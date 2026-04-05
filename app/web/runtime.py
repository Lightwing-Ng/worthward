"""
Shared web runtime and route handlers.

Code version: v0.3.5
"""

from __future__ import annotations
from datetime import datetime
import json
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass
from io import BytesIO
from pathlib import Path
from typing import Any
from urllib.parse import urlencode
import hashlib
import pandas as pd
from flask import jsonify, make_response, redirect, render_template, request, send_from_directory, url_for, send_file

from app.core.backtest_settings import load_backtest_execution_mode, save_backtest_execution_mode
from app.infrastructure.broker_market_data import (
    classify_daily_store_status,
    classify_one_minute_store_status,
    has_recent_one_minute_store,
    normalize_one_minute_store_frame,
    one_minute_lookback_start,
    refresh_longbridge_one_minute_store,
    test_broker_connection,
)
from app.core.broker_settings import (
    BrokerSettings,
    has_longbridge_credentials,
    load_broker_settings,
    sanitize_broker_settings_for_view,
    save_broker_settings,
)
from app.services.comparisons import build_series_payload, slice_dataset_for_period
from app.core.email_settings import (
    SmtpSettings,
    build_oauth_settings_message,
    finish_outlook_oauth_device_flow,
    load_smtp_settings,
    sanitize_smtp_settings_for_view,
    save_smtp_settings,
    start_outlook_oauth_device_flow,
    test_smtp_connection,
)
from strategies.backtest import run_single_ticker_backtest
from strategies.base import StrategyParameterDefinition
from strategies.loader import instantiate_strategy, list_enabled_strategies, get_strategy_definition
from app.infrastructure.connectivity import (
    fetch_tradingview_metrics,
    has_google_hk_access,
    has_remote_logo_access,
    has_remote_market_access,
    has_tradingview_ta_available,
    last_google_hk_check_at,
    last_remote_logo_check_at,
    last_remote_market_check_at,
    last_tradingview_ta_check_at,
    reset_connectivity_caches,
)
from app.core.config import (
    CODE_VERSION,
    DEFAULT_INTERVAL,
    DEFAULT_PERIOD,
    DEFAULT_TICKERS,
    PERIOD_OFFSETS,
    SUPPORTED_PERIODS_1M,
)
from app.services.date_constraints import build_date_constraint_payload
from app.services.investment_import import (
    build_investment_payload_from_ibkr_csvs,
    normalize_investment_payload_tickers,
)
from app.services.logos import build_market_store_logo_url, fetch_quote_profile, has_valid_ticker_format, is_known_ticker, normalize_ticker_input, refresh_quote_profile_cache, \
    search_tickers
from app.services.market_data import fetch_history, refresh_history_store
from app.services.market_freshness import ensure_latest_daily_caches, extract_all_investment_tickers, extract_open_investment_tickers
from app.services.presentation import build_series_colors, format_display_date, format_period_label, hex_to_rgba
from app.core.settings import get_settings
from app.infrastructure.storage import (
    INVESTMENT_STORE_PATH,
    LOGOS_STORE_DIR,
    TICKER_USAGE_STORE_PATH,
    clear_nonhistorical_market_cache,
    delete_ticker_data,
    has_logo_asset,
    has_profile_record,
    history_store_path_for,
    intraday_history_store_path_for,
    list_local_tickers,
    list_historical_tickers,
    load_profile_record,
    logo_store_path_for,
    record_ticker_usage,
    record_strategy_usage,
    top_used_strategies,
)

MAX_TICKERS = 5
MIN_TICKERS = 2
PORTFOLIO_BENCHMARK_TICKERS = ("SPY", "QQQ")
PORTFOLIO_BENCHMARK_COLORS = {
    "SPY": "#8e8e93",
    "QQQ": "#c7c7cc",
}
LEGACY_VIEW_ALIASES = {
    "trade-messages": "backtest",
}
SUPPORTED_VIEWS = {"tickers", "portfolio", "backtest", "more", "settings"}
SUPPORTED_SETTINGS_SECTIONS = {"about", "general", "font-tokens", "material-tokens", "network", "strategies", "email-smtp", "broker-access", "local-market-store", "clear-caches",
                               "style-tokens"}
SUPPORTED_MORE_SECTIONS = {"timing", "investment"}
LEGACY_MORE_SECTION_ALIASES = {
    "invest": "investment",
}
LOCAL_STORE_PAGE_SIZE = 10
SETTINGS_FEEDBACK_COOKIE = "antigravity_settings_feedback"
STRATEGY_CATEGORY_LABELS = {
    "baseline": "Baseline",
    "recent": "Recent",
    "all": "All",
}
VIEW_PATHS = {
    "tickers": "/compare",
    "portfolio": "/portfolio",
    "backtest": "/backtest",
    "more": "/more/timing",
    "settings": "/settings/about",
}
ADAPTIVE_PERIODS_1D = ("6mo", "1y", "2y", "3y", "5y", "10y", "max")
TRADING_DAY_REQUIREMENTS = {
    "1d": 1,
    "3d": 3,
}


@dataclass(frozen=True)
class WebRuntime:
    """Callable handlers and helpers shared across split route modules."""

    root: Any
    compare_page: Any
    portfolio_page: Any
    backtest_page: Any
    legacy_trade_messages_page: Any
    more_root: Any
    more_page: Any
    settings_root: Any
    settings_page: Any
    export_transactions_api: Any
    general_settings_action: Any
    email_smtp_action: Any
    broker_access_action: Any
    local_market_store_action: Any
    settings_cache_action: Any
    market_store_logo: Any
    symbol_search: Any
    date_constraints_api: Any
    trade_strategy_fields_api: Any
    settings_network_status_api: Any
    local_market_store_page_data_api: Any
    market_store_presence_api: Any
    test_chart_1m_view: Any
    investment_page: Any
    investment_get_transactions: Any
    investment_add_transaction: Any
    investment_get_latest_price: Any
    investment_get_parquet: Any


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
    if hasattr(raw_value, "ndim") and hasattr(raw_value, "tolist") and not pd.api.types.is_scalar(raw_value):
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
    return timestamp.strftime("%Y/%m/%d")


def build_web_runtime() -> WebRuntime:
    settings = get_settings()
    defaults = settings["defaults"]
    labels = settings["ui"]["labels"]
    theme_settings = settings["ui"]["theme"]
    theme_light = theme_settings["light"]
    theme_dark = theme_settings["dark"]
    theme = theme_light
    chart_config = settings["ui"]["chart"]
    logos = settings["ui"]["logos"]
    app_meta = settings["app"]
    investment_settings = settings.get("investment", {}) if isinstance(settings.get("investment"), dict) else {}
    money_market_settings = (
        investment_settings.get("money_market_funds", {})
        if isinstance(investment_settings.get("money_market_funds"), dict)
        else {}
    )
    configured_money_market_tickers = {
        str(value).strip().upper()
        for value in money_market_settings.get("tickers", [])
        if str(value).strip()
    }
    money_market_name_from_description = bool(money_market_settings.get("name_from_description", False))
    money_market_description_keywords = [
        str(value).strip().upper()
        for value in money_market_settings.get("description_keywords", [])
        if str(value).strip()
    ]

    def exclude_configured_money_market_tickers(tickers: list[str]) -> list[str]:
        return [
            ticker
            for ticker in tickers
            if str(ticker).strip().upper() not in configured_money_market_tickers
        ]

    # Backtest result cache: skip redundant computation when config doesn't change
    _cached_backtest: dict[str, tuple] = {}

    def _get_backtest_cache_key() -> str:
        """Generate a cache key from all backtest configuration parameters."""
        params = [
            request.args.get("ticker", ""),
            request.args.get("strategy", ""),
            request.args.get("capital", ""),
            request.args.get("period", ""),
            request.args.get("range", ""),
            request.args.get("from", ""),
            request.args.get("to", ""),
            request.args.get("interval", ""),
            str(request.args.get("dividends", "")),
            # Include all strategy parameters in cache key
            sorted([(k, request.args.get(k, "")) for k in request.args.keys() if k not in {
                "ticker", "strategy", "capital", "period", "range", "from", "to", "interval", "dividends",
                "view", "section", "view", "tickers", "weight",
            }]),
        ]
        key_string = json.dumps(params, sort_keys=True)
        return hashlib.sha256(key_string.encode("utf-8")).hexdigest()[:16]

    def _read_settings_feedback() -> dict[str, str]:
        raw_feedback = request.cookies.get(SETTINGS_FEEDBACK_COOKIE, "").strip()
        if not raw_feedback:
            return {}
        try:
            payload = json.loads(raw_feedback)
        except json.JSONDecodeError:
            return {}
        if not isinstance(payload, dict):
            return {}
        return {
            key: str(value).strip()
            for key, value in payload.items()
            if key in {"notice", "error", "broker_test_status", "broker_test_message", "broker_test_checked_at"}
            and str(value).strip()
        }

    def _redirect_with_settings_feedback(
        section_name: str,
        *,
        notice: str = "",
        error: str = "",
        broker_test_status: str = "",
        broker_test_message: str = "",
        broker_test_checked_at: str = "",
    ):
        response = make_response(redirect(build_settings_path(section_name), code=303))
        payload = {
            key: value.strip()
            for key, value in {
                "notice": notice,
                "error": error,
                "broker_test_status": broker_test_status,
                "broker_test_message": broker_test_message,
                "broker_test_checked_at": broker_test_checked_at,
            }.items()
            if value and value.strip()
        }
        if payload:
            response.set_cookie(
                SETTINGS_FEEDBACK_COOKIE,
                json.dumps(payload, separators=(",", ":")),
                max_age=60,
                httponly=True,
                samesite="Lax",
                path="/settings",
            )
        else:
            response.delete_cookie(SETTINGS_FEEDBACK_COOKIE, path="/settings")
        return response

    def validate_ticker_or_raise(raw_ticker: str) -> str:
        normalized_ticker = normalize_ticker_input(raw_ticker)
        if not has_valid_ticker_format(normalized_ticker):
            raise ValueError(f"Invalid ticker format: {raw_ticker}.")
        return normalized_ticker

    def parse_int_value(raw_value: object, fallback: int) -> int:
        if raw_value is None:
            return fallback
        try:
            return int(str(raw_value).strip())
        except (TypeError, ValueError):
            return fallback

    def parse_float_value(raw_value: object, fallback: float) -> float:
        if raw_value is None:
            return fallback
        normalized = str(raw_value).strip().replace(",", "")
        if not normalized:
            return fallback
        try:
            return float(normalized)
        except (TypeError, ValueError):
            return fallback

    def parse_requested_tickers() -> list[str]:
        repeated = request.args.getlist("ticker")
        if repeated:
            compacted = [normalize_ticker_input(value) for value in repeated if normalize_ticker_input(value)]
            return compacted[:MAX_TICKERS]

        csv_tickers = request.args.get("tickers", "").strip()
        if csv_tickers:
            compacted = [
                normalize_ticker_input(value)
                for value in csv_tickers.split(",")
                if normalize_ticker_input(value)
            ]
            return compacted[:MAX_TICKERS]

        numbered = [request.args.get(f"ticker_{index}", "") for index in range(1, MAX_TICKERS + 1)]
        has_numbered = any(value.strip() for value in numbered) or any(
            f"ticker_{index}" in request.args for index in range(1, MAX_TICKERS + 1)
        )
        if has_numbered:
            raw_tickers = numbered
        elif "ticker_a" in request.args or "ticker_b" in request.args:
            raw_tickers = [request.args.get("ticker_a", ""), request.args.get("ticker_b", "")]
        else:
            return []
        compacted = [normalize_ticker_input(value) for value in raw_tickers if normalize_ticker_input(value)]
        return compacted[:MAX_TICKERS]

    def parse_requested_weights(slot_count: int) -> list[int]:
        repeated = request.args.getlist("weight")
        raw_values = repeated[:slot_count] if repeated else [
            request.args.get(f"weight_{index}", "")
            for index in range(1, slot_count + 1)
        ]
        weights: list[int] = []
        for raw_value in raw_values:
            if raw_value is None or str(raw_value).strip() == "":
                weights.append(0)
            else:
                weights.append(min(max(parse_int_value(raw_value, 0), 0), 100))
        return weights

    def parse_bool_flag(*names: str, default: bool = False) -> bool:
        for name in names:
            values = request.args.getlist(name)
            if values:
                return values[-1] == "1"
        return default

    def parse_range_request_args() -> tuple[str, str, str, str]:
        range_mode = request.args.get(
            "range",
            request.args.get("range_mode", defaults.get("range_mode", "period")),
        ).strip().lower()
        period = request.args.get("period", defaults.get("period", DEFAULT_PERIOD)).strip().lower()
        exact_start = request.args.get("from", request.args.get("exact_start", "")).strip()
        exact_end = request.args.get("to", request.args.get("exact_end", "")).strip()
        return range_mode, period, exact_start, exact_end

    def build_exact_range_bounds(start_value: str, end_value: str) -> tuple[pd.Timestamp, pd.Timestamp]:
        start_bound = pd.to_datetime(start_value).normalize()
        end_bound = pd.to_datetime(end_value).replace(hour=23, minute=59, second=59)
        return start_bound, end_bound

    def slice_dataset_to_exact_range(
            dataset: pd.DataFrame,
            adjusted_start: str,
            adjusted_end: str,
    ) -> pd.DataFrame:
        start_bound, end_bound = build_exact_range_bounds(adjusted_start, adjusted_end)
        return dataset[(dataset["Date"] >= start_bound) & (dataset["Date"] <= end_bound)].copy()

    def slice_datasets_to_exact_range(
            datasets: list[pd.DataFrame],
            adjusted_start: str,
            adjusted_end: str,
    ) -> list[pd.DataFrame]:
        return [
            slice_dataset_to_exact_range(dataset, adjusted_start, adjusted_end)
            for dataset in datasets
        ]

    def format_store_range_date(raw_value: object) -> str:
        return format_store_range_date_value(raw_value)

    def build_default_weights(count: int) -> list[int]:
        if count <= 0:
            return []
        base_weight = 100 // count
        remainder = 100 % count
        return [base_weight + (1 if index < remainder else 0) for index in range(count)]

    def normalize_portfolio_weights(raw_weights: list[int], active_count: int) -> list[int]:
        if active_count <= 0:
            return []
        trimmed = raw_weights[:active_count]
        if len(trimmed) < active_count:
            trimmed.extend([0] * (active_count - len(trimmed)))
        total = sum(trimmed)
        if total == 100:
            return trimmed
        if total <= 0:
            return build_default_weights(active_count)
        scaled = [int((value * 100) / total) for value in trimmed]
        remainder = 100 - sum(scaled)
        for index in range(active_count):
            if remainder == 0:
                break
            scaled[index] += 1
            remainder -= 1
        return scaled

    def ensure_positive_portfolio_weights(raw_weights: list[int], active_count: int) -> list[int]:
        trimmed = raw_weights[:active_count]
        if len(trimmed) < active_count:
            trimmed.extend([0] * (active_count - len(trimmed)))
        if any(weight <= 0 for weight in trimmed):
            raise ValueError("Each selected ticker must have a weight above 0%.")
        return trimmed

    def build_portfolio_series_payload(datasets: list[pd.DataFrame], weights: list[int], color: str):
        first_dataset = datasets[0]
        cumulative_growth = pd.Series(0.0, index=first_dataset.index)
        if len(datasets) != len(weights):
            raise ValueError("Portfolio datasets and weights must have the same length.")
        for dataset, weight in zip(datasets, weights):
            first_close = float(dataset["Close"].iloc[0])
            cumulative_growth += (weight / 100.0) * (dataset["Close"] / first_close)
        portfolio_frame = pd.DataFrame(
            {
                "Date": first_dataset["Date"],
                "Close": cumulative_growth,
            }
        )
        return build_series_payload("Portfolio", portfolio_frame, color=color)

    def build_portfolio_growth_multipliers(datasets: list[pd.DataFrame]) -> list[float]:
        return [
            float(dataset["Close"].iloc[-1]) / float(dataset["Close"].iloc[0])
            for dataset in datasets
        ]

    def build_benchmark_series_payloads(
            reference_dates: pd.Series,
            include_dividends: bool,
    ) -> tuple[list, list]:
        benchmark_series = []
        benchmark_profiles = []
        reference_date_frame = pd.DataFrame({"Date": reference_dates})
        for ticker in PORTFOLIO_BENCHMARK_TICKERS:
            try:
                dataset = fetch_history(ticker, include_dividends)
            except Exception:
                continue
            aligned = pd.merge(
                reference_date_frame,
                dataset[["Date", "Close"]],
                on="Date",
                how="inner",
            ).sort_values("Date")
            if aligned.empty or len(aligned) != len(reference_date_frame):
                continue
            benchmark_series.append(
                build_series_payload(
                    ticker,
                    aligned,
                    color=PORTFOLIO_BENCHMARK_COLORS[ticker],
                    glow=False,
                )
            )
            benchmark_profiles.append(fetch_quote_profile(ticker, False))
        return benchmark_series, benchmark_profiles

    def resolve_view() -> str:
        requested_view = request.args.get("view", "tickers").strip().lower()
        requested_view = LEGACY_VIEW_ALIASES.get(requested_view, requested_view)
        return requested_view if requested_view in SUPPORTED_VIEWS else "tickers"

    def build_view_path(view_name: str) -> str:
        return VIEW_PATHS.get(view_name, VIEW_PATHS["tickers"])

    def build_view_url(view_name: str) -> str:
        return build_view_path(view_name)

    def resolve_settings_section() -> str:
        requested_section = request.args.get("section", "about").strip().lower()
        return requested_section if requested_section in SUPPORTED_SETTINGS_SECTIONS else "about"

    def normalize_settings_section(section_name: str | None) -> str:
        candidate = (section_name or "about").strip().lower()
        return candidate if candidate in SUPPORTED_SETTINGS_SECTIONS else "about"

    def build_settings_path(section_name: str) -> str:
        return f"/settings/{normalize_settings_section(section_name)}"

    def build_settings_url(section_name: str) -> str:
        return build_settings_path(section_name)

    def normalize_more_section(section_name: str | None) -> str:
        candidate = (section_name or "timing").strip().lower()
        candidate = LEGACY_MORE_SECTION_ALIASES.get(candidate, candidate)
        return candidate if candidate in SUPPORTED_MORE_SECTIONS else "timing"

    def build_more_path(section_name: str) -> str:
        return f"/more/{normalize_more_section(section_name)}"

    def build_more_url(section_name: str) -> str:
        return build_more_path(section_name)

    def should_use_modal_banner_message(message: str | None) -> bool:
        normalized = (message or "").strip()
        if not normalized:
            return False
        return (
                normalized.startswith("No market data returned for ")
                or normalized.startswith("Local market data for ")
                or normalized.startswith("Unknown or unsupported ticker: ")
                or normalized.startswith("has no local or remote market data")
                or normalized.startswith("Failed to perform, curl: (35) TLS connect error:")
        )

    def modal_banner_icon_class(message: str | None) -> str:
        normalized = (message or "").strip()
        if normalized.startswith("Backtest execution model updated:"):
            return "icon-modal-dialog-banner-backtest-execution"
        return "icon-modal-dialog-banner-default"

    def build_more_timing_url(selected_ticker: str | None = None) -> str:
        base_path = build_more_path("timing")
        normalized_ticker = normalize_ticker_input(selected_ticker or "")
        if not normalized_ticker:
            return base_path
        query_string = urlencode({"ticker": normalized_ticker})
        return f"{base_path}?{query_string}"

    def build_local_store_page_url(page_number: int) -> str:
        params = request.args.to_dict(flat=False)
        params.pop("view", None)
        params.pop("section", None)
        params.pop("local_page", None)
        params["page"] = [str(page_number)]
        query_string = urlencode(params, doseq=True)
        base_path = build_settings_path("local-market-store")
        return f"{base_path}?{query_string}" if query_string else base_path

    def format_strategy_category_label(category: str) -> str:
        normalized = (category or "general").strip().lower()
        return STRATEGY_CATEGORY_LABELS.get(normalized, normalized.replace("-", " ").title())

    def _run_backtest_from_request():
        backtest_execution_mode = load_backtest_execution_mode()
        requested_tickers = parse_requested_tickers()
        if not requested_tickers:
            requested_tickers = [normalize_ticker_input(str(defaults.get("backtest_ticker", DEFAULT_TICKERS[0])))]
        if not requested_tickers:
            raise ValueError("No ticker selected for backtest.")
        trade_ticker = validate_ticker_or_raise(requested_tickers[0])
        include_dividends = parse_bool_flag("dividends", "include_dividends")
        range_mode, period, exact_start, exact_end = parse_range_request_args()
        supported_intervals = ["1d"]
        if has_recent_one_minute_store(trade_ticker):
            supported_intervals.append("1m")
        requested_interval = request.args.get("interval", defaults.get("backtest_interval", DEFAULT_INTERVAL)).strip().lower()
        if not request.args.get("interval") and period == "1w" and "1m" in supported_intervals:
            requested_interval = "1m"
        if requested_interval not in supported_intervals:
            requested_interval = supported_intervals[0]
        trade_dataset = fetch_history(trade_ticker, include_dividends, interval=requested_interval)

        if requested_interval == "1m":
            six_months_ago = one_minute_lookback_start().tz_localize(None)
            trade_dataset = trade_dataset[trade_dataset["Date"] >= six_months_ago]

        date_constraints = build_date_constraint_payload(
            trade_dataset,
            requested_start=exact_start or None,
            requested_end=exact_end or None,
        )
        if range_mode == "exact":
            if not date_constraints.trading_dates:
                raise ValueError("The selected exact range does not contain trading dates.")
            trade_dataset = slice_dataset_to_exact_range(
                trade_dataset,
                date_constraints.adjusted_start,
                date_constraints.adjusted_end,
            )
            if trade_dataset.empty:
                raise ValueError("The selected exact range does not contain trading dates.")
        else:
            common_end_date = trade_dataset["Date"].max()
            trade_dataset = slice_dataset_for_period(trade_dataset, period, common_end_date)

        strategy_options = list_enabled_strategies()
        selected_strategy_id = request.args.get("strategy", defaults.get("backtest_strategy", strategy_options[0]["id"] if strategy_options else "")).strip()
        strategy_ids = {str(item["id"]) for item in strategy_options}
        if selected_strategy_id not in strategy_ids and strategy_options:
            selected_strategy_id = str(strategy_options[0]["id"])
        selected_strategy_params = collect_strategy_form_values(selected_strategy_id) if selected_strategy_id else {}
        backtest_initial_capital = max(
            parse_float_value(
                request.args.get("capital", request.args.get("initial_capital")),
                float(defaults.get("backtest_capital", 10000.0)),
            ),
            1.0,
        )

        strategy = instantiate_strategy(selected_strategy_id)
        signal_result = strategy.compute_signals(trade_dataset, selected_strategy_params)
        backtest_result = run_single_ticker_backtest(
            signal_result,
            backtest_initial_capital,
            execution_mode=backtest_execution_mode,
            interval=requested_interval,
        )
        return backtest_result, trade_ticker, requested_interval, date_constraints, trade_dataset, selected_strategy_id, selected_strategy_params

    def build_strategy_option_groups(strategy_options: list[dict[str, object]]) -> list[dict[str, object]]:
        baseline_items = [item for item in strategy_options if item.get("id") == "buy-and-hold"]

        recent_ids = top_used_strategies(limit=3)
        recent_items = []
        for sid in recent_ids:
            # Avoid showing baseline in recent
            if sid == "buy-and-hold":
                continue
            matching = [item for item in strategy_options if item.get("id") == sid]
            if matching:
                recent_items.append(matching[0])

        all_other_items = sorted(
            [item for item in strategy_options if item.get("id") != "buy-and-hold"],
            key=lambda item: str(item.get("name", "")).lower()
        )

        groups = []
        if baseline_items:
            groups.append({
                "key": "baseline",
                "label": STRATEGY_CATEGORY_LABELS["baseline"],
                "items": baseline_items
            })

        if recent_items:
            groups.append({
                "key": "recent",
                "label": STRATEGY_CATEGORY_LABELS["recent"],
                "items": recent_items
            })

        if all_other_items:
            groups.append({
                "key": "all",
                "label": STRATEGY_CATEGORY_LABELS["all"],
                "items": all_other_items
            })

        return groups

    def build_strategy_form_field(definition: StrategyParameterDefinition, value: Any) -> dict[str, object]:
        def format_numeric_value(raw_value: Any, *, kind: str, step: Any) -> Any:
            if kind != "number":
                return raw_value
            try:
                numeric_value = float(raw_value)
            except (TypeError, ValueError):
                return raw_value
            step_text = "" if step is None else str(step)
            decimals = len(step_text.split(".", 1)[1]) if "." in step_text else 1
            return f"{numeric_value:.{decimals}f}"

        resolved_value = definition.default if value is None else value
        field_type = "select"
        input_mode = "text"
        slider_min: int | float | None = None
        slider_max: int | float | None = None
        slider_step: int | float | None = None
        switch_checked = False
        switch_on_value: str | int = 1
        switch_off_value: str | int = 0

        if definition.kind in {"integer", "number"}:
            field_type = "number"
            input_mode = "decimal" if definition.kind == "number" else "numeric"
            base_value = resolved_value if isinstance(resolved_value, (int, float)) else definition.default
            if not isinstance(base_value, (int, float)):
                base_value = 0
            slider_step = definition.step if definition.step is not None else (0.1 if definition.kind == "number" else 1)
            slider_min = definition.minimum if definition.minimum is not None else min(0, base_value)
            if definition.maximum is not None:
                slider_max = definition.maximum
            else:
                scale = max(abs(float(base_value or 0)), abs(float(definition.default or 0)), 1.0)
                slider_max = scale * 4
                if definition.kind == "integer":
                    slider_max = max(int(slider_min) + 1, int(round(slider_max)))
                else:
                    slider_max = max(float(slider_min) + float(slider_step), round(float(slider_max), 4))
        elif definition.kind == "string":
            field_type = "text"
        elif definition.kind == "boolean":
            field_type = "switch"
            switch_checked = bool(resolved_value)
        else:
            field_type = "select"
            options = tuple(str(option) for option in definition.options)
            if options in {("Off", "On"), ("On", "Off")}:
                field_type = "switch"
                switch_on_value = "On"
                switch_off_value = "Off"
                switch_checked = str(resolved_value) == "On"

        return {
            "key": definition.key,
            "label": definition.label,
            "kind": definition.kind,
            "field_type": field_type,
            "input_mode": input_mode,
            "value": format_numeric_value(resolved_value, kind=definition.kind, step=definition.step),
            "default": definition.default,
            "minimum": definition.minimum,
            "maximum": definition.maximum,
            "step": definition.step,
            "slider_min": slider_min,
            "slider_max": slider_max,
            "slider_step": slider_step,
            "options": list(definition.options),
            "editable": definition.editable,
            "help_text": definition.help_text,
            "unit_hint": definition.unit_hint,
            "placeholder": definition.placeholder,
            "switch_checked": switch_checked,
            "switch_on_value": switch_on_value,
            "switch_off_value": switch_off_value,
        }

    def collect_strategy_form_values(strategy_id: str) -> dict[str, Any]:
        strategy = instantiate_strategy(strategy_id)
        raw_values: dict[str, Any] = {}
        for definition in strategy.get_parameter_definitions():
            raw_value = request.args.get(definition.key)
            if raw_value is None or str(raw_value).strip() == "":
                raw_values[definition.key] = definition.default
            else:
                raw_values[definition.key] = raw_value
        return strategy.normalize_params(raw_values)

    def build_strategy_form_fields(strategy_id: str, values: dict[str, Any] | None = None) -> list[dict[str, object]]:
        strategy = instantiate_strategy(strategy_id)
        normalized_values = strategy.normalize_params(values or {})
        return [
            build_strategy_form_field(definition, normalized_values.get(definition.key))
            for definition in strategy.get_parameter_definitions()
        ]

    def build_strategy_settings_rows(strategy_options: list[dict[str, object]]) -> list[dict[str, object]]:
        rows: list[dict[str, object]] = []
        for item in strategy_options:
            strategy = instantiate_strategy(str(item["id"]))
            rows.append(
                {
                    "id": item["id"],
                    "name": item["name"],
                    "category": format_strategy_category_label(str(item.get("category", "general"))),
                    "description": item.get("description", ""),
                    "supports": item.get("supports", {}),
                    "parameters": [
                        {
                            "label": definition.label,
                            "default_display": definition.display_default(),
                            "meaning": definition.help_text,
                        }
                        for definition in strategy.get_parameter_definitions()
                    ],
                }
            )
        supertrend_ai_row = next((row for row in rows if row.get("id") == "supertrend-ai"), None)
        if supertrend_ai_row is not None:
            rows.append(
                {
                    **supertrend_ai_row,
                    "parameters": [dict(parameter) for parameter in supertrend_ai_row.get("parameters", [])],
                }
            )
        return rows

    def build_style_token_rows() -> list[dict[str, object]]:
        def style_token_id(name: str) -> str:
            return name.strip().lower().replace(" ", "-")

        def material_token_id(name: str) -> str:
            return name.strip().lower().replace(" ", "-")

        def px_token(name: str, value: int, min_value: int = 0) -> dict[str, object]:
            return {
                "name": name,
                "value": f"{value}px",
                "editable": True,
                "numeric_value": value,
                "unit": "px",
                "min_value": min_value,
            }

        def raw_token(name: str, value: str) -> dict[str, object]:
            text_value = str(value)
            if re.fullmatch(r"-?\d+", text_value):
                numeric_value = int(text_value)
                return {
                    "name": name,
                    "value": text_value,
                    "editable": True,
                    "numeric_value": numeric_value,
                    "unit": "",
                    "min_value": 0 if numeric_value >= 0 else numeric_value,
                }
            return {
                "name": name,
                "value": text_value,
                "editable": False,
            }

        def material_reference_token(name: str, material_name: str) -> dict[str, object]:
            return {
                "name": name,
                "value": material_name,
                "editable": False,
                "reference_label": material_name,
                "reference_target_id": material_token_id(material_name),
            }

        rows = [
            {
                "id": style_token_id("Segmented control"),
                "name": "Segmented control",
                "sample_kind": "range-mode",
                "sample_title": "",
                "sample_copy": "",
                "sample_button": "",
                "sample_button_class": "",
                "sample_icon_class": "",
                "sample_icon_shell_class": "",
                "tokens": [
                    raw_token("--mode-switch-radius", "var(--radius-pill)"),
                    px_token("--mode-switch-pad", 4, 0),
                    px_token("--mode-switch-gap", 4, 0),
                    px_token("--mode-switch-min-height", 36, 1),
                    px_token("--mode-switch-thumb-inset", 4, 0),
                    px_token("--mode-switch-thumb-offset", 6, 0),
                    px_token("--mode-switch-label-pad-inline", 12, 0),
                    px_token("--mode-switch-label-min-height", 28, 1),
                    raw_token("--mode-switch-thumb-background", "var(--accent-fill)"),
                ],
                "related_styles": [],
            },
            {
                "id": style_token_id("Settings action button"),
                "name": "Settings action button",
                "sample_kind": "action-button",
                "sample_title": "",
                "sample_copy": "",
                "sample_button": labels["local_store_maintain_button"],
                "sample_button_class": "settings-inline-button settings-inline-button-primary",
                "sample_icon_class": "",
                "sample_icon_shell_class": "",
                "tokens": [
                    raw_token("--settings-action-button-radius", "var(--radius-pill)"),
                    px_token("--settings-action-button-pad-block", 0, 0),
                    px_token("--settings-action-button-pad-inline", 18, 0),
                    px_token("--settings-action-button-min-height", 32, 1),
                    raw_token("--settings-action-button-background", "#0055cc"),
                    raw_token("--settings-action-button-color", "var(--color-white-adaptive)"),
                    raw_token("--settings-action-button-background-disabled", "color-mix(in srgb, var(--theme-muted) 28%, transparent)"),
                    raw_token("--settings-action-button-color-disabled", "color-mix(in srgb, var(--settings-action-button-color) 72%, transparent)"),
                    raw_token("--settings-action-button-background-pending", "color-mix(in srgb, var(--settings-action-button-background) 76%, white 24%)"),
                ],
                "related_styles": [],
            },
            {
                "id": style_token_id("Settings action package"),
                "name": "Settings action package",
                "sample_kind": "action-package",
                "sample_title": labels["local_store_maintain_title"],
                "sample_copy": labels["local_store_maintain_note"],
                "sample_button": labels["local_store_maintain_button"],
                "sample_button_class": "settings-inline-button settings-inline-button-primary",
                "sample_icon_class": "icon-store-maintain",
                "sample_icon_shell_class": "settings-callout-card-primary",
                "tokens": [
                    px_token("--settings-action-package-column-gap", 12),
                    px_token("--settings-action-package-row-gap", 8),
                    px_token("--settings-action-package-copy-gap", 4),
                    px_token("--style-token-demo-width", 384),
                ],
                "related_styles": [
                    {
                        "name": "Settings action button",
                        "target_id": style_token_id("Settings action button"),
                    },
                    {
                        "name": "Settings execution option",
                        "target_id": style_token_id("Settings execution option"),
                    },
                ],
            },
            {
                "id": style_token_id("Circular icon button"),
                "name": "Circular icon button",
                "sample_kind": "round-icon-button",
                "sample_title": "",
                "sample_copy": "",
                "sample_button": "",
                "sample_button_class": "settings-round-icon-button",
                "sample_icon_class": "icon-plus",
                "sample_icon_shell_class": "",
                "tokens": [
                    px_token("--settings-round-icon-button-size", 36, 1),
                    px_token("--settings-round-icon-button-icon-size", 18, 1),
                    raw_token("--settings-round-icon-button-radius", "var(--radius-pill)"),
                    raw_token("--settings-round-icon-button-background", "var(--glass-chip-background-strong)"),
                    raw_token("--settings-round-icon-button-background-hover", "var(--glass-chip-background-hover)"),
                    raw_token("--settings-round-icon-button-shadow", "var(--glass-chip-shadow)"),
                    raw_token("--settings-round-icon-button-shadow-hover", "var(--glass-chip-shadow-hover)"),
                    raw_token("--settings-round-icon-button-shadow-active", "var(--glass-chip-shadow-active)"),
                    raw_token("--settings-round-icon-button-color", "color-mix(in srgb, var(--theme-text) 70%, transparent)"),
                    raw_token("--settings-round-icon-button-color-hover", "var(--accent-text)"),
                ],
                "related_styles": [],
            },
            {
                "id": style_token_id("Workspace metric value"),
                "name": "Workspace metric value",
                "sample_kind": "metric-value",
                "sample_title": labels["portfolio_total_return"],
                "sample_copy": "",
                "sample_button": "",
                "sample_button_class": "",
                "sample_icon_class": "",
                "sample_icon_shell_class": "",
                "sample_value": "67.01%",
                "tokens": [
                    raw_token("--workspace-metric-value-font-size", "var(--font-metric-md)"),
                    raw_token("--workspace-metric-value-line-height", "1"),
                    raw_token("--workspace-metric-value-letter-spacing", "-0.04em"),
                    raw_token("--workspace-metric-value-font-weight", "var(--font-weight-regular)"),
                    px_token("--workspace-metric-card-min-height", 58, 1),
                    raw_token("--workspace-metric-card-padding", "6px 8px 8px"),
                    px_token("--workspace-metric-card-row-gap", 4, 1),
                    raw_token("--workspace-metric-card-radius", "var(--radius-panel)"),
                    px_token("--workspace-metric-card-label-min-height", 24, 1),
                    raw_token("--workspace-metric-card-align-self", "start"),
                    raw_token("--workspace-metrics-grid-auto-rows-wide", "minmax(var(--workspace-metric-card-min-height), max-content)"),
                ],
                "related_styles": [],
            },
            {
                "id": style_token_id("Scrollable data table"),
                "name": "Scrollable data table",
                "sample_kind": "data-table",
                "sample_title": "Transaction history",
                "sample_copy": "",
                "sample_button": "",
                "sample_button_class": "",
                "sample_icon_class": "",
                "sample_icon_shell_class": "",
                "sample_table_columns": ["No.", "Time", "Type", "Description", "Amount"],
                "sample_table_rows": [
                    ["12", "2 Apr 2026", "Buy", "NVDA @ 123.45 x 10", "$1,234.50"],
                    ["11", "1 Apr 2026", "Deposit", "--", "$5,000.00"],
                    ["10", "31 Mar 2026", "Dividend", "AAPL", "$42.18"],
                    ["9", "28 Mar 2026", "Sell", "TSLA @ 271.00 x 3", "$813.00"],
                ],
                "tokens": [
                    raw_token("--radius-panel", "10px"),
                    raw_token("--glass-surface-border", "1px solid color-mix(in srgb, var(--theme-text) 8%, transparent)"),
                    raw_token("--glass-surface-background-soft", "var(--theme-glass-surface-background-soft)"),
                    raw_token("--panel-strong", "var(--theme-panel-strong)"),
                    raw_token("--scrollable-data-table-header-padding", "4px 1px"),
                    raw_token("--scrollable-data-table-cell-padding", "2px 1px"),
                    raw_token("--scrollable-data-table-summary-line-height", "0.75"),
                    raw_token("--scrollable-data-table-summary-padding", "6px 8px"),
                    raw_token("--investment-holdings-cell-padding", "4px 6px"),
                ],
                "related_styles": [],
            },
            {
                "id": style_token_id("Ticker identity row"),
                "name": "Ticker identity row",
                "sample_kind": "ticker-identity-row",
                "sample_title": "Alphabet Inc.",
                "sample_copy": "",
                "sample_button": "",
                "sample_button_class": "",
                "sample_icon_class": "",
                "sample_icon_shell_class": "",
                "sample_value": "GOOGL",
                "tokens": [
                    px_token("--ticker-identity-pad-block", 4, 0),
                    px_token("--ticker-identity-pad-inline", 6, 0),
                    px_token("--ticker-identity-gap", 10, 0),
                    px_token("--ticker-identity-min-height", 28, 1),
                    px_token("--ticker-identity-logo-height", 20, 1),
                    px_token("--ticker-identity-logo-max-width", 28, 1),
                    raw_token("--ticker-identity-symbol-font-size", "var(--font-tooltip)"),
                    px_token("--ticker-identity-name-margin-top", 2, 0),
                    raw_token("--ticker-identity-name-font-size", "var(--font-ui-xs)"),
                    raw_token("--ticker-identity-name-line-height", "1.2"),
                    raw_token("--ticker-identity-name-fade-stop", "78%"),
                    raw_token("--ticker-identity-background", "transparent"),
                    raw_token("--ticker-identity-background-hover", "transparent"),
                    px_token("--ticker-identity-radius", 0, 0),
                ],
                "related_styles": [],
            },
            {
                "id": style_token_id("Ticker input control"),
                "name": "Ticker input control",
                "sample_kind": "ticker-input-control",
                "sample_title": "Ticker 1",
                "sample_copy": "",
                "sample_button": "",
                "sample_button_class": "",
                "sample_icon_class": "",
                "sample_icon_shell_class": "",
                "sample_placeholder": "",
                "sample_value": "NVDA",
                "tokens": [
                    px_token("--trade-control-input-height", 30, 0),
                    px_token("--ticker-input-control-radius", 999, 0),
                    raw_token("--control-liquid-background", "color-mix(in srgb, var(--color-white-adaptive) 0.01%, transparent)"),
                    raw_token("--control-liquid-background-hover", "color-mix(in srgb, var(--theme-muted) 8%, transparent)"),
                    raw_token("--control-liquid-shadow", "none"),
                    raw_token("--control-liquid-shadow-focus", "none"),
                    raw_token("--ticker-input-glass-background", "transparent"),
                ],
                "related_styles": [],
            },
            {
                "id": style_token_id("Settings form input"),
                "name": "Settings form input",
                "sample_kind": "settings-form-input",
                "sample_title": "Outlook OAuth client ID",
                "sample_copy": "",
                "sample_button": "",
                "sample_button_class": "",
                "sample_icon_class": "",
                "sample_icon_shell_class": "",
                "sample_placeholder": "Outlook OAuth client ID",
                "sample_value": "8c4f9d21-6b73-4f1e-9a2c-3d7e5f8b1c42",
                "tokens": [
                    px_token("--radius-control", 999, 0),
                    px_token("--settings-text-input-pad-block", 5, 0),
                    px_token("--settings-text-input-pad-inline", 10, 0),
                    px_token("--settings-form-control-max-width", 384, 0),
                    raw_token("--settings-text-input-background", "var(--panel-strong)"),
                    raw_token("--settings-text-input-color", "var(--text)"),
                    raw_token("--settings-text-input-font-size", "var(--font-form-control)"),
                ],
                "related_styles": [],
            },
            {
                "id": style_token_id("Settings execution option"),
                "name": "Settings execution option",
                "sample_kind": "settings-general-option",
                "sample_title": "Signal bar close",
                "sample_copy": "When a signal appears, execute the trade at the closing price of the same bar. This is simple and deterministic, but it is more optimistic because the model uses the bar that generated the signal.",
                "sample_button": "",
                "sample_button_class": "",
                "sample_icon_class": "",
                "sample_icon_shell_class": "",
                "tokens": [
                    px_token("--settings-general-option-max-width", 640, 0),
                    px_token("--settings-general-option-radius", 10, 0),
                    px_token("--settings-general-option-pad-block", 14, 0),
                    px_token("--settings-general-option-pad-inline", 16, 0),
                    raw_token("--settings-general-option-background", "var(--glass-surface-background-strong)"),
                    raw_token("--settings-general-option-border", "1px solid color-mix(in srgb, var(--theme-text) 8%, transparent)"),
                ],
                "related_styles": [],
            },
            {
                "id": style_token_id("Modal dialog"),
                "name": "Modal dialog",
                "sample_kind": "modal-dialog",
                "sample_title": "Saving daily market data to local cache",
                "sample_copy": "We are checking this ticker for missing daily history and saving any new data on this device. Please keep this page open while the download finishes.",
                "sample_button": "",
                "sample_button_class": "",
                "sample_icon_class": "icon-overlay-local-cache",
                "sample_icon_shell_class": "",
                "tokens": [
                    px_token("--workspace-modal-radius", 10),
                    px_token("--workspace-modal-pad-block", 18),
                    px_token("--workspace-modal-pad-inline", 18),
                    px_token("--workspace-modal-close-offset", 10),
                    px_token("--workspace-modal-icon-size", 36),
                    px_token("--workspace-modal-column-gap", 12),
                    px_token("--workspace-modal-row-gap", 4),
                    px_token("--workspace-modal-title-margin-end", 32),
                ],
                "related_styles": [],
            },
            {
                "id": style_token_id("Modal dialog banner message"),
                "name": "Modal dialog banner message",
                "sample_kind": "floating-banner",
                "sample_title": "Backtest execution model updated: Signal bar close.",
                "sample_copy": "",
                "sample_button": "",
                "sample_button_class": "",
                "sample_icon_class": "icon-modal-dialog-banner-backtest-execution",
                "sample_icon_shell_class": "",
                "tokens": [],
                "related_styles": [
                    {
                        "name": "Modal dialog",
                        "target_id": style_token_id("Modal dialog"),
                    },
                ],
            },
            {
                "id": style_token_id("Trade strategy stepper"),
                "name": "Trade strategy stepper",
                "sample_kind": "trade-strategy-stepper",
                "sample_title": "",
                "sample_copy": "",
                "sample_button": "",
                "sample_button_class": "",
                "sample_icon_class": "",
                "sample_icon_shell_class": "",
                "tokens": [
                    px_token("--strategy-stepper-width", 20, 1),
                    px_token("--strategy-stepper-radius", 6, 0),
                    px_token("--strategy-param-control-height", 36, 1),
                    px_token("--strategy-stepper-button-height", 18, 1),
                    px_token("--strategy-stepper-font-size", 9, 1),
                ],
                "related_styles": [],
            },
            {
                "id": style_token_id("Local store pagination"),
                "name": "Local store pagination",
                "sample_kind": "local-store-pagination",
                "sample_title": "",
                "sample_copy": "",
                "sample_button": "",
                "sample_button_class": "",
                "sample_icon_class": "",
                "sample_icon_shell_class": "",
                "tokens": [
                    px_token("--local-store-pagination-slot-size", 30, 1),
                    raw_token("--local-store-pagination-button-radius", "var(--radius-pill)"),
                    raw_token("--local-store-pagination-indicator-radius", "var(--radius-pill)"),
                    raw_token("--local-store-pagination-indicator-background", "var(--accent-fill)"),
                    raw_token("--local-store-pagination-indicator-shadow",
                              "0 8px 18px var(--accent-shadow-strong), inset 0 1px 0 color-mix(in srgb, var(--theme-glass-highlight) 36%, transparent)"),
                    raw_token("--local-store-pagination-button-border", "1px solid var(--accent-border-strong)"),
                ],
                "related_styles": [],
            },
            {
                "id": style_token_id("Chart tooltip"),
                "name": "Chart tooltip",
                "sample_kind": "chart-tooltip",
                "sample_title": "26 Mar 2026 10:08",
                "sample_copy": "",
                "sample_button": "",
                "sample_button_class": "",
                "sample_icon_class": "",
                "sample_icon_shell_class": "",
                "sample_rows": [
                    {"label": "Close", "value": "44.38", "color": "var(--accent-fill)"},
                    {"label": "Net return", "value": "3.34%", "color": "var(--theme-accent-positive)"},
                    {"label": "Equity", "value": "10,333.71", "color": "var(--theme-text)"},
                    {"label": "If all in", "value": "9,840.88", "color": "var(--theme-muted)"},
                    {"label": "vs all in", "value": "+492.83", "color": "var(--theme-accent-positive)"},
                ],
                "tokens": [
                    material_reference_token("--tooltip-background", "Frosted glass extracted"),
                    material_reference_token("--tooltip-border", "Frosted glass extracted"),
                    material_reference_token("--tooltip-shadow", "Frosted glass extracted"),
                    material_reference_token("--tooltip-blur", "Frosted glass extracted"),
                    px_token("--chart-tooltip-min-width", 164, 1),
                    px_token("--chart-tooltip-max-width", 260, 1),
                    px_token("--chart-tooltip-padding-block", 10, 1),
                    px_token("--chart-tooltip-padding-inline", 12, 1),
                    px_token("--chart-tooltip-date-margin-bottom", 8, 1),
                    raw_token("--chart-tooltip-date-align", "left"),
                    px_token("--chart-tooltip-row-gap", 6, 1),
                    px_token("--chart-tooltip-item-gap", 8, 1),
                    raw_token("--chart-tooltip-label-align", "left"),
                    raw_token("--chart-tooltip-value-align", "right"),
                ],
                "related_styles": [],
            },
        ]
        token_order = {
            "Settings form input": 10,
            "Ticker input control": 15,
            "Settings execution option": 20,
            "Segmented control": 30,
            "Workspace metric value": 35,
            "Scrollable data table": 37,
            "Settings action button": 40,
            "Settings action package": 50,
            "Circular icon button": 60,
            "Trade strategy stepper": 70,
            "Local store pagination": 80,
            "Modal dialog": 90,
            "Modal dialog banner message": 100,
            "Chart tooltip": 110,
        }
        rows.sort(key=lambda row: (token_order.get(str(row.get("name", "")), 999), str(row.get("name", ""))))
        return rows

    def build_font_token_rows() -> list[dict[str, object]]:
        def font_token_id(name: str) -> str:
            return name.strip().lower().replace(" ", "-")

        def raw_token(name: str, value: str) -> dict[str, str]:
            return {
                "name": name,
                "value": str(value),
            }

        rows = [
            {
                "id": font_token_id("Primitive scale"),
                "name": "Primitive scale",
                "description": "Base pixel sizes defined in the design system. These are the source tokens that semantic text roles inherit from.",
                "samples": [
                    {"token_name": "--font-size-1", "usage_label": "Compact status", "sample_text": "Available", "sample_value": "11px"},
                    {"token_name": "--font-size-2", "usage_label": "Tooltip copy", "sample_text": "Logo services reachable", "sample_value": "12px"},
                    {"token_name": "--font-size-3", "usage_label": "Table text", "sample_text": "Ticker  Full name  Available range", "sample_value": "13px"},
                    {"token_name": "--font-size-4", "usage_label": "Form label", "sample_text": "Ticker  Period  Reinvest cash dividends", "sample_value": "14px"},
                    {"token_name": "--font-size-5", "usage_label": "Control text", "sample_text": "smtp-mail.outlook.com", "sample_value": "15px"},
                    {"token_name": "--font-size-6", "usage_label": "Section title", "sample_text": labels["hero_title"], "sample_value": "24px"},
                    {"token_name": "--font-size-7", "usage_label": "Large metric", "sample_text": "+19.84%", "sample_value": "32px"},
                    {"token_name": "--font-size-8", "usage_label": "XL metric", "sample_text": "67.01%", "sample_value": "36px"},
                ],
                "tokens": [
                    raw_token("--font-size-1", "11px"),
                    raw_token("--font-size-2", "12px"),
                    raw_token("--font-size-3", "13px"),
                    raw_token("--font-size-4", "14px"),
                    raw_token("--font-size-5", "15px"),
                    raw_token("--font-size-6", "24px"),
                    raw_token("--font-size-7", "32px"),
                    raw_token("--font-size-8", "36px"),
                ],
            },
            {
                "id": font_token_id("Semantic scale aliases"),
                "name": "Semantic scale aliases",
                "description": "Intermediate aliases map the primitive scale to UI, title, and metric contexts before component-level tokens consume them.",
                "samples": [
                    {"token_name": "--font-ui-xs", "usage_label": "Weekday labels", "sample_text": "Sun  Mon  Tue  Wed  Thu  Fri  Sat", "sample_value": "11px"},
                    {"token_name": "--font-ui-sm", "usage_label": "Tooltip size", "sample_text": "Use smtp-mail.outlook.com:587 with STARTTLS.", "sample_value": "12px"},
                    {"token_name": "--font-ui-md", "usage_label": "Standard label size", "sample_text": "Ticker  Period  Strategy", "sample_value": "14px"},
                    {"token_name": "--font-ui-lg", "usage_label": "Standard control size", "sample_text": "QQQ  NVDA  AAPL", "sample_value": "15px"},
                    {"token_name": "--font-title-md", "usage_label": "Workspace title", "sample_text": labels["portfolio_title"], "sample_value": "24px"},
                    {"token_name": "--font-metric-md", "usage_label": "Metric medium", "sample_text": "$ 10,333.71", "sample_value": "24px"},
                    {"token_name": "--font-metric-lg", "usage_label": "Metric large", "sample_text": "32.48%", "sample_value": "32px"},
                    {"token_name": "--font-metric-xl", "usage_label": "Metric extra large", "sample_text": "67.01%", "sample_value": "36px"},
                ],
                "tokens": [
                    raw_token("--font-ui-xs", "var(--font-size-1)"),
                    raw_token("--font-ui-sm", "var(--font-size-2)"),
                    raw_token("--font-ui-md", "var(--font-size-4)"),
                    raw_token("--font-ui-lg", "var(--font-size-5)"),
                    raw_token("--font-title-md", "var(--font-size-6)"),
                    raw_token("--font-metric-md", "var(--font-size-6)"),
                    raw_token("--font-metric-lg", "var(--font-size-7)"),
                    raw_token("--font-metric-xl", "var(--font-size-8)"),
                ],
            },
            {
                "id": font_token_id("Component text roles"),
                "name": "Component text roles",
                "description": "These are the font tokens used directly by the current workspace screens and controls.",
                "samples": [
                    {"token_name": "--font-form-label", "usage_label": "Form label",
                     "sample_text": f"{labels['backtest_ticker']}  {labels['period']}  {labels['backtest_strategy']}", "sample_value": "14px"},
                    {"token_name": "--font-form-control", "usage_label": "Form control", "sample_text": "MACD crossover  |  Exact range  |  2024-01-02 to 2025-03-19",
                     "sample_value": "15px"},
                    {"token_name": "--font-tooltip", "usage_label": "Tooltip", "sample_text": "Run the network checks again and refresh the availability results shown below.",
                     "sample_value": "12px"},
                    {"token_name": "--font-table-body", "usage_label": "Table body", "sample_text": "2025-03-19  BUY  100 @ 187.42  |  Equity  12,845.90", "sample_value": "13px"},
                    {"token_name": "--font-table-head", "usage_label": "Table head", "sample_text": "Ticker  Full name  Available range", "sample_value": "13px"},
                    {"token_name": "--font-card-title", "usage_label": "Card title", "sample_text": labels["hero_title"], "sample_value": "24px"},
                    {"token_name": "--font-card-subtitle", "usage_label": "Card subtitle", "sample_text": "AAPL  MSFT  NVDA  META  AVGO  AMD  ORCL  QQQ  SPY  TLT",
                     "sample_value": "15px"},
                    {"token_name": "--font-metric-value", "usage_label": "Metric value", "sample_text": "67.01%", "sample_value": "24px"},
                ],
                "tokens": [
                    raw_token("--font-form-label", "var(--font-ui-md)"),
                    raw_token("--font-form-control", "var(--font-ui-lg)"),
                    raw_token("--font-tooltip", "var(--font-ui-sm)"),
                    raw_token("--font-table-body", "var(--font-size-3)"),
                    raw_token("--font-table-head", "var(--font-size-3)"),
                    raw_token("--font-card-title", "var(--font-title-md)"),
                    raw_token("--font-card-subtitle", "var(--font-ui-lg)"),
                    raw_token("--font-metric-value", "var(--font-metric-md)"),
                ],
            },
        ]
        return rows

    def build_material_token_rows() -> list[dict[str, object]]:
        def material_token_id(name: str) -> str:
            return name.strip().lower().replace(" ", "-")

        def raw_token(name: str, value: str) -> dict[str, object]:
            return {
                "name": name,
                "value": str(value),
                "editable": False,
            }

        def standard_material_tokens(
                background: str,
                border: str,
                shadow: str,
                blur: str,
        ) -> list[dict[str, object]]:
            return [
                raw_token("--glass-surface-background", background),
                raw_token("--glass-surface-border", border),
                raw_token("--glass-surface-shadow", shadow),
                raw_token("--glass-surface-blur", blur),
            ]

        sample_title = "The quick brown fox jumps over the lazy dog."
        sample_copy = "Testing backdrop-filter and transparency performance over a complex gradient background."

        rows = [
            {
                "id": material_token_id("Frosted glass"),
                "name": "Frosted glass",
                "sample_kind": "glass-surface",
                "sample_title": sample_title,
                "sample_copy": sample_copy,
                "sample_surface_background": "var(--glass-surface-background)",
                "sample_surface_border": "var(--glass-surface-border)",
                "sample_surface_blur": "var(--glass-surface-blur)",
                "sample_surface_shadow": "var(--glass-surface-shadow)",
                "tokens": standard_material_tokens(
                    "var(--theme-glass-surface-background)",
                    "1px solid color-mix(in srgb, var(--color-white-adaptive) 26%, transparent)",
                    "0 18px 40px var(--theme-shadow-ambient)",
                    "saturate(180%) blur(24px)",
                ),
            },
            {
                "id": material_token_id("Frosted glass extracted"),
                "name": "Frosted glass extracted",
                "sample_kind": "glass-surface",
                "sample_title": sample_title,
                "sample_copy": sample_copy,
                "sample_surface_background": "linear-gradient(180deg, rgba(255, 255, 255, 0.24) 0%, rgba(248, 249, 250, 0.18) 100%)",
                "sample_surface_border": "1px solid rgba(255, 255, 255, 0.30)",
                "sample_surface_blur": "saturate(160%) blur(18px)",
                "sample_surface_shadow": "0 18px 40px rgba(10, 14, 25, 0.12)",
                "tokens": standard_material_tokens(
                    "linear-gradient(180deg, rgba(255, 255, 255, 0.24) 0%, rgba(248, 249, 250, 0.18) 100%)",
                    "1px solid rgba(255, 255, 255, 0.30)",
                    "0 18px 40px rgba(10, 14, 25, 0.12)",
                    "saturate(160%) blur(18px)",
                ),
            },
        ]
        return rows

    def build_local_store_pagination_slots(
            current_page: int,
            total_pages: int,
    ) -> tuple[dict[str, int | None], list[dict[str, int | None]], dict[str, int | None]]:
        page_group_index = (current_page - 1) // 5
        page_start = (page_group_index * 5) + 1
        page_slots: list[dict[str, int | None]] = []
        for offset in range(5):
            page_number = page_start + offset
            page_slots.append(
                {
                    "page": page_number if page_number <= total_pages else None,
                    "is_active": page_number == current_page,
                }
            )

        previous_page = page_start - 5 if page_start > 1 else None
        next_page = page_start + 5 if page_start + 5 <= total_pages else None
        return (
            {"page": previous_page},
            page_slots,
            {"page": next_page},
        )

    def build_local_market_rows() -> list[dict[str, str]]:
        rows: list[dict[str, str]] = []
        for ticker in list_local_market_tickers():
            rows.extend(build_local_market_rows_for_tickers([ticker], include_ranges=True))
        return rows

    def has_local_profile_snapshot(ticker: str) -> bool:
        return has_profile_record(ticker)

    def has_local_logo_snapshot(ticker: str) -> bool:
        return has_logo_asset(ticker)

    def list_local_market_tickers() -> list[str]:
        return [
            ticker
            for ticker in list_local_tickers()
            if history_store_path_for(ticker).exists() and history_store_path_for(ticker).stat().st_size > 0
               and has_local_profile_snapshot(ticker) and has_local_logo_snapshot(ticker)
        ]

    def load_local_profile_snapshot(ticker: str) -> tuple[str, str] | None:
        profile_record = load_profile_record(ticker)
        if profile_record is None:
            return None
        logo_path = logo_store_path_for(ticker)
        if not logo_path.exists():
            return None
        logo_url = build_market_store_logo_url(logo_path.name, logo_path.stat().st_mtime_ns)
        company_name = str(profile_record.get("company_name") or "").strip()
        if company_name:
            return company_name, logo_url
        return None

    def build_local_market_rows_for_tickers(
            tickers: list[str],
            *,
            include_ranges: bool,
    ) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        for ticker in tickers:
            history_path = history_store_path_for(ticker)
            if not history_path.exists() or history_path.stat().st_size == 0:
                continue
            profile_snapshot = load_local_profile_snapshot(ticker)
            if profile_snapshot is None:
                continue
            company_name, logo_url = profile_snapshot
            range_start = ""
            range_end = ""
            if include_ranges:
                try:
                    dataset = pd.read_parquet(history_path, columns=["Date"])
                    if dataset.empty:
                        continue
                    date_values = dataset["Date"]
                    if isinstance(date_values, pd.DataFrame):
                        date_values = date_values.iloc[:, 0]
                    range_start = format_store_range_date(date_values.min())
                    range_end = format_store_range_date(date_values.max())
                except Exception:
                    pass
            daily_store_status = classify_daily_store_status(ticker)
            intraday_store_status = classify_one_minute_store_status(ticker)
            rows.append(
                {
                    "ticker": ticker,
                    "company_name": company_name,
                    "logo_url": logo_url,
                    "range_start": range_start,
                    "range_end": range_end,
                    "range": f"{range_start} - {range_end}" if range_start and range_end else "",
                    "has_1m": intraday_store_status == "fresh",
                    "has_1d": daily_store_status == "fresh",
                    "daily_store_status": daily_store_status,
                    "intraday_store_status": intraday_store_status,
                }
            )
        return rows

    def build_network_service_rows(*, pending: bool) -> list[dict[str, str | bool]]:
        def service_logo_url(filename: str) -> str:
            return url_for("static", filename=f"images/{filename}")

        def format_checked_at(value: float | None) -> str:
            if value is None:
                return "Last checked: Not checked yet."
            stamp = pd.Timestamp(value, unit="s")
            return f"Last checked: {stamp.day} {stamp.strftime('%b %Y %H:%M:%S')}"

        if pending:
            return [
                {
                    "key": "market",
                    "name": "yfinance",
                    "status": "Checking...",
                    "note": "Checking whether Yahoo Finance can be reached from this device.",
                    "checked_at_text": "Last checked: Checking...",
                    "logo_url": service_logo_url("Yahoo-Logo.svg"),
                    "is_available": False,
                    "is_pending": True,
                },
                {
                    "key": "logo",
                    "name": labels["logo_network"],
                    "status": "Checking...",
                    "note": "Checking whether the primary ticker logo service and its fallbacks can be reached from this device.",
                    "checked_at_text": "Last checked: Checking...",
                    "logo_url": service_logo_url("network.svg"),
                    "is_available": False,
                    "is_pending": True,
                },
                {
                    "key": "google-hk",
                    "name": "Google (Hong Kong)",
                    "status": "Checking...",
                    "note": "Checking whether Google (Hong Kong) can be reached from this device.",
                    "checked_at_text": "Last checked: Checking...",
                    "logo_url": service_logo_url("Google__G__logo.svg"),
                    "is_available": False,
                    "is_pending": True,
                },
                {
                    "key": "tradingview-ta",
                    "name": "tradingview-ta",
                    "status": "Checking...",
                    "note": "Checking if the tradingview-ta library is installed.",
                    "checked_at_text": "Last checked: Checking...",
                    "logo_url": service_logo_url("TradingView-Logo.svg"),
                    "is_available": False,
                    "is_pending": True,
                },
            ]

        remote_market_access = has_remote_market_access()
        remote_logo_access = has_remote_logo_access()
        google_hk_access = has_google_hk_access()
        tradingview_ta_available = has_tradingview_ta_available()
        remote_market_access = bool(remote_market_access)
        remote_logo_access = bool(remote_logo_access)
        google_hk_access = bool(google_hk_access)
        tradingview_ta_available = bool(tradingview_ta_available)
        return [
            {
                "key": "market",
                "name": "yfinance",
                "status": labels["service_ok"] if remote_market_access else labels["service_down"],
                "note": (
                    "Yahoo Finance is reachable, so missing price history can be refreshed from the network."
                    if remote_market_access
                    else "Yahoo Finance is blocked here, so the app can only rely on bundled local market data."
                ),
                "checked_at_text": format_checked_at(last_remote_market_check_at()),
                "logo_url": service_logo_url("Yahoo-Logo.svg"),
                "is_available": remote_market_access,
                "is_pending": False,
            },
            {
                "key": "logo",
                "name": labels["logo_network"],
                "status": labels["service_ok"] if remote_logo_access else labels["service_down"],
                "note": (
                    "Logo providers are reachable, so missing brand marks can be fetched when needed."
                    if remote_logo_access
                    else "Remote logo sources are blocked here, so only logos already stored locally will appear."
                ),
                "checked_at_text": format_checked_at(last_remote_logo_check_at()),
                "logo_url": service_logo_url("network.svg"),
                "is_available": remote_logo_access,
                "is_pending": False,
            },
            {
                "key": "google-hk",
                "name": "Google (Hong Kong)",
                "status": labels["service_ok"] if google_hk_access else labels["service_down"],
                "note": (
                    "Google (Hong Kong) is reachable from this device."
                    if google_hk_access
                    else "Google (Hong Kong) could not be reached from this device."
                ),
                "checked_at_text": format_checked_at(last_google_hk_check_at()),
                "logo_url": service_logo_url("Google__G__logo.svg"),
                "is_available": google_hk_access,
                "is_pending": False,
            },
            {
                "key": "tradingview-ta",
                "name": "tradingview-ta",
                "status": labels["service_ok"] if tradingview_ta_available else labels["service_down"],
                "note": (
                    "The tradingview-ta library is installed, so TradingView technical analysis indicators can be used."
                    if tradingview_ta_available
                    else "The tradingview-ta library is not installed, so features requiring it will be unavailable."
                ),
                "checked_at_text": format_checked_at(last_tradingview_ta_check_at()),
                "logo_url": service_logo_url("TradingView-Logo.svg"),
                "is_available": tradingview_ta_available,
                "is_pending": False,
            },
        ]

    def maintain_local_market_store() -> dict[str, Any]:
        historical_tickers = list_historical_tickers()
        if not historical_tickers:
            return {
                "total_count": 0,
                "history_refreshed_count": 0,
                "metadata_refreshed_count": 0,
                "metadata_blocked_count": 0,
                "history_failed_tickers": [],
            }

        def refresh_local_entry(ticker: str) -> tuple[str, bool]:
            refresh_history_store(ticker)
            metadata_refreshed = refresh_quote_profile_cache(ticker, force_refresh=True)
            if not metadata_refreshed:
                fetch_quote_profile(ticker, force_refresh=False)
            return ticker, metadata_refreshed

        history_refreshed_count = 0
        metadata_refreshed_count = 0
        history_failed_tickers: list[str] = []
        worker_count = min(6, len(historical_tickers))
        with ThreadPoolExecutor(max_workers=worker_count) as executor:
            futures = {executor.submit(refresh_local_entry, ticker): ticker for ticker in historical_tickers}
            for future in as_completed(futures):
                ticker = futures[future]
                try:
                    _, metadata_refreshed = future.result()
                    history_refreshed_count += 1
                    if metadata_refreshed:
                        metadata_refreshed_count += 1
                except Exception:
                    history_failed_tickers.append(ticker)
        return {
            "total_count": len(historical_tickers),
            "history_refreshed_count": history_refreshed_count,
            "metadata_refreshed_count": metadata_refreshed_count,
            "metadata_blocked_count": max(history_refreshed_count - metadata_refreshed_count, 0),
            "history_failed_tickers": history_failed_tickers,
        }

    def local_store_page_value() -> int:
        return max(parse_int_value(request.args.get("page", request.args.get("local_page")), 1), 1)

    def build_modern_query_pairs() -> list[tuple[str, str]]:
        pairs: list[tuple[str, str]] = []

        for ticker in parse_requested_tickers():
            pairs.append(("ticker", ticker))

        has_weight_args = bool(request.args.getlist("weight")) or any(
            key.startswith("weight_") for key in request.args.keys()
        )
        if has_weight_args:
            for weight in parse_requested_weights(MAX_TICKERS):
                pairs.append(("weight", str(weight)))

        period_value = request.args.get("period", "").strip().lower()
        if period_value:
            pairs.append(("period", period_value))

        range_value = request.args.get("range", request.args.get("range_mode", "")).strip().lower()
        if range_value:
            pairs.append(("range", range_value))

        start_value = request.args.get("from", request.args.get("exact_start", "")).strip()
        if start_value:
            pairs.append(("from", start_value))

        end_value = request.args.get("to", request.args.get("exact_end", "")).strip()
        if end_value:
            pairs.append(("to", end_value))

        dividends_value = request.args.get("dividends", request.args.get("include_dividends", "")).strip()
        if dividends_value:
            pairs.append(("dividends", dividends_value))

        strategy_value = request.args.get("strategy", "").strip()
        if strategy_value:
            pairs.append(("strategy", strategy_value))

        capital_value = request.args.get("capital", request.args.get("initial_capital", "")).strip()
        if capital_value:
            pairs.append(("capital", capital_value))

        page_value = request.args.get("page", request.args.get("local_page", "")).strip()
        if page_value:
            pairs.append(("page", page_value))

        passthrough_keys = {
            "ticker",
            "tickers",
            "weight",
            "period",
            "range",
            "range_mode",
            "from",
            "to",
            "exact_start",
            "exact_end",
            "dividends",
            "include_dividends",
            "strategy",
            "capital",
            "initial_capital",
            "page",
            "local_page",
            "view",
            "section",
            "ticker_a",
            "ticker_b",
        }
        passthrough_keys.update({f"ticker_{index}" for index in range(1, MAX_TICKERS + 1)})
        passthrough_keys.update({f"weight_{index}" for index in range(1, MAX_TICKERS + 1)})

        strategy_param_keys: set[str] = set()
        strategy_value = request.args.get("strategy", "").strip()
        if strategy_value:
            try:
                strategy = instantiate_strategy(strategy_value)
                strategy_param_keys = {definition.key for definition in strategy.get_parameter_definitions()}
            except Exception:
                strategy_param_keys = set()

        for key in request.args.keys():
            if key in {"view", "section"}:
                continue
            if key in passthrough_keys and key not in strategy_param_keys:
                continue
            for value in request.args.getlist(key):
                cleaned = str(value).strip()
                if cleaned:
                    pairs.append((key, cleaned))

        return pairs

    def align_datasets_on_common_dates(datasets: list[pd.DataFrame]) -> list[pd.DataFrame]:
        merged = datasets[0][["Date", "Close"]].rename(columns={"Close": "Close_0"}).copy()
        for index, dataset in enumerate(datasets[1:], start=1):
            merged = pd.merge(
                merged,
                dataset[["Date", "Close"]].rename(columns={"Close": f"Close_{index}"}),
                on="Date",
                how="inner",
            ).sort_values("Date")
        if merged.empty:
            raise ValueError("The selected tickers do not share any common trading dates.")
        return [
            merged[["Date", f"Close_{index}"]].rename(columns={f"Close_{index}": "Close"}).copy()
            for index in range(len(datasets))
        ]

    def extract_shared_dates(datasets: list[pd.DataFrame]) -> pd.Series:
        if not datasets:
            return pd.Series(dtype="datetime64[ns]")
        merged = datasets[0][["Date"]].drop_duplicates().sort_values("Date")
        for dataset in datasets[1:]:
            merged = pd.merge(
                merged,
                dataset[["Date"]].drop_duplicates(),
                on="Date",
                how="inner",
            ).sort_values("Date")
            if merged.empty:
                return pd.Series(dtype="datetime64[ns]")
        return merged["Date"].reset_index(drop=True)

    def build_supported_periods_from_dates(date_values: pd.Series, interval: str = "1d") -> list[str]:
        timestamps = pd.to_datetime(date_values, errors="coerce").dropna().sort_values().drop_duplicates()
        if timestamps.empty:
            return ["1d"] if interval == "1m" else ["1d"]

        start = timestamps.iloc[0]
        end = timestamps.iloc[-1]
        trading_day_count = len(pd.Index(timestamps.dt.normalize()).unique())
        candidate_periods = SUPPORTED_PERIODS_1M if interval == "1m" else ADAPTIVE_PERIODS_1D
        supported: list[str] = []

        for candidate in candidate_periods:
            if candidate == "max":
                continue
            if candidate in TRADING_DAY_REQUIREMENTS:
                if trading_day_count >= TRADING_DAY_REQUIREMENTS[candidate]:
                    supported.append(candidate)
                continue
            if candidate in PERIOD_OFFSETS:
                candidate_start = (end - PERIOD_OFFSETS[candidate]).normalize()
                if candidate_start >= start.normalize():
                    supported.append(candidate)

        if interval == "1m":
            if not supported:
                supported.append("1d")
            if len(supported) >= 2:
                supported.append("max")
            return supported

        if not supported:
            return ["max"]
        supported.append("max")
        return supported

    def resolve_requested_period_from_supported(
            requested_period: str,
            supported_periods: list[str],
            earliest_available: pd.Timestamp | None = None,
    ) -> tuple[str, str | None]:
        if requested_period in supported_periods:
            return requested_period, None

        fallback_period = supported_periods[-1] if supported_periods else "1d"
        if fallback_period == "max" and len(supported_periods) >= 2:
            fallback_label = format_period_label(fallback_period)
        else:
            fallback_label = format_period_label(fallback_period)

        notice = (
            f"Requested period {requested_period} exceeds the available trading history. "
            f"Automatically switched to {fallback_label}."
        )
        if earliest_available is not None:
            notice = (
                f"{notice[:-1]} Earliest available data starts on "
                f"{format_display_date(earliest_available)}."
            )
        return fallback_period, notice

    def build_supported_periods_for_history_store(ticker: str, interval: str = "1d") -> list[str]:
        path = intraday_history_store_path_for(ticker, interval) if interval == "1m" else history_store_path_for(ticker)
        if not path.exists() or path.stat().st_size == 0:
            return ["1d"] if interval == "1m" else ["max"]
        try:
            dataset = pd.read_parquet(path, columns=["Date"])
        except Exception:
            return ["1d"] if interval == "1m" else ["max"]
        if dataset.empty:
            return ["1d"] if interval == "1m" else ["max"]
        return build_supported_periods_from_dates(dataset["Date"], interval=interval)

    def resolve_effective_period_for_many(requested_period: str, datasets: list[pd.DataFrame]) -> tuple[str, str | None]:
        shared_dates = extract_shared_dates(datasets)
        if shared_dates.empty:
            raise ValueError("The selected tickers do not have overlapping trading history.")
        supported_periods = build_supported_periods_from_dates(shared_dates, interval="1d")
        return resolve_requested_period_from_supported(
            requested_period,
            supported_periods,
            earliest_available=shared_dates.min(),
        )

    def render_workspace_page(current_view: str, settings_section: str = "about", more_section: str = "timing"):
        backtest_execution_mode = load_backtest_execution_mode()
        is_dock_prefetch = request.headers.get("X-Requested-With") == "dock-prefetch"
        requested_tickers = parse_requested_tickers()
        if current_view == "backtest" and not requested_tickers:
            requested_tickers = [normalize_ticker_input(str(defaults.get("backtest_ticker", DEFAULT_TICKERS[0])))]
        range_mode, period, exact_start, exact_end = parse_range_request_args()
        include_dividends = parse_bool_flag("dividends", "include_dividends")

        if current_view == "tickers" and not requested_tickers:
            requested_tickers = [
                normalize_ticker_input(defaults.get("ticker_a", DEFAULT_TICKERS[0])),
                normalize_ticker_input(defaults.get("ticker_b", DEFAULT_TICKERS[1])),
            ]
            include_dividends = True
        elif current_view == "portfolio" and not requested_tickers:
            requested_tickers = [
                                    normalize_ticker_input(value)
                                    for value in defaults.get("portfolio_tickers", ["NVDA", "AAPL", "QQQ"])
                                    if normalize_ticker_input(value)
                                ][:MAX_TICKERS]
            include_dividends = True
        elif current_view == "backtest" and not requested_tickers:
            default_trade_ticker = normalize_ticker_input(
                defaults.get("backtest_ticker", defaults.get("ticker_a", DEFAULT_TICKERS[0]))
            )
            requested_tickers = [default_trade_ticker] if default_trade_ticker else [DEFAULT_TICKERS[0]]
            include_dividends = bool(defaults.get("backtest_include_dividends", True))

        settings_feedback = _read_settings_feedback() if current_view == "settings" else {}
        error = (
            settings_feedback.get("error")
            if current_view == "settings"
            else (request.args.get("error", "").strip() or None)
        )
        notice = (
            settings_feedback.get("notice")
            if current_view == "settings"
            else (request.args.get("notice", "").strip() or None)
        )
        broker_test_status = (
            settings_feedback.get("broker_test_status", "").lower() or None
            if current_view == "settings"
            else (request.args.get("broker_test_status", "").strip().lower() or None)
        )
        broker_test_message = (
            settings_feedback.get("broker_test_message")
            if current_view == "settings"
            else (request.args.get("broker_test_message", "").strip() or None)
        )
        broker_test_checked_at = (
            settings_feedback.get("broker_test_checked_at")
            if current_view == "settings"
            else (request.args.get("broker_test_checked_at", "").strip() or None)
        )
        floating_banner_icon_class = "icon-modal-dialog-banner-default"
        if notice and "Successfully connected" in notice:
            floating_banner_icon_class = "icon-settings-broker"
        elif error:
            floating_banner_icon_class = "icon-modal-dialog-banner-default"  # Or some error icon
        exact_start_value = exact_start
        exact_end_value = exact_end
        display_range = ""
        profiles = []
        series = []
        performance_items = []
        portfolio_items = []
        portfolio_weights = []
        portfolio_total_return = None
        validated_tickers: list[str] = []
        datasets: list[pd.DataFrame] = []
        aligned_datasets: list[pd.DataFrame] = []
        strategy_options = list_enabled_strategies()
        strategy_option_groups = build_strategy_option_groups(strategy_options)
        selected_strategy_id = request.args.get(
            "strategy",
            defaults.get("backtest_strategy", strategy_options[0]["id"] if strategy_options else "")
            if current_view == "backtest"
            else (strategy_options[0]["id"] if strategy_options else ""),
        ).strip()
        strategy_ids = {str(item["id"]) for item in strategy_options}
        if selected_strategy_id not in strategy_ids and strategy_options:
            selected_strategy_id = str(strategy_options[0]["id"])
        selected_strategy_params = collect_strategy_form_values(selected_strategy_id) if selected_strategy_id else {}
        strategy_form_fields = build_strategy_form_fields(selected_strategy_id, selected_strategy_params) if selected_strategy_id else []
        backtest_initial_capital = max(
            parse_float_value(
                request.args.get("capital", request.args.get("initial_capital")),
                float(defaults.get("backtest_capital", 10000.0)) if current_view == "backtest" else 10000.0,
            ),
            1.0,
        )
        requested_interval = request.args.get("interval", defaults.get("backtest_interval", DEFAULT_INTERVAL)).strip().lower()
        supported_intervals = ["1d"]
        if current_view == "backtest" and requested_tickers:
            try:
                trade_ticker = validate_ticker_or_raise(requested_tickers[0])
                if has_recent_one_minute_store(trade_ticker):
                    supported_intervals.append("1m")
            except ValueError:
                pass

        # Smart default for 1w period if interval is not specified
        if not request.args.get("interval") and period == "1w" and "1m" in supported_intervals:
            requested_interval = "1m"

        if requested_interval not in supported_intervals:
            requested_interval = supported_intervals[0]

        backtest_result = None
        date_constraints = build_date_constraint_payload()
        ticker_slots = requested_tickers.copy() if requested_tickers else ["", ""]
        requested_weights = parse_requested_weights(max(len(ticker_slots), MIN_TICKERS)) if current_view == "portfolio" else []
        has_weight_query = bool(request.args.getlist("weight")) or any(
            key.startswith("weight_") for key in request.args.keys()
        )
        if current_view == "portfolio" and not has_weight_query:
            requested_weights = [
                                    min(max(parse_int_value(value, 0), 0), 100)
                                    for value in defaults.get("portfolio_weights", [25, 25, 50])
                                ][:max(len(requested_tickers), MIN_TICKERS)]
        period_label = format_period_label(period)
        page_title = labels["hero_title"]
        report_heading = labels["performance_summary"]
        chart_heading = labels["chart_summary"]
        settings_title = labels["about"]
        settings_service_rows: list[dict[str, str | bool]] = []
        strategy_settings_rows: list[dict[str, object]] = []
        style_token_rows: list[dict[str, object]] = []
        material_token_rows: list[dict[str, object]] = []
        font_token_rows: list[dict[str, object]] = []
        smtp_settings = sanitize_smtp_settings_for_view(load_smtp_settings())
        broker_settings = sanitize_broker_settings_for_view(load_broker_settings())
        local_market_rows: list[dict[str, Any]] = []
        local_store_total_pages = 1
        local_store_current_page = 1
        local_store_prev_slot = {"page": None}
        local_store_page_slots = [{"page": page_number, "is_active": page_number == 1} for page_number in range(1, 6)]
        local_store_next_slot = {"page": None}
        more_cards: list[dict[str, str]] = []
        backtest_periods_by_interval: dict[str, list[str]] = {
            "1d": list(ADAPTIVE_PERIODS_1D),
            "1m": list(SUPPORTED_PERIODS_1M),
        }

        settings_section = normalize_settings_section(settings_section)
        more_section = normalize_more_section(more_section)

        if current_view == "settings" and settings_section == "about":
            error = None
            notice = None

        if current_view == "portfolio":
            page_title = labels["portfolio_title"]
            report_heading = labels["portfolio_summary"]
            chart_heading = labels["portfolio_chart"]
        elif current_view == "backtest":
            page_title = labels["backtest_title"]
        elif current_view == "settings":
            page_title = labels["settings_title"]
            if settings_section == "network":
                settings_title = labels["network_self_check"]
            elif settings_section == "general":
                settings_title = "General"
            elif settings_section == "font-tokens":
                settings_title = "Font tokens"
            elif settings_section == "material-tokens":
                settings_title = "Material tokens"
            elif settings_section == "strategies":
                settings_title = labels["strategy_settings"]
            elif settings_section == "email-smtp":
                settings_title = labels["email_smtp"]
            elif settings_section == "broker-access":
                settings_title = "Broker access"
            elif settings_section == "local-market-store":
                settings_title = labels["local_market_store"]
            elif settings_section == "clear-caches":
                settings_title = "Clear caches"
            elif settings_section == "style-tokens":
                settings_title = "Style tokens"
        elif current_view == "more":
            page_title = labels["more_title"]
            settings_title = labels["more_title"]
            if more_section == "investment":
                page_title = "Investment"
                settings_title = "Investment"

        supported_periods = (
            list(SUPPORTED_PERIODS_1M) if requested_interval == "1m" and "1m" in supported_intervals else list(ADAPTIVE_PERIODS_1D)
        )

        if period not in supported_periods:
            period = supported_periods[0] if supported_periods else DEFAULT_PERIOD

        def handle_fetch_history_failure(ticker: str, include_dividends: bool) -> pd.DataFrame:
            """
            If fetching fails because remote data cannot be retrieved, try to load whatever local data exists.
            If any local parquet exists, even if incomplete, return it instead of raising immediately.
            """
            path = history_store_path_for(ticker)
            if path.exists():
                try:
                    return select_price_series(pd.read_parquet(path), include_dividends)
                except Exception:
                    pass
            raise ValueError(f"No market data returned for {ticker}.")

        try:
            if current_view == "backtest":
                # Check cache: skip re-computation if config unchanged
                cache_key = _get_backtest_cache_key()
                if cache_key in _cached_backtest:
                    # Cache hit - use cached result directly
                    backtest_result, trade_ticker, requested_interval, date_constraints, trade_dataset, selected_strategy_id, selected_strategy_params = _cached_backtest[cache_key]
                else:
                    # Cache miss - need to recompute and cache
                    backtest_result, trade_ticker, requested_interval, date_constraints, trade_dataset, selected_strategy_id, selected_strategy_params = _run_backtest_from_request()
                    _cached_backtest[cache_key] = (
                        backtest_result, trade_ticker, requested_interval, date_constraints,
                        trade_dataset, selected_strategy_id, selected_strategy_params
                    )
                    # Limit cache size to prevent memory growth (keep last 8 cached results)
                    if len(_cached_backtest) > 8:
                        # Remove oldest entry
                        oldest_key = next(iter(_cached_backtest.keys()))
                        del _cached_backtest[oldest_key]
                record_strategy_usage(selected_strategy_id)
                ticker_slots = [trade_ticker]
                profiles = [fetch_quote_profile(trade_ticker, False)]
                backtest_periods_by_interval = {
                    "1d": build_supported_periods_for_history_store(trade_ticker, "1d"),
                    "1m": build_supported_periods_for_history_store(trade_ticker, "1m"),
                }
                if not trade_dataset.empty:
                    backtest_periods_by_interval[requested_interval] = build_supported_periods_from_dates(
                        trade_dataset["Date"],
                        interval=requested_interval,
                    )
                supported_periods = backtest_periods_by_interval.get(requested_interval, list(ADAPTIVE_PERIODS_1D))
                period, period_notice = resolve_requested_period_from_supported(
                    period,
                    supported_periods,
                    earliest_available=trade_dataset["Date"].min() if not trade_dataset.empty else None,
                )
                if period_notice and notice is None:
                    notice = period_notice
                elif period_notice:
                    notice += " " + period_notice
                exact_start_value = trade_dataset["Date"].min().strftime("%Y-%m-%d")
                exact_end_value = trade_dataset["Date"].max().strftime("%Y-%m-%d")
                if range_mode == "exact":
                    period_label = "Exact range"
                else:
                    period_label = format_period_label(period)
                display_range = f"{format_display_date(trade_dataset['Date'].min())} - {format_display_date(trade_dataset['Date'].max())}"
            elif current_view in {"tickers", "portfolio"}:
                if requested_tickers and len(requested_tickers) >= MIN_TICKERS:
                    if is_dock_prefetch:
                        validated_tickers = [normalize_ticker_input(t) or t for t in requested_tickers]
                        profiles = [type("Mock", (), {"company_name": t, "logo_url": ""})() for t in validated_tickers]
                        if current_view == "portfolio":
                            portfolio_weights = requested_weights or [0] * len(validated_tickers)
                            portfolio_items = [{"ticker": t, "company_name": t, "logo_url": "", "weight": w, "growth_multiple": 1.0, "color": "transparent"} for t, w in
                                               zip(validated_tickers, portfolio_weights)]
                            portfolio_total_return = 0.0
                        else:
                            series = [type("Mock", (), {"ticker": t, "normalized_returns": [0.0], "color": "transparent"})() for t in validated_tickers]
                            performance_items = [
                                {"ticker": t, "company_name": t, "logo_url": "", "ending_return": 0.0, "color": "transparent", "shadow_color": "transparent", "is_winner": False}
                                for t in validated_tickers]
                        common_start = pd.Timestamp.now()
                        common_end = pd.Timestamp.now()
                        display_range = "Loading range..."
                        ticker_slots = validated_tickers.copy()
                        continue_process_tickers = False
                    else:
                        validated_tickers = [validate_ticker_or_raise(ticker) for ticker in requested_tickers]
                        continue_process_tickers = True
                    if continue_process_tickers:
                        if len(set(validated_tickers)) != len(validated_tickers):
                            raise ValueError("Ticker symbols must be unique.")

                        freshness_refresh_failures: list[str] = []
                        if current_view in {"tickers", "portfolio"}:
                            freshness_refresh_failures = ensure_latest_daily_caches(validated_tickers)

                        # Try to fetch datasets, handle missing remote data by falling back to any available local data
                        datasets: list[pd.DataFrame] = []
                        failed_fetches: list[str] = []
                        completely_missing: list[str] = []
                        for ticker in validated_tickers:
                            try:
                                datasets.append(fetch_history(ticker, include_dividends))
                            except ValueError as fetch_exc:
                                if "No market data returned" in str(fetch_exc) or "Local market data for" in str(fetch_exc):
                                    try:
                                        dataset = handle_fetch_history_failure(ticker, include_dividends)
                                        datasets.append(dataset)
                                        failed_fetches.append(ticker)
                                    except ValueError:
                                        completely_missing.append(ticker)
                                else:
                                    raise

                        # If any ticker is completely missing (no local + no remote), replace it with the first available local ticker from usage history
                        if completely_missing:
                            local_tickers = [t for t in list_local_market_tickers() if t not in completely_missing]
                            if not local_tickers:
                                # If no local tickers available at all, use the default tickers to guarantee something renders
                                local_tickers = [normalize_ticker_input(t) for t in DEFAULT_TICKERS if normalize_ticker_input(t) not in completely_missing]

                            for missing_ticker in completely_missing:
                                # Pick the first available local ticker that has data
                                replacement = local_tickers[0] if len(local_tickers) > 0 else DEFAULT_TICKERS[0]
                                replacement = normalize_ticker_input(replacement)
                                # Replace in validated_tickers
                                idx = validated_tickers.index(missing_ticker)
                                validated_tickers[idx] = replacement
                                # Fetch dataset for replacement
                                try:
                                    dataset = fetch_history(replacement, include_dividends)
                                    # Remove the placeholder None we appended when skipping
                                    if len(datasets) > idx:
                                        datasets.pop(idx)
                                    datasets.insert(idx, dataset)
                                except Exception:
                                    # This should not happen since we filtered local_tickers to only include available ones
                                    pass
                                # Add to notice
                                if notice is None:
                                    notice = f"{missing_ticker} has no local or remote market data, automatically replaced with {replacement}."
                                else:
                                    notice += f" {missing_ticker} has no local or remote market data, automatically replaced with {replacement}."

                        profiles = [fetch_quote_profile(ticker, False) for ticker in validated_tickers]
                        supported_periods = build_supported_periods_from_dates(
                            extract_shared_dates(datasets),
                            interval="1d",
                        )
                        date_constraints = build_date_constraint_payload(
                            *datasets,
                            requested_start=exact_start or None,
                            requested_end=exact_end or None,
                        )

                        # Auto-switch to Exact mode if we're in Relative mode and any ticker couldn't fetch full recent data
                        auto_notice = None
                        if range_mode != "exact" and len(failed_fetches) > 0:
                            # Get the minimal max date across all datasets (latest available data is bounded by the ticker with incomplete data)
                            common_max_end = min(dataset["Date"].max() for dataset in datasets)
                            # The requested period offset stays the same but end is now at the latest available common date
                            requested_start = (common_max_end - PERIOD_OFFSETS[period]).normalize()
                            adjusted_start = requested_start.strftime("%Y-%m-%d")
                            adjusted_end = common_max_end.strftime("%Y-%m-%d")
                            # Rebuild date constraints with the new exact range
                            date_constraints = build_date_constraint_payload(
                                *datasets,
                                requested_start=adjusted_start,
                                requested_end=adjusted_end,
                            )
                            range_mode = "exact"
                            period_label = "Exact range"
                            ticker_list = ", ".join(failed_fetches)
                            auto_notice = (
                                f"Could not retrieve the latest market data for {ticker_list}. "
                                f"Automatically switched to exact range from {format_display_date(pd.to_datetime(adjusted_start))} "
                                f"to {format_display_date(common_max_end)} based on available local data."
                            )
                            if notice is None:
                                notice = auto_notice
                            else:
                                notice += " " + auto_notice

                        if freshness_refresh_failures:
                            failed_preview = ", ".join(freshness_refresh_failures)
                            freshness_notice = (
                                f"Could not refresh the latest trading-day cache for {failed_preview}. "
                                "Using the newest local daily data currently available."
                            )
                            if notice is None:
                                notice = freshness_notice
                            else:
                                notice += " " + freshness_notice

                        if range_mode == "exact":
                            if not date_constraints.trading_dates:
                                raise ValueError("The selected tickers do not share any common trading dates.")
                            aligned_datasets = align_datasets_on_common_dates(datasets)
                            aligned_datasets = slice_datasets_to_exact_range(
                                aligned_datasets,
                                date_constraints.adjusted_start,
                                date_constraints.adjusted_end,
                            )
                            if any(dataset.empty for dataset in aligned_datasets):
                                raise ValueError("The selected exact range does not contain shared trading dates.")
                            exact_start_value = date_constraints.adjusted_start or adjusted_start
                            exact_end_value = date_constraints.adjusted_end or adjusted_end
                            period_label = "Exact range"
                        else:
                            period, notice_resolve = resolve_effective_period_for_many(period, datasets)
                            if notice_resolve and notice is None:
                                notice = notice_resolve
                            elif notice_resolve:
                                notice = (notice or "") + " " + notice_resolve
                            common_end_date = min(dataset["Date"].max() for dataset in datasets)
                            sliced_datasets = [slice_dataset_for_period(dataset, period, common_end_date) for dataset in datasets]
                            aligned_datasets = align_datasets_on_common_dates(sliced_datasets)
                            exact_start_value = aligned_datasets[0]["Date"].min().strftime("%Y-%m-%d")
                            exact_end_value = aligned_datasets[0]["Date"].max().strftime("%Y-%m-%d")
                            period_label = format_period_label(period)

                        colors = build_series_colors(len(validated_tickers), theme["accent_primary"], theme["accent_secondary"])
                        if current_view == "portfolio":
                            ensure_positive_portfolio_weights(requested_weights, len(validated_tickers))
                            portfolio_weights = normalize_portfolio_weights(requested_weights, len(validated_tickers))
                            growth_multipliers = build_portfolio_growth_multipliers(aligned_datasets)
                            portfolio_series = build_portfolio_series_payload(
                                aligned_datasets,
                                portfolio_weights,
                                theme["accent_primary"],
                            )
                            benchmark_series, benchmark_profiles = build_benchmark_series_payloads(
                                aligned_datasets[0]["Date"],
                                include_dividends,
                            )
                            series = [portfolio_series, *benchmark_series]
                            profiles = [*profiles, *benchmark_profiles]
                            portfolio_total_return = portfolio_series.normalized_returns[-1]
                            portfolio_items = [
                                {
                                    "ticker": ticker,
                                    "company_name": profile.company_name,
                                    "logo_url": profile.logo_url,
                                    "weight": weight,
                                    "growth_multiple": growth_multiple,
                                    "color": color,
                                }
                                for ticker, profile, weight, growth_multiple, color in zip(
                                    validated_tickers,
                                    profiles[: len(validated_tickers)],
                                    portfolio_weights,
                                    growth_multipliers,
                                    colors,
                                )
                            ]
                        else:
                            series = [
                                build_series_payload(ticker, dataset, color=color)
                                for ticker, dataset, color in zip(validated_tickers, aligned_datasets, colors)
                            ]
                        best_return = max(item.normalized_returns[-1] for item in series)
                        common_start = aligned_datasets[0]["Date"].min()
                        common_end = aligned_datasets[0]["Date"].max()
                        display_range = f"{format_display_date(common_start)} - {format_display_date(common_end)}"
                        if current_view != "portfolio":
                            performance_items = [
                                {
                                    "ticker": item.ticker,
                                    "company_name": profile.company_name,
                                    "logo_url": profile.logo_url,
                                    "ending_return": item.normalized_returns[-1],
                                    "color": item.color,
                                    "shadow_color": hex_to_rgba(item.color or theme["accent_primary"], 0.22),
                                    "is_winner": item.normalized_returns[-1] == best_return,
                                }
                                for item, profile in zip(series, profiles)
                            ]
                        ticker_slots = validated_tickers.copy()
                        record_ticker_usage(validated_tickers)
        except Exception as exc:  # noqa: BLE001
            error = str(exc) or None
            if should_use_modal_banner_message(error):
                floating_banner_icon_class = modal_banner_icon_class(error)

        remote_market_access = True
        remote_logo_access = False

        if current_view != "settings" and not error and not notice:
            requires_remote_probe = any(
                not history_store_path_for(ticker).exists()
                for ticker in validated_tickers
            )
            if requires_remote_probe:
                remote_market_access = has_remote_market_access()
                if not remote_market_access:
                    notice = "Using bundled local market_store data because remote market access is unavailable."

        top_tickers = []
        timing_selected_ticker = ""
        timing_metrics = []
        timing_summary = []
        timing_market = {}
        timing_error = ""

        if current_view == "settings":
            if settings_section in {"general", "email-smtp", "broker-access", "local-market-store", "clear-caches"} and (notice or error):
                floating_banner_icon_class = modal_banner_icon_class(error or notice)
            settings_service_rows = build_network_service_rows(pending=settings_section == "network")
            strategy_settings_rows = build_strategy_settings_rows(strategy_options)
            font_token_rows = build_font_token_rows()
            style_token_rows = build_style_token_rows()
            material_token_rows = build_material_token_rows()
            if settings_section == "local-market-store":
                all_local_market_tickers = list_local_market_tickers()
                local_store_current_page = local_store_page_value()
                local_store_total_pages = max((len(all_local_market_tickers) - 1) // LOCAL_STORE_PAGE_SIZE + 1, 1)
                local_store_current_page = min(local_store_current_page, local_store_total_pages)
                local_store_prev_slot, local_store_page_slots, local_store_next_slot = build_local_store_pagination_slots(
                    local_store_current_page,
                    local_store_total_pages,
                )
                start_index = (local_store_current_page - 1) * LOCAL_STORE_PAGE_SIZE
                end_index = start_index + LOCAL_STORE_PAGE_SIZE
                local_market_rows = build_local_market_rows_for_tickers(
                    all_local_market_tickers[start_index:end_index],
                    include_ranges=True,
                )
        elif current_view == "more":
            top_tickers = []
            timing_selected_ticker = ""
            timing_metrics = []
            timing_summary = []
            timing_error = ""
            timing_market = {}
            usage_path = TICKER_USAGE_STORE_PATH
            if usage_path.exists():
                import json
                with usage_path.open("r", encoding="utf-8") as f:
                    usage_data = json.load(f)
                sorted_tickers = sorted(
                    usage_data.items(),
                    key=lambda item: item[1].get("count", 0),
                    reverse=True,
                )
                for ticker, item in sorted_tickers:
                    count = item.get("count", 0)
                    if count <= 0:
                        continue
                    profile_snapshot = load_local_profile_snapshot(ticker)
                    company_name = profile_snapshot[0] if profile_snapshot else ticker
                    logo_url = profile_snapshot[1] if profile_snapshot else ""
                    top_tickers.append(
                        {
                            "ticker": ticker,
                            "count": count,
                            "company_name": company_name,
                            "logo_url": logo_url,
                            "url": build_more_timing_url(ticker),
                        }
                    )
                    if len(top_tickers) >= 50:
                        break
            timing_selected_ticker = normalize_ticker_input(request.args.get("ticker", "MU")) or "MU"
            if top_tickers and timing_selected_ticker not in {item["ticker"] for item in top_tickers}:
                timing_selected_ticker = top_tickers[0]["ticker"]
            try:
                tradingview_settings = settings.get("integrations", {}).get("tradingview_ta", {})
                default_screener = str(tradingview_settings.get("default_screener", "america"))
                default_exchange = str(tradingview_settings.get("default_exchange", "NASDAQ"))
                profile_record = load_profile_record(timing_selected_ticker) or {}
                selected_screener = str(
                    profile_record.get("tradingview_screener")
                    or default_screener
                )
                selected_exchange = str(
                    profile_record.get("tradingview_exchange")
                    or default_exchange
                )
                analysis = fetch_tradingview_metrics(
                    timing_selected_ticker,
                    screener=selected_screener,
                    exchange=selected_exchange,
                )
                summary = analysis.get("summary", {}) or {}
                oscillators = (analysis.get("oscillators", {}) or {}).get("COMPUTE", {}) or {}
                moving_averages = (analysis.get("moving_averages", {}) or {}).get("COMPUTE", {}) or {}
                indicators = analysis.get("indicators", {}) or {}
                timing_market = {
                    "exchange": str(analysis.get("exchange", "NASDAQ")),
                    "screener": str(analysis.get("screener", "america")),
                }
                timing_summary = [
                    {"label": "Recommendation", "value": str(summary.get("RECOMMENDATION", "N/A"))},
                    {"label": "Buy", "value": str(summary.get("BUY", "0"))},
                    {"label": "Neutral", "value": str(summary.get("NEUTRAL", "0"))},
                    {"label": "Sell", "value": str(summary.get("SELL", "0"))},
                ]

                def format_metric_value(value: object) -> str:
                    if isinstance(value, bool):
                        return "True" if value else "False"
                    if isinstance(value, int):
                        return f"{value:,}" if abs(value) >= 1000 else str(value)
                    if isinstance(value, float):
                        if value.is_integer():
                            integer_value = int(value)
                            return f"{integer_value:,}" if abs(integer_value) >= 1000 else str(integer_value)
                        return f"{value:,.2f}"
                    return str(value)

                preferred_metric_keys = [
                    "close",
                    "open",
                    "volume",
                    "RSI",
                    "RSI[1]",
                    "Stoch.K",
                    "Stoch.D",
                    "CCI20",
                    "ADX",
                    "AO",
                    "Mom",
                    "MACD.macd",
                    "MACD.signal",
                    "Rec.Stoch.RSI",
                    "Rec.WR",
                    "Rec.BBPower",
                    "EMA5",
                    "EMA10",
                    "EMA20",
                    "EMA30",
                    "EMA50",
                    "EMA100",
                    "EMA200",
                    "SMA10",
                    "SMA20",
                    "SMA50",
                    "SMA100",
                    "SMA200",
                    "VWMA",
                    "HullMA9",
                    "Pivot.M.Classic.S1",
                    "Pivot.M.Classic.R1",
                    "BB.lower",
                    "BB.upper",
                ]
                metric_rows = []
                for key in preferred_metric_keys:
                    if key not in indicators:
                        continue
                    value = indicators.get(key)
                    metric_rows.append({"label": key, "value": format_metric_value(value)})
                for key, value in oscillators.items():
                    metric_rows.append({"label": f"Oscillator · {key}", "value": format_metric_value(value)})
                for key, value in moving_averages.items():
                    metric_rows.append({"label": f"Moving average · {key}", "value": format_metric_value(value)})
                seen_labels = set()
                deduped_metric_rows = []
                for row in metric_rows:
                    if row["label"] in seen_labels:
                        continue
                    seen_labels.add(row["label"])
                    deduped_metric_rows.append(row)
                timing_metrics = deduped_metric_rows
            except Exception as exc:
                timing_error = str(exc)

        if current_view == "backtest":
            ticker_slots = ticker_slots[:1] if ticker_slots else [""]
        else:
            while len(ticker_slots) < MIN_TICKERS:
                ticker_slots.append("")
        if current_view == "portfolio":
            if not portfolio_weights and any(ticker_slots):
                portfolio_weights = build_default_weights(len([ticker for ticker in ticker_slots if ticker]))
            while len(portfolio_weights) < len(ticker_slots):
                portfolio_weights.append(0)

        template_name = {
            "tickers": "compare.html",
            "portfolio": "portfolio.html",
            "backtest": "backtest.html",
            "more": "investment.html" if more_section == "investment" else "more.html",
            "settings": "settings.html",
        }[current_view]

        response = make_response(render_template(
            template_name,
            error=error,
            notice=notice,
            floating_banner_icon_class=floating_banner_icon_class,
            period=period,
            period_label=period_label,
            display_range=display_range,
            periods=supported_periods,
            period_labels={item: format_period_label(item) for item in supported_periods},
            series=series,
            profiles_json=[asdict(profile) for profile in profiles],
            performance_items=performance_items,
            portfolio_items=portfolio_items,
            portfolio_weights=portfolio_weights,
            portfolio_total_return=portfolio_total_return,
            ticker_slots=ticker_slots,
            max_tickers=MAX_TICKERS,
            min_tickers=MIN_TICKERS,
            include_dividends=include_dividends,
            range_mode=range_mode,
            exact_start=exact_start_value,
            exact_end=exact_end_value,
            version=app_meta.get("version", CODE_VERSION),
            updated_on=app_meta.get("updated_on", ""),
            current_view=current_view,
            settings_section=settings_section,
            more_section=more_section,
            top_tickers=top_tickers,
            timing_selected_ticker=timing_selected_ticker,
            timing_metrics=timing_metrics,
            timing_summary=timing_summary,
            timing_market=timing_market,
            timing_error=timing_error,
            remote_market_access=remote_market_access,
            settings_title=settings_title,
            settings_service_rows=settings_service_rows,
            strategy_settings_rows=strategy_settings_rows,
            font_token_rows=font_token_rows,
            style_token_rows=style_token_rows,
            material_token_rows=material_token_rows,
            backtest_execution_mode=backtest_execution_mode,
            broker_settings=broker_settings,
            broker_test_status=broker_test_status,
            broker_test_message=broker_test_message,
            broker_test_checked_at=broker_test_checked_at,
            local_market_rows=local_market_rows,
            local_store_current_page=local_store_current_page,
            local_store_page_size=LOCAL_STORE_PAGE_SIZE,
            local_store_total_pages=local_store_total_pages,
            local_store_prev_slot=local_store_prev_slot,
            local_store_page_slots=local_store_page_slots,
            local_store_next_slot=local_store_next_slot,
            page_title=page_title,
            report_heading=report_heading,
            chart_heading=chart_heading,
            dock_urls={view_name: build_view_url(view_name) for view_name in ("tickers", "portfolio", "backtest", "more", "settings")},
            settings_urls={section_name: build_settings_url(section_name) for section_name in
                           ("about", "general", "font-tokens", "material-tokens", "network", "strategies", "email-smtp", "broker-access", "local-market-store", "clear-caches",
                            "style-tokens")},
            more_urls={section_name: build_more_url(section_name) for section_name in ("timing", "investment")},
            local_store_page_urls={page_number: build_local_store_page_url(page_number) for page_number in range(1, local_store_total_pages + 1)},
            labels=labels,
            theme=theme,
            theme_light=theme_light,
            theme_dark=theme_dark,
            chart_config=chart_config,
            logos=logos,
            defaults=defaults,
            smtp_settings=smtp_settings,
            strategy_options=strategy_options,
            strategy_option_groups=strategy_option_groups,
            selected_strategy_id=selected_strategy_id,
            strategy_form_fields=strategy_form_fields,
            selected_strategy_params=selected_strategy_params,
            backtest_initial_capital=backtest_initial_capital,
            backtest_result=backtest_result,
            backtest_periods_by_interval=backtest_periods_by_interval,
            supported_intervals=supported_intervals,
            requested_interval=requested_interval,
            current_view_name=current_view,
            current_path=request.path,
            endpoints={
                "symbolSearch": "/api/symbol-search",
                "dateConstraints": "/api/date-constraints",
                "strategyFields": "/api/trade-strategy-fields",
                "settingsNetworkStatus": "/api/settings/network-status",
                "localStorePageData": "/api/settings/local-market-store/page-data",
                "marketStorePresence": "/api/market-store/presence",
            },
        ))
        if current_view == "settings":
            response.delete_cookie(SETTINGS_FEEDBACK_COOKIE, path="/settings")
        return response

    def export_transactions_api():
        try:
            # Re-run backtest to get the full transaction list
            backtest_result, trade_ticker, requested_interval, date_constraints, trade_dataset, strategy_id, strategy_params = _run_backtest_from_request()

            summary = backtest_result.get("summary", {})
            trades = backtest_result.get("trades", [])
            if not trades:
                return "No transactions to export.", 404

            strategy_definition = get_strategy_definition(strategy_id)
            # 0. Context for Filename
            start_str = trade_dataset["Date"].min().strftime("%Y%m%d")
            end_str = trade_dataset["Date"].max().strftime("%Y%m%d")
            strategy_name = strategy_definition.get('name', strategy_id)
            report_filename = f"{trade_ticker} Backtest Report {start_str} - {end_str} ({strategy_name}).md"
            period_start = pd.to_datetime(trade_dataset["Date"].min())
            period_end = pd.to_datetime(trade_dataset["Date"].max())
            period_label = f"{period_start.day} {period_start.strftime('%b %Y')} - {period_end.day} {period_end.strftime('%b %Y')}"
            dataset_export_date_format = "%Y-%m-%d %H:%M" if requested_interval == "1m" else "%Y-%m-%d"
            market_data_csv = trade_dataset.to_csv(index=False, date_format=dataset_export_date_format).rstrip()

            # 1. Performance Summary
            benchmark_alpha = float(summary.get("benchmark_alpha", 0) or 0)
            long_gain = float(summary.get("long_gain", 0) or 0)
            short_gain = float(summary.get("short_gain", 0) or 0)
            long_loss = float(summary.get("long_loss", 0) or 0)
            beat_bh_pct = float(summary.get("beat_bh_pct", 0) or 0)
            win_rate_pct = summary.get("win_rate_pct")
            win_rate_display = "N/A" if win_rate_pct is None else f"{float(win_rate_pct):,.2f}%"

            md_lines = [
                f"## Backtest Report: {trade_ticker}",
                f"**Generated on**: {pd.Timestamp.now().strftime('%d %b %Y %H:%M:%S HKT')}",
                f"**Algorithm**: {strategy_name}",
                f"**Period**: {period_label}",
                "",
                "### Performance Summary",
                f"- **Initial capital**: ${summary.get('initial_capital', 0):,.2f}",
                f"- **Final equity**: ${summary.get('final_equity', 0):,.2f}",
                f"- **Net return**: {summary.get('net_return_pct', 0):,.2f}%",
                f"- **Total trades**: {summary.get('total_trades', 0)}",
                f"- **Win rate**: {win_rate_display}",
                f"- **Beat B&H**: {beat_bh_pct:,.2f}%",
                f"- **Alpha vs B&H**: {'+' if benchmark_alpha >= 0 else '-'}${abs(benchmark_alpha):,.2f}",
                f"- **Realized long P&L**: {'+' if long_gain >= 0 else '-'}${abs(long_gain):,.2f}",
                f"- **Realized short P&L**: {'+' if short_gain >= 0 else '-'}${abs(short_gain):,.2f}",
                f"- **Realized long loss**: {'-' if long_loss > 0 else '+'}${abs(long_loss):,.2f}",
                "",
            ]

            # 2. Transaction Details
            md_lines.extend([
                "### Transaction History",
                "",
                "| No. | Date | Side | Price | Shares | P&L | Cash | Equity |",
                "| ---: | :--- | :--- | ---: | ---: | ---: | ---: | ---: |"
            ])
            for i, trade in enumerate(trades):
                if trade.get("_virtual_close"):
                    continue  # Skip virtual closing trade, same as table display
                trade_date = pd.to_datetime(trade.get('date')).strftime('%Y/%m/%d %H:%M') if trade.get('date') else "N/A"
                md_lines.append(
                    f"| {i + 1} | {trade_date} | {trade.get('side')} | "
                    f"{trade.get('price', 0):,.2f} | {trade.get('shares', 0):,.0f} | "
                    f"{trade.get('pnl', 0):,.2f} | {trade.get('cash', 0):,.2f} | {trade.get('equity', 0):,.2f} |"
                )

            # 3. Strategy Context
            md_lines.extend([
                "",
                "### Strategy Context",
                "",
                "#### Parameters",
                "",
                "| Parameter | Value |",
                "| :--- | :--- |"
            ])
            for key, val in strategy_params.items():
                md_lines.append(f"| {key} | {val} |")

            # Read Strategy Code
            try:
                module_name = strategy_definition.get("module", "")
                if module_name:
                    file_name = module_name.split(".")[-1] + ".py"
                    algo_path = Path(__file__).resolve().parent.parent / "strategies" / "algorithms" / file_name
                    if algo_path.exists():
                        with open(algo_path, "r", encoding="utf-8") as f:
                            strategy_code = f.read()
                        md_lines.extend([
                            "",
                            "#### Strategy Implementation",
                            "```python",
                            strategy_code,
                            "```",
                            ""
                        ])
            except Exception as e:
                md_lines.append(f"\n*(Failed to load strategy source: {str(e)})*")

            # 4. LLM Strategy Developer Prompt
            md_lines.extend([
                "",
                "### LLM Strategy Developer Prompt",
                "",
                "*Copy and paste the prompt below into any SOTA LLMs to recreate or iterate on this strategy.*",
                "",
                "````",
                "You are an elite quantitative trading developer and Python engineer. Your task is to write a trading strategy plugin for the `antigravity` trading system.",
                "",
                "The user will provide a trading logic or indicator concept. You must output a fully functional, production-ready Python file named `strategy_{strategy_id}.py` that acts as a drop-in component for the `strategies/algorithms/` directory.",
                "",
                "### Core Architecture & Constraints",
                "",
                "1. **Imports & Inheritance**:",
                "   - Must include `from __future__ import annotations` at the very top.",
                "   - Must import `import pandas as pd` and `import numpy as np`.",
                "   - Must import: `from ..base import BaseStrategy, StrategyParameterDefinition, StrategySignalResult, StrategySupportMatrix`.",
                "   - The strategy class must inherit from `BaseStrategy`.",
                "",
                "2. **Class Metadata (Class Attributes)**:",
                "   Every strategy must define the following class-level attributes exactly:",
                "   - `strategy_id` (str): Unique snake_case identifier (e.g., \"macd\", \"rsi_reversion\").",
                "   - `strategy_name` (str): Human-readable name for the UI.",
                "   - `strategy_description` (str): Clear, concise description of the logic.",
                "   - `strategy_category` (str): Must be one of: \"trend\", \"momentum\", \"mean_reversion\", \"volatility\", \"volume\", or \"machine_learning\".",
                "   - `strategy_display_order` (int): An integer (10-90) indicating UI sorting priority.",
                "   - `strategy_supports` (StrategySupportMatrix): Usually `StrategySupportMatrix(single_ticker=True, multi_ticker=False, long_only=True, short=False)`.",
                "",
                "3. **Parameter Definitions (`get_parameter_definitions`)**:",
                "   Override `def get_parameter_definitions(self) -> tuple[StrategyParameterDefinition, ...]:` to declare all user-configurable parameters.",
                "   Supported kwargs for `StrategyParameterDefinition`: `key`, `label`, `kind` (\"integer\", \"number\", \"boolean\", \"choice\", \"string\"), `default`, `minimum`, `maximum`, `step`, `options`, `help_text`, `unit_hint`.",
                "",
                "4. **Signal Computation (`compute_signals`)**:",
                "   Override `def compute_signals(self, dataset: pd.DataFrame, params: dict | None = None) -> StrategySignalResult:`.",
                "   - **CRITICAL**: Never modify `dataset` in-place. Always start with `frame = dataset.copy()`.",
                "   - **CRITICAL**: Always normalize parameters first via `normalized_params = self.normalize_params(params)`.",
                "   - Extract your parameters with explicit type casting.",
                "   - Compute your indicators using vectorized pandas operations. Avoid loops for performance unless mathematically required.",
                "   - Create exactly two boolean signal columns: `\"buy_signal\"` and `\"sell_signal\"`.",
                "   - **CRITICAL**: Use `.fillna(False)` on signal columns.",
                "   - Return: `return StrategySignalResult(frame=frame, buy_signal_column=\"buy_signal\", sell_signal_column=\"sell_signal\")`.",
                "",
                "5. **Output Format**:",
                "   - Provide ONLY the Python code block. No surrounding markdown explanations.",
                "   - The code must be pristine, strictly typed (Python 3.10+), and adhere to standard Black formatting.",
                "",
                "### Gold Standard Reference (MACD Strategy)",
                "```python",
                "from __future__ import annotations",
                "import pandas as pd",
                "from ..base import BaseStrategy, StrategyParameterDefinition, StrategySignalResult, StrategySupportMatrix",
                "",
                "class MacdStrategy(BaseStrategy):",
                "    strategy_id = \"macd\"",
                "    strategy_name = \"MACD\"",
                "    strategy_description = \"MACD crossover strategy using default settings.\"",
                "    strategy_category = \"momentum\"",
                "    strategy_display_order = 20",
                "    strategy_supports = StrategySupportMatrix(single_ticker=True, multi_ticker=False, long_only=True, short=False)",
                "",
                "    def get_parameter_definitions(self) -> tuple[StrategyParameterDefinition, ...]:",
                "        return (",
                "            StrategyParameterDefinition(key=\"fast_span\", label=\"Fast EMA\", kind=\"integer\", default=12, minimum=1),",
                "            StrategyParameterDefinition(key=\"slow_span\", label=\"Slow EMA\", kind=\"integer\", default=26, minimum=2),",
                "            StrategyParameterDefinition(key=\"signal_span\", label=\"Signal EMA\", kind=\"integer\", default=9, minimum=1),",
                "        )",
                "",
                "    def compute_signals(self, dataset: pd.DataFrame, params: dict | None = None) -> StrategySignalResult:",
                "        frame = dataset.copy()",
                "        normalized_params = self.normalize_params(params)",
                "        fast_span, slow_span, signal_span = int(normalized_params[\"fast_span\"]), int(normalized_params[\"slow_span\"]), int(normalized_params[\"signal_span\"])",
                "        ema_fast = frame[\"Close\"].ewm(span=fast_span, adjust=False).mean()",
                "        ema_slow = frame[\"Close\"].ewm(span=slow_span, adjust=False).mean()",
                "        frame[\"macd_line\"] = ema_fast - ema_slow",
                "        frame[\"signal_line\"] = frame[\"macd_line\"].ewm(span=signal_span, adjust=False).mean()",
                "        frame[\"buy_signal\"] = ((frame[\"macd_line\"] > frame[\"signal_line\"]) & (frame[\"macd_line\"].shift(1) <= frame[\"signal_line\"].shift(1))).fillna(False)",
                "        frame[\"sell_signal\"] = ((frame[\"macd_line\"] < frame[\"signal_line\"]) & (frame[\"macd_line\"].shift(1) >= frame[\"signal_line\"].shift(1))).fillna(False)",
                "        return StrategySignalResult(frame=frame, buy_signal_column=\"buy_signal\", sell_signal_column=\"sell_signal\")",
                "```",
                "````",
            ])

            # 5. Source market data
            md_lines.extend([
                "### Source market data",
                "",
                "```text",
                market_data_csv,
                "```",
                ""
            ])

            md_content = "\n".join(md_lines)

            return send_file(
                BytesIO(md_content.encode("utf-8")),
                mimetype='text/markdown',
                as_attachment=True,
                download_name=report_filename
            )
        except Exception as exc:
            return str(exc), 500

    def root():
        legacy_view = request.args.get("view")
        if request.args:
            target_view = resolve_view() if legacy_view else "tickers"
            target_section = resolve_settings_section() if target_view == "settings" else "about"
            target_path = build_settings_path(target_section) if target_view == "settings" else build_view_path(target_view)
            query_string = urlencode(build_modern_query_pairs(), doseq=True)
            return redirect(f"{target_path}?{query_string}" if query_string else target_path)
        return redirect(build_view_path("tickers"))

    def compare_page():
        return render_workspace_page("tickers")

    def portfolio_page():
        return render_workspace_page("portfolio")

    def backtest_page():
        return render_workspace_page("backtest")

    def legacy_trade_messages_page():
        query_string = request.query_string.decode().strip()
        target_path = build_view_path("backtest")
        return redirect(f"{target_path}?{query_string}" if query_string else target_path)

    def more_root():
        return redirect(build_more_path("timing"))

    def more_page(section_name: str):
        normalized_section = normalize_more_section(section_name)
        if normalized_section != (section_name or "").strip().lower():
            return redirect(build_more_path(normalized_section))
        return render_workspace_page("more", more_section=normalized_section)

    def settings_root():
        return redirect(build_settings_path("about"))

    def settings_page(section_name: str):
        return render_workspace_page("settings", section_name)

    def general_settings_action():
        current_mode = load_backtest_execution_mode()
        selected_mode = save_backtest_execution_mode(request.form.get("backtest_execution_mode", "next_open"))
        selected_label = "Signal bar close" if selected_mode == "signal_close" else "Next bar open"
        notice = f"Backtest execution model updated: {selected_label}." if selected_mode != current_mode else ""
        return _redirect_with_settings_feedback("general", notice=notice)

    def email_smtp_action():
        action = request.form.get("action", "save").strip().lower()
        current_settings = load_smtp_settings()
        mailbox = request.form.get("from_email", current_settings.from_email or current_settings.username).strip()
        updated_settings = SmtpSettings(
            host=request.form.get("host", current_settings.host).strip() or current_settings.host,
            port=max(parse_int_value(request.form.get("port"), current_settings.port), 1),
            username=mailbox,
            password=request.form.get("password", ""),
            from_email=mailbox,
            use_starttls=request.form.getlist("use_starttls")[-1] == "1" if request.form.getlist("use_starttls") else False,
            oauth_client_id=request.form.get("oauth_client_id", current_settings.oauth_client_id).strip(),
            oauth_tenant=request.form.get("oauth_tenant", current_settings.oauth_tenant).strip(),
            oauth_access_token=current_settings.oauth_access_token,
            oauth_refresh_token=current_settings.oauth_refresh_token,
            oauth_token_expires_at=current_settings.oauth_token_expires_at,
            oauth_device_code=current_settings.oauth_device_code,
            oauth_user_code=current_settings.oauth_user_code,
            oauth_verification_uri=current_settings.oauth_verification_uri,
            oauth_verification_uri_complete=current_settings.oauth_verification_uri_complete,
            oauth_device_expires_at=current_settings.oauth_device_expires_at,
            oauth_device_interval_seconds=current_settings.oauth_device_interval_seconds,
        )
        if not updated_settings.password:
            updated_settings.password = current_settings.password
        if (
                updated_settings.oauth_client_id != current_settings.oauth_client_id
                or updated_settings.oauth_tenant != current_settings.oauth_tenant
                or updated_settings.from_email != current_settings.from_email
        ):
            updated_settings.oauth_access_token = ""
            updated_settings.oauth_refresh_token = ""
            updated_settings.oauth_token_expires_at = 0.0
            updated_settings.oauth_device_code = ""
            updated_settings.oauth_user_code = ""
            updated_settings.oauth_verification_uri = ""
            updated_settings.oauth_verification_uri_complete = ""
            updated_settings.oauth_device_expires_at = 0.0
            updated_settings.oauth_device_interval_seconds = 5.0
        save_smtp_settings(updated_settings)
        if action == "start-oauth":
            updated_settings, success, message = start_outlook_oauth_device_flow(updated_settings)
            save_smtp_settings(updated_settings)
        elif action == "finish-oauth":
            updated_settings, success, message = finish_outlook_oauth_device_flow(updated_settings)
            save_smtp_settings(updated_settings)
        elif action == "test":
            success, message, updated_settings = test_smtp_connection(updated_settings)
            save_smtp_settings(updated_settings)
        else:
            success, message = True, f"SMTP settings saved. {build_oauth_settings_message(updated_settings)}"
        return _redirect_with_settings_feedback(
            "email-smtp",
            notice=message if success else "",
            error="" if success else message,
        )

    def broker_access_action():
        current_settings = load_broker_settings()
        selected_broker = str(
            request.form.get("selected_broker", current_settings.selected_broker)
        ).strip().lower() or "longbridge"
        updated_settings = BrokerSettings(
            selected_broker=selected_broker,
            longbridge_app_key=str(request.form.get("longbridge_app_key", "")).strip() or current_settings.longbridge_app_key,
            longbridge_app_secret=str(request.form.get("longbridge_app_secret", "")).strip() or current_settings.longbridge_app_secret,
            longbridge_access_token=str(request.form.get("longbridge_access_token", "")).strip() or current_settings.longbridge_access_token,
        )
        save_broker_settings(updated_settings)
        action = request.form.get("action", "save")
        if action == "test":
            success, message = test_broker_connection(updated_settings)
            checked_at = datetime.now().astimezone()
            checked_at_label = f"{checked_at.day} {checked_at.strftime('%b %Y %H:%M:%S %Z')}"
            return _redirect_with_settings_feedback(
                "broker-access",
                broker_test_status="success" if success else "error",
                broker_test_message=message,
                broker_test_checked_at=checked_at_label,
            )
        else:
            notice = (
                "Broker credentials were saved only on this device. "
                "This project is open source, and the developer cannot retrieve your local secrets."
            )
            return _redirect_with_settings_feedback("broker-access", notice=notice)

    def local_market_store_action():
        ticker = normalize_ticker_input(request.form.get("ticker", ""))
        action = request.form.get("action", "").strip().lower()
        page = max(parse_int_value(request.form.get("page", request.form.get("local_page")), 1), 1)
        base_path = build_settings_path("local-market-store")

        def build_local_store_redirect(**extra_params: str) -> str:
            params = {"page": page, **extra_params}
            return f"{base_path}?{urlencode(params)}"

        redirect_url = build_local_store_redirect()

        try:
            if action == "maintain":
                maintenance = maintain_local_market_store()
                total_count = int(maintenance["total_count"])
                history_refreshed_count = int(maintenance["history_refreshed_count"])
                metadata_refreshed_count = int(maintenance["metadata_refreshed_count"])
                metadata_blocked_count = int(maintenance["metadata_blocked_count"])
                history_failed_tickers = list(maintenance["history_failed_tickers"])
                if history_failed_tickers and history_refreshed_count == 0:
                    failed_preview = ", ".join(history_failed_tickers[:3])
                    return _redirect_with_settings_feedback(
                        "local-market-store",
                        error=f"Unable to refresh historical market data for {failed_preview}.",
                    )

                notice_parts: list[str] = []
                if total_count == 0:
                    notice = "Local Market Store is already up to date."
                    return _redirect_with_settings_feedback("local-market-store", notice=notice)

                if history_refreshed_count > 0:
                    notice_parts.append(
                        f"Updated {history_refreshed_count:,} historical parquet dataset"
                        f"{'' if history_refreshed_count == 1 else 's'}."
                    )
                if metadata_refreshed_count > 0:
                    notice_parts.append(
                        f"Refreshed {metadata_refreshed_count:,} logo and company profile entr"
                        f"{'y' if metadata_refreshed_count == 1 else 'ies'}."
                    )
                if metadata_blocked_count > 0:
                    notice_parts.append(
                        f"Yahoo blocked {metadata_blocked_count:,} metadata refresh request"
                        f"{'' if metadata_blocked_count == 1 else 's'}, so cached logos and profiles were kept."
                    )
                if history_failed_tickers:
                    failed_count = len(history_failed_tickers)
                    preview = ", ".join(history_failed_tickers[:3])
                    notice_parts.append(
                        f"{failed_count:,} historical dataset"
                        f"{'' if failed_count == 1 else 's'} could not be refreshed yet"
                        f"{': ' + preview if preview else '.'}"
                    )
                notice = " ".join(part.rstrip(".") + "." for part in notice_parts if part)
                return _redirect_with_settings_feedback("local-market-store", notice=notice)
            if not ticker:
                return redirect(redirect_url, code=303)
            if action == "refresh":
                refresh_history_store(ticker)
                try:
                    fetch_quote_profile(ticker, force_refresh=True)
                except Exception:
                    try:
                        fetch_quote_profile(ticker, force_refresh=False)
                    except Exception:
                        pass
                notice = f"Saved the latest daily market data for {ticker} to local cache."
                return _redirect_with_settings_feedback("local-market-store", notice=notice)
            elif action == "refresh-1m":
                broker_settings = load_broker_settings()
                if broker_settings.selected_broker == "longbridge" and has_longbridge_credentials(broker_settings):
                    refresh_longbridge_one_minute_store(ticker, broker_settings)
                    notice = f"Saved the latest 6 months of 1-minute market data for {ticker} to local cache (via Longbridge)."
                else:
                    from app.services.market_data import download_full_history, normalize_history_frame
                    from app.infrastructure.storage import intraday_history_store_path_for

                    history = download_full_history(ticker, interval="1m")
                    normalized_dataset = normalize_history_frame(history, ticker, interval="1m")
                    path = intraday_history_store_path_for(ticker, "1m")
                    normalized_dataset.to_parquet(path, index=False)
                    notice = f"Saved the latest month of 1-minute market data for {ticker} to local cache (yfinance fallback)."
                return _redirect_with_settings_feedback("local-market-store", notice=notice)
            elif action == "delete":
                delete_ticker_data(ticker)
                notice = f"Removed all cached data for {ticker} from local storage."
                return _redirect_with_settings_feedback("local-market-store", notice=notice)
        except Exception as exc:  # noqa: BLE001
            message = str(exc).strip() or f"Unable to update local cache for {ticker}."
            return _redirect_with_settings_feedback("local-market-store", error=message)

        return redirect(redirect_url, code=303)

    def settings_cache_action():
        section_name = normalize_settings_section(request.form.get("section", "clear-caches"))
        action = str(request.form.get("action", "market-data")).strip().lower() or "market-data"
        try:
            if action == "investment-transactions":
                if INVESTMENT_STORE_PATH.exists():
                    INVESTMENT_STORE_PATH.unlink()
                    notice = "Cleared the local broker transaction record stored in settings_store/investment.json."
                else:
                    notice = "No local broker transaction record was found in settings_store/investment.json."
            else:
                cache_summary = clear_nonhistorical_market_cache()
                reset_connectivity_caches()
                notice = (
                    f"Cleared {cache_summary['removed_search_queries']:,} market search cache entr"
                    f"{'y' if cache_summary['removed_search_queries'] == 1 else 'ies'}, "
                    f"{cache_summary['removed_profiles']:,} non-local market profile entr"
                    f"{'y' if cache_summary['removed_profiles'] == 1 else 'ies'}, "
                    f"{cache_summary['removed_logos']:,} non-local market logo image"
                    f"{'' if cache_summary['removed_logos'] == 1 else 's'}. "
                    f"Protected {cache_summary['protected_tickers']:,} Local Market Store ticker entr"
                    f"{'y' if cache_summary['protected_tickers'] == 1 else 'ies'}, "
                    f"kept {cache_summary['protected_search_queries']:,} matching market search cache entr"
                    f"{'y' if cache_summary['protected_search_queries'] == 1 else 'ies'}, "
                    "and left ticker usage records untouched."
                )
            return _redirect_with_settings_feedback(section_name, notice=notice)
        except Exception as exc:  # noqa: BLE001
            message = str(exc).strip() or "Unable to clear cached settings data."
            return _redirect_with_settings_feedback(section_name, error=message)

    def market_store_logo(filename: str):
        candidate = LOGOS_STORE_DIR / filename
        if candidate.exists():
            return send_from_directory(LOGOS_STORE_DIR, filename)
        return ("Not Found", 404)

    def symbol_search():
        query = normalize_ticker_input(request.args.get("q", ""))
        limit = min(max(parse_int_value(request.args.get("limit"), 5), 1), 5)
        if not query:
            return jsonify(search_tickers("", limit=limit))
        return jsonify([] if not has_valid_ticker_format(query) else search_tickers(query, limit=limit))

    def date_constraints_api():
        requested_tickers = parse_requested_tickers()
        requested_view = request.args.get("view", request.args.get("mode", "tickers")).strip().lower()
        requested_view = LEGACY_VIEW_ALIASES.get(requested_view, requested_view)
        minimum_required = 1 if requested_view == "backtest" else MIN_TICKERS
        if len(requested_tickers) < minimum_required:
            return jsonify(asdict(build_date_constraint_payload()))
        validated_tickers = [validate_ticker_or_raise(ticker) for ticker in requested_tickers]
        if len(set(validated_tickers)) != len(validated_tickers):
            return jsonify(asdict(build_date_constraint_payload()))
        include_dividends = request.args.get("dividends", request.args.get("include_dividends", "0")) == "1"
        requested_start = request.args.get("from", request.args.get("exact_start", "")).strip() or None
        requested_end = request.args.get("to", request.args.get("exact_end", "")).strip() or None
        datasets = [fetch_history(ticker, include_dividends) for ticker in validated_tickers]
        payload = build_date_constraint_payload(*datasets, requested_start=requested_start, requested_end=requested_end)
        return jsonify(asdict(payload))

    def trade_strategy_fields_api():
        strategy_id = request.args.get("strategy", "").strip()
        if not strategy_id:
            return jsonify({"is_tunable": False, "html": ""})

        strategy_ids = {str(item["id"]) for item in list_enabled_strategies()}
        if strategy_id not in strategy_ids:
            return jsonify({"is_tunable": False, "html": ""})

        strategy_form_fields = build_strategy_form_fields(strategy_id)
        html = render_template(
            "_trade_strategy_params_panel.html",
            strategy_form_fields=strategy_form_fields,
        )
        return jsonify(
            {
                "is_tunable": bool(strategy_form_fields),
                "html": html,
            }
        )

    def settings_network_status_api():
        if request.args.get("refresh", "").strip() == "1":
            reset_connectivity_caches()
        return jsonify({"rows": build_network_service_rows(pending=False)})

    def local_market_store_page_data_api():
        current_page = max(parse_int_value(request.args.get("page"), 1), 1)
        all_local_market_tickers = list_local_market_tickers()
        total_pages = max((len(all_local_market_tickers) - 1) // LOCAL_STORE_PAGE_SIZE + 1, 1)
        current_page = min(current_page, total_pages)
        start_index = (current_page - 1) * LOCAL_STORE_PAGE_SIZE
        end_index = start_index + LOCAL_STORE_PAGE_SIZE
        rows = build_local_market_rows_for_tickers(
            all_local_market_tickers[start_index:end_index],
            include_ranges=True,
        )
        return jsonify(
            {
                "page": current_page,
                "total_pages": total_pages,
                "rows": rows,
            }
        )

    def market_store_presence_api():
        raw_tickers = [value.strip() for value in request.args.getlist("ticker") if value.strip()]
        normalized_tickers: list[str] = []
        for raw_ticker in raw_tickers:
            try:
                normalized_tickers.append(validate_ticker_or_raise(raw_ticker))
            except ValueError:
                continue
        unique_tickers = list(dict.fromkeys(normalized_tickers))
        missing_history = [
            ticker
            for ticker in unique_tickers
            if not history_store_path_for(ticker).exists()
        ]
        has_1m_mapping = {
            ticker: has_recent_one_minute_store(ticker)
            for ticker in unique_tickers
        }
        period_options_mapping = {
            ticker: {
                "1d": build_supported_periods_for_history_store(ticker, "1d"),
                "1m": build_supported_periods_for_history_store(ticker, "1m"),
            }
            for ticker in unique_tickers
        }
        return jsonify(
            {
                "tickers": unique_tickers,
                "missingHistory": missing_history,
                "hasMissingHistory": bool(missing_history),
                "has1m": has_1m_mapping,
                "periodOptions": period_options_mapping,
            }
        )

    def test_chart_1m_view(ticker: str, date_str: str):
        path = intraday_history_store_path_for(ticker, "1m")
        if not path.exists():
            return f"No 1m data for {ticker} at {path}", 404

        try:
            df = normalize_one_minute_store_frame(pd.read_parquet(path))
            # 1m Parquet storage is now standardized strictly to New York Time (NYT).
            df['DateNYT'] = pd.to_datetime(df['Date'])

            # Audit unique dates for debugging
            all_unique_dates = sorted(df['DateNYT'].dt.date.unique())
            print(f"DEBUG: All unique NYT dates in file: {all_unique_dates[-10:]}")

            if date_str == 'last5':
                target_dates = all_unique_dates[-5:]
                print(f"DEBUG: Filtering for target dates: {target_dates}")
                day_data = df[df['DateNYT'].dt.date.isin(target_dates)].copy()
                display_date = f"Last 5 Days ({target_dates[0]} to {target_dates[-1]})"
            else:
                day_data = df[df['DateNYT'].dt.strftime('%Y-%m-%d') == date_str].copy()
                display_date = date_str

            if day_data.empty:
                print(f"DEBUG: No rows found for {ticker} on {date_str} NYT")
                return f"No data found for {ticker} on {date_str}. NYT range: {df['DateNYT'].min()} to {df['DateNYT'].max()}", 404

            day_data = day_data.sort_values("DateNYT")
            print(f"DEBUG: Found {len(day_data)} rows for {ticker} in final selection (NYT Store).")

            rows = []
            is_multi = date_str == 'last5'
            for _, row in day_data.iterrows():
                rows.append({
                    "time": row['DateNYT'].strftime('%m-%d %H:%M') if is_multi else row['DateNYT'].strftime('%H:%M:%S'),
                    "close": float(row['Close']),
                    "volume": int(row['Volume']),
                })

            return render_template(
                "test_chart_1m.html",
                ticker=ticker,
                date=display_date,
                rows=rows
            )
        except Exception as e:
            return f"Error loading chart: {str(e)}", 500

    def investment_page():
        query_string = request.query_string.decode().strip()
        target_path = build_more_path("investment")
        return redirect(f"{target_path}?{query_string}" if query_string else target_path)

    def investment_get_transactions():
        """Get all saved investment transactions from local storage."""
        if not INVESTMENT_STORE_PATH.exists():
            return jsonify({
                "transactions": [],
                "ticker_profiles": {},
                "money_market_tickers": sorted(configured_money_market_tickers),
                "success": True,
            })
        try:
            with open(INVESTMENT_STORE_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
            data = normalize_investment_payload_tickers(data)

            freshness_refresh_failures = ensure_latest_daily_caches(
                exclude_configured_money_market_tickers(
                    extract_open_investment_tickers(data)
                )
            )

            def resolve_money_market_company_name(
                    ticker: str,
                    transactions: list[dict[str, object]],
            ) -> str | None:
                if ticker not in configured_money_market_tickers or not money_market_name_from_description:
                    return None

                preferred_transaction_types = {"buy", "sell"}
                fallback_candidate = None
                for txn in transactions:
                    if str(txn.get("ticker") or "").strip().upper() != ticker:
                        continue
                    description = " ".join(str(txn.get("description") or "").split()).strip()
                    if not description:
                        continue
                    description_upper = description.upper()
                    if money_market_description_keywords and not any(
                            keyword in description_upper for keyword in money_market_description_keywords
                    ):
                        continue
                    normalized_type = str(txn.get("type") or "").replace(" ", "_").lower()
                    if normalized_type in preferred_transaction_types:
                        return description
                    if fallback_candidate is None:
                        fallback_candidate = description
                return fallback_candidate

            ticker_profiles: dict[str, dict[str, str]] = {}
            transactions = data.get("transactions", [])
            for txn in transactions:
                raw_ticker = str(txn.get("ticker") or "").strip().upper()
                if not raw_ticker:
                    continue
                normalized_type = str(txn.get("type") or "").replace(" ", "_").lower()
                if normalized_type in {"forex_trade", "forex_trade_component", "fx_translation_pnl"}:
                    continue
                if raw_ticker in ticker_profiles:
                    continue
                profile_snapshot = load_local_profile_snapshot(raw_ticker)
                if profile_snapshot is not None:
                    company_name, logo_url = profile_snapshot
                else:
                    profile_record = load_profile_record(raw_ticker) or {}
                    company_name = str(profile_record.get("company_name") or raw_ticker).strip() or raw_ticker
                    logo_url = ""
                    if has_logo_asset(raw_ticker):
                        logo_path = logo_store_path_for(raw_ticker)
                        logo_url = build_market_store_logo_url(logo_path.name, logo_path.stat().st_mtime_ns)
                    else:
                        profile = fetch_quote_profile(raw_ticker, force_refresh=False)
                        company_name = str(profile.company_name or company_name).strip() or raw_ticker
                        logo_url = str(profile.logo_url or "").strip()
                    if company_name == raw_ticker:
                        inferred_money_market_name = resolve_money_market_company_name(raw_ticker, transactions)
                        if inferred_money_market_name:
                            company_name = inferred_money_market_name
                ticker_profiles[raw_ticker] = {
                    "ticker": raw_ticker,
                    "company_name": company_name,
                    "logo_url": logo_url,
                }
            data["ticker_profiles"] = ticker_profiles
            data["money_market_tickers"] = sorted(configured_money_market_tickers)
            data["freshness_refresh_failures"] = freshness_refresh_failures
            return jsonify(data)
        except Exception as exc:
            return jsonify({"success": False, "error": str(exc)}), 500

    def investment_add_transactions():
        """Import IBKR CSV files and rebuild the local investment store."""
        transactions_file = None
        positions_file = None
        try:
            transactions_file = request.files.get("transactions_csv")
            positions_file = request.files.get("positions_csv")
            if transactions_file is None or positions_file is None:
                return jsonify({
                    "success": False,
                    "error": "Please upload both the Transaction History CSV and the Realized Summary CSV.",
                }), 400

            transactions_payload = transactions_file.read()
            positions_payload = positions_file.read()
            if not transactions_payload or not positions_payload:
                return jsonify({
                    "success": False,
                    "error": "Both CSV files must be non-empty.",
                }), 400

            investment_payload = build_investment_payload_from_ibkr_csvs(
                transaction_csv_bytes=transactions_payload,
                positions_csv_bytes=positions_payload,
            )

            freshness_refresh_failures = ensure_latest_daily_caches(
                exclude_configured_money_market_tickers(
                    extract_all_investment_tickers(investment_payload)
                )
            )

            INVESTMENT_STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
            with open(INVESTMENT_STORE_PATH, "w", encoding="utf-8") as f:
                json.dump(investment_payload, f, indent=2, ensure_ascii=False)
                f.write("\n")

            return jsonify({
                "success": True,
                "message": (
                    "Import complete. The server does not store your original CSV files. "
                    "They were processed in memory and discarded after the import finished."
                ),
                "summary": investment_payload.get("summary", {}),
                "freshness_refresh_failures": freshness_refresh_failures,
                "transactions": investment_payload.get("transactions", []),
                "investment": investment_payload,
            })
        except ValueError as exc:
            return jsonify({"success": False, "error": str(exc)}), 400
        except Exception as exc:
            return jsonify({"success": False, "error": str(exc)}), 500
        finally:
            if transactions_file is not None:
                transactions_file.close()
            if positions_file is not None:
                positions_file.close()

    def investment_get_latest_price():
        """Get the latest closing price for a ticker from local market store."""
        ticker = request.args.get("ticker", "").strip().upper()
        if not ticker:
            return jsonify({"success": False, "error": "No ticker provided"}), 400

        try:
            path = history_store_path_for(ticker)
            if not path.exists():
                return jsonify({"success": False, "error": f"No local data for {ticker}"}), 404

            df = pd.read_parquet(path)
            if df.empty or "Close" not in df.columns:
                return jsonify({"success": False, "error": f"No price data for {ticker}"}), 404

            # Get the latest close price (last row)
            latest_row = df.sort_values("Date").iloc[-1]
            latest_close = float(latest_row["Close"])
            latest_date = str(latest_row["Date"].date()) if hasattr(latest_row["Date"], "date") else str(latest_row["Date"])

            return jsonify({
                "success": True,
                "ticker": ticker,
                "latest_close": latest_close,
                "latest_date": latest_date
            })
        except Exception as exc:
            return jsonify({"success": False, "error": str(exc)}), 500

    def investment_get_parquet():
        """Get all date -> close price mappings from the parquet file for a ticker."""
        ticker = request.args.get("ticker", "").strip().upper()
        if not ticker:
            return jsonify({"success": False, "error": "No ticker provided"}), 400

        try:
            path = history_store_path_for(ticker)
            if not path.exists():
                if ticker in configured_money_market_tickers:
                    return jsonify({"success": False, "error": f"No local data for {ticker}"}), 404
                fetch_history(ticker, include_dividends=False)
                path = history_store_path_for(ticker)
            else:
                if ticker not in configured_money_market_tickers:
                    ensure_latest_daily_caches([ticker])

            df = pd.read_parquet(path)
            if df.empty or "Close" not in df.columns or "Date" not in df.columns:
                return jsonify({"success": False, "error": f"No price/date data for {ticker}"}), 404

            # Sort by date and extract (date string, close price) pairs
            df_sorted = df.sort_values("Date")
            prices = []
            for _, row in df_sorted.iterrows():
                date_val = row["Date"]
                if isinstance(date_val, pd.Timestamp):
                    date_str = date_val.strftime("%Y-%m-%d")
                else:
                    # If already string, ensure YYYY-MM-DD format
                    date_str = str(pd.to_datetime(date_val).date())
                close_val = float(row["Close"])
                prices.append({"date": date_str, "close": close_val})

            return jsonify({
                "success": True,
                "ticker": ticker,
                "prices": prices,
                "count": len(prices)
            })
        except Exception as exc:
            return jsonify({"success": False, "error": str(exc)}), 500

    return WebRuntime(
        root=root,
        compare_page=compare_page,
        portfolio_page=portfolio_page,
        backtest_page=backtest_page,
        legacy_trade_messages_page=legacy_trade_messages_page,
        more_root=more_root,
        more_page=more_page,
        settings_root=settings_root,
        settings_page=settings_page,
        export_transactions_api=export_transactions_api,
        general_settings_action=general_settings_action,
        email_smtp_action=email_smtp_action,
        broker_access_action=broker_access_action,
        local_market_store_action=local_market_store_action,
        settings_cache_action=settings_cache_action,
        market_store_logo=market_store_logo,
        symbol_search=symbol_search,
        date_constraints_api=date_constraints_api,
        trade_strategy_fields_api=trade_strategy_fields_api,
        settings_network_status_api=settings_network_status_api,
        local_market_store_page_data_api=local_market_store_page_data_api,
        market_store_presence_api=market_store_presence_api,
        test_chart_1m_view=test_chart_1m_view,
        investment_page=investment_page,
        investment_get_transactions=investment_get_transactions,
        investment_add_transaction=investment_add_transactions,
        investment_get_latest_price=investment_get_latest_price,
        investment_get_parquet=investment_get_parquet,
    )
