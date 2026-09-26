"""Build the investment mutations web-runtime context.

Code version: v0.2.1
"""

from __future__ import annotations


def build_investment_mutation_context(context: dict[str, object]) -> dict[str, object]:
    INVESTMENT_STORE_PATH = context["INVESTMENT_STORE_PATH"]

    LOGGER = context["LOGGER"]

    apply_no_store_headers = context["apply_no_store_headers"]

    build_investment_internal_transfer_binding_index = context[
        "build_investment_internal_transfer_binding_index"
    ]

    build_investment_section_freshness = context["build_investment_section_freshness"]

    cast = context["cast"]

    datetime = context["datetime"]

    ensure_latest_investment_daily_caches = context[
        "ensure_latest_investment_daily_caches"
    ]

    fetch_history = context["fetch_history"]

    invalidate_investment_transactions_cache = context[
        "invalidate_investment_transactions_cache"
    ]

    investment_store_exists = context["investment_store_exists"]

    is_configured_money_market_ticker = context["is_configured_money_market_ticker"]

    jsonify = context["jsonify"]

    load_normalized_investment_payload = context["load_normalized_investment_payload"]

    load_price_history_series = context["load_price_history_series"]

    normalize_investment_internal_transfer_bindings = context[
        "normalize_investment_internal_transfer_bindings"
    ]

    normalize_investment_internal_transfer_ignored_source_keys = context[
        "normalize_investment_internal_transfer_ignored_source_keys"
    ]

    normalize_investment_payload_tickers = context[
        "normalize_investment_payload_tickers"
    ]

    normalize_investment_security_transfer_attributions = context[
        "normalize_investment_security_transfer_attributions"
    ]

    pd = context["pd"]

    refresh_investment_security_transfer_reconciliation = context[
        "refresh_investment_security_transfer_reconciliation"
    ]

    request = context["request"]

    resolve_investment_history_store_path = context[
        "resolve_investment_history_store_path"
    ]

    update_investment_store_payload = context["update_investment_store_payload"]

    validate_investment_browser_write_request = context[
        "validate_investment_browser_write_request"
    ]

    validate_investment_internal_transfer_binding = context[
        "validate_investment_internal_transfer_binding"
    ]

    validate_investment_security_transfer_attribution = context[
        "validate_investment_security_transfer_attribution"
    ]

    def investment_update_internal_transfer_binding():
        """Persist a manual internal-transfer binding into the local investment store."""
        try:
            security_error = validate_investment_browser_write_request(request)
            if security_error:
                response = jsonify({"success": False, "error": security_error})
                response.status_code = 403
                return apply_no_store_headers(response)
            payload = request.get_json(silent=True) or {}
            requested_source_key = str(payload.get("source_key", "")).strip()
            requested_target_key = str(payload.get("target_key", "")).strip()
            requested_action = str(payload.get("action", "")).strip().lower()
            if requested_action not in {"", "bind", "ignore", "restore"}:
                return jsonify(
                    {
                        "success": False,
                        "error": "The internal-transfer action is invalid.",
                    }
                ), 400
            if not requested_source_key:
                return jsonify(
                    {
                        "success": False,
                        "error": "A source transfer key is required.",
                    }
                ), 400
            if not investment_store_exists(INVESTMENT_STORE_PATH):
                return jsonify(
                    {
                        "success": False,
                        "error": "No local investment store exists yet.",
                    }
                ), 400

            def update_bindings(
                current_payload: dict[str, object],
            ) -> tuple[dict[str, object], dict[str, object]]:
                investment_payload = normalize_investment_payload_tickers(
                    current_payload
                )
                transactions = investment_payload.get("transactions")
                ignored_source_keys = (
                    normalize_investment_internal_transfer_ignored_source_keys(
                        investment_payload.get(
                            "manual_internal_transfer_ignored_source_keys"
                        ),
                        transactions=transactions,
                    )
                )
                if requested_action in {"ignore", "restore"}:
                    normalized_requested_source_keys = (
                        normalize_investment_internal_transfer_ignored_source_keys(
                            [requested_source_key],
                            transactions=transactions,
                        )
                    )
                    source_key = (
                        normalized_requested_source_keys[0]
                        if len(normalized_requested_source_keys) == 1
                        else requested_source_key
                    )
                    binding_index = build_investment_internal_transfer_binding_index(
                        transactions
                    )
                    if len(binding_index.get(source_key, [])) != 1:
                        raise ValueError(
                            "The source transfer key is missing or ambiguous."
                        )
                    next_bindings = normalize_investment_internal_transfer_bindings(
                        investment_payload.get("manual_internal_transfer_bindings"),
                        transactions=transactions,
                    )
                    if requested_action == "ignore":
                        next_bindings.pop(source_key, None)
                        if source_key not in ignored_source_keys:
                            ignored_source_keys.append(source_key)
                    else:
                        ignored_source_keys = [
                            key for key in ignored_source_keys if key != source_key
                        ]
                    investment_payload["manual_internal_transfer_bindings"] = (
                        next_bindings
                    )
                    investment_payload[
                        "manual_internal_transfer_ignored_source_keys"
                    ] = ignored_source_keys
                    updated_payload = (
                        refresh_investment_security_transfer_reconciliation(
                            investment_payload
                        )
                    )
                    return cast(dict[str, object], updated_payload), {
                        "manual_internal_transfer_bindings": next_bindings,
                        "manual_internal_transfer_ignored_source_keys": (
                            updated_payload.get(
                                "manual_internal_transfer_ignored_source_keys", []
                            )
                        ),
                        "summary": updated_payload.get("summary", {}),
                    }
                requested_pair = normalize_investment_internal_transfer_bindings(
                    {
                        requested_source_key: requested_target_key
                        or requested_source_key,
                    },
                    transactions=transactions,
                )
                source_key = next(iter(requested_pair), requested_source_key)
                target_key = (
                    requested_pair.get(source_key, "") if requested_target_key else ""
                )
                if requested_target_key:
                    validate_investment_internal_transfer_binding(
                        transactions,
                        source_key,
                        target_key,
                    )
                next_bindings = normalize_investment_internal_transfer_bindings(
                    investment_payload.get("manual_internal_transfer_bindings"),
                    transactions=transactions,
                )
                ignored_source_keys = [
                    key for key in ignored_source_keys if key != source_key
                ]
                if target_key:
                    for (
                        existing_source_key,
                        existing_target_key,
                    ) in next_bindings.items():
                        if (
                            existing_source_key != source_key
                            and existing_target_key == target_key
                        ):
                            raise ValueError(
                                "The selected internal-transfer counterpart is already bound to another source record. Remove that binding first."
                            )
                    next_bindings[source_key] = target_key
                else:
                    next_bindings.pop(source_key, None)
                investment_payload["manual_internal_transfer_bindings"] = next_bindings
                investment_payload["manual_internal_transfer_ignored_source_keys"] = (
                    ignored_source_keys
                )
                updated_payload = refresh_investment_security_transfer_reconciliation(
                    investment_payload
                )
                return cast(dict[str, object], updated_payload), {
                    "manual_internal_transfer_bindings": next_bindings,
                    "manual_internal_transfer_ignored_source_keys": (
                        updated_payload.get(
                            "manual_internal_transfer_ignored_source_keys", []
                        )
                    ),
                    "summary": updated_payload.get("summary", {}),
                    "broker_summaries": updated_payload.get(
                        "broker_summaries", {}
                    ),
                }

            update_result = cast(
                dict[str, object],
                update_investment_store_payload(update_bindings, INVESTMENT_STORE_PATH),
            )
            invalidate_investment_transactions_cache()
            return jsonify(
                {
                    "success": True,
                    "manual_internal_transfer_bindings": update_result.get(
                        "manual_internal_transfer_bindings", {}
                    ),
                    "manual_internal_transfer_ignored_source_keys": update_result.get(
                        "manual_internal_transfer_ignored_source_keys", []
                    ),
                    "summary": update_result.get("summary", {}),
                    "broker_summaries": update_result.get(
                        "broker_summaries", {}
                    ),
                }
            )
        except ValueError as exc:
            return jsonify(
                {
                    "success": False,
                    "error": str(exc),
                }
            ), 400
        except Exception:  # noqa: BLE001
            LOGGER.exception("Unable to update internal transfer binding")
            return jsonify(
                {
                    "success": False,
                    "error": "Unable to update the internal transfer binding. Try again later.",
                }
            ), 500

    def investment_update_security_transfer_attribution():
        """Persist a user-attested source account for one Schwab receipt only."""
        try:
            security_error = validate_investment_browser_write_request(request)
            if security_error:
                response = jsonify({"success": False, "error": security_error})
                response.status_code = 403
                return apply_no_store_headers(response)
            request_payload = request.get_json(silent=True) or {}
            requested_receipt_key = str(request_payload.get("receipt_key", "")).strip()
            raw_source_broker = str(request_payload.get("source_broker", "")).strip()
            raw_source_account = str(request_payload.get("source_account", "")).strip()
            if not requested_receipt_key:
                return jsonify(
                    {
                        "success": False,
                        "error": "A Schwab transfer receipt key is required.",
                    }
                ), 400
            if bool(raw_source_broker) != bool(raw_source_account):
                return jsonify(
                    {
                        "success": False,
                        "error": "Select both a source broker and a source account, or clear the attribution.",
                    }
                ), 400
            if not investment_store_exists(INVESTMENT_STORE_PATH):
                return jsonify(
                    {
                        "success": False,
                        "error": "No local investment store exists yet.",
                    }
                ), 400

            def update_attributions(
                current_payload: dict[str, object],
            ) -> tuple[dict[str, object], dict[str, object]]:
                investment_payload = normalize_investment_payload_tickers(
                    current_payload
                )
                transactions = investment_payload.get("transactions")
                next_attributions = normalize_investment_security_transfer_attributions(
                    investment_payload.get("manual_security_transfer_attributions"),
                    transactions=transactions,
                )
                if raw_source_broker:
                    validate_investment_security_transfer_attribution(
                        transactions,
                        requested_receipt_key,
                        raw_source_broker,
                        raw_source_account,
                        existing_attributions=next_attributions,
                    )
                    next_attributions[requested_receipt_key] = {
                        "schema_version": "1",
                        "source_broker": raw_source_broker,
                        "source_account": raw_source_account,
                        "attested_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                    }
                else:
                    next_attributions.pop(requested_receipt_key, None)
                investment_payload["manual_security_transfer_attributions"] = (
                    next_attributions
                )
                updated_payload = refresh_investment_security_transfer_reconciliation(
                    investment_payload
                )
                return cast(dict[str, object], updated_payload), {
                    "manual_security_transfer_attributions": updated_payload.get(
                        "manual_security_transfer_attributions", {}
                    ),
                    "summary": updated_payload.get("summary", {}),
                }

            update_result = cast(
                dict[str, object],
                update_investment_store_payload(
                    update_attributions,
                    INVESTMENT_STORE_PATH,
                ),
            )
            invalidate_investment_transactions_cache()
            return jsonify(
                {
                    "success": True,
                    "manual_security_transfer_attributions": update_result.get(
                        "manual_security_transfer_attributions", {}
                    ),
                    "summary": update_result.get("summary", {}),
                }
            )
        except ValueError as exc:
            return jsonify(
                {
                    "success": False,
                    "error": str(exc),
                }
            ), 400
        except Exception:  # noqa: BLE001
            LOGGER.exception("Unable to update Schwab transfer attribution")
            return jsonify(
                {
                    "success": False,
                    "error": "Unable to update the Schwab transfer attribution. Try again later.",
                }
            ), 500

    def investment_get_latest_price():
        """Get the latest closing price for a ticker from local market store."""
        ticker = request.args.get("ticker", "").strip().upper()
        if not ticker:
            response = jsonify({"success": False, "error": "No ticker provided"})
            response.status_code = 400
            return apply_no_store_headers(response)

        try:
            path = resolve_investment_history_store_path(ticker)
            if path is None:
                response = jsonify(
                    {"success": False, "error": f"No local data for {ticker}"}
                )
                response.status_code = 404
                return apply_no_store_headers(response)

            df = pd.read_parquet(path)
            if df.empty or "Close" not in df.columns:
                response = jsonify(
                    {"success": False, "error": f"No price data for {ticker}"}
                )
                response.status_code = 404
                return apply_no_store_headers(response)

            # Get the latest close price (last row)
            latest_row = df.sort_values("Date").iloc[-1]
            latest_close = float(latest_row["Close"])
            latest_date = (
                str(latest_row["Date"].date())
                if hasattr(latest_row["Date"], "date")
                else str(latest_row["Date"])
            )

            response = jsonify(
                {
                    "success": True,
                    "ticker": ticker,
                    "latest_close": latest_close,
                    "latest_date": latest_date,
                }
            )
            return apply_no_store_headers(response)
        except Exception:  # noqa: BLE001
            LOGGER.exception("Unable to load the latest local price for %s", ticker)
            response = jsonify(
                {
                    "success": False,
                    "error": f"Unable to load the latest local price for {ticker}. Try again later.",
                }
            )
            response.status_code = 500
            return apply_no_store_headers(response)

    def investment_get_parquet():
        """Get all date -> close price mappings from the parquet file for a ticker."""
        ticker = request.args.get("ticker", "").strip().upper()
        if not ticker:
            response = jsonify({"success": False, "error": "No ticker provided"})
            response.status_code = 400
            return apply_no_store_headers(response)

        try:
            path = resolve_investment_history_store_path(ticker)
            freshness_scope = request.args.get("freshness_scope", "").strip().lower()
            section_freshness = build_investment_section_freshness(
                load_normalized_investment_payload()
            )
            should_refresh_ticker = ticker in set(
                section_freshness["open_tickers"]
            ) and not is_configured_money_market_ticker(ticker)
            if path is None:
                if not should_refresh_ticker:
                    response = jsonify(
                        {"success": False, "error": f"No local data for {ticker}"}
                    )
                    response.status_code = 404
                    return apply_no_store_headers(response)
                fetch_history(ticker, include_dividends=False)
                path = resolve_investment_history_store_path(ticker)
            else:
                if should_refresh_ticker:
                    ensure_latest_investment_daily_caches([ticker])
                    path = resolve_investment_history_store_path(ticker) or path

            if path is None:
                response = jsonify(
                    {"success": False, "error": f"No local data for {ticker}"}
                )
                response.status_code = 404
                return apply_no_store_headers(response)
            prices = load_price_history_series(path)
            if not prices:
                response = jsonify(
                    {"success": False, "error": f"No price/date data for {ticker}"}
                )
                response.status_code = 404
                return apply_no_store_headers(response)

            response = jsonify(
                {
                    "success": True,
                    "ticker": ticker,
                    "prices": prices,
                    "count": len(prices),
                    "freshness_scope": freshness_scope or "ticker",
                    "target_trading_day": section_freshness["target_trading_day"]
                    if freshness_scope == "section"
                    else "",
                }
            )
            return apply_no_store_headers(response)
        except Exception:  # noqa: BLE001
            LOGGER.exception("Unable to load local price history for %s", ticker)
            response = jsonify(
                {
                    "success": False,
                    "error": f"Unable to load local price history for {ticker}. Try again later.",
                }
            )
            response.status_code = 500
            return apply_no_store_headers(response)

    def normalize_investment_intraday_ohlc(dataset: pd.DataFrame) -> pd.DataFrame:
        """Keep only positive, structurally valid OHLC bars at the API boundary."""
        price_columns = ["Open", "High", "Low", "Close"]
        if not all(column in dataset.columns for column in ["Date", *price_columns]):
            return dataset.iloc[0:0].copy()
        normalized = dataset.copy()
        normalized["Date"] = pd.to_datetime(normalized["Date"], errors="coerce")
        normalized[price_columns] = normalized[price_columns].apply(
            pd.to_numeric, errors="coerce"
        )
        normalized = normalized.dropna(subset=["Date", *price_columns])
        positive_prices = (normalized[price_columns] > 0).all(axis=1)
        valid_structure = (
            (normalized["High"] >= normalized["Open"])
            & (normalized["High"] >= normalized["Close"])
            & (normalized["Low"] <= normalized["Open"])
            & (normalized["Low"] <= normalized["Close"])
            & (normalized["High"] >= normalized["Low"])
        )
        return normalized.loc[positive_prices & valid_structure].sort_values("Date")

    return {
        "investment_get_latest_price": investment_get_latest_price,
        "investment_get_parquet": investment_get_parquet,
        "investment_update_internal_transfer_binding": investment_update_internal_transfer_binding,
        "investment_update_security_transfer_attribution": investment_update_security_transfer_attribution,
        "normalize_investment_intraday_ohlc": normalize_investment_intraday_ohlc,
    }
