"""ResearchSession Backtest CRPS skill boundaries. Code version: v1.0.0."""

from __future__ import annotations

from copy import deepcopy
import math

import pandas as pd
import pytest

from app.services.research import strategy_tuning
from app.services.research.strategy_tuning import (
    BACKTEST_HISTORY_BASIS,
    SESSION_HISTORY_BASIS,
    ResearchRequest,
    ResearchSession,
)
from strategies.loader import instantiate_strategy
from strategies.price_field.pipeline import bundle_to_price_field_ohlcv
from tests.factories.market import (
    oscillating_ohlc_frame_for_dates,
    price_field_bundle_for_frame,
)


DATES = pd.bdate_range("2024-01-02", periods=300)
STRATEGY = "bayesian-price-field"
# Real Bayesian inference at its smallest window with every factor disabled.
PARAMS = {
    **{
        definition.key: False
        for definition in instantiate_strategy(STRATEGY).get_parameter_definitions()
        if definition.group == "factors" and definition.kind == "boolean"
    },
    "training_window": 30,
    "chip_window": 5,
}


def _session(monkeypatch, *, first=140, objective="crps_skill", loads=None):
    bundle = price_field_bundle_for_frame(
        "NVDA",
        oscillating_ohlc_frame_for_dates("NVDA", DATES.strftime("%Y-%m-%d").tolist()),
    )

    def load_provider(self, _tickers, *, interval, start, end, params):
        if loads is not None:
            loads.append((self, start, end, params))
        self._warmup_bundle = deepcopy(bundle)
        return [bundle_to_price_field_ohlcv(self._warmup_bundle)]

    monkeypatch.setattr(
        type(instantiate_strategy(STRATEGY)), "load_market_datasets", load_provider
    )
    return ResearchSession(ResearchRequest(
        STRATEGY,
        ("NVDA",),
        str(DATES[first].date()),
        str(DATES[-1].date()),
        params=PARAMS,
        objective=objective,
    ))


@pytest.mark.parametrize(
    ("strategy_id", "interval", "message"),
    [
        ("macd", "1d", "probability-grid"),
        ("buy-and-hold", "1d", "probability-grid"),
        (STRATEGY, "1m", "daily model and execution"),
    ],
)
def test_crps_objective_rejects_unsupported_requests_before_provider_access(
    strategy_id, interval, message, monkeypatch
):
    strategy = instantiate_strategy(strategy_id)

    def unexpected(*_args, **_kwargs):
        pytest.fail("An unsupported CRPS request must fail before provider access.")

    monkeypatch.setattr(type(strategy), "load_market_datasets", unexpected)
    with pytest.raises(ValueError, match=message):
        ResearchSession(
            ResearchRequest(
                strategy_id, ("NVDA",), "2025-01-02", "2026-01-02",
                interval=interval, objective="crps_skill",
            ),
            history_loader=unexpected,
        )


def test_crps_objective_requires_21_sessions_in_every_scored_window(monkeypatch):
    # 100 requested sessions yield scored windows of 15, 15, and 20 sessions.
    with pytest.raises(ValueError, match="at least 21 trading sessions.*15, 15, and 20"):
        _session(monkeypatch, first=200)


def test_crps_objective_accepts_exactly_21_sessions_and_rejects_20(monkeypatch):
    # 139 requested sessions yield scored windows of 21, 21, and 28 sessions.
    session = _session(monkeypatch, first=len(DATES) - 139)
    windows = [*session.validation_windows, session.holdout_window]
    assert [
        session.dates.index(last) - session.dates.index(first) + 1
        for first, last in windows
    ] == [21, 21, 28]
    result = session.validate(session.strategy.normalize_params(PARAMS))
    assert math.isfinite(result["score"])
    # One complete (origin, horizon) pair per horizon h has 21 - h origins.
    assert [fold["valid_pairs"] for fold in result["validation"]] == [210, 210]
    # One session fewer shrinks the first validation window to 20 sessions.
    with pytest.raises(ValueError, match="at least 21 trading sessions.*20, 21, and 28"):
        _session(monkeypatch, first=len(DATES) - 138)


def test_crps_window_sees_only_fold_rows_and_a_bundle_clipped_at_the_fold(
    monkeypatch,
):
    session = _session(monkeypatch)
    original = session.strategy._warmup_bundle
    compute = session.strategy.compute_signals
    seen = []

    def inspect(data, params):
        bundle = session.strategy._warmup_bundle
        assert bundle is not original
        seen.append((
            data["Date"].min(),
            data["Date"].max(),
            max(pd.Timestamp(row["observed_at"]) for row in bundle["ohlcv"]),
            bundle["end"],
        ))
        return compute(data, params)

    session.strategy.compute_signals = inspect
    windows = [
        *session.validation_windows,
        session.holdout_window,
        (session.dates[0], session.dates[-1]),
    ]
    params = session.strategy.normalize_params(PARAMS)
    metrics = [session.evaluate_window(params, window) for window in windows]

    assert seen == [
        (first, last, last, pd.Timestamp(last).isoformat()) for first, last in windows
    ]
    assert session.strategy._warmup_bundle is original
    assert len(original["ohlcv"]) == len(DATES)
    for fold in metrics:
        assert fold["score"] == fold["crps_skill_pct"]
        assert math.isfinite(fold["score"])
        # Session windows share frozen inputs and claim no Backtest parity.
        assert fold["history_basis"] == SESSION_HISTORY_BASIS
        assert "backtest_headline_pct" not in fold
        assert fold["valid_pairs"] == fold["eligible_pairs"] > 0
        assert fold["coverage_pct"] == 100.0


def test_full_window_reloads_the_chosen_params_and_keeps_the_session(monkeypatch):
    loads = []
    session = _session(monkeypatch, loads=loads)
    strategy, bundle = session.strategy, session.strategy._warmup_bundle
    chosen = session.strategy.normalize_params({**PARAMS, "training_window": 40})

    full_window = session.evaluate_full_window(chosen)

    # A separate strategy instance reloads the requested range with the chosen
    # params, exactly as an exact-range Backtest loads them.
    assert len(loads) == 2
    reload_strategy, start, end, params = loads[-1]
    assert reload_strategy is not strategy
    assert (start, end) == (DATES[140], DATES[-1])
    assert params == chosen
    assert session.strategy is strategy
    assert session.strategy._warmup_bundle is bundle
    assert (full_window["from"], full_window["to"]) == (
        str(DATES[140].date()), str(DATES[-1].date())
    )
    assert full_window["history_basis"] == BACKTEST_HISTORY_BASIS
    assert full_window["backtest_headline_pct"] == round(
        full_window["crps_skill_pct"], 2
    )
    assert full_window["data_fingerprint"]
    assert full_window["sources"] == session.provenance

    returns = _session(monkeypatch, objective="risk_adjusted_return")
    with pytest.raises(ValueError, match="Only the CRPS skill objective"):
        returns.evaluate_full_window(chosen)


def test_incomplete_distribution_evidence_fails_closed_and_restores_the_bundle(
    monkeypatch,
):
    session = _session(monkeypatch)
    original = session.strategy._warmup_bundle
    params = session.strategy.normalize_params(PARAMS)
    monkeypatch.setattr(
        strategy_tuning, "complete_distribution_skill", lambda _diagnostics: None
    )
    with pytest.raises(ValueError, match="complete 20-horizon CRPS skill"):
        session.validate(params)
    assert session.strategy._warmup_bundle is original

    def failing(_data, _params):
        raise RuntimeError("model failed")

    session.strategy.compute_signals = failing
    with pytest.raises(RuntimeError, match="model failed"):
        session.holdout(params)
    assert session.strategy._warmup_bundle is original


def test_return_objectives_keep_their_existing_window_contract(monkeypatch):
    session = _session(monkeypatch, objective="risk_adjusted_return")
    fold = session.evaluate_window(
        session.strategy.normalize_params(PARAMS), session.validation_windows[0]
    )
    assert set(fold) == {
        "from", "to", "net_return_pct", "max_drawdown_pct", "score", "model_evidence"
    }
    assert fold["score"] == pytest.approx(
        fold["net_return_pct"] - 0.5 * fold["max_drawdown_pct"], abs=1e-6
    )
