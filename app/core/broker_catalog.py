"""
Canonical broker metadata and pinyin-initial sort order.

Code version: v0.2.1
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
        icon_filename="IBKR.svg",
        description="Supported now for CSV import.",
    ),
    "schwab": BrokerCatalogEntry(
        code="schwab",
        label="Charles Schwab",
        pinyin_sort_key="charlesschwab",
        icon_filename="Charles Schwab.svg",
        description="Upload Schwab Order Status CSV (e.g. Individual..._Order_Status_....csv) or Transaction History CSV.",
    ),
    "tigertrade": BrokerCatalogEntry(
        code="tigertrade",
        label="Tiger Trade",
        pinyin_sort_key="tigertrade",
        icon_filename="TigerTrade.png",
        description="Upload one or more Tiger Trade activity statement PDFs.",
    ),
    "usmart_hk": BrokerCatalogEntry(
        code="usmart_hk",
        label="uSMART (HK)",
        pinyin_sort_key="usmarthk",
        icon_filename="uSAMRT.png",
        description="Upload one or more uSMART Securities (HK) monthly statement PDFs.",
    ),
    "longbridge_hk": BrokerCatalogEntry(
        code="longbridge_hk",
        label="Longbridge (HK)",
        pinyin_sort_key="longbridgehk",
        icon_filename="Longbridge.png",
        description="Upload Fund Details plain text and History Orders XLSX exports.",
    ),
    "longbridge_sg": BrokerCatalogEntry(
        code="longbridge_sg",
        label="Longbridge (SG)",
        pinyin_sort_key="longbridgesg",
        icon_filename="Longbridge.png",
        description="Upload Fund Details plain text and History Orders XLSX exports.",
    ),
    "futuhk": BrokerCatalogEntry(
        code="futuhk",
        label="Futu (HK)",
        pinyin_sort_key="futuhk",
        icon_filename="FutuHK.svg",
        description="Upload one or more Futu Securities International (Hong Kong) monthly statement PDFs.",
    ),
    "cmbwl": BrokerCatalogEntry(
        code="cmbwl",
        label="CMB Wing Lung Bank",
        pinyin_sort_key="cmbwinglungbank",
        icon_filename="CMB Wing Lung.svg",
        description="Parse completed securities order notification emails (.eml).",
    ),
}

SETTINGS_BROKER_CODES = ("ibkr", "longbridge")
LIVE_TRADING_BROKER_CODES = ("ibkr", "longbridge")
INVESTMENT_IMPORT_BROKER_CODES = (
    "cmbwl",
    "hsbc",
    "futuhk",
    "ibkr",
    "longbridge_hk",
    "longbridge_sg",
    "schwab",
    "tigertrade",
    "usmart_hk",
)


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
