"""
Self-checks for the unified workspace entry and migrated page layouts.

Code version: v1.3.9
"""

from __future__ import annotations

from pathlib import Path
import unittest
from unittest.mock import patch

from app import create_app
from app.models.schemas import SeriesPayload
from tests.factories.market import FakeStrategy, backtest_result, fetch_history_stub, quote_profile_stub


ROOT = Path(__file__).resolve().parents[1]
APP_JS = ROOT / "app/web/static/assets/js/app.js"
INVESTMENT_JS = ROOT / "app/web/static/assets/js/investment.js"
WORKSPACE_SHARE_JS = ROOT / "app/web/static/assets/js/workspace-share.js"
SETTINGS_JS = ROOT / "app/web/static/assets/js/settings.js"
BASE_HTML = ROOT / "app/web/templates/base.html"
SETTINGS_HTML = ROOT / "app/web/templates/settings.html"
MOTION_CSS = ROOT / "app/web/static/assets/css/foundation/motion.css"
SPINNER_SVG = ROOT / "app/web/static/images/loading.spinner.svg"
STYLE_TOKEN_ROWS = ROOT / "app/web/style_token_rows.py"
PRICE_COMPARE_JS = ROOT / "app/web/static/assets/js/price-compare.js"
SHELL_CSS = ROOT / "app/web/static/assets/css/layout/shell.css"
RESPONSIVE_CSS = ROOT / "app/web/static/assets/css/utilities/responsive.css"
WORKSPACE_CSS = ROOT / "app/web/static/assets/css/views/workspace.css"


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

    def test_price_range_modal_reuses_the_ticker_fetch_spinner(self) -> None:
        source = APP_JS.read_text(encoding="utf-8")

        self.assertIn(
            '"suggestion-loading-spinner workspace-modal-icon"',
            source,
        )
        price_loading_dialog = source.split("const showImmediateRangeLoadingDialog = () => {", 1)[1].split(
            "const showCompareOverlay", 1
        )[0]
        self.assertIn('title: "Updating price history"', price_loading_dialog)
        self.assertIn("loadingSpinner: true", price_loading_dialog)
        self.assertNotIn("showImmediateRangeLoadingDialog();\n            refreshSharedSelectField", source)
        self.assertIn(
            'if (["market-caps", "prices"].includes(state.currentView)) {',
            source,
        )
        can_auto_submit = source.split("const canAutoSubmit = () => {", 1)[1].split(
            "const scheduleAutoSubmit", 1
        )[0]
        self.assertNotIn("!hasInitialResult", can_auto_submit)

    def test_waiting_states_share_the_vector_ticker_spinner(self) -> None:
        app_source = APP_JS.read_text(encoding="utf-8")
        investment_source = INVESTMENT_JS.read_text(encoding="utf-8")
        share_source = WORKSPACE_SHARE_JS.read_text(encoding="utf-8")
        settings_source = SETTINGS_JS.read_text(encoding="utf-8")
        base_source = BASE_HTML.read_text(encoding="utf-8")
        settings_html = SETTINGS_HTML.read_text(encoding="utf-8")
        motion_source = MOTION_CSS.read_text(encoding="utf-8")
        spinner_source = SPINNER_SVG.read_text(encoding="utf-8")
        style_token_source = STYLE_TOKEN_ROWS.read_text(encoding="utf-8")

        self.assertIn(
            'workspaceModalOverlayIcon.className = "suggestion-loading-spinner workspace-modal-icon";',
            app_source,
        )
        self.assertNotIn('iconClass: "icon-', app_source)
        self.assertIn('class="suggestion-loading-spinner workspace-modal-icon"', base_source)
        self.assertIn("suggestion-loading-spinner", investment_source)
        self.assertIn('SHARE_RENDER_MODAL_ICON_CLASS = "suggestion-loading-spinner"', share_source)
        self.assertIn('"suggestion-loading-spinner"', settings_source)
        self.assertIn("suggestion-loading-spinner", settings_html)
        self.assertIn('"sample_icon_class": "suggestion-loading-spinner"', style_token_source)
        self.assertIn('mask: url("/static/images/loading.spinner.svg")', motion_source)
        self.assertIn('stroke-linecap="round"', spinner_source)
        self.assertNotIn("border: 2px solid", motion_source)

    def test_empty_price_history_does_not_request_live_data_without_tickers(self) -> None:
        source = PRICE_COMPARE_JS.read_text(encoding="utf-8")
        refresh_live_prices = source.split("const refreshLivePrices = async () => {", 1)[1].split(
            "bootstrap.initPriceCompareWorkspace", 1
        )[0]

        self.assertIn("if (tickers.length < 2) return;", refresh_live_prices)
        self.assertIn("tickers.forEach((ticker) => params.append(\"ticker\", ticker));", refresh_live_prices)


class WorkspaceMigrationTests(unittest.TestCase):
    maxDiff = None

    def setUp(self) -> None:
        self.client = create_app().test_client()

    def test_overlay_sidebar_dock_and_backtest_height_contracts(self) -> None:
        responsive_source = RESPONSIVE_CSS.read_text(encoding="utf-8")
        app_source = APP_JS.read_text(encoding="utf-8")
        shell_source = SHELL_CSS.read_text(encoding="utf-8")

        collapsed_dock_rule = responsive_source.split(
            ".app-shell.is-sidebar-collapsed ~ .sidebar-dock {",
            1,
        )[1].split("}", 1)[0]
        backtest_surface_rule = responsive_source.split(
            ".chart-surface.backtest-surface {",
            1,
        )[1].split("}", 1)[0]
        bottom_pad_logic = app_source.split(
            "const syncMobilePageBottomPadMetrics = (page) => {",
            1,
        )[1].split("const syncMobilePageBottomPadding", 1)[0]

        self.assertIn("opacity: 0", collapsed_dock_rule)
        self.assertIn("pointer-events: none", collapsed_dock_rule)
        self.assertIn("flex: 1 1 auto", backtest_surface_rule)
        self.assertIn("const endBottomPad = scrollBottomPad", bottom_pad_logic)
        self.assertNotIn("dockClearance", bottom_pad_logic)

        collapsed_motion = shell_source.split(
            ".app-shell.is-sidebar-collapsed ~ .sidebar-dock {",
            1,
        )[1].split("}", 1)[0]
        open_motion = shell_source.split(
            ".app-shell.is-sidebar-open ~ .sidebar-dock {",
            1,
        )[1].split("}", 1)[0]
        self.assertIn("translateY(8px)", collapsed_motion)
        self.assertIn("transition-delay: 90ms", collapsed_motion)
        self.assertIn("translateY(0)", open_motion)
        self.assertIn("transition-delay: 140ms", open_motion)

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
        self.assertIn("Market cap comparison", sidebar_html)
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
        market_cap_series = SeriesPayload(
            ticker="QQQ",
            dates=["1 Jan 2026", "2 Jan 2026"],
            raw_dates=["2026-01-01 00:00", "2026-01-02 00:00"],
            normalized_returns=[None, None],
            market_caps=[1_000_000_000.0, 1_100_000_000.0],
        )
        with (
            patch("app.web.runtime.fetch_history", side_effect=fetch_history_stub),
            patch("app.web.runtime.fetch_quote_profile", side_effect=quote_profile_stub),
            patch("app.web.runtime.record_ticker_usage"),
            patch("app.web.runtime.instantiate_strategy", return_value=FakeStrategy()),
            patch("app.web.runtime.run_single_ticker_backtest", return_value=backtest_result()),
            patch("app.web.runtime.record_strategy_usage"),
            patch("app.web.runtime.build_market_cap_series_payload", return_value=market_cap_series),
        ):
            responses = {
                "compare": self.client.get("/workspaces/compare?ticker=QQQ&ticker=AAPL&period=1y&dividends=1"),
                "market_caps": self.client.get("/workspaces/market-caps?ticker=QQQ&ticker=AAPL&period=1y"),
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
        market_cap_html = responses["market_caps"].get_data(as_text=True)
        self._assert_workspace_contract(
            market_cap_html,
            control_class='ticker-form-controls market-caps-controls',
        )
        market_cap_sidebar = _slice_between(
            market_cap_html,
            '<aside class="panel sidebar" id="app_sidebar">',
            "</aside>",
        )
        self.assertLess(market_cap_sidebar.index("Price performance"), market_cap_sidebar.index("Market cap comparison"))
        self.assertLess(market_cap_sidebar.index("Market cap comparison"), market_cap_sidebar.index("Compute your portfolio"))
        self.assertIn('"market_caps": [1000000000.0, 1100000000.0]', market_cap_html)
        self.assertIn('data-exact-range-date-grid', market_cap_html)
        self.assertIn('data-exact-single-date-grid', market_cap_html)
        self.assertIn('id="exact_start"', market_cap_html)
        self.assertIn('id="exact_end"', market_cap_html)
        self.assertNotIn('Market capitalization uses point-in-time shares without look-ahead.', market_cap_html)
        self.assertNotIn('notice-market-cap-method', market_cap_html)
        self.assertNotIn('notice-market-cap-method', WORKSPACE_CSS.read_text(encoding="utf-8"))
        self.assertNotIn('Historical market capitalization', market_cap_html)
        self.assertNotIn('class="workspace-method-note"', market_cap_html)
        self._assert_workspace_contract(
            responses["portfolio"].get_data(as_text=True),
            control_class='ticker-form-controls portfolio-controls',
        )
        self._assert_workspace_contract(
            responses["backtest"].get_data(as_text=True),
            control_class='ticker-controls trade-controls',
        )

    def test_comparison_workspace_memory_includes_market_cap_view(self) -> None:
        app_source = APP_JS.read_text(encoding="utf-8")
        self.assertIn('const comparisonViews = new Set(["tickers", "market-caps", "prices"]);', app_source)
        self.assertIn('path === "/workspaces/market-caps"', app_source)


if __name__ == "__main__":
    unittest.main()
