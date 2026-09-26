"""Finalize workspace values after market-data evaluation.

Code version: v0.1.1
"""

from __future__ import annotations


def finalize_workspace_values(
    values: dict[str, object],
    ctx: object,
) -> None:
    values["remote_market_access"] = True

    if (
        values["current_view"] != "settings"
        and not values["error"]
        and not values["notice"]
    ):
        requires_remote_probe = any(
            not ctx.history_store_path_for(ticker).exists()
            for ticker in values["validated_tickers"]
        )
        if requires_remote_probe:
            values["remote_market_access"] = ctx.has_remote_market_access()
            if not values["remote_market_access"]:
                values["notice"] = (
                    "Using bundled local market_store data because remote market access is unavailable."
                )

    values["top_tickers"] = []
    values["timing_selected_ticker"] = ""
    values["timing_metrics"] = []
    values["timing_summary"] = []
    values["timing_market"] = {}
    values["timing_error"] = ""
    values["live_trading_account_label"] = "Integrated A/C (Unavailable)"

    if values["current_view"] == "settings":
        if values["settings_section"] in {
            "general",
            "backtest",
            "email-smtp",
            "broker-access",
            "local-market-store",
            "clear-caches",
        } and (values["notice"] or values["error"]):
            values["floating_banner_icon_class"] = ctx.modal_banner_icon_class(
                values["error"] or values["notice"]
            )
        values["settings_service_rows"] = ctx.build_network_service_rows(
            pending=values["settings_section"] != "network",
            service_labels=values["labels"],
            translate_fn=values["translate_ui"],
        )
        values["strategy_settings_groups"] = ctx.translate_nested_text(
            ctx.build_strategy_settings_groups(values["strategy_options"]),
            values["language_settings"].language,
            values["language_translations"],
        )
        values["font_token_rows"] = ctx.translate_nested_text(
            ctx.build_font_token_rows(values["labels"]),
            values["language_settings"].language,
            values["language_translations"],
        )
        values["color_token_rows"] = ctx.translate_nested_text(
            ctx.build_color_token_rows(ctx.theme_light, ctx.theme_dark),
            values["language_settings"].language,
            values["language_translations"],
        )
        values["style_token_rows"] = ctx.translate_nested_text(
            ctx.build_style_token_rows(values["labels"]),
            values["language_settings"].language,
            values["language_translations"],
        )
        values["export_image_rows"] = ctx.translate_nested_text(
            ctx.build_export_image_rows(ctx.PROJECT_DISPLAY_URL),
            values["language_settings"].language,
            values["language_translations"],
        )
        values["material_token_rows"] = ctx.translate_nested_text(
            ctx.build_material_token_rows(),
            values["language_settings"].language,
            values["language_translations"],
        )
        cash_equivalent_tickers = ctx.load_cash_equivalent_tickers()
        values["cash_equivalent_rows"] = []
        for t in cash_equivalent_tickers:
            company = ctx.resolve_known_ticker_company_name(t) or t
            logo = ctx.resolve_stored_logo_url(t) or ""
            values["cash_equivalent_rows"].append(
                {
                    "ticker": t,
                    "company_name": company,
                    "logo_url": logo,
                }
            )
        values["cash_equivalent_fund_rows"] = []
        for raw_ticker in ctx.money_market_settings.get("tickers", []):
            ticker = ctx.canonicalize_money_market_ticker(raw_ticker)
            if not ticker:
                continue
            quote_currency = ctx.configured_money_market_quote_currencies.get(
                ticker, ""
            )
            values["cash_equivalent_fund_rows"].append(
                {
                    "ticker": ticker,
                    "company_name": ctx.resolve_known_ticker_company_name(ticker)
                    or ticker,
                    "quote_currency": quote_currency,
                    "token_logo_class": "investment-cash-equivalent-token-logo",
                }
            )
        if values["settings_section"] == "local-market-store":
            all_local_market_tickers = ctx.list_local_market_tickers()
            values["local_store_current_page"] = ctx.local_store_page_value()
            values["local_store_total_pages"] = max(
                (len(all_local_market_tickers) - 1) // ctx.LOCAL_STORE_PAGE_SIZE + 1,
                1,
            )
            values["local_store_current_page"] = min(
                values["local_store_current_page"], values["local_store_total_pages"]
            )
            values["settings_page_number"] = values["local_store_current_page"]
            values["local_store_pagination_items"] = (
                ctx.build_local_store_pagination_items(
                    values["local_store_current_page"],
                    values["local_store_total_pages"],
                )
            )
            start_index = (
                values["local_store_current_page"] - 1
            ) * ctx.LOCAL_STORE_PAGE_SIZE
            end_index = start_index + ctx.LOCAL_STORE_PAGE_SIZE
            values["local_market_rows"] = ctx.build_local_market_rows_for_tickers(
                all_local_market_tickers[start_index:end_index],
                include_ranges=True,
            )
    elif values["current_view"] == "trade":
        if values["trade_section"] == "live-trading":
            values["live_trading_account_label"] = ctx.load_longbridge_account_label(
                ctx.load_broker_settings()
            )

    if values["current_view"] in {*ctx.BACKTEST_VIEWS, "dca"}:
        required_slots = (
            values["strategy_required_tickers"]
            if values["current_view"] in ctx.BACKTEST_VIEWS
            else 1
        )
        values["ticker_slots"] = (
            values["ticker_slots"][:required_slots]
            if values["ticker_slots"]
            else [""] * required_slots
        )
    else:
        while len(values["ticker_slots"]) < ctx.MIN_TICKERS:
            values["ticker_slots"].append("")
    if values["current_view"] == "portfolio":
        if not values["portfolio_weights"] and any(values["ticker_slots"]):
            values["portfolio_weights"] = ctx.build_default_weights(
                len([ticker for ticker in values["ticker_slots"] if ticker])
            )
        while len(values["portfolio_weights"]) < len(values["ticker_slots"]):
            values["portfolio_weights"].append(0)
        if not values["portfolio_shares"]:
            values["portfolio_shares"] = (
                values["requested_shares"][: len(values["ticker_slots"])]
                if values["requested_shares"]
                else []
            )
        while len(values["portfolio_shares"]) < len(values["ticker_slots"]):
            values["portfolio_shares"].append(0)

    values["template_name"] = {
        "tickers": "compare.html",
        "prices": "price_compare.html",
        "portfolio": "portfolio.html",
        "dca": "dca.html",
        "backtest": "backtest.html",
        "trade": (
            "investment.html"
            if values["trade_section"] == "investment"
            else "live_trading.html"
            if values["trade_section"] == "live-trading"
            else "investment.html"
        ),
        "settings": "settings.html",
    }[values["current_view"]]
