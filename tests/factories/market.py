"""Factories for test market data and results. Code version: v1.3.0."""

from __future__ import annotations

import pandas as pd

from app.models.schemas import QuoteProfile

# Stable per-ticker bases shared by OHLC and close-only helpers.
_TICKER_BASE_PRICES: dict[str, float] = {
    "QQQ": 100.0,
    "AAPL": 200.0,
    "NVDA": 300.0,
    "DRAM": 25.0,
}


class FakeStrategy:
    """Minimal strategy double accepted by the runtime and backtest forms."""

    def compute_signals(self, dataset: pd.DataFrame, params: dict[str, object]) -> pd.DataFrame:
        del params
        return dataset

    def get_parameter_definitions(self) -> list[object]:
        return []

    def get_parameter_sections(self) -> tuple[dict[str, str], ...]:
        return ()

    def normalize_params(self, values: dict[str, object]) -> dict[str, object]:
        return values


def ticker_base_price(ticker: str) -> float:
    """Return the deterministic base close used by market-frame factories."""
    return _TICKER_BASE_PRICES.get(str(ticker or "").strip().upper(), 150.0)


def ohlc_frame_for_dates(ticker: str, dates: list[str]) -> pd.DataFrame:
    """Return an OHLC frame for explicit timestamps with stable ticker-specific prices."""
    base = ticker_base_price(ticker)
    offsets = [float(index) for index, _value in enumerate(dates)]
    return pd.DataFrame({
        "Date": pd.to_datetime(dates),
        "Close": [base + offset for offset in offsets],
        "Open": [base - 0.5 + offset for offset in offsets],
        "High": [base + 0.5 + offset for offset in offsets],
        "Low": [base - 1.0 + offset for offset in offsets],
    })


def market_frame(ticker: str = "QQQ", *, intraday: bool = False) -> pd.DataFrame:
    """Return a two-row OHLC frame with stable ticker-specific prices."""
    dates = (
        ["2026-04-02 09:30", "2026-04-02 15:59"]
        if intraday
        else ["2026-03-26", "2026-03-27"]
    )
    return ohlc_frame_for_dates(ticker, dates)


def close_frame_for_dates(
    dates: list[str],
    closes: list[float],
    *,
    dividends: list[float] | None = None,
) -> pd.DataFrame:
    """Return a Date/Close frame, optionally with cash dividends, for service tests."""
    if len(dates) != len(closes):
        raise ValueError("dates and closes must have the same length.")
    payload: dict[str, object] = {
        "Date": pd.to_datetime(dates),
        "Close": closes,
    }
    if dividends is not None:
        if len(dividends) != len(dates):
            raise ValueError("dividends must match the length of dates.")
        payload["Dividends"] = dividends
    return pd.DataFrame(payload)


def close_frame_for_ticker(ticker: str, *, dates: list[str] | None = None) -> pd.DataFrame:
    """Return a two-row Date/Close frame using the same base prices as market_frame."""
    resolved_dates = dates or ["2026-03-26", "2026-03-27"]
    base = ticker_base_price(ticker)
    closes = [base + float(index) for index, _value in enumerate(resolved_dates)]
    return close_frame_for_dates(resolved_dates, closes)


def longbridge_candlestick_rows() -> list[dict[str, str]]:
    """Return deterministic CLI candlesticks spanning the US overnight date boundary."""
    return [
        {
            "time": "2026-07-14T00:00:00Z",
            "open": "160.000",
            "high": "161.000",
            "low": "159.500",
            "close": "160.500",
            "volume": "1000",
            "turnover": "160500.000",
            "session": "Overnight",
        },
        {
            "time": "2026-07-14T05:00:00Z",
            "open": "162.000",
            "high": "163.000",
            "low": "161.500",
            "close": "162.500",
            "volume": "1200",
            "turnover": "195000.000",
            "session": "Overnight",
        },
    ]


def fetch_history_stub(
    ticker: str,
    include_dividends: bool,
    interval: str = "1d",
    **_kwargs: object,
) -> pd.DataFrame:
    """Match the production history signature while avoiding network access."""
    del include_dividends
    return market_frame(ticker, intraday=interval == "1m")


def quote_profile_stub(
    ticker: str,
    force_refresh: bool = False,
    namespace: str = "primary",
    *,
    company_name: str | None = None,
    logo_url: str | None = None,
) -> QuoteProfile:
    """Return a deterministic identity profile without touching the network."""
    del force_refresh, namespace
    return QuoteProfile(
        ticker=ticker,
        company_name=company_name if company_name is not None else f"{ticker} Holdings",
        logo_url=logo_url if logo_url is not None else f"/api/market-store/logos/{ticker}.png",
    )


def backtest_result(*, intraday: bool = False) -> dict[str, object]:
    """Return the smallest complete backtest response consumed by templates."""
    frame = market_frame("DRAM" if intraday else "QQQ", intraday=intraday)
    dates = [str(value) for value in frame["Date"].dt.strftime("%Y-%m-%d %H:%M" if intraday else "%Y-%m-%d")]
    return {
        "summary": {
            "initial_capital": 10_000.0,
            "final_equity": 10_100.0,
            "net_return_pct": 1.0,
            "total_trades": 1,
            "win_rate_pct": 100.0,
            "beat_bh_pct": 100.0,
            "benchmark_alpha": 10.0,
            "long_gain": 10.0,
            "short_gain": 0.0,
            "long_loss": 0.0,
        },
        "chart": {
            "dates": dates,
            "raw_dates": dates,
            "close": frame["Close"].tolist(),
            "open": frame["Open"].tolist(),
            "high": frame["High"].tolist(),
            "low": frame["Low"].tolist(),
            "equity": [10_000.0, 10_100.0],
        },
        "trades": [],
        "interval": "1m" if intraday else "1d",
    }
