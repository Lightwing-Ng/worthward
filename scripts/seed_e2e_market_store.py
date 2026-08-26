"""Build the isolated deterministic market store used by Playwright. Code version: v1.2.0."""

from __future__ import annotations

from pathlib import Path
import sys

import pandas as pd

from tests.factories.market import ohlc_frame_for_dates


ROOT_DIR = Path(__file__).resolve().parent.parent
EXPECTED_STORE_DIR = (ROOT_DIR / "test-results" / "runtime-store" / "market_store").resolve()

DAILY_TICKERS = (
    "000660.KS",
    "7709.HK",
    "AAPL",
    "AMD",
    "DRAM",
    "GOOGL",
    "META",
    "MU",
    "NVDA",
    "QQQ",
    "STX",
)
US_INTRADAY_TICKERS = ("AAPL", "DRAM", "MU", "NVDA", "QQQ", "STX")
PROFILE_ROWS = (
    ("000660.KS", "SK hynix Inc.", "https://www.skhynix.com"),
    ("7709.HK", "CSOP SK Hynix Daily (2x) Leveraged Product", ""),
    ("AAPL", "Apple Inc.", "https://www.apple.com"),
    ("AMD", "Advanced Micro Devices, Inc.", "https://www.amd.com"),
    ("DRAM", "Roundhill Memory ETF", "https://www.roundhillinvestments.com/etf/dram/"),
    ("GOOGL", "Alphabet Inc.", "https://abc.xyz"),
    ("META", "Meta Platforms, Inc.", "https://about.meta.com"),
    ("MU", "Micron Technology, Inc.", "https://www.micron.com"),
    ("NVDA", "NVIDIA Corporation", "https://www.nvidia.com"),
    ("QQQ", "Invesco QQQ Trust", "https://www.invesco.com"),
    ("STX", "Seagate Technology Holdings plc", "https://www.seagate.com"),
)


def _complete_price_frame(ticker: str, dates: list[str], *, intraday: bool) -> pd.DataFrame:
    """Return a persistence-ready frame derived from the shared OHLC factory."""
    frame = ohlc_frame_for_dates(ticker, dates)
    frame["Adj Close"] = frame["Close"]
    frame["Dividends"] = 0.0
    frame["Volume"] = 1_000.0
    frame["Turnover"] = frame["Close"] * frame["Volume"]
    if not intraday:
        frame["Stock Splits"] = 0.0
    return frame


def _us_intraday_dates() -> list[str]:
    dates: list[str] = []
    for trading_date in ("2026-07-10", "2026-07-13", "2026-07-14"):
        dates.extend(
            timestamp.strftime("%Y-%m-%d %H:%M:%S")
            for timestamp in pd.date_range(f"{trading_date} 09:30", periods=390, freq="min")
        )
    return dates


def _write_profiles(store_dir: Path) -> None:
    profiles = pd.DataFrame(
        [
            {
                "ticker": ticker,
                "company_name": company_name,
                "website": website,
                "storage_scope": "local_store",
                "tradingview_screener": "",
                "tradingview_exchange": "",
                "updated_at": "2026-07-14T00:00:00+00:00",
            }
            for ticker, company_name, website in PROFILE_ROWS
        ]
    )
    profiles_dir = store_dir / "profiles"
    profiles_dir.mkdir(parents=True, exist_ok=True)
    profiles.to_parquet(profiles_dir / "profiles.parquet", index=False)


def _write_market_cap_inputs(store_dir: Path) -> None:
    shares_dir = store_dir / "fundamentals" / "shares"
    shares_dir.mkdir(parents=True, exist_ok=True)
    dates = pd.to_datetime(["2021-01-04", "2026-07-14"])
    for ticker, shares in (("AAPL", 15_000_000_000.0), ("NVDA", 24_000_000_000.0)):
        frame = pd.DataFrame({"Date": dates, "Shares": [shares, shares]})
        frame.to_parquet(shares_dir / f"{ticker}.parquet", index=False)


def seed_market_store(store_dir: Path) -> None:
    """Populate only the canonical isolated Playwright market store."""
    resolved_store = store_dir.resolve()
    if resolved_store != EXPECTED_STORE_DIR:
        raise ValueError(f"Refusing to seed unexpected E2E market-store path: {resolved_store}")

    historical_dir = resolved_store / "historical"
    historical_dir.mkdir(parents=True, exist_ok=True)

    daily_dates = [
        timestamp.strftime("%Y-%m-%d")
        for timestamp in pd.bdate_range("2021-01-04", "2026-07-14")
    ]
    for ticker in DAILY_TICKERS:
        _complete_price_frame(ticker, daily_dates, intraday=False).to_parquet(
            historical_dir / f"{ticker}.parquet",
            index=False,
        )

    us_intraday_dates = _us_intraday_dates()
    for ticker in US_INTRADAY_TICKERS:
        _complete_price_frame(ticker, us_intraday_dates, intraday=True).to_parquet(
            historical_dir / f"{ticker}_1m.parquet",
            index=False,
        )

    cross_market_dates = {
        "000660.KS": [
            timestamp.strftime("%Y-%m-%d %H:%M:%S")
            for timestamp in pd.date_range("2026-07-13 20:00", periods=390, freq="min")
        ],
        "7709.HK": [
            timestamp.strftime("%Y-%m-%d %H:%M:%S")
            for timestamp in pd.date_range("2026-07-13 21:30", periods=390, freq="min")
        ],
    }
    for ticker, dates in cross_market_dates.items():
        _complete_price_frame(ticker, dates, intraday=True).to_parquet(
            historical_dir / f"{ticker}_1m.parquet",
            index=False,
        )

    _write_profiles(resolved_store)
    _write_market_cap_inputs(resolved_store)


def main() -> int:
    if len(sys.argv) != 2:
        raise SystemExit("Usage: seed_e2e_market_store.py <isolated-market-store-path>")
    seed_market_store(Path(sys.argv[1]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
