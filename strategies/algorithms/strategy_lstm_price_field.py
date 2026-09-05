"""
Walk-forward LSTM executable-return strategy.

The model predicts the tradable next-open-to-following-open log return from
the same causal Longbridge factor pipeline as Bayesian Price Field, then emits
the shared probability-grid payload. Training never reads a future row.

Code version: v1.5.0
- Changed: Model-neutral causal Price Field preparation now comes from the
  shared pipeline instead of the Bayesian strategy module.
"""

from __future__ import annotations

import hashlib
import json
import math
from typing import Any, Callable, Sequence

import numpy as np
import pandas as pd

from app.infrastructure.connectivity import is_remote_market_access_disabled
from strategies.lstm_compute import (
    LAG_RETURN_FEATURE,
    backend_presentation,
    lagged_close_return,
    resolve_lstm_backend,
    walk_forward_lstm_predictions,
)
from strategies.price_field_contract import (
    LSTM_PRICE_FIELD_SCHEMA,
    LSTM_PRICE_FIELD_STRATEGY_ID,
    PROBABILITY_GRID_RENDERER,
    build_probability_grid_presentation,
)
from strategies.price_field_pipeline import (
    PRICE_FIELD_FACTOR_DEFINITIONS,
    PRICE_FIELD_FACTOR_PARAMETER_KEYS,
    build_price_field_factor_columns as _build_factor_columns,
    build_price_field_factor_status,
    bundle_to_price_field_ohlcv as _bundle_ohlcv_frame,
    estimate_price_field_return_state as _estimate_return_state,
    executable_price_field_return_targets as _executable_return_targets,
    json_number_list as _json_number_list,
    load_price_field_market_bundle,
    merge_price_field_bundle_observations as _merge_bundle_observations,
    normal_probability_above_zero as _normal_probability_above_zero,
    normalize_price_field_ohlcv as _normalize_ohlcv_frame,
    price_field_probabilistic_diagnostics as _probabilistic_diagnostics,
    probability_threshold_signals as _probability_threshold_signals,
    record_price_field_value as _record_value,
)

from ..base import (
    BaseStrategy,
    StrategyParameterDefinition,
    StrategySignalResult,
    StrategySupportMatrix,
)
from ..interval_bridge import DAILY_CLOSE_TO_NEXT_SESSION_OPEN
_PREDICTION_MEAN_COLUMN = "lstm_predictive_mean"
_PREDICTION_STD_COLUMN = "lstm_predictive_std"
_PROBABILITY_COLUMN = "lstm_probability_up"
_AUTOREGRESSION_COLUMN = "lstm_return_autoregression"
_LONG_RUN_MEAN_COLUMN = "lstm_return_long_run_mean"
_INNOVATION_STD_COLUMN = "lstm_return_innovation_std"
_MODEL_VERSION = "lstm-price-field-model/v1.1.0"
_CELL_DISPLAY_THRESHOLD_DEFAULT_PCT = 5.0
_CELL_DISPLAY_THRESHOLD_MIN_PCT = 0.0
_CELL_DISPLAY_THRESHOLD_MAX_PCT = 50.0
_PRESENTATION_ONLY_PARAMETER_KEYS = frozenset({"cell_display_threshold"})
_LSTM_FINGERPRINT_PARAMETER_KEYS = (
    PRICE_FIELD_FACTOR_PARAMETER_KEYS
    | {
        "training_window",
        "chip_window",
        "lstm_lookback",
        "lstm_hidden_size",
        "lstm_epochs",
        "lstm_learning_rate",
        "lstm_seed",
        "entry_probability",
        "compute_backend",
    }
)


def _rewrite_strategy_error(exc: Exception) -> ValueError:
    return ValueError(str(exc).replace("Price Field", "LSTM Price Field"))


def _lstm_frame_fingerprint(
        frame: pd.DataFrame,
        factor_values: dict[str, np.ndarray],
        params: dict[str, Any],
        bundle_fingerprint: str,
        feature_names: Sequence[str],
) -> str:
    columns = [
        column
        for column in (
            "Date",
            "Open",
            "High",
            "Low",
            "Close",
            "Volume",
            "bayesian_pe_ratio",
            "bayesian_option_put_call_ratio",
        )
        if column in frame.columns
    ]
    frame_hash = pd.util.hash_pandas_object(
        frame[columns],
        index=False,
    ).to_numpy().tobytes()
    derived_frame = pd.DataFrame(
        {
            key: np.asarray(factor_values[key], dtype=np.float64)
            for key in sorted(factor_values)
        },
        index=frame.index,
    )
    derived_hash = pd.util.hash_pandas_object(
        derived_frame,
        index=False,
    ).to_numpy().tobytes()
    contract_bytes = json.dumps(
        {
            "bundle_fingerprint": str(bundle_fingerprint or ""),
            "model_version": _MODEL_VERSION,
            "feature_names": list(feature_names),
            "params": {
                key: value
                for key, value in params.items()
                if key in _LSTM_FINGERPRINT_PARAMETER_KEYS
            },
        },
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    ).encode("utf-8")
    return hashlib.sha256(contract_bytes + frame_hash + derived_hash).hexdigest()


def _build_lstm_feature_matrix(
        frame: pd.DataFrame,
        factor_values: dict[str, np.ndarray],
        enabled_factors: Sequence[str],
) -> tuple[np.ndarray, tuple[str, ...]]:
    names: list[str] = [LAG_RETURN_FEATURE]
    columns = [lagged_close_return(frame["Close"].to_numpy(dtype=np.float64))]
    row_count = len(frame)
    for factor in enabled_factors:
        values = np.asarray(
            factor_values.get(factor, np.full(row_count, np.nan, dtype=np.float64)),
            dtype=np.float64,
        )
        if len(values) != row_count or not np.any(np.isfinite(values)):
            continue
        names.append(str(factor))
        columns.append(values)
    return np.column_stack(columns), tuple(names)


def _latest_lstm_factor_selection(
        feature_names: Sequence[str],
        origin_index: int,
) -> dict[str, Any]:
    selected = [name for name in feature_names if name != LAG_RETURN_FEATURE]
    status = {
        name: "selected" if name in selected else "auxiliary"
        for name in feature_names
    }
    return {
        "origin_index": int(origin_index),
        "eligible": list(selected),
        "selected": list(selected),
        "selection_status": status,
        "method": "lstm-enabled-finite-causal-features",
    }


class LSTMPriceFieldStrategy(BaseStrategy):
    strategy_id = LSTM_PRICE_FIELD_STRATEGY_ID
    strategy_name = "LSTM Price Field"
    strategy_description = (
        "Walk-forward LSTM estimates executable next-open returns from the same "
        "point-in-time-safe Longbridge CLI factors as Bayesian Price Field, then "
        "emits the shared causal multi-step price field."
    )
    strategy_category = "machine-learning"
    strategy_display_order = 43
    strategy_supports = StrategySupportMatrix(
        single_ticker=True,
        multi_ticker=False,
        long_only=True,
        short=False,
        required_tickers=1,
    )
    strategy_supported_intervals = ("1d", "1m")
    strategy_model_interval_overrides = {"1m": "1d"}
    strategy_signal_bridges = {"1m": DAILY_CLOSE_TO_NEXT_SESSION_OPEN}
    strategy_interval_notices = {
        "1m": "Daily LSTM model; the probability field is available at 1d.",
    }
    strategy_market_data_source = "longbridge-cli"
    backtest_cacheable = False
    strategy_parameter_title = "LSTM parameters"
    strategy_presentation_renderer = "probability-grid-v1"
    strategy_parameter_actions = (
        {"key": "training", "title": "LSTM training", "kind": "action", "slot": "lstm-training"},
    )

    def __init__(self) -> None:
        self._warmup_bundle: object | None = None
        self.training_progress: Callable[[int, int], None] | None = None
        self.training_min_seconds = 0.0

    def get_default_tickers(self) -> tuple[str, ...]:
        return ("NVDA",)

    def get_parameter_definitions(self) -> tuple[StrategyParameterDefinition, ...]:
        return (
            *(
                StrategyParameterDefinition(
                    key=definition.parameter_key,
                    label=" ".join(
                        word if index == 0 or word in {"OI", "P/E", "P/B", "P/S"} else word.lower()
                        for index, word in enumerate(definition.label.split())
                    ).replace("Put/Call", "Put/call"),
                    kind="boolean",
                    group="factors",
                    default=definition.default,
                    help_text=definition.help_text,
                )
                for definition in PRICE_FIELD_FACTOR_DEFINITIONS
            ),
            StrategyParameterDefinition(
                key="cell_display_threshold",
                optimizable=False,
                label="Cell display threshold (%)",
                kind="number",
                default=_CELL_DISPLAY_THRESHOLD_DEFAULT_PCT,
                minimum=_CELL_DISPLAY_THRESHOLD_MIN_PCT,
                maximum=_CELL_DISPLAY_THRESHOLD_MAX_PCT,
                step=0.01,
                unit_hint="%",
                help_text=(
                    "Hides individual probability-field cells below this absolute "
                    "probability. 0% shows every cell; 50% is the maximum focus "
                    "threshold. This changes presentation only, not signals or scoring."
                ),
            ),
            StrategyParameterDefinition(
                key="training_window",
                label="Training window",
                kind="integer",
                default=60,
                minimum=30,
                maximum=504,
                step=1,
                unit_hint="bars",
                help_text=(
                    "Limits each LSTM fit to causal sequences already known at "
                    "the hovered date. Sequences whose next-open target is not "
                    "yet observable are excluded."
                ),
            ),
            StrategyParameterDefinition(
                key="chip_window",
                label="Volume-at-price window",
                kind="integer",
                default=30,
                minimum=5,
                maximum=252,
                step=1,
                unit_hint="bars",
                help_text="Sets the trailing bar window for the volume-at-price distribution factor.",
            ),
            StrategyParameterDefinition(
                key="lstm_lookback",
                label="LSTM lookback",
                kind="integer",
                default=8,
                minimum=4,
                maximum=16,
                step=1,
                unit_hint="bars",
                help_text="Causal sequence length presented to the LSTM at each origin.",
            ),
            StrategyParameterDefinition(
                key="lstm_hidden_size",
                label="LSTM hidden size",
                kind="integer",
                default=8,
                minimum=4,
                maximum=32,
                step=1,
                help_text="Width of the single LSTM hidden state. Smaller values bound unified memory.",
            ),
            StrategyParameterDefinition(
                key="lstm_epochs",
                label="LSTM epochs",
                kind="integer",
                default=6,
                minimum=1,
                maximum=20,
                step=1,
                help_text="Full-batch training steps at each causal origin.",
            ),
            StrategyParameterDefinition(
                key="lstm_learning_rate",
                label="LSTM learning rate",
                kind="number",
                default=0.05,
                minimum=0.001,
                maximum=0.5,
                step=0.001,
                help_text="Adam step size for the origin-local LSTM fit.",
            ),
            StrategyParameterDefinition(
                key="lstm_seed",
                optimizable=False,
                label="LSTM seed",
                kind="integer",
                default=42,
                minimum=0,
                maximum=1_000_000,
                step=1,
                help_text="Reproducible per-origin RNG seed offset for LSTM initialization.",
            ),
            StrategyParameterDefinition(
                key="entry_probability",
                label="Entry probability",
                kind="number",
                default=60.0,
                minimum=51.0,
                maximum=95.0,
                step=0.1,
                unit_hint="%",
                help_text="Enters when the predicted rise probability reaches this threshold and exits at its symmetric downside threshold.",
            ),
            StrategyParameterDefinition(
                key="compute_backend",
                optimizable=False,
                label="Compute backend",
                kind="choice",
                default="Auto",
                options=("Auto", "CPU", "GPU", "Neural Engine"),
                help_text=(
                    "Auto uses NumPy CPU for origin-local LSTM training on unified "
                    "memory. GPU requests a confirmed Apple MPS or CUDA device after "
                    "a real tensor readback and falls back to CPU. Neural Engine is "
                    "used only when Core ML compute-unit execution is confirmed; "
                    "otherwise it falls back to CPU. Missing optional packages never "
                    "crash the Backtest page."
                ),
            ),
        )

    def load_market_datasets(
            self,
            tickers: Sequence[str],
            *,
            interval: str,
            start: Any,
            end: Any,
            params: dict[str, Any] | None = None,
    ) -> list[pd.DataFrame] | None:
        try:
            bundle = load_price_field_market_bundle(
                tickers,
                interval=interval,
                start=start,
                end=end,
                params=params,
            )
        except ValueError as exc:
            raise _rewrite_strategy_error(exc) from exc
        self._warmup_bundle = bundle
        return [_bundle_ohlcv_frame(bundle)]

    def compute_signals(
            self,
            dataset: pd.DataFrame,
            params: dict | None = None,
    ) -> StrategySignalResult:
        normalized_params = self.normalize_params(params)
        try:
            visible_frame = _normalize_ohlcv_frame(dataset)
        except ValueError as exc:
            raise _rewrite_strategy_error(exc) from exc
        full_frame = (
            _bundle_ohlcv_frame(self._warmup_bundle)
            if self._warmup_bundle is not None
            else visible_frame.copy()
        )
        full_frame = _merge_bundle_observations(full_frame, self._warmup_bundle)
        factor_values = _build_factor_columns(
            full_frame,
            int(normalized_params["chip_window"]),
            use_volume_at_price=bool(normalized_params["use_volume_at_price"]),
        )
        enabled_factors = [
            definition.key
            for definition in PRICE_FIELD_FACTOR_DEFINITIONS
            if bool(normalized_params[definition.parameter_key])
        ]
        feature_matrix, feature_names = _build_lstm_feature_matrix(
            full_frame,
            factor_values,
            enabled_factors,
        )
        target_values = _executable_return_targets(
            pd.to_numeric(full_frame["Open"], errors="coerce").to_numpy(
                dtype=np.float64
            )
        )
        requested_backend = str(normalized_params["compute_backend"])
        durable_gpu = self.training_min_seconds > 0 and requested_backend != "CPU"
        backend = resolve_lstm_backend("GPU" if durable_gpu else requested_backend)
        backend.requested = requested_backend
        backend.minimum_training_seconds = self.training_min_seconds
        backend.require_accelerator = durable_gpu
        if durable_gpu and backend.engine != "torch":
            raise RuntimeError("Training requires a working PyTorch MPS or CUDA GPU. "
                               "Install a supported PyTorch build or explicitly select CPU.")
        backend.feature_names = feature_names
        predictive_mean, predictive_std = walk_forward_lstm_predictions(
            feature_matrix,
            target_values,
            training_window=int(normalized_params["training_window"]),
            lookback=int(normalized_params["lstm_lookback"]),
            hidden_size=int(normalized_params["lstm_hidden_size"]),
            epochs=int(normalized_params["lstm_epochs"]),
            learning_rate=float(normalized_params["lstm_learning_rate"]),
            seed=int(normalized_params["lstm_seed"]),
            backend=backend,
            progress=self.training_progress,
        )
        autoregression = np.full(len(full_frame), np.nan, dtype=np.float64)
        long_run_mean = np.full(len(full_frame), np.nan, dtype=np.float64)
        innovation_std = np.full(len(full_frame), np.nan, dtype=np.float64)
        probability_up = np.full(len(full_frame), np.nan, dtype=np.float64)
        lookback = int(normalized_params["lstm_lookback"])
        training_window = int(normalized_params["training_window"])
        for origin in range(len(full_frame)):
            mean = float(predictive_mean[origin])
            scale = float(predictive_std[origin])
            if not math.isfinite(mean) or not math.isfinite(scale) or scale <= 0.0:
                continue
            training_end = max(0, origin - 1)
            training_start = max(lookback - 1, training_end - training_window)
            training_indices = np.arange(training_start, training_end, dtype=np.int64)
            training_indices = training_indices[np.isfinite(target_values[training_indices])]
            if len(training_indices) == 0:
                continue
            phi, mu, innovation = _estimate_return_state(
                target_values,
                training_indices,
                scale,
            )
            autoregression[origin] = phi
            long_run_mean[origin] = mu
            innovation_std[origin] = innovation
            probability_up[origin] = _normal_probability_above_zero(mean, scale)

        prediction_frame = pd.DataFrame(
            {
                "Date": full_frame["Date"],
                _PREDICTION_MEAN_COLUMN: predictive_mean,
                _PREDICTION_STD_COLUMN: predictive_std,
                _PROBABILITY_COLUMN: probability_up,
                _AUTOREGRESSION_COLUMN: autoregression,
                _LONG_RUN_MEAN_COLUMN: long_run_mean,
                _INNOVATION_STD_COLUMN: innovation_std,
            }
        )
        output = visible_frame.merge(
            prediction_frame,
            on="Date",
            how="left",
            validate="one_to_one",
        )
        diagnostics = _probabilistic_diagnostics(
            output["Open"].to_numpy(dtype=np.float64),
            output[_PREDICTION_MEAN_COLUMN].to_numpy(dtype=np.float64),
            output[_PREDICTION_STD_COLUMN].to_numpy(dtype=np.float64),
            output[_PROBABILITY_COLUMN].to_numpy(dtype=np.float64),
        )
        entry_probability = float(normalized_params["entry_probability"]) / 100.0
        buy_signals, sell_signals = _probability_threshold_signals(
            pd.to_numeric(output[_PROBABILITY_COLUMN], errors="coerce"),
            entry_probability,
        )
        output["buy_signal"] = pd.Series(buy_signals, index=output.index, dtype="bool")
        output["sell_signal"] = pd.Series(sell_signals, index=output.index, dtype="bool")

        latest_origin = max(0, len(output) - 1)
        actual_features = backend.origin_feature_names.get(len(full_frame) - 1, ())
        factor_selection = _latest_lstm_factor_selection(actual_features, latest_origin)
        for name in feature_names:
            if name != LAG_RETURN_FEATURE and name not in actual_features:
                factor_selection["selection_status"][name] = "unavailable"
        factors = build_price_field_factor_status(
            self._warmup_bundle,
            full_frame,
            factor_values,
            normalized_params,
            factor_selection,
        )
        bundle_fingerprint = str(
            _record_value(self._warmup_bundle, "fingerprint", "") or ""
        )
        fingerprint = _lstm_frame_fingerprint(
            full_frame,
            factor_values,
            normalized_params,
            bundle_fingerprint,
            feature_names,
        )
        source_commands = [
            str(command)
            for command in tuple(
                _record_value(self._warmup_bundle, "source_commands", ()) or ()
            )
        ]
        presentation = build_probability_grid_presentation(
            schema=LSTM_PRICE_FIELD_SCHEMA,
            model_version=_MODEL_VERSION,
            cell_display_threshold_pct=float(
                normalized_params["cell_display_threshold"]
            ),
            distribution_kind="lstm-gaussian-log-return",
            predictive_mean=_json_number_list(output[_PREDICTION_MEAN_COLUMN]),
            predictive_scale=_json_number_list(output[_PREDICTION_STD_COLUMN]),
            probability_up=_json_number_list(output[_PROBABILITY_COLUMN]),
            return_autoregression=_json_number_list(output[_AUTOREGRESSION_COLUMN]),
            return_long_run_mean=_json_number_list(output[_LONG_RUN_MEAN_COLUMN]),
            return_innovation_scale=_json_number_list(output[_INNOVATION_STD_COLUMN]),
            data_keys=[
                pd.Timestamp(value).isoformat()
                for value in output["Date"].tolist()
            ],
            diagnostics=diagnostics,
            factors=factors,
            factor_selection=factor_selection,
            device=backend_presentation(backend),
            source={
                "market_data": "longbridge-cli",
                "commands": source_commands,
            },
            fingerprint=fingerprint,
            extra={
                "training_label": "LSTM training",
                "lstm": {
                    "lookback": int(normalized_params["lstm_lookback"]),
                    "hidden_size": int(normalized_params["lstm_hidden_size"]),
                    "epochs": int(normalized_params["lstm_epochs"]),
                    "learning_rate": float(normalized_params["lstm_learning_rate"]),
                    "seed": int(normalized_params["lstm_seed"]),
                    "feature_names": list(feature_names),
                    "renderer": PROBABILITY_GRID_RENDERER,
                    "remote_market_access_disabled": is_remote_market_access_disabled(),
                },
            },
        )
        return StrategySignalResult(
            frame=output,
            buy_signal_column="buy_signal",
            sell_signal_column="sell_signal",
            required_execution_mode="next_open",
            metadata={
                "factors": factors,
                "factor_selection": presentation["factor_selection"],
                "compute_device": backend.resolved,
                "compute_engine": backend.engine,
                "compute_fallback_reason": backend.fallback_reason,
                "market_data_source": "longbridge-cli",
                "fingerprint": fingerprint,
                "probability_field_direction_hit_rate_pct": diagnostics[
                    "direction_hit_rate_pct"
                ],
                "probability_field_direction_hits": diagnostics["direction_hits"],
                "probability_field_direction_scored_points": diagnostics[
                    "direction_scored_points"
                ],
                "probability_field_probability_score_pct": diagnostics[
                    "probability_score_pct"
                ],
                "probability_field_brier_score": diagnostics["brier_score"],
                "probability_field_scored_points": diagnostics["scored_points"],
                "probability_field_mean_nlpd": diagnostics[
                    "mean_negative_log_predictive_density"
                ],
                "probability_field_mean_crps_log_return": diagnostics[
                    "mean_crps_log_return"
                ],
            },
            presentation=presentation,
        )
