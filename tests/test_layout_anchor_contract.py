"""Static contract tests for the shared spatial layout system.

Code version: v0.3.1
"""

from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
ASSET_ROOT = PROJECT_ROOT / "app/web/static/assets"
TEMPLATE_ROOT = PROJECT_ROOT / "app/web/templates"


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def test_shell_anchors_are_tokenized_and_redundantly_constrained() -> None:
    tokens = _read(ASSET_ROOT / "css/foundation/tokens.css")
    shell = _read(ASSET_ROOT / "css/layout/shell.css")
    trade = _read(ASSET_ROOT / "css/views/trade.css")
    responsive = _read(ASSET_ROOT / "css/utilities/responsive.css")

    for fragment in (
        "--page-edge-pad: 10px;",
        "--layout-edge-gap: var(--page-edge-pad);",
        "--layout-global-anchor-inset: calc(var(--layout-edge-gap) * 2);",
        "--layout-glass-border-width: 1px;",
        "--workspace-mode-result-heading-gap: 8px;",
        "--global-quick-actions-right: var(--layout-global-anchor-inset);",
        "--sidebar-overlay-toggle-inset: max(var(--sidebar-overlay-inset-top), var(--sidebar-overlay-inset-right));",
        "--layout-sidebar-dock-bottom-gap: var(--layout-edge-gap);",
        "--sidebar-dock-bottom-gap: var(--layout-sidebar-dock-bottom-gap);",
        "--layout-sidebar-dock-block-size: calc(",
        "--layout-sidebar-overlay-inline-size: min(",
    ):
        assert fragment in tokens

    for fragment in (
        "padding: var(--layout-edge-gap) var(--layout-edge-gap) var(--sidebar-bottom-pad);",
        "top: var(--layout-global-anchor-inset);",
        "--global-quick-action-gap: var(--layout-global-action-gap);",
    ):
        assert fragment in shell

    for fragment in (
        "padding-block: var(--layout-sidebar-dock-padding-block);",
        "height: var(--layout-sidebar-dock-item-block-size);",
    ):
        assert fragment in trade

    for fragment in (
        "--settings-round-icon-button-size: 44px;",
        "--workspace-mode-result-heading-lift: calc(var(--workspace-title-rail-height) + var(--workspace-mode-result-heading-gap));",
        "--layout-global-action-inline-size: calc(",
        "--layout-sidebar-overlay-inline-size: min(",
        "--sidebar-toggle-x: calc(",
        "top: var(--layout-global-anchor-inset);",
        "left: calc(var(--sidebar-overlay-inset-left) + (var(--layout-sidebar-overlay-inline-size) / 2)) !important;",
        "--layout-sidebar-dock-block-size: calc(",
    ):
        assert fragment in responsive

    assert "--sidebar-toggle-top: 20px;" not in responsive
    assert "--sidebar-toggle-left: 20px;" not in responsive


def test_compare_share_and_date_rows_use_the_same_summary_grid() -> None:
    stylesheet = _read(ASSET_ROOT / "css/views/investment.css")
    share_script = _read(ASSET_ROOT / "js/workspace-share.js")

    for fragment in (
        "padding-block-start: calc(var(--settings-round-icon-button-size) + var(--layout-global-action-gap));",
        "right: var(--layout-edge-gap);",
        "#compare_summary_panel > .compare-summary-date-range {",
        "margin-inline-start: var(--workspace-article-pad-inline);",
    ):
        assert fragment in stylesheet

    summary_branch = share_script[share_script.index('dataset.sharePlacement === "summary-panel"'):]
    summary_branch = summary_branch[:summary_branch.index('dataset.sharePlacement === "summary-heading"')]
    assert 'drawer.style.removeProperty("top");' in summary_branch
    assert "drawer.style.top =" not in summary_branch


def test_portfolio_uses_a_single_line_short_title() -> None:
    portfolio = _read(TEMPLATE_ROOT / "portfolio.html")
    navigation = _read(TEMPLATE_ROOT / "_workspace_mode_nav.html")

    assert '<p class="report-heading">Portfolio</p>' in portfolio
    assert '<section class="workspace-mode-shell portfolio-workspace">' in portfolio
    workspace = _read(ASSET_ROOT / "css/views/workspace.css")
    assert ".portfolio-workspace .workspace-mode-results-stack > .chart-surface {" in workspace
    assert "padding-inline: var(--workspace-article-pad-inline);" in workspace
    assert "labels.dock_portfolio" in navigation


def test_portfolio_result_owns_date_and_share_action() -> None:
    portfolio = _read(TEMPLATE_ROOT / "portfolio.html")
    workspace = _read(ASSET_ROOT / "css/views/workspace.css")

    heading_block = portfolio[portfolio.index('<div class="report-heading-row workspace-result-heading-stack">') :]
    heading_block = heading_block[: heading_block.index("</div>")]
    assert "{{ display_range }}" not in heading_block
    assert '<div class="portfolio-summary-main">' in portfolio
    assert '<p class="portfolio-summary-range workspace-result-date-range">{{ display_range }}</p>' in portfolio
    assert "placement='summary-panel'" in portfolio

    for fragment in (
        ".portfolio-workspace .workspace-mode-main > .workspace-header {",
        "width: min(100%, var(--layout-content-width));",
        "max-width: var(--layout-content-width);",
        ".portfolio-summary-content-card {\n    overflow: visible;\n}",
        "#portfolio_summary_region > .investment-share-actions[data-share-placement=\"summary-panel\"] {",
        "right: var(--layout-edge-gap);",
    ):
        assert fragment in workspace


def test_broker_feedback_uses_the_copy_column_and_own_layout_row() -> None:
    settings_css = _read(ASSET_ROOT / "css/views/settings.css")
    app_css = _read(ASSET_ROOT / "css/app.css")

    for fragment in (
        "grid-column: 1 / -1;\n    grid-row: 3;",
        "display: grid;\n    grid-template-columns: 36px minmax(0, 1fr);",
        "column-gap: var(--settings-action-package-column-gap);\n    width: 100%;",
        "max-width: 100%;\n    min-width: 0;",
        "margin: 0;\n    justify-self: stretch;",
        ".settings-broker-test-feedback-icon {",
        "grid-column: 1;\n    align-self: start;\n    justify-self: center;",
        "grid-column: 2;\n    min-width: 0;",
        ".settings-action-package:has(.settings-service-name):has([data-broker-test-feedback]:not([hidden]))",
        "grid-template-rows: auto auto auto auto;",
        ".settings-action-package:has(.settings-service-name):has([data-broker-test-feedback]:not([hidden])) .settings-action-package-form",
        "grid-row: 4;",
        "overflow-wrap: anywhere;\n    word-break: break-word;",
    ):
        assert fragment in settings_css

    assert '@import url("./views/settings.css?v=0.25.0");' in app_css
    assert '@import url("./foundation/tokens.css?v=0.24.0");' in app_css
    assert "v0.58.0" in app_css


def test_bayesian_backtest_reserves_a_readable_fresh_narrow_chart_stage() -> None:
    tokens = _read(ASSET_ROOT / "css/foundation/tokens.css")
    trade_css = _read(ASSET_ROOT / "css/views/trade.css")
    backtest_script = _read(ASSET_ROOT / "js/backtest.js")
    backtest_layout = _read(ASSET_ROOT / "js/backtest/layout.js")
    probability_grid = _read(ASSET_ROOT / "js/backtest/probability-grid.js")
    backtest_template = _read(TEMPLATE_ROOT / "backtest.html")

    for fragment in (
        '.classList.toggle("has-probability-field", Boolean(strategyPresentation))',
        '.classList.remove("has-probability-field")',
        'probabilityScrollSpacer.className = "backtest-probability-scroll-spacer";',
        'probabilityScrollTarget = Math.ceil(Math.max(0, Number(targetValue) || 0));',
        'tradeChartStack.dataset.probabilityPanMotion = "shared-bouncy-spring";',
        "const motion = window.AntigravityMotion;",
        "const preset = motion.springPresets?.bouncy || {",
        '"backtest-probability-scroll",',
        "x: canvasRect.left - stackRect.left + tradeChartStack.scrollLeft + point.x,",
        "const canvasOffsetX = canvasRect.left - stackRect.left + tradeChartStack.scrollLeft;",
        "setProbabilityScrollTarget(tooltipContentRight - tradeChartStack.clientWidth);",
        'tradeChartStack.classList.remove("has-probability-field", "has-probability-scroll");',
    ):
        assert fragment in backtest_script

    for fragment in (
        "--backtest-probability-narrow-results-min-height: 600px;",
        "--backtest-probability-narrow-overview-min-height: 320px;",
        "--backtest-probability-narrow-chart-stage-min-height: 254px;",
        ".backtest-results-stack.investment-workspace-header.has-probability-field {",
        "--investment-overview-content-min-height: var(--backtest-probability-narrow-overview-min-height);",
        "min-height: var(--backtest-probability-narrow-results-min-height);",
        ".backtest-results-stack.has-probability-field .trade-chart-stack {",
        "min-height: var(--backtest-probability-narrow-chart-stage-min-height);",
        ".trade-chart-stack.has-probability-scroll {",
        "overflow-x: auto;",
        "scrollbar-width: thin;",
        ".trade-chart-stack.has-probability-scroll::-webkit-scrollbar {",
        "height: 6px;",
        ".backtest-probability-scroll-spacer {",
        ".backtest-probability-tooltip.chart-tooltip {",
        "--backtest-probability-tooltip-transparency: 90%;",
        "--backtest-probability-tooltip-radius: 10px;",
        "--backtest-probability-cell-radius: 2px;",
        "--backtest-probability-grid-padding: 8px;",
        "transparent var(--backtest-probability-tooltip-transparency),",
        "background-image: none;",
        "border: 0;",
        "box-shadow: none;",
        "backdrop-filter: none;",
        "-webkit-backdrop-filter: none;",
        ".backtest-probability-tooltip.chart-tooltip[hidden] {",
        "display: none;",
        ".backtest-probability-tooltip[data-pinned=\"true\"] {",
    ):
        assert fragment in trade_css

    for fragment in (
        "const DEFAULT_ROWS_ABOVE = 6;",
        "const DEFAULT_ROWS_BELOW = 6;",
        "const DEFAULT_COLUMN_COUNT = 36;",
        "const DEFAULT_GAP_PX = 3;",
        "const DEFAULT_PADDING_PX = 8;",
        "const DEFAULT_MIN_CELL_PX = 4;",
        "const DEFAULT_CELL_RADIUS_PX = 2;",
        "const DEFAULT_TOOLTIP_RADIUS_PX = 10;",
        "const DEFAULT_TOOLTIP_TRANSPARENCY_PCT = 90;",
        'time_quantization: "integer-trading-days",',
        "const slotWidth = daysPerColumn * normalizedStepPixels;",
        "const cellSize = slotWidth - gap;",
        "const horizon = (visualColumn + 1) * daysPerColumn;",
        'direction: "right",',
    ):
        assert fragment in probability_grid

    assert "--backtest-probability-tooltip-transparency" not in tokens
    assert "--backtest-probability-tooltip-radius" not in tokens
    assert "--backtest-probability-cell-radius" not in tokens

    price_panel = backtest_template.index('<div class="trade-chart-panel">')
    price_canvas = backtest_template.index('<canvas id="tradePriceChart"></canvas>')
    equity_panel = backtest_template.index(
        '<div class="trade-chart-panel trade-chart-panel-equity">'
    )
    equity_canvas = backtest_template.index('<canvas id="tradeEquityChart"></canvas>')
    assert price_panel < price_canvas < equity_panel < equity_canvas

    assert "overviewStageSelector: '.trade-chart-stack'," in backtest_layout
    investment_layout = _read(ASSET_ROOT / "js/investment/layout.js")
    assert "'--investment-overview-content-min-height'" in investment_layout


def test_settings_layout_dimensions_are_canonical_and_color_groups_follow_the_intro() -> None:
    tokens = _read(ASSET_ROOT / "css/foundation/tokens.css")
    settings_css = _read(ASSET_ROOT / "css/views/settings.css")
    settings_template = _read(TEMPLATE_ROOT / "settings.html")

    for fragment in (
        "--layout-content-width: 640px;",
        "--layout-control-width: 384px;",
        "--layout-physical-effect-bleed: 48px;",
        "--settings-general-option-max-width: var(--layout-content-width);",
        "--settings-action-package-max-width: var(--layout-content-width);",
        "--settings-form-shell-max-width: var(--layout-content-width);",
        "--settings-form-control-max-width: var(--layout-control-width);",
        "--settings-reading-guard-single-column-width: min(var(--layout-content-width), var(--responsive-breakpoint-layout-switch-min));",
        "--style-token-demo-width: var(--layout-control-width);",
    ):
        assert fragment in tokens

    for fragment in (
        "--settings-shell-content-max-width: var(--layout-content-width);",
        ".settings-shell-material-tokens,\n.settings-shell-strategies {",
        ".settings-shell-network > .settings-content-scrollport > .settings-action-package,",
        ".settings-shell-material-tokens .style-token-card {\n    overflow: visible;\n}",
        ".settings-content-scrollport {",
        "margin-inline-start: calc(-1 * var(--layout-physical-effect-bleed));",
        "padding-inline-start: var(--layout-physical-effect-bleed);",
        "overflow-x: hidden;\n    overflow-y: auto;",
        "width: min(100%, var(--layout-control-width));",
        "max-width: var(--layout-control-width);",
        "grid-template-columns: minmax(0, 1fr);",
        "width: min(100%, var(--layout-content-width));",
        ".settings-shell-investment > .settings-content-scrollport > .settings-general-panel {",
        ".settings-shell-strategies > .settings-content-scrollport > .settings-summary {\n    width: min(100%, var(--settings-shell-content-max-width));",
        "width: min(100%, var(--settings-shell-content-max-width));\n    max-width: 100%;\n    border-radius: var(--radius-panel);",
        ".settings-shell-local-market-store > .settings-content-scrollport > .settings-summary {\n    width: min(100%, var(--settings-shell-content-max-width));",
        ".settings-shell-local-market-store > .settings-content-scrollport > .local-store-table-shell {\n    width: min(100%, var(--settings-shell-content-max-width));",
        ".font-preview-card {\n    border: 0;\n}",
    ):
        assert fragment in settings_css

    assert 'class="settings-content-scrollport" data-settings-content-scrollport' in settings_template

    intro_position = settings_template.index('class="settings-color-token-intro settings-card"')
    sidebar_position = settings_template.index('class="settings-color-token-sidebar"')
    group_position = settings_template.index('class="settings-color-token-group settings-card"')
    assert intro_position < sidebar_position < group_position


def test_period_controls_use_the_shared_dropdown_width_token() -> None:
    forms_css = _read(ASSET_ROOT / "css/components/forms.css")
    macros = _read(TEMPLATE_ROOT / "_macros.html")

    assert "data-shared-select-kind=\"period\"" in macros
    assert "backtest-shared-select-trigger" in macros
    assert ".ticker-controls .field.range-panel > .backtest-shared-select-row {" in forms_css
    assert "width: min(100%, var(--settings-form-control-max-width));" in forms_css
    assert "max-width: var(--settings-form-control-max-width);" in forms_css
    assert "width: min(320px, 100%);" in forms_css
    assert "max-width: 320px;" in forms_css


def test_strategy_parameters_reveal_downward_without_crossing_the_strategy_row() -> None:
    forms_css = _read(ASSET_ROOT / "css/components/forms.css")

    popover_rule = forms_css[
        forms_css.index(".trade-strategy-params-popover {"):
        forms_css.index(".trade-controls:has(.trade-strategy-field.is-open)")
    ]
    assert "position: static;" in popover_rule
    assert "margin-top: 4px;" in popover_rule

    animation = forms_css[
        forms_css.index("@keyframes strategy-params-flow-in {"):
        forms_css.index("@media (prefers-reduced-motion: reduce)")
    ]
    assert "clip-path: inset(0 0 100% 0);" in animation
    assert "transform-origin: top center;" in animation
    assert "animation: strategy-params-flow-in" in animation
    assert "translateY(-" not in animation


def test_broker_select_options_are_name_only() -> None:
    macros = _read(TEMPLATE_ROOT / "_macros.html")
    broker_macro = macros[macros.index("{% macro render_broker_select_options") :]

    assert "data-icon-url=\"{{ url_for('market_store_logo'" in broker_macro
    assert "data-sort-key=\"{{ entry.label }}\"" in broker_macro
    assert "data-description=\"{{ entry.description }}\"" not in broker_macro


def test_language_tabs_use_the_shared_button_tab_segmented_contract() -> None:
    template = _read(TEMPLATE_ROOT / "settings.html")
    forms_css = _read(ASSET_ROOT / "css/components/forms.css")
    settings_css = _read(ASSET_ROOT / "css/views/settings.css")
    app_js = _read(ASSET_ROOT / "js/app.js")

    assert 'class="settings-language-tabs segmented-control segmented-control--tabs"' in template
    assert 'role="tablist"' in template
    assert 'data-active="{{ settings_tab }}"' in template
    assert 'class="settings-language-tab segmented-control-option"' in template
    assert ".segmented-control--tabs > .segmented-control-option" in forms_css
    assert '[aria-selected="true"] > span' in forms_css
    assert "option.getAttribute(\"aria-selected\") === \"true\"" in app_js
    assert ".settings-language-tab.is-active" not in settings_css


def test_simplified_chinese_label_uses_the_ascii_parenthesis_contract() -> None:
    language_settings = _read(PROJECT_ROOT / "app/core/language_settings.py")
    runtime = _read(PROJECT_ROOT / "app/web/runtime.py")
    template = _read(TEMPLATE_ROOT / "settings.html")

    assert '"zh_hans_cn": "简体中文(中国大陆)"' in language_settings
    assert '"简体中文（中国大陆）": "简体中文(中国大陆)"' in language_settings
    assert 'LANGUAGE_LABELS["zh_hans_cn"]' in runtime
    assert "language_labels['zh_hans_cn']" in template
