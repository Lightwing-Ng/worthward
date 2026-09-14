"""Build the pages settings web-runtime context.

Code version: v0.1.0
"""

from __future__ import annotations


def build_pages_settings_context(context: dict[str, object]) -> dict[str, object]:
    BrokerSettings = context["BrokerSettings"]

    BytesIO = context["BytesIO"]

    CODE_VERSION = context["CODE_VERSION"]

    HTML_LANG_BY_LANGUAGE = context["HTML_LANG_BY_LANGUAGE"]

    INVESTMENT_STORE_PATH = context["INVESTMENT_STORE_PATH"]

    LANGUAGE_LABELS = context["LANGUAGE_LABELS"]

    LOGGER = context["LOGGER"]

    LOGOS_STORE_DIR = context["LOGOS_STORE_DIR"]

    Path = context["Path"]

    RemoteDisconnected = context["RemoteDisconnected"]

    SETTINGS_FEEDBACK_COOKIE = context["SETTINGS_FEEDBACK_COOKIE"]

    STRATEGY_CATEGORY_KEYS = context["STRATEGY_CATEGORY_KEYS"]

    SUPPORTED_LANGUAGE_CODES = context["SUPPORTED_LANGUAGE_CODES"]

    SmtpSettings = context["SmtpSettings"]

    Workbook = context["Workbook"]

    YAHOO_SMTP_HOST = context["YAHOO_SMTP_HOST"]

    YAHOO_SMTP_PORT = context["YAHOO_SMTP_PORT"]

    _redirect_with_settings_feedback = context["_redirect_with_settings_feedback"]

    _run_backtest_from_request = context["_run_backtest_from_request"]

    app_meta = context["app_meta"]

    apply_no_store_headers = context["apply_no_store_headers"]

    build_dca_backtest_redirect = context["build_dca_backtest_redirect"]

    build_legacy_workspace_redirect = context["build_legacy_workspace_redirect"]

    build_market_cap_compare_redirect = context["build_market_cap_compare_redirect"]

    build_modern_query_pairs = context["build_modern_query_pairs"]

    build_settings_state_url = context["build_settings_state_url"]

    build_trade_path = context["build_trade_path"]

    build_view_path = context["build_view_path"]

    cast = context["cast"]

    clear_investment_store = context["clear_investment_store"]

    clear_non_historical_market_cache = context["clear_non_historical_market_cache"]

    clear_oauth_settings = context["clear_oauth_settings"]

    datetime = context["datetime"]

    delete_ticker_data = context["delete_ticker_data"]

    fetch_quote_profile = context["fetch_quote_profile"]

    format_display_date = context["format_display_date"]

    format_display_datetime = context["format_display_datetime"]

    get_longbridge_cli_auth_status = context["get_longbridge_cli_auth_status"]

    get_strategy_definition = context["get_strategy_definition"]

    invalidate_investment_transactions_cache = context[
        "invalidate_investment_transactions_cache"
    ]

    jsonify = context["jsonify"]

    live_trading_pin = context["live_trading_pin"]

    load_backtest_execution_mode = context["load_backtest_execution_mode"]

    load_broker_settings = context["load_broker_settings"]

    load_cash_equivalent_tickers = context["load_cash_equivalent_tickers"]

    load_date_display_settings = context["load_date_display_settings"]

    load_investment_cost_basis_method = context["load_investment_cost_basis_method"]

    load_language_settings = context["load_language_settings"]

    load_smtp_settings = context["load_smtp_settings"]

    load_workbook = context["load_workbook"]

    maintain_local_market_store = context["maintain_local_market_store"]

    make_response = context["make_response"]

    normalize_settings_page = context["normalize_settings_page"]

    normalize_settings_section = context["normalize_settings_section"]

    normalize_ticker_input = context["normalize_ticker_input"]

    normalize_trade_section = context["normalize_trade_section"]

    parse_float_value = context["parse_float_value"]

    pd = context["pd"]

    redirect = context["redirect"]

    refresh_history_store = context["refresh_history_store"]

    refresh_one_minute_store = context["refresh_one_minute_store"]

    render_template = context["render_template"]

    render_workspace_page = context["render_workspace_page"]

    report_fetch_abort_debug_event = context["report_fetch_abort_debug_event"]

    request = context["request"]

    reset_connectivity_caches = context["reset_connectivity_caches"]

    resolve_settings_section = context["resolve_settings_section"]

    resolve_settings_tab = context["resolve_settings_tab"]

    resolve_view = context["resolve_view"]

    save_backtest_execution_mode = context["save_backtest_execution_mode"]

    save_broker_settings = context["save_broker_settings"]

    save_cash_equivalent_tickers = context["save_cash_equivalent_tickers"]

    save_full_date_display_format = context["save_full_date_display_format"]

    save_investment_cost_basis_method = context["save_investment_cost_basis_method"]

    save_language_code = context["save_language_code"]

    save_language_settings = context["save_language_settings"]

    save_short_date_display_format = context["save_short_date_display_format"]

    save_smtp_settings = context["save_smtp_settings"]

    send_file = context["send_file"]

    send_from_directory = context["send_from_directory"]

    session = context["session"]

    settings_page_value = context["settings_page_value"]

    start_longbridge_cli_browser_oauth = context["start_longbridge_cli_browser_oauth"]

    test_broker_connection = context["test_broker_connection"]

    test_longbridge_cli_connection = context["test_longbridge_cli_connection"]

    test_smtp_connection = context["test_smtp_connection"]

    theme_dark = context["theme_dark"]

    theme_light = context["theme_light"]

    urlencode = context["urlencode"]

    validate_live_trading_pin = context["validate_live_trading_pin"]

    def export_transactions_api():
        try:
            # Re-run backtest to get the full transaction list
            (
                backtest_result,
                trade_ticker,
                requested_interval,
                _date_constraints,
                trade_dataset,
                strategy_id,
                strategy_params,
                _,
            ) = _run_backtest_from_request()

            raw_summary = backtest_result.get("summary", {})
            summary: dict[str, object] = (
                cast(dict[str, object], raw_summary)
                if isinstance(raw_summary, dict)
                else {}
            )
            raw_trades = backtest_result.get("trades", [])
            trades: list[dict[str, object]] = (
                [
                    cast(dict[str, object], trade)
                    for trade in raw_trades
                    if isinstance(trade, dict)
                ]
                if isinstance(raw_trades, list)
                else []
            )
            if not trades:
                return "No transactions to export.", 404

            strategy_definition = get_strategy_definition(strategy_id)
            is_multi_asset = bool(backtest_result.get("multi_asset"))
            raw_tickers = backtest_result.get("tickers", [])
            report_tickers = (
                [str(ticker).strip() for ticker in raw_tickers if str(ticker).strip()]
                if isinstance(raw_tickers, (list, tuple))
                else []
            )
            if not report_tickers:
                report_tickers = list(
                    dict.fromkeys(
                        str(trade.get("ticker") or trade_ticker).strip()
                        for trade in trades
                        if str(trade.get("ticker") or trade_ticker).strip()
                    )
                )
            ticker_caption = " / ".join(report_tickers) or trade_ticker
            ticker_filename_prefix = "-".join(report_tickers) or trade_ticker
            # 0. Context for Filename
            start_str = trade_dataset["Date"].min().strftime("%Y%m%d")
            end_str = trade_dataset["Date"].max().strftime("%Y%m%d")
            strategy_name = strategy_definition.get("name", strategy_id)
            report_filename = f"{ticker_filename_prefix} Backtest Report {start_str} - {end_str} ({strategy_name}).md"
            period_start = pd.to_datetime(trade_dataset["Date"].min())
            period_end = pd.to_datetime(trade_dataset["Date"].max())
            period_label = f"{format_display_date(period_start)} - {format_display_date(period_end)}"
            dataset_export_date_format = (
                "%Y-%m-%d %H:%M" if requested_interval == "1m" else "%Y-%m-%d"
            )
            market_data_csv = trade_dataset.to_csv(
                index=False, date_format=dataset_export_date_format
            ).rstrip()

            if strategy_id == "dca":
                dca_amount = parse_float_value(summary.get("amount_per_period"), 0.0)
                dca_planned = parse_float_value(summary.get("planned_capital"), 0.0)
                dca_invested = parse_float_value(summary.get("total_invested"), 0.0)
                dca_final_equity = parse_float_value(summary.get("final_equity"), 0.0)
                dca_net_return = parse_float_value(summary.get("net_return_pct"), 0.0)
                dca_all_in_equity = parse_float_value(summary.get("all_in_equity"), 0.0)
                dca_all_in_alpha = parse_float_value(summary.get("all_in_alpha"), 0.0)
                dca_trades = [
                    trade for trade in trades if not trade.get("_virtual_close")
                ]
                md_lines = [
                    f"## DCA Backtest Report: {ticker_caption}",
                    f"**Generated on**: {format_display_datetime(pd.Timestamp.now(), include_seconds=True, timezone_suffix='HKT')}",
                    f"**Algorithm**: {strategy_name}",
                    f"**Period**: {period_label}",
                    "",
                    "### Performance Summary",
                    f"- **Amount per period**: ${dca_amount:,.2f}",
                    f"- **Planned capital**: ${dca_planned:,.2f}",
                    f"- **Total invested**: ${dca_invested:,.2f}",
                    f"- **Final equity**: ${dca_final_equity:,.2f}",
                    f"- **Net return**: {dca_net_return:,.2f}%",
                    f"- **Contribution days**: {summary.get('investment_days', len(dca_trades))}",
                    f"- **Total shares**: {parse_float_value(summary.get('total_shares'), 0.0):,.6f}",
                    f"- **Average cost**: ${parse_float_value(summary.get('average_cost'), 0.0):,.4f}",
                    f"- **All-in final equity**: ${dca_all_in_equity:,.2f}",
                    f"- **DCA alpha vs all-in**: {'+' if dca_all_in_alpha >= 0 else '-'}${abs(dca_all_in_alpha):,.2f}",
                    "",
                    "### Contribution History",
                    "",
                    "| No. | Date time | Side | Price | Quantity | Realized P&L | Unrealized P&L | Cash | Market value | Equity |",
                    "| ---: | :--- | :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
                ]
                for index, trade in enumerate(dca_trades, start=1):
                    equity = parse_float_value(trade.get("equity"), 0.0)
                    cash = parse_float_value(trade.get("cash"), 0.0)
                    market_value = parse_float_value(
                        trade.get("market_value"), equity - cash
                    )
                    md_lines.append(
                        f"| {index} | {trade.get('date', 'N/A')} | {trade.get('side', 'Buy')} | "
                        f"{parse_float_value(trade.get('price'), 0.0):,.2f} | "
                        f"{parse_float_value(trade.get('quantity', trade.get('shares')), 0.0):,.0f} | "
                        f"{parse_float_value(trade.get('realized_pnl'), 0.0):,.2f} | "
                        f"{parse_float_value(trade.get('unrealized_pnl'), 0.0):,.2f} | "
                        f"{cash:,.2f} | "
                        f"{market_value:,.2f} | "
                        f"{equity:,.2f} |"
                    )
                md_lines.extend(
                    [
                        "",
                        "### Strategy Context",
                        "",
                        f"- **Tickers**: {ticker_caption}",
                        "",
                        "#### Parameters",
                        "",
                        "| Parameter | Value |",
                        "| :--- | :--- |",
                    ]
                )
                for key, val in strategy_params.items():
                    md_lines.append(f"| {key} | {val} |")
                md_lines.extend(
                    [
                        "",
                        "### Source market data",
                        "",
                        "```text",
                        market_data_csv,
                        "```",
                        "",
                    ]
                )
                md_content = "\n".join(md_lines)
                return send_file(
                    BytesIO(md_content.encode("utf-8")),
                    mimetype="text/markdown",
                    as_attachment=True,
                    download_name=report_filename,
                )

            # 1. Performance Summary
            benchmark_alpha = float(summary.get("benchmark_alpha", 0) or 0)
            long_gain = float(summary.get("long_gain", 0) or 0)
            short_gain = float(summary.get("short_gain", 0) or 0)
            long_loss = float(summary.get("long_loss", 0) or 0)
            beat_bh_pct = float(summary.get("beat_bh_pct", 0) or 0)
            win_rate_pct = summary.get("win_rate_pct")
            win_rate_display = (
                "N/A"
                if win_rate_pct is None
                else f"{parse_float_value(win_rate_pct, 0.0):,.2f}%"
            )
            probability_field_direction_hit_rate = summary.get(
                "probability_field_direction_hit_rate_pct"
            )
            probability_field_direction_hit_rate_display = (
                "N/A"
                if probability_field_direction_hit_rate is None
                else f"{parse_float_value(probability_field_direction_hit_rate, 0.0):,.2f}%"
            )
            probability_field_probability_score = summary.get(
                "probability_field_probability_score_pct"
            )
            probability_field_probability_score_display = (
                "N/A"
                if probability_field_probability_score is None
                else f"{parse_float_value(probability_field_probability_score, 0.0):,.2f}%"
            )

            md_lines = [
                f"## Backtest Report: {ticker_caption}",
                f"**Generated on**: {format_display_datetime(pd.Timestamp.now(), include_seconds=True, timezone_suffix='HKT')}",
                f"**Algorithm**: {strategy_name}",
                f"**Period**: {period_label}",
                "",
                "### Performance Summary",
                f"- **Initial capital**: ${summary.get('initial_capital', 0):,.2f}",
                f"- **Final equity**: ${summary.get('final_equity', 0):,.2f}",
                f"- **Net return**: {summary.get('net_return_pct', 0):,.2f}%",
                f"- **Total trades**: {summary.get('total_trades', 0)}",
                f"- **Win rate**: {win_rate_display}",
                *(
                    [
                        f"- **Bayesian direction hit rate (next-open execution)**: {probability_field_direction_hit_rate_display}",
                    ]
                    if probability_field_direction_hit_rate is not None
                    else []
                ),
                *(
                    [
                        f"- **Bayesian probability score (one minus Brier loss)**: {probability_field_probability_score_display}",
                    ]
                    if probability_field_probability_score is not None
                    else []
                ),
                f"- **Beat B&H**: {beat_bh_pct:,.2f}%",
                f"- **Alpha vs B&H**: {'+' if benchmark_alpha >= 0 else '-'}${abs(benchmark_alpha):,.2f}",
                f"- **Realized long P&L**: {'+' if long_gain >= 0 else '-'}${abs(long_gain):,.2f}",
                f"- **Realized short P&L**: {'+' if short_gain >= 0 else '-'}${abs(short_gain):,.2f}",
                f"- **Realized long loss**: {'-' if long_loss > 0 else '+'}${abs(long_loss):,.2f}",
                "",
            ]

            # 2. Transaction Details
            md_lines.extend(
                [
                    "### Transaction History",
                    "",
                    "| No. | Date time | Ticker | Side | Price | Quantity | Realized P&L | Unrealized P&L | Cash | Market value | Equity |"
                    if is_multi_asset
                    else "| No. | Date time | Side | Price | Quantity | Realized P&L | Unrealized P&L | Cash | Market value | Equity |",
                    "| ---: | :--- | :--- | :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |"
                    if is_multi_asset
                    else "| ---: | :--- | :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
                ]
            )
            for i, trade in enumerate(trades):
                if trade.get("_virtual_close"):
                    continue  # Skip virtual closing trade, same as table display
                trade_date = (
                    format_display_datetime(
                        pd.to_datetime(trade.get("date")), use_short_date=True
                    )
                    if trade.get("date")
                    else "N/A"
                )
                ticker_cell = f"{trade.get('ticker', '')} | " if is_multi_asset else ""
                equity = parse_float_value(trade.get("equity"), 0.0)
                cash = parse_float_value(trade.get("cash"), 0.0)
                market_value = parse_float_value(
                    trade.get("market_value"), equity - cash
                )
                md_lines.append(
                    f"| {i + 1} | {trade_date} | {ticker_cell}{trade.get('side')} | "
                    f"{trade.get('price', 0):,.2f} | "
                    f"{parse_float_value(trade.get('quantity', trade.get('shares')), 0.0):,.0f} | "
                    f"{parse_float_value(trade.get('realized_pnl', trade.get('pnl')), 0.0):,.2f} | "
                    f"{parse_float_value(trade.get('unrealized_pnl'), 0.0):,.2f} | "
                    f"{cash:,.2f} | {market_value:,.2f} | {equity:,.2f} |"
                )

            # 3. Strategy Context
            md_lines.extend(
                [
                    "",
                    "### Strategy Context",
                    "",
                    f"- **Tickers**: {ticker_caption}",
                    "",
                    "#### Parameters",
                    "",
                    "| Parameter | Value |",
                    "| :--- | :--- |",
                ]
            )
            for key, val in strategy_params.items():
                md_lines.append(f"| {key} | {val} |")

            # Read Strategy Code
            try:
                module_name = strategy_definition.get("module", "")
                if module_name:
                    file_name = module_name.split(".")[-1] + ".py"
                    algo_path = (
                        Path(__file__).resolve().parent.parent
                        / "strategies"
                        / "algorithms"
                        / file_name
                    )
                    if algo_path.exists():
                        with open(algo_path, "r", encoding="utf-8") as f:
                            strategy_code = f.read()
                        md_lines.extend(
                            [
                                "",
                                "#### Strategy Implementation",
                                "```python",
                                strategy_code,
                                "```",
                                "",
                            ]
                        )
            except Exception:  # noqa: BLE001
                LOGGER.exception(
                    "Unable to load strategy source for exported backtest report"
                )
                md_lines.append(
                    "\n*(Strategy source was unavailable for this export.)*"
                )

            # 4. LLM Strategy Developer Prompt
            md_lines.extend(
                [
                    "",
                    "### LLM Strategy Developer Prompt",
                    "",
                    "*Copy and paste the prompt below into any SOTA LLMs to recreate or iterate on this strategy.*",
                    "",
                    "````",
                    "You are an elite quantitative trading developer and Python engineer. Your task is to write a trading strategy plugin for the `worthward` trading system.",
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
                    '   - `strategy_id` (str): Unique snake_case identifier (e.g., "macd", "rsi_reversion").',
                    "   - `strategy_name` (str): Human-readable name for the UI.",
                    "   - `strategy_description` (str): Clear, concise description of the logic.",
                    f"   - `strategy_category` (str): Must be one of: {', '.join(repr(key) for key in STRATEGY_CATEGORY_KEYS)}.",
                    "   - `strategy_display_order` (int): An integer (10-90) indicating UI sorting priority.",
                    "   - `strategy_supports` (StrategySupportMatrix): Usually `StrategySupportMatrix(single_ticker=True, multi_ticker=False, long_only=True, short=False)`.",
                    "",
                    "3. **Parameter Definitions (`get_parameter_definitions`)**:",
                    "   Override `def get_parameter_definitions(self) -> tuple[StrategyParameterDefinition, ...]:` to declare all user-configurable parameters.",
                    '   Supported kwargs for `StrategyParameterDefinition`: `key`, `label`, `kind` ("integer", "number", "boolean", "choice", "string"), `default`, `minimum`, `maximum`, `step`, `options`, `help_text`, `unit_hint`.',
                    "",
                    "4. **Signal Computation (`compute_signals`)**:",
                    "   Override `def compute_signals(self, dataset: pd.DataFrame, params: dict | None = None) -> StrategySignalResult:`.",
                    "   - **CRITICAL**: Never modify `dataset` in-place. Always start with `frame = dataset.copy()`.",
                    "   - **CRITICAL**: Always normalize parameters first via `normalized_params = self.normalize_params(params)`.",
                    "   - Extract your parameters with explicit type casting.",
                    "   - Compute your indicators using vectorized pandas operations. Avoid loops for performance unless mathematically required.",
                    '   - Create exactly two boolean signal columns: `"buy_signal"` and `"sell_signal"`.',
                    "   - **CRITICAL**: Use `.fillna(False)` on signal columns.",
                    '   - Return: `return StrategySignalResult(frame=frame, buy_signal_column="buy_signal", sell_signal_column="sell_signal")`.',
                    "",
                    "5. **Output Format**:",
                    "   - Provide ONLY the Python code block. No surrounding markdown explanations.",
                    "   - The code must be pristine, strictly typed (Python >=3.13), and adhere to standard Black formatting.",
                    "",
                    "### Gold Standard Reference (MACD Strategy)",
                    "```python",
                    "from __future__ import annotations",
                    "import pandas as pd",
                    "from ..base import BaseStrategy, StrategyParameterDefinition, StrategySignalResult, StrategySupportMatrix",
                    "",
                    "class MacdStrategy(BaseStrategy):",
                    '    strategy_id = "macd"',
                    '    strategy_name = "MACD"',
                    '    strategy_description = "MACD crossover strategy using default settings."',
                    '    strategy_category = "technical-analysis"',
                    "    strategy_display_order = 20",
                    "    strategy_supports = StrategySupportMatrix(single_ticker=True, multi_ticker=False, long_only=True, short=False)",
                    "",
                    "    def get_parameter_definitions(self) -> tuple[StrategyParameterDefinition, ...]:",
                    "        return (",
                    '            StrategyParameterDefinition(key="fast_span", label="Fast EMA", kind="integer", default=12, minimum=1),',
                    '            StrategyParameterDefinition(key="slow_span", label="Slow EMA", kind="integer", default=26, minimum=2),',
                    '            StrategyParameterDefinition(key="signal_span", label="Signal EMA", kind="integer", default=9, minimum=1),',
                    "        )",
                    "",
                    "    def compute_signals(self, dataset: pd.DataFrame, params: dict | None = None) -> StrategySignalResult:",
                    "        frame = dataset.copy()",
                    "        normalized_params = self.normalize_params(params)",
                    '        fast_span, slow_span, signal_span = int(normalized_params["fast_span"]), int(normalized_params["slow_span"]), int(normalized_params["signal_span"])',
                    '        ema_fast = frame["Close"].ewm(span=fast_span, adjust=False).mean()',
                    '        ema_slow = frame["Close"].ewm(span=slow_span, adjust=False).mean()',
                    '        frame["macd_line"] = ema_fast - ema_slow',
                    '        frame["signal_line"] = frame["macd_line"].ewm(span=signal_span, adjust=False).mean()',
                    '        frame["buy_signal"] = ((frame["macd_line"] > frame["signal_line"]) & (frame["macd_line"].shift(1) <= frame["signal_line"].shift(1))).fillna(False)',
                    '        frame["sell_signal"] = ((frame["macd_line"] < frame["signal_line"]) & (frame["macd_line"].shift(1) >= frame["signal_line"].shift(1))).fillna(False)',
                    '        return StrategySignalResult(frame=frame, buy_signal_column="buy_signal", sell_signal_column="sell_signal")',
                    "```",
                    "````",
                ]
            )

            # 5. Source market data
            md_lines.extend(
                ["### Source market data", "", "```text", market_data_csv, "```", ""]
            )

            md_content = "\n".join(md_lines)

            return send_file(
                BytesIO(md_content.encode("utf-8")),
                mimetype="text/markdown",
                as_attachment=True,
                download_name=report_filename,
            )
        except Exception:  # noqa: BLE001
            LOGGER.exception("Unable to export backtest transactions")
            return "Unable to export backtest transactions. Try again later.", 500

    def root():
        legacy_view = request.args.get("view")
        if request.args:
            target_view = resolve_view() if legacy_view else "tickers"
            if target_view == "market-caps":
                return build_market_cap_compare_redirect()
            if target_view == "settings":
                return redirect(
                    build_settings_state_url(
                        resolve_settings_section(),
                        tab=resolve_settings_tab(),
                        page=settings_page_value(),
                    )
                )
            target_path = build_view_path(target_view)
            query_string = urlencode(build_modern_query_pairs(target_view), doseq=True)
            return redirect(
                f"{target_path}?{query_string}" if query_string else target_path
            )
        return redirect(build_view_path("tickers"))

    def compare_page():
        return render_workspace_page("tickers")

    def market_cap_compare_page():
        return build_market_cap_compare_redirect()

    def legacy_compare_page():
        return build_legacy_workspace_redirect("tickers")

    def price_compare_page():
        return render_workspace_page("prices")

    def portfolio_page():
        return render_workspace_page("portfolio")

    def legacy_portfolio_page():
        return build_legacy_workspace_redirect("portfolio")

    def dca_page():
        return build_dca_backtest_redirect()

    def legacy_dca_page():
        return build_dca_backtest_redirect()

    def backtest_page():
        return render_workspace_page("backtest")

    def grid_trading_page():
        query_pairs = [
            (key, value)
            for key, values in request.args.lists()
            if key not in {"strategy", "workspace"}
            for value in values
        ]
        query_pairs.append(("strategy", "grid-trading"))
        query_string = urlencode(query_pairs)
        target_path = build_view_path("backtest")
        return redirect(
            f"{target_path}?{query_string}" if query_string else target_path
        )

    def legacy_backtest_page():
        return build_legacy_workspace_redirect("backtest")

    def legacy_trade_messages_page():
        return build_legacy_workspace_redirect("backtest")

    def trade_root():
        return redirect(build_trade_path("investment"))

    def trade_page(section_name: str):
        normalized_section = normalize_trade_section(section_name)
        if normalized_section != (section_name or "").strip().lower():
            return redirect(build_trade_path(normalized_section))
        if normalized_section == "live-trading" and not session.get(
            "live_trading_unlocked"
        ):
            response = make_response(
                render_template(
                    "live_trading_unlock.html",
                    error_message="",
                    theme_dark=theme_dark,
                    theme_light=theme_light,
                    version=app_meta.get("version", CODE_VERSION),
                )
            )
            return apply_no_store_headers(response)
        return render_workspace_page("trade", trade_section=normalized_section)

    def live_trading_unlock():
        access_granted, error_status, error_message = validate_live_trading_pin(
            request.form.get("pin"),
            live_trading_pin,
        )
        if not access_granted:
            response = make_response(
                render_template(
                    "live_trading_unlock.html",
                    error_message=error_message,
                    theme_dark=theme_dark,
                    theme_light=theme_light,
                    version=app_meta.get("version", CODE_VERSION),
                ),
                error_status,
            )
            return apply_no_store_headers(response)

        session.clear()
        session["live_trading_unlocked"] = True
        return redirect(build_trade_path("live-trading"), code=303)

    def legacy_trade_root():
        return redirect(build_trade_path("investment"))

    def legacy_trade_page(section_name: str):
        return redirect(build_trade_path(normalize_trade_section(section_name)))

    def settings_root():
        return redirect(
            build_settings_state_url(
                resolve_settings_section(),
                tab=resolve_settings_tab(),
                page=settings_page_value(),
            )
        )

    def settings_page(section_name: str):
        normalized_section = normalize_settings_section(section_name)
        canonical_url = build_settings_state_url(
            normalized_section,
            tab=resolve_settings_tab(),
            page=settings_page_value(),
        )
        current_url = request.path
        if request.query_string:
            current_url = f"{current_url}?{request.query_string.decode()}"
        if current_url != canonical_url:
            return redirect(canonical_url)
        report_fetch_abort_debug_event(
            "E",
            "runtime.py:settings_page",
            "settings page request received",
            {
                "section_name": normalized_section,
                "path": request.path,
                "query_string": request.query_string.decode(),
            },
        )
        return render_workspace_page("settings", normalized_section)

    def _language_rows_from_request_form() -> list[dict[str, str]]:
        return [
            {
                "en": english,
                "zh_hant_hk": zh_hant_hk,
                "zh_hans_cn": zh_hans_cn,
            }
            for english, zh_hant_hk, zh_hans_cn in zip(
                request.form.getlist("translation_en"),
                request.form.getlist("translation_zh_hant_hk"),
                request.form.getlist("translation_zh_hans_cn"),
            )
        ]

    def _language_rows_from_xlsx_bytes(payload: bytes) -> list[dict[str, str]]:
        workbook = load_workbook(filename=BytesIO(payload), data_only=True)
        worksheet = workbook.active
        headers = [
            str(worksheet.cell(row=1, column=column_index).value or "").strip()
            for column_index in range(1, 5)
        ]
        header_to_column = {header: index + 1 for index, header in enumerate(headers)}
        english_column = header_to_column.get("English", 2)
        traditional_column = header_to_column.get("繁體中文（香港）", 3)
        simplified_column = header_to_column.get("简体中文(中国大陆)")
        if simplified_column is None:
            simplified_column = header_to_column.get("简体中文（中国大陆）", 4)
        rows: list[dict[str, str]] = []
        for row_index in range(2, worksheet.max_row + 1):
            english = str(
                worksheet.cell(row=row_index, column=english_column).value or ""
            ).strip()
            if not english:
                continue
            rows.append(
                {
                    "en": english,
                    "zh_hant_hk": str(
                        worksheet.cell(row=row_index, column=traditional_column).value
                        or ""
                    ).strip(),
                    "zh_hans_cn": str(
                        worksheet.cell(row=row_index, column=simplified_column).value
                        or ""
                    ).strip(),
                }
            )
        if not rows:
            raise ValueError(
                "The uploaded spreadsheet does not contain any language mapping rows."
            )
        return rows

    def general_settings_action():
        notices: list[str] = []
        wants_async_language_response = request.headers.get("X-Settings-Async") == "1"
        selected_language_settings = load_language_settings()
        language_action = str(request.form.get("language_action", "save")).strip()
        language_file = request.files.get("language_mapping_xlsx")
        settings_state_from_form = {
            "tab": request.form.get("settings_tab", ""),
            "page": request.form.get("settings_page", ""),
        }
        if language_action == "upload" and language_file and language_file.filename:
            try:
                selected_language_settings = save_language_settings(
                    language=request.form.get(
                        "language_code", load_language_settings().language
                    ),
                    translations=_language_rows_from_xlsx_bytes(language_file.read()),
                    history_label="Spreadsheet upload",
                )
                notices.append(
                    f"Language translations imported from {language_file.filename}."
                )
                if (
                    selected_language_settings.language in {"zh_hant_hk", "zh_hans_cn"}
                    and load_date_display_settings().full_date_format == "d_mmm_yyyy"
                ):
                    save_full_date_display_format("yyyy_mm_dd_cjk")
                elif (
                    selected_language_settings.language == "en"
                    and load_date_display_settings().full_date_format
                    == "yyyy_mm_dd_cjk"
                ):
                    save_full_date_display_format("d_mmm_yyyy")
            except ValueError as exc:
                return _redirect_with_settings_feedback(
                    "general",
                    error=(
                        "Language spreadsheet import failed: "
                        f"{str(exc).strip() or 'check the file and try again.'}"
                    ),
                    query_params=settings_state_from_form,
                )
            except Exception:  # noqa: BLE001
                LOGGER.exception("Language spreadsheet import failed")
                return _redirect_with_settings_feedback(
                    "general",
                    error="Language spreadsheet import failed. Check the file and try again.",
                    query_params=settings_state_from_form,
                )
        elif "language_code" in request.form or "translation_en" in request.form:
            current_language_settings = load_language_settings()
            translation_rows = _language_rows_from_request_form()
            selected_language_settings = save_language_settings(
                language=request.form.get(
                    "language_code", current_language_settings.language
                ),
                translations=translation_rows if translation_rows else None,
                history_label="Manual edit",
            )
            if (
                selected_language_settings.language in {"zh_hant_hk", "zh_hans_cn"}
                and load_date_display_settings().full_date_format == "d_mmm_yyyy"
            ):
                save_full_date_display_format("yyyy_mm_dd_cjk")
            elif (
                selected_language_settings.language == "en"
                and load_date_display_settings().full_date_format == "yyyy_mm_dd_cjk"
            ):
                save_full_date_display_format("d_mmm_yyyy")
            if (
                selected_language_settings.language
                != current_language_settings.language
            ):
                notices.append(
                    f"Language updated: {LANGUAGE_LABELS[selected_language_settings.language]}."
                )
            elif translation_rows:
                notices.append("Language translations updated.")
        if wants_async_language_response:
            response = jsonify(
                {
                    "success": True,
                    "notice": " ".join(notices),
                    "language": selected_language_settings.language,
                    "label": LANGUAGE_LABELS[selected_language_settings.language],
                }
            )
            return apply_no_store_headers(response)
        if "full_date_format" in request.form:
            current_full = load_date_display_settings().full_date_format
            selected_full = save_full_date_display_format(
                request.form.get("full_date_format", current_full)
            )
            if selected_full != current_full:
                full_labels = {
                    "d_mmm_yyyy": "D Mmm yyyy",
                    "dd_mmm_yyyy": "DD Mmm yyyy",
                    "yyyy_mmm_d": "yyyy Mmm D",
                    "yyyy_mmm_dd": "yyyy Mmm DD",
                    "yyyy_mm_dd_cjk": "yyyy年mm月dd日",
                }
                notices.append(
                    f"Full date format updated: {full_labels[selected_full]}."
                )
        if "short_date_format" in request.form:
            current_short = load_date_display_settings().short_date_format
            selected_short = save_short_date_display_format(
                request.form.get("short_date_format", current_short)
            )
            if selected_short != current_short:
                short_labels = {
                    "yyyy_mm_dd": "yyyy/mm/dd",
                    "dd_mm_yyyy": "dd/mm/yyyy",
                }
                notices.append(
                    f"Compact date format updated: {short_labels[selected_short]}."
                )
        notice = " ".join(notices)
        return _redirect_with_settings_feedback(
            "general",
            notice=notice,
            query_params=settings_state_from_form,
        )

    def language_download_api():
        settings = load_language_settings()
        workbook = Workbook()
        worksheet = workbook.active
        worksheet.title = "i18n mapping"
        worksheet.append(
            ["No.", "English", "繁體中文（香港）", LANGUAGE_LABELS["zh_hans_cn"]]
        )
        for index, row in enumerate(settings.translations, start=1):
            worksheet.append([index, row["en"], row["zh_hant_hk"], row["zh_hans_cn"]])
        worksheet.freeze_panes = "A2"
        widths = {"A": 8, "B": 52, "C": 52, "D": 52}
        for column_letter, width in widths.items():
            worksheet.column_dimensions[column_letter].width = width
        buffer = BytesIO()
        workbook.save(buffer)
        buffer.seek(0)
        return send_file(
            buffer,
            mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            as_attachment=True,
            download_name="worthward-i18n-mapping.xlsx",
        )

    def language_settings_api():
        payload = request.get_json(silent=True) or {}
        language = str(payload.get("language", "")).strip()
        current_language = load_language_settings().language
        selected_language = save_language_code(language or current_language)
        current_full_date_format = load_date_display_settings().full_date_format
        if (
            selected_language in {"zh_hant_hk", "zh_hans_cn"}
            and current_full_date_format == "d_mmm_yyyy"
        ):
            save_full_date_display_format("yyyy_mm_dd_cjk")
        elif selected_language == "en" and current_full_date_format == "yyyy_mm_dd_cjk":
            save_full_date_display_format("d_mmm_yyyy")
        response = jsonify(
            {
                "success": True,
                "language": selected_language,
                "htmlLang": HTML_LANG_BY_LANGUAGE[selected_language],
                "label": LANGUAGE_LABELS[selected_language],
                "dateDisplay": {
                    "full": load_date_display_settings().full_date_format,
                    "short": load_date_display_settings().short_date_format,
                },
            }
        )
        return apply_no_store_headers(response)

    def language_cycle_api():
        current_language = load_language_settings().language
        current_index = SUPPORTED_LANGUAGE_CODES.index(current_language)
        selected_language = SUPPORTED_LANGUAGE_CODES[
            (current_index + 1) % len(SUPPORTED_LANGUAGE_CODES)
        ]
        save_language_code(selected_language)
        current_full_date_format = load_date_display_settings().full_date_format
        if (
            selected_language in {"zh_hant_hk", "zh_hans_cn"}
            and current_full_date_format == "d_mmm_yyyy"
        ):
            save_full_date_display_format("yyyy_mm_dd_cjk")
        elif selected_language == "en" and current_full_date_format == "yyyy_mm_dd_cjk":
            save_full_date_display_format("d_mmm_yyyy")
        response = jsonify(
            {
                "success": True,
                "language": selected_language,
                "htmlLang": HTML_LANG_BY_LANGUAGE[selected_language],
                "label": LANGUAGE_LABELS[selected_language],
                "dateDisplay": {
                    "full": load_date_display_settings().full_date_format,
                    "short": load_date_display_settings().short_date_format,
                },
            }
        )
        return apply_no_store_headers(response)

    def backtest_settings_action():
        notice = ""
        if "backtest_execution_mode" in request.form:
            current_mode = load_backtest_execution_mode()
            selected_mode = save_backtest_execution_mode(
                request.form.get("backtest_execution_mode", "next_open")
            )
            if selected_mode != current_mode:
                selected_label = (
                    "Signal bar close"
                    if selected_mode == "signal_close"
                    else "Next bar open"
                )
                notice = f"Backtest execution model updated: {selected_label}."
        return _redirect_with_settings_feedback("backtest", notice=notice)

    def investment_settings_action():
        current_method = load_investment_cost_basis_method()
        selected_method = save_investment_cost_basis_method(
            request.form.get("investment_cost_basis_method", current_method),
        )
        if selected_method == current_method:
            return _redirect_with_settings_feedback("investment")
        selected_labels = {
            "lowest_cost_first": "Lowest-cost lots first",
            "fifo": "First in, first out (FIFO)",
            "lifo": "Last in, first out (LIFO)",
            "moving_average": "Moving average cost",
        }
        return _redirect_with_settings_feedback(
            "investment",
            notice=(
                "Investment cost basis method updated: "
                f"{selected_labels[selected_method]}."
            ),
        )

    def cash_equivalents_action():
        action = str(request.form.get("action", "save")).strip().lower()
        current = load_cash_equivalent_tickers()
        if action == "add":
            raw = request.form.get("ticker", "") or request.form.get("tickers", "")
            new_ticker = str(raw).strip().upper()
            if new_ticker:
                updated = list(
                    dict.fromkeys(current + [new_ticker])
                )  # preserve order, dedup
                save_cash_equivalent_tickers(updated)
            return _redirect_with_settings_feedback(
                "cash-equivalents", notice="Cash equivalent added."
            )
        if action == "remove":
            target = str(request.form.get("ticker", "")).strip().upper()
            if target:
                updated = [t for t in current if t != target]
                save_cash_equivalent_tickers(updated)
            return _redirect_with_settings_feedback(
                "cash-equivalents", notice="Cash equivalent removed."
            )
        if action == "set":
            # accept repeated tickers or comma
            raw_list = request.form.getlist("ticker") or []
            if not raw_list:
                csv = request.form.get("tickers", "")
                raw_list = [x for x in csv.split(",") if x.strip()]
            updated = _normalize_ticker_list_for_cash(raw_list)
            save_cash_equivalent_tickers(updated)
            return _redirect_with_settings_feedback(
                "cash-equivalents", notice="Cash equivalents updated."
            )
        # default: redirect
        return _redirect_with_settings_feedback("cash-equivalents")

    def _normalize_ticker_list_for_cash(raw_values: list) -> list[str]:
        result: list[str] = []
        seen: set[str] = set()
        for v in raw_values or []:
            t = str(v or "").strip().upper()
            if t and t not in seen:
                seen.add(t)
                result.append(t)
        return result

    def email_smtp_action():
        action = request.form.get("action", "save").strip().lower()
        current_settings = load_smtp_settings()
        mailbox = request.form.get(
            "from_email", current_settings.from_email or current_settings.username
        ).strip()
        updated_settings = SmtpSettings(
            host=YAHOO_SMTP_HOST,
            port=YAHOO_SMTP_PORT,
            username=mailbox,
            password=request.form.get("password", ""),
            from_email=mailbox,
            use_starttls=request.form.getlist("use_starttls")[-1] == "1"
            if request.form.getlist("use_starttls")
            else False,
        )
        if not updated_settings.password:
            updated_settings.password = current_settings.password
        clear_oauth_settings(updated_settings)
        save_smtp_settings(updated_settings)
        if action == "test":
            success, message, updated_settings = test_smtp_connection(updated_settings)
            save_smtp_settings(updated_settings)
        else:
            success, message = True, "Yahoo SMTP settings saved."
        return _redirect_with_settings_feedback(
            "email-smtp",
            notice=message if success else "",
            error="" if success else message,
        )

    def broker_access_action():
        current_settings = load_broker_settings()
        selected_broker = (
            str(request.form.get("selected_broker", current_settings.selected_broker))
            .strip()
            .lower()
            or "longbridge"
        )
        longbridge_auth_mode = current_settings.longbridge_auth_mode
        action = request.form.get("action", "save")
        if action == "authorize" and selected_broker == "longbridge":
            longbridge_auth_mode = "cli_oauth"

        updated_settings = BrokerSettings(
            selected_broker=selected_broker,
            longbridge_auth_mode=longbridge_auth_mode,
            longbridge_cli_path=str(request.form.get("longbridge_cli_path", "")).strip()
            or current_settings.longbridge_cli_path,
            longbridge_cli_home=str(request.form.get("longbridge_cli_home", "")).strip()
            or current_settings.longbridge_cli_home,
            # Legacy Longbridge API credentials remain read-only for backward compatibility.
            # This endpoint intentionally never accepts or stores new Longbridge secrets.
            longbridge_app_key=current_settings.longbridge_app_key,
            longbridge_app_secret=current_settings.longbridge_app_secret,
            longbridge_access_token=current_settings.longbridge_access_token,
            ibkr_account_id=str(request.form.get("ibkr_account_id", "")).strip()
            or current_settings.ibkr_account_id,
        )
        save_broker_settings(updated_settings)
        if action == "authorize":
            if selected_broker != "longbridge":
                return _redirect_with_settings_feedback(
                    "broker-access",
                    error="Select Longbridge before starting browser authorization.",
                )
            success, message = start_longbridge_cli_browser_oauth(updated_settings)
            return _redirect_with_settings_feedback(
                "broker-access",
                notice=message if success else "",
                error="" if success else message,
                longbridge_oauth_pending="1" if success else "",
            )
        if action == "test":
            success, message = test_broker_connection(updated_settings)
            checked_at = datetime.now().astimezone()
            checked_at_label = format_display_datetime(
                checked_at,
                include_seconds=True,
                timezone_suffix=checked_at.strftime("%Z"),
            )
            return _redirect_with_settings_feedback(
                "broker-access",
                broker_test_status="success" if success else "error",
                broker_test_message=message,
                broker_test_checked_at=checked_at_label,
            )
        else:
            notice = (
                "Broker settings were saved only on this device. "
                "This project is open source, and the developer cannot retrieve your local secrets."
            )
            return _redirect_with_settings_feedback("broker-access", notice=notice)

    def longbridge_oauth_status_api():
        settings = load_broker_settings()
        if settings.selected_broker != "longbridge":
            response = jsonify(
                {
                    "status": "error",
                    "message": "Select Longbridge before checking browser authorization.",
                }
            )
            response.status_code = 400
            return apply_no_store_headers(response)

        try:
            auth_status = get_longbridge_cli_auth_status(settings)
        except Exception:  # noqa: BLE001
            LOGGER.exception("Longbridge authorization status check failed")
            response = jsonify(
                {
                    "status": "error",
                    "message": "Longbridge authorization status is temporarily unavailable. Try again later.",
                }
            )
            response.status_code = 503
            return apply_no_store_headers(response)

        token_status = (
            str(((auth_status.get("token") or {}).get("status") or "")).strip().lower()
        )
        if token_status == "refresh_pending":
            return apply_no_store_headers(
                jsonify(
                    {
                        "status": "pending",
                        "message": "Waiting for Longbridge browser authorization to finish.",
                        "token_status": token_status,
                    }
                )
            )

        if token_status != "valid":
            token_failure_messages = {
                "expired": "Longbridge browser authorization expired. Start authorization again.",
                "error": "Longbridge browser authorization failed. Start authorization again.",
                "missing": "Longbridge authorization is unavailable. Start authorization again.",
            }
            return apply_no_store_headers(
                jsonify(
                    {
                        "status": "error",
                        "message": token_failure_messages.get(
                            token_status,
                            "Longbridge authorization did not report a usable token. Start authorization again.",
                        ),
                        "token_status": token_status or "unknown",
                    }
                )
            )

        success, message = test_longbridge_cli_connection(settings)
        response = jsonify(
            {
                "status": "success" if success else "error",
                "message": message,
                "token_status": token_status,
            }
        )
        response.delete_cookie(SETTINGS_FEEDBACK_COOKIE, path="/settings")
        return apply_no_store_headers(response)

    def local_market_store_action():
        ticker = normalize_ticker_input(request.form.get("ticker", ""))
        action = request.form.get("action", "").strip().lower()
        page = normalize_settings_page(
            request.form.get("page", request.form.get("local_page"))
        )

        def build_local_store_redirect(**extra_params: str) -> str:
            return build_settings_state_url(
                "local-market-store",
                page=extra_params.get("page", page),
            )

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
                        query_params={"page": page},
                    )

                notice_parts: list[str] = []
                if total_count == 0:
                    notice = "Local Market Store is already up to date."
                    return _redirect_with_settings_feedback(
                        "local-market-store",
                        notice=notice,
                        query_params={"page": page},
                    )

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
                notice = " ".join(
                    part.rstrip(".") + "." for part in notice_parts if part
                )
                return _redirect_with_settings_feedback(
                    "local-market-store",
                    notice=notice,
                    query_params={"page": page},
                )
            if not ticker:
                return redirect(redirect_url, code=303)
            if action == "refresh":
                refresh_history_store(ticker)
                try:
                    fetch_quote_profile(ticker, force_refresh=True)
                except (
                    AttributeError,
                    ImportError,
                    OSError,
                    ValueError,
                    KeyError,
                    TypeError,
                    RemoteDisconnected,
                ):
                    try:
                        fetch_quote_profile(ticker, force_refresh=False)
                    except (
                        AttributeError,
                        ImportError,
                        OSError,
                        ValueError,
                        KeyError,
                        TypeError,
                        RemoteDisconnected,
                    ):
                        pass
                notice = (
                    f"Saved the latest daily market data for {ticker} to local cache."
                )
                return _redirect_with_settings_feedback(
                    "local-market-store",
                    notice=notice,
                    query_params={"page": page},
                )
            elif action == "refresh-1m":
                refresh_result = refresh_one_minute_store(ticker)
                if refresh_result.source == "longbridge_fallback":
                    notice = (
                        f"Saved the latest 6 months of 1-minute market data for {ticker} "
                        "to local cache (via optional Longbridge fallback after yfinance failed)."
                    )
                elif refresh_result.source == "yfinance_30d":
                    notice = (
                        "Saved the latest "
                        f"{refresh_result.fetched_days} days of 1-minute market data to local cache "
                        f"for {ticker} (via the default yfinance window stitching)."
                    )
                else:
                    notice = (
                        "Saved the latest "
                        f"{refresh_result.fetched_days} days of 1-minute market data to local cache "
                        f"for {ticker} (via the default yfinance source)."
                    )
                return _redirect_with_settings_feedback(
                    "local-market-store",
                    notice=notice,
                    query_params={"page": page},
                )
            elif action == "delete":
                delete_ticker_data(ticker)
                notice = f"Removed all cached data for {ticker} from local storage."
                return _redirect_with_settings_feedback(
                    "local-market-store",
                    notice=notice,
                    query_params={"page": page},
                )
        except Exception:  # noqa: BLE001
            LOGGER.exception("Unable to update local market cache for %s", ticker)
            return _redirect_with_settings_feedback(
                "local-market-store",
                error=f"Unable to update local cache for {ticker}. Try again later.",
                query_params={"page": page},
            )

        return redirect(redirect_url, code=303)

    def settings_cache_action():
        section_name = normalize_settings_section(
            request.form.get("section", "clear-caches")
        )
        action = (
            str(request.form.get("action", "market-data")).strip().lower()
            or "market-data"
        )
        try:
            if action == "investment-transactions":
                if clear_investment_store(INVESTMENT_STORE_PATH):
                    notice = "Cleared the local broker transaction record stored in settings_store/investment.parquet."
                else:
                    notice = "No local broker transaction record was found in settings_store/investment.parquet."
                invalidate_investment_transactions_cache()
            else:
                cache_summary = clear_non_historical_market_cache()
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
        except Exception:  # noqa: BLE001
            LOGGER.exception("Unable to clear cached settings data")
            return _redirect_with_settings_feedback(
                section_name,
                error="Unable to clear cached settings data. Try again later.",
            )

    def market_store_logo(filename: str):
        candidate = LOGOS_STORE_DIR / filename
        if candidate.exists():
            return send_from_directory(LOGOS_STORE_DIR, filename)
        return "Not Found", 404

    def favicon_icon():
        candidate = LOGOS_STORE_DIR / "favicon.svg"
        if candidate.exists():
            return send_from_directory(LOGOS_STORE_DIR, "favicon.svg")
        return "Not Found", 404

    return {
        "_language_rows_from_request_form": _language_rows_from_request_form,
        "_language_rows_from_xlsx_bytes": _language_rows_from_xlsx_bytes,
        "_normalize_ticker_list_for_cash": _normalize_ticker_list_for_cash,
        "backtest_page": backtest_page,
        "backtest_settings_action": backtest_settings_action,
        "broker_access_action": broker_access_action,
        "cash_equivalents_action": cash_equivalents_action,
        "compare_page": compare_page,
        "dca_page": dca_page,
        "email_smtp_action": email_smtp_action,
        "export_transactions_api": export_transactions_api,
        "favicon_icon": favicon_icon,
        "general_settings_action": general_settings_action,
        "grid_trading_page": grid_trading_page,
        "investment_settings_action": investment_settings_action,
        "language_cycle_api": language_cycle_api,
        "language_download_api": language_download_api,
        "language_settings_api": language_settings_api,
        "legacy_backtest_page": legacy_backtest_page,
        "legacy_compare_page": legacy_compare_page,
        "legacy_dca_page": legacy_dca_page,
        "legacy_portfolio_page": legacy_portfolio_page,
        "legacy_trade_messages_page": legacy_trade_messages_page,
        "legacy_trade_page": legacy_trade_page,
        "legacy_trade_root": legacy_trade_root,
        "live_trading_unlock": live_trading_unlock,
        "local_market_store_action": local_market_store_action,
        "longbridge_oauth_status_api": longbridge_oauth_status_api,
        "market_cap_compare_page": market_cap_compare_page,
        "market_store_logo": market_store_logo,
        "portfolio_page": portfolio_page,
        "price_compare_page": price_compare_page,
        "root": root,
        "settings_cache_action": settings_cache_action,
        "settings_page": settings_page,
        "settings_root": settings_root,
        "trade_page": trade_page,
        "trade_root": trade_root,
    }
