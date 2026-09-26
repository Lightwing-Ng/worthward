"""One tick-selection owner and an explicit shared-chart load contract.

Code version: v1.3.1
"""

from __future__ import annotations

from pathlib import Path
import re


PROJECT_ROOT = Path(__file__).resolve().parents[3]
JAVASCRIPT_ROOT = PROJECT_ROOT / "app/web/static/assets/js"
BASE_TEMPLATE = PROJECT_ROOT / "app/web/templates/base.html"
SHARED_AXIS_ASSET = "assets/js/chart-axis-utils.js"

# Every chart surface that selects x-axis tick indexes. Classic scripts must be
# loaded after the shared owner in base.html; module entrypoints are deferred
# and therefore always run after classic scripts.
CLASSIC_TICK_CONSUMERS = (
    "assets/js/chart.js",
    "assets/js/backtest/chart-controller.js",
    "assets/js/dca.js",
)
MODULE_TICK_CONSUMERS = (
    "live-trading/chart-axis.js",
    "investment/stock-details.js",
    "investment/runtime/realtime-chart.js",
)
TICK_CONSUMER_SOURCES = tuple(
    Path(asset.removeprefix("assets/js/")) for asset in CLASSIC_TICK_CONSUMERS
) + tuple(Path(name) for name in MODULE_TICK_CONSUMERS)

# A second copy of the algorithm always restates this breakpoint together with
# the four-tick and three-tick branches.
TICK_ALGORITHM_SIGNATURE = re.compile(
    r"maxTickCount\s*=\s*plotWidth\s*>=",
)
# The pixel-space date-axis layout is defined once, in the shared owner.
DATE_AXIS_LAYOUT_DEFINITION = re.compile(r"\bconst\s+layoutDateAxisTicks\s*=")


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def test_shared_axis_module_is_the_only_tick_algorithm_owner() -> None:
    shared_source = _read(JAVASCRIPT_ROOT / "chart-axis-utils.js")
    assert len(TICK_ALGORITHM_SIGNATURE.findall(shared_source)) == 1

    assert len(DATE_AXIS_LAYOUT_DEFINITION.findall(shared_source)) == 1

    for relative_path in TICK_CONSUMER_SOURCES:
        source = _read(JAVASCRIPT_ROOT / relative_path)
        assert not TICK_ALGORITHM_SIGNATURE.search(source), relative_path
        assert not DATE_AXIS_LAYOUT_DEFINITION.search(source), relative_path
        assert (
            "buildTickIndexSet" in source
            or "TickIndexSet" in source
            or "layoutDateAxisTicks" in source
        ), relative_path

    # The Overview equity chart receives the shared owner through the
    # Investment runtime composition root rather than the global name.
    equity_chart = _read(JAVASCRIPT_ROOT / "investment/runtime/equity-chart.js")
    assert "runtime.chartAxis.layoutDateAxisTicks(" in equity_chart
    assert not DATE_AXIS_LAYOUT_DEFINITION.search(equity_chart)
    assert "window.WORTHWARD_CHART_AXIS" in _read(JAVASCRIPT_ROOT / "investment.js")


def test_every_classic_tick_consumer_loads_after_the_shared_axis_owner() -> None:
    base_template = _read(BASE_TEMPLATE)
    shared_position = base_template.index(SHARED_AXIS_ASSET)

    for asset in CLASSIC_TICK_CONSUMERS:
        assert base_template.index(asset) > shared_position, asset


def test_shared_axis_owner_sets_chart_font_before_every_page_chart_consumer() -> None:
    base_template = _read(BASE_TEMPLATE)
    shared_source = _read(JAVASCRIPT_ROOT / "chart-axis-utils.js")
    shared_position = base_template.index(SHARED_AXIS_ASSET)

    assert base_template.index("assets/css/app.css") < shared_position
    assert shared_position < base_template.index("{% block page_scripts %}")
    assert "Chart?.defaults?.font" in shared_source
    assert 'getPropertyValue("--font-family-base")' in shared_source
    assert 'chart.update("none")' in shared_source
    assert "globalScope.document?.fonts?.ready" in shared_source

    chart_constructor = re.compile(r"\bnew\s+(?:window\.)?Chart\s*\(")
    consumers = [
        path.relative_to(PROJECT_ROOT)
        for path in JAVASCRIPT_ROOT.rglob("*.js")
        if "vendor" not in path.parts and chart_constructor.search(_read(path))
    ]
    assert consumers


def test_module_tick_consumers_depend_on_the_deferred_module_ordering() -> None:
    # Module scripts are deferred by specification, so the classic shared owner
    # has executed by the time these entrypoints run. The Live trading adapter
    # receives the shared owner from its entrypoint.
    for relative_path in MODULE_TICK_CONSUMERS:
        source = _read(JAVASCRIPT_ROOT / relative_path)
        if relative_path == "live-trading/chart-axis.js":
            assert "chartAxis.layoutDateAxisTicks(" in source
        else:
            assert "WORTHWARD_CHART_AXIS" in source, relative_path

    live_trading_template = _read(PROJECT_ROOT / "app/web/templates/live_trading.html")
    assert 'type="module"' in live_trading_template
    assert "assets/js/live-trading.js" in live_trading_template
    assert "createLiveTradingAxisPlugins" in _read(JAVASCRIPT_ROOT / "live-trading.js")
