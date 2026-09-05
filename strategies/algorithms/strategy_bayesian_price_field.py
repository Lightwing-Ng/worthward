"""
Walk-forward Bayesian executable-return strategy.

Every production market input is loaded through the Longbridge CLI factor
provider. The model predicts the tradable next-open-to-next-open log return and
exposes a compact, declarative presentation payload for the Backtest
probability-grid renderer.

Code version: v1.29.0
- Changed: Model-neutral causal Price Field preparation now lives in the
  shared pipeline; Bayesian retains posterior inference, factor selection,
  and backend scheduling.
- Changed: Bayesian presentation assembly now uses the shared Price Field
  payload builder, removing the remaining model-local copy of the renderer
  envelope while preserving Bayesian-owned diagnostics and device metadata.
- Changed: Probability-grid geometry now comes from the shared Price Field
  contract so Bayesian and LSTM emit one renderer payload.
- Changed: The signal target is the executable ``Open[t+1] -> Open[t+2]`` log
  return, so a close-origin prediction no longer receives credit for an
  overnight gap that has already occurred before the required next-open fill.
- Changed: Multi-column probabilities evolve through a causal AR(1) return
  state fitted at each origin instead of freezing one daily posterior mean and
  applying ``h * mean`` and ``sqrt(h) * scale`` diffusion extrapolation.
- Changed: Prior Strength is a direct percentage of standardized sample
  information, making the full slider range produce meaningful shrinkage.
- Changed: Enabled factors must add positive causal expanding-window log-score
  evidence after a complexity penalty; coverage and dispersion are only
  deterministic eligibility and tie-break inputs.
- Changed: User-facing diagnostics are a 0-100% executable-direction hit rate
  and a bounded proper Brier probability score. Gaussian log score and CRPS
  remain research diagnostics and are not mislabeled as hit rates.
- Changed: Direction diagnostics exclude flat executable returns and neutral
  50/50 forecasts; empty diagnostic samples remain explicitly unscored.
- Added: Factor presentation metadata separates provider availability,
  point-in-time eligibility, and actual selection at the latest model origin.
- Changed: Auto now coordinates independent walk-forward origins across the
  bounded CPU executor and an available Apple MPS or CUDA device, with a full
  NumPy CPU fallback when no accelerator is available or GPU execution fails.
- Changed: Causal CPU walk-forward origins use the shared bounded spawn process
  pool, with an ordered thread fallback when process execution is unavailable.
  Each worker receives only a causal batch and BLAS is capped to one thread per
  worker to use multiple processor cores without nested oversubscription.
- Added: Opt-in granular historical Longbridge option-volume and open-interest
  factors sit alongside the backward-compatible composite Options factor.
- Added: An opt-in Dynamic P/E Ratio factor uses the current Longbridge
  ``calc-index`` snapshot only on its own availability date.
- Changed: Bayesian quantitative-factor controls are registered once and
  rendered in alphabetical order; model parameters remain after the factors.
- Changed: Walk-forward observation noise now uses regularized, effective-degree-of-freedom ridge residual variance with a small process-noise floor, avoiding in-sample OLS overconfidence.
- Changed: The probability renderer keeps only the matrix itself; its Python
  presentation owns the instantaneous nonlinear cell-opacity curve.
- Added: Daily posterior signals may execute on real one-minute bars through a
  causal final-bar to next-session-open bridge without fabricating minute-level
  posterior values.
- Changed: The declarative presentation contract retains a fixed 20-column,
  ten-row-per-side maximum field with integer-trading-day slots and a fixed
  2 px cell gap. The renderer applies the same 2 px guide-to-first-cell inset
  while retaining the vertical and trailing 8 px field padding.
- Changed: The probability field no longer carries private radius or material
  fields; the renderer is a transparent, square-cell matrix only.
- Changed: NVDA is the default research ticker for this strategy.
- Changed: Longbridge symbol resolution now reuses the shared adapter contract,
  including canonical US share-class tickers such as BRK-B.
- Fixed: Ordinary Torch initialization failures now preserve the documented
  NumPy CPU fallback while process-control exceptions still propagate.
- Fixed: Provider trading dates remain market-local naive midnights throughout
  the model frame and presentation time-axis contract.
- Fixed: A GPU runtime failure now restarts the full walk-forward pass on one
  NumPy CPU backend, so a single backtest cannot mix MPS/CUDA and CPU values.
- Fixed: Research factors that lack a verifiable point-in-time availability
  status surface as unavailable rather than silently acting like ordinary
  sparse historical factors.
- Added: The probability field now exposes opt-in Longbridge research factors.
- Added: The Bayesian Price Field exposes a private absolute probability display
  threshold for focusing the rendered field without changing signals or scores.
- Changed: Bayesian startup defaults now use the selected GA winner's model
  factors and hyperparameters; browser-local strategy memory and explicit URL
  parameters remain authoritative overrides.
- Fixed: Model fingerprints now include the backend that actually produced the
  result, including resolved device, execution engine, numeric precision, and
  whole-run runtime fallback state.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
import hashlib
import importlib
import json
import math
import platform
from typing import Any, Sequence

import numpy as np
import pandas as pd

from app.infrastructure.parallel import (
    map_ordered_batches,
    resolve_worker_count,
)
from strategies.price_field_contract import (
    BAYESIAN_PRICE_FIELD_SCHEMA,
    build_probability_grid_presentation,
)
from strategies.price_field_pipeline import (
    PriceFieldFactorDefinition,
    PRICE_FIELD_FACTOR_DEFINITIONS,
    PRICE_FIELD_FACTOR_PARAMETER_KEYS,
    build_price_field_factor_status,
    build_price_field_factor_columns as _build_factor_columns,
    bundle_to_price_field_ohlcv as _bundle_ohlcv_frame,
    estimate_price_field_return_state as _estimate_return_state,
    executable_price_field_return_targets as _executable_return_targets,
    gaussian_negative_log_score as _gaussian_negative_log_score,
    json_number_list as _json_number_list,
    longbridge_price_field_symbol as _longbridge_symbol,  # noqa: F401
    merge_price_field_bundle_observations as _merge_bundle_observations,
    min_price_field_noise_variance as _MIN_NOISE_VARIANCE,
    multi_step_price_field_normal_parameters as _multi_step_normal_parameters,  # noqa: F401
    normal_probability_above_zero as _normal_probability_above_zero,
    normalize_price_field_ohlcv as _normalize_ohlcv_frame,
    price_field_epsilon as _EPSILON,
    price_field_probabilistic_diagnostics as _probabilistic_diagnostics,
    probability_threshold_signals as _probability_threshold_signals,
    record_price_field_value as _record_value,
    option_ratio as _option_ratio,  # noqa: F401
    rolling_price_field_volume_at_price_percentile as _rolling_volume_at_price_percentile,  # noqa: F401
    load_price_field_market_bundle,
)

from ..base import (
    BaseStrategy,
    StrategyParameterDefinition,
    StrategySignalResult,
    StrategySupportMatrix,
)
from ..interval_bridge import DAILY_CLOSE_TO_NEXT_SESSION_OPEN


_PREDICTION_MEAN_COLUMN = "bayesian_predictive_mean"
_PREDICTION_STD_COLUMN = "bayesian_predictive_std"
_PROBABILITY_COLUMN = "bayesian_probability_up"
_AUTOREGRESSION_COLUMN = "bayesian_return_autoregression"
_LONG_RUN_MEAN_COLUMN = "bayesian_return_long_run_mean"
_INNOVATION_STD_COLUMN = "bayesian_return_innovation_std"
_MIN_TRAINING_OBSERVATIONS = 20
_MODEL_VERSION = "bayesian-price-field-model/v1.10.0"
_CPU_PARALLEL_MIN_ROWS = 64
_CPU_PARALLEL_MAX_WORKERS = 8
_FACTOR_SELECTION_PRIORITY = (
    "volume",
    "pe",
    "options",
    "option_call_open_interest",
    "option_call_volume",
    "option_put_open_interest",
    "option_put_call_open_interest_ratio",
    "option_put_call_volume_ratio",
    "option_put_volume",
    "option_total_open_interest",
    "option_total_volume",
    "volume_at_price",
    "pb_ratio",
    "ps_ratio",
    "dividend_yield",
    "market_temperature",
    "capital_flow",
    "shareholder_concentration",
    "fund_holder_weight",
    "short_interest",
    "short_volume",
    "broker_holding",
)
_FACTOR_SELECTION_PRIORITY_INDEX = {
    factor: index for index, factor in enumerate(_FACTOR_SELECTION_PRIORITY)
}
_FACTOR_VALIDATION_POINTS = 6
_MIN_FACTOR_VALIDATION_POINTS = 4
_CELL_DISPLAY_THRESHOLD_DEFAULT_PCT = 5.0
_CELL_DISPLAY_THRESHOLD_MIN_PCT = 0.0
_CELL_DISPLAY_THRESHOLD_MAX_PCT = 50.0
_PRESENTATION_ONLY_PARAMETER_KEYS = frozenset({"cell_display_threshold"})
_BAYESIAN_FINGERPRINT_PARAMETER_KEYS = (
    PRICE_FIELD_FACTOR_PARAMETER_KEYS
    | {
        "training_window",
        "chip_window",
        "prior_strength",
        "entry_probability",
        "compute_backend",
    }
)

_BayesianFactorDefinition = PriceFieldFactorDefinition
_BAYESIAN_FACTOR_DEFINITIONS = PRICE_FIELD_FACTOR_DEFINITIONS

# Selected default profile from the DRAM Bayesian Price Field GA run. These
# factors are enabled only when their historical observations are available
# and pass the model's causal factor-selection gate.
_BAYESIAN_DEFAULT_ON_FACTOR_KEYS = frozenset({
    "use_options",
    "use_option_call_volume",
    "use_option_put_call_open_interest_ratio",
    "use_option_put_call_volume_ratio",
    "use_volume",
    "use_volume_at_price",
})





def _load_torch() -> Any | None:
    try:
        return importlib.import_module("torch")
    except Exception:
        return None


@dataclass
class _ComputeBackend:
    requested: str
    resolved: str = "cpu"
    engine: str = "numpy"
    torch_module: Any | None = None
    numeric_precision: str = "float64"
    fallback_reason: str | None = None
    runtime_fallback: bool = False
    parallel_workers: int = 1
    parallel_executor: str = "serial"
    parallel_fallback_reason: str | None = None

    def fall_back_to_cpu(self, reason: str) -> None:
        self.resolved = "cpu"
        self.engine = "numpy-fallback"
        self.torch_module = None
        self.numeric_precision = "float64"
        self.fallback_reason = reason
        self.runtime_fallback = True
        self.parallel_workers = 1
        self.parallel_executor = "serial"
        self.parallel_fallback_reason = None


def _torch_device_available(torch_module: Any, device: str) -> bool:
    try:
        if device == "mps":
            return bool(torch_module.backends.mps.is_available())
        if device == "cuda":
            return bool(torch_module.cuda.is_available())
    except (AttributeError, RuntimeError):
        return False
    return False


def _resolve_compute_backend(requested: str) -> _ComputeBackend:
    normalized = requested if requested in {"Auto", "CPU", "GPU"} else "Auto"
    backend = _ComputeBackend(requested=normalized)
    if normalized == "CPU":
        return backend

    torch_module = _load_torch()
    if torch_module is None:
        return backend

    system_name = platform.system()
    candidate_devices = (
        ("mps", "cuda")
        if system_name == "Darwin"
        else (("cuda",) if system_name == "Windows" else ("cuda", "mps"))
    )
    for device in candidate_devices:
        if _torch_device_available(torch_module, device):
            backend.resolved = device
            backend.engine = "hybrid" if normalized == "Auto" else "torch"
            backend.torch_module = torch_module
            backend.numeric_precision = "float32" if device == "mps" else "float64"
            return backend
    return backend


def _ridge_penalty(prior_strength: float, observation_count: int) -> float:
    """Map the UI percentage to standardized sample information.

    A standardized non-intercept factor contributes approximately ``n`` to the
    diagonal of ``X'X``. Treating Prior Strength as a percentage of that amount
    gives the slider a stable meaning across training-window lengths: 100 means
    a ridge penalty equal to one full sample-information diagonal.
    """
    normalized_strength = max(0.0, float(prior_strength)) / 100.0
    return normalized_strength * max(1, int(observation_count))


def _numpy_bayesian_prediction(
        design: np.ndarray,
        target: np.ndarray,
        current: np.ndarray,
        prior_strength: float,
        noise_variance: float,
) -> tuple[float, float]:
    identity = np.eye(design.shape[1], dtype=np.float64)
    identity[0, 0] = 0.1
    ridge_penalty = _ridge_penalty(prior_strength, len(target))
    precision = (
        design.T @ design + ridge_penalty * identity
    ) / noise_variance
    right_hand_side = (design.T @ target) / noise_variance
    posterior_mean = np.linalg.solve(precision, right_hand_side)
    current_precision_solution = np.linalg.solve(precision, current)
    predictive_mean = float(current @ posterior_mean)
    predictive_variance = float(
        noise_variance + current @ current_precision_solution
    )
    return predictive_mean, math.sqrt(max(predictive_variance, _EPSILON))


def _torch_bayesian_prediction(
        backend: _ComputeBackend,
        design: np.ndarray,
        target: np.ndarray,
        current: np.ndarray,
        prior_strength: float,
        noise_variance: float,
) -> tuple[float, float]:
    torch_module = backend.torch_module
    if torch_module is None:
        raise RuntimeError("Torch is unavailable.")
    dtype = torch_module.float32 if backend.resolved == "mps" else torch_module.float64
    device = torch_module.device(backend.resolved)
    design_tensor = torch_module.as_tensor(design, dtype=dtype, device=device)
    target_tensor = torch_module.as_tensor(target, dtype=dtype, device=device)
    current_tensor = torch_module.as_tensor(current, dtype=dtype, device=device)
    identity = torch_module.eye(design.shape[1], dtype=dtype, device=device)
    identity[0, 0] = 0.1
    ridge_penalty = _ridge_penalty(prior_strength, len(target))
    precision = (
        design_tensor.T @ design_tensor + ridge_penalty * identity
    ) / noise_variance
    right_hand_side = design_tensor.T @ target_tensor / noise_variance
    posterior_mean = torch_module.linalg.solve(precision, right_hand_side)
    precision_solution = torch_module.linalg.solve(precision, current_tensor)
    predictive_mean = float((current_tensor @ posterior_mean).detach().cpu().item())
    predictive_variance = float(
        (
            noise_variance
            + current_tensor @ precision_solution
        ).detach().cpu().item()
    )
    predictive_standard_deviation = math.sqrt(max(predictive_variance, _EPSILON))
    if not math.isfinite(predictive_mean) or not math.isfinite(predictive_standard_deviation):
        raise ValueError("Torch posterior prediction was non-finite.")
    return predictive_mean, predictive_standard_deviation


def _bayesian_prediction(
        backend: _ComputeBackend,
        design: np.ndarray,
        target: np.ndarray,
        current: np.ndarray,
        prior_strength: float,
        noise_variance: float,
) -> tuple[float, float]:
    if backend.engine in {"torch", "hybrid"}:
        try:
            return _torch_bayesian_prediction(
                backend,
                design,
                target,
                current,
                prior_strength,
                noise_variance,
            )
        except (RuntimeError, TypeError, ValueError) as exc:
            backend.fall_back_to_cpu(
                f"{type(exc).__name__}: {str(exc) or 'Torch posterior failure'}"
            )
    return _numpy_bayesian_prediction(
        design,
        target,
        current,
        prior_strength,
        noise_variance,
    )


def _ridge_residual_variance(
        design: np.ndarray,
        target: np.ndarray,
        prior_strength: float,
) -> float:
    """Estimate causal process noise from the same ridge model as prediction.

    The old estimator fit an unregularized OLS model and divided its in-sample
    residual sum by ``n - p``. With correlated factors that residual can be
    almost zero even though a future return remains uncertain. Reusing the
    Bayesian ridge coefficients and its effective residual degrees of freedom
    keeps the scale aligned with the posterior while the variance floor avoids
    a degenerate, overconfident forecast on a short or perfectly fitted sample.
    """
    numeric_design = np.asarray(design, dtype=np.float64)
    numeric_target = np.asarray(target, dtype=np.float64)
    observation_count = len(numeric_target)
    if observation_count <= 1:
        return _MIN_NOISE_VARIANCE

    sample_variance = float(np.var(numeric_target, ddof=1))
    if not math.isfinite(sample_variance):
        sample_variance = 0.0
    identity = np.eye(numeric_design.shape[1], dtype=np.float64)
    identity[0, 0] = 0.1
    precision = numeric_design.T @ numeric_design + (
        _ridge_penalty(prior_strength, observation_count) * identity
    )
    try:
        coefficients = np.linalg.solve(
            precision,
            numeric_design.T @ numeric_target,
        )
        leverage = np.linalg.solve(precision, numeric_design.T)
    except (np.linalg.LinAlgError, ValueError):
        # Keep the recovery path on the same regularized precision system.
        precision_inverse = np.linalg.pinv(precision)
        coefficients = precision_inverse @ numeric_design.T @ numeric_target
        leverage = precision_inverse @ numeric_design.T

    effective_degrees_of_freedom = observation_count - float(
        np.trace(numeric_design @ leverage)
    )
    residuals = numeric_target - numeric_design @ coefficients
    residual_sum = float(np.sum(np.square(residuals)))
    effective_degrees_of_freedom = max(1.0, effective_degrees_of_freedom)
    ridge_variance = residual_sum / effective_degrees_of_freedom
    if not math.isfinite(ridge_variance):
        ridge_variance = 0.0
    noise_variance = max(
        _MIN_NOISE_VARIANCE,
        ridge_variance,
        sample_variance * 0.05,
    )
    # A modest fraction of the observed return dispersion is retained as
    # irreducible process noise even when the training design interpolates it.
    return max(_MIN_NOISE_VARIANCE, float(noise_variance), ridge_variance)


def _standardized_design_at_index(
        factor_values: dict[str, np.ndarray],
        factors: Sequence[str],
        training_indices: np.ndarray,
        current_index: int,
) -> tuple[np.ndarray, np.ndarray] | None:
    """Build one causal standardized design and its current feature row."""
    standardized_training: list[np.ndarray] = []
    standardized_current: list[float] = []
    for factor in factors:
        training_values = np.asarray(
            factor_values[factor][training_indices],
            dtype=np.float64,
        )
        center = float(np.mean(training_values))
        scale = float(np.std(training_values))
        current_value = float(factor_values[factor][current_index])
        if (
                not math.isfinite(center)
                or not math.isfinite(scale)
                or scale <= _EPSILON
                or not math.isfinite(current_value)
        ):
            return None
        standardized_training.append((training_values - center) / scale)
        standardized_current.append((current_value - center) / scale)

    design = np.ones(
        (len(training_indices), 1 + len(standardized_training)),
        dtype=np.float64,
    )
    current = np.ones(1 + len(standardized_current), dtype=np.float64)
    if standardized_training:
        design[:, 1:] = np.column_stack(standardized_training)
        current[1:] = standardized_current
    return design, current



def _causal_incremental_factor_evidence(
        factor_values: dict[str, np.ndarray],
        selected_factors: Sequence[str],
        candidate_factor: str,
        candidate_indices: np.ndarray,
        target_values: np.ndarray,
        prior_strength: float,
) -> tuple[float, int]:
    """Score one added factor on identical expanding-window validation rows."""
    augmented_factors = [*selected_factors, candidate_factor]
    common_mask = np.isfinite(target_values[candidate_indices])
    for factor in augmented_factors:
        common_mask &= np.isfinite(factor_values[factor][candidate_indices])
    common_indices = candidate_indices[common_mask]
    if len(common_indices) < (
            _MIN_TRAINING_OBSERVATIONS + _MIN_FACTOR_VALIDATION_POINTS
    ):
        return -math.inf, 0

    validation_positions = list(
        range(_MIN_TRAINING_OBSERVATIONS, len(common_indices))
    )[-_FACTOR_VALIDATION_POINTS:]
    base_scores: list[float] = []
    augmented_scores: list[float] = []
    complexity_penalties: list[float] = []
    for position in validation_positions:
        validation_index = int(common_indices[position])
        # Recreate the same availability lag as a real close-origin fit. The
        # target on ``validation_index - 1`` still needs an Open after the
        # validation origin and must not enter this inner historical model.
        training_indices = common_indices[
            common_indices <= validation_index - 2
        ]
        if len(training_indices) < _MIN_TRAINING_OBSERVATIONS:
            continue
        base_design = _standardized_design_at_index(
            factor_values,
            selected_factors,
            training_indices,
            validation_index,
        )
        augmented_design = _standardized_design_at_index(
            factor_values,
            augmented_factors,
            training_indices,
            validation_index,
        )
        if base_design is None or augmented_design is None:
            continue
        observed = float(target_values[validation_index])
        for destination, (design, current) in (
                (base_scores, base_design),
                (augmented_scores, augmented_design),
        ):
            variance = _ridge_residual_variance(
                design,
                target_values[training_indices],
                prior_strength,
            )
            mean, scale = _numpy_bayesian_prediction(
                design,
                target_values[training_indices],
                current,
                prior_strength,
                variance,
            )
            destination.append(
                _gaussian_negative_log_score(observed, mean, scale)
            )
        complexity_penalties.append(
            math.log(max(2, len(training_indices)))
            / (2.0 * len(training_indices))
        )

    if len(base_scores) < _MIN_FACTOR_VALIDATION_POINTS:
        return -math.inf, len(base_scores)
    improvement = float(np.mean(np.asarray(base_scores) - np.asarray(augmented_scores)))
    adjusted_improvement = improvement - float(np.mean(complexity_penalties))
    return adjusted_improvement, len(base_scores)


def _eligible_factor_candidates(
        factor_values: dict[str, np.ndarray],
        enabled_factors: Sequence[str],
        candidate_indices: np.ndarray,
        current_index: int,
) -> list[tuple[str, int, float]]:
    """Return enabled factors that can enter one causal model origin."""
    candidates: list[tuple[str, int, float]] = []
    seen: set[str] = set()
    for raw_factor in enabled_factors:
        factor = str(raw_factor)
        if factor in seen or factor not in factor_values:
            continue
        seen.add(factor)
        values = np.asarray(factor_values[factor], dtype=np.float64)
        if current_index < 0 or current_index >= len(values):
            continue
        candidate_values = values[candidate_indices]
        finite = np.isfinite(candidate_values)
        coverage = int(np.count_nonzero(finite))
        if not np.isfinite(values[current_index]) or coverage < _MIN_TRAINING_OBSERVATIONS:
            continue
        finite_values = candidate_values[finite]
        dispersion = float(np.std(finite_values)) if len(finite_values) > 1 else 0.0
        if not math.isfinite(dispersion):
            dispersion = 0.0
        candidates.append((factor, coverage, dispersion))
    return candidates


def _select_active_factors(
        factor_values: dict[str, np.ndarray],
        enabled_factors: Sequence[str],
        candidate_indices: np.ndarray,
        current_index: int,
        target_values: np.ndarray,
        prior_strength: float,
) -> list[str]:
    """Select factors by causal incremental predictive evidence.

    Coverage and dispersion determine eligibility only. Each admitted factor
    must improve expanding-window Gaussian log score on later historical rows
    after a one-parameter complexity penalty, and every comparison uses the
    same point-in-time rows for its base and augmented models.
    """
    candidates = _eligible_factor_candidates(
        factor_values,
        enabled_factors,
        candidate_indices,
        current_index,
    )

    candidate_metadata = {
        factor: (coverage, dispersion)
        for factor, coverage, dispersion in candidates
    }
    active: list[str] = []
    remaining = {factor for factor, _, _ in candidates}
    while remaining:
        evidence: list[tuple[str, float, int]] = []
        for factor in remaining:
            improvement, validation_points = _causal_incremental_factor_evidence(
                factor_values,
                active,
                factor,
                candidate_indices,
                target_values,
                prior_strength,
            )
            evidence.append((factor, improvement, validation_points))
        evidence.sort(
            key=lambda item: (
                -item[1],
                -item[2],
                -candidate_metadata[item[0]][0],
                -candidate_metadata[item[0]][1],
                _FACTOR_SELECTION_PRIORITY_INDEX.get(
                    item[0],
                    len(_FACTOR_SELECTION_PRIORITY),
                ),
                item[0],
            )
        )
        best_factor, best_improvement, _ = evidence[0]
        if not math.isfinite(best_improvement) or best_improvement <= 0.0:
            break
        active.append(best_factor)
        remaining.remove(best_factor)
    return active


def _latest_factor_selection(
        factor_values: dict[str, np.ndarray],
        enabled_factors: Sequence[str],
        training_window: int,
        target_values: np.ndarray,
        current_index: int,
        prior_strength: float,
) -> dict[str, Any]:
    """Describe eligibility and selection for the latest causal origin."""
    normalized_index = min(max(0, int(current_index)), max(0, len(target_values) - 1))
    training_end = max(0, normalized_index - 1)
    training_start = max(0, training_end - int(training_window))
    candidate_indices = np.arange(training_start, training_end, dtype=np.int64)
    candidates = _eligible_factor_candidates(
        factor_values,
        enabled_factors,
        candidate_indices,
        normalized_index,
    )
    eligible = [factor for factor, _, _ in candidates]
    selected = _select_active_factors(
        factor_values,
        enabled_factors,
        candidate_indices,
        normalized_index,
        target_values,
        prior_strength,
    )
    selected_set = set(selected)
    eligible_set = set(eligible)
    return {
        "origin_index": normalized_index,
        "eligible": eligible,
        "selected": selected,
        "selection_status": {
            factor: (
                "selected"
                if factor in selected_set
                else "eligible-not-selected"
                if factor in eligible_set
                else "ineligible"
            )
            for factor in dict.fromkeys(
                [*map(str, enabled_factors), *eligible, *selected]
            )
        },
    }



def _cpu_parallel_worker_count(row_count: int) -> int:
    """Choose a bounded worker count for independent CPU walk-forward origins."""
    return resolve_worker_count(
        max(0, int(row_count)),
        mode="cpu",
        min_items=_CPU_PARALLEL_MIN_ROWS,
        max_workers=_CPU_PARALLEL_MAX_WORKERS,
    )


def _walk_forward_prediction_at_index(
        index: int,
        target_values: np.ndarray,
        factor_values: dict[str, np.ndarray],
        enabled_factors: Sequence[str],
        training_window: int,
        prior_strength: float,
        backend: _ComputeBackend,
) -> tuple[int, float, float, float, float, float, float]:
    """Compute one causal origin; no worker reads a future row as a feature."""
    missing = (
        index,
        math.nan,
        math.nan,
        math.nan,
        math.nan,
        math.nan,
        math.nan,
    )
    # A factor row ``j`` targets Open[j+1] -> Open[j+2]. At the close of
    # origin ``index`` only targets through ``j = index - 2`` are observable;
    # the immediately preceding factor row still depends on the next open.
    training_end = max(0, index - 1)
    training_start = max(0, training_end - training_window)
    candidate_indices = np.arange(training_start, training_end, dtype=np.int64)
    if len(candidate_indices) < _MIN_TRAINING_OBSERVATIONS:
        return missing

    active_factors = _select_active_factors(
        factor_values,
        enabled_factors,
        candidate_indices,
        index,
        target_values,
        prior_strength,
    )

    joint_mask = np.isfinite(target_values[candidate_indices])
    for factor in active_factors:
        joint_mask &= np.isfinite(factor_values[factor][candidate_indices])
    training_indices = candidate_indices[joint_mask]
    if len(training_indices) < _MIN_TRAINING_OBSERVATIONS:
        return missing

    target = target_values[training_indices]
    design_contract = _standardized_design_at_index(
        factor_values,
        active_factors,
        training_indices,
        index,
    )
    if design_contract is None:
        return missing
    design, current = design_contract

    noise_variance = _ridge_residual_variance(
        design,
        target,
        prior_strength,
    )
    mean, standard_deviation = _bayesian_prediction(
        backend,
        design,
        target,
        current,
        prior_strength,
        noise_variance,
    )
    if not math.isfinite(mean) or not math.isfinite(standard_deviation):
        return missing
    autoregression, long_run_mean, innovation_scale = _estimate_return_state(
        target_values,
        training_indices,
        standard_deviation,
    )
    return (
        index,
        mean,
        standard_deviation,
        _normal_probability_above_zero(mean, standard_deviation),
        autoregression,
        long_run_mean,
        innovation_scale,
    )


def _walk_forward_prediction_batch(
        indices: Sequence[int],
        target_values: np.ndarray,
        factor_values: dict[str, np.ndarray],
        enabled_factors: Sequence[str],
        training_window: int,
        prior_strength: float,
        backend: _ComputeBackend,
) -> list[tuple[int, float, float, float, float, float, float]]:
    """Evaluate a contiguous causal batch in a process-safe top-level task."""
    return [
        _walk_forward_prediction_at_index(
            int(index),
            target_values,
            factor_values,
            enabled_factors,
            training_window,
            prior_strength,
            backend,
        )
        for index in indices
    ]


def _walk_forward_predictions_cpu(
        indices: Sequence[int],
        target_values: np.ndarray,
        factor_values: dict[str, np.ndarray],
        enabled_factors: Sequence[str],
        training_window: int,
        prior_strength: float,
        backend: _ComputeBackend,
) -> tuple[list[tuple[int, float, float, float, float, float, float]], Any]:
    """Run the CPU share of origins and return its executor statistics."""
    cpu_backend = _ComputeBackend(
        requested=backend.requested,
        resolved="cpu",
        engine="numpy",
        numeric_precision="float64",
    )
    predictions, stats = map_ordered_batches(
        _walk_forward_prediction_batch,
        indices,
        mode="cpu",
        static_args=(
            target_values,
            factor_values,
            tuple(enabled_factors),
            training_window,
            prior_strength,
            cpu_backend,
        ),
        min_items=_CPU_PARALLEL_MIN_ROWS,
        max_workers=_CPU_PARALLEL_MAX_WORKERS,
    )
    return predictions, stats


def _walk_forward_predictions_hybrid(
        frame: pd.DataFrame,
        target_values: np.ndarray,
        factor_values: dict[str, np.ndarray],
        enabled_factors: Sequence[str],
        training_window: int,
        prior_strength: float,
        backend: _ComputeBackend,
) -> list[tuple[int, float, float, float, float, float, float]]:
    """Coordinate CPU origins and GPU origins concurrently for Auto mode."""
    del frame
    indices = tuple(range(len(target_values)))
    if not indices:
        backend.parallel_workers = 1
        backend.parallel_executor = "serial"
        backend.parallel_fallback_reason = None
        return []

    gpu_indices = indices[::2]
    cpu_indices = indices[1::2]

    def run_cpu() -> tuple[
            list[tuple[int, float, float, float, float, float, float]],
            Any,
    ]:
        return _walk_forward_predictions_cpu(
            cpu_indices,
            target_values,
            factor_values,
            enabled_factors,
            training_window,
            prior_strength,
            backend,
        )

    with ThreadPoolExecutor(max_workers=2) as executor:
        cpu_future = executor.submit(run_cpu)
        gpu_future = executor.submit(
            _walk_forward_prediction_batch,
            gpu_indices,
            target_values,
            factor_values,
            tuple(enabled_factors),
            training_window,
            prior_strength,
            backend,
        )
        cpu_predictions, cpu_stats = cpu_future.result()
        gpu_predictions = gpu_future.result()

    backend.parallel_workers = cpu_stats.workers + 1
    backend.parallel_executor = "hybrid"
    backend.parallel_fallback_reason = cpu_stats.fallback_reason
    return [*cpu_predictions, *gpu_predictions]


def _walk_forward_predictions(
        frame: pd.DataFrame,
        factor_values: dict[str, np.ndarray],
        enabled_factors: Sequence[str],
        training_window: int,
        prior_strength: float,
        backend: _ComputeBackend,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    row_count = len(frame)
    predictive_mean = np.full(row_count, np.nan, dtype=np.float64)
    predictive_std = np.full(row_count, np.nan, dtype=np.float64)
    probability_up = np.full(row_count, np.nan, dtype=np.float64)
    autoregression = np.full(row_count, np.nan, dtype=np.float64)
    long_run_mean = np.full(row_count, np.nan, dtype=np.float64)
    innovation_std = np.full(row_count, np.nan, dtype=np.float64)
    open_prices = pd.to_numeric(
        frame["Open"],
        errors="coerce",
    ).to_numpy(dtype=np.float64)
    target_values = _executable_return_targets(open_prices)

    if backend.engine == "torch":
        backend.parallel_workers = 1
        backend.parallel_executor = "serial"
        backend.parallel_fallback_reason = None
        predictions = _walk_forward_prediction_batch(
            tuple(range(row_count)),
            target_values,
            factor_values,
            enabled_factors,
            training_window,
            prior_strength,
            backend,
        )
    elif backend.engine == "hybrid":
        predictions = _walk_forward_predictions_hybrid(
            frame,
            target_values,
            factor_values,
            enabled_factors,
            training_window,
            prior_strength,
            backend,
        )
    else:
        predictions, stats = _walk_forward_predictions_cpu(
            tuple(range(row_count)),
            target_values,
            factor_values,
            enabled_factors,
            training_window,
            prior_strength,
            backend,
        )
        backend.parallel_workers = stats.workers
        backend.parallel_executor = stats.executor
        backend.parallel_fallback_reason = stats.fallback_reason

    for (
            index,
            mean,
            standard_deviation,
            probability,
            origin_autoregression,
            origin_long_run_mean,
            origin_innovation_std,
    ) in predictions:
        predictive_mean[index] = mean
        predictive_std[index] = standard_deviation
        probability_up[index] = probability
        autoregression[index] = origin_autoregression
        long_run_mean[index] = origin_long_run_mean
        innovation_std[index] = origin_innovation_std

    return (
        predictive_mean,
        predictive_std,
        probability_up,
        autoregression,
        long_run_mean,
        innovation_std,
    )



def _frame_fingerprint(
        frame: pd.DataFrame,
        factor_values: dict[str, np.ndarray],
        params: dict[str, Any],
        bundle_fingerprint: str,
        backend: _ComputeBackend | None = None,
) -> str:
    """Hash every model input, including derived factors and model settings."""
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
    backend_payload = None
    if backend is not None:
        backend_payload = {
            "requested": backend.requested,
            "resolved": backend.resolved,
            "engine": backend.engine,
            "numeric_precision": backend.numeric_precision,
            "runtime_fallback": backend.runtime_fallback,
        }
    contract_bytes = json.dumps(
        {
            "bundle_fingerprint": str(bundle_fingerprint or ""),
            "model_version": _MODEL_VERSION,
            "backend": backend_payload,
            "params": {
                key: value
                for key, value in params.items()
                if key in _BAYESIAN_FINGERPRINT_PARAMETER_KEYS
            },
        },
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    ).encode("utf-8")
    return hashlib.sha256(contract_bytes + frame_hash + derived_hash).hexdigest()


class BayesianPriceFieldStrategy(BaseStrategy):
    strategy_id = "bayesian-price-field"
    strategy_name = "Bayesian Price Field"
    strategy_description = (
        "Walk-forward Bayesian regression estimates executable next-open returns "
        "from point-in-time-safe Longbridge CLI price, volume, options, valuation, "
        "and sentiment factors, then evolves a causal multi-step price field."
    )
    strategy_category = "machine-learning"
    strategy_display_order = 42
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
        "1m": "Daily Bayesian model; the probability field is available at 1d.",
    }
    strategy_market_data_source = "longbridge-cli"
    backtest_cacheable = False
    strategy_parameter_title = "Bayesian parameters"
    strategy_presentation_renderer = "probability-grid-v1"

    def __init__(self) -> None:
        self._warmup_bundle: object | None = None

    def get_default_tickers(self) -> tuple[str, ...]:
        return ("NVDA",)

    def get_parameter_definitions(self) -> tuple[StrategyParameterDefinition, ...]:
        return (
            *(
                StrategyParameterDefinition(
                    key=definition.parameter_key,
                    label=definition.label,
                    kind="boolean",
                    group="factors",
                    default=definition.parameter_key in _BAYESIAN_DEFAULT_ON_FACTOR_KEYS,
                    help_text=definition.help_text,
                )
                for definition in _BAYESIAN_FACTOR_DEFINITIONS
            ),
            StrategyParameterDefinition(
                key="cell_display_threshold",
                optimizable=False,
                label="Cell Display Threshold (%)",
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
                label="Training Window",
                kind="integer",
                default=30,
                minimum=30,
                maximum=504,
                step=1,
                unit_hint="bars",
                help_text="Limits each posterior fit to observations already known at the hovered date.",
            ),
            StrategyParameterDefinition(
                key="chip_window",
                label="Volume-at-price Window",
                kind="integer",
                default=41,
                minimum=5,
                maximum=252,
                step=1,
                unit_hint="bars",
                help_text="Sets the trailing bar window for the volume-at-price distribution factor.",
            ),
            StrategyParameterDefinition(
                key="prior_strength",
                label="Prior Strength",
                kind="number",
                default=1.51,
                minimum=0.01,
                maximum=100.0,
                step=0.01,
                unit_hint="% sample information",
                help_text=(
                    "Sets coefficient shrinkage as a percentage of the standardized "
                    "training sample's information. 100% adds a ridge penalty equal "
                    "to one factor-information diagonal."
                ),
            ),
            StrategyParameterDefinition(
                key="entry_probability",
                label="Entry Probability",
                kind="number",
                default=60.0,
                minimum=51.0,
                maximum=95.0,
                step=0.1,
                unit_hint="%",
                help_text="Enters when the posterior rise probability reaches this threshold and exits at its symmetric downside threshold.",
            ),
            StrategyParameterDefinition(
                key="compute_backend",
                optimizable=False,
                label="Compute Backend",
                kind="choice",
                default="Auto",
                options=("Auto", "CPU", "GPU"),
                help_text="Auto coordinates bounded multi-core CPU work with an available Apple MPS or CUDA GPU for heterogeneous walk-forward computation; without an accelerator it uses CPU. CPU forces bounded multi-core CPU work. GPU explicitly requests Apple MPS or CUDA, then safely falls back to CPU.",
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
        normalized_params = self.normalize_params(params)
        try:
            bundle = load_price_field_market_bundle(
                tickers,
                interval=interval,
                start=start,
                end=end,
                params=normalized_params,
            )
        except ValueError as exc:
            raise ValueError(
                str(exc).replace("Price Field", "Bayesian Price Field")
            ) from exc
        self._warmup_bundle = bundle
        return [_bundle_ohlcv_frame(bundle)]

    def _factor_status(
            self,
            frame: pd.DataFrame,
            factor_values: dict[str, np.ndarray],
            normalized_params: dict[str, Any],
            selection: dict[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        return build_price_field_factor_status(
            self._warmup_bundle,
            frame,
            factor_values,
            normalized_params,
            selection,
        )

    def compute_signals(
            self,
            dataset: pd.DataFrame,
            params: dict | None = None,
    ) -> StrategySignalResult:
        normalized_params = self.normalize_params(params)
        visible_frame = _normalize_ohlcv_frame(dataset)
        full_frame = (
            _bundle_ohlcv_frame(self._warmup_bundle)
            if self._warmup_bundle is not None
            else visible_frame.copy()
        )
        full_frame = _merge_bundle_observations(full_frame, self._warmup_bundle)
        factor_values = _build_factor_columns(
            full_frame,
            int(normalized_params["chip_window"]),
        )
        enabled_factors = [
            definition.key
            for definition in _BAYESIAN_FACTOR_DEFINITIONS
            if bool(normalized_params[definition.parameter_key])
        ]
        target_values = _executable_return_targets(
            pd.to_numeric(full_frame["Open"], errors="coerce").to_numpy(
                dtype=np.float64
            )
        )
        factor_selection = _latest_factor_selection(
            factor_values,
            enabled_factors,
            int(normalized_params["training_window"]),
            target_values,
            len(full_frame) - 1,
            float(normalized_params["prior_strength"]),
        )
        backend = _resolve_compute_backend(str(normalized_params["compute_backend"]))
        (
            predictive_mean,
            predictive_std,
            probability_up,
            autoregression,
            long_run_mean,
            innovation_std,
        ) = _walk_forward_predictions(
            full_frame,
            factor_values,
            enabled_factors,
            int(normalized_params["training_window"]),
            float(normalized_params["prior_strength"]),
            backend,
        )
        if backend.runtime_fallback:
            # A runtime MPS/CUDA failure can happen only after earlier origins
            # have already completed. Recompute every origin on one clean CPU
            # backend instead of returning a mixed-precision backtest.
            fallback_backend = _ComputeBackend(
                requested=backend.requested,
                resolved="cpu",
                engine="numpy-fallback",
                numeric_precision="float64",
                fallback_reason=backend.fallback_reason,
                runtime_fallback=True,
            )
            (
                predictive_mean,
                predictive_std,
                probability_up,
                autoregression,
                long_run_mean,
                innovation_std,
            ) = _walk_forward_predictions(
                full_frame,
                factor_values,
                enabled_factors,
                int(normalized_params["training_window"]),
                float(normalized_params["prior_strength"]),
                fallback_backend,
            )
            backend = fallback_backend
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
        output = visible_frame.merge(prediction_frame, on="Date", how="left", validate="one_to_one")
        # Score only the visible backtest interval. The hidden warm-up bars
        # may train a posterior, but they are not part of the user-facing
        # equity curve or its diagnostic denominator.
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

        bundle_fingerprint = str(
            _record_value(self._warmup_bundle, "fingerprint", "") or ""
        )
        fingerprint = _frame_fingerprint(
            full_frame,
            factor_values,
            normalized_params,
            bundle_fingerprint,
            backend,
        )
        source_commands = [
            str(command)
            for command in tuple(
                _record_value(self._warmup_bundle, "source_commands", ()) or ()
            )
        ]
        factors = self._factor_status(
            full_frame,
            factor_values,
            normalized_params,
            factor_selection,
        )
        presentation = build_probability_grid_presentation(
            schema=BAYESIAN_PRICE_FIELD_SCHEMA,
            model_version=_MODEL_VERSION,
            cell_display_threshold_pct=float(
                normalized_params["cell_display_threshold"]
            ),
            distribution_kind="dynamic-normal-log-return",
            predictive_mean=_json_number_list(output[_PREDICTION_MEAN_COLUMN]),
            predictive_scale=_json_number_list(output[_PREDICTION_STD_COLUMN]),
            probability_up=_json_number_list(output[_PROBABILITY_COLUMN]),
            return_autoregression=_json_number_list(
                output[_AUTOREGRESSION_COLUMN]
            ),
            return_long_run_mean=_json_number_list(
                output[_LONG_RUN_MEAN_COLUMN]
            ),
            return_innovation_scale=_json_number_list(
                output[_INNOVATION_STD_COLUMN]
            ),
            data_keys=[
                pd.Timestamp(value).isoformat()
                for value in output["Date"].tolist()
            ],
            diagnostics=diagnostics,
            factors=factors,
            factor_selection={
                "origin_index": factor_selection["origin_index"],
                "eligible": list(factor_selection["eligible"]),
                "selected": list(factor_selection["selected"]),
                "selection_status": dict(factor_selection["selection_status"]),
                "method": (
                    "latest-causal-expanding-window-incremental-gaussian-log-score"
                ),
            },
            device={
                "requested": backend.requested,
                "resolved": backend.resolved,
                "engine": backend.engine,
                "numeric_precision": backend.numeric_precision,
                "fallback_reason": backend.fallback_reason,
                "parallel_workers": backend.parallel_workers,
                "parallel_strategy": (
                    "gpu-device"
                    if backend.engine == "torch"
                    else "cpu-gpu-heterogeneous"
                    if backend.engine == "hybrid"
                    else {
                        "process": "cpu-process-pool",
                        "thread": "cpu-thread-fallback",
                        "serial": "cpu-serial",
                    }.get(backend.parallel_executor, "cpu-serial")
                ),
                "parallel_fallback_reason": backend.parallel_fallback_reason,
            },
            source={
                "market_data": "longbridge-cli",
                "commands": source_commands,
            },
            fingerprint=fingerprint,
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
                "compute_parallel_workers": backend.parallel_workers,
                "compute_parallel_executor": backend.parallel_executor,
                "compute_parallel_fallback_reason": backend.parallel_fallback_reason,
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
