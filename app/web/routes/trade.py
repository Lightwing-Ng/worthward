"""
Trade route registration.

Code version: v0.9.0
- Added: Schwab security-transfer source-account confirmation route.
"""

from flask import Flask

from app.web.runtime import WebRuntime


def register_trade_routes(app: Flask, runtime: WebRuntime) -> None:
    app.get("/trade")(runtime.trade_root)
    app.get("/trade/<section_name>")(runtime.trade_page)
    app.post("/trade/live-trading/unlock")(runtime.live_trading_unlock)
    app.get("/more")(runtime.legacy_trade_root)
    app.get("/more/<section_name>")(runtime.legacy_trade_page)
    app.get("/invest")(runtime.investment_page)
    app.get("/investment")(runtime.investment_page)
    app.get("/api/investment/transactions")(runtime.investment_get_transactions)
    app.post("/api/investment/transactions")(runtime.investment_add_transaction)
    app.get("/api/investment/imports/zircon-hk/template.xlsx")(
        runtime.investment_download_zircon_hk_template
    )
    app.post("/api/investment/exports/standard.xlsx")(
        runtime.investment_export_standard_xlsx
    )
    app.post("/api/investment/imports/zircon-hk/validate")(
        runtime.investment_validate_zircon_hk_workbook
    )
    app.post("/api/investment/imports/hsbc-paste/validate")(
        runtime.investment_validate_hsbc_pasted_text
    )
    app.get("/api/investment/latest-price")(runtime.investment_get_latest_price)
    app.get("/api/investment/parquet")(runtime.investment_get_parquet)
    app.get("/api/market-session/us-equity")(runtime.investment_get_market_session)
    app.get("/api/investment/intraday")(runtime.investment_get_intraday_history)
    app.get("/api/investment/realtime-quotes")(runtime.investment_get_realtime_quotes)
    app.post("/api/investment/internal-transfer-binding")(runtime.investment_update_internal_transfer_binding)
    app.post("/api/investment/security-transfer-attribution")(
        runtime.investment_update_security_transfer_attribution
    )
    app.get("/api/live-trading/positions")(runtime.live_trading_get_positions)
    app.post("/api/live-trading/orders")(runtime.live_trading_submit_order)
