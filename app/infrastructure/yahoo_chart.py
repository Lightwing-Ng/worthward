"""
Direct Yahoo Chart API transport for daily and intraday market history fallback.

Code version: v0.1.1
"""

from __future__ import annotations

import json
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

import pandas as pd

YAHOO_CHART_ENDPOINT = "https://query1.finance.yahoo.com/v8/finance/chart"
YAHOO_CHART_MAX_RESPONSE_BYTES = 32 * 1024 * 1024
YAHOO_CHART_TIMEOUT_SECONDS = 12


class YahooChartError(ValueError):
    """Raised when Yahoo returns no usable authoritative chart data."""


def _bounded_values(values: object, expected_length: int) -> list[object | None]:
    if not isinstance(values, list):
        return [None] * expected_length
    return [*values[:expected_length], *([None] * max(0, expected_length - len(values)))]


def _daily_index(timestamps: list[object], timezone_name: str) -> pd.DatetimeIndex:
    parsed = pd.to_datetime(timestamps, unit="s", utc=True, errors="coerce")
    try:
        localized = parsed.tz_convert(timezone_name)
    except (KeyError, TypeError, ValueError):
        localized = parsed
    return localized.tz_localize(None).normalize()


def _event_date(timestamp: object, timezone_name: str) -> pd.Timestamp | None:
    parsed = pd.to_datetime(timestamp, unit="s", utc=True, errors="coerce")
    if pd.isna(parsed):
        return None
    try:
        parsed = parsed.tz_convert(timezone_name)
    except (KeyError, TypeError, ValueError):
        pass
    return parsed.tz_localize(None).normalize()


def _build_chart_url(
        ticker: str,
        *,
        start: str | None,
        period: str | None,
        end: str | None = None,
        interval: str = "1d",
        prepost: bool = False,
) -> str:
    request_end = pd.Timestamp.now(tz="UTC") + pd.Timedelta(days=1)
    normalized_interval = str(interval or "1d").strip().lower()
    params: dict[str, object] = {
        "interval": normalized_interval,
        "events": "div,splits,capitalGains",
        "includeAdjustedClose": "true",
        "includePrePost": str(bool(prepost)).lower(),
    }
    if start is not None:
        parsed_start = pd.to_datetime(start, utc=True, errors="coerce")
        if pd.isna(parsed_start):
            raise YahooChartError(f"Invalid Yahoo Chart start date: {start}.")
        params["period1"] = int(parsed_start.timestamp())
    else:
        normalized_period = str(period or "max").strip().lower()
        if normalized_period == "max":
            request_start = pd.Timestamp(0, unit="s", tz="UTC")
        elif normalized_period.endswith("y") and normalized_period[:-1].isdigit():
            request_start = request_end - pd.DateOffset(years=int(normalized_period[:-1]))
        elif normalized_period.endswith("mo") and normalized_period[:-2].isdigit():
            request_start = request_end - pd.DateOffset(months=int(normalized_period[:-2]))
        elif normalized_period.endswith("d") and normalized_period[:-1].isdigit():
            requested_days = int(normalized_period[:-1])
            request_start = request_end - pd.Timedelta(days=max(7, requested_days * 2))
        else:
            raise YahooChartError(f"Unsupported Yahoo Chart period: {period}.")
        params["period1"] = int(request_start.timestamp())
    if end is not None:
        parsed_end = pd.to_datetime(end, utc=True, errors="coerce")
        if pd.isna(parsed_end):
            raise YahooChartError(f"Invalid Yahoo Chart end date: {end}.")
        request_end = parsed_end
    params["period2"] = int(request_end.timestamp())
    encoded_ticker = quote(str(ticker).strip(), safe="")
    return f"{YAHOO_CHART_ENDPOINT}/{encoded_ticker}?{urlencode(params)}"


def _parse_chart_payload(payload: object, ticker: str, *, interval: str = "1d") -> pd.DataFrame:
    if not isinstance(payload, dict):
        raise YahooChartError(f"Yahoo Chart returned an invalid payload for {ticker}.")
    chart = payload.get("chart")
    if not isinstance(chart, dict):
        raise YahooChartError(f"Yahoo Chart returned no chart object for {ticker}.")
    error = chart.get("error")
    if isinstance(error, dict):
        code = str(error.get("code") or "unknown error")
        description = str(error.get("description") or "No description supplied")
        raise YahooChartError(f"Yahoo Chart rejected {ticker}: {code}: {description}.")
    results = chart.get("result")
    if not isinstance(results, list) or not results or not isinstance(results[0], dict):
        raise YahooChartError(f"Yahoo Chart returned no history for {ticker}.")

    result = results[0]
    timestamps = result.get("timestamp")
    if not isinstance(timestamps, list) or not timestamps:
        raise YahooChartError(f"Yahoo Chart returned no timestamps for {ticker}.")
    indicators = result.get("indicators")
    if not isinstance(indicators, dict):
        raise YahooChartError(f"Yahoo Chart returned no indicators for {ticker}.")
    quotes = indicators.get("quote")
    if not isinstance(quotes, list) or not quotes or not isinstance(quotes[0], dict):
        raise YahooChartError(f"Yahoo Chart returned no OHLC history for {ticker}.")

    metadata = result.get("meta") if isinstance(result.get("meta"), dict) else {}
    timezone_name = str(metadata.get("exchangeTimezoneName") or "UTC")
    quote_payload = quotes[0]
    row_count = len(timestamps)
    is_intraday = str(interval or "1d").strip().lower() != "1d"
    timestamps_index = pd.to_datetime(timestamps, unit="s", utc=True)
    if not is_intraday:
        try:
            timestamps_index = timestamps_index.tz_convert(timezone_name).tz_localize(None).normalize()
        except (KeyError, TypeError, ValueError):
            timestamps_index = timestamps_index.tz_localize(None).normalize()
    frame = pd.DataFrame(
        {
            "Open": _bounded_values(quote_payload.get("open"), row_count),
            "High": _bounded_values(quote_payload.get("high"), row_count),
            "Low": _bounded_values(quote_payload.get("low"), row_count),
            "Close": _bounded_values(quote_payload.get("close"), row_count),
        },
        index=timestamps_index,
    )
    volume_values = quote_payload.get("volume")
    if isinstance(volume_values, list):
        frame["Volume"] = _bounded_values(volume_values, row_count)
    adjusted = indicators.get("adjclose")
    if isinstance(adjusted, list) and adjusted and isinstance(adjusted[0], dict):
        frame["Adj Close"] = _bounded_values(adjusted[0].get("adjclose"), row_count)
    else:
        frame["Adj Close"] = frame["Close"]

    frame["Dividends"] = 0.0
    events = result.get("events")
    dividends = events.get("dividends") if isinstance(events, dict) else None
    if isinstance(dividends, dict):
        for dividend in dividends.values():
            if not isinstance(dividend, dict):
                continue
            dividend_date = _event_date(dividend.get("date"), timezone_name)
            amount = pd.to_numeric(dividend.get("amount"), errors="coerce")
            if dividend_date is None or pd.isna(amount):
                continue
            matching_rows = frame.index == dividend_date
            if matching_rows.any():
                frame.loc[matching_rows, "Dividends"] += float(amount)

    frame.index.name = "Date"
    frame = frame.loc[~frame.index.isna()].copy()
    frame = frame.loc[~frame.index.duplicated(keep="last")].sort_index()
    frame = frame.dropna(subset=["Close", "Adj Close"])
    if frame.empty:
        raise YahooChartError(f"Yahoo Chart returned no usable daily history for {ticker}.")
    return frame


def download_yahoo_chart_daily_history(
        ticker: str,
        *,
        start: str | None = None,
        period: str | None = None,
) -> pd.DataFrame:
    """Download authoritative daily bars directly from Yahoo's Chart endpoint."""
    request_obj = Request(
        _build_chart_url(ticker, start=start, period=period),
        headers={"User-Agent": "Mozilla/5.0"},
    )
    with urlopen(request_obj, timeout=YAHOO_CHART_TIMEOUT_SECONDS) as response:
        raw_payload = response.read(YAHOO_CHART_MAX_RESPONSE_BYTES + 1)
    if len(raw_payload) > YAHOO_CHART_MAX_RESPONSE_BYTES:
        raise YahooChartError(f"Yahoo Chart response exceeded the size limit for {ticker}.")
    try:
        payload = json.loads(raw_payload)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise YahooChartError(f"Yahoo Chart returned invalid JSON for {ticker}: {exc}.") from exc
    return _parse_chart_payload(payload, ticker, interval="1d")


def download_yahoo_chart_history(
        ticker: str,
        *,
        start: str | pd.Timestamp,
        end: str | pd.Timestamp,
        interval: str = "1m",
        prepost: bool = False,
) -> pd.DataFrame:
    """Download bounded intraday bars directly from Yahoo's Chart endpoint."""
    request_obj = Request(
        _build_chart_url(
            ticker,
            start=str(start),
            period=None,
            end=str(end),
            interval=interval,
            prepost=prepost,
        ),
        headers={"User-Agent": "Mozilla/5.0"},
    )
    with urlopen(request_obj, timeout=YAHOO_CHART_TIMEOUT_SECONDS) as response:
        raw_payload = response.read(YAHOO_CHART_MAX_RESPONSE_BYTES + 1)
    if len(raw_payload) > YAHOO_CHART_MAX_RESPONSE_BYTES:
        raise YahooChartError(f"Yahoo Chart response exceeded the size limit for {ticker}.")
    try:
        payload = json.loads(raw_payload)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise YahooChartError(f"Yahoo Chart returned invalid JSON for {ticker}: {exc}.") from exc
    return _parse_chart_payload(payload, ticker, interval=interval)
