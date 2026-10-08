"""Beta committee probabilities, aggregation, and read-only boundaries. Code version: v1.0.0."""

from __future__ import annotations

import builtins
from copy import deepcopy
from itertools import product
import math
import os
from pathlib import Path
import socket
from statistics import NormalDist
import subprocess
import sys

from flask import Flask
from jinja2 import DictLoader
import pandas as pd
import pytest

from app.beta import register_beta
from app.beta import analysis, buy_analysis
from app.beta.price_field_vote import extract_price_field_vote
from app.infrastructure import storage
from tests.factories.market import clustered_ohlc_random_walk, close_frame_for_dates, ohlc_frame_for_dates


ORIGIN = "2026-07-14T00:00:00"
MODEL = "har-range-price-field"


@pytest.fixture
def direct_forecast():
    """Supply a minimal public presentation, without duplicating a market-data factory."""
    return {
        "schema": "har-range-price-field/v1",
        "renderer": "probability-grid-v1",
        "distribution_kind": "direct-normal-horizon",
        "target_interval": "signal-close-to-future-close",
        "max_horizon": 20,
        "data_keys": ["2026-07-13T00:00:00", ORIGIN],
        "predictive_mean": [0.0, 0.01],
        "predictive_scale": [0.02, 0.02],
        "probability_up": [0.5, 0.99],
        "return_autoregression": [0.0, 0.0],
        "return_long_run_mean": [0.0, 0.0],
        "return_innovation_scale": [0.02, 0.02],
        "horizon_predictive_mean": [[0.0] * 20, [0.01] * 20],
        "horizon_predictive_std": [[0.02] * 20, [0.02] * 20],
        "cell_display_threshold": 99.0,
        "fingerprint": "isolated-forecast",
        "model_version": "v1.0.0",
    }


def test_direct_horizon_vote_uses_complete_distribution_and_only_one_member(direct_forecast):
    direct_forecast["horizon_predictive_mean"][-1][4] = -0.04
    before = deepcopy(direct_forecast)
    one = extract_price_field_vote(direct_forecast, origin=ORIGIN, model_id=MODEL)
    five = extract_price_field_vote(direct_forecast, origin=ORIGIN, model_id=MODEL, horizon=5)
    assert one["member"] == five["member"] == "price-field"
    assert one["vote"] == "approve"
    assert five["vote"] == "oppose"
    assert one["probability_up"] == pytest.approx(NormalDist().cdf(0.5), abs=1e-14)
    assert five["probability_up"] == pytest.approx(NormalDist().cdf(-2), abs=1e-14)
    assert five["horizon"] == 5
    assert five["origin"] == ORIGIN
    assert five["target_interval"] == "signal-close-to-future-close"
    assert five["fingerprint"] == "isolated-forecast"
    assert direct_forecast == before


def test_display_grid_threshold_and_precomputed_one_step_probability_do_not_change_vote(direct_forecast):
    first = extract_price_field_vote(direct_forecast, origin=ORIGIN, model_id=MODEL)
    direct_forecast.update(cell_display_threshold=0, grid_values=[[0.0]], probability_up=[0.0, 0.0])
    second = extract_price_field_vote(direct_forecast, origin=ORIGIN, model_id=MODEL)
    assert second == first


@pytest.mark.parametrize("kind", ["dynamic-normal-log-return", "lstm-gaussian-log-return"])
def test_autoregressive_adapter_retains_executable_target_and_covariance(direct_forecast, kind):
    direct_forecast.update(
        distribution_kind=kind,
        target_interval="next-open-to-following-open",
        predictive_mean=[0.0, 0.03],
        predictive_scale=[0.02, 0.04],
        return_autoregression=[0.0, 0.5],
        return_long_run_mean=[0.0, 0.01],
        return_innovation_scale=[0.02, 0.02],
    )
    vote = extract_price_field_vote(direct_forecast, origin=ORIGIN, model_id="bayesian-price-field", horizon=2)
    # For two sessions, R1 + R2 = 1.5 R1 + 0.005 + independent innovation.
    expected_probability = NormalDist(0.05, math.sqrt(1.5 ** 2 * 0.04 ** 2 + 0.02 ** 2)).cdf(0)
    assert vote["probability_up"] == pytest.approx(1 - expected_probability, abs=1e-14)
    assert vote["target_interval"] == "next-open-to-following-open"
    assert vote["vote"] == "approve"


def test_voting_boundaries_are_inclusive_and_the_interval_is_neutral(direct_forecast):
    vote = extract_price_field_vote(direct_forecast, origin=ORIGIN, model_id=MODEL)
    probability = vote["probability_up"]
    boundary = probability * 100
    assert extract_price_field_vote(direct_forecast, origin=ORIGIN, model_id=MODEL, threshold_pct=boundary)["vote"] == "approve"
    assert extract_price_field_vote(direct_forecast, origin=ORIGIN, model_id=MODEL, threshold_pct=boundary + 0.01)["vote"] == "neutral"
    direct_forecast["horizon_predictive_mean"][-1][0] = -0.01
    opposition = extract_price_field_vote(direct_forecast, origin=ORIGIN, model_id=MODEL)
    lower_boundary = (1 - opposition["probability_up"]) * 100
    assert extract_price_field_vote(direct_forecast, origin=ORIGIN, model_id=MODEL, threshold_pct=lower_boundary)["vote"] == "oppose"
    assert extract_price_field_vote(direct_forecast, origin=ORIGIN, model_id=MODEL, threshold_pct=lower_boundary + 0.01)["vote"] == "neutral"
    direct_forecast["horizon_predictive_mean"][-1][0] = 0
    assert extract_price_field_vote(direct_forecast, origin=ORIGIN, model_id=MODEL)["vote"] == "neutral"


@pytest.mark.parametrize("defect", [
    "absent", "renderer", "kind", "target", "stale_origin", "future_origin",
    "duplicate_origin", "reverse_origins", "bad_origin", "unaligned_series",
    "incomplete_heads", "unaligned_heads", "max_horizon", "zero_scale",
    "negative_scale", "missing_latest", "nan_latest", "infinite_latest", "boolean_latest",
])
def test_invalid_or_missing_latest_forecast_abstains_without_scanning_older_rows(direct_forecast, defect):
    payload = direct_forecast
    if defect == "absent":
        payload = None
    elif defect in {"renderer", "kind", "target"}:
        payload[{"renderer": "renderer", "kind": "distribution_kind", "target": "target_interval"}[defect]] = "unsupported"
    elif defect == "stale_origin":
        payload["data_keys"][-1] = "2026-07-13T12:00:00"
    elif defect == "future_origin":
        payload["data_keys"][-1] = "2026-07-15T00:00:00"
    elif defect == "duplicate_origin":
        payload["data_keys"][0] = ORIGIN
    elif defect == "reverse_origins":
        payload["data_keys"] = list(reversed(payload["data_keys"]))
    elif defect == "bad_origin":
        payload["data_keys"][0] = "not a date"
    elif defect == "unaligned_series":
        payload["predictive_scale"] = [0.02]
    elif defect == "incomplete_heads":
        payload["horizon_predictive_std"][-1].pop()
    elif defect == "unaligned_heads":
        payload["horizon_predictive_mean"].pop()
    elif defect == "max_horizon":
        payload["max_horizon"] = 21
    elif defect in {"zero_scale", "negative_scale"}:
        payload["horizon_predictive_std"][-1][0] = 0 if defect == "zero_scale" else -0.01
    else:
        payload["horizon_predictive_mean"][-1][0] = {
            "missing_latest": None, "nan_latest": float("nan"),
            "infinite_latest": float("inf"), "boolean_latest": True,
        }[defect]
    vote = extract_price_field_vote(payload, origin=ORIGIN, model_id=MODEL)
    assert vote["vote"] == "abstain"
    assert vote["probability_up"] is None
    assert vote["reason"]


@pytest.mark.parametrize("threshold", [50, 0, -1, 100.01, float("nan"), float("inf"), True, "60"])
def test_adapter_rejects_invalid_probability_configuration(direct_forecast, threshold):
    with pytest.raises(ValueError):
        extract_price_field_vote(direct_forecast, origin=ORIGIN, model_id=MODEL, threshold_pct=threshold)


@pytest.mark.parametrize("horizon", [0, 21, -1, 1.5, True, "1"])
def test_adapter_rejects_invalid_horizon_configuration(direct_forecast, horizon):
    with pytest.raises(ValueError):
        extract_price_field_vote(direct_forecast, origin=ORIGIN, model_id=MODEL, horizon=horizon)


@pytest.mark.parametrize("states", list(product(("approve", "oppose", "neutral", "abstain"), repeat=3)))
def test_committee_requires_two_of_three_votes_and_never_redistributes_abstentions(states):
    votes = [
        {"member": member, "vote": state}
        for member, state in zip(("trend", "momentum", "price-field"), states, strict=True)
    ]
    summary = buy_analysis.summarize_votes(votes)
    counts = {state: states.count(state) for state in ("approve", "oppose", "neutral", "abstain")}
    expected = (
        "incomplete" if counts["abstain"] else
        "approve" if counts["approve"] >= 2 else
        "oppose" if counts["oppose"] >= 2 else "neutral"
    )
    assert summary == {"verdict": expected, **counts, "total": 3, "required_approvals": 2}


@pytest.fixture
def committee_app(monkeypatch):
    monkeypatch.setenv("WORTHWARD_BETA_ENABLED", "1")
    application = Flask(__name__)
    application.config.update(TESTING=True)
    application.jinja_loader = DictLoader({"beta.html": "{{ beta_experiment.id }}"})
    assert register_beta(application)
    return application


@pytest.fixture
def committee_store(tmp_path, monkeypatch):
    directory = tmp_path / "historical"
    directory.mkdir()
    monkeypatch.setattr(analysis, "HISTORICAL_STORE_DIR", directory)
    monkeypatch.setattr(storage, "HISTORICAL_STORE_DIR", directory)
    dates = pd.bdate_range(end="2026-07-14", periods=320).strftime("%Y-%m-%d").tolist()
    frame = ohlc_frame_for_dates("QQQ", dates)
    frame.to_parquet(directory / "QQQ.parquet", index=False)
    return directory, frame


def test_committee_endpoint_only_reads_local_data_and_returns_one_price_field_vote(
        committee_app, committee_store, direct_forecast, monkeypatch,
):
    directory, _frame = committee_store
    before = {path.name: path.read_bytes() for path in directory.iterdir()}
    calls = []

    def compute(frame, model):
        calls.append((len(frame), model))
        payload = deepcopy(direct_forecast)
        count = len(frame)
        payload["data_keys"] = [pd.Timestamp(date).isoformat() for date in frame["Date"]]
        for key in ("predictive_mean", "predictive_scale", "probability_up", "return_autoregression", "return_long_run_mean", "return_innovation_scale"):
            payload[key] = [payload[key][-1]] * count
        for key in ("horizon_predictive_mean", "horizon_predictive_std"):
            payload[key] = [list(payload[key][-1]) for _ in range(count)]
        return payload

    monkeypatch.setattr(buy_analysis, "compute_price_field", compute)
    original_open, original_path_open, original_os_open = builtins.open, Path.open, os.open

    def read_only_open(file, mode="r", *args, **kwargs):
        assert not any(flag in mode for flag in "wax+")
        return original_open(file, mode, *args, **kwargs)

    def read_only_path_open(path, mode="r", *args, **kwargs):
        assert not any(flag in mode for flag in "wax+")
        return original_path_open(path, mode, *args, **kwargs)

    def read_only_os_open(path, flags, *args, **kwargs):
        assert not flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC | os.O_APPEND)
        return original_os_open(path, flags, *args, **kwargs)

    def reject(*_args, **_kwargs):
        raise AssertionError("Buy Analysis attempted a network, training, or persistence action.")

    monkeypatch.setattr(builtins, "open", read_only_open)
    monkeypatch.setattr(Path, "open", read_only_path_open)
    monkeypatch.setattr(os, "open", read_only_os_open)
    monkeypatch.setattr(socket.socket, "connect", reject)
    monkeypatch.setattr(socket, "create_connection", reject)
    monkeypatch.setattr(storage, "ensure_market_store_dir", reject)
    monkeypatch.setattr(storage, "write_parquet_atomic", reject)
    monkeypatch.setattr(storage, "_migrate_store_filenames", reject)
    monkeypatch.setattr(pd.DataFrame, "to_parquet", reject)
    response = committee_app.test_client().get("/beta/api/buy-analysis?ticker=qqq.us")
    assert response.status_code == 200
    assert response.headers["Cache-Control"] == "no-store"
    payload = response.get_json()
    assert payload["schema"] == "beta-buy-analysis/v1"
    assert payload["ticker"] == "QQQ"
    assert payload["as_of"] == "14 Jul 2026"
    assert pd.Timestamp(payload["origin"]) == pd.Timestamp(ORIGIN, tz="UTC")
    assert payload["observations"] == 320
    assert payload["model"]["id"] == MODEL
    assert [vote["member"] for vote in payload["votes"]] == ["trend", "momentum", "price-field"]
    assert payload["votes"][-1]["horizon"] == 1
    assert payload["votes"][-1]["probability_up"] == pytest.approx(NormalDist().cdf(0.5), abs=1e-14)
    assert payload["summary"]["total"] == 3
    assert payload["summary"]["required_approvals"] == 2
    assert calls == [(320, MODEL)]
    assert {path.name: path.read_bytes() for path in directory.iterdir()} == before


@pytest.mark.parametrize("query", [
    "ticker=QQQ&ticker=AAPL", "ticker=QQQ&model=har-range-price-field&model=score-driven-price-field",
    "ticker=QQQ&horizon=1&horizon=2", "ticker=QQQ&threshold=60&threshold=70", "ticker=QQQ&refresh=1",
    "ticker=QQQ&model=unknown", "ticker=QQQ&model=lstm-price-field", "ticker=QQQ&horizon=0",
    "ticker=QQQ&horizon=21", "ticker=QQQ&horizon=1.5", "ticker=QQQ&horizon=nan",
    "ticker=QQQ&threshold=50", "ticker=QQQ&threshold=101", "ticker=QQQ&threshold=nan",
    "ticker=QQQ&threshold=inf", "ticker=QQQ&threshold=bad", "ticker=QQQ&model=",
])
def test_invalid_committee_query_is_rejected_before_local_data_access(committee_app, monkeypatch, query):
    def reject(*_args, **_kwargs):
        raise AssertionError("Invalid committee input must not read a market file.")

    monkeypatch.setattr(buy_analysis, "load_history", reject)
    response = committee_app.test_client().get(f"/beta/api/buy-analysis?{query}")
    assert response.status_code == 400
    assert set(response.get_json()) == {"error"}


@pytest.mark.parametrize("ticker", ["../QQQ", "QQQ/../../settings", "QQQ\\secret", "<script>", "A,B", "^GSPC", "a" * 100, ""])
def test_buy_analysis_ticker_allowlist_precedes_path_access(committee_app, monkeypatch, ticker):
    def reject(*_args, **_kwargs):
        raise AssertionError("Malformed ticker must not reach path resolution.")

    monkeypatch.setattr(analysis, "history_store_path_for", reject)
    response = committee_app.test_client().get("/beta/api/buy-analysis", query_string={"ticker": ticker})
    assert response.status_code == 400


def test_valid_closes_with_missing_ohlc_keep_price_field_abstention(committee_store):
    directory, frame = committee_store
    close_frame = close_frame_for_dates(frame["Date"].dt.strftime("%Y-%m-%d").tolist(), frame["Close"].tolist())
    close_frame.to_parquet(directory / "QQQ.parquet", index=False)
    before = (directory / "QQQ.parquet").read_bytes()
    payload = buy_analysis.analyze("QQQ")
    assert [vote["vote"] for vote in payload["votes"][:2]] == ["approve", "approve"]
    assert payload["votes"][-1]["vote"] == "abstain"
    assert payload["votes"][-1]["probability_up"] is None
    assert payload["summary"]["verdict"] == "incomplete"
    assert payload["summary"]["total"] == 3
    assert (directory / "QQQ.parquet").read_bytes() == before


@pytest.mark.parametrize("defect", ["invalid", "duplicate_daily_origin", "reversed"])
def test_real_price_field_rejects_bad_dates_before_signal_computation(monkeypatch, defect):
    frame = clustered_ohlc_random_walk(320)
    if defect == "invalid":
        frame["Date"] = frame["Date"].astype(object)
        frame.loc[80, "Date"] = "not a date"
    elif defect == "duplicate_daily_origin":
        frame.loc[80, "Date"] = frame.loc[79, "Date"] + pd.Timedelta(hours=12)
    else:
        frame = frame.iloc[::-1].reset_index(drop=True)
    strategy = buy_analysis._strategy(MODEL)

    def reject(*_args, **_kwargs):
        raise AssertionError("Malformed daily origins must not reach the Price Field model.")

    monkeypatch.setattr(strategy, "compute_signals", reject)
    monkeypatch.setattr(buy_analysis, "_strategy", lambda model: strategy)
    with pytest.raises(ValueError, match="(?i)date"):
        buy_analysis.compute_price_field(frame, MODEL)


def test_extremely_long_horizon_is_a_400_without_local_data_access(committee_app, monkeypatch):
    def reject(*_args, **_kwargs):
        raise AssertionError("An oversized horizon must not read a market file.")

    monkeypatch.setattr(buy_analysis, "load_history", reject)
    response = committee_app.test_client().get(
        "/beta/api/buy-analysis", query_string={"ticker": "QQQ", "horizon": "9" * 5_000},
    )
    assert response.status_code == 400
    assert set(response.get_json()) == {"error"}


def test_disabled_beta_does_not_import_committee_or_strategy_compute():
    script = """
import sys
from flask import Flask
from app.beta import register_beta
assert 'app.beta.buy_analysis' not in sys.modules
assert 'app.beta.price_field_vote' not in sys.modules
application = Flask(__name__)
assert register_beta(application) is False
assert 'app.beta.buy_analysis' not in sys.modules
assert 'app.beta.price_field_vote' not in sys.modules
assert application.test_client().get('/beta/buy-analysis').status_code == 404
assert application.test_client().get('/beta/api/buy-analysis?ticker=QQQ').status_code == 404
"""
    result = subprocess.run(
        [sys.executable, "-c", script],
        cwd=Path(__file__).resolve().parents[3],
        env={**os.environ, "WORTHWARD_BETA_ENABLED": "0", "PYTHONDONTWRITEBYTECODE": "1"},
        capture_output=True, text=True, timeout=30, check=False,
    )
    assert result.returncode == 0, result.stderr
