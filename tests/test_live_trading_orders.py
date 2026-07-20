"""
Tests for Longbridge live trading order flows.

Code version: v0.3.1
"""

from __future__ import annotations

from decimal import Decimal
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from app import create_app
from app.core.broker_settings import BrokerSettings
from app.services.live_trading import LiveOrderResult, submit_longbridge_limit_order

LIVE_TRADING_TEST_TOKEN = "audit-live-trading-token-32-chars"


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

        response = client.post(
            "/trade/live-trading/unlock",
            data={"pin": "195135"},
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

        response = client.post(
            "/trade/live-trading/unlock",
            data={"pin": "000000"},
        )

        self.assertEqual(response.status_code, 401)
        self.assertIn("The PIN is incorrect.", response.get_data(as_text=True))

    def test_live_trading_pin_session_authorizes_positions_api(self) -> None:
        client = create_app().test_client()
        client.post("/trade/live-trading/unlock", data={"pin": "195135"})

        with (
            patch("app.web.runtime.load_broker_settings", return_value=BrokerSettings()),
            patch("app.web.runtime.load_longbridge_account_balances", return_value=[]),
            patch("app.web.runtime.load_longbridge_stock_positions", return_value=[]),
        ):
            response = client.get("/api/live-trading/positions")

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.get_json()["success"])

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
        self.assertFalse(response.get_json()["success"])
        mocked_balances.assert_not_called()
        mocked_positions.assert_not_called()


if __name__ == "__main__":
    unittest.main()
