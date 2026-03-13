"""
HTTP route registration.

Code version: v3.12.0
"""

from __future__ import annotations

from dataclasses import asdict
from urllib.parse import urlencode

import pandas as pd
from flask import Flask, jsonify, redirect, render_template, request, send_from_directory

from .comparisons import build_series_payload, slice_dataset_for_period
from .email_settings import SmtpSettings, load_smtp_settings, sanitize_smtp_settings_for_view, save_smtp_settings, test_smtp_connection
from strategies.backtest import run_single_ticker_backtest
from strategies.loader import instantiate_strategy, list_enabled_strategies
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
PORTFOLIO_BENCHMARK_TICKERS = ("SPY", "QQQ")
PORTFOLIO_BENCHMARK_COLORS = {
    "SPY": "#8e8e93",
    "QQQ": "#c7c7cc",
}
SUPPORTED_VIEWS = {"tickers", "portfolio", "trade-messages", "settings"}
SUPPORTED_SETTINGS_SECTIONS = {"about", "network", "strategies", "email-smtp", "local-market-store"}
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
        weights: list[int] = []
        for index in range(1, slot_count + 1):
            raw_value = request.args.get(f"weight_{index}")
            if raw_value is None or str(raw_value).strip() == "":
                weights.append(0)
            else:
                weights.append(min(max(parse_int_value(raw_value, 0), 0), 100))
        return weights

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
            dataset = fetch_history(ticker, DEFAULT_INTERVAL, include_dividends)
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

        error = request.args.get("error", "").strip() or None
        notice = request.args.get("notice", "").strip() or None
        notice_is_floating = False
        date_notice = None
        exact_start_value = exact_start
        exact_end_value = exact_end
        display_range = ""
        profiles = []
        series = []
        performance_items = []
        portfolio_items = []
        portfolio_weights = []
        portfolio_total_return = None
        strategy_options = list_enabled_strategies()
        selected_strategy_id = request.args.get("strategy", strategy_options[0]["id"] if strategy_options else "").strip()
        backtest_initial_capital = max(parse_float_value(request.args.get("initial_capital"), 10000.0), 1.0)
        trade_backtest_result = None
        date_constraints = build_date_constraint_payload()
        ticker_slots = requested_tickers.copy() if requested_tickers else ["", ""]
        requested_weights = parse_requested_weights(max(len(ticker_slots), MIN_TICKERS)) if current_view == "portfolio" else []
        period_label = format_period_label(period)
        page_title = labels["hero_title"]
        report_heading = labels["performance_summary"]
        chart_heading = labels["chart_summary"]
        settings_title = labels["about"]
        settings_service_rows: list[dict[str, str | bool]] = []
        strategy_settings_rows: list[dict[str, object]] = []
        smtp_settings = sanitize_smtp_settings_for_view(load_smtp_settings())
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
        elif current_view == "trade-messages":
            page_title = labels["trade_messages_title"]
        elif current_view == "settings":
            page_title = labels["settings_title"]
            if settings_section == "network":
                settings_title = labels["network_self_check"]
            elif settings_section == "strategies":
                settings_title = labels["strategy_settings"]
            elif settings_section == "email-smtp":
                settings_title = labels["email_smtp"]
            elif settings_section == "local-market-store":
                settings_title = labels["local_market_store"]

        if period not in SUPPORTED_PERIODS:
            period = DEFAULT_PERIOD

        try:
            if current_view == "trade-messages":
                if not requested_tickers:
                    raise ValueError("")
                trade_ticker = validate_ticker_or_raise(requested_tickers[0])
                ticker_slots = [trade_ticker]
                trade_dataset = fetch_history(trade_ticker, interval, include_dividends)
                profiles = [fetch_quote_profile(trade_ticker, False)]
                date_constraints = build_date_constraint_payload(
                    trade_dataset,
                    requested_start=exact_start or None,
                    requested_end=exact_end or None,
                )
                if range_mode == "exact":
                    if not date_constraints.trading_dates:
                        raise ValueError("The selected exact range does not contain trading dates.")
                    aligned_start = pd.to_datetime(date_constraints.adjusted_start)
                    aligned_end = pd.to_datetime(date_constraints.adjusted_end)
                    trade_dataset = trade_dataset[
                        (trade_dataset["Date"] >= aligned_start) & (trade_dataset["Date"] <= aligned_end)
                    ].copy()
                    if trade_dataset.empty:
                        raise ValueError("The selected exact range does not contain trading dates.")
                    date_notice = date_constraints.message
                    exact_start_value = date_constraints.adjusted_start or exact_start
                    exact_end_value = date_constraints.adjusted_end or exact_end
                    period_label = "Exact range"
                else:
                    common_end_date = trade_dataset["Date"].max()
                    trade_dataset = slice_dataset_for_period(trade_dataset, period, common_end_date)
                    exact_start_value = trade_dataset["Date"].min().strftime("%Y-%m-%d")
                    exact_end_value = trade_dataset["Date"].max().strftime("%Y-%m-%d")
                    period_label = format_period_label(period)
                display_range = f"{format_display_date(trade_dataset['Date'].min())} - {format_display_date(trade_dataset['Date'].max())}"
                strategy = instantiate_strategy(selected_strategy_id)
                signal_result = strategy.compute_signals(trade_dataset)
                trade_backtest_result = run_single_ticker_backtest(signal_result, backtest_initial_capital)
            elif current_view in {"tickers", "portfolio"}:
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

        remote_market_access = has_remote_market_access()
        remote_logo_access = has_remote_logo_access()

        if current_view != "settings" and not remote_market_access and not error and not notice:
            notice = "Using bundled local market_store data because remote market access is unavailable."
            notice_is_floating = True

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
            strategy_settings_rows = [
                {
                    "name": item["name"],
                    "description": item.get("description", ""),
                    "supports": item.get("supports", {}),
                }
                for item in strategy_options
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

        if current_view == "trade-messages":
            ticker_slots = ticker_slots[:1] if ticker_slots else [""]
        else:
            while len(ticker_slots) < MIN_TICKERS:
                ticker_slots.append("")
        if current_view == "portfolio":
            if not portfolio_weights and any(ticker_slots):
                portfolio_weights = build_default_weights(len([ticker for ticker in ticker_slots if ticker]))
            while len(portfolio_weights) < len(ticker_slots):
                portfolio_weights.append(0)

        return render_template(
            "index.html",
            error=error,
            notice=notice,
            notice_is_floating=notice_is_floating,
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
            remote_market_access=remote_market_access,
            settings_title=settings_title,
            settings_service_rows=settings_service_rows,
            strategy_settings_rows=strategy_settings_rows,
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
            dock_urls={view_name: build_view_url(view_name) for view_name in ("tickers", "portfolio", "trade-messages", "settings")},
            settings_urls={section_name: build_settings_url(section_name) for section_name in ("about", "network", "strategies", "email-smtp", "local-market-store")},
            local_store_page_urls={page_number: build_local_store_page_url(page_number) for page_number in range(1, local_store_total_pages + 1)},
            labels=labels,
            theme=theme,
            chart_config=chart_config,
            logos=logos,
            defaults=defaults,
            smtp_settings=smtp_settings,
            strategy_options=strategy_options,
            selected_strategy_id=selected_strategy_id,
            backtest_initial_capital=backtest_initial_capital,
            trade_backtest_result=trade_backtest_result,
            current_view_name=current_view,
            endpoints={
                "symbolSearch": "/api/symbol-search",
                "dateConstraints": "/api/date-constraints",
            },
        )

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
        )
        if not updated_settings.password:
            updated_settings.password = current_settings.password
        save_smtp_settings(updated_settings)
        redirect_url = "/?view=settings&section=email-smtp"
        success, message = test_smtp_connection(updated_settings) if action == "test" else (True, "SMTP settings saved.")
        params = urlencode({
            "view": "settings",
            "section": "email-smtp",
            "notice": message if success else "",
            "error": "" if success else message,
        })
        return redirect(f"/?{params}")

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
        requested_view = request.args.get("view", "tickers").strip().lower()
        minimum_required = 1 if requested_view == "trade-messages" else MIN_TICKERS
        if len(requested_tickers) < minimum_required:
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
