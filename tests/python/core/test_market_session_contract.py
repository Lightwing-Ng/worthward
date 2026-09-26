"""One maintained market-session source for backend, chart, and export.

Code version: v1.0.1
"""

from __future__ import annotations

import json
from pathlib import Path
import re

import pandas as pd
import pytest

from app.core.markets.identity import MARKET_SUFFIXES, infer_ticker_market
from app.core.markets.sessions import (
    browser_market_session_config,
    market_included_bar_segments,
    market_session_close_minute,
    market_session_for_ticker,
    market_session_last_bar_minute,
    market_session_open_minute,
    market_session_segments,
)
from app.infrastructure import broker_market_data
from app.services.analysis import comparisons


PROJECT_ROOT = Path(__file__).resolve().parents[3]
JAVASCRIPT_ROOT = PROJECT_ROOT / "app/web/static/assets/js"
CHART_CONSUMERS = (
    "chart.js",
    "app/chart-export.js",
    "app/date-controls.js",
    "price-compare/runtime.js",
)


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def test_every_supported_suffix_family_has_one_session_definition() -> None:
    for market, suffixes in MARKET_SUFFIXES:
        session = market_session_for_ticker(f"SAMPLE{suffixes[0]}")
        assert session.market == market
        assert session.segments
        for segment in session.segments:
            assert segment.open_minute < segment.close_minute
            assert segment.open_minute <= segment.last_bar_minute
            assert segment.last_bar_minute in {
                segment.close_minute - 1,
                segment.close_minute,
            }


@pytest.mark.parametrize(
    ("ticker", "timezone", "open_minute", "close_minute", "last_bar_minute"),
    (
        # Buenos Aires and Istanbul are their own market families. The browser
        # chart and SVG export previously mapped them to Mexico City and Paris.
        ("GGAL.BA", "America/Argentina/Buenos_Aires", (10 * 60) + 30, 17 * 60, (17 * 60) - 1),
        ("GARAN.IS", "Europe/Istanbul", 10 * 60, 18 * 60, (18 * 60) - 1),
        # ASX normal trading opens at 10:00 Sydney time, not 09:00.
        ("BHP.AX", "Australia/Sydney", 10 * 60, 16 * 60, (16 * 60) - 1),
        # Korea prints a closing-auction bar stamped on the session boundary.
        ("000660.KS", "Asia/Seoul", 9 * 60, (15 * 60) + 30, (15 * 60) + 30),
        ("0700.HK", "Asia/Hong_Kong", (9 * 60) + 30, 16 * 60, (16 * 60) - 1),
        ("AAPL", "America/New_York", (9 * 60) + 30, 16 * 60, (16 * 60) - 1),
    ),
)
def test_confirmed_market_identity_mismatches_resolve_to_one_definition(
        ticker: str,
        timezone: str,
        open_minute: int,
        close_minute: int,
        last_bar_minute: int,
) -> None:
    session = market_session_for_ticker(ticker)

    assert session.timezone == timezone
    assert market_session_open_minute(ticker) == open_minute
    assert market_session_close_minute(ticker) == close_minute
    assert market_session_last_bar_minute(ticker) == last_bar_minute


@pytest.mark.parametrize("ticker", ("0700.HK", "7203.T", "600519.SS", "D05.SI"))
def test_split_sessions_keep_their_lunch_break(ticker: str) -> None:
    segments = market_session_segments(ticker)

    assert len(segments) == 2
    assert segments[0][1] < segments[1][0]


@pytest.mark.parametrize(
    ("ticker", "minute_of_day", "included_bar", "session_active"),
    (
        # A closing-auction bar stamped on the boundary is an included bar, but
        # the continuous session is no longer running at that minute.
        ("000660.KS", (15 * 60) + 30, True, False),
        ("CDR.WA", (17 * 60) + 30, True, False),
        ("0700.HK", (15 * 60) + 59, True, True),
        ("0700.HK", 16 * 60, False, False),
        ("0700.HK", (12 * 60) + 30, False, False),
    ),
)
def test_inclusive_bar_windows_and_exclusive_session_windows_stay_distinct(
        ticker: str,
        minute_of_day: int,
        included_bar: bool,
        session_active: bool,
) -> None:
    bars = market_included_bar_segments(ticker)
    windows = market_session_segments(ticker)

    assert any(start <= minute_of_day <= end for start, end in bars) is included_bar
    assert any(start <= minute_of_day < end for start, end in windows) is session_active


def test_comparison_and_broker_session_filters_share_the_included_bar_window() -> None:
    # 15:30 Seoul on a weekday is the Korean closing-auction bar.
    seoul_close = pd.Timestamp("2026-09-14 15:30", tz="Asia/Seoul")
    warsaw_close = pd.Timestamp("2026-09-14 17:30", tz="Europe/Warsaw")

    for timestamp, ticker in ((seoul_close, "000660.KS"), (warsaw_close, "CDR.WA")):
        assert comparisons._is_market_session_timestamp(timestamp, ticker)
        assert broker_market_data._is_regular_market_session(timestamp, ticker)


def test_sydney_pre_open_bars_are_not_regular_session_bars() -> None:
    pre_open = pd.Timestamp("2026-09-14 09:30", tz="Australia/Sydney")
    first_bar = pd.Timestamp("2026-09-14 10:00", tz="Australia/Sydney")

    assert not comparisons._is_market_session_timestamp(pre_open, "BHP.AX")
    assert not broker_market_data._is_regular_market_session(pre_open, "BHP.AX")
    assert comparisons._is_market_session_timestamp(first_bar, "BHP.AX")
    assert broker_market_data._is_regular_market_session(first_bar, "BHP.AX")


def test_browser_projection_preserves_backend_suffix_precedence() -> None:
    rows = browser_market_session_config()
    suffix_rows = [row for row in rows if row["suffixes"]]

    assert [row["market"] for row in suffix_rows] == [market for market, _ in MARKET_SUFFIXES]
    assert [tuple(row["suffixes"]) for row in suffix_rows] == [
        suffixes for _, suffixes in MARKET_SUFFIXES
    ]
    assert rows[-1]["suffixes"] == []
    assert rows[-1]["market"] == "US"

    for row in rows:
        ticker = f"SAMPLE{row['suffixes'][0]}" if row["suffixes"] else "AAPL"
        assert infer_ticker_market(ticker) == row["market"]
        assert row["openMinute"] == market_session_open_minute(ticker)
        assert row["closeMinute"] == market_session_close_minute(ticker)
        assert row["lastBarMinute"] == market_session_last_bar_minute(ticker)
        assert row["barEndMinute"] == row["lastBarMinute"] + 1


def test_browser_projection_is_json_serializable_and_published_by_base_template() -> None:
    payload = json.loads(json.dumps(browser_market_session_config()))

    assert payload
    base_template = _read(PROJECT_ROOT / "app/web/templates/base.html")
    assert 'id="worthward_market_sessions"' in base_template
    assert "market_session_config|tojson" in base_template
    assert base_template.index('id="worthward_market_sessions"') < base_template.index(
        "assets/js/chart-axis-utils.js"
    )


def test_browser_chart_and_export_keep_no_private_market_rule_table() -> None:
    for relative_path in CHART_CONSUMERS:
        source = _read(JAVASCRIPT_ROOT / relative_path)
        assert "America/Mexico_City" not in source, relative_path
        assert "Europe/Paris" not in source, relative_path
        assert not re.search(r"suffixes:\s*\[", source), relative_path
        # No consumer may map a ticker suffix to a timezone on its own.
        assert not re.search(r'endsWith\("\.[A-Z]+"\)\) return "', source), relative_path

    for relative_path in ("chart.js", "app/chart-export.js", "app/date-controls.js"):
        assert "Intl.DateTimeFormat" not in _read(JAVASCRIPT_ROOT / relative_path), (
            relative_path
        )

    price_compare_runtime = _read(JAVASCRIPT_ROOT / "price-compare/runtime.js")
    assert "resolveMarketTimeConfig" in price_compare_runtime
    assert "WORTHWARD_MARKET_SESSIONS" in price_compare_runtime
    assert "Asia/Seoul" not in price_compare_runtime.split("const timezoneLabel")[0]


def test_shared_axis_module_owns_the_only_timezone_offset_implementation() -> None:
    shared_source = _read(JAVASCRIPT_ROOT / "chart-axis-utils.js")

    assert shared_source.count("new Intl.DateTimeFormat") == 1
    assert "resolveMarketTimeConfig," in shared_source
    assert "WORTHWARD_MARKET_SESSIONS" in shared_source
