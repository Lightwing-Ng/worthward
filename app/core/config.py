"""
Shared application configuration.

Code version: v0.4.0
"""

from pathlib import Path

import pandas as pd

BASE_DIR = Path(__file__).resolve().parent.parent.parent
MARKET_STORE_DIR = BASE_DIR / "market_store"
SETTINGS_STORE_DIR = BASE_DIR / "settings_store"
DEFAULT_TICKERS = ("QQQ", "JEPQ")
DEFAULT_PERIOD = "1y"
DEFAULT_INTERVAL = "1d"
PERIOD_LABELS = {
    "1d": "1 day",
    "3d": "3 days",
    "1w": "1 week",
    "2w": "2 weeks",
    "1mo": "1 month",
    "3mo": "3 months",
    "6mo": "6 months",
    "1y": "1 year",
    "2y": "2 years",
    "3y": "3 years",
    "5y": "5 years",
    "10y": "10 years",
    "max": "Max",
}
PERIOD_DAY_SPANS = {
    "1d": 1,
    "3d": 3,
    "1w": 7,
    "2w": 14,
}
PERIOD_MONTH_SPANS = {
    "1mo": 1,
    "3mo": 3,
    "6mo": 6,
    "1y": 12,
    "2y": 24,
    "3y": 36,
    "5y": 60,
    "10y": 120,
}
SUPPORTED_PERIODS_1D = ("6mo", "1y", "2y", "3y", "5y", "10y", "max")
COMPARE_PERIODS_1D = ("1d", "3d", "1w", "6mo", "1y", "2y", "3y", "5y", "10y", "max")
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
CODE_VERSION = "v2.12.0"
