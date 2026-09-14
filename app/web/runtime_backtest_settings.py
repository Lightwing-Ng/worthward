"""Build the backtest settings web-runtime context.

Code version: v0.1.0
"""

from __future__ import annotations


def build_backtest_settings_context(context: dict[str, object]) -> dict[str, object]:
    Any = context["Any"]

    BACKTEST_VIEWS = context["BACKTEST_VIEWS"]

    Callable = context["Callable"]

    DAILY_CLOSE_TO_NEXT_SESSION_OPEN = context["DAILY_CLOSE_TO_NEXT_SESSION_OPEN"]

    DEFAULT_INTERVAL = context["DEFAULT_INTERVAL"]

    DEFAULT_PERIOD = context["DEFAULT_PERIOD"]

    DEFAULT_TICKERS = context["DEFAULT_TICKERS"]

    MARKET_STORE_DIR = context["MARKET_STORE_DIR"]

    NEW_YORK_TIMEZONE = context["NEW_YORK_TIMEZONE"]

    PERIOD_OFFSETS = context["PERIOD_OFFSETS"]

    ThreadPoolExecutor = context["ThreadPoolExecutor"]

    _load_strategy_market_datasets = context["_load_strategy_market_datasets"]

    _resolve_strategy_provider_end = context["_resolve_strategy_provider_end"]

    _strategy_interval_notice = context["_strategy_interval_notice"]

    _strategy_model_interval = context["_strategy_model_interval"]

    _strategy_signal_bridge = context["_strategy_signal_bridge"]

    _strategy_supported_execution_intervals = context[
        "_strategy_supported_execution_intervals"
    ]

    as_completed = context["as_completed"]

    base_labels = context["base_labels"]

    bridge_daily_signals_to_intraday = context["bridge_daily_signals_to_intraday"]

    build_date_constraint_payload = context["build_date_constraint_payload"]

    build_strategy_form_fields_for_strategy = context[
        "build_strategy_form_fields_for_strategy"
    ]

    build_strategy_option_groups_from_catalog = context[
        "build_strategy_option_groups_from_catalog"
    ]

    build_strategy_settings_groups_for_factory = context[
        "build_strategy_settings_groups_for_factory"
    ]

    build_supported_periods_for_history_store = context[
        "build_supported_periods_for_history_store"
    ]

    build_supported_periods_from_dates = context["build_supported_periods_from_dates"]

    build_translation_map = context["build_translation_map"]

    classify_daily_store_status = context["classify_daily_store_status"]

    classify_one_minute_store_status = context["classify_one_minute_store_status"]

    combine_backtest_datasets = context["combine_backtest_datasets"]

    defaults = context["defaults"]

    ensure_latest_backtest_caches = context["ensure_latest_backtest_caches"]

    ensure_latest_backtest_intraday_cache = context[
        "ensure_latest_backtest_intraday_cache"
    ]

    ensure_latest_daily_caches = context["ensure_latest_daily_caches"]

    fetch_history = context["fetch_history"]

    fetch_quote_profile = context["fetch_quote_profile"]

    format_display_datetime = context["format_display_datetime"]

    format_store_range_date = context["format_store_range_date"]

    has_logo_asset = context["has_logo_asset"]

    has_profile_record = context["has_profile_record"]

    history_store_path_for = context["history_store_path_for"]

    instantiate_strategy = context["instantiate_strategy"]

    is_ticker_fallback_company_name = context["is_ticker_fallback_company_name"]

    iter_investment_store_ticker_aliases = context[
        "iter_investment_store_ticker_aliases"
    ]

    list_enabled_strategies = context["list_enabled_strategies"]

    list_historical_tickers = context["list_historical_tickers"]

    list_local_tickers = context["list_local_tickers"]

    load_backtest_execution_mode = context["load_backtest_execution_mode"]

    load_broker_settings = context["load_broker_settings"]

    load_language_settings = context["load_language_settings"]

    load_local_one_minute_history = context["load_local_one_minute_history"]

    load_profile_record = context["load_profile_record"]

    load_smtp_settings = context["load_smtp_settings"]

    market_trading_dates_for_history = context["market_trading_dates_for_history"]

    max_tickers_for_view = context["max_tickers_for_view"]

    normalize_ticker = context["normalize_ticker"]

    normalize_ticker_input = context["normalize_ticker_input"]

    normalize_view_name = context["normalize_view_name"]

    one_minute_lookback_start = context["one_minute_lookback_start"]

    parse_bool_flag = context["parse_bool_flag"]

    parse_float_value = context["parse_float_value"]

    parse_portfolio_allocation_mode = context["parse_portfolio_allocation_mode"]

    parse_range_request_args = context["parse_range_request_args"]

    parse_requested_shares = context["parse_requested_shares"]

    parse_requested_tickers = context["parse_requested_tickers"]

    parse_requested_weights = context["parse_requested_weights"]

    pd = context["pd"]

    refresh_history_store = context["refresh_history_store"]

    refresh_quote_profile_cache = context["refresh_quote_profile_cache"]

    request = context["request"]

    resolve_backtest_tickers = context["resolve_backtest_tickers"]

    resolve_comparison_metric = context["resolve_comparison_metric"]

    resolve_effective_period_for_datasets = context[
        "resolve_effective_period_for_datasets"
    ]

    resolve_known_ticker_company_name = context["resolve_known_ticker_company_name"]

    resolve_requested_period_from_supported = context[
        "resolve_requested_period_from_supported"
    ]

    resolve_stored_logo_url = context["resolve_stored_logo_url"]

    run_network_self_check = context["run_network_self_check"]

    run_single_ticker_backtest = context["run_single_ticker_backtest"]

    select_price_series = context["select_price_series"]

    settings_page_value = context["settings_page_value"]

    simulate_recurring_investment = context["simulate_recurring_investment"]

    slice_dataset_for_period = context["slice_dataset_for_period"]

    slice_dataset_to_exact_range = context["slice_dataset_to_exact_range"]

    slice_intraday_history_for_exact_range = context[
        "slice_intraday_history_for_exact_range"
    ]

    slice_intraday_history_for_period = context["slice_intraday_history_for_period"]

    translate_labels = context["translate_labels"]

    translate_text = context["translate_text"]

    url_for = context["url_for"]

    validate_ticker_or_raise = context["validate_ticker_or_raise"]

    def _run_backtest_from_request():
        backtest_execution_mode = load_backtest_execution_mode()
        strategy_options = list_enabled_strategies()
        is_grid_workspace = (
            request.args.get("workspace", "").strip().lower() == "grid-trading"
        )
        default_strategy_id = (
            "grid-trading"
            if is_grid_workspace
            else defaults.get(
                "backtest_strategy",
                strategy_options[0]["id"] if strategy_options else "",
            )
        )
        selected_strategy_id = (
            "grid-trading"
            if is_grid_workspace
            else request.args.get("strategy", default_strategy_id).strip()
        )
        strategy_ids = {str(item["id"]) for item in strategy_options}
        if selected_strategy_id not in strategy_ids and strategy_options:
            selected_strategy_id = str(strategy_options[0]["id"])
        if selected_strategy_id == "dca":
            return _run_dca_from_request()
        strategy = instantiate_strategy(selected_strategy_id)
        selected_strategy_params = collect_strategy_form_values(selected_strategy_id)
        requested_tickers = parse_requested_tickers()
        requested_tickers, required_tickers, _ = resolve_backtest_tickers(
            requested_tickers,
            selected_strategy_id,
        )
        if not requested_tickers:
            fallback_ticker = normalize_ticker_input(
                str(defaults.get("backtest_ticker", DEFAULT_TICKERS[0]))
            )
            requested_tickers, required_tickers, _ = resolve_backtest_tickers(
                [fallback_ticker] if fallback_ticker else [],
                selected_strategy_id,
            )
        if len(requested_tickers) < required_tickers:
            raise ValueError(
                f"{strategy.get_metadata().name} requires {required_tickers} tickers."
            )
        validated_tickers = [
            validate_ticker_or_raise(ticker) for ticker in requested_tickers
        ]
        if len(set(validated_tickers)) != len(validated_tickers):
            raise ValueError(
                f"{strategy.get_metadata().name} requires distinct tickers."
            )
        uses_strategy_market_data = (
            str(getattr(strategy, "strategy_market_data_source", "default"))
            .strip()
            .lower()
            != "default"
        )
        refreshes = (
            []
            if uses_strategy_market_data
            else [ensure_latest_backtest_caches(ticker) for ticker in validated_tickers]
        )
        price_only = request.args.get(
            "return", ""
        ).strip().lower() == "price" or parse_bool_flag(
            "price_only", "price_return_only"
        )
        include_dividends = (
            False
            if price_only
            else (
                request.args.get("return", "").strip().lower() == "dividends"
                or parse_bool_flag("dividends", "include_dividends")
            )
        )
        stop_loss_enabled = parse_bool_flag(
            "stop_loss",
            default=bool(defaults.get("backtest_stop_loss", False)),
        )
        range_mode, period, exact_start, exact_end = parse_range_request_args()
        supported_intervals = _strategy_supported_execution_intervals(
            strategy,
            validated_tickers,
        )
        requested_interval = (
            request.args.get(
                "interval", defaults.get("backtest_interval", DEFAULT_INTERVAL)
            )
            .strip()
            .lower()
        )
        if (
            not request.args.get("interval")
            and period == "1w"
            and "1m" in supported_intervals
        ):
            requested_interval = "1m"
        if requested_interval not in supported_intervals:
            requested_interval = supported_intervals[0]
        if range_mode != "exact" and requested_interval == "1m":
            intraday_periods = build_supported_periods_for_history_store(
                validated_tickers[0],
                "1m",
            )
            period, _ = resolve_requested_period_from_supported(
                period,
                intraday_periods,
            )
        model_interval = _strategy_model_interval(strategy, requested_interval)
        signal_bridge = _strategy_signal_bridge(strategy, requested_interval)
        if model_interval != requested_interval and not signal_bridge:
            raise ValueError(
                "A mixed-frequency Backtest strategy must declare a signal bridge."
            )
        if uses_strategy_market_data and signal_bridge and requested_interval == "1m":
            refreshes = [
                ensure_latest_backtest_intraday_cache(ticker)
                for ticker in validated_tickers
            ]
        backtest_cache_refresh = {
            "daily_error": any(
                bool(refresh.get("daily_error")) for refresh in refreshes
            ),
            "intraday_error": any(
                bool(refresh.get("intraday_error")) for refresh in refreshes
            ),
        }
        provider_end = (
            pd.Timestamp(exact_end)
            if range_mode == "exact" and exact_end
            else _resolve_strategy_provider_end(validated_tickers[0])
        )
        provider_start = (
            pd.Timestamp(exact_start)
            if range_mode == "exact" and exact_start
            else provider_end - PERIOD_OFFSETS.get(period, pd.DateOffset(years=10))
        )
        if requested_interval == "1m" and range_mode != "exact":
            provider_start = max(
                provider_start,
                one_minute_lookback_start()
                .tz_convert(NEW_YORK_TIMEZONE)
                .tz_localize(None)
                .normalize(),
            )
        strategy_datasets = _load_strategy_market_datasets(
            strategy,
            validated_tickers,
            interval=model_interval,
            start=provider_start,
            end=provider_end,
            params=selected_strategy_params,
        )
        model_dataset = None
        if strategy_datasets is not None:
            model_dataset = (
                combine_backtest_datasets(strategy_datasets)
                if required_tickers > 1
                else strategy_datasets[0]
            )
        trade_datasets = (
            strategy_datasets
            if (strategy_datasets is not None and model_interval == requested_interval)
            else [
                (
                    load_local_one_minute_history(ticker)
                    if signal_bridge and requested_interval == "1m"
                    else fetch_history(
                        ticker,
                        False,
                        interval=requested_interval,
                        dividend_mode="price",
                    )
                )
                for ticker in validated_tickers
            ]
        )
        if len(trade_datasets) != required_tickers:
            raise ValueError(
                f"{strategy.get_metadata().name} returned an invalid market dataset count."
            )
        trade_dataset = (
            combine_backtest_datasets(trade_datasets)
            if required_tickers > 1
            else trade_datasets[0]
        )

        if requested_interval == "1m":
            six_months_ago = (
                one_minute_lookback_start()
                .tz_convert(NEW_YORK_TIMEZONE)
                .tz_localize(None)
            )
            trade_dataset = trade_dataset[trade_dataset["Date"] >= six_months_ago]

        constraint_dataset = (
            pd.DataFrame(
                {
                    "Date": market_trading_dates_for_history(
                        trade_dataset,
                        validated_tickers[0],
                    ),
                }
            )
            if requested_interval == "1m"
            else trade_dataset
        )
        date_constraints = build_date_constraint_payload(
            constraint_dataset,
            requested_start=exact_start or None,
            requested_end=exact_end or None,
        )
        if range_mode == "exact":
            if not date_constraints.trading_dates:
                raise ValueError(
                    "The selected exact range does not contain trading dates."
                )
            trade_dataset = (
                slice_intraday_history_for_exact_range(
                    trade_dataset,
                    validated_tickers[0],
                    date_constraints.adjusted_start,
                    date_constraints.adjusted_end,
                )
                if requested_interval == "1m"
                else slice_dataset_to_exact_range(
                    trade_dataset,
                    date_constraints.adjusted_start,
                    date_constraints.adjusted_end,
                )
            )
            if trade_dataset.empty:
                raise ValueError(
                    "The selected exact range does not contain trading dates."
                )
        else:
            common_end_date = trade_dataset["Date"].max()
            trade_dataset = (
                slice_intraday_history_for_period(
                    trade_dataset,
                    validated_tickers[0],
                    period,
                )
                if requested_interval == "1m"
                else slice_dataset_for_period(
                    trade_dataset,
                    period,
                    common_end_date,
                )
            )

        backtest_initial_capital = max(
            parse_float_value(
                request.args.get("capital", request.args.get("initial_capital")),
                float(defaults.get("backtest_capital", 10000.0)),
            ),
            1.0,
        )

        if signal_bridge:
            if model_dataset is None:
                raise ValueError(
                    "The interval bridge requires a strategy model dataset."
                )
            execution_trading_dates = market_trading_dates_for_history(
                trade_dataset,
                validated_tickers[0],
            )
            model_dates = pd.to_datetime(
                model_dataset["Date"],
                errors="coerce",
            )
            if model_dates.isna().any():
                raise ValueError(
                    "The strategy model dataset contains an invalid timestamp."
                )
            if model_dates.dt.tz is not None:
                model_dates = model_dates.dt.tz_localize(None)
            execution_start = execution_trading_dates.min().normalize()
            execution_end = execution_trading_dates.max().normalize()
            visible_model_dataset = model_dataset.loc[
                model_dates.dt.normalize().between(execution_start, execution_end)
            ].copy()
            if visible_model_dataset.empty:
                raise ValueError(
                    "The strategy model data does not overlap the execution range."
                )
            daily_signal_result = strategy.compute_signals(
                visible_model_dataset,
                selected_strategy_params,
            )
            if signal_bridge != DAILY_CLOSE_TO_NEXT_SESSION_OPEN:
                raise ValueError(
                    f"Unsupported strategy signal bridge: {signal_bridge}."
                )
            signal_result = bridge_daily_signals_to_intraday(
                daily_signal_result,
                trade_dataset,
                execution_trading_dates,
            )
        else:
            signal_result = strategy.compute_signals(
                trade_dataset,
                selected_strategy_params,
            )
        if hasattr(signal_result, "metadata") and isinstance(
            signal_result.metadata, dict
        ):
            signal_result.metadata["tickers"] = validated_tickers
        backtest_result = run_single_ticker_backtest(
            signal_result,
            backtest_initial_capital,
            execution_mode=backtest_execution_mode,
            interval=requested_interval,
            reinvest_cash_dividends=include_dividends,
            include_cash_dividends=not price_only,
            stop_loss_enabled=stop_loss_enabled,
        )
        interval_notice = _strategy_interval_notice(strategy, requested_interval)
        if interval_notice:
            backtest_result["strategy_interval_notice"] = interval_notice
        return (
            backtest_result,
            validated_tickers[0],
            requested_interval,
            date_constraints,
            trade_dataset,
            selected_strategy_id,
            selected_strategy_params,
            backtest_cache_refresh,
        )

    def build_strategy_option_groups(
        strategy_options: list[dict[str, object]],
    ) -> list[dict[str, object]]:
        return build_strategy_option_groups_from_catalog(strategy_options)

    def collect_strategy_form_values(strategy_id: str) -> dict[str, Any]:
        strategy = instantiate_strategy(strategy_id)
        get_startup_params = getattr(strategy, "get_startup_params", None)
        startup_params = (
            get_startup_params()
            if callable(get_startup_params)
            else strategy.normalize_params({})
        )
        raw_values: dict[str, Any] = {}
        for definition in strategy.get_parameter_definitions():
            raw_value = request.args.get(definition.key)
            if raw_value is None or str(raw_value).strip() == "":
                raw_values[definition.key] = startup_params[definition.key]
            else:
                raw_values[definition.key] = raw_value
        return strategy.normalize_params(raw_values)

    def _run_dca_from_request(requested_tickers: list[str] | None = None):
        """Run the recurring-investment simulator through the Backtest request contract."""
        requested = [
            normalize_ticker_input(str(value))
            for value in (requested_tickers or parse_requested_tickers("backtest"))
            if normalize_ticker_input(str(value))
        ]
        if not requested:
            fallback = normalize_ticker_input(
                str(
                    defaults.get(
                        "dca_ticker",
                        defaults.get("backtest_ticker", DEFAULT_TICKERS[0]),
                    )
                )
            )
            requested = [fallback] if fallback else [DEFAULT_TICKERS[0]]
        ticker = validate_ticker_or_raise(requested[0])
        refreshes = ensure_latest_daily_caches([ticker])
        try:
            dataset = fetch_history(ticker, False, dividend_mode="price")
        except ValueError:
            path = history_store_path_for(ticker)
            if not path.exists():
                raise
            dataset = select_price_series(
                pd.read_parquet(path),
                False,
                dividend_mode="price",
            )

        range_mode, period, exact_start, exact_end = parse_range_request_args()
        date_constraints = build_date_constraint_payload(
            dataset,
            requested_start=exact_start or None,
            requested_end=exact_end or None,
        )
        if range_mode == "exact":
            if not date_constraints.trading_dates:
                raise ValueError(
                    "The selected exact range does not contain trading dates."
                )
            dataset = slice_dataset_to_exact_range(
                dataset,
                date_constraints.adjusted_start,
                date_constraints.adjusted_end,
            )
        else:
            supported_periods = build_supported_periods_from_dates(
                dataset["Date"], interval="1d"
            )
            period, _ = resolve_requested_period_from_supported(
                period,
                supported_periods,
                earliest_available=dataset["Date"].min() if not dataset.empty else None,
            )
            dataset = slice_dataset_for_period(dataset, period, dataset["Date"].max())
        if dataset.empty:
            raise ValueError(
                f"No market data available for {ticker} in the selected range."
            )

        params = collect_strategy_form_values("dca")
        stop_loss_enabled = parse_bool_flag(
            "stop_loss",
            default=bool(defaults.get("backtest_stop_loss", False)),
        )
        result = simulate_recurring_investment(
            ticker,
            dataset,
            amount_per_period=params["amount"],
            frequency=params["frequency"],
            weekday=params["weekday"],
            month_day=params["month_day"],
            reinvest_cash_dividends=(
                request.args.get("return", "").strip().lower() == "dividends"
            )
            or parse_bool_flag("dividends", "include_dividends"),
            include_cash_dividends=request.args.get("return", "").strip().lower()
            != "price"
            and not parse_bool_flag("price_only", "price_return_only"),
            stop_loss_enabled=stop_loss_enabled,
        )
        return (
            result,
            ticker,
            "1d",
            date_constraints,
            dataset,
            "dca",
            params,
            {"daily_error": any(bool(refresh) for refresh in refreshes)},
        )

    def build_strategy_form_fields(
        strategy_id: str, values: dict[str, Any] | None = None
    ) -> list[dict[str, object]]:
        return build_strategy_form_fields_for_strategy(
            strategy_id,
            values,
            strategy_factory=instantiate_strategy,
        )

    def build_strategy_settings_groups(
        strategy_options: list[dict[str, object]],
    ) -> list[dict[str, object]]:
        return build_strategy_settings_groups_for_factory(
            strategy_options,
            strategy_factory=instantiate_strategy,
        )

    def build_local_store_pagination_ranges(
        first_page: int,
        last_page: int,
        chunk_size: int = 5,
    ) -> list[tuple[int, int]]:
        if first_page > last_page:
            return []
        ranges = [
            (range_start, min(range_start + chunk_size - 1, last_page))
            for range_start in range(first_page, last_page + 1, chunk_size)
        ]
        if len(ranges) > 1 and ranges[-1][1] - ranges[-1][0] + 1 < chunk_size:
            ranges[-2] = (ranges[-2][0], ranges[-1][1])
            ranges.pop()
        return ranges

    def build_local_store_pagination_items(
        current_page: int,
        total_pages: int,
    ) -> list[dict[str, Any]]:
        page_group_index = (current_page - 1) // 5
        page_start = (page_group_index * 5) + 1
        page_end = min(page_start + 4, total_pages)
        items: list[dict[str, Any]] = []

        if total_pages <= 1:
            return items
        if total_pages <= 5:
            return [
                {
                    "kind": "page",
                    "page": page_number,
                    "is_active": page_number == current_page,
                }
                for page_number in range(1, total_pages + 1)
            ]

        if page_start > 1:
            items.extend(
                (
                    {"kind": "previous", "page": page_start - 1},
                    {"kind": "page", "page": 1, "is_active": current_page == 1},
                    {
                        "kind": "ellipsis",
                        "position": "leading",
                        "ranges": build_local_store_pagination_ranges(
                            1, page_start - 1
                        ),
                    },
                )
            )

        items.extend(
            {
                "kind": "page",
                "page": page_number,
                "is_active": page_number == current_page,
            }
            for page_number in range(page_start, page_end + 1)
        )

        if page_end < total_pages:
            items.extend(
                (
                    {
                        "kind": "ellipsis",
                        "position": "trailing",
                        "ranges": build_local_store_pagination_ranges(
                            page_end + 1, total_pages
                        ),
                    },
                    {
                        "kind": "page",
                        "page": total_pages,
                        "is_active": current_page == total_pages,
                    },
                    {"kind": "next", "page": page_end + 1},
                )
            )
        return items

    def has_local_profile_snapshot(ticker: str) -> bool:
        return has_profile_record(ticker)

    def has_local_logo_snapshot(ticker: str) -> bool:
        return has_logo_asset(ticker)

    def list_local_market_tickers() -> list[str]:
        # Project canonical form for US stocks is bare symbol (e.g. "BAC").
        # Support legacy files named "XXX.US.parquet" coming from Longbridge imports
        # without polluting the displayed symbol.
        def _has_usable_history(t: str) -> bool:
            p = history_store_path_for(t)
            if p.exists() and p.stat().st_size > 0:
                return True
            # legacy polluted name from Longbridge
            legacy = (
                MARKET_STORE_DIR / "historical" / f"{normalize_ticker(t)}.US.parquet"
            )
            return legacy.exists() and legacy.stat().st_size > 0

        return [
            ticker
            for ticker in list_local_tickers()
            if _has_usable_history(ticker)
            and has_local_profile_snapshot(ticker)
            and has_local_logo_snapshot(ticker)
        ]

    def load_local_profile_snapshot(ticker: str) -> tuple[str, str] | None:
        normalized_ticker = normalize_ticker_input(ticker)
        fallback_logo_url = ""
        for candidate in iter_investment_store_ticker_aliases(ticker):
            profile_record = load_profile_record(candidate)
            if profile_record is None:
                continue
            logo_url = resolve_stored_logo_url(candidate)
            if not logo_url:
                continue
            company_name = str(profile_record.get("company_name") or "").strip()
            if not is_ticker_fallback_company_name(company_name, normalized_ticker):
                return company_name, logo_url
            if company_name:
                fallback_logo_url = fallback_logo_url or logo_url
        if normalized_ticker and fallback_logo_url:
            return (
                resolve_known_ticker_company_name(normalized_ticker)
                or normalized_ticker,
                fallback_logo_url,
            )
        if normalized_ticker:
            return None
        return None

    def resolve_ticker_identity_snapshot(
        ticker: str,
        *,
        allow_remote_refresh: bool = True,
    ) -> tuple[str, str]:
        profile_snapshot = load_local_profile_snapshot(ticker)
        if profile_snapshot is not None:
            return profile_snapshot

        normalized_ticker = normalize_ticker_input(ticker)
        company_name = normalized_ticker
        logo_url = ""
        for candidate in iter_investment_store_ticker_aliases(ticker):
            profile_record = load_profile_record(candidate) or {}
            candidate_company_name = str(
                profile_record.get("company_name") or ""
            ).strip()
            candidate_logo_url = resolve_stored_logo_url(candidate)
            if not is_ticker_fallback_company_name(
                candidate_company_name, normalized_ticker
            ):
                company_name = candidate_company_name
            elif not company_name:
                company_name = candidate_company_name or normalized_ticker
            if candidate_logo_url and not logo_url:
                logo_url = candidate_logo_url
            if logo_url and company_name and company_name.upper() != normalized_ticker:
                break

        if allow_remote_refresh and (
            not logo_url or company_name.upper() == normalized_ticker
        ):
            for candidate in iter_investment_store_ticker_aliases(ticker):
                profile = fetch_quote_profile(candidate, force_refresh=True)
                profile_company_name = str(profile.company_name or "").strip()
                if (
                    profile_company_name
                    and profile_company_name.upper() != str(candidate).upper()
                ):
                    company_name = profile_company_name
                logo_url = str(profile.logo_url or "").strip() or logo_url
                if (
                    logo_url
                    and company_name
                    and company_name.upper() != normalized_ticker
                ):
                    break
        if company_name.upper() == normalized_ticker:
            known_company_name = resolve_known_ticker_company_name(ticker)
            if known_company_name:
                company_name = known_company_name
        return company_name, logo_url

    def build_local_market_rows_for_tickers(
        tickers: list[str],
        *,
        include_ranges: bool,
    ) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        for ticker in tickers:
            history_path = history_store_path_for(ticker)
            if not history_path.exists() or history_path.stat().st_size == 0:
                # fallback for Longbridge-polluted "BAC.US.parquet" etc.
                legacy_path = (
                    MARKET_STORE_DIR
                    / "historical"
                    / f"{normalize_ticker(ticker)}.US.parquet"
                )
                if legacy_path.exists() and legacy_path.stat().st_size > 0:
                    history_path = legacy_path
                else:
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
                except (ImportError, OSError, ValueError, KeyError, TypeError):
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
                    "range": f"{range_start} - {range_end}"
                    if range_start and range_end
                    else "",
                    "has_1m": intraday_store_status == "fresh",
                    "has_1d": daily_store_status == "fresh",
                    "daily_store_status": daily_store_status,
                    "intraday_store_status": intraday_store_status,
                }
            )
        return rows

    def build_network_service_rows(
        *,
        pending: bool,
        service_labels: dict[str, str] | None = None,
        translate_fn: Callable[[str], str] | None = None,
    ) -> list[dict[str, Any]]:
        if service_labels is None or translate_fn is None:
            current_language_settings = load_language_settings()
            current_translations = build_translation_map(current_language_settings)
            service_labels = service_labels or translate_labels(
                base_labels,
                current_language_settings,
            )
            if translate_fn is None:

                def translate_fn(value: str) -> str:
                    return translate_text(
                        value,
                        current_language_settings.language,
                        current_translations,
                    )

        translate = translate_fn

        def service_logo_url(filename: str) -> str:
            return url_for("static", filename=f"images/{filename}")

        def format_checked_at(value: float | None) -> str:
            prefix = translate("Last checked:")
            if value is None:
                return f"{prefix} {translate('Not checked yet.')}"
            stamp = pd.Timestamp(value, unit="s")
            return f"{prefix} {format_display_datetime(stamp, include_seconds=True)}"

        service_definitions = (
            {
                "key": "market",
                "name": "yfinance",
                "logo": "Yahoo-Logo.svg",
                "pending_note": "Checking Yahoo Finance Chart through the verified HTTP(S) and yfinance transports from this application host.",
            },
            {
                "key": "sec",
                "name": "SEC EDGAR",
                "logo": "network.svg",
                "pending_note": "Checking SEC EDGAR submissions through the verified HTTP(S) transport from this application host.",
            },
            {
                "key": "longbridge",
                "name": "Longbridge OpenAPI",
                "logo": "network.svg",
                "pending_note": "Checking the Longbridge OpenAPI transport without sending credentials or trading requests.",
            },
            {
                "key": "logo",
                "name": service_labels["logo_network"],
                "logo": "apple.logo.svg",
                "pending_note": "Checking the primary ticker logo provider and its fallback providers from this application host.",
            },
            {
                "key": "google-hk",
                "name": translate("Google (Hong Kong)"),
                "logo": "Google__G__logo.svg",
                "pending_note": "Checking Google (Hong Kong) and its global fallback from this application host.",
            },
            {
                "key": "smtp",
                "name": "Yahoo Mail SMTP",
                "logo": "envelope.fill.svg",
                "pending_note": "Checking the configured SMTP host and STARTTLS transport without submitting mailbox credentials.",
            },
        )

        if pending:
            return [
                {
                    "key": definition["key"],
                    "name": definition["name"],
                    "status": translate("Checking..."),
                    "note": translate(definition["pending_note"]),
                    "pending_note": translate(definition["pending_note"]),
                    "checked_at_text": f"{translate('Last checked:')} {translate('Checking...')}",
                    "logo_url": service_logo_url(definition["logo"]),
                    "is_available": False,
                    "is_pending": True,
                }
                for definition in service_definitions
            ]

        raw_payload = run_network_self_check(
            smtp_settings=load_smtp_settings(),
            broker_settings=load_broker_settings(),
        )
        raw_rows = {
            str(item.get("key")): item
            for item in raw_payload.get("rows", [])
            if isinstance(item, dict)
        }
        status_labels = {
            "available": service_labels["service_ok"],
            "unavailable": service_labels["service_down"],
            "disabled": translate("Disabled by configuration"),
            "not_configured": translate("Not configured"),
            "not_installed": translate("Not installed"),
            "not_applicable": translate("Not applicable"),
        }
        rows: list[dict[str, Any]] = []
        for definition in service_definitions:
            raw_row = raw_rows.get(definition["key"], {})
            state = str(raw_row.get("state") or "unavailable")
            checked_at_value = raw_row.get("checked_at")
            try:
                checked_at = (
                    float(checked_at_value) if checked_at_value is not None else None
                )
            except (TypeError, ValueError):
                checked_at = None
            rows.append(
                {
                    "key": definition["key"],
                    "name": definition["name"],
                    "status": status_labels.get(state, service_labels["service_down"]),
                    "note": str(
                        raw_row.get("note") or translate("No diagnostic was returned.")
                    ),
                    "pending_note": translate(definition["pending_note"]),
                    "checked_at_text": format_checked_at(checked_at),
                    "logo_url": service_logo_url(definition["logo"]),
                    "is_available": bool(raw_row.get("is_available")),
                    "is_pending": False,
                    "state": state,
                    "latency_ms": raw_row.get("latency_ms"),
                }
            )
        return rows

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
            metadata_was_refreshed = refresh_quote_profile_cache(
                ticker, force_refresh=True
            )
            if not metadata_was_refreshed:
                fetch_quote_profile(ticker, force_refresh=False)
            return ticker, metadata_was_refreshed

        history_refreshed_count = 0
        metadata_refreshed_count = 0
        history_failed_tickers: list[str] = []
        worker_count = min(6, len(historical_tickers))
        with ThreadPoolExecutor(max_workers=worker_count) as executor:
            futures = {
                executor.submit(refresh_local_entry, ticker): ticker
                for ticker in historical_tickers
            }
            for future in as_completed(futures):
                ticker = futures[future]
                try:
                    _, entry_metadata_refreshed = future.result()
                    history_refreshed_count += 1
                    if entry_metadata_refreshed:
                        metadata_refreshed_count += 1
                except (ImportError, OSError, ValueError, KeyError, TypeError):
                    history_failed_tickers.append(ticker)
        return {
            "total_count": len(historical_tickers),
            "history_refreshed_count": history_refreshed_count,
            "metadata_refreshed_count": metadata_refreshed_count,
            "metadata_blocked_count": max(
                history_refreshed_count - metadata_refreshed_count, 0
            ),
            "history_failed_tickers": history_failed_tickers,
        }

    def local_store_page_value() -> int:
        return settings_page_value()

    def build_modern_query_pairs(view_name: str | None = None) -> list[tuple[str, str]]:
        pairs: list[tuple[str, str]] = []
        normalized_view = normalize_view_name(view_name)
        comparison_metric = resolve_comparison_metric(normalized_view)
        view_max_tickers = max_tickers_for_view(normalized_view, comparison_metric)

        for ticker in parse_requested_tickers(normalized_view, comparison_metric):
            pairs.append(("ticker", ticker))

        if (
            normalized_view in {"market-caps", "prices"}
            and comparison_metric == "market-cap"
        ):
            pairs.append(("metric", comparison_metric))

        has_weight_args = bool(request.args.getlist("weight")) or any(
            key.startswith("weight_") for key in request.args.keys()
        )
        allocation_mode = parse_portfolio_allocation_mode()
        has_share_args = bool(request.args.getlist("shares")) or any(
            key.startswith("shares_") for key in request.args.keys()
        )
        if allocation_mode == "shares" and has_share_args:
            pairs.append(("allocation", "shares"))
            for share_count in parse_requested_shares(view_max_tickers):
                pairs.append(("shares", str(share_count)))
        elif has_weight_args:
            for weight in parse_requested_weights(view_max_tickers):
                pairs.append(("weight", str(weight)))

        raw_range_value = (
            request.args.get("range", request.args.get("range_mode", ""))
            .strip()
            .lower()
        )
        period_value = request.args.get("period", "").strip().lower()
        if raw_range_value in {"exact", "custom"}:
            pairs.append(("range", "custom"))
            if period_value:
                pairs.append(("period", period_value))
        elif (
            period_value
            and period_value
            != str(defaults.get("period", DEFAULT_PERIOD)).strip().lower()
        ):
            pairs.append(("range", period_value))
        elif raw_range_value and raw_range_value not in {"period"}:
            pairs.append(("range", raw_range_value))

        date_value = request.args.get(
            "date",
            request.args.get(
                "trading_date", request.args.get("exact_trading_date", "")
            ),
        ).strip()
        start_value = request.args.get(
            "from", request.args.get("exact_start", "")
        ).strip()
        end_value = request.args.get("to", request.args.get("exact_end", "")).strip()
        if date_value and (
            period_value == "1d" or raw_range_value in {"exact", "custom"}
        ):
            pairs.append(("date", date_value))
        else:
            if start_value:
                pairs.append(("from", start_value))
            if end_value:
                pairs.append(("to", end_value))

        return_value = request.args.get("return", "").strip().lower()
        price_only_value = request.args.get(
            "price_only", request.args.get("price_return_only", "")
        ).strip()
        dividends_value = request.args.get(
            "dividends", request.args.get("include_dividends", "")
        ).strip()
        if return_value in {"price", "total"}:
            if return_value == "price":
                pairs.append(("return", "price"))
        elif price_only_value == "1":
            pairs.append(("return", "price"))
        elif dividends_value == "1":
            pairs.append(("dividends", "1"))

        stop_loss_value = request.args.get("stop_loss", "").strip()
        if stop_loss_value in {"0", "1"}:
            pairs.append(("stop_loss", stop_loss_value))

        show_trade_details_value = request.args.get("show_trade_details", "").strip()
        if normalized_view in BACKTEST_VIEWS and show_trade_details_value in {"0", "1"}:
            pairs.append(("show_trade_details", show_trade_details_value))

        overnight_value = request.args.get(
            "overnight", request.args.get("include_overnight", "")
        ).strip()
        if overnight_value == "1":
            pairs.append(("overnight", "1"))

        extended_hours_value = request.args.get(
            "extended-hours",
            request.args.get(
                "extended_hours", request.args.get("include_extended_hours", "")
            ),
        ).strip()
        if extended_hours_value == "1":
            pairs.append(("extended-hours", "1"))

        chips_value = request.args.get("chips", "").strip()
        if (
            normalized_view == "prices"
            and comparison_metric == "price"
            and chips_value == "1"
        ):
            pairs.append(("chips", "1"))

        strategy_value = request.args.get("strategy", "").strip()
        if strategy_value:
            pairs.append(("strategy", strategy_value))

        capital_value = request.args.get(
            "capital", request.args.get("initial_capital", "")
        ).strip()
        if capital_value:
            pairs.append(("capital", capital_value))

        amount_value = request.args.get("amount", "").strip()
        if amount_value:
            pairs.append(("amount", amount_value))

        frequency_value = request.args.get("frequency", "").strip().lower()
        if frequency_value:
            pairs.append(("frequency", frequency_value))

        weekday_value = request.args.get("weekday", "").strip()
        if weekday_value:
            pairs.append(("weekday", weekday_value))

        month_day_value = request.args.get(
            "month-day", request.args.get("month_day", "")
        ).strip()
        if month_day_value:
            pairs.append(("month-day", month_day_value))

        tab_value = (
            request.args.get("tab", request.args.get("trade_detail_tab", ""))
            .strip()
            .lower()
        )
        if tab_value == "transactions":
            pairs.append(("tab", "transactions"))

        page_value = request.args.get(
            "page", request.args.get("local_page", "")
        ).strip()
        if page_value:
            pairs.append(("page", page_value))

        passthrough_keys = {
            "ticker",
            "tickers",
            "weight",
            "allocation",
            "shares",
            "period",
            "range",
            "range_mode",
            "date",
            "trading_date",
            "exact_trading_date",
            "from",
            "to",
            "exact_start",
            "exact_end",
            "dividends",
            "include_dividends",
            "return",
            "price_only",
            "price_return_only",
            "stop_loss",
            "show_trade_details",
            "extended-hours",
            "extended_hours",
            "include_extended_hours",
            "overnight",
            "include_overnight",
            "chips",
            "strategy",
            "capital",
            "initial_capital",
            "amount",
            "frequency",
            "weekday",
            "month_day",
            "month-day",
            "tab",
            "trade_detail_tab",
            "page",
            "local_page",
            "view",
            "section",
            "ticker_a",
            "ticker_b",
            "metric",
        }
        passthrough_keys.update(
            {f"ticker_{index}" for index in range(1, view_max_tickers + 1)}
        )
        passthrough_keys.update(
            {f"weight_{index}" for index in range(1, view_max_tickers + 1)}
        )
        passthrough_keys.update(
            {f"shares_{index}" for index in range(1, view_max_tickers + 1)}
        )

        strategy_param_keys: set[str] = set()
        strategy_value = request.args.get("strategy", "").strip()
        if strategy_value:
            try:
                strategy = instantiate_strategy(strategy_value)
                strategy_param_keys = {
                    definition.key
                    for definition in strategy.get_parameter_definitions()
                }
            except (AttributeError, ImportError, TypeError, ValueError):
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

    def resolve_effective_period_for_many(
        requested_period: str, datasets: list[pd.DataFrame]
    ) -> tuple[str, str | None]:
        return resolve_effective_period_for_datasets(requested_period, datasets)

    return {
        "_run_backtest_from_request": _run_backtest_from_request,
        "_run_dca_from_request": _run_dca_from_request,
        "build_local_market_rows_for_tickers": build_local_market_rows_for_tickers,
        "build_local_store_pagination_items": build_local_store_pagination_items,
        "build_local_store_pagination_ranges": build_local_store_pagination_ranges,
        "build_modern_query_pairs": build_modern_query_pairs,
        "build_network_service_rows": build_network_service_rows,
        "build_strategy_form_fields": build_strategy_form_fields,
        "build_strategy_option_groups": build_strategy_option_groups,
        "build_strategy_settings_groups": build_strategy_settings_groups,
        "collect_strategy_form_values": collect_strategy_form_values,
        "has_local_logo_snapshot": has_local_logo_snapshot,
        "has_local_profile_snapshot": has_local_profile_snapshot,
        "list_local_market_tickers": list_local_market_tickers,
        "load_local_profile_snapshot": load_local_profile_snapshot,
        "local_store_page_value": local_store_page_value,
        "maintain_local_market_store": maintain_local_market_store,
        "resolve_effective_period_for_many": resolve_effective_period_for_many,
        "resolve_ticker_identity_snapshot": resolve_ticker_identity_snapshot,
    }
