"""Read-only, in-memory buy-thesis committee for Beta. Code version: v1.0.0."""

from __future__ import annotations

from collections import Counter
from importlib import import_module
import math
from typing import Any

import numpy as np
import pandas as pd

from . import analysis
from .analysis import BetaDataError, display_date, percent
from .price_field_vote import extract_price_field_vote

DEFAULT_MODEL = "har-range-price-field"
MAX_HISTORY = 3_000
MODEL_CLASSES = {
    "har-range-price-field": "HarRangePriceFieldStrategy",
    "score-driven-price-field": "ScoreDrivenPriceFieldStrategy",
    "rough-volatility-price-field": "RoughVolatilityPriceFieldStrategy",
    "crps-learning-price-field": "CrpsLearningPriceFieldStrategy",
}
VOTE_KINDS = frozenset({"approve", "oppose", "neutral", "abstain"})
MEMBERS = frozenset({"trend", "momentum", "price-field"})


def _strategy(model: str):
    if model not in MODEL_CLASSES:
        raise BetaDataError("Choose one of the available local Price Field models.", 400)
    module = import_module(f"strategies.algorithms.strategy_{model.replace('-', '_')}")
    return getattr(module, MODEL_CLASSES[model])()


def model_options() -> list[dict[str, str]]:
    """Expose existing models that require neither neural training nor provider access."""
    return [{"id": model, "name": _strategy(model).strategy_name} for model in MODEL_CLASSES]


def load_history(ticker: str) -> tuple[str, pd.DataFrame]:
    return analysis.load_history(ticker, include_ohlcv=True, maximum=MAX_HISTORY)


def compute_price_field(frame: pd.DataFrame, model: str) -> dict[str, Any]:
    """Reuse the original model with its frozen profile and observed local warmup."""
    strategy = _strategy(model)
    required = {"Date", "Open", "High", "Low", "Close", "Volume"}
    if not required.issubset(frame):
        raise ValueError("The Price Field vote needs observed daily Open, High, Low, Close, and Volume.")
    dates = pd.to_datetime(frame["Date"], errors="coerce", utc=True)
    if (dates.isna().any() or not dates.is_monotonic_increasing
            or not dates.dt.normalize().is_unique):
        raise ValueError("Observed daily dates must be valid, unique, and in ascending order.")
    prices = frame[["Open", "High", "Low", "Close"]].to_numpy(dtype=float)
    volume = frame["Volume"].to_numpy(dtype=float)
    if (not np.isfinite(prices).all() or (prices <= 0).any()
            or not np.isfinite(volume).all() or (volume < 0).any()):
        raise ValueError("The Price Field vote needs finite positive OHLC prices and nonnegative volume.")
    if ((frame["High"] < frame[["Open", "Close", "Low"]].max(axis=1)).any()
            or (frame["Low"] > frame[["Open", "Close", "High"]].min(axis=1)).any()):
        raise ValueError("The observed daily high and low must contain the open and close.")
    params = strategy.get_startup_params()
    # Use precisely the model's warmup request rather than a different load start.
    full = frame.tail(strategy.warmup_bars(params) + 1).copy()
    full["Date"] = dates.iloc[-len(full):].dt.tz_localize(None).to_numpy()
    strategy._warmup_bundle = {
        "ohlcv": [
            {"observed_at": row.Date, "open": row.Open, "high": row.High,
             "low": row.Low, "close": row.Close, "volume": row.Volume}
            for row in full.itertuples(index=False)
        ],
        "source_commands": [],
    }
    result = strategy.compute_signals(full.tail(1).copy(), params)
    return result.presentation


def summarize_votes(votes: list[dict[str, Any]]) -> dict[str, Any]:
    """Count each named member once; missing evidence cannot establish a majority."""
    if len(votes) != len(MEMBERS) or {vote.get("member") for vote in votes} != MEMBERS:
        raise ValueError("The committee requires exactly one vote from each of its three members.")
    if any(vote.get("vote") not in VOTE_KINDS for vote in votes):
        raise ValueError("A committee member returned an unsupported vote.")
    counts = Counter(vote["vote"] for vote in votes)
    verdict = ("incomplete" if counts["abstain"] else
               "approve" if counts["approve"] >= 2 else
               "oppose" if counts["oppose"] >= 2 else "neutral")
    return {"verdict": verdict, **{kind: counts[kind] for kind in sorted(VOTE_KINDS)},
            "total": 3, "required_approvals": 2}


def _descriptive_vote(member: str, name: str, change: float, origin: str, reason: str) -> dict[str, Any]:
    vote = "approve" if change > 0 else "oppose" if change < 0 else "neutral"
    if not math.isfinite(change):
        vote = "abstain"
        reason = "The latest observation cannot be evaluated safely."
    return {"member": member, "name": name, "vote": vote, "reason": reason,
            "probability_up": None, "origin": origin, "horizon": None,
            "target_interval": "trailing-observed-close", "model_id": None,
            "model_version": None, "fingerprint": None}


def analyze(
        ticker: str, model: str = DEFAULT_MODEL, horizon: int = 1,
        threshold_pct: float = 60.0,
) -> dict[str, Any]:
    """Evaluate one explicit local snapshot without orders, downloads, or persistence."""
    strategy = _strategy(model)
    # Validate configuration before any source path is resolved.
    try:
        extract_price_field_vote({}, origin="2000-01-01", model_id=model,
                                 threshold_pct=threshold_pct, horizon=horizon)
    except ValueError as exc:
        raise BetaDataError(str(exc), 400) from exc
    ticker, frame = load_history(ticker)
    origin = pd.Timestamp(frame["Date"].iloc[-1]).isoformat()
    closes = frame["Close"]
    with np.errstate(over="raise", divide="raise", invalid="raise"):
        try:
            distance = float(closes.iloc[-1] / closes.tail(60).mean() - 1)
            momentum = float(closes.iloc[-1] / closes.iloc[-21] - 1)
        except (FloatingPointError, OverflowError) as exc:
            raise BetaDataError("The local price scale cannot be analyzed safely.") from exc
    votes = [
        _descriptive_vote("trend", "Trend", distance, origin,
                          f"Latest close is {percent(distance)} from its trailing 60-close mean."),
        _descriptive_vote("momentum", "Momentum", momentum, origin,
                          f"Observed 20-session close return is {percent(momentum)}."),
    ]
    try:
        presentation = compute_price_field(frame, model)
        field_vote = extract_price_field_vote(presentation, origin=origin, model_id=model,
                                             threshold_pct=threshold_pct, horizon=horizon)
    except (ValueError, RuntimeError, FloatingPointError, OverflowError, np.linalg.LinAlgError) as exc:
        field_vote = extract_price_field_vote({}, origin=origin, model_id=model,
                                             threshold_pct=threshold_pct, horizon=horizon)
        field_vote["reason"] = f"Price Field abstains: {exc}"
    votes.append(field_vote)
    return {
        "schema": "beta-buy-analysis/v1", "ticker": ticker,
        "as_of": display_date(frame["Date"].iloc[-1]), "origin": origin,
        "observations": len(frame),
        "source": f"Local daily cache ({frame.attrs.get('source_ticker', ticker)}); no refresh",
        "model": {"id": model, "name": strategy.strategy_name},
        "votes": votes, "summary": summarize_votes(votes),
        "notes": [
            "Trend and Momentum reuse Regime Radar's trailing-close comparisons. They describe observed history.",
            "Price Field has one seat regardless of the selected model. Its probability is model-implied, not the committee's probability of success.",
            f"Price Field approves at {threshold_pct:,.2f}% or above and opposes at {100 - threshold_pct:,.2f}% or below. Other probabilities are neutral.",
            "A complete committee needs all three votes. Two approvals support the buy thesis; two oppositions challenge it; otherwise the evidence is mixed. An abstention leaves the result incomplete.",
            "The available Price Fields reuse their frozen Backtest profiles and estimate future close returns from observed local OHLCV. No neural training job is started.",
            "The snapshot loads at most 3,000 observations and honors the selected model's warmup limit. Forecasts can depend on this bounded history, especially CRPS Learning.",
            "The date is the last cached observation, which can be stale. Forecasts exclude dividends, fees, and slippage; no trade is submitted.",
        ],
    }
