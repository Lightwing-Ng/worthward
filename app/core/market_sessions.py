"""Dependency-neutral regular-session definitions for supported markets.

This module is the sole maintained owner of each supported market family's
regular trading session. It builds on `market_identity` so the suffix table,
the IANA timezone, and the session rules never drift apart.

Three distinct minute values are modeled per session segment because the
application's consumers genuinely need different ones:

- `open_minute` is the exchange session opening boundary in market-local
  minutes, and is also the timestamp of the first included minute bar.
- `close_minute` is the exchange session closing boundary. It is an
  *exclusive* endpoint: at exactly this minute the continuous session is over.
- `last_bar_minute` is the timestamp of the *last included minute bar* of the
  segment. It is an *inclusive* endpoint. For most markets it is
  `close_minute - 1`, but markets that print a closing auction stamped on the
  boundary minute itself (Korea, Japan, Euronext, Helsinki, India, Taiwan,
  Thailand, Tel Aviv) carry a bar at `close_minute`.

Consumers pick a view rather than restating the rules:

- `market_session_segments()` returns half-open `[open_minute, close_minute)`
  windows and answers "is the continuous session running right now".
- `market_included_bar_segments()` returns inclusive
  `[open_minute, last_bar_minute]` windows and answers "does this minute bar
  belong to the regular session".

Lunch breaks and split sessions are represented as multiple segments. Overnight
US bars are a trading-date concern owned by the comparison service, not a
session-window concern. This module holds no holiday calendar; it describes the
shape of a regular session only.

Code version: v1.0.0
"""

from __future__ import annotations

from dataclasses import dataclass

from app.core.market_identity import (
    MARKET_SUFFIXES,
    MARKET_TIMEZONES,
    infer_ticker_market,
)


@dataclass(frozen=True)
class MarketSessionSegment:
    """One continuous regular-trading window in market-local minutes."""

    open_minute: int
    close_minute: int
    last_bar_minute: int


@dataclass(frozen=True)
class MarketSession:
    """The regular-session identity of one supported market family."""

    market: str
    timezone: str
    label: str
    segments: tuple[MarketSessionSegment, ...]

    @property
    def open_minute(self) -> int:
        """Return the opening boundary of the first regular segment."""
        return self.segments[0].open_minute

    @property
    def close_minute(self) -> int:
        """Return the closing boundary of the last regular segment."""
        return self.segments[-1].close_minute

    @property
    def last_bar_minute(self) -> int:
        """Return the last included minute bar of the last regular segment."""
        return self.segments[-1].last_bar_minute


def _segment(open_minute: int, close_minute: int, last_bar_minute: int | None = None) -> MarketSessionSegment:
    return MarketSessionSegment(
        open_minute=open_minute,
        close_minute=close_minute,
        last_bar_minute=close_minute - 1 if last_bar_minute is None else last_bar_minute,
    )


def _minute(hour: int, minute: int = 0) -> int:
    return (hour * 60) + minute


# Australian Securities Exchange normal trading is 10:00 to 16:00 Sydney time.
# Reference: ASX cash market trading hours.
_MARKET_SESSIONS: dict[str, MarketSession] = {
    "US": MarketSession("US", MARKET_TIMEZONES["US"], "NYT", (
        _segment(_minute(9, 30), _minute(16)),
    )),
    "HK": MarketSession("HK", MARKET_TIMEZONES["HK"], "HKT", (
        _segment(_minute(9, 30), _minute(12)),
        _segment(_minute(13), _minute(16)),
    )),
    "KR": MarketSession("KR", MARKET_TIMEZONES["KR"], "KST", (
        _segment(_minute(9), _minute(15, 30), _minute(15, 30)),
    )),
    "JP": MarketSession("JP", MARKET_TIMEZONES["JP"], "JST", (
        _segment(_minute(9), _minute(11, 30)),
        _segment(_minute(12, 30), _minute(15, 30), _minute(15, 30)),
    )),
    "CN": MarketSession("CN", MARKET_TIMEZONES["CN"], "CST", (
        _segment(_minute(9, 30), _minute(11, 30)),
        _segment(_minute(13), _minute(15)),
    )),
    "UK": MarketSession("UK", MARKET_TIMEZONES["UK"], "LON", (
        _segment(_minute(8), _minute(16, 30)),
    )),
    "SG": MarketSession("SG", MARKET_TIMEZONES["SG"], "SGT", (
        _segment(_minute(9), _minute(12)),
        _segment(_minute(13), _minute(17)),
    )),
    "AU": MarketSession("AU", MARKET_TIMEZONES["AU"], "AET", (
        _segment(_minute(10), _minute(16)),
    )),
    "CA": MarketSession("CA", MARKET_TIMEZONES["CA"], "ET", (
        _segment(_minute(9, 30), _minute(16)),
    )),
    "EU": MarketSession("EU", MARKET_TIMEZONES["EU"], "CET", (
        _segment(_minute(9), _minute(17, 30), _minute(17, 30)),
    )),
    "FI": MarketSession("FI", MARKET_TIMEZONES["FI"], "EET", (
        _segment(_minute(9), _minute(17, 30), _minute(17, 30)),
    )),
    "IN": MarketSession("IN", MARKET_TIMEZONES["IN"], "IST", (
        _segment(_minute(9, 15), _minute(15, 30), _minute(15, 30)),
    )),
    "TW": MarketSession("TW", MARKET_TIMEZONES["TW"], "CST", (
        _segment(_minute(9), _minute(13, 30), _minute(13, 30)),
    )),
    "MY": MarketSession("MY", MARKET_TIMEZONES["MY"], "MYT", (
        _segment(_minute(9), _minute(17)),
    )),
    "TH": MarketSession("TH", MARKET_TIMEZONES["TH"], "ICT", (
        _segment(_minute(10), _minute(16, 30), _minute(16, 30)),
    )),
    "ID": MarketSession("ID", MARKET_TIMEZONES["ID"], "WIB", (
        _segment(_minute(9), _minute(16)),
    )),
    "NZ": MarketSession("NZ", MARKET_TIMEZONES["NZ"], "NZT", (
        _segment(_minute(10), _minute(16, 45)),
    )),
    "BR": MarketSession("BR", MARKET_TIMEZONES["BR"], "BRT", (
        _segment(_minute(10), _minute(17)),
    )),
    "AR": MarketSession("AR", MARKET_TIMEZONES["AR"], "ART", (
        _segment(_minute(10, 30), _minute(17)),
    )),
    "LATAM": MarketSession("LATAM", MARKET_TIMEZONES["LATAM"], "CT", (
        _segment(_minute(8, 30), _minute(15)),
    )),
    "TR": MarketSession("TR", MARKET_TIMEZONES["TR"], "TRT", (
        _segment(_minute(10), _minute(18)),
    )),
    "IL": MarketSession("IL", MARKET_TIMEZONES["IL"], "IST", (
        _segment(_minute(9, 30), _minute(17, 30), _minute(17, 30)),
    )),
    "SA": MarketSession("SA", MARKET_TIMEZONES["SA"], "AST", (
        _segment(_minute(10), _minute(15)),
    )),
    "ZA": MarketSession("ZA", MARKET_TIMEZONES["ZA"], "SAST", (
        _segment(_minute(9), _minute(17)),
    )),
    "QA": MarketSession("QA", MARKET_TIMEZONES["QA"], "AST", (
        _segment(_minute(9, 30), _minute(13, 10)),
    )),
}


def market_session(market: object) -> MarketSession:
    """Return the regular session definition for a canonical market family."""
    key = str(market or "").strip().upper()
    return _MARKET_SESSIONS.get(key, _MARKET_SESSIONS["US"])


def market_session_for_ticker(ticker: object) -> MarketSession:
    """Return the regular session definition inferred from a ticker suffix."""
    return market_session(infer_ticker_market(ticker))


def market_session_segments(ticker: object) -> list[tuple[int, int]]:
    """Return half-open `[open, close)` session windows in market-local minutes."""
    return [
        (segment.open_minute, segment.close_minute)
        for segment in market_session_for_ticker(ticker).segments
    ]


def market_included_bar_segments(ticker: object) -> list[tuple[int, int]]:
    """Return inclusive `[open, last bar]` windows in market-local minutes."""
    return [
        (segment.open_minute, segment.last_bar_minute)
        for segment in market_session_for_ticker(ticker).segments
    ]


def market_session_open_minute(ticker: object) -> int:
    """Return the first regular-session minute bar for a ticker's market."""
    return market_session_for_ticker(ticker).open_minute


def market_session_last_bar_minute(ticker: object) -> int:
    """Return the last included regular-session minute bar for a ticker."""
    return market_session_for_ticker(ticker).last_bar_minute


def market_session_close_minute(ticker: object) -> int:
    """Return the exchange session closing boundary for a ticker's market."""
    return market_session_for_ticker(ticker).close_minute


def browser_market_session_config() -> list[dict[str, object]]:
    """Serialize the session table for browser charting and SVG export.

    The projection is ordered exactly like the canonical suffix table so a
    browser consumer can resolve a ticker with the same longest-registered
    suffix precedence the backend uses. `barEndMinute` is the exclusive end of
    the last included minute bar, which is what a bar-centered plot needs for
    its right edge; `closeMinute` remains the exchange session boundary.
    """
    rows: list[dict[str, object]] = []
    for market, suffixes in MARKET_SUFFIXES:
        session = market_session(market)
        rows.append({
            "market": market,
            "suffixes": list(suffixes),
            "timezone": session.timezone,
            "label": session.label,
            "openMinute": session.open_minute,
            "closeMinute": session.close_minute,
            "lastBarMinute": session.last_bar_minute,
            "barEndMinute": session.last_bar_minute + 1,
            "segments": [
                {
                    "openMinute": segment.open_minute,
                    "closeMinute": segment.close_minute,
                    "lastBarMinute": segment.last_bar_minute,
                }
                for segment in session.segments
            ],
        })
    default_session = market_session("US")
    rows.append({
        "market": default_session.market,
        "suffixes": [],
        "timezone": default_session.timezone,
        "label": default_session.label,
        "openMinute": default_session.open_minute,
        "closeMinute": default_session.close_minute,
        "lastBarMinute": default_session.last_bar_minute,
        "barEndMinute": default_session.last_bar_minute + 1,
        "segments": [
            {
                "openMinute": segment.open_minute,
                "closeMinute": segment.close_minute,
                "lastBarMinute": segment.last_bar_minute,
            }
            for segment in default_session.segments
        ],
    })
    return rows
