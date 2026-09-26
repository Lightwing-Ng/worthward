"""Build the investment market live web-runtime context.

Code version: v0.1.1
"""

from __future__ import annotations


def build_investment_market_live_context(
    context: dict[str, object],
) -> dict[str, object]:
    LOGGER = context["LOGGER"]

    apply_no_store_headers = context["apply_no_store_headers"]

    fetch_history = context["fetch_history"]

    is_configured_money_market_ticker = context["is_configured_money_market_ticker"]

    is_nyse_early_close = context["is_nyse_early_close"]

    is_one_minute_store_fresh = context["is_one_minute_store_fresh"]

    jsonify = context["jsonify"]

    live_trading_api_authorization_failure_response = context[
        "live_trading_api_authorization_failure_response"
    ]

    load_broker_settings = context["load_broker_settings"]

    load_investment_realtime_quotes = context["load_investment_realtime_quotes"]

    load_longbridge_account_balances = context["load_longbridge_account_balances"]

    load_longbridge_stock_positions = context["load_longbridge_stock_positions"]

    normalize_investment_intraday_ohlc = context["normalize_investment_intraday_ohlc"]

    nyse_market_session_state = context["nyse_market_session_state"]

    nyse_recent_trading_days = context["nyse_recent_trading_days"]

    pd = context["pd"]

    re = context["re"]

    refresh_one_minute_store = context["refresh_one_minute_store"]

    refresh_one_minute_store_with_longbridge = context[
        "refresh_one_minute_store_with_longbridge"
    ]

    refresh_recent_one_minute_store_with_yfinance = context[
        "refresh_recent_one_minute_store_with_yfinance"
    ]

    request = context["request"]

    resolve_investment_history_store_path = context[
        "resolve_investment_history_store_path"
    ]

    submit_longbridge_limit_order = context["submit_longbridge_limit_order"]

    validate_ticker_or_raise = context["validate_ticker_or_raise"]

    def investment_get_intraday_history():
        """Get local 1-minute OHLC history for Investment charts."""
        ticker = request.args.get("ticker", "").strip().upper()
        requested_range = request.args.get("range", "").strip().lower() or "1w"
        ensure_store = request.args.get("ensure_store", "").strip() == "1"
        requested_days = [
            day
            for day in (
                part.strip() for part in request.args.get("days", "").split(",")
            )
            if re.match(r"^\d{4}-\d{2}-\d{2}$", day)
        ]
        if not ticker:
            response = jsonify({"success": False, "error": "No ticker provided"})
            response.status_code = 400
            return apply_no_store_headers(response)

        try:
            normalized_ticker = validate_ticker_or_raise(ticker)
            if is_configured_money_market_ticker(normalized_ticker):
                response = jsonify(
                    {
                        "success": True,
                        "ticker": normalized_ticker,
                        "interval": "1m",
                        "range": requested_range,
                        "days": requested_days,
                        "rows": [],
                        "count": 0,
                        "refreshed": False,
                        "source": "money_market_anchor",
                    }
                )
                return apply_no_store_headers(response)
            refresh_result = None
            intraday_path = resolve_investment_history_store_path(
                normalized_ticker, interval="1m"
            )
            if ensure_store and not is_one_minute_store_fresh(normalized_ticker):
                refresh_result = refresh_one_minute_store(normalized_ticker)
                intraday_path = resolve_investment_history_store_path(
                    normalized_ticker, interval="1m"
                )

            if intraday_path is not None:
                dataset = pd.read_parquet(intraday_path)
            else:
                dataset = fetch_history(
                    normalized_ticker, include_dividends=False, interval="1m"
                )
            if dataset.empty:
                response = jsonify(
                    {
                        "success": False,
                        "error": f"No 1-minute market data for {normalized_ticker}",
                    }
                )
                response.status_code = 404
                return apply_no_store_headers(response)

            intraday = normalize_investment_intraday_ohlc(dataset)
            if intraday.empty:
                response = jsonify(
                    {
                        "success": False,
                        "error": f"No 1-minute OHLC data for {normalized_ticker}",
                    }
                )
                response.status_code = 404
                return apply_no_store_headers(response)
            if ensure_store and requested_days:
                session_state = nyse_market_session_state(include_overnight=True)
                recent_day_count = 23 if requested_range == "1m" else 5
                refreshable_days = set(
                    nyse_recent_trading_days(
                        session_state.get("as_of"),
                        day_count=recent_day_count,
                    )
                )
                eligible_requested_days = [
                    day for day in requested_days if day in refreshable_days
                ]
                intraday_day_keys = intraday["Date"].dt.strftime("%Y-%m-%d")
                available_days = set(intraday_day_keys.drop_duplicates().tolist())
                available_bar_counts = intraday_day_keys.value_counts()
                active_session_day = (
                    str(session_state.get("session_date") or "")
                    if session_state.get("is_realtime_allowed")
                    and session_state.get("session") == "intraday"
                    else ""
                )

                def expected_regular_bar_count(day_key: str) -> int:
                    regular_close_minute = (
                        (13 * 60) if is_nyse_early_close(day_key) else (16 * 60)
                    )
                    return regular_close_minute - ((9 * 60) + 30)

                missing_days = [
                    day for day in eligible_requested_days if day not in available_days
                ]
                incomplete_days = [
                    day
                    for day in eligible_requested_days
                    if day != active_session_day
                    and int(available_bar_counts.get(day, 0))
                    < expected_regular_bar_count(day)
                ]
                refresh_days = set(missing_days).union(incomplete_days)
                if refresh_days:
                    try:
                        refresh_result = refresh_recent_one_minute_store_with_yfinance(
                            normalized_ticker,
                            days=30,
                        )
                        intraday_path = resolve_investment_history_store_path(
                            normalized_ticker, interval="1m"
                        )
                        dataset = (
                            pd.read_parquet(intraday_path)
                            if intraday_path is not None
                            else dataset
                        )
                        intraday = normalize_investment_intraday_ohlc(dataset)
                    except Exception as exc:  # noqa: BLE001
                        LOGGER.debug(
                            "Unable to fill requested Investment intraday days for %s with Yahoo: %s",
                            normalized_ticker,
                            exc,
                        )
                    available_days = set(
                        intraday["Date"]
                        .dt.strftime("%Y-%m-%d")
                        .drop_duplicates()
                        .tolist()
                    )
                    available_bar_counts = (
                        intraday["Date"].dt.strftime("%Y-%m-%d").value_counts()
                    )
                    fallback_days = [
                        day
                        for day in refresh_days
                        if (
                            day != active_session_day
                            and int(available_bar_counts.get(day, 0))
                            < expected_regular_bar_count(day)
                        )
                        or (day == active_session_day and day not in available_days)
                    ]
                    if fallback_days:
                        try:
                            longbridge_refresh_result = (
                                refresh_one_minute_store_with_longbridge(
                                    normalized_ticker
                                )
                            )
                            intraday_path = resolve_investment_history_store_path(
                                normalized_ticker,
                                interval="1m",
                            )
                            dataset = (
                                pd.read_parquet(intraday_path)
                                if intraday_path is not None
                                else dataset
                            )
                            intraday = normalize_investment_intraday_ohlc(dataset)
                            available_days = set(
                                intraday["Date"]
                                .dt.strftime("%Y-%m-%d")
                                .drop_duplicates()
                                .tolist()
                            )
                            available_bar_counts = (
                                intraday["Date"].dt.strftime("%Y-%m-%d").value_counts()
                            )
                            if all(
                                day in available_days
                                and (
                                    day == active_session_day
                                    or int(available_bar_counts.get(day, 0))
                                    >= expected_regular_bar_count(day)
                                )
                                for day in fallback_days
                            ):
                                refresh_result = longbridge_refresh_result
                            else:
                                LOGGER.debug(
                                    "Longbridge Investment intraday refresh for %s did not fill %s",
                                    normalized_ticker,
                                    ", ".join(fallback_days),
                                )
                        except Exception as exc:  # noqa: BLE001
                            LOGGER.debug(
                                "Unable to fill requested Investment intraday days for %s with fallback data: %s",
                                normalized_ticker,
                                exc,
                            )

            latest_timestamp = intraday["Date"].max()
            if requested_days:
                requested_day_set = set(requested_days)
                intraday = intraday.loc[
                    intraday["Date"].dt.strftime("%Y-%m-%d").isin(requested_day_set)
                ].copy()
            elif requested_range == "current-day":
                latest_day = latest_timestamp.strftime("%Y-%m-%d")
                intraday = intraday.loc[
                    intraday["Date"].dt.strftime("%Y-%m-%d") == latest_day
                ].copy()
            elif requested_range == "3d":
                trading_days = (
                    intraday["Date"].dt.strftime("%Y-%m-%d").drop_duplicates().tolist()
                )
                selected_days = set(trading_days[-3:])
                if selected_days:
                    intraday = intraday.loc[
                        intraday["Date"].dt.strftime("%Y-%m-%d").isin(selected_days)
                    ].copy()
            elif requested_range == "1w":
                trading_days = nyse_recent_trading_days(latest_timestamp, day_count=5)
                selected_days = set(trading_days)
                if selected_days:
                    intraday = intraday.loc[
                        intraday["Date"].dt.strftime("%Y-%m-%d").isin(selected_days)
                    ].copy()
            elif requested_range == "1m":
                trading_days = nyse_recent_trading_days(latest_timestamp, day_count=23)
                selected_days = set(trading_days)
                if selected_days:
                    intraday = intraday.loc[
                        intraday["Date"].dt.strftime("%Y-%m-%d").isin(selected_days)
                    ].copy()

            rows = [
                {
                    "date": timestamp.strftime("%Y-%m-%d %H:%M"),
                    "open": float(open_value),
                    "high": float(high_value),
                    "low": float(low_value),
                    "close": float(close_value),
                }
                for timestamp, open_value, high_value, low_value, close_value in zip(
                    intraday["Date"],
                    intraday["Open"],
                    intraday["High"],
                    intraday["Low"],
                    intraday["Close"],
                )
            ]
            response = jsonify(
                {
                    "success": True,
                    "ticker": normalized_ticker,
                    "interval": "1m",
                    "range": requested_range,
                    "days": requested_days,
                    "rows": rows,
                    "count": len(rows),
                    "refreshed": refresh_result is not None,
                    "source": refresh_result.source
                    if refresh_result is not None
                    else "local",
                }
            )
            return apply_no_store_headers(response)
        except Exception:  # noqa: BLE001
            LOGGER.exception("Unable to load 1-minute market data for %s", ticker)
            response = jsonify(
                {
                    "success": False,
                    "error": f"Unable to load 1-minute market data for {ticker}. Try again later.",
                }
            )
            response.status_code = 500
            return apply_no_store_headers(response)

    def investment_get_realtime_quotes():
        """Get Longbridge-first realtime quotes with yfinance fallback."""
        failures: list[dict[str, str]] = []

        def collect_valid_tickers(raw_values: list[str]) -> list[str]:
            valid_tickers: list[str] = []
            for raw_value in raw_values:
                raw_ticker = str(raw_value or "").strip()
                if not raw_ticker:
                    continue
                try:
                    valid_tickers.append(validate_ticker_or_raise(raw_ticker))
                except ValueError as exc:
                    failures.append(
                        {
                            "ticker": raw_ticker,
                            "error": str(exc),
                        }
                    )
            return valid_tickers

        requested_tickers = collect_valid_tickers(request.args.getlist("ticker"))
        if not requested_tickers and not failures:
            repeated = str(request.args.get("tickers", "")).strip()
            requested_tickers = collect_valid_tickers(repeated.split(","))
        requested_tickers = list(dict.fromkeys(requested_tickers))
        if not requested_tickers:
            response = jsonify(
                {
                    "success": False,
                    "error": "No valid tickers provided"
                    if failures
                    else "No tickers provided",
                    "quotes": [],
                    "failures": failures,
                    "count": 0,
                    "source": "yfinance",
                }
            )
            response.status_code = 400
            return apply_no_store_headers(response)

        quotes: list[dict[str, object]] = []
        fetched_at = pd.Timestamp.now(tz="UTC")
        try:
            quotes = load_investment_realtime_quotes(requested_tickers)
        except Exception:  # noqa: BLE001
            LOGGER.exception("Unable to load realtime investment quotes")
            failures = [
                {
                    "ticker": ticker,
                    "error": "Realtime quote data is temporarily unavailable.",
                }
                for ticker in requested_tickers
            ]

        # Always return 200 with whatever we got (partial is common for large ticker sets
        # or slow symbols). The 502 was causing visible errors and making import feel stuck.
        # Failures are reported to the caller for diagnostics.
        response = jsonify(
            {
                "success": bool(quotes) or (len(requested_tickers) == 0),
                "quotes": quotes,
                "failures": failures,
                "count": len(quotes),
                "source": (
                    "mixed"
                    if len({str(item.get("source") or "") for item in quotes}) > 1
                    else str(quotes[0].get("source") or "yfinance")
                    if quotes
                    else "yfinance"
                ),
                "fetched_at": fetched_at.strftime("%Y-%m-%d %H:%M:%S%z"),
            }
        )
        response.status_code = 200
        return apply_no_store_headers(response)

    def investment_get_market_session():
        """Get US-equity market session state for frontend-safe gating of realtime refresh."""
        try:
            reference = request.args.get("as_of")
            try:
                requested_day_count = int(request.args.get("day_count", "5"))
            except (TypeError, ValueError):
                requested_day_count = 5
            requested_day_count = max(1, min(365, requested_day_count))
            session_state = nyse_market_session_state(
                reference if reference else None,
                include_overnight=True,
            )
            trading_days = nyse_recent_trading_days(
                reference if reference else None,
                day_count=requested_day_count,
            )
            response = jsonify(
                {"success": True, "trading_days": trading_days, **session_state}
            )
            response.status_code = 200
            return apply_no_store_headers(response)
        except Exception:  # noqa: BLE001
            LOGGER.exception("Unable to load US-equity market session state")
            response = jsonify(
                {
                    "success": False,
                    "error": "US-equity market session information is temporarily unavailable.",
                    "market": "us_equity",
                    "is_trading_day": False,
                    "is_early_close": False,
                    "session": "off",
                    "session_date": "",
                    "as_of": pd.Timestamp.now(tz="America/New_York").isoformat(),
                    "timezone": "America/New_York",
                    "is_realtime_allowed": False,
                    "overnight_open": "20:00",
                    "overnight_close": "04:00",
                    "premarket_open": "04:00",
                    "regular_open": "09:30",
                    "regular_close": "16:00",
                    "postmarket_close": "20:00",
                    "next_session_open": "",
                    "next_session_close": "",
                    "trading_days": [],
                }
            )
            response.status_code = 500
            return apply_no_store_headers(response)

    def live_trading_get_positions():
        """Load current Longbridge stock positions for the Live trading workspace."""
        authorization_failure = live_trading_api_authorization_failure_response()
        if authorization_failure is not None:
            return authorization_failure
        try:
            settings = load_broker_settings()
            account_balances = load_longbridge_account_balances(settings)
            positions = load_longbridge_stock_positions(settings)
            response = jsonify(
                {
                    "success": True,
                    "account_balances": [
                        {
                            "total_cash": item.total_cash,
                            "max_finance_amount": item.max_finance_amount,
                            "remaining_finance_amount": item.remaining_finance_amount,
                            "risk_level": item.risk_level,
                            "margin_call": item.margin_call,
                            "currency": item.currency,
                            "market": item.market,
                            "net_assets": item.net_assets,
                            "init_margin": item.init_margin,
                            "maintenance_margin": item.maintenance_margin,
                            "buy_power": item.buy_power,
                            "cash_infos": [
                                {
                                    "withdraw_cash": cash_item.withdraw_cash,
                                    "available_cash": cash_item.available_cash,
                                    "frozen_cash": cash_item.frozen_cash,
                                    "settling_cash": cash_item.settling_cash,
                                    "currency": cash_item.currency,
                                }
                                for cash_item in item.cash_infos
                            ],
                            "frozen_transaction_fees": [
                                {
                                    "currency": fee_item.currency,
                                    "frozen_transaction_fee": fee_item.frozen_transaction_fee,
                                }
                                for fee_item in item.frozen_transaction_fees
                            ],
                        }
                        for item in account_balances
                    ],
                    "positions": [
                        {
                            "symbol": item.symbol,
                            "symbol_name": item.symbol_name,
                            "quantity": item.quantity,
                            "available_quantity": item.available_quantity,
                            "cost_price": item.cost_price,
                            "currency": item.currency,
                            "market": item.market,
                            "account_channel": item.account_channel,
                        }
                        for item in positions
                    ],
                }
            )
            return apply_no_store_headers(response)
        except ValueError as exc:
            response = jsonify({"success": False, "error": str(exc)})
            response.status_code = 400
            return apply_no_store_headers(response)
        except Exception:  # noqa: BLE001
            LOGGER.exception("Unable to load live trading account data")
            response = jsonify(
                {
                    "success": False,
                    "error": "Live trading account data is temporarily unavailable. Try again later.",
                }
            )
            response.status_code = 500
            return apply_no_store_headers(response)

    def live_trading_submit_order():
        """Submit a Longbridge live limit order from the Live trading workspace."""
        authorization_failure = live_trading_api_authorization_failure_response()
        if authorization_failure is not None:
            return authorization_failure
        payload = request.get_json(silent=True) or {}
        try:
            order = submit_longbridge_limit_order(
                load_broker_settings(),
                ticker=str(payload.get("ticker", "")).strip(),
                side=str(payload.get("side", "")).strip(),
                price=str(payload.get("price", "")).strip(),
                quantity=str(payload.get("quantity", "")).strip(),
                remark=str(payload.get("remark", "")).strip(),
            )
            response = jsonify(
                {
                    "success": True,
                    "message": f"{order.side.title()} order submitted for {order.symbol}.",
                    "order": {
                        "order_id": order.order_id,
                        "symbol": order.symbol,
                        "side": order.side,
                        "price": order.price,
                        "quantity": order.quantity,
                        "order_type": order.order_type,
                        "time_in_force": order.time_in_force,
                        "status": order.status,
                        "remark": order.remark,
                    },
                }
            )
            return apply_no_store_headers(response)
        except ValueError as exc:
            response = jsonify({"success": False, "error": str(exc)})
            response.status_code = 400
            return apply_no_store_headers(response)
        except Exception:  # noqa: BLE001
            LOGGER.exception("Unable to submit live trading order")
            response = jsonify(
                {
                    "success": False,
                    "error": "The live order could not be submitted. Try again later.",
                }
            )
            response.status_code = 500
            return apply_no_store_headers(response)

    return {
        "investment_get_intraday_history": investment_get_intraday_history,
        "investment_get_market_session": investment_get_market_session,
        "investment_get_realtime_quotes": investment_get_realtime_quotes,
        "live_trading_get_positions": live_trading_get_positions,
        "live_trading_submit_order": live_trading_submit_order,
    }
