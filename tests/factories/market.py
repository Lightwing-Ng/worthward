"""Factories for test market data and results. Code version: v1.4.0."""

from __future__ import annotations

import numpy as np
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


def oscillating_ohlc_frame_for_dates(ticker: str, dates: list[str]) -> pd.DataFrame:
    """Return deterministic OHLCV bars whose daily log returns change sign.

    Two incommensurate cycles give probability models a non-degenerate return
    distribution to forecast without random numbers; the linear frame's
    constant returns cannot exercise a volatility-relative CRPS baseline.
    """
    index = np.arange(len(dates), dtype=float)
    log_close = (
        0.0004 * index
        + 0.06 * np.sin(2 * np.pi * index / 23)
        + 0.025 * np.sin(2 * np.pi * index / 7.3)
    )
    close = ticker_base_price(ticker) * np.exp(log_close)
    previous = np.concatenate((close[:1], close[:-1]))
    open_ = previous * np.exp(0.004 * np.sin(2 * np.pi * index / 5.1))
    spread = 0.006 + 0.003 * (1 + np.sin(2 * np.pi * index / 13))
    return pd.DataFrame({
        "Date": pd.to_datetime(dates),
        "Open": open_,
        "High": np.maximum(open_, close) * (1 + spread),
        "Low": np.minimum(open_, close) * (1 - spread),
        "Close": close,
        "Volume": 1_000_000.0 + 250_000.0 * (1 + np.sin(2 * np.pi * index / 11)),
    })


def price_field_bundle_for_frame(ticker: str, frame: pd.DataFrame) -> dict[str, object]:
    """Return a plain Price Field provider bundle holding only the frame's bars.

    Factor histories are empty, matching an offline local-store bundle, so no
    valuation, option, or research observation is invented.
    """
    volume = frame["Volume"] if "Volume" in frame else pd.Series(0.0, index=frame.index)
    return {
        "symbol": f"{str(ticker).strip().upper()}.US",
        "ohlcv": [
            {
                "observed_at": pd.Timestamp(date).isoformat(),
                "open": float(open_),
                "high": float(high),
                "low": float(low),
                "close": float(close),
                "volume": float(bar_volume),
                "turnover": float(bar_volume * close),
            }
            for date, open_, high, low, close, bar_volume in zip(
                frame["Date"], frame["Open"], frame["High"], frame["Low"],
                frame["Close"], volume, strict=True,
            )
        ],
        "pe_history": [],
        "dynamic_pe_history": [],
        "option_history": [],
        "research_history": [],
        "factor_status": {},
        "fingerprint": f"factory-{str(ticker).strip().lower()}-{len(frame)}",
        "source_commands": [],
    }


def clustered_ohlc_random_walk(
    count: int,
    *,
    seed: int = 20160104,
    start: str = "2016-01-04",
    base_price: float = 100.0,
    daily_vol: float = 0.02,
    alpha: float = 0.08,
    beta: float = 0.9,
    zero_range_rows: tuple[int, ...] = (),
    missing_open_rows: tuple[int, ...] = (),
) -> pd.DataFrame:
    """Return deterministic daily OHLCV bars from a GARCH(1,1) random walk with overnight gaps.

    The fixed seed makes every call identical. Each session opens with an overnight
    gap (0.35 of the current volatility), moves from open to close (0.9 of it) and
    trades a range around both, so volatility clusters with persistence
    ``alpha + beta``; ``alpha = beta = 0`` gives a constant close-to-close standard
    deviation of ``daily_vol * sqrt(0.35**2 + 0.9**2)``. ``zero_range_rows`` become
    halted sessions (all four prices equal the previous close) and
    ``missing_open_rows`` lose their open, high and low.
    """
    rng = np.random.default_rng(seed)
    shocks = rng.standard_normal(count)
    gaps = rng.standard_normal(count)
    wicks = np.abs(rng.standard_normal((count, 2)))
    omega = daily_vol ** 2 * max(1.0 - alpha - beta, 0.0)
    variance = daily_vol ** 2
    previous = float(base_price)
    rows = np.empty((count, 4))
    for index in range(count):
        sigma = variance ** 0.5
        open_ = previous * np.exp(0.35 * sigma * gaps[index])
        close = open_ * np.exp(0.0003 + 0.9 * sigma * shocks[index])
        high = max(open_, close) * np.exp(0.4 * sigma * wicks[index, 0])
        low = min(open_, close) * np.exp(-0.4 * sigma * wicks[index, 1])
        rows[index] = (open_, high, low, close)
        change = np.log(close / previous)
        variance = omega + alpha * change * change + beta * variance
        previous = close
    frame = pd.DataFrame({
        "Date": pd.bdate_range(start, periods=count),
        "Open": rows[:, 0],
        "High": rows[:, 1],
        "Low": rows[:, 2],
        "Close": rows[:, 3],
        "Volume": 1_000_000.0 * (1.0 + 0.5 * np.abs(shocks)),
    })
    for index in zero_range_rows:
        halted = frame.loc[index - 1, "Close"] if index > 0 else frame.loc[index, "Open"]
        frame.loc[index, ["Open", "High", "Low", "Close"]] = halted
    for index in missing_open_rows:
        frame.loc[index, ["Open", "High", "Low"]] = np.nan
    return frame


def illiquid_ohlc_random_walk(
    count: int,
    *,
    halted_share: float,
    halt_seed: int = 4,
    tick: float | None = None,
    **walk: object,
) -> pd.DataFrame:
    """Return ``clustered_ohlc_random_walk`` bars of a thinly traded, tick-bound stock.

    A seeded random ``halted_share`` of sessions (never the first) has no trade:
    open, high, low and close equal the previous close, so the session has zero
    range, zero gap and a zero return, and the missed move arrives as the next
    traded session's gap. ``tick`` rounds every price to that grid (at least one
    tick). The other keywords go to ``clustered_ohlc_random_walk``.
    """
    rng = np.random.default_rng(halt_seed)
    halted = tuple(int(row) for row in np.flatnonzero(rng.random(count) < halted_share) if row > 0)
    frame = clustered_ohlc_random_walk(count, zero_range_rows=halted, **walk)
    if tick:
        columns = ["Open", "High", "Low", "Close"]
        frame[columns] = np.maximum(np.round(frame[columns].to_numpy() / tick), 1.0) * tick
    return frame
