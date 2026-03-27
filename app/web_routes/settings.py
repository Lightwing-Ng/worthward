"""
Settings route registration.

Code version: v1.0.0
"""

from flask import Flask

from ..web_runtime import WebRuntime


def register_settings_routes(app: Flask, runtime: WebRuntime) -> None:
    app.get("/settings")(runtime.settings_root)
    app.get("/settings/<section_name>")(runtime.settings_page)
    app.post("/settings/general/action")(runtime.general_settings_action)
    app.post("/settings/email-smtp/action")(runtime.email_smtp_action)
    app.post("/settings/broker-access/action")(runtime.broker_access_action)
    app.post("/settings/local-market-store/action")(runtime.local_market_store_action)
    app.post("/settings/cache/action")(runtime.settings_cache_action)
    app.get("/market-store/logos/<path:filename>")(runtime.market_store_logo)
    app.get("/api/settings/network-status")(runtime.settings_network_status_api)
    app.get("/api/settings/local-market-store/page-data")(runtime.local_market_store_page_data_api)
