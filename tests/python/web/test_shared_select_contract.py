"""Focused Shared select presentation contract tests. Code version: v1.1.3."""

from __future__ import annotations

from pathlib import Path
import re


PROJECT_ROOT = Path(__file__).resolve().parents[3]
TOKENS_PATH = PROJECT_ROOT / "app/web/static/assets/css/foundation/tokens.css"
FORMS_PATH = PROJECT_ROOT / "app/web/static/assets/css/components/forms.css"
STYLE_TOKEN_ROWS_PATH = PROJECT_ROOT / "app/web/presentation/style_token_rows.py"
WORKFLOW_PATH = PROJECT_ROOT / "docs/SHARED_UI_WORKFLOW.md"
LAYOUT_CONTRACT_PATH = PROJECT_ROOT / "SHARED_UI_LAYOUT_CONTRACT.md"


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def test_shared_select_tokens_publish_material_geometry_and_chevron_contract() -> None:
    tokens_css = _read(TOKENS_PATH)
    style_token_rows = _read(STYLE_TOKEN_ROWS_PATH)

    expected_declarations = (
        "--shared-select-trigger-material: var(--frosted-glass-background);",
        "--shared-select-trigger-material-hover: var(--frosted-glass-background-hover);",
        "--shared-select-dropdown-surface-opacity: 62%;",
        "--shared-select-dropdown-material:",
        "color-mix(in srgb, var(--theme-glass-highlight) 56%, transparent) 0%,",
        "color-mix(in srgb, var(--theme-glass-highlight) 16%, transparent) 100%",
        "color-mix(in srgb, var(--theme-background) var(--shared-select-dropdown-surface-opacity), transparent);",
        "--shared-select-border: var(--frosted-glass-border);",
        "--shared-select-shadow: var(--frosted-glass-shadow);",
        "--shared-select-shadow-hover: var(--frosted-glass-shadow-hover);",
        "--shared-select-blur: var(--frosted-glass-blur);",
        "--shared-select-control-height: 30px;",
        "--shared-select-trigger-padding-inline-end: 36px;",
        "--shared-select-dropdown-max-width: var(--layout-control-width);",
        "--shared-select-option-min-height: 36px;",
        "--shared-select-chevron-width: 12px;",
        "--shared-select-chevron-height: 8px;",
        "--shared-select-chevron-closed-rotation: -90deg;",
        "--shared-select-chevron-open-rotation: 0deg;",
        "--shared-select-chevron-transition-duration: 180ms;",
    )
    for declaration in expected_declarations:
        assert declaration in tokens_css

    for token_name in (
        "--shared-select-trigger-material",
        "--shared-select-trigger-material-hover",
        "--shared-select-dropdown-material",
        "--shared-select-dropdown-surface-opacity",
        "--shared-select-border",
        "--shared-select-shadow",
        "--shared-select-shadow-hover",
        "--shared-select-blur",
        "--shared-select-trigger-padding-inline-end",
        "--shared-select-dropdown-max-width",
        "--shared-select-chevron-mask",
        "--shared-select-chevron-width",
        "--shared-select-chevron-height",
        "--shared-select-chevron-closed-rotation",
        "--shared-select-chevron-open-rotation",
        "--shared-select-chevron-transition-duration",
    ):
        assert style_token_rows.count(f'"{token_name}"') == 1


def test_shared_select_css_consumes_semantic_material_and_chevron_tokens() -> None:
    forms_css = _read(FORMS_PATH)

    for declaration in (
        "background: var(--shared-select-trigger-material);",
        "background: var(--shared-select-trigger-material-hover);",
        "background: var(--shared-select-dropdown-material);",
        "border: var(--shared-select-border) !important;",
        "border: var(--shared-select-border);",
        "box-shadow: var(--shared-select-shadow);",
        "box-shadow: var(--shared-select-shadow-hover);",
        "backdrop-filter: var(--shared-select-blur);",
        "padding-inline-end: var(--shared-select-trigger-padding-inline-end);",
        "max-width: min(100%, var(--shared-select-dropdown-max-width));",
        "width: var(--shared-select-chevron-width);",
        "height: var(--shared-select-chevron-height);",
        "background-color: currentColor;",
        "transform: translateY(-50%) rotate(var(--shared-select-chevron-closed-rotation));",
        "transform: translateY(-50%) rotate(var(--shared-select-chevron-open-rotation));",
        "transition: transform var(--shared-select-chevron-transition-duration) var(--motion-standard);",
    ):
        assert declaration in forms_css

    assert (
        ".backtest-shared-select-trigger > .trade-strategy-trigger-chevron {"
        "\n\tdisplay: none;"
    ) in forms_css
    assert (
        ".investment-broker-filter-trigger.backtest-shared-select-trigger::after {"
        "\n\tcontent: none;"
    ) in forms_css
    assert (
        ".strategy-param-dropdown {"
        "\n\tbackground: var(--frosted-glass-opaque-background);"
    ) in forms_css
    assert "@media (prefers-reduced-motion: reduce)" in forms_css
    assert (
        ".backtest-shared-select-trigger::after {"
        "\n\t\ttransition: none !important;"
    ) in forms_css


def test_shared_select_workflow_documents_reusable_and_product_boundaries() -> None:
    workflow = _read(WORKFLOW_PATH)

    assert "agenticContext vendors the aligned v1.0.1 controller" in workflow
    assert "standard single-value select adapter" in workflow
    assert "30 px high" in workflow
    assert "36 px high" in workflow
    assert "384 px shared control" in workflow
    assert "420 px cap" in workflow
    assert "Product-specific multi-select filters and compact" in workflow
    assert "table-header filters also remain adapter-owned" in workflow


def test_public_layout_contract_carries_complete_standard_select_semantics() -> None:
    contract = _read(LAYOUT_CONTRACT_PATH)
    normalized_contract = " ".join(contract.split())

    assert re.search(r"Documentation version: `v\d+\.\d+\.\d+`", contract)
    assert "This specimen-only presentation leaves ordinary" in normalized_contract
    assert "### Standard single-value Shared select" in contract
    for required_text in (
        "sole form and application-state authority",
        '`aria-haspopup="listbox"`',
        '`button[type="button"][role="option"]`',
        '`aria-disabled="true"`',
        "exactly one bubbling native `change` event",
        "A hidden or disabled backing select",
        "select-controller.js` v1.0.1",
        "skips hidden or disabled options",
        "--shared-select-trigger-material",
        "--shared-select-dropdown-material",
        "--shared-select-dropdown-surface-opacity: 62%",
        "12px by 8px `currentColor` down-chevron",
        "points right while closed and down while open",
        "Reduced motion removes that transition",
        "Standard field and menu width is `min(parent inline size, 384px)`",
        "Internal menu scrolling does not move the portal",
    ):
        assert required_text in normalized_contract
