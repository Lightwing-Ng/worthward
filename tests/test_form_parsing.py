"""Behavior tests for shared workspace form and query parsing helpers.

Code version: v1.3.0
"""

from __future__ import annotations

import unittest
from typing import Any

from app.web.form_parsing import (
    build_default_weights,
    compact_normalized_tickers,
    ensure_positive_portfolio_weights,
    normalize_portfolio_weights,
    parse_bool_flag_from_args,
    parse_float_value,
    parse_int_value,
    parse_portfolio_allocation_mode_from_args,
    parse_range_request_args_from_args,
    parse_requested_shares_from_args,
    parse_requested_tickers_from_args,
    parse_requested_weights_from_args,
    resolve_workspace_dividend_mode,
)
from app.web.navigation import (
    build_settings_path,
    build_settings_state_url,
    build_trade_path,
    build_view_path,
    normalize_settings_section,
    normalize_settings_page,
    normalize_settings_tab,
    normalize_trade_section,
    normalize_view_name,
)


class _Args(dict[str, Any]):
    """Minimal MultiDict-like mapping for pure parsing tests."""

    def __init__(self, *args: object, multi: dict[str, list[str]] | None = None, **kwargs: object) -> None:
        super().__init__(*args, **kwargs)  # type: ignore[arg-type]
        self._multi = multi or {}

    def getlist(self, key: str) -> list[str]:
        if key in self._multi:
            return list(self._multi[key])
        value = self.get(key)
        if value is None:
            return []
        return [str(value)]


def _identity(value: str) -> str:
    return str(value or "").strip().upper()


class FormParsingTests(unittest.TestCase):
    def test_parse_int_and_float_fallbacks(self) -> None:
        self.assertEqual(parse_int_value("12", 0), 12)
        self.assertEqual(parse_int_value("x", 7), 7)
        self.assertEqual(parse_int_value(None, 3), 3)
        self.assertEqual(parse_float_value("1,234.5", 0.0), 1234.5)
        self.assertEqual(parse_float_value("", 2.5), 2.5)
        self.assertEqual(parse_float_value("bad", 9.0), 9.0)

    def test_compact_and_parse_tickers_from_repeated_csv_and_legacy_shapes(self) -> None:
        self.assertEqual(
            compact_normalized_tickers([" qqq ", "", "aapl"], max_tickers=5, normalize=_identity),
            ["QQQ", "AAPL"],
        )
        repeated = parse_requested_tickers_from_args(
            _Args(multi={"ticker": ["qqq", "aapl"]}),
            max_tickers=5,
            normalize=_identity,
        )
        self.assertEqual(repeated, ["QQQ", "AAPL"])

        csv_values = parse_requested_tickers_from_args(
            _Args({"tickers": "qqq, msft ,nvda"}),
            max_tickers=5,
            normalize=_identity,
        )
        self.assertEqual(csv_values, ["QQQ", "MSFT", "NVDA"])

        numbered = parse_requested_tickers_from_args(
            _Args({"ticker_1": "qqq", "ticker_2": "aapl", "ticker_3": ""}),
            max_tickers=5,
            normalize=_identity,
        )
        self.assertEqual(numbered, ["QQQ", "AAPL"])

        legacy = parse_requested_tickers_from_args(
            _Args({"ticker_a": "spy", "ticker_b": "qqq"}),
            max_tickers=5,
            normalize=_identity,
        )
        self.assertEqual(legacy, ["SPY", "QQQ"])

        self.assertEqual(
            parse_requested_tickers_from_args(_Args(), max_tickers=5, normalize=_identity),
            [],
        )

    def test_weights_shares_allocation_and_bool_flags(self) -> None:
        weights = parse_requested_weights_from_args(
            _Args(multi={"weight": ["60", "40", "x"]}),
            2,
        )
        self.assertEqual(weights, [60, 40])

        numbered_weights = parse_requested_weights_from_args(
            _Args({"weight_1": "25", "weight_2": ""}),
            2,
        )
        self.assertEqual(numbered_weights, [25, 0])

        shares = parse_requested_shares_from_args(
            _Args(multi={"shares": ["-3", "10"]}),
            2,
        )
        self.assertEqual(shares, [0, 10])

        self.assertEqual(
            parse_portfolio_allocation_mode_from_args(_Args({"allocation": "shares"})),
            "shares",
        )
        self.assertEqual(
            parse_portfolio_allocation_mode_from_args(_Args({"allocation": "weight"})),
            "weight",
        )

        self.assertTrue(
            parse_bool_flag_from_args(_Args(multi={"dividends": ["0", "1"]}), "dividends")
        )
        self.assertFalse(
            parse_bool_flag_from_args(_Args(multi={"dividends": ["0"]}), "dividends")
        )
        self.assertTrue(
            parse_bool_flag_from_args(_Args(), "missing", default=True)
        )

    def test_dividend_mode_and_range_args(self) -> None:
        self.assertEqual(resolve_workspace_dividend_mode(True, True), "price")
        self.assertEqual(resolve_workspace_dividend_mode(False, True), "reinvest")
        self.assertEqual(resolve_workspace_dividend_mode(False, False), "cash")

        range_mode, period, start, end = parse_range_request_args_from_args(
            _Args({
                "range": "exact",
                "period": "1d",
                "trading_date": "2026-03-26",
            }),
            default_range_mode="period",
            default_period="1y",
        )
        self.assertEqual((range_mode, period, start, end), ("exact", "1d", "2026-03-26", "2026-03-26"))

        range_mode, period, start, end = parse_range_request_args_from_args(
            _Args({"from": "2026-01-01", "to": "2026-02-01"}),
            default_range_mode="period",
            default_period="3y",
        )
        self.assertEqual(range_mode, "period")
        self.assertEqual(period, "3y")
        self.assertEqual(start, "2026-01-01")
        self.assertEqual(end, "2026-02-01")

        range_mode, period, start, end = parse_range_request_args_from_args(
            _Args({"range": "3mo"}),
            default_range_mode="period",
            default_period="1y",
        )
        self.assertEqual((range_mode, period, start, end), ("period", "3mo", "", ""))

        range_mode, period, start, end = parse_range_request_args_from_args(
            _Args({
                "range": "custom",
                "period": "3mo",
                "from": "2026-01-01",
                "to": "2026-03-31",
            }),
            default_range_mode="period",
            default_period="1y",
        )
        self.assertEqual((range_mode, period, start, end), ("exact", "3mo", "2026-01-01", "2026-03-31"))

    def test_portfolio_weight_normalization_invariants(self) -> None:
        self.assertEqual(build_default_weights(3), [34, 33, 33])
        self.assertEqual(build_default_weights(0), [])
        self.assertEqual(normalize_portfolio_weights([60, 40], 2), [60, 40])
        self.assertEqual(normalize_portfolio_weights([0, 0], 2), [50, 50])
        self.assertEqual(sum(normalize_portfolio_weights([10, 20, 30], 3)), 100)
        self.assertEqual(ensure_positive_portfolio_weights([10, 20], 2), [10, 20])
        with self.assertRaisesRegex(ValueError, "weight above 0%"):
            ensure_positive_portfolio_weights([10, 0], 2)

    def test_normalize_portfolio_weights_empty_active_count_returns_empty(self) -> None:
        self.assertEqual(normalize_portfolio_weights([60, 40], 0), [])
        self.assertEqual(normalize_portfolio_weights([100], -1), [])

    def test_normalize_portfolio_weights_pads_short_inputs_with_zeros_before_scaling(self) -> None:
        # One supplied weight and two zero-padded slots: total 50 scales to 100.
        scaled = normalize_portfolio_weights([50], 3)
        self.assertEqual(len(scaled), 3)
        self.assertEqual(sum(scaled), 100)
        self.assertEqual(scaled[0], 100)
        self.assertEqual(scaled[1], 0)
        self.assertEqual(scaled[2], 0)

        already_hundred = normalize_portfolio_weights([100], 2)
        self.assertEqual(already_hundred, [100, 0])

    def test_ensure_positive_portfolio_weights_rejects_zero_after_padding(self) -> None:
        # Fewer weights than active slots pads trailing zeros, which must fail.
        with self.assertRaisesRegex(ValueError, "weight above 0%"):
            ensure_positive_portfolio_weights([25, 75], 3)
        with self.assertRaisesRegex(ValueError, "weight above 0%"):
            ensure_positive_portfolio_weights([], 2)


class NavigationHelperTests(unittest.TestCase):
    def test_view_settings_and_trade_path_contracts(self) -> None:
        self.assertEqual(normalize_view_name("trade-messages"), "backtest")
        self.assertEqual(normalize_view_name("nope"), "tickers")
        self.assertEqual(build_view_path("portfolio"), "/workspaces/portfolio")
        self.assertEqual(build_view_path("grid-trading"), "/workspaces/backtest")

        self.assertEqual(normalize_settings_section("broker-access"), "broker-access")
        self.assertEqual(normalize_settings_section("local_store"), "local-market-store")
        self.assertEqual(normalize_settings_section("missing"), "about")
        self.assertEqual(build_settings_path("general"), "/settings/general")
        self.assertEqual(normalize_settings_tab("HISTORY"), "history")
        self.assertEqual(normalize_settings_tab("missing"), "current")
        self.assertEqual(normalize_settings_page("0"), 1)
        self.assertEqual(normalize_settings_page("3"), 3)
        self.assertEqual(
            build_settings_state_url("general", tab="history", page=2),
            "/settings/general?tab=history&page=2",
        )
        self.assertEqual(
            build_settings_state_url("general", tab="current", page=1),
            "/settings/general",
        )
        self.assertEqual(
            build_settings_state_url("local_store", page=1),
            "/settings/local-market-store",
        )

        self.assertEqual(normalize_trade_section("timing"), "investment")
        self.assertEqual(normalize_trade_section("live"), "live-trading")
        self.assertEqual(build_trade_path("invest"), "/trade/investment")
        self.assertEqual(build_trade_path("live-trading"), "/trade/live-trading")


if __name__ == "__main__":
    unittest.main()
