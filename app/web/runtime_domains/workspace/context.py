"""Build the workspace web-runtime context.

Code version: v0.2.1
"""

from __future__ import annotations

from functools import partial

from app.web.runtime_domains.workspace.dependencies import (
    WORKSPACE_RUNTIME_DEPENDENCIES as WORKSPACE_RUNTIME_DEPENDENCIES,
    build_workspace_dependencies,
)
from app.web.runtime_domains.workspace.finalize import finalize_workspace_values
from app.web.runtime_domains.workspace.history import load_history_after_fetch_failure
from app.web.runtime_domains.workspace.request import build_workspace_request_context
from app.web.runtime_domains.workspace.response import render_workspace_response


def build_workspace_context(context: dict[str, object]) -> dict[str, object]:
    c = build_workspace_dependencies(context)

    def render_workspace_page(
        current_view: str,
        settings_section: str = "about",
        trade_section: str = "investment",
    ):
        (
            backtest_execution_mode,
            investment_cost_basis_method,
            date_display_settings,
            language_settings,
            labels,
            language_translations,
            translate_ui,
            language_history_rows,
            is_dock_prefetch,
            comparison_metric,
            is_market_cap_comparison,
            show_chips,
            view_max_tickers,
            requested_tickers,
            range_mode,
            period,
            exact_start,
            exact_end,
            price_only,
            include_dividends,
            stop_loss_enabled,
            show_trade_details,
            include_extended_hours,
            include_overnight,
            show_extended_hours_toggle,
            show_overnight_toggle,
            error,
            notice,
            broker_test_status,
            broker_test_message,
            broker_test_checked_at,
            longbridge_oauth_pending,
            floating_banner_icon_class,
        ) = build_workspace_request_context(current_view, c)
        exact_start_value = exact_start
        exact_end_value = exact_end
        chart_trading_date_value = ""
        display_range = ""
        profiles: list[c.QuoteProfile] = []
        series: list[c.SeriesPayload] = []
        performance_items = []
        portfolio_items = []
        portfolio_weights = []
        portfolio_shares = []
        portfolio_allocation_mode = c.parse_portfolio_allocation_mode()
        portfolio_total_return = None
        validated_tickers: list[str] = []
        control_tickers: list[str] = []
        strategy_options = c.list_enabled_strategies()
        strategy_option_groups = c.build_strategy_option_groups(strategy_options)
        selected_strategy_id = (
            "grid-trading"
            if c.request.args.get("workspace", "").strip().lower() == "grid-trading"
            else c.request.args.get(
                "strategy",
                c.defaults.get(
                    "backtest_strategy",
                    strategy_options[0]["id"] if strategy_options else "",
                )
                if current_view == "backtest"
                else (strategy_options[0]["id"] if strategy_options else ""),
            ).strip()
        )
        strategy_ids = {str(item["id"]) for item in strategy_options}
        if selected_strategy_id not in strategy_ids and strategy_options:
            selected_strategy_id = str(strategy_options[0]["id"])
        strategy_required_tickers = 1
        strategy_supports: dict[str, object] = {}
        strategy_default_tickers: list[str] = []
        if current_view in c.BACKTEST_VIEWS:
            requested_tickers, strategy_required_tickers, strategy_supports = (
                c.resolve_backtest_tickers(
                    requested_tickers,
                    selected_strategy_id,
                )
            )
            _, strategy_default_tickers, _ = c.get_strategy_ticker_contract(
                selected_strategy_id
            )
            if not requested_tickers:
                fallback_ticker = c.normalize_ticker_input(
                    str(
                        c.defaults.get(
                            "backtest_ticker",
                            c.defaults.get("ticker_a", c.DEFAULT_TICKERS[0]),
                        )
                    )
                )
                requested_tickers, strategy_required_tickers, strategy_supports = (
                    c.resolve_backtest_tickers(
                        [fallback_ticker] if fallback_ticker else [],
                        selected_strategy_id,
                    )
                )
        selected_strategy_params = (
            c.collect_strategy_form_values(selected_strategy_id)
            if selected_strategy_id
            else {}
        )
        explicit_strategy_form_values = {
            key: value
            for key, value in selected_strategy_params.items()
            if c.request.args.get(key) is not None
            and str(c.request.args.get(key)).strip() != ""
        }
        strategy_form_fields = (
            c.build_strategy_form_fields(
                selected_strategy_id,
                explicit_strategy_form_values,
            )
            if selected_strategy_id
            else []
        )
        selected_strategy_runtime = (
            c.instantiate_strategy(selected_strategy_id)
            if selected_strategy_id
            else None
        )
        backtest_initial_capital = max(
            c.parse_float_value(
                c.request.args.get("capital", c.request.args.get("initial_capital")),
                float(c.defaults.get("backtest_capital", 10000.0))
                if current_view in c.BACKTEST_VIEWS
                else 10000.0,
            ),
            1.0,
        )
        dca_amount = max(
            c.parse_float_value(
                c.request.args.get("amount", selected_strategy_params.get("amount")),
                float(c.defaults.get("dca_amount", 1000.0)),
            ),
            1.0,
        )
        dca_frequency = (
            "weekly"
            if c.request.args.get(
                "frequency",
                str(
                    selected_strategy_params.get(
                        "frequency", c.defaults.get("dca_frequency", "monthly")
                    )
                ),
            )
            .strip()
            .lower()
            == "weekly"
            else "monthly"
        )
        dca_weekday = min(
            max(
                c.parse_int_value(
                    c.request.args.get(
                        "weekday", selected_strategy_params.get("weekday")
                    ),
                    c.parse_int_value(c.defaults.get("dca_weekday"), 0),
                ),
                0,
            ),
            6,
        )
        dca_month_day = min(
            max(
                c.parse_int_value(
                    c.request.args.get(
                        "month-day",
                        c.request.args.get(
                            "month_day", selected_strategy_params.get("month_day")
                        ),
                    ),
                    c.parse_int_value(c.defaults.get("dca_month_day"), 15),
                ),
                1,
            ),
            28,
        )
        requested_interval = (
            c.request.args.get(
                "interval", c.defaults.get("backtest_interval", c.DEFAULT_INTERVAL)
            )
            .strip()
            .lower()
        )
        supported_intervals = ["1d"]
        if current_view in c.BACKTEST_VIEWS and requested_tickers:
            try:
                validated_interval_tickers = [
                    c.validate_ticker_or_raise(ticker)
                    for ticker in requested_tickers[:strategy_required_tickers]
                ]
                supported_intervals = c._strategy_supported_execution_intervals(
                    selected_strategy_runtime,
                    validated_interval_tickers,
                )
            except ValueError:
                pass

        # Smart default for 1w period if interval is not specified
        if (
            not c.request.args.get("interval")
            and period == "1w"
            and "1m" in supported_intervals
        ):
            requested_interval = "1m"

        if requested_interval not in supported_intervals:
            requested_interval = supported_intervals[0]
        if current_view == "dca" or selected_strategy_id == "dca":
            requested_interval = "1d"
            supported_intervals = ["1d"]

        backtest_result = None
        dca_result = None
        backtest_market_refresh: dict[str, str | bool | None] | None = None
        ticker_slots = requested_tickers.copy() if requested_tickers else ["", ""]
        requested_weights = (
            c.parse_requested_weights(
                max(len(ticker_slots), c.MIN_TICKERS),
                numbered_ticker_limit=view_max_tickers,
            )
            if current_view == "portfolio"
            else []
        )
        requested_shares = (
            c.parse_requested_shares(
                max(len(ticker_slots), c.MIN_TICKERS),
                numbered_ticker_limit=view_max_tickers,
            )
            if current_view == "portfolio"
            else []
        )
        has_weight_query = bool(c.request.args.getlist("weight")) or any(
            key.startswith("weight_") for key in c.request.args.keys()
        )
        has_share_query = bool(c.request.args.getlist("shares")) or any(
            key.startswith("shares_") for key in c.request.args.keys()
        )
        if current_view == "portfolio" and not has_weight_query:
            requested_weights = [
                min(max(c.parse_int_value(value, 0), 0), 100)
                for value in c.defaults.get("portfolio_weights", [25, 25, 50])
            ][: max(len(requested_tickers), c.MIN_TICKERS)]
        if current_view == "portfolio" and portfolio_allocation_mode != "shares":
            requested_shares = [0] * max(len(ticker_slots), c.MIN_TICKERS)
        if (
            current_view == "portfolio"
            and portfolio_allocation_mode == "shares"
            and not has_share_query
        ):
            requested_shares = [0] * max(len(ticker_slots), c.MIN_TICKERS)
        period_label = c.format_period_label(period)
        page_title = labels["hero_title"]
        report_heading = labels["performance_summary"]
        chart_heading = labels["chart_summary"]
        settings_title = labels["about"]
        settings_service_rows: list[dict[str, c.Any]] = []
        strategy_settings_groups: list[dict[str, object]] = []
        style_token_rows: list[dict[str, object]] = []
        color_token_rows: list[dict[str, object]] = []
        export_image_rows: list[dict[str, object]] = []
        material_token_rows: list[dict[str, object]] = []
        cash_equivalent_rows: list[dict[str, object]] = []
        cash_equivalent_fund_rows: list[dict[str, object]] = []
        font_token_rows: list[dict[str, object]] = []
        smtp_settings = c.sanitize_smtp_settings_for_view(c.load_smtp_settings())
        broker_settings = c.sanitize_broker_settings_for_view(c.load_broker_settings())
        local_market_rows: list[dict[str, c.Any]] = []
        local_store_total_pages = 1
        local_store_current_page = 1
        local_store_pagination_items: list[dict[str, c.Any]] = []
        settings_tab = "current"
        settings_page_number = 1
        backtest_periods_by_interval: dict[str, list[str]] = {
            "1d": list(c.COMPARE_PERIODS_1D),
            "1m": list(c.SUPPORTED_PERIODS_1M),
        }

        settings_section = c.normalize_settings_section(settings_section)
        trade_section = c.normalize_trade_section(trade_section)

        if current_view == "settings":
            settings_tab = (
                c.resolve_settings_tab() if settings_section == "general" else "current"
            )
            if settings_section == "general":
                settings_page_number = c.settings_page_value()
                language_row_count = (
                    len(language_settings.translations)
                    if settings_tab == "current"
                    else max(len(language_history_rows), 1)
                )
                language_total_pages = max(
                    (language_row_count - 1) // c.SETTINGS_LANGUAGE_PAGE_SIZE + 1,
                    1,
                )
                settings_page_number = min(settings_page_number, language_total_pages)
            elif settings_section == "local-market-store":
                settings_page_number = c.settings_page_value()

        if current_view == "settings" and settings_section == "about":
            error = None
            notice = None

        if current_view == "prices":
            if is_market_cap_comparison:
                page_title = labels.get("dock_market_caps", "Market cap comparison")
                report_heading = labels.get("dock_market_caps", "Market cap comparison")
                chart_heading = translate_ui("Market cap history")
            else:
                page_title = labels.get("dock_prices", "Price performance")
                report_heading = labels.get("dock_prices", "Price performance")
                chart_heading = translate_ui("Price history")
        elif current_view == "market-caps":
            page_title = labels.get("dock_market_caps", "Market cap comparison")
            report_heading = labels.get("dock_market_caps", "Market cap comparison")
            chart_heading = translate_ui("Market cap history")
        elif current_view == "portfolio":
            page_title = labels["portfolio_title"]
            report_heading = labels["portfolio_summary"]
            chart_heading = labels["portfolio_chart"]
        elif current_view == "dca":
            page_title = labels["dca_title"]
            report_heading = labels["dca_metrics"]
            chart_heading = labels["dca_chart"]
        elif current_view in c.BACKTEST_VIEWS:
            page_title = labels["backtest_title"]
        elif current_view == "settings":
            page_title = labels["settings_title"]
            if settings_section == "network":
                settings_title = labels["network_self_check"]
            elif settings_section == "general":
                settings_title = translate_ui("General")
            elif settings_section == "backtest":
                settings_title = translate_ui("Backtest")
            elif settings_section == "investment":
                settings_title = translate_ui("Investment")
            elif settings_section == "font-tokens":
                settings_title = translate_ui("Font tokens")
            elif settings_section == "color-tokens":
                settings_title = translate_ui("Color tokens")
            elif settings_section == "material-tokens":
                settings_title = translate_ui("Material tokens")
            elif settings_section == "strategies":
                settings_title = labels["strategy_settings"]
            elif settings_section == "email-smtp":
                settings_title = labels["email_smtp"]
            elif settings_section == "broker-access":
                settings_title = translate_ui("Broker access")
            elif settings_section == "local-market-store":
                settings_title = labels["local_market_store"]
            elif settings_section == "clear-caches":
                settings_title = translate_ui("Clear caches")
            elif settings_section == "style-tokens":
                settings_title = translate_ui("Style tokens")
            elif settings_section == "export-image":
                settings_title = translate_ui("Export images")
            elif settings_section == "cash-equivalents":
                settings_title = translate_ui("Cash equivalents")
        elif current_view == "trade":
            page_title = labels["trade_title"]
            settings_title = labels["trade_title"]
            if trade_section == "investment":
                page_title = "Investment"
                settings_title = "Investment"
            elif trade_section == "live-trading":
                page_title = "Live trading"
                settings_title = "Live trading"

        supported_periods = (
            list(c.COMPARE_PERIODS_1D)
            if current_view in {"tickers", "market-caps", "prices", "portfolio"}
            else list(c.SUPPORTED_PERIODS_1M)
            if requested_interval == "1m" and "1m" in supported_intervals
            else list(c.SUPPORTED_PERIODS_1D)
        )

        if period not in supported_periods and not (
            current_view in c.BACKTEST_VIEWS and requested_interval == "1m"
        ):
            period = supported_periods[0] if supported_periods else c.DEFAULT_PERIOD

        handle_fetch_history_failure = partial(
            load_history_after_fetch_failure,
            c,
        )

        try:
            if current_view in c.BACKTEST_VIEWS and selected_strategy_id == "dca":
                (
                    dca_result,
                    trade_ticker,
                    requested_interval,
                    date_constraints,
                    trade_dataset,
                    selected_strategy_id,
                    selected_strategy_params,
                    dca_refresh_status,
                ) = c._run_dca_from_request(requested_tickers)
                backtest_market_refresh = {
                    "daily_error": bool(dca_refresh_status.get("daily_error")),
                    "intraday_error": False,
                }
                c.record_strategy_usage(selected_strategy_id)
                ticker_slots = [trade_ticker]
                profiles = [c.fetch_quote_profile(trade_ticker, False)]
                backtest_periods_by_interval = {
                    "1d": list(c.COMPARE_PERIODS_1D),
                    "1m": c.build_supported_periods_for_history_store(
                        trade_ticker, "1m"
                    ),
                }
                supported_periods = list(c.COMPARE_PERIODS_1D)
                period, period_notice = c.resolve_requested_period_from_supported(
                    period,
                    supported_periods,
                    earliest_available=trade_dataset["Date"].min(),
                )
                if period_notice and notice is None:
                    notice = period_notice
                elif period_notice:
                    notice += " " + period_notice
                exact_start_value = trade_dataset["Date"].min().strftime("%Y-%m-%d")
                exact_end_value = trade_dataset["Date"].max().strftime("%Y-%m-%d")
                period_label = (
                    "Exact range"
                    if range_mode == "exact"
                    else c.format_period_label(period)
                )
                display_range = (
                    f"{c.format_display_date(trade_dataset['Date'].min())} - "
                    f"{c.format_display_date(trade_dataset['Date'].max())}"
                )
                if backtest_market_refresh.get("daily_error"):
                    refresh_notice = (
                        "Could not refresh the latest 1d cache automatically, so the recurring-investment "
                        "simulation reused the newest local daily data."
                    )
                    notice = f"{notice} {refresh_notice}" if notice else refresh_notice
            elif current_view in c.BACKTEST_VIEWS:
                uses_strategy_market_data = (
                    str(
                        getattr(
                            selected_strategy_runtime,
                            "strategy_market_data_source",
                            "default",
                        )
                    )
                    .strip()
                    .lower()
                    != "default"
                )
                if requested_tickers and not uses_strategy_market_data:
                    backtest_refreshes = [
                        c.ensure_latest_backtest_caches(
                            c.validate_ticker_or_raise(ticker)
                        )
                        for ticker in requested_tickers[:strategy_required_tickers]
                    ]
                    backtest_market_refresh = {
                        "daily_error": any(
                            bool((refresh or {}).get("daily_error"))
                            for refresh in backtest_refreshes
                        ),
                        "intraday_error": any(
                            bool((refresh or {}).get("intraday_error"))
                            for refresh in backtest_refreshes
                        ),
                    }
                strategy_cacheable = bool(
                    getattr(selected_strategy_runtime, "backtest_cacheable", True)
                )
                cache_key = c._get_backtest_cache_key() if strategy_cacheable else ""
                if strategy_cacheable and cache_key in c._cached_backtest:
                    # Cache hit - use cached result directly
                    (
                        backtest_result,
                        trade_ticker,
                        requested_interval,
                        date_constraints,
                        trade_dataset,
                        selected_strategy_id,
                        selected_strategy_params,
                    ) = c._cached_backtest[cache_key]
                else:
                    # Cache miss - need to recompute and cache
                    (
                        backtest_result,
                        trade_ticker,
                        requested_interval,
                        date_constraints,
                        trade_dataset,
                        selected_strategy_id,
                        selected_strategy_params,
                        run_refresh_status,
                    ) = c._run_backtest_from_request()
                    if backtest_market_refresh is None:
                        backtest_market_refresh = {
                            "daily_error": bool(run_refresh_status.get("daily_error")),
                            "intraday_error": bool(
                                run_refresh_status.get("intraday_error")
                            ),
                        }
                    else:
                        backtest_market_refresh["daily_error"] = bool(
                            backtest_market_refresh.get("daily_error")
                            or run_refresh_status.get("daily_error")
                        )
                        backtest_market_refresh["intraday_error"] = bool(
                            backtest_market_refresh.get("intraday_error")
                            or run_refresh_status.get("intraday_error")
                        )
                    if strategy_cacheable:
                        c._cached_backtest[cache_key] = (
                            backtest_result,
                            trade_ticker,
                            requested_interval,
                            date_constraints,
                            trade_dataset,
                            selected_strategy_id,
                            selected_strategy_params,
                        )
                        # Limit cache size to prevent memory growth (keep last 8 cached results)
                        if len(c._cached_backtest) > 8:
                            oldest_key = next(iter(c._cached_backtest.keys()))
                            del c._cached_backtest[oldest_key]
                c.record_strategy_usage(selected_strategy_id)
                ticker_slots = requested_tickers[:strategy_required_tickers]
                profiles = [
                    c.fetch_quote_profile(ticker, False) for ticker in ticker_slots
                ]
                backtest_periods_by_interval = {
                    "1d": list(c.COMPARE_PERIODS_1D),
                    "1m": c.build_supported_periods_for_history_store(
                        trade_ticker, "1m"
                    ),
                }
                interval_notice = (
                    str(backtest_result.get("strategy_interval_notice", "")).strip()
                    if isinstance(backtest_result, dict)
                    else ""
                )
                if interval_notice:
                    notice = (
                        f"{notice} {interval_notice}" if notice else interval_notice
                    )
                if backtest_market_refresh:
                    refresh_notices: list[str] = []
                    if backtest_market_refresh.get("daily_error"):
                        refresh_notices.append(
                            "Could not refresh the latest 1d cache automatically, so the backtest reused the newest local daily data."
                        )
                    if backtest_market_refresh.get("intraday_error"):
                        refresh_notices.append(
                            "Could not refresh the latest 1m cache automatically, so the backtest reused the newest local intraday data when available."
                        )
                    if refresh_notices:
                        refresh_notice = " ".join(refresh_notices)
                        if notice is None:
                            notice = refresh_notice
                        else:
                            notice += " " + refresh_notice
                visible_backtest_dates = (
                    c.market_trading_dates_for_history(trade_dataset, trade_ticker)
                    if requested_interval == "1m"
                    else c.pd.to_datetime(trade_dataset["Date"], errors="coerce")
                )
                visible_start = visible_backtest_dates.min()
                visible_end = visible_backtest_dates.max()
                supported_periods = backtest_periods_by_interval.get(
                    requested_interval, list(c.SUPPORTED_PERIODS_1D)
                )
                period, period_notice = c.resolve_requested_period_from_supported(
                    period,
                    supported_periods,
                    earliest_available=visible_start
                    if not trade_dataset.empty
                    else None,
                )
                if period_notice and notice is None:
                    notice = period_notice
                elif period_notice:
                    notice += " " + period_notice
                exact_start_value = c.pd.Timestamp(visible_start).strftime("%Y-%m-%d")
                exact_end_value = c.pd.Timestamp(visible_end).strftime("%Y-%m-%d")
                if range_mode == "exact":
                    period_label = "Exact range"
                else:
                    period_label = c.format_period_label(period)
                display_range = (
                    f"{c.format_display_date(visible_start)} - "
                    f"{c.format_display_date(visible_end)}"
                )
            elif current_view == "dca":
                if requested_tickers:
                    dca_ticker = c.validate_ticker_or_raise(requested_tickers[0])
                    dca_refresh_failures = c.ensure_latest_daily_caches([dca_ticker])
                else:
                    raise ValueError("No ticker selected for recurring investment.")

                try:
                    dca_dataset = c.fetch_history(
                        dca_ticker, False, dividend_mode="price"
                    )
                except ValueError:
                    dca_dataset = handle_fetch_history_failure(
                        dca_ticker, False, dividend_mode="price"
                    )

                date_constraints = c.build_date_constraint_payload(
                    dca_dataset,
                    requested_start=exact_start or None,
                    requested_end=exact_end or None,
                )
                if range_mode == "exact":
                    if not date_constraints.trading_dates:
                        raise ValueError(
                            "The selected exact range does not contain trading dates."
                        )
                    dca_dataset = c.slice_dataset_to_exact_range(
                        dca_dataset,
                        date_constraints.adjusted_start,
                        date_constraints.adjusted_end,
                    )
                else:
                    supported_periods = c.build_supported_periods_from_dates(
                        dca_dataset["Date"], interval="1d"
                    )
                    period, period_notice = c.resolve_requested_period_from_supported(
                        period,
                        supported_periods,
                        earliest_available=dca_dataset["Date"].min()
                        if not dca_dataset.empty
                        else None,
                    )
                    if period_notice and notice is None:
                        notice = period_notice
                    elif period_notice:
                        notice += " " + period_notice
                    dca_dataset = c.slice_dataset_for_period(
                        dca_dataset, period, dca_dataset["Date"].max()
                    )

                if dca_dataset.empty:
                    raise ValueError(
                        f"No market data available for {dca_ticker} in the selected range."
                    )

                range_start = c.pd.Timestamp(dca_dataset["Date"].min()).strftime(
                    "%Y-%m-%d"
                )
                range_end = c.pd.Timestamp(dca_dataset["Date"].max()).strftime(
                    "%Y-%m-%d"
                )
                dca_result = c.simulate_recurring_investment(
                    dca_ticker,
                    dca_dataset,
                    amount_per_period=dca_amount,
                    frequency=dca_frequency,
                    weekday=dca_weekday,
                    month_day=dca_month_day,
                    reinvest_cash_dividends=include_dividends,
                    include_cash_dividends=not price_only,
                    stop_loss_enabled=stop_loss_enabled,
                )
                profiles = [c.fetch_quote_profile(dca_ticker, False)]
                ticker_slots = [dca_ticker]
                exact_start_value = range_start
                exact_end_value = range_end
                period_label = (
                    "Exact range"
                    if range_mode == "exact"
                    else c.format_period_label(period)
                )
                display_range = f"{c.format_display_date(dca_dataset['Date'].min())} - {c.format_display_date(dca_dataset['Date'].max())}"
                if dca_refresh_failures:
                    failed_preview = ", ".join(dca_refresh_failures)
                    refresh_notice = (
                        f"Could not refresh the latest trading-day cache for {failed_preview}. "
                        "Using the newest local daily data currently available."
                    )
                    if notice is None:
                        notice = refresh_notice
                    else:
                        notice += " " + refresh_notice
            elif current_view in {"tickers", "market-caps", "prices", "portfolio"}:
                if requested_tickers and len(requested_tickers) >= c.MIN_TICKERS:
                    if is_dock_prefetch:
                        validated_tickers = [
                            c.normalize_ticker_input(t) or t for t in requested_tickers
                        ]
                        profiles = [
                            c.QuoteProfile(ticker=t, company_name=t, logo_url="")
                            for t in validated_tickers
                        ]
                        if current_view == "portfolio":
                            portfolio_weights = requested_weights or [0] * len(
                                validated_tickers
                            )
                            portfolio_shares = requested_shares or [0] * len(
                                validated_tickers
                            )
                            portfolio_items = [
                                {
                                    "ticker": t,
                                    "company_name": t,
                                    "logo_url": "",
                                    "weight": w,
                                    "shares": s,
                                    "initial_price": None,
                                    "growth_multiple": 1.0,
                                    "color": "transparent",
                                }
                                for t, w, s in zip(
                                    validated_tickers,
                                    portfolio_weights,
                                    portfolio_shares,
                                )
                            ]
                            portfolio_total_return = 0.0
                        else:
                            series = [
                                c.SeriesPayload(
                                    ticker=t,
                                    dates=[""],
                                    raw_dates=[""],
                                    normalized_returns=[0.0],
                                    color="transparent",
                                    glow=False,
                                )
                                for t in validated_tickers
                            ]
                            performance_items = [
                                {
                                    "ticker": t,
                                    "company_name": t,
                                    "logo_url": "",
                                    "ending_return": 0.0,
                                    "ttm_dividend_yield": None,
                                    "color": "transparent",
                                    "shadow_color": "transparent",
                                    "is_winner": False,
                                    "is_dividend_yield_winner": False,
                                }
                                for t in validated_tickers
                            ]
                        display_range = "Loading range..."
                        ticker_slots = (control_tickers or validated_tickers).copy()
                        continue_process_tickers = False
                    else:
                        validated_tickers = [
                            c.validate_ticker_or_raise(ticker)
                            for ticker in requested_tickers
                        ]
                        continue_process_tickers = True
                    if continue_process_tickers:
                        if len(set(validated_tickers)) != len(validated_tickers):
                            raise ValueError("Ticker symbols must be unique.")

                        control_tickers = validated_tickers.copy()
                        overnight_tickers = c.resolve_compare_overnight_tickers(
                            control_tickers
                        )
                        show_overnight_toggle = (
                            current_view in {"tickers", "market-caps", "prices"}
                            and len(overnight_tickers) <= view_max_tickers
                            and c.supports_compare_overnight(control_tickers, period)
                            and c.has_compare_overnight_market_data_source()
                        )
                        if not show_overnight_toggle:
                            include_overnight = False
                        elif include_overnight:
                            control_tickers = [
                                c.canonical_compare_overnight_ticker(ticker)
                                for ticker in control_tickers
                            ]
                            if len(set(control_tickers)) != len(control_tickers):
                                raise ValueError(
                                    "SKHYV and SKHY identify the same security."
                                )
                            validated_tickers = overnight_tickers

                        freshness_refresh_failures: list[str] = []
                        is_local_intraday_price_request = (
                            current_view in {"market-caps", "prices"}
                            and range_mode != "exact"
                            and period in {"1d", "3d", "1w"}
                        )
                        if (
                            current_view
                            in {"tickers", "market-caps", "prices", "portfolio"}
                            and not is_local_intraday_price_request
                        ):
                            freshness_refresh_failures = c.ensure_latest_daily_caches(
                                validated_tickers
                            )

                        # Try to fetch datasets, handle missing remote data by falling back to any available local data
                        datasets: list[c.pd.DataFrame | None] = []
                        failed_fetches: list[str] = []
                        completely_missing: list[str] = []
                        dividend_mode = c.resolve_workspace_dividend_mode(
                            price_only, include_dividends
                        )
                        for ticker in validated_tickers:
                            try:
                                datasets.append(
                                    c.fetch_history(
                                        ticker,
                                        include_dividends,
                                        dividend_mode=dividend_mode,
                                    )
                                )
                            except ValueError as fetch_exc:
                                if "No market data returned" in str(
                                    fetch_exc
                                ) or "Local market data for" in str(fetch_exc):
                                    try:
                                        dataset = handle_fetch_history_failure(
                                            ticker,
                                            include_dividends,
                                            dividend_mode=dividend_mode,
                                        )
                                        datasets.append(dataset)
                                        failed_fetches.append(ticker)
                                    except ValueError:
                                        completely_missing.append(ticker)
                                        datasets.append(None)
                                else:
                                    raise

                        if completely_missing and current_view != "portfolio":
                            missing_ticker_list = ", ".join(completely_missing)
                            missing_market_data_error = (
                                f"No local or remote market data is available for {missing_ticker_list}. "
                                "The selected ticker list was kept unchanged."
                            )
                            raise c.MissingComparisonMarketDataError(
                                missing_market_data_error
                            )

                        # Portfolio may replace each missing slot with the first successfully
                        # loaded unique local/default candidate. Other comparison workspaces
                        # preserve the selected security identities and fail above.
                        if completely_missing:
                            reserved_tickers = set(validated_tickers)
                            replacement_candidates: list[str] = []
                            for raw_candidate in [
                                *c.list_local_market_tickers(),
                                *c.DEFAULT_TICKERS,
                            ]:
                                candidate = c.normalize_ticker_input(raw_candidate)
                                if (
                                    not candidate
                                    or candidate in reserved_tickers
                                    or candidate in replacement_candidates
                                ):
                                    continue
                                replacement_candidates.append(candidate)

                            for idx, missing_ticker in enumerate(validated_tickers):
                                if datasets[idx] is not None:
                                    continue
                                replacement = ""
                                replacement_dataset: c.pd.DataFrame | None = None
                                while (
                                    replacement_candidates
                                    and replacement_dataset is None
                                ):
                                    candidate = replacement_candidates.pop(0)
                                    try:
                                        replacement_dataset = c.fetch_history(
                                            candidate,
                                            include_dividends,
                                            dividend_mode=dividend_mode,
                                        )
                                        replacement = candidate
                                    except (
                                        ImportError,
                                        OSError,
                                        ValueError,
                                        KeyError,
                                        TypeError,
                                    ):
                                        continue
                                if replacement_dataset is None:
                                    raise ValueError(
                                        f"{missing_ticker} has no local or remote market data, "
                                        "and no unique replacement dataset is available."
                                    )
                                validated_tickers[idx] = replacement
                                if idx < len(control_tickers):
                                    control_tickers[idx] = replacement
                                datasets[idx] = replacement_dataset
                                reserved_tickers.add(replacement)
                                if notice is None:
                                    notice = f"{missing_ticker} has no local or remote market data, automatically replaced with {replacement}."
                                else:
                                    notice += f" {missing_ticker} has no local or remote market data, automatically replaced with {replacement}."

                        if len(set(validated_tickers)) != len(validated_tickers):
                            raise ValueError(
                                "Ticker symbols must be unique after market-data replacement."
                            )
                        if any(dataset is None for dataset in datasets):
                            raise ValueError(
                                "Every selected ticker must have an aligned market dataset."
                            )
                        datasets = [
                            dataset for dataset in datasets if dataset is not None
                        ]

                        profiles = [
                            c.fetch_quote_profile(ticker, False)
                            for ticker in validated_tickers
                        ]
                        market_cap_split_events = (
                            {
                                ticker: c.extract_stock_split_events(dataset)
                                for ticker, dataset in zip(validated_tickers, datasets)
                            }
                            if is_market_cap_comparison
                            else {}
                        )
                        market_cap_split_actions_authoritative = (
                            {
                                ticker: bool(
                                    dataset.attrs.get(
                                        "stock_split_actions_authoritative"
                                    )
                                )
                                for ticker, dataset in zip(validated_tickers, datasets)
                            }
                            if is_market_cap_comparison
                            else {}
                        )
                        include_extended_hours = current_view in {
                            "tickers",
                            "market-caps",
                            "prices",
                        } and c.supports_compare_extended_hours(
                            validated_tickers, period
                        )
                        show_extended_hours_toggle = False
                        intraday_period_candidates = set(c.COMPARE_INTRADAY_PERIODS)
                        intraday_period_sets = [
                            {
                                candidate
                                for candidate in c.build_supported_periods_for_history_store(
                                    ticker, "1m"
                                )
                                if candidate in intraday_period_candidates
                            }
                            for ticker in validated_tickers
                        ]
                        supported_periods = c.build_supported_compare_periods(
                            c.extract_union_dates(datasets),
                            intraday_period_sets,
                        )
                        intraday_supported_periods = [
                            candidate
                            for candidate in supported_periods
                            if candidate in intraday_period_candidates
                        ]
                        if (
                            range_mode != "exact"
                            and period not in intraday_period_candidates
                        ):
                            period, period_notice = (
                                c.resolve_requested_period_from_supported(
                                    period,
                                    supported_periods,
                                    earliest_available=min(
                                        dataset["Date"].min() for dataset in datasets
                                    ),
                                )
                            )
                            if period_notice and notice is None:
                                notice = period_notice
                            elif period_notice:
                                notice = f"{notice} {period_notice}"
                        date_constraints = c.build_date_constraint_payload(
                            *datasets,
                            requested_start=exact_start or None,
                            requested_end=exact_end or None,
                        )

                        # Auto-switch to Exact mode if we're in Relative mode and any ticker couldn't fetch full recent data
                        if range_mode != "exact" and len(failed_fetches) > 0:
                            # Get the minimal max date across all datasets (latest available data is bounded by the ticker with incomplete data)
                            common_max_end = min(
                                dataset["Date"].max() for dataset in datasets
                            )
                            # The requested period offset stays the same but end is now at the latest available common date
                            requested_start = (
                                max(
                                    dataset["Date"].min() for dataset in datasets
                                ).normalize()
                                if period == "max"
                                else (
                                    common_max_end - c.PERIOD_OFFSETS[period]
                                ).normalize()
                            )
                            adjusted_start = requested_start.strftime("%Y-%m-%d")
                            adjusted_end = common_max_end.strftime("%Y-%m-%d")
                            # Rebuild date constraints with the new exact range
                            date_constraints = c.build_date_constraint_payload(
                                *datasets,
                                requested_start=adjusted_start,
                                requested_end=adjusted_end,
                            )
                            range_mode = "exact"
                            period_label = "Exact range"
                            ticker_list = ", ".join(failed_fetches)
                            auto_notice = (
                                f"Could not retrieve the latest market data for {ticker_list}. "
                                f"Automatically switched to exact range from {c.format_display_date(c.pd.to_datetime(adjusted_start))} "
                                f"to {c.format_display_date(common_max_end)} based on available local data."
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

                        is_exact_one_day_compare = (
                            current_view in {"tickers", "market-caps", "prices"}
                            and range_mode == "exact"
                            and period == "1d"
                        )
                        is_intraday_compare_period = (
                            range_mode != "exact" and period in {"1d", "3d", "1w"}
                        )
                        exact_range_trading_dates = c.exact_trading_dates_in_range(
                            date_constraints
                        )
                        is_exact_short_intraday_compare = (
                            current_view in {"tickers", "market-caps", "prices"}
                            and range_mode == "exact"
                            and period in {"3d", "1w"}
                            and not is_exact_one_day_compare
                            and 2 <= len(exact_range_trading_dates) <= 5
                        )
                        if is_exact_one_day_compare:
                            date_constraints = (
                                c.build_one_day_intraday_date_constraint_payload(
                                    validated_tickers,
                                    requested_start=exact_start or None,
                                    requested_end=exact_end or None,
                                    include_overnight_flag=include_overnight,
                                )
                            )
                        elif (
                            current_view in {"tickers", "market-caps", "prices"}
                            and range_mode == "exact"
                            and period in {"3d", "1w"}
                        ):
                            intraday_date_constraints = (
                                c.build_short_intraday_date_constraint_payload(
                                    validated_tickers,
                                    requested_start=exact_start or None,
                                    requested_end=exact_end or None,
                                )
                            )
                            if intraday_date_constraints.trading_dates:
                                date_constraints = intraday_date_constraints
                                exact_range_trading_dates = (
                                    c.exact_trading_dates_in_range(date_constraints)
                                )
                                is_exact_short_intraday_compare = (
                                    2 <= len(exact_range_trading_dates) <= 5
                                )

                        if is_exact_one_day_compare:
                            if not date_constraints.trading_dates:
                                raise ValueError(
                                    "The selected tickers do not share any common trading dates."
                                )
                            target_trading_date = (
                                date_constraints.adjusted_start
                                or date_constraints.adjusted_end
                                or date_constraints.max_date
                            )
                            if not target_trading_date:
                                raise ValueError("Select a shared trading date.")
                            live_session_date = c.pd.Timestamp.now(
                                tz="Asia/Shanghai"
                            ).date()
                            selected_markets = {
                                c.infer_ticker_market(ticker)
                                for ticker in validated_tickers
                            }
                            aligned_datasets, axis_trading_date = (
                                c.build_current_compare_one_day_datasets(
                                    validated_tickers,
                                    daily_datasets=datasets,
                                    target_trading_date=target_trading_date,
                                    live_session_date=live_session_date,
                                    include_extended_hours_flag=include_extended_hours,
                                    include_overnight_flag=include_overnight,
                                    force_refresh=False,
                                )
                            )
                            if (
                                c.pd.to_datetime(
                                    target_trading_date, errors="coerce"
                                ).date()
                                == live_session_date
                                and len(selected_markets) == 1
                            ):
                                aligned_datasets = c.truncate_intraday_datasets_to_common_live_timestamp(
                                    aligned_datasets
                                )
                            chart_trading_date_value = c.pd.to_datetime(
                                axis_trading_date
                            ).strftime("%Y-%m-%d")
                            exact_start_value = c.pd.to_datetime(
                                target_trading_date
                            ).strftime("%Y-%m-%d")
                            exact_end_value = exact_start_value
                            period_label = "Trading date"
                        elif range_mode == "exact":
                            if not date_constraints.trading_dates:
                                raise ValueError(
                                    "The selected tickers do not share any common trading dates."
                                )
                            if is_exact_short_intraday_compare:
                                intraday_datasets = []
                                live_session_date = c.pd.Timestamp.now(
                                    tz=c.market_timezone_for_ticker(
                                        validated_tickers[0]
                                    )
                                ).date()
                                should_append_exact_live = (
                                    bool(exact_range_trading_dates)
                                    and c.pd.to_datetime(
                                        exact_range_trading_dates[-1],
                                        errors="coerce",
                                    ).date()
                                    == live_session_date
                                    and any(
                                        c.is_market_regular_session_active_for_ticker(
                                            ticker
                                        )
                                        for ticker in validated_tickers
                                    )
                                )
                                for ticker in validated_tickers:
                                    raw_intraday_dataset = c.fetch_history(
                                        ticker,
                                        include_dividends=False,
                                        interval="1m",
                                        dividend_mode="price",
                                    )
                                    if should_append_exact_live:
                                        raw_intraday_dataset = c.append_live_compare_intraday_dataset(
                                            ticker,
                                            raw_intraday_dataset,
                                            live_trading_date=live_session_date,
                                            include_extended_hours_flag=include_extended_hours,
                                            force_refresh=True,
                                        )[0]
                                    intraday_dataset = (
                                        c.prepare_intraday_dataset_for_compare(
                                            raw_intraday_dataset,
                                            ticker,
                                            regular_session_only=True,
                                        )
                                    )
                                    intraday_datasets.append(
                                        c.slice_intraday_dataset_to_trading_dates(
                                            intraday_dataset,
                                            ticker,
                                            exact_range_trading_dates,
                                        )
                                    )
                                aligned_datasets = (
                                    c.align_intraday_datasets_for_compare(
                                        intraday_datasets,
                                        validated_tickers,
                                    )
                                )
                                if (
                                    should_append_exact_live
                                    and len(
                                        {
                                            c.infer_ticker_market(ticker)
                                            for ticker in validated_tickers
                                        }
                                    )
                                    == 1
                                ):
                                    aligned_datasets = c.truncate_intraday_datasets_to_common_live_timestamp(
                                        aligned_datasets
                                    )
                            else:
                                aligned_datasets = c.align_datasets_on_common_dates(
                                    datasets
                                )
                                aligned_datasets = c.slice_datasets_to_exact_range(
                                    aligned_datasets,
                                    date_constraints.adjusted_start,
                                    date_constraints.adjusted_end,
                                )
                            if any(dataset.empty for dataset in aligned_datasets):
                                raise ValueError(
                                    "The selected exact range does not contain shared trading dates."
                                )
                            exact_start_value = (
                                date_constraints.adjusted_start
                                or date_constraints.min_date
                                or ""
                            )
                            exact_end_value = (
                                date_constraints.adjusted_end
                                or date_constraints.max_date
                                or ""
                            )
                            period_label = "Exact range"
                        elif is_intraday_compare_period:
                            if period not in intraday_supported_periods:
                                earliest_intraday = (
                                    min(dataset["Date"].min() for dataset in datasets)
                                    if datasets
                                    else None
                                )
                                period, intraday_notice = (
                                    c.resolve_requested_period_from_supported(
                                        period,
                                        intraday_supported_periods
                                        or list(c.COMPARE_PERIODS_1D),
                                        earliest_intraday,
                                    )
                                )
                                if intraday_notice and notice is None:
                                    notice = intraday_notice
                                elif intraday_notice:
                                    notice = f"{notice} {intraday_notice}"
                            intraday_datasets: list[c.pd.DataFrame] = []
                            live_session_date = c.pd.Timestamp.now(
                                tz=c.market_timezone_for_ticker(validated_tickers[0])
                            ).date()
                            selected_markets = {
                                c.infer_ticker_market(ticker)
                                for ticker in validated_tickers
                            }
                            should_append_relative_live = any(
                                c.is_market_regular_session_active_for_ticker(ticker)
                                for ticker in validated_tickers
                            )
                            if period == "1d":
                                all_selected_tickers_are_us = all(
                                    c.infer_ticker_market(ticker) == "US"
                                    for ticker in validated_tickers
                                )
                                refresh_stale_local = (
                                    len(
                                        {
                                            c.infer_ticker_market(ticker)
                                            for ticker in validated_tickers
                                        }
                                    )
                                    > 1
                                )
                                loaded_intraday_datasets: list[
                                    c.pd.DataFrame | None
                                ] = []
                                first_intraday_error: Exception | None = None
                                for ticker in validated_tickers:
                                    try:
                                        loaded_intraday_datasets.append(
                                            c.load_compare_one_day_intraday_dataset(
                                                ticker,
                                                include_extended_hours_flag=include_extended_hours,
                                                include_overnight_flag=include_overnight,
                                                refresh_stale_local=refresh_stale_local,
                                            )
                                        )
                                    except Exception as exc:  # noqa: BLE001
                                        if not all_selected_tickers_are_us:
                                            raise
                                        first_intraday_error = (
                                            first_intraday_error or exc
                                        )
                                        loaded_intraday_datasets.append(None)
                                        c.LOGGER.info(
                                            "Keeping %s pending on the one-day axis until its first regular-session quote: %s",
                                            ticker,
                                            exc,
                                        )
                                available_intraday_datasets = [
                                    dataset
                                    for dataset in loaded_intraday_datasets
                                    if dataset is not None and not dataset.empty
                                ]
                                if not available_intraday_datasets:
                                    if first_intraday_error is not None:
                                        raise first_intraday_error
                                    raise ValueError(
                                        "The selected tickers do not have one-day intraday data yet."
                                    )
                                latest_available_timestamp = max(
                                    c.pd.Timestamp(dataset["Date"].max())
                                    for dataset in available_intraday_datasets
                                )
                                latest_available_day = latest_available_timestamp.date()
                                has_pending_ticker = any(
                                    dataset is None
                                    for dataset in loaded_intraday_datasets
                                )
                                if (
                                    has_pending_ticker
                                    and not should_append_relative_live
                                    and latest_available_day != live_session_date
                                ):
                                    if first_intraday_error is not None:
                                        raise first_intraday_error
                                    raise ValueError(
                                        "A selected ticker does not have one-day intraday data yet."
                                    )
                                reference_dataset = max(
                                    available_intraday_datasets,
                                    key=lambda dataset: c.pd.Timestamp(
                                        dataset["Date"].max()
                                    ),
                                )
                                reference_latest_day = c.pd.Timestamp(
                                    reference_dataset["Date"].max()
                                ).date()
                                reference_latest_session = reference_dataset.loc[
                                    c.pd.to_datetime(
                                        reference_dataset["Date"], errors="coerce"
                                    ).dt.date
                                    == reference_latest_day
                                ].copy()
                                intraday_datasets = [
                                    dataset
                                    if dataset is not None
                                    else c.build_empty_compare_axis_dataset(
                                        reference_latest_session
                                    )
                                    for dataset in loaded_intraday_datasets
                                ]
                                common_end_date = min(
                                    dataset["Date"].max()
                                    for dataset in intraday_datasets
                                )
                                try:
                                    aligned_datasets = (
                                        c.slice_intraday_datasets_for_compare_period(
                                            intraday_datasets,
                                            period,
                                            common_end_date,
                                            validated_tickers,
                                        )
                                    )
                                except ValueError as alignment_error:
                                    fallback_trading_days: list[object] = []
                                    preferred_fallback_date = c.pd.to_datetime(
                                        date_constraints.max_date,
                                        errors="coerce",
                                    )
                                    if not c.pd.isna(preferred_fallback_date):
                                        fallback_trading_days.append(
                                            preferred_fallback_date.date()
                                        )

                                    latest_local_market_dates: list[object] = []
                                    for ticker, dataset in zip(
                                        validated_tickers, intraday_datasets
                                    ):
                                        available_dates = {
                                            c.market_trading_date_for_timestamp(
                                                value, ticker
                                            )
                                            for value in dataset["Date"]
                                        }
                                        if available_dates:
                                            latest_local_market_dates.append(
                                                max(available_dates)
                                            )
                                    if latest_local_market_dates:
                                        stale_market_fallback_date = min(
                                            latest_local_market_dates
                                        )
                                        if (
                                            stale_market_fallback_date
                                            not in fallback_trading_days
                                        ):
                                            fallback_trading_days.append(
                                                stale_market_fallback_date
                                            )

                                    recovered_alignment = False
                                    for fallback_trading_day in fallback_trading_days:
                                        restored_tickers: list[str] = []
                                        restored_intraday_datasets = (
                                            intraday_datasets.copy()
                                        )
                                        restore_failed = False
                                        for index, (ticker, dataset) in enumerate(
                                            zip(validated_tickers, intraday_datasets)
                                        ):
                                            available_trading_days = {
                                                c.market_trading_date_for_timestamp(
                                                    value, ticker
                                                )
                                                for value in dataset["Date"]
                                            }
                                            if (
                                                fallback_trading_day
                                                in available_trading_days
                                            ):
                                                continue
                                            try:
                                                restored_intraday_datasets[index] = (
                                                    c.load_compare_one_day_intraday_dataset(
                                                        ticker,
                                                        include_extended_hours_flag=include_extended_hours,
                                                        include_overnight_flag=include_overnight,
                                                        trading_date=fallback_trading_day,
                                                    )
                                                )
                                                restored_tickers.append(ticker)
                                            except (
                                                ImportError,
                                                OSError,
                                                ValueError,
                                                KeyError,
                                                TypeError,
                                            ) as exc:
                                                c.LOGGER.info(
                                                    "Unable to restore the shared one-day comparison date for %s: %s",
                                                    ticker,
                                                    exc,
                                                )
                                                restore_failed = True
                                                break
                                        if restore_failed or not restored_tickers:
                                            continue

                                        try:
                                            common_end_date = min(
                                                dataset["Date"].max()
                                                for dataset in restored_intraday_datasets
                                            )
                                            aligned_datasets = c.slice_intraday_datasets_for_compare_period(
                                                restored_intraday_datasets,
                                                period,
                                                common_end_date,
                                                validated_tickers,
                                            )
                                        except ValueError:
                                            continue

                                        restored_preview = ", ".join(restored_tickers)
                                        restore_notice = (
                                            f"Loaded on-demand 1-minute data for {restored_preview} to restore "
                                            "the shared one-day market date."
                                        )
                                        if notice is None:
                                            notice = restore_notice
                                        else:
                                            notice += f" {restore_notice}"
                                        recovered_alignment = True
                                        break
                                    if not recovered_alignment:
                                        raise alignment_error
                                reference_timestamp = c.pd.Timestamp(
                                    aligned_datasets[0]["Date"].max()
                                )
                                if reference_timestamp.tzinfo is None:
                                    reference_timestamp = (
                                        reference_timestamp.tz_localize(
                                            "America/New_York"
                                        )
                                    )
                                else:
                                    reference_timestamp = (
                                        reference_timestamp.tz_convert(
                                            "America/New_York"
                                        )
                                    )
                                chart_trading_date_value = (
                                    reference_timestamp.tz_convert(
                                        c.market_timezone_for_ticker(
                                            validated_tickers[0]
                                        )
                                    ).strftime("%Y-%m-%d")
                                )
                                exact_start_value = chart_trading_date_value
                                exact_end_value = chart_trading_date_value
                                has_current_intraday_data = any(
                                    dataset is not None
                                    and live_session_date
                                    in {
                                        c.market_trading_date_for_timestamp(
                                            value, ticker
                                        )
                                        for value in dataset["Date"]
                                    }
                                    for ticker, dataset in zip(
                                        validated_tickers, loaded_intraday_datasets
                                    )
                                )
                                if len(selected_markets) > 1 and (
                                    should_append_relative_live
                                    or has_current_intraday_data
                                ):
                                    try:
                                        aligned_datasets, _axis_trading_date = (
                                            c.build_current_compare_one_day_datasets(
                                                validated_tickers,
                                                daily_datasets=datasets,
                                                target_trading_date=live_session_date,
                                                live_session_date=live_session_date,
                                                include_extended_hours_flag=include_extended_hours,
                                                include_overnight_flag=include_overnight,
                                                force_refresh=True,
                                            )
                                        )
                                        chart_trading_date_value = c.pd.Timestamp(
                                            live_session_date
                                        ).strftime("%Y-%m-%d")
                                        exact_start_value = chart_trading_date_value
                                        exact_end_value = chart_trading_date_value
                                    except (
                                        ImportError,
                                        OSError,
                                        ValueError,
                                        KeyError,
                                        TypeError,
                                    ) as exc:
                                        c.LOGGER.info(
                                            "Unable to render the current mixed-market one-day axis; keeping the local comparison: %s",
                                            exc,
                                        )
                            for ticker in [] if period == "1d" else validated_tickers:
                                intraday_dataset = c.fetch_history(
                                    ticker,
                                    include_dividends=False,
                                    interval="1m",
                                    dividend_mode="price",
                                )
                                if period in {
                                    "3d",
                                    "1w",
                                } and c.is_market_regular_session_active_for_ticker(
                                    ticker
                                ):
                                    intraday_dataset = c.append_live_compare_intraday_dataset(
                                        ticker,
                                        intraday_dataset,
                                        live_trading_date=c.pd.Timestamp.now(
                                            tz=c.market_timezone_for_ticker(ticker)
                                        ).date(),
                                        include_extended_hours_flag=include_extended_hours,
                                        force_refresh=True,
                                    )[0]
                                intraday_datasets.append(intraday_dataset)
                            if period != "1d" and intraday_datasets:
                                common_end_date = min(
                                    dataset["Date"].max()
                                    for dataset in intraday_datasets
                                )
                                aligned_datasets = (
                                    c.slice_intraday_datasets_for_compare_period(
                                        intraday_datasets,
                                        period,
                                        common_end_date,
                                        validated_tickers,
                                    )
                                )
                                exact_start_value = (
                                    aligned_datasets[0]["Date"]
                                    .min()
                                    .strftime("%Y-%m-%d")
                                )
                                exact_end_value = (
                                    aligned_datasets[0]["Date"]
                                    .max()
                                    .strftime("%Y-%m-%d")
                                )
                            period_label = c.format_period_label(period)
                        else:
                            period, notice_resolve = (
                                c.resolve_effective_period_for_many(period, datasets)
                            )
                            if notice_resolve and notice is None:
                                notice = notice_resolve
                            elif notice_resolve:
                                notice = (notice or "") + " " + notice_resolve
                            common_end_date = min(
                                dataset["Date"].max() for dataset in datasets
                            )
                            aligned_datasets = c.slice_datasets_for_compare_period(
                                datasets,
                                period,
                                common_end_date,
                            )
                            exact_start_value = (
                                aligned_datasets[0]["Date"].min().strftime("%Y-%m-%d")
                            )
                            exact_end_value = (
                                aligned_datasets[0]["Date"].max().strftime("%Y-%m-%d")
                            )
                            period_label = c.format_period_label(period)
                        supported_periods = supported_periods or list(
                            c.COMPARE_PERIODS_1D
                        )

                        colors = c.build_series_colors(
                            len(validated_tickers),
                            c.theme["accent_primary"],
                            c.theme["accent_secondary"],
                        )
                        if current_view == "portfolio":
                            portfolio_shares = requested_shares[
                                : len(validated_tickers)
                            ]
                            if len(portfolio_shares) < len(validated_tickers):
                                portfolio_shares.extend(
                                    [0]
                                    * (len(validated_tickers) - len(portfolio_shares))
                                )
                            growth_multipliers = c.build_portfolio_growth_multipliers(
                                aligned_datasets
                            )
                            if portfolio_allocation_mode == "shares":
                                if any(
                                    share_count <= 0 for share_count in portfolio_shares
                                ):
                                    raise ValueError(
                                        "Each selected ticker must have at least 1 share."
                                    )
                                portfolio_weights = c.normalize_portfolio_share_weights(
                                    aligned_datasets, portfolio_shares
                                )
                                portfolio_series = (
                                    c.build_portfolio_series_payload_for_shares(
                                        aligned_datasets,
                                        portfolio_shares,
                                        c.theme["accent_primary"],
                                    )
                                )
                            else:
                                c.ensure_positive_portfolio_weights(
                                    requested_weights, len(validated_tickers)
                                )
                                portfolio_weights = c.normalize_portfolio_weights(
                                    requested_weights, len(validated_tickers)
                                )
                                portfolio_series = c.build_portfolio_series_payload(
                                    aligned_datasets,
                                    portfolio_weights,
                                    c.theme["accent_primary"],
                                )
                            benchmark_series, benchmark_profiles = (
                                c.build_benchmark_series_payloads(
                                    aligned_datasets[0]["Date"],
                                    include_dividends,
                                    price_only,
                                )
                            )
                            series = [portfolio_series, *benchmark_series]
                            profiles = [*profiles, *benchmark_profiles]
                            portfolio_total_return = (
                                portfolio_series.normalized_returns[-1]
                            )
                            portfolio_items = [
                                {
                                    "ticker": ticker,
                                    "company_name": profile.company_name,
                                    "logo_url": profile.logo_url,
                                    "weight": weight,
                                    "shares": share_count,
                                    "initial_price": float(dataset["Close"].iloc[0]),
                                    "growth_multiple": growth_multiple,
                                    "color": color,
                                }
                                for ticker, profile, weight, share_count, dataset, growth_multiple, color in zip(
                                    validated_tickers,
                                    profiles[: len(validated_tickers)],
                                    portfolio_weights,
                                    portfolio_shares,
                                    aligned_datasets,
                                    growth_multipliers,
                                    colors,
                                )
                            ]
                        else:
                            if is_market_cap_comparison:
                                series = [
                                    c.build_market_cap_series_payload(
                                        ticker,
                                        dataset,
                                        color=color,
                                        split_events=market_cap_split_events.get(
                                            ticker
                                        ),
                                        resolve_missing_split_events=True,
                                        split_events_are_authoritative=(
                                            market_cap_split_actions_authoritative.get(
                                                ticker, False
                                            )
                                        ),
                                    )
                                    for ticker, dataset, color in zip(
                                        validated_tickers, aligned_datasets, colors
                                    )
                                ]
                            else:
                                series = [
                                    c.build_compare_series_payload(
                                        ticker, dataset, color=color
                                    )
                                    for ticker, dataset, color in zip(
                                        validated_tickers, aligned_datasets, colors
                                    )
                                ]

                        def last_valid_return(item: c.SeriesPayload) -> float | None:
                            valid_returns = [
                                value
                                for value in item.normalized_returns
                                if value is not None
                            ]
                            return valid_returns[-1] if valid_returns else None

                        valid_performance_returns = [
                            value
                            for value in (last_valid_return(item) for item in series)
                            if value is not None
                        ]
                        best_return = (
                            max(valid_performance_returns)
                            if valid_performance_returns
                            else None
                        )
                        common_start = aligned_datasets[0]["Date"].min()
                        common_end = aligned_datasets[0]["Date"].max()
                        if (
                            current_view in {"tickers", "market-caps", "prices"}
                            and period == "1d"
                            and (range_mode == "exact" or is_intraday_compare_period)
                        ):
                            display_range = c.format_display_date(
                                c.pd.to_datetime(exact_start_value or common_start)
                            )
                        elif current_view in {"tickers", "market-caps", "prices"} and (
                            (is_intraday_compare_period and period in {"3d", "1w"})
                            or is_exact_short_intraday_compare
                        ):
                            display_range = (
                                c.format_compare_intraday_market_local_display_range(
                                    aligned_datasets,
                                    validated_tickers,
                                )
                                or f"{c.format_display_date(common_start)} - {c.format_display_date(common_end)}"
                            )
                        else:
                            display_range = f"{c.format_display_date(common_start)} - {c.format_display_date(common_end)}"
                        if current_view == "tickers":
                            dividend_yield_map = c.build_ttm_dividend_yield_map(
                                validated_tickers, common_end
                            )
                            best_dividend_yield = c.best_numeric_metric(
                                [
                                    dividend_yield_map.get(ticker)
                                    for ticker in validated_tickers
                                ]
                            )
                            performance_items = [
                                {
                                    "ticker": item.ticker,
                                    "company_name": profile.company_name,
                                    "logo_url": profile.logo_url,
                                    "ending_return": last_valid_return(item),
                                    "ttm_dividend_yield": dividend_yield_map.get(
                                        item.ticker
                                    ),
                                    "color": item.color,
                                    "shadow_color": c.hex_to_rgba(
                                        item.color or c.theme["accent_primary"], 0.22
                                    ),
                                    "is_winner": best_return is not None
                                    and last_valid_return(item) == best_return,
                                    "is_dividend_yield_winner": (
                                        best_dividend_yield is not None
                                        and dividend_yield_map.get(item.ticker)
                                        == best_dividend_yield
                                    ),
                                }
                                for item, profile in zip(series, profiles)
                            ]
                        ticker_slots = (control_tickers or validated_tickers).copy()
                        c.record_ticker_usage(validated_tickers)
        except c.MissingComparisonMarketDataError as exc:
            c.LOGGER.info("Unable to render %s workspace: %s", current_view, exc)
            error = str(exc)
            if c.should_use_modal_banner_message(error):
                floating_banner_icon_class = c.modal_banner_icon_class(error)
        except Exception:  # noqa: BLE001
            c.LOGGER.exception("Unable to render %s workspace", current_view)
            error = (
                "Unable to load this workspace. Check your local data and try again."
            )
            if c.should_use_modal_banner_message(error):
                floating_banner_icon_class = c.modal_banner_icon_class(error)

        values = locals()
        finalize_workspace_values(values, c)
        return render_workspace_response(values, c)

        return render_workspace_response(locals(), c)

    return {
        "render_workspace_page": render_workspace_page,
    }
