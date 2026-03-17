"""
Shared application configuration.

Code version: v2.0.0
"""

from pathlib import Path

import pandas as pd


BASE_DIR = Path(__file__).resolve().parent.parent
MARKET_STORE_DIR = BASE_DIR / "market_store"
DEFAULT_TICKERS = ("QQQ", "JEPQ")
DEFAULT_PERIOD = "1y"
DEFAULT_INTERVAL = "1d"
SUPPORTED_PERIODS = ("1mo", "3mo", "6mo", "1y", "2y", "5y", "10y", "max")
PERIOD_OFFSETS = {
    "1mo": pd.DateOffset(months=1),
    "3mo": pd.DateOffset(months=3),
    "6mo": pd.DateOffset(months=6),
    "1y": pd.DateOffset(years=1),
    "2y": pd.DateOffset(years=2),
    "5y": pd.DateOffset(years=5),
    "10y": pd.DateOffset(years=10),
}
CODE_VERSION = "v2.0.0"
