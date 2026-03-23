"""
HTTP route registration.

Code version: v3.31.11
"""

from __future__ import annotations
import json
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict
from io import BytesIO
from typing import Any
from urllib.parse import urlencode
import pandas as pd
from flask import Flask, jsonify, redirect, render_template, request, send_from_directory, url_for, send_file

from .backtest_settings import load_backtest_execution_mode, save_backtest_execution_mode
from .broker_market_data import (
    has_recent_one_minute_store,
    refresh_longbridge_one_minute_store,
    test_broker_connection,
)
from .broker_settings import (
    BrokerSettings,
    has_longbridge_credentials,
    load_broker_settings,
    sanitize_broker_settings_for_view,
    save_broker_settings,
)
from .comparisons import build_series_payload, slice_dataset_for_period
from .email_settings import (
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
from strategies.loader import instantiate_strategy, list_enabled_strategies
from .connectivity import (
    fetch_tradingview_metrics,
    has_google_hk_access,
    has_remote_logo_access,
    has_remote_market_access,
    has_tradingview_ta_available,
    reset_connectivity_caches,
)
from .config import (
    CODE_VERSION,
    DEFAULT_INTERVAL,
    DEFAULT_PERIOD,
    DEFAULT_TICKERS,
    PERIOD_OFFSETS,
    SUPPORTED_PERIODS_1D,
    SUPPORTED_PERIODS_1M,
)
from .date_constraints import build_date_constraint_payload
from .logos import build_market_store_logo_url, fetch_quote_profile, has_valid_ticker_format, is_known_ticker, normalize_ticker_input, refresh_quote_profile_cache, search_tickers
from .market_data import fetch_history, refresh_history_store
from .presentation import build_series_colors, format_display_date, format_period_label, hex_to_rgba
from .settings import get_settings
from .storage import (
    LOGOS_STORE_DIR,
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
SUPPORTED_SETTINGS_SECTIONS = {"about", "general", "network", "strategies", "email-smtp", "broker-access", "local-market-store", "clear-caches", "style-tokens"}
SUPPORTED_MORE_SECTIONS = {"overview", "timing"}
LOCAL_STORE_PAGE_SIZE = 10
STRATEGY_CATEGORY_LABELS = {
    "baseline": "Baseline",
    "momentum": "Momentum",
    "trend": "Trend",
    "general": "General",
}
VIEW_PATHS = {
    "tickers": "/compare",
    "portfolio": "/portfolio",
    "backtest": "/backtest",
    "more": "/more/overview",
    "settings": "/settings/about",
}


def register_routes(app: Flask) -> None:
    settings = get_settings()
    defaults = settings["defaults"]
    labels = settings["ui"]["labels"]
    theme = settings["ui"]["theme"]
    chart_config = settings["ui"]["chart"]
    logos = settings["ui"]["logos"]
    app_meta = settings["app"]

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

    def format_store_range_date(raw_value: object) -> str:
        if raw_value is None:
            return ""
        if isinstance(raw_value, pd.DataFrame):
            if raw_value.empty:
                return ""
            raw_value = raw_value.min().min()
        elif isinstance(raw_value, (pd.Series, pd.Index, list, tuple)):
            values = pd.Series(raw_value).dropna()
            if values.empty:
                return ""
            raw_value = values.iloc[0]

        timestamp = pd.Timestamp(raw_value)
        if pd.isna(timestamp):
            return ""
        return timestamp.strftime("%Y/%m/%d")

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
        for dataset, weight in zip(datasets, weights, strict=True):
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
        candidate = (section_name or "overview").strip().lower()
        return candidate if candidate in SUPPORTED_MORE_SECTIONS else "overview"

    def build_more_path(section_name: str) -> str:
        return f"/more/{normalize_more_section(section_name)}"

    def build_more_url(section_name: str) -> str:
        return build_more_path(section_name)

    def build_more_cards(section_name: str) -> list[dict[str, str]]:
        return [
            {
                "title": "Collection workspace",
                "detail": "More is a reserved tool hub for secondary utilities that deserve full-size cards and readable side navigation.",
                "meta": "Overview",
            },
            {
                "title": "Consistent shell",
                "detail": "This page intentionally mirrors the Settings structure so new utilities can be added without inventing a parallel layout system.",
                "meta": "UI",
            },
        ]

    def should_use_modal_banner_message(message: str | None) -> bool:
        normalized = (message or "").strip()
        if not normalized:
            return False
        return (
            normalized.startswith("No market data returned for ")
            or normalized.startswith("Local market data for ")
            or normalized.startswith("Unknown or unsupported ticker: ")
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
            raise ValueError("No ticker selected for backtest.")
        trade_ticker = validate_ticker_or_raise(requested_tickers[0])
        include_dividends = parse_bool_flag("dividends", "include_dividends")
        range_mode = request.args.get("range", defaults.get("range_mode", "period")).strip().lower()
        period = request.args.get("period", defaults.get("period", DEFAULT_PERIOD)).strip().lower()
        exact_start = request.args.get("from", request.args.get("exact_start", "")).strip()
        exact_end = request.args.get("to", request.args.get("exact_end", "")).strip()
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
            one_year_ago = pd.Timestamp.now(tz="UTC") - pd.DateOffset(years=1)
            trade_dataset = trade_dataset[trade_dataset["Date"] >= one_year_ago.tz_localize(None)]
            
        date_constraints = build_date_constraint_payload(
            trade_dataset,
            requested_start=exact_start or None,
            requested_end=exact_end or None,
        )
        if range_mode == "exact":
            if not date_constraints.trading_dates:
                raise ValueError("The selected exact range does not contain trading dates.")
            aligned_start = pd.to_datetime(date_constraints.adjusted_start)
            aligned_end = pd.to_datetime(date_constraints.adjusted_end).replace(hour=23, minute=59, second=59)
            trade_dataset = trade_dataset[
                (trade_dataset["Date"] >= aligned_start) & (trade_dataset["Date"] <= aligned_end)
            ].copy()
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
        return backtest_result, trade_ticker, requested_interval, date_constraints, trade_dataset

    def build_strategy_option_groups(strategy_options: list[dict[str, object]]) -> list[dict[str, object]]:
        grouped: dict[str, list[dict[str, object]]] = {}
        category_order: list[str] = []
        for item in strategy_options:
            category = str(item.get("category", "general"))
            if category not in grouped:
                grouped[category] = []
                category_order.append(category)
            grouped[category].append(item)
        return [
            {
                "key": category,
                "label": format_strategy_category_label(category),
                "items": grouped[category],
            }
            for category in category_order
        ]

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
        return rows

    def build_style_token_rows() -> list[dict[str, object]]:
        def style_token_id(name: str) -> str:
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
            return {
                "name": name,
                "value": value,
                "editable": False,
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
                    px_token("--mode-switch-radius", 999, 0),
                    px_token("--mode-switch-pad", 4, 0),
                    px_token("--mode-switch-gap", 4, 0),
                    px_token("--mode-switch-min-height", 36, 1),
                    px_token("--mode-switch-thumb-inset", 4, 0),
                    px_token("--mode-switch-thumb-offset", 6, 0),
                    px_token("--mode-switch-label-pad-inline", 12, 0),
                    px_token("--mode-switch-label-min-height", 28, 1),
                    raw_token("--mode-switch-thumb-background", "#0055cc"),
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
                    px_token("--settings-action-button-radius", 999, 0),
                    px_token("--settings-action-button-pad-block", 0, 0),
                    px_token("--settings-action-button-pad-inline", 18, 0),
                    px_token("--settings-action-button-min-height", 32, 1),
                    raw_token("--settings-action-button-background", "#0055cc"),
                    raw_token("--settings-action-button-color", "#ffffff"),
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
                    px_token("--settings-action-package-radius", 10),
                    px_token("--settings-action-package-pad-block", 14),
                    px_token("--settings-action-package-pad-inline", 16),
                    px_token("--settings-action-package-column-gap", 12),
                    px_token("--settings-action-package-row-gap", 8),
                    px_token("--settings-action-package-copy-gap", 4),
                    raw_token("--settings-action-package-background", "rgba(255, 255, 255, 0.58)"),
                    raw_token("--settings-action-package-border", "1px solid rgba(15, 23, 42, 0.06)"),
                ],
                "related_styles": [
                    {
                        "name": "Settings action button",
                        "target_id": style_token_id("Settings action button"),
                    },
                ],
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
                    px_token("--local-store-pagination-button-radius", 999, 0),
                    px_token("--local-store-pagination-indicator-radius", 999, 0),
                    raw_token("--local-store-pagination-indicator-background", "#0055cc"),
                    raw_token("--local-store-pagination-indicator-shadow", "0 8px 18px rgba(0, 85, 204, 0.24), inset 0 1px 0 rgba(255, 255, 255, 0.18)"),
                    raw_token("--local-store-pagination-button-border", "1px solid rgba(0, 85, 204, 0.28)"),
                ],
                "related_styles": [],
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
    ) -> list[dict[str, str]]:
        rows: list[dict[str, str]] = []
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
            rows.append(
                {
                    "ticker": ticker,
                    "company_name": company_name,
                    "logo_url": logo_url,
                    "range_start": range_start,
                    "range_end": range_end,
                    "range": f"{range_start} - {range_end}" if range_start and range_end else "",
                    "has_1m": has_recent_one_minute_store(ticker),
                }
            )
        return rows

    def build_network_service_rows(*, pending: bool) -> list[dict[str, str | bool]]:
        def service_logo_url(filename: str) -> str:
            return url_for("static", filename=f"images/{filename}")

        if pending:
            return [
                {
                    "key": "market",
                    "name": "yfinance",
                    "status": "Checking...",
                    "note": "Checking whether Yahoo Finance can be reached from this device.",
                    "logo_url": service_logo_url("Yahoo-Logo.svg"),
                    "is_available": False,
                    "is_pending": True,
                },
                {
                    "key": "logo",
                    "name": labels["logo_network"],
                    "status": "Checking...",
                    "note": "Checking whether the primary ticker logo service and its fallbacks can be reached from this device.",
                    "logo_url": service_logo_url("network.svg"),
                    "is_available": False,
                    "is_pending": True,
                },
                {
                    "key": "google-hk",
                    "name": "Google (Hong Kong)",
                    "status": "Checking...",
                    "note": "Checking whether Google (Hong Kong) can be reached from this device.",
                    "logo_url": service_logo_url("Google__G__logo.svg"),
                    "is_available": False,
                    "is_pending": True,
                },
                {
                    "key": "tradingview-ta",
                    "name": "tradingview-ta",
                    "status": "Checking...",
                    "note": "Checking if the tradingview-ta library is installed.",
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

    def resolve_effective_period_for_many(requested_period: str, datasets: list[pd.DataFrame]) -> tuple[str, str | None]:
        if requested_period == "max":
            return "max", None
        common_start = max(dataset["Date"].min() for dataset in datasets)
        common_end = min(dataset["Date"].max() for dataset in datasets)
        requested_start = (common_end - PERIOD_OFFSETS[requested_period]).normalize()
        if requested_start >= common_start:
            return requested_period, None

        fallback_period = "max"
        for candidate in SUPPORTED_PERIODS_1D:
            if candidate == "max":
                break
            candidate_start = (common_end - PERIOD_OFFSETS[candidate]).normalize()
            if candidate_start >= common_start:
                fallback_period = candidate

        available_days = (common_end - common_start).days
        if available_days <= 0:
            raise ValueError("The selected tickers do not have overlapping trading history.")

        notice = (
            f"Requested period {requested_period} exceeds the shared trading history. "
            f"Automatically switched to {fallback_period} based on the latest common start date "
            f"({format_display_date(common_start)})."
        )
        return fallback_period, notice

    def render_workspace_page(current_view: str, settings_section: str = "about", more_section: str = "overview"):
        backtest_execution_mode = load_backtest_execution_mode()
        is_dock_prefetch = request.headers.get("X-Requested-With") == "dock-prefetch"
        requested_tickers = parse_requested_tickers()
        range_mode = request.args.get(
            "range",
            request.args.get("range_mode", defaults.get("range_mode", "period")),
        ).strip().lower()
        period = request.args.get("period", defaults.get("period", DEFAULT_PERIOD)).strip().lower()
        exact_start = request.args.get("from", request.args.get("exact_start", "")).strip()
        exact_end = request.args.get("to", request.args.get("exact_end", "")).strip()
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

        error = request.args.get("error", "").strip() or None
        notice = request.args.get("notice", "").strip() or None
        notice_is_floating = bool(error or notice)
        floating_banner_icon_class = "icon-modal-dialog-banner-default"
        if notice and "Successfully connected" in notice:
            floating_banner_icon_class = "icon-settings-broker"
        elif error:
            floating_banner_icon_class = "icon-modal-dialog-banner-default" # Or some error icon
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
        smtp_settings = sanitize_smtp_settings_for_view(load_smtp_settings())
        broker_settings = sanitize_broker_settings_for_view(load_broker_settings())
        local_market_rows: list[dict[str, str]] = []
        local_store_total_pages = 1
        local_store_current_page = 1
        local_store_prev_slot = {"page": None}
        local_store_page_slots = [{"page": page_number, "is_active": page_number == 1} for page_number in range(1, 6)]
        local_store_next_slot = {"page": None}
        more_cards: list[dict[str, str]] = []

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

        supported_periods = (
            SUPPORTED_PERIODS_1M if requested_interval == "1m" and "1m" in supported_intervals else SUPPORTED_PERIODS_1D
        )

        if period not in supported_periods:
            period = DEFAULT_PERIOD

        try:
            if current_view == "backtest":
                backtest_result, trade_ticker, requested_interval, date_constraints, trade_dataset = _run_backtest_from_request()
                ticker_slots = [trade_ticker]
                profiles = [fetch_quote_profile(trade_ticker, False)]
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
                            portfolio_items = [{"ticker": t, "company_name": t, "logo_url": "", "weight": w, "growth_multiple": 1.0, "color": "transparent"} for t, w in zip(validated_tickers, portfolio_weights)]
                            portfolio_total_return = 0.0
                        else:
                            series = [type("Mock", (), {"ticker": t, "normalized_returns": [0.0], "color": "transparent"})() for t in validated_tickers]
                            performance_items = [{"ticker": t, "company_name": t, "logo_url": "", "ending_return": 0.0, "color": "transparent", "shadow_color": "transparent", "is_winner": False} for t in validated_tickers]
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

                        datasets = [fetch_history(ticker, include_dividends) for ticker in validated_tickers]
                        profiles = [fetch_quote_profile(ticker, False) for ticker in validated_tickers]
                        date_constraints = build_date_constraint_payload(
                            *datasets,
                            requested_start=exact_start or None,
                            requested_end=exact_end or None,
                        )
                        if range_mode == "exact":
                            if not date_constraints.trading_dates:
                                raise ValueError("The selected tickers do not share any common trading dates.")
                            aligned_start = pd.to_datetime(date_constraints.adjusted_start)
                            aligned_end = pd.to_datetime(date_constraints.adjusted_end)
                            aligned_datasets = align_datasets_on_common_dates(datasets)
                            aligned_datasets = [
                                dataset[(dataset["Date"] >= aligned_start) & (dataset["Date"] <= aligned_end)].copy()
                                for dataset in aligned_datasets
                            ]
                            if any(dataset.empty for dataset in aligned_datasets):
                                raise ValueError("The selected exact range does not contain shared trading dates.")
                            exact_start_value = date_constraints.adjusted_start or exact_start
                            exact_end_value = date_constraints.adjusted_end or exact_end
                            period_label = "Exact range"
                        else:
                            period, notice = resolve_effective_period_for_many(period, datasets)
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
                                    strict=True,
                                )
                            ]
                        else:
                            series = [
                                build_series_payload(ticker, dataset, color=color)
                                for ticker, dataset, color in zip(validated_tickers, aligned_datasets, colors, strict=True)
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
                                for item, profile in zip(series, profiles, strict=True)
                            ]
                        ticker_slots = validated_tickers.copy()
                        record_ticker_usage(validated_tickers)
        except Exception as exc:  # noqa: BLE001
            error = str(exc) or None
            if should_use_modal_banner_message(error):
                notice_is_floating = True
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
                    notice_is_floating = True

        top_tickers = []
        timing_selected_ticker = ""
        timing_metrics = []
        timing_summary = []
        timing_market = {}
        timing_error = ""

        if current_view == "settings":
            if settings_section in {"general", "email-smtp", "broker-access", "local-market-store", "clear-caches"} and (notice or error):
                notice_is_floating = True
                floating_banner_icon_class = modal_banner_icon_class(error or notice)
            settings_service_rows = build_network_service_rows(pending=settings_section == "network")
            strategy_settings_rows = build_strategy_settings_rows(strategy_options)
            style_token_rows = build_style_token_rows()
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
            more_cards = build_more_cards(more_section)
            top_tickers = []
            timing_selected_ticker = ""
            timing_metrics = []
            timing_summary = []
            timing_error = ""
            timing_market = {}
            if more_section == "timing":
                from app.storage import TICKER_USAGE_STORE_PATH
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
            "more": "more.html",
            "settings": "settings.html",
        }[current_view]

        return render_template(
            template_name,
            error=error,
            notice=notice,
            notice_is_floating=notice_is_floating,
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
            style_token_rows=style_token_rows,
            backtest_execution_mode=backtest_execution_mode,
            broker_settings=broker_settings,
            more_cards=more_cards,
            local_market_rows=local_market_rows,
            local_store_current_page=local_store_current_page,
            local_store_total_pages=local_store_total_pages,
            local_store_prev_slot=local_store_prev_slot,
            local_store_page_slots=local_store_page_slots,
            local_store_next_slot=local_store_next_slot,
            page_title=page_title,
            report_heading=report_heading,
            chart_heading=chart_heading,
            dock_urls={view_name: build_view_url(view_name) for view_name in ("tickers", "portfolio", "backtest", "more", "settings")},
            settings_urls={section_name: build_settings_url(section_name) for section_name in ("about", "general", "network", "strategies", "email-smtp", "broker-access", "local-market-store", "clear-caches", "style-tokens")},
            more_urls={section_name: build_more_url(section_name) for section_name in ("overview", "timing")},
            local_store_page_urls={page_number: build_local_store_page_url(page_number) for page_number in range(1, local_store_total_pages + 1)},
            labels=labels,
            theme=theme,
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
        )

    @app.get("/api/export-transactions")
    def export_transactions_api():
        try:
            # Re-run backtest to get the full transaction list
            backtest_result, trade_ticker, *remaining = _run_backtest_from_request()
            
            trades = backtest_result.get("trades", [])
            if not trades:
                return "No transactions to export.", 404

            df = pd.DataFrame(trades)
            
            # Format numbers to be strings to control appearance in Excel
            for col in ["price", "pnl", "equity"]:
                if col in df.columns:
                    df[col] = df[col].apply(lambda x: f"{x:,.2f}")
            if "shares" in df.columns:
                    df["shares"] = df["shares"].apply(lambda x: f"{x:,.0f}")

            output = BytesIO()
            with pd.ExcelWriter(output, engine='openpyxl') as writer:
                df.to_excel(writer, index=False, sheet_name='Transactions')
                worksheet = writer.sheets['Transactions']
                # Auto-adjust columns
                for idx, col in enumerate(df):
                    series = df[col]
                    max_len = max((
                        series.astype(str).map(len).max(),
                        len(str(series.name))
                    )) + 2
                    worksheet.column_dimensions[chr(65 + idx)].width = max_len

            output.seek(0)
            
            return send_file(
                output,
                mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                as_attachment=True,
                download_name=f"{trade_ticker}_transactions.xlsx"
            )
        except Exception as exc:
            return str(exc), 500

    @app.get("/")
    def root():
        legacy_view = request.args.get("view")
        if request.args:
            target_view = resolve_view() if legacy_view else "tickers"
            target_section = resolve_settings_section() if target_view == "settings" else "about"
            target_path = build_settings_path(target_section) if target_view == "settings" else build_view_path(target_view)
            query_string = urlencode(build_modern_query_pairs(), doseq=True)
            return redirect(f"{target_path}?{query_string}" if query_string else target_path)
        return redirect(build_view_path("tickers"))

    @app.get("/compare")
    def compare_page():
        return render_workspace_page("tickers")

    @app.get("/portfolio")
    def portfolio_page():
        return render_workspace_page("portfolio")

    @app.get("/backtest")
    def backtest_page():
        return render_workspace_page("backtest")

    @app.get("/trade-messages")
    def legacy_trade_messages_page():
        query_string = request.query_string.decode().strip()
        target_path = build_view_path("backtest")
        return redirect(f"{target_path}?{query_string}" if query_string else target_path)

    @app.get("/more")
    def more_root():
        return redirect(build_more_path("overview"))

    @app.get("/more/<section_name>")
    def more_page(section_name: str):
        return render_workspace_page("more", more_section=section_name)

    @app.get("/settings")
    def settings_root():
        return redirect(build_settings_path("about"))

    @app.get("/settings/<section_name>")
    def settings_page(section_name: str):
        return render_workspace_page("settings", section_name)

    @app.post("/settings/general/action")
    def general_settings_action():
        selected_mode = save_backtest_execution_mode(request.form.get("backtest_execution_mode", "next_open"))
        selected_label = "Signal bar close" if selected_mode == "signal_close" else "Next bar open"
        params = urlencode({"notice": f"Backtest execution model updated: {selected_label}."})
        return redirect(f"{build_settings_path('general')}?{params}")

    @app.post("/settings/email-smtp/action")
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
        if updated_settings.oauth_client_id != current_settings.oauth_client_id:
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
        params = urlencode({
            "notice": message if success else "",
            "error": "" if success else message,
        })
        return redirect(f"{build_settings_path('email-smtp')}?{params}" if params else build_settings_path("email-smtp"))

    @app.post("/settings/broker-access/action")
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
            notice = message if success else ""
            error = "" if success else message
        else:
            success = True
            notice = (
                "Broker credentials were saved only on this device. "
                "This project is open source, and the developer cannot retrieve your local secrets."
            )
            error = ""
        
        params = urlencode({
            "notice": notice,
            "error": error,
        })
        return redirect(f"{build_settings_path('broker-access')}?{params}")

    @app.post("/settings/local-market-store/action")
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
                    return redirect(
                        build_local_store_redirect(
                            error=f"Unable to refresh historical market data for {failed_preview}."
                        )
                    )

                notice_parts: list[str] = []
                if total_count == 0:
                    notice = "Local Market Store is already up to date."
                    return redirect(build_local_store_redirect(notice=notice))

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
                return redirect(build_local_store_redirect(notice=notice))
            if not ticker:
                return redirect(redirect_url)
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
                return redirect(build_local_store_redirect(notice=notice))
            elif action == "refresh-1m":
                broker_settings = load_broker_settings()
                if broker_settings.selected_broker != "longbridge":
                    raise ValueError("1-minute history fetch is currently available only through Longbridge.")
                if not has_longbridge_credentials(broker_settings):
                    raise ValueError("Save your Longbridge App Key, App Secret, and Access Token first.")
                refresh_longbridge_one_minute_store(ticker, broker_settings)
                notice = f"Saved the latest 1-minute market data for {ticker} to local cache."
                return redirect(build_local_store_redirect(notice=notice))
            elif action == "delete":
                delete_ticker_data(ticker)
                notice = f"Removed all cached data for {ticker} from local storage."
                return redirect(build_local_store_redirect(notice=notice))
        except Exception as exc:  # noqa: BLE001
            message = str(exc).strip() or f"Unable to update local cache for {ticker}."
            return redirect(build_local_store_redirect(error=message))

        return redirect(redirect_url)

    @app.post("/settings/cache/action")
    def settings_cache_action():
        section_name = normalize_settings_section(request.form.get("section", "clear-caches"))
        try:
            cache_summary = clear_nonhistorical_market_cache()
            reset_connectivity_caches()
            notice = (
                f"Cleared {cache_summary['removed_search_queries']:,} search result cache entr"
                f"{'y' if cache_summary['removed_search_queries'] == 1 else 'ies'}, "
                f"{cache_summary['removed_profiles']:,} non-local profile entr"
                f"{'y' if cache_summary['removed_profiles'] == 1 else 'ies'}, "
                f"{cache_summary['removed_logos']:,} non-local logo image"
                f"{'' if cache_summary['removed_logos'] == 1 else 's'}. "
                f"Protected {cache_summary['protected_tickers']:,} Local Market Store ticker entr"
                f"{'y' if cache_summary['protected_tickers'] == 1 else 'ies'}, "
                f"kept {cache_summary['protected_search_queries']:,} matching search cache entr"
                f"{'y' if cache_summary['protected_search_queries'] == 1 else 'ies'}, "
                "and left ticker usage records untouched."
            )
            return redirect(f"{build_settings_path(section_name)}?{urlencode({'notice': notice})}")
        except Exception as exc:  # noqa: BLE001
            message = str(exc).strip() or "Unable to clear cached settings data."
            return redirect(f"{build_settings_path(section_name)}?{urlencode({'error': message})}")

    @app.get("/market-store/logos/<path:filename>")
    def market_store_logo(filename: str):
        candidate = LOGOS_STORE_DIR / filename
        if candidate.exists():
            return send_from_directory(LOGOS_STORE_DIR, filename)
        return ("Not Found", 404)

    @app.get("/api/symbol-search")
    def symbol_search():
        query = normalize_ticker_input(request.args.get("q", ""))
        limit = min(max(parse_int_value(request.args.get("limit"), 5), 1), 5)
        if not query:
            return jsonify(search_tickers("", limit=limit))
        return jsonify([] if not has_valid_ticker_format(query) else search_tickers(query, limit=limit))

    @app.get("/api/date-constraints")
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

    @app.get("/api/trade-strategy-fields")
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

    @app.get("/api/settings/network-status")
    def settings_network_status_api():
        if request.args.get("refresh", "").strip() == "1":
            reset_connectivity_caches()
        return jsonify({"rows": build_network_service_rows(pending=False)})

    @app.get("/api/settings/local-market-store/page-data")
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

    @app.get("/api/market-store/presence")
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
        return jsonify(
            {
                "tickers": unique_tickers,
                "missingHistory": missing_history,
                "hasMissingHistory": bool(missing_history),
                "has1m": has_1m_mapping,
            }
        )

    @app.get("/test/chart/1m/<ticker>/<date_str>")
    def test_chart_1m_view(ticker: str, date_str: str):
        path = intraday_history_store_path_for(ticker, "1m")
        if not path.exists():
            return f"No 1m data for {ticker} at {path}", 404

        try:
            df = pd.read_parquet(path)
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

