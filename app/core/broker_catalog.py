"""
Canonical broker metadata and pinyin-initial sort order.

Code version: v0.1.0
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class BrokerCatalogEntry:
    code: str
    label: str
    pinyin_sort_key: str
    icon_filename: str
    description: str = ""


# Sort keys use the broker display label's first-letter bucket (H/I/L for the
# current English labels). Full keys keep a stable tie-breaker within the bucket.
BROKER_CATALOG: dict[str, BrokerCatalogEntry] = {
    "hsbc": BrokerCatalogEntry(
        code="hsbc",
        label="HSBC",
        pinyin_sort_key="hsbc",
        icon_filename="HSBC.png",
        description="Paste plain text from HSBC Order Status and the USD cash account.",
    ),
    "ibkr": BrokerCatalogEntry(
        code="ibkr",
        label="IBKR",
        pinyin_sort_key="ibkr",
        icon_filename="IBKR.png",
        description="Supported now for CSV import.",
    ),
    "longbridge": BrokerCatalogEntry(
        code="longbridge",
        label="Longbridge",
        pinyin_sort_key="longbridge",
        icon_filename="Longbridge.png",
        description="Uses the configured authentication session to pull historical orders and cash flow.",
    ),
}

SETTINGS_BROKER_CODES = ("ibkr", "longbridge")
LIVE_TRADING_BROKER_CODES = ("ibkr", "longbridge")
INVESTMENT_IMPORT_BROKER_CODES = ("hsbc", "ibkr", "longbridge")


def broker_pinyin_sort_key(code: str | None, *, fallback_label: str | None = None) -> str:
    normalized_code = str(code or "").strip().lower()
    entry = BROKER_CATALOG.get(normalized_code)
    if entry is not None:
        return entry.pinyin_sort_key
    fallback = str(fallback_label or normalized_code).strip().lower()
    return fallback or normalized_code


def sort_broker_codes(codes: list[str] | set[str] | tuple[str, ...]) -> list[str]:
    unique_codes = []
    seen: set[str] = set()
    for code in codes:
        normalized_code = str(code or "").strip().lower()
        if not normalized_code or normalized_code in seen:
            continue
        seen.add(normalized_code)
        unique_codes.append(normalized_code)
    return sorted(unique_codes, key=lambda code: (broker_pinyin_sort_key(code), code))


def sorted_broker_entries(codes: list[str] | set[str] | tuple[str, ...]) -> list[BrokerCatalogEntry]:
    return [
        BROKER_CATALOG[code]
        for code in sort_broker_codes(codes)
        if code in BROKER_CATALOG
    ]