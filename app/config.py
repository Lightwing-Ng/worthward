"""
Shared application configuration.

Code version: v2.0.1
"""

from pathlib import Path

import pandas as pd

BASE_DIR = Path(__file__).resolve().parent.parent
MARKET_STORE_DIR = BASE_DIR / "market_store"
DEFAULT_TICKERS = ("QQQ", "JEPQ")
DEFAULT_PERIOD = "1y"
DEFAULT_INTERVAL = "1d"
SUPPORTED_PERIODS_1D = ("6mo", "1y", "2y", "3y", "5y", "10y", "max")
SUPPORTED_PERIODS_1M = ("1d", "3d", "1w", "2w", "1mo")
PERIOD_OFFSETS = {
    "1d": pd.Timedelta(days=1),
    "3d": pd.Timedelta(days=3),
    "1w": pd.Timedelta(days=6),
    "2w": pd.Timedelta(days=13),
    "1mo": pd.DateOffset(months=1),
    "3mo": pd.DateOffset(months=3),
    "6mo": pd.DateOffset(months=6),
    "1y": pd.DateOffset(years=1),
    "2y": pd.DateOffset(years=2),
    "3y": pd.DateOffset(years=3),
    "5y": pd.DateOffset(years=5),
    "10y": pd.DateOffset(years=10),
}
CODE_VERSION = "v2.11.0"
