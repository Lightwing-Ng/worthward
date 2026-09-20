"""
Application factory for the stock comparison web app.

Code version: v0.13.0
- Changed: Keep the package facade dependency-light until create_app() is called.
- Added: Publish the canonical market-session projection to every template.
- Added: Publish one Backtest transaction-column structure to every template.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from app.core.upload_limits import (
    INVESTMENT_IMPORT_MULTIPART_ALLOWANCE_BYTES as INVESTMENT_IMPORT_MULTIPART_ALLOWANCE_BYTES,
    MAX_INVESTMENT_IMPORT_REQUEST_BYTES,
)

if TYPE_CHECKING:
    from flask import Flask

__all__ = (
    "INVESTMENT_IMPORT_MULTIPART_ALLOWANCE_BYTES",
    "MAX_INVESTMENT_IMPORT_REQUEST_BYTES",
    "create_app",
)


# This global Flask request cap permits one artifact-sized multipart request
# plus a small envelope allowance. The separate 256 MiB immutable-evidence
# directory capacity remains enforced by storage and is not an HTTP body limit.


def create_app() -> Flask:
    import secrets

    from flask import Flask, Response, request

    from app.core.broker_catalog import (
        INVESTMENT_IMPORT_BROKER_CODES,
        LIVE_TRADING_BROKER_CODES,
        SETTINGS_BROKER_CODES,
        sorted_broker_entries,
    )
    from app.core.market_sessions import browser_market_session_config
    from app.web.backtest_table_columns import backtest_transaction_columns
    from app.web.request_security import get_or_create_investment_csrf_token, protect_settings_writes
    from app.web.routes_entry import register_routes

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
        # Native form POSTs otherwise carry Origin: null in Chromium. Keep
        # Settings origin proof while still withholding external referrers.
        response.headers.setdefault(
            "Referrer-Policy",
            "same-origin" if request.path.startswith("/settings") else "no-referrer",
        )
        return response

    # The browser market-session projection is immutable for the process, so
    # it is serialized once rather than rebuilt for every rendered template.
    market_session_config = browser_market_session_config()
    # One maintained Backtest transaction-column structure for the server
    # table and the optimistic hydration skeleton.
    backtest_table_columns = {
        "single": backtest_transaction_columns(),
        "multiAsset": backtest_transaction_columns(multi_asset=True),
    }

    @app.context_processor
    def inject_broker_catalog() -> dict[str, object]:
        return {
            "sorted_broker_entries": sorted_broker_entries,
            "settings_broker_codes": SETTINGS_BROKER_CODES,
            "live_trading_broker_codes": LIVE_TRADING_BROKER_CODES,
            "investment_import_broker_codes": INVESTMENT_IMPORT_BROKER_CODES,
            "investment_csrf_token": get_or_create_investment_csrf_token(),
            "market_session_config": market_session_config,
            "backtest_table_columns": backtest_table_columns,
        }

    register_routes(app)
    app.before_request(protect_settings_writes)
    return app
