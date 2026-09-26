"""Build the comparison web-runtime context.

Code version: v0.2.1
"""

from __future__ import annotations

from app.core.markets.sessions import (
    market_session_last_bar_minute,
    market_session_segments,
)


def build_comparison_context(context: dict[str, object]) -> dict[str, object]:
    Any = context["Any"]

    DEFAULT_PERIOD = context["DEFAULT_PERIOD"]

    DEFAULT_TICKERS = context["DEFAULT_TICKERS"]

    DateConstraintPayload = context["DateConstraintPayload"]

    LOGGER = context["LOGGER"]

    MAX_TICKERS = context["MAX_TICKERS"]

    PORTFOLIO_BENCHMARK_COLORS = context["PORTFOLIO_BENCHMARK_COLORS"]

    PORTFOLIO_BENCHMARK_TICKERS = context["PORTFOLIO_BENCHMARK_TICKERS"]

    QuoteProfile = context["QuoteProfile"]

    SETTINGS_FEEDBACK_COOKIE = context["SETTINGS_FEEDBACK_COOKIE"]

    SeriesPayload = context["SeriesPayload"]

    build_series_payload = context["build_series_payload"]

    build_settings_path = context["build_settings_path"]

    build_settings_state_url = context["build_settings_state_url"]

    build_view_path = context["build_view_path"]

    calculate_ttm_dividend_yield = context["calculate_ttm_dividend_yield"]

    date = context["date"]

    defaults = context["defaults"]

    fetch_compare_one_day_extended_history = context[
        "fetch_compare_one_day_extended_history"
    ]

    fetch_history = context["fetch_history"]

    fetch_one_minute_history_for_trading_date = context[
        "fetch_one_minute_history_for_trading_date"
    ]

    fetch_quote_profile = context["fetch_quote_profile"]

    fetch_request_compare_one_day_overnight_history = context[
        "fetch_request_compare_one_day_overnight_history"
    ]

    fill_intraday_market_session_gaps = context["fill_intraday_market_session_gaps"]

    filter_intraday_dataset_to_regular_session = context[
        "filter_intraday_dataset_to_regular_session"
    ]

    format_display_datetime = context["format_display_datetime"]

    format_store_range_date_value = context["format_store_range_date_value"]

    has_valid_ticker_format = context["has_valid_ticker_format"]

    hashlib = context["hashlib"]

    history_store_path_for = context["history_store_path_for"]

    infer_ticker_market = context["infer_ticker_market"]

    intraday_history_store_path_for = context["intraday_history_store_path_for"]

    is_one_minute_store_fresh = context["is_one_minute_store_fresh"]

    json = context["json"]

    latest_completed_nyse_trading_day = context["latest_completed_nyse_trading_day"]

    list_enabled_strategies = context["list_enabled_strategies"]

    load_backtest_execution_mode = context["load_backtest_execution_mode"]

    make_response = context["make_response"]

    market_store_file_lock = context["market_store_file_lock"]

    market_ticker_store_aliases = context["market_ticker_store_aliases"]

    market_timezone_for_ticker = context["market_timezone_for_ticker"]

    market_trading_date_for_timestamp = context["market_trading_date_for_timestamp"]

    max_tickers_for_view = context["max_tickers_for_view"]

    normalize_comparison_metric = context["normalize_comparison_metric"]

    normalize_settings_page = context["normalize_settings_page"]

    normalize_settings_section = context["normalize_settings_section"]

    normalize_settings_tab = context["normalize_settings_tab"]

    normalize_ticker_input = context["normalize_ticker_input"]

    normalize_view_name = context["normalize_view_name"]

    nyse_market_session_state = context["nyse_market_session_state"]

    parse_bool_flag_from_args = context["parse_bool_flag_from_args"]

    parse_portfolio_allocation_mode_from_args = context[
        "parse_portfolio_allocation_mode_from_args"
    ]

    parse_range_request_args_from_args = context["parse_range_request_args_from_args"]

    parse_requested_shares_from_args = context["parse_requested_shares_from_args"]

    parse_requested_tickers_from_args = context["parse_requested_tickers_from_args"]

    parse_requested_weights_from_args = context["parse_requested_weights_from_args"]

    pd = context["pd"]

    prepare_intraday_dataset_for_compare = context[
        "prepare_intraday_dataset_for_compare"
    ]

    redirect = context["redirect"]

    refresh_one_minute_store = context["refresh_one_minute_store"]

    request = context["request"]

    resolve_compare_axis_trading_date = context["resolve_compare_axis_trading_date"]

    resolve_workspace_dividend_mode = context["resolve_workspace_dividend_mode"]

    select_price_series = context["select_price_series"]

    shift_intraday_compare_axis_to_trading_date = context[
        "shift_intraday_compare_axis_to_trading_date"
    ]

    slice_intraday_datasets_for_compare_period = context[
        "slice_intraday_datasets_for_compare_period"
    ]

    urlencode = context["urlencode"]

    def _get_backtest_cache_key() -> str:
        """Generate a cache key from all backtest configuration parameters."""
        requested_tickers = parse_requested_tickers("backtest")
        if not requested_tickers:
            fallback_ticker = normalize_ticker_input(
                str(defaults.get("backtest_ticker", DEFAULT_TICKERS[0]))
            )
            requested_tickers = [fallback_ticker] if fallback_ticker else []
        history_versions = []
        for ticker in requested_tickers:
            daily_path = history_store_path_for(ticker)
            intraday_path = intraday_history_store_path_for(ticker, "1m")
            history_versions.append(
                {
                    "ticker": ticker,
                    "daily_mtime_ns": daily_path.stat().st_mtime_ns
                    if daily_path.exists()
                    else None,
                    "intraday_mtime_ns": intraday_path.stat().st_mtime_ns
                    if intraday_path.exists()
                    else None,
                }
            )
        params = [
            request.path,
            requested_tickers,
            load_backtest_execution_mode(),
            request.args.get("strategy", ""),
            request.args.get("capital", ""),
            request.args.get("period", ""),
            request.args.get("range", ""),
            request.args.get("from", ""),
            request.args.get("to", ""),
            request.args.get("interval", ""),
            str(request.args.get("price_only", "")),
            str(request.args.get("dividends", "")),
            str(request.args.get("stop_loss", "")),
            # Include all strategy parameters in cache key
            sorted(
                [
                    (k, request.args.get(k, ""))
                    for k in request.args.keys()
                    if k
                    not in {
                        "ticker",
                        "strategy",
                        "capital",
                        "period",
                        "range",
                        "from",
                        "to",
                        "interval",
                        "price_only",
                        "dividends",
                        "stop_loss",
                        "show_trade_details",
                        "view",
                        "section",
                        "view",
                        "tickers",
                        "weight",
                    }
                ]
            ),
            history_versions,
        ]
        key_string = json.dumps(params, sort_keys=True)
        return hashlib.sha256(key_string.encode("utf-8")).hexdigest()[:16]

    def _read_settings_feedback() -> dict[str, str]:
        raw_feedback = request.cookies.get(SETTINGS_FEEDBACK_COOKIE, "").strip()
        if not raw_feedback:
            return {}
        try:
            payload = json.loads(raw_feedback)
        except json.JSONDecodeError:
            return {}
        if not isinstance(payload, dict):
            return {}
        return {
            key: str(value).strip()
            for key, value in payload.items()
            if key
            in {
                "notice",
                "error",
                "broker_test_status",
                "broker_test_message",
                "broker_test_checked_at",
                "longbridge_oauth_pending",
            }
            and str(value).strip()
        }

    def _redirect_with_settings_feedback(
        section_name: str,
        *,
        notice: str = "",
        error: str = "",
        broker_test_status: str = "",
        broker_test_message: str = "",
        broker_test_checked_at: str = "",
        longbridge_oauth_pending: str = "",
        query_params: dict[str, Any] | None = None,
    ):
        target_path = build_settings_path(section_name)
        if query_params:
            target_path = build_settings_state_url(
                section_name,
                tab=query_params.get(
                    "tab", query_params.get("settings_tab", "current")
                ),
                page=query_params.get(
                    "page",
                    query_params.get(
                        "settings_page", query_params.get("local_page", 1)
                    ),
                ),
            )
        response = make_response(redirect(target_path, code=303))
        payload = {
            key: value.strip()
            for key, value in {
                "notice": notice,
                "error": error,
                "broker_test_status": broker_test_status,
                "broker_test_message": broker_test_message,
                "broker_test_checked_at": broker_test_checked_at,
                "longbridge_oauth_pending": longbridge_oauth_pending,
            }.items()
            if value and value.strip()
        }
        if payload:
            response.set_cookie(
                SETTINGS_FEEDBACK_COOKIE,
                json.dumps(payload, separators=(",", ":")),
                max_age=60,
                httponly=True,
                samesite="Lax",
                path="/settings",
            )
        else:
            response.delete_cookie(SETTINGS_FEEDBACK_COOKIE, path="/settings")
        return response

    def validate_ticker_or_raise(raw_ticker: str) -> str:
        normalized_ticker = normalize_ticker_input(raw_ticker)
        if not has_valid_ticker_format(normalized_ticker):
            raise ValueError(f"Invalid ticker format: {raw_ticker}.")
        return normalized_ticker

    def resolve_comparison_metric(view_name: str | None = None) -> str:
        """Resolve the metric used by the unified Ticker comparison workspace."""
        normalized_view = normalize_view_name(view_name)
        if normalized_view not in {"prices", "market-caps"}:
            return "price"
        default_metric = "market-cap" if normalized_view == "market-caps" else "price"
        return normalize_comparison_metric(
            request.args.get("metric"),
            default=default_metric,
        )

    def parse_requested_tickers(
        view_name: str | None = None,
        comparison_metric: str | None = None,
    ) -> list[str]:
        resolved_metric = comparison_metric or resolve_comparison_metric(view_name)
        return parse_requested_tickers_from_args(
            request.args,
            max_tickers=max_tickers_for_view(view_name, resolved_metric),
            normalize=normalize_ticker_input,
            getlist=request.args.getlist,
        )

    def parse_requested_weights(
        slot_count: int,
        *,
        numbered_ticker_limit: int | None = None,
    ) -> list[int]:
        return parse_requested_weights_from_args(
            request.args,
            slot_count,
            getlist=request.args.getlist,
            numbered_ticker_limit=numbered_ticker_limit,
        )

    def parse_portfolio_allocation_mode() -> str:
        return parse_portfolio_allocation_mode_from_args(request.args)

    def parse_requested_shares(
        slot_count: int,
        *,
        numbered_ticker_limit: int | None = None,
    ) -> list[int]:
        return parse_requested_shares_from_args(
            request.args,
            slot_count,
            getlist=request.args.getlist,
            numbered_ticker_limit=numbered_ticker_limit,
        )

    def parse_bool_flag(*names: str, default: bool = False) -> bool:
        return parse_bool_flag_from_args(
            request.args,
            *names,
            default=default,
            getlist=request.args.getlist,
        )

    def parse_range_request_args() -> tuple[str, str, str, str]:
        return parse_range_request_args_from_args(
            request.args,
            default_range_mode=str(defaults.get("range_mode", "period")),
            default_period=str(defaults.get("period", DEFAULT_PERIOD)),
        )

    def build_exact_range_bounds(
        start_value: str, end_value: str
    ) -> tuple[pd.Timestamp, pd.Timestamp]:
        start_bound = pd.to_datetime(start_value).normalize()
        end_bound = pd.to_datetime(end_value).replace(hour=23, minute=59, second=59)
        return start_bound, end_bound

    def slice_dataset_to_exact_range(
        dataset: pd.DataFrame,
        adjusted_start: str,
        adjusted_end: str,
    ) -> pd.DataFrame:
        start_bound, end_bound = build_exact_range_bounds(adjusted_start, adjusted_end)
        return dataset[
            (dataset["Date"] >= start_bound) & (dataset["Date"] <= end_bound)
        ].copy()

    def slice_datasets_to_exact_range(
        datasets: list[pd.DataFrame],
        adjusted_start: str,
        adjusted_end: str,
    ) -> list[pd.DataFrame]:
        return [
            slice_dataset_to_exact_range(dataset, adjusted_start, adjusted_end)
            for dataset in datasets
        ]

    def exact_trading_dates_in_range(payload: DateConstraintPayload) -> list[str]:
        if (
            not payload.trading_dates
            or not payload.adjusted_start
            or not payload.adjusted_end
        ):
            return []
        start_date = pd.to_datetime(payload.adjusted_start).date()
        end_date = pd.to_datetime(payload.adjusted_end).date()
        return [
            trading_date
            for trading_date in payload.trading_dates
            if start_date <= pd.to_datetime(trading_date).date() <= end_date
        ]

    def resolve_compare_market_trading_date(
        ticker: str,
        requested_trading_date: object,
        *,
        display_trading_date: object,
    ) -> date:
        """Map a current comparison date to the ticker's local market date."""
        requested_date = pd.to_datetime(requested_trading_date, errors="coerce")
        display_date = pd.to_datetime(display_trading_date, errors="coerce")
        if pd.isna(requested_date) or pd.isna(display_date):
            raise ValueError(f"Invalid compare trading date: {requested_trading_date}.")
        requested_date_value = requested_date.date()
        if requested_date_value != display_date.date():
            return requested_date_value
        current_timestamp = pd.Timestamp.now(tz="Asia/Shanghai")
        if infer_ticker_market(ticker) == "US":
            session_state = nyse_market_session_state(
                reference=current_timestamp,
                include_overnight=False,
            )
            if str(session_state.get("session", "")) in {"pre", "intraday", "post"}:
                return pd.Timestamp(session_state["session_date"]).date()
            return latest_completed_nyse_trading_day(reference=current_timestamp).date()
        return current_timestamp.tz_convert(market_timezone_for_ticker(ticker)).date()

    def market_close_minute_for_ticker(ticker: str) -> int | None:
        """Return the market's last included minute bar, or None for US."""
        if infer_ticker_market(ticker) == "US":
            return None
        return market_session_last_bar_minute(ticker)

    def market_session_segments_for_ticker(ticker: str) -> list[tuple[int, int]]:
        """Return half-open market-local regular-session windows."""
        return market_session_segments(ticker)

    def is_market_regular_session_active_for_ticker(
        ticker: str,
        reference_timestamp: object | None = None,
    ) -> bool:
        current_timestamp = (
            pd.Timestamp.now(tz="UTC")
            if reference_timestamp is None
            else pd.to_datetime(reference_timestamp, errors="coerce")
        )
        if pd.isna(current_timestamp):
            return False
        if current_timestamp.tzinfo is None:
            current_timestamp = current_timestamp.tz_localize("UTC")
        else:
            current_timestamp = current_timestamp.tz_convert("UTC")
        localized = current_timestamp.tz_convert(market_timezone_for_ticker(ticker))
        if int(localized.weekday()) >= 5:
            return False
        minute_of_day = (int(localized.hour) * 60) + int(localized.minute)
        return any(
            start_minute <= minute_of_day < end_minute
            for start_minute, end_minute in market_session_segments_for_ticker(ticker)
        )

    def apply_market_close_anchor(
        intraday_dataset: pd.DataFrame,
        daily_dataset: pd.DataFrame,
        ticker: str,
        trading_date: object,
    ) -> pd.DataFrame:
        close_minute = market_close_minute_for_ticker(ticker)
        if (
            close_minute is None
            or intraday_dataset.empty
            or daily_dataset.empty
            or "Close" not in daily_dataset.columns
        ):
            return intraday_dataset

        target_date = pd.to_datetime(trading_date).date()
        daily_dates = pd.to_datetime(daily_dataset["Date"], errors="coerce").dt.date
        daily_rows = daily_dataset.loc[daily_dates == target_date]
        if daily_rows.empty:
            return intraday_dataset

        close_value = pd.to_numeric(
            pd.Series([daily_rows.iloc[-1]["Close"]]), errors="coerce"
        ).iloc[0]
        if pd.isna(close_value):
            return intraday_dataset

        market_timezone = market_timezone_for_ticker(ticker)
        close_local = pd.Timestamp(
            year=int(target_date.year),
            month=int(target_date.month),
            day=int(target_date.day),
            hour=close_minute // 60,
            minute=close_minute % 60,
            tz=market_timezone,
        )
        close_timestamp = close_local.tz_convert("America/New_York").tz_localize(None)

        anchored_dataset = intraday_dataset.copy()
        intraday_close_values = pd.to_numeric(
            anchored_dataset.get("Close", pd.Series(dtype="float64")), errors="coerce"
        )
        comparable_closes = intraday_close_values.loc[
            intraday_close_values.notna()
            & (anchored_dataset["Date"] <= close_timestamp)
        ]
        if not comparable_closes.empty:
            last_intraday_close = float(comparable_closes.iloc[-1])
            if last_intraday_close > 0:
                close_gap_ratio = (
                    abs(float(close_value) - last_intraday_close) / last_intraday_close
                )
                if close_gap_ratio > 0.20:
                    LOGGER.warning(
                        "Skipped market close anchor for %s on %s because daily close %.4f is %.2f%% away from intraday close %.4f.",
                        ticker,
                        trading_date,
                        float(close_value),
                        close_gap_ratio * 100,
                        last_intraday_close,
                    )
                    return intraday_dataset

        matching_rows = anchored_dataset["Date"] == close_timestamp
        if not matching_rows.any():
            row: dict[str, object] = {
                column: pd.NA for column in anchored_dataset.columns
            }
            row["Date"] = close_timestamp
            anchored_dataset = pd.concat(
                [anchored_dataset, pd.DataFrame([row])], ignore_index=True
            )
            matching_rows = anchored_dataset["Date"] == close_timestamp

        for column in ("Open", "High", "Low", "Close", "Adj Close"):
            if column in anchored_dataset.columns:
                anchored_dataset.loc[matching_rows, column] = float(close_value)
        if "Volume" in anchored_dataset.columns:
            anchored_dataset.loc[matching_rows, "Volume"] = 0.0
        if "Turnover" in anchored_dataset.columns:
            anchored_dataset.loc[matching_rows, "Turnover"] = 0.0

        return (
            anchored_dataset.drop_duplicates(subset=["Date"], keep="last")
            .sort_values("Date")
            .reset_index(drop=True)
        )

    def slice_intraday_dataset_to_market_trading_date(
        dataset: pd.DataFrame,
        ticker: str,
        trading_date: object,
    ) -> pd.DataFrame:
        target_date = pd.to_datetime(trading_date).date()

        def date_for_market(value: object) -> object:
            return market_trading_date_for_timestamp(value, ticker)

        market_dates = dataset["Date"].map(date_for_market)
        return dataset[market_dates == target_date].copy()

    def slice_intraday_dataset_to_trading_dates(
        dataset: pd.DataFrame,
        ticker: str,
        trading_dates: list[str],
    ) -> pd.DataFrame:
        selected_dates = {
            pd.to_datetime(trading_date).date() for trading_date in trading_dates
        }

        def date_for_market(value: object) -> object:
            return market_trading_date_for_timestamp(value, ticker)

        market_dates = dataset["Date"].map(date_for_market)
        return dataset[market_dates.isin(selected_dates)].copy()

    def load_local_compare_one_day_intraday_dataset(
        ticker: str,
        *,
        refresh_stale: bool = False,
    ) -> pd.DataFrame:
        path = next(
            (
                candidate_path
                for candidate in market_ticker_store_aliases(ticker)
                if (
                    candidate_path := intraday_history_store_path_for(candidate, "1m")
                ).exists()
                and candidate_path.stat().st_size > 0
            ),
            intraday_history_store_path_for(ticker, "1m"),
        )
        if not path.exists() or path.stat().st_size == 0:
            refresh_one_minute_store(ticker)
            path = next(
                (
                    candidate_path
                    for candidate in market_ticker_store_aliases(ticker)
                    if (
                        candidate_path := intraday_history_store_path_for(
                            candidate, "1m"
                        )
                    ).exists()
                    and candidate_path.stat().st_size > 0
                ),
                intraday_history_store_path_for(ticker, "1m"),
            )
        elif refresh_stale and not is_one_minute_store_fresh(ticker):
            try:
                refresh_one_minute_store(ticker)
            except (ImportError, OSError, ValueError, KeyError, TypeError) as exc:
                LOGGER.warning(
                    "Unable to refresh stale local 1-minute compare data for %s; using the existing cache: %s",
                    ticker,
                    exc,
                )
            path = next(
                (
                    candidate_path
                    for candidate in market_ticker_store_aliases(ticker)
                    if (
                        candidate_path := intraday_history_store_path_for(
                            candidate, "1m"
                        )
                    ).exists()
                    and candidate_path.stat().st_size > 0
                ),
                intraday_history_store_path_for(ticker, "1m"),
            )
        if not path.exists() or path.stat().st_size == 0:
            raise ValueError(f"Local 1-minute market data for {ticker} is unavailable.")
        with market_store_file_lock(path):
            dataset = pd.read_parquet(path)
        dataset = select_price_series(
            dataset, include_dividends=False, dividend_mode="price"
        )
        if dataset.empty:
            raise ValueError(f"Local 1-minute market data for {ticker} is empty.")
        return dataset

    def load_compare_one_day_intraday_dataset(
        ticker: str,
        *,
        include_extended_hours_flag: bool,
        include_overnight_flag: bool = False,
        trading_date: object | None = None,
        refresh_stale_local: bool = False,
    ) -> pd.DataFrame:
        if infer_ticker_market(ticker) == "US" and include_overnight_flag:
            intraday_dataset = fetch_request_compare_one_day_overnight_history(
                ticker,
                trading_date=trading_date,
            )
            if trading_date is not None:
                intraday_dataset = slice_intraday_dataset_to_market_trading_date(
                    intraday_dataset,
                    ticker,
                    trading_date,
                )
            if intraday_dataset.empty:
                raise ValueError(
                    f"Overnight companion data for {ticker} does not include {trading_date}."
                )
            return intraday_dataset

        if trading_date is None:
            intraday_dataset = load_local_compare_one_day_intraday_dataset(
                ticker,
                refresh_stale=refresh_stale_local,
            )
            if infer_ticker_market(ticker) == "US" and not include_extended_hours_flag:
                intraday_dataset = filter_intraday_dataset_to_regular_session(
                    intraday_dataset
                )
            if intraday_dataset.empty:
                raise ValueError(
                    f"The latest local intraday store does not contain usable data for {ticker}."
                )
            return intraday_dataset

        if infer_ticker_market(ticker) != "US":
            intraday_dataset = load_local_compare_one_day_intraday_dataset(ticker)
            dated_dataset = slice_intraday_dataset_to_market_trading_date(
                intraday_dataset,
                ticker,
                trading_date,
            )
            if not dated_dataset.empty:
                return dated_dataset
            try:
                intraday_dataset = fetch_one_minute_history_for_trading_date(
                    ticker,
                    trading_date,
                    include_dividends=False,
                    dividend_mode="price",
                )
            except (ImportError, OSError, ValueError, KeyError, TypeError) as exc:
                LOGGER.warning(
                    "Unable to fetch exact-day 1-minute compare data for %s on %s: %s",
                    ticker,
                    trading_date,
                    exc,
                )
                intraday_dataset = fetch_history(
                    ticker,
                    include_dividends=False,
                    interval="1m",
                    dividend_mode="price",
                )
            intraday_dataset = slice_intraday_dataset_to_market_trading_date(
                intraday_dataset, ticker, trading_date
            )
            if intraday_dataset.empty:
                raise ValueError(
                    f"The selected trading date does not contain shared intraday data for {ticker}."
                )
            return intraday_dataset

        try:
            intraday_dataset = fetch_compare_one_day_extended_history(
                ticker,
                trading_date=trading_date,
            )
            dated_dataset = slice_intraday_dataset_to_market_trading_date(
                intraday_dataset, ticker, trading_date
            )
            if dated_dataset.empty:
                raise ValueError(
                    f"Extended-hours data for {ticker} does not include {trading_date}."
                )
            intraday_dataset = dated_dataset
            if not include_extended_hours_flag:
                intraday_dataset = filter_intraday_dataset_to_regular_session(
                    intraday_dataset
                )
            return intraday_dataset
        except (ImportError, OSError, ValueError, KeyError, TypeError) as exc:
            LOGGER.warning(
                "Unable to fetch extended-hours compare 1d data for %s: %s",
                ticker,
                exc,
            )

        intraday_dataset = fetch_history(
            ticker,
            include_dividends=False,
            interval="1m",
            dividend_mode="price",
        )
        intraday_dataset = slice_intraday_dataset_to_market_trading_date(
            intraday_dataset, ticker, trading_date
        )
        if not include_extended_hours_flag:
            intraday_dataset = filter_intraday_dataset_to_regular_session(
                intraday_dataset
            )
        if intraday_dataset.empty:
            raise ValueError(
                f"The selected trading date does not contain shared intraday data for {ticker}."
            )
        return intraday_dataset

    def market_minute_key_for_compare_axis(value: object, ticker: str) -> str:
        timestamp = pd.Timestamp(value)
        if timestamp.tzinfo is None:
            timestamp = timestamp.tz_localize("America/New_York")
        else:
            timestamp = timestamp.tz_convert("America/New_York")
        localized = timestamp.tz_convert(market_timezone_for_ticker(ticker))
        return f"{int(localized.hour):02d}:{int(localized.minute):02d}"

    def load_live_compare_one_day_intraday_dataset(
        ticker: str,
        *,
        live_trading_date: object,
        include_extended_hours_flag: bool,
        force_refresh: bool,
        include_overnight_flag: bool = False,
    ) -> tuple[pd.DataFrame, str]:
        if infer_ticker_market(ticker) == "US" and include_overnight_flag:
            intraday_dataset = fetch_request_compare_one_day_overnight_history(
                ticker,
                trading_date=live_trading_date,
            )
            source = str(
                intraday_dataset.attrs.get("market_data_source")
                or "overnight_companion"
            )
            intraday_dataset = slice_intraday_dataset_to_market_trading_date(
                intraday_dataset,
                ticker,
                live_trading_date,
            )
            if intraday_dataset.empty:
                raise ValueError(
                    f"Overnight companion data for {ticker} does not include {live_trading_date}."
                )
            return intraday_dataset, source

        if infer_ticker_market(ticker) == "US" and include_extended_hours_flag:
            try:
                intraday_dataset = fetch_compare_one_day_extended_history(
                    ticker,
                    trading_date=live_trading_date,
                )
                source = str(
                    intraday_dataset.attrs.get("market_data_source") or "extended_hours"
                )
                intraday_dataset = slice_intraday_dataset_to_market_trading_date(
                    intraday_dataset,
                    ticker,
                    live_trading_date,
                )
                if intraday_dataset.empty:
                    raise ValueError(
                        f"Extended-hours data for {ticker} does not include {live_trading_date}."
                    )
                return intraday_dataset, source
            except (ImportError, OSError, ValueError, KeyError, TypeError) as exc:
                LOGGER.warning(
                    "Unable to load default extended-hours data for %s on %s: %s",
                    ticker,
                    live_trading_date,
                    exc,
                )

        source = "local"
        if force_refresh:
            try:
                refresh_result = refresh_one_minute_store(ticker)
                source = refresh_result.source
            except Exception as exc:  # noqa: BLE001
                LOGGER.warning(
                    "Unable to refresh live 1-minute compare data for %s: %s",
                    ticker,
                    exc,
                )

        intraday_dataset = load_local_compare_one_day_intraday_dataset(ticker)
        intraday_dataset = slice_intraday_dataset_to_market_trading_date(
            intraday_dataset,
            ticker,
            live_trading_date,
        )
        if intraday_dataset.empty and infer_ticker_market(ticker) != "US":
            try:
                intraday_dataset = fetch_one_minute_history_for_trading_date(
                    ticker,
                    live_trading_date,
                    include_dividends=False,
                    dividend_mode="price",
                )
                source = str(
                    intraday_dataset.attrs.get("market_data_source") or "yfinance_exact"
                )
            except (ImportError, OSError, ValueError, KeyError, TypeError) as exc:
                LOGGER.warning(
                    "Unable to fetch missing live 1-minute compare data for %s on %s: %s",
                    ticker,
                    live_trading_date,
                    exc,
                )
        if infer_ticker_market(ticker) == "US" and not include_extended_hours_flag:
            intraday_dataset = filter_intraday_dataset_to_regular_session(
                intraday_dataset
            )
        if intraday_dataset.empty:
            raise ValueError(
                f"Live 1-minute data for {ticker} does not include {live_trading_date}."
            )
        return intraday_dataset, source

    def load_target_compare_one_day_intraday_dataset(
        ticker: str,
        *,
        target_trading_date: object,
        include_extended_hours_flag: bool,
        include_overnight_flag: bool = False,
        live_session_date: object | None = None,
        force_refresh: bool = False,
    ) -> pd.DataFrame:
        parsed_target_date = pd.to_datetime(target_trading_date, errors="coerce")
        if pd.isna(parsed_target_date):
            raise ValueError(f"Invalid compare trading date: {target_trading_date}.")

        target_date_value = parsed_target_date.date()
        if live_session_date is None:
            current_live_session_date = pd.Timestamp.now(tz="Asia/Shanghai").date()
        else:
            parsed_live_session_date = pd.to_datetime(
                live_session_date, errors="coerce"
            )
            if pd.isna(parsed_live_session_date):
                raise ValueError(f"Invalid live session date: {live_session_date}.")
            current_live_session_date = parsed_live_session_date.date()

        if target_date_value == current_live_session_date:
            market_trading_date = resolve_compare_market_trading_date(
                ticker,
                target_date_value,
                display_trading_date=current_live_session_date,
            )
            return load_live_compare_one_day_intraday_dataset(
                ticker,
                live_trading_date=market_trading_date,
                include_extended_hours_flag=include_extended_hours_flag,
                include_overnight_flag=include_overnight_flag,
                force_refresh=force_refresh,
            )[0]

        return load_compare_one_day_intraday_dataset(
            ticker,
            include_extended_hours_flag=include_extended_hours_flag,
            include_overnight_flag=include_overnight_flag,
            trading_date=target_date_value,
        )

    def build_current_compare_one_day_datasets(
        tickers: list[str],
        *,
        daily_datasets: list[pd.DataFrame],
        target_trading_date: object,
        live_session_date: object,
        include_extended_hours_flag: bool,
        include_overnight_flag: bool,
        force_refresh: bool,
    ) -> tuple[list[pd.DataFrame], str]:
        """Build a current-day axis while allowing a market to remain pending."""
        parsed_target_date = pd.to_datetime(target_trading_date, errors="coerce")
        parsed_live_session_date = pd.to_datetime(live_session_date, errors="coerce")
        if pd.isna(parsed_target_date) or pd.isna(parsed_live_session_date):
            raise ValueError("Current compare trading dates must be valid.")

        target_date_value = parsed_target_date.date()
        live_session_date_value = parsed_live_session_date.date()
        axis_trading_date = (
            resolve_compare_axis_trading_date(tickers, target_date_value)
            if target_date_value == live_session_date_value
            else target_date_value
        )
        axis_trading_date_value = pd.to_datetime(axis_trading_date, errors="coerce")
        if pd.isna(axis_trading_date_value):
            raise ValueError("Current compare reference axis date must be valid.")
        axis_trading_date_value = axis_trading_date_value.date()
        reference_intraday_datasets = [
            load_compare_one_day_intraday_dataset(
                ticker,
                include_extended_hours_flag=include_extended_hours_flag,
                include_overnight_flag=include_overnight_flag,
                trading_date=axis_trading_date_value,
            )
            for ticker in tickers
        ]
        reference_common_end_date = min(
            dataset["Date"].max() for dataset in reference_intraday_datasets
        )
        reference_aligned_datasets = slice_intraday_datasets_for_compare_period(
            reference_intraday_datasets,
            "1d",
            reference_common_end_date,
            tickers,
        )
        if axis_trading_date_value != target_date_value:
            display_reference_aligned_datasets = [
                shift_intraday_compare_axis_to_trading_date(
                    dataset,
                    axis_trading_date_value,
                    target_date_value,
                )
                for dataset in reference_aligned_datasets
            ]
            aligned_datasets: list[pd.DataFrame] = []
            for reference_dataset, ticker in zip(
                display_reference_aligned_datasets, tickers
            ):
                try:
                    target_dataset = load_target_compare_one_day_intraday_dataset(
                        ticker,
                        target_trading_date=target_date_value,
                        include_extended_hours_flag=include_extended_hours_flag,
                        include_overnight_flag=include_overnight_flag,
                        live_session_date=live_session_date_value,
                        force_refresh=force_refresh,
                    )
                    aligned_datasets.append(
                        map_live_intraday_dataset_to_reference_axis(
                            reference_dataset,
                            target_dataset,
                            ticker,
                        )
                    )
                except Exception as exc:  # noqa: BLE001
                    LOGGER.info(
                        "No current compare bars for %s on %s yet: %s",
                        ticker,
                        target_date_value,
                        exc,
                    )
                    aligned_datasets.append(
                        build_empty_compare_axis_dataset(reference_dataset)
                    )
        else:
            aligned_datasets = [
                apply_market_close_anchor(
                    dataset,
                    daily_dataset,
                    ticker,
                    target_date_value,
                )
                for dataset, daily_dataset, ticker in zip(
                    reference_aligned_datasets,
                    daily_datasets,
                    tickers,
                )
            ]
        return aligned_datasets, pd.Timestamp(axis_trading_date_value).strftime(
            "%Y-%m-%d"
        )

    def append_live_compare_intraday_dataset(
        ticker: str,
        intraday_dataset: pd.DataFrame,
        *,
        live_trading_date: object,
        include_extended_hours_flag: bool,
        force_refresh: bool,
    ) -> tuple[pd.DataFrame, str | None]:
        try:
            live_dataset, source = load_live_compare_one_day_intraday_dataset(
                ticker,
                live_trading_date=live_trading_date,
                include_extended_hours_flag=include_extended_hours_flag,
                force_refresh=force_refresh,
            )
        except Exception as exc:  # noqa: BLE001
            LOGGER.warning(
                "Unable to append live intraday compare data for %s: %s", ticker, exc
            )
            return intraday_dataset, None
        combined = (
            pd.concat([intraday_dataset, live_dataset], ignore_index=True)
            .drop_duplicates(subset=["Date"], keep="last")
            .sort_values("Date")
            .reset_index(drop=True)
        )
        return combined, source

    def map_live_intraday_dataset_to_reference_axis(
        reference_dataset: pd.DataFrame,
        live_dataset: pd.DataFrame,
        ticker: str,
    ) -> pd.DataFrame:
        reference_frame = build_empty_compare_axis_dataset(reference_dataset)

        live_prepared = fill_intraday_market_session_gaps(
            prepare_intraday_dataset_for_compare(live_dataset, ticker),
            ticker,
        )
        if live_prepared.empty:
            return reference_frame

        live_rows_by_minute: dict[str, pd.Series] = {}
        for _, live_row in live_prepared.sort_values("Date").iterrows():
            live_rows_by_minute[
                market_minute_key_for_compare_axis(live_row["Date"], ticker)
            ] = live_row

        for row_index, reference_date in reference_frame["Date"].items():
            live_row = live_rows_by_minute.get(
                market_minute_key_for_compare_axis(reference_date, ticker)
            )
            if live_row is None:
                continue
            for column in ("Open", "High", "Low", "Close", "Adj Close", "Volume"):
                if column in live_row.index:
                    reference_frame.at[row_index, column] = live_row[column]

        return reference_frame

    def build_empty_compare_axis_dataset(
        reference_dataset: pd.DataFrame,
    ) -> pd.DataFrame:
        reference_frame = (
            reference_dataset[["Date"]]
            .copy()
            .sort_values("Date")
            .reset_index(drop=True)
        )
        for column in ("Open", "High", "Low", "Close", "Adj Close", "Volume"):
            reference_frame[column] = pd.NA
        return reference_frame

    def truncate_intraday_datasets_to_common_live_timestamp(
        datasets: list[pd.DataFrame],
    ) -> list[pd.DataFrame]:
        if not datasets:
            return []

        valid_end_dates: list[pd.Timestamp] = []
        for dataset in datasets:
            if (
                dataset.empty
                or "Date" not in dataset.columns
                or "Close" not in dataset.columns
            ):
                return datasets
            close_values = pd.to_numeric(dataset["Close"], errors="coerce")
            valid_dates = pd.to_datetime(
                dataset.loc[close_values.notna(), "Date"], errors="coerce"
            ).dropna()
            if valid_dates.empty:
                return datasets
            valid_end_dates.append(pd.Timestamp(valid_dates.max()))

        common_live_end = min(valid_end_dates)
        price_columns = ("Open", "High", "Low", "Close", "Adj Close")
        muted_columns = (*price_columns, "Volume", "Turnover")
        truncated_datasets: list[pd.DataFrame] = []
        for dataset in datasets:
            truncated = dataset.copy()
            parsed_dates = pd.to_datetime(truncated["Date"], errors="coerce")
            trailing_mask = parsed_dates > common_live_end
            if trailing_mask.any():
                for column in muted_columns:
                    if column in truncated.columns:
                        truncated.loc[trailing_mask, column] = pd.NA
            truncated_datasets.append(truncated)
        return truncated_datasets

    def build_empty_compare_axis_series_payload(
        ticker: str,
        reference_dataset: pd.DataFrame,
        color: str | None = None,
    ) -> SeriesPayload:
        reference_dates = (
            reference_dataset["Date"]
            .map(lambda value: pd.Timestamp(value).strftime("%Y-%m-%d %H:%M"))
            .tolist()
        )
        display_dates = (
            reference_dataset["Date"]
            .map(lambda value: format_display_datetime(value))
            .tolist()
        )
        # Keep the ticker on the shared axis even before that market has live bars.
        return SeriesPayload(
            ticker=ticker.upper(),
            dates=display_dates,
            raw_dates=reference_dates,
            normalized_returns=[None for _ in reference_dates],
            color=color,
            glow=False,
            candlestick_returns=[
                {
                    "x": index,
                    "o": None,
                    "h": None,
                    "l": None,
                    "c": None,
                    "v": None,
                    "synthetic": True,
                }
                for index, _value in enumerate(reference_dates)
            ],
            candlestick_prices=[
                {
                    "x": index,
                    "o": None,
                    "h": None,
                    "l": None,
                    "c": None,
                    "v": None,
                    "synthetic": True,
                }
                for index, _value in enumerate(reference_dates)
            ],
            prices=[None for _ in reference_dates],
        )

    def build_compare_series_payload(
        ticker: str,
        dataset: pd.DataFrame,
        color: str | None = None,
    ) -> SeriesPayload:
        try:
            return build_series_payload(ticker, dataset, color=color)
        except ValueError:
            if dataset.empty or "Date" not in dataset.columns:
                raise
            has_intraday_timestamps = (
                dataset["Date"]
                .map(
                    lambda value: (
                        pd.Timestamp(value).hour != 0 or pd.Timestamp(value).minute != 0
                    )
                )
                .any()
            )
            close_values = pd.to_numeric(
                dataset.get("Close", pd.Series(dtype="float64")), errors="coerce"
            ).dropna()
            if not has_intraday_timestamps or not close_values.empty:
                raise
            return build_empty_compare_axis_series_payload(ticker, dataset, color=color)

    def build_ttm_dividend_yield_map(
        tickers: list[str],
        end_date: object | None = None,
    ) -> dict[str, float | None]:
        yields: dict[str, float | None] = {}
        for ticker in tickers:
            normalized_ticker = normalize_ticker_input(ticker)
            try:
                price_dataset = fetch_history(
                    normalized_ticker, False, dividend_mode="price"
                )
                yields[normalized_ticker] = calculate_ttm_dividend_yield(
                    price_dataset, end_date=end_date
                )
            except Exception as exc:  # noqa: BLE001
                LOGGER.info(
                    "Unable to calculate TTM dividend yield for %s: %s",
                    normalized_ticker,
                    exc,
                )
                yields[normalized_ticker] = None
        return yields

    def best_numeric_metric(values: list[float | None]) -> float | None:
        numeric_values = [value for value in values if value is not None]
        return max(numeric_values) if numeric_values else None

    def format_store_range_date(raw_value: object) -> str:
        return format_store_range_date_value(raw_value)

    def build_portfolio_series_payload(
        datasets: list[pd.DataFrame], weights: list[int], color: str
    ):
        first_dataset = datasets[0]
        cumulative_growth = pd.Series(0.0, index=first_dataset.index)
        if len(datasets) != len(weights):
            raise ValueError(
                "Portfolio datasets and weights must have the same length."
            )
        for dataset, weight in zip(datasets, weights):
            first_close = float(dataset["Close"].iloc[0])
            cumulative_growth += (weight / 100.0) * (dataset["Close"] / first_close)
        portfolio_frame = pd.DataFrame(
            {
                "Date": first_dataset["Date"],
                "Close": cumulative_growth,
            }
        )
        return build_series_payload("Portfolio", portfolio_frame, color=color)

    def build_portfolio_series_payload_for_shares(
        datasets: list[pd.DataFrame], shares: list[int], color: str
    ):
        first_dataset = datasets[0]
        portfolio_value = pd.Series(0.0, index=first_dataset.index)
        if len(datasets) != len(shares):
            raise ValueError("Portfolio datasets and shares must have the same length.")
        for dataset, share_count in zip(datasets, shares):
            portfolio_value += max(int(share_count), 0) * dataset["Close"]
        if float(portfolio_value.iloc[0]) <= 0:
            raise ValueError("Each selected ticker must have at least 1 share.")
        portfolio_frame = pd.DataFrame(
            {
                "Date": first_dataset["Date"],
                "Close": portfolio_value,
            }
        )
        return build_series_payload("Portfolio", portfolio_frame, color=color)

    def normalize_portfolio_share_weights(
        datasets: list[pd.DataFrame], shares: list[int]
    ) -> list[int]:
        if not datasets:
            return []
        initial_values = [
            max(int(share_count), 0) * float(dataset["Close"].iloc[0])
            for dataset, share_count in zip(datasets, shares)
        ]
        total = sum(initial_values)
        if total <= 0:
            return [0 for _value in initial_values]
        scaled = [int((value * 100) / total) for value in initial_values]
        remainder = 100 - sum(scaled)
        order = sorted(
            range(len(initial_values)),
            key=lambda index: initial_values[index],
            reverse=True,
        )
        for index in order:
            if remainder <= 0:
                break
            scaled[index] += 1
            remainder -= 1
        return scaled

    def build_portfolio_growth_multipliers(datasets: list[pd.DataFrame]) -> list[float]:
        return [
            float(dataset["Close"].iloc[-1]) / float(dataset["Close"].iloc[0])
            for dataset in datasets
        ]

    def build_benchmark_series_payloads(
        reference_dates: pd.Series,
        include_dividends: bool,
        price_only: bool,
    ) -> tuple[list[SeriesPayload], list[QuoteProfile]]:
        benchmark_series: list[SeriesPayload] = []
        benchmark_profiles: list[QuoteProfile] = []
        reference_date_frame = pd.DataFrame({"Date": reference_dates})
        dividend_mode = resolve_workspace_dividend_mode(price_only, include_dividends)
        for ticker in PORTFOLIO_BENCHMARK_TICKERS:
            try:
                dataset = fetch_history(
                    ticker, include_dividends, dividend_mode=dividend_mode
                )
            except (ImportError, OSError, ValueError, KeyError, TypeError):
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
        return normalize_view_name(request.args.get("view", "tickers"))

    def build_legacy_workspace_redirect(view_name: str):
        if normalize_view_name(view_name) == "market-caps":
            return build_market_cap_compare_redirect()
        query_string = request.query_string.decode().strip()
        target_path = build_view_path(view_name)
        return redirect(
            f"{target_path}?{query_string}" if query_string else target_path
        )

    def build_market_cap_compare_redirect():
        """Redirect the retired market-cap workspace to its unified URL."""
        query_pairs = [("metric", "market-cap")]
        query_pairs.extend(
            (key, value)
            for key, values in request.args.lists()
            if key not in {"metric", "view"}
            for value in values
        )
        query_string = urlencode(query_pairs, doseq=True)
        target_path = build_view_path("prices")
        return redirect(f"{target_path}?{query_string}")

    def build_dca_backtest_redirect():
        query_pairs = [
            (key, value)
            for key, values in request.args.lists()
            if key not in {"strategy", "workspace"}
            for value in values
        ]
        query_pairs.append(("strategy", "dca"))
        query_string = urlencode(query_pairs)
        target_path = build_view_path("backtest")
        return redirect(
            f"{target_path}?{query_string}" if query_string else target_path
        )

    def resolve_settings_section() -> str:
        for parameter_name in ("section", "settings_section"):
            requested_section = request.args.get(parameter_name, "").strip()
            if requested_section:
                return normalize_settings_section(requested_section)
        return "about"

    def resolve_settings_tab() -> str:
        for parameter_name in ("tab", "settings_tab", "language_tab"):
            requested_tab = request.args.get(parameter_name, "").strip()
            if requested_tab:
                return normalize_settings_tab(requested_tab)
        return "current"

    def settings_page_value() -> int:
        for parameter_name in ("page", "settings_page", "local_page", "language_page"):
            requested_page = request.args.get(parameter_name, "").strip()
            if requested_page:
                return normalize_settings_page(requested_page)
        return 1

    def should_use_modal_banner_message(message: str | None) -> bool:
        normalized = (message or "").strip()
        if not normalized:
            return False
        return (
            normalized.startswith("No market data returned for ")
            or normalized.startswith("Local market data for ")
            or normalized.startswith("Unknown or unsupported ticker: ")
            or normalized.startswith("has no local or remote market data")
            or normalized.startswith("Failed to perform, curl: (35) TLS connect error:")
        )

    def modal_banner_icon_class(message: str | None) -> str:
        normalized = (message or "").strip()
        if normalized.startswith("Backtest execution model updated:"):
            return "icon-modal-dialog-banner-backtest-execution"
        return "icon-modal-dialog-banner-default"

    def build_local_store_page_url(page_number: int) -> str:
        return build_settings_state_url("local-market-store", page=page_number)

    def get_strategy_ticker_contract(
        strategy_id: str,
    ) -> tuple[int, list[str], dict[str, object]]:
        """Return the ordered ticker contract declared by one discovered strategy."""
        definition = next(
            (
                item
                for item in list_enabled_strategies()
                if str(item.get("id")) == strategy_id
            ),
            {},
        )
        supports = definition.get("supports", {})
        supports = supports if isinstance(supports, dict) else {}
        raw_required = supports.get("required_tickers")
        try:
            required_tickers = int(raw_required)
        except (TypeError, ValueError):
            required_tickers = 2 if supports.get("multi_ticker") else 1
        required_tickers = max(1, min(required_tickers, MAX_TICKERS))
        default_tickers: list[str] = []
        for value in definition.get("default_tickers", []):
            normalized_ticker = normalize_ticker_input(str(value))
            if normalized_ticker and normalized_ticker not in default_tickers:
                default_tickers.append(normalized_ticker)
        return required_tickers, default_tickers, supports

    def resolve_backtest_tickers(
        requested_tickers: list[str],
        strategy_id: str,
    ) -> tuple[list[str], int, dict[str, object]]:
        """Resolve strategy-owned ticker defaults while preserving query order."""
        required_tickers, default_tickers, supports = get_strategy_ticker_contract(
            strategy_id
        )
        normalized_requested = [
            normalize_ticker_input(str(value))
            for value in requested_tickers
            if normalize_ticker_input(str(value))
        ]
        if not normalized_requested:
            resolved = default_tickers[:required_tickers]
        elif required_tickers == 1:
            resolved = normalized_requested[:1] or default_tickers[:1]
        else:
            resolved = normalized_requested[:required_tickers]
            for default_ticker in default_tickers:
                if len(resolved) >= required_tickers:
                    break
                if default_ticker not in resolved:
                    resolved.append(default_ticker)
        return resolved[:required_tickers], required_tickers, supports

    return {
        "_get_backtest_cache_key": _get_backtest_cache_key,
        "_read_settings_feedback": _read_settings_feedback,
        "_redirect_with_settings_feedback": _redirect_with_settings_feedback,
        "append_live_compare_intraday_dataset": append_live_compare_intraday_dataset,
        "apply_market_close_anchor": apply_market_close_anchor,
        "best_numeric_metric": best_numeric_metric,
        "build_benchmark_series_payloads": build_benchmark_series_payloads,
        "build_compare_series_payload": build_compare_series_payload,
        "build_current_compare_one_day_datasets": build_current_compare_one_day_datasets,
        "build_dca_backtest_redirect": build_dca_backtest_redirect,
        "build_empty_compare_axis_dataset": build_empty_compare_axis_dataset,
        "build_empty_compare_axis_series_payload": build_empty_compare_axis_series_payload,
        "build_exact_range_bounds": build_exact_range_bounds,
        "build_legacy_workspace_redirect": build_legacy_workspace_redirect,
        "build_local_store_page_url": build_local_store_page_url,
        "build_market_cap_compare_redirect": build_market_cap_compare_redirect,
        "build_portfolio_growth_multipliers": build_portfolio_growth_multipliers,
        "build_portfolio_series_payload": build_portfolio_series_payload,
        "build_portfolio_series_payload_for_shares": build_portfolio_series_payload_for_shares,
        "build_ttm_dividend_yield_map": build_ttm_dividend_yield_map,
        "exact_trading_dates_in_range": exact_trading_dates_in_range,
        "format_store_range_date": format_store_range_date,
        "get_strategy_ticker_contract": get_strategy_ticker_contract,
        "is_market_regular_session_active_for_ticker": is_market_regular_session_active_for_ticker,
        "load_compare_one_day_intraday_dataset": load_compare_one_day_intraday_dataset,
        "load_live_compare_one_day_intraday_dataset": load_live_compare_one_day_intraday_dataset,
        "load_local_compare_one_day_intraday_dataset": load_local_compare_one_day_intraday_dataset,
        "load_target_compare_one_day_intraday_dataset": load_target_compare_one_day_intraday_dataset,
        "map_live_intraday_dataset_to_reference_axis": map_live_intraday_dataset_to_reference_axis,
        "market_close_minute_for_ticker": market_close_minute_for_ticker,
        "market_minute_key_for_compare_axis": market_minute_key_for_compare_axis,
        "market_session_segments_for_ticker": market_session_segments_for_ticker,
        "modal_banner_icon_class": modal_banner_icon_class,
        "normalize_portfolio_share_weights": normalize_portfolio_share_weights,
        "parse_bool_flag": parse_bool_flag,
        "parse_portfolio_allocation_mode": parse_portfolio_allocation_mode,
        "parse_range_request_args": parse_range_request_args,
        "parse_requested_shares": parse_requested_shares,
        "parse_requested_tickers": parse_requested_tickers,
        "parse_requested_weights": parse_requested_weights,
        "resolve_backtest_tickers": resolve_backtest_tickers,
        "resolve_compare_market_trading_date": resolve_compare_market_trading_date,
        "resolve_comparison_metric": resolve_comparison_metric,
        "resolve_settings_section": resolve_settings_section,
        "resolve_settings_tab": resolve_settings_tab,
        "resolve_view": resolve_view,
        "settings_page_value": settings_page_value,
        "should_use_modal_banner_message": should_use_modal_banner_message,
        "slice_dataset_to_exact_range": slice_dataset_to_exact_range,
        "slice_datasets_to_exact_range": slice_datasets_to_exact_range,
        "slice_intraday_dataset_to_market_trading_date": slice_intraday_dataset_to_market_trading_date,
        "slice_intraday_dataset_to_trading_dates": slice_intraday_dataset_to_trading_dates,
        "truncate_intraday_datasets_to_common_live_timestamp": truncate_intraday_datasets_to_common_live_timestamp,
        "validate_ticker_or_raise": validate_ticker_or_raise,
    }
