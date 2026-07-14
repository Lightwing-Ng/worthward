"""
Market data retrieval services.

Code version: v0.14.0
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import datetime
import io
import logging
import math
import contextlib
import re
from time import sleep
from pathlib import Path
from threading import Lock

import pandas as pd
import yfinance as yf

from app.core.broker_settings import has_longbridge_market_data_source, load_broker_settings
from app.infrastructure.connectivity import has_remote_market_access
from app.infrastructure.runtime_network import (
    add_yahoo_tls_configuration_hint,
    get_yfinance_session,
)
from app.infrastructure.longbridge_cli import get_longbridge_cli_auth_status
from app.infrastructure.yahoo_chart import download_yahoo_chart_daily_history
from app.infrastructure.broker_market_data import (
    HONG_KONG_TIMEZONE,
    NEW_YORK_TIMEZONE,
    fetch_longbridge_compare_one_day_history,
    fetch_longbridge_daily_history,
    fetch_longbridge_one_minute_history,
    has_recent_one_minute_store,
    is_daily_store_fresh,
    normalize_one_minute_store_frame,
    one_minute_lookback_start,
    refresh_longbridge_one_minute_store,
)
from app.infrastructure.storage import (
    ensure_market_store_dir,
    history_store_path_for,
    intraday_history_store_path_for,
    market_ticker_store_aliases,
    market_store_file_lock,
    normalize_ticker,
    write_parquet_atomic,
)

DOWNLOAD_RETRY_ATTEMPTS = 3
DOWNLOAD_RETRY_DELAYS_SECONDS = (0.0, 0.35, 0.8)
YFINANCE_DOWNLOAD_LOCK = Lock()
INTRADAY_INTERVALS = {"1m"}
YFINANCE_INTRADAY_FALLBACK_DAYS = 30
YFINANCE_INTRADAY_FALLBACK_WINDOW_DAYS = 7
YFINANCE_INTRADAY_MINIMUM_FALLBACK_DAYS = 7
DAILY_HISTORY_PERIOD_FALLBACKS = ("max", "5y", "2y", "1y", "6mo", "3mo", "1mo", "5d", "1d")
COMMON_SPLIT_FACTORS = (2.0, 3.0, 4.0, 5.0, 8.0, 10.0, 20.0, 25.0, 40.0, 50.0)
SPLIT_FACTOR_CANDIDATES = tuple(
    sorted({*COMMON_SPLIT_FACTORS, *(1.0 / factor for factor in COMMON_SPLIT_FACTORS)})
)
SPLIT_MATCH_TOLERANCE = math.log(1.12)
SPLIT_MIN_EVENT_DISTANCE = math.log(1.5)
SPLIT_MIN_IMPROVEMENT = 0.08
DIVIDEND_ACTION_LOOKBACK_DAYS = 370
DIVIDEND_ADJUSTMENT_SHIFT_TOLERANCE = 0.00001
COMPARE_OVERNIGHT_CANONICAL_SYMBOLS = {
    "SKHYV": "SKHY",
    "SKHYV.US": "SKHY",
}
COMPARE_OVERNIGHT_COMPANION_SYMBOLS = {
    "000660.KS": "SKHY",
}
LOGGER = logging.getLogger(__name__)
YFINANCE_LOGGER = logging.getLogger("yfinance")
NETWORK_URL_USERINFO_PATTERN = re.compile(r"(?i)(https?://)[^/@\s]+@")
NETWORK_SECRET_QUERY_PATTERN = re.compile(
    r"(?i)([?&](?:crumb|token|key|secret|password)=)[^&\s]+"
)


class YfinanceDownloadError(ValueError):
    """Raised when yfinance returns no usable frame or raises a transport error."""


def _sanitize_network_diagnostic(value: object) -> str:
    diagnostic = " ".join(str(value or "").split())
    diagnostic = NETWORK_URL_USERINFO_PATTERN.sub(r"\1REDACTED@", diagnostic)
    return NETWORK_SECRET_QUERY_PATTERN.sub(r"\1REDACTED", diagnostic)


def _yfinance_failure_detail(
        *,
        stderr_value: str,
        stdout_value: str,
        log_value: str,
        exception: Exception | None = None,
) -> str:
    candidates = [
        log_value,
        stderr_value,
        stdout_value,
        f"{type(exception).__name__}: {exception}" if exception is not None else "",
    ]
    details: list[str] = []
    for candidate in candidates:
        sanitized = _sanitize_network_diagnostic(candidate)
        if sanitized and sanitized not in details:
            details.append(sanitized)
    detail = " | ".join(details) or "No diagnostic was emitted."
    return add_yahoo_tls_configuration_hint(detail)


@dataclass(frozen=True)
class OneMinuteRefreshResult:
    path: Path
    source: str
    fetched_days: int


def normalize_market_interval(interval: str | None) -> str:
    normalized_interval = str(interval or "1d").strip().lower()
    return normalized_interval or "1d"


def is_intraday_market_interval(interval: str | None) -> bool:
    return normalize_market_interval(interval) in INTRADAY_INTERVALS


def history_store_path_for_interval(ticker: str, interval: str = "1d") -> Path:
    normalized_ticker = normalize_ticker(ticker)
    normalized_interval = normalize_market_interval(interval)
    if is_intraday_market_interval(normalized_interval):
        return intraday_history_store_path_for(normalized_ticker, normalized_interval)
    return history_store_path_for(normalized_ticker)


def list_available_market_intervals(ticker: str) -> list[str]:
    normalized_ticker = normalize_ticker(ticker)
    supported_intervals = ["1d"]
    if has_recent_one_minute_store(normalized_ticker):
        supported_intervals.append("1m")
    return supported_intervals


def yfinance_lookup_symbol(ticker: str) -> str:
    normalized_ticker = normalize_ticker(ticker)
    if normalized_ticker.endswith(".SH"):
        symbol, _ = normalized_ticker.rsplit(".", 1)
        return f"{symbol}.SS"
    if normalized_ticker.endswith(".HK"):
        symbol, suffix = normalized_ticker.rsplit(".", 1)
        if symbol.isdigit():
            return f"{symbol.zfill(4)}.{suffix}"
    return normalized_ticker


def _download_daily_history_with_yfinance(
        ticker: str | list[str],
        *,
        start: str | datetime | None = None,
        end: str | datetime | None = None,
        period: str | None = None,
        interval: str = "1d",
        prepost: bool = False,
) -> pd.DataFrame:
    """
    Serialize yfinance downloads for cross-version thread safety and to keep
    the temporary diagnostic handler scoped to one request.

    yfinance may also emit noisy diagnostics directly to stderr when it cannot
    resolve symbols like `MSFT.US`. We silence that low-level output here and
    preserve a sanitized explanation for the caller's fallback decision.
    """
    lookup_ticker: str | list[str]
    if isinstance(ticker, list):
        lookup_ticker = [yfinance_lookup_symbol(value) for value in ticker]
    else:
        lookup_ticker = yfinance_lookup_symbol(ticker)
    with YFINANCE_DOWNLOAD_LOCK:
        stderr_buffer = io.StringIO()
        stdout_buffer = io.StringIO()
        log_buffer = io.StringIO()
        diagnostic_handler = logging.StreamHandler(log_buffer)
        diagnostic_handler.setLevel(logging.ERROR)
        YFINANCE_LOGGER.addHandler(diagnostic_handler)
        try:
            with contextlib.redirect_stderr(stderr_buffer), contextlib.redirect_stdout(stdout_buffer):
                try:
                    dataset = yf.download(
                        tickers=lookup_ticker,
                        start=start,
                        end=end,
                        period=period,
                        interval=interval,
                        actions=normalize_market_interval(interval) == "1d",
                        auto_adjust=False,
                        prepost=prepost,
                        progress=False,
                        multi_level_index=False,
                        threads=False,
                        timeout=12,
                        session=get_yfinance_session(),
                    )
                except Exception as exc:
                    detail = _yfinance_failure_detail(
                        stderr_value=stderr_buffer.getvalue(),
                        stdout_value=stdout_buffer.getvalue(),
                        log_value=log_buffer.getvalue(),
                        exception=exc,
                    )
                    raise YfinanceDownloadError(
                        f"yfinance request for {lookup_ticker} failed: {detail}"
                    ) from exc
        finally:
            YFINANCE_LOGGER.removeHandler(diagnostic_handler)
            diagnostic_handler.close()

        if dataset is None or dataset.empty:
            detail = _yfinance_failure_detail(
                stderr_value=stderr_buffer.getvalue(),
                stdout_value=stdout_buffer.getvalue(),
                log_value=log_buffer.getvalue(),
            )
            raise YfinanceDownloadError(
                f"yfinance returned no data for {lookup_ticker}: {detail}"
            )
        return dataset


def _load_longbridge_market_settings():
    settings = load_broker_settings()
    if not has_longbridge_market_data_source(settings):
        return None
    return settings


def _load_compare_overnight_market_settings():
    settings = load_broker_settings()
    if has_longbridge_market_data_source(settings):
        return settings

    cli_settings = replace(
        settings,
        selected_broker="longbridge",
        longbridge_auth_mode="cli_oauth",
    )
    try:
        auth_status = get_longbridge_cli_auth_status(cli_settings)
    except Exception:  # noqa: BLE001
        return None
    token_status = str(((auth_status.get("token") or {}).get("status") or "")).strip().lower()
    return cli_settings if token_status == "valid" else None


def _download_one_minute_history_with_longbridge(
        ticker: str,
) -> pd.DataFrame:
    settings = _load_longbridge_market_settings()
    if settings is None:
        raise ValueError(
            f"Unable to fetch 1-minute market data for {ticker}. "
            "Configure Longbridge CLI OAuth or Longbridge legacy credentials in Settings > Broker Access first."
        )
    return fetch_longbridge_one_minute_history(ticker, settings, since=None)


def _download_one_minute_history_with_yfinance_window(
        ticker: str,
        *,
        start: pd.Timestamp,
        end: pd.Timestamp,
) -> pd.DataFrame:
    market = infer_ticker_market(ticker)
    history = _download_daily_history_with_yfinance(
        ticker,
        start=start.to_pydatetime(),
        end=(end + pd.Timedelta(minutes=1)).to_pydatetime(),
        interval="1m",
        prepost=(market != "US"),
    )
    if history.empty:
        return history
    normalized = normalize_history_frame(history, ticker, interval="1m")
    return normalized.loc[
        (normalized["Date"] >= start.tz_convert(None))
        & (normalized["Date"] <= end.tz_convert(None))
    ].copy()


def _download_recent_one_minute_history_with_yfinance(
        ticker: str,
        *,
        days: int = YFINANCE_INTRADAY_FALLBACK_DAYS,
) -> pd.DataFrame:
    window_days = max(1, YFINANCE_INTRADAY_FALLBACK_WINDOW_DAYS)
    now_utc = pd.Timestamp.now(tz="UTC").floor("min")
    start_utc = now_utc - pd.Timedelta(days=max(1, days)) + pd.Timedelta(minutes=1)
    cursor = start_utc
    frames: list[pd.DataFrame] = []

    while cursor < now_utc:
        window_end = min(cursor + pd.Timedelta(days=window_days), now_utc)
        try:
            frame = _download_one_minute_history_with_yfinance_window(
                ticker,
                start=cursor,
                end=window_end,
            )
        except Exception as exc:
            LOGGER.warning(
                "Unable to download 1-minute yfinance window for %s between %s and %s: %s",
                ticker,
                cursor,
                window_end,
                exc,
            )
            frame = pd.DataFrame()
        if not frame.empty:
            frames.append(frame)
        if window_end >= now_utc:
            break
        cursor = window_end - pd.Timedelta(minutes=1)

    if not frames:
        raise ValueError(f"No recent 1-minute market data returned for {ticker} via yfinance.")

    combined = pd.concat(frames, ignore_index=True)
    combined = combined.drop_duplicates(subset=["Date"], keep="last").sort_values("Date")
    if combined.empty:
        raise ValueError(f"No recent 1-minute market data returned for {ticker} via yfinance.")
    return combined.reset_index(drop=True)


def _download_one_minute_history_with_fallback(ticker: str) -> pd.DataFrame:
    """
    Download recent 1-minute history with yfinance as the default source.

    Longbridge is an optional final fallback. Most installations do not have a
    brokerage account, so ordinary market views must never probe Longbridge
    before the free provider has been exhausted.
    """
    normalized_ticker = normalize_ticker(ticker)
    yfinance_errors: list[tuple[int, Exception]] = []
    for days in (
        YFINANCE_INTRADAY_FALLBACK_DAYS,
        YFINANCE_INTRADAY_MINIMUM_FALLBACK_DAYS,
    ):
        try:
            return _download_recent_one_minute_history_with_yfinance(
                normalized_ticker,
                days=days,
            )
        except Exception as exc:
            yfinance_errors.append((days, exc))

    longbridge_error: Exception | None = None
    if _load_longbridge_market_settings() is not None:
        for attempt in range(DOWNLOAD_RETRY_ATTEMPTS):
            delay = (
                DOWNLOAD_RETRY_DELAYS_SECONDS[attempt]
                if attempt < len(DOWNLOAD_RETRY_DELAYS_SECONDS)
                else DOWNLOAD_RETRY_DELAYS_SECONDS[-1]
            )
            if delay > 0:
                sleep(delay)
            try:
                return _download_one_minute_history_with_longbridge(normalized_ticker)
            except Exception as exc:
                longbridge_error = exc

    failure_details = [
        f"yfinance {days}-day request failed: {error}"
        for days, error in yfinance_errors
    ]
    if longbridge_error is not None:
        failure_details.append(f"optional Longbridge fallback failed: {longbridge_error}")
    detail = ". ".join(failure_details)
    raise ValueError(
        f"Unable to download 1-minute market data for {normalized_ticker}. {detail}."
    ) from (longbridge_error or yfinance_errors[-1][1])


def infer_ticker_market(ticker: str) -> str:
    normalized_ticker = normalize_ticker(ticker)
    if normalized_ticker.endswith(".HK"):
        return "HK"
    if normalized_ticker.endswith((".KS", ".KQ")):
        return "KR"
    if normalized_ticker.endswith((".T", ".JP")):
        return "JP"
    if normalized_ticker.endswith((".SH", ".SS", ".SZ")):
        return "CN"
    if normalized_ticker.endswith((".SG", ".SI")):
        return "SG"
    if normalized_ticker.endswith(".L"):
        return "UK"
    if normalized_ticker.endswith(".AX"):
        return "AU"
    if normalized_ticker.endswith((".TO", ".V", ".NE", ".CN", ".CA")):
        return "CA"
    if normalized_ticker.endswith((".PA", ".AS", ".BR", ".MI", ".MC", ".DE", ".F", ".HM", ".BE", ".DU", ".MU", ".HA", ".SW", ".VI", ".ST", ".CO", ".OL", ".IR", ".IS")):
        return "EU"
    if normalized_ticker.endswith(".HE"):
        return "FI"
    if normalized_ticker.endswith((".NS", ".BO")):
        return "IN"
    if normalized_ticker.endswith((".TW", ".TWO")):
        return "TW"
    if normalized_ticker.endswith(".KL"):
        return "MY"
    if normalized_ticker.endswith(".BK"):
        return "TH"
    if normalized_ticker.endswith(".JK"):
        return "ID"
    if normalized_ticker.endswith(".NZ"):
        return "NZ"
    if normalized_ticker.endswith(".SA"):
        return "BR"
    if normalized_ticker.endswith((".BA", ".MX")):
        return "LATAM"
    if normalized_ticker.endswith(".TA"):
        return "IL"
    if normalized_ticker.endswith((".SR", ".SE")):
        return "SA"
    if normalized_ticker.endswith(".JO"):
        return "ZA"
    if normalized_ticker.endswith(".QA"):
        return "QA"
    return "US"


def supports_compare_extended_hours(tickers: list[str], period: str) -> bool:
    normalized_tickers = [normalize_ticker(ticker) for ticker in tickers if str(ticker or "").strip()]
    return (
        bool(normalized_tickers)
        and str(period or "").strip().lower() == "1d"
        and any(infer_ticker_market(ticker) == "US" for ticker in normalized_tickers)
    )


def canonical_compare_overnight_ticker(ticker: str) -> str:
    normalized = normalize_ticker(ticker)
    return COMPARE_OVERNIGHT_CANONICAL_SYMBOLS.get(normalized, normalized)


def resolve_compare_overnight_tickers(tickers: list[str]) -> list[str]:
    """Return canonical chart symbols and add known US overnight companions."""
    requested = [normalize_ticker(ticker) for ticker in tickers if str(ticker or "").strip()]
    resolved: list[str] = []
    for ticker in requested:
        canonical = canonical_compare_overnight_ticker(ticker)
        if canonical not in resolved:
            resolved.append(canonical)
    for ticker in requested:
        companion = COMPARE_OVERNIGHT_COMPANION_SYMBOLS.get(ticker)
        if companion and companion not in resolved:
            resolved.append(companion)
    return resolved


def supports_compare_overnight(tickers: list[str], period: str) -> bool:
    resolved_tickers = resolve_compare_overnight_tickers(tickers)
    return (
        bool(resolved_tickers)
        and str(period or "").strip().lower() == "1d"
        and any(infer_ticker_market(ticker) == "US" for ticker in resolved_tickers)
    )


def has_compare_overnight_market_data_source() -> bool:
    """Return whether the application can attempt the overnight companion path."""
    if callable(getattr(yf, "download", None)):
        return True
    return _load_compare_overnight_market_settings() is not None


def market_timezone_for_ticker(ticker: str) -> str:
    market = infer_ticker_market(ticker)
    if market == "HK":
        return HONG_KONG_TIMEZONE
    if market == "KR":
        return "Asia/Seoul"
    if market == "JP":
        return "Asia/Tokyo"
    if market == "CN":
        return "Asia/Shanghai"
    if market == "UK":
        return "Europe/London"
    if market == "SG":
        return "Asia/Singapore"
    if market == "AU":
        return "Australia/Sydney"
    if market == "CA":
        return "America/Toronto"
    if market == "EU":
        return "Europe/Paris"
    if market == "FI":
        return "Europe/Helsinki"
    if market == "IN":
        return "Asia/Kolkata"
    if market == "TW":
        return "Asia/Taipei"
    if market == "MY":
        return "Asia/Kuala_Lumpur"
    if market == "TH":
        return "Asia/Bangkok"
    if market == "ID":
        return "Asia/Jakarta"
    if market == "NZ":
        return "Pacific/Auckland"
    if market == "BR":
        return "America/Sao_Paulo"
    if market == "LATAM":
        return "America/Mexico_City"
    if market == "IL":
        return "Asia/Jerusalem"
    if market == "SA":
        return "Asia/Riyadh"
    if market == "ZA":
        return "Africa/Johannesburg"
    if market == "QA":
        return "Asia/Qatar"
    return NEW_YORK_TIMEZONE


def fetch_one_minute_history_for_trading_date(
        ticker: str,
        trading_date: object,
        *,
        include_dividends: bool = False,
        dividend_mode: str | None = None,
) -> pd.DataFrame:
    normalized_ticker = normalize_ticker(ticker)
    target_date = pd.to_datetime(trading_date, errors="coerce")
    if pd.isna(target_date):
        raise ValueError(f"Invalid trading date for {normalized_ticker}: {trading_date}.")

    market_timezone = market_timezone_for_ticker(normalized_ticker)
    local_start = pd.Timestamp(
        year=int(target_date.year),
        month=int(target_date.month),
        day=int(target_date.day),
        tz=market_timezone,
    )
    local_end = local_start + pd.Timedelta(days=1)
    history = _download_daily_history_with_yfinance(
        normalized_ticker,
        start=local_start.tz_convert("UTC").to_pydatetime(),
        end=local_end.tz_convert("UTC").to_pydatetime(),
        interval="1m",
        prepost=infer_ticker_market(normalized_ticker) != "US",
    )
    if history.empty:
        raise ValueError(f"No 1-minute market data returned for {normalized_ticker} on {target_date.date()} via yfinance.")

    normalized_dataset = normalize_history_frame(history, normalized_ticker, interval="1m")
    return select_price_series(
        normalized_dataset,
        include_dividends,
        dividend_mode=dividend_mode,
    )


def classify_hk_equity_session(timestamp: pd.Timestamp | datetime | str) -> str:
    """Classify a Hong Kong equity bar timestamp into intraday or off."""
    parsed_timestamp = pd.to_datetime(timestamp, errors="coerce")
    if pd.isna(parsed_timestamp):
        return "off"
    localized = parsed_timestamp
    if localized.tzinfo is None:
        localized = localized.tz_localize(HONG_KONG_TIMEZONE)
    else:
        localized = localized.tz_convert(HONG_KONG_TIMEZONE)
    weekday = int(localized.weekday())
    if weekday >= 5:
        return "off"
    total_minutes = (int(localized.hour) * 60) + int(localized.minute)
    morning_open = (9 * 60) + 30
    morning_close = 12 * 60
    afternoon_open = 13 * 60
    afternoon_close = 16 * 60
    if morning_open <= total_minutes < morning_close:
        return "intraday"
    if afternoon_open <= total_minutes < afternoon_close:
        return "intraday"
    return "off"


def classify_kr_equity_session(timestamp: pd.Timestamp | datetime | str) -> str:
    """Classify a South Korean equity bar timestamp into intraday or off."""
    parsed_timestamp = pd.to_datetime(timestamp, errors="coerce")
    if pd.isna(parsed_timestamp):
        return "off"
    localized = parsed_timestamp
    if localized.tzinfo is None:
        localized = localized.tz_localize("Asia/Seoul")
    else:
        localized = localized.tz_convert("Asia/Seoul")
    if int(localized.weekday()) >= 5:
        return "off"
    total_minutes = (int(localized.hour) * 60) + int(localized.minute)
    regular_open = 9 * 60
    regular_close = (15 * 60) + 30
    if regular_open <= total_minutes < regular_close:
        return "intraday"
    return "off"


def classify_us_equity_session(timestamp: pd.Timestamp | datetime | str) -> str:
    """Classify a US equity bar timestamp into overnight, pre, intraday, post, or off."""
    parsed_timestamp = pd.to_datetime(timestamp, errors="coerce")
    if pd.isna(parsed_timestamp):
        return "off"
    localized = parsed_timestamp
    if localized.tzinfo is not None:
        localized = localized.tz_convert(NEW_YORK_TIMEZONE).tz_localize(None)
    weekday = int(localized.weekday())
    total_minutes = (int(localized.hour) * 60) + int(localized.minute)
    regular_open = (9 * 60) + 30
    regular_close = 16 * 60
    premarket_open = 4 * 60
    postmarket_close = 20 * 60
    if (
            (total_minutes >= postmarket_close and weekday in {0, 1, 2, 3, 6})
            or (total_minutes < premarket_open and weekday in {0, 1, 2, 3, 4})
    ):
        return "overnight"
    if weekday >= 5:
        return "off"
    if regular_open <= total_minutes < regular_close:
        return "intraday"
    if premarket_open <= total_minutes < regular_open:
        return "pre"
    if regular_close <= total_minutes < postmarket_close:
        return "post"
    return "off"


def fetch_yfinance_realtime_quote(ticker: str) -> dict[str, object]:
    """
    Fetch the latest yfinance 1-minute quote including pre-market and post-market bars.

    The result is intentionally not written to the local parquet store because
    the investment overview uses it as a live mark-to-market point, not as an
    official daily close.
    """
    normalized_ticker = normalize_ticker(ticker)
    history = _download_daily_history_with_yfinance(
        normalized_ticker,
        period="1d",
        interval="1m",
        prepost=True,
    )
    if history is None or history.empty:
        raise ValueError(f"No realtime 1-minute quote returned for {normalized_ticker} via yfinance.")

    normalized = normalize_history_frame(history, normalized_ticker, interval="1m")
    if normalized.empty:
        raise ValueError(f"No realtime 1-minute quote returned for {normalized_ticker} via yfinance.")

    latest_row = normalized.sort_values("Date").iloc[-1]
    latest_timestamp = pd.to_datetime(latest_row["Date"], errors="coerce")
    latest_close = float(latest_row["Close"])
    if pd.isna(latest_timestamp) or not math.isfinite(latest_close):
        raise ValueError(f"No usable realtime 1-minute quote returned for {normalized_ticker} via yfinance.")

    market = infer_ticker_market(normalized_ticker)
    if market == "HK":
        localized_timestamp = (
            pd.Timestamp(latest_timestamp)
            .tz_localize(NEW_YORK_TIMEZONE)
            .tz_convert(HONG_KONG_TIMEZONE)
        )
        session = classify_hk_equity_session(localized_timestamp)
        display_timestamp = localized_timestamp.strftime("%Y-%m-%d %H:%M")
        session_date = localized_timestamp.strftime("%Y-%m-%d")
    else:
        session = classify_us_equity_session(latest_timestamp)
        display_timestamp = pd.Timestamp(latest_timestamp).strftime("%Y-%m-%d %H:%M")
        session_date = pd.Timestamp(latest_timestamp).strftime("%Y-%m-%d")

    return {
        "ticker": normalized_ticker,
        "price": latest_close,
        "timestamp": display_timestamp,
        "session": session,
        "session_date": session_date,
        "market": market,
        "source": "yfinance",
    }


def fetch_compare_one_day_extended_history(ticker: str) -> pd.DataFrame:
    """
    Fetch recent 1-minute OHLC bars with US extended hours for the compare 1d chart.

    The result is intentionally not written to the local 1-minute store because
    this is a chart-specific view that needs pre-market and post-market bars.
    """
    normalized_ticker = canonical_compare_overnight_ticker(ticker)
    last_error: Exception | None = None
    for provider_ticker in market_ticker_store_aliases(normalized_ticker):
        try:
            history = _download_daily_history_with_yfinance(
                provider_ticker,
                period="5d",
                interval="1m",
                prepost=True,
            )
            if history is None or history.empty:
                raise ValueError(
                    f"No extended-hours 1-minute data returned for {provider_ticker} via yfinance."
                )
            normalized = normalize_history_frame(history, normalized_ticker, interval="1m")
            result = select_price_series(
                normalized,
                include_dividends=False,
                dividend_mode="price",
            )
            result.attrs["market_data_source"] = "yfinance_extended_fallback"
            result.attrs["provider_ticker"] = provider_ticker
            return result
        except (ImportError, OSError, ValueError, KeyError, TypeError) as exc:
            last_error = exc
            LOGGER.info(
                "Unable to load yfinance extended-hours bars for %s via alias %s: %s",
                normalized_ticker,
                provider_ticker,
                exc,
            )
    raise ValueError(
        f"No extended-hours 1-minute data returned for {normalized_ticker} via yfinance aliases."
    ) from last_error


def fetch_compare_one_day_overnight_history(
        ticker: str,
        *,
        include_extended_hours: bool = True,
) -> pd.DataFrame:
    """Fetch the continuous US full session, with yfinance as the fallback."""
    normalized_ticker = canonical_compare_overnight_ticker(ticker)
    settings = _load_compare_overnight_market_settings()
    if settings is not None:
        try:
            history = fetch_longbridge_compare_one_day_history(normalized_ticker, settings)
            allowed_sessions = {"intraday", "normal", "overnight"}
            if include_extended_hours:
                allowed_sessions.update({"pre", "post"})
            if "Session" in history.columns:
                session_values = history["Session"].astype(str).str.strip().str.lower()
                history = history.loc[session_values.isin(allowed_sessions)].copy()
            if history.empty:
                raise ValueError(
                    f"No enabled-session 1-minute data returned for {normalized_ticker} via Longbridge."
                )
            result = select_price_series(
                history,
                include_dividends=False,
                dividend_mode="price",
            )
            result.attrs["market_data_source"] = "longbridge_overnight"
            result.attrs["provider_ticker"] = normalized_ticker
            return result
        except Exception as exc:  # noqa: BLE001
            LOGGER.warning(
                "Unable to load Longbridge overnight bars for %s; using yfinance extended-hours fallback: %s",
                normalized_ticker,
                exc,
            )

    return fetch_compare_one_day_extended_history(normalized_ticker)


def fetch_yfinance_realtime_quotes(tickers: list[str]) -> list[dict[str, object]]:
    """
    Fetch realtime quotes in one batch, then retry missing tickers individually.

    yfinance can return a partial or differently shaped batch on some platforms.
    Per-ticker recovery prevents one malformed Windows batch from appearing as
    many unrelated quote failures.
    """
    if not tickers:
        return []
    normalized_list = list(dict.fromkeys(
        normalize_ticker(t) for t in tickers if str(t or "").strip()
    ))
    if not normalized_list:
        return []
    results: list[dict[str, object]] = []
    try:
        history = _download_daily_history_with_yfinance(
            normalized_list,
            period="1d",
            interval="1m",
            prepost=True,
        )
        is_multi = history is not None and isinstance(history.columns, pd.MultiIndex)
        batch_tickers = normalized_list if is_multi or len(normalized_list) == 1 else []
        for normalized_ticker in batch_tickers:
            lookup_ticker = yfinance_lookup_symbol(normalized_ticker)
            try:
                if is_multi:
                    # yfinance multi-ticker result usually has MultiIndex columns:
                    # level 0 = field (Close, etc), level 1 = ticker
                    try:
                        tdf = history.xs(lookup_ticker, level=1, axis=1)
                    except (KeyError, AttributeError):
                        try:
                            tdf = history.xs(normalized_ticker, level=1, axis=1)
                        except (KeyError, AttributeError):
                            try:
                                tdf = history[lookup_ticker]
                            except (KeyError, TypeError):
                                try:
                                    tdf = history[normalized_ticker]
                                except (KeyError, TypeError):
                                    continue
                else:
                    tdf = history
                if tdf.empty:
                    continue
                normalized = normalize_history_frame(tdf, normalized_ticker, interval="1m")
                if normalized.empty:
                    continue
                latest_row = normalized.sort_values("Date").iloc[-1]
                latest_timestamp = pd.to_datetime(latest_row["Date"], errors="coerce")
                latest_close = float(latest_row["Close"])
                if pd.isna(latest_timestamp) or not math.isfinite(latest_close):
                    continue
                market = infer_ticker_market(normalized_ticker)
                if market == "HK":
                    localized_timestamp = (
                        pd.Timestamp(latest_timestamp)
                        .tz_localize(NEW_YORK_TIMEZONE)
                        .tz_convert(HONG_KONG_TIMEZONE)
                    )
                    session = classify_hk_equity_session(localized_timestamp)
                    display_timestamp = localized_timestamp.strftime("%Y-%m-%d %H:%M")
                    session_date = localized_timestamp.strftime("%Y-%m-%d")
                else:
                    session = classify_us_equity_session(latest_timestamp)
                    display_timestamp = pd.Timestamp(latest_timestamp).strftime("%Y-%m-%d %H:%M")
                    session_date = pd.Timestamp(latest_timestamp).strftime("%Y-%m-%d")
                results.append({
                    "ticker": normalized_ticker,
                    "price": latest_close,
                    "timestamp": display_timestamp,
                    "session": session,
                    "session_date": session_date,
                    "market": market,
                    "source": "yfinance",
                })
            except Exception:  # noqa: BLE001
                continue
    except Exception as exc:  # noqa: BLE001
        LOGGER.warning("Unable to download batched yfinance realtime quotes: %s", exc)

    resolved_tickers = {str(item.get("ticker") or "") for item in results}
    for normalized_ticker in normalized_list:
        if normalized_ticker in resolved_tickers:
            continue
        try:
            results.append(fetch_yfinance_realtime_quote(normalized_ticker))
        except Exception as exc:  # noqa: BLE001
            LOGGER.warning(
                "Unable to download yfinance realtime quote for %s after batch recovery: %s",
                normalized_ticker,
                exc,
            )
    return results


def _upsert_one_minute_store(ticker: str, dataset: pd.DataFrame) -> Path:
    normalized_ticker = normalize_ticker(ticker)
    ensure_market_store_dir()
    path = intraday_history_store_path_for(normalized_ticker, "1m")
    normalized_dataset = normalize_one_minute_store_frame(dataset, normalized_ticker)
    if normalized_dataset.empty:
        raise ValueError(f"No 1-minute market data returned for {normalized_ticker}.")

    with market_store_file_lock(path):
        if path.exists():
            try:
                existing_df = normalize_one_minute_store_frame(pd.read_parquet(path), normalized_ticker)
            except (ImportError, OSError, ValueError, KeyError) as exc:
                LOGGER.warning("Unable to read existing 1-minute store for %s from %s: %s", normalized_ticker, path, exc)
                existing_df = pd.DataFrame()
            if not existing_df.empty:
                normalized_dataset = pd.concat([existing_df, normalized_dataset], ignore_index=True)
                normalized_dataset = normalized_dataset.drop_duplicates(subset=["Date"], keep="last").sort_values("Date")

        cut_off = one_minute_lookback_start().tz_convert("America/New_York").tz_localize(None)
        normalized_dataset = normalized_dataset.loc[normalized_dataset["Date"] >= cut_off].copy()
        write_parquet_atomic(path, normalized_dataset, index=False)
    return path


def _download_daily_history_with_longbridge(
        ticker: str,
        *,
        start: str | None = None,
) -> pd.DataFrame:
    settings = _load_longbridge_market_settings()
    if settings is None:
        raise ValueError(
            f"Unable to fetch 1-day market data for {ticker}. "
            "Configure Longbridge App Key, App Secret, and Access Token in Settings > Broker Access first."
        )
    since = pd.to_datetime(start, errors="coerce") if start else None
    if since is not None and pd.isna(since):
        since = None
    since_dt = since.to_pydatetime() if since is not None else None
    return fetch_longbridge_daily_history(ticker, settings, since=since_dt)


def _daily_history_period_candidates(
        *,
        start: str | None = None,
        period: str | None = None,
) -> list[str | None]:
    if start is not None:
        return [None]
    if period is None or period == "max":
        return list(DAILY_HISTORY_PERIOD_FALLBACKS)
    return [period]


def _download_daily_history_with_fallback(
        ticker: str,
        *,
        start: str | None = None,
        period: str | None = None,
) -> pd.DataFrame:
    candidate_periods = _daily_history_period_candidates(start=start, period=period)
    yfinance_errors: list[tuple[str | None, Exception]] = []
    for candidate_period in candidate_periods:
        try:
            dataset = _download_daily_history_with_yfinance(
                ticker,
                start=start,
                period=candidate_period,
                interval="1d",
            )
            return dataset
        except Exception as exc:
            yfinance_errors.append((candidate_period, exc))

    yahoo_chart_errors: list[tuple[str | None, Exception]] = []
    lookup_ticker = yfinance_lookup_symbol(ticker)
    for candidate_period in candidate_periods:
        try:
            return download_yahoo_chart_daily_history(
                lookup_ticker,
                start=start,
                period=candidate_period,
            )
        except Exception as exc:
            yahoo_chart_errors.append((candidate_period, exc))

    last_yfinance_error = yfinance_errors[-1][1]
    last_yahoo_chart_error = yahoo_chart_errors[-1][1]
    yahoo_failure_detail = (
        f"yfinance failed after {len(yfinance_errors)} request(s): {last_yfinance_error}. "
        f"Direct Yahoo Chart fallback failed after {len(yahoo_chart_errors)} request(s): "
        f"{last_yahoo_chart_error}"
    )

    settings = _load_longbridge_market_settings()
    if settings is None:
        raise ValueError(
            f"Unable to fetch 1-day market data for {ticker} from Yahoo. "
            f"{yahoo_failure_detail}. Optional Longbridge fallback is not configured."
        ) from last_yahoo_chart_error

    try:
        return _download_daily_history_with_longbridge(ticker, start=start)
    except Exception as exc:
        raise ValueError(
            f"Unable to fetch 1-day market data for {ticker}. {yahoo_failure_detail}. "
            f"Optional Longbridge fallback also failed: {exc}"
        ) from exc


def drop_duplicate_columns(frame: pd.DataFrame) -> pd.DataFrame:
    if not frame.columns.has_duplicates:
        return frame
    return frame.loc[:, ~frame.columns.duplicated()].copy()


def _normalize_store_frame_for_compare(frame: pd.DataFrame) -> pd.DataFrame:
    normalized = drop_duplicate_columns(frame.copy())
    if "Date" in normalized.columns:
        normalized["Date"] = pd.to_datetime(normalized["Date"], errors="coerce")
    normalized = normalized.sort_values("Date").reset_index(drop=True)
    return normalized


def _infer_split_factor(previous_close: float, current_prices: list[float]) -> float | None:
    valid_prices = [float(value) for value in current_prices if pd.notna(value) and float(value) > 0]
    if not math.isfinite(previous_close) or previous_close <= 0 or not valid_prices:
        return None

    observed_ratios = [previous_close / value for value in valid_prices if value > 0]
    if not observed_ratios:
        return None

    observed_ratio = math.exp(sum(math.log(ratio) for ratio in observed_ratios) / len(observed_ratios))
    raw_distance = abs(math.log(observed_ratio))
    if raw_distance < SPLIT_MIN_EVENT_DISTANCE:
        return None

    best_factor = 1.0
    best_distance = math.inf
    for candidate in SPLIT_FACTOR_CANDIDATES:
        distance = abs(math.log(observed_ratio / candidate))
        if distance < best_distance:
            best_distance = distance
            best_factor = candidate

    materially_different = abs(math.log(best_factor)) >= SPLIT_MIN_EVENT_DISTANCE
    confidently_matched = best_distance <= SPLIT_MATCH_TOLERANCE
    meaningfully_improved = best_distance + SPLIT_MIN_IMPROVEMENT < raw_distance
    if not materially_different or not confidently_matched or not meaningfully_improved:
        return None
    return best_factor


def _apply_inferred_split_adjustments(dataset: pd.DataFrame) -> pd.DataFrame:
    """
    Standardize raw broker bars onto a split-adjusted share basis when the
    source does not provide an adjusted close column.
    """
    if dataset.empty or "Adj Close" in dataset.columns or "Close" not in dataset.columns or len(dataset) < 2:
        return dataset

    event_factors = [1.0] * len(dataset)
    for index in range(1, len(dataset)):
        previous_close = dataset.iloc[index - 1].get("Close")
        current_open = dataset.iloc[index].get("Open")
        current_close = dataset.iloc[index].get("Close")
        factor = _infer_split_factor(float(previous_close), [current_open, current_close])
        if factor is not None:
            event_factors[index] = factor

    if all(abs(factor - 1.0) < 1e-9 for factor in event_factors):
        return dataset

    adjusted = dataset.copy()
    suffix_products = pd.Series(event_factors, dtype="float64").iloc[::-1].cumprod().iloc[::-1].tolist()
    divisors = pd.Series([*suffix_products[1:], 1.0], index=adjusted.index, dtype="float64")
    for column in ("Open", "High", "Low", "Close"):
        if column in adjusted.columns:
            adjusted[column] = pd.to_numeric(adjusted[column], errors="coerce") / divisors
    return adjusted


def normalize_history_frame(history: pd.DataFrame, ticker: str, interval: str = "1d") -> pd.DataFrame:
    interval = normalize_market_interval(interval)
    if history.empty:
        raise ValueError(f"No market data returned for {ticker}.")
    if isinstance(history.columns, pd.MultiIndex):
        history.columns = history.columns.get_level_values(0)

    history = history.reset_index()
    history = drop_duplicate_columns(history)
    if "Date" not in history.columns and "Datetime" in history.columns:
        history = history.rename(columns={"Datetime": "Date"})

    required_columns = ["Date", "Close"]
    ohlc_columns = ["Open", "High", "Low", "Adj Close", "Dividends"]
    missing_required = [column for column in required_columns if column not in history.columns]
    if missing_required:
        raise ValueError(f"Missing required columns for {ticker}: {', '.join(missing_required)}.")

    all_to_keep = required_columns + [col for col in ohlc_columns if col in history.columns]
    dataset = drop_duplicate_columns(history[all_to_keep].copy())
    if is_intraday_market_interval(interval):
        dates = pd.to_datetime(dataset["Date"], utc=True)
        dataset["Date"] = dates.dt.tz_convert(NEW_YORK_TIMEZONE).dt.tz_localize(None)
    else:
        dataset["Date"] = pd.to_datetime(dataset["Date"], utc=True).dt.tz_convert(None)
    for col in (ohlc_columns + ["Close"]):
        if col in dataset.columns:
            dataset[col] = pd.to_numeric(dataset[col], errors="coerce")

    subset_for_drop = ["Date", "Close"]
    if "Adj Close" in dataset.columns:
        subset_for_drop.append("Adj Close")
    if "Dividends" in dataset.columns:
        dataset["Dividends"] = dataset["Dividends"].fillna(0.0)
    dataset = dataset.dropna(subset=subset_for_drop).sort_values("Date").reset_index(drop=True)
    return _apply_inferred_split_adjustments(dataset)


def _daily_history_has_incomplete_dividend_actions(dataset: pd.DataFrame) -> bool:
    if "Dividends" not in dataset.columns:
        return True
    required_columns = {"Date", "Close", "Adj Close"}
    if dataset.empty or not required_columns.issubset(dataset.columns):
        return False

    prepared = dataset[["Date", "Close", "Adj Close", "Dividends"]].copy()
    prepared["Date"] = pd.to_datetime(prepared["Date"], errors="coerce")
    prepared["Close"] = pd.to_numeric(prepared["Close"], errors="coerce")
    prepared["Adj Close"] = pd.to_numeric(prepared["Adj Close"], errors="coerce")
    prepared["Dividends"] = pd.to_numeric(prepared["Dividends"], errors="coerce").fillna(0.0)
    prepared = prepared.dropna(subset=["Date", "Close", "Adj Close"]).sort_values("Date")
    prepared = prepared[(prepared["Close"] > 0) & (prepared["Adj Close"] > 0)]
    if len(prepared) < 2:
        return False

    cutoff = pd.Timestamp(prepared["Date"].max()) - pd.Timedelta(days=DIVIDEND_ACTION_LOOKBACK_DAYS)
    trailing = prepared[prepared["Date"] >= cutoff].copy()
    if len(trailing) < 2:
        return False

    adjustment_ratio = trailing["Adj Close"] / trailing["Close"]
    material_adjustment = adjustment_ratio.pct_change().abs() > DIVIDEND_ADJUSTMENT_SHIFT_TOLERANCE
    missing_cash_action = trailing["Dividends"] <= 0
    return bool((material_adjustment & missing_cash_action).any())


def _build_cash_dividend_close_series(dataset: pd.DataFrame) -> pd.Series:
    close = pd.to_numeric(dataset["Close"], errors="coerce").astype("float64")
    if "Dividends" not in dataset.columns:
        return close
    dividends = pd.to_numeric(dataset["Dividends"], errors="coerce").fillna(0.0).astype("float64")
    cumulative_cash = dividends.copy()
    if not cumulative_cash.empty:
        cumulative_cash.iloc[0] = 0.0
    cumulative_cash = cumulative_cash.cumsum()
    return close + cumulative_cash


def _build_reinvested_dividend_close_series(dataset: pd.DataFrame) -> pd.Series:
    close = pd.to_numeric(dataset["Close"], errors="coerce").astype("float64")
    if "Dividends" not in dataset.columns or not (pd.to_numeric(dataset["Dividends"], errors="coerce").fillna(0.0) > 0).any():
        return pd.to_numeric(dataset["Adj Close"], errors="coerce").astype("float64") if "Adj Close" in dataset.columns else close

    dividends = pd.to_numeric(dataset["Dividends"], errors="coerce").fillna(0.0).astype("float64")
    shares = 1.0
    values: list[float] = []
    for index, close_price in enumerate(close.tolist()):
        dividend_per_share = float(dividends.iloc[index])
        if index > 0 and dividend_per_share > 0 and close_price > 0:
            shares += (shares * dividend_per_share) / close_price
        values.append(shares * close_price)
    return pd.Series(values, index=dataset.index, dtype="float64")


def select_price_series(
        dataset: pd.DataFrame,
        include_dividends: bool,
        dividend_mode: str | None = None,
) -> pd.DataFrame:
    normalized_dividend_mode = str(dividend_mode or ("reinvest" if include_dividends else "cash")).strip().lower()
    price_column = "Close"
    cols = ["Date", "Open", "High", "Low", price_column, "Dividends"]
    available_cols = [c for c in cols if c in dataset.columns]
    result = dataset[available_cols].copy()
    if normalized_dividend_mode == "reinvest":
        result["Close"] = _build_reinvested_dividend_close_series(dataset)
    elif normalized_dividend_mode == "cash":
        result["Close"] = _build_cash_dividend_close_series(dataset)
    return result


def download_full_history(ticker: str, interval: str = "1d") -> pd.DataFrame:
    normalized_ticker = normalize_ticker(ticker)
    normalized_interval = normalize_market_interval(interval)
    if is_intraday_market_interval(normalized_interval):
        return _download_one_minute_history_with_fallback(normalized_ticker)
    return _download_daily_history_with_fallback(
        normalized_ticker,
        period="max",
    )


def fetch_history(
        ticker: str,
        include_dividends: bool,
        interval: str = "1d",
        dividend_mode: str | None = None,
) -> pd.DataFrame:
    normalized_ticker = normalize_ticker(ticker)
    normalized_interval = normalize_market_interval(interval)
    ensure_market_store_dir()
    path = next(
        (
            candidate_path
            for candidate in market_ticker_store_aliases(normalized_ticker)
            if (candidate_path := history_store_path_for_interval(candidate, normalized_interval)).exists()
            and candidate_path.stat().st_size > 0
        ),
        history_store_path_for_interval(normalized_ticker, normalized_interval),
    )
    if path.exists():
        should_refresh_for_dividends = False
        with market_store_file_lock(path):
            dataset = pd.read_parquet(path)
            if is_intraday_market_interval(normalized_interval):
                normalized_intraday = normalize_one_minute_store_frame(dataset, normalized_ticker)
                if not normalized_intraday.equals(dataset):
                    write_parquet_atomic(path, normalized_intraday, index=False)
                dataset = normalized_intraday
            else:
                should_refresh_for_dividends = _daily_history_has_incomplete_dividend_actions(dataset)
                dataset = normalize_history_frame(dataset, normalized_ticker, interval=normalized_interval)
        if should_refresh_for_dividends:
            try:
                refresh_history_store(normalized_ticker, force_full=True)
                with market_store_file_lock(path):
                    dataset = normalize_history_frame(pd.read_parquet(path), normalized_ticker, interval=normalized_interval)
            except Exception as exc:
                LOGGER.warning("Unable to refresh dividend actions for %s at %s: %s", normalized_ticker, path, exc)
        return select_price_series(dataset, include_dividends, dividend_mode=dividend_mode)

    history = download_full_history(normalized_ticker, interval=normalized_interval)
    normalized_dataset = normalize_history_frame(history, normalized_ticker, interval=normalized_interval)
    with market_store_file_lock(path):
        write_parquet_atomic(path, normalized_dataset, index=False)
    return select_price_series(normalized_dataset, include_dividends, dividend_mode=dividend_mode)


def refresh_history_store(ticker: str, *, force_full: bool = False) -> Path:
    normalized_ticker = normalize_ticker(ticker)
    ensure_market_store_dir()

    path = history_store_path_for(normalized_ticker)

    start_date = None
    existing_df = None
    with market_store_file_lock(path):
        if path.exists() and not force_full:
            try:
                existing_df = normalize_history_frame(pd.read_parquet(path), normalized_ticker)
                if not existing_df.empty:
                    # Get the max date and go back 1 day to ensure overlap and consistency
                    max_date = pd.to_datetime(existing_df["Date"].max())
                    start_date = (max_date - pd.Timedelta(days=1)).strftime("%Y-%m-%d")
            except (ImportError, OSError, ValueError, KeyError, TypeError) as exc:
                LOGGER.warning("Unable to inspect existing daily history store for %s at %s: %s", normalized_ticker, path, exc)
                existing_df = None

    if start_date:
        # Incremental download logic
        try:
            new_history = _download_daily_history_with_fallback(
                normalized_ticker,
                start=start_date,
            )
            if not new_history.empty:
                new_df = normalize_history_frame(new_history, normalized_ticker)
                if existing_df is not None:
                    with market_store_file_lock(path):
                        try:
                            latest_existing = normalize_history_frame(pd.read_parquet(path), normalized_ticker) if path.exists() else existing_df
                        except (ImportError, OSError, ValueError, KeyError, TypeError) as exc:
                            LOGGER.warning("Unable to re-read daily history store for %s at %s: %s", normalized_ticker, path, exc)
                            latest_existing = existing_df

                        existing_normalized = latest_existing.reset_index(drop=True)
                        existing_max_date = pd.to_datetime(existing_normalized["Date"].max(), errors="coerce")
                        new_max_date = pd.to_datetime(new_df["Date"].max(), errors="coerce")
                        if pd.notna(existing_max_date) and pd.notna(new_max_date) and new_max_date <= existing_max_date:
                            return path

                        # Merge and drop duplicates, keeping newer data for the overlap
                        combined = pd.concat([existing_normalized, new_df])
                        combined = combined.drop_duplicates(subset=["Date"], keep="last").sort_values("Date")
                        if not combined.reset_index(drop=True).equals(existing_normalized):
                            write_parquet_atomic(path, combined, index=False)
                    return path
        except Exception as exc:
            # Fallback to full download if incremental fails
            LOGGER.warning("Incremental daily history refresh failed for %s; falling back to full download: %s", normalized_ticker, exc)

    # Fallback / Initial download
    history = download_full_history(normalized_ticker)
    normalized_dataset = normalize_history_frame(history, normalized_ticker)
    with market_store_file_lock(path):
        write_parquet_atomic(path, normalized_dataset, index=False)
    return path


def refresh_one_minute_store(ticker: str) -> OneMinuteRefreshResult:
    normalized_ticker = normalize_ticker(ticker)
    yfinance_errors: list[tuple[int, Exception]] = []
    for days in (
        YFINANCE_INTRADAY_FALLBACK_DAYS,
        YFINANCE_INTRADAY_MINIMUM_FALLBACK_DAYS,
    ):
        try:
            dataset = _download_recent_one_minute_history_with_yfinance(
                normalized_ticker,
                days=days,
            )
            path = _upsert_one_minute_store(normalized_ticker, dataset)
            return OneMinuteRefreshResult(
                path=path,
                source=f"yfinance_{days}d",
                fetched_days=days,
            )
        except Exception as exc:
            yfinance_errors.append((days, exc))

    longbridge_error: Exception | None = None
    settings = _load_longbridge_market_settings()
    if settings is not None:
        try:
            refresh_longbridge_one_minute_store(normalized_ticker, settings)
            return OneMinuteRefreshResult(
                path=intraday_history_store_path_for(normalized_ticker, "1m"),
                source="longbridge_fallback",
                fetched_days=180,
            )
        except Exception as exc:
            longbridge_error = exc

    detail = ". ".join([
        *(
            f"yfinance {days}-day request failed: {error}"
            for days, error in yfinance_errors
        ),
        *(
            [f"optional Longbridge fallback failed: {longbridge_error}"]
            if longbridge_error is not None
            else []
        ),
    ])
    raise ValueError(
        f"Unable to refresh 1-minute market data for {normalized_ticker}. {detail}."
    ) from (longbridge_error or yfinance_errors[-1][1])


def refresh_recent_one_minute_store_with_yfinance(
        ticker: str,
        *,
        days: int = YFINANCE_INTRADAY_FALLBACK_DAYS,
) -> OneMinuteRefreshResult:
    normalized_ticker = normalize_ticker(ticker)
    safe_days = max(YFINANCE_INTRADAY_MINIMUM_FALLBACK_DAYS, int(days))
    fallback_dataset = _download_recent_one_minute_history_with_yfinance(
        normalized_ticker,
        days=safe_days,
    )
    fallback_path = _upsert_one_minute_store(normalized_ticker, fallback_dataset)
    return OneMinuteRefreshResult(
        path=fallback_path,
        source=f"yfinance_{safe_days}d",
        fetched_days=safe_days,
    )


def ensure_fresh_history_store(ticker: str) -> bool:
    """
    Ensures the local daily cache includes the latest completed trading day.

    Returns True when a refresh was performed, otherwise False.
    """
    normalized_ticker = normalize_ticker(ticker)
    ensure_market_store_dir()
    if is_daily_store_fresh(normalized_ticker):
        return False
    if not has_remote_market_access():
        return False
    refresh_history_store(normalized_ticker)
    return True
