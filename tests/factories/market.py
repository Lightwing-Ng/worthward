"""Factories for test market data and results. Code version: v1.0.0."""

from __future__ import annotations

import pandas as pd

from app.models.schemas import QuoteProfile


class FakeStrategy:
    """Minimal strategy double accepted by the runtime and backtest forms."""

    def compute_signals(self, dataset: pd.DataFrame, params: dict[str, object]) -> pd.DataFrame:
        del params
        return dataset

    def get_parameter_definitions(self) -> list[object]:
        return []

    def normalize_params(self, values: dict[str, object]) -> dict[str, object]:
        return values


def market_frame(ticker: str = "QQQ", *, intraday: bool = False) -> pd.DataFrame:
    """Return a two-row OHLC frame with stable ticker-specific prices."""
    base = {"QQQ": 100.0, "AAPL": 200.0, "NVDA": 300.0, "DRAM": 25.0}.get(ticker, 150.0)
    dates = (
        ["2026-04-02 09:30", "2026-04-02 15:59"]
        if intraday
        else ["2026-03-26", "2026-03-27"]
    )
    return pd.DataFrame({
        "Date": pd.to_datetime(dates),
        "Close": [base, base + 1.0],
        "Open": [base - 0.5, base + 0.5],
        "High": [base + 0.5, base + 1.5],
        "Low": [base - 1.0, base],
    })


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
) -> QuoteProfile:
    """Return a deterministic identity profile without touching the network."""
    del force_refresh, namespace
    return QuoteProfile(
        ticker=ticker,
        company_name=f"{ticker} Holdings",
        logo_url=f"/api/market-store/logos/{ticker}.png",
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
