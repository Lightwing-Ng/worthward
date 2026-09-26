"""Shared constants and dependency bindings for investment import domains.

Code version: v0.1.1
"""

from __future__ import annotations

import base64

import csv

from copy import deepcopy

import email

import hashlib

import json

import logging

import re

import subprocess

import tempfile

import xml.etree.ElementTree as ET

from collections import Counter, defaultdict

from datetime import date, datetime, timedelta, timezone

from email import policy

from email.utils import parsedate_to_datetime

from pathlib import Path

from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

from io import BytesIO, TextIOWrapper

from typing import Any, Callable

from zoneinfo import ZoneInfo

from zipfile import BadZipFile, ZipFile

from app.core.broker_catalog import sort_broker_codes

from app.core.branding import read_compatible_environment

from app.core.preferences.broker import BrokerSettings, uses_longbridge_cli_oauth

from app.core.config import SETTINGS_STORE_DIR

from app.infrastructure.longbridge_cli import (
    get_longbridge_cli_auth_status,
    run_longbridge_cli_json,
)

from app.infrastructure.parallel import map_ordered

from app.infrastructure.storage import (
    MAX_INVESTMENT_SOURCE_ARTIFACT_BYTES,
    canonicalize_investment_ticker,
    investment_evidence_dir_for,
    normalize_ticker,
)

from app.services.investment.investment_record_basics import (
    build_normalized_transaction_view as _build_normalized_view,
    decimal_to_str as _decimal_to_str,
    normalize_import_text as _normalize_text,
    normalize_import_whitespace as _normalize_whitespace,
    parse_decimal_text as _parse_decimal,
)

from app.services.investment.importing.registry import InvestmentParserRegistry

from app.services.investment.importing.brokers.zircon_hk import (
    build_investment_payload_from_zircon_hk_manual_xlsx,
)

LOGGER = logging.getLogger(__name__)

IBKR_SECURITY_IDENTIFIER_DESCRIPTION_PATTERN = re.compile(
    r"\b(?P<ticker>[A-Za-z][A-Za-z0-9._-]{0,15})\s*"
    r"\(\s*(?P<identifier>[A-Za-z]{2}[A-Za-z0-9]{8,})\s*\)"
)

TRANSACTION_DESCRIPTION_SEPARATOR = " · "

TRANSACTION_DESCRIPTION_SEPARATOR_PATTERN = re.compile(r"\s+(?:-|–|—|\|)\s+")

SCHEMA_VERSION = "3.0.0"

LONGBRIDGE_HK_IMPORTER_VERSION = "0.19.0"

LONGBRIDGE_SG_IMPORTER_VERSION = "0.5.0"

USMART_HK_IMPORTER_VERSION = "0.1.1"

TIGERTRADE_IMPORTER_VERSION = "0.1.2"

HSBC_STATEMENT_PDF_IMPORTER_VERSION = "0.7.0"

PRIVATE_INVESTMENT_EVIDENCE_PATH = (
    SETTINGS_STORE_DIR / "private_investment_evidence.json"
)

LONGBRIDGE_USER_CONFIRMED_PERFORMANCE_CALIBRATION_SOURCE = (
    "user_confirmed_broker_performance_calibration"
)

IBKR_USER_VERIFIED_CASH_SNAPSHOT_SOURCE = "ibkr_user_verified_app_cash"

IBKR_GAINSKEEPER_CASH_SNAPSHOT_SOURCE = "ibkr_gainskeeper_balances"

IBKR_USER_VERIFIED_POSITION_SNAPSHOT_SOURCE = "ibkr_user_verified_app_positions"

IBKR_WEB_CAPTURE_SCOPE = "supplemental"

IBKR_WEB_CAPTURE_ROLE = "trade_records_after_file_cutoff"

IBKR_WEB_SNAPSHOT_RELATIONSHIP = "supplements_file_snapshots_when_present"

IBKR_WEB_CAPTURE_METADATA_FIELDS = (
    "capture_scope",
    "capture_role",
    "snapshot_relationship",
)

DEFAULT_CONVENTION_TIME = "20:00:00"

DEFAULT_CONVENTION_TIMEZONE = "America/New_York"

IBKR_WEB_DISPLAY_TIMEZONE = ZoneInfo("Asia/Hong_Kong")

IBKR_WEB_LEDGER_TIMEZONE = ZoneInfo(DEFAULT_CONVENTION_TIMEZONE)

IBKR_WEB_TRADE_SUMMARY_PATTERN = re.compile(
    r"^(?P<action>Bot|Bought|Sold)\s+"
    r"(?P<quantity>[\d,]+(?:\.\d+)?)\s+@\s+"
    r"(?P<price>[\d,]+(?:\.\d+)?)\s+on\s+"
    r"(?P<venue>[A-Z0-9._-]+)$",
    re.IGNORECASE,
)

IBKR_WEB_TRADE_DATETIME_PATTERN = re.compile(
    r"^\d{1,2}/\d{1,2}/20\d{2},\s+\d{1,2}:\d{2}\s+[AP]M$",
    re.IGNORECASE,
)

IBKR_WEB_COMPACT_TRADE_PATTERN = re.compile(
    r"^(?P<action>Buy|Sold)\s+"
    r"(?P<quantity>[\d,]+(?:\.\d+)?)\s+"
    r"(?P<ticker>[A-Z0-9][A-Z0-9.-]*)\s+Limit\s+"
    r"(?P<price>[\d,]+(?:\.\d+)?)\s*,\s*"
    r"(?P<venue>[A-Z0-9._-]+)$",
    re.IGNORECASE,
)

IBKR_WEB_COMPACT_TIME_PATTERN = re.compile(
    r"^\d{1,2}:\d{2}\s+[AP]M$",
    re.IGNORECASE,
)

IBKR_WEB_TRADE_FEE_PATTERN = re.compile(
    r"^Fees:\s*(?P<fee>[\d,]+(?:\.\d+)?)$",
    re.IGNORECASE,
)

ZERO = Decimal("0")

MIXED_BROKER_SNAPSHOT_WARNING = (
    "Mixed broker/account store detected. Authoritative position and cash snapshots are disabled "
    "at the merged top level to avoid confusing one broker account with the whole portfolio."
)

HSBC_EXPECTED_ACCOUNT_NUMBER = read_compatible_environment(
    "WORTHWARD_HSBC_ACCOUNT_NUMBER",
    "ANTIGRAVITY_HSBC_ACCOUNT_NUMBER",
)

HSBC_EXPECTED_INVESTMENT_ACCOUNT_NUMBER = read_compatible_environment(
    "WORTHWARD_HSBC_INVESTMENT_ACCOUNT_NUMBER",
    "ANTIGRAVITY_HSBC_INVESTMENT_ACCOUNT_NUMBER",
)

HSBC_PASTE_CHUNK_MARKER = "===== HSBC PASTE CHUNK ====="

HSBC_CASH_ACCOUNT_FILE_KINDS = frozenset(
    {
        "hsbc_usd_account_text",
        "hsbc_usd_savings_csv",
        "hsbc_multi_currency_cash_account_text",
        "hsbc_statement_cash",
    }
)

HSBC_CURRENCY_ALIASES = {
    "USD": "USD",
    "HKD": "HKD",
    "CNH": "CNH",
    "CNY": "CNH",
    "RMB": "CNH",
}

IBKR_REALIZED_SUMMARY_NATIVE_CASH_FILE_KIND = "ibkr_realized_summary_cash"

IBKR_TRANSACTION_HISTORY_CASH_FILE_KIND = "transactions"

IBKR_CASH_EQUIVALENT_MAX_DATE_GAP_DAYS = 1

IBKR_CASH_EQUIVALENT_RELATIVE_TOLERANCE = Decimal("0.02")

HSBC_STATEMENT_DATE_TIMEZONE = "Asia/Hong_Kong"

BOCHK_STATEMENT_IMPORTER_VERSION = "0.3.0"

BOCHK_STATEMENT_DATE_TIMEZONE = "Asia/Hong_Kong"

BOCHK_CUSTOMER_NUMBER_PATTERN = re.compile(
    r"(?:Enrich|i-Free)\s+Banking\s+Customer\s+No\s+(?P<customer>\d+)",
    re.IGNORECASE,
)

BOCHK_STATEMENT_DATE_PATTERN = re.compile(
    r"Statement\s+Date\s+(?P<date>20\d{2}/\d{2}/\d{2})",
    re.IGNORECASE,
)

BOCHK_ACCOUNT_SECTION_PATTERN = re.compile(
    r"^(?P<account_type>HKD\s+(?:Savings|Current)|Foreign\s+Currency\s+(?:Savings|Current))\s+"
    r"\((?P<account_number>[0-9-]+)\)\s*§?$",
    re.IGNORECASE,
)

BOCHK_CURRENCY_ALIASES = {
    "HKD": "HKD",
    "USD": "USD",
    "CNH": "CNH",
    "CNY": "CNH",
    "RMB": "CNH",
}

BOCHK_CURRENCY_MARKERS = frozenset(BOCHK_CURRENCY_ALIASES)

BOCHK_SECURITIES_CASH_SECTION = (
    "US Securities Account Withdrawals / Deposits of Cash Balance"
)

BOCHK_STATEMENT_MONEY_PATTERN = re.compile(
    r"(?<![A-Z0-9])(?:\(\s*)?-?\d[\d,]*\.\d{2,4}(?:DR)?(?:\s*\))?(?![A-Z0-9])",
    re.IGNORECASE,
)

HSBC_EXPLICIT_FOREX_TRANSACTION_PATTERN = re.compile(
    r"\b(?:FOREIGN\s+EXCHANGE|CURRENCY\s+(?:CONVERSION|EXCHANGE)|"
    r"FX\s+(?:FROM|CONVERSION|EXCHANGE|DEAL|TRADE))\b",
    re.IGNORECASE,
)

HSBC_FOREX_REFERENCE_PATTERN = re.compile(
    r"\b(?P<reference>(?:[A-Z]{1,4}\d{6,}|(?:FX|FOREX)[A-Z0-9-]{4,}))\b",
    re.IGNORECASE,
)

HSBC_PORTFOLIO_UPDATED_PATTERN = re.compile(
    r"^Updated\s+(?P<time>\d{1,2}:\d{2}:\d{2})\s+on\s+"
    r"(?P<date>\d{1,2}\s+[A-Za-z]{3,9}\s+20\d{2})\s+U\.S\. ET$",
    re.IGNORECASE,
)

HSBC_ORDER_STATUS_ROLLING_WINDOW_PATTERN = re.compile(
    r"within\s+the\s+last\s+(?P<calendar_days>\d+)\s+calendar\s+days",
    re.IGNORECASE,
)

HSBC_TRADE_SETTLEMENT_REFERENCE_PATTERN = re.compile(
    r"^HK\d{6}[A-Z0-9 ]+(?:\s+\d{3})?$",
    re.IGNORECASE,
)

HSBC_ORDER_SETTLEMENT_REFERENCE_PATTERN = re.compile(
    r"^REF\s+(?P<prefix>[PS])(?P<order_number>\d+)001\s+SEC(?:\s+\(\d{2}[A-Z]{3}\d{2}\))?$",
    re.IGNORECASE,
)

HSBC_PARTIAL_ORDER_STATUS_WARNING = (
    "HSBC Portfolio text is treated as authoritative. Replayed fully executed orders did not fully reconcile "
    "to the current portfolio snapshot, which usually means the pasted Order Status range does not cover the full holding history."
)

HSBC_CORPORATE_EVENT_PAYMENT_PREFIX = "CORP EVT PAYMENT"

HSBC_DIVIDEND_MATCH_LOOKBACK_DAYS = 14

HSBC_DIVIDEND_NET_RETENTION_RATES = (
    Decimal("1"),
    Decimal("0.90"),
    Decimal("0.85"),
    Decimal("0.70"),
)

HSBC_STATEMENT_DATE_PATTERN = re.compile(
    r"Page\s+1\s+of\s+\d+\s*\n\s*(?P<day>\d{1,2})\s+(?P<month>[A-Z][a-z]+)\s+(?P<year>20\d{2})",
    re.IGNORECASE,
)

HSBC_STATEMENT_MONTHS = {
    "jan": 1,
    "feb": 2,
    "mar": 3,
    "apr": 4,
    "may": 5,
    "jun": 6,
    "jul": 7,
    "aug": 8,
    "sep": 9,
    "oct": 10,
    "nov": 11,
    "dec": 12,
}

CURRENCY_CODE_PATTERN = re.compile(r"\b([A-Z]{3})\b")

LONGBRIDGE_ORDER_TIME_FIELDS = (
    "filled_at",
    "executed_at",
    "dealt_at",
    "time",
    "updated_at",
    "created_at",
    "submitted_at",
)

LONGBRIDGE_US_MARKET_TIMEZONE = ZoneInfo("America/New_York")

LONGBRIDGE_MARKET_TIMEZONES = {
    "US": ZoneInfo("America/New_York"),
    "HK": ZoneInfo("Asia/Hong_Kong"),
    "SH": ZoneInfo("Asia/Shanghai"),
    "SZ": ZoneInfo("Asia/Shanghai"),
    "SG": ZoneInfo("Asia/Singapore"),
}

LONGBRIDGE_EXECUTED_ORDER_STATUSES = {
    "filled",
    "filledstatus",
    "partialwithdrawal",
    "partialfilled",
    "partiallyfilled",
    "partialfilledstatus",
    "partiallycancelled",
}

LONGBRIDGE_STOCK_CONTRACT_FLOW_SIDES = {
    "buy contract-stocks": "buy",
    "sell contract-stocks": "sell",
    "buy contract - stock": "buy",
    "sell contract - stock": "sell",
    "option purchase transaction": "buy",
    "option sell transaction": "sell",
    "stock short sale": "sell",
}

LONGBRIDGE_STOCK_FEE_FLOW_SIDES = {
    "stock trade fee": None,  # generic fee, can apply to buy or sell
    "stock sell commission": "sell",
    "fees for buy trade": "buy",
    "fees for sell trade": "sell",
    "option purchase fee": "buy",
    "option sell fee": "sell",
}

LONGBRIDGE_SG_MONTH_HEADER_PATTERN = re.compile(r"^\d{4}\.\w{3}$")

LONGBRIDGE_SG_FUND_AMOUNT_PATTERN = re.compile(r"^(-?[\d,]+\.\d+)\s+([A-Z]{3})$")

LONGBRIDGE_SG_FUND_DATE_PATTERN = re.compile(r"^\d{4}\.\d{2}\.\d{2}$")

LONGBRIDGE_SG_FUND_TICKER_PATTERN = re.compile(
    r"^[A-Z0-9]+\.(US|HK|SH|SZ|SG)$", re.IGNORECASE
)

LONGBRIDGE_SG_FUND_SHARES_PATTERN = re.compile(r"^-?\d+\s+Shares$", re.IGNORECASE)

LONGBRIDGE_SG_FUND_SKIP_LINES = frozenset({"All Months", "Filter"})

LONGBRIDGE_SG_EASTERN_TIME_SUFFIX_PATTERN = re.compile(r"\s+ET$", re.IGNORECASE)

LONGBRIDGE_HK_EMBEDDED_MARKET_SYMBOL_PATTERN = re.compile(
    r"(?P<symbol>[A-Z0-9]{1,16})\.(?P<market>US|HK|SH|SZ|SG)(?=\)|\b)",
    re.IGNORECASE,
)

LONGBRIDGE_HK_ISIN_DESCRIPTION_SYMBOL_PATTERN = re.compile(
    r"(?:CANCEL\s+)?(?P<symbol>[A-Z][A-Z0-9]{0,15})\((?:US|HK)[A-Z0-9]+\)",
    re.IGNORECASE,
)

LONGBRIDGE_HK_WITHHOLDING_SYMBOL_PATTERN = re.compile(
    r"(?:REVERSAL\s+)?(?P<symbol>[A-Z][A-Z0-9]{0,15})\s+WITHHOLDING\b",
    re.IGNORECASE,
)

LONGBRIDGE_HK_MMF_SHARES_PATTERN = re.compile(
    r"(?P<shares>-?\d+(?:\.\d+)?)\s+SHARES\b",
    re.IGNORECASE,
)

LONGBRIDGE_HK_FEE_FLOW_NAMES = frozenset(
    {
        "co other fee",
        "option purchase fee",
        "option sell fee",
        "stock sell commission",
        "stock trade fee",
    }
)

LONGBRIDGE_HK_DIVIDEND_WITHHOLDING_FLOW_NAMES = frozenset({"co other fee", "others"})

LONGBRIDGE_SG_FLAT_HOLDING_TICKERS = ("TQQQ", "NVDA")

LONGBRIDGE_STOCK_CASH_FLOW_MATCH_HOURS = Decimal("96")

LONGBRIDGE_STOCK_CASH_FLOW_AMOUNT_TOLERANCE = Decimal("0.05")

LONGBRIDGE_STOCK_CASH_FLOW_MATCH_MAX_CANDIDATES = 12

LONGBRIDGE_IMPORT_WINDOW_DAYS = 120

LONGBRIDGE_ORDER_IMPORT_WINDOW_DAYS = 60

LONGBRIDGE_ORDER_METADATA_LOOKBACK_DAYS = 30

LONGBRIDGE_IMPORT_MIN_RETRY_WINDOW_DAYS = 7

LONGBRIDGE_OPTION_DESCRIPTION_PATTERN = re.compile(
    r"\bOP/(?P<market>US|HK|SH|SZ|SG)/(?P<symbol>[A-Z0-9]+)\b",
    re.IGNORECASE,
)

LONGBRIDGE_US_OPTION_SYMBOL_PATTERN = re.compile(
    r"^[A-Z]{1,10}\d{6}[CP]\d{1,8}$",
    re.IGNORECASE,
)

LONGBRIDGE_BARE_SYMBOL_DESCRIPTION_PATTERN = re.compile(
    r"^(?P<symbol>[A-Z0-9]{1,16})(?:\.(?P<market>US|HK|SH|SZ|SG))?$",
    re.IGNORECASE,
)

LONGBRIDGE_CURRENCY_MARKET_SUFFIXES = {
    "USD": "US",
    "HKD": "HK",
}

TYPE_MAPPING = {
    "Deposit": "deposit",
    "Buy": "buy",
    "Sell": "sell",
    "Dividend": "dividend",
    "Foreign Tax Withholding": "foreign_tax_withholding",
    "Payment in Lieu": "payment_in_lieu",
    "Debit Interest": "debit_interest",
    "Credit Interest": "credit_interest",
    "Dividend Reinvestment": "dividend_reinvestment",
    "Adjustment": "adjustment",
    "Forex Trade Component": "forex_trade_component",
    "Withdrawal": "withdrawal",
    "Transfer In": "transfer_in",
    "Transfer Out": "transfer_out",
}

GRANT_PATTERN = re.compile(
    r"^(?P<grant_date>\d{4}-\d{2}-\d{2})"
    r"(?:,\s+\d{2}:\d{2}:\d{2})?"
    r"\s+\(Vesting:\s+"
    r"(?P<vesting_date>\d{4}-\d{2}-\d{2})"
    r"(?:,\s+\d{2}:\d{2}:\d{2})?"
    r"\)$"
)

_SECURITY_TRANSFER_FIFO_METHOD = "fifo_reconstructed"

_SECURITY_TRANSFER_FIFO_METHOD_LABEL = "FIFO reconstructed"

_SECURITY_TRANSFER_FIFO_BASIS_FIELDS = (
    "carried_cost_basis_raw",
    "carried_cost_basis_status",
    "carried_cost_basis_method",
    "carried_cost_basis_method_label",
    "carried_cost_basis_quantity_raw",
    "carried_cost_basis_source_transfer_key",
    "carried_cost_basis_allocations",
    "transfer_out_cost_basis_raw",
    "transfer_out_cost_basis_status",
    "transfer_out_cost_basis_method",
    "transfer_out_cost_basis_method_label",
    "transfer_out_cost_basis_quantity_raw",
    "transfer_out_cost_basis_allocations",
)

_REALIZED_PNL_REPLAY_TRANSACTION_TYPES = frozenset(
    {
        "buy",
        "sell",
        "grant",
        "dividend_reinvestment",
        "transfer_in",
        "transfer_out",
    }
)

_INVESTMENT_INTERNAL_TRANSFER_BANK_BROKERS = frozenset({"hsbc", "boc_hk", "cmbwl"})

_INVESTMENT_INTERNAL_TRANSFER_DATE_PATTERN = re.compile(
    r"(?<![A-Z0-9])(?P<day>\d{1,2})(?P<month>JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)"
    r"(?P<year>\d{2}|\d{4})?(?![A-Z0-9])",
    re.IGNORECASE,
)

_INVESTMENT_INTERNAL_TRANSFER_UNDATED_POSTING_LAG_DAYS = 1

GKX_SUPPORTED_INVTRANLIST_TAGS = frozenset(
    {
        "DTSTART",
        "DTEND",
        "BUYSTOCK",
        "SELLSTOCK",
        "BUYOTHER",
        "SELLOTHER",
        "INCOME",
        "INVEXPENSE",
        "INVBANKTRAN",
        "TRANSFER",
    }
)

_LONGBRIDGE_HISTORY_ORDERS_REQUIRED_COLUMNS = frozenset(
    {
        "order status",
        "market",
        "symbol",
        "direction",
        "currency",
        "order time",
        "avg price",
        "executed qty",
        "order no.",
    }
)

_LONGBRIDGE_HISTORY_LOG_REQUIRED_COLUMNS = frozenset(
    {
        "order no.",
        "order status",
        "time",
    }
)

_LONGBRIDGE_HISTORY_XLSX_MAX_ARCHIVE_ENTRIES = 512

_LONGBRIDGE_HISTORY_XLSX_MAX_UNCOMPRESSED_BYTES = 128 * 1024 * 1024

_LONGBRIDGE_HISTORY_XLSX_REQUIRED_MEMBERS = {
    "[Content_Types].xml",
    "xl/workbook.xml",
}

_LONGBRIDGE_HISTORY_XLSX_FORBIDDEN_PREFIXES = (
    "xl/embeddings/",
    "xl/externalLinks/",
    "xl/oleObjects/",
)

_LONGBRIDGE_HISTORY_XLSX_FORBIDDEN_NAMES = {
    "xl/connections.xml",
    "xl/vbaProject.bin",
}

FUTUHK_STATEMENT_TIMEZONE = "Asia/Hong_Kong"

FUTUHK_INTERNAL_TRANSFER_SCOPE = "futuhk_hk_stocks_account"

FUTUHK_INTERNAL_TRANSFER_REMARK = "TRANSFER FROM HK STOCKS ACCOUNT"

FUTUHK_TRADE_ROW_PATTERN = re.compile(
    r"^(?P<side>買入|賣出)\s+訂單合計\s+"
    r"(?P<order_id>\d+)\s+"
    r"(?:(?P<inline_name>.+?)\s+)?"
    r"(?P<trade_date>\d{4}/\d{2}/\d{2})\s+"
    r"(?P<quantity>[\d,]+)\s+"
    r"(?P<price>[\d,]+\.?\d*)\s+"
    r"(?P<gross>[\d,]+\.\d+)\s+"
    r"(?P<net>[+-]?[\d,]+\.\d+)$"
)

FUTUHK_FLOW_ROW_PATTERN = re.compile(
    r"^(?P<direction>In|Out)\s+"
    r"(?P<date>\d{4}/\d{2}/\d{2})\s+"
    r"(?P<amount>[+-]?[\d,]+\.\d+)\s+"
    r"(?P<settlement_date>\d{4}/\d{2}/\d{2})\s+"
    r"(?P<order_id>\d+)"
    r"(?:\s+(?P<inline_remark>.+))?$"
)

FUTUHK_ACCOUNT_PATTERN = re.compile(r"賬戶號碼[：:\s]*(\d{10,})")

FUTUHK_STATEMENT_PERIOD_PATTERN = re.compile(
    r"月結單（(?P<year>\d{4})年(?P<month>\d{2})月）"
)

FUTUHK_SETTLEMENT_DATE_PATTERN = re.compile(
    r"交收日期[：:]\s*(?P<date>\d{4}/\d{2}/\d{2})"
)

FUTUHK_SYMBOL_PREFIX_PATTERN = re.compile(r"^([A-Z]{1,5})\([^)]*$")

FUTUHK_PAGE_MARKER_PATTERN = re.compile(
    r"(?:--\s*)?\d+\s+of\s+\d+\s+--|\d+/\d+$", re.IGNORECASE
)

FUTUHK_TRADE_CONTEXT_NOISE_PATTERNS = (
    "佣金：",
    "交收費：",
    "證監會費：",
    "交易活動費：",
    "平台使用費：",
    "小計：",
    "成交金額合計：",
    "交易費用合計：",
    "佣金合計：",
    "平台使用費合計：",
    "變動金額合計：",
    "客戶姓名：",
    "股票订单",
    "股票訂單",
    "交易明細",
    "資金進出",
    "期末總覽",
    "期初總覽",
)

USMART_HK_TIMEZONE = "Asia/Hong_Kong"

TIGERTRADE_US_TIMEZONE = "America/New_York"

TIGERTRADE_FUND_TIMEZONE = "Asia/Hong_Kong"

USMART_HK_ACCOUNT_PATTERN = re.compile(r"賬戶號碼\s+(\d{6,})")

USMART_HK_PERIOD_PATTERN = re.compile(r"結單⽇期[：:]\s*(\d{4}-\d{2})")

USMART_HK_TRADE_PATTERN = re.compile(
    r"(?P<market>美股|港股)\s+(?P<side>買⼊|買入|賣出|卖出)\s+"
    r"(?P<quantity>[\d,]+(?:\.\d+)?)\s+(?P<currency>[A-Z]{3})\s+"
    r"(?P<price>[\d,]+(?:\.\d+)?)\s+(?P<gross>[\d,]+(?:\.\d+)?)\s+"
    r"(?P<trade_date>\d{4}-\d{2}-\d{2})"
)

USMART_HK_CASH_ROW_PATTERN = re.compile(
    r"^\s*(?P<item>[^\s]+)\s{2,}(?P<currency>HKD|USD|CNY)\s{2,}"
    r"(?P<amount>-?[\d,]+\.\d+)\s{2,}(?P<date>\d{4}-\d{2}-\d{2})(?:\s{2,}(?P<remark>.*))?$"
)

TIGERTRADE_ACCOUNT_PATTERN = re.compile(
    r"Account Information.*?\n\s*(\d{5,})\s+",
    re.DOTALL,
)

TIGERTRADE_PERIOD_PATTERN = re.compile(
    r"Activity Statement\s*:\s*(\d{4}\.\d{2}\.\d{2})\s*-\s*(\d{4}\.\d{2}\.\d{2})"
)

TIGERTRADE_FOREX_PATTERN = re.compile(
    r"^\s*(?P<ticker>[A-Z]{3}\.[A-Z]{3})\s+(?P<side>Buy|Sell)\s+"
    r"(?P<quantity>-?[\d,]+(?:\.\d+)?)\s+(?P<price>[\d,]+(?:\.\d+)?)\s+"
    r"(?P<amount>-?[\d,]+(?:\.\d+)?)\s+.*?(?P<settle_date>\d{4}-\d{2}-\d{2})\s+"
    r"(?P<currency>[A-Z]{3})\s*$"
)

TIGERTRADE_STOCK_PATTERN = re.compile(
    r"\bUS\s+(?P<exchange>NASDAQ|NYSE|ARCA|AMEX)\s+(?P<activity>Open|Close)\s+"
    r"(?P<quantity>-?[\d,]+(?:\.\d+)?)\s+(?P<price>[\d,]+(?:\.\d+)?)\s+"
    r"(?P<amount>-?[\d,]+(?:\.\d+)?)\s+"
)

TIGERTRADE_FUND_PATTERN = re.compile(
    r"\b(?P<market>HK|SG)\s+(?P<activity>Buy|Sell)\s+"
    r"(?P<quantity>-?[\d,]+(?:\.\d+)?)\s+(?P<price>[\d,]+(?:\.\d+)?)\s+"
    r"(?P<amount>-?[\d,]+(?:\.\d+)?)\s+(?P<fee>-?[\d,]+(?:\.\d+)?)\s+"
    r"(?P<realized>-?[\d,]+(?:\.\d+)?)\s+"
)

CMBWL_SECURITIES_ORDER_TIMEZONE = "Asia/Hong_Kong"

CMBWL_COMPLETED_ORDER_PATTERN = re.compile(r"was completed", re.IGNORECASE)

CMBWL_CANCELLED_ORDER_PATTERN = re.compile(r"unmatched and cancelled", re.IGNORECASE)

CMBWL_ACCOUNT_PATTERN = re.compile(r"account\s+([\d\-X]+)", re.IGNORECASE)

CMBWL_SYMBOL_LINE_PATTERN = re.compile(r"^(.+?)\s*\(([A-Z0-9\.]+)\)\s*$")

CMBWL_ACTION_PATTERN = re.compile(r"^Action:\s*(Bought|Sold)\s*$", re.IGNORECASE)

CMBWL_EXECUTED_QTY_PATTERN = re.compile(
    r"^Executed Qty:\s*([\d,\.]+)\s*$", re.IGNORECASE
)

CMBWL_EXECUTED_PRICE_PATTERN = re.compile(
    r"^Executed Price:\s*([A-Z]{3})([\d,\.]+)\s*$",
    re.IGNORECASE,
)

CMBWL_CANCELLED_QTY_PATTERN = re.compile(r"^Qty:\s*([\d,\.]+)\s*$", re.IGNORECASE)

CMBWL_CANCELLED_PRICE_PATTERN = re.compile(
    r"^Price:\s*([A-Z]{3})\s*([\d,\.]+)\s*$",
    re.IGNORECASE,
)

CMBWL_ORDER_NO_PATTERN = re.compile(r"^Order No\.:\s*(\d+)\s*$", re.IGNORECASE)

SCHWAB_FILLED_STATUS = {"filled", "executed", "complete", "done", "partially filled"}

SCHWAB_ACTION_TO_TYPE = {
    "buy": "buy",
    "buy to cover": "buy",
    "buy to open": "buy",
    "sell": "sell",
    "sell short": "sell",
    "sell to close": "sell",
    "sell to open": "sell",
    "dividend": "dividend",
    "qualified dividend": "dividend",
    "qualified div": "dividend",
    "non-qualified dividend": "dividend",
    "non-qualified div": "dividend",
    "cash dividend": "dividend",
    "ordinary dividend": "dividend",
    "reinvest dividend": "dividend_reinvestment",
    "dividend reinvestment": "dividend_reinvestment",
    "nra tax adj": "foreign_tax_withholding",
    "nra tax adjustment": "foreign_tax_withholding",
    "foreign tax withholding": "foreign_tax_withholding",
    "withholding tax": "foreign_tax_withholding",
    "dividend tax": "foreign_tax_withholding",
    "interest": "credit_interest",
    "credit interest": "credit_interest",
    "debit interest": "debit_interest",
    "deposit": "deposit",
    "withdrawal": "withdrawal",
    "wire received": "deposit",
    "wire sent": "withdrawal",
    "moneylink transfer": "deposit",
    "security transfer": "transfer_in",
    "security transfer in": "transfer_in",
    "security transfer out": "transfer_out",
    "journal": "adjustment",
    "fee": "adjustment",
}

SCHWAB_LEGACY_TRANSACTION_TYPE_ALIASES = {
    "nra_tax_adj": "foreign_tax_withholding",
    "nra_tax_adjustment": "foreign_tax_withholding",
}

SCHWAB_POSITIONS_HEADER_PATTERN = re.compile(
    r"^Positions\s+for\s+account\s+(?P<account>.+?)\s+as\s+of\s+"
    r"(?P<time>\d{1,2}:\d{2}\s*[AP]M)\s+ET,\s*"
    r"(?P<date>\d{4}[/-]\d{2}[/-]\d{2})$",
    re.IGNORECASE,
)

SCHWAB_FILENAME_ACCOUNT_PATTERN = re.compile(
    r"(?:^|[_-])(?P<account>[Xx*•.\s]*\d{3,})(?:[_-])"
    r"(?:transactions|positions)(?:[_-]|$)",
    re.IGNORECASE,
)

SCHWAB_ACCOUNT_SUFFIX_PATTERN = re.compile(r"(?P<suffix>\d{3,})\s*$")

SCHWAB_POSITIONS_TOTAL_TOLERANCE = Decimal("0.01")

SCHWAB_UNKNOWN_NUMERIC_VALUES = frozenset(
    {
        "",
        "-",
        "--",
        "n/a",
        "na",
        "incomplete",
        "unknown",
        "not available",
        "—",
        "–",
    }
)

SCHWAB_INTERNAL_TRANSFER_JOURNAL_ACTIONS = frozenset({"journal"})

SCHWAB_SECURITY_TRANSFER_ACTIONS = frozenset(
    {
        "security transfer",
        "security transfer in",
    }
)

__all__ = (
    "Any",
    "BOCHK_ACCOUNT_SECTION_PATTERN",
    "BOCHK_CURRENCY_ALIASES",
    "BOCHK_CURRENCY_MARKERS",
    "BOCHK_CUSTOMER_NUMBER_PATTERN",
    "BOCHK_SECURITIES_CASH_SECTION",
    "BOCHK_STATEMENT_DATE_PATTERN",
    "BOCHK_STATEMENT_DATE_TIMEZONE",
    "BOCHK_STATEMENT_IMPORTER_VERSION",
    "BOCHK_STATEMENT_MONEY_PATTERN",
    "BadZipFile",
    "BrokerSettings",
    "BytesIO",
    "CMBWL_ACCOUNT_PATTERN",
    "CMBWL_ACTION_PATTERN",
    "CMBWL_CANCELLED_ORDER_PATTERN",
    "CMBWL_CANCELLED_PRICE_PATTERN",
    "CMBWL_CANCELLED_QTY_PATTERN",
    "CMBWL_COMPLETED_ORDER_PATTERN",
    "CMBWL_EXECUTED_PRICE_PATTERN",
    "CMBWL_EXECUTED_QTY_PATTERN",
    "CMBWL_ORDER_NO_PATTERN",
    "CMBWL_SECURITIES_ORDER_TIMEZONE",
    "CMBWL_SYMBOL_LINE_PATTERN",
    "CURRENCY_CODE_PATTERN",
    "Callable",
    "Counter",
    "DEFAULT_CONVENTION_TIME",
    "DEFAULT_CONVENTION_TIMEZONE",
    "Decimal",
    "ET",
    "FUTUHK_ACCOUNT_PATTERN",
    "FUTUHK_FLOW_ROW_PATTERN",
    "FUTUHK_INTERNAL_TRANSFER_REMARK",
    "FUTUHK_INTERNAL_TRANSFER_SCOPE",
    "FUTUHK_PAGE_MARKER_PATTERN",
    "FUTUHK_SETTLEMENT_DATE_PATTERN",
    "FUTUHK_STATEMENT_PERIOD_PATTERN",
    "FUTUHK_STATEMENT_TIMEZONE",
    "FUTUHK_SYMBOL_PREFIX_PATTERN",
    "FUTUHK_TRADE_CONTEXT_NOISE_PATTERNS",
    "FUTUHK_TRADE_ROW_PATTERN",
    "GKX_SUPPORTED_INVTRANLIST_TAGS",
    "GRANT_PATTERN",
    "HSBC_CASH_ACCOUNT_FILE_KINDS",
    "HSBC_CORPORATE_EVENT_PAYMENT_PREFIX",
    "HSBC_CURRENCY_ALIASES",
    "HSBC_DIVIDEND_MATCH_LOOKBACK_DAYS",
    "HSBC_DIVIDEND_NET_RETENTION_RATES",
    "HSBC_EXPECTED_ACCOUNT_NUMBER",
    "HSBC_EXPECTED_INVESTMENT_ACCOUNT_NUMBER",
    "HSBC_EXPLICIT_FOREX_TRANSACTION_PATTERN",
    "HSBC_FOREX_REFERENCE_PATTERN",
    "HSBC_ORDER_SETTLEMENT_REFERENCE_PATTERN",
    "HSBC_ORDER_STATUS_ROLLING_WINDOW_PATTERN",
    "HSBC_PARTIAL_ORDER_STATUS_WARNING",
    "HSBC_PASTE_CHUNK_MARKER",
    "HSBC_PORTFOLIO_UPDATED_PATTERN",
    "HSBC_STATEMENT_DATE_PATTERN",
    "HSBC_STATEMENT_DATE_TIMEZONE",
    "HSBC_STATEMENT_MONTHS",
    "HSBC_STATEMENT_PDF_IMPORTER_VERSION",
    "HSBC_TRADE_SETTLEMENT_REFERENCE_PATTERN",
    "IBKR_CASH_EQUIVALENT_MAX_DATE_GAP_DAYS",
    "IBKR_CASH_EQUIVALENT_RELATIVE_TOLERANCE",
    "IBKR_GAINSKEEPER_CASH_SNAPSHOT_SOURCE",
    "IBKR_REALIZED_SUMMARY_NATIVE_CASH_FILE_KIND",
    "IBKR_SECURITY_IDENTIFIER_DESCRIPTION_PATTERN",
    "IBKR_TRANSACTION_HISTORY_CASH_FILE_KIND",
    "IBKR_USER_VERIFIED_CASH_SNAPSHOT_SOURCE",
    "IBKR_USER_VERIFIED_POSITION_SNAPSHOT_SOURCE",
    "IBKR_WEB_CAPTURE_METADATA_FIELDS",
    "IBKR_WEB_CAPTURE_ROLE",
    "IBKR_WEB_CAPTURE_SCOPE",
    "IBKR_WEB_COMPACT_TIME_PATTERN",
    "IBKR_WEB_COMPACT_TRADE_PATTERN",
    "IBKR_WEB_DISPLAY_TIMEZONE",
    "IBKR_WEB_LEDGER_TIMEZONE",
    "IBKR_WEB_SNAPSHOT_RELATIONSHIP",
    "IBKR_WEB_TRADE_DATETIME_PATTERN",
    "IBKR_WEB_TRADE_FEE_PATTERN",
    "IBKR_WEB_TRADE_SUMMARY_PATTERN",
    "InvalidOperation",
    "InvestmentParserRegistry",
    "LOGGER",
    "LONGBRIDGE_BARE_SYMBOL_DESCRIPTION_PATTERN",
    "LONGBRIDGE_CURRENCY_MARKET_SUFFIXES",
    "LONGBRIDGE_EXECUTED_ORDER_STATUSES",
    "LONGBRIDGE_HK_DIVIDEND_WITHHOLDING_FLOW_NAMES",
    "LONGBRIDGE_HK_EMBEDDED_MARKET_SYMBOL_PATTERN",
    "LONGBRIDGE_HK_FEE_FLOW_NAMES",
    "LONGBRIDGE_HK_IMPORTER_VERSION",
    "LONGBRIDGE_HK_ISIN_DESCRIPTION_SYMBOL_PATTERN",
    "LONGBRIDGE_HK_MMF_SHARES_PATTERN",
    "LONGBRIDGE_HK_WITHHOLDING_SYMBOL_PATTERN",
    "LONGBRIDGE_IMPORT_MIN_RETRY_WINDOW_DAYS",
    "LONGBRIDGE_IMPORT_WINDOW_DAYS",
    "LONGBRIDGE_MARKET_TIMEZONES",
    "LONGBRIDGE_OPTION_DESCRIPTION_PATTERN",
    "LONGBRIDGE_ORDER_IMPORT_WINDOW_DAYS",
    "LONGBRIDGE_ORDER_METADATA_LOOKBACK_DAYS",
    "LONGBRIDGE_ORDER_TIME_FIELDS",
    "LONGBRIDGE_SG_EASTERN_TIME_SUFFIX_PATTERN",
    "LONGBRIDGE_SG_FLAT_HOLDING_TICKERS",
    "LONGBRIDGE_SG_FUND_AMOUNT_PATTERN",
    "LONGBRIDGE_SG_FUND_DATE_PATTERN",
    "LONGBRIDGE_SG_FUND_SHARES_PATTERN",
    "LONGBRIDGE_SG_FUND_SKIP_LINES",
    "LONGBRIDGE_SG_FUND_TICKER_PATTERN",
    "LONGBRIDGE_SG_IMPORTER_VERSION",
    "LONGBRIDGE_SG_MONTH_HEADER_PATTERN",
    "LONGBRIDGE_STOCK_CASH_FLOW_AMOUNT_TOLERANCE",
    "LONGBRIDGE_STOCK_CASH_FLOW_MATCH_HOURS",
    "LONGBRIDGE_STOCK_CASH_FLOW_MATCH_MAX_CANDIDATES",
    "LONGBRIDGE_STOCK_CONTRACT_FLOW_SIDES",
    "LONGBRIDGE_STOCK_FEE_FLOW_SIDES",
    "LONGBRIDGE_USER_CONFIRMED_PERFORMANCE_CALIBRATION_SOURCE",
    "LONGBRIDGE_US_MARKET_TIMEZONE",
    "LONGBRIDGE_US_OPTION_SYMBOL_PATTERN",
    "MAX_INVESTMENT_SOURCE_ARTIFACT_BYTES",
    "MIXED_BROKER_SNAPSHOT_WARNING",
    "PRIVATE_INVESTMENT_EVIDENCE_PATH",
    "Path",
    "ROUND_HALF_UP",
    "SCHEMA_VERSION",
    "SCHWAB_ACCOUNT_SUFFIX_PATTERN",
    "SCHWAB_ACTION_TO_TYPE",
    "SCHWAB_FILENAME_ACCOUNT_PATTERN",
    "SCHWAB_FILLED_STATUS",
    "SCHWAB_INTERNAL_TRANSFER_JOURNAL_ACTIONS",
    "SCHWAB_LEGACY_TRANSACTION_TYPE_ALIASES",
    "SCHWAB_POSITIONS_HEADER_PATTERN",
    "SCHWAB_POSITIONS_TOTAL_TOLERANCE",
    "SCHWAB_SECURITY_TRANSFER_ACTIONS",
    "SCHWAB_UNKNOWN_NUMERIC_VALUES",
    "SETTINGS_STORE_DIR",
    "TIGERTRADE_ACCOUNT_PATTERN",
    "TIGERTRADE_FOREX_PATTERN",
    "TIGERTRADE_FUND_PATTERN",
    "TIGERTRADE_FUND_TIMEZONE",
    "TIGERTRADE_IMPORTER_VERSION",
    "TIGERTRADE_PERIOD_PATTERN",
    "TIGERTRADE_STOCK_PATTERN",
    "TIGERTRADE_US_TIMEZONE",
    "TRANSACTION_DESCRIPTION_SEPARATOR",
    "TRANSACTION_DESCRIPTION_SEPARATOR_PATTERN",
    "TYPE_MAPPING",
    "TextIOWrapper",
    "USMART_HK_ACCOUNT_PATTERN",
    "USMART_HK_CASH_ROW_PATTERN",
    "USMART_HK_IMPORTER_VERSION",
    "USMART_HK_PERIOD_PATTERN",
    "USMART_HK_TIMEZONE",
    "USMART_HK_TRADE_PATTERN",
    "ZERO",
    "ZipFile",
    "ZoneInfo",
    "_INVESTMENT_INTERNAL_TRANSFER_BANK_BROKERS",
    "_INVESTMENT_INTERNAL_TRANSFER_DATE_PATTERN",
    "_INVESTMENT_INTERNAL_TRANSFER_UNDATED_POSTING_LAG_DAYS",
    "_LONGBRIDGE_HISTORY_LOG_REQUIRED_COLUMNS",
    "_LONGBRIDGE_HISTORY_ORDERS_REQUIRED_COLUMNS",
    "_LONGBRIDGE_HISTORY_XLSX_FORBIDDEN_NAMES",
    "_LONGBRIDGE_HISTORY_XLSX_FORBIDDEN_PREFIXES",
    "_LONGBRIDGE_HISTORY_XLSX_MAX_ARCHIVE_ENTRIES",
    "_LONGBRIDGE_HISTORY_XLSX_MAX_UNCOMPRESSED_BYTES",
    "_LONGBRIDGE_HISTORY_XLSX_REQUIRED_MEMBERS",
    "_REALIZED_PNL_REPLAY_TRANSACTION_TYPES",
    "_SECURITY_TRANSFER_FIFO_BASIS_FIELDS",
    "_SECURITY_TRANSFER_FIFO_METHOD",
    "_SECURITY_TRANSFER_FIFO_METHOD_LABEL",
    "_build_normalized_view",
    "_decimal_to_str",
    "_normalize_text",
    "_normalize_whitespace",
    "_parse_decimal",
    "base64",
    "build_investment_payload_from_zircon_hk_manual_xlsx",
    "canonicalize_investment_ticker",
    "csv",
    "date",
    "datetime",
    "deepcopy",
    "defaultdict",
    "email",
    "get_longbridge_cli_auth_status",
    "hashlib",
    "investment_evidence_dir_for",
    "json",
    "logging",
    "map_ordered",
    "normalize_ticker",
    "parsedate_to_datetime",
    "policy",
    "re",
    "read_compatible_environment",
    "run_longbridge_cli_json",
    "sort_broker_codes",
    "subprocess",
    "tempfile",
    "timedelta",
    "timezone",
    "uses_longbridge_cli_oauth",
)
