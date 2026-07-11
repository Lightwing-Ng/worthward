"""
Self-checks for the unified workspace entry and migrated page layouts.

Code version: v1.1.1
"""

from __future__ import annotations

from pathlib import Path
import unittest
from unittest.mock import patch

from app import create_app
from tests.factories.market import FakeStrategy, backtest_result, fetch_history_stub, quote_profile_stub


ROOT = Path(__file__).resolve().parents[1]
APP_JS = ROOT / "app/web/static/assets/js/app.js"
SETTINGS_JS = ROOT / "app/web/static/assets/js/settings.js"
SHELL_CSS = ROOT / "app/web/static/assets/css/layout/shell.css"


def _slice_between(html: str, start_marker: str, end_marker: str) -> str:
    return html.split(start_marker, 1)[1].split(end_marker, 1)[0]


class OptimisticNavigationTests(unittest.TestCase):
    def test_navigation_registry_covers_every_route_profile(self) -> None:
        source = APP_JS.read_text(encoding="utf-8")

        for view in ("tickers", "portfolio", "dca", "backtest"):
            self.assertIn(f"{view}: {{title:", source)

        for section in (
            "about",
            "backtest",
            "broker-access",
            "cash-equivalents",
            "clear-caches",
            "email-smtp",
            "export-image",
            "font-tokens",
            "general",
            "local-market-store",
            "material-tokens",
            "network",
            "strategies",
            "style-tokens",
        ):
            has_profile = (
                f'{section}: {{title:' in source
                or f'"{section}": {{title:' in source
            )
            self.assertTrue(has_profile, section)

        self.assertIn('investment: {title: "Investment"}', source)
        self.assertIn('"live-trading": {title: "Live trading"}', source)

    def test_settings_navigation_uses_shared_skeleton_lifecycle(self) -> None:
        source = SETTINGS_JS.read_text(encoding="utf-8")

        self.assertIn(
            'renderOptimisticNavigationSkeleton({view: "settings", section: targetSection});',
            source,
        )
        self.assertIn(
            'renderOptimisticNavigationSkeleton({view: "settings", section});',
            source,
        )
        self.assertGreaterEqual(source.count("clearOptimisticNavigationSkeleton();"), 2)

    def test_navigation_skeleton_has_no_full_page_glass_or_blur(self) -> None:
        source = SHELL_CSS.read_text(encoding="utf-8")
        skeleton_css = source.split(".navigation-skeleton-root", 1)[1].split(
            "[data-workspace-mask]",
            1,
        )[0]

        self.assertNotIn(".workspace.panel::after", source)
        self.assertNotIn("body.is-page-navigating .workspace", source)
        self.assertNotIn("backdrop-filter", skeleton_css)
        self.assertNotIn("filter: blur", skeleton_css)
        self.assertIn("border-radius: var(--radius-soft)", skeleton_css)
        self.assertIn("navigation-skeleton-sheen", skeleton_css)

    def test_local_progressive_glass_masks_remain_available(self) -> None:
        source = SHELL_CSS.read_text(encoding="utf-8")

        self.assertIn(
            "body.is-workspace-switching [data-workspace-mask].is-masked-during-switch::after",
            source,
        )
        self.assertIn("backdrop-filter: var(--glass-mask-blur)", source)
        self.assertIn('data-workspace-mask="trade-metric"', source)


class WorkspaceMigrationTests(unittest.TestCase):
    maxDiff = None

    def setUp(self) -> None:
        self.client = create_app().test_client()

    def _assert_workspace_contract(self, html: str, *, control_class: str) -> None:
        sidebar_html = _slice_between(
            html,
            '<aside class="panel sidebar" id="app_sidebar">',
            "</aside>",
        )
        workspace_html = _slice_between(
            html,
            '<section class="panel chart-panel workspace" id="workspace_panel">',
            "</section>\n    </div>",
        )
        dock_html = _slice_between(
            html,
            '<nav class="sidebar-dock" aria-label="Workspace modes">',
            "</nav>",
        )

        self.assertIn('aria-label="Workspace sections"', sidebar_html)
        self.assertIn("Return comparison", sidebar_html)
        self.assertIn("Price performance", sidebar_html)
        self.assertIn("Compute your portfolio", sidebar_html)
        self.assertIn("Backtest", sidebar_html)
        self.assertNotIn('<form class="controls sidebar-form', sidebar_html)

        self.assertIn('class="workspace-mode-layout"', workspace_html)
        self.assertIn('class="chart-surface workspace-mode-controls-surface"', workspace_html)
        self.assertIn('workspace-mode-results-stack', workspace_html)
        self.assertIn(control_class, workspace_html)

        self.assertIn('aria-label="Workspace"', dock_html)
        self.assertIn('data-tooltip="Workspace"', dock_html)
        self.assertEqual(dock_html.count('class="sidebar-dock-item'), 3)
        self.assertNotIn('data-tooltip="Compare stocks"', dock_html)
        self.assertNotIn('data-tooltip="Compute your portfolio"', dock_html)
        self.assertNotIn('data-tooltip="Backtest"', dock_html)

    def test_compare_portfolio_and_backtest_pages_keep_controls_inside_workspace(self) -> None:
        with (
            patch("app.web.runtime.fetch_history", side_effect=fetch_history_stub),
            patch("app.web.runtime.fetch_quote_profile", side_effect=quote_profile_stub),
            patch("app.web.runtime.record_ticker_usage"),
            patch("app.web.runtime.instantiate_strategy", return_value=FakeStrategy()),
            patch("app.web.runtime.run_single_ticker_backtest", return_value=backtest_result()),
            patch("app.web.runtime.record_strategy_usage"),
        ):
            responses = {
                "compare": self.client.get("/workspaces/compare?ticker=QQQ&ticker=AAPL&period=1y&dividends=1"),
                "portfolio": self.client.get("/workspaces/portfolio?ticker=NVDA&ticker=AAPL&weight=60&weight=40&period=1y&dividends=1"),
                "backtest": self.client.get("/workspaces/backtest?ticker=QQQ&strategy=buy-and-hold&period=1y&capital=10000"),
            }

        self.assertEqual(
            {name: response.status_code for name, response in responses.items()},
            {name: 200 for name in responses},
        )

        self._assert_workspace_contract(
            responses["compare"].get_data(as_text=True),
            control_class='ticker-form-controls tickers-controls',
        )
        self._assert_workspace_contract(
            responses["portfolio"].get_data(as_text=True),
            control_class='ticker-form-controls portfolio-controls',
        )
        self._assert_workspace_contract(
            responses["backtest"].get_data(as_text=True),
            control_class='ticker-controls trade-controls',
        )


if __name__ == "__main__":
    unittest.main()
