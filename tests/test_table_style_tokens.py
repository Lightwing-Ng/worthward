"""Tests for standard table and shared-filter presentation contracts. Code version: v1.6.0."""

from __future__ import annotations

from pathlib import Path

from app import create_app


def test_settings_css_has_no_legacy_ibkr_gateway_selectors() -> None:
    project_root = Path(__file__).resolve().parents[1]
    settings_css = (
        project_root / "app/web/static/assets/css/views/settings.css"
    ).read_text(encoding="utf-8")

    assert "settings-ibkr-gateway" not in settings_css
    assert "settings-broker-guide" not in settings_css
    assert "settingsIbkrGatewayPulse" not in settings_css


def test_style_tokens_expose_shared_filter_and_complete_table_contract() -> None:
    client = create_app().test_client()

    response = client.get("/settings/style-tokens")

    html = response.get_data(as_text=True)
    assert response.status_code == 200
    assert 'id="shared-select-filter"' in html
    assert "--shared-select-option-padding" in html
    assert "--scrollable-data-table-header-height" in html
    assert "--scrollable-data-table-summary-background" in html
    assert 'data-summary-scope="both"' in html


def test_style_tokens_expose_the_action_package_live_marker_contract() -> None:
    client = create_app().test_client()

    response = client.get("/settings/style-tokens")

    html = response.get_data(as_text=True)
    assert response.status_code == 200
    assert 'data-style-token-action-package' in html
    assert 'data-style-token-action-package-live' in html
    assert 'data-action-package-live-marker' in html
    assert 'data-action-package-pending-copy' in html
    assert "--settings-action-package-live-marker-size" in html
    assert "--settings-action-package-live-marker-color" in html
    assert "--settings-action-package-live-marker-duration" in html


def test_style_tokens_expose_the_investment_holdings_allocation_badge_contract() -> None:
    client = create_app().test_client()

    response = client.get("/settings/style-tokens")

    html = response.get_data(as_text=True)
    assert response.status_code == 200
    assert 'data-style-token-card="investment-holdings-allocation-badge"' in html
    assert "style-token-holdings-allocation-badge-demo" in html
    assert "--investment-holdings-allocation-badge-inline-size" in html
    assert "--investment-holdings-allocation-badge-radius" in html
    assert "--investment-holdings-allocation-badge-background-positive" in html
    assert "--investment-holdings-allocation-badge-background-negative" in html
    assert "--investment-holdings-allocation-badge-color" in html


def test_style_tokens_portfolio_orbit_uses_four_distinct_mega_cap_logos() -> None:
    client = create_app().test_client()

    response = client.get("/settings/style-tokens")

    html = response.get_data(as_text=True)
    assert response.status_code == 200
    for ticker in ("AAPL", "GOOGL", "NVDA", "MSFT"):
        assert f'data-ticker="{ticker}"' in html
        assert f'src="/market-store/logos/{ticker}.svg"' in html


def test_investment_equity_range_uses_the_compact_segmented_control_contract() -> None:
    project_root = Path(__file__).resolve().parents[1]
    investment_css = (
        project_root / "app/web/static/assets/css/views/investment.css"
    ).read_text(encoding="utf-8")

    range_rule = investment_css.split(
        ".investment-stock-details-range-segmented {",
        1,
    )[1].split("}", 1)[0]

    for declaration in (
        "--mode-switch-pad: 2px;",
        "--mode-switch-gap: 2px;",
        "--mode-switch-min-height: 32px;",
        "--mode-switch-thumb-inset: 2px;",
        "--mode-switch-thumb-offset: 4px;",
        "--mode-switch-label-pad-inline: 8px;",
        "--mode-switch-label-min-height: 24px;",
        "--mode-switch-thumb-background: var(--accent-fill);",
    ):
        assert declaration in range_rule


def test_investment_table_header_is_interactive_and_body_is_measurable() -> None:
    client = create_app().test_client()

    response = client.get("/trade/investment")

    html = response.get_data(as_text=True)
    assert response.status_code == 200
    assert "data-table-interactive-header" in html
    assert 'aria-label="Side"' in html
    assert '<th aria-label="Side" data-markdown-export-label="Type">Type</th>' in html
    assert "data-table-body" in html
    assert 'aria-hidden="true"' not in html.split("investment-ledger-table", 1)[1].split("</table>", 1)[0]


def test_interactive_table_header_retains_standard_frosted_material() -> None:
    project_root = Path(__file__).resolve().parents[1]
    investment_css = (
        project_root / "app/web/static/assets/css/views/investment.css"
    ).read_text(encoding="utf-8")
    investment_js = (
        project_root / "app/web/static/assets/js/investment.js"
    ).read_text(encoding="utf-8")

    header_rule = investment_css.split(
        ".scrollable-data-table-shell > .scrollable-data-table[data-table-header],",
        1,
    )[1].split("}", 1)[0]
    assert "background: var(--frosted-glass-background);" in header_rule
    assert "backdrop-filter: var(--frosted-glass-blur);" in header_rule
    assert "border: var(--frosted-glass-border);" in header_rule
    assert "[data-table-header], table[aria-hidden=\"true\"]" in investment_js


def test_investment_holdings_body_omits_vertical_cell_borders() -> None:
    project_root = Path(__file__).resolve().parents[1]
    investment_css = (
        project_root / "app/web/static/assets/css/views/investment.css"
    ).read_text(encoding="utf-8")

    holdings_body_rule = investment_css.split(
        ".investment-holdings-table tbody td+td {",
        1,
    )[1].split("}", 1)[0]
    assert "border-left: 0;" in holdings_body_rule
    assert "var(--frosted-glass-border)" not in holdings_body_rule


def test_investment_type_filter_uses_progressive_disclosure() -> None:
    project_root = Path(__file__).resolve().parents[1]
    investment_css = (
        project_root / "app/web/static/assets/css/views/investment.css"
    ).read_text(encoding="utf-8")
    investment_js = (
        project_root / "app/web/static/assets/js/investment.js"
    ).read_text(encoding="utf-8")

    assert 'investment-side-filter-default-label" aria-hidden="true">Type<' in investment_js
    assert 'aria-label="Type filter: ${selectedLabel}"' in investment_js
    side_header_rule = investment_css.split(
        ".investment-history-side-filter-header {",
        1,
    )[1].split("}", 1)[0]
    default_label_rule = investment_css.split(
        ".investment-side-filter-default-label {",
        1,
    )[1].split("}", 1)[0]
    side_filter_rule = investment_css.split(
        ".investment-side-filter-field {",
        1,
    )[1].split("}", 1)[0]

    assert "padding: var(--scrollable-data-table-header-padding);" in side_header_rule
    assert "vertical-align: top;" in side_header_rule
    assert "position: static;" in default_label_rule
    assert "font: inherit;" in default_label_rule
    assert "text-align: inherit;" in default_label_rule
    assert "position: absolute;" in side_filter_rule
    assert ".investment-history-side-filter-header:hover .investment-side-filter-field" in investment_css
    assert ".investment-history-side-filter-header:focus-within .investment-side-filter-field" in investment_css
