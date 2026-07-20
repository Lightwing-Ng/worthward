"""Canonical workspace, trade, and settings path helpers.

Code version: v1.0.0
"""

from __future__ import annotations

MAX_TICKERS = 5
MIN_TICKERS = 2

LEGACY_VIEW_ALIASES = {
    "trade-messages": "backtest",
}
SUPPORTED_VIEWS = {
    "tickers",
    "market-caps",
    "prices",
    "portfolio",
    "dca",
    "backtest",
    "grid-trading",
    "trade",
    "settings",
}
BACKTEST_VIEWS = {"backtest", "grid-trading"}
SUPPORTED_SETTINGS_SECTIONS = {
    "about",
    "general",
    "backtest",
    "font-tokens",
    "material-tokens",
    "network",
    "strategies",
    "email-smtp",
    "broker-access",
    "local-market-store",
    "clear-caches",
    "style-tokens",
    "export-image",
    "cash-equivalents",
}
SUPPORTED_TRADE_SECTIONS = {"investment", "live-trading"}
LEGACY_TRADE_SECTION_ALIASES = {
    "timing": "investment",
    "invest": "investment",
    "live": "live-trading",
    "live_trading": "live-trading",
}
VIEW_PATHS = {
    "tickers": "/workspaces/compare",
    "market-caps": "/workspaces/market-caps",
    "prices": "/workspaces/prices",
    "portfolio": "/workspaces/portfolio",
    "dca": "/workspaces/dca",
    "backtest": "/workspaces/backtest",
    "grid-trading": "/workspaces/grid-trading",
    "trade": "/trade/investment",
    "settings": "/settings/about",
}


def normalize_view_name(view_name: str | None) -> str:
    """Return a supported workspace view key, applying legacy aliases."""
    requested_view = (view_name or "tickers").strip().lower()
    requested_view = LEGACY_VIEW_ALIASES.get(requested_view, requested_view)
    return requested_view if requested_view in SUPPORTED_VIEWS else "tickers"


def build_view_path(view_name: str) -> str:
    """Return the canonical path for a workspace view."""
    return VIEW_PATHS.get(normalize_view_name(view_name), VIEW_PATHS["tickers"])


def build_view_url(view_name: str) -> str:
    """Alias of build_view_path for template/url call sites."""
    return build_view_path(view_name)


def normalize_settings_section(section_name: str | None) -> str:
    """Return a supported settings section key."""
    candidate = (section_name or "about").strip().lower()
    return candidate if candidate in SUPPORTED_SETTINGS_SECTIONS else "about"


def build_settings_path(section_name: str) -> str:
    """Return the canonical path for a settings section."""
    return f"/settings/{normalize_settings_section(section_name)}"


def build_settings_url(section_name: str) -> str:
    """Alias of build_settings_path for template/url call sites."""
    return build_settings_path(section_name)


def normalize_trade_section(section_name: str | None) -> str:
    """Return a supported trade section key, applying legacy aliases."""
    candidate = (section_name or "investment").strip().lower()
    candidate = LEGACY_TRADE_SECTION_ALIASES.get(candidate, candidate)
    return candidate if candidate in SUPPORTED_TRADE_SECTIONS else "investment"


def build_trade_path(section_name: str) -> str:
    """Return the canonical path for a trade section."""
    return f"/trade/{normalize_trade_section(section_name)}"


def build_trade_url(section_name: str) -> str:
    """Alias of build_trade_path for template/url call sites."""
    return build_trade_path(section_name)
