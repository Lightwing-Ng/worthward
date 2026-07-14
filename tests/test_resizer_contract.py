"""Tests for the shared inline and block resizer contract. Code version: v1.0.0."""

from __future__ import annotations

from pathlib import Path

from app import create_app


ROOT = Path(__file__).resolve().parents[1]


def test_settings_and_investment_resizers_share_one_component() -> None:
    client = create_app().test_client()

    settings_html = client.get("/settings/style-tokens").get_data(as_text=True)
    investment_html = client.get("/trade/investment").get_data(as_text=True)

    assert "surface-resizer surface-resizer--inline style-token-resizer" in settings_html
    assert 'aria-orientation="vertical"' in settings_html
    assert "surface-resizer surface-resizer--block surface-resizer--reveal" in investment_html
    assert 'aria-orientation="horizontal"' in investment_html


def test_shared_resizer_uses_extracted_frosted_glass_material() -> None:
    css = (ROOT / "app/web/static/assets/css/components/resizer.css").read_text(
        encoding="utf-8",
    )
    js = (ROOT / "app/web/static/assets/js/resizer.js").read_text(encoding="utf-8")

    assert "background: var(--frosted-glass-extracted-background);" in css
    assert "box-shadow: var(--frosted-glass-extracted-shadow);" in css
    assert "backdrop-filter: var(--frosted-glass-extracted-blur);" in css
    assert ".surface-resizer--inline" in css
    assert ".surface-resizer--block" in css
    assert "ArrowUp" in js
    assert "ArrowLeft" in js
