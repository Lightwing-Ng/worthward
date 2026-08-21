"""Tests for the unified responsive breakpoint contract. Code version: v0.2.3."""

from __future__ import annotations

from pathlib import Path
import re


PROJECT_ROOT = Path(__file__).resolve().parents[1]
TOKENS_CSS = PROJECT_ROOT / "app/web/static/assets/css/foundation/tokens.css"
RESPONSIVE_JS = PROJECT_ROOT / "app/web/static/assets/js/responsive.js"
BASE_HTML = PROJECT_ROOT / "app/web/templates/base.html"
UNLOCK_HTML = PROJECT_ROOT / "app/web/templates/live_trading_unlock.html"

EXPECTED_REGISTRY = {
    "layout-switch-min": 768,
    "compact-layout-max": 600,
    "sidebar-overlay-max": 900,
    "settings-density-max": 980,
    "investment-form-density-max": 1080,
    "trade-layout-min": 1024,
    "trade-metrics-wide-min": 1200,
    "pagination-compact-max": 320,
    "pagination-tiny-max": 280,
    "investment-date-grid-max": 560,
    "portfolio-donut-max": 430,
    "sidebar-toggle-tight-max": 500,
    "live-pin-tight-max": 420,
}

EXPECTED_MEDIA_VALUES = {*EXPECTED_REGISTRY.values(), EXPECTED_REGISTRY["layout-switch-min"] - 1}


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _camelize(value: str) -> str:
    head, *tail = value.split("-")
    return head + "".join(part.title() for part in tail)


def test_css_breakpoints_have_one_semantic_registry() -> None:
    token_source = _read(TOKENS_CSS)
    registry = {
        name: int(value)
        for name, value in re.findall(
            r"--responsive-breakpoint-([a-z0-9-]+):\s*([0-9]+)px;",
            token_source,
        )
    }

    assert {name: registry[name] for name in EXPECTED_REGISTRY} == EXPECTED_REGISTRY

    responsive_sources = list(
        (PROJECT_ROOT / "app/web/static/assets/css").rglob("*.css")
    ) + [BASE_HTML, UNLOCK_HTML]
    media_values = {
        int(value)
        for path in responsive_sources
        for value in re.findall(
            r"\((?:min|max)-width\s*:\s*([0-9]+)px\)",
            _read(path),
        )
    }

    assert media_values == EXPECTED_MEDIA_VALUES


def test_javascript_reads_width_media_queries_from_shared_responsive_api() -> None:
    responsive_source = _read(RESPONSIVE_JS)
    assert "window.ANTIGRAVITY_RESPONSIVE = Object.freeze" in responsive_source
    assert "contentStackMax: layoutSwitchMin - 1" in responsive_source
    fallback_source = responsive_source.split(
        "const fallbackValues = Object.freeze({", maxsplit=1
    )[1].split("});", maxsplit=1)[0]
    fallback_values = {
        name: int(value)
        for name, value in re.findall(r"^\s+([a-zA-Z]+):\s*([0-9]+),$", fallback_source, re.MULTILINE)
    }
    assert {
        _camelize(name): value for name, value in EXPECTED_REGISTRY.items()
    } == fallback_values

    javascript_sources = [
        path
        for path in (PROJECT_ROOT / "app/web/static/assets/js").rglob("*.js")
        if path != RESPONSIVE_JS
    ]
    direct_width_query = re.compile(r"matchMedia\(\s*[\"'`][^\"'`]*-width")

    for path in javascript_sources:
        assert direct_width_query.search(_read(path)) is None, path

    base_source = _read(BASE_HTML)
    assert 'assets/js/responsive.js' in base_source
    assert base_source.index('assets/js/responsive.js') < base_source.index(
        'window.sessionStorage.getItem("antigravity:sidebar-open")'
    )


def test_sidebar_overlay_keeps_touch_toggle_above_its_backdrop() -> None:
    token_source = _read(TOKENS_CSS)
    responsive_source = _read(PROJECT_ROOT / "app/web/static/assets/css/utilities/responsive.css")
    overlay_block = responsive_source.split("@media (max-width: 900px)", maxsplit=1)[1].split(
        "@media (max-width: 600px)", maxsplit=1
    )[0]

    for token in (
        "--sidebar-overlay-inset-top",
        "--sidebar-overlay-inset-right",
        "--sidebar-overlay-inset-bottom",
        "--sidebar-overlay-inset-left",
        "--sidebar-overlay-available-inline-size",
        "--layer-sidebar-toggle: 220",
    ):
        assert token in token_source

    for fragment in (
        ".sidebar-backdrop {\n\t\tdisplay: none;\n\t\tvisibility: hidden;\n\t\tpointer-events: none;",
        ".sidebar-backdrop:not([hidden]) {",
        "display: block;",
        "visibility: visible;",
        "pointer-events: auto;",
        "width: 44px;",
        "height: 44px;",
        "z-index: var(--layer-sidebar-toggle);",
        "touch-action: manipulation;",
    ):
        assert fragment in overlay_block


def test_sidebar_toggle_is_outside_the_shell_stacking_context() -> None:
    template_source = _read(BASE_HTML)
    toggle_index = template_source.index('id="sidebar_toggle"')
    shell_index = template_source.index('<div class="app-shell')

    assert toggle_index < shell_index
    assert ".page > .sidebar-toggle" in _read(
        PROJECT_ROOT / "app/web/static/assets/css/utilities/responsive.css"
    )


def test_coarse_pointer_sidebar_toggle_keeps_its_hit_target_stationary() -> None:
    responsive_source = _read(
        PROJECT_ROOT / "app/web/static/assets/css/utilities/responsive.css"
    )
    touch_block = responsive_source.split(
        "@media (max-width: 900px) and (hover: none) and (pointer: coarse)",
        maxsplit=1,
    )[1]

    for fragment in (
        ".page > .sidebar-toggle:hover",
        ".page > .sidebar-toggle:focus-visible",
        ".page > .sidebar-toggle:active",
        "transform: translate3d(var(--sidebar-toggle-x), 0, 0);",
        "transition: background 160ms var(--motion-standard), box-shadow 160ms var(--motion-standard), color 160ms var(--motion-standard);",
    ):
        assert fragment in touch_block


def test_safe_area_viewports_use_cover_layout() -> None:
    assert "viewport-fit=cover" in _read(BASE_HTML)
    assert "viewport-fit=cover" in _read(UNLOCK_HTML)


def test_hidden_elements_cannot_be_reactivated_by_responsive_display_rules() -> None:
    token_source = _read(TOKENS_CSS)

    assert "[hidden] { display: none !important; }" in token_source
