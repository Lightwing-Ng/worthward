"""
Application factory for the stock comparison web app.

Code version: v0.4.0
"""

import secrets

from flask import Flask

from app.core.broker_catalog import (
    INVESTMENT_IMPORT_BROKER_CODES,
    LIVE_TRADING_BROKER_CODES,
    SETTINGS_BROKER_CODES,
    sorted_broker_entries,
)
from app.web.routes_entry import register_routes


def create_app() -> Flask:
    app = Flask(
        __name__,
        template_folder="web/templates",
        static_folder="web/static",
    )
    # Browser unlocks last only for this process and browser session.
    app.secret_key = secrets.token_bytes(32)
    app.config.update(
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Strict",
    )

    @app.context_processor
    def inject_broker_catalog() -> dict[str, object]:
        return {
            "sorted_broker_entries": sorted_broker_entries,
            "settings_broker_codes": SETTINGS_BROKER_CODES,
            "live_trading_broker_codes": LIVE_TRADING_BROKER_CODES,
            "investment_import_broker_codes": INVESTMENT_IMPORT_BROKER_CODES,
        }

    register_routes(app)
    return app
