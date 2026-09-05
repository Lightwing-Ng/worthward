"""Tests for standard table and shared-filter presentation contracts. Code version: v1.10.0."""

from __future__ import annotations

import re
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


def test_settings_general_option_uses_the_half_pixel_border_token() -> None:
    project_root = Path(__file__).resolve().parents[1]
    foundation_tokens = (
        project_root / "app/web/static/assets/css/foundation/tokens.css"
    ).read_text(encoding="utf-8")
    style_token_rows = (
        project_root / "app/web/style_token_rows.py"
    ).read_text(encoding="utf-8")

    expected = "0.5px solid color-mix(in srgb, var(--theme-text) 8%, transparent)"
    assert f"--settings-general-option-border: {expected};" in foundation_tokens
    assert f'raw_token("--settings-general-option-border", "{expected}")' in style_token_rows


def test_style_token_stepper_input_has_a_compact_demo_height_fallback() -> None:
    project_root = Path(__file__).resolve().parents[1]
    settings_css = (
        project_root / "app/web/static/assets/css/views/settings.css"
    ).read_text(encoding="utf-8")

    stepper_rule = settings_css.split(
        ".style-token-stepper-input {", 1
    )[1].split("}", 1)[0]
    assert "height: var(--strategy-param-control-height, 30px);" in stepper_rule
    assert "min-height: var(--strategy-param-control-height, 30px);" in stepper_rule


def test_style_tokens_expose_the_shared_switch_contract() -> None:
    project_root = Path(__file__).resolve().parents[1]
    tokens_css = (
        project_root / "app/web/static/assets/css/foundation/tokens.css"
    ).read_text(encoding="utf-8")
    workspace_css = (
        project_root / "app/web/static/assets/css/views/workspace.css"
    ).read_text(encoding="utf-8")
    style_token_rows = (
        project_root / "app/web/style_token_rows.py"
    ).read_text(encoding="utf-8")
    html = create_app().test_client().get("/settings/style-tokens").get_data(as_text=True)

    assert 'data-style-token-card="switch"' in html
    assert 'data-style-token-switch-demo' in html
    assert 'id="style_token_switch_demo"' in html
    assert 'data-style-token-switch-input' in html
    assert "Reinvest cash dividends" in html
    for token_name in (
        "--switch-width",
        "--switch-height",
        "--switch-track-background-checked",
        "--switch-thumb-offset",
    ):
        assert token_name in tokens_css
        assert token_name in workspace_css
        assert token_name in style_token_rows


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


def test_style_tokens_render_examples_inside_the_collapse_specimen() -> None:
    html = create_app().test_client().get("/settings/style-tokens").get_data(as_text=True)

    collapse_html = html.split('data-style-token-card="collapse"', 1)[1].split(
        'data-style-token-card="', 1
    )[0]
    assert 'data-style-token-collapse-example' in collapse_html
    assert "LSTM Price Field" in collapse_html
    assert ">8</span><span class=\"style-token-collapse-example-unit\">bars</span>" in collapse_html
    assert ">0.050</span>" in collapse_html
    assert ">60.0</span><span class=\"style-token-collapse-example-unit\">%</span>" in collapse_html


def test_style_token_shared_filter_demo_uses_the_shared_select_contract() -> None:
    client = create_app().test_client()

    response = client.get("/settings/style-tokens")

    html = response.get_data(as_text=True)
    assert response.status_code == 200
    demo_start = html.index('data-style-token-shared-select-demo')
    demo_html = html[demo_start:]
    assert 'data-shared-select-field' in demo_html
    assert 'data-shared-select-trigger' in demo_html
    assert 'data-shared-select-dropdown' in demo_html
    assert 'id="style_token_shared_select_demo"' in demo_html
    assert 'value="buy"' in demo_html
    assert 'value="sell"' in demo_html


def test_style_token_period_dropdown_demo_uses_the_standard_period_options() -> None:
    client = create_app().test_client()

    response = client.get("/settings/style-tokens")

    html = response.get_data(as_text=True)
    assert response.status_code == 200
    card_start = html.index('data-style-token-card="shared-select-dropdown"')
    next_card = html.find('data-style-token-card="', card_start + 1)
    card_html = html[card_start:next_card if next_card >= 0 else None]
    assert 'data-style-token-shared-select-dropdown-demo' in card_html
    assert 'id="style_token_shared_select_dropdown"' in card_html
    assert 'aria-label="Period: 1 year"' in card_html
    for value, label in (
        ("1d", "1 day"),
        ("3d", "3 days"),
        ("1w", "1 week"),
        ("1mo", "1 month"),
        ("3mo", "3 months"),
        ("6mo", "6 months"),
        ("1y", "1 year"),
        ("2y", "2 years"),
        ("3y", "3 years"),
        ("5y", "5 years"),
        ("10y", "10 years"),
        ("max", "Max"),
    ):
        assert f'<option value="{value}"' in card_html
        assert f'data-value="{value}"' in card_html
        assert label in card_html
    assert 'href="/settings/material-tokens#frosted-glass"' in card_html


def test_requested_style_token_components_link_to_frosted_glass() -> None:
    client = create_app().test_client()

    response = client.get("/settings/style-tokens")
    html = response.get_data(as_text=True)
    card_ids = (
        "circular-icon-button",
        "modal-dialog",
        "modal-dialog-banner-message",
            "scrollable-table",
        "segmented-control",
        "settings-action-package",
        "shared-select-filter",
        "shared-select-dropdown",
    )

    assert response.status_code == 200
    for card_id in card_ids:
        card_start = html.index(f'data-style-token-card="{card_id}"')
        next_card = html.find('data-style-token-card="', card_start + 1)
        card_html = html[card_start:next_card if next_card >= 0 else None]
        assert 'href="/settings/material-tokens#frosted-glass"' in card_html


def test_requested_shared_surfaces_use_the_canonical_frosted_glass_properties() -> None:
    project_root = Path(__file__).resolve().parents[1]
    forms_css = (
        project_root / "app/web/static/assets/css/components/forms.css"
    ).read_text(encoding="utf-8")
    tables_css = (
        project_root / "app/web/static/assets/css/components/tables.css"
    ).read_text(encoding="utf-8")
    settings_css = (
        project_root / "app/web/static/assets/css/views/settings.css"
    ).read_text(encoding="utf-8")
    tokens_css = (
        project_root / "app/web/static/assets/css/foundation/tokens.css"
    ).read_text(encoding="utf-8")

    segmented_rule = forms_css.split(
        ".segmented-control,\n.range-mode-shell {", 1
    )[1].split(".segmented-control::-webkit-scrollbar", 1)[0]
    shared_select_rule = forms_css.rsplit(
        ".backtest-shared-select-trigger {", 1
    )[1].split(".backtest-shared-select-trigger:hover", 1)[0]
    action_package_rule = settings_css.split(
        ".settings-action-package {", 1
    )[1].split(".settings-action-package-icon-shell", 1)[0]
    table_filter_rule = tables_css.split(
        ".scrollable-data-table-filter-trigger {", 1
    )[1].split("}", 1)[0]

    for rule in (shared_select_rule, table_filter_rule):
        assert "var(--frosted-glass-background" in rule
        assert "var(--frosted-glass-border)" in rule
        assert "var(--frosted-glass-shadow" in rule
        assert "var(--frosted-glass-blur)" in rule
    assert "var(--frosted-glass-background" in segmented_rule
    assert "border: 0;" in segmented_rule
    assert "var(--frosted-glass-shadow" in segmented_rule
    assert "var(--frosted-glass-blur)" in segmented_rule
    style_token_range_rule = settings_css.split(
        ".settings-shell-style-tokens .range-mode-shell {", 1
    )[1].split("}", 1)[0]
    assert "background: var(--control-glass-background);" in style_token_range_rule
    assert "saturate(200%) blur(26px)" in style_token_range_rule
    assert "linear-gradient" not in style_token_range_rule
    assert "background: var(--settings-action-package-background);" in action_package_rule
    assert "border: var(--settings-action-package-border);" in action_package_rule
    assert "box-shadow: var(--frosted-glass-shadow);" in action_package_rule
    assert "backdrop-filter: var(--frosted-glass-blur);" in action_package_rule
    assert "--settings-action-package-background: var(--frosted-glass-background);" in tokens_css
    assert "--settings-action-package-border: var(--frosted-glass-border);" in tokens_css


def test_style_token_reference_links_share_the_value_text_alignment_contract() -> None:
    project_root = Path(__file__).resolve().parents[1]
    settings_css = (
        project_root / "app/web/static/assets/css/views/settings.css"
    ).read_text(encoding="utf-8")

    link_rule = settings_css.split(
        ".style-token-value-link {", 1
    )[1].split("}", 1)[0]
    value_text_rule = settings_css.split(
        ".style-token-value-text {", 1
    )[1].split("}", 1)[0]
    related_value_rule = settings_css.split(
        ".style-token-related-value {", 1
    )[1].split("}", 1)[0]

    for declaration in (
        "padding-right: calc(var(--strategy-stepper-width) + 8px);",
        "text-align: right;",
    ):
        assert declaration in link_rule
        assert declaration in value_text_rule
        assert declaration in related_value_rule
    for declaration in (
        "display: block;",
        "width: 100%;",
        "box-sizing: border-box;",
    ):
        assert declaration in value_text_rule
        assert declaration in related_value_rule


def test_style_tokens_are_alphabetized_without_the_shared_primitives_specimen() -> None:
    client = create_app().test_client()

    response = client.get("/settings/style-tokens")

    html = response.get_data(as_text=True)
    titles = [
        fragment.split("</p>", maxsplit=1)[0]
        for fragment in html.split('<p class="style-token-title">')[1:]
    ]
    assert response.status_code == 200
    assert titles == sorted(titles, key=str.casefold)
    assert 'data-style-token-card="tooltip"' in html
    assert '<p class="style-token-title">Tooltip</p>' in html
    assert "chart tooltip" not in html.casefold()
    assert 'data-style-token-card="pagination"' in html
    assert '<p class="style-token-title">Pagination</p>' in html
    assert "local store pagination" not in html.casefold()
    assert 'data-style-token-card="shared-style-primitives"' not in html
    assert '<p class="style-token-title">Shared style primitives</p>' not in html
    assert 'style-token-inventory-demo' not in html
    assert 'data-active="overview" data-option-count="3"' in html
    assert 'data-segmented-pill="measured"' in html
    assert 'value="overview" checked' in html
    assert 'value="details"' in html
    assert 'value="metrics"' in html
    assert 'data-style-token-card="primary-button"' in html
    assert 'class="settings-inline-button settings-inline-button-primary"' in html
    assert 'data-pagination-page-count="64"' in html
    assert 'data-pagination-current-page="23"' in html
    assert 'class="local-store-page-button local-store-page-nav"' in html
    assert 'icon-page-prev' in html
    assert 'icon-page-next' in html
    assert html.count('class="local-store-page-ellipsis"') >= 2
    assert '>21</span>' in html
    assert '>22</span>' in html
    assert '>23</span>' in html
    assert '>24</span>' in html
    assert '>25</span>' in html
    assert '>64</span>' in html


def test_shared_segmented_and_pagination_controls_use_regular_unselected_weight() -> None:
    project_root = Path(__file__).resolve().parents[1]
    forms_css = (project_root / "app/web/static/assets/css/components/forms.css").read_text(encoding="utf-8")
    settings_css = (project_root / "app/web/static/assets/css/views/settings.css").read_text(encoding="utf-8")

    segmented_rule_start = forms_css.index(".segmented-control-option span,")
    segmented_rule_end = forms_css.index(".segmented-control[data-segmented-pill=", segmented_rule_start)
    segmented_rule = forms_css[segmented_rule_start:segmented_rule_end]
    selected_rule_start = forms_css.index(".segmented-control-option input:checked + span,")
    selected_rule_end = forms_css.index(".range-mode-shell > .segmented-control-option input:checked + span", selected_rule_start)
    selected_rule = forms_css[selected_rule_start:selected_rule_end]
    pagination_rule_start = settings_css.index("\n.local-store-page-button {\n") + 1
    pagination_rule_end = settings_css.index(".local-store-page-button.is-active {", pagination_rule_start)
    pagination_rule = settings_css[pagination_rule_start:pagination_rule_end]
    assert "font-weight: var(--font-weight-regular);" in segmented_rule
    assert "font-weight: var(--font-weight-bold);" in selected_rule
    assert "font-weight: var(--font-weight-regular);" in pagination_rule


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
    assert "border-radius: var(--radius-soft);" in menu_rule
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
    assert "border-radius: 0 0 var(--radius-panel) var(--radius-panel);" in scroll_rule
    assert "border-bottom-left-radius: var(--radius-panel);" in first_corner_rule
    assert "border-bottom-right-radius: var(--radius-panel);" in last_corner_rule


def test_ordinary_ten_pixel_radii_use_foundation_tokens() -> None:
    project_root = Path(__file__).resolve().parents[1]
    css_root = project_root / "app/web/static/assets/css"
    foundation_tokens = css_root / "foundation/tokens.css"
    literal_radius_pattern = re.compile(
        r"(?m)^\s*(?:--[a-z0-9_-]*radius|border(?:-[a-z]+)*-radius)"
        r"\s*:[^;\n]*\b10px\b"
    )

    violations = []
    for css_path in sorted(css_root.rglob("*.css")):
        if css_path == foundation_tokens:
            continue
        css_text = css_path.read_text(encoding="utf-8")
        for match in literal_radius_pattern.finditer(css_text):
            line_number = css_text.count("\n", 0, match.start()) + 1
            violations.append(f"{css_path}:{line_number}: {match.group(0).strip()}")

    assert violations == []


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


def test_investment_ranges_reuse_the_investment_view_segmented_control_contract() -> None:
    project_root = Path(__file__).resolve().parents[1]
    investment_js = (
        project_root / "app/web/static/assets/js/investment.js"
    ).read_text(encoding="utf-8")
    investment_css = (
        project_root / "app/web/static/assets/css/views/investment.css"
    ).read_text(encoding="utf-8")

    assert (
        "'segmented-control--compact investment-view-segmented "
        "investment-stock-details-range-segmented'"
    ) in investment_js
    assert "<span>${option.label}</span>" in investment_js
    assert "investment-stock-details-range-label" not in investment_js
    assert ".investment-stock-details-range-segmented {" not in investment_css
    assert ".investment-stock-details-range-shell > .segmented-control" in investment_css
    assert "pointer-events: auto" in investment_css


def test_blue_pill_variants_reuse_the_segmented_thumb_background_token() -> None:
    project_root = Path(__file__).resolve().parents[1]
    forms_css = (
        project_root / "app/web/static/assets/css/components/forms.css"
    ).read_text(encoding="utf-8")
    workspace_css = (
        project_root / "app/web/static/assets/css/views/workspace.css"
    ).read_text(encoding="utf-8")
    trade_css = (
        project_root / "app/web/static/assets/css/views/trade.css"
    ).read_text(encoding="utf-8")
    investment_css = (
        project_root / "app/web/static/assets/css/views/investment.css"
    ).read_text(encoding="utf-8")

    assert "background: var(--mode-switch-thumb-background);" in forms_css
    switch_rule = workspace_css.split(
        ".ios-switch-shell input:checked + .ios-switch-slider {", 1
    )[1].split("}", 1)[0]
    trade_detail_rule = trade_css.split(
        ".trade-detail-shell::before {", 1
    )[1].split("}", 1)[0]
    live_buy_rule = investment_css.split(
        '.live-trading-side-segmented[data-active="buy"]::before {', 1
    )[1].split("}", 1)[0]

    assert "background: var(--switch-track-background-checked);" in switch_rule
    for rule in (trade_detail_rule, live_buy_rule):
        assert "background: var(--mode-switch-thumb-background);" in rule
    assert "background: #0055cc;" not in live_buy_rule


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
    assert 'data-ibkr-calibration-table' not in html
    assert 'id="ibkr_trade_notifications_cash"' not in html
    assert 'id="investment_import_calibration_table_body"' not in html
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
    assert "border-radius: var(--radius-soft);" in investment_css
    assert "inset: 0;" in investment_css
    assert "backdrop-filter: saturate(84%) blur(18px);" in investment_css
    assert "body.is-investment-import-modal-open" in investment_css
    assert 'id="ibkr_holdings_paste_button"' in html
    assert 'id="ibkr_holdings_text"' in html
    assert ".investment-import-calibration-table" not in investment_css
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
    assert 'data-style-token-card="scrollable-table"' in html
    assert '<p class="style-token-title">Scrollable table</p>' in html
    assert "scrollable data table" not in html.casefold()
    assert 'data-style-token-table-filter-demo' in html
    assert 'data-table-interactive-header' in html
    assert 'data-style-token-table-filter-trigger' in html
    assert 'data-style-token-table-filter-option="buy"' in html
    assert 'data-style-token-table-filter-summary' in html
    assert 'local-store-pagination-host style-token-table-demo' in html
    assert 'data-style-token-table-page-size="6"' in html
    assert 'data-style-token-table-pagination' in html
    assert 'data-table-header' in html
    assert 'data-table-body' in html
    assert html.count('data-style-token-table-demo-row') == 12
