"""
Dataclasses shared across routes and services.

Code version: v3.1.0
"""

from dataclasses import dataclass


@dataclass(slots=True)
class SeriesPayload:
    ticker: str
    dates: list[str]
    normalized_returns: list[float]
    color: str | None = None
    glow: bool = True


@dataclass(slots=True)
class QuoteProfile:
    ticker: str
    company_name: str
    website: str | None = None
    logo_url: str | None = None


@dataclass(slots=True)
class DateConstraintPayload:
    min_date: str | None
    max_date: str | None
    trading_dates: list[str]
    adjusted_start: str | None = None
    adjusted_end: str | None = None
    message: str | None = None
