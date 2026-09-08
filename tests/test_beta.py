"""Beta isolation, data validation, and causal diagnostics. Code version: v0.1.0."""

from __future__ import annotations

import builtins
import os
from pathlib import Path
import socket
import subprocess
import sys

from flask import Flask
from jinja2 import DictLoader
import numpy as np
import pandas as pd
import pytest

from app.beta import build_page_context, register_beta
from app.beta import analysis
from app.beta.registry import EXPERIMENT_BY_ID, EXPERIMENTS
from app.infrastructure import storage
from tests.factories.market import close_frame_for_dates


@pytest.fixture
def beta_store(tmp_path, monkeypatch):
    directory = tmp_path / "historical"
    directory.mkdir()
    monkeypatch.setattr(analysis, "HISTORICAL_STORE_DIR", directory)
    monkeypatch.setattr(storage, "HISTORICAL_STORE_DIR", directory)
    dates = pd.bdate_range("2015-01-01", periods=650)
    closes = (100 * np.exp(np.linspace(0, 0.5, 650) + np.sin(np.arange(650) / 13) * 0.12)).tolist()
    frame = close_frame_for_dates(dates.strftime("%Y-%m-%d").tolist(), closes)
    frame.to_parquet(directory / "QQQ.parquet", index=False, row_group_size=50)
    return directory, frame


@pytest.fixture
def beta_app(monkeypatch):
    monkeypatch.delenv("WORTHWARD_BETA_ENABLED", raising=False)
    application = Flask(__name__)
    application.config["TESTING"] = True
    application.jinja_loader = DictLoader({
        "beta.html": "{{ beta_experiment.id }}|{{ beta_experiments|length }}|{{ current_view }}|{{ beta_state|tojson }}",
    })
    assert register_beta(application)
    return application


@pytest.mark.parametrize("setting", ["0", "false", "off", "no", "", "unexpected"])
def test_disable_switch_registers_no_beta_routes(monkeypatch, setting):
    monkeypatch.setenv("WORTHWARD_BETA_ENABLED", setting)
    application = Flask(__name__)
    assert register_beta(application) is False
    assert not any(rule.rule.startswith("/beta") for rule in application.url_map.iter_rules())
    with application.test_request_context():
        context = {}
        application.update_template_context(context)
        assert context["beta_enabled"] is False
        assert context["beta_url"] is None


def test_disabled_beta_does_not_import_its_analysis_dependencies():
    script = """
import sys
from flask import Flask
from app.beta import register_beta
assert 'app.beta.analysis' not in sys.modules
assert register_beta(Flask(__name__)) is False
assert 'app.beta.analysis' not in sys.modules
"""
    result = subprocess.run(
        [sys.executable, "-c", script],
        cwd=Path(__file__).resolve().parents[1],
        env={**os.environ, "WORTHWARD_BETA_ENABLED": "0", "PYTHONDONTWRITEBYTECODE": "1"},
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    assert result.returncode == 0, result.stderr


def test_beta_pages_and_registry_use_an_independent_context(beta_app):
    client = beta_app.test_client()
    assert client.get("/beta").status_code == 200
    for experiment in EXPERIMENTS:
        response = client.get(f"/beta/{experiment['id']}")
        assert response.status_code == 200
        assert f"{experiment['id']}|6|beta|" in response.text
        assert response.headers["Cache-Control"] == "no-store"
    assert client.get("/beta/unknown").status_code == 404
    assert client.post("/beta/api/analyze").status_code == 405
    with beta_app.test_request_context():
        context = build_page_context(EXPERIMENTS[0])
        assert context["beta_state"]["endpoints"] == {}
        assert "security" not in context["beta_state"]
        assert "investment" not in context["beta_state"]
        assert "broker" not in context["beta_state"]


@pytest.mark.parametrize("experiment", analysis.ANALYZERS)
def test_analysis_reads_without_network_or_file_writes(beta_store, beta_app, monkeypatch, experiment):
    directory, _frame = beta_store
    before = {path.name: path.read_bytes() for path in directory.iterdir()}
    original_open = builtins.open
    original_os_open = os.open
    original_path_open = Path.open

    def reject(*args, **kwargs):
        raise AssertionError("Beta attempted an unrelated network or persistence action.")

    def read_only_open(file, mode="r", *args, **kwargs):
        assert not any(flag in mode for flag in "wax+")
        return original_open(file, mode, *args, **kwargs)

    def read_only_os_open(path, flags, *args, **kwargs):
        assert not flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC | os.O_APPEND)
        return original_os_open(path, flags, *args, **kwargs)

    def read_only_path_open(path, mode="r", *args, **kwargs):
        assert not any(flag in mode for flag in "wax+")
        return original_path_open(path, mode, *args, **kwargs)

    monkeypatch.setattr(builtins, "open", read_only_open)
    monkeypatch.setattr(os, "open", read_only_os_open)
    monkeypatch.setattr(Path, "open", read_only_path_open)
    monkeypatch.setattr(socket.socket, "connect", reject)
    monkeypatch.setattr(socket, "create_connection", reject)
    monkeypatch.setattr(storage, "ensure_market_store_dir", reject)
    monkeypatch.setattr(storage, "write_parquet_atomic", reject)
    monkeypatch.setattr(storage, "_migrate_store_filenames", reject)
    monkeypatch.setattr(pd.DataFrame, "to_parquet", reject)
    response = beta_app.test_client().get("/beta/api/analyze", query_string={"experiment": experiment, "ticker": "qqq.us"})
    assert response.status_code == 200
    payload = response.get_json()
    assert payload["ticker"] == "QQQ"
    assert payload["experiment"] == experiment
    assert payload["observations"] == 650
    assert set(payload) == {"experiment", "ticker", "as_of", "observations", "source", "metrics", "chart", "rows", "notes"}
    for series in payload["chart"]["series"]:
        assert len(series["values"]) == len(payload["chart"]["labels"])
        assert all(value is None or np.isfinite(value) for value in series["values"])
    assert {path.name: path.read_bytes() for path in directory.iterdir()} == before


@pytest.mark.parametrize("ticker", ["../QQQ", "QQQ/../../settings", "QQQ\\secret", "<script>", "A,B", "^GSPC", "a" * 100, ""])
def test_ticker_allowlist_rejects_before_any_path_read(beta_app, monkeypatch, ticker):
    def reject(*_args, **_kwargs):
        raise AssertionError("Malformed tickers must not reach path resolution.")

    monkeypatch.setattr(analysis, "history_store_path_for", reject)
    response = beta_app.test_client().get("/beta/api/analyze", query_string={"experiment": "regime-radar", "ticker": ticker})
    assert response.status_code == 400
    assert set(response.get_json()) == {"error"}


@pytest.mark.parametrize("query, expected", [
    ("experiment=unknown&ticker=QQQ", 404),
    ("experiment=thesis-lab&ticker=QQQ", 404),
    ("experiment=regime-radar&ticker=QQQ&refresh=1", 400),
    ("experiment=regime-radar&ticker=QQQ&ticker=AAPL", 400),
    ("experiment=stress-lab&experiment=regime-radar&ticker=QQQ", 400),
])
def test_api_rejects_unknown_capabilities_and_ambiguous_queries(beta_app, query, expected):
    response = beta_app.test_client().get(f"/beta/api/analyze?{query}")
    assert response.status_code == expected
    assert set(response.get_json()) == {"error"}


def test_local_data_absence_and_symlink_escape_fail_closed(beta_store):
    directory, _frame = beta_store
    with pytest.raises(analysis.BetaDataError, match="No local") as failure:
        analysis.load_closes("MISSING")
    assert failure.value.status == 404
    outside = directory.parent / "outside.parquet"
    outside.write_bytes((directory / "QQQ.parquet").read_bytes())
    (directory / "ESCAPE.parquet").symlink_to(outside)
    with pytest.raises(analysis.BetaDataError, match="ordinary local") as failure:
        analysis.load_closes("ESCAPE")
    assert failure.value.status == 400


def test_same_security_market_alias_is_read_with_explicit_provenance(beta_store):
    directory, frame = beta_store
    frame.to_parquet(directory / "SKHYV.parquet", index=False)
    payload = analysis.analyze("regime-radar", "SKHY")
    assert payload["ticker"] == "SKHY"
    assert "(SKHYV)" in payload["source"]
    frame.to_parquet(directory / "SKHY.parquet", index=False)
    payload = analysis.analyze("regime-radar", "SKHY")
    assert "(SKHY)" in payload["source"]


def test_investment_lineage_proxy_is_never_used_as_market_identity(beta_store):
    directory, frame = beta_store
    frame.to_parquet(directory / "SPY.parquet", index=False)
    frame.to_parquet(directory / "SPYM.parquet", index=False)
    with pytest.raises(analysis.BetaDataError, match="No local"):
        analysis.load_closes("SPLG")


@pytest.mark.parametrize("defect", ["zero", "negative", "nan", "infinity", "duplicate_date", "bad_date", "reversed_dates", "missing_close", "too_short", "future_date", "corrupt"])
def test_bad_local_rows_are_rejected_without_repair(beta_store, defect):
    directory, frame = beta_store
    path = directory / "QQQ.parquet"
    if defect in {"zero", "negative", "nan", "infinity"}:
        frame.loc[80, "Close"] = {"zero": 0, "negative": -1, "nan": np.nan, "infinity": np.inf}[defect]
    elif defect == "duplicate_date":
        frame.loc[80, "Date"] = frame.loc[79, "Date"]
    elif defect == "bad_date":
        frame.loc[80, "Date"] = pd.NaT
    elif defect == "reversed_dates":
        frame = frame.iloc[::-1]
    elif defect == "missing_close":
        frame = frame.drop(columns="Close")
    elif defect == "too_short":
        frame = frame.head(79)
    elif defect == "future_date":
        frame.loc[len(frame) - 1, "Date"] = pd.Timestamp.now().normalize() + pd.Timedelta(days=3)
    frame.to_parquet(path, index=False)
    if defect == "corrupt":
        path.write_bytes(b"not a parquet file")
    before = path.read_bytes()
    with pytest.raises(analysis.BetaDataError):
        analysis.load_closes("QQQ")
    assert path.read_bytes() == before


def test_tail_observation_cap_is_explicit(beta_store):
    directory, _frame = beta_store
    dates = pd.bdate_range("2010-01-01", periods=3_000).strftime("%Y-%m-%d").tolist()
    frame = close_frame_for_dates(dates, np.linspace(100, 200, 3_000).tolist())
    frame.to_parquet(directory / "QQQ.parquet", index=False, row_group_size=100)
    payload = analysis.analyze("stress-lab", "QQQ")
    assert payload["observations"] == 2_500
    assert "capped at 2,500" in payload["notes"][0]
    _ticker, loaded = analysis.load_closes("QQQ")
    assert loaded.iloc[0]["Close"] == frame.iloc[500]["Close"]


def test_analog_selection_has_no_query_or_continuation_leakage(beta_store):
    _directory, frame = beta_store
    closes = frame["Close"].to_numpy()
    chosen = analysis.find_analogs(closes)
    assert len(chosen) == 5
    query_start = len(closes) - analysis.WINDOW
    for candidate in chosen:
        assert candidate["outcome_end"] < query_start
        assert candidate["end"] - candidate["start"] + 1 == 20
        assert candidate["outcome_end"] - candidate["end"] == 20
    for index, candidate in enumerate(chosen):
        for other in chosen[index + 1:]:
            assert candidate["outcome_end"] < other["start"] or other["outcome_end"] < candidate["start"]
    # Flat equal-distance shapes must rank by date, never by a later outcome.
    flat = np.ones(220) * 100
    flat[35] = 120
    candidates = analysis.find_analogs(flat)
    assert candidates[0]["start"] == 0
    assert candidates[0]["distance"] == 0
    assert candidates[0]["outcome_end"] == 39


def test_rolling_horizon_semantics_and_stress_use_h_plus_one_closes(beta_store):
    directory, frame = beta_store
    # Deterministic compounding makes the correct number of price intervals observable.
    frame["Close"] = 100 * np.power(1.01, np.arange(len(frame)))
    frame.to_parquet(directory / "QQQ.parquet", index=False)
    expected = analysis.percent(1.01 ** 20 - 1)
    stress = analysis.analyze("stress-lab", "QQQ")
    assert stress["metrics"][1]["value"] == expected
    assert len(stress["chart"]["labels"]) == 21
    robustness = analysis.analyze("robustness-lab", "QQQ")
    assert robustness["metrics"][0]["value"] == expected
    assert robustness["metrics"][1]["value"] == expected
    assert robustness["metrics"][2]["value"] == "0.0%"
    assert robustness["rows"]["values"][1][-1] == "630"


def test_regime_volatility_and_trailing_drawdown_have_known_values(beta_store):
    directory, frame = beta_store
    frame["Close"] = 100.0
    frame.loc[len(frame) - 1, "Close"] = 90.0
    frame.to_parquet(directory / "QQQ.parquet", index=False)
    payload = analysis.analyze("regime-radar", "QQQ")
    metrics = {item["label"]: item["value"] for item in payload["metrics"]}
    assert metrics["Trend texture"] == "Falling"
    assert metrics["20-session return"] == "-10.00%"
    assert metrics["Trailing drawdown"] == "-10.00%"
    expected_vol = np.std([0.0] * 19 + [np.log(0.9)], ddof=1) * np.sqrt(252)
    assert metrics["Realized volatility"] == f"{expected_vol * 100:,.2f}%"


def test_registry_only_exposes_declared_read_only_analyzers():
    assert len(EXPERIMENT_BY_ID) == 6
    assert {item["id"] for item in EXPERIMENTS if item["interactive"]} == set(analysis.ANALYZERS)
