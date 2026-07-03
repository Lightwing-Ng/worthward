"""
Web route assembly entrypoint.

Code version: v0.3.1
"""

from flask import Flask

from app.web.routes.backtest import register_backtest_routes
from app.web.routes.compare import register_compare_routes
from app.web.routes.dca import register_dca_routes
from app.web.routes.trade import register_trade_routes
from app.web.routes.portfolio import register_portfolio_routes
from app.web.routes.settings import register_settings_routes
from app.web.runtime import build_web_runtime


def register_routes(app: Flask) -> None:
    runtime = build_web_runtime()
    register_compare_routes(app, runtime)
    register_portfolio_routes(app, runtime)
    register_dca_routes(app, runtime)
    register_backtest_routes(app, runtime)
    register_trade_routes(app, runtime)
    register_settings_routes(app, runtime)
