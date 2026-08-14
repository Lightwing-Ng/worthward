"""
Tests for Longbridge live trading order flows.

Code version: v0.3.2
"""

from __future__ import annotations

from decimal import Decimal
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from app import create_app
from app.core.broker_settings import BrokerSettings
from app.core.live_trading_security import authorize_live_trading_api_request
from app.services.live_trading import (
    LiveOrderResult,
    load_longbridge_account_balances,
    load_longbridge_stock_positions,
    submit_longbridge_limit_order,
)

LIVE_TRADING_TEST_TOKEN = "audit-live-trading-token-32-chars"
LIVE_TRADING_TEST_PIN = "123456"


class _FakeConfig:
    last_credentials: tuple[str, str, str] | None = None

    @classmethod
    def from_apikey(cls, app_key: str, app_secret: str, access_token: str) -> dict[str, str]:
        cls.last_credentials = (app_key, app_secret, access_token)
        return {
            "app_key": app_key,
            "app_secret": app_secret,
            "access_token": access_token,
        }


class _FakeTradeContext:
    instances: list["_FakeTradeContext"] = []
    last_submit_kwargs: dict[str, object] | None = None
    next_response: object = SimpleNamespace(order_id="order-001", status="submitted")

    def __init__(self, config: object) -> None:
        self.config = config
        self.closed = False
        _FakeTradeContext.instances.append(self)

    def submit_order(self, **kwargs: object) -> object:
        _FakeTradeContext.last_submit_kwargs = kwargs
        return _FakeTradeContext.next_response

    def close(self) -> None:
        self.closed = True


class _FakeReadTradeContext:
    def __init__(
            self,
            *,
            account_balance_response: object = None,
            stock_positions_response: object = None,
    ) -> None:
        self.account_balance_response = account_balance_response
        self.stock_positions_response = stock_positions_response
        self.closed = False

    def account_balance(self) -> object:
        return self.account_balance_response

    def stock_positions(self) -> object:
        return self.stock_positions_response

    def close(self) -> None:
        self.closed = True


class LongbridgeLiveTradingServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        _FakeConfig.last_credentials = None
        _FakeTradeContext.instances = []
        _FakeTradeContext.last_submit_kwargs = None
        _FakeTradeContext.next_response = SimpleNamespace(order_id="order-001", status="submitted")
        self.settings = BrokerSettings(
            selected_broker="longbridge",
            longbridge_app_key="demo-app-key",
            longbridge_app_secret="demo-app-secret",
            longbridge_access_token="demo-access-token",
        )

    def test_submit_longbridge_limit_order_matches_buy_example_from_docs(self) -> None:
        with patch(
            "app.services.live_trading._load_longbridge_trade_api",
            return_value=(
                _FakeConfig,
                _FakeTradeContext,
                SimpleNamespace(LO="LO"),
                SimpleNamespace(Buy="BUY", Sell="SELL"),
                SimpleNamespace(Day="DAY"),
            ),
        ):
            order = submit_longbridge_limit_order(
                self.settings,
                ticker="TSLA.US",
                side="buy",
                price="250.00",
                quantity="100",
                remark="Buy TSLA",
            )

        self.assertEqual(_FakeConfig.last_credentials, ("demo-app-key", "demo-app-secret", "demo-access-token"))
        self.assertEqual(_FakeTradeContext.last_submit_kwargs["symbol"], "TSLA.US")
        self.assertEqual(_FakeTradeContext.last_submit_kwargs["order_type"], "LO")
        self.assertEqual(_FakeTradeContext.last_submit_kwargs["side"], "BUY")
        self.assertEqual(_FakeTradeContext.last_submit_kwargs["time_in_force"], "DAY")
        self.assertEqual(_FakeTradeContext.last_submit_kwargs["submitted_quantity"], Decimal("100"))
        self.assertEqual(_FakeTradeContext.last_submit_kwargs["submitted_price"], Decimal("250.00"))
        self.assertEqual(_FakeTradeContext.last_submit_kwargs["remark"], "Buy TSLA")
        self.assertEqual(order.order_id, "order-001")
        self.assertEqual(order.symbol, "TSLA.US")
        self.assertEqual(order.side, "buy")
        self.assertEqual(order.price, "250.00")
        self.assertEqual(order.quantity, "100")
        self.assertEqual(order.order_type, "LO")
        self.assertEqual(order.time_in_force, "Day")
        self.assertEqual(order.status, "submitted")
        self.assertTrue(_FakeTradeContext.instances[0].closed)

    def test_submit_longbridge_limit_order_matches_sell_example_from_docs(self) -> None:
        with patch(
            "app.services.live_trading._load_longbridge_trade_api",
            return_value=(
                _FakeConfig,
                _FakeTradeContext,
                SimpleNamespace(LO="LO"),
                SimpleNamespace(Buy="BUY", Sell="SELL"),
                SimpleNamespace(Day="DAY"),
            ),
        ):
            order = submit_longbridge_limit_order(
                self.settings,
                ticker="TSLA.US",
                side="sell",
                price="260.00",
                quantity="100",
                remark="  Sell TSLA  ",
            )

        self.assertEqual(_FakeTradeContext.last_submit_kwargs["side"], "SELL")
        self.assertEqual(_FakeTradeContext.last_submit_kwargs["submitted_price"], Decimal("260.00"))
        self.assertEqual(_FakeTradeContext.last_submit_kwargs["submitted_quantity"], Decimal("100"))
        self.assertEqual(_FakeTradeContext.last_submit_kwargs["remark"], "Sell TSLA")
        self.assertEqual(order.side, "sell")
        self.assertEqual(order.price, "260.00")
        self.assertEqual(order.quantity, "100")
        self.assertEqual(order.remark, "Sell TSLA")
        self.assertTrue(_FakeTradeContext.instances[0].closed)

    def test_submit_longbridge_limit_order_rejects_missing_credentials(self) -> None:
        with self.assertRaisesRegex(ValueError, "Save your Longbridge App Key"):
            submit_longbridge_limit_order(
                BrokerSettings(selected_broker="longbridge"),
                ticker="TSLA.US",
                side="buy",
                price="250.00",
                quantity="100",
            )

    def test_submit_longbridge_limit_order_rejects_invalid_inputs_without_submitting(self) -> None:
        invalid_cases = (
            (
                "empty ticker",
                {"ticker": "", "side": "buy", "price": "250", "quantity": "1"},
                "Ticker is required.",
            ),
            (
                "unsupported side",
                {"ticker": "TSLA.US", "side": "hold", "price": "250", "quantity": "1"},
                "Side must be Buy or Sell.",
            ),
            (
                "zero price",
                {"ticker": "TSLA.US", "side": "buy", "price": "0", "quantity": "1"},
                "Price must be greater than 0.",
            ),
            (
                "invalid quantity",
                {"ticker": "TSLA.US", "side": "buy", "price": "250", "quantity": "bad"},
                "Quantity must be a valid positive number.",
            ),
        )

        with patch(
            "app.services.live_trading._load_longbridge_trade_api",
            return_value=(
                _FakeConfig,
                _FakeTradeContext,
                SimpleNamespace(LO="LO"),
                SimpleNamespace(Buy="BUY", Sell="SELL"),
                SimpleNamespace(Day="DAY"),
            ),
        ):
            for label, order_input, expected_message in invalid_cases:
                with self.subTest(label=label):
                    _FakeTradeContext.last_submit_kwargs = None
                    with self.assertRaisesRegex(ValueError, expected_message):
                        submit_longbridge_limit_order(self.settings, **order_input)
                    self.assertIsNone(_FakeTradeContext.last_submit_kwargs)
                    self.assertTrue(_FakeTradeContext.instances[-1].closed)

    def test_legacy_account_readers_reject_missing_credentials_without_transport(self) -> None:
        settings = BrokerSettings(
            selected_broker="longbridge",
            longbridge_auth_mode="legacy_apikey",
        )

        with (
            patch("app.services.live_trading._build_longbridge_trade_context") as mocked_sdk_context,
            patch("app.services.live_trading.run_longbridge_cli_json") as mocked_cli_json,
        ):
            for loader in (load_longbridge_account_balances, load_longbridge_stock_positions):
                with self.subTest(loader=loader.__name__):
                    with self.assertRaisesRegex(ValueError, "Save your Longbridge App Key"):
                        loader(settings)

        mocked_sdk_context.assert_not_called()
        mocked_cli_json.assert_not_called()

    def test_load_longbridge_account_balances_uses_legacy_sdk_and_closes_context(self) -> None:
        context = _FakeReadTradeContext(
            account_balance_response=SimpleNamespace(
                list=[],
                data=SimpleNamespace(
                    list=[
                        SimpleNamespace(
                            currency="USD",
                            total_cash="120.50",
                            cash_infos=[
                                SimpleNamespace(
                                    withdraw_cash="100",
                                    available_cash="99",
                                    frozen_cash="1",
                                    settling_cash="0",
                                    currency="USD",
                                ),
                            ],
                            frozen_transaction_fees=[
                                SimpleNamespace(currency="USD", frozen_transaction_fee="2"),
                            ],
                        ),
                        SimpleNamespace(base_currency="HKD", total_cash="80"),
                    ],
                ),
            ),
        )

        with (
            patch(
                "app.services.live_trading._build_longbridge_trade_context",
                return_value=context,
            ) as mocked_sdk_context,
            patch("app.services.live_trading.run_longbridge_cli_json") as mocked_cli_json,
        ):
            balances = load_longbridge_account_balances(self.settings)

        mocked_sdk_context.assert_called_once_with(self.settings)
        mocked_cli_json.assert_not_called()
        self.assertEqual([balance.currency for balance in balances], ["HKD", "USD"])
        self.assertEqual(balances[1].total_cash, "120.50")
        self.assertEqual(balances[1].cash_infos[0].available_cash, "99")
        self.assertEqual(balances[1].frozen_transaction_fees[0].frozen_transaction_fee, "2")
        self.assertTrue(context.closed)

    def test_load_longbridge_stock_positions_uses_legacy_sdk_and_skips_missing_symbols(self) -> None:
        context = _FakeReadTradeContext(
            stock_positions_response=SimpleNamespace(
                data=SimpleNamespace(
                    channels=[
                        SimpleNamespace(
                            account_channel="Primary",
                            stock_info=[
                                SimpleNamespace(
                                    symbol="TSLA.US",
                                    symbol_name="Tesla",
                                    quantity="10",
                                    enable_quantity="8",
                                    cost_price="250",
                                    currency="USD",
                                    market="US",
                                ),
                                SimpleNamespace(symbol="", quantity="1"),
                            ],
                        ),
                        SimpleNamespace(
                            account_channel="Secondary",
                            positions=[
                                SimpleNamespace(
                                    stock_code="AAPL.US",
                                    name="Apple",
                                    quantity="5",
                                    available_quantity="4",
                                    cost_price="200",
                                    currency="USD",
                                    market="US",
                                ),
                            ],
                        ),
                    ],
                ),
            ),
        )

        with (
            patch(
                "app.services.live_trading._build_longbridge_trade_context",
                return_value=context,
            ) as mocked_sdk_context,
            patch("app.services.live_trading.run_longbridge_cli_json") as mocked_cli_json,
        ):
            positions = load_longbridge_stock_positions(self.settings)

        mocked_sdk_context.assert_called_once_with(self.settings)
        mocked_cli_json.assert_not_called()
        self.assertEqual([position.symbol for position in positions], ["AAPL.US", "TSLA.US"])
        self.assertEqual(positions[0].account_channel, "Secondary")
        self.assertEqual(positions[1].available_quantity, "8")
        self.assertTrue(context.closed)

    def test_load_longbridge_account_balances_uses_cli_oauth_and_normalizes_items(self) -> None:
        settings = BrokerSettings(selected_broker="longbridge", longbridge_auth_mode="cli_oauth")
        cli_payload = [
            None,
            {
                "currency": "USD",
                "total_cash": "120.50",
                "cash_infos": [
                    {
                        "withdraw_cash": "100",
                        "available_cash": "99",
                        "frozen_cash": "1",
                        "settling_cash": "0",
                        "currency": "USD",
                    },
                ],
                "frozen_transaction_fees": [{"currency": "USD", "frozen_transaction_fee": "2"}],
            },
            {"base_currency": "HKD", "total_cash": "80"},
        ]

        with (
            patch("app.services.live_trading.run_longbridge_cli_json", return_value=cli_payload) as mocked_cli_json,
            patch("app.services.live_trading._build_longbridge_trade_context") as mocked_sdk_context,
        ):
            balances = load_longbridge_account_balances(settings)

        mocked_cli_json.assert_called_once_with(settings, ["assets", "--format", "json"], timeout_seconds=20)
        mocked_sdk_context.assert_not_called()
        self.assertEqual([balance.currency for balance in balances], ["HKD", "USD"])
        self.assertEqual(balances[1].cash_infos[0].available_cash, "99")
        self.assertEqual(balances[1].frozen_transaction_fees[0].frozen_transaction_fee, "2")

    def test_load_longbridge_stock_positions_uses_cli_oauth_and_skips_invalid_items(self) -> None:
        settings = BrokerSettings(selected_broker="longbridge", longbridge_auth_mode="cli_oauth")
        cli_payload = [
            None,
            {"symbol": "", "quantity": "1"},
            {
                "stock_code": "TSLA.US",
                "name": "Tesla",
                "quantity": "10",
                "enable_quantity": "8",
                "cost_price": "250",
                "currency": "USD",
                "market": "US",
                "account_channel": "Primary",
            },
            {
                "symbol": "AAPL.US",
                "symbol_name": "Apple",
                "quantity": "5",
                "available_quantity": "4",
                "cost_price": "200",
                "currency": "USD",
                "market": "US",
                "account_channel": "Secondary",
            },
        ]

        with (
            patch("app.services.live_trading.run_longbridge_cli_json", return_value=cli_payload) as mocked_cli_json,
            patch("app.services.live_trading._build_longbridge_trade_context") as mocked_sdk_context,
        ):
            positions = load_longbridge_stock_positions(settings)

        mocked_cli_json.assert_called_once_with(settings, ["positions", "--format", "json"], timeout_seconds=20)
        mocked_sdk_context.assert_not_called()
        self.assertEqual([position.symbol for position in positions], ["AAPL.US", "TSLA.US"])
        self.assertEqual(positions[0].account_channel, "Secondary")
        self.assertEqual(positions[1].available_quantity, "8")


class LiveTradingAuthorizationContractTests(unittest.TestCase):
    def test_live_api_authorization_matrix_preserves_pin_session_or_token_contract(self) -> None:
        cases = (
            (
                "no session and no configured token",
                False,
                {},
                None,
                False,
                503,
                "Live trading is locked. Set ANTIGRAVITY_LIVE_TRADING_TOKEN to a random token of "
                "at least 32 characters before reading account data or submitting orders.",
            ),
            (
                "no session and wrong token",
                False,
                {"ANTIGRAVITY_LIVE_TRADING_TOKEN": LIVE_TRADING_TEST_TOKEN},
                "wrong",
                False,
                401,
                "Live trading access token is missing or invalid.",
            ),
            (
                "no session and correct token",
                False,
                {"ANTIGRAVITY_LIVE_TRADING_TOKEN": LIVE_TRADING_TEST_TOKEN},
                LIVE_TRADING_TEST_TOKEN,
                True,
                200,
                "",
            ),
            ("pin session and no configured token", True, {}, None, True, 200, ""),
            (
                "pin session and wrong token header",
                True,
                {"ANTIGRAVITY_LIVE_TRADING_TOKEN": LIVE_TRADING_TEST_TOKEN},
                "wrong",
                True,
                200,
                "",
            ),
        )

        for (
            label,
            pin_session_unlocked,
            environment,
            presented_token,
            expected_granted,
            expected_status,
            expected_message,
        ) in cases:
            with self.subTest(label=label), patch.dict("os.environ", environment, clear=True):
                access_granted, status_code, message = authorize_live_trading_api_request(
                    pin_session_unlocked,
                    presented_token,
                )

            self.assertEqual(access_granted, expected_granted)
            self.assertEqual(status_code, expected_status)
            self.assertEqual(message, expected_message)


class LiveTradingOrderApiTests(unittest.TestCase):
    def test_live_trading_page_requires_pin_then_renders_order_controls(self) -> None:
        client = create_app().test_client()

        response = client.get("/trade/live-trading")

        self.assertEqual(response.status_code, 200)
        locked_body = response.get_data(as_text=True)
        self.assertNotIn('class="live-trading-pin-stage"', locked_body)
        self.assertIn('class="workspace-modal-overlay live-trading-pin-overlay"', locked_body)
        self.assertIn('class="workspace-modal-dialog live-trading-pin-dialog"', locked_body)
        self.assertIn("assets/css/app.css", locked_body)
        self.assertIn('window.localStorage.getItem(storageKey)', locked_body)
        self.assertIn('@media (prefers-color-scheme: dark)', locked_body)
        self.assertIn(':root[data-theme-override="dark"]', locked_body)
        self.assertIn('id="live_trading_pin"', locked_body)
        self.assertEqual(locked_body.count('class="live-trading-pin-slot"'), 6)
        self.assertIn('class="live-trading-pin-heading"', locked_body)
        self.assertIn('slot.classList.toggle("is-filled", filled)', locked_body)
        self.assertNotIn('class="live-trading-pin-back"', locked_body)
        self.assertNotIn('id="live_trading_broker"', locked_body)

        with patch.dict(
            "os.environ",
            {"ANTIGRAVITY_LIVE_TRADING_PIN": LIVE_TRADING_TEST_PIN},
            clear=True,
        ):
            response = client.post(
                "/trade/live-trading/unlock",
                data={"pin": LIVE_TRADING_TEST_PIN},
                follow_redirects=True,
            )

        self.assertEqual(response.status_code, 200)
        body = response.get_data(as_text=True)
        self.assertIn('id="live_trading_broker"', body)
        self.assertIn('id="live_trading_ticker"', body)
        self.assertIn('id="live_trading_price"', body)
        self.assertIn('id="live_trading_quantity"', body)
        self.assertNotIn('id="live_trading_access_token"', body)
        self.assertIn('id="live_trading_swipe_submit"', body)
        self.assertIn('data-enabled="0"', body)
        self.assertIn('aria-disabled="true"', body)
        self.assertIn('id="live_trading_swipe_thumb"', body)
        self.assertIn("disabled", body)

    def test_live_trading_page_rejects_incorrect_pin(self) -> None:
        client = create_app().test_client()

        with patch.dict(
            "os.environ",
            {"ANTIGRAVITY_LIVE_TRADING_PIN": LIVE_TRADING_TEST_PIN},
            clear=True,
        ):
            response = client.post(
                "/trade/live-trading/unlock",
                data={"pin": "000000"},
            )

        self.assertEqual(response.status_code, 401)
        self.assertIn("The PIN is incorrect.", response.get_data(as_text=True))

    def test_live_trading_pin_session_authorizes_positions_api(self) -> None:
        with patch.dict(
            "os.environ",
            {"ANTIGRAVITY_LIVE_TRADING_PIN": LIVE_TRADING_TEST_PIN},
            clear=True,
        ):
            client = create_app().test_client()
            client.post("/trade/live-trading/unlock", data={"pin": LIVE_TRADING_TEST_PIN})

            with (
                patch("app.web.runtime.load_broker_settings", return_value=BrokerSettings()),
                patch("app.web.runtime.load_longbridge_account_balances", return_value=[]) as mocked_balances,
                patch("app.web.runtime.load_longbridge_stock_positions", return_value=[]) as mocked_positions,
            ):
                response = client.get("/api/live-trading/positions")

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.get_json()["success"])
        mocked_balances.assert_called_once()
        mocked_positions.assert_called_once()

    def test_live_trading_positions_api_accepts_correct_access_token(self) -> None:
        client = create_app().test_client()

        with (
            patch.dict(
                "os.environ",
                {
                    "ANTIGRAVITY_LIVE_TRADING_TOKEN": LIVE_TRADING_TEST_TOKEN,
                    "ANTIGRAVITY_LIVE_TRADING_PIN": LIVE_TRADING_TEST_PIN,
                },
            ),
            patch("app.web.runtime.load_broker_settings", return_value=BrokerSettings()),
            patch("app.web.runtime.load_longbridge_account_balances", return_value=[]) as mocked_balances,
            patch("app.web.runtime.load_longbridge_stock_positions", return_value=[]) as mocked_positions,
        ):
            response = client.get(
                "/api/live-trading/positions",
                headers={"X-Antigravity-Live-Trading-Token": LIVE_TRADING_TEST_TOKEN},
            )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.get_json()["success"])
        mocked_balances.assert_called_once()
        mocked_positions.assert_called_once()

    def test_live_trading_pin_session_ignores_invalid_token_header_for_order(self) -> None:
        client = create_app().test_client()

        with (
            patch.dict(
                "os.environ",
                {
                    "ANTIGRAVITY_LIVE_TRADING_TOKEN": LIVE_TRADING_TEST_TOKEN,
                    "ANTIGRAVITY_LIVE_TRADING_PIN": LIVE_TRADING_TEST_PIN,
                },
            ),
            patch(
                "app.web.runtime.submit_longbridge_limit_order",
                return_value=LiveOrderResult(
                    order_id="order-999",
                    symbol="TSLA.US",
                    side="buy",
                    price="250.00",
                    quantity="1",
                    order_type="LO",
                    time_in_force="Day",
                    status="submitted",
                    remark="",
                ),
            ) as mocked_submit_order,
        ):
            unlock_response = client.post(
                "/trade/live-trading/unlock",
                data={"pin": LIVE_TRADING_TEST_PIN},
            )
            response = client.post(
                "/api/live-trading/orders",
                headers={"X-Antigravity-Live-Trading-Token": "wrong-token"},
                json={"ticker": "TSLA.US", "side": "buy", "price": "250", "quantity": "1"},
            )

        self.assertEqual(unlock_response.status_code, 303)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.get_json()["success"])
        mocked_submit_order.assert_called_once()

    def test_live_trading_orders_api_returns_submitted_longbridge_buy_order(self) -> None:
        client = create_app().test_client()

        with (
            patch.dict("os.environ", {"ANTIGRAVITY_LIVE_TRADING_TOKEN": LIVE_TRADING_TEST_TOKEN}),
            patch(
                "app.web.runtime.load_broker_settings",
                return_value=BrokerSettings(selected_broker="longbridge"),
            ),
            patch(
                "app.web.runtime.submit_longbridge_limit_order",
                return_value=LiveOrderResult(
                    order_id="order-888",
                    symbol="TSLA.US",
                    side="buy",
                    price="250.00",
                    quantity="100",
                    order_type="LO",
                    time_in_force="Day",
                    status="submitted",
                    remark="Buy TSLA",
                ),
            ) as mocked_submit_order,
        ):
            response = client.post(
                "/api/live-trading/orders",
                headers={"X-Antigravity-Live-Trading-Token": LIVE_TRADING_TEST_TOKEN},
                json={
                    "ticker": "TSLA.US",
                    "side": "buy",
                    "price": "250.00",
                    "quantity": "100",
                    "remark": "Buy TSLA",
                },
            )

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertTrue(payload["success"])
        self.assertEqual(payload["message"], "Buy order submitted for TSLA.US.")
        self.assertEqual(payload["order"]["order_id"], "order-888")
        self.assertEqual(payload["order"]["symbol"], "TSLA.US")
        self.assertEqual(payload["order"]["side"], "buy")
        self.assertEqual(payload["order"]["price"], "250.00")
        self.assertEqual(payload["order"]["quantity"], "100")
        self.assertEqual(payload["order"]["order_type"], "LO")
        self.assertEqual(payload["order"]["time_in_force"], "Day")
        mocked_submit_order.assert_called_once()

    def test_live_trading_orders_api_returns_bad_request_for_invalid_longbridge_payload(self) -> None:
        client = create_app().test_client()

        with (
            patch.dict("os.environ", {"ANTIGRAVITY_LIVE_TRADING_TOKEN": LIVE_TRADING_TEST_TOKEN}),
            patch(
                "app.web.runtime.load_broker_settings",
                return_value=BrokerSettings(selected_broker="longbridge"),
            ),
            patch(
                "app.web.runtime.submit_longbridge_limit_order",
                side_effect=ValueError("Price must be greater than 0."),
            ),
        ):
            response = client.post(
                "/api/live-trading/orders",
                headers={"X-Antigravity-Live-Trading-Token": LIVE_TRADING_TEST_TOKEN},
                json={
                    "ticker": "TSLA.US",
                    "side": "buy",
                    "price": "0",
                    "quantity": "100",
                },
            )

        self.assertEqual(response.status_code, 400)
        payload = response.get_json()
        self.assertFalse(payload["success"])
        self.assertEqual(payload["error"], "Price must be greater than 0.")

    def test_live_trading_orders_api_is_locked_when_server_token_is_not_configured(self) -> None:
        client = create_app().test_client()

        with (
            patch.dict("os.environ", {}, clear=True),
            patch("app.web.runtime.submit_longbridge_limit_order") as mocked_submit_order,
        ):
            response = client.post(
                "/api/live-trading/orders",
                json={"ticker": "TSLA.US", "side": "buy", "price": "250", "quantity": "1"},
            )

        self.assertEqual(response.status_code, 503)
        self.assertFalse(response.get_json()["success"])
        mocked_submit_order.assert_not_called()

    def test_live_trading_orders_api_rejects_invalid_access_token(self) -> None:
        client = create_app().test_client()

        with (
            patch.dict("os.environ", {"ANTIGRAVITY_LIVE_TRADING_TOKEN": LIVE_TRADING_TEST_TOKEN}),
            patch("app.web.runtime.submit_longbridge_limit_order") as mocked_submit_order,
        ):
            response = client.post(
                "/api/live-trading/orders",
                headers={"X-Antigravity-Live-Trading-Token": "incorrect-token"},
                json={"ticker": "TSLA.US", "side": "buy", "price": "250", "quantity": "1"},
            )

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.headers["WWW-Authenticate"], 'Bearer realm="antigravity-live-trading"')
        self.assertFalse(response.get_json()["success"])
        mocked_submit_order.assert_not_called()

    def test_live_trading_positions_api_rejects_missing_access_token(self) -> None:
        client = create_app().test_client()

        with (
            patch.dict("os.environ", {"ANTIGRAVITY_LIVE_TRADING_TOKEN": LIVE_TRADING_TEST_TOKEN}),
            patch("app.web.runtime.load_longbridge_account_balances") as mocked_balances,
            patch("app.web.runtime.load_longbridge_stock_positions") as mocked_positions,
        ):
            response = client.get("/api/live-trading/positions")

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.headers["WWW-Authenticate"], 'Bearer realm="antigravity-live-trading"')
        self.assertFalse(response.get_json()["success"])
        mocked_balances.assert_not_called()
        mocked_positions.assert_not_called()


if __name__ == "__main__":
    unittest.main()
