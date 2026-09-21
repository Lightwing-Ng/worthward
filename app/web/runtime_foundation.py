"""Build the foundation web-runtime context.

Code version: v0.2.0
"""

from __future__ import annotations


def build_foundation_context(context: dict[str, object]) -> dict[str, object]:
    Any = context["Any"]

    DateConstraintPayload = context["DateConstraintPayload"]

    INVESTMENT_REALTIME_QUOTE_TTL_SECONDS = context[
        "INVESTMENT_REALTIME_QUOTE_TTL_SECONDS"
    ]

    INVESTMENT_STORE_PATH = context["INVESTMENT_STORE_PATH"]

    INVESTMENT_TRANSACTIONS_CACHE_PATH = context["INVESTMENT_TRANSACTIONS_CACHE_PATH"]

    INVESTMENT_TRANSACTIONS_CACHE_SCHEMA_VERSION = context[
        "INVESTMENT_TRANSACTIONS_CACHE_SCHEMA_VERSION"
    ]

    LEGACY_LIVE_TRADING_TOKEN_HEADER = context["LEGACY_LIVE_TRADING_TOKEN_HEADER"]

    LIVE_TRADING_TOKEN_HEADER = context["LIVE_TRADING_TOKEN_HEADER"]

    LOGGER = context["LOGGER"]

    LstmTrainingManager = context["LstmTrainingManager"]

    Path = context["Path"]

    PriceFieldTrainingManager = context["PriceFieldTrainingManager"]

    QuoteProfile = context["QuoteProfile"]

    _synchronize_hsbc_authoritative_current_cash_boundary = context[
        "_synchronize_hsbc_authoritative_current_cash_boundary"
    ]

    authorize_live_trading_api_request = context["authorize_live_trading_api_request"]

    build_date_constraint_availability = context["build_date_constraint_availability"]

    build_date_constraint_payload = context["build_date_constraint_payload"]

    cast = context["cast"]

    commit_investment_import = context["commit_investment_import"]

    complete_market_local_trading_days = context["complete_market_local_trading_days"]

    ensure_latest_investment_daily_caches = context[
        "ensure_latest_investment_daily_caches"
    ]

    extract_open_investment_tickers = context["extract_open_investment_tickers"]

    fetch_compare_one_day_extended_history = context[
        "fetch_compare_one_day_extended_history"
    ]

    fetch_compare_one_day_overnight_history = context[
        "fetch_compare_one_day_overnight_history"
    ]

    fetch_history = context["fetch_history"]

    fetch_longbridge_realtime_quotes = context["fetch_longbridge_realtime_quotes"]

    fetch_one_minute_history_for_trading_date = context[
        "fetch_one_minute_history_for_trading_date"
    ]

    fetch_usd_exchange_rate_history = context["fetch_usd_exchange_rate_history"]

    fetch_yfinance_realtime_quotes = context["fetch_yfinance_realtime_quotes"]

    format_display_date = context["format_display_date"]

    g = context["g"]

    get_settings = context["get_settings"]

    history_store_path_for = context["history_store_path_for"]

    infer_ticker_market = context["infer_ticker_market"]

    intraday_history_store_path_for = context["intraday_history_store_path_for"]

    investment_source_artifact_storage_keys = context[
        "investment_source_artifact_storage_keys"
    ]

    investment_ticker_identity_store_aliases = context[
        "investment_ticker_identity_store_aliases"
    ]

    investment_ticker_store_aliases = context["investment_ticker_store_aliases"]

    json = context["json"]

    jsonify = context["jsonify"]

    latest_completed_nyse_trading_day = context["latest_completed_nyse_trading_day"]

    load_cash_equivalent_tickers = context["load_cash_equivalent_tickers"]

    load_investment_store_payload = context["load_investment_store_payload"]

    market_store_file_lock = context["market_store_file_lock"]

    market_trading_date_for_timestamp = context["market_trading_date_for_timestamp"]

    materialize_investment_source_artifacts = context[
        "materialize_investment_source_artifacts"
    ]

    merge_investment_payloads = context["merge_investment_payloads"]

    normalize_investment_payload_tickers = context[
        "normalize_investment_payload_tickers"
    ]

    normalize_ticker_input = context["normalize_ticker_input"]

    nyse_market_session_state = context["nyse_market_session_state"]

    pd = context["pd"]

    prepare_intraday_dataset_for_compare = context[
        "prepare_intraday_dataset_for_compare"
    ]

    propagate_investment_lineage_identity_profiles = context[
        "propagate_investment_lineage_identity_profiles"
    ]

    re = context["re"]

    refresh_history_store = context["refresh_history_store"]

    refresh_investment_security_transfer_reconciliation = context[
        "refresh_investment_security_transfer_reconciliation"
    ]

    refresh_recent_one_minute_store_with_yfinance = context[
        "refresh_recent_one_minute_store_with_yfinance"
    ]

    request = context["request"]

    resolve_known_ticker_company_name = context["resolve_known_ticker_company_name"]

    session = context["session"]

    threading = context["threading"]

    time = context["time"]

    update_investment_store_payload = context["update_investment_store_payload"]

    verify_investment_source_artifacts = context["verify_investment_source_artifacts"]

    write_json_atomic = context["write_json_atomic"]

    def resolve_ticker_identity_snapshot(*args, **kwargs):

        return context["resolve_ticker_identity_snapshot"](*args, **kwargs)

    settings = get_settings()

    defaults = settings["defaults"]

    base_labels = settings["ui"]["labels"]

    theme_settings = settings["ui"]["theme"]

    theme_light = theme_settings["light"]

    theme_dark = theme_settings["dark"]

    theme = theme_light

    chart_config = settings["ui"]["chart"]

    logos = settings["ui"]["logos"]

    app_meta = settings["app"]

    live_trading_pin = settings.get("security", {}).get("live_trading_pin", "")

    investment_settings = (
        settings.get("investment", {})
        if isinstance(settings.get("investment"), dict)
        else {}
    )

    money_market_settings = (
        investment_settings.get("money_market_funds", {})
        if isinstance(investment_settings.get("money_market_funds"), dict)
        else {}
    )

    lstm_training_manager = LstmTrainingManager()

    price_field_training_manager = PriceFieldTrainingManager()

    def quote_profile_to_json(profile: QuoteProfile) -> dict[str, str | None]:
        return {
            "ticker": profile.ticker,
            "company_name": profile.company_name,
            "website": profile.website,
            "logo_url": profile.logo_url,
        }

    def date_constraint_payload_to_json(
        payload: DateConstraintPayload,
    ) -> dict[str, object]:
        return {
            "min_date": payload.min_date,
            "max_date": payload.max_date,
            "trading_dates": list(payload.trading_dates),
            "adjusted_start": payload.adjusted_start,
            "adjusted_end": payload.adjusted_end,
            "message": payload.message,
            "availability": payload.availability,
        }

    def annotate_date_constraint_availability(
        payload: DateConstraintPayload,
        tickers: list[str],
        datasets: list[pd.DataFrame],
    ) -> DateConstraintPayload:
        payload.availability = build_date_constraint_availability(
            payload, tickers, datasets
        )
        return payload

    def fetch_request_compare_one_day_overnight_history(
        ticker: str,
        *,
        trading_date: object | None = None,
    ) -> pd.DataFrame:
        cache = getattr(g, "compare_overnight_history_cache", None)
        if cache is None:
            cache = {}
            g.compare_overnight_history_cache = cache
        parsed_trading_date = (
            pd.to_datetime(trading_date, errors="coerce")
            if trading_date is not None
            else None
        )
        cache_date = (
            ""
            if parsed_trading_date is None or pd.isna(parsed_trading_date)
            else parsed_trading_date.date().isoformat()
        )
        cache_key = (normalize_ticker_input(ticker), cache_date)
        if cache_key not in cache:
            cache[cache_key] = fetch_compare_one_day_overnight_history(
                ticker,
                trading_date=trading_date,
            )
        return cache[cache_key].copy()

    def market_local_trading_dates_frame(
        dataset: pd.DataFrame, ticker: str
    ) -> pd.DataFrame:
        if dataset.empty or "Date" not in dataset.columns:
            return pd.DataFrame({"Date": pd.Series(dtype="datetime64[ns]")})

        def market_local_date(value: object) -> object:
            return market_trading_date_for_timestamp(value, ticker)

        dates = (
            dataset["Date"]
            .map(market_local_date)
            .dropna()
            .drop_duplicates()
            .sort_values()
        )
        return pd.DataFrame({"Date": pd.to_datetime(dates)})

    def format_compare_intraday_market_local_display_range(
        datasets: list[pd.DataFrame],
        tickers: list[str],
    ) -> str:
        local_dates: list[pd.Timestamp] = []
        for index, dataset in enumerate(datasets):
            ticker = tickers[index] if index < len(tickers) else ""
            frame = market_local_trading_dates_frame(dataset, ticker)
            if frame.empty:
                continue
            local_dates.extend(
                pd.to_datetime(frame["Date"], errors="coerce").dropna().tolist()
            )
        if not local_dates:
            return ""
        return f"{format_display_date(min(local_dates))} - {format_display_date(max(local_dates))}"

    def build_one_day_intraday_date_constraint_payload(
        tickers: list[str],
        requested_start: str | None = None,
        requested_end: str | None = None,
        include_overnight_flag: bool = False,
    ) -> DateConstraintPayload:
        date_frames: list[pd.DataFrame] = []
        refresh_failures: list[str] = []
        live_session_date = pd.Timestamp.now(tz="Asia/Shanghai").date()
        has_live_session_date = False
        requested_dates = {
            parsed.date()
            for value in (requested_start, requested_end)
            if value and not pd.isna(parsed := pd.to_datetime(value, errors="coerce"))
        }
        dates_to_probe = set(requested_dates)
        has_us_market = any(infer_ticker_market(ticker) == "US" for ticker in tickers)
        has_non_us_market = any(
            infer_ticker_market(ticker) != "US" for ticker in tickers
        )
        should_probe_live_session = has_us_market and has_non_us_market
        if not dates_to_probe and has_us_market:
            live_session_state = nyse_market_session_state(include_overnight=True)
            if live_session_state.get("is_trading_day"):
                should_probe_live_session = True
        if should_probe_live_session:
            dates_to_probe.add(live_session_date)
        for ticker in tickers:
            use_overnight_source = (
                include_overnight_flag and infer_ticker_market(ticker) == "US"
            )
            if use_overnight_source:
                try:
                    intraday_dataset = fetch_request_compare_one_day_overnight_history(
                        ticker,
                        trading_date=requested_start or requested_end,
                    )
                except (ImportError, OSError, ValueError, KeyError, TypeError) as exc:
                    LOGGER.warning(
                        "Unable to load overnight date constraints for %s: %s",
                        ticker,
                        exc,
                    )
                    refresh_failures.append(ticker)
                    intraday_dataset = fetch_history(
                        ticker,
                        include_dividends=False,
                        interval="1m",
                        dividend_mode="price",
                    )
            else:
                intraday_dataset = fetch_history(
                    ticker,
                    include_dividends=False,
                    interval="1m",
                    dividend_mode="price",
                )
            prepared_dataset = prepare_intraday_dataset_for_compare(
                intraday_dataset,
                ticker,
                regular_session_only=not use_overnight_source,
            )
            date_frame = market_local_trading_dates_frame(prepared_dataset, ticker)
            available_dates = (
                set(date_frame["Date"].dt.date) if not date_frame.empty else set()
            )
            should_refresh_public_data = not use_overnight_source and (
                not dates_to_probe or not dates_to_probe.issubset(available_dates)
            )
            if should_refresh_public_data:
                try:
                    refresh_recent_one_minute_store_with_yfinance(ticker)
                    intraday_dataset = fetch_history(
                        ticker,
                        include_dividends=False,
                        interval="1m",
                        dividend_mode="price",
                    )
                    prepared_dataset = prepare_intraday_dataset_for_compare(
                        intraday_dataset,
                        ticker,
                        regular_session_only=True,
                    )
                    date_frame = market_local_trading_dates_frame(
                        prepared_dataset, ticker
                    )
                except (ImportError, OSError, ValueError, KeyError, TypeError) as exc:
                    LOGGER.warning(
                        "Unable to refresh 1-minute date constraints for %s: %s",
                        ticker,
                        exc,
                    )
                    refresh_failures.append(ticker)
            available_dates = (
                set(date_frame["Date"].dt.date) if not date_frame.empty else set()
            )
            missing_requested_dates = requested_dates - available_dates
            if not use_overnight_source:
                for requested_date in sorted(missing_requested_dates):
                    try:
                        if infer_ticker_market(ticker) == "US":
                            exact_dataset = fetch_compare_one_day_extended_history(
                                ticker,
                                trading_date=requested_date,
                            )
                            regular_session_only = False
                        else:
                            exact_dataset = fetch_one_minute_history_for_trading_date(
                                ticker,
                                requested_date,
                                include_dividends=False,
                                dividend_mode="price",
                            )
                            regular_session_only = True
                        prepared_exact_dataset = prepare_intraday_dataset_for_compare(
                            exact_dataset,
                            ticker,
                            regular_session_only=regular_session_only,
                        )
                        exact_date_frame = market_local_trading_dates_frame(
                            prepared_exact_dataset,
                            ticker,
                        )
                        date_frame = (
                            pd.concat([date_frame, exact_date_frame], ignore_index=True)
                            .drop_duplicates(subset=["Date"])
                            .sort_values("Date")
                            .reset_index(drop=True)
                        )
                    except (
                        ImportError,
                        OSError,
                        ValueError,
                        KeyError,
                        TypeError,
                    ) as exc:
                        LOGGER.warning(
                            "Unable to load exact-day date constraints for %s on %s: %s",
                            ticker,
                            requested_date,
                            exc,
                        )
                        if ticker not in refresh_failures:
                            refresh_failures.append(ticker)
            if dates_to_probe and dates_to_probe.issubset(
                set(date_frame["Date"].dt.date) if not date_frame.empty else set()
            ):
                refresh_failures = [
                    failed_ticker
                    for failed_ticker in refresh_failures
                    if failed_ticker != ticker
                ]
            has_live_session_date = has_live_session_date or bool(
                not date_frame.empty
                and (date_frame["Date"].dt.date == live_session_date).any()
            )
            date_frames.append(date_frame)

        payload = build_date_constraint_payload(
            *date_frames,
            requested_start=requested_start,
            requested_end=requested_end,
        )
        if has_live_session_date:
            live_date_value = pd.Timestamp(live_session_date).strftime("%Y-%m-%d")
            trading_dates = sorted({*payload.trading_dates, live_date_value})
            adjusted_start = payload.adjusted_start
            adjusted_end = payload.adjusted_end
            requested_start_date = (
                pd.to_datetime(requested_start, errors="coerce")
                if requested_start
                else None
            )
            requested_end_date = (
                pd.to_datetime(requested_end, errors="coerce")
                if requested_end
                else None
            )
            if (
                requested_start_date is not None
                and not pd.isna(requested_start_date)
                and requested_start_date.date() == live_session_date
            ):
                adjusted_start = live_date_value
            if (
                requested_end_date is not None
                and not pd.isna(requested_end_date)
                and requested_end_date.date() == live_session_date
            ):
                adjusted_end = live_date_value
            payload = DateConstraintPayload(
                min_date=payload.min_date or live_date_value,
                max_date=max(
                    [payload.max_date, live_date_value]
                    if payload.max_date
                    else [live_date_value]
                ),
                trading_dates=trading_dates,
                adjusted_start=adjusted_start,
                adjusted_end=adjusted_end,
                message=payload.message,
            )
        if refresh_failures:
            failed_preview = ", ".join(refresh_failures)
            refresh_notice = (
                f"Could not refresh 1-minute trading dates for {failed_preview}. "
                "Using currently cached intraday dates."
            )
            payload.message = (
                f"{payload.message} {refresh_notice}".strip()
                if payload.message
                else refresh_notice
            )
        return annotate_date_constraint_availability(payload, tickers, date_frames)

    def build_short_intraday_date_constraint_payload(
        tickers: list[str],
        requested_start: str | None = None,
        requested_end: str | None = None,
    ) -> DateConstraintPayload:
        date_frames: list[pd.DataFrame] = []
        for ticker in tickers:
            intraday_dataset = fetch_history(
                ticker,
                include_dividends=False,
                interval="1m",
                dividend_mode="price",
            )
            prepared_dataset = prepare_intraday_dataset_for_compare(
                intraday_dataset,
                ticker,
                regular_session_only=True,
            )
            date_frames.append(
                market_local_trading_dates_frame(prepared_dataset, ticker)
            )

        payload = build_date_constraint_payload(
            *date_frames,
            requested_start=requested_start,
            requested_end=requested_end,
        )
        return annotate_date_constraint_availability(payload, tickers, date_frames)

    def resolve_compare_axis_trading_date(
        tickers: list[str],
        requested_trading_date: object,
    ) -> str:
        requested_date = pd.to_datetime(requested_trading_date, errors="coerce")
        if pd.isna(requested_date):
            raise ValueError(f"Invalid compare trading date: {requested_trading_date}.")
        requested_date_value = requested_date.date()
        live_session_date = pd.Timestamp.now(tz="Asia/Shanghai").date()

        date_frames: list[pd.DataFrame] = []
        requested_date_is_complete = requested_date_value != live_session_date
        for ticker in tickers:
            intraday_dataset = fetch_history(
                ticker,
                include_dividends=False,
                interval="1m",
                dividend_mode="price",
            )
            prepared_dataset = prepare_intraday_dataset_for_compare(
                intraday_dataset,
                ticker,
                regular_session_only=True,
            )
            date_frame = market_local_trading_dates_frame(prepared_dataset, ticker)
            requested_date_is_complete = (
                requested_date_is_complete
                and requested_date_value
                in complete_market_local_trading_days(
                    prepared_dataset,
                    ticker,
                )
            )
            if not date_frame.empty:
                date_frame = date_frame[
                    date_frame["Date"].dt.date < requested_date_value
                ].copy()
            date_frames.append(date_frame)

        if requested_date_is_complete:
            return pd.Timestamp(requested_date_value).strftime("%Y-%m-%d")

        payload = build_date_constraint_payload(*date_frames)
        if not payload.trading_dates:
            return pd.Timestamp(requested_date_value).strftime("%Y-%m-%d")
        return payload.max_date or payload.trading_dates[-1]

    def canonicalize_money_market_ticker(value: object) -> str:
        raw_ticker = str(value or "").strip().upper()
        aliases = investment_ticker_store_aliases(raw_ticker)
        return str(aliases[0] if aliases else raw_ticker).strip().upper()

    configured_money_market_tickers = {
        canonicalize_money_market_ticker(value)
        for value in money_market_settings.get("tickers", [])
        if str(value).strip()
    }

    configured_money_market_quote_currencies = {
        canonicalize_money_market_ticker(ticker): str(currency).strip().upper()
        for ticker, currency in money_market_settings.get(
            "quote_currency_overrides", {}
        ).items()
        if (
            canonicalize_money_market_ticker(ticker) in configured_money_market_tickers
            and len(str(currency).strip()) == 3
        )
    }

    money_market_name_from_description = bool(
        money_market_settings.get("name_from_description", False)
    )

    money_market_description_keywords = [
        str(value).strip().upper()
        for value in money_market_settings.get("description_keywords", [])
        if str(value).strip()
    ]

    def exclude_configured_money_market_tickers(tickers: list[str]) -> list[str]:
        return [
            ticker
            for ticker in tickers
            if not is_configured_money_market_ticker(ticker)
        ]

    investment_realtime_quote_cache_lock = threading.Lock()

    investment_realtime_quote_cache: dict[
        tuple[str, ...], tuple[float, list[dict[str, object]]]
    ] = {}

    def is_configured_money_market_ticker(ticker: str) -> bool:
        return (
            canonicalize_money_market_ticker(ticker) in configured_money_market_tickers
        )

    def get_cash_equivalent_tickers() -> set[str]:
        try:
            raw = load_cash_equivalent_tickers()
            return {str(value).strip().upper() for value in raw if str(value).strip()}
        except Exception:  # noqa: BLE001
            return {"BOXX", "SGOV"}

    def apply_no_store_headers(response):
        response.headers["Cache-Control"] = (
            "no-store, no-cache, max-age=0, must-revalidate"
        )
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
        return response

    def live_trading_api_authorization_failure_response():
        access_granted, error_status, error_message = (
            authorize_live_trading_api_request(
                bool(session.get("live_trading_unlocked")),
                request.headers.get(LIVE_TRADING_TOKEN_HEADER)
                or request.headers.get(LEGACY_LIVE_TRADING_TOKEN_HEADER),
            )
        )
        if access_granted:
            return None

        response = jsonify({"success": False, "error": error_message})
        response.status_code = error_status
        if error_status == 401:
            response.headers["WWW-Authenticate"] = (
                'Bearer realm="worthward-live-trading"'
            )
        return apply_no_store_headers(response)

    def ensure_investment_transactions_cache_dir() -> None:
        INVESTMENT_TRANSACTIONS_CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)

    def invalidate_investment_transactions_cache() -> None:
        try:
            ensure_investment_transactions_cache_dir()
            with market_store_file_lock(INVESTMENT_TRANSACTIONS_CACHE_PATH):
                if INVESTMENT_TRANSACTIONS_CACHE_PATH.exists():
                    INVESTMENT_TRANSACTIONS_CACHE_PATH.unlink()
        except OSError:
            LOGGER.warning(
                "Unable to invalidate the derived investment transaction cache; "
                "continuing with the portable investment ledger.",
                exc_info=True,
            )

    def build_file_fingerprint(path: Path) -> dict[str, object]:
        if not path.exists():
            return {
                "exists": False,
                "path": str(path),
                "size": 0,
                "mtime_ns": 0,
            }
        stat_result = path.stat()
        return {
            "exists": True,
            "path": str(path),
            "size": stat_result.st_size,
            "mtime_ns": stat_result.st_mtime_ns,
        }

    def build_investment_price_store_fingerprints(
        transactions: list[dict[str, Any]],
        open_tickers: list[str] | set[str] | tuple[str, ...],
    ) -> list[dict[str, object]]:
        open_ticker_set = {
            normalize_ticker_input(str(ticker))
            for ticker in (open_tickers or [])
            if str(ticker or "").strip()
        }
        fingerprints: list[dict[str, object]] = []
        for ticker in collect_investment_display_tickers(transactions):
            if is_configured_money_market_ticker(ticker):
                continue
            path = resolve_investment_history_store_path(ticker)
            fingerprints.append(
                {
                    "ticker": ticker,
                    "is_open": ticker in open_ticker_set,
                    "store": build_file_fingerprint(path)
                    if path is not None
                    else {
                        "exists": False,
                        "path": "",
                        "size": 0,
                        "mtime_ns": 0,
                    },
                }
            )
        return fingerprints

    def read_investment_transactions_cache(
        investment_store_fingerprint: dict[str, object],
    ) -> dict[str, Any] | None:
        try:
            ensure_investment_transactions_cache_dir()
            with market_store_file_lock(INVESTMENT_TRANSACTIONS_CACHE_PATH):
                if not INVESTMENT_TRANSACTIONS_CACHE_PATH.exists():
                    return None
                with open(
                    INVESTMENT_TRANSACTIONS_CACHE_PATH, "r", encoding="utf-8"
                ) as f:
                    cached = json.load(f)
        except (json.JSONDecodeError, OSError, TypeError):
            return None

        if cached.get("schema_version") != INVESTMENT_TRANSACTIONS_CACHE_SCHEMA_VERSION:
            return None
        if cached.get("investment_store") != investment_store_fingerprint:
            return None
        payload = cached.get("payload")
        if not isinstance(payload, dict):
            return None
        section_freshness = payload.get("section_freshness")
        if not isinstance(section_freshness, dict):
            return None
        target_trading_day = latest_completed_nyse_trading_day().strftime("%Y-%m-%d")
        if section_freshness.get("target_trading_day") != target_trading_day:
            return None
        transactions = payload.get("transactions", [])
        if not isinstance(transactions, list):
            return None
        price_store_fingerprints = build_investment_price_store_fingerprints(
            cast(list[dict[str, Any]], transactions),
            section_freshness.get("open_tickers") or [],
        )
        if cached.get("price_stores") != price_store_fingerprints:
            return None
        return normalize_loaded_investment_payload(payload)

    def write_investment_transactions_cache(
        *,
        investment_store_fingerprint: dict[str, object],
        price_store_fingerprints: list[dict[str, object]],
        payload: dict[str, Any],
    ) -> None:
        cache_payload = {
            "schema_version": INVESTMENT_TRANSACTIONS_CACHE_SCHEMA_VERSION,
            "investment_store": investment_store_fingerprint,
            "price_stores": price_store_fingerprints,
            "payload": payload,
        }
        try:
            ensure_investment_transactions_cache_dir()
            with market_store_file_lock(INVESTMENT_TRANSACTIONS_CACHE_PATH):
                write_json_atomic(INVESTMENT_TRANSACTIONS_CACHE_PATH, cache_payload)
        except OSError:
            LOGGER.warning(
                "Unable to write the derived investment transaction cache; "
                "continuing with the portable investment ledger.",
                exc_info=True,
            )

    def normalize_loaded_investment_payload(payload: dict[str, Any]) -> dict[str, Any]:
        normalized_payload = normalize_investment_payload_tickers(payload)
        _synchronize_hsbc_authoritative_current_cash_boundary(normalized_payload)
        return cast(
            dict[str, Any],
            refresh_investment_security_transfer_reconciliation(normalized_payload),
        )

    def load_normalized_investment_payload() -> dict[str, Any]:
        return normalize_loaded_investment_payload(
            load_investment_store_payload(INVESTMENT_STORE_PATH)
        )

    def merge_and_write_investment_payload(
        imported_payload: dict[str, Any],
    ) -> dict[str, Any]:
        def is_test_account_identifier(value: object) -> bool:
            normalized = re.sub(r"[^A-Z0-9]+", "", str(value or "").upper())
            return normalized.endswith("TEST") or normalized.endswith("E2E")

        imported_broker = str(imported_payload.get("broker") or "").strip().lower()
        imported_records = [
            record
            for record in imported_payload.get("transactions", [])
            if isinstance(record, dict)
        ]
        has_test_account = imported_broker == "ibkr" and (
            is_test_account_identifier(imported_payload.get("account"))
            or any(
                is_test_account_identifier(record.get("account"))
                or is_test_account_identifier(
                    record.get("source", {}).get("account")
                    if isinstance(record.get("source"), dict)
                    else ""
                )
                for record in imported_records
            )
        )
        if has_test_account:
            raise ValueError(
                "Refusing to persist an IBKR test-fixture account into the investment store."
            )

        def normalize_payload(payload: dict[str, Any]) -> dict[str, Any]:
            return cast(dict[str, Any], normalize_investment_payload_tickers(payload))

        def update_store(updater):
            return cast(
                dict[str, Any],
                update_investment_store_payload(updater, INVESTMENT_STORE_PATH),
            )

        existing_source_artifact_storage_keys = investment_source_artifact_storage_keys(
            load_investment_store_payload(INVESTMENT_STORE_PATH)
        )

        return commit_investment_import(
            imported_payload,
            normalize_payload=normalize_payload,
            merge_payloads=lambda current, incoming: merge_investment_payloads(
                current,
                incoming,
                hsbc_dividend_action_loader=load_local_investment_dividend_actions,
            ),
            update_store=update_store,
            load_store=load_normalized_investment_payload,
            invalidate_cache=invalidate_investment_transactions_cache,
            materialize_payload=lambda payload: materialize_investment_source_artifacts(
                payload,
                INVESTMENT_STORE_PATH,
                allow_missing_storage_keys=existing_source_artifact_storage_keys,
            ),
            verify_persisted_payload=lambda payload: verify_investment_source_artifacts(
                payload,
                INVESTMENT_STORE_PATH,
                allow_missing_storage_keys=existing_source_artifact_storage_keys,
            ),
        )

    def refresh_investment_import_price_caches(
        imported_payload: dict[str, Any],
    ) -> list[str]:
        try:
            return ensure_latest_investment_daily_caches(
                exclude_configured_money_market_tickers(
                    extract_open_investment_tickers(imported_payload)
                )
            )
        except Exception:  # noqa: BLE001
            LOGGER.exception("Investment import price-cache refresh failed")
            return [
                "Price cache refresh failed after import. Retry it from Local Market Store."
            ]

    def load_local_investment_dividend_actions(
        tickers: set[str],
    ) -> dict[str, list[dict[str, str]]]:
        actions: dict[str, list[dict[str, str]]] = {}
        for ticker in sorted(tickers):
            path = history_store_path_for(ticker)
            if not path.exists():
                raise FileNotFoundError(
                    f"Local dividend history is unavailable for {ticker}."
                )
            try:
                dataset = pd.read_parquet(path, columns=["Date", "Dividends"])
            except Exception as exc:
                raise RuntimeError(
                    f"Local dividend history could not be read for {ticker}."
                ) from exc
            dividend_values = pd.to_numeric(
                dataset["Dividends"], errors="coerce"
            ).fillna(0.0)
            ticker_actions = [
                {
                    "date": pd.Timestamp(row_date).date().isoformat(),
                    "dividend_per_share": str(dividend_value),
                }
                for row_date, dividend_value in zip(dataset["Date"], dividend_values)
                if float(dividend_value) > 0
            ]
            if ticker_actions:
                actions[ticker] = ticker_actions
        return actions

    def build_investment_section_freshness(payload: dict[str, Any]) -> dict[str, Any]:
        return {
            "scope": "section",
            "target_trading_day": latest_completed_nyse_trading_day().strftime(
                "%Y-%m-%d"
            ),
            "open_tickers": sorted(
                exclude_configured_money_market_tickers(
                    extract_open_investment_tickers(payload)
                )
            ),
        }

    def build_investment_fx_rate_history_payload(
        transactions: list[dict[str, Any]],
    ) -> dict[str, dict[str, Any]]:
        """Build local-currency-per-USD daily rates for the investment frontend."""
        transaction_currencies = {
            str(transaction.get("currency") or "").strip().upper()
            for transaction in (transactions if isinstance(transactions, list) else [])
        }
        requested_currencies: list[str] = []
        if "HKD" in transaction_currencies:
            requested_currencies.append("HKD")
        if transaction_currencies.intersection({"CNY", "CNH", "RMB"}):
            requested_currencies.append("CNY")
        if not requested_currencies:
            return {}

        parsed_dates: list[pd.Timestamp] = []
        for transaction in transactions if isinstance(transactions, list) else []:
            parsed = pd.to_datetime(transaction.get("date"), errors="coerce")
            if pd.isna(parsed):
                continue
            parsed_timestamp = pd.Timestamp(parsed)
            if parsed_timestamp.tzinfo is not None:
                parsed_timestamp = parsed_timestamp.tz_convert(
                    "America/New_York"
                ).tz_localize(None)
            parsed_dates.append(parsed_timestamp.normalize())

        end_date = pd.Timestamp.now(tz="America/New_York").tz_localize(None).normalize()
        start_date = min(parsed_dates) if parsed_dates else end_date
        if start_date > end_date:
            start_date = end_date

        payload: dict[str, dict[str, Any]] = {}
        for currency in requested_currencies:
            try:
                history = fetch_usd_exchange_rate_history(
                    currency, start_date, end_date
                )
            except Exception as exc:  # noqa: BLE001
                LOGGER.warning(
                    "Unable to build investment %s FX history: %s", currency, exc
                )
                continue

            history = history.copy()
            history["Date"] = pd.to_datetime(
                history["Date"], errors="coerce"
            ).dt.normalize()
            history = history.loc[
                history["Date"].notna()
                & (history["Date"] >= start_date)
                & (history["Date"] <= end_date)
            ]
            values: dict[str, float] = {}
            for row in history.itertuples(index=False):
                row_date = pd.to_datetime(getattr(row, "Date", None), errors="coerce")
                usd_per_unit = pd.to_numeric(
                    getattr(row, "UsdPerUnit", None), errors="coerce"
                )
                if (
                    pd.isna(row_date)
                    or pd.isna(usd_per_unit)
                    or float(usd_per_unit) <= 0
                ):
                    continue
                normalized_date = pd.Timestamp(row_date)
                if normalized_date.tzinfo is not None:
                    normalized_date = normalized_date.tz_convert(
                        "America/New_York"
                    ).tz_localize(None)
                values[normalized_date.date().isoformat()] = 1.0 / float(usd_per_unit)
            if values:
                dates = sorted(values)
                payload[currency] = {
                    "dates": dates,
                    "values": {date: values[date] for date in dates},
                }

        # Yahoo has a CNY history but no separate CNH mapping in this project.
        # Use it as the RMB fallback; transaction- or statement-specific rates
        # are applied later by the frontend and therefore remain authoritative.
        if (
            "CNY" in payload
            and "CNH" in transaction_currencies
            and "CNH" not in payload
        ):
            payload["CNH"] = {
                "dates": list(payload["CNY"]["dates"]),
                "values": dict(payload["CNY"]["values"]),
            }
        return payload

    def collect_investment_display_tickers(
        transactions: list[dict[str, Any]],
    ) -> list[str]:
        tickers: list[str] = []
        seen: set[str] = set()
        excluded_types = {"forex_trade", "forex_trade_component", "fx_translation_pnl"}
        for txn in transactions:
            ticker = str(txn.get("ticker") or "").strip().upper()
            if not ticker:
                continue
            normalized_type = str(txn.get("type") or "").replace(" ", "_").lower()
            if normalized_type in excluded_types or ticker in seen:
                continue
            seen.add(ticker)
            tickers.append(ticker)
        return tickers

    def resolve_money_market_company_name(
        ticker: str,
        transactions: list[dict[str, Any]],
    ) -> str | None:
        if (
            not is_configured_money_market_ticker(ticker)
            or not money_market_name_from_description
        ):
            return None

        preferred_transaction_types = {"buy", "sell"}
        fallback_candidate = None
        for txn in transactions:
            if canonicalize_money_market_ticker(
                txn.get("ticker")
            ) != canonicalize_money_market_ticker(ticker):
                continue
            description = " ".join(str(txn.get("description") or "").split()).strip()
            if not description:
                continue
            description_upper = description.upper()
            if money_market_description_keywords and not any(
                keyword in description_upper
                for keyword in money_market_description_keywords
            ):
                continue
            normalized_type = str(txn.get("type") or "").replace(" ", "_").lower()
            if normalized_type in preferred_transaction_types:
                return description
            if fallback_candidate is None:
                fallback_candidate = description
        return fallback_candidate

    def load_investment_realtime_quotes(
        open_tickers: list[str] | set[str] | tuple[str, ...],
    ) -> list[dict[str, object]]:
        requested_tickers = list(
            dict.fromkeys(
                str(ticker).strip().upper()
                for ticker in (open_tickers or [])
                if str(ticker or "").strip()
            )
        )
        requested_tickers = exclude_configured_money_market_tickers(requested_tickers)
        if not requested_tickers:
            return []
        cache_key = tuple(sorted(requested_tickers))
        now_monotonic = time.monotonic()
        with investment_realtime_quote_cache_lock:
            cached_entry = investment_realtime_quote_cache.get(cache_key)
            if (
                cached_entry is not None
                and now_monotonic - cached_entry[0]
                <= INVESTMENT_REALTIME_QUOTE_TTL_SECONDS
            ):
                return [dict(item) for item in cached_entry[1]]
        # Prefer configured Longbridge live quotes during supported US sessions.
        # Batch yfinance requests recover only the unresolved tickers, preserving
        # Longbridge as the authoritative source whenever it returned a quote.
        quotes = fetch_longbridge_realtime_quotes(requested_tickers)
        resolved_tickers = {
            str(item.get("ticker") or "").strip().upper() for item in quotes
        }
        unresolved_tickers = [
            ticker for ticker in requested_tickers if ticker not in resolved_tickers
        ]
        if unresolved_tickers:
            for quote in fetch_yfinance_realtime_quotes(unresolved_tickers):
                quote_ticker = str(quote.get("ticker") or "").strip().upper()
                if quote_ticker and quote_ticker not in resolved_tickers:
                    quotes.append(quote)
                    resolved_tickers.add(quote_ticker)
        resolved_tickers = {
            str(item.get("ticker") or "").strip().upper() for item in quotes
        }
        if resolved_tickers.issuperset(requested_tickers):
            with investment_realtime_quote_cache_lock:
                investment_realtime_quote_cache[cache_key] = (
                    time.monotonic(),
                    [dict(item) for item in quotes],
                )
        return quotes

    def build_investment_ticker_profiles(
        transactions: list[dict[str, Any]],
        open_tickers: list[str] | set[str] | tuple[str, ...],
    ) -> dict[str, dict[str, str]]:
        open_ticker_set = {
            normalize_ticker_input(str(ticker))
            for ticker in open_tickers
            if str(ticker or "").strip()
        }
        ticker_profiles: dict[str, dict[str, str]] = {}
        for raw_ticker in collect_investment_display_tickers(transactions):
            company_name, logo_url = resolve_ticker_identity_snapshot(
                raw_ticker,
                allow_remote_refresh=(
                    raw_ticker in open_ticker_set
                    and not is_configured_money_market_ticker(raw_ticker)
                ),
            )
            if company_name == raw_ticker:
                known_company_name = resolve_known_ticker_company_name(raw_ticker)
                if known_company_name:
                    company_name = known_company_name
            if company_name == raw_ticker:
                inferred_money_market_name = resolve_money_market_company_name(
                    raw_ticker, transactions
                )
                if inferred_money_market_name:
                    company_name = inferred_money_market_name
            profile_entry = {
                "ticker": raw_ticker,
                "company_name": company_name,
                "logo_url": logo_url,
            }
            ticker_profiles[raw_ticker] = profile_entry
            if raw_ticker.endswith(".US"):
                bare_ticker = raw_ticker[:-3].strip()
                if bare_ticker and bare_ticker not in ticker_profiles:
                    ticker_profiles[bare_ticker] = {
                        **profile_entry,
                        "ticker": bare_ticker,
                    }
        propagate_investment_lineage_identity_profiles(ticker_profiles)
        return ticker_profiles

    def iter_investment_store_ticker_aliases(ticker: str) -> list[str]:
        return investment_ticker_store_aliases(ticker)

    def resolve_investment_history_store_path(
        ticker: str,
        *,
        interval: str = "1d",
        include_proxy: bool = True,
    ) -> Path | None:
        alias_candidates = (
            iter_investment_store_ticker_aliases(ticker)
            if include_proxy
            else investment_ticker_identity_store_aliases(ticker)
        )
        for candidate in alias_candidates:
            path = (
                intraday_history_store_path_for(candidate, interval)
                if interval == "1m"
                else history_store_path_for(candidate)
            )
            if path.exists() and path.stat().st_size > 0:
                return path
        return None

    def load_price_history_series(path: Path) -> list[dict[str, Any]]:
        dataset = pd.read_parquet(path, columns=["Date", "Close"])
        dataset = dataset.assign(
            _parsed_date=pd.to_datetime(dataset["Date"], errors="coerce"),
            _parsed_close=pd.to_numeric(dataset["Close"], errors="coerce"),
        )
        dataset = dataset.loc[
            dataset["_parsed_date"].notna()
            & dataset["_parsed_close"].notna()
            & (dataset["_parsed_close"] > 0)
        ].sort_values(["_parsed_date", "_parsed_close"], kind="mergesort")
        prices_by_date: dict[str, float] = {}
        for date_val, close_val in dataset[
            ["_parsed_date", "_parsed_close"]
        ].itertuples(index=False, name=None):
            if pd.isna(date_val) or pd.isna(close_val) or not float(close_val) > 0:
                continue
            date_str = pd.Timestamp(date_val).date().isoformat()
            # The lowest valid close is a deterministic tie-breaker for
            # duplicate provider prints, independent of parquet row order.
            prices_by_date.setdefault(date_str, float(close_val))
        return [
            {"date": date_str, "close": prices_by_date[date_str]}
            for date_str in sorted(prices_by_date)
        ]

    def get_investment_earliest_ticker_dates(
        transactions: list[dict[str, Any]],
    ) -> dict[str, str]:
        earliest_dates: dict[str, str] = {}
        for transaction in transactions:
            ticker = str(transaction.get("ticker") or "").strip().upper()
            if not ticker:
                continue
            normalized_type = (
                str(transaction.get("type") or "").replace(" ", "_").lower()
            )
            if normalized_type in {
                "forex_trade",
                "forex_trade_component",
                "fx_translation_pnl",
            }:
                continue
            parsed_date = pd.to_datetime(transaction.get("date"), errors="coerce")
            if pd.isna(parsed_date):
                continue
            ledger_date = parsed_date.date().isoformat()
            if ticker not in earliest_dates or ledger_date < earliest_dates[ticker]:
                earliest_dates[ticker] = ledger_date
        return earliest_dates

    def load_investment_price_histories(
        transactions: list[dict[str, Any]],
        *,
        open_tickers: list[str] | set[str] | tuple[str, ...] | None = None,
    ) -> tuple[dict[str, list[dict[str, Any]]], list[dict[str, str]]]:
        price_history_by_ticker: dict[str, list[dict[str, Any]]] = {}
        failures: list[dict[str, str]] = []
        earliest_ticker_dates = get_investment_earliest_ticker_dates(transactions)
        open_ticker_set = {
            normalize_ticker_input(str(ticker))
            for ticker in (open_tickers or [])
            if str(ticker or "").strip()
        }
        for ticker in collect_investment_display_tickers(transactions):
            if is_configured_money_market_ticker(ticker):
                continue
            try:
                path = resolve_investment_history_store_path(
                    ticker, include_proxy=False
                )
                should_refresh_live_cache = ticker in open_ticker_set
                if path is None:
                    failures.append(
                        {
                            "ticker": ticker,
                            "reason": "missing_store",
                            "message": (
                                f"No local market history is available for {ticker}."
                                if should_refresh_live_cache
                                else f"No cached market history is available for the closed position {ticker}; ledger trade prices will be used instead."
                            ),
                        }
                    )
                    continue
                prices = load_price_history_series(path)
                if not prices:
                    failures.append(
                        {
                            "ticker": ticker,
                            "reason": "empty_store",
                            "message": f"No closing-price rows are available for {ticker}.",
                        }
                    )
                    continue
                earliest_required_date = earliest_ticker_dates.get(ticker)
                first_available_date = prices[0]["date"]
                if (
                    earliest_required_date
                    and first_available_date > earliest_required_date
                ):
                    refresh_ticker = path.stem
                    try:
                        refresh_history_store(refresh_ticker, force_full=True)
                        refreshed_path = (
                            resolve_investment_history_store_path(
                                ticker,
                                include_proxy=False,
                            )
                            or path
                        )
                        refreshed_prices = load_price_history_series(refreshed_path)
                        if refreshed_prices:
                            prices = refreshed_prices
                            first_available_date = prices[0]["date"]
                    except Exception as exc:  # noqa: BLE001
                        LOGGER.warning(
                            "Unable to repair incomplete investment history coverage for %s: %s",
                            ticker,
                            exc,
                        )
                    if first_available_date > earliest_required_date:
                        failures.append(
                            {
                                "ticker": ticker,
                                "reason": "incomplete_coverage",
                                "message": (
                                    f"Local market history for {ticker} begins on {first_available_date}, "
                                    f"after the earliest ledger date requiring valuation {earliest_required_date}; "
                                    "historical equity remains unavailable before the first usable close."
                                ),
                            }
                        )
                price_history_by_ticker[ticker] = prices
            except Exception:  # noqa: BLE001
                LOGGER.exception("Could not read local market history for %s", ticker)
                failures.append(
                    {
                        "ticker": ticker,
                        "reason": "read_failed",
                        "message": f"Could not read local market history for {ticker}.",
                    }
                )
        return price_history_by_ticker, failures

    _cached_backtest: dict[str, tuple] = {}

    return {
        "_cached_backtest": _cached_backtest,
        "annotate_date_constraint_availability": annotate_date_constraint_availability,
        "app_meta": app_meta,
        "apply_no_store_headers": apply_no_store_headers,
        "base_labels": base_labels,
        "build_file_fingerprint": build_file_fingerprint,
        "build_investment_fx_rate_history_payload": build_investment_fx_rate_history_payload,
        "build_investment_price_store_fingerprints": build_investment_price_store_fingerprints,
        "build_investment_section_freshness": build_investment_section_freshness,
        "build_investment_ticker_profiles": build_investment_ticker_profiles,
        "build_one_day_intraday_date_constraint_payload": build_one_day_intraday_date_constraint_payload,
        "build_short_intraday_date_constraint_payload": build_short_intraday_date_constraint_payload,
        "canonicalize_money_market_ticker": canonicalize_money_market_ticker,
        "chart_config": chart_config,
        "collect_investment_display_tickers": collect_investment_display_tickers,
        "configured_money_market_quote_currencies": configured_money_market_quote_currencies,
        "configured_money_market_tickers": configured_money_market_tickers,
        "date_constraint_payload_to_json": date_constraint_payload_to_json,
        "defaults": defaults,
        "ensure_investment_transactions_cache_dir": ensure_investment_transactions_cache_dir,
        "exclude_configured_money_market_tickers": exclude_configured_money_market_tickers,
        "fetch_request_compare_one_day_overnight_history": fetch_request_compare_one_day_overnight_history,
        "format_compare_intraday_market_local_display_range": format_compare_intraday_market_local_display_range,
        "get_cash_equivalent_tickers": get_cash_equivalent_tickers,
        "get_investment_earliest_ticker_dates": get_investment_earliest_ticker_dates,
        "invalidate_investment_transactions_cache": invalidate_investment_transactions_cache,
        "investment_realtime_quote_cache": investment_realtime_quote_cache,
        "investment_realtime_quote_cache_lock": investment_realtime_quote_cache_lock,
        "investment_settings": investment_settings,
        "is_configured_money_market_ticker": is_configured_money_market_ticker,
        "iter_investment_store_ticker_aliases": iter_investment_store_ticker_aliases,
        "live_trading_api_authorization_failure_response": live_trading_api_authorization_failure_response,
        "live_trading_pin": live_trading_pin,
        "load_investment_price_histories": load_investment_price_histories,
        "load_investment_realtime_quotes": load_investment_realtime_quotes,
        "load_local_investment_dividend_actions": load_local_investment_dividend_actions,
        "load_normalized_investment_payload": load_normalized_investment_payload,
        "load_price_history_series": load_price_history_series,
        "logos": logos,
        "lstm_training_manager": lstm_training_manager,
        "market_local_trading_dates_frame": market_local_trading_dates_frame,
        "merge_and_write_investment_payload": merge_and_write_investment_payload,
        "money_market_description_keywords": money_market_description_keywords,
        "money_market_name_from_description": money_market_name_from_description,
        "money_market_settings": money_market_settings,
        "normalize_loaded_investment_payload": normalize_loaded_investment_payload,
        "price_field_training_manager": price_field_training_manager,
        "quote_profile_to_json": quote_profile_to_json,
        "read_investment_transactions_cache": read_investment_transactions_cache,
        "refresh_investment_import_price_caches": refresh_investment_import_price_caches,
        "resolve_compare_axis_trading_date": resolve_compare_axis_trading_date,
        "resolve_investment_history_store_path": resolve_investment_history_store_path,
        "resolve_money_market_company_name": resolve_money_market_company_name,
        "settings": settings,
        "theme": theme,
        "theme_dark": theme_dark,
        "theme_light": theme_light,
        "theme_settings": theme_settings,
        "write_investment_transactions_cache": write_investment_transactions_cache,
    }
