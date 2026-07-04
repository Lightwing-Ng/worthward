"""
Dataclasses shared across routes and services.

Code version: v0.4.0
"""

from dataclasses import dataclass
from typing import Optional, List, Any


@dataclass
class SeriesPayload:
    ticker: str
    dates: List[str]
    raw_dates: List[str]
    normalized_returns: List[float | None]
    color: Optional[str] = None
    glow: bool = True
    candlestick_returns: Optional[List[dict[str, Any]]] = None


@dataclass
class QuoteProfile:
    ticker: str
    company_name: str
    website: Optional[str] = None
    logo_url: Optional[str] = None


@dataclass
class DateConstraintPayload:
    min_date: Optional[str]
    max_date: Optional[str]
    trading_dates: List[str]
    adjusted_start: Optional[str] = None
    adjusted_end: Optional[str] = None
    message: Optional[str] = None
