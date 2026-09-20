"""One tick-selection owner and an explicit shared-chart load contract.

Code version: v1.0.0
"""

from __future__ import annotations

from pathlib import Path
import re


PROJECT_ROOT = Path(__file__).resolve().parents[1]
JAVASCRIPT_ROOT = PROJECT_ROOT / "app/web/static/assets/js"
BASE_TEMPLATE = PROJECT_ROOT / "app/web/templates/base.html"
SHARED_AXIS_ASSET = "assets/js/chart-axis-utils.js"

# Every chart surface that selects x-axis tick indexes. Classic scripts must be
# loaded after the shared owner in base.html; module entrypoints are deferred
# and therefore always run after classic scripts.
CLASSIC_TICK_CONSUMERS = (
    "assets/js/chart.js",
    "assets/js/backtest/chart-controller-mount.js",
    "assets/js/dca.js",
)
MODULE_TICK_CONSUMERS = (
    "live-trading.js",
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


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def test_shared_axis_module_is_the_only_tick_algorithm_owner() -> None:
    shared_source = _read(JAVASCRIPT_ROOT / "chart-axis-utils.js")
    assert len(TICK_ALGORITHM_SIGNATURE.findall(shared_source)) == 1

    for relative_path in TICK_CONSUMER_SOURCES:
        source = _read(JAVASCRIPT_ROOT / relative_path)
        assert not TICK_ALGORITHM_SIGNATURE.search(source), relative_path
        assert "buildTickIndexSet" in source or "TickIndexSet" in source


def test_every_classic_tick_consumer_loads_after_the_shared_axis_owner() -> None:
    base_template = _read(BASE_TEMPLATE)
    shared_position = base_template.index(SHARED_AXIS_ASSET)

    for asset in CLASSIC_TICK_CONSUMERS:
        assert base_template.index(asset) > shared_position, asset


def test_module_tick_consumers_depend_on_the_deferred_module_ordering() -> None:
    # Module scripts are deferred by specification, so the classic shared owner
    # has always executed by the time these entrypoints run. Each one resolves
    # the shared global rather than restating the algorithm.
    for relative_path in MODULE_TICK_CONSUMERS:
        source = _read(JAVASCRIPT_ROOT / relative_path)
        assert "WORTHWARD_CHART_AXIS" in source, relative_path

    live_trading_template = _read(PROJECT_ROOT / "app/web/templates/live_trading.html")
    assert 'type="module"' in live_trading_template
    assert "assets/js/live-trading.js" in live_trading_template
