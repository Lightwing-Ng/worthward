"""
Application factory for the stock comparison web app.

Code version: v0.10.0
"""

import secrets

from flask import Flask, Response

from app.core.broker_catalog import (
    INVESTMENT_IMPORT_BROKER_CODES,
    LIVE_TRADING_BROKER_CODES,
    SETTINGS_BROKER_CODES,
    sorted_broker_entries,
)
from app.core.upload_limits import (
    INVESTMENT_IMPORT_MULTIPART_ALLOWANCE_BYTES as INVESTMENT_IMPORT_MULTIPART_ALLOWANCE_BYTES,
    MAX_INVESTMENT_IMPORT_REQUEST_BYTES,
)
from app.web.routes_entry import register_routes
from app.web.request_security import get_or_create_investment_csrf_token


# This global Flask request cap permits one artifact-sized multipart request
# plus a small envelope allowance. The separate 256 MiB immutable-evidence
# directory capacity remains enforced by storage and is not an HTTP body limit.


def create_app() -> Flask:
    app = Flask(
        __name__,
        template_folder="web/templates",
        static_folder="web/static",
    )
    # Browser unlocks last only for this process and browser session.
    app.secret_key = secrets.token_bytes(32)
    app.config.update(
        MAX_CONTENT_LENGTH=MAX_INVESTMENT_IMPORT_REQUEST_BYTES,
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Strict",
    )

    @app.after_request
    def apply_baseline_security_headers(response: Response) -> Response:
        """Apply compatible baseline browser protections to every response."""
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        return response

    @app.context_processor
    def inject_broker_catalog() -> dict[str, object]:
        return {
            "sorted_broker_entries": sorted_broker_entries,
            "settings_broker_codes": SETTINGS_BROKER_CODES,
            "live_trading_broker_codes": LIVE_TRADING_BROKER_CODES,
            "investment_import_broker_codes": INVESTMENT_IMPORT_BROKER_CODES,
            "investment_csrf_token": get_or_create_investment_csrf_token(),
        }

    register_routes(app)
    return app
