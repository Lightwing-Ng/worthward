"""Tests for the Bayesian Price Field strategy. Code version: v1.15.0."""

from __future__ import annotations

import math
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import numpy as np
import pandas as pd

from strategies.algorithms.strategy_bayesian_price_field import (
    _MODEL_VERSION,
    _ComputeBackend,
    _MIN_NOISE_VARIANCE,
    BayesianPriceFieldStrategy,
    _build_factor_columns,
    _bundle_ohlcv_frame,
    _frame_fingerprint,
    _longbridge_symbol,
    _merge_bundle_observations,
    _option_ratio,
    _probability_field_hit_rate,
    _probability_threshold_signals,
    _ridge_residual_variance,
    _resolve_compute_backend,
    _rolling_volume_at_price_percentile,
    _select_active_factors,
    _walk_forward_predictions,
)
from strategies.base import normalize_strategy_presentation


def _market_frame(row_count: int = 180) -> pd.DataFrame:
    generator = np.random.default_rng(208)
    log_returns = 0.0006 + generator.normal(0.0, 0.009, row_count)
    close = 100.0 * np.exp(np.cumsum(log_returns))
    volume = 1_000_000.0 * np.clip(
        1.0 + generator.normal(0.0, 0.18, row_count),
        0.1,
        None,
    )
    return pd.DataFrame(
        {
            "Date": pd.date_range("2025-01-02", periods=row_count, freq="D"),
            "Open": close * 0.999,
            "High": close * 1.01,
            "Low": close * 0.99,
            "Close": close,
            "Volume": volume,
        }
    )


def _cpu_params(**overrides: object) -> dict[str, object]:
    return {
        "compute_backend": "CPU",
        "training_window": 60,
        "chip_window": 20,
        **overrides,
    }


def _bundle_from_frame(
        frame: pd.DataFrame,
        *,
        pe_history: tuple[object, ...] = (),
        option_history: tuple[object, ...] = (),
        fingerprint: str = "bundle-fingerprint",
        factor_status: dict[str, str] | None = None,
) -> SimpleNamespace:
    bars = tuple(
        SimpleNamespace(
            observed_at=row.Date,
            open=row.Open,
            high=row.High,
            low=row.Low,
            close=row.Close,
            volume=row.Volume,
            turnover=None,
        )
        for row in frame.itertuples(index=False)
    )
    return SimpleNamespace(
        ohlcv=bars,
        pe_history=pe_history,
        option_history=option_history,
        fingerprint=fingerprint,
        factor_status=factor_status
        or {"ohlcv": "available", "pe": "missing", "options": "missing"},
        source_commands=("longbridge kline history AAPL.US",),
    )


class BayesianPriceFieldStrategyTests(unittest.TestCase):
    def test_longbridge_symbol_reuses_the_shared_share_class_contract(self) -> None:
        self.assertEqual(_longbridge_symbol("AAPL"), "AAPL.US")
        self.assertEqual(_longbridge_symbol("BRK.B"), "BRK.B.US")
        self.assertEqual(_longbridge_symbol("BRK-B"), "BRK.B.US")
        self.assertEqual(_longbridge_symbol("700.HK"), "700.HK")

    def test_bundle_frame_preserves_market_local_naive_midnight(self) -> None:
        local_trading_day = pd.Timestamp("2026-08-28")
        bundle = SimpleNamespace(
            symbol="700.HK",
            ohlcv=(
                SimpleNamespace(
                    observed_at=local_trading_day,
                    open=100.0,
                    high=101.0,
                    low=99.0,
                    close=100.0,
                    volume=1_000_000.0,
                    turnover=100_000_000.0,
                ),
            ),
            fingerprint="local-day-fingerprint",
        )

        frame = _bundle_ohlcv_frame(bundle)

        self.assertEqual(frame["Date"].tolist(), [local_trading_day])
        self.assertIsNone(frame["Date"].dt.tz)
        self.assertEqual(frame["Date"].iloc[0].hour, 0)

    def test_probability_threshold_intent_repeats_until_the_engine_can_fill(self) -> None:
        buy_signals, sell_signals = _probability_threshold_signals(
            [float("nan"), 0.70, 0.72, 0.30, 0.20],
            0.60,
        )

        np.testing.assert_array_equal(
            buy_signals,
            [False, True, True, False, False],
        )
        np.testing.assert_array_equal(
            sell_signals,
            [False, False, False, True, True],
        )

    def test_metadata_and_parameters_expose_the_strategy_contract(self) -> None:
        strategy = BayesianPriceFieldStrategy()
        metadata = strategy.get_metadata()

        self.assertEqual(metadata.strategy_id, "bayesian-price-field")
        self.assertEqual(metadata.name, "Bayesian Price Field")
        self.assertEqual(metadata.category, "machine-learning")
        self.assertEqual(metadata.display_order, 42)
        self.assertEqual(strategy.get_default_tickers(), ("NVDA",))
        self.assertEqual(strategy.get_supported_intervals(), ("1d", "1m"))
        self.assertEqual(strategy.get_model_interval("1d"), "1d")
        self.assertEqual(strategy.get_model_interval("1m"), "1d")
        self.assertEqual(
            strategy.get_signal_bridge("1m"),
            "daily-close-to-next-session-open",
        )
        self.assertEqual(
            strategy.get_interval_notice("1m"),
            "Daily Bayesian model; the probability field is available at 1d.",
        )
        self.assertEqual(strategy.strategy_market_data_source, "longbridge-cli")
        self.assertFalse(strategy.backtest_cacheable)

        definitions = {
            definition.key: definition
            for definition in strategy.get_parameter_definitions()
        }
        self.assertEqual(
            {
                "use_pe_ratio",
                "use_volume",
                "use_options",
                "use_volume_at_price",
                "use_pb_ratio",
                "use_ps_ratio",
                "use_dividend_yield",
                "use_market_temperature",
                "use_capital_flow",
                "use_shareholder_concentration",
                "use_fund_holder_weight",
                "use_short_interest",
                "use_short_volume",
                "use_broker_holding",
                "training_window",
                "chip_window",
                "prior_strength",
                "entry_probability",
                "compute_backend",
            },
            set(definitions),
        )
        self.assertEqual(definitions["compute_backend"].options, ("Auto", "CPU", "GPU"))
        self.assertEqual(definitions["compute_backend"].default, "Auto")
        self.assertIn("Auto uses NumPy CPU", definitions["compute_backend"].help_text)
        self.assertIn("GPU explicitly requests Apple MPS", definitions["compute_backend"].help_text)
        self.assertIn("Low-High price bins", definitions["use_volume_at_price"].help_text)
        self.assertEqual(_MODEL_VERSION, "bayesian-price-field-model/v1.7.0")

    def test_probability_field_hit_rate_is_bounded_and_uses_only_later_observations(self) -> None:
        frame = _market_frame(90)
        strategy = BayesianPriceFieldStrategy()
        result = strategy.compute_signals(
            frame,
            _cpu_params(use_pe_ratio=False, use_options=False),
        )
        hit_rate = result.presentation["hit_rate"]

        self.assertTrue(hit_rate["causal"])
        self.assertGreater(hit_rate["scored_points"], 0)
        self.assertGreaterEqual(hit_rate["score_pct"], 0.0)
        self.assertLessEqual(hit_rate["score_pct"], 100.0)
        self.assertEqual(
            hit_rate["probability_weighted_score_pct"],
            hit_rate["score_pct"],
        )
        self.assertEqual(hit_rate["realized_cell_score_pct"], hit_rate["score_pct"])
        self.assertGreaterEqual(hit_rate["event_hit_rate_pct"], 0.0)
        self.assertLessEqual(hit_rate["event_hit_rate_pct"], 100.0)
        self.assertGreaterEqual(hit_rate["event_hits"], 0)
        self.assertLessEqual(hit_rate["event_hits"], hit_rate["scored_points"])
        self.assertEqual(hit_rate["lattice_coverage_pct"], hit_rate["event_hit_rate_pct"])
        self.assertEqual(hit_rate["metric_kind"], "causal-log-return-realized-cell-score")
        self.assertEqual(hit_rate["scoring_lattice"]["horizons"], "1..20")
        self.assertEqual(hit_rate["max_horizon"], 20)
        self.assertEqual(hit_rate["rows_above"], 10)
        self.assertEqual(hit_rate["rows_below"], 10)
        self.assertEqual(
            result.metadata["probability_field_hit_rate_pct"],
            hit_rate["score_pct"],
        )

    def test_probability_field_hit_rate_does_not_score_same_day_predictions(self) -> None:
        close = np.full(45, 100.0)
        means = np.full(45, np.nan)
        scales = np.full(45, np.nan)
        means[-1] = 0.0
        scales[-1] = 0.02
        hit_rate = _probability_field_hit_rate(close, means, scales)

        # The final origin has no later trading-day close, so a same-day
        # prediction can never contribute a point to the score.
        self.assertEqual(hit_rate["scored_points"], 0)
        self.assertEqual(hit_rate["score_pct"], 0.0)

    def test_walk_forward_prediction_has_no_future_lookahead(self) -> None:
        original = _market_frame()
        changed_future = original.copy()
        future_start = 145
        changed_future.loc[future_start:, "Close"] *= np.linspace(
            1.2,
            2.5,
            len(changed_future) - future_start,
        )
        changed_future.loc[future_start:, "High"] = changed_future.loc[future_start:, "Close"] * 1.02
        changed_future.loc[future_start:, "Low"] = changed_future.loc[future_start:, "Close"] * 0.98
        changed_future.loc[future_start:, "Volume"] *= 7.0

        first = BayesianPriceFieldStrategy().compute_signals(
            original,
            _cpu_params(use_pe_ratio=False, use_options=False),
        )
        second = BayesianPriceFieldStrategy().compute_signals(
            changed_future,
            _cpu_params(use_pe_ratio=False, use_options=False),
        )

        for column in (
            "bayesian_predictive_mean",
            "bayesian_predictive_std",
            "bayesian_probability_up",
        ):
            np.testing.assert_allclose(
                first.frame.loc[: future_start - 1, column],
                second.frame.loc[: future_start - 1, column],
                rtol=0.0,
                atol=1e-12,
                equal_nan=True,
            )

    def test_walk_forward_prediction_ignores_future_pe_options_and_research_values(self) -> None:
        frame = _market_frame()
        future_start = 145
        dates = pd.to_datetime(frame["Date"])

        def bundle_with_factor_multiplier(multiplier: float) -> SimpleNamespace:
            pe_history = tuple(
                SimpleNamespace(
                    observed_at=timestamp,
                    value=(18.0 + (index * 0.03))
                    * (multiplier if index >= future_start else 1.0),
                )
                for index, timestamp in enumerate(dates)
            )
            option_history = tuple(
                SimpleNamespace(
                    observed_at=timestamp,
                    put_call_volume_ratio=(0.8 + (index * 0.002))
                    * (multiplier if index >= future_start else 1.0),
                    put_call_open_interest_ratio=None,
                    put_volume=None,
                    call_volume=None,
                    put_open_interest=None,
                    call_open_interest=None,
                )
                for index, timestamp in enumerate(dates)
            )
            bundle = _bundle_from_frame(
                frame,
                pe_history=pe_history,
                option_history=option_history,
                factor_status={
                    "ohlcv": "available",
                    "pe": "available",
                    "options": "available",
                    "pb_ratio": "available",
                },
            )
            bundle.research_history = tuple(
                SimpleNamespace(
                    observed_at=timestamp,
                    factor="pb_ratio",
                    value=(2.0 + (index * 0.01))
                    * (multiplier if index >= future_start else 1.0),
                    source="test",
                )
                for index, timestamp in enumerate(dates)
            )
            return bundle

        first_strategy = BayesianPriceFieldStrategy()
        first_strategy._warmup_bundle = bundle_with_factor_multiplier(1.0)
        first = first_strategy.compute_signals(
            frame,
            _cpu_params(
                use_pe_ratio=True,
                use_options=True,
                use_pb_ratio=True,
                use_volume=False,
                use_volume_at_price=False,
            ),
        )
        second_strategy = BayesianPriceFieldStrategy()
        second_strategy._warmup_bundle = bundle_with_factor_multiplier(1_000.0)
        second = second_strategy.compute_signals(
            frame,
            _cpu_params(
                use_pe_ratio=True,
                use_options=True,
                use_pb_ratio=True,
                use_volume=False,
                use_volume_at_price=False,
            ),
        )

        for column in (
            "bayesian_predictive_mean",
            "bayesian_predictive_std",
            "bayesian_probability_up",
        ):
            np.testing.assert_allclose(
                first.frame.loc[: future_start - 1, column],
                second.frame.loc[: future_start - 1, column],
                rtol=0.0,
                atol=1e-12,
                equal_nan=True,
            )
        self.assertTrue(
            np.any(
                np.not_equal(
                    first.frame.loc[future_start:, "bayesian_predictive_mean"],
                    second.frame.loc[future_start:, "bayesian_predictive_mean"],
                )
            )
        )

    def test_walk_forward_noise_uses_regularized_residual_variance_floor(self) -> None:
        row_count = 40
        forward_returns = np.linspace(-0.02, 0.02, row_count - 1)
        close = np.empty(row_count, dtype=np.float64)
        close[0] = 100.0
        for index, forward_return in enumerate(forward_returns, start=1):
            close[index] = close[index - 1] * math.exp(float(forward_return))
        frame = pd.DataFrame({"Close": close})
        factor = np.concatenate((forward_returns, [forward_returns[-1]]))
        backend = _resolve_compute_backend("CPU")
        observed_noise_variances: list[float] = []

        def capture_prediction(
                _backend: object,
                design: np.ndarray,
                target: np.ndarray,
                current: np.ndarray,
                prior_strength: float,
                noise_variance: float,
        ) -> tuple[float, float]:
            del _backend, design, target, current, prior_strength
            observed_noise_variances.append(noise_variance)
            return 0.0, math.sqrt(noise_variance)

        with patch(
            "strategies.algorithms.strategy_bayesian_price_field._bayesian_prediction",
            side_effect=capture_prediction,
        ):
            _walk_forward_predictions(
                frame,
                {"signal": factor},
                ["signal"],
                training_window=30,
                prior_strength=1.0,
                backend=backend,
            )

        self.assertTrue(observed_noise_variances)
        self.assertGreaterEqual(min(observed_noise_variances), _MIN_NOISE_VARIANCE)
        self.assertLess(max(observed_noise_variances), float(np.var(forward_returns[:20], ddof=1)))
        self.assertGreater(float(np.var(forward_returns[:20], ddof=1)), 1e-5)

    def test_ridge_noise_fallback_keeps_regularization_when_direct_solve_fails(self) -> None:
        design = np.column_stack((np.ones(30), np.linspace(-1.0, 1.0, 30)))
        target = np.linspace(-0.02, 0.02, 30)
        with patch(
            "strategies.algorithms.strategy_bayesian_price_field.np.linalg.solve",
            side_effect=np.linalg.LinAlgError("forced recovery"),
        ):
            variance = _ridge_residual_variance(design, target, prior_strength=1.0)

        self.assertTrue(math.isfinite(variance))
        self.assertGreaterEqual(variance, _MIN_NOISE_VARIANCE)

    def test_sparse_factor_fallback_is_independent_of_parameter_order(self) -> None:
        candidate_indices = np.arange(40, dtype=np.int64)
        target_mask = np.ones(40, dtype=bool)
        first = np.full(41, np.nan)
        second = np.full(41, np.nan)
        first[:25] = np.linspace(1.0, 2.0, 25)
        second[10:41] = np.linspace(3.0, 5.0, 31)
        factor_values = {"sparse": first, "dense": second}

        selected_forward = _select_active_factors(
            factor_values,
            ["sparse", "dense"],
            candidate_indices,
            40,
            target_mask,
        )
        selected_reversed = _select_active_factors(
            factor_values,
            ["dense", "sparse"],
            candidate_indices,
            40,
            target_mask,
        )
        self.assertEqual(selected_forward, selected_reversed)
        self.assertEqual(selected_forward, ["dense"])

    def test_volume_at_price_factor_is_a_causal_volume_weighted_cdf(self) -> None:
        low_close_frame = pd.DataFrame(
            {
                "Date": pd.date_range("2026-01-01", periods=5, freq="D"),
                "Open": [5.0] * 5,
                "High": [10.0] * 5,
                "Low": [0.0] * 5,
                "Close": [5.0, 5.0, 2.0, 5.0, 5.0],
                "Volume": [100.0] * 5,
            }
        )
        high_close_frame = low_close_frame.copy()
        high_close_frame.loc[2, "Close"] = 8.0

        low_percentile = _rolling_volume_at_price_percentile(
            low_close_frame,
            chip_window=3,
        )
        high_percentile = _rolling_volume_at_price_percentile(
            high_close_frame,
            chip_window=3,
        )

        self.assertAlmostEqual(low_percentile[2], 0.2, places=12)
        self.assertAlmostEqual(high_percentile[2], 0.8, places=12)

        changed_future = low_close_frame.copy()
        changed_future.loc[3:, ["Low", "High", "Volume"]] = [
            [-100.0, 1_000.0, 10_000_000.0],
            [-200.0, 2_000.0, 20_000_000.0],
        ]
        changed_percentile = _rolling_volume_at_price_percentile(
            changed_future,
            chip_window=3,
        )
        np.testing.assert_allclose(
            low_percentile[:3],
            changed_percentile[:3],
            rtol=0.0,
            atol=0.0,
            equal_nan=True,
        )

    def test_asof_factor_merges_enforce_pe_and_options_staleness_limits(self) -> None:
        frame = _market_frame(25)
        first_date = pd.Timestamp(frame["Date"].iloc[0])
        bundle = _bundle_from_frame(
            frame,
            pe_history=(SimpleNamespace(observed_at=first_date, value=18.0),),
            option_history=(
                SimpleNamespace(
                    observed_at=first_date,
                    put_call_volume_ratio=1.2,
                    put_call_open_interest_ratio=None,
                    put_volume=None,
                    call_volume=None,
                    put_open_interest=None,
                    call_open_interest=None,
                ),
            ),
        )

        merged = _merge_bundle_observations(frame, bundle)

        self.assertEqual(merged.loc[14, "bayesian_pe_ratio"], 18.0)
        self.assertTrue(pd.isna(merged.loc[15, "bayesian_pe_ratio"]))
        self.assertEqual(
            merged.loc[7, "bayesian_option_put_call_ratio"],
            1.2,
        )
        self.assertTrue(
            pd.isna(merged.loc[8, "bayesian_option_put_call_ratio"])
        )

    def test_factor_status_reports_stale_error_disabled_and_insufficient(self) -> None:
        frame = _market_frame(60)
        first_date = pd.Timestamp(frame["Date"].iloc[0])
        stale_bundle = _bundle_from_frame(
            frame,
            pe_history=(SimpleNamespace(observed_at=first_date, value=18.0),),
            option_history=(
                SimpleNamespace(
                    observed_at=first_date,
                    put_call_volume_ratio=1.1,
                    put_call_open_interest_ratio=None,
                    put_volume=None,
                    call_volume=None,
                    put_open_interest=None,
                    call_open_interest=None,
                ),
            ),
            factor_status={"ohlcv": "available", "pe": "available", "options": "available"},
        )
        stale_strategy = BayesianPriceFieldStrategy()
        stale_strategy._warmup_bundle = stale_bundle
        stale_result = stale_strategy.compute_signals(frame, _cpu_params())
        stale_factors = {
            factor["key"]: factor
            for factor in stale_result.presentation["factors"]
        }

        self.assertEqual(stale_factors["pe"]["status"], "stale")
        self.assertEqual(stale_factors["options"]["status"], "stale")
        self.assertGreater(stale_factors["pe"]["finite_observations"], 0)
        self.assertLess(stale_factors["pe"]["coverage"], 1.0)

        last_date = pd.Timestamp(frame["Date"].iloc[-1])
        one_value_bundle = _bundle_from_frame(
            frame,
            pe_history=(SimpleNamespace(observed_at=last_date, value=20.0),),
            factor_status={"ohlcv": "available", "pe": "available", "options": "error"},
        )
        one_value_strategy = BayesianPriceFieldStrategy()
        one_value_strategy._warmup_bundle = one_value_bundle
        one_value_result = one_value_strategy.compute_signals(
            frame,
            _cpu_params(use_options=True, use_volume=False),
        )
        one_value_factors = {
            factor["key"]: factor
            for factor in one_value_result.presentation["factors"]
        }

        self.assertEqual(one_value_factors["pe"]["status"], "insufficient")
        self.assertEqual(one_value_factors["pe"]["finite_observations"], 1)
        self.assertEqual(one_value_factors["options"]["status"], "error")
        self.assertEqual(one_value_factors["volume"]["status"], "disabled")

        unavailable_bundle = _bundle_from_frame(
            frame,
            factor_status={
                "ohlcv": "available",
                "short_interest": "unavailable_point_in_time",
                "capital_flow": "unsupported_history",
            },
        )
        unavailable_strategy = BayesianPriceFieldStrategy()
        unavailable_strategy._warmup_bundle = unavailable_bundle
        unavailable_result = unavailable_strategy.compute_signals(
            frame,
            _cpu_params(
                use_short_interest=True,
                use_capital_flow=True,
                use_volume=False,
            ),
        )
        unavailable_factors = {
            factor["key"]: factor
            for factor in unavailable_result.presentation["factors"]
        }
        self.assertEqual(
            unavailable_factors["short_interest"]["status"],
            "unavailable_point_in_time",
        )
        self.assertEqual(
            unavailable_factors["capital_flow"]["status"],
            "unsupported_history",
        )

    def test_model_fingerprint_covers_bundle_params_ohlcv_and_derived_factors(self) -> None:
        frame = _market_frame(80)
        frame["bayesian_pe_ratio"] = np.linspace(15.0, 20.0, len(frame))
        frame["bayesian_option_put_call_ratio"] = np.linspace(0.8, 1.2, len(frame))
        params = BayesianPriceFieldStrategy().normalize_params(_cpu_params())
        factors = _build_factor_columns(frame, int(params["chip_window"]))

        baseline = _frame_fingerprint(frame, factors, params, "bundle-a")
        changed_bundle = _frame_fingerprint(frame, factors, params, "bundle-b")
        changed_params = {
            **params,
            "training_window": int(params["training_window"]) + 1,
        }
        changed_training_window = _frame_fingerprint(
            frame,
            factors,
            changed_params,
            "bundle-a",
        )
        changed_ohlcv_frame = frame.copy()
        changed_ohlcv_frame.loc[10, "High"] += 0.01
        changed_ohlcv_factors = _build_factor_columns(
            changed_ohlcv_frame,
            int(params["chip_window"]),
        )
        changed_ohlcv = _frame_fingerprint(
            changed_ohlcv_frame,
            changed_ohlcv_factors,
            params,
            "bundle-a",
        )
        changed_factor_values = {
            key: values.copy()
            for key, values in factors.items()
        }
        changed_factor_values["pe"][40] += 0.01
        changed_derived_factor = _frame_fingerprint(
            frame,
            changed_factor_values,
            params,
            "bundle-a",
        )

        self.assertEqual(
            len(
                {
                    baseline,
                    changed_bundle,
                    changed_training_window,
                    changed_ohlcv,
                    changed_derived_factor,
                }
            ),
            5,
        )

    def test_presentation_contains_only_finite_probability_values(self) -> None:
        result = BayesianPriceFieldStrategy().compute_signals(
            _market_frame(),
            _cpu_params(),
        )
        presentation = normalize_strategy_presentation(result.presentation)

        self.assertEqual(presentation["schema"], "bayesian-price-field/v1")
        self.assertEqual(presentation["renderer"], "probability-grid-v1")
        self.assertEqual(presentation["model_version"], _MODEL_VERSION)
        self.assertEqual(presentation["rows_above"], 10)
        self.assertEqual(presentation["rows_below"], 10)
        self.assertEqual(presentation["columns"], 20)
        self.assertEqual(presentation["width_fraction"], 0.25)
        self.assertEqual(presentation["gap_px"], 2)
        self.assertEqual(presentation["padding_px"], 8)
        self.assertEqual(presentation["min_cell_px"], 4)
        self.assertEqual(presentation["cell_radius_px"], 2)
        self.assertEqual(presentation["tooltip_radius_px"], 10)
        self.assertEqual(presentation["tooltip_transparency_pct"], 50)
        self.assertEqual(
            presentation["cell_opacity_mapping"],
            "instant-contrast-power-v1",
        )
        self.assertEqual(presentation["cell_opacity_exponent"], 1.6)
        self.assertEqual(presentation["cell_opacity_tail_ratio"], 0.02)
        self.assertEqual(presentation["time_quantization"], "integer-trading-days")
        self.assertEqual(
            presentation["metric_geometry"]["scoring_lattice"]["horizons"],
            "1..20",
        )
        self.assertEqual(
            presentation["metric_geometry"]["render_lattice"]["columns"],
            20,
        )
        self.assertEqual(
            presentation["metric_geometry"]["render_lattice"]["horizon_mapping"],
            "viewport-quantized",
        )
        self.assertEqual(len(presentation["predictive_mean"]), len(result.frame))
        self.assertEqual(len(presentation["predictive_scale"]), len(result.frame))
        self.assertEqual(len(presentation["probability_up"]), len(result.frame))
        self.assertEqual(
            presentation["data_keys"],
            [pd.Timestamp(value).isoformat() for value in result.frame["Date"]],
        )
        self.assertEqual(result.required_execution_mode, "next_open")
        for key in ("predictive_mean", "predictive_scale", "probability_up"):
            finite_values = [
                value
                for value in presentation[key]
                if value is not None
            ]
            self.assertTrue(finite_values)
            self.assertTrue(all(math.isfinite(value) for value in finite_values))
        self.assertTrue(
            all(
                0.0 <= value <= 1.0
                for value in presentation["probability_up"]
                if value is not None
            )
        )
        self.assertTrue(
            all(
                value > 0.0
                for value in presentation["predictive_scale"]
                if value is not None
            )
        )

    def test_missing_pe_and_options_are_reported_without_blocking_prediction(self) -> None:
        result = BayesianPriceFieldStrategy().compute_signals(
            _market_frame(),
            _cpu_params(use_pe_ratio=True, use_options=True),
        )
        statuses = {
            factor["key"]: factor["status"]
            for factor in result.presentation["factors"]
        }

        self.assertEqual(statuses["pe"], "insufficient")
        self.assertEqual(statuses["options"], "insufficient")
        self.assertEqual(statuses["volume"], "active")
        self.assertEqual(statuses["volume_at_price"], "active")
        factor_details = {
            factor["key"]: factor
            for factor in result.presentation["factors"]
        }
        self.assertEqual(factor_details["pe"]["finite_observations"], 0)
        self.assertEqual(factor_details["pe"]["coverage"], 0.0)
        self.assertEqual(
            factor_details["volume"]["finite_observations"],
            len(result.frame),
        )
        self.assertEqual(factor_details["volume"]["coverage"], 1.0)
        self.assertGreater(result.frame["bayesian_probability_up"].notna().sum(), 0)

    def test_research_factor_observations_join_as_of_and_are_exposed_in_the_model(self) -> None:
        frame = _market_frame(80)
        observations = tuple(
            SimpleNamespace(
                observed_at=frame["Date"].iloc[index],
                factor="pb_ratio",
                value=2.0 + (index / 100.0),
            )
            for index in range(20, 80, 10)
        )
        bundle = _bundle_from_frame(
            frame,
            factor_status={"ohlcv": "available", "pb_ratio": "available"},
        )
        bundle.research_history = observations
        strategy = BayesianPriceFieldStrategy()
        strategy._warmup_bundle = bundle
        result = strategy.compute_signals(
            frame,
            _cpu_params(
                use_pe_ratio=False,
                use_options=False,
                use_pb_ratio=True,
            ),
        )

        merged = _merge_bundle_observations(frame, bundle)
        self.assertIn("pb_ratio", _build_factor_columns(merged, 20))
        pb_factor = next(
            factor for factor in result.presentation["factors"]
            if factor["key"] == "pb_ratio"
        )
        self.assertTrue(pb_factor["enabled"])
        self.assertGreater(pb_factor["finite_observations"], 0)

    def test_options_factor_derives_ratios_from_raw_volume_and_open_interest(self) -> None:
        observation = SimpleNamespace(
            put_call_volume_ratio=None,
            put_call_open_interest_ratio=None,
            put_volume=300.0,
            call_volume=200.0,
            put_open_interest=600.0,
            call_open_interest=400.0,
        )

        self.assertEqual(_option_ratio(observation), 1.5)

    def test_constant_inputs_produce_a_stable_intercept_only_posterior(self) -> None:
        row_count = 100
        frame = pd.DataFrame(
            {
                "Date": pd.date_range("2025-01-02", periods=row_count, freq="D"),
                "Open": [100.0] * row_count,
                "High": [100.0] * row_count,
                "Low": [100.0] * row_count,
                "Close": [100.0] * row_count,
                "Volume": [1_000_000.0] * row_count,
            }
        )
        result = BayesianPriceFieldStrategy().compute_signals(
            frame,
            _cpu_params(use_pe_ratio=False, use_options=False),
        )
        finite = result.frame.dropna(subset=["bayesian_probability_up"])

        self.assertFalse(finite.empty)
        np.testing.assert_allclose(finite["bayesian_predictive_mean"], 0.0, atol=1e-12)
        np.testing.assert_allclose(finite["bayesian_probability_up"], 0.5, atol=1e-12)
        self.assertTrue((finite["bayesian_predictive_std"] > 0.0).all())
        self.assertFalse(result.frame["buy_signal"].any())
        self.assertFalse(result.frame["sell_signal"].any())

    def test_auto_and_cpu_backends_use_numpy_without_loading_torch(self) -> None:
        for requested in ("Auto", "CPU"):
            for system_name in ("Darwin", "Windows"):
                with self.subTest(requested=requested, system=system_name):
                    with (
                        patch(
                            "strategies.algorithms.strategy_bayesian_price_field._load_torch",
                        ) as load_torch,
                        patch(
                            "strategies.algorithms.strategy_bayesian_price_field.platform.system",
                            return_value=system_name,
                        ) as platform_system,
                    ):
                        backend = _resolve_compute_backend(requested)

                    self.assertEqual(backend.requested, requested)
                    self.assertEqual(backend.resolved, "cpu")
                    self.assertEqual(backend.engine, "numpy")
                    load_torch.assert_not_called()
                    platform_system.assert_not_called()

    def test_gpu_backend_falls_back_to_cpu_without_torch(self) -> None:
        for system_name in ("Darwin", "Windows"):
            with self.subTest(system=system_name):
                with (
                    patch(
                        "strategies.algorithms.strategy_bayesian_price_field._load_torch",
                        return_value=None,
                    ) as load_torch,
                    patch(
                        "strategies.algorithms.strategy_bayesian_price_field.platform.system",
                        return_value=system_name,
                    ) as platform_system,
                ):
                    backend = _resolve_compute_backend("GPU")

                self.assertEqual(backend.requested, "GPU")
                self.assertEqual(backend.resolved, "cpu")
                self.assertEqual(backend.engine, "numpy")
                load_torch.assert_called_once_with()
                platform_system.assert_not_called()

    def test_runtime_gpu_failure_restarts_the_complete_walk_forward_pass_on_cpu(self) -> None:
        frame = _market_frame()
        expected = BayesianPriceFieldStrategy().compute_signals(
            frame,
            _cpu_params(use_pe_ratio=False, use_options=False),
        )
        gpu_backend = _ComputeBackend(
            requested="GPU",
            resolved="mps",
            engine="torch",
            torch_module=object(),
            numeric_precision="float32",
        )
        attempts = 0

        def fake_torch_prediction(*_args: object, **_kwargs: object) -> tuple[float, float]:
            nonlocal attempts
            attempts += 1
            if attempts == 1:
                return 0.987654321, 0.1
            raise RuntimeError("simulated MPS solve failure")

        with (
            patch(
                "strategies.algorithms.strategy_bayesian_price_field._resolve_compute_backend",
                return_value=gpu_backend,
            ),
            patch(
                "strategies.algorithms.strategy_bayesian_price_field._torch_bayesian_prediction",
                side_effect=fake_torch_prediction,
            ),
        ):
            result = BayesianPriceFieldStrategy().compute_signals(
                frame,
                _cpu_params(
                    compute_backend="GPU",
                    use_pe_ratio=False,
                    use_options=False,
                ),
            )

        self.assertEqual(attempts, 2)
        for column in (
            "bayesian_predictive_mean",
            "bayesian_predictive_std",
            "bayesian_probability_up",
        ):
            np.testing.assert_allclose(
                result.frame[column],
                expected.frame[column],
                rtol=0.0,
                atol=1e-12,
                equal_nan=True,
            )
        self.assertEqual(result.presentation["device"]["requested"], "GPU")
        self.assertEqual(result.presentation["device"]["resolved"], "cpu")
        self.assertEqual(result.presentation["device"]["engine"], "numpy-fallback")
        self.assertEqual(result.presentation["device"]["numeric_precision"], "float64")
        self.assertIn("RuntimeError", result.presentation["device"]["fallback_reason"])

    def test_torch_initialization_failure_falls_back_without_swallowing_process_control(self) -> None:
        with patch(
            "strategies.algorithms.strategy_bayesian_price_field.importlib.import_module",
            side_effect=RuntimeError("Torch runtime is incompatible."),
        ):
            backend = _resolve_compute_backend("GPU")

        self.assertEqual(backend.resolved, "cpu")
        self.assertEqual(backend.engine, "numpy")

        for process_control_exception in (KeyboardInterrupt(), SystemExit()):
            with (
                self.subTest(exception=type(process_control_exception).__name__),
                patch(
                    "strategies.algorithms.strategy_bayesian_price_field.importlib.import_module",
                    side_effect=process_control_exception,
                ),
                self.assertRaises(type(process_control_exception)),
            ):
                _resolve_compute_backend("GPU")

    def test_gpu_backend_prefers_native_gpu_for_each_desktop_platform(self) -> None:
        torch_module = SimpleNamespace(
            backends=SimpleNamespace(
                mps=SimpleNamespace(is_available=lambda: True),
            ),
            cuda=SimpleNamespace(is_available=lambda: True),
        )
        for system_name, expected_device in (("Darwin", "mps"), ("Windows", "cuda")):
            with self.subTest(system=system_name):
                with (
                    patch(
                        "strategies.algorithms.strategy_bayesian_price_field._load_torch",
                        return_value=torch_module,
                    ),
                    patch(
                        "strategies.algorithms.strategy_bayesian_price_field.platform.system",
                        return_value=system_name,
                    ),
                ):
                    backend = _resolve_compute_backend("GPU")

                self.assertEqual(backend.requested, "GPU")
                self.assertEqual(backend.resolved, expected_device)
                self.assertEqual(backend.engine, "torch")

    def test_auto_backend_presentation_reports_numpy_cpu_without_loading_torch(self) -> None:
        with patch(
            "strategies.algorithms.strategy_bayesian_price_field._load_torch",
        ) as load_torch:
            result = BayesianPriceFieldStrategy().compute_signals(
                _market_frame(),
                _cpu_params(compute_backend="Auto"),
            )

        load_torch.assert_not_called()
        self.assertEqual(
            result.presentation["device"],
            {
                "requested": "Auto",
                "resolved": "cpu",
                "engine": "numpy",
                "numeric_precision": "float64",
                "fallback_reason": None,
            },
        )
        self.assertEqual(result.metadata["compute_device"], "cpu")

    def test_market_loader_requests_warmup_and_preserves_the_bundle(self) -> None:
        bars = tuple(
            SimpleNamespace(
                observed_at=timestamp,
                open=100.0,
                high=101.0,
                low=99.0,
                close=100.0,
                volume=1_000_000.0,
                turnover=100_000_000.0,
            )
            for timestamp in pd.date_range("2024-09-01", periods=10, freq="D", tz="UTC")
        )
        bundle = SimpleNamespace(
            ohlcv=bars,
            pe_history=(),
            option_history=(),
            fingerprint="bundle-fingerprint",
            factor_status={"ohlcv": "available", "pe": "disabled", "options": "disabled"},
            source_commands=("longbridge kline history AAPL.US",),
        )
        strategy = BayesianPriceFieldStrategy()
        requested_start = pd.Timestamp("2025-01-02")
        with patch(
            "app.services.bayesian_market_factors.fetch_bayesian_factor_bundle",
            return_value=bundle,
        ) as fetch_bundle:
            datasets = strategy.load_market_datasets(
                ["AAPL"],
                interval="1d",
                start=requested_start,
                end=pd.Timestamp("2025-04-01"),
                params=_cpu_params(
                    training_window=120,
                    chip_window=30,
                    use_pe_ratio=False,
                    use_options=False,
                ),
            )

        self.assertIs(strategy._warmup_bundle, bundle)
        self.assertEqual(len(datasets or []), 1)
        self.assertEqual(datasets[0].attrs["market_data_source"], "longbridge-cli")
        call_args = fetch_bundle.call_args
        self.assertEqual(call_args.args[0], "AAPL.US")
        self.assertLess(pd.Timestamp(call_args.args[1]), requested_start)
        self.assertFalse(call_args.kwargs["include_pe"])
        self.assertFalse(call_args.kwargs["include_options"])


if __name__ == "__main__":
    unittest.main()
