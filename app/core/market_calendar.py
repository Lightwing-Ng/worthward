"""NYSE trading-calendar primitives shared across application layers.

Code version: v1.1.1
"""

from __future__ import annotations

from datetime import date, timedelta
from functools import lru_cache

import pandas as pd

_NYSE_SPECIAL_CLOSURES: dict[int, frozenset[date]] = {
    2018: frozenset({date(2018, 12, 5)}),
    2025: frozenset({date(2025, 1, 9)}),
}

_NYSE_SESSION_TIMEZONE = "America/New_York"
_NYSE_PREMARKET_OPEN_MINUTE = 4 * 60
_NYSE_REGULAR_OPEN_MINUTE = (9 * 60) + 30
_NYSE_REGULAR_CLOSE_MINUTE = 16 * 60
_NYSE_POSTMARKET_CLOSE_MINUTE = 20 * 60
_NYSE_OVERNIGHT_CLOSE_MINUTE = 4 * 60
_NYSE_EARLY_CLOSE_MINUTE = 13 * 60
_NYSE_EARLY_CLOSE_OVERRIDES: dict[int, frozenset[date]] = {
    2025: frozenset({date(2025, 11, 28)}),
}


def _nth_weekday_of_month(year: int, month: int, weekday: int, occurrence: int) -> date:
    current = date(year, month, 1)
    while current.weekday() != weekday:
        current += timedelta(days=1)
    current += timedelta(weeks=occurrence - 1)
    return current


def _last_weekday_of_month(year: int, month: int, weekday: int) -> date:
    if month == 12:
        current = date(year + 1, 1, 1) - timedelta(days=1)
    else:
        current = date(year, month + 1, 1) - timedelta(days=1)
    while current.weekday() != weekday:
        current -= timedelta(days=1)
    return current


def _calculate_easter_sunday(year: int) -> date:
    """
    Calculate Gregorian Easter Sunday with the Meeus/Jones/Butcher algorithm.
    """
    a = year % 19
    b = year // 100
    c = year % 100
    d = b // 4
    e = b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i = c // 4
    k = c % 4
    calendar_correction = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * calendar_correction) // 451
    month = (h + calendar_correction - 7 * m + 114) // 31
    day = ((h + calendar_correction - 7 * m + 114) % 31) + 1
    return date(year, month, day)


def _observed_fixed_holiday(year: int, month: int, day: int) -> date:
    observed = date(year, month, day)
    if observed.weekday() == 5:
        return observed - timedelta(days=1)
    if observed.weekday() == 6:
        return observed + timedelta(days=1)
    return observed


def _nyse_early_close_days(year: int) -> frozenset[date]:
    early_closures = set(_NYSE_SPECIAL_CLOSURES.get(year, frozenset()))
    early_closures.update(_NYSE_EARLY_CLOSE_OVERRIDES.get(year, frozenset()))
    early_closures.add(_nth_weekday_of_month(year, 11, 3, 4) + timedelta(days=1))
    christmas_day_observed = _observed_fixed_holiday(year, 12, 25)
    if christmas_day_observed == date(year, 12, 24):
        early_closures.add(date(year, 12, 24))
    july4_observed = _observed_fixed_holiday(year, 7, 4)
    if july4_observed == date(year, 7, 3):
        early_closures.add(date(year, 7, 3))
    return frozenset(early_closures)


def _nyse_has_early_close_for(value: date) -> bool:
    return value in _nyse_early_close_days(value.year)


def _find_next_nyse_trading_day(candidate: date) -> date:
    next_day = candidate
    while not is_nyse_trading_day(next_day):
        next_day += timedelta(days=1)
    return next_day


def _format_minute_clock(total_minutes: int) -> str:
    hour = total_minutes // 60
    minute = total_minutes % 60
    return f"{hour:02d}:{minute:02d}"


@lru_cache(maxsize=32)
def nyse_holidays(year: int) -> frozenset[date]:
    holidays = {
        _observed_fixed_holiday(year, 1, 1),
        _nth_weekday_of_month(year, 1, 0, 3),
        _nth_weekday_of_month(year, 2, 0, 3),
        _calculate_easter_sunday(year) - timedelta(days=2),
        _last_weekday_of_month(year, 5, 0),
        _observed_fixed_holiday(year, 7, 4),
        _nth_weekday_of_month(year, 9, 0, 1),
        _nth_weekday_of_month(year, 11, 3, 4),
        _observed_fixed_holiday(year, 12, 25),
    }
    if year >= 2022:
        holidays.add(_observed_fixed_holiday(year, 6, 19))
    holidays.update(_NYSE_SPECIAL_CLOSURES.get(year, frozenset()))
    return frozenset(holidays)


def is_nyse_trading_day(value: date | pd.Timestamp | str) -> bool:
    current = pd.Timestamp(value).date()
    return current.weekday() < 5 and current not in nyse_holidays(current.year)


def is_nyse_early_close(value: date | pd.Timestamp | str) -> bool:
    current = pd.Timestamp(value).date()
    return is_nyse_trading_day(current) and _nyse_has_early_close_for(current)


def nyse_market_session_state(
        reference: pd.Timestamp | str | None = None,
        *,
        include_overnight: bool = False,
) -> dict[str, object]:
    anchor = pd.Timestamp.now(tz=_NYSE_SESSION_TIMEZONE) if reference is None else pd.Timestamp(reference)
    if anchor.tzinfo is None:
        anchor = anchor.tz_localize("UTC").tz_convert(_NYSE_SESSION_TIMEZONE)
    else:
        anchor = anchor.tz_convert(_NYSE_SESSION_TIMEZONE)

    calendar_date = anchor.date()
    trading_date = calendar_date
    is_trading_day = is_nyse_trading_day(calendar_date)
    is_early_close = is_nyse_early_close(calendar_date)
    regular_close_minute = _NYSE_EARLY_CLOSE_MINUTE if is_early_close else _NYSE_REGULAR_CLOSE_MINUTE
    total_minutes = (int(anchor.hour) * 60) + int(anchor.minute)
    session = "off"
    if is_trading_day:
        if _NYSE_PREMARKET_OPEN_MINUTE <= total_minutes < _NYSE_REGULAR_OPEN_MINUTE:
            session = "pre"
        elif _NYSE_REGULAR_OPEN_MINUTE <= total_minutes < regular_close_minute:
            session = "intraday"
        elif regular_close_minute <= total_minutes < _NYSE_POSTMARKET_CLOSE_MINUTE and not is_early_close:
            session = "post"
    if include_overnight and session == "off":
        if total_minutes >= _NYSE_POSTMARKET_CLOSE_MINUTE:
            overnight_trading_date = calendar_date + timedelta(days=1)
            if is_nyse_trading_day(overnight_trading_date):
                trading_date = overnight_trading_date
                is_trading_day = True
                is_early_close = is_nyse_early_close(trading_date)
                session = "overnight"
        elif total_minutes < _NYSE_OVERNIGHT_CLOSE_MINUTE and is_nyse_trading_day(calendar_date):
            session = "overnight"

    regular_close_minute = _NYSE_EARLY_CLOSE_MINUTE if is_early_close else _NYSE_REGULAR_CLOSE_MINUTE
    next_trading_day = _find_next_nyse_trading_day(trading_date + timedelta(days=1))
    next_trading_day_open = f"{next_trading_day.isoformat()}T{_format_minute_clock(_NYSE_REGULAR_OPEN_MINUTE)}:00"
    next_trading_day_close = f"{next_trading_day.isoformat()}T{_format_minute_clock(_NYSE_REGULAR_CLOSE_MINUTE)}:00"

    return {
        "market": "us_equity",
        "is_trading_day": is_trading_day,
        "is_early_close": is_early_close,
        "session": session,
        "session_date": trading_date.isoformat(),
        "as_of": anchor.isoformat(),
        "timezone": _NYSE_SESSION_TIMEZONE,
        "is_realtime_allowed": is_trading_day and session in {"overnight", "pre", "intraday", "post"},
        "overnight_open": _format_minute_clock(_NYSE_POSTMARKET_CLOSE_MINUTE),
        "overnight_close": _format_minute_clock(_NYSE_OVERNIGHT_CLOSE_MINUTE),
        "premarket_open": _format_minute_clock(_NYSE_PREMARKET_OPEN_MINUTE),
        "regular_open": _format_minute_clock(_NYSE_REGULAR_OPEN_MINUTE),
        "regular_close": _format_minute_clock(regular_close_minute),
        "postmarket_close": _format_minute_clock(_NYSE_POSTMARKET_CLOSE_MINUTE),
        "next_session_open": next_trading_day_open,
        "next_session_close": next_trading_day_close,
    }


def nyse_recent_trading_days(
        reference: pd.Timestamp | str | None = None,
        *,
        day_count: int = 5,
) -> list[str]:
    requested_count = max(1, min(365, int(day_count)))
    session_state = nyse_market_session_state(reference, include_overnight=True)
    session_date = str(session_state.get("session_date", ""))
    try:
        anchor = pd.Timestamp(session_date).date()
    except (TypeError, ValueError):
        anchor = pd.Timestamp.now(tz=_NYSE_SESSION_TIMEZONE).date()

    if str(session_state.get("session", "")) in {"pre", "overnight"}:
        anchor -= timedelta(days=1)
    while not is_nyse_trading_day(anchor):
        anchor -= timedelta(days=1)

    trading_days: list[str] = []
    cursor = anchor
    while len(trading_days) < requested_count:
        if is_nyse_trading_day(cursor):
            trading_days.append(cursor.isoformat())
        cursor -= timedelta(days=1)

    return list(reversed(trading_days))


def latest_completed_nyse_trading_day(
        reference: pd.Timestamp | str | None = None,
        *,
        market_close_hour: int = 16,
) -> pd.Timestamp:
    anchor = pd.Timestamp.now(tz="UTC") if reference is None else pd.Timestamp(reference)
    if anchor.tzinfo is None:
        anchor = anchor.tz_localize("UTC")
    else:
        anchor = anchor.tz_convert("UTC")

    reference_new_york = anchor.tz_convert("America/New_York")
    candidate = reference_new_york.date()
    if reference_new_york.hour < market_close_hour:
        candidate -= timedelta(days=1)

    while not is_nyse_trading_day(candidate):
        candidate -= timedelta(days=1)

    return pd.Timestamp(candidate)
