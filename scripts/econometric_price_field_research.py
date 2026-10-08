#!/usr/bin/env python3
"""Reproduce stored Price Field priors and current panel scores offline. Code version: v1.0.0.

One frozen protocol: the 16-ticker daily panel, priors estimated strictly before
2016-10-01, the selection window 2016-10-01 through 2023-09-30 and the KPI window
from 2023-10-01 to the end of local history.
The historical selection protocol is reported with its recorded exception and
exploratory KPI exposure; this CLI does not establish candidate-selection independence.

* ``--describe`` prints the protocol, the four strategies' frozen defaults and the
  stored prior constants without loading prices.
* ``priors`` re-estimates the Rough Volatility and Score-Driven priors from local
  daily history physically truncated before the cutoff, with the procedure of the
  research scripts (rough ``priors2.py`` and ``priors_r2.py``; score-driven
  ``prior_centers2.py`` with ``sdlib.gasx_sigma``) run on the repository's model
  functions, and compares every value with the stored constant at that
  constant's rounding precision. Stored constants are never changed.
* ``panel`` scores the four registered strategies' default forecasts, made by the
  repository forecast functions on each ticker's full local history with the
  strategies' date-anchored refit blocks, on the selection and KPI windows with
  the official scorer ``score_neural_price_field``. ``--refit-schedule
  row-index-grid`` instead refits on the research harness's row grid
  ``0, refit, 2 refit, ...`` (pure-array forecasts without session dates).

Prices are read only from the local daily store through the research loader, with
remote market access disabled. Results go to a new output directory outside the
market and settings stores. Exit status: 0 reproduced or complete, 1 failure,
2 usage error, 3 finished with a value that did not reproduce or a window
without a complete score (the output is still written).
"""
# ruff: noqa: E402

from __future__ import annotations

import argparse
from concurrent.futures import ProcessPoolExecutor, as_completed
from dataclasses import asdict, replace
from datetime import datetime, timezone
import hashlib
import importlib
import json
import multiprocessing
import os
from pathlib import Path
import platform
import re
import shlex
import sys
import time
from typing import Any, Callable

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

import numpy as np
import pandas as pd

from app.core import config
from app.infrastructure.connectivity import REMOTE_MARKET_ACCESS_ENV
from app.services.research.output_guard import is_protected_output
from app.services.research.strategy_tuning import load_research_history
from strategies.backtest import complete_distribution_skill
from strategies.loader import instantiate_strategy
from strategies.price_field.econometric import rough, score_driven
from strategies.price_field.econometric.crps_learning import COMBINER_DEFAULTS
from strategies.price_field.econometric.forecasts import PriceArrays
from strategies.price_field.econometric.har import HAR_DEFAULTS
from strategies.price_field.econometric.location import DRIFT_DEFAULTS
from strategies.price_field.econometric.measures import (
    MEDIAN_WINDOW,
    log_returns,
    open_anchored_variance,
    refit_schedule,
    rolling_median,
)
from strategies.price_field.econometric.strategy import (
    EconometricPriceFieldStrategy,
    json_safe,
    valid_forecast_rows,
)
from strategies.price_field.neural.scoring import NEURAL_SCORING_VERSION, score_neural_price_field

CODE_VERSION = "v1.0.0"
CLI_NAME = "econometric_price_field_research"
SCRIPT_PATH = "scripts/econometric_price_field_research.py"
DESCRIBE_SCHEMA = "econometric-price-field-protocol/v1"
PRIORS_SCHEMA = "econometric-price-field-priors/v1"
PANEL_SCHEMA = "econometric-price-field-panel/v1"

# Frozen research protocol.
PANEL_TICKERS = ("NVDA", "QQQ", "SMH", "SPY", "AAPL", "MSFT", "MU", "AVGO", "TSM", "ORCL",
                 "QCOM", "GOOGL", "JPM", "IBM", "VZ", "C")
STRATEGY_IDS = ("har-range-price-field", "score-driven-price-field",
                "rough-volatility-price-field", "crps-learning-price-field")
PRIOR_CUTOFF = "2016-10-01"          # priors read daily bars strictly before this date
SELECTION_START = "2016-10-01"
SELECTION_END = "2023-09-30"         # inclusive
KPI_START = "2023-10-01"             # through the last local session
KPI_TICKER = "NVDA"
OHLC = ("Open", "High", "Low", "Close")
HORIZONS = 20
REPORT_HORIZONS = (1, 5, 10, 20)
# The strategies refit on date-anchored business-day blocks; the research harness used the row grid.
REFIT_SCHEDULES = ("session-date-blocks", "row-index-grid")

# Rough Volatility priors (research priors2.py / priors_r2.py): per ticker the empirical
# variogram of the log-variance proxy over the last 2000 bars before the cutoff and the
# matured proxy-to-close ratio at the last pre-cutoff bar with no pseudo-pairs; the panel
# median variogram is fitted with the module's grid and the ratio is the panel median.
ROUGH_PRIOR_PROXIES = ("yz", "r2")
ROUGH_PRIOR_SETTINGS: dict[str, Any] = {"window": 2000, "lag_max": 250, "n_lags": 30, "K": 250,
                                        "refit": 20, "mu_window": None, "cal_window": 2000,
                                        "prior_pairs": 0.0, "cal_prior_pairs": 0.0}
ROUGH_PRIOR_DECIMALS = {"a": 3, "b": 3, "H": 3, "lam": 4, "rho": 3}

# Score-Driven priors (research prior_centers2.py with sdlib.gasx_sigma): unpenalized
# fits on the trailing 1000 returns at refits anchored at bar 60 every 20 bars over the
# last 2000 pre-cutoff bars (never before bar 300), every fifth refit kept per ticker;
# centers are panel medians and the stored SDs the population SDs (ddof 0) of those fits.
SCORE_DRIVEN_PRIOR_SPECS: dict[str, dict[str, Any]] = {
    "range": {"center": "RANGE_PRIOR_CENTER", "sd": "RANGE_PRIOR_SD", "use_range": True,
              "start_values": (-3.9, 0.98, 0.05, 0.02, 0.15, 0.05)},
    "close_only": {"center": "BETAT_PRIOR_CENTER", "sd": "BETAT_PRIOR_SD", "use_range": False,
                   "start_values": (-3.9, 0.98, 0.05, 0.02, 0.15, 0.0)},
}
SCORE_DRIVEN_PRIOR_SETTINGS: dict[str, Any] = {"window": 1000, "anchor": 60, "refit": 20, "span": 2000,
                                               "min_start": 300, "thin": 5, "iterations": 30,
                                               "range_floor_fraction": 0.05}
SCORE_DRIVEN_PRIOR_DECIMALS = 10
SCORE_DRIVEN_FIT_BATCH = 1024
REPRODUCTION_RULE = ("reproduced when |estimate - stored| <= 0.5 * 10**-decimals, i.e. the stored "
                     "constant is the estimate rounded to the stored precision")

CODE_MODULES = (
    "strategies.price_field.econometric",
    "strategies.price_field.econometric.crps_learning",
    "strategies.price_field.econometric.forecasts",
    "strategies.price_field.econometric.har",
    "strategies.price_field.econometric.location",
    "strategies.price_field.econometric.measures",
    "strategies.price_field.econometric.rough",
    "strategies.price_field.econometric.score_driven",
    "strategies.price_field.econometric.strategy",
    "strategies.algorithms.strategy_har_range_price_field",
    "strategies.algorithms.strategy_score_driven_price_field",
    "strategies.algorithms.strategy_rough_volatility_price_field",
    "strategies.algorithms.strategy_crps_learning_price_field",
    "strategies.price_field.neural.scoring",
    "strategies.price_field.scoring",
    "strategies.backtest",
    "app.services.research.strategy_tuning",
    "app.services.research.output_guard",
)
ENVIRONMENT_NAMES = ("WORTHWARD_MARKET_STORE_DIR", "WORTHWARD_SETTINGS_STORE_DIR", "WORTHWARD_COMPUTE_ROOT",
                     REMOTE_MARKET_ACCESS_ENV, "WORTHWARD_LONGBRIDGE_CLI_ACCESS")
CODE_VERSION_PATTERN = re.compile(rb"Code version:\s*(v\d+\.\d+\.\d+)")


# Provenance


def _file_record(path: Path) -> dict[str, Any]:
    content = path.read_bytes()
    match = CODE_VERSION_PATTERN.search(content)
    try:
        shown = str(path.resolve().relative_to(PROJECT_ROOT))
    except ValueError:
        shown = str(path)
    return {"path": shown, "code_version": match.group(1).decode() if match else None,
            "sha256": hashlib.sha256(content).hexdigest()}


def code_provenance() -> dict[str, Any]:
    """Code version and SHA-256 of every module behind the forecasts, the scorer and this CLI."""
    records = {name: _file_record(Path(importlib.import_module(name).__file__)) for name in CODE_MODULES}
    records["scripts.econometric_price_field_research"] = _file_record(Path(__file__))
    return records


def command_record(argv: list[str]) -> dict[str, Any]:
    """The reproducible command line and the store environment it ran under."""
    words = ["python3", *(["-B"] if sys.flags.dont_write_bytecode else []), SCRIPT_PATH, *argv]
    return {
        "command": shlex.join(words), "argv": list(argv), "cwd": os.getcwd(),
        "python": platform.python_version(), "numpy": np.__version__, "pandas": pd.__version__,
        "platform": platform.platform(), "market_store": str(config.MARKET_STORE_DIR),
        "environment": {name: os.environ.get(name) for name in ENVIRONMENT_NAMES},
    }


def protocol_manifest() -> dict[str, Any]:
    return {
        "panel_tickers": list(PANEL_TICKERS),
        "prior_cutoff": PRIOR_CUTOFF,
        "prior_rule": "priors read only daily bars strictly before the prior cutoff",
        "selection_window": {"start": SELECTION_START, "end": SELECTION_END},
        "kpi_window": {"start": KPI_START, "end": "last local session"},
        "kpi_ticker": KPI_TICKER,
        "selection_rule": ("The reported final ranking maximizes panel mean CRPS skill on the selection "
                           "window, subject to the recorded CRPS Learning neighbor-stability exception."),
        "selection_exception": {
            "strategy": "crps-learning-price-field", "parameter": "loc_alpha",
            "strict_argmax": 0.0, "selected": 0.1,
            "rule": ("The research report selected location fixed share 0.1 over the strict argmax 0 "
                     "using a pre-window one-step neighbor-stability check."),
        },
        "selection_evidence": {
            "status": "reported-historical-protocol",
            "kpi_is_pristine_holdout": False,
            "candidate_generation_independence": "unverified",
            "limitation": ("Exploratory rounds displayed NVDA KPI results while candidates were compared. "
                           "Reproducing final priors and scores does not prove historical selection independence."),
            "reproduced_by_this_cli": ["stored priors", "current default forecasts and panel scores"],
            "not_reproduced_by_this_cli": ["historical candidate grids", "historical selection decisions"],
        },
        "history": ("local daily store through the research loader (price close, no dividend adjustment); "
                    "rows with a missing date or a non-finite or non-positive open, high, low or close "
                    "are dropped, as in the research harness"),
        "scorer": {"function": "strategies.price_field.neural.scoring.score_neural_price_field",
                   "version": NEURAL_SCORING_VERSION,
                   "headline": "equal mean of the 20 horizon CRPS skills, complete pair coverage required"},
    }


def strategy_manifest(strategy_id: str) -> dict[str, Any]:
    """Registered class, frozen startup parameters and resolved model settings of one strategy."""
    strategy = instantiate_strategy(strategy_id)
    if not isinstance(strategy, EconometricPriceFieldStrategy):
        raise TypeError(f"{strategy_id} is not an econometric Price Field strategy.")
    params = strategy.get_startup_params()
    return {"name": strategy.strategy_name, "econometric_model": strategy.econometric_model,
            "class": f"{type(strategy).__module__}.{type(strategy).__qualname__}",
            "default_params": params, "settings": asdict(strategy.settings_from_params(params))}


def stored_prior_constants() -> dict[str, Any]:
    """The prior constants exactly as the modules store them (infinite SD: no prior)."""
    names = list(score_driven.PARAMETER_NAMES)

    def by_name(values: np.ndarray) -> dict[str, float]:
        return {name: float(value) for name, value in zip(names, values)}

    return {
        "rough_volatility": {
            "proxies": {proxy: {key: (np.asarray(value).tolist() if key == "rho" else float(value))
                                for key, value in spec.items()} for proxy, spec in rough.PRIORS.items()},
            "decimals": dict(ROUGH_PRIOR_DECIMALS),
            "grid_H": list(rough.GRID_H), "grid_lam": list(rough.GRID_LAM),
            "defaults": dict(rough.ROUGH_DEFAULTS),
        },
        "score_driven": {
            "parameters": names,
            "range": {"center": by_name(score_driven.RANGE_PRIOR_CENTER), "sd": by_name(score_driven.RANGE_PRIOR_SD),
                      "defaults": dict(score_driven.RANGE_DEFAULTS)},
            "close_only": {"center": by_name(score_driven.BETAT_PRIOR_CENTER),
                           "sd": by_name(score_driven.BETAT_PRIOR_SD), "defaults": dict(score_driven.BETAT_DEFAULTS)},
            "lower": by_name(score_driven.LOWER), "upper": by_name(score_driven.UPPER),
            "decimals": SCORE_DRIVEN_PRIOR_DECIMALS,
            "note": ("an SD of null is infinite (no prior); the penalty SD is prior_scale times the stored SD, "
                     "and the omega center only fills the array because start values overwrite it"),
        },
        "drift": dict(DRIFT_DEFAULTS),
    }


def procedures_manifest() -> dict[str, Any]:
    return {
        "reproduction_rule": REPRODUCTION_RULE,
        "rough_volatility_priors": {
            "proxies": list(ROUGH_PRIOR_PROXIES), **ROUGH_PRIOR_SETTINGS,
            "variogram": "per ticker over the last `window` bars before the cutoff; panel median per lag",
            "fit": "strategies.price_field.econometric.rough.fit_matern_variogram (grid H, lam; exact constrained a, b)",
            "rho": "panel median of rough_sigma's matured proxy-to-close ratio at the last pre-cutoff bar",
        },
        "score_driven_priors": {
            **SCORE_DRIVEN_PRIOR_SETTINGS,
            "specs": {name: {"constants": [spec["center"], spec["sd"]], "use_range": spec["use_range"],
                             "start_values": list(spec["start_values"])}
                      for name, spec in SCORE_DRIVEN_PRIOR_SPECS.items()},
            "range_proxy": ("Parkinson plus squared gap (measures.open_anchored_variance kind='park', first bar "
                            "missing) floored at 0.05 times the plain causal 252-bar median"),
            "fit": "score_driven._fit, unpenalized (zero prior weights), Levenberg-Marquardt",
            "summary": "panel median and population SD (ddof 0) of every fifth refit per ticker",
        },
        "panel": {
            "forecast": ("strategy.forecast_price_field with the startup parameters on the full local history; "
                         "PriceArrays carry session dates (date-anchored refit blocks, as the strategies refit) "
                         "unless --refit-schedule row-index-grid reproduces the research harness grid"),
            "masking": "strategy.valid_forecast_rows, as in compute_signals",
            "score_driven_first_origin": "the first scored origin; earlier fits are skipped, scored rows identical",
            "windows": "each window is scored on a frame truncated at its end, so every target lies inside",
        },
    }


def describe() -> dict[str, Any]:
    """The frozen protocol manifest; loads no prices."""
    return {
        "schema": DESCRIBE_SCHEMA, "cli_version": CODE_VERSION,
        "protocol": protocol_manifest(),
        "strategies": {strategy_id: strategy_manifest(strategy_id) for strategy_id in STRATEGY_IDS},
        "priors": stored_prior_constants(),
        "model_defaults": {"har_range": dict(HAR_DEFAULTS), "rough_volatility": dict(rough.ROUGH_DEFAULTS),
                           "score_driven_range": dict(score_driven.RANGE_DEFAULTS),
                           "score_driven_close_only": dict(score_driven.BETAT_DEFAULTS),
                           "crps_learning": dict(COMBINER_DEFAULTS), "drift": dict(DRIFT_DEFAULTS)},
        "procedures": procedures_manifest(),
        "code": code_provenance(),
    }


# Local history


def frame_sha256(frame: pd.DataFrame) -> str:
    """SHA-256 of the session dates (int64 ns) and float64 OHLC actually used."""
    digest = hashlib.sha256(frame["Date"].to_numpy(dtype="datetime64[ns]").astype(np.int64).tobytes())
    for column in OHLC:
        digest.update(frame[column].to_numpy(dtype=float).tobytes())
    return digest.hexdigest()


def prepare_history(frame: pd.DataFrame, ticker: str) -> tuple[pd.DataFrame, dict[str, int]]:
    """Chronological research-harness rows: finite, positive OHLC and one row per date."""
    missing = {"Date", *OHLC} - set(frame.columns)
    if missing:
        raise ValueError(f"Incomplete OHLC history for {ticker}: missing {', '.join(sorted(missing))}.")
    data = frame.loc[:, ["Date", *OHLC]].copy()
    dates = pd.to_datetime(data["Date"], errors="coerce")
    if getattr(dates.dt, "tz", None) is not None:
        dates = dates.dt.tz_localize(None)
    data["Date"] = dates.astype("datetime64[ns]")
    for column in OHLC:
        data[column] = pd.to_numeric(data[column], errors="coerce").astype(float)
    data = data.sort_values("Date", kind="mergesort")
    prices = data[list(OHLC)].to_numpy(dtype=float)
    valid = data["Date"].notna().to_numpy() & np.all(np.isfinite(prices) & (prices > 0), axis=1)
    data = data[valid]
    duplicated = data["Date"].duplicated(keep="last").to_numpy()
    data = data[~duplicated].reset_index(drop=True)
    return data, {"rows_dropped_invalid_ohlc": int((~valid).sum()), "rows_dropped_duplicate_dates": int(duplicated.sum())}


def load_ticker(ticker: str) -> tuple[pd.DataFrame, dict[str, Any]]:
    """Read one ticker's local daily history (read-only) with its source and data digests."""
    frame = load_research_history(ticker, "1d")
    source = frame.attrs.get("research_source")
    path = Path(source) if source else None
    data, dropped = prepare_history(frame, ticker)
    if data.empty:
        raise ValueError(f"No usable daily OHLC rows for {ticker}.")
    record = {
        "source": str(path) if path else None,
        "source_sha256": hashlib.sha256(path.read_bytes()).hexdigest() if path and path.is_file() else None,
        "rows_loaded": int(len(frame)), **dropped, "rows": int(len(data)),
        "first_date": str(data["Date"].iloc[0].date()), "last_date": str(data["Date"].iloc[-1].date()),
        "data_sha256": frame_sha256(data),
    }
    return data, record


def arrays(frame: pd.DataFrame) -> tuple[np.ndarray, ...]:
    return tuple(frame[column].to_numpy(dtype=float) for column in OHLC)


def window_bounds(dates: np.ndarray) -> dict[str, tuple[int, int]]:
    """Origin index ranges [start, end) of the selection and KPI windows."""
    values = np.asarray(dates, dtype="datetime64[ns]")
    after_selection = np.datetime64(SELECTION_END) + np.timedelta64(1, "D")
    selection = (int(np.searchsorted(values, np.datetime64(SELECTION_START))),
                 int(np.searchsorted(values, after_selection)))
    kpi = (int(np.searchsorted(values, np.datetime64(KPI_START))), len(values))
    return {"pre": selection, "kpi": kpi}


# Priors


def compare(estimate: float, stored: float, decimals: int) -> dict[str, Any]:
    """One re-estimated value against its stored constant at the stored rounding precision."""
    difference = abs(float(estimate) - float(stored))
    return {"estimate": float(estimate), "stored": float(stored), "abs_diff": difference,
            "rel_diff": difference / abs(float(stored)) if stored else None, "decimals": int(decimals),
            "reproduced": bool(difference <= 0.5 * 10.0 ** -decimals * (1.0 + 1e-6))}


def rough_prior_lags() -> np.ndarray:
    settings = ROUGH_PRIOR_SETTINGS
    return np.unique(np.round(np.geomspace(1, settings["lag_max"], settings["n_lags"])).astype(int))


def rough_priors(histories: dict[str, pd.DataFrame], proxy: str) -> dict[str, Any]:
    """Re-estimate one proxy's prior variogram and proxy-to-close ratios from pre-cutoff bars."""
    settings = ROUGH_PRIOR_SETTINGS
    lags = rough_prior_lags()
    variograms, ratios, tickers = [], [], {}
    for ticker, frame in histories.items():
        open_, high, low, close = arrays(frame)
        last = len(close) - 1
        log_variance = rough.log_variance_proxy(open_, high, low, close, proxy)
        squares, counts = rough._variogram(log_variance, np.array([last]), lags, settings["window"])
        variograms.append(squares[0] / counts[0])
        _, parts = rough.rough_sigma(open_, high, low, close, proxy=proxy, return_parts=True, **settings)
        ratios.append(parts["ratio"][last])
        # Rows whose refit had a lag without pairs read the stored prior variogram even with zero
        # pseudo-pairs; the matured pairs of the ratio at the last bar reach back this far.
        first_pair = max(0, last - HORIZONS - settings["cal_window"] + 1)
        origins = refit_schedule(len(close), settings["refit"])
        used = origins[(origins <= last) & (np.append(origins[1:], len(close)) > first_pair)]
        _, used_counts = rough._variogram(log_variance, used, lags, settings["window"])
        window_start = frame["Date"].iloc[max(0, last - settings["window"] + 1)]
        tickers[ticker] = {"variogram_window_start": str(window_start.date()),
                           "variogram_pairs_lag_max": int(counts[0][-1]),
                           "ratio_reads_stored_prior_variogram": bool(np.any(used_counts == 0))}
    median_variogram = np.median(np.array(variograms), 0)
    a, b, hurst, rate = (float(value[0]) for value in rough.fit_matern_variogram(median_variogram[None, :], lags))
    rho = np.median(np.array(ratios), 0)
    stored = rough.PRIORS[proxy]
    variogram = {key: compare(value, stored[key], ROUGH_PRIOR_DECIMALS[key])
                 for key, value in (("a", a), ("b", b), ("H", hurst), ("lam", rate))}
    rho_rows = [compare(value, stored_value, ROUGH_PRIOR_DECIMALS["rho"])
                for value, stored_value in zip(rho, np.asarray(stored["rho"], dtype=float))]
    return {
        "variogram": variogram, "rho": rho_rows,
        "reproduced": all(item["reproduced"] for item in (*variogram.values(), *rho_rows)),
        "lags": lags.tolist(), "panel_median_variogram": median_variogram.tolist(),
        "tickers_reading_stored_prior_variogram": [ticker for ticker, item in tickers.items()
                                                   if item["ratio_reads_stored_prior_variogram"]],
        "tickers": tickers,
    }


def research_range_proxy(open_: np.ndarray, high: np.ndarray, low: np.ndarray, close: np.ndarray) -> np.ndarray:
    """The research range proxy: Parkinson plus squared gap (first bar missing), floored at 0.05 times
    the plain causal 252-bar median of the proxy (zero proxies included, unlike the product floor)."""
    proxy = np.asarray(open_anchored_variance(open_, high, low, close, kind="park"), dtype=float).copy()
    if len(proxy):
        proxy[0] = np.nan
    proxy = np.where(np.isfinite(proxy), proxy, np.nan)
    floor = SCORE_DRIVEN_PRIOR_SETTINGS["range_floor_fraction"] * rolling_median(proxy, MEDIAN_WINDOW)
    return np.where(np.isfinite(proxy), np.maximum(proxy, floor), np.nan)


def product_range_proxy(open_: np.ndarray, high: np.ndarray, low: np.ndarray, close: np.ndarray) -> np.ndarray:
    """The product range proxy (positive-median floor, inverted ranges rejected)."""
    return score_driven.score_driven_range_variance(open_, high, low, close)


def score_driven_prior_fits(histories: dict[str, pd.DataFrame], spec: dict[str, Any],
                            proxy_function: Callable[..., np.ndarray]) -> tuple[np.ndarray, dict[str, Any]]:
    """Unpenalized fits at the research refits; returns the thinned parameters and per-ticker refits."""
    settings = SCORE_DRIVEN_PRIOR_SETTINGS
    start_values = np.asarray(spec["start_values"], dtype=float)
    stacks, owners, tickers = [], [], {}
    for ticker, frame in histories.items():
        open_, high, low, close = arrays(frame)
        count = len(close)
        returns = log_returns(close)
        with np.errstate(divide="ignore", invalid="ignore"):
            driver = 0.5 * np.log(proxy_function(open_, high, low, close)) if spec["use_range"] else np.zeros(count)
        first = max(settings["min_start"], count - settings["span"])
        origins = np.arange(settings["anchor"], count, settings["refit"])
        origins = origins[origins + settings["refit"] - 1 >= first]
        tickers[ticker] = {"refits": int(len(origins)),
                           "kept": int(len(origins[::settings["thin"]])),
                           "first_refit": str(frame["Date"].iloc[origins[0]].date()) if len(origins) else None,
                           "last_refit": str(frame["Date"].iloc[origins[-1]].date()) if len(origins) else None}
        if not len(origins):
            continue
        with np.errstate(over="ignore", invalid="ignore", divide="ignore"):
            R, WX, ACT, LIK = score_driven._stack(returns, driver, origins, settings["window"])
            pairs = np.maximum(LIK.sum(1), 1.0)
            rms = np.sqrt(np.maximum((R * R * LIK).sum(1) / pairs, 1e-12))
            shift = (WX * LIK).sum(1) / pairs - np.log(rms) if spec["use_range"] else np.zeros(len(origins))
            WX = (WX - shift[:, None]) * ACT
            start = np.tile(start_values, (len(origins), 1))
            start[:, 0] = np.log(rms) - 0.5 * np.log(1.0 / (1.0 - 2.0 * start[:, 4]))
        stacks.append((R, WX, ACT, LIK, start))
        owners.append(len(origins))
    if not stacks:
        raise ValueError("No ticker has enough pre-cutoff history for a Score-Driven prior fit.")
    R, WX, ACT, LIK, start = (np.concatenate([stack[index] for stack in stacks]) for index in range(5))
    free = np.ones(6, bool) if spec["use_range"] else np.array([1, 1, 1, 1, 1, 0], bool)
    batches = []
    with np.errstate(over="ignore", invalid="ignore", divide="ignore"):
        for first in range(0, len(R), SCORE_DRIVEN_FIT_BATCH):
            rows = slice(first, first + SCORE_DRIVEN_FIT_BATCH)
            # Fits are independent, so bounded batches give the same values as one batch.
            batches.append(score_driven._fit(R[rows], WX[rows], ACT[rows], LIK[rows], start[rows], np.zeros(6),
                                             start_values, free, settings["iterations"]))
    theta = np.concatenate(batches)
    kept = np.concatenate([part[::settings["thin"]] for part in np.split(theta, np.cumsum(owners)[:-1])])
    return kept, tickers


def score_driven_summary(kept: np.ndarray, spec: dict[str, Any]) -> dict[str, Any]:
    """Compare the panel medians and population SDs with the stored centers and SDs."""
    center = getattr(score_driven, spec["center"])
    spread = getattr(score_driven, spec["sd"])
    medians, deviations = np.median(kept, 0), kept.std(0)
    parameters: dict[str, Any] = {}
    for index, name in enumerate(score_driven.PARAMETER_NAMES):
        if index == 0:
            parameters[name] = {"prior": False, "estimate_median": float(medians[0]),
                                "estimate_sd": float(deviations[0]), "stored_center": float(center[0]),
                                "stored_sd": None, "note": "no prior on omega; the stored center is unused"}
        elif not np.isfinite(spread[index]):
            parameters[name] = {"prior": False, "fixed": True, "stored_center": float(center[index]),
                                "estimate_median": float(medians[index]), "estimate_sd": float(deviations[index])}
        else:
            parameters[name] = {"prior": True,
                                "center": compare(medians[index], center[index], SCORE_DRIVEN_PRIOR_DECIMALS),
                                "sd": compare(deviations[index], spread[index], SCORE_DRIVEN_PRIOR_DECIMALS)}
    compared = [item[key] for item in parameters.values() if item["prior"] for key in ("center", "sd")]
    return {"constants": [spec["center"], spec["sd"]], "kept_fits": int(len(kept)), "parameters": parameters,
            "reproduced": all(item["reproduced"] for item in compared)}


def score_driven_priors(histories: dict[str, pd.DataFrame], name: str, spec: dict[str, Any],
                        progress: Callable[[str], None]) -> dict[str, Any]:
    kept, tickers = score_driven_prior_fits(histories, spec, research_range_proxy)
    result = {"use_range": spec["use_range"], "start_values": list(spec["start_values"]),
              **score_driven_summary(kept, spec), "tickers": tickers}
    if spec["use_range"]:
        progress(f"Score-Driven {name} prior sensitivity to the product range proxy")
        product, _ = score_driven_prior_fits(histories, spec, product_range_proxy)
        product_summary = score_driven_summary(product, spec)
        result["product_proxy_sensitivity"] = {
            "proxy": "score_driven.score_driven_range_variance (positive-median floor, inverted ranges rejected)",
            "max_abs_center_difference": float(np.max(np.abs(np.median(product, 0) - np.median(kept, 0))[1:])),
            "max_abs_sd_difference": float(np.max(np.abs(product.std(0) - kept.std(0))[1:])),
            "stored_constants_reproduced": product_summary["reproduced"],
            "not_reproduced": [f"{parameter}.{key}" for parameter, item in product_summary["parameters"].items()
                               if item["prior"] for key in ("center", "sd") if not item[key]["reproduced"]],
        }
    return result


def failed_quantities(rough_section: dict[str, Any], driven_section: dict[str, Any]) -> list[str]:
    failures = []
    for proxy, result in rough_section["proxies"].items():
        failures += [f"rough_volatility.{proxy}.{key}" for key, item in result["variogram"].items()
                     if not item["reproduced"]]
        failures += [f"rough_volatility.{proxy}.rho.h{index + 1}" for index, item in enumerate(result["rho"])
                     if not item["reproduced"]]
    for name, result in driven_section["specs"].items():
        failures += [f"score_driven.{name}.{parameter}.{key}" for parameter, item in result["parameters"].items()
                     if item["prior"] for key in ("center", "sd") if not item[key]["reproduced"]]
    return failures


def run_priors(histories: dict[str, pd.DataFrame], inputs: dict[str, Any],
               progress: Callable[[str], None]) -> dict[str, Any]:
    cutoff = np.datetime64(PRIOR_CUTOFF)
    truncated = {}
    for ticker, frame in histories.items():
        before = frame[frame["Date"].to_numpy(dtype="datetime64[ns]") < cutoff].reset_index(drop=True)
        if len(before) <= ROUGH_PRIOR_SETTINGS["lag_max"]:
            raise ValueError(f"{ticker} has {len(before)} daily bars before {PRIOR_CUTOFF}; the prior "
                             f"procedure needs more than {ROUGH_PRIOR_SETTINGS['lag_max']}.")
        truncated[ticker] = before
        inputs[ticker].update({"rows_before_cutoff": int(len(before)),
                               "last_date_before_cutoff": str(before["Date"].iloc[-1].date()),
                               "pre_cutoff_data_sha256": frame_sha256(before)})
    rough_section: dict[str, Any] = {"settings": dict(ROUGH_PRIOR_SETTINGS), "proxies": {}}
    for proxy in ROUGH_PRIOR_PROXIES:
        progress(f"Rough Volatility {proxy} priors from {len(truncated)} tickers")
        rough_section["proxies"][proxy] = rough_priors(truncated, proxy)
    driven_section: dict[str, Any] = {"settings": dict(SCORE_DRIVEN_PRIOR_SETTINGS), "specs": {}}
    for name, spec in SCORE_DRIVEN_PRIOR_SPECS.items():
        progress(f"Score-Driven {name} priors from {len(truncated)} tickers")
        driven_section["specs"][name] = score_driven_priors(truncated, name, spec, progress)
    failures = failed_quantities(rough_section, driven_section)
    total = (sum(len(result["variogram"]) + len(result["rho"]) for result in rough_section["proxies"].values())
             + sum(2 * sum(item["prior"] for item in result["parameters"].values())
                   for result in driven_section["specs"].values()))
    return {
        "schema": PRIORS_SCHEMA, "mode": "priors", "cli_version": CODE_VERSION,
        "status": "reproduced" if not failures else "not_reproduced",
        "protocol": {**protocol_manifest(), "panel_is_protocol_panel": tuple(histories) == PANEL_TICKERS},
        "reproduction_rule": REPRODUCTION_RULE,
        "summary": {"quantities": total, "reproduced": total - len(failures), "not_reproduced": failures},
        "inputs": inputs, "rough_volatility": rough_section, "score_driven": driven_section,
        "procedures": procedures_manifest(),
    }


# Panel


def window_score(dates: np.ndarray, close: np.ndarray, means: np.ndarray, stds: np.ndarray,
                 start: int, end: int) -> dict[str, Any]:
    """Official score of origins [start, end) on a frame truncated at ``end``."""
    columns: dict[str, Any] = {"Date": dates[:end], "Close": close[:end]}
    for horizon in range(1, HORIZONS + 1):
        columns[f"pf_mean_h{horizon:02d}"] = means[:end, horizon - 1]
        columns[f"pf_std_h{horizon:02d}"] = stds[:end, horizon - 1]
    diagnostics = score_neural_price_field(pd.DataFrame(columns), start, end)
    skill = complete_distribution_skill(diagnostics)

    def percent(value: Any) -> float | None:
        return None if value is None else 100.0 * float(value)

    return {
        "crps_skill_pct": percent(skill),
        "complete": skill is not None,
        "eligible_pairs": int(diagnostics["eligible_pairs"]), "valid_pairs": int(diagnostics["valid_pairs"]),
        "horizon_crps_skill_pct": {str(horizon): percent(diagnostics["horizons"][str(horizon)]["crps_skill_score"])
                                   for horizon in REPORT_HORIZONS},
        "central_interval_coverage_pct": {level: item.get("coverage_pct")
                                          for level, item in diagnostics["central_intervals"].items()},
    }


def evaluate_ticker(job: dict[str, Any]) -> dict[str, Any]:
    """Forecast and score one ticker for every requested strategy (a worker process when parallel)."""
    started = time.perf_counter()
    dates = job["dates"]
    anchored = job["refit_schedule"] == "session-date-blocks"
    prices = PriceArrays(job["open"], job["high"], job["low"], job["close"], dates=dates if anchored else None)
    windows = job["windows"]
    scored = [start for start, end in windows.values() if end > start]
    first_origin = min(scored) if scored else 0
    results = {}
    for strategy_id in job["strategies"]:
        clock = time.perf_counter()
        strategy = instantiate_strategy(strategy_id)
        settings = replace(strategy.settings_from_params(strategy.get_startup_params()), first_origin=first_origin)
        forecast = strategy.forecast_price_field(prices, settings)
        means = np.array(forecast.means, dtype=float, copy=True)
        stds = np.array(forecast.stds, dtype=float, copy=True)
        valid = valid_forecast_rows(means, stds)
        means[~valid] = np.nan
        stds[~valid] = np.nan
        first_valid = int(np.argmax(valid)) if valid.any() else None
        results[strategy_id] = {
            "refit_schedule": forecast.diagnostics.get("refit_schedule"),
            "first_forecast_date": str(pd.Timestamp(dates[first_valid]).date()) if first_valid is not None else None,
            "windows": {name: window_score(dates, job["close"], means, stds, start, end)
                        for name, (start, end) in windows.items()},
            "seconds": round(time.perf_counter() - clock, 3),
        }
    return {"ticker": job["ticker"], "results": results, "seconds": round(time.perf_counter() - started, 3)}


def panel_job(ticker: str, frame: pd.DataFrame, strategies: tuple[str, ...], refit_schedule: str) -> dict[str, Any]:
    open_, high, low, close = arrays(frame)
    dates = frame["Date"].to_numpy(dtype="datetime64[ns]")
    return {"ticker": ticker, "dates": dates, "open": open_, "high": high, "low": low, "close": close,
            "windows": window_bounds(dates), "strategies": strategies, "refit_schedule": refit_schedule}


def window_record(dates: np.ndarray, start: int, end: int) -> dict[str, Any]:
    def day(index: int) -> str:
        return str(pd.Timestamp(dates[index]).date())

    return {"start_index": start, "end_index": end, "origins": max(0, end - start),
            "first_origin": day(start) if end > start else None,
            "last_session": day(end - 1) if end > start else None}


def evaluate_panel(jobs: list[dict[str, Any]], workers: int,
                   progress: Callable[[str], None]) -> dict[str, dict[str, Any]]:
    finished: dict[str, dict[str, Any]] = {}

    def report(result: dict[str, Any]) -> None:
        finished[result["ticker"]] = result
        progress(f"{result['ticker']} scored in {result['seconds']:.1f} s ({len(finished)}/{len(jobs)})")

    if workers <= 1 or len(jobs) <= 1:
        for job in jobs:
            report(evaluate_ticker(job))
        return finished
    context = multiprocessing.get_context("spawn")
    with ProcessPoolExecutor(max_workers=workers, mp_context=context) as pool:
        futures = [pool.submit(evaluate_ticker, job) for job in jobs]
        for future in as_completed(futures):
            report(future.result())
    return finished


def panel_summary(tickers: list[str], strategies: tuple[str, ...], results: dict[str, Any]) -> dict[str, Any]:
    summary = {}
    for strategy_id in strategies:
        entry: dict[str, Any] = {}
        for window in ("pre", "kpi"):
            values = [results[ticker]["results"][strategy_id]["windows"][window]["crps_skill_pct"]
                      for ticker in tickers]
            present = [value for value in values if value is not None]
            entry[window] = {"mean_pct": float(np.mean(present)) if present and len(present) == len(values) else None,
                             "median_pct": float(np.median(present)) if present else None,
                             "complete_tickers": len(present), "tickers": len(values)}
        if KPI_TICKER in tickers:
            windows = results[KPI_TICKER]["results"][strategy_id]["windows"]
            entry["kpi_ticker"] = {"ticker": KPI_TICKER, "pre_pct": windows["pre"]["crps_skill_pct"],
                                   "kpi_pct": windows["kpi"]["crps_skill_pct"]}
        summary[strategy_id] = entry
    return summary


def run_panel(histories: dict[str, pd.DataFrame], inputs: dict[str, Any], strategies: tuple[str, ...],
              workers: int, refit_schedule: str, progress: Callable[[str], None]) -> dict[str, Any]:
    jobs = [panel_job(ticker, frame, strategies, refit_schedule) for ticker, frame in histories.items()]
    progress(f"Scoring {len(strategies)} strategies on {len(jobs)} tickers with {workers} worker(s)")
    results = evaluate_panel(jobs, workers, progress)
    tickers = list(histories)
    for job in jobs:
        ticker = job["ticker"]
        inputs[ticker]["windows"] = {name: window_record(job["dates"], start, end)
                                     for name, (start, end) in job["windows"].items()}
        inputs[ticker]["results"] = results[ticker]["results"]
        inputs[ticker]["seconds"] = results[ticker]["seconds"]
    complete = all(item["complete"] for ticker in tickers for strategy_id in strategies
                   for item in results[ticker]["results"][strategy_id]["windows"].values())
    return {
        "schema": PANEL_SCHEMA, "mode": "panel", "cli_version": CODE_VERSION,
        "status": "completed" if complete else "incomplete",
        "protocol": {**protocol_manifest(), "panel_is_protocol_panel": tuple(tickers) == PANEL_TICKERS},
        "strategies": {strategy_id: strategy_manifest(strategy_id) for strategy_id in strategies},
        "evaluation": {**procedures_manifest()["panel"], "refit_schedule": refit_schedule},
        "panel": panel_summary(tickers, strategies, results),
        "tickers": inputs,
    }


# Command line


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog=CLI_NAME,
        description=("Reproduce the econometric Price Field priors and panel scores offline; "
                     "production market stores are read-only."),
        epilog="Exit status: 0 reproduced or complete, 1 failure, 2 usage error, 3 not reproduced or incomplete.",
    )
    parser.add_argument("--version", action="version", version=f"{CLI_NAME} {CODE_VERSION}")
    parser.add_argument("mode", nargs="?", choices=("priors", "panel"),
                        help="priors: re-estimate the stored priors; panel: score the frozen forecasts.")
    parser.add_argument("--describe", action="store_true",
                        help="Print the frozen protocol, defaults and stored priors without loading prices.")
    parser.add_argument("--ticker", action="append", default=[],
                        help="Repeat to choose tickers (default: the frozen 16-ticker panel).")
    parser.add_argument("--strategy", action="append", default=[], choices=STRATEGY_IDS,
                        help="Panel only; repeat to choose strategies (default: all four).")
    parser.add_argument("--refit-schedule", choices=REFIT_SCHEDULES,
                        help=("Panel only: session-date-blocks (default, as the strategies refit) or "
                              "row-index-grid (the research harness grid)."))
    parser.add_argument("--workers", type=int,
                        help="Panel only: worker processes (default: one per ticker, at most 8).")
    parser.add_argument("--output", help="New output directory, never an existing directory or production store.")
    return parser


def _tickers(values: list[str]) -> tuple[str, ...]:
    tickers = tuple(value.strip().upper() for value in values) if values else PANEL_TICKERS
    if not all(tickers):
        raise ValueError("Tickers must be nonempty.")
    if len(set(tickers)) != len(tickers):
        raise ValueError("Tickers must be unique.")
    return tickers


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    parser = _parser()
    args = parser.parse_args(argv)
    # Offline only: set before any provider access; loaders read this at call time.
    os.environ[REMOTE_MARKET_ACCESS_ENV] = "disabled"
    if args.describe:
        if args.mode or args.ticker or args.strategy or args.output or args.workers is not None or args.refit_schedule:
            parser.error("--describe takes no mode or run options.")
        try:
            print(json.dumps(json_safe(describe()), indent=2, allow_nan=False))
            return 0
        except (ValueError, TypeError, RuntimeError, OSError) as exc:
            print(f"{CLI_NAME} failed: {exc}", file=sys.stderr)
            return 1
    if not args.mode:
        parser.error("Choose --describe or a mode: priors or panel.")
    if not args.output:
        parser.error("A new --output directory is required.")
    if args.mode == "priors" and (args.strategy or args.workers is not None or args.refit_schedule):
        parser.error("--strategy, --workers and --refit-schedule apply to panel mode only.")
    output = Path(args.output).expanduser().resolve()
    # Redirected store variables never unprotect the repository's own stores.
    if is_protected_output(output):
        parser.error("Research output cannot be inside production market or settings stores.")
    started, clock = datetime.now(timezone.utc), time.perf_counter()

    def progress(message: str) -> None:
        print(f"[{args.mode}] {message}", file=sys.stderr, flush=True)

    try:
        if output.exists():
            raise ValueError("The output directory must be new.")
        tickers = _tickers(args.ticker)
        strategies = tuple(dict.fromkeys(args.strategy)) if args.strategy else STRATEGY_IDS
        workers = min(len(tickers), os.cpu_count() or 1, 8) if args.workers is None else args.workers
        if workers < 1:
            raise ValueError("Workers must be at least 1.")
        histories, inputs = {}, {}
        for ticker in tickers:
            histories[ticker], inputs[ticker] = load_ticker(ticker)
            progress(f"Loaded {ticker}: {inputs[ticker]['rows']} daily rows "
                     f"{inputs[ticker]['first_date']} to {inputs[ticker]['last_date']}")
        output.mkdir(parents=True, exist_ok=False)
        if args.mode == "priors":
            payload, name = run_priors(histories, inputs, progress), "priors.json"
            succeeded = payload["status"] == "reproduced"
        else:
            schedule = args.refit_schedule or REFIT_SCHEDULES[0]
            payload, name = run_panel(histories, inputs, strategies, workers, schedule, progress), "manifest.json"
            succeeded = payload["status"] == "completed"
        payload["code"] = code_provenance()
        payload["run"] = {"started_at": started.isoformat(), "finished_at": datetime.now(timezone.utc).isoformat(),
                          "runtime_seconds": round(time.perf_counter() - clock, 3),
                          **({"workers": workers} if args.mode == "panel" else {}), **command_record(argv)}
        with (output / name).open("x", encoding="utf-8") as handle:
            json.dump(json_safe(payload), handle, indent=2, allow_nan=False)
            handle.write("\n")
        progress(f"{payload['status']} in {payload['run']['runtime_seconds']:.1f} s")
        print(str(output / name))
        return 0 if succeeded else 3
    except (ValueError, TypeError, RuntimeError, OSError, ArithmeticError, KeyError) as exc:
        print(f"{CLI_NAME} failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
