"""Regression tests for the shared floating-banner presentation contract. Code version: v0.3.1."""

from pathlib import Path

from app import create_app
from tests.css_test_utils import read_css_bundle


PROJECT_ROOT = Path(__file__).resolve().parents[1]
TEMPLATES_ROOT = PROJECT_ROOT / "app/web/templates"
STATIC_ROOT = PROJECT_ROOT / "app/web/static/assets"


def test_all_floating_banner_surfaces_use_the_shared_banner_macro() -> None:
    for template_name in ("base.html", "investment.html", "live_trading.html", "settings.html"):
        template = (TEMPLATES_ROOT / template_name).read_text(encoding="utf-8")
        assert "render_notice_banner" in template


def test_shared_banner_css_aligns_title_body_icon_and_hanging_numbered_copy() -> None:
    css = (STATIC_ROOT / "css/views/workspace.css").read_text(encoding="utf-8")
    icon_rule_start = css.index(".notice-floating-banner-icon {")
    icon_rule = css[icon_rule_start : css.index("\n}", icon_rule_start)]

    assert "align-items: start !important;" in css
    assert "align-self: start;" in css
    assert "margin-top" not in icon_rule
    assert ".notice-floating-banner-content" in css
    assert ".notice-floating-banner-content:has(> .notice-floating-banner-heading)" in css
    assert "display: contents;" in css
    assert ".notice-floating-banner-copy" in css
    assert (
        ".notice-floating-banner-copy {\n"
        "    grid-column: 2;\n"
        "    grid-row: 2;\n"
        "    align-self: start;\n"
        "    margin: 0;"
    ) in css
    assert "font-weight: var(--font-weight-regular);" in css
    assert "list-style-position: outside;" in css
    assert "padding-inline-start: var(--workspace-modal-list-padding-inline-start);" in css
    assert "padding-inline-start: var(--workspace-modal-list-marker-gap);" in css
    assert ".workspace-modal-list" in css
    assert ".notice-floating-banner-emphasis-danger" in css
    assert ".notice-floating-banner-icon-success" in css


def test_shared_banner_macro_emits_one_valid_body_element_per_title() -> None:
    macro = (TEMPLATES_ROOT / "_macros.html").read_text(encoding="utf-8")
    specimen = (
        TEMPLATES_ROOT / "settings/_style_tokens.html"
    ).read_text(encoding="utf-8")

    assert '<ol class="notice-floating-banner-list">{{ caller() }}</ol>' in macro
    assert '<p class="notice-floating-banner-copy">{{ caller() }}</p>' in macro
    assert "numbered=true" in specimen
    assert '<li{% if loop.first %}' in specimen
    assert '<p class="notice-floating-banner-copy"><ol' not in specimen


def test_notifications_reuse_the_approved_waiting_copy_hierarchy() -> None:
    css = (STATIC_ROOT / "css/views/workspace.css").read_text(encoding="utf-8")
    for selector in (".workspace-modal-title", ".notice-floating-banner-heading"):
        rule = css.split(f"{selector} {{", maxsplit=1)[1].split("}", maxsplit=1)[0]
        assert "font-weight: var(--font-weight-semibold);" in rule
        assert "overflow-wrap: anywhere;" in rule
    for selector in (".workspace-modal-copy", ".notice-floating-banner-copy"):
        rule = css.split(f"{selector} {{", maxsplit=1)[1].split("}", maxsplit=1)[0]
        assert "color: var(--muted);" in rule
        assert "font-weight: var(--font-weight-regular);" in rule
        assert "min-width: 0;" in rule
        assert "overflow-wrap: anywhere;" in rule
        assert "font-size: var(--font-size-5);" in rule
    for selector in (".workspace-modal-list", ".notice-floating-banner-list"):
        rule = css.split(f"{selector} {{", maxsplit=1)[1].split("}", maxsplit=1)[0]
        assert "font-size: var(--font-size-5);" in rule
        assert "list-style-position: outside;" in rule
    content_rule = css.split(".notice-floating-banner-content {", maxsplit=1)[1].split(
        "}", maxsplit=1
    )[0]
    assert "color: var(--muted);" in content_rule
    assert (
        ".workspace-modal-close .icon,\n"
        ".notice-floating-banner .notice-close .icon {\n"
        "    width: 12px;\n"
        "    height: 12px;"
    ) in css


def test_approved_waiting_material_is_scoped_to_notification_consumers() -> None:
    tokens = (STATIC_ROOT / "css/foundation/tokens.css").read_text(encoding="utf-8")
    workspace = (STATIC_ROOT / "css/views/workspace.css").read_text(encoding="utf-8")
    settings = (STATIC_ROOT / "css/views/settings.css").read_text(encoding="utf-8")
    for token in ("--workspace-modal-material", "--notice-floating-material"):
        assert f"{token}: var(--frosted-glass-notice-background);" in tokens
    assert "--frosted-glass-notice-blur: saturate(160%) blur(18px);" in tokens
    assert "--frosted-glass-surface-opacity: 62%;" in tokens
    assert "--frosted-glass-blur: blur(12px);" in tokens
    assert "--frosted-glass-notice-background:" in tokens
    assert "rgba(255, 255, 255, 0.24)" in tokens
    assert "rgba(248, 249, 250, 0.18)" in tokens
    assert "rgba(10, 14, 20, 0.06)" in tokens
    for source, selector in (
        (workspace, ".workspace-modal-dialog"),
        (workspace, ".notice-floating"),
        (settings, "div.style-token-modal-demo"),
    ):
        rule = source.split(f"{selector} {{", maxsplit=1)[1].split("}", maxsplit=1)[0]
        assert "border: var(--frosted-glass-notice-border);" in rule
        assert "box-shadow: var(--frosted-glass-notice-shadow);" in rule
        assert "backdrop-filter: var(--frosted-glass-notice-blur);" in rule


def test_live_trading_pin_adapter_inherits_material_without_changing_security() -> None:
    template = (TEMPLATES_ROOT / "live_trading_unlock.html").read_text(encoding="utf-8")
    for selector in (".live-trading-pin-overlay", ".live-trading-pin-dialog"):
        rule = template.split(f"{selector} {{", maxsplit=1)[1].split("}", maxsplit=1)[0]
        for shader_property in (
            "background:",
            "border:",
            "box-shadow:",
            "backdrop-filter:",
        ):
            assert shader_property not in rule
    assert ".live-trading-pin-dialog::after" not in template
    assert "grid-template-columns: minmax(0, 1fr);" in template
    assert "padding: var(--live-trading-pin-dialog-padding);" in template
    assert "width: min(var(--live-trading-pin-dialog-width), calc(100vw - 32px));" in template
    assert 'class="workspace-modal-overlay live-trading-pin-overlay"' in template
    assert 'class="workspace-modal-dialog live-trading-pin-dialog"' in template
    assert 'method="post" action="/trade/live-trading/unlock"' in template
    assert 'type="password"' in template
    assert 'pattern="[0-9]{6}"' in template
    assert 'autocomplete="one-time-code"' in template
    assert 'id="live_trading_pin_submit" type="submit" disabled' in template


def test_dynamic_banner_message_containers_use_explicit_title_and_body_classes() -> None:
    investment_template = (TEMPLATES_ROOT / "investment.html").read_text(encoding="utf-8")
    live_trading_template = (TEMPLATES_ROOT / "live_trading.html").read_text(encoding="utf-8")
    investment_javascript = (
        STATIC_ROOT / "js/investment/runtime/stock-history-filters.js"
    ).read_text(encoding="utf-8")
    live_trading_javascript = (
        STATIC_ROOT / "js/live-trading.js"
    ).read_text(encoding="utf-8")

    for template in (investment_template, live_trading_template):
        assert "message_container=true" in template

    for javascript in (investment_javascript, live_trading_javascript):
        assert '<p class="notice-floating-banner-heading">' in javascript
        assert '<p class="notice-floating-banner-copy">' in javascript


def test_ibkr_feedback_contains_plain_title_rich_emphasis_and_numbered_list() -> None:
    javascript = (STATIC_ROOT / "js/investment/import-feedback.js").read_text(encoding="utf-8")
    entry_javascript = (STATIC_ROOT / "js/investment.js").read_text(encoding="utf-8")
    investment_css = read_css_bundle(STATIC_ROOT / "css/views/investment.css")

    assert "from './investment/import-feedback.js?" in entry_javascript
    assert '<p class="notice-floating-banner-heading">IBKR import complete</p>' in javascript
    assert "<strong>incrementally</strong>" in javascript
    assert "<u>Transfer review</u>" in javascript
    assert "marked Unbound in Transaction history" in javascript
    assert "notice-floating-banner-emphasis-danger" in javascript
    assert 'class="notice-floating-banner-list investment-import-feedback-list"' in javascript
    assert "IBKR import complete.</p>" not in javascript
    assert ".investment-import-feedback-list {\n    color: var(--muted);\n}" in investment_css


def test_server_notice_renders_the_same_title_and_numbered_copy_structure() -> None:
    response = create_app().test_client().get(
        "/workspaces/compare?notice=Saved%20the%20latest%20configuration."
    )

    body = response.get_data(as_text=True)
    assert response.status_code == 200
    assert '<p class="notice-floating-banner-heading">Notice</p>' in body
    assert '<p class="notice-floating-banner-copy">' in body
    assert 'Saved the latest configuration.' in body
    assert 'class="notice-floating-banner-list"><li>Saved the latest configuration.' not in body


def test_investment_import_progress_uses_the_workspace_modal_contract() -> None:
    base_template = (TEMPLATES_ROOT / "base.html").read_text(encoding="utf-8")
    investment_workflow_javascript = (
        STATIC_ROOT / "js/investment/runtime/stock-history-filters.js"
    ).read_text(encoding="utf-8")

    assert 'id="workspace_modal_overlay"' in base_template
    assert 'role="dialog"' in base_template
    assert 'aria-modal="true"' in base_template
    assert 'aria-labelledby="workspace_modal_overlay_title"' in base_template
    assert 'aria-describedby="workspace_modal_overlay_copy"' in base_template
    assert "title: 'Import in progress'" in investment_workflow_javascript
    assert "showInvestmentImportProgressModal(resolvedMessage);" in investment_workflow_javascript
    assert "if (isLoading) {" in investment_workflow_javascript


def test_investment_import_feedback_escapes_the_report_card_stacking_context() -> None:
    investment_javascript = (STATIC_ROOT / "js/investment.js").read_text(encoding="utf-8")
    investment_css = read_css_bundle(STATIC_ROOT / "css/views/investment.css")

    assert "importFeedback.parentElement !== document.body" in investment_javascript
    assert "document.body.append(runtime.importFeedback);" in investment_javascript
    assert (
        ".investment-import-feedback-banner {\n"
        "    width: min(460px, calc(100vw - (var(--page-edge-pad) * 2)));\n"
        "    max-width: calc(100vw - (var(--page-edge-pad) * 2));\n"
        "    line-height: 1.5;\n"
        "    z-index: calc(var(--layer-global-popover) + 1);"
    ) in investment_css
