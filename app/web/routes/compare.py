"""
Compare route registration.

Code version: v0.3.0
"""

from flask import Flask

from app.web.runtime import WebRuntime


def register_compare_routes(app: Flask, runtime: WebRuntime) -> None:
    app.get("/")(runtime.root)
    app.get("/compare")(runtime.compare_page)
    app.get("/api/symbol-search")(runtime.symbol_search)
    app.get("/api/date-constraints")(runtime.date_constraints_api)
    app.get("/api/market-store/presence")(runtime.market_store_presence_api)
