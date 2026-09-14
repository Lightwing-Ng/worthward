"""Shared web-runtime facade and explicit route-handler schema.

Code version: v1.4.3
- Changed: Compose bounded runtime domains through explicit context factories while
  preserving the established WebRuntime route contract.
"""

# The facade imports form the patchable dependency surface captured by the
# domain context factories.
# ruff: noqa: E402, F401

from __future__ import annotations
from collections.abc import Callable
from datetime import date, datetime
from http.client import RemoteDisconnected
import json
import logging
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass
from io import BytesIO
from pathlib import Path
from typing import Any, cast
from urllib.parse import urlencode
import hashlib
import pandas as pd
from flask import (
    g,
    jsonify,
    make_response,
    redirect,
    render_template,
    request,
    send_from_directory,
    session,
    url_for,
    send_file,
)
from openpyxl import Workbook, load_workbook
from werkzeug.exceptions import RequestEntityTooLarge

from app.core.backtest_settings import (
    load_backtest_execution_mode,
    save_backtest_execution_mode,
)
from app.core.cash_equivalent_settings import (
    load_cash_equivalent_tickers,
    save_cash_equivalent_tickers,
)
from app.core.investment_settings import (
    load_investment_cost_basis_method,
    save_investment_cost_basis_method,
)
from app.core.market_identity import infer_ticker_market, market_timezone_for_ticker
from app.core.debug_reporting import load_optional_debug_endpoint, post_debug_event
from app.core.date_display_settings import (
    load_date_display_settings,
    save_full_date_display_format,
    save_short_date_display_format,
)
from app.core.language_settings import (
    HTML_LANG_BY_LANGUAGE,
    LANGUAGE_LABELS,
    SUPPORTED_LANGUAGE_CODES,
    build_translation_map,
    load_language_settings,
    save_language_code,
    save_language_settings,
    translate_nested_text,
    translate_labels,
    translate_text,
)
from app.core.live_trading_security import (
    LEGACY_LIVE_TRADING_TOKEN_HEADER,
    LIVE_TRADING_TOKEN_HEADER,
    authorize_live_trading_api_request,
    validate_live_trading_pin,
)
from app.web.request_security import (
    validate_investment_browser_write_request,
    validate_local_browser_write_request,
)
from app.infrastructure.broker_market_data import (
    NEW_YORK_TIMEZONE,
    classify_daily_store_status,
    classify_one_minute_store_status,
    fetch_longbridge_daily_history,
    fetch_longbridge_trade_stats,
    has_longbridge_market_data_source,
    has_recent_one_minute_store,
    is_one_minute_store_fresh,
    one_minute_lookback_start,
    test_broker_connection,
)
from app.infrastructure.longbridge_cli import (
    get_longbridge_cli_auth_status,
    start_longbridge_cli_browser_oauth,
    test_longbridge_cli_connection,
)
from app.core.broker_settings import (
    BrokerSettings,
    load_broker_settings,
    sanitize_broker_settings_for_view,
    save_broker_settings,
)
from app.services.comparisons import (
    align_intraday_datasets_for_compare,
    build_series_payload,
    calculate_ttm_dividend_yield,
    complete_market_local_trading_days,
    fill_intraday_market_session_gaps,
    filter_intraday_dataset_to_regular_session,
    market_trading_date_for_timestamp,
    prepare_intraday_dataset_for_compare,
    resolve_effective_period_for_datasets,
    shift_intraday_compare_axis_to_trading_date,
    slice_dataset_for_period,
    slice_datasets_for_compare_period,
    slice_intraday_datasets_for_compare_period,
)
from app.core.email_settings import (
    SmtpSettings,
    YAHOO_SMTP_HOST,
    YAHOO_SMTP_PORT,
    clear_oauth_settings,
    load_smtp_settings,
    sanitize_smtp_settings_for_view,
    save_smtp_settings,
    test_smtp_connection,
)
from strategies.backtest import combine_backtest_datasets, run_single_ticker_backtest
from strategies.price_field_contract import (
    is_price_field_strategy,
)
from strategies.interval_bridge import (
    DAILY_CLOSE_TO_NEXT_SESSION_OPEN,
    bridge_daily_signals_to_intraday,
)
from strategies.loader import (
    instantiate_strategy,
    list_enabled_strategies,
    get_strategy_definition,
)
from app.infrastructure.connectivity import (
    has_remote_market_access,
    network_transport_note,
    run_network_self_check,
    reset_connectivity_caches,
)
from app.core.config import (
    BASE_CURRENCY,
    BASE_TIMEZONE,
    CODE_VERSION,
    DEFAULT_INTERVAL,
    DEFAULT_PERIOD,
    DEFAULT_TICKERS,
    COMPARE_PERIODS_1D,
    MARKET_STORE_DIR,
    PERIOD_DAY_SPANS,
    PERIOD_LABELS,
    PERIOD_MONTH_SPANS,
    PERIOD_OFFSETS,
    SETTINGS_STORE_DIR,
    SUPPORTED_PERIODS_1D,
    SUPPORTED_PERIODS_1M,
)
from app.core.upload_limits import MAX_INVESTMENT_IMPORT_REQUEST_MIB
from app.services.date_constraints import (
    build_date_constraint_payload,
    build_date_constraint_availability,
    is_nyse_early_close,
    latest_completed_nyse_trading_day,
    nyse_market_session_state,
    nyse_recent_trading_days,
)
from app.services.dca import simulate_recurring_investment
from app.services.lstm_training import LstmTrainingConflict, LstmTrainingManager
from app.services.price_field_training import (
    PriceFieldTrainingConflict,
    PriceFieldTrainingManager,
)
from app.services.market_cap import (
    build_market_cap_series_payload,
    extract_stock_split_events,
    fetch_usd_exchange_rate_history,
)
from app.services.range_options import (
    COMPARE_INTRADAY_PERIODS,
    build_supported_compare_periods,
    build_supported_periods_from_dates,
    resolve_requested_period_from_supported,
)
from app.services.investment_import import (
    _synchronize_hsbc_authoritative_current_cash_boundary,
    build_investment_internal_transfer_binding_index,
    merge_investment_payloads,
    normalize_investment_internal_transfer_bindings,
    normalize_investment_internal_transfer_ignored_source_keys,
    normalize_investment_payload_tickers,
    normalize_investment_security_transfer_attributions,
    parse_investment_payload,
    refresh_investment_security_transfer_reconciliation,
    validate_hsbc_pasted_text,
    validate_investment_internal_transfer_binding,
    validate_investment_security_transfer_attribution,
)
from app.services.investment_import_registry import commit_investment_import
from app.services.zircon_hk_import import (
    STANDARD_INVESTMENT_EXPORT_FILENAME,
    ZIRCON_HK_MAX_TRANSACTION_ROWS,
    ZIRCON_HK_TEMPLATE_FILENAME,
    build_standard_investment_xlsx,
    build_zircon_hk_template_xlsx,
)

from app.services.live_trading import (
    load_longbridge_account_balances,
    load_longbridge_account_label,
    load_longbridge_stock_positions,
    submit_longbridge_limit_order,
)
from app.services.logos import (
    fetch_quote_profile,
    has_valid_ticker_format,
    normalize_ticker_input,
    refresh_quote_profile_cache,
    resolve_stored_logo_url,
    search_tickers,
)
from app.services.market_data import (
    canonical_compare_overnight_ticker,
    fetch_compare_one_day_extended_history,
    fetch_compare_one_day_overnight_history,
    fetch_history,
    fetch_longbridge_realtime_quotes,
    fetch_one_minute_history_for_trading_date,
    fetch_yfinance_realtime_quotes,
    has_compare_overnight_market_data_source,
    list_available_market_intervals,
    load_local_one_minute_history,
    normalize_history_frame,
    refresh_history_store,
    refresh_one_minute_store,
    refresh_one_minute_store_with_longbridge,
    refresh_recent_one_minute_store_with_yfinance,
    resolve_compare_overnight_tickers,
    select_price_series,
    supports_compare_extended_hours,
    supports_compare_overnight,
)
from app.services.market_freshness import (
    ensure_latest_backtest_intraday_cache,
    ensure_latest_daily_caches,
    ensure_latest_investment_daily_caches,
    extract_open_investment_tickers,
)
from app.services.market_freshness import ensure_latest_backtest_caches
from app.models.schemas import DateConstraintPayload, QuoteProfile, SeriesPayload
from app.services.presentation import (
    build_series_colors,
    format_display_date,
    format_display_datetime,
    format_period_label,
    format_short_display_date,
    hex_to_rgba,
)
from app.core.settings import get_settings
from app.infrastructure.storage import (
    INVESTMENT_STORE_PATH,
    LOGOS_STORE_DIR,
    clear_non_historical_market_cache,
    clear_investment_store,
    delete_ticker_data,
    has_logo_asset,
    has_profile_record,
    history_store_path_for,
    investment_store_exists,
    investment_store_path_for,
    intraday_history_store_path_for,
    is_ticker_fallback_company_name,
    list_local_tickers,
    list_historical_tickers,
    load_investment_store_payload,
    load_profile_record,
    market_ticker_store_aliases,
    market_store_file_lock,
    materialize_investment_source_artifacts,
    investment_source_artifact_storage_keys,
    investment_ticker_identity_store_aliases,
    investment_ticker_lineage_payload,
    investment_ticker_store_aliases,
    known_ticker_company_names_payload,
    normalize_ticker,
    propagate_investment_lineage_identity_profiles,
    resolve_known_ticker_company_name,
    record_ticker_usage,
    record_strategy_usage,
    update_investment_store_payload,
    verify_investment_source_artifacts,
    write_json_atomic,
)
from app.web.form_parsing import (
    build_default_weights,
    ensure_positive_portfolio_weights,
    normalize_portfolio_weights,
    parse_bool_flag_from_args,
    parse_float_value,
    parse_int_value,
    parse_portfolio_allocation_mode_from_args,
    parse_range_request_args_from_args,
    parse_requested_shares_from_args,
    parse_requested_tickers_from_args,
    parse_requested_weights_from_args,
    resolve_workspace_dividend_mode,
)
from app.web.navigation import (
    BACKTEST_VIEWS,
    MAX_TICKERS,
    MIN_TICKERS,
    build_settings_path,
    build_settings_state_url,
    build_settings_url,
    build_trade_path,
    build_trade_url,
    build_view_path,
    build_view_url,
    max_tickers_for_view,
    normalize_comparison_metric,
    normalize_settings_page,
    normalize_settings_section,
    normalize_settings_tab,
    normalize_trade_section,
    normalize_view_name,
)
from app.web.market_history import (
    align_datasets_on_common_dates,
    build_supported_periods_for_history_store,
    extract_union_dates,
    market_trading_dates_for_history,
    slice_intraday_history_for_exact_range,
    slice_intraday_history_for_period,
)
from app.web.strategy_forms import (
    STRATEGY_CATEGORY_KEYS,
    build_strategy_form_fields as build_strategy_form_fields_for_strategy,
    build_strategy_form_sections,
    build_strategy_option_groups as build_strategy_option_groups_from_catalog,
    build_strategy_settings_groups as build_strategy_settings_groups_for_factory,
)
from app.web.style_token_rows import (
    build_color_token_rows,
    build_export_image_rows,
    build_font_token_rows,
    build_material_token_rows,
    build_style_token_rows,
)

LOGGER = logging.getLogger(__name__)


class MissingComparisonMarketDataError(ValueError):
    """Report an unavailable selected security without changing its identity."""


FETCH_ABORT_DEBUG_CONFIG = load_optional_debug_endpoint(
    "frontend-fetch-aborts.env",
    "frontend-fetch-aborts",
)
PROJECT_SOURCE_URL = "https://github.com/Lightwing-Ng/worthward"
PROJECT_DISPLAY_URL = PROJECT_SOURCE_URL.removeprefix("https://").removeprefix(
    "http://"
)


def report_fetch_abort_debug_event(
    hypothesis_id: str,
    location: str,
    msg: str,
    data: dict[str, Any] | None = None,
    run_id: str = "post-fix",
) -> None:
    # #region debug-point E:backend-fetch-abort
    post_debug_event(
        FETCH_ABORT_DEBUG_CONFIG,
        hypothesis_id=hypothesis_id,
        location=location,
        msg=msg,
        data=data,
        run_id=run_id,
        timeout_seconds=0.5,
    )
    # #endregion


PORTFOLIO_BENCHMARK_TICKERS = ("SPY", "QQQ")
INVESTMENT_TRANSACTIONS_CACHE_SCHEMA_VERSION = "investment-transactions-v15"
INVESTMENT_TRANSACTIONS_CACHE_PATH = (
    SETTINGS_STORE_DIR / "investment_cache" / "transactions_payload.json"
)
INVESTMENT_REALTIME_QUOTE_TTL_SECONDS = 60.0
INVESTMENT_REALTIME_QUOTE_TIMEOUT_SECONDS = 30
REALTIME_BATCH_SIZE = 8
PORTFOLIO_BENCHMARK_COLORS = {
    "SPY": "#8e8e93",
    "QQQ": "#c7c7cc",
}
LOCAL_STORE_PAGE_SIZE = 10
SETTINGS_LANGUAGE_PAGE_SIZE = 10
SETTINGS_FEEDBACK_COOKIE = "worthward_settings_feedback"


def _resolve_strategy_provider_end(
    ticker: str,
    reference_timestamp: object | None = None,
) -> pd.Timestamp:
    """Resolve a relative strategy-data window end in the ticker's market date."""
    reference = (
        pd.Timestamp.now(tz="UTC")
        if reference_timestamp is None
        else pd.Timestamp(reference_timestamp)
    )
    if reference.tzinfo is None:
        reference = reference.tz_localize("UTC")
    return pd.Timestamp(
        market_trading_date_for_timestamp(reference, ticker)
    ).normalize()


def _load_strategy_market_datasets(
    strategy: object,
    tickers: list[str],
    *,
    interval: str,
    start: pd.Timestamp,
    end: pd.Timestamp,
    params: dict[str, object],
) -> list[pd.DataFrame] | None:
    """Load and validate strategy-owned data without crossing provider boundaries."""
    declared_source = (
        str(getattr(strategy, "strategy_market_data_source", "default")).strip().lower()
    )
    loader = getattr(strategy, "load_market_datasets", None)
    if declared_source == "default":
        return (
            loader(
                tickers,
                interval=interval,
                start=start,
                end=end,
                params=params,
            )
            if callable(loader)
            else None
        )

    if not callable(loader):
        raise ValueError(
            f"Strategy market-data source {declared_source!r} requires a loader."
        )
    loaded = loader(
        tickers,
        interval=interval,
        start=start,
        end=end,
        params=params,
    )
    if loaded is None:
        raise ValueError(
            f"Strategy market-data source {declared_source!r} returned no datasets."
        )
    if isinstance(loaded, pd.DataFrame):
        raise ValueError(
            "Strategy-owned market data must be returned as a dataset list."
        )
    try:
        datasets = list(loaded)
    except TypeError as exc:
        raise ValueError(
            "Strategy-owned market data must be returned as a dataset list."
        ) from exc

    for index, dataset in enumerate(datasets, start=1):
        if not isinstance(dataset, pd.DataFrame) or dataset.empty:
            raise ValueError(
                f"Strategy-owned market dataset {index} must be a non-empty DataFrame."
            )
        missing_columns = [
            column for column in ("Date", "Close") if column not in dataset.columns
        ]
        if missing_columns:
            raise ValueError(
                f"Strategy-owned market dataset {index} is missing "
                f"{', '.join(missing_columns)}."
            )
        dataset_source = (
            str(dataset.attrs.get("market_data_source", "")).strip().lower()
        )
        if dataset_source != declared_source:
            raise ValueError(
                f"Strategy-owned market dataset {index} source "
                f"{dataset_source or 'missing'!r} does not match "
                f"{declared_source!r}."
            )
    return datasets


def _strategy_model_interval(strategy: object, execution_interval: str) -> str:
    """Resolve a strategy's model interval without changing legacy strategies."""
    getter = getattr(strategy, "get_model_interval", None)
    model_interval = (
        getter(execution_interval) if callable(getter) else execution_interval
    )
    normalized = str(model_interval or "").strip().lower()
    if normalized not in {"1d", "1m"}:
        raise ValueError("Strategy model interval is invalid.")
    return normalized


def _strategy_signal_bridge(strategy: object, execution_interval: str) -> str | None:
    """Resolve an optional model-to-execution signal bridge."""
    getter = getattr(strategy, "get_signal_bridge", None)
    bridge = getter(execution_interval) if callable(getter) else None
    normalized = str(bridge or "").strip().lower()
    return normalized or None


def _strategy_interval_notice(strategy: object, execution_interval: str) -> str | None:
    """Resolve optional mixed-frequency context for the rendered workspace."""
    getter = getattr(strategy, "get_interval_notice", None)
    notice = getter(execution_interval) if callable(getter) else None
    normalized = str(notice or "").strip()
    return normalized or None


def _strategy_supported_execution_intervals(
    strategy: object,
    tickers: list[str],
) -> list[str]:
    """Intersect strategy execution capabilities with required local data."""
    getter = getattr(strategy, "get_supported_intervals", None)
    declared = set(getter() if callable(getter) else ("1d", "1m"))
    uses_strategy_market_data = (
        str(getattr(strategy, "strategy_market_data_source", "default")).strip().lower()
        != "default"
    )
    local_options = {
        ticker: set(list_available_market_intervals(ticker)) for ticker in tickers
    }
    supported: list[str] = []
    for execution_interval in ("1d", "1m"):
        if execution_interval not in declared:
            continue
        model_interval = _strategy_model_interval(strategy, execution_interval)
        strategy_owns_execution_data = (
            uses_strategy_market_data and model_interval == execution_interval
        )
        if strategy_owns_execution_data or all(
            execution_interval in local_options[ticker] for ticker in tickers
        ):
            supported.append(execution_interval)
    return supported or ["1d"]


@dataclass(frozen=True)
class WebRuntime:
    """Callable handlers and helpers shared across split route modules."""

    root: Any
    compare_page: Any
    market_cap_compare_page: Any
    legacy_compare_page: Any
    price_compare_page: Any
    portfolio_page: Any
    legacy_portfolio_page: Any
    dca_page: Any
    legacy_dca_page: Any
    backtest_page: Any
    grid_trading_page: Any
    legacy_backtest_page: Any
    legacy_trade_messages_page: Any
    trade_root: Any
    trade_page: Any
    legacy_trade_root: Any
    legacy_trade_page: Any
    live_trading_unlock: Any
    settings_root: Any
    settings_page: Any
    export_transactions_api: Any
    general_settings_action: Any
    language_settings_api: Any
    language_cycle_api: Any
    language_download_api: Any
    backtest_settings_action: Any
    investment_settings_action: Any
    cash_equivalents_action: Any
    email_smtp_action: Any
    broker_access_action: Any
    longbridge_oauth_status_api: Any
    local_market_store_action: Any
    settings_cache_action: Any
    market_store_logo: Any
    favicon_icon: Any
    symbol_search: Any
    date_constraints_api: Any
    compare_live_api: Any
    compare_chips_api: Any
    trade_strategy_fields_api: Any
    lstm_training_list_api: Any
    lstm_training_start_api: Any
    lstm_training_stop_api: Any
    lstm_training_delete_api: Any
    price_field_training_list_api: Any
    price_field_training_start_api: Any
    price_field_training_stop_api: Any
    price_field_training_delete_api: Any
    settings_network_status_api: Any
    local_market_store_page_data_api: Any
    market_store_presence_api: Any
    investment_page: Any
    investment_get_transactions: Any
    investment_add_transaction: Any
    investment_download_zircon_hk_template: Any
    investment_export_standard_xlsx: Any
    investment_validate_zircon_hk_workbook: Any
    investment_validate_hsbc_pasted_text: Any
    investment_get_latest_price: Any
    investment_get_parquet: Any
    investment_get_intraday_history: Any
    investment_get_market_session: Any
    investment_get_realtime_quotes: Any
    investment_update_internal_transfer_binding: Any
    investment_update_security_transfer_attribution: Any
    live_trading_get_positions: Any
    live_trading_submit_order: Any


def extract_first_non_null_value(raw_value: object) -> object | None:
    if raw_value is None:
        return None
    if isinstance(raw_value, pd.DataFrame):
        if raw_value.empty:
            return None
        for column in raw_value.columns:
            extracted = extract_first_non_null_value(raw_value[column])
            if extracted is not None:
                return extracted
        return None
    if isinstance(raw_value, pd.Series):
        values = raw_value.dropna()
        if values.empty:
            return None
        return extract_first_non_null_value(values.iloc[0])
    if isinstance(raw_value, pd.Index):
        values = raw_value.dropna()
        if len(values) == 0:
            return None
        return extract_first_non_null_value(values[0])
    if isinstance(raw_value, (list, tuple)):
        for value in raw_value:
            extracted = extract_first_non_null_value(value)
            if extracted is not None:
                return extracted
        return None
    if (
        hasattr(raw_value, "ndim")
        and hasattr(raw_value, "tolist")
        and not pd.api.types.is_scalar(raw_value)
    ):
        values = raw_value.tolist()
        return extract_first_non_null_value(values)
    return raw_value


def format_store_range_date_value(raw_value: object) -> str:
    candidate = extract_first_non_null_value(raw_value)
    if candidate is None:
        return ""
    timestamp = pd.Timestamp(candidate)
    if pd.isna(timestamp):
        return ""
    return format_short_display_date(timestamp)


_LATE_BOUND_RUNTIME_CALLABLES = frozenset(
    {
        "build_market_cap_series_payload",
        "build_supported_periods_for_history_store",
        "classify_daily_store_status",
        "classify_one_minute_store_status",
        "clear_investment_store",
        "ensure_latest_backtest_caches",
        "ensure_latest_backtest_intraday_cache",
        "ensure_latest_daily_caches",
        "ensure_latest_investment_daily_caches",
        "fetch_compare_one_day_extended_history",
        "fetch_compare_one_day_overnight_history",
        "fetch_history",
        "fetch_longbridge_daily_history",
        "fetch_longbridge_realtime_quotes",
        "fetch_longbridge_trade_stats",
        "fetch_one_minute_history_for_trading_date",
        "fetch_quote_profile",
        "fetch_yfinance_realtime_quotes",
        "get_longbridge_cli_auth_status",
        "has_compare_overnight_market_data_source",
        "has_logo_asset",
        "has_longbridge_market_data_source",
        "has_profile_record",
        "has_recent_one_minute_store",
        "history_store_path_for",
        "instantiate_strategy",
        "intraday_history_store_path_for",
        "is_one_minute_store_fresh",
        "list_available_market_intervals",
        "list_local_tickers",
        "load_backtest_execution_mode",
        "load_broker_settings",
        "load_cash_equivalent_tickers",
        "load_date_display_settings",
        "load_investment_cost_basis_method",
        "load_language_settings",
        "load_local_one_minute_history",
        "load_longbridge_account_balances",
        "load_longbridge_stock_positions",
        "load_profile_record",
        "nyse_market_session_state",
        "nyse_recent_trading_days",
        "parse_investment_payload",
        "record_strategy_usage",
        "record_ticker_usage",
        "refresh_one_minute_store",
        "refresh_one_minute_store_with_longbridge",
        "refresh_recent_one_minute_store_with_yfinance",
        "resolve_stored_logo_url",
        "run_network_self_check",
        "run_single_ticker_backtest",
        "start_longbridge_cli_browser_oauth",
        "submit_longbridge_limit_order",
        "test_longbridge_cli_connection",
        "update_investment_store_payload",
        "validate_hsbc_pasted_text",
    }
)


def _late_bound_runtime_callable(name: str) -> Callable[..., object]:
    def call(*args: object, **kwargs: object) -> object:
        return globals()[name](*args, **kwargs)

    return call


def _build_runtime_context() -> dict[str, object]:
    context = dict(globals())
    context.update(
        {
            name: _late_bound_runtime_callable(name)
            for name in _LATE_BOUND_RUNTIME_CALLABLES
        }
    )
    return context


from app.web.runtime_foundation import build_foundation_context
from app.web.runtime_comparison import build_comparison_context
from app.web.runtime_backtest_settings import build_backtest_settings_context
from app.web.runtime_workspace import build_workspace_context
from app.web.runtime_pages_settings import build_pages_settings_context
from app.web.runtime_compare_training import build_compare_training_context
from app.web.runtime_investment_imports import build_investment_import_context
from app.web.runtime_investment_mutations import build_investment_mutation_context
from app.web.runtime_investment_market_live import build_investment_market_live_context


def build_web_runtime() -> WebRuntime:
    context = _build_runtime_context()
    context.update(build_foundation_context(context))
    context.update(build_comparison_context(context))
    context.update(build_backtest_settings_context(context))
    context.update(build_workspace_context(context))
    context.update(build_pages_settings_context(context))
    context.update(build_compare_training_context(context))
    context.update(build_investment_import_context(context))
    context.update(build_investment_mutation_context(context))
    context.update(build_investment_market_live_context(context))
    backtest_page = context["backtest_page"]
    backtest_settings_action = context["backtest_settings_action"]
    broker_access_action = context["broker_access_action"]
    cash_equivalents_action = context["cash_equivalents_action"]
    compare_chips_api = context["compare_chips_api"]
    compare_live_api = context["compare_live_api"]
    compare_page = context["compare_page"]
    date_constraints_api = context["date_constraints_api"]
    dca_page = context["dca_page"]
    email_smtp_action = context["email_smtp_action"]
    export_transactions_api = context["export_transactions_api"]
    favicon_icon = context["favicon_icon"]
    general_settings_action = context["general_settings_action"]
    grid_trading_page = context["grid_trading_page"]
    investment_add_transactions = context["investment_add_transactions"]
    investment_download_zircon_hk_template = context[
        "investment_download_zircon_hk_template"
    ]
    investment_export_standard_xlsx = context["investment_export_standard_xlsx"]
    investment_get_intraday_history = context["investment_get_intraday_history"]
    investment_get_latest_price = context["investment_get_latest_price"]
    investment_get_market_session = context["investment_get_market_session"]
    investment_get_parquet = context["investment_get_parquet"]
    investment_get_realtime_quotes = context["investment_get_realtime_quotes"]
    investment_get_transactions = context["investment_get_transactions"]
    investment_page = context["investment_page"]
    investment_settings_action = context["investment_settings_action"]
    investment_update_internal_transfer_binding = context[
        "investment_update_internal_transfer_binding"
    ]
    investment_update_security_transfer_attribution = context[
        "investment_update_security_transfer_attribution"
    ]
    investment_validate_hsbc_pasted_text = context[
        "investment_validate_hsbc_pasted_text"
    ]
    investment_validate_zircon_hk_workbook = context[
        "investment_validate_zircon_hk_workbook"
    ]
    language_cycle_api = context["language_cycle_api"]
    language_download_api = context["language_download_api"]
    language_settings_api = context["language_settings_api"]
    legacy_backtest_page = context["legacy_backtest_page"]
    legacy_compare_page = context["legacy_compare_page"]
    legacy_dca_page = context["legacy_dca_page"]
    legacy_portfolio_page = context["legacy_portfolio_page"]
    legacy_trade_messages_page = context["legacy_trade_messages_page"]
    legacy_trade_page = context["legacy_trade_page"]
    legacy_trade_root = context["legacy_trade_root"]
    live_trading_get_positions = context["live_trading_get_positions"]
    live_trading_submit_order = context["live_trading_submit_order"]
    live_trading_unlock = context["live_trading_unlock"]
    local_market_store_action = context["local_market_store_action"]
    local_market_store_page_data_api = context["local_market_store_page_data_api"]
    longbridge_oauth_status_api = context["longbridge_oauth_status_api"]
    lstm_training_delete_api = context["lstm_training_delete_api"]
    lstm_training_list_api = context["lstm_training_list_api"]
    lstm_training_start_api = context["lstm_training_start_api"]
    lstm_training_stop_api = context["lstm_training_stop_api"]
    market_cap_compare_page = context["market_cap_compare_page"]
    market_store_logo = context["market_store_logo"]
    market_store_presence_api = context["market_store_presence_api"]
    portfolio_page = context["portfolio_page"]
    price_compare_page = context["price_compare_page"]
    price_field_training_delete_api = context["price_field_training_delete_api"]
    price_field_training_list_api = context["price_field_training_list_api"]
    price_field_training_start_api = context["price_field_training_start_api"]
    price_field_training_stop_api = context["price_field_training_stop_api"]
    root = context["root"]
    settings_cache_action = context["settings_cache_action"]
    settings_network_status_api = context["settings_network_status_api"]
    settings_page = context["settings_page"]
    settings_root = context["settings_root"]
    symbol_search = context["symbol_search"]
    trade_page = context["trade_page"]
    trade_root = context["trade_root"]
    trade_strategy_fields_api = context["trade_strategy_fields_api"]
    return WebRuntime(
        root=root,
        compare_page=compare_page,
        market_cap_compare_page=market_cap_compare_page,
        legacy_compare_page=legacy_compare_page,
        price_compare_page=price_compare_page,
        portfolio_page=portfolio_page,
        legacy_portfolio_page=legacy_portfolio_page,
        dca_page=dca_page,
        legacy_dca_page=legacy_dca_page,
        backtest_page=backtest_page,
        grid_trading_page=grid_trading_page,
        legacy_backtest_page=legacy_backtest_page,
        legacy_trade_messages_page=legacy_trade_messages_page,
        trade_root=trade_root,
        trade_page=trade_page,
        legacy_trade_root=legacy_trade_root,
        legacy_trade_page=legacy_trade_page,
        live_trading_unlock=live_trading_unlock,
        settings_root=settings_root,
        settings_page=settings_page,
        export_transactions_api=export_transactions_api,
        general_settings_action=general_settings_action,
        language_settings_api=language_settings_api,
        language_cycle_api=language_cycle_api,
        language_download_api=language_download_api,
        backtest_settings_action=backtest_settings_action,
        investment_settings_action=investment_settings_action,
        cash_equivalents_action=cash_equivalents_action,
        email_smtp_action=email_smtp_action,
        broker_access_action=broker_access_action,
        longbridge_oauth_status_api=longbridge_oauth_status_api,
        local_market_store_action=local_market_store_action,
        settings_cache_action=settings_cache_action,
        market_store_logo=market_store_logo,
        favicon_icon=favicon_icon,
        symbol_search=symbol_search,
        date_constraints_api=date_constraints_api,
        compare_live_api=compare_live_api,
        compare_chips_api=compare_chips_api,
        trade_strategy_fields_api=trade_strategy_fields_api,
        lstm_training_list_api=lstm_training_list_api,
        lstm_training_start_api=lstm_training_start_api,
        lstm_training_stop_api=lstm_training_stop_api,
        lstm_training_delete_api=lstm_training_delete_api,
        price_field_training_list_api=price_field_training_list_api,
        price_field_training_start_api=price_field_training_start_api,
        price_field_training_stop_api=price_field_training_stop_api,
        price_field_training_delete_api=price_field_training_delete_api,
        settings_network_status_api=settings_network_status_api,
        local_market_store_page_data_api=local_market_store_page_data_api,
        market_store_presence_api=market_store_presence_api,
        investment_page=investment_page,
        investment_get_transactions=investment_get_transactions,
        investment_add_transaction=investment_add_transactions,
        investment_download_zircon_hk_template=investment_download_zircon_hk_template,
        investment_export_standard_xlsx=investment_export_standard_xlsx,
        investment_validate_zircon_hk_workbook=investment_validate_zircon_hk_workbook,
        investment_validate_hsbc_pasted_text=investment_validate_hsbc_pasted_text,
        investment_get_latest_price=investment_get_latest_price,
        investment_get_parquet=investment_get_parquet,
        investment_get_intraday_history=investment_get_intraday_history,
        investment_get_realtime_quotes=investment_get_realtime_quotes,
        investment_get_market_session=investment_get_market_session,
        investment_update_internal_transfer_binding=investment_update_internal_transfer_binding,
        investment_update_security_transfer_attribution=(
            investment_update_security_transfer_attribution
        ),
        live_trading_get_positions=live_trading_get_positions,
        live_trading_submit_order=live_trading_submit_order,
    )
