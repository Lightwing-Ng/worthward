"""Regression tests for the shared floating-banner presentation contract. Code version: v0.2.0."""

from pathlib import Path

from app import create_app


PROJECT_ROOT = Path(__file__).resolve().parents[1]
TEMPLATES_ROOT = PROJECT_ROOT / "app/web/templates"
STATIC_ROOT = PROJECT_ROOT / "app/web/static/assets"


def test_all_floating_banner_surfaces_use_the_shared_banner_macro() -> None:
    for template_name in ("base.html", "investment.html", "live_trading.html", "settings.html"):
        template = (TEMPLATES_ROOT / template_name).read_text(encoding="utf-8")
        assert "render_notice_banner" in template


def test_shared_banner_css_uses_top_aligned_icon_and_hanging_numbered_copy() -> None:
    css = (STATIC_ROOT / "css/views/workspace.css").read_text(encoding="utf-8")

    assert "align-items: start !important;" in css
    assert "align-self: start;" in css
    assert "margin-top: 2px;" in css
    assert ".notice-floating-banner-content" in css
    assert ".notice-floating-banner-copy" in css
    assert "font-weight: var(--font-weight-regular);" in css
    assert "list-style-position: outside;" in css
    assert ".notice-floating-banner-emphasis-danger" in css
    assert ".notice-floating-banner-icon-success" in css


def test_ibkr_feedback_contains_plain_title_rich_emphasis_and_numbered_list() -> None:
    javascript = (STATIC_ROOT / "js/investment.js").read_text(encoding="utf-8")

    assert '<p class="notice-floating-banner-heading">IBKR import complete</p>' in javascript
    assert "<strong>incrementally</strong>" in javascript
    assert "<u>Immediate action</u>" in javascript
    assert "notice-floating-banner-emphasis-danger" in javascript
    assert 'class="notice-floating-banner-list investment-import-feedback-list"' in javascript
    assert "IBKR import complete.</p>" not in javascript


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
