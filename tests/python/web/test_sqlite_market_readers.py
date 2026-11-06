"""Read actual SQLite market stores through production consumer boundaries.

Code version: v1.0.0
"""

from __future__ import annotations

from types import SimpleNamespace

import pandas as pd
import pytest

from app.beta import analysis
from app.infrastructure import broker_market_data, storage
from app.services.market import market_cap, market_data
from app.services.research import strategy_tuning
from app.web.runtime_domains.workspace.history import load_history_after_fetch_failure
from tests.factories.market import ohlc_frame_for_dates


def test_active_market_paths_use_sqlite_for_all_frame_kinds():
    paths = [
        storage.history_store_path_for("QQQ"),
        storage.intraday_history_store_path_for("QQQ", "1m"),
        storage.PROFILES_PARQUET_PATH,
        storage.SEARCH_CACHE_PARQUET_PATH,
        market_cap.fx_store_path_for("HKD"),
        market_cap.shares_store_path_for("QQQ"),
        market_cap.splits_store_path_for("QQQ"),
    ]
    assert all(path.suffix == ".sqlite3" for path in paths)


@pytest.fixture
def sqlite_history(tmp_path, monkeypatch):
    historical = tmp_path / "historical"
    historical.mkdir()
    path = historical / "QQQ.sqlite3"
    dates = pd.bdate_range("2021-01-04", periods=650).strftime("%Y-%m-%d").tolist()
    frame = ohlc_frame_for_dates("QQQ", dates)
    storage.write_market_frame_atomic(path, frame, index=False)
    assert path.read_bytes().startswith(b"SQLite format 3\x00")

    def reject_parquet(*_args, **_kwargs):
        raise AssertionError("A SQLite consumer must never invoke the legacy Parquet reader.")

    monkeypatch.setattr(pd, "read_parquet", reject_parquet)
    return path, frame


def test_beta_sqlite_tail_projection_is_read_only(sqlite_history, monkeypatch):
    path, expected = sqlite_history
    monkeypatch.setattr(analysis, "HISTORICAL_STORE_DIR", path.parent)
    monkeypatch.setattr(analysis, "history_store_path_for", lambda _ticker: path)
    before = {entry.name: entry.read_bytes() for entry in path.parent.iterdir()}
    ticker, actual = analysis.load_history("QQQ", include_ohlcv=True, maximum=120)
    assert ticker == "QQQ"
    assert len(actual) == 120
    assert actual["Close"].tolist() == expected.tail(120)["Close"].tolist()
    assert actual["Date"].dt.strftime("%Y-%m-%d").tolist() == (
        expected.tail(120)["Date"].dt.strftime("%Y-%m-%d").tolist()
    )
    for column in ("Open", "High", "Low"):
        assert actual[column].tolist() == expected.tail(120)[column].tolist()
    assert {entry.name: entry.read_bytes() for entry in path.parent.iterdir()} == before


def test_beta_rejects_corrupt_sqlite_without_mutating_or_reading_legacy(sqlite_history, monkeypatch):
    path, _expected = sqlite_history
    legacy = path.with_suffix(".parquet")
    legacy.write_bytes(b"An independent legacy artifact must not become a fallback.")
    path.write_bytes(b"damaged SQLite market history")
    monkeypatch.setattr(analysis, "HISTORICAL_STORE_DIR", path.parent)
    monkeypatch.setattr(analysis, "history_store_path_for", lambda _ticker: path)
    before = {entry.name: entry.read_bytes() for entry in path.parent.iterdir()}
    with pytest.raises(analysis.BetaDataError, match="could not be read"):
        analysis.load_closes("QQQ")
    assert {entry.name: entry.read_bytes() for entry in path.parent.iterdir()} == before


def test_sqlite_minute_loader_and_freshness_readers_leave_store_unchanged(sqlite_history, monkeypatch):
    path, _daily = sqlite_history
    expected = ohlc_frame_for_dates(
        "QQQ", ["2026-07-14 09:30", "2026-07-14 09:31", "2026-07-14 15:59"]
    )
    storage.write_market_frame_atomic(path, expected, index=False)
    monkeypatch.setattr(market_data, "history_store_path_for_interval", lambda *_args: path)
    monkeypatch.setattr(broker_market_data, "intraday_history_store_path_for", lambda *_args: path)
    before = path.read_bytes()
    actual = market_data.load_local_one_minute_history("QQQ")
    assert actual["Close"].tolist() == expected["Close"].tolist()
    assert broker_market_data.has_recent_one_minute_store("QQQ")
    assert path.read_bytes() == before


def test_research_and_workspace_fallback_use_sqlite_without_store_writes(sqlite_history, monkeypatch):
    path, expected = sqlite_history
    monkeypatch.setattr(strategy_tuning, "history_store_path_for_interval", lambda *_args: path)
    before = path.read_bytes()
    research = strategy_tuning.load_research_history("QQQ", "1d")
    assert research["Close"].tolist() == expected["Close"].tolist()
    assert research.attrs["research_source"] == str(path)
    context = SimpleNamespace(
        history_store_path_for=lambda _ticker: path,
        select_price_series=lambda frame, _include, dividend_mode=None: frame,
    )
    fallback = load_history_after_fetch_failure(context, "QQQ", False, "price")
    pd.testing.assert_frame_equal(fallback, expected)
    assert path.read_bytes() == before
