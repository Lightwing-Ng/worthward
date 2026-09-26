"""Build request-derived values for workspace rendering.

Code version: v0.1.1
"""

from __future__ import annotations


def build_workspace_request_context(
    current_view: str,
    c: object,
) -> tuple[object, ...]:
    backtest_execution_mode = c.load_backtest_execution_mode()
    investment_cost_basis_method = c.load_investment_cost_basis_method()
    date_display_settings = c.load_date_display_settings()
    language_settings = c.load_language_settings()
    labels = c.translate_labels(c.base_labels, language_settings)
    language_translations = c.build_translation_map(language_settings)

    def translate_ui(value: str) -> str:
        return c.translate_text(
            value, language_settings.language, language_translations
        )

    language_history_rows = [
        {
            "timestamp": str(entry.get("timestamp", "")),
            "change": change,
        }
        for entry in reversed(language_settings.history)
        for change in entry.get("changes", [])
    ]
    is_dock_prefetch = c.request.headers.get("X-Requested-With") == "dock-prefetch"
    comparison_metric = c.resolve_comparison_metric(current_view)
    is_market_cap_comparison = current_view == "market-caps" or (
        current_view == "prices" and comparison_metric == "market-cap"
    )
    show_chips = (
        current_view == "prices"
        and comparison_metric == "price"
        and c.parse_bool_flag("chips")
    )
    view_max_tickers = c.max_tickers_for_view(current_view, comparison_metric)
    requested_tickers = c.parse_requested_tickers(current_view, comparison_metric)
    range_mode, period, exact_start, exact_end = c.parse_range_request_args()
    price_only = c.request.args.get(
        "return", ""
    ).strip().lower() == "price" or c.parse_bool_flag(
        "price_only",
        "price_return_only",
        default=bool(c.defaults.get("price_only", False)),
    )
    include_dividends = (
        False
        if price_only
        else (
            c.request.args.get("return", "").strip().lower() == "dividends"
            or c.parse_bool_flag("dividends", "include_dividends")
        )
    )
    stop_loss_enabled = c.parse_bool_flag(
        "stop_loss",
        default=bool(c.defaults.get("backtest_stop_loss", False)),
    )
    show_trade_details = c.parse_bool_flag(
        "show_trade_details",
        default=bool(c.defaults.get("backtest_show_trade_details", False)),
    )
    if current_view in {"prices", "market-caps"}:
        price_only = True
        include_dividends = False
    include_extended_hours = (
        current_view in {"tickers", "market-caps", "prices"} and period == "1d"
    )
    include_overnight = (
        current_view in {"tickers", "market-caps", "prices"}
        and period == "1d"
        and c.parse_bool_flag("overnight", "include_overnight")
    )
    show_extended_hours_toggle = False
    show_overnight_toggle = False

    if current_view in {"tickers", "market-caps", "prices"} and not requested_tickers:
        requested_tickers = [
            c.normalize_ticker_input(c.defaults.get("ticker_a", c.DEFAULT_TICKERS[0])),
            c.normalize_ticker_input(c.defaults.get("ticker_b", c.DEFAULT_TICKERS[1])),
        ]
        include_dividends = False
    elif current_view == "portfolio" and not requested_tickers:
        requested_tickers = [
            c.normalize_ticker_input(value)
            for value in c.defaults.get("portfolio_tickers", ["NVDA", "AAPL", "QQQ"])
            if c.normalize_ticker_input(value)
        ][:view_max_tickers]
        include_dividends = False
    elif current_view in c.BACKTEST_VIEWS and not requested_tickers:
        if not any(
            key in c.request.args
            for key in ("return", "dividends", "include_dividends")
        ):
            include_dividends = (
                False
                if price_only
                else bool(c.defaults.get("backtest_include_dividends", False))
            )
    elif current_view == "dca" and not requested_tickers:
        default_trade_ticker = c.normalize_ticker_input(
            c.defaults.get(
                "dca_ticker", c.defaults.get("ticker_a", c.DEFAULT_TICKERS[0])
            )
        )
        requested_tickers = (
            [default_trade_ticker] if default_trade_ticker else [c.DEFAULT_TICKERS[0]]
        )
        include_dividends = (
            False
            if price_only
            else bool(c.defaults.get("dca_include_dividends", False))
        )

    settings_feedback = (
        c._read_settings_feedback() if current_view == "settings" else {}
    )
    error = (
        settings_feedback.get("error")
        if current_view == "settings"
        else (c.request.args.get("error", "").strip() or None)
    )
    notice = (
        settings_feedback.get("notice")
        if current_view == "settings"
        else (c.request.args.get("notice", "").strip() or None)
    )
    broker_test_status = (
        settings_feedback.get("broker_test_status", "").lower() or None
        if current_view == "settings"
        else (c.request.args.get("broker_test_status", "").strip().lower() or None)
    )
    broker_test_message = (
        settings_feedback.get("broker_test_message")
        if current_view == "settings"
        else (c.request.args.get("broker_test_message", "").strip() or None)
    )
    broker_test_checked_at = (
        settings_feedback.get("broker_test_checked_at")
        if current_view == "settings"
        else (c.request.args.get("broker_test_checked_at", "").strip() or None)
    )
    longbridge_oauth_pending = (
        settings_feedback.get("longbridge_oauth_pending") == "1"
        if current_view == "settings"
        else c.request.args.get("longbridge_oauth_pending", "").strip() == "1"
    )
    floating_banner_icon_class = "icon-modal-dialog-banner-default"
    if notice and "Successfully connected" in notice:
        floating_banner_icon_class = "icon-settings-broker"
    elif error:
        floating_banner_icon_class = (
            "icon-modal-dialog-banner-default"  # Or some error icon
        )

    return (
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
    )
