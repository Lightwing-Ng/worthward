"""
Canonical broker metadata and alphabetical sort order.

Code version: v0.12.0
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class BrokerCatalogEntry:
    code: str
    label: str
    icon_filename: str
    description: str = ""


# Display labels provide a stable alphabetical order for institution selectors,
# with the code providing the final tie-breaker.
BROKER_CATALOG: dict[str, BrokerCatalogEntry] = {
    "hsbc": BrokerCatalogEntry(
        code="hsbc",
        label="HSBC",
        icon_filename="HSBC.png",
        description="Paste plain text from HSBC Order Status and the USD cash account.",
    ),
    "ibkr": BrokerCatalogEntry(
        code="ibkr",
        label="IBKR",
        icon_filename="IBKR.svg",
        description="Supported now for CSV import.",
    ),
    "longbridge": BrokerCatalogEntry(
        code="longbridge",
        label="Longbridge",
        icon_filename="Longbridge.png",
        description="Authorize the local Longbridge CLI through browser OAuth.",
    ),
    "schwab": BrokerCatalogEntry(
        code="schwab",
        label="Charles Schwab",
        icon_filename="Charles Schwab.svg",
        description="Upload Schwab Order Status CSV (e.g. Individual..._Order_Status_....csv) or Transaction History CSV.",
    ),
    "tigertrade": BrokerCatalogEntry(
        code="tigertrade",
        label="Tiger Trade",
        icon_filename="TigerTrade.png",
        description="Upload one or more Tiger Trade activity statement PDFs.",
    ),
    "usmart_hk": BrokerCatalogEntry(
        code="usmart_hk",
        label="uSMART (HK)",
        icon_filename="uSAMRT.png",
        description="Upload one or more uSMART Securities (HK) monthly statement PDFs.",
    ),
    "zircon_hk": BrokerCatalogEntry(
        code="zircon_hk",
        label="Zircon (HK)",
        icon_filename="Zircon HK.png",
        description="Download, complete, validate, and upload the generic fallback XLSX template.",
    ),
    "standard_xlsx": BrokerCatalogEntry(
        code="standard_xlsx",
        label="No specified broker",
        icon_filename="Standard XLSX.svg",
        description="Import a broker-neutral antigravity standard XLSX workbook.",
    ),
    "longbridge_hk": BrokerCatalogEntry(
        code="longbridge_hk",
        label="Longbridge (HK)",
        icon_filename="Longbridge.png",
        description="Upload Fund Details plain text and History Orders XLSX exports.",
    ),
    "longbridge_sg": BrokerCatalogEntry(
        code="longbridge_sg",
        label="Longbridge (SG)",
        icon_filename="Longbridge.png",
        description="Upload Fund Details plain text and History Orders XLSX exports.",
    ),
    "futuhk": BrokerCatalogEntry(
        code="futuhk",
        label="Futu (HK)",
        icon_filename="FutuHK.svg",
        description="Upload one or more Futu Securities International (Hong Kong) monthly statement PDFs.",
    ),
    "cmbwl": BrokerCatalogEntry(
        code="cmbwl",
        label="CMB Wing Lung Bank",
        icon_filename="CMB Wing Lung.svg",
        description="Parse completed securities order notification emails (.eml).",
    ),
    "cmb_cn": BrokerCatalogEntry(
        code="cmb_cn",
        label="China Merchants Bank",
        icon_filename="CMB Wing Lung.svg",
        description="Record Mainland China bank-account activity in CNY through the standard XLSX.",
    ),
    "cmb_hk": BrokerCatalogEntry(
        code="cmb_hk",
        label="China Merchants Bank Hong Kong Branch",
        icon_filename="CMB Wing Lung.svg",
        description="Record Hong Kong bank-account activity through the standard XLSX.",
    ),
    "boc_cn": BrokerCatalogEntry(
        code="boc_cn",
        label="Bank of China",
        icon_filename="Bank of China.svg",
        description="Record Mainland China bank-account activity in CNY, HKD, or USD through the standard XLSX.",
    ),
    "boc_hk": BrokerCatalogEntry(
        code="boc_hk",
        label="Bank of China (Hong Kong)",
        icon_filename="Bank of China.svg",
        description="Upload one or more BOCHK Consolidated Statement PDFs for Hong Kong cash-account activity.",
    ),
    "icbc_cn": BrokerCatalogEntry(
        code="icbc_cn",
        label="Industrial and Commercial Bank of China",
        icon_filename="ICBC.svg",
        description="Record Mainland China bank-account activity through the standard XLSX.",
    ),
    "icbc_hk": BrokerCatalogEntry(
        code="icbc_hk",
        label="Industrial and Commercial Bank of China (Asia)",
        icon_filename="ICBC.svg",
        description="Record Hong Kong bank-account activity through the standard XLSX.",
    ),
    "ccb_cn": BrokerCatalogEntry(
        code="ccb_cn",
        label="China Construction Bank",
        icon_filename="CCB.svg",
        description="Record Mainland China bank-account activity through the standard XLSX.",
    ),
    "ccb_hk": BrokerCatalogEntry(
        code="ccb_hk",
        label="China Construction Bank (Asia)",
        icon_filename="CCB.svg",
        description="Record Hong Kong bank-account activity through the standard XLSX.",
    ),
    "standard_chartered_hk": BrokerCatalogEntry(
        code="standard_chartered_hk",
        label="Standard Chartered (HK)",
        icon_filename="Standard Chartered.svg",
        description="Record Hong Kong bank-account activity through the standard XLSX.",
    ),
    "welab_bank": BrokerCatalogEntry(
        code="welab_bank",
        label="WeLab Bank",
        icon_filename="WeLab Bank.png",
        description="Record Hong Kong bank-account activity through the standard XLSX.",
    ),
}

SETTINGS_BROKER_CODES = ("ibkr", "longbridge")
LIVE_TRADING_BROKER_CODES = ("ibkr", "longbridge")
INVESTMENT_IMPORT_BROKER_CODES = (
    "boc_cn",
    "boc_hk",
    "ccb_cn",
    "ccb_hk",
    "cmb_cn",
    "cmbwl",
    "hsbc",
    "futuhk",
    "icbc_cn",
    "icbc_hk",
    "ibkr",
    "longbridge_hk",
    "longbridge_sg",
    "standard_xlsx",
    "schwab",
    "tigertrade",
    "usmart_hk",
    "zircon_hk",
)


def broker_sort_key(code: str | None, *, fallback_label: str | None = None) -> str:
    normalized_code = str(code or "").strip().lower()
    entry = BROKER_CATALOG.get(normalized_code)
    if entry is not None:
        return entry.label.casefold()
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
    return sorted(unique_codes, key=lambda code: (broker_sort_key(code), code))


def sorted_broker_entries(codes: list[str] | set[str] | tuple[str, ...]) -> list[BrokerCatalogEntry]:
    return [
        BROKER_CATALOG[code]
        for code in sort_broker_codes(codes)
        if code in BROKER_CATALOG
    ]
