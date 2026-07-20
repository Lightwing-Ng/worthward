"""Behavior tests for shared investment import text, decimal, and normalized views.

Code version: v1.1.0
"""

from __future__ import annotations

import unittest
from decimal import Decimal

from app.services.investment_record_basics import (
    build_normalized_transaction_view,
    decimal_to_str,
    normalize_import_text,
    normalize_import_whitespace,
    parse_decimal_text,
)
from app.services import investment_import as import_service


class InvestmentRecordBasicsTests(unittest.TestCase):
    def test_text_and_decimal_helpers(self) -> None:
        self.assertEqual(normalize_import_text("  abc  "), "abc")
        self.assertEqual(normalize_import_whitespace(" a   b\tc "), "a b c")
        self.assertEqual(decimal_to_str(Decimal("12.50")), "12.50")
        self.assertIsNone(decimal_to_str(None))

        warnings: list[str] = []
        self.assertEqual(
            parse_decimal_text("1,234.56", "amount", 3, warnings),
            Decimal("1234.56"),
        )
        self.assertEqual(warnings, [])
        self.assertIsNone(parse_decimal_text("-", "amount", 4, warnings))
        self.assertIsNone(parse_decimal_text("not-a-number", "price", 5, warnings))
        self.assertEqual(len(warnings), 1)
        self.assertIn("price", warnings[0])

    def test_normalized_view_trade_uses_accounting_adjustment_not_cash_flow(self) -> None:
        view = build_normalized_transaction_view(
            "buy",
            Decimal("-10"),
            Decimal("12.5"),
            Decimal("-125"),
            Decimal("1.25"),
            Decimal("-126.25"),
        )
        self.assertEqual(view["side"], "buy")
        self.assertEqual(view["position_quantity"], "-10")
        self.assertEqual(view["display_quantity"], "10")
        self.assertEqual(view["display_amount"], "125")
        self.assertEqual(view["is_cash_flow"], False)
        self.assertEqual(view["accounting_adjustment_amount"], "-126.25")
        self.assertNotIn("cash_flow_amount", view)

    def test_normalized_view_dividend_is_cash_flow(self) -> None:
        view = build_normalized_transaction_view(
            "dividend",
            None,
            None,
            Decimal("3.25"),
            None,
            Decimal("3.25"),
        )
        self.assertEqual(view["is_cash_flow"], True)
        self.assertEqual(view["cash_flow_amount"], "3.25")
        self.assertEqual(view["display_amount"], "3.25")
        self.assertNotIn("side", view)

    def test_import_service_reexports_same_normalized_semantics(self) -> None:
        """investment_import wrappers must stay behavior-identical to the shared helpers."""
        warnings: list[str] = []
        shared = parse_decimal_text("9.99", "price", 1, warnings)
        via_import = import_service._parse_decimal("9.99", "price", 1, [])
        self.assertEqual(shared, via_import)

        shared_view = build_normalized_transaction_view(
            "sell",
            Decimal("2"),
            Decimal("50"),
            Decimal("100"),
            Decimal("0"),
            Decimal("100"),
        )
        import_view = import_service._build_normalized_view(
            "sell",
            Decimal("2"),
            Decimal("50"),
            Decimal("100"),
            Decimal("0"),
            Decimal("100"),
        )
        self.assertEqual(shared_view, import_view)

    def test_side_override_replaces_default_side_inference(self) -> None:
        view = build_normalized_transaction_view(
            "buy",
            Decimal("1"),
            Decimal("10"),
            Decimal("10"),
            None,
            Decimal("10"),
            side_override="sell",
        )
        self.assertEqual(view["side"], "sell")
        self.assertEqual(view["is_cash_flow"], False)
        self.assertIn("accounting_adjustment_amount", view)
        self.assertNotIn("cash_flow_amount", view)

    def test_cash_flow_override_false_forces_accounting_adjustment_on_dividend(self) -> None:
        view = build_normalized_transaction_view(
            "dividend",
            None,
            None,
            Decimal("4.00"),
            None,
            Decimal("4.00"),
            is_cash_flow_override=False,
        )
        self.assertEqual(view["is_cash_flow"], False)
        self.assertEqual(view["accounting_adjustment_amount"], "4.00")
        self.assertNotIn("cash_flow_amount", view)

    def test_cash_flow_override_true_forces_cash_flow_amount_on_buy(self) -> None:
        view = build_normalized_transaction_view(
            "buy",
            Decimal("2"),
            Decimal("5"),
            Decimal("10"),
            None,
            Decimal("10"),
            is_cash_flow_override=True,
        )
        self.assertEqual(view["side"], "buy")
        self.assertEqual(view["is_cash_flow"], True)
        self.assertEqual(view["cash_flow_amount"], "10")
        self.assertNotIn("accounting_adjustment_amount", view)

    def test_fx_translation_pnl_remains_non_cash_flow_by_default(self) -> None:
        view = build_normalized_transaction_view(
            "fx_translation_pnl",
            None,
            None,
            Decimal("-1.25"),
            None,
            Decimal("-1.25"),
        )
        self.assertNotIn("side", view)
        self.assertEqual(view["is_cash_flow"], False)
        self.assertEqual(view["accounting_adjustment_amount"], "-1.25")
        self.assertNotIn("cash_flow_amount", view)
        self.assertEqual(view["display_amount"], "-1.25")


if __name__ == "__main__":
    unittest.main()
