"""Render the final workspace template from an evaluated workspace context.

Code version: v0.1.1
"""

from __future__ import annotations


def render_workspace_response(
    values: dict[str, object],
    ctx: object,
) -> object:
    response = ctx.make_response(
        ctx.render_template(
            values["template_name"],
            error=values["error"],
            notice=values["notice"],
            floating_banner_icon_class=values["floating_banner_icon_class"],
            period=values["period"],
            period_label=values["period_label"],
            display_range=values["display_range"],
            periods=values["supported_periods"],
            period_labels={
                item: ctx.format_period_label(item)
                for item in values["supported_periods"]
            },
            period_metadata={
                "labels": ctx.PERIOD_LABELS,
                "daySpans": ctx.PERIOD_DAY_SPANS,
                "monthSpans": ctx.PERIOD_MONTH_SPANS,
            },
            series=values["series"],
            profiles_json=[
                ctx.quote_profile_to_json(profile) for profile in values["profiles"]
            ],
            performance_items=values["performance_items"],
            portfolio_items=values["portfolio_items"],
            portfolio_weights=values["portfolio_weights"],
            portfolio_shares=values["portfolio_shares"],
            portfolio_allocation_mode=values["portfolio_allocation_mode"],
            portfolio_total_return=values["portfolio_total_return"],
            dca_result=values["dca_result"],
            dca_amount=values["dca_amount"],
            dca_frequency=values["dca_frequency"],
            dca_weekday=values["dca_weekday"],
            dca_month_day=values["dca_month_day"],
            ticker_slots=values["ticker_slots"],
            max_tickers=values["view_max_tickers"],
            min_tickers=ctx.MIN_TICKERS,
            base_currency=ctx.BASE_CURRENCY,
            base_timezone=ctx.BASE_TIMEZONE,
            include_dividends=values["include_dividends"],
            stop_loss_enabled=values["stop_loss_enabled"],
            show_trade_details=values["show_trade_details"],
            price_only=values["price_only"],
            include_extended_hours=values["include_extended_hours"],
            show_extended_hours_toggle=values["show_extended_hours_toggle"],
            include_overnight=values["include_overnight"],
            show_overnight_toggle=values["show_overnight_toggle"],
            range_mode=values["range_mode"],
            exact_start=values["exact_start_value"],
            exact_end=values["exact_end_value"],
            format_display_date=ctx.format_display_date,
            chart_trading_date=values["chart_trading_date_value"]
            or values["exact_start_value"],
            comparison_current_date=ctx.pd.Timestamp.now(tz="Asia/Shanghai").strftime(
                "%Y-%m-%d"
            ),
            version=ctx.app_meta.get("version", ctx.CODE_VERSION),
            updated_on=ctx.app_meta.get("updated_on", ""),
            current_view=values["current_view"],
            settings_section=values["settings_section"],
            trade_section=values["trade_section"],
            top_tickers=values["top_tickers"],
            timing_selected_ticker=values["timing_selected_ticker"],
            timing_metrics=values["timing_metrics"],
            timing_summary=values["timing_summary"],
            timing_market=values["timing_market"],
            timing_error=values["timing_error"],
            remote_market_access=values["remote_market_access"],
            settings_title=values["settings_title"],
            settings_service_rows=values["settings_service_rows"],
            strategy_settings_groups=values["strategy_settings_groups"],
            font_token_rows=values["font_token_rows"],
            color_token_rows=values["color_token_rows"],
            style_token_rows=values["style_token_rows"],
            export_image_rows=values["export_image_rows"],
            material_token_rows=values["material_token_rows"],
            cash_equivalent_rows=values["cash_equivalent_rows"],
            cash_equivalent_fund_rows=values["cash_equivalent_fund_rows"],
            backtest_execution_mode=values["backtest_execution_mode"],
            investment_cost_basis_method=values["investment_cost_basis_method"],
            date_display_full_format=values["date_display_settings"].full_date_format,
            date_display_short_format=values["date_display_settings"].short_date_format,
            language_code=values["language_settings"].language,
            language_labels=ctx.LANGUAGE_LABELS,
            language_options=ctx.SUPPORTED_LANGUAGE_CODES,
            language_translations=list(values["language_settings"].translations),
            language_history_rows=values["language_history_rows"],
            language_html_lang=ctx.HTML_LANG_BY_LANGUAGE[
                values["language_settings"].language
            ],
            translate_ui=values["translate_ui"],
            broker_settings=values["broker_settings"],
            broker_test_status=values["broker_test_status"],
            broker_test_message=values["broker_test_message"],
            broker_test_checked_at=values["broker_test_checked_at"],
            longbridge_oauth_pending=values["longbridge_oauth_pending"],
            live_trading_account_label=values["live_trading_account_label"],
            local_market_rows=values["local_market_rows"],
            local_store_current_page=values["local_store_current_page"],
            local_store_page_size=ctx.LOCAL_STORE_PAGE_SIZE,
            local_store_total_pages=values["local_store_total_pages"],
            local_store_pagination_items=values["local_store_pagination_items"],
            settings_tab=values["settings_tab"],
            settings_page_number=values["settings_page_number"],
            settings_language_page_size=ctx.SETTINGS_LANGUAGE_PAGE_SIZE,
            page_title=values["page_title"],
            sidebar_title=values["labels"]["trade_title"]
            if values["current_view"] == "trade"
            else values["page_title"],
            report_heading=values["report_heading"],
            chart_heading=values["chart_heading"],
            comparison_metric=values["comparison_metric"],
            show_chips=values["show_chips"],
            dock_urls={
                view_name: ctx.build_view_url(view_name)
                for view_name in (
                    "tickers",
                    "prices",
                    "portfolio",
                    "dca",
                    "backtest",
                    "trade",
                    "settings",
                )
            },
            settings_urls={
                section_name: ctx.build_settings_url(section_name)
                for section_name in (
                    "about",
                    "general",
                    "investment",
                    "backtest",
                    "font-tokens",
                    "color-tokens",
                    "material-tokens",
                    "network",
                    "strategies",
                    "email-smtp",
                    "broker-access",
                    "local-market-store",
                    "clear-caches",
                    "style-tokens",
                    "export-image",
                    "cash-equivalents",
                )
            },
            trade_urls={
                section_name: ctx.build_trade_url(section_name)
                for section_name in ("investment", "live-trading")
            },
            local_store_page_urls={
                page_number: ctx.build_local_store_page_url(page_number)
                for page_number in range(1, values["local_store_total_pages"] + 1)
            },
            labels=values["labels"],
            theme=ctx.theme,
            theme_light=ctx.theme_light,
            theme_dark=ctx.theme_dark,
            project_source_url=ctx.PROJECT_SOURCE_URL,
            project_display_url=ctx.PROJECT_DISPLAY_URL,
            chart_config=ctx.chart_config,
            logos=ctx.logos,
            defaults=ctx.defaults,
            smtp_settings=values["smtp_settings"],
            strategy_options=values["strategy_options"],
            strategy_option_groups=values["strategy_option_groups"],
            selected_strategy_id=values["selected_strategy_id"],
            show_probability_field=ctx.is_price_field_strategy(
                values["selected_strategy_id"]
            ),
            price_field_strategy_ids=sorted(
                str(item["id"])
                for item in values["strategy_options"]
                if item.get("presentation_renderer") == "probability-grid-v1"
            ),
            strategy_required_tickers=values["strategy_required_tickers"],
            strategy_supports=values["strategy_supports"],
            strategy_default_tickers=values["strategy_default_tickers"],
            strategy_form_fields=values["strategy_form_fields"],
            strategy_form_sections=ctx.build_strategy_form_sections(
                values["selected_strategy_id"],
                values["strategy_form_fields"],
                strategy_factory=ctx.instantiate_strategy,
            )
            if values["selected_strategy_id"]
            else [],
            selected_strategy_params=values["selected_strategy_params"],
            backtest_initial_capital=values["backtest_initial_capital"],
            backtest_result=values["backtest_result"],
            backtest_periods_by_interval=values["backtest_periods_by_interval"],
            supported_intervals=values["supported_intervals"],
            requested_interval=values["requested_interval"],
            current_view_name=values["current_view"],
            current_path=ctx.request.path,
            fetch_abort_debug_config=ctx.FETCH_ABORT_DEBUG_CONFIG,
            endpoints={
                "symbolSearch": "/api/symbol-search",
                "dateConstraints": "/api/date-constraints",
                "compareLive": "/api/compare/live",
                "compareChips": "/api/compare/chips",
                "strategyFields": "/api/trade-strategy-fields",
                "lstmTraining": "/api/lstm-training",
                "lstmTrainingStart": "/api/lstm-training/start",
                "lstmTrainingStop": "/api/lstm-training/stop",
                "lstmTrainingDelete": "/api/lstm-training/delete",
                "priceFieldTraining": "/api/price-field-training",
                "priceFieldTrainingStart": "/api/price-field-training/start",
                "priceFieldTrainingStop": "/api/price-field-training/stop",
                "priceFieldTrainingDelete": "/api/price-field-training/delete",
                "settingsNetworkStatus": "/api/settings/network-status",
                "localStorePageData": "/api/settings/local-market-store/page-data",
                "marketStorePresence": "/api/market-store/presence",
                "investmentIntraday": "/api/investment/intraday",
                "investmentMarketSession": "/api/market-session/us-equity",
                "investmentRealtimeQuotes": "/api/investment/realtime-quotes",
                "liveTradingPositions": "/api/live-trading/positions",
                "liveTradingOrder": "/api/live-trading/orders",
            },
        )
    )
    if values["current_view"] == "settings":
        response.delete_cookie(ctx.SETTINGS_FEEDBACK_COOKIE, path="/settings")
    if values["current_view"] == "trade" and values["trade_section"] == "investment":
        ctx.apply_no_store_headers(response)
    return response
