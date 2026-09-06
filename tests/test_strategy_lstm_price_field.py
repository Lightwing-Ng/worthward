"""Tests for the LSTM Price Field strategy. Code version: v1.4.1."""

from __future__ import annotations

import math
from pathlib import Path
import unittest
from unittest.mock import patch

import numpy as np
import pandas as pd

from strategies.algorithms.strategy_lstm_price_field import (
    _MODEL_VERSION,
    LSTMPriceFieldStrategy,
)
from strategies.algorithms.strategy_bayesian_price_field import (
    BayesianPriceFieldStrategy,
)
from strategies.price_field_pipeline import (
    PRICE_FIELD_FACTOR_DEFINITIONS,
)
from strategies.base import normalize_strategy_presentation
from strategies.loader import instantiate_strategy, list_enabled_strategies
from strategies.price_field_contract import (
    LSTM_PRICE_FIELD_SCHEMA,
    PROBABILITY_GRID_RENDERER,
    probability_grid_geometry_fields,
)


def _market_frame(row_count: int = 96) -> pd.DataFrame:
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
        "training_window": 40,
        "chip_window": 12,
        "lstm_lookback": 4,
        "lstm_hidden_size": 4,
        "lstm_epochs": 1,
        "lstm_learning_rate": 0.05,
        "lstm_seed": 42,
        "use_pe_ratio": False,
        "use_options": False,
        "use_volume": True,
        "use_volume_at_price": False,
        **overrides,
    }


class LSTMPriceFieldStrategyTests(unittest.TestCase):
    def test_disabled_vap_skips_kernel_and_chip_window_warmup(self):
        from strategies.price_field_pipeline import load_price_field_market_bundle

        with patch("strategies.price_field_pipeline._rolling_volume_at_price_percentile",
                   side_effect=AssertionError("Disabled VAP must not run")):
            result = LSTMPriceFieldStrategy().compute_signals(_market_frame(), _cpu_params(chip_window=74))
        self.assertNotIn("volume_at_price", result.presentation["factor_selection"]["selected"])
        starts = []
        with patch("strategies.price_field_pipeline.is_remote_market_access_disabled", return_value=True), patch(
                "app.services.price_field_market_factors.build_local_price_field_factor_bundle") as loader:
            for chip, enabled in ((74, False), (30, False), (74, True)):
                load_price_field_market_bundle(["TEST"], interval="1d", start="2025-06-01",
                                               end="2025-07-01", params=_cpu_params(
                                                   training_window=57, chip_window=chip,
                                                   use_volume_at_price=enabled))
                starts.append(loader.call_args.args[1])
        self.assertEqual(starts[0], starts[1])
        self.assertLess(starts[2], starts[0])

    def test_latest_selection_excludes_a_factor_missing_in_current_sequence(self):
        frame = _market_frame()
        frame.loc[len(frame) - 1, "Volume"] = np.nan
        result = LSTMPriceFieldStrategy().compute_signals(frame, _cpu_params())
        selection = result.presentation["factor_selection"]
        self.assertNotIn("volume", selection["selected"])
        self.assertEqual(selection["selection_status"]["volume"], "unavailable")

    def test_training_progress_reports_actual_origins_without_changing_results(self) -> None:
        strategy = LSTMPriceFieldStrategy()
        observed = []
        strategy.training_progress = lambda done, total: observed.append((done, total))
        frame = _market_frame(80)
        result = strategy.compute_signals(frame, _cpu_params())
        self.assertEqual(observed, [(origin, 80) for origin in range(80)])
        baseline = LSTMPriceFieldStrategy().compute_signals(frame, _cpu_params())
        pd.testing.assert_frame_equal(result.frame, baseline.frame)

    def test_strategy_depends_on_shared_pipeline_not_bayesian_strategy(self) -> None:
        source = Path(
            __file__
        ).resolve().parents[1] / "strategies/algorithms/strategy_lstm_price_field.py"
        text = source.read_text(encoding="utf-8")

        self.assertNotIn("strategy_bayesian_price_field", text)
        self.assertNotIn("BayesianPriceFieldStrategy(", text)
        self.assertIn("load_price_field_market_bundle", text)
        self.assertIn("build_price_field_factor_status", text)

    def test_shared_factor_and_window_parameter_semantics_match(self) -> None:
        lstm_definitions = {
            definition.key: definition
            for definition in LSTMPriceFieldStrategy().get_parameter_definitions()
        }
        bayesian_definitions = {
            definition.key: definition
            for definition in BayesianPriceFieldStrategy().get_parameter_definitions()
        }

        for definition in PRICE_FIELD_FACTOR_DEFINITIONS:
            lstm = lstm_definitions[definition.parameter_key]
            bayesian = bayesian_definitions[definition.parameter_key]
            self.assertEqual(lstm.kind, bayesian.kind)
            self.assertEqual(lstm.minimum, bayesian.minimum)
            self.assertEqual(lstm.maximum, bayesian.maximum)
            self.assertEqual(lstm.step, bayesian.step)
            self.assertEqual(lstm.unit_hint, bayesian.unit_hint)

        for key in ("training_window", "chip_window"):
            lstm = lstm_definitions[key]
            bayesian = bayesian_definitions[key]
            self.assertEqual(lstm.kind, "integer")
            self.assertEqual(lstm.minimum, bayesian.minimum)
            self.assertEqual(lstm.maximum, bayesian.maximum)
            self.assertEqual(lstm.step, bayesian.step)
            self.assertEqual(lstm.unit_hint, bayesian.unit_hint)

    def test_lag_return_alone_still_produces_a_price_field(self) -> None:
        disabled_factors = {
            definition.parameter_key: False
            for definition in PRICE_FIELD_FACTOR_DEFINITIONS
        }
        result = LSTMPriceFieldStrategy().compute_signals(
            _market_frame(80),
            _cpu_params(**disabled_factors),
        )
        presentation = normalize_strategy_presentation(result.presentation)

        self.assertEqual(
            presentation["lstm"]["feature_names"],
            ["lstm_lagged_close_return"],
        )
        self.assertGreater(
            presentation["device"]["origins_trained"],
            0,
        )
        self.assertGreater(
            sum(
                value is not None
                for value in presentation["predictive_mean"]
            ),
            0,
        )

    def test_bayesian_only_parameters_do_not_change_lstm_fingerprint(self) -> None:
        frame = _market_frame(80)
        baseline = LSTMPriceFieldStrategy().compute_signals(
            frame,
            _cpu_params(prior_strength=0.01),
        )
        changed = LSTMPriceFieldStrategy().compute_signals(
            frame,
            _cpu_params(prior_strength=100.0),
        )

        self.assertEqual(
            baseline.presentation["fingerprint"],
            changed.presentation["fingerprint"],
        )
        np.testing.assert_array_equal(
            baseline.frame["buy_signal"].to_numpy(),
            changed.frame["buy_signal"].to_numpy(),
        )

    def test_registry_discovers_the_strategy(self) -> None:
        catalog = next(
            item
            for item in list_enabled_strategies()
            if item["id"] == "lstm-price-field"
        )
        strategy = instantiate_strategy("lstm-price-field")
        self.assertEqual(catalog["name"], "LSTM Price Field")
        self.assertEqual(catalog["class_name"], "LSTMPriceFieldStrategy")
        self.assertIsInstance(strategy, LSTMPriceFieldStrategy)
        self.assertEqual(strategy.get_default_tickers(), ("NVDA",))

    def test_metadata_and_namespaced_parameters(self) -> None:
        strategy = LSTMPriceFieldStrategy()
        metadata = strategy.get_metadata()
        self.assertEqual(metadata.strategy_id, "lstm-price-field")
        self.assertEqual(metadata.name, "LSTM Price Field")
        self.assertEqual(metadata.display_order, 43)
        definitions = {
            definition.key: definition
            for definition in strategy.get_parameter_definitions()
        }
        self.assertIn("lstm_lookback", definitions)
        self.assertIn("lstm_hidden_size", definitions)
        self.assertIn("lstm_epochs", definitions)
        self.assertIn("lstm_learning_rate", definitions)
        self.assertIn("lstm_seed", definitions)
        self.assertNotIn("prior_strength", definitions)
        self.assertEqual(
            definitions["compute_backend"].options,
            ("Auto", "CPU", "GPU", "Neural Engine"),
        )
        self.assertEqual(_MODEL_VERSION, "lstm-price-field-model/v1.2.0")
        self.assertFalse(strategy.backtest_cacheable)
        self.assertEqual(strategy.get_signal_bridge("1m"), "daily-close-to-next-session-open")

    def test_presentation_matches_the_shared_probability_grid_contract(self) -> None:
        result = LSTMPriceFieldStrategy().compute_signals(
            _market_frame(),
            _cpu_params(),
        )
        presentation = normalize_strategy_presentation(result.presentation)
        geometry = probability_grid_geometry_fields()
        self.assertEqual(presentation["schema"], LSTM_PRICE_FIELD_SCHEMA)
        self.assertEqual(presentation["renderer"], PROBABILITY_GRID_RENDERER)
        for key, value in geometry.items():
            self.assertEqual(presentation[key], value)
        self.assertEqual(presentation["target_interval"], "next-open-to-following-open")
        self.assertEqual(presentation["multi_step_kind"], "causal-ar1-return-state")
        self.assertEqual(len(presentation["predictive_mean"]), len(result.frame))
        self.assertEqual(result.required_execution_mode, "next_open")
        for key in (
            "predictive_mean",
            "predictive_scale",
            "probability_up",
            "return_autoregression",
            "return_long_run_mean",
            "return_innovation_scale",
        ):
            for value in presentation[key]:
                if value is not None:
                    self.assertTrue(math.isfinite(float(value)))
        finite_probabilities = [
            value for value in presentation["probability_up"] if value is not None
        ]
        self.assertTrue(finite_probabilities)
        self.assertTrue(all(0.0 <= value <= 1.0 for value in finite_probabilities))
        self.assertEqual(presentation["device"]["requested"], "CPU")
        self.assertEqual(presentation["device"]["resolved"], "cpu")
        self.assertEqual(presentation["device"]["engine"], "numpy")
        self.assertFalse(presentation["device"]["neural_engine_confirmed"])
        self.assertIn("lstm_lagged_close_return", presentation["lstm"]["feature_names"])

    def test_unavailable_longbridge_factors_do_not_blank_the_field(self) -> None:
        result = LSTMPriceFieldStrategy().compute_signals(
            _market_frame(80),
            _cpu_params(use_pe_ratio=True, use_options=True, use_volume=True),
        )
        presentation = normalize_strategy_presentation(result.presentation)
        finite_means = [
            value for value in presentation["predictive_mean"] if value is not None
        ]
        self.assertTrue(finite_means)
        self.assertGreater(presentation["device"]["origins_trained"], 0)
        self.assertGreater(presentation["device"]["train_ms"], 0.0)
        self.assertLess(
            presentation["device"]["origins_failed_closed"],
            len(result.frame),
        )
        self.assertIn("lstm_lagged_close_return", presentation["lstm"]["feature_names"])
        self.assertNotIn("pe", presentation["lstm"]["feature_names"])

    def test_cell_display_threshold_is_presentation_only(self) -> None:
        frame = _market_frame(80)
        baseline = LSTMPriceFieldStrategy().compute_signals(
            frame,
            _cpu_params(cell_display_threshold=0),
        )
        focused = LSTMPriceFieldStrategy().compute_signals(
            frame,
            _cpu_params(cell_display_threshold=50),
        )
        for column in (
            "lstm_predictive_mean",
            "lstm_predictive_std",
            "lstm_probability_up",
            "buy_signal",
            "sell_signal",
        ):
            np.testing.assert_array_equal(
                baseline.frame[column].to_numpy(),
                focused.frame[column].to_numpy(),
            )
        self.assertEqual(baseline.presentation["cell_display_threshold_pct"], 0.0)
        self.assertEqual(focused.presentation["cell_display_threshold_pct"], 50.0)
        self.assertEqual(
            baseline.presentation["diagnostics"],
            focused.presentation["diagnostics"],
        )
        self.assertEqual(
            baseline.presentation["fingerprint"],
            focused.presentation["fingerprint"],
        )

    def test_walk_forward_has_no_future_lookahead(self) -> None:
        original = _market_frame(90)
        changed_future = original.copy()
        future_start = 70
        changed_future.loc[future_start:, "Close"] *= np.linspace(
            1.2,
            2.5,
            len(changed_future) - future_start,
        )
        changed_future.loc[future_start:, "Open"] *= np.linspace(
            0.8,
            1.8,
            len(changed_future) - future_start,
        )
        first = LSTMPriceFieldStrategy().compute_signals(original, _cpu_params())
        second = LSTMPriceFieldStrategy().compute_signals(changed_future, _cpu_params())
        for column in (
            "lstm_predictive_mean",
            "lstm_predictive_std",
            "lstm_probability_up",
        ):
            np.testing.assert_allclose(
                first.frame.loc[: future_start - 1, column],
                second.frame.loc[: future_start - 1, column],
                rtol=0.0,
                atol=1e-12,
                equal_nan=True,
            )

    def test_insufficient_history_fails_closed(self) -> None:
        result = LSTMPriceFieldStrategy().compute_signals(
            _market_frame(24),
            _cpu_params(training_window=40, lstm_lookback=8),
        )
        self.assertTrue(result.frame["lstm_predictive_mean"].isna().all())
        self.assertFalse(result.frame["buy_signal"].any())
        self.assertEqual(result.presentation["device"]["origins_trained"], 0)

    def test_gpu_request_reports_cpu_fallback_instead_of_the_request(self) -> None:
        with patch("strategies.lstm_compute._load_optional_module", return_value=None):
            result = LSTMPriceFieldStrategy().compute_signals(
                _market_frame(72),
                _cpu_params(compute_backend="GPU"),
            )
        device = result.presentation["device"]
        self.assertEqual(device["requested"], "GPU")
        self.assertEqual(device["resolved"], "cpu")
        self.assertEqual(device["engine"], "numpy-fallback")
        self.assertIn("torch is not installed", str(device["fallback_reason"]))

    def test_missing_optional_accelerators_do_not_crash_import_or_auto(self) -> None:
        with patch("strategies.lstm_compute._load_optional_module", return_value=None):
            result = LSTMPriceFieldStrategy().compute_signals(
                _market_frame(72),
                _cpu_params(compute_backend="Auto"),
            )
        self.assertEqual(result.presentation["schema"], LSTM_PRICE_FIELD_SCHEMA)
        self.assertEqual(result.presentation["device"]["resolved"], "cpu")

    def test_probability_mass_is_finite_and_normalized_when_present(self) -> None:
        result = LSTMPriceFieldStrategy().compute_signals(
            _market_frame(80),
            _cpu_params(),
        )
        probabilities = result.frame["lstm_probability_up"].to_numpy(dtype=np.float64)
        finite = probabilities[np.isfinite(probabilities)]
        self.assertGreater(len(finite), 0)
        self.assertTrue(np.all(finite >= 0.0))
        self.assertTrue(np.all(finite <= 1.0))
        scales = result.frame["lstm_predictive_std"].to_numpy(dtype=np.float64)
        self.assertTrue(np.all(scales[np.isfinite(scales)] > 0.0))


if __name__ == "__main__":
    unittest.main()
