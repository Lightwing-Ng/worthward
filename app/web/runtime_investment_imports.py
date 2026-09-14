"""Build the investment imports web-runtime context.

Code version: v0.1.0
"""

from __future__ import annotations


def build_investment_import_context(context: dict[str, object]) -> dict[str, object]:
    Any = context["Any"]

    BytesIO = context["BytesIO"]

    INVESTMENT_STORE_PATH = context["INVESTMENT_STORE_PATH"]

    INVESTMENT_TRANSACTIONS_CACHE_SCHEMA_VERSION = context[
        "INVESTMENT_TRANSACTIONS_CACHE_SCHEMA_VERSION"
    ]

    LOGGER = context["LOGGER"]

    MAX_INVESTMENT_IMPORT_REQUEST_MIB = context["MAX_INVESTMENT_IMPORT_REQUEST_MIB"]

    RequestEntityTooLarge = context["RequestEntityTooLarge"]

    STANDARD_INVESTMENT_EXPORT_FILENAME = context["STANDARD_INVESTMENT_EXPORT_FILENAME"]

    ZIRCON_HK_MAX_TRANSACTION_ROWS = context["ZIRCON_HK_MAX_TRANSACTION_ROWS"]

    ZIRCON_HK_TEMPLATE_FILENAME = context["ZIRCON_HK_TEMPLATE_FILENAME"]

    apply_no_store_headers = context["apply_no_store_headers"]

    build_file_fingerprint = context["build_file_fingerprint"]

    build_investment_fx_rate_history_payload = context[
        "build_investment_fx_rate_history_payload"
    ]

    build_investment_price_store_fingerprints = context[
        "build_investment_price_store_fingerprints"
    ]

    build_investment_section_freshness = context["build_investment_section_freshness"]

    build_investment_ticker_profiles = context["build_investment_ticker_profiles"]

    build_standard_investment_xlsx = context["build_standard_investment_xlsx"]

    build_trade_path = context["build_trade_path"]

    build_zircon_hk_template_xlsx = context["build_zircon_hk_template_xlsx"]

    configured_money_market_quote_currencies = context[
        "configured_money_market_quote_currencies"
    ]

    configured_money_market_tickers = context["configured_money_market_tickers"]

    ensure_latest_investment_daily_caches = context[
        "ensure_latest_investment_daily_caches"
    ]

    get_cash_equivalent_tickers = context["get_cash_equivalent_tickers"]

    invalidate_investment_transactions_cache = context[
        "invalidate_investment_transactions_cache"
    ]

    investment_store_exists = context["investment_store_exists"]

    investment_store_path_for = context["investment_store_path_for"]

    investment_ticker_lineage_payload = context["investment_ticker_lineage_payload"]

    json = context["json"]

    jsonify = context["jsonify"]

    known_ticker_company_names_payload = context["known_ticker_company_names_payload"]

    load_investment_cost_basis_method = context["load_investment_cost_basis_method"]

    load_investment_price_histories = context["load_investment_price_histories"]

    load_investment_realtime_quotes = context["load_investment_realtime_quotes"]

    load_local_investment_dividend_actions = context[
        "load_local_investment_dividend_actions"
    ]

    load_normalized_investment_payload = context["load_normalized_investment_payload"]

    merge_and_write_investment_payload = context["merge_and_write_investment_payload"]

    parse_investment_payload = context["parse_investment_payload"]

    re = context["re"]

    read_investment_transactions_cache = context["read_investment_transactions_cache"]

    redirect = context["redirect"]

    refresh_investment_import_price_caches = context[
        "refresh_investment_import_price_caches"
    ]

    report_fetch_abort_debug_event = context["report_fetch_abort_debug_event"]

    request = context["request"]

    send_file = context["send_file"]

    threading = context["threading"]

    validate_hsbc_pasted_text = context["validate_hsbc_pasted_text"]

    validate_investment_browser_write_request = context[
        "validate_investment_browser_write_request"
    ]

    write_investment_transactions_cache = context["write_investment_transactions_cache"]

    def investment_page():
        query_string = request.query_string.decode().strip()
        target_path = build_trade_path("investment")
        return redirect(
            f"{target_path}?{query_string}" if query_string else target_path
        )

    def investment_get_transactions():
        """Get all saved investment transactions from local storage."""
        report_fetch_abort_debug_event(
            "E",
            "runtime.py:investment_get_transactions",
            "investment transactions request received",
            {
                "path": request.path,
                "store_exists": investment_store_exists(INVESTMENT_STORE_PATH),
            },
        )
        if not investment_store_exists(INVESTMENT_STORE_PATH):
            invalidate_investment_transactions_cache()
            response = jsonify(
                {
                    "transactions": [],
                    "ticker_profiles": {},
                    "price_history_by_ticker": {},
                    "fx_rate_history_by_currency": {},
                    "price_history_failures": [],
                    "money_market_tickers": sorted(configured_money_market_tickers),
                    "money_market_quote_currencies": configured_money_market_quote_currencies,
                    "cash_equivalent_tickers": sorted(get_cash_equivalent_tickers()),
                    "ticker_lineage": investment_ticker_lineage_payload(),
                    "known_ticker_company_names": known_ticker_company_names_payload(),
                    "investment_cost_basis_method": load_investment_cost_basis_method(),
                    "realtime_quotes": [],
                    "section_freshness": build_investment_section_freshness({}),
                    "success": True,
                }
            )
            report_fetch_abort_debug_event(
                "E",
                "runtime.py:investment_get_transactions",
                "investment transactions returned empty store payload",
                {
                    "status": 200,
                    "transaction_count": 0,
                },
            )
            return apply_no_store_headers(response)
        try:
            investment_store_fingerprint = build_file_fingerprint(
                investment_store_path_for(INVESTMENT_STORE_PATH)
            )
            cached_data = read_investment_transactions_cache(
                investment_store_fingerprint
            )
            if cached_data is not None:
                section_freshness = cached_data.get("section_freshness", {})
                cached_data["realtime_quotes"] = load_investment_realtime_quotes(
                    section_freshness.get("open_tickers", [])
                    if isinstance(section_freshness, dict)
                    else []
                )
                cached_data["money_market_tickers"] = sorted(
                    configured_money_market_tickers
                )
                cached_data["money_market_quote_currencies"] = (
                    configured_money_market_quote_currencies
                )
                cached_data["cash_equivalent_tickers"] = sorted(
                    get_cash_equivalent_tickers()
                )
                cached_data["ticker_lineage"] = investment_ticker_lineage_payload()
                cached_data["known_ticker_company_names"] = (
                    known_ticker_company_names_payload()
                )
                cached_data["investment_cost_basis_method"] = (
                    load_investment_cost_basis_method()
                )
                cached_data["success"] = True
                cached_data["investment_store_version"] = str(
                    investment_store_fingerprint.get("mtime_ns", 0)
                )
                cached_data["investment_cache"] = {
                    "status": "hit",
                    "schema_version": INVESTMENT_TRANSACTIONS_CACHE_SCHEMA_VERSION,
                }
                response = jsonify(cached_data)
                report_fetch_abort_debug_event(
                    "E",
                    "runtime.py:investment_get_transactions",
                    "investment transactions returned cached payload",
                    {
                        "status": 200,
                        "transaction_count": len(cached_data.get("transactions", [])),
                    },
                )
                return apply_no_store_headers(response)

            data = load_normalized_investment_payload()
            section_freshness = build_investment_section_freshness(data)
            freshness_refresh_failures = ensure_latest_investment_daily_caches(
                section_freshness["open_tickers"]
            )
            investment_store_fingerprint = build_file_fingerprint(
                investment_store_path_for(INVESTMENT_STORE_PATH)
            )
            transactions = data.get("transactions", [])
            data["fx_rate_history_by_currency"] = (
                build_investment_fx_rate_history_payload(transactions)
            )
            price_history_by_ticker, price_history_failures = (
                load_investment_price_histories(
                    transactions,
                    open_tickers=section_freshness["open_tickers"],
                )
            )
            data["ticker_profiles"] = build_investment_ticker_profiles(
                transactions,
                section_freshness["open_tickers"],
            )
            data["price_history_by_ticker"] = price_history_by_ticker
            data["price_history_failures"] = price_history_failures
            data["money_market_tickers"] = sorted(configured_money_market_tickers)
            data["money_market_quote_currencies"] = (
                configured_money_market_quote_currencies
            )
            data["cash_equivalent_tickers"] = sorted(get_cash_equivalent_tickers())
            data["ticker_lineage"] = investment_ticker_lineage_payload()
            data["known_ticker_company_names"] = known_ticker_company_names_payload()
            data["investment_cost_basis_method"] = load_investment_cost_basis_method()
            data["realtime_quotes"] = load_investment_realtime_quotes(
                section_freshness["open_tickers"]
            )
            data["freshness_refresh_failures"] = freshness_refresh_failures
            data["section_freshness"] = section_freshness
            data["success"] = True
            data["investment_store_version"] = str(
                investment_store_fingerprint.get("mtime_ns", 0)
            )
            data["investment_cache"] = {
                "status": "miss",
                "schema_version": INVESTMENT_TRANSACTIONS_CACHE_SCHEMA_VERSION,
            }
            price_store_fingerprints = build_investment_price_store_fingerprints(
                transactions,
                section_freshness["open_tickers"],
            )
            if not freshness_refresh_failures:
                cacheable_data = dict(data)
                cacheable_data["realtime_quotes"] = []
                cacheable_data["investment_cache"] = {
                    "status": "stored",
                    "schema_version": INVESTMENT_TRANSACTIONS_CACHE_SCHEMA_VERSION,
                }
                write_investment_transactions_cache(
                    investment_store_fingerprint=investment_store_fingerprint,
                    price_store_fingerprints=price_store_fingerprints,
                    payload=cacheable_data,
                )
            response = jsonify(data)
            report_fetch_abort_debug_event(
                "E",
                "runtime.py:investment_get_transactions",
                "investment transactions returned success payload",
                {
                    "status": 200,
                    "transaction_count": len(transactions),
                    "freshness_refresh_failure_count": len(freshness_refresh_failures),
                    "price_history_failure_count": len(price_history_failures),
                },
            )
            return apply_no_store_headers(response)
        except Exception:  # noqa: BLE001
            LOGGER.exception("Unable to load local investment transactions")
            response = jsonify(
                {
                    "success": False,
                    "error": "Unable to load local investment transactions. Try again later.",
                }
            )
            response.status_code = 500
            report_fetch_abort_debug_event(
                "E",
                "runtime.py:investment_get_transactions",
                "investment transactions failed",
                {
                    "status": 500,
                },
            )
            return apply_no_store_headers(response)

    def investment_download_zircon_hk_template():
        """Download the typed generic fallback investment workbook."""
        response = send_file(
            BytesIO(build_zircon_hk_template_xlsx()),
            as_attachment=True,
            download_name=ZIRCON_HK_TEMPLATE_FILENAME,
            mimetype=(
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            ),
            max_age=0,
        )
        return apply_no_store_headers(response)

    def investment_export_standard_xlsx():
        """Export selected rendered ledger rows in the round-trip XLSX contract."""
        try:
            security_error = validate_investment_browser_write_request(request)
            if security_error:
                response = jsonify({"success": False, "error": security_error})
                response.status_code = 403
                return apply_no_store_headers(response)
            payload = request.get_json(silent=True)
            if not isinstance(payload, dict):
                raise ValueError("The standard XLSX export request is invalid.")
            selected_transactions = payload.get("transactions")
            if not isinstance(selected_transactions, list) or not selected_transactions:
                raise ValueError(
                    "Select at least one transaction for standard XLSX export."
                )
            if len(selected_transactions) > ZIRCON_HK_MAX_TRANSACTION_ROWS:
                raise ValueError(
                    "A standard XLSX export supports at most "
                    f"{ZIRCON_HK_MAX_TRANSACTION_ROWS:,} transactions."
                )
            if not all(
                isinstance(transaction, dict) for transaction in selected_transactions
            ):
                raise ValueError(
                    "The standard XLSX export contains an invalid transaction."
                )
            tickers = {
                str(transaction.get("ticker") or "").strip().upper()
                for transaction in selected_transactions
                if str(transaction.get("ticker") or "").strip()
            }
            filename = STANDARD_INVESTMENT_EXPORT_FILENAME
            if len(tickers) == 1:
                ticker = re.sub(r"[^A-Z0-9._-]+", "-", next(iter(tickers))).strip("-")
                if ticker:
                    filename = f"{ticker}_standard_investment_export.xlsx"
            response = send_file(
                BytesIO(build_standard_investment_xlsx(selected_transactions)),
                as_attachment=True,
                download_name=filename,
                mimetype=(
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                ),
                max_age=0,
            )
            return apply_no_store_headers(response)
        except ValueError as exc:
            response = jsonify({"success": False, "error": str(exc)})
            response.status_code = 400
            return apply_no_store_headers(response)
        except Exception:  # noqa: BLE001
            LOGGER.exception("Unable to export the standard investment workbook")
            response = jsonify(
                {
                    "success": False,
                    "error": "The standard investment workbook could not be exported.",
                }
            )
            response.status_code = 500
            return apply_no_store_headers(response)

    def investment_validate_zircon_hk_workbook():
        """Validate a generic fallback workbook without writing investment data."""
        try:
            security_error = validate_investment_browser_write_request(request)
            if security_error:
                response = jsonify({"success": False, "error": security_error})
                response.status_code = 403
                return apply_no_store_headers(response)
            workbook_file = request.files.get("zircon_hk_transactions_xlsx")
            if workbook_file is None:
                response = jsonify(
                    {
                        "success": False,
                        "error": "Please upload the completed manual investment XLSX workbook.",
                    }
                )
                response.status_code = 400
                return apply_no_store_headers(response)
            workbook_bytes = workbook_file.read()
            if not workbook_bytes:
                response = jsonify(
                    {
                        "success": False,
                        "error": "The manual investment XLSX workbook is empty.",
                    }
                )
                response.status_code = 400
                return apply_no_store_headers(response)
            imported_payload = parse_investment_payload(
                "zircon_hk",
                "manual_xlsx",
                xlsx_bytes=workbook_bytes,
                filename=str(getattr(workbook_file, "filename", "") or "").strip(),
            )
            transaction_count = len(imported_payload.get("transactions", []))
            response = jsonify(
                {
                    "success": True,
                    "message": (
                        f"Validated {transaction_count:,} manual investment "
                        f"{'transaction' if transaction_count == 1 else 'transactions'}."
                    ),
                    "transaction_count": transaction_count,
                    "summary": imported_payload.get("summary", {}),
                }
            )
            return apply_no_store_headers(response)
        except RequestEntityTooLarge:
            response = jsonify(
                {
                    "success": False,
                    "error": (
                        f"The workbook exceeds the {MAX_INVESTMENT_IMPORT_REQUEST_MIB} MiB "
                        "investment upload limit."
                    ),
                }
            )
            response.status_code = 413
            return apply_no_store_headers(response)
        except ValueError as exc:
            response = jsonify({"success": False, "error": str(exc)})
            response.status_code = 400
            return apply_no_store_headers(response)
        except Exception:  # noqa: BLE001
            LOGGER.exception("Unable to validate manual investment workbook")
            response = jsonify(
                {
                    "success": False,
                    "error": (
                        "The manual investment workbook could not be validated. "
                        "Download a fresh template and try again."
                    ),
                }
            )
            response.status_code = 500
            return apply_no_store_headers(response)

    def investment_validate_hsbc_pasted_text():
        """Validate HSBC paste content without writing ledger or evidence data."""
        try:
            security_error = validate_investment_browser_write_request(request)
            if security_error:
                response = jsonify({"success": False, "error": security_error})
                response.status_code = 403
                return apply_no_store_headers(response)
            request_payload = request.get_json(silent=True)
            if not isinstance(request_payload, dict):
                response = jsonify(
                    {
                        "success": False,
                        "error": "HSBC pasted text validation requires a JSON request body.",
                    }
                )
                response.status_code = 400
                return apply_no_store_headers(response)
            validation = validate_hsbc_pasted_text(
                portfolio_text=str(request_payload.get("portfolio_text", "") or ""),
                order_status_text=str(
                    request_payload.get("order_status_text", "") or ""
                ),
                cash_account_text=str(
                    request_payload.get("cash_account_text", "") or ""
                ),
                dividend_action_loader=load_local_investment_dividend_actions,
            )
            return apply_no_store_headers(jsonify({"success": True, **validation}))
        except RequestEntityTooLarge:
            response = jsonify(
                {
                    "success": False,
                    "error": (
                        f"The pasted HSBC text exceeds the {MAX_INVESTMENT_IMPORT_REQUEST_MIB} MiB "
                        "investment import limit."
                    ),
                }
            )
            response.status_code = 413
            return apply_no_store_headers(response)
        except ValueError as exc:
            response = jsonify({"success": False, "error": str(exc)})
            response.status_code = 400
            return apply_no_store_headers(response)
        except Exception:  # noqa: BLE001
            LOGGER.exception("Unable to validate HSBC pasted text")
            response = jsonify(
                {
                    "success": False,
                    "error": "The HSBC pasted text could not be validated. Paste the full HSBC page again.",
                }
            )
            response.status_code = 500
            return apply_no_store_headers(response)

    def investment_add_transactions():
        """Import or sync broker activity into the local investment store."""
        transactions_file = None
        positions_file = None
        try:
            security_error = validate_investment_browser_write_request(request)
            if security_error:
                response = jsonify({"success": False, "error": security_error})
                response.status_code = 403
                return apply_no_store_headers(response)
            broker = str(request.form.get("broker", "ibkr")).strip().lower() or "ibkr"
            report_fetch_abort_debug_event(
                "E",
                "runtime.py:investment_add_transactions",
                "investment import request received",
                {
                    "broker": broker,
                    "path": request.path,
                },
            )
            transactions_file = request.files.get("transactions_csv")
            positions_file = request.files.get("positions_csv")
            dry_run = False
            if broker == "ibkr":
                ibkr_import_mode = (
                    str(request.form.get("ibkr_import_mode", "csv")).strip().lower()
                )
                if ibkr_import_mode == "gainskeeper":
                    gainskeeper_files = request.files.getlist("gainskeeper_files")
                    gainskeeper_payloads: list[tuple[bytes, str]] = []
                    for gainskeeper_file in gainskeeper_files:
                        if gainskeeper_file is None:
                            continue
                        file_payload = gainskeeper_file.read()
                        if not file_payload:
                            continue
                        gainskeeper_payloads.append(
                            (
                                file_payload,
                                str(
                                    getattr(gainskeeper_file, "filename", "") or ""
                                ).strip(),
                            )
                        )
                    if not gainskeeper_payloads:
                        return jsonify(
                            {
                                "success": False,
                                "error": "Please upload at least one IBKR GainsKeeper .gkx file.",
                            }
                        ), 400
                    imported_payload = parse_investment_payload(
                        "ibkr",
                        "gainskeeper",
                        files=gainskeeper_payloads,
                    )
                    success_message = (
                        "IBKR GainsKeeper import complete. OFX/GKX records were merged idempotently, "
                        "matching CSV records were upgraded with intraday trade timestamps where available, "
                        "and exact uploaded source files were retained locally as SHA-256-verified immutable evidence."
                    )
                elif ibkr_import_mode == "web_paste":
                    trade_notifications_text = str(
                        request.form.get("ibkr_trade_notifications_text", "")
                    ).strip()
                    holdings_text = str(
                        request.form.get("ibkr_holdings_text", "")
                    ).strip()
                    trade_notifications_date = str(
                        request.form.get("ibkr_trade_notifications_date", "")
                    ).strip()
                    trade_notifications_cash = str(
                        request.form.get("ibkr_trade_notifications_cash", "")
                    ).strip()
                    trade_notifications_cash_balances = str(
                        request.form.get("ibkr_trade_notifications_cash_balances", "")
                    ).strip()
                    trade_notifications_positions = str(
                        request.form.get("ibkr_trade_notifications_positions", "")
                    ).strip()
                    trade_notifications_cash_as_of_datetime = str(
                        request.form.get(
                            "ibkr_trade_notifications_cash_as_of_datetime",
                            "",
                        )
                    ).strip()
                    if not trade_notifications_text:
                        return jsonify(
                            {
                                "success": False,
                                "error": "Please paste the IBKR Trade Notifications page text.",
                            }
                        ), 400
                    ending_cash_by_currency = None
                    if trade_notifications_cash_balances:
                        try:
                            parsed_cash_balances = json.loads(
                                trade_notifications_cash_balances
                            )
                        except json.JSONDecodeError as exc:
                            raise ValueError(
                                "The optional IBKR cash balances must be valid JSON."
                            ) from exc
                        if not isinstance(parsed_cash_balances, dict):
                            raise ValueError(
                                "The optional IBKR cash balances must be a currency-to-amount object."
                            )
                        ending_cash_by_currency = parsed_cash_balances
                    imported_payload = parse_investment_payload(
                        "ibkr",
                        "web_pasted_text",
                        trade_notifications_text=trade_notifications_text,
                        trade_date=trade_notifications_date or None,
                        holdings_text=holdings_text or None,
                        ending_cash=trade_notifications_cash or None,
                        ending_cash_by_currency=ending_cash_by_currency,
                        position_snapshot_text=trade_notifications_positions or None,
                        ending_cash_as_of_datetime=(
                            trade_notifications_cash_as_of_datetime or None
                        ),
                    )
                    success_message = (
                        "IBKR web trade notification sync complete. Filled trades were merged "
                        "idempotently as supplemental records after the available file-snapshot "
                        "cutoff; unique fills remain additive. Later matching Transaction History "
                        "CSV or GainsKeeper records replace rounded web values with authoritative "
                        "file precision. An optional user-verified post-fill cash value is retained "
                        "as an intraday boundary after the latest pasted fill. Exact pasted text is "
                        "retained locally as SHA-256-verified immutable evidence."
                    )
                    if holdings_text:
                        success_message += (
                            " The pasted Your Holdings page supplied the validated current "
                            "cash and position boundary and was retained as separate immutable evidence."
                        )
                    imported_summary = imported_payload.get("summary")
                    if (
                        isinstance(imported_summary, dict)
                        and imported_summary.get("position_snapshot_authoritative")
                        is True
                        and imported_summary.get("position_snapshot_source")
                        == ("ibkr_user_verified_app_positions")
                    ):
                        success_message += (
                            " A user-confirmed current IBKR position snapshot was retained "
                            "at the same cash boundary."
                        )
                else:
                    if transactions_file is None or positions_file is None:
                        return jsonify(
                            {
                                "success": False,
                                "error": "Please upload both the Transaction History CSV and the Realized Summary CSV.",
                            }
                        ), 400

                    transactions_payload = transactions_file.read()
                    positions_payload = positions_file.read()
                    if not transactions_payload or not positions_payload:
                        return jsonify(
                            {
                                "success": False,
                                "error": "Both CSV files must be non-empty.",
                            }
                        ), 400

                    imported_payload = parse_investment_payload(
                        "ibkr",
                        "csv",
                        transaction_csv_bytes=transactions_payload,
                        positions_csv_bytes=positions_payload,
                        transaction_filename=str(
                            getattr(transactions_file, "filename", "") or ""
                        ).strip(),
                        positions_filename=str(
                            getattr(positions_file, "filename", "") or ""
                        ).strip(),
                    )
                    success_message = (
                        "IBKR import complete. Matching records were merged incrementally into the local investment store "
                        "without clearing older data first. Exact uploaded CSV source files are retained locally as "
                        "SHA-256-verified immutable evidence."
                    )
            elif broker == "longbridge_hk":
                hk_fund_details_file = request.files.get(
                    "longbridge_hk_fund_details_txt"
                )
                hk_history_orders_file = request.files.get(
                    "longbridge_hk_history_orders_xlsx"
                )
                if hk_fund_details_file is None or hk_history_orders_file is None:
                    return jsonify(
                        {
                            "success": False,
                            "error": "Please upload both the Fund Details text file and the History Orders spreadsheet.",
                        }
                    ), 400

                hk_fund_details_bytes = hk_fund_details_file.read()
                hk_fund_details_text = hk_fund_details_bytes.decode(
                    "utf-8", errors="replace"
                )
                hk_history_orders_bytes = hk_history_orders_file.read()
                if not hk_fund_details_text.strip() or not hk_history_orders_bytes:
                    return jsonify(
                        {
                            "success": False,
                            "error": "Both Longbridge (HK) import files must be non-empty.",
                        }
                    ), 400

                imported_payload = parse_investment_payload(
                    "longbridge_hk",
                    "paired_files",
                    fund_details_text=hk_fund_details_text,
                    fund_details_bytes=hk_fund_details_bytes,
                    history_orders_xlsx_bytes=hk_history_orders_bytes,
                    fund_details_filename=str(
                        getattr(hk_fund_details_file, "filename", "") or ""
                    ).strip(),
                    history_orders_filename=str(
                        getattr(hk_history_orders_file, "filename", "") or ""
                    ).strip(),
                )
                success_message = (
                    "Longbridge (HK) import complete. Fund Details and History Orders files were parsed in memory and "
                    "merged incrementally into the local investment store without clearing older data first. Exact "
                    "uploaded files were retained locally as SHA-256-verified immutable evidence."
                )
            elif broker == "longbridge_sg":
                fund_details_file = request.files.get("longbridge_sg_fund_details_txt")
                history_orders_file = request.files.get(
                    "longbridge_sg_history_orders_xlsx"
                )
                if fund_details_file is None or history_orders_file is None:
                    return jsonify(
                        {
                            "success": False,
                            "error": "Please upload both the Fund Details text file and the History Orders spreadsheet.",
                        }
                    ), 400

                fund_details_bytes = fund_details_file.read()
                fund_details_text = fund_details_bytes.decode("utf-8", errors="replace")
                history_orders_bytes = history_orders_file.read()
                if not fund_details_text.strip() or not history_orders_bytes:
                    return jsonify(
                        {
                            "success": False,
                            "error": "Both Longbridge (SG) import files must be non-empty.",
                        }
                    ), 400

                imported_payload = parse_investment_payload(
                    "longbridge_sg",
                    "paired_files",
                    fund_details_text=fund_details_text,
                    fund_details_bytes=fund_details_bytes,
                    history_orders_xlsx_bytes=history_orders_bytes,
                    fund_details_filename=str(
                        getattr(fund_details_file, "filename", "") or ""
                    ).strip(),
                    history_orders_filename=str(
                        getattr(history_orders_file, "filename", "") or ""
                    ).strip(),
                )
                success_message = (
                    "Longbridge (SG) import complete. Fund Details and History Orders files were parsed in memory and "
                    "merged incrementally into the local investment store without clearing older data first. Exact "
                    "uploaded files were retained locally as SHA-256-verified immutable evidence."
                )
            elif broker == "futuhk":
                statement_pdf_files = request.files.getlist("futuhk_statement_pdfs")
                statement_pdf_payloads: list[tuple[bytes, str]] = []
                for statement_pdf_file in statement_pdf_files:
                    if statement_pdf_file is None:
                        continue
                    pdf_bytes = statement_pdf_file.read()
                    if not pdf_bytes:
                        continue
                    statement_pdf_payloads.append(
                        (
                            pdf_bytes,
                            str(
                                getattr(statement_pdf_file, "filename", "") or ""
                            ).strip(),
                        )
                    )
                imported_payload = parse_investment_payload(
                    "futuhk",
                    "statement_pdfs",
                    statement_pdf_payloads=statement_pdf_payloads,
                )
                success_message = (
                    "Futu (HK) import complete. Monthly statement PDFs were parsed in memory and merged "
                    "incrementally into the local investment store without clearing older data first."
                )
            elif broker == "hsbc":
                hsbc_import_mode = (
                    str(request.form.get("hsbc_import_mode", "paste")).strip().lower()
                )
                if hsbc_import_mode == "statement_pdf":
                    statement_pdf_payloads: list[tuple[bytes, str]] = []
                    for statement_pdf_file in request.files.getlist(
                        "hsbc_statement_pdfs"
                    ):
                        if statement_pdf_file is None:
                            continue
                        pdf_bytes = statement_pdf_file.read()
                        if not pdf_bytes:
                            continue
                        statement_pdf_payloads.append(
                            (
                                pdf_bytes,
                                str(
                                    getattr(statement_pdf_file, "filename", "") or ""
                                ).strip(),
                            )
                        )
                    imported_payload = parse_investment_payload(
                        "hsbc",
                        "statement_bundle",
                        statement_pdf_payloads=statement_pdf_payloads,
                    )
                    success_message = (
                        "HSBC statement import complete. Full monthly cash-account statements, or compatible "
                        "composite/investment statement pairs, were reconciled by period and account before the "
                        "committed store was read back."
                    )
                else:
                    imported_payload = parse_investment_payload(
                        "hsbc",
                        "pasted_text",
                        portfolio_text=str(
                            request.form.get("hsbc_portfolio_text", "")
                        ).strip(),
                        order_status_text=str(
                            request.form.get("hsbc_order_status_text", "")
                        ).strip(),
                        cash_account_text=str(
                            request.form.get("hsbc_cash_account_text", "")
                        ).strip(),
                        dividend_action_loader=load_local_investment_dividend_actions,
                    )
                    import_summary = (
                        imported_payload.get("summary")
                        if isinstance(imported_payload.get("summary"), dict)
                        else {}
                    )
                    if import_summary.get("hsbc_paste_import_scope") in {
                        "cash_only_non_usd",
                        "cash_only_usd",
                    }:
                        success_message = (
                            "HSBC cash-only sync complete. The pasted cash-account text was normalized and "
                            "merged incrementally without replacing the existing Portfolio position snapshot."
                        )
                    else:
                        success_message = (
                            "HSBC sync complete. The pasted cash-account, Portfolio, and Order Status text were normalized and "
                            "merged incrementally into the local investment store without "
                            "clearing older data first."
                        )
            elif broker == "schwab":
                schwab_transactions_file = request.files.get("transactions_csv")
                if schwab_transactions_file is None:
                    schwab_transactions_file = request.files.get(
                        "schwab_transactions_csv"
                    )
                schwab_positions_file = request.files.get("positions_csv")
                if schwab_positions_file is None:
                    schwab_positions_file = request.files.get("schwab_positions_csv")
                if schwab_transactions_file is None or schwab_positions_file is None:
                    return jsonify(
                        {
                            "success": False,
                            "error": "Please upload both the Schwab Transactions CSV and Positions CSV.",
                        }
                    ), 400
                schwab_transactions_payload = schwab_transactions_file.read()
                schwab_positions_payload = schwab_positions_file.read()
                if not schwab_transactions_payload or not schwab_positions_payload:
                    return jsonify(
                        {
                            "success": False,
                            "error": "The Schwab Transactions and Positions CSV files cannot be empty.",
                        }
                    ), 400
                imported_payload = parse_investment_payload(
                    "schwab",
                    "csv",
                    transaction_csv_bytes=schwab_transactions_payload,
                    positions_csv_bytes=schwab_positions_payload,
                    transaction_filename=str(
                        getattr(schwab_transactions_file, "filename", "") or ""
                    ).strip(),
                    positions_filename=str(
                        getattr(schwab_positions_file, "filename", "") or ""
                    ).strip(),
                )
                success_message = (
                    "Charles Schwab import complete. Transactions and the authoritative Positions snapshot were "
                    "merged incrementally into the local investment store without clearing older data first."
                )
            elif broker == "boc_hk" and request.files.getlist("boc_hk_statement_pdfs"):
                statement_pdf_payloads: list[tuple[bytes, str]] = []
                for statement_pdf_file in request.files.getlist(
                    "boc_hk_statement_pdfs"
                ):
                    if statement_pdf_file is None:
                        continue
                    source_filename = str(
                        getattr(statement_pdf_file, "filename", "") or ""
                    ).strip()
                    if not source_filename:
                        return jsonify(
                            {
                                "success": False,
                                "error": "Every uploaded BOCHK statement must have a non-empty filename.",
                            }
                        ), 400
                    if not source_filename.lower().endswith(".pdf"):
                        return jsonify(
                            {
                                "success": False,
                                "error": (
                                    f"The uploaded BOCHK statement '{source_filename}' must use a .pdf filename."
                                ),
                            }
                        ), 400
                    pdf_bytes = statement_pdf_file.read()
                    if not pdf_bytes:
                        return jsonify(
                            {
                                "success": False,
                                "error": (
                                    f"The uploaded BOCHK statement PDF '{source_filename}' is empty."
                                ),
                            }
                        ), 400
                    statement_pdf_payloads.append(
                        (
                            pdf_bytes,
                            source_filename,
                        )
                    )
                if not statement_pdf_payloads:
                    return jsonify(
                        {
                            "success": False,
                            "error": "Please upload at least one BOCHK Consolidated Statement PDF.",
                        }
                    ), 400
                imported_payload = parse_investment_payload(
                    "boc_hk",
                    "statement_pdfs",
                    statement_pdf_payloads=statement_pdf_payloads,
                )
                success_message = (
                    "BOCHK import complete. Consolidated Statement PDFs were parsed in memory, with each cash subaccount "
                    "and source currency preserved, then merged incrementally without clearing older data first."
                )
            elif (
                broker == "boc_hk"
                and request.files.get("zircon_hk_transactions_xlsx") is None
            ):
                return jsonify(
                    {
                        "success": False,
                        "error": "Please upload at least one BOCHK Consolidated Statement PDF.",
                    }
                ), 400
            elif broker in {
                "zircon_hk",
                "standard_xlsx",
                "cmb_cn",
                "boc_cn",
                "boc_hk",
                "icbc_cn",
                "icbc_hk",
                "ccb_cn",
                "ccb_hk",
            }:
                workbook_file = request.files.get("zircon_hk_transactions_xlsx")
                if workbook_file is None:
                    return jsonify(
                        {
                            "success": False,
                            "error": "Please upload the completed manual investment XLSX workbook.",
                        }
                    ), 400
                workbook_bytes = workbook_file.read()
                if not workbook_bytes:
                    return jsonify(
                        {
                            "success": False,
                            "error": "The manual investment XLSX workbook is empty.",
                        }
                    ), 400
                imported_payload = parse_investment_payload(
                    "zircon_hk",
                    "manual_xlsx",
                    xlsx_bytes=workbook_bytes,
                    filename=str(getattr(workbook_file, "filename", "") or "").strip(),
                )
                success_message = (
                    "Manual investment workbook import complete. Validated records were "
                    "merged incrementally into the local investment store, and the exact "
                    "uploaded XLSX was retained as SHA-256-verified immutable evidence."
                )
            elif broker in {"tigertrade", "usmart_hk"}:
                field_name = f"{broker}_statement_pdfs"
                statement_pdf_payloads: list[tuple[bytes, str]] = []
                for statement_pdf_file in request.files.getlist(field_name):
                    if statement_pdf_file is None:
                        continue
                    pdf_bytes = statement_pdf_file.read()
                    if not pdf_bytes:
                        continue
                    statement_pdf_payloads.append(
                        (
                            pdf_bytes,
                            str(
                                getattr(statement_pdf_file, "filename", "") or ""
                            ).strip(),
                        )
                    )
                if broker == "tigertrade":
                    imported_payload = parse_investment_payload(
                        "tigertrade",
                        "statement_pdfs",
                        statement_pdf_payloads=statement_pdf_payloads,
                    )
                    broker_label = "Tiger Trade"
                else:
                    imported_payload = parse_investment_payload(
                        "usmart_hk",
                        "statement_pdfs",
                        statement_pdf_payloads=statement_pdf_payloads,
                    )
                    broker_label = "uSMART (HK)"
                success_message = (
                    f"{broker_label} import complete. Statement PDFs were parsed in memory and merged "
                    "incrementally into the local investment store without clearing older data first."
                )
            else:
                return jsonify(
                    {
                        "success": False,
                        "error": f"{broker.upper()} investment import is not implemented yet.",
                    }
                ), 400

            if dry_run:
                investment_payload = imported_payload
            else:
                investment_payload = merge_and_write_investment_payload(
                    imported_payload
                )

            # Run the price cache refresh in the background (skip for dry-run)
            if not dry_run:

                def background_refresh(payload: dict[str, Any]) -> None:
                    try:
                        refresh_investment_import_price_caches(payload)
                    except Exception:  # noqa: BLE001
                        LOGGER.exception("Investment import background refresh failed")

                threading.Thread(
                    target=background_refresh, args=(imported_payload,), daemon=True
                ).start()
            freshness_refresh_failures: list[str] = []

            return jsonify(
                {
                    "success": True,
                    "message": success_message,
                    "summary": investment_payload.get("summary", {}),
                    "freshness_refresh_failures": freshness_refresh_failures,
                    "investment_store_version": str(
                        build_file_fingerprint(
                            investment_store_path_for(INVESTMENT_STORE_PATH)
                        ).get("mtime_ns", 0)
                    ),
                    "transaction_count": len(
                        investment_payload.get("transactions", [])
                    ),
                }
            )
        except RequestEntityTooLarge:
            response = jsonify(
                {
                    "success": False,
                    "error": (
                        f"The investment import exceeds the {MAX_INVESTMENT_IMPORT_REQUEST_MIB} MiB total upload limit. "
                        "Upload fewer or smaller files."
                    ),
                }
            )
            response.status_code = 413
            report_fetch_abort_debug_event(
                "E",
                "runtime.py:investment_add_transactions",
                "investment import rejected because the request exceeded its size limit",
                {
                    "status": 413,
                },
            )
            return apply_no_store_headers(response)
        except ValueError as exc:
            report_fetch_abort_debug_event(
                "E",
                "runtime.py:investment_add_transactions",
                "investment import rejected with value error",
                {
                    "status": 400,
                    "error": str(exc),
                },
            )
            return jsonify({"success": False, "error": str(exc)}), 400
        except Exception:  # noqa: BLE001
            LOGGER.exception("Investment import failed")
            report_fetch_abort_debug_event(
                "E",
                "runtime.py:investment_add_transactions",
                "investment import failed",
                {
                    "status": 500,
                },
            )
            return jsonify(
                {
                    "success": False,
                    "error": "The investment import could not be completed. Try again later.",
                }
            ), 500

    return {
        "investment_add_transactions": investment_add_transactions,
        "investment_download_zircon_hk_template": investment_download_zircon_hk_template,
        "investment_export_standard_xlsx": investment_export_standard_xlsx,
        "investment_get_transactions": investment_get_transactions,
        "investment_page": investment_page,
        "investment_validate_hsbc_pasted_text": investment_validate_hsbc_pasted_text,
        "investment_validate_zircon_hk_workbook": investment_validate_zircon_hk_workbook,
    }
