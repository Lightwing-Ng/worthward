"""
Longbridge live trading helpers.

Code version: v0.5.2
- Changed: Longbridge HTTP requests now reuse the verified proxy-aware transport.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from importlib import import_module
import json
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request

from app.core.broker_settings import (
    BrokerSettings,
    has_longbridge_credentials,
    normalize_longbridge_access_token,
    uses_longbridge_cli_oauth,
)
from app.infrastructure.longbridge_cli import run_longbridge_cli_json
from app.infrastructure.runtime_network import open_scoped_network_url as urlopen

LONGBRIDGE_OPENAPI_BASE_URL = "https://openapi.longbridge.com"
LONGBRIDGE_OPENAPI_TIMEOUT_SECONDS = 8


@dataclass(frozen=True)
class LiveOrderResult:
    order_id: str
    symbol: str
    side: str
    price: str
    quantity: str
    order_type: str
    time_in_force: str
    status: str | None
    remark: str


@dataclass(frozen=True)
class LivePositionResult:
    symbol: str
    symbol_name: str
    quantity: str
    available_quantity: str
    cost_price: str
    currency: str
    market: str
    account_channel: str


@dataclass(frozen=True)
class LiveCashInfoResult:
    withdraw_cash: str
    available_cash: str
    frozen_cash: str
    settling_cash: str
    currency: str


@dataclass(frozen=True)
class LiveFrozenTransactionFeeResult:
    currency: str
    frozen_transaction_fee: str


@dataclass(frozen=True)
class LiveAccountBalanceResult:
    total_cash: str
    max_finance_amount: str
    remaining_finance_amount: str
    risk_level: str
    margin_call: str
    currency: str
    market: str
    net_assets: str
    init_margin: str
    maintenance_margin: str
    buy_power: str
    cash_infos: list[LiveCashInfoResult]
    frozen_transaction_fees: list[LiveFrozenTransactionFeeResult]


def _first_non_empty_string(candidates: list[object]) -> str | None:
    for candidate in candidates:
        normalized = str(candidate or "").strip()
        if normalized:
            return normalized
    return None


def _stringify_decimal_like(value: object, fallback: str = "0") -> str:
    normalized = _first_non_empty_string([value])
    return normalized if normalized is not None else fallback


def _extract_position_value(position: Any, names: list[str], fallback: str = "") -> str:
    return _first_non_empty_string([_get_mapping_or_attr(position, name) for name in names]) or fallback


def _get_mapping_or_attr(value: Any, name: str, default: Any = None) -> Any:
    if isinstance(value, dict):
        return value.get(name, default)
    return getattr(value, name, default)


def _coerce_sequence(value: Any) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, (list, tuple)):
        return list(value)
    return [value]


def _extract_position_channels(response: Any) -> list[Any]:
    direct_channels = _get_mapping_or_attr(response, "channels")
    if direct_channels:
        return _coerce_sequence(direct_channels)

    direct_list = _get_mapping_or_attr(response, "list")
    if direct_list:
        return _coerce_sequence(direct_list)

    data = _get_mapping_or_attr(response, "data")
    if data is not None:
        nested_channels = _get_mapping_or_attr(data, "channels")
        if nested_channels:
            return _coerce_sequence(nested_channels)
        nested_list = _get_mapping_or_attr(data, "list")
        if nested_list:
            return _coerce_sequence(nested_list)

    if isinstance(response, (list, tuple)):
        return list(response)

    return []


def _read_json_payload(response: Any) -> dict[str, Any]:
    charset = "utf-8"
    try:
        charset = response.headers.get_content_charset("utf-8") or "utf-8"
    except Exception:
        charset = "utf-8"
    raw_body = response.read()
    try:
        return json.loads(raw_body.decode(charset) if raw_body else "{}")
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise RuntimeError("Longbridge returned an invalid JSON response.") from exc


def _extract_longbridge_error_message(payload: Any, fallback: str) -> str:
    if isinstance(payload, dict):
        message = _first_non_empty_string([
            payload.get("message"),
            payload.get("msg"),
            _get_mapping_or_attr(payload.get("error"), "message"),
            payload.get("detail"),
        ])
        if message:
            return message
    return fallback


def _call_longbridge_asset_api(
    settings: BrokerSettings,
    path: str,
) -> dict[str, Any]:
    access_token = normalize_longbridge_access_token(settings.longbridge_access_token)
    if not access_token:
        raise ValueError("Save your Longbridge Access Token first.")

    request_obj = Request(
        f"{LONGBRIDGE_OPENAPI_BASE_URL}{path}",
        headers={
            "Accept": "application/json",
            "Authorization": f"Bearer {access_token}",
            "User-Agent": "antigravity/1.0",
        },
    )

    try:
        with urlopen(request_obj, timeout=LONGBRIDGE_OPENAPI_TIMEOUT_SECONDS) as response:
            payload = _read_json_payload(response)
    except HTTPError as exc:
        error_payload: dict[str, Any] = {}
        try:
            error_payload = _read_json_payload(exc)
        except RuntimeError:
            error_payload = {}
        status_message = _extract_longbridge_error_message(
            error_payload,
            f"Longbridge request failed with HTTP {exc.code}.",
        )
        raise RuntimeError(status_message) from exc
    except URLError as exc:
        raise RuntimeError("Unable to reach Longbridge OpenAPI right now.") from exc

    code = payload.get("code")
    try:
        is_success = int(code) == 0
    except (TypeError, ValueError):
        is_success = False
    if not is_success:
        raise RuntimeError(_extract_longbridge_error_message(payload, "Longbridge request failed."))

    data = payload.get("data")
    return data if isinstance(data, dict) else {}


def _load_longbridge_trade_api() -> tuple[Any, Any, Any, Any, Any]:
    for module_name in ("longbridge.openapi", "longport.openapi"):
        try:
            module = import_module(module_name)
            return (
                module.Config,
                module.TradeContext,
                module.OrderType,
                module.OrderSide,
                module.TimeInForceType,
            )
        except ImportError:
            continue
    raise RuntimeError(
        "Longbridge OpenAPI is not installed. Add the official Python package before placing live orders."
    )


def _build_longbridge_config(config_cls: Any, settings: BrokerSettings) -> Any:
    app_key = settings.longbridge_app_key.strip()
    app_secret = settings.longbridge_app_secret.strip()
    access_token = normalize_longbridge_access_token(settings.longbridge_access_token)
    factory = getattr(config_cls, "from_apikey", None)
    if callable(factory):
        return factory(app_key, app_secret, access_token)
    return config_cls(app_key, app_secret, access_token)


def _build_longbridge_trade_context(settings: BrokerSettings) -> Any:
    config_cls, trade_context_cls, _, _, _ = _load_longbridge_trade_api()
    config = _build_longbridge_config(config_cls, settings)
    return trade_context_cls(config)


def _load_longbridge_account_balances_via_cli(settings: BrokerSettings) -> list[LiveAccountBalanceResult]:
    payload = run_longbridge_cli_json(settings, ["assets", "--format", "json"], timeout_seconds=20)
    balance_items = payload if isinstance(payload, list) else []

    balances: list[LiveAccountBalanceResult] = []
    for item in balance_items:
        if not isinstance(item, dict):
            continue
        balance_currency = _extract_position_value(item, ["currency", "base_currency"], "--")
        cash_infos: list[LiveCashInfoResult] = []
        for cash_item in _coerce_sequence(item.get("cash_infos")):
            cash_infos.append(LiveCashInfoResult(
                withdraw_cash=_stringify_decimal_like(_get_mapping_or_attr(cash_item, "withdraw_cash")),
                available_cash=_stringify_decimal_like(_get_mapping_or_attr(cash_item, "available_cash")),
                frozen_cash=_stringify_decimal_like(_get_mapping_or_attr(cash_item, "frozen_cash")),
                settling_cash=_stringify_decimal_like(_get_mapping_or_attr(cash_item, "settling_cash")),
                currency=_extract_position_value(cash_item, ["currency"], balance_currency),
            ))

        frozen_transaction_fees: list[LiveFrozenTransactionFeeResult] = []
        for fee_item in _coerce_sequence(item.get("frozen_transaction_fees")):
            frozen_transaction_fees.append(LiveFrozenTransactionFeeResult(
                currency=_extract_position_value(fee_item, ["currency"], balance_currency),
                frozen_transaction_fee=_stringify_decimal_like(
                    _get_mapping_or_attr(fee_item, "frozen_transaction_fee"),
                ),
            ))

        balances.append(LiveAccountBalanceResult(
            total_cash=_stringify_decimal_like(item.get("total_cash")),
            max_finance_amount=_stringify_decimal_like(item.get("max_finance_amount")),
            remaining_finance_amount=_stringify_decimal_like(item.get("remaining_finance_amount")),
            risk_level=_stringify_decimal_like(item.get("risk_level")),
            margin_call=_stringify_decimal_like(item.get("margin_call")),
            currency=balance_currency,
            market=_extract_position_value(item, ["market"], ""),
            net_assets=_stringify_decimal_like(item.get("net_assets")),
            init_margin=_stringify_decimal_like(item.get("init_margin")),
            maintenance_margin=_stringify_decimal_like(item.get("maintenance_margin")),
            buy_power=_stringify_decimal_like(item.get("buy_power")),
            cash_infos=cash_infos,
            frozen_transaction_fees=frozen_transaction_fees,
        ))

    balances.sort(key=lambda item: item.currency)
    return balances


def _load_longbridge_stock_positions_via_cli(settings: BrokerSettings) -> list[LivePositionResult]:
    payload = run_longbridge_cli_json(settings, ["positions", "--format", "json"], timeout_seconds=20)
    raw_positions = payload if isinstance(payload, list) else []

    positions: list[LivePositionResult] = []
    for item in raw_positions:
        if not isinstance(item, dict):
            continue
        symbol = _extract_position_value(item, ["symbol", "stock_code"])
        if not symbol:
            continue
        positions.append(LivePositionResult(
            symbol=symbol,
            symbol_name=_extract_position_value(item, ["symbol_name", "name"], symbol),
            quantity=_stringify_decimal_like(item.get("quantity")),
            available_quantity=_stringify_decimal_like(
                _first_non_empty_string([
                    item.get("available_quantity"),
                    item.get("enable_quantity"),
                ]),
            ),
            cost_price=_stringify_decimal_like(item.get("cost_price")),
            currency=_extract_position_value(item, ["currency"], "--"),
            market=_extract_position_value(item, ["market"], "--"),
            account_channel=_extract_position_value(item, ["account_channel"], "Connected"),
        ))

    positions.sort(key=lambda item: item.symbol)
    return positions


def normalize_longbridge_symbol(ticker: str) -> str:
    normalized_ticker = str(ticker or "").strip().upper()
    if not normalized_ticker:
        raise ValueError("Ticker is required.")
    if "." in normalized_ticker:
        return normalized_ticker
    return f"{normalized_ticker}.US"


def normalize_order_side(raw_side: str) -> str:
    normalized_side = str(raw_side or "").strip().lower()
    if normalized_side in {"buy", "b"}:
        return "buy"
    if normalized_side in {"sell", "s"}:
        return "sell"
    raise ValueError("Side must be Buy or Sell.")


def parse_submitted_quantity(raw_quantity: str | int | float | Decimal) -> Decimal:
    try:
        quantity = Decimal(str(raw_quantity).strip())
    except (InvalidOperation, ValueError):
        raise ValueError("Quantity must be a valid positive number.") from None
    if quantity <= 0:
        raise ValueError("Quantity must be greater than 0.")
    return quantity


def parse_submitted_price(raw_price: str | int | float | Decimal) -> Decimal:
    try:
        price = Decimal(str(raw_price).strip())
    except (InvalidOperation, ValueError):
        raise ValueError("Price must be a valid positive number.") from None
    if price <= 0:
        raise ValueError("Price must be greater than 0.")
    return price


def submit_longbridge_limit_order(
    settings: BrokerSettings,
    *,
    ticker: str,
    side: str,
    price: str | int | float | Decimal,
    quantity: str | int | float | Decimal,
    remark: str = "",
) -> LiveOrderResult:
    if not has_longbridge_credentials(settings):
        raise ValueError("Save your Longbridge App Key, App Secret, and Access Token first.")

    config_cls, trade_context_cls, order_type_enum, order_side_enum, time_in_force_enum = _load_longbridge_trade_api()
    config = _build_longbridge_config(config_cls, settings)
    trade_context = trade_context_cls(config)
    try:
        symbol = normalize_longbridge_symbol(ticker)
        normalized_side = normalize_order_side(side)
        submitted_price = parse_submitted_price(price)
        submitted_quantity = parse_submitted_quantity(quantity)
        order_side = order_side_enum.Buy if normalized_side == "buy" else order_side_enum.Sell
        response = trade_context.submit_order(
            symbol=symbol,
            order_type=order_type_enum.LO,
            side=order_side,
            time_in_force=time_in_force_enum.Day,
            submitted_quantity=submitted_quantity,
            submitted_price=submitted_price,
            remark=str(remark or "").strip(),
        )
        return LiveOrderResult(
            order_id=str(getattr(response, "order_id", "") or ""),
            symbol=symbol,
            side=normalized_side,
            price=str(submitted_price),
            quantity=str(submitted_quantity),
            order_type="LO",
            time_in_force="Day",
            status=getattr(response, "status", None),
            remark=str(remark or "").strip(),
        )
    finally:
        close_handler = getattr(trade_context, "close", None)
        if callable(close_handler):
            try:
                close_handler()
            except Exception:
                pass


def load_longbridge_account_label(settings: BrokerSettings) -> str:
    if not has_longbridge_credentials(settings):
        return "Integrated A/C (Unavailable)"

    try:
        balances = load_longbridge_account_balances(settings)
        primary_currency = None
        if balances:
            primary_currency = _first_non_empty_string([balances[0].currency])
        return f"Integrated A/C ({primary_currency or 'Connected'})"
    except Exception:
        return "Integrated A/C (Unavailable)"


def load_longbridge_account_balances(settings: BrokerSettings) -> list[LiveAccountBalanceResult]:
    if uses_longbridge_cli_oauth(settings):
        return _load_longbridge_account_balances_via_cli(settings)

    if not has_longbridge_credentials(settings):
        raise ValueError("Save your Longbridge App Key, App Secret, and Access Token first.")

    trade_context = _build_longbridge_trade_context(settings)
    try:
        response = trade_context.account_balance()
        balance_items = _coerce_sequence(_get_mapping_or_attr(response, "list"))
        if not balance_items:
            response_data = _get_mapping_or_attr(response, "data")
            balance_items = _coerce_sequence(_get_mapping_or_attr(response_data, "list"))

        balances: list[LiveAccountBalanceResult] = []
        for item in balance_items:
            balance_currency = _extract_position_value(item, ["currency", "base_currency"], "--")
            cash_infos: list[LiveCashInfoResult] = []
            for cash_item in _coerce_sequence(_get_mapping_or_attr(item, "cash_infos")):
                cash_infos.append(LiveCashInfoResult(
                    withdraw_cash=_stringify_decimal_like(_get_mapping_or_attr(cash_item, "withdraw_cash")),
                    available_cash=_stringify_decimal_like(_get_mapping_or_attr(cash_item, "available_cash")),
                    frozen_cash=_stringify_decimal_like(_get_mapping_or_attr(cash_item, "frozen_cash")),
                    settling_cash=_stringify_decimal_like(_get_mapping_or_attr(cash_item, "settling_cash")),
                    currency=_extract_position_value(cash_item, ["currency"], balance_currency),
                ))

            frozen_transaction_fees: list[LiveFrozenTransactionFeeResult] = []
            for fee_item in _coerce_sequence(_get_mapping_or_attr(item, "frozen_transaction_fees")):
                frozen_transaction_fees.append(LiveFrozenTransactionFeeResult(
                    currency=_extract_position_value(fee_item, ["currency"], balance_currency),
                    frozen_transaction_fee=_stringify_decimal_like(
                        _get_mapping_or_attr(fee_item, "frozen_transaction_fee"),
                    ),
                ))

            balances.append(LiveAccountBalanceResult(
                total_cash=_stringify_decimal_like(_get_mapping_or_attr(item, "total_cash")),
                max_finance_amount=_stringify_decimal_like(_get_mapping_or_attr(item, "max_finance_amount")),
                remaining_finance_amount=_stringify_decimal_like(
                    _get_mapping_or_attr(item, "remaining_finance_amount"),
                ),
                risk_level=_stringify_decimal_like(_get_mapping_or_attr(item, "risk_level")),
                margin_call=_stringify_decimal_like(_get_mapping_or_attr(item, "margin_call")),
                currency=balance_currency,
                market=_extract_position_value(item, ["market"], ""),
                net_assets=_stringify_decimal_like(_get_mapping_or_attr(item, "net_assets")),
                init_margin=_stringify_decimal_like(_get_mapping_or_attr(item, "init_margin")),
                maintenance_margin=_stringify_decimal_like(_get_mapping_or_attr(item, "maintenance_margin")),
                buy_power=_stringify_decimal_like(_get_mapping_or_attr(item, "buy_power")),
                cash_infos=cash_infos,
                frozen_transaction_fees=frozen_transaction_fees,
            ))

        balances.sort(key=lambda item: item.currency)
        return balances
    finally:
        close_handler = getattr(trade_context, "close", None)
        if callable(close_handler):
            try:
                close_handler()
            except Exception:
                pass


def load_longbridge_stock_positions(settings: BrokerSettings) -> list[LivePositionResult]:
    if uses_longbridge_cli_oauth(settings):
        return _load_longbridge_stock_positions_via_cli(settings)

    if not has_longbridge_credentials(settings):
        raise ValueError("Save your Longbridge App Key, App Secret, and Access Token first.")

    trade_context = _build_longbridge_trade_context(settings)
    try:
        response = trade_context.stock_positions()
        channels = _extract_position_channels(response)

        positions: list[LivePositionResult] = []
        for channel in channels:
            account_channel = _extract_position_value(
                channel,
                ["account_channel", "channel", "account_no", "account_number", "account"],
                "Connected",
            )
            stock_items = getattr(channel, "stock_info", None)
            if stock_items is None:
                stock_items = _get_mapping_or_attr(channel, "stock_info")
            if stock_items is None:
                stock_items = _get_mapping_or_attr(channel, "positions")
            if stock_items is None:
                continue
            for item in stock_items:
                symbol = _extract_position_value(item, ["symbol", "stock_code"])
                if not symbol:
                    continue
                positions.append(LivePositionResult(
                    symbol=symbol,
                    symbol_name=_extract_position_value(item, ["symbol_name", "name"], symbol),
                    quantity=_stringify_decimal_like(_get_mapping_or_attr(item, "quantity")),
                    available_quantity=_stringify_decimal_like(
                        _first_non_empty_string([
                            _get_mapping_or_attr(item, "available_quantity"),
                            _get_mapping_or_attr(item, "enable_quantity"),
                        ]),
                    ),
                    cost_price=_stringify_decimal_like(_get_mapping_or_attr(item, "cost_price")),
                    currency=_extract_position_value(item, ["currency"], "--"),
                    market=_extract_position_value(item, ["market"], "--"),
                    account_channel=account_channel,
                ))

        positions.sort(key=lambda item: item.symbol)
        return positions
    finally:
        close_handler = getattr(trade_context, "close", None)
        if callable(close_handler):
            try:
                close_handler()
            except Exception:
                pass
