"""
Backtest route registration.

Code version: v1.0.0
"""

from flask import Flask

from app.web.runtime import WebRuntime


def register_backtest_routes(app: Flask, runtime: WebRuntime) -> None:
    app.get("/backtest")(runtime.backtest_page)
    app.get("/trade-messages")(runtime.legacy_trade_messages_page)
    app.get("/api/export-transactions")(runtime.export_transactions_api)
    app.get("/api/trade-strategy-fields")(runtime.trade_strategy_fields_api)
