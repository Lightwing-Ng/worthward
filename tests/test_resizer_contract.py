"""Tests for the shared inline and block resizer contract. Code version: v1.2.3."""

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


def test_shared_resizer_uses_canonical_frosted_glass_material() -> None:
    css = (ROOT / "app/web/static/assets/css/components/resizer.css").read_text(
        encoding="utf-8",
    )
    tokens = (ROOT / "app/web/static/assets/css/foundation/tokens.css").read_text(
        encoding="utf-8",
    )
    trade_css = (ROOT / "app/web/static/assets/css/views/trade.css").read_text(
        encoding="utf-8",
    )
    js = (ROOT / "app/web/static/assets/js/resizer.js").read_text(encoding="utf-8")

    assert "--surface-resizer-handle-background: var(--frosted-glass-background);" in tokens
    assert "--surface-resizer-handle-shadow: var(--frosted-glass-shadow);" in tokens
    assert "--surface-resizer-handle-blur: var(--frosted-glass-blur);" in tokens
    assert "background: var(--surface-resizer-handle-background);" in css
    assert "box-shadow: var(--surface-resizer-handle-shadow);" in css
    assert "backdrop-filter: var(--surface-resizer-handle-blur);" in css
    for pseudo in ("::-webkit-slider-thumb", "::-moz-range-thumb"):
        thumb_rule = trade_css.split(f".strategy-allocation-handle{pseudo} {{", 1)[1]
        thumb_rule = thumb_rule.split("}", 1)[0]
        assert "border: var(--surface-resizer-handle-border);" in thumb_rule
        interactive_rule = trade_css.split(
            f".strategy-allocation-handle:active{pseudo} {{", 1,
        )[1].split("}", 1)[0]
        assert "border-color: var(--accent-border-medium);" in interactive_rule
        assert "0 0 0 4px var(--accent-focus-ring)" in interactive_rule
        assert "0 0 18px var(--accent-focus-glow)" in interactive_rule
    assert "background: var(--strategy-range-thumb-background, var(--surface-resizer-handle-background));" in trade_css
    assert "box-shadow: var(--surface-resizer-handle-shadow);" in trade_css
    assert "backdrop-filter: var(--surface-resizer-handle-blur);" in trade_css
    assert ".surface-resizer--inline" in css
    assert ".surface-resizer--block" in css
    assert "ArrowUp" in js
    assert "ArrowLeft" in js
