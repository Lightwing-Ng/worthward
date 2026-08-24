"""Canonical workspace, trade, and settings navigation helpers.

Code version: v1.6.0
"""

from __future__ import annotations

from urllib.parse import urlencode

MAX_TICKERS = 5
MARKET_CAP_MAX_TICKERS = 10
MIN_TICKERS = 2
COMPARISON_METRICS = {"price", "market-cap"}

LEGACY_VIEW_ALIASES = {
    "trade-messages": "backtest",
    "grid-trading": "backtest",
}
SUPPORTED_VIEWS = {
    "tickers",
    "market-caps",
    "prices",
    "portfolio",
    "dca",
    "backtest",
    "trade",
    "settings",
}
BACKTEST_VIEWS = {"backtest"}
SUPPORTED_SETTINGS_SECTIONS = {
    "about",
    "general",
    "investment",
    "backtest",
    "font-tokens",
    "color-tokens",
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
LEGACY_SETTINGS_SECTION_ALIASES = {
    "broker": "broker-access",
    "broker_access": "broker-access",
    "font_tokens": "font-tokens",
    "color_tokens": "color-tokens",
    "local_market_store": "local-market-store",
    "local_store": "local-market-store",
    "material_tokens": "material-tokens",
    "style_tokens": "style-tokens",
    "cash_equivalents": "cash-equivalents",
    "investment_accounting": "investment",
    "clear_caches": "clear-caches",
    "email_smtp": "email-smtp",
    "export_image": "export-image",
}
SUPPORTED_SETTINGS_TABS = {"current", "history"}
SETTINGS_PAGINATED_SECTIONS = {"general", "local-market-store"}
SUPPORTED_TRADE_SECTIONS = {"investment", "live-trading"}
LEGACY_TRADE_SECTION_ALIASES = {
    "timing": "investment",
    "invest": "investment",
    "live": "live-trading",
    "live_trading": "live-trading",
}
VIEW_PATHS = {
    "tickers": "/workspaces/compare",
    "market-caps": "/workspaces/prices",
    "prices": "/workspaces/prices",
    "portfolio": "/workspaces/portfolio",
    "dca": "/workspaces/dca",
    "backtest": "/workspaces/backtest",
    "trade": "/trade/investment",
    "settings": "/settings/about",
}


def normalize_comparison_metric(
    metric_name: str | None,
    *,
    default: str = "price",
) -> str:
    """Return a supported Ticker comparison metric."""
    normalized_default = default.strip().lower()
    if normalized_default not in COMPARISON_METRICS:
        normalized_default = "price"
    candidate = (metric_name or "").strip().lower()
    return candidate if candidate in COMPARISON_METRICS else normalized_default


def max_tickers_for_view(
    view_name: str | None,
    comparison_metric: str | None = None,
) -> int:
    """Return the ticker-input limit for a canonical workspace view."""
    normalized_view = normalize_view_name(view_name)
    is_market_cap_comparison = normalized_view == "market-caps" or (
        normalized_view == "prices"
        and normalize_comparison_metric(comparison_metric) == "market-cap"
    )
    return MARKET_CAP_MAX_TICKERS if is_market_cap_comparison else MAX_TICKERS


def normalize_view_name(view_name: str | None) -> str:
    """Return a supported workspace view key, applying legacy aliases."""
    requested_view = (view_name or "tickers").strip().lower()
    requested_view = LEGACY_VIEW_ALIASES.get(requested_view, requested_view)
    return requested_view if requested_view in SUPPORTED_VIEWS else "tickers"


def build_view_path(view_name: str) -> str:
    """Return the canonical path for a workspace view."""
    return VIEW_PATHS.get(normalize_view_name(view_name), VIEW_PATHS["tickers"])


def build_view_url(view_name: str) -> str:
    """Return the canonical workspace URL for template and URL call sites."""
    normalized_view = normalize_view_name(view_name)
    target_path = build_view_path(normalized_view)
    if normalized_view == "market-caps":
        return f"{target_path}?{urlencode({'metric': 'market-cap'})}"
    return target_path


def normalize_settings_section(section_name: str | None) -> str:
    """Return a supported settings section key."""
    candidate = (section_name or "about").strip().lower()
    candidate = LEGACY_SETTINGS_SECTION_ALIASES.get(candidate, candidate)
    return candidate if candidate in SUPPORTED_SETTINGS_SECTIONS else "about"


def build_settings_path(section_name: str) -> str:
    """Return the canonical path for a settings section."""
    return f"/settings/{normalize_settings_section(section_name)}"


def build_settings_url(section_name: str) -> str:
    """Alias of build_settings_path for template/url call sites."""
    return build_settings_path(section_name)


def normalize_settings_tab(tab_name: str | None) -> str:
    """Return the canonical General language-mapping tab."""
    candidate = (tab_name or "current").strip().lower()
    return candidate if candidate in SUPPORTED_SETTINGS_TABS else "current"


def normalize_settings_page(page_number: object, fallback: int = 1) -> int:
    """Return a positive Settings page number, defaulting safely to page one."""
    try:
        parsed = int(str(page_number).strip())
    except (TypeError, ValueError):
        return max(int(fallback), 1)
    return max(parsed, 1)


def build_settings_state_url(
    section_name: str | None,
    *,
    tab: str | None = "current",
    page: object = 1,
) -> str:
    """Return a canonical Settings path and its non-default URL state."""
    section = normalize_settings_section(section_name)
    normalized_tab = normalize_settings_tab(tab)
    normalized_page = normalize_settings_page(page)
    params: list[tuple[str, str]] = []
    if section == "general" and normalized_tab == "history":
        params.append(("tab", "history"))
    if section in SETTINGS_PAGINATED_SECTIONS and normalized_page > 1:
        params.append(("page", str(normalized_page)))
    query_string = urlencode(params)
    base_path = build_settings_path(section)
    return f"{base_path}?{query_string}" if query_string else base_path


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
