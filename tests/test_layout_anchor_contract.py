"""Static contract tests for the shared spatial layout system.

Code version: v0.8.16
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

    assert '@import url("./views/settings.css?v=0.25.3");' in app_css
    assert '@import url("./foundation/tokens.css?v=0.26.0");' in app_css
    assert '@import url("./components/forms.css?v=3.40.6");' in app_css
    assert '@import url("./views/investment.css?v=1.78.3");' in app_css
    assert "v0.65.14" in app_css


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
    assert "--compute-backend-trigger-label-offset" in trade_css
    assert "transform: translateX(var(--compute-backend-trigger-label-offset));" in trade_css
    assert '@import url("./views/trade.css?v=3.55.12");' in app_css


def test_backtest_boolean_switches_share_the_plain_switch_row_contract() -> None:
    forms_css = _read(ASSET_ROOT / "css/components/forms.css")
    backtest_template = _read(TEMPLATE_ROOT / "_backtest_form.html")
    dca_template = _read(TEMPLATE_ROOT / "_dca_form.html")
    strategy_template = _read(TEMPLATE_ROOT / "_trade_strategy_params_panel.html")

    plain_rule_start = forms_css.index(".switch-row.switch-row--plain,")
    plain_rule = forms_css[plain_rule_start : forms_css.index("\n}", plain_rule_start)]
    for fragment in (
        "padding: 0;",
        "background: transparent;",
        "border: none;",
        "box-shadow: none;",
    ):
        assert fragment in plain_rule

    assert backtest_template.count('row_class="switch-row switch-row--plain"') == 4
    assert dca_template.count('row_class="switch-row switch-row--plain"') == 2
    assert 'row_class="switch-row switch-row--plain trade-strategy-boolean-row"' in strategy_template
    assert ".trade-strategy-boolean-row .switch-label > span:not(.field-tooltip)" not in forms_css


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
        "clip-path: inset(4px 0);",
    ):
        assert fragment in trade_css
    assert (
        ".backtest-probability-detail-plot {\n"
        "    display: grid;\n"
        "    flex: 1 1 auto;\n"
        "    grid-template-columns: 52px minmax(0, 1fr);\n"
        "    min-height: 0;\n"
        "    min-width: 0;\n"
        "    overflow: hidden;\n"
    ) in trade_css
    assert (
        ".backtest-probability-detail-main {\n"
        "    display: flex;\n"
        "    flex-direction: column;\n"
        "    min-width: 0;\n"
        "    min-height: 0;\n"
        "    overflow: hidden;\n"
    ) in trade_css
    assert (
        ".backtest-probability-detail-grid-viewport {\n"
        "    position: relative;\n"
        "    flex: 1 1 auto;\n"
        "    min-width: 0;\n"
        "    min-height: 0;\n"
        "    contain: layout paint;\n"
        "    overflow: hidden;\n"
    ) in trade_css
    assert (
        ".backtest-probability-detail-grid {\n"
        "    position: absolute;\n"
        "    top: 50%;\n"
        "    left: 0;\n"
        "    display: grid;\n"
        "    box-sizing: border-box;\n"
        "    align-content: stretch;\n"
        "    justify-content: stretch;\n"
        "    min-width: 0;\n"
        "    min-height: 0;\n"
        "    contain: strict;\n"
        "    overflow: hidden;\n"
    ) in trade_css

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
        'probabilityScrollPortIsActive = isActive;',
        'probabilityScrollResizer.contains(target)',
        'probabilityScrollResizer?.addEventListener("mouseleave",',
        'const setProbabilityScrollPosition = (scrollLeft) => {',
        'const stackScrollWidth = Math.ceil(',
        'const stackScrollWidth = Math.ceil(stackWidth + nextDistance);',
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


def test_bayesian_backtest_routes_dynamic_grid_minimum_through_shared_resizer() -> None:
    tokens = _read(ASSET_ROOT / "css/foundation/tokens.css")
    trade_css = _read(ASSET_ROOT / "css/views/trade.css")
    backtest_script = _read(ASSET_ROOT / "js/backtest.js")
    backtest_layout = _read(ASSET_ROOT / "js/backtest/layout.js")
    probability_grid = _read(ASSET_ROOT / "js/backtest/probability-grid.js")
    app_script = _read(ASSET_ROOT / "js/app.js")
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
        'tradeChartStack.dataset.probabilityPanMotion = "shared-pointer-follow";',
        "const canvasContentLeft = canvasRect.left",
        "const lastCurveContentX = canvasContentLeft + (lastCurveX * scaleX);",
        "logicalRelativeX > lastCurveContentX + PROBABILITY_HOVER_EDGE_HANDOFF_PX",
        "hoverRelativeX = (logicalRelativeX - canvasContentLeft) / scaleX;",
        "probabilityScrollCleanup?.();",
        "setProbabilityScrollPosition(probabilityScrollTarget);",
        "x: canvasRect.left - stackRect.left + probabilityScrollVisualPosition + point.x,",
        "const canvasOffsetX = (",
        "canvasRect.left - stackRect.left + probabilityScrollVisualPosition",
        ");",
            "Number(getPriceCurveRightContentLeft(currentStackRect))",
            'tradeChartStack.dataset.probabilityPanTarget = "0";',
        "columnCount: strategyPresentation.columns,",
        "rowsAbove: strategyPresentation.rows_above,",
        "rowsBelow: strategyPresentation.rows_below,",
        "opacityExponent: strategyPresentation.cell_opacity_exponent,",
        "opacityTailRatio: strategyPresentation.cell_opacity_tail_ratio,",
        "cellDisplayThresholdPct: strategyPresentation.cell_display_threshold_pct,",
        "probabilityDetailPanel.dataset.cellDisplayThresholdPct = String(",
        "is-threshold-hidden",
        "thresholdVisible",
        'tradeChartStack.classList.remove("has-probability-field");',
    ):
        assert fragment in backtest_script

    for fragment in (
        'if (parts.triggerLabel.textContent !== nextLabel) parts.triggerLabel.textContent = nextLabel;',
        'if (parts.triggerLabel.dataset.fallbackLabel !== nextLabel)',
        'const nextEmptyState = nextLabel ? "0" : "1";',
        'if (parts.trigger.dataset.empty !== nextEmptyState)',
    ):
        assert fragment in app_script

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
        "background: transparent;",
        "background-image: none;",
        "border: 0;",
        "border-radius: 0;",
        "box-shadow: none;",
        "backdrop-filter: none;",
        "-webkit-backdrop-filter: none;",
        ".backtest-probability-tooltip.chart-tooltip[hidden] {",
        "display: none;",
        ".backtest-probability-tooltip[data-pinned=\"true\"] {",
        ".backtest-probability-cell {",
        ".backtest-probability-cell.is-threshold-hidden {",
        "border-radius: 0;",
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
        'const CELL_OPACITY_MAPPING = "instant-contrast-power-v1";',
        "const DEFAULT_CELL_OPACITY_EXPONENT = 1.6;",
        "const DEFAULT_CELL_OPACITY_TAIL_RATIO = 0.02;",
        "const DEFAULT_CELL_DISPLAY_THRESHOLD_PCT = 5;",
        "const symmetricRows = normalizeSymmetricRows(value.rows_above, value.rows_below);",
        "rows_above: symmetricRows.rowsAbove,",
        "rows_below: symmetricRows.rowsBelow,",
        "columns: DEFAULT_COLUMN_COUNT,",
        "minCell: Object.freeze([DEFAULT_MIN_CELL_PX, 32]),",
        "cell_opacity_exponent: boundedNumber(",
        "cell_opacity_tail_ratio: boundedNumber(",
        "cell_display_threshold_pct: boundedNumber(",
        "delete presentation.cell_radius_px;",
        "delete presentation.tooltip_radius_px;",
        "delete presentation.tooltip_transparency_pct;",
        'time_quantization: "integer-trading-days",',
        "const requestedGap = boundedNumber(gapPx, DEFAULT_GAP_PX, GEOMETRY_LIMITS.gap);",
        "Math.ceil(((minimumCell + requestedGap) / normalizedStepPixels) - 1e-12),",
        "const gap = requestedGap;",
        "const slotWidth = daysPerColumn * normalizedStepPixels;",
        "const cellSize = slotWidth - gap;",
        "const availableRowsWithinHalfPlot = rowsThatFit((bottom - top) / 2);",
        "const availableRowsPerSide = Math.min(",
        "MAX_ROWS_PER_SIDE",
        "const computeGridMinimumPlotHeight = ({",
        "const geometry = computeGridGeometry({",
        "const halfHeight = computeMaximumGridHalfHeight({",
        "maxCellPx: geometry.cellSize,",
        "chartAreaMinimumHeight: 2 * halfHeight,",
        "const requestedCellSize = finiteOrNull(maxCellPx);",
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
        "MAX_VERTICAL_PLOT_FRACTION",
        "MAX_VERTICAL_PLOT_FRACTION",
    ):
        assert fragment not in probability_grid

    assert "--backtest-probability-tooltip-transparency" not in tokens
    assert "--backtest-probability-tooltip-radius" not in tokens
    assert "--backtest-probability-cell-radius" not in tokens
    assert "--backtest-probability-tooltip-transparency" not in trade_css
    assert "--backtest-probability-tooltip-radius" not in trade_css

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
    for fragment in (
        "const PROBABILITY_STAGE_MINIMUM_PROPERTY = '--backtest-probability-stage-min-height';",
        "const PROBABILITY_STAGE_MINIMUM_CHANGE_EVENT = 'antigravity:backtest-probability-stage-minimum-change';",
        "const getProbabilityStageMinimum = () => {",
        "getOverviewStageMinimum: getProbabilityStageMinimum,",
        "overviewMinimumChangeEvent: PROBABILITY_STAGE_MINIMUM_CHANGE_EVENT,",
        "investment-layout-v1.3.4",
        "ignoreMutationSelector: '[data-backtest-probability-detail-panel]',",
        "observeHistorySurfaceResize: false,",
    ):
        assert fragment in backtest_layout

    for fragment in (
        'const PROBABILITY_STAGE_MINIMUM_PROPERTY = "--backtest-probability-stage-min-height";',
        'const PROBABILITY_STAGE_MINIMUM_CHANGE_EVENT = "antigravity:backtest-probability-stage-minimum-change";',
        "const publishProbabilityStageMinimum = () => {",
        "probabilityGridApi.computeGridMinimumPlotHeight?.({",
        "const centralAnchor = pricePoints.reduce((closest, point, index) => {",
        "const centerOffsetRatio = centralAnchor",
        "const minimumBoundaryRatio = centerOffsetRatio <= 0.1",
        "const requiredChartAreaHeight = requirement.chartAreaMinimumHeight",
        "const requiredPlotHeight = requiredChartAreaHeight * canvasScaleY;",
        "const pricePanelShare = canvasRect.height / stackRect.height;",
        "resultsStack.style.setProperty(",
        "resultsStack.dispatchEvent(new Event(PROBABILITY_STAGE_MINIMUM_CHANGE_EVENT));",
        "clearProbabilityStageMinimum();",
    ):
        assert fragment in backtest_script

    investment_layout = _read(ASSET_ROOT / "js/investment/layout.js")
    for fragment in (
        "getOverviewStageMinimum = () => 0,",
        "overviewMinimumChangeEvent = null,",
        "onChartsResized = null,",
        "const requestedDynamicStageMinimum = typeof getOverviewStageMinimum === 'function'",
        "const dynamicStageMinimum = Number.isFinite(requestedDynamicStageMinimum)",
        "dynamicStageMinimum,",
        "overviewMinimumChangeEvent",
        "onChartsResized",
        "ignoreMutationSelector",
        "const stackedLayoutMedia = typeof windowRef?.ANTIGRAVITY_RESPONSIVE?.media === 'function'",
        "const isStackedLayout = () => Boolean(stackedLayoutMedia?.matches);",
        "const clearInlineSplitLayoutStyles = () => {",
        "overviewRatio = Number.NaN;",
        "if (!isStackedLayout()) {",
        "stackedLayoutMedia.addEventListener('change', onStackedLayoutChange);",
        "stackedLayoutMedia.removeEventListener('change', onStackedLayoutChange);",
        "workspaceHeader.addEventListener(overviewMinimumChangeEvent, onOverviewMinimumChange);",
        "workspaceHeader.removeEventListener(overviewMinimumChangeEvent, onOverviewMinimumChange);",
        "'--investment-overview-content-min-height'",
    ):
        assert fragment in investment_layout

    base_template = _read(TEMPLATE_ROOT / "base.html")
    for fragment in (
        "-app-v0.50.1",
        "-backtest-probability-grid-v0.23.1",
        "-backtest-v0.35.13",
        "-backtest-layout-v0.3.3",
    ):
        assert fragment in base_template


def test_bayesian_history_detail_preserves_hover_and_complete_geometry() -> None:
    backtest_template = _read(TEMPLATE_ROOT / "backtest.html")
    backtest_script = _read(ASSET_ROOT / "js/backtest.js")
    pending_app = _read(ASSET_ROOT / "js/app.js")
    trade_css = _read(ASSET_ROOT / "css/views/trade.css")

    for fragment in (
        'id="backtest_probability_detail_panel"',
        'data-backtest-history-view-panel="probability"',
        'data-backtest-probability-detail-grid',
        'data-backtest-probability-detail-y-axis',
        'data-backtest-probability-detail-x-axis',
        'data-backtest-probability-detail-up-summary',
        'data-backtest-probability-detail-down-summary',
        'class="backtest-probability-detail-status-row"',
        '"value": "probability", "label": "Price Field"',
        'data-option-count="',
        'aria-live="polite"',
    ):
        assert fragment in backtest_template
    assert 'backtest-probability-detail-contract' not in backtest_template
    assert 'backtest-probability-detail-legend' not in backtest_template
    assert 'backtest-probability-detail-legend' not in pending_app
    assert 'backtest-probability-detail-y-axis-title' not in backtest_template
    assert 'backtest-probability-detail-y-axis-title' not in pending_app
    assert 'backtest-probability-detail-x-axis-title' not in backtest_template
    assert '>Forecast date<' not in backtest_template
    assert 'backtest-probability-detail-x-axis-title' not in pending_app
    assert 'Forecast date' not in pending_app
    assert (
        '.backtest-history-view-body > '
        '[data-backtest-history-view-panel]:not([hidden]):not(.backtest-probability-detail-panel)'
    ) in trade_css
    assert (
        '.backtest-history-view-body > [data-backtest-history-view-panel]:not([hidden]) {'
    ) not in trade_css
    assert backtest_template.index('"value": "metrics"') < backtest_template.index('"value": "probability"')
    assert backtest_template.index('"value": "probability"') < backtest_template.index('"value": "transactions"')
    assert backtest_template.index('data-backtest-history-view-panel="metrics"') < backtest_template.index('data-backtest-history-view-panel="probability"')
    assert backtest_template.index('data-backtest-history-view-panel="probability"') < backtest_template.index('data-backtest-history-view-panel="transactions"')
    for fragment in (
        "pointRadius: 0,\n\t\t\t\t\t\tpointHoverRadius: 0,",
        "const buildProbabilityForecastDateParts = (anchorIndex, horizon) => {",
        "const applyProbabilityCellNode = (",
        "const renderProbabilityDetail = (index, model) => {",
        "const formatSelectedDate = (dateParts) => {",
        'formatFullDateParts(dateParts, { includeTime: false })',
        "latestProbabilityDetailBaseStatus = `Selected date: ${selectedDate}`;",
        "const buildProbabilityDetailTickIndexSet = (count, plotWidth) => {",
        "const renderedTicks = xTickNodes.filter(Boolean);",
        "const isProbabilityHistoryViewActive = () => (",
        "const buildProbabilityGridModel = (index, pricePoint) => {",
        "const buildProbabilityDetailModel = (index, model) => {",
        "const renderProbabilityDetailRowHover = (row) => {",
        "const renderProbabilityDetailSideSummary = (cells) => {",
        "formatProbabilityMass(summary.upProbability)",
        "formatProbabilityMass(summary.downProbability)",
        "Cumulative probability across all ${summary.cellCount} forecast cells",
        "including ${summary.hiddenCellCount} hidden",
        "probabilityDetailGrid.dataset.hoverSummary = hoverSummary;",
        'probabilityDetailGrid.setAttribute("title", hoverSummary);',
        'cell.setAttribute("title", hoverSummary);',
        "probabilityGridApi.summarizeProbabilityRow?.(",
        "probabilityGridApi.summarizeProbabilityField?.(cells)",
        "limitRowsToChartArea: false,",
        "const resolveProbabilityFieldReferenceCellSize = (chart, stepPixels) => {",
        "const referenceWindow = rangeEnd - referenceStart;",
        "const hasFullReferenceWindow = (rangeEnd - rangeStart) >= (referenceWindow * 0.9);",
        "const chartHoverPointCaches = new Map();",
        "const probabilityModelCache = new Map();",
        "const getProbabilityHoverLayout = () => {",
        "const visualTop = pointerAnchored",
        "probabilityHoverPointerY - currentStackRect.top - Number(geometry.aboveExtent || 0)",
        "const updateHoverCrosshair = (x, y, plotFrame, horizontalEnd = null) =>",
        "Math.max(plotFrame.right, horizontalEnd)",
        "const fieldRight = fieldLeft + Number(probabilityBounds.width || 0);",
        "const snapProbabilityScrollToFit = () => {",
        "const lastCurveX = finitePoints[finitePoints.length - 1].x;",
        "const PROBABILITY_HOVER_EDGE_HANDOFF_PX = 2;",
        "const canvasContentLeft = canvasRect.left",
        "const lastCurveContentX = canvasContentLeft + (lastCurveX * scaleX);",
        "|| logicalRelativeX > lastCurveContentX + PROBABILITY_HOVER_EDGE_HANDOFF_PX)",
        "hoverRelativeX = (logicalRelativeX - canvasContentLeft) / scaleX;",
        'hoverSurface.addEventListener("mouseleave", (event) => {',
        "resetProbabilityHoverPointer();",
        "resetProbabilityHoverPointer();",
        "const cachedModel = probabilityModelCache.get(index);",
        "const shouldRenderCells = shouldUpdateDomMirror",
        "&& (!canReuseCells || grid.dataset.renderKey !== renderKey);",
        "const shouldUpdateDomMirror = !hasDomMirror",
        "const drawProbabilityCanvas = (geometry, cells) => {",
        "if (chart === equityChart && !showTradeDetails) return;",
        "let latestProbabilityDetailIndex = null;",
        "const scheduleProbabilityDetailRefresh = (passes = 1) => {",
        "const refreshProbabilityDetailAfterViewChange = () => {",
        "probabilityDetailLayoutObserver = new ResizeObserver(() => {",
        "probabilityDetailLayoutObserver.observe(probabilityDetailGrid.parentElement);",
        "cellSizeTargetPx",
        "if (detailModel) renderProbabilityDetail(detailIndex, detailModel);",
        "formatChartDateLines(dateParts)",
        "buildProbabilityDetailTickIndexSet(geometry.columnCount",
        "probabilityDetailPanel.dataset.activeIndex = String(index);",
        "probabilityDetailGrid.style.gridTemplateColumns = `repeat(${geometry.columnCount}, ${detailCellSize}px)`;",
    ):
        assert fragment in backtest_script
    for fragment in (
        ".backtest-probability-detail-panel",
        ".backtest-probability-detail-status-row",
            "flex: 0 0 clamp(320px, 52vh, 520px);",
        "transform: translateY(-50%);",
        ".backtest-probability-detail-cell",
        ".backtest-probability-detail-cell.is-threshold-hidden",
        ".backtest-probability-detail-cell.is-row-hovered",
        ".backtest-probability-detail-x-tick.is-first",
        ".backtest-probability-detail-x-tick.is-last",
        ".backtest-probability-detail-side-summary",
        ".backtest-probability-detail-side-summary-value.is-up",
        ".backtest-probability-detail-side-summary-value.is-down",
        "z-index: calc(var(--layer-chart-overlay-line) + 2);",
    ):
        assert fragment in trade_css


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
    assert "width: fit-content;" in forms_css
    assert "max-width: 100%;" in forms_css
    assert "width: min(100%, var(--layout-control-width));" in investment_css
    assert "width: min(100%, 384px);" not in investment_css


def test_shared_segmented_controls_shrink_wrap_without_disabling_true_overflow_tracks() -> None:
    forms_css = _read(ASSET_ROOT / "css/components/forms.css")
    investment_css = _read(ASSET_ROOT / "css/views/investment.css")
    settings_css = _read(ASSET_ROOT / "css/views/settings.css")

    backtest_interval_rule = forms_css[
        forms_css.index(".trade-controls .backtest-interval-field > .backtest-interval-segmented {"):
        forms_css.index(".trade-controls .range-mode-field > .range-mode-shell {")
    ]
    range_mode_rule = forms_css[
        forms_css.index(".trade-controls .range-mode-field > .range-mode-shell {"):
        forms_css.index(".trade-controls .range-mode-field {")
    ]
    peek_rule = forms_css[
        forms_css.index('.segmented-control[data-segmented-overflow-mode="peek"] {'):
        forms_css.index('.segmented-control[data-segmented-overflow-mode="peek"][data-segmented-overflow="1"] {')
    ]
    overflow_track_rule = forms_css[
        forms_css.index('.segmented-control[data-segmented-overflow-mode="peek"][data-segmented-overflow="1"] {'):
        forms_css.index(".segmented-control,\n.range-mode-shell {")
    ]

    for rule in (backtest_interval_rule, range_mode_rule, peek_rule):
        assert "width: fit-content;" in rule
        assert "max-width: 100%;" in rule
    assert "justify-self: center;" in backtest_interval_rule
    assert "justify-self: center;" in range_mode_rule
    assert "width: var(--segmented-track-width, 100%);" in overflow_track_rule
    assert "margin-inline: 0;" in overflow_track_rule

    for selector in (
        ".live-trading-range-segmented {",
        ".investment-view-segmented {",
        ".investment-import-method-segmented {",
    ):
        rule_start = investment_css.index(selector)
        rule_end = investment_css.index("}\n", rule_start) + 2
        rule = investment_css[rule_start:rule_end]
        assert "width: fit-content;" in rule
        assert "max-width: 100%;" in rule
        assert "margin-inline: auto;" in rule

    language_tabs_start = settings_css.index(".settings-language-tabs {")
    language_tabs_end = settings_css.index("}\n", language_tabs_start) + 2
    language_tabs_rule = settings_css[language_tabs_start:language_tabs_end]
    assert "width: fit-content;" in language_tabs_rule
    assert "max-width: 100%;" in language_tabs_rule


def test_strategy_parameters_reveal_downward_without_crossing_the_strategy_row() -> None:
    forms_css = _read(ASSET_ROOT / "css/components/forms.css")

    popover_rule = forms_css[
        forms_css.index(".trade-strategy-params-popover {"):
        forms_css.index(".trade-controls:has(.trade-strategy-field.is-open)")
    ]
    assert "position: static;" in popover_rule
    assert "margin-top: 4px;" in popover_rule
    assert "overflow: visible;" in popover_rule
    assert "overflow-x: clip;" not in popover_rule

    animation = forms_css[
        forms_css.index("@keyframes strategy-params-flow-in {"):
        forms_css.index("@media (prefers-reduced-motion: reduce)")
    ]
    assert "clip-path" not in animation
    assert "transform-origin: top center;" in animation
    assert "animation: strategy-params-flow-in" in animation
    assert "translateY(-" not in animation
    assert "will-change: transform, opacity, filter;" in animation


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
