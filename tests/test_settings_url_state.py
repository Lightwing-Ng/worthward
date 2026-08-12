"""Route tests for the canonical Settings URL state contract.

Code version: v0.3.0
"""

from __future__ import annotations

import unittest
from pathlib import Path
from unittest.mock import patch

from app import create_app


class SettingsUrlStateRouteTests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = create_app().test_client()

    def test_legacy_settings_root_state_redirects_to_the_canonical_location(self) -> None:
        response = self.client.get(
            "/settings?section=general&language_tab=history&language_page=2",
        )

        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.headers["Location"], "/settings/general?tab=history&page=2")

    def test_legacy_section_tab_and_page_aliases_are_normalized(self) -> None:
        response = self.client.get(
            "/settings/general?settings_tab=history&local_page=2&unused=drop",
        )

        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.headers["Location"], "/settings/general?tab=history&page=2")

    def test_default_page_is_omitted_for_local_market_store(self) -> None:
        response = self.client.get("/settings/local-market-store?local_page=1")

        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.headers["Location"], "/settings/local-market-store")

    def test_general_history_tab_is_server_rendered_from_the_canonical_url(self) -> None:
        response = self.client.get("/settings/general?tab=history")

        self.assertEqual(response.status_code, 200)
        body = response.get_data(as_text=True)
        self.assertIn(
            'class="settings-language-tab segmented-control-option is-active" data-language-tab="history"',
            body,
        )
        self.assertIn('data-language-panel="history"', body)
        self.assertNotIn(
            'class="settings-language-tab segmented-control-option is-active" data-language-tab="current"',
            body,
        )

    def test_investment_settings_exposes_the_default_lot_matching_select(self) -> None:
        with patch(
            "app.web.runtime.load_investment_cost_basis_method",
            return_value="lowest_cost_first",
        ):
            response = create_app().test_client().get("/settings/investment")

        self.assertEqual(response.status_code, 200)
        body = response.get_data(as_text=True)
        self.assertIn('name="investment_cost_basis_method"', body)
        self.assertIn(
            '<option value="lowest_cost_first"',
            body,
        )
        self.assertIn(
            '<option value="lowest_cost_first" data-description="Match sells against the lowest-cost open lots first. This is the default strategy-attribution method." selected>',
            body,
        )

    def test_cash_equivalent_settings_separates_listed_securities_and_money_market_funds(self) -> None:
        with patch(
            "app.web.runtime.load_cash_equivalent_tickers",
            return_value=["BOXX", "SGOV"],
        ):
            response = create_app().test_client().get("/settings/cash-equivalents")

        self.assertEqual(response.status_code, 200)
        body = response.get_data(as_text=True)
        self.assertIn('data-cash-equivalent-category="stocks"', body)
        self.assertIn('data-cash-equivalent-category="funds"', body)
        self.assertIn('data-ticker="BOXX"', body)
        self.assertIn('data-ticker="SGOV"', body)
        for ticker in (
            "005276756",
            "HK0000369196",
            "HK0000478872",
            "HK0000584737",
            "HK0000584752",
            "HK0000720752",
            "HK0001039582",
        ):
            self.assertIn(f'data-fund-ticker="{ticker}"', body)
        self.assertEqual(body.count('data-fund-ticker="'), 7)
        self.assertEqual(body.count("investment-cash-equivalent-token-logo"), 7)
        self.assertNotIn("investment-money-market-fund-token-logo", body)
        self.assertNotIn('class="ticker-remove cash-equiv-remove" aria-label="Remove HK000', body)
        self.assertNotIn("Cash equivalents appear with the cash allocation", body)
        self.assertNotIn("Defaults: BOXX, SGOV", body)
        self.assertNotIn("Money-market funds are included automatically", body)
        stocks_start = body.index('data-cash-equivalent-category="stocks"')
        funds_start = body.index('data-cash-equivalent-category="funds"')
        stocks_markup = body[stocks_start:funds_start]
        self.assertLess(
            stocks_markup.index('class="cash-equivalent-category-heading"'),
            stocks_markup.index('id="cash_equivalents_add_action_shell"'),
        )
        self.assertLess(
            stocks_markup.index('id="cash_equivalents_add_action_shell"'),
            stocks_markup.index('id="cash_equivalents_list"'),
        )

    def test_cash_equivalent_groups_are_isolated_from_workspace_grid_columns(self) -> None:
        css = Path("app/web/static/assets/css/views/settings.css").read_text(encoding="utf-8")

        self.assertRegex(
            css,
            r"\.cash-equivalents-card\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column",
        )
        self.assertRegex(
            css,
            r"\.cash-equivalent-category\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column",
        )
        self.assertRegex(
            css,
            r"\.investment-cash-equivalent-token-logo,\s*"
            r"\.cash-equivalents-card .*\.investment-money-market-fund-token-logo\s*"
            r"\{[^}]*dollarsign\.ring\.svg",
        )


if __name__ == "__main__":
    unittest.main()
