"""
Settings route registration.

Code version: v0.4.1
"""

from flask import Flask

from app.web.runtime import WebRuntime


def register_settings_routes(app: Flask, runtime: WebRuntime) -> None:
    app.get("/favicon.svg")(runtime.favicon_icon)
    app.get("/settings")(runtime.settings_root)
    app.get("/settings/<section_name>")(runtime.settings_page)
    app.post("/settings/general/action")(runtime.general_settings_action)
    app.post("/api/settings/language")(runtime.language_settings_api)
    app.post("/api/settings/language/cycle")(runtime.language_cycle_api)
    app.get("/api/settings/language/mapping.xlsx")(runtime.language_download_api)
    app.post("/settings/backtest/action")(runtime.backtest_settings_action)
    app.post("/settings/cash-equivalents/action")(runtime.cash_equivalents_action)
    app.post("/settings/email-smtp/action")(runtime.email_smtp_action)
    app.post("/settings/broker-access/action")(runtime.broker_access_action)
    app.get("/api/settings/longbridge-oauth/status")(runtime.longbridge_oauth_status_api)
    app.post("/settings/local-market-store/action")(runtime.local_market_store_action)
    app.post("/settings/cache/action")(runtime.settings_cache_action)
    app.get("/market-store/logos/<path:filename>")(runtime.market_store_logo)
    app.get("/api/settings/network-status")(runtime.settings_network_status_api)
    app.get("/api/settings/local-market-store/page-data")(runtime.local_market_store_page_data_api)
