"""Dependency-neutral ticker market identity helpers.

Code version: v1.1.0
"""

from __future__ import annotations


_MARKET_SUFFIXES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("HK", (".HK",)),
    ("KR", (".KS", ".KQ")),
    ("JP", (".T", ".JP")),
    ("CN", (".SH", ".SS", ".SZ")),
    ("SG", (".SG", ".SI")),
    ("UK", (".L",)),
    ("AU", (".AX",)),
    ("CA", (".TO", ".V", ".NE", ".CN", ".CA")),
    (
        "EU",
        (
            ".PA",
            ".AS",
            ".BR",
            ".MI",
            ".MC",
            ".DE",
            ".F",
            ".HM",
            ".BE",
            ".DU",
            ".MU",
            ".HA",
            ".SW",
            ".VI",
            ".ST",
            ".CO",
            ".OL",
            ".IR",
            ".WA",
        ),
    ),
    ("FI", (".HE",)),
    ("IN", (".NS", ".BO")),
    ("TW", (".TW", ".TWO")),
    ("MY", (".KL",)),
    ("TH", (".BK",)),
    ("ID", (".JK",)),
    ("NZ", (".NZ",)),
    ("BR", (".SA",)),
    ("AR", (".BA",)),
    ("LATAM", (".MX",)),
    ("TR", (".IS",)),
    ("IL", (".TA",)),
    ("SA", (".SR", ".SE")),
    ("ZA", (".JO",)),
    ("QA", (".QA",)),
)

MARKET_TIMEZONES = {
    "US": "America/New_York",
    "HK": "Asia/Hong_Kong",
    "KR": "Asia/Seoul",
    "JP": "Asia/Tokyo",
    "CN": "Asia/Shanghai",
    "UK": "Europe/London",
    "SG": "Asia/Singapore",
    "AU": "Australia/Sydney",
    "CA": "America/Toronto",
    "EU": "Europe/Paris",
    "FI": "Europe/Helsinki",
    "IN": "Asia/Kolkata",
    "TW": "Asia/Taipei",
    "MY": "Asia/Kuala_Lumpur",
    "TH": "Asia/Bangkok",
    "ID": "Asia/Jakarta",
    "NZ": "Pacific/Auckland",
    "BR": "America/Sao_Paulo",
    "AR": "America/Argentina/Buenos_Aires",
    "LATAM": "America/Mexico_City",
    "TR": "Europe/Istanbul",
    "IL": "Asia/Jerusalem",
    "SA": "Asia/Riyadh",
    "ZA": "Africa/Johannesburg",
    "QA": "Asia/Qatar",
}


def infer_ticker_market(ticker: object) -> str:
    """Return the canonical market family inferred from a ticker suffix."""
    normalized = str(ticker or "").strip().upper()
    for market, suffixes in _MARKET_SUFFIXES:
        if normalized.endswith(suffixes):
            return market
    return "US"


def market_timezone_for_ticker(ticker: object) -> str:
    """Return the canonical IANA timezone for a ticker's inferred market."""
    return MARKET_TIMEZONES[infer_ticker_market(ticker)]
