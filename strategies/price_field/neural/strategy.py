"""One strategy adapter for eight direct probability engines. Code version: v1.6.1."""

from __future__ import annotations

import hashlib
import json
from typing import Any, Callable, Sequence

import numpy as np
import pandas as pd

from strategies.base import BaseStrategy, StrategyParameterDefinition, StrategySignalResult, StrategySupportMatrix
from strategies.price_field.neural.compute import walk_forward_neural_predictions
from strategies.price_field.neural.inputs import (
    AVAILABILITY_POLICY, BENCHMARK_FACTORS, BENCHMARK_SYMBOLS,
    factor_values_for_neural, plain_market_bundle, prepare_neural_price_field_inputs,
)
from strategies.price_field.neural.registry import neural_architecture_spec
from strategies.price_field.direct_horizon import (
    attach_direct_signals, build_direct_presentation, direct_horizon_series,
    direct_prediction_columns, score_direct_forecasts,
)
from strategies.price_field.pipeline import (
    PRICE_FIELD_FACTOR_DEFINITIONS, build_price_field_factor_status,
    bundle_to_price_field_ohlcv, load_price_field_market_bundle, normalize_price_field_ohlcv,
)


class NeuralPriceFieldStrategy(BaseStrategy):
    """Own input/parameter/presentation policy; architectures own learned forecasts."""

    architecture = ""
    strategy_training_family = "neural-price-field-v1"
    strategy_category = "price-field"
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
        profile = neural_architecture_spec(self.architecture).startup_profile
        return (
            parameter("cell_display_threshold", "Cell display threshold (%)", kind="number", default=1.0,
                      minimum=0.0, maximum=50.0, step=0.01, optimizable=False,
                      help_text="Visibility only; all cells and tails still contribute to probability scoring."),
            parameter("training_window", "Training window", default=profile.training_window, minimum=64, maximum=756, step=1,
                      help_text="Maximum mature historical training sequences at each causal refit."),
            parameter("chip_window", "Volume-at-price window", default=profile.chip_window, minimum=5, maximum=252, step=1),
            parameter("lookback", "Lookback", default=profile.lookback, minimum=8, maximum=64, step=1),
            parameter("hidden_size", "Hidden size", default=profile.hidden_size, minimum=8, maximum=64, step=1),
            parameter("epochs", "Epochs", default=profile.epochs, minimum=1, maximum=64, step=1),
            parameter("learning_rate", "Learning rate", kind="number", default=profile.learning_rate,
                      minimum=0.0001, maximum=0.02, step=0.0001),
            parameter("retrain_interval", "Refit interval", default=profile.retrain_interval, minimum=1, maximum=63, step=1,
                      help_text="Trading sessions between causal refits; intervening forecasts use frozen weights."),
            parameter("weight_decay", "Weight decay", kind="number", default=profile.weight_decay,
                      minimum=0.0, maximum=0.1, step=0.0001),
            parameter("dropout", "Dropout", kind="number", default=profile.dropout, minimum=0.0, maximum=0.5, step=0.01),
            parameter("seed", "Seed", default=profile.seed, minimum=0, maximum=1_000_000, step=1, optimizable=False),
            parameter("entry_probability", "Entry probability (%)", kind="number", default=60.0,
                      minimum=50.0, maximum=95.0, step=0.1, optimizable=False,
                      help_text="Compatibility threshold for the Backtest transaction display; not a probability-training objective."),
            parameter("compute_backend", "Compute backend", kind="choice", default=profile.compute_backend,
                      options=("Auto", "CPU", "GPU"), optimizable=False,
                      help_text="Auto uses verified MPS/CUDA when available, otherwise Torch CPU. GPU fails closed."),
            *(parameter(d.parameter_key, d.label, kind="boolean", group="factors", subgroup=d.category,
                        default=d.parameter_key in profile.enabled_factor_parameters, help_text=d.help_text)
              for d in PRICE_FIELD_FACTOR_DEFINITIONS),
            *(parameter(f"use_{key}", f"{symbol} {'daily return' if horizon == 1 else '20-day momentum'}",
                        kind="boolean", default=f"use_{key}" in profile.enabled_factor_parameters,
                        group="factors", subgroup="Market context",
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
            from app.services.research.price_field_market_factors import fetch_price_field_factor_bundle
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
        predictions = direct_prediction_columns(prepared["Date"], forecast.means, forecast.stds)
        predictions["pf_training_end"] = forecast.origin_training_end
        prediction_frame = pd.DataFrame(predictions)
        output, means, stds, probabilities = attach_direct_signals(
            visible, prediction_frame, normalized["entry_probability"],
        )
        scoring_frame = prepared.merge(
            prediction_frame,
            on="Date",
            how="left",
            validate="one_to_one",
        )
        diagnostics = score_direct_forecasts(scoring_frame, visible["Date"])
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
        presentation = build_direct_presentation(
            schema=f"{self.strategy_id}/v1", model_version=model_version,
            cell_display_threshold_pct=normalized["cell_display_threshold"], dates=output["Date"],
            means=means, stds=stds, probabilities=probabilities, diagnostics=diagnostics,
            factors=factors, factor_selection=selection, device=forecast.device,
            source={"market_data": "longbridge-cli", "commands": causal_bundle.get("source_commands", []),
                    "availability_policy": AVAILABILITY_POLICY}, fingerprint=fingerprint,
            extra={"training_label": f"{self.strategy_name} training", "training_family": self.strategy_training_family,
                   **direct_horizon_series(means, stds),
                   "training_diagnostics": forecast.training_diagnostics,
                   "neural": {"architecture": self.architecture, "feature_names": list(names),
                              "trained_horizons": list(range(1, 21)), "distribution": "Gaussian log-return marginals"}},
        )
        return StrategySignalResult(output, "buy_signal", "sell_signal", required_execution_mode="next_open",
                                    presentation=presentation, metadata={"fingerprint": fingerprint, "factors": factors,
                                    "factor_selection": selection, "compute_device": forecast.device["resolved"],
                                    "compute_engine": "torch", "market_data_source": "longbridge-cli",
                                    "diagnostics": diagnostics, "model_version": model_version})
