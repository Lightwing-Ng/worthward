"""Build the compare training web-runtime context.

Code version: v0.2.1
"""

from __future__ import annotations


def build_compare_training_context(context: dict[str, object]) -> dict[str, object]:
    Any = context["Any"]

    COMPARE_PERIODS_1D = context["COMPARE_PERIODS_1D"]

    Callable = context["Callable"]

    LOCAL_STORE_PAGE_SIZE = context["LOCAL_STORE_PAGE_SIZE"]

    LOGGER = context["LOGGER"]

    LstmTrainingConflict = context["LstmTrainingConflict"]

    MAX_TICKERS = context["MAX_TICKERS"]

    MIN_TICKERS = context["MIN_TICKERS"]

    PriceFieldTrainingConflict = context["PriceFieldTrainingConflict"]

    SeriesPayload = context["SeriesPayload"]

    annotate_date_constraint_availability = context[
        "annotate_date_constraint_availability"
    ]

    append_live_compare_intraday_dataset = context[
        "append_live_compare_intraday_dataset"
    ]

    apply_no_store_headers = context["apply_no_store_headers"]

    asdict = context["asdict"]

    best_numeric_metric = context["best_numeric_metric"]

    build_compare_series_payload = context["build_compare_series_payload"]

    build_date_constraint_payload = context["build_date_constraint_payload"]

    build_empty_compare_axis_dataset = context["build_empty_compare_axis_dataset"]

    build_local_market_rows_for_tickers = context["build_local_market_rows_for_tickers"]

    build_network_service_rows = context["build_network_service_rows"]

    build_one_day_intraday_date_constraint_payload = context[
        "build_one_day_intraday_date_constraint_payload"
    ]

    build_series_colors = context["build_series_colors"]

    build_series_payload = context["build_series_payload"]

    build_short_intraday_date_constraint_payload = context[
        "build_short_intraday_date_constraint_payload"
    ]

    build_strategy_form_fields = context["build_strategy_form_fields"]

    build_strategy_form_sections = context["build_strategy_form_sections"]

    build_supported_periods_for_history_store = context[
        "build_supported_periods_for_history_store"
    ]

    build_ttm_dividend_yield_map = context["build_ttm_dividend_yield_map"]

    date_constraint_payload_to_json = context["date_constraint_payload_to_json"]

    ensure_latest_daily_caches = context["ensure_latest_daily_caches"]

    fetch_history = context["fetch_history"]

    fetch_longbridge_daily_history = context["fetch_longbridge_daily_history"]

    fetch_longbridge_trade_stats = context["fetch_longbridge_trade_stats"]

    format_compare_intraday_market_local_display_range = context[
        "format_compare_intraday_market_local_display_range"
    ]

    format_display_date = context["format_display_date"]

    get_strategy_ticker_contract = context["get_strategy_ticker_contract"]

    has_compare_overnight_market_data_source = context[
        "has_compare_overnight_market_data_source"
    ]

    has_longbridge_market_data_source = context["has_longbridge_market_data_source"]

    has_recent_one_minute_store = context["has_recent_one_minute_store"]

    has_valid_ticker_format = context["has_valid_ticker_format"]

    history_store_path_for = context["history_store_path_for"]

    infer_ticker_market = context["infer_ticker_market"]

    instantiate_strategy = context["instantiate_strategy"]

    is_market_regular_session_active_for_ticker = context[
        "is_market_regular_session_active_for_ticker"
    ]

    jsonify = context["jsonify"]

    list_enabled_strategies = context["list_enabled_strategies"]

    list_local_market_tickers = context["list_local_market_tickers"]

    load_broker_settings = context["load_broker_settings"]

    load_compare_one_day_intraday_dataset = context[
        "load_compare_one_day_intraday_dataset"
    ]

    load_live_compare_one_day_intraday_dataset = context[
        "load_live_compare_one_day_intraday_dataset"
    ]

    lstm_training_manager = context["lstm_training_manager"]

    map_live_intraday_dataset_to_reference_axis = context[
        "map_live_intraday_dataset_to_reference_axis"
    ]

    network_transport_note = context["network_transport_note"]

    normalize_history_frame = context["normalize_history_frame"]

    normalize_settings_page = context["normalize_settings_page"]

    normalize_ticker_input = context["normalize_ticker_input"]

    normalize_view_name = context["normalize_view_name"]

    parse_int_value = context["parse_int_value"]

    parse_requested_tickers = context["parse_requested_tickers"]

    pd = context["pd"]

    price_field_training_manager = context["price_field_training_manager"]

    render_template = context["render_template"]

    report_fetch_abort_debug_event = context["report_fetch_abort_debug_event"]

    request = context["request"]

    reset_connectivity_caches = context["reset_connectivity_caches"]

    resolve_compare_axis_trading_date = context["resolve_compare_axis_trading_date"]

    resolve_compare_market_trading_date = context["resolve_compare_market_trading_date"]

    resolve_compare_overnight_tickers = context["resolve_compare_overnight_tickers"]

    resolve_comparison_metric = context["resolve_comparison_metric"]

    resolve_workspace_dividend_mode = context["resolve_workspace_dividend_mode"]

    search_tickers = context["search_tickers"]

    shift_intraday_compare_axis_to_trading_date = context[
        "shift_intraday_compare_axis_to_trading_date"
    ]

    slice_intraday_datasets_for_compare_period = context[
        "slice_intraday_datasets_for_compare_period"
    ]

    supports_compare_extended_hours = context["supports_compare_extended_hours"]

    supports_compare_overnight = context["supports_compare_overnight"]

    theme = context["theme"]

    time = context["time"]

    truncate_intraday_datasets_to_common_live_timestamp = context[
        "truncate_intraday_datasets_to_common_live_timestamp"
    ]

    validate_local_browser_write_request = context[
        "validate_local_browser_write_request"
    ]

    validate_ticker_or_raise = context["validate_ticker_or_raise"]

    def symbol_search():
        query = normalize_ticker_input(request.args.get("q", ""))
        limit = min(max(parse_int_value(request.args.get("limit"), 5), 1), 5)
        report_fetch_abort_debug_event(
            "E",
            "runtime.py:symbol_search",
            "symbol search request received",
            {
                "query": query,
                "limit": limit,
                "path": request.path,
            },
        )
        if not query:
            return jsonify(search_tickers("", limit=limit))
        return jsonify(
            []
            if not has_valid_ticker_format(query)
            else search_tickers(query, limit=limit)
        )

    def date_constraints_api():
        requested_view = normalize_view_name(
            request.args.get("view", request.args.get("mode", "tickers"))
        )
        comparison_metric = resolve_comparison_metric(requested_view)
        is_market_cap_comparison = requested_view == "market-caps" or (
            requested_view == "prices" and comparison_metric == "market-cap"
        )
        requested_tickers = parse_requested_tickers(requested_view, comparison_metric)
        minimum_required = 1 if requested_view in {"backtest", "dca"} else MIN_TICKERS
        if len(requested_tickers) < minimum_required:
            return jsonify(
                date_constraint_payload_to_json(build_date_constraint_payload())
            )
        validated_tickers = [
            validate_ticker_or_raise(ticker) for ticker in requested_tickers
        ]
        if len(set(validated_tickers)) != len(validated_tickers):
            return jsonify(
                date_constraint_payload_to_json(build_date_constraint_payload())
            )
        price_only_flag = (
            request.args.get("return", "").strip().lower() == "price"
            or request.args.get(
                "price_only", request.args.get("price_return_only", "0")
            )
            == "1"
        )
        include_dividends_flag = (
            False
            if price_only_flag
            else (
                request.args.get("return", "").strip().lower() == "dividends"
                or request.args.get(
                    "dividends", request.args.get("include_dividends", "0")
                )
                == "1"
            )
        )
        if is_market_cap_comparison:
            price_only_flag = True
            include_dividends_flag = False
        dividend_mode = resolve_workspace_dividend_mode(
            price_only_flag, include_dividends_flag
        )
        requested_start = (
            request.args.get("from", request.args.get("exact_start", "")).strip()
            or None
        )
        requested_end = (
            request.args.get("to", request.args.get("exact_end", "")).strip() or None
        )
        requested_range = (
            request.args.get("range", request.args.get("range_mode", ""))
            .strip()
            .lower()
        )
        if requested_range == "custom":
            requested_range = "exact"
        requested_period = request.args.get("period", "").strip().lower()
        freshness_refresh_failures: list[str] = []
        if (
            requested_view in {"tickers", "market-caps", "prices"}
            and requested_range == "exact"
            and requested_period == "1d"
        ):
            payload = build_one_day_intraday_date_constraint_payload(
                validated_tickers,
                requested_start=requested_start,
                requested_end=requested_end,
            )
            return jsonify(date_constraint_payload_to_json(payload))
        if (
            (requested_view in {"tickers", "market-caps"} or is_market_cap_comparison)
            and requested_range == "exact"
            and requested_period in {"3d", "1w"}
        ):
            payload = build_short_intraday_date_constraint_payload(
                validated_tickers,
                requested_start=requested_start,
                requested_end=requested_end,
            )
            if payload.trading_dates:
                return jsonify(date_constraint_payload_to_json(payload))
        if (
            requested_view in {"tickers", "market-caps", "portfolio", "dca"}
            or is_market_cap_comparison
        ):
            freshness_refresh_failures = ensure_latest_daily_caches(validated_tickers)
        datasets = [
            fetch_history(ticker, include_dividends_flag, dividend_mode=dividend_mode)
            for ticker in validated_tickers
        ]
        payload = build_date_constraint_payload(
            *datasets, requested_start=requested_start, requested_end=requested_end
        )
        annotate_date_constraint_availability(payload, validated_tickers, datasets)
        if freshness_refresh_failures:
            failed_preview = ", ".join(freshness_refresh_failures)
            freshness_notice = (
                f"Could not refresh the latest trading-day cache for {failed_preview}. "
                "Using the newest local daily data currently available."
            )
            payload.message = (
                f"{payload.message} {freshness_notice}".strip()
                if payload.message
                else freshness_notice
            )
        return jsonify(date_constraint_payload_to_json(payload))

    def compare_chips_api():
        raw_tickers = [
            value.strip() for value in request.args.getlist("ticker") if value.strip()
        ]
        if not raw_tickers:
            repeated = str(request.args.get("tickers", "")).strip()
            raw_tickers = [
                value.strip() for value in repeated.split(",") if value.strip()
            ]
        if len(raw_tickers) < MIN_TICKERS:
            response = jsonify(
                {
                    "success": False,
                    "error": "At least two tickers are required for chip comparison.",
                }
            )
            response.status_code = 400
            return apply_no_store_headers(response)

        try:
            validated_tickers = list(
                dict.fromkeys(
                    validate_ticker_or_raise(ticker) for ticker in raw_tickers
                )
            )
            if len(validated_tickers) < MIN_TICKERS:
                raise ValueError(
                    "At least two distinct tickers are required for chip comparison."
                )
            if len(validated_tickers) > MAX_TICKERS:
                raise ValueError(
                    f"Chip comparison supports at most {MAX_TICKERS} tickers."
                )

            broker_settings = load_broker_settings()
            if (
                broker_settings.selected_broker != "longbridge"
                or not has_longbridge_market_data_source(broker_settings)
            ):
                response = jsonify(
                    {
                        "success": False,
                        "error": "Configure Longbridge market data in Settings > Broker access to display chips.",
                    }
                )
                response.status_code = 503
                return apply_no_store_headers(response)

            requested_start = pd.to_datetime(
                request.args.get("from", ""), errors="coerce"
            )
            requested_end = pd.to_datetime(request.args.get("to", ""), errors="coerce")
            if (
                pd.notna(requested_start)
                and pd.notna(requested_end)
                and requested_start > requested_end
            ):
                raise ValueError(
                    "Chip comparison start date must not be after its end date."
                )
            has_bounded_ohlcv_range = pd.notna(requested_start) and pd.notna(
                requested_end
            )

            def run_with_rate_limit_retry(loader: Callable[[], Any]) -> Any:
                for attempt in range(3):
                    try:
                        return loader()
                    except Exception as exc:  # noqa: BLE001
                        is_rate_limited = "429002" in str(exc) or "调用上限" in str(exc)
                        if not is_rate_limited or attempt == 2:
                            raise
                        time.sleep(1.05)
                raise RuntimeError(
                    "Longbridge rate-limit retry did not return a result."
                )

            def fetch_longbridge_ohlcv(ticker: str) -> dict[str, Any]:
                since = (
                    requested_start.to_pydatetime()
                    if pd.notna(requested_start)
                    else None
                )
                raw_dataset = run_with_rate_limit_retry(
                    lambda: fetch_longbridge_daily_history(
                        ticker, broker_settings, since=since
                    )
                )
                dataset = normalize_history_frame(raw_dataset, ticker, interval="1d")
                if dataset.empty or "Date" not in dataset.columns:
                    raise ValueError(
                        f"No daily OHLCV returned for {ticker} via Longbridge."
                    )
                date_values = pd.to_datetime(dataset["Date"], errors="coerce")
                if getattr(date_values.dt, "tz", None) is not None:
                    date_values = date_values.dt.tz_localize(None)
                selected = dataset.loc[date_values.notna()].copy()
                selected_dates = date_values.loc[date_values.notna()]
                if pd.notna(requested_start):
                    selected = selected.loc[selected_dates >= requested_start].copy()
                    selected_dates = selected_dates.loc[
                        selected_dates >= requested_start
                    ]
                if pd.notna(requested_end):
                    selected = selected.loc[selected_dates <= requested_end].copy()
                ohlcv = build_series_payload(ticker, selected).ohlcv or []
                if not any(float(row.get("v") or 0) > 0 for row in ohlcv):
                    raise ValueError(
                        f"No positive daily volume returned for {ticker} via Longbridge."
                    )
                payload = {
                    "ticker": ticker,
                    "source": "longbridge-daily-ohlcv",
                    "ohlcv": ohlcv,
                }
                return payload

            def fetch_one(ticker: str) -> tuple[str, dict[str, Any] | None, str | None]:
                if has_bounded_ohlcv_range:
                    try:
                        return ticker, fetch_longbridge_ohlcv(ticker), None
                    except Exception as ohlcv_exc:  # noqa: BLE001
                        LOGGER.info(
                            "No range-aligned Longbridge daily OHLCV returned for %s: %s",
                            ticker,
                            ohlcv_exc,
                        )
                        return (
                            ticker,
                            None,
                            "No range-aligned chip distribution is available for this ticker.",
                        )
                try:
                    payload = run_with_rate_limit_retry(
                        lambda: fetch_longbridge_trade_stats(ticker, broker_settings)
                    )
                    return (
                        ticker,
                        {
                            "ticker": ticker,
                            "source": "longbridge-trade-stats",
                            **payload,
                        },
                        None,
                    )
                except Exception as trade_stats_exc:  # noqa: BLE001
                    LOGGER.info(
                        "No Longbridge trade statistics returned for %s: %s",
                        ticker,
                        trade_stats_exc,
                    )
                try:
                    return ticker, fetch_longbridge_ohlcv(ticker), None
                except Exception as ohlcv_exc:  # noqa: BLE001
                    LOGGER.info(
                        "No Longbridge daily OHLCV returned for %s: %s",
                        ticker,
                        ohlcv_exc,
                    )
                    return (
                        ticker,
                        None,
                        "No chip distribution is available for this ticker.",
                    )

            results: dict[str, dict[str, Any] | None] = {}
            errors: dict[str, str] = {}
            for index, requested_ticker in enumerate(validated_tickers):
                ticker, payload, error_message = fetch_one(requested_ticker)
                if payload is not None:
                    results[ticker] = payload
                elif error_message:
                    errors[ticker] = error_message
                if index < len(validated_tickers) - 1:
                    time.sleep(1.05)

            ordered_series = [
                results[ticker] for ticker in validated_tickers if ticker in results
            ]
            if not ordered_series:
                response = jsonify(
                    {
                        "success": False,
                        "error": "Longbridge returned no chip distribution for the selected tickers.",
                        "errors": errors,
                    }
                )
                response.status_code = 502
                return apply_no_store_headers(response)

            return apply_no_store_headers(
                jsonify(
                    {
                        "success": True,
                        "series": ordered_series,
                        "errors": errors,
                        "fetchedAt": pd.Timestamp.now(tz="UTC").isoformat(),
                    }
                )
            )
        except ValueError as exc:
            response = jsonify({"success": False, "error": str(exc)})
            response.status_code = 400
            return apply_no_store_headers(response)
        except Exception:  # noqa: BLE001
            LOGGER.exception("Chip comparison request failed")
            response = jsonify(
                {
                    "success": False,
                    "error": "Chip comparison is temporarily unavailable. Try again later.",
                }
            )
            response.status_code = 500
            return apply_no_store_headers(response)

    def compare_live_api():
        raw_tickers = [
            value.strip() for value in request.args.getlist("ticker") if value.strip()
        ]
        if not raw_tickers:
            repeated = str(request.args.get("tickers", "")).strip()
            raw_tickers = [
                value.strip() for value in repeated.split(",") if value.strip()
            ]
        if len(raw_tickers) < MIN_TICKERS:
            response = jsonify(
                {
                    "success": False,
                    "error": "At least two tickers are required for live comparison.",
                }
            )
            response.status_code = 400
            return apply_no_store_headers(response)

        try:
            validated_tickers = list(
                dict.fromkeys(
                    validate_ticker_or_raise(ticker) for ticker in raw_tickers
                )
            )
            if len(validated_tickers) < MIN_TICKERS:
                raise ValueError(
                    "At least two distinct tickers are required for live comparison."
                )

            requested_period = request.args.get("period", "1d").strip().lower() or "1d"
            requested_overnight = (
                request.args.get(
                    "overnight",
                    request.args.get("include_overnight", "0"),
                )
                == "1"
            )
            include_overnight_flag = (
                requested_overnight
                and supports_compare_overnight(validated_tickers, requested_period)
                and has_compare_overnight_market_data_source()
            )
            if include_overnight_flag:
                validated_tickers = resolve_compare_overnight_tickers(validated_tickers)
                if len(validated_tickers) > MAX_TICKERS:
                    raise ValueError(
                        f"Overnight comparison supports at most {MAX_TICKERS} tickers."
                    )

            comparison_now = pd.Timestamp.now(tz="Asia/Shanghai")
            axis_date_value = request.args.get(
                "axis_date", request.args.get("trading_date", "")
            ).strip()
            accepts_exact_live_date = requested_period == "1d" and bool(axis_date_value)
            live_date_value = (
                request.args.get("live_date", "").strip()
                if accepts_exact_live_date
                else ""
            )
            live_trading_date = (
                pd.to_datetime(live_date_value, errors="coerce")
                if live_date_value
                else comparison_now
            )
            if pd.isna(live_trading_date):
                raise ValueError(f"Invalid live trading date: {live_date_value}.")
            live_trading_date = live_trading_date.date()
            current_live_session_date = comparison_now.date()
            selected_markets = {
                infer_ticker_market(ticker) for ticker in validated_tickers
            }
            live_session_active = (
                live_trading_date == current_live_session_date
                and any(
                    is_market_regular_session_active_for_ticker(ticker)
                    for ticker in validated_tickers
                )
            )

            include_extended_hours_flag = supports_compare_extended_hours(
                validated_tickers,
                requested_period,
            )
            force_refresh = request.args.get("refresh", "1").strip() != "0"

            if requested_period in {"3d", "1w"}:
                live_sources: list[str] = []
                intraday_datasets: list[pd.DataFrame] = []
                for ticker in validated_tickers:
                    market_live_trading_date = resolve_compare_market_trading_date(
                        ticker,
                        live_trading_date,
                        display_trading_date=current_live_session_date,
                    )
                    intraday_dataset = fetch_history(
                        ticker,
                        include_dividends=False,
                        interval="1m",
                        dividend_mode="price",
                    )
                    intraday_dataset, source = append_live_compare_intraday_dataset(
                        ticker,
                        intraday_dataset,
                        live_trading_date=market_live_trading_date,
                        include_extended_hours_flag=include_extended_hours_flag,
                        force_refresh=force_refresh,
                    )
                    intraday_datasets.append(intraday_dataset)
                    live_sources.append(source or "local")

                common_end_date = min(
                    dataset["Date"].max() for dataset in intraday_datasets
                )
                aligned_datasets = slice_intraday_datasets_for_compare_period(
                    intraday_datasets,
                    requested_period,
                    common_end_date,
                    validated_tickers,
                )
                if len(selected_markets) == 1:
                    aligned_datasets = (
                        truncate_intraday_datasets_to_common_live_timestamp(
                            aligned_datasets
                        )
                    )
                colors = build_series_colors(
                    len(validated_tickers),
                    theme["accent_primary"],
                    theme["accent_secondary"],
                )
                series = [
                    build_compare_series_payload(ticker, dataset, color=color)
                    for ticker, dataset, color in zip(
                        validated_tickers, aligned_datasets, colors
                    )
                ]

                def last_valid_return(item: SeriesPayload) -> float | None:
                    valid_returns = [
                        value for value in item.normalized_returns if value is not None
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
                dividend_yield_map = build_ttm_dividend_yield_map(
                    validated_tickers, common_end_date
                )
                best_dividend_yield = best_numeric_metric(
                    [dividend_yield_map.get(ticker) for ticker in validated_tickers]
                )
                performance_items = [
                    {
                        "ticker": item.ticker,
                        "ending_return": last_valid_return(item),
                        "ttm_dividend_yield": dividend_yield_map.get(item.ticker),
                        "color": item.color,
                        "is_winner": best_return is not None
                        and last_valid_return(item) == best_return,
                        "is_dividend_yield_winner": (
                            best_dividend_yield is not None
                            and dividend_yield_map.get(item.ticker)
                            == best_dividend_yield
                        ),
                    }
                    for item in series
                ]
                response = jsonify(
                    {
                        "success": True,
                        "series": [asdict(item) for item in series],
                        "performanceItems": performance_items,
                        "period": requested_period,
                        "currentComparisonDate": current_live_session_date.strftime(
                            "%Y-%m-%d"
                        ),
                        "liveDate": pd.Timestamp(live_trading_date).strftime(
                            "%Y-%m-%d"
                        ),
                        "liveSessionActive": live_session_active,
                        "displayRange": format_compare_intraday_market_local_display_range(
                            aligned_datasets,
                            validated_tickers,
                        ),
                        "sources": {
                            ticker: source
                            for ticker, source in zip(validated_tickers, live_sources)
                        },
                        "fetchedAt": pd.Timestamp.now(tz="UTC").isoformat(),
                    }
                )
                return apply_no_store_headers(response)

            if not axis_date_value and requested_period == "1d":
                axis_date_value = resolve_compare_axis_trading_date(
                    validated_tickers,
                    live_trading_date,
                )
            if not axis_date_value:
                raise ValueError("A reference axis trading date is required.")
            axis_trading_date = pd.to_datetime(axis_date_value, errors="coerce")
            if pd.isna(axis_trading_date):
                raise ValueError(
                    f"Invalid reference axis trading date: {axis_date_value}."
                )

            reference_datasets = [
                load_compare_one_day_intraday_dataset(
                    ticker,
                    include_extended_hours_flag=include_extended_hours_flag,
                    include_overnight_flag=include_overnight_flag,
                    trading_date=axis_trading_date,
                )
                for ticker in validated_tickers
            ]
            reference_common_end = min(
                dataset["Date"].max() for dataset in reference_datasets
            )
            reference_aligned_datasets = slice_intraday_datasets_for_compare_period(
                reference_datasets,
                "1d",
                reference_common_end,
                validated_tickers,
            )
            if (
                pd.Timestamp(axis_trading_date).date()
                != pd.Timestamp(live_trading_date).date()
            ):
                reference_aligned_datasets = [
                    shift_intraday_compare_axis_to_trading_date(
                        dataset,
                        axis_trading_date,
                        live_trading_date,
                    )
                    for dataset in reference_aligned_datasets
                ]

            live_sources: list[str] = []
            colors = build_series_colors(
                len(validated_tickers),
                theme["accent_primary"],
                theme["accent_secondary"],
            )
            mapped_live_datasets: list[pd.DataFrame] = []
            for reference_dataset, ticker in zip(
                reference_aligned_datasets, validated_tickers
            ):
                try:
                    market_live_trading_date = resolve_compare_market_trading_date(
                        ticker,
                        live_trading_date,
                        display_trading_date=current_live_session_date,
                    )
                    live_dataset, source = load_live_compare_one_day_intraday_dataset(
                        ticker,
                        live_trading_date=market_live_trading_date,
                        include_extended_hours_flag=include_extended_hours_flag,
                        force_refresh=force_refresh,
                        include_overnight_flag=include_overnight_flag,
                    )
                    mapped_live_datasets.append(
                        map_live_intraday_dataset_to_reference_axis(
                            reference_dataset, live_dataset, ticker
                        )
                    )
                    live_sources.append(source)
                except Exception as exc:  # noqa: BLE001
                    LOGGER.info(
                        "No live compare bars for %s on %s yet: %s",
                        ticker,
                        live_trading_date,
                        exc,
                    )
                    mapped_live_datasets.append(
                        build_empty_compare_axis_dataset(reference_dataset)
                    )
                    live_sources.append("pending")
            if len(selected_markets) == 1:
                mapped_live_datasets = (
                    truncate_intraday_datasets_to_common_live_timestamp(
                        mapped_live_datasets
                    )
                )
            series = [
                build_compare_series_payload(ticker, dataset, color=color)
                for ticker, dataset, color in zip(
                    validated_tickers, mapped_live_datasets, colors
                )
            ]

            def last_valid_return(item: SeriesPayload) -> float | None:
                valid_returns = [
                    value for value in item.normalized_returns if value is not None
                ]
                return valid_returns[-1] if valid_returns else None

            valid_performance_returns = [
                value
                for value in (last_valid_return(item) for item in series)
                if value is not None
            ]
            best_return = (
                max(valid_performance_returns) if valid_performance_returns else None
            )
            dividend_yield_map = build_ttm_dividend_yield_map(
                validated_tickers, live_trading_date
            )
            best_dividend_yield = best_numeric_metric(
                [dividend_yield_map.get(ticker) for ticker in validated_tickers]
            )
            performance_items = [
                {
                    "ticker": item.ticker,
                    "ending_return": last_valid_return(item),
                    "ttm_dividend_yield": dividend_yield_map.get(item.ticker),
                    "color": item.color,
                    "is_winner": best_return is not None
                    and last_valid_return(item) == best_return,
                    "is_dividend_yield_winner": (
                        best_dividend_yield is not None
                        and dividend_yield_map.get(item.ticker) == best_dividend_yield
                    ),
                }
                for item in series
            ]

            response = jsonify(
                {
                    "success": True,
                    "series": [asdict(item) for item in series],
                    "performanceItems": performance_items,
                    "axisDate": axis_trading_date.strftime("%Y-%m-%d"),
                    "currentComparisonDate": current_live_session_date.strftime(
                        "%Y-%m-%d"
                    ),
                    "liveDate": pd.Timestamp(live_trading_date).strftime("%Y-%m-%d"),
                    "liveSessionActive": live_session_active,
                    "displayRange": format_display_date(
                        pd.Timestamp(live_trading_date)
                    ),
                    "sources": {
                        ticker: source
                        for ticker, source in zip(validated_tickers, live_sources)
                    },
                    "fetchedAt": pd.Timestamp.now(tz="UTC").isoformat(),
                }
            )
            return apply_no_store_headers(response)
        except Exception:  # noqa: BLE001
            LOGGER.exception("Live comparison request failed")
            response = jsonify(
                {
                    "success": False,
                    "error": "Live comparison is temporarily unavailable. Try again later.",
                }
            )
            response.status_code = 500
            return apply_no_store_headers(response)

    def trade_strategy_fields_api():
        strategy_id = request.args.get("strategy", "").strip()
        if not strategy_id:
            return jsonify({"is_tunable": False, "html": ""})

        strategy_ids = {str(item["id"]) for item in list_enabled_strategies()}
        if strategy_id not in strategy_ids:
            return jsonify({"is_tunable": False, "html": ""})

        strategy_form_fields = build_strategy_form_fields(strategy_id)
        required_tickers, default_tickers, supports = get_strategy_ticker_contract(
            strategy_id
        )
        html = render_template(
            "_trade_strategy_params_panel.html",
            strategy_form_fields=strategy_form_fields,
            strategy_form_sections=build_strategy_form_sections(
                strategy_id, strategy_form_fields, strategy_factory=instantiate_strategy
            ),
        )
        return jsonify(
            {
                "is_tunable": bool(strategy_form_fields),
                "html": html,
                "required_tickers": required_tickers,
                "default_tickers": default_tickers,
                "supports": supports,
            }
        )

    def lstm_training_list_api():
        try:
            response = jsonify(
                {
                    "success": True,
                    "protocol_version": 3,
                    "runs": lstm_training_manager.list_runs(),
                }
            )
            return apply_no_store_headers(response)
        except Exception:  # noqa: BLE001
            LOGGER.exception("Unable to load LSTM training history")
            response = jsonify(
                {
                    "success": False,
                    "runs": [],
                    "error": "LSTM training history is temporarily unavailable.",
                }
            )
            response.status_code = 500
            return apply_no_store_headers(response)

    def lstm_training_start_api():
        security_error = validate_local_browser_write_request(
            request,
            action_label="LSTM training changes",
        )
        if security_error:
            response = jsonify({"success": False, "error": security_error})
            response.status_code = 403
            return apply_no_store_headers(response)
        payload = request.get_json(silent=True) or {}
        try:
            run = lstm_training_manager.start(
                ticker=str(payload.get("ticker", "")),
                period=str(payload.get("period", "")),
                params=payload.get("params"),
                interval=str(payload.get("interval", "")),
                **(
                    {"configuration": payload["configuration"]}
                    if "configuration" in payload
                    else {}
                ),
            )
            response = jsonify({"success": True, "run": run})
            response.status_code = 202
            return apply_no_store_headers(response)
        except LstmTrainingConflict as exc:
            response = jsonify({"success": False, "error": str(exc)})
            response.status_code = 409
            return apply_no_store_headers(response)
        except ValueError as exc:
            response = jsonify({"success": False, "error": str(exc)})
            response.status_code = 400
            return apply_no_store_headers(response)
        except Exception:  # noqa: BLE001
            LOGGER.exception("Unable to start LSTM training")
            response = jsonify(
                {
                    "success": False,
                    "error": "LSTM training could not be started. Try again later.",
                }
            )
            response.status_code = 500
            return apply_no_store_headers(response)

    def lstm_training_stop_api():
        security_error = validate_local_browser_write_request(
            request,
            action_label="LSTM training changes",
        )
        if security_error:
            response = jsonify({"success": False, "error": security_error})
            response.status_code = 403
            return apply_no_store_headers(response)
        payload = request.get_json(silent=True) or {}
        try:
            run_id = str(payload.get("run_id") or payload.get("job_id") or "")
            run = lstm_training_manager.stop(run_id)
            response = jsonify({"success": True, "run": run})
            return apply_no_store_headers(response)
        except ValueError as exc:
            response = jsonify({"success": False, "error": str(exc)})
            response.status_code = 400
            return apply_no_store_headers(response)
        except Exception:  # noqa: BLE001
            LOGGER.exception("Unable to stop LSTM training")
            response = jsonify(
                {
                    "success": False,
                    "error": "LSTM training could not be stopped. Try again later.",
                }
            )
            response.status_code = 500
            return apply_no_store_headers(response)

    def lstm_training_delete_api():
        security_error = validate_local_browser_write_request(
            request, action_label="LSTM training changes"
        )
        if security_error:
            response = jsonify({"success": False, "error": security_error})
            response.status_code = 403
            return apply_no_store_headers(response)
        payload = request.get_json(silent=True) or {}
        try:
            result = lstm_training_manager.delete(str(payload.get("run_id", "")))
            response = jsonify({"success": True, **result})
        except (ValueError, RuntimeError) as exc:
            response = jsonify({"success": False, "error": str(exc)})
            response.status_code = 409 if isinstance(exc, RuntimeError) else 400
        except OSError:
            LOGGER.exception("Unable to archive LSTM training")
            response = jsonify(
                {"success": False, "error": "The training run could not be archived."}
            )
            response.status_code = 500
        return apply_no_store_headers(response)

    def price_field_training_action(action):
        if action != "list":
            security_error = validate_local_browser_write_request(
                request, action_label="Probability-model training changes"
            )
            if security_error:
                response = jsonify({"success": False, "error": security_error})
                response.status_code = 403
                return apply_no_store_headers(response)
        payload = request.get_json(silent=True) or {} if action != "list" else {}
        try:
            if not isinstance(payload, dict):
                raise ValueError("Training request must be a JSON object.")
            if action == "list":
                outcome = {
                    "runs": price_field_training_manager.list_runs(
                        str(request.args.get("strategy", ""))
                    ),
                    "protocol_version": 3,
                }
            elif action == "start":
                outcome = {
                    "run": price_field_training_manager.start(
                        strategy_id=str(payload.get("strategy", "")),
                        ticker=str(payload.get("ticker", "")),
                        period=str(payload.get("period", "")),
                        params=payload.get("params"),
                        interval=str(payload.get("interval", "")),
                        configuration=payload.get("configuration"),
                    )
                }
            elif action == "stop":
                outcome = {
                    "run": price_field_training_manager.stop(
                        str(payload.get("run_id", ""))
                    )
                }
            else:
                outcome = price_field_training_manager.delete(
                    str(payload.get("run_id", ""))
                )
            response = jsonify({"success": True, **outcome})
            if action == "start":
                response.status_code = 202
        except (ValueError, PriceFieldTrainingConflict) as exc:
            response = jsonify({"success": False, "error": str(exc)})
            response.status_code = (
                409 if isinstance(exc, PriceFieldTrainingConflict) else 400
            )
        except Exception:  # noqa: BLE001
            LOGGER.exception("Probability training action failed: %s", action)
            response = jsonify(
                {
                    "success": False,
                    "error": "The probability-model training action could not be completed.",
                }
            )
            response.status_code = 500
        return apply_no_store_headers(response)

    def price_field_training_list_api():
        return price_field_training_action("list")

    def price_field_training_start_api():
        return price_field_training_action("start")

    def price_field_training_stop_api():
        return price_field_training_action("stop")

    def price_field_training_delete_api():
        return price_field_training_action("delete")

    def settings_network_status_api():
        if request.args.get("refresh", "").strip() == "1":
            reset_connectivity_caches()
        return jsonify(
            {
                "rows": build_network_service_rows(pending=False),
                "transport_note": network_transport_note(),
            }
        )

    def local_market_store_page_data_api():
        current_page = normalize_settings_page(request.args.get("page"))
        all_local_market_tickers = list_local_market_tickers()
        total_pages = max(
            (len(all_local_market_tickers) - 1) // LOCAL_STORE_PAGE_SIZE + 1, 1
        )
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
        raw_tickers = [
            value.strip() for value in request.args.getlist("ticker") if value.strip()
        ]
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
            ticker: has_recent_one_minute_store(ticker) for ticker in unique_tickers
        }
        period_options_mapping = {
            ticker: {
                "1d": list(COMPARE_PERIODS_1D),
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

    return {
        "compare_chips_api": compare_chips_api,
        "compare_live_api": compare_live_api,
        "date_constraints_api": date_constraints_api,
        "local_market_store_page_data_api": local_market_store_page_data_api,
        "lstm_training_delete_api": lstm_training_delete_api,
        "lstm_training_list_api": lstm_training_list_api,
        "lstm_training_start_api": lstm_training_start_api,
        "lstm_training_stop_api": lstm_training_stop_api,
        "market_store_presence_api": market_store_presence_api,
        "price_field_training_action": price_field_training_action,
        "price_field_training_delete_api": price_field_training_delete_api,
        "price_field_training_list_api": price_field_training_list_api,
        "price_field_training_start_api": price_field_training_start_api,
        "price_field_training_stop_api": price_field_training_stop_api,
        "settings_network_status_api": settings_network_status_api,
        "symbol_search": symbol_search,
        "trade_strategy_fields_api": trade_strategy_fields_api,
    }
