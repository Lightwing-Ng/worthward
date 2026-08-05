"""Route tests for the canonical Settings URL state contract.

Code version: v0.1.1
"""

from __future__ import annotations

import unittest
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


if __name__ == "__main__":
    unittest.main()
