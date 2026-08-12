"""Contracts for the SF Symbols-derived web asset reserve.

Code version: v1.0.0
"""

from __future__ import annotations

from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[1]
IMAGE_DIR = ROOT / "app/web/static/images"
CATALOG = IMAGE_DIR / "SF_SYMBOLS.md"
TRADE_CSS = ROOT / "app/web/static/assets/css/views/trade.css"

TRADING_RESERVE = (
    "arrow.left.arrow.right",
    "arrow.up.and.down.square",
    "bell.fill",
    "bolt.fill",
    "briefcase.fill",
    "building.columns.fill",
    "calendar.badge.clock",
    "chart.dots.scatter",
    "chart.line.downtrend.xyaxis",
    "chart.line.flattrend.xyaxis",
    "chart.line.text.clipboard.fill",
    "chart.line.uptrend.xyaxis",
    "chart.pie.fill",
    "chart.xyaxis.line",
    "clock.badge",
    "dollarsign.circle.fill",
    "exclamationmark.shield.fill",
    "exclamationmark.triangle.fill",
    "gauge.with.dots.needle.50percent",
    "line.3.horizontal.decrease.circle",
    "list.bullet.clipboard.fill",
    "lock.shield.fill",
    "magnifyingglass",
    "percent",
    "rectangle.stack.badge.plus",
    "star.fill",
    "text.page.badge.magnifyingglass",
)


def test_trading_reserve_uses_compact_core_svg_exports() -> None:
    catalog = CATALOG.read_text(encoding="utf-8")

    for symbol_name in TRADING_RESERVE:
        asset = IMAGE_DIR / f"{symbol_name}.svg"
        source = asset.read_text(encoding="utf-8")

        assert f"`{symbol_name}`" in catalog
        assert "<!--Generator: Apple Native CoreSVG 341-->" in source
        assert re.search(r'viewBox="0 0 [0-9.]+ [0-9.]+"', source)
        assert '<rect ' in source and 'opacity="0"' in source
        assert 'fill="black"' in source
        assert 'fill-opacity="0.85"' in source
        assert 'viewBox="0 0 3300 2200"' not in source
        assert "<style>" not in source
        assert "<text " not in source


def test_live_trading_uses_the_official_sf_symbols_name() -> None:
    trade_css = TRADE_CSS.read_text(encoding="utf-8")
    official_asset = IMAGE_DIR / "waveform.and.person.filled.svg"

    assert official_asset.is_file()
    assert not (IMAGE_DIR / "waveform.and.person.svg").exists()
    assert trade_css.count("waveform.and.person.filled.svg") == 2
    assert "waveform.and.person.svg" not in trade_css
