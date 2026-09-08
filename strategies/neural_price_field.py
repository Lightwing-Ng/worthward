"""One strategy adapter for four direct probability engines. Code version: v1.0.0."""

from __future__ import annotations

import hashlib
import json
from typing import Any, Callable, Sequence

import numpy as np
import pandas as pd

from strategies.base import BaseStrategy, StrategyParameterDefinition, StrategySignalResult, StrategySupportMatrix
from strategies.neural_price_field_compute import walk_forward_neural_predictions
from strategies.neural_price_field_inputs import (
    AVAILABILITY_POLICY, BENCHMARK_FACTORS, BENCHMARK_SYMBOLS,
    factor_values_for_neural, plain_market_bundle, prepare_neural_price_field_inputs,
)
from strategies.neural_price_field_scoring import score_neural_price_field
from strategies.price_field_contract import build_probability_grid_presentation
from strategies.price_field_pipeline import (
    PRICE_FIELD_FACTOR_DEFINITIONS, build_price_field_factor_status,
    bundle_to_price_field_ohlcv, json_number_list, load_price_field_market_bundle,
    normal_probability_above_zero, normalize_price_field_ohlcv, probability_threshold_signals,
)


class NeuralPriceFieldStrategy(BaseStrategy):
    """Own input/parameter/presentation policy; architectures own learned forecasts."""

    architecture = ""
    strategy_training_family = "neural-price-field-v1"
    strategy_category = "machine-learning"
    strategy_supports = StrategySupportMatrix(single_ticker=True, multi_ticker=False, long_only=True, short=False)
    strategy_supported_intervals = ("1d",)
    strategy_market_data_source = "longbridge-cli"
    strategy_presentation_renderer = "probability-grid-v1"
    strategy_parameter_actions = (
        {"key": "training", "title": "Probability training", "kind": "action", "slot": "price-field-training"},
    )
    backtest_cacheable = False

    def __init__(self) -> None:
        self._warmup_bundle: object | None = None
        self.training_progress: Callable[[int, int], None] | None = None
        self.training_cancel: Callable[[], bool] | None = None
        self.training_min_seconds = 0.0

    def get_default_tickers(self) -> tuple[str, ...]:
        return ("NVDA",)

    def get_parameter_definitions(self) -> tuple[StrategyParameterDefinition, ...]:
        parameter = StrategyParameterDefinition
        return (
            parameter("cell_display_threshold", "Cell display threshold (%)", kind="number", default=2.0,
                      minimum=0.0, maximum=50.0, step=0.01, optimizable=False,
                      help_text="Visibility only; all cells and tails still contribute to probability scoring."),
            parameter("training_window", "Training window", default=252, minimum=64, maximum=756, step=1,
                      help_text="Maximum mature historical training sequences at each causal refit."),
            parameter("chip_window", "Volume-at-price window", default=30, minimum=5, maximum=252, step=1),
            parameter("lookback", "Lookback", default=32, minimum=8, maximum=64, step=1),
            parameter("hidden_size", "Hidden size", default=32, minimum=8, maximum=64, step=1),
            parameter("epochs", "Epochs", default=8, minimum=1, maximum=64, step=1),
            parameter("learning_rate", "Learning rate", kind="number", default=0.001,
                      minimum=0.0001, maximum=0.02, step=0.0001),
            parameter("retrain_interval", "Refit interval", default=20, minimum=1, maximum=63, step=1,
                      help_text="Trading sessions between causal refits; intervening forecasts use frozen weights."),
            parameter("weight_decay", "Weight decay", kind="number", default=0.001,
                      minimum=0.0, maximum=0.1, step=0.0001),
            parameter("dropout", "Dropout", kind="number", default=0.1, minimum=0.0, maximum=0.5, step=0.01),
            parameter("seed", "Seed", default=42, minimum=0, maximum=1_000_000, step=1, optimizable=False),
            parameter("entry_probability", "Entry probability (%)", kind="number", default=60.0,
                      minimum=50.0, maximum=95.0, step=0.1, optimizable=False,
                      help_text="Compatibility threshold for the Backtest transaction display; not a probability-training objective."),
            parameter("compute_backend", "Compute backend", kind="choice", default="Auto",
                      options=("Auto", "CPU", "GPU"), optimizable=False,
                      help_text="Auto uses verified MPS/CUDA when available, otherwise Torch CPU. GPU fails closed."),
            *(parameter(d.parameter_key, d.label, kind="boolean", group="factors", subgroup=d.category,
                        default=d.key in {"volume", "volatility_20d", "momentum_5d"}, help_text=d.help_text)
              for d in PRICE_FIELD_FACTOR_DEFINITIONS),
            *(parameter(f"use_{key}", f"{symbol} {'daily return' if horizon == 1 else '20-day momentum'}",
                        kind="boolean", default=False, group="factors", subgroup="Market context",
                        help_text=f"Historical {symbol} regular-session closes known at the forecast date; missing dates remain unknown.")
              for key, symbol, horizon in BENCHMARK_FACTORS),
        )

    def load_market_datasets(
            self, tickers: Sequence[str], *, interval: str, start: Any, end: Any,
            params: dict[str, Any] | None = None,
    ) -> list[pd.DataFrame]:
        normalized = self.normalize_params(params)
        # Loading needs both the sequence context and the fully matured target
        # horizon before the requested training window can be populated.
        load_params = {**normalized, "training_window": normalized["training_window"] + normalized["lookback"] + 20}
        bundle = plain_market_bundle(load_price_field_market_bundle(
            tickers, interval=interval, start=start, end=end, params=load_params,
        ))
        frame = bundle_to_price_field_ohlcv(bundle)
        requested = [symbol for symbol in BENCHMARK_SYMBOLS if any(
            normalized[f"use_{key}"] for key, candidate, _ in BENCHMARK_FACTORS if candidate == symbol
        )]
        if requested:
            from app.infrastructure.connectivity import is_remote_market_access_disabled
            from app.services.price_field_market_factors import fetch_price_field_factor_bundle
            bundle["benchmarks"] = {}
            bundle["benchmark_status"] = {}
            for symbol in requested:
                if is_remote_market_access_disabled():
                    bundle["benchmark_status"][symbol] = "unavailable-offline"
                    continue
                try:
                    benchmark = fetch_price_field_factor_bundle(
                        f"{symbol}.US", frame["Date"].iloc[0], end,
                        include_pe=False, include_dynamic_pe=False, include_options=False, research_factors=(),
                    )
                    bundle["benchmarks"][symbol] = plain_market_bundle(benchmark.ohlcv)
                    bundle["benchmark_status"][symbol] = "available"
                except (OSError, RuntimeError, ValueError):
                    bundle["benchmark_status"][symbol] = "error"
        self._warmup_bundle = bundle
        return [frame]

    def compute_signals(self, dataset: pd.DataFrame, params: dict | None = None) -> StrategySignalResult:
        normalized = self.normalize_params(params)
        visible = normalize_price_field_ohlcv(dataset)
        full = bundle_to_price_field_ohlcv(self._warmup_bundle) if self._warmup_bundle is not None else visible
        prepared, features, names = prepare_neural_price_field_inputs(full, self._warmup_bundle, normalized)
        forecast = walk_forward_neural_predictions(
            features, prepared["Close"].to_numpy(dtype=float), architecture=self.architecture,
            params=normalized, feature_names=names, progress=self.training_progress,
            min_training_seconds=self.training_min_seconds, cancel=self.training_cancel,
        )
        predictions = {"Date": prepared["Date"]}
        for horizon in range(20):
            predictions[f"pf_mean_h{horizon + 1:02d}"] = forecast.means[:, horizon]
            predictions[f"pf_std_h{horizon + 1:02d}"] = forecast.stds[:, horizon]
        predictions["pf_training_end"] = forecast.origin_training_end
        output = visible.merge(pd.DataFrame(predictions), on="Date", how="left", validate="one_to_one")
        means = output[[f"pf_mean_h{h:02d}" for h in range(1, 21)]].to_numpy(dtype=float)
        stds = output[[f"pf_std_h{h:02d}" for h in range(1, 21)]].to_numpy(dtype=float)
        probabilities = np.asarray([normal_probability_above_zero(mean, std) if np.isfinite(mean) and np.isfinite(std)
                                    and std > 0 else np.nan for mean, std in zip(means[:, 0], stds[:, 0])])
        output["pf_probability_up"] = probabilities
        buy, sell = probability_threshold_signals(pd.Series(probabilities), normalized["entry_probability"] / 100)
        output["buy_signal"] = np.asarray(buy, dtype=bool)
        output["sell_signal"] = np.asarray(sell, dtype=bool)
        valid = np.flatnonzero(np.isfinite(means).all(axis=1) & np.isfinite(stds).all(axis=1))
        # The page excludes its displayed warmup and labels this explicitly.
        # Research passes fixed common start/end boundaries to the same scorer.
        score_start = int(valid[0]) if len(valid) else len(output)
        diagnostics = score_neural_price_field(output, score_start, len(output))
        next_day = diagnostics.get("next_day") or {}
        diagnostics.update(
            direction_hit_rate_pct=next_day.get("direction_hit_rate_pct"),
            scored_points=diagnostics.get("valid_pairs", 0),
            metric_kind="direct-close-full-grid-brier", target_interval="signal-close-to-future-close",
            proper_probability_rule="one-minus-half-multiclass-brier", causal=True,
            warmup_excluded_points=score_start, evaluation_scope="displayed-history-after-warmup",
        )
        selected = [name for name in forecast.selected_features if name != "close_return"]
        selection = {"origin_index": max(0, len(output) - 1), "eligible": selected, "selected": selected,
                     "method": "causal-training-availability", "selection_status": {
                         name: "selected" if name in selected else "ineligible" for name in names if name != "close_return"}}
        _, values, causal_bundle = factor_values_for_neural(full, self._warmup_bundle, normalized)
        factors = build_price_field_factor_status(causal_bundle, prepared, values, normalized, selection)
        for key, symbol, horizon in BENCHMARK_FACTORS:
            finite = int(np.isfinite(values[key]).sum())
            enabled = normalized[f"use_{key}"]
            factors.append({"key": key, "label": f"{symbol} {'daily return' if horizon == 1 else '20-day momentum'}",
                            "enabled": enabled, "status": "disabled" if not enabled else "active" if finite >= 32 else "insufficient",
                            "eligible": key in selected, "selected": key in selected,
                            "selection_status": "selected" if key in selected else "ineligible" if enabled else "disabled",
                            "finite_observations": finite, "total_observations": len(prepared),
                            "coverage": finite / len(prepared) if len(prepared) else 0.0})
        model_version = f"{self.strategy_id}-model/v1.0.0"
        identity = json.dumps({"model": model_version, "availability": AVAILABILITY_POLICY, "features": names,
                               "params": {k: v for k, v in normalized.items() if k != "cell_display_threshold"}}, sort_keys=True)
        fingerprint = hashlib.sha256(identity.encode() + pd.util.hash_pandas_object(prepared, index=False).values.tobytes()
                                     + np.asarray(features, dtype=np.float64).tobytes()).hexdigest()
        presentation = build_probability_grid_presentation(
            schema=f"{self.strategy_id}/v1", model_version=model_version,
            cell_display_threshold_pct=normalized["cell_display_threshold"], distribution_kind="direct-normal-horizon",
            predictive_mean=json_number_list(means[:, 0]), predictive_scale=json_number_list(stds[:, 0]),
            probability_up=json_number_list(probabilities), return_autoregression=[0.0] * len(output),
            return_long_run_mean=[0.0] * len(output), return_innovation_scale=json_number_list(stds[:, 0]),
            data_keys=[pd.Timestamp(value).isoformat() for value in output["Date"]], diagnostics=diagnostics,
            factors=factors, factor_selection=selection, device=forecast.device,
            source={"market_data": "longbridge-cli", "commands": causal_bundle.get("source_commands", []),
                    "availability_policy": AVAILABILITY_POLICY}, fingerprint=fingerprint,
            geometry_metadata={"target_interval": "signal-close-to-future-close", "price_anchor_kind": "signal-close",
                               "multi_step_kind": "direct-horizon", "metric_geometry": {
                                   "diagnostic_outcome": {
                                       "horizons": list(range(1, 21)), "horizon_unit": "close-to-future-close-session",
                                       "proper_probability_rule": "one-minus-half-multiclass-brier",
                                       "bands": 20, "tail_bins": 2, "horizon_weighting": "equal",
                                   },
                                   "render_lattice": {
                                       "columns": 20, "rows_above": 10, "rows_below": 10,
                                       "horizon_unit": "integer-trading-days-per-viewport-column",
                                       "horizon_mapping": "viewport-quantized", "max_horizon": 20,
                                       "detail_horizons": list(range(1, 21)), "beyond_max_horizon": "unavailable",
                                   },
                               }},
            extra={"training_label": f"{self.strategy_name} training", "training_family": self.strategy_training_family,
                   "max_horizon": 20, "horizon_predictive_mean": [json_number_list(row) for row in means],
                   "horizon_predictive_std": [json_number_list(row) for row in stds],
                   "training_diagnostics": forecast.training_diagnostics,
                   "neural": {"architecture": self.architecture, "feature_names": list(names),
                              "trained_horizons": list(range(1, 21)), "distribution": "Gaussian log-return marginals"}},
        )
        return StrategySignalResult(output, "buy_signal", "sell_signal", required_execution_mode="next_open",
                                    presentation=presentation, metadata={"fingerprint": fingerprint, "factors": factors,
                                    "factor_selection": selection, "compute_device": forecast.device["resolved"],
                                    "compute_engine": "torch", "market_data_source": "longbridge-cli",
                                    "diagnostics": diagnostics, "model_version": model_version})
