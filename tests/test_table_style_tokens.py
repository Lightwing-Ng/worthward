"""Tests for standard table and shared-filter presentation contracts. Code version: v1.8.10."""

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
    assert "--shared-select-option-radius" in html
    assert "--scrollable-data-table-header-height" in html
    assert "--scrollable-data-table-summary-background" in html
    assert 'data-summary-scope="both"' in html


def test_shared_select_option_highlights_use_pill_geometry() -> None:
    project_root = Path(__file__).resolve().parents[1]
    forms_css = (
        project_root / "app/web/static/assets/css/components/forms.css"
    ).read_text(encoding="utf-8")

    option_rule = forms_css.split(
        "\n.trade-strategy-dropdown-option {", maxsplit=1
    )[1].split("}", maxsplit=1)[0]

    assert "border-radius: var(--shared-select-option-radius);" in option_rule


def test_investment_pagination_menu_uses_opaque_frosted_material() -> None:
    project_root = Path(__file__).resolve().parents[1]
    settings_css = (
        project_root / "app/web/static/assets/css/views/settings.css"
    ).read_text(encoding="utf-8")
    tokens_css = (
        project_root / "app/web/static/assets/css/foundation/tokens.css"
    ).read_text(encoding="utf-8")

    assert "--frosted-glass-opaque-background:" in tokens_css
    menu_rule = settings_css.split(
        ".local-store-pagination-range-menu {", maxsplit=1
    )[1].split("}", maxsplit=1)[0]
    assert (
        "background: var(--frosted-glass-opaque-background, "
        "var(--glass-popover-background));"
    ) in menu_rule


def test_pagination_range_menu_hides_the_scrollbar_track() -> None:
    project_root = Path(__file__).resolve().parents[1]
    settings_css = (
        project_root / "app/web/static/assets/css/views/settings.css"
    ).read_text(encoding="utf-8")

    menu_rule = settings_css.split(
        ".local-store-pagination-range-menu {", maxsplit=1
    )[1].split("}", maxsplit=1)[0]
    assert "overflow-y: auto;" in menu_rule
    assert "scrollbar-width: none;" in menu_rule
    assert "-ms-overflow-style: none;" in menu_rule
    assert "border-radius: 10px;" in menu_rule
    assert "scrollbar-gutter:" not in menu_rule
    assert "scrollbar-color:" not in menu_rule
    scrollbar_start = settings_css.index(
        ".local-store-pagination-range-menu::-webkit-scrollbar {"
    )
    scrollbar_rule = settings_css[
        scrollbar_start:settings_css.index("\n}", scrollbar_start)
    ]
    assert "width: 0;" in scrollbar_rule
    assert "height: 0;" in scrollbar_rule
    assert "background: transparent;" in scrollbar_rule
    track_start = settings_css.index(
        ".local-store-pagination-range-menu::-webkit-scrollbar-track {"
    )
    track_rule = settings_css[
        track_start:settings_css.index("\n}", track_start)
    ]
    assert "background: transparent;" in track_rule


def test_pagination_range_menu_respects_clipping_ancestors() -> None:
    """Keep the range menu inside the nearest scrollable workspace boundary."""
    project_root = Path(__file__).resolve().parents[1]
    script = (
        project_root / "app/web/static/assets/js/local-store-pagination.js"
    ).read_text(encoding="utf-8")

    for token in (
        "function getLocalStorePaginationRangeMenuClipBounds(picker)",
        "style.overflowX !== 'visible' || style.overflowY !== 'visible'",
        "const clipTop = Math.max(viewportInset, clipBounds.top);",
        "const clipBottom = Math.min(window.innerHeight - viewportInset, clipBounds.bottom);",
        "const spaceAbove = Math.max(0, pickerRect.top - clipTop - menuGap);",
        "const spaceBelow = Math.max(0, clipBottom - pickerRect.bottom - menuGap);",
    ):
        assert token in script


def test_investment_history_scroll_shell_keeps_rounded_bottom_corners() -> None:
    project_root = Path(__file__).resolve().parents[1]
    investment_css = (
        project_root / "app/web/static/assets/css/views/investment.css"
    ).read_text(encoding="utf-8")

    scroll_rule = investment_css.split(
        ".investment-history-table-shell > .investment-history-table-scroll {",
        maxsplit=1,
    )[1].split("}", maxsplit=1)[0]
    first_corner_rule = investment_css.split(
        ".investment-history-table-shell > .investment-history-table-scroll > "
        ".investment-history-table tbody tr:last-child > :first-child {",
        maxsplit=1,
    )[1].split("}", maxsplit=1)[0]
    last_corner_rule = investment_css.split(
        ".investment-history-table-shell > .investment-history-table-scroll > "
        ".investment-history-table tbody tr:last-child > :last-child {",
        maxsplit=1,
    )[1].split("}", maxsplit=1)[0]
    assert "border-radius: 0 0 10px 10px;" in scroll_rule
    assert "border-bottom-left-radius: 10px;" in first_corner_rule
    assert "border-bottom-right-radius: 10px;" in last_corner_rule


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
    assert "--investment-holdings-allocation-badge-glyph-width" in html
    assert "--investment-holdings-allocation-badge-radius" in html
    assert "--investment-holdings-allocation-badge-background-positive" in html
    assert "--investment-holdings-allocation-badge-background-negative" in html
    assert "--investment-holdings-allocation-badge-color" in html
    assert "--theme-muted-soft" in html
    assert "1.11%" in html
    assert "8.88%" in html


def test_color_tokens_settings_expose_paired_light_dark_rows_and_local_override_script() -> None:
    client = create_app().test_client()

    response = client.get("/settings/color-tokens")

    html = response.get_data(as_text=True)
    assert response.status_code == 200
    assert 'data-color-token-layout' in html
    assert 'data-color-token-group="positive-green"' in html
    assert 'data-color-token-name="--theme-accent-positive" data-color-token-mode="light"' in html
    assert 'data-color-token-name="--theme-accent-positive" data-color-token-mode="dark"' in html
    assert 'data-color-token-name="--theme-success"' in html
    assert 'value="#16a34a"' in html
    assert 'value="#2fff9c"' in html
    assert 'assets/js/color-tokens.js' in html
    assert 'href="/settings/color-tokens"' in html


def test_holdings_allocation_badge_uses_the_active_theme_background_for_text() -> None:
    project_root = Path(__file__).resolve().parents[1]
    investment_css = (
        project_root / "app/web/static/assets/css/views/investment.css"
    ).read_text(encoding="utf-8")
    badge_rule = investment_css.split(
        ".investment-holdings-allocation-badge {", maxsplit=1
    )[1].split("}", maxsplit=1)[0]

    assert "color: var(--theme-background);" in badge_rule
    assert "color: var(--investment-holdings-allocation-badge-color);" not in badge_rule


def test_neutral_holdings_badge_and_investment_hover_guides_share_soft_muted_gray() -> None:
    project_root = Path(__file__).resolve().parents[1]
    tokens_css = (
        project_root / "app/web/static/assets/css/foundation/tokens.css"
    ).read_text(encoding="utf-8")
    investment_css = (
        project_root / "app/web/static/assets/css/views/investment.css"
    ).read_text(encoding="utf-8")
    investment_js = (
        project_root / "app/web/static/assets/js/investment.js"
    ).read_text(encoding="utf-8")
    stock_details_js = (
        project_root / "app/web/static/assets/js/investment/stock-details.js"
    ).read_text(encoding="utf-8")

    assert "--theme-muted-soft: color-mix(in srgb, var(--theme-muted) 72%, var(--theme-background));" in tokens_css
    neutral_rule = investment_css.split(
        ".investment-holdings-daily-pnl-badge.investment-holdings-daily-pnl-badge-neutral {",
        maxsplit=1,
    )[1].split("}", maxsplit=1)[0]
    assert "background: var(--theme-muted-soft);" in neutral_rule
    assert "color: var(--theme-background);" in neutral_rule
    assert "mutedSoft: computed.getPropertyValue(\"--theme-muted-soft\").trim()" in investment_js
    assert "ctx.strokeStyle = resolvedTheme.mutedSoft;" in investment_js
    assert "ctx.strokeStyle = resolvedTheme.mutedSoft;" in stock_details_js


def test_style_tokens_portfolio_orbit_uses_four_distinct_mega_cap_logos() -> None:
    client = create_app().test_client()

    response = client.get("/settings/style-tokens")

    html = response.get_data(as_text=True)
    assert response.status_code == 200
    for ticker in ("AAPL", "GOOGL", "NVDA", "MSFT"):
        assert f'data-ticker="{ticker}"' in html
        assert f'src="/market-store/logos/{ticker}.svg"' in html


def test_style_tokens_portfolio_orbit_centers_logos_on_their_segments() -> None:
    client = create_app().test_client()

    response = client.get("/settings/style-tokens")

    html = response.get_data(as_text=True)
    assert response.status_code == 200
    for ticker, start, end, midpoint in (
        ("AAPL", "0", "159.84", "79.92"),
        ("GOOGL", "161.04", "249.84", "205.44"),
        ("NVDA", "251.04", "322.08", "286.56"),
        ("MSFT", "323.28", "358.8", "341.04"),
    ):
        logo = f'data-ticker="{ticker}"'
        assert f'{logo} data-style-token-donut-angle="{midpoint}"' in html
        assert f'{logo} data-style-token-donut-angle="{midpoint}" data-style-token-donut-segment-start="{start}" data-style-token-donut-segment-end="{end}"' in html


def test_style_tokens_modal_title_uses_shared_bold_weight() -> None:
    project_root = Path(__file__).resolve().parents[1]
    trade_css = (
        project_root / "app/web/static/assets/css/views/trade.css"
    ).read_text(encoding="utf-8")

    modal_title_rule = trade_css.split(
        ".style-token-modal-demo .workspace-modal-title {",
        maxsplit=1,
    )[1].split("}", maxsplit=1)[0]

    assert "font-weight: var(--font-weight-bold);" in modal_title_rule
    assert "font-weight: var(--font-weight-regular);" not in modal_title_rule


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


def test_investment_import_modal_uses_page_blur_and_standard_action_package() -> None:
    project_root = Path(__file__).resolve().parents[1]
    investment_css = (
        project_root / "app/web/static/assets/css/views/investment.css"
    ).read_text(encoding="utf-8")
    client = create_app().test_client()

    response = client.get("/trade/investment")
    html = response.get_data(as_text=True)

    assert response.status_code == 200
    assert 'id="investment_form"' in html
    assert 'data-card-shadow="false"' in html
    assert 'id="investment_import_close_button"' in html
    assert 'data-ibkr-calibration-table' in html
    assert 'id="ibkr_trade_notifications_cash"' in html
    assert 'id="investment_import_calibration_table_body"' in html
    assert 'class="investment-import-date-row"' in html
    assert 'aria-hidden="true">➋</span>' in html
    assert 'aria-hidden="true">➌</span>' in html
    assert 'class="settings-action-package settings-callout-card-primary investment-import-action-package"' in html
    assert 'class="settings-action-package-copy settings-callout-text"' in html
    assert '<p class="settings-service-name">Investment import</p>' in html
    assert '.investment-import-form[data-card-shadow="true"] {' in investment_css
    assert '.investment-import-form[data-card-shadow="false"] {' in investment_css
    assert "--investment-import-bridge-shadow: none;" in investment_css
    assert "--investment-import-action-package-shadow" not in investment_css
    assert ".investment-import-close-icon" in investment_css
    assert "body.is-investment-import-modal-open #toggle_form_button" in investment_css
    assert "body.is-investment-import-modal-open #sidebar_toggle" in investment_css
    assert "body.is-investment-import-modal-open #investment_section_resizer" in investment_css
    assert "body.is-investment-import-modal-open #global_quick_actions" in investment_css
    assert "position: sticky;" in investment_css
    assert "pointer-events: none;" in investment_css
    assert "border-radius: 10px;" in investment_css
    assert "inset: 0;" in investment_css
    assert "backdrop-filter: saturate(84%) blur(18px);" in investment_css
    assert "body.is-investment-import-modal-open" in investment_css
    assert ".investment-import-calibration-table" in investment_css
    assert "width: min(780px, calc(100vw - (var(--page-edge-pad) * 2)));" in investment_css
    assert ".investment-import-date-row" in investment_css
    assert ".investment-import-method-segmented[data-segmented-pill=\"measured\"]::before" in investment_css


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


def test_investment_compact_filters_share_the_type_hover_contract() -> None:
    project_root = Path(__file__).resolve().parents[1]
    tables_css = (
        project_root / "app/web/static/assets/css/components/tables.css"
    ).read_text(encoding="utf-8")
    investment_js = (
        project_root / "app/web/static/assets/js/investment.js"
    ).read_text(encoding="utf-8")

    assert "scrollable-data-table-filter-header" in investment_js
    assert "scrollable-data-table-filter-default-label" in investment_js
    assert "scrollable-data-table-filter-field" in investment_js
    assert "scrollable-data-table-filter-trigger" in investment_js
    assert ".scrollable-data-table-filter-header:hover .scrollable-data-table-filter-field" in tables_css
    assert ".scrollable-data-table-filter-header:focus-within .scrollable-data-table-filter-field" in tables_css
    assert ".scrollable-data-table-filter-header:hover .scrollable-data-table-filter-default-label" in tables_css
    assert ".scrollable-data-table-filter-trigger" in tables_css
    assert "font: inherit;" in tables_css.split(
        ".scrollable-data-table-filter-trigger {",
        1,
    )[1].split("}", 1)[0]
    assert ".scrollable-data-table-filter-trigger .trade-strategy-trigger-label" in tables_css
    assert "justify-content: center;" in tables_css.split(
        ".scrollable-data-table-filter-trigger .trade-strategy-trigger-label {",
        1,
    )[1].split("}", 1)[0]
    assert "font-size: var(--font-tooltip);" not in tables_css.split(
        ".scrollable-data-table-filter-trigger {",
        1,
    )[1].split("}", 1)[0]


def test_style_tokens_render_the_interactive_standard_table_filter_demo() -> None:
    client = create_app().test_client()

    response = client.get("/settings/style-tokens")

    html = response.get_data(as_text=True)
    assert response.status_code == 200
    assert 'data-style-token-card="scrollable-data-table"' in html
    assert 'data-style-token-table-filter-demo' in html
    assert 'data-table-interactive-header' in html
    assert 'data-style-token-table-filter-trigger' in html
    assert 'data-style-token-table-filter-option="buy"' in html
    assert 'data-style-token-table-filter-summary' in html
