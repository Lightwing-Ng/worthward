"""
More route registration.

Code version: v0.3.0
"""

from flask import Flask

from app.web.runtime import WebRuntime


def register_more_routes(app: Flask, runtime: WebRuntime) -> None:
    app.get("/more")(runtime.more_root)
    app.get("/more/<section_name>")(runtime.more_page)
    app.get("/invest")(runtime.investment_page)
    app.get("/investment")(runtime.investment_page)
    app.get("/api/investment/transactions")(runtime.investment_get_transactions)
    app.post("/api/investment/transactions")(runtime.investment_add_transaction)
    app.get("/api/investment/latest-price")(runtime.investment_get_latest_price)
    app.get("/api/investment/parquet")(runtime.investment_get_parquet)
