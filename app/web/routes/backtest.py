"""
Backtest route registration.

Code version: v0.5.0

The former Grid Trading URL remains a compatibility redirect; the canonical UI is
the strategy selector and inline parameter panel in Generic Backtest.
"""

from flask import Flask

from app.web.runtime import WebRuntime


def register_backtest_routes(app: Flask, runtime: WebRuntime) -> None:
    app.get("/workspaces/backtest")(runtime.backtest_page)
    app.get("/workspaces/grid-trading")(runtime.grid_trading_page)
    app.get("/backtest")(runtime.legacy_backtest_page)
    app.get("/trade-messages")(runtime.legacy_trade_messages_page)
    app.get("/api/export-transactions")(runtime.export_transactions_api)
    app.get("/api/trade-strategy-fields")(runtime.trade_strategy_fields_api)
