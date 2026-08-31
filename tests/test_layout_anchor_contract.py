"""Static contract tests for the shared spatial layout system.

Code version: v0.5.6
"""

from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
ASSET_ROOT = PROJECT_ROOT / "app/web/static/assets"
TEMPLATE_ROOT = PROJECT_ROOT / "app/web/templates"


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _css_code_version(path: Path) -> str:
    first_line = _read(path).splitlines()[0]
    assert first_line.startswith("/* Code version: v")
    assert first_line.endswith(" */")
    return first_line.removeprefix("/* Code version: ").removesuffix(" */")


def test_shell_anchors_are_tokenized_and_redundantly_constrained() -> None:
    tokens = _read(ASSET_ROOT / "css/foundation/tokens.css")
    shell = _read(ASSET_ROOT / "css/layout/shell.css")
    trade = _read(ASSET_ROOT / "css/views/trade.css")
    responsive = _read(ASSET_ROOT / "css/utilities/responsive.css")

    for fragment in (
        "--page-edge-pad: 10px;",
        "--layout-edge-gap: var(--page-edge-pad);",
        "--layout-page-inset-top: max(var(--page-edge-pad), env(safe-area-inset-top, 0px));",
        "--layout-page-inset-right: max(var(--page-edge-pad), env(safe-area-inset-right, 0px));",
        "--layout-global-anchor-top: calc(var(--layout-page-inset-top) + var(--layout-edge-gap));",
        "--layout-global-anchor-right: calc(var(--layout-page-inset-right) + var(--layout-edge-gap));",
        "--layout-global-anchor-inset: calc(var(--layout-edge-gap) * 2);",
        "--layout-glass-border-width: 1px;",
        "--workspace-mode-result-heading-gap: 8px;",
        "--global-quick-actions-top: var(--layout-global-anchor-top);",
        "--global-quick-actions-right: var(--layout-global-anchor-right);",
        "--sidebar-overlay-toggle-inset: max(var(--sidebar-overlay-inset-top), var(--sidebar-overlay-inset-right));",
        "--layout-sidebar-dock-bottom-gap: var(--layout-edge-gap);",
        "--sidebar-dock-bottom-gap: var(--layout-sidebar-dock-bottom-gap);",
        "--layout-sidebar-dock-block-size: calc(",
        "--layout-sidebar-overlay-inline-size: min(",
    ):
        assert fragment in tokens

    for fragment in (
        "padding: var(--layout-edge-gap) var(--layout-edge-gap) var(--sidebar-bottom-pad);",
        "top: var(--global-quick-actions-top);",
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
        "top: calc(var(--layout-page-inset-top) + var(--sidebar-toggle-top));",
        "top: var(--global-quick-actions-top);",
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

    heading_block = portfolio[portfolio.index('<div class="report-heading-row workspace-result-heading-stack"') :]
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

    assert '@import url("./views/settings.css?v=0.25.1");' in app_css
    assert '@import url("./foundation/tokens.css?v=0.26.0");' in app_css
    assert '@import url("./views/investment.css?v=1.78.2");' in app_css
    assert "v0.64.3" in app_css


def test_app_stylesheet_consumers_share_the_current_cache_buster() -> None:
    app_css = ASSET_ROOT / "css/app.css"
    cache_buster = f"-app-css-{_css_code_version(app_css)}"

    for template_name in ("base.html", "live_trading_unlock.html"):
        assert cache_buster in _read(TEMPLATE_ROOT / template_name)


def test_bayesian_compute_backend_value_is_centered_in_its_own_column() -> None:
    trade_css = _read(ASSET_ROOT / "css/views/trade.css")
    app_css = _read(ASSET_ROOT / "css/app.css")

    assert '.trade-strategy-param[data-strategy-param-key="compute_backend"] .trade-strategy-param-select-shell {' in trade_css
    assert "justify-self: center;" in trade_css
    assert "width: min(100%, 160px);" in trade_css
    assert '.trade-strategy-param[data-strategy-param-key="compute_backend"] .trade-strategy-trigger {' in trade_css
    assert "justify-content: center;" in trade_css
    assert '@import url("./views/trade.css?v=3.50.0");' in app_css


def test_backtest_chart_heading_uses_compact_regular_typography() -> None:
    trade_css = _read(ASSET_ROOT / "css/views/trade.css")

    assert ".backtest-surface {" in trade_css
    assert "--backtest-chart-heading-font-size: 20px;" in trade_css
    assert ".backtest-surface > .chart-heading-row > .chart-heading {" in trade_css
    assert "font-size: var(--backtest-chart-heading-font-size);" in trade_css
    assert "font-weight: var(--font-weight-regular);" in trade_css


def test_backtest_section_resizer_uses_compact_handle_contract() -> None:
    trade_css = _read(ASSET_ROOT / "css/views/trade.css")

    assert "--backtest-section-resizer-size: 10px;" in trade_css
    assert "--investment-section-resizer-size: var(--backtest-section-resizer-size);" in trade_css
    resizer_start = trade_css.index(".backtest-section-resizer {")
    resizer_block = trade_css[resizer_start : trade_css.index("\n}", resizer_start)]
    assert "font-size: 12px;" in resizer_block


def test_backtest_probability_scroll_delegates_paint_to_the_native_browser() -> None:
    trade_css = _read(ASSET_ROOT / "css/views/trade.css")
    backtest_script = _read(ASSET_ROOT / "js/backtest.js")
    backtest_template = _read(TEMPLATE_ROOT / "backtest.html")
    pending_app = _read(ASSET_ROOT / "js/app.js")
    stack_contract = trade_css[
        trade_css.index(".trade-chart-stack {"):
        trade_css.index(".backtest-probability-scroll-spacer {")
    ]
    scroll_contract = trade_css[
        trade_css.index(".backtest-probability-scrollport {"):
        trade_css.index(".backtest-probability-scrollport-spacer {", trade_css.index(".backtest-probability-scrollport {"))
    ]

    for fragment in (
        "position: absolute;",
        "inset-block: -2px;",
        "overflow-x: auto;",
        "overflow-y: hidden;",
        "overscroll-behavior-inline: contain;",
        "scrollbar-gutter: auto;",
        "scrollbar-width: auto;",
        "scrollbar-color: auto;",
        "-ms-overflow-style: auto;",
        ".backtest-probability-scrollport::-webkit-scrollbar {",
        "all: revert;",
        "width: auto;",
        "height: auto;",
        ".backtest-probability-scrollport::-webkit-scrollbar-track,",
        ".backtest-probability-scrollport::-webkit-scrollbar-thumb,",
        ".backtest-results-stack.has-probability-scrollport .backtest-section-resizer {",
        "pointer-events: none;",
    ):
        assert fragment in trade_css

    assert "var(--accent-scrollbar)" not in scroll_contract
    assert ".trade-chart-stack.has-probability-scroll {" not in trade_css
    assert "overflow: hidden;" in stack_contract

    for markup in (backtest_template, pending_app):
        assert 'class="backtest-section-resizer-slot" data-backtest-section-resizer-slot' in markup
        assert 'data-backtest-probability-scrollport' in markup
        assert 'data-backtest-probability-scrollport-spacer' in markup

    for fragment in (
        '"[data-backtest-probability-scrollport]"',
        '"[data-backtest-probability-scrollport-spacer]"',
        'const setProbabilityScrollPortActive = (active) => {',
        'probabilityScrollResizer.blur();',
        'const setProbabilityScrollPosition = (scrollLeft) => {',
        'const stackScrollWidth = Math.ceil(',
        'tradeChartStack.clientWidth + distance);',
        'const nativeScrollLeft = Math.ceil(next);',
        'const setProbabilityScrollVisualOffset = (offsetValue) => {',
        'const probabilityScrollVisualNodes = [',
        'priceCanvas.closest(".trade-chart-panel"),',
        'equityCanvas.closest(".trade-chart-panel"),',
        'probabilityScrollVisualPosition = next;',
        'setProbabilityScrollVisualOffset(actualNativeScrollLeft - probabilityScrollVisualPosition);',
        'probabilityScrollPort.addEventListener("scroll", () => {',
        'const visualNext = probabilityScrollTarget > 0',
        'Math.min(nativeNext, probabilityScrollTarget)',
        'setProbabilityScrollPosition(visualNext);',
        'if (probabilityScrollTarget <= 0.01) {',
        'completeProbabilityScroll();',
        'resultsStack?.classList.toggle("has-probability-scrollport", isActive);',
    ):
        assert fragment in backtest_script

    for fragment in (
        'maxWidth: Math.max(0, tradeChartStack.clientWidth - 1),',
        'grid.dataset.requestedColumnCount = String(geometry.requestedColumnCount);',
        'requestedColumnCount',
        'probabilityScrollTarget = Math.ceil(',
        'distance + (distance > 0 ? 1 : 0)',
    ):
        assert fragment not in backtest_script


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
        '"[data-backtest-probability-scrollport]"',
        'const setProbabilityScrollPortActive = (active) => {',
        'const setProbabilityScrollPosition = (scrollLeft) => {',
        'probabilityScrollPort.addEventListener("scroll", () => {',
        'probabilityScrollTarget = Math.max(0, Number(targetValue) || 0);',
        'tradeChartStack.dataset.probabilityPanMotion = "shared-bouncy-spring";',
        "const motion = window.AntigravityMotion;",
        "const preset = motion.springPresets?.bouncy || {",
        '"backtest-probability-scroll",',
        "x: canvasRect.left - stackRect.left + probabilityScrollVisualPosition + point.x,",
        "const canvasOffsetX = (",
        "canvasRect.left - stackRect.left + probabilityScrollVisualPosition",
        ");",
        "setProbabilityScrollTarget(tooltipContentRight - tradeChartStack.clientWidth);",
        "columnCount: strategyPresentation.columns,",
        "rowsAbove: strategyPresentation.rows_above,",
        "rowsBelow: strategyPresentation.rows_below,",
        'probabilityTooltip.dataset.transparency = String(',
        '"--backtest-probability-tooltip-radius",',
        '"--backtest-probability-tooltip-transparency",',
        "opacityExponent: strategyPresentation.cell_opacity_exponent,",
        "opacityTailRatio: strategyPresentation.cell_opacity_tail_ratio,",
        'tradeChartStack.classList.remove("has-probability-field");',
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
        ".trade-chart-stack.has-probability-field {\n    padding-bottom: 0;",
        "@media (min-width: 1008px) {",
        ".workspace-mode-layout:has(.backtest-results-stack.has-probability-field) {",
        "clamp(264px, calc(100% - 398px), var(--sidebar-width))",
        "minmax(386px, 1fr);",
        ".backtest-section-resizer-slot {",
        "height: var(--investment-section-resizer-size);",
        ".backtest-probability-scrollport {",
        "inset-block: -2px;",
        "overflow-x: auto;",
        "scrollbar-width: auto;",
        "scrollbar-color: auto;",
        ".backtest-probability-scrollport::-webkit-scrollbar {",
        "all: revert;",
        "width: auto;",
        "height: auto;",
        ".backtest-probability-scroll-spacer {",
        ".backtest-probability-tooltip.chart-tooltip {",
        "--backtest-probability-cell-radius: 2px;",
        "--backtest-probability-grid-padding: 8px;",
        "--backtest-probability-tooltip-radius: 10px;",
        "--backtest-probability-tooltip-transparency: 50%;",
        "background: color-mix(",
        "transparent var(--backtest-probability-tooltip-transparency),",
        "background-image: none;",
        "border: 0;",
        "border-radius: var(--backtest-probability-tooltip-radius);",
        "box-shadow: none;",
        "backdrop-filter: none;",
        "-webkit-backdrop-filter: none;",
        ".backtest-probability-tooltip.chart-tooltip[hidden] {",
        "display: none;",
        ".backtest-probability-tooltip[data-pinned=\"true\"] {",
        ".backtest-probability-cell {",
        "transition: none;",
    ):
        assert fragment in trade_css

    for fragment in (
        "const DEFAULT_ROWS_ABOVE = 10;",
        "const DEFAULT_ROWS_BELOW = 10;",
        "const DEFAULT_COLUMN_COUNT = 20;",
        "const DEFAULT_GAP_PX = 2;",
        "const DEFAULT_PADDING_PX = 8;",
        "const DEFAULT_MIN_CELL_PX = 4;",
        "const DEFAULT_CELL_RADIUS_PX = 2;",
        "const DEFAULT_TOOLTIP_RADIUS_PX = 10;",
        "const DEFAULT_TOOLTIP_TRANSPARENCY_PCT = 50;",
        'const CELL_OPACITY_MAPPING = "instant-contrast-power-v1";',
        "const DEFAULT_CELL_OPACITY_EXPONENT = 1.6;",
        "const DEFAULT_CELL_OPACITY_TAIL_RATIO = 0.02;",
        "const symmetricRows = normalizeSymmetricRows(value.rows_above, value.rows_below);",
        "rows_above: symmetricRows.rowsAbove,",
        "rows_below: symmetricRows.rowsBelow,",
        "columns: DEFAULT_COLUMN_COUNT,",
        "minCell: Object.freeze([DEFAULT_MIN_CELL_PX, 32]),",
        "cell_opacity_exponent: boundedNumber(",
        "cell_opacity_tail_ratio: boundedNumber(",
        "tooltip_radius_px: boundedNumber(",
        "tooltip_transparency_pct: boundedNumber(",
        'time_quantization: "integer-trading-days",',
        "const requestedGap = boundedNumber(gapPx, DEFAULT_GAP_PX, GEOMETRY_LIMITS.gap);",
        "Math.ceil(((minimumCell + requestedGap) / normalizedStepPixels) - 1e-12),",
        "const gap = requestedGap;",
        "const slotWidth = daysPerColumn * normalizedStepPixels;",
        "const cellSize = slotWidth - gap;",
        "const availableRowsWithinHalfPlot = rowsThatFit(",
        "MAX_VERTICAL_PLOT_FRACTION",
        "const availableRowsPerSide = Math.min(",
        "MAX_ROWS_PER_SIDE",
        "requestedGap,",
        "const horizon = (visualColumn + 1) * daysPerColumn;",
        "const opacityProfile = computeInstantOpacityProfile(",
        "const minimumProbabilityRatio = minimumProbability / maximumProbability;",
        "const baselineRatio = Math.max(",
        "const probabilityRatio = probability / maximumProbability;",
        'direction: "right",',
    ):
        assert fragment in probability_grid

    for fragment in (
        "maxWidth = null",
        "maximumVisibleColumns",
        "requestedColumnCount",
        "const MAX_ROWS_ABOVE",
        "const MAX_ROWS_BELOW",
        "normalizeRows(rowsAbove, rowsBelow)",
        "boundedInteger(value.columns, DEFAULT_COLUMN_COUNT, GEOMETRY_LIMITS.columns)",
    ):
        assert fragment not in probability_grid

    assert "--backtest-probability-tooltip-transparency" not in tokens
    assert "--backtest-probability-tooltip-radius" not in tokens
    assert "--backtest-probability-cell-radius" not in tokens
    assert "--backtest-probability-tooltip-transparency" in trade_css
    assert "--backtest-probability-tooltip-radius" in trade_css

    price_panel = backtest_template.index('<div class="trade-chart-panel">')
    price_canvas = backtest_template.index('<canvas id="tradePriceChart"></canvas>')
    equity_panel = backtest_template.index(
        '<div class="trade-chart-panel trade-chart-panel-equity"'
    )
    equity_canvas = backtest_template.index('<canvas id="tradeEquityChart"></canvas>')
    assert price_panel < price_canvas < equity_panel < equity_canvas
    assert 'data-backtest-section-resizer-slot' in backtest_template
    assert 'data-backtest-probability-scrollport' in backtest_template

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
        ".settings-shell-material-tokens > .settings-content-scrollport > .style-token-shell,",
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

    assert (
        'class="settings-content-scrollport" data-layout-role="content-scrollport" '
        "data-settings-content-scrollport"
    ) in settings_template

    intro_position = settings_template.index('class="settings-color-token-intro settings-card"')
    sidebar_position = settings_template.index('class="settings-color-token-sidebar"')
    group_position = settings_template.index('class="settings-color-token-group settings-card"')
    assert intro_position < sidebar_position < group_position


def test_period_controls_use_the_shared_dropdown_width_token() -> None:
    forms_css = _read(ASSET_ROOT / "css/components/forms.css")
    investment_css = _read(ASSET_ROOT / "css/views/investment.css")
    macros = _read(TEMPLATE_ROOT / "_macros.html")

    assert "data-shared-select-kind=\"period\"" in macros
    assert "backtest-shared-select-trigger" in macros
    assert ".ticker-controls .field.range-panel > .backtest-shared-select-row {" in forms_css
    assert "width: min(100%, var(--settings-form-control-max-width));" in forms_css
    assert "max-width: var(--settings-form-control-max-width);" in forms_css
    assert "width: min(320px, 100%);" in forms_css
    assert "max-width: 320px;" in forms_css
    assert "width: min(100%, var(--layout-control-width));" in investment_css
    assert "width: min(100%, 384px);" not in investment_css


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


def test_shared_segmented_controls_keep_visible_disabled_options_in_their_slots() -> None:
    forms_css = _read(ASSET_ROOT / "css/components/forms.css")
    app_js = _read(ASSET_ROOT / "js/app.js")
    trade_css = _read(ASSET_ROOT / "css/views/trade.css")

    assert ".filter((option) => !option.hidden);" in app_js
    assert ".segmented-control-option:has(input:disabled)," in forms_css
    assert ".segmented-control-option[aria-disabled=\"true\"] > span," in forms_css
    assert "[data-backtest-history-transactions-option][aria-disabled=\"true\"]" not in trade_css


def test_simplified_chinese_label_uses_the_ascii_parenthesis_contract() -> None:
    language_settings = _read(PROJECT_ROOT / "app/core/language_settings.py")
    runtime = _read(PROJECT_ROOT / "app/web/runtime.py")
    template = _read(TEMPLATE_ROOT / "settings.html")

    assert '"zh_hans_cn": "简体中文(中国大陆)"' in language_settings
    assert '"简体中文（中国大陆）": "简体中文(中国大陆)"' in language_settings
    assert 'LANGUAGE_LABELS["zh_hans_cn"]' in runtime
    assert "language_labels['zh_hans_cn']" in template


def test_production_templates_publish_the_shared_layout_role_registry() -> None:
    base = _read(TEMPLATE_ROOT / "base.html")
    macros = _read(TEMPLATE_ROOT / "_macros.html")

    for fragment in (
        'data-layout-role="sidebar-toggle"',
        'data-layout-role="global-action-column"',
        'data-layout-role="global-theme-anchor"',
        'data-layout-role="sidebar-title"',
        'data-layout-role="sidebar-dock"',
    ):
        assert fragment in base

    for fragment in (
        'data-layout-role="result-actions"',
        'data-layout-role="result-action"',
    ):
        assert fragment in macros

    for template_name in (
        "compare.html",
        "dca.html",
        "investment.html",
        "backtest.html",
        "portfolio.html",
        "price_compare.html",
    ):
        template = _read(TEMPLATE_ROOT / template_name)
        for fragment in (
            'data-layout-role="title-rail"',
            'data-layout-role="title-heading"',
        ):
            assert fragment in template, (template_name, fragment)

    for template_name in ("compare.html", "dca.html", "investment.html", "backtest.html", "portfolio.html"):
        assert 'data-layout-role="result-container"' in _read(TEMPLATE_ROOT / template_name)

    for template_name in ("compare.html", "dca.html", "backtest.html"):
        template = _read(TEMPLATE_ROOT / template_name)
        assert 'data-layout-role="result-title-rail"' in template
        assert 'data-layout-role="result-heading"' in template

    assert 'data-layout-role="secondary-heading"' in _read(TEMPLATE_ROOT / "investment.html")
    assert 'data-layout-role="pagination"' in _read(TEMPLATE_ROOT / "_dca_backtest_table.html")
    assert 'data-layout-role="content-scrollport"' in _read(TEMPLATE_ROOT / "settings.html")


def test_effect_hosts_and_scrollports_have_explicit_overflow_ownership() -> None:
    app_css = _read(ASSET_ROOT / "css/app.css")
    settings_css = _read(ASSET_ROOT / "css/views/settings.css")
    workspace_css = _read(ASSET_ROOT / "css/views/workspace.css")
    trade_css = _read(ASSET_ROOT / "css/views/trade.css")

    assert ".chart-panel.workspace {\n    overflow: visible;" in workspace_css
    settings_header_start = settings_css.index(".settings-workspace-header {")
    settings_header = settings_css[settings_header_start : settings_header_start + 260]
    assert "overflow: visible;" in settings_header

    scrollport_start = settings_css.index(".settings-content-scrollport {")
    scrollport = settings_css[scrollport_start : settings_css.index("\n}", scrollport_start)]
    for fragment in (
        "margin-inline-start: calc(-1 * var(--layout-physical-effect-bleed));",
        "padding-inline-start: var(--layout-physical-effect-bleed);",
        "padding-block-end: var(--layout-physical-effect-bleed);",
        "overflow-x: hidden;",
        "overflow-y: auto;",
    ):
        assert fragment in scrollport

    for fragment in (
        ".settings-shell-network .settings-service-row,",
        ".settings-shell-material-tokens .style-token-card {\n    overflow: visible;",
        ".settings-action-package {\n    position: relative;",
    ):
        assert fragment in settings_css

    trade_stack_start = trade_css.rindex(".trade-chart-stack {")
    trade_stack = trade_css[trade_stack_start : trade_css.index("\n}", trade_stack_start)]
    assert "overflow: hidden;" in trade_stack
    assert '@import url("./views/workspace.css?v=1.22.0");' in app_css
