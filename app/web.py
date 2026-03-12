"""
HTTP route registration.

Code version: v3.5.2
"""

from __future__ import annotations

from dataclasses import asdict
from urllib.parse import urlencode

import pandas as pd
from flask import Flask, jsonify, redirect, render_template, request, send_from_directory

from .comparisons import build_series_payload, slice_dataset_for_period
from .connectivity import has_remote_logo_access, has_remote_market_access
from .config import CODE_VERSION, DEFAULT_INTERVAL, DEFAULT_PERIOD, DEFAULT_TICKERS, PERIOD_OFFSETS, SUPPORTED_PERIODS
from .date_constraints import build_date_constraint_payload
from .logos import fetch_quote_profile, has_valid_ticker_format, is_known_ticker, normalize_ticker_input, search_tickers
from .market_data import fetch_history, refresh_history_store
from .presentation import build_series_colors, format_display_date, format_interval_label, format_period_label, hex_to_rgba
from .settings import get_settings
from .storage import PRIMARY_LOGOS_STORE_DIR, SEARCH_LOGOS_STORE_DIR, history_store_path_for, list_local_tickers, record_ticker_usage

MAX_TICKERS = 5
MIN_TICKERS = 2
SUPPORTED_VIEWS = {"tickers", "portfolio", "settings"}
SUPPORTED_SETTINGS_SECTIONS = {"about", "network", "local-market-store"}
LOCAL_STORE_PAGE_SIZE = 10


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
        if not is_known_ticker(normalized_ticker):
            raise ValueError(f"Unknown or unsupported ticker: {normalized_ticker}.")
        return normalized_ticker

    def parse_int_value(raw_value: object, fallback: int) -> int:
        if raw_value is None:
            return fallback
        try:
            return int(str(raw_value).strip())
        except (TypeError, ValueError):
            return fallback

    def parse_requested_tickers() -> list[str]:
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

    def resolve_view() -> str:
        requested_view = request.args.get("view", "tickers").strip().lower()
        return requested_view if requested_view in SUPPORTED_VIEWS else "tickers"

    def build_view_url(view_name: str) -> str:
        params = request.args.to_dict(flat=False)
        params["view"] = [view_name]
        query_string = urlencode(params, doseq=True)
        return f"/?{query_string}" if query_string else "/"

    def resolve_settings_section() -> str:
        requested_section = request.args.get("section", "about").strip().lower()
        return requested_section if requested_section in SUPPORTED_SETTINGS_SECTIONS else "about"

    def build_settings_url(section_name: str) -> str:
        params = request.args.to_dict(flat=False)
        params["view"] = ["settings"]
        params["section"] = [section_name]
        query_string = urlencode(params, doseq=True)
        return f"/?{query_string}" if query_string else "/"

    def build_local_store_page_url(page_number: int) -> str:
        params = request.args.to_dict(flat=False)
        params["view"] = ["settings"]
        params["section"] = ["local-market-store"]
        params["local_page"] = [str(page_number)]
        query_string = urlencode(params, doseq=True)
        return f"/?{query_string}" if query_string else "/"

    def build_local_market_rows() -> list[dict[str, str]]:
        rows: list[dict[str, str]] = []
        for ticker in list_local_tickers():
            history_path = history_store_path_for(ticker)
            if not history_path.exists():
                continue
            dataset = pd.read_parquet(history_path, columns=["Date"])
            if dataset.empty:
                continue
            profile = fetch_quote_profile(ticker, False)
            rows.append(
                {
                    "ticker": ticker,
                    "company_name": profile.company_name,
                    "logo_url": profile.logo_url or "",
                    "range": f"{format_display_date(dataset['Date'].min())} - {format_display_date(dataset['Date'].max())}",
                }
            )
        return rows

    def local_store_page_value() -> int:
        return max(parse_int_value(request.args.get("local_page"), 1), 1)

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
        for candidate in SUPPORTED_PERIODS:
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

    @app.get("/")
    def index():
        current_view = resolve_view()
        settings_section = resolve_settings_section()
        requested_tickers = parse_requested_tickers()
        range_mode = request.args.get("range_mode", defaults.get("range_mode", "period")).strip().lower()
        period = request.args.get("period", defaults.get("period", DEFAULT_PERIOD)).strip().lower()
        exact_start = request.args.get("exact_start", "").strip()
        exact_end = request.args.get("exact_end", "").strip()
        interval = DEFAULT_INTERVAL
        include_dividends = request.args.getlist("include_dividends")[-1] == "1" if request.args.getlist("include_dividends") else False

        error = None
        notice = None
        date_notice = None
        display_range = ""
        profiles = []
        series = []
        performance_items = []
        date_constraints = build_date_constraint_payload()
        ticker_slots = requested_tickers.copy() if requested_tickers else ["", ""]
        period_label = format_period_label(period)
        page_title = labels["hero_title"]
        report_heading = labels["performance_summary"]
        chart_heading = labels["chart_summary"]
        settings_title = labels["about"]
        settings_service_rows: list[dict[str, str | bool]] = []
        local_market_rows: list[dict[str, str]] = []
        local_store_total_pages = 1
        local_store_current_page = 1
        local_store_page_start = 1
        local_store_page_end = 1
        local_store_prev_page = None
        local_store_next_page = None
        submit_label = labels["update_chart"]

        if current_view == "portfolio":
            page_title = labels["portfolio_title"]
            report_heading = labels["portfolio_summary"]
            chart_heading = labels["portfolio_chart"]
            submit_label = labels["compute"]
        elif current_view == "settings":
            page_title = labels["settings_title"]
            if settings_section == "network":
                settings_title = labels["network_self_check"]
            elif settings_section == "local-market-store":
                settings_title = labels["local_market_store"]

        if period not in SUPPORTED_PERIODS:
            period = DEFAULT_PERIOD

        try:
            if not requested_tickers:
                raise ValueError("")
            if len(requested_tickers) < MIN_TICKERS:
                raise ValueError("Please enter at least two ticker symbols.")
            validated_tickers = [validate_ticker_or_raise(ticker) for ticker in requested_tickers]
            if len(set(validated_tickers)) != len(validated_tickers):
                raise ValueError("Ticker symbols must be unique.")

            datasets = [fetch_history(ticker, interval, include_dividends) for ticker in validated_tickers]
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
                date_notice = date_constraints.message
                period_label = "Exact range"
            else:
                period, notice = resolve_effective_period_for_many(period, datasets)
                common_end_date = min(dataset["Date"].max() for dataset in datasets)
                sliced_datasets = [slice_dataset_for_period(dataset, period, common_end_date) for dataset in datasets]
                aligned_datasets = align_datasets_on_common_dates(sliced_datasets)
                period_label = format_period_label(period)

            colors = build_series_colors(len(validated_tickers), theme["accent_primary"], theme["accent_secondary"])
            series = [
                build_series_payload(ticker, dataset, color=color)
                for ticker, dataset, color in zip(validated_tickers, aligned_datasets, colors, strict=True)
            ]
            best_return = max(item.normalized_returns[-1] for item in series)
            common_start = aligned_datasets[0]["Date"].min()
            common_end = aligned_datasets[0]["Date"].max()
            display_range = f"{format_display_date(common_start)} - {format_display_date(common_end)}"
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

        remote_market_access = has_remote_market_access()
        remote_logo_access = has_remote_logo_access()

        if not remote_market_access and not error and not notice:
            notice = "Using bundled local market_store data because remote market access is unavailable."

        if current_view == "settings":
            settings_service_rows = [
                {
                    "name": "yfinance",
                    "status": labels["service_ok"] if remote_market_access else labels["service_down"],
                    "note": (
                        "Yahoo Finance is reachable, so missing price history can be refreshed from the network."
                        if remote_market_access
                        else "Yahoo Finance is blocked here, so the app can only rely on bundled local market data."
                    ),
                    "is_available": remote_market_access,
                },
                {
                    "name": labels["logo_network"],
                    "status": labels["service_ok"] if remote_logo_access else labels["service_down"],
                    "note": (
                        "Logo providers are reachable, so missing brand marks can be fetched when needed."
                        if remote_logo_access
                        else "Logo providers are blocked here, so only logos already stored locally will appear."
                    ),
                    "is_available": remote_logo_access,
                },
            ]
            if settings_section == "local-market-store":
                all_local_market_rows = build_local_market_rows()
                local_store_current_page = local_store_page_value()
                local_store_total_pages = max((len(all_local_market_rows) - 1) // LOCAL_STORE_PAGE_SIZE + 1, 1)
                local_store_current_page = min(local_store_current_page, local_store_total_pages)
                page_group_index = (local_store_current_page - 1) // 5
                local_store_page_start = page_group_index * 5 + 1
                local_store_page_end = min(local_store_page_start + 4, local_store_total_pages)
                if local_store_page_start > 1:
                    local_store_prev_page = max(local_store_page_start - 5, 1)
                if local_store_page_end < local_store_total_pages:
                    local_store_next_page = local_store_page_end + 1
                start_index = (local_store_current_page - 1) * LOCAL_STORE_PAGE_SIZE
                end_index = start_index + LOCAL_STORE_PAGE_SIZE
                local_market_rows = all_local_market_rows[start_index:end_index]

        while len(ticker_slots) < MIN_TICKERS:
            ticker_slots.append("")

        return render_template(
            "index.html",
            error=error,
            notice=notice,
            date_notice=date_notice,
            interval=interval,
            period=period,
            interval_label=format_interval_label(interval),
            period_label=period_label,
            display_range=display_range,
            periods=SUPPORTED_PERIODS,
            period_labels={item: format_period_label(item) for item in SUPPORTED_PERIODS},
            series=series,
            profiles_json=[asdict(profile) for profile in profiles],
            performance_items=performance_items,
            ticker_slots=ticker_slots,
            max_tickers=MAX_TICKERS,
            min_tickers=MIN_TICKERS,
            include_dividends=include_dividends,
            range_mode=range_mode,
            exact_start=date_constraints.adjusted_start or exact_start,
            exact_end=date_constraints.adjusted_end or exact_end,
            version=app_meta.get("version", CODE_VERSION),
            updated_on=app_meta.get("updated_on", ""),
            current_view=current_view,
            settings_section=settings_section,
            remote_market_access=remote_market_access,
            settings_title=settings_title,
            settings_service_rows=settings_service_rows,
            local_market_rows=local_market_rows,
            local_store_current_page=local_store_current_page,
            local_store_total_pages=local_store_total_pages,
            local_store_page_start=local_store_page_start,
            local_store_page_end=local_store_page_end,
            local_store_prev_page=local_store_prev_page,
            local_store_next_page=local_store_next_page,
            submit_label=submit_label,
            page_title=page_title,
            report_heading=report_heading,
            chart_heading=chart_heading,
            dock_urls={view_name: build_view_url(view_name) for view_name in ("tickers", "portfolio", "settings")},
            settings_urls={section_name: build_settings_url(section_name) for section_name in ("about", "network", "local-market-store")},
            local_store_page_urls={page_number: build_local_store_page_url(page_number) for page_number in range(1, local_store_total_pages + 1)},
            labels=labels,
            theme=theme,
            chart_config=chart_config,
            logos=logos,
            defaults=defaults,
            endpoints={
                "symbolSearch": "/api/symbol-search",
                "dateConstraints": "/api/date-constraints",
            },
        )

    @app.post("/settings/local-market-store/action")
    def local_market_store_action():
        ticker = normalize_ticker_input(request.form.get("ticker", ""))
        action = request.form.get("action", "").strip().lower()
        page = max(parse_int_value(request.form.get("local_page"), 1), 1)
        redirect_url = f"/?view=settings&section=local-market-store&local_page={page}"

        if not ticker:
            return redirect(redirect_url)

        try:
            if action == "refresh":
                refresh_history_store(ticker, DEFAULT_INTERVAL)
                fetch_quote_profile(ticker, force_refresh=True)
            elif action == "delete":
                history_path = history_store_path_for(ticker)
                if history_path.exists():
                    history_path.unlink()
        except Exception:
            return redirect(redirect_url)

        return redirect(redirect_url)

    @app.get("/market-store/logos/<path:filename>")
    def market_store_logo(filename: str):
        for directory in (PRIMARY_LOGOS_STORE_DIR, SEARCH_LOGOS_STORE_DIR):
            candidate = directory / filename
            if candidate.exists():
                return send_from_directory(directory, filename)
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
        if len(requested_tickers) < MIN_TICKERS:
            return jsonify(asdict(build_date_constraint_payload()))
        validated_tickers = [validate_ticker_or_raise(ticker) for ticker in requested_tickers]
        if len(set(validated_tickers)) != len(validated_tickers):
            return jsonify(asdict(build_date_constraint_payload()))
        include_dividends = request.args.get("include_dividends", "0") == "1"
        requested_start = request.args.get("exact_start", "").strip() or None
        requested_end = request.args.get("exact_end", "").strip() or None
        datasets = [fetch_history(ticker, DEFAULT_INTERVAL, include_dividends) for ticker in validated_tickers]
        payload = build_date_constraint_payload(*datasets, requested_start=requested_start, requested_end=requested_end)
        return jsonify(asdict(payload))
