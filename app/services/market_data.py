"""
Market data retrieval services.

Code version: v0.4.6
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
import io
import logging
import math
import contextlib
from time import sleep
from pathlib import Path
from threading import Lock

import pandas as pd
import yfinance as yf

from app.core.broker_settings import has_longbridge_market_data_source, load_broker_settings
from app.infrastructure.broker_market_data import (
    HONG_KONG_TIMEZONE,
    NEW_YORK_TIMEZONE,
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
LOGGER = logging.getLogger(__name__)


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


def _download_daily_history_with_yfinance(
        ticker: str,
        *,
        start: str | datetime | None = None,
        end: str | datetime | None = None,
        period: str | None = None,
        interval: str = "1d",
        prepost: bool = False,
) -> pd.DataFrame:
    """
    Serialize yfinance downloads because yfinance 1.2.0 mutates module-level
    shared state during each request and is not safe under concurrent calls.

    yfinance may also emit noisy diagnostics directly to stderr when it cannot
    resolve symbols like `MSFT.US`. We silence that low-level output here and
    let the caller decide whether to fall back to Longbridge.
    """
    with YFINANCE_DOWNLOAD_LOCK:
        stderr_buffer = io.StringIO()
        stdout_buffer = io.StringIO()
        with contextlib.redirect_stderr(stderr_buffer), contextlib.redirect_stdout(stdout_buffer):
            return yf.download(
                tickers=ticker,
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
            )


def _load_longbridge_market_settings():
    settings = load_broker_settings()
    if not has_longbridge_market_data_source(settings):
        return None
    return settings


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
    history = _download_daily_history_with_yfinance(
        ticker,
        start=start.to_pydatetime(),
        end=(end + pd.Timedelta(minutes=1)).to_pydatetime(),
        interval="1m",
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


def infer_ticker_market(ticker: str) -> str:
    normalized_ticker = normalize_ticker(ticker)
    if normalized_ticker.endswith(".HK"):
        return "HK"
    if normalized_ticker.endswith((".SH", ".SZ")):
        return "CN"
    if normalized_ticker.endswith(".SG"):
        return "SG"
    return "US"


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


def classify_us_equity_session(timestamp: pd.Timestamp | datetime | str) -> str:
    """Classify a US equity bar timestamp into pre, intraday, post, or off."""
    parsed_timestamp = pd.to_datetime(timestamp, errors="coerce")
    if pd.isna(parsed_timestamp):
        return "off"
    localized = parsed_timestamp
    if localized.tzinfo is not None:
        localized = localized.tz_convert(NEW_YORK_TIMEZONE).tz_localize(None)
    total_minutes = (int(localized.hour) * 60) + int(localized.minute)
    regular_open = (9 * 60) + 30
    regular_close = 16 * 60
    premarket_open = 4 * 60
    postmarket_close = 20 * 60
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
    normalized_ticker = normalize_ticker(ticker)
    history = _download_daily_history_with_yfinance(
        normalized_ticker,
        period="5d",
        interval="1m",
        prepost=True,
    )
    if history is None or history.empty:
        raise ValueError(f"No extended-hours 1-minute data returned for {normalized_ticker} via yfinance.")
    normalized = normalize_history_frame(history, normalized_ticker, interval="1m")
    return select_price_series(normalized, include_dividends=False, dividend_mode="price")


def fetch_yfinance_realtime_quotes(tickers: list[str]) -> list[dict[str, object]]:
    """
    Efficient batch version: performs a single yfinance download for the list of tickers
    (instead of N separate calls). This dramatically speeds up the case of many holdings
    after an IBKR (or other) import that produces a large number of open positions.
    """
    if not tickers:
        return []
    normalized_list = [
        normalize_ticker(t) for t in tickers if str(t or "").strip()
    ]
    if not normalized_list:
        return []
    try:
        history = _download_daily_history_with_yfinance(
            normalized_list,
            period="1d",
            interval="1m",
            prepost=True,
        )
        if history is None or history.empty:
            return []
        is_multi = isinstance(history.columns, pd.MultiIndex)
        results: list[dict[str, object]] = []
        for normalized_ticker in normalized_list:
            try:
                if is_multi:
                    # yfinance multi-ticker result usually has MultiIndex columns:
                    # level 0 = field (Close, etc), level 1 = ticker
                    try:
                        tdf = history.xs(normalized_ticker, level=1, axis=1)
                    except (KeyError, AttributeError):
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
        return results
    except Exception:  # noqa: BLE001
        return []


def _upsert_one_minute_store(ticker: str, dataset: pd.DataFrame) -> Path:
    normalized_ticker = normalize_ticker(ticker)
    ensure_market_store_dir()
    path = intraday_history_store_path_for(normalized_ticker, "1m")
    normalized_dataset = normalize_one_minute_store_frame(dataset)
    if normalized_dataset.empty:
        raise ValueError(f"No 1-minute market data returned for {normalized_ticker}.")

    with market_store_file_lock(path):
        if path.exists():
            try:
                existing_df = normalize_one_minute_store_frame(pd.read_parquet(path))
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
    yfinance_error: Exception | None = None
    for candidate_period in _daily_history_period_candidates(start=start, period=period):
        try:
            dataset = _download_daily_history_with_yfinance(
                ticker,
                start=start,
                period=candidate_period,
                interval="1d",
            )
            if dataset is not None and not dataset.empty:
                return dataset
            yfinance_error = ValueError(f"No 1-day market data returned for {ticker} via yfinance.")
        except Exception as exc:
            yfinance_error = exc

    settings = _load_longbridge_market_settings()
    if settings is None:
        raise ValueError(
            f"Unable to fetch 1-day market data for {ticker} via yfinance. "
            "Configure Longbridge App Key, App Secret, and Access Token in Settings > Broker Access to enable automatic fallback."
        ) from yfinance_error

    try:
        return _download_daily_history_with_longbridge(ticker, start=start)
    except Exception as exc:
        raise ValueError(
            f"Unable to fetch 1-day market data for {ticker}. yfinance failed and Longbridge fallback also failed: {exc}"
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
        last_error: Exception | None = None
        for attempt in range(DOWNLOAD_RETRY_ATTEMPTS):
            delay = DOWNLOAD_RETRY_DELAYS_SECONDS[attempt] if attempt < len(DOWNLOAD_RETRY_DELAYS_SECONDS) else DOWNLOAD_RETRY_DELAYS_SECONDS[-1]
            if delay > 0:
                sleep(delay)
            try:
                return _download_one_minute_history_with_longbridge(normalized_ticker)
            except Exception as exc:
                last_error = exc
        if last_error is not None:
            raise last_error
        raise ValueError(f"Unable to download market data for {ticker}.")
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
    path = history_store_path_for_interval(normalized_ticker, normalized_interval)
    if path.exists():
        should_refresh_for_dividends = False
        with market_store_file_lock(path):
            dataset = pd.read_parquet(path)
            if is_intraday_market_interval(normalized_interval):
                normalized_intraday = normalize_one_minute_store_frame(dataset)
                if not normalized_intraday.equals(dataset):
                    write_parquet_atomic(path, normalized_intraday, index=False)
                dataset = normalized_intraday
            else:
                should_refresh_for_dividends = "Dividends" not in dataset.columns
                dataset = normalize_history_frame(dataset, normalized_ticker, interval=normalized_interval)
        if should_refresh_for_dividends:
            try:
                refresh_history_store(normalized_ticker, force_full=True)
                with market_store_file_lock(path):
                    dataset = normalize_history_frame(pd.read_parquet(path), normalized_ticker, interval=normalized_interval)
            except Exception as exc:
                LOGGER.warning("Unable to refresh dividend actions for %s at %s: %s", normalized_ticker, path, exc)
        return select_price_series(dataset, include_dividends, dividend_mode=dividend_mode)

    if is_intraday_market_interval(normalized_interval) and _load_longbridge_market_settings() is None:
        raise ValueError(
            f"Local 1-minute market data for {normalized_ticker} is unavailable. "
            "Configure Longbridge App Key, App Secret, and Access Token in Settings > Broker Access first."
        )

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
    settings = _load_longbridge_market_settings()
    longbridge_error: Exception | None = None

    if settings is not None:
        try:
            refresh_longbridge_one_minute_store(normalized_ticker, settings)
            return OneMinuteRefreshResult(
                path=intraday_history_store_path_for(normalized_ticker, "1m"),
                source="longbridge",
                fetched_days=180,
            )
        except Exception as exc:
            longbridge_error = exc

    try:
        fallback_dataset = _download_recent_one_minute_history_with_yfinance(
            normalized_ticker,
            days=YFINANCE_INTRADAY_FALLBACK_DAYS,
        )
        fallback_path = _upsert_one_minute_store(normalized_ticker, fallback_dataset)
        return OneMinuteRefreshResult(
            path=fallback_path,
            source="yfinance_30d",
            fetched_days=YFINANCE_INTRADAY_FALLBACK_DAYS,
        )
    except Exception as thirty_day_error:
        try:
            fallback_dataset = _download_recent_one_minute_history_with_yfinance(
                normalized_ticker,
                days=YFINANCE_INTRADAY_MINIMUM_FALLBACK_DAYS,
            )
            fallback_path = _upsert_one_minute_store(normalized_ticker, fallback_dataset)
            return OneMinuteRefreshResult(
                path=fallback_path,
                source="yfinance_7d",
                fetched_days=YFINANCE_INTRADAY_MINIMUM_FALLBACK_DAYS,
            )
        except Exception as seven_day_error:
            if longbridge_error is not None:
                raise ValueError(
                    f"Unable to refresh 1-minute market data for {normalized_ticker}. "
                    f"Longbridge failed: {longbridge_error}. "
                    f"yfinance 30-day fallback failed: {thirty_day_error}. "
                    f"yfinance 7-day fallback failed: {seven_day_error}."
                ) from seven_day_error
            raise ValueError(
                f"Unable to refresh 1-minute market data for {normalized_ticker}. "
                f"yfinance 30-day fallback failed: {thirty_day_error}. "
                f"yfinance 7-day fallback failed: {seven_day_error}."
            ) from seven_day_error


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
    refresh_history_store(normalized_ticker)
    return True
