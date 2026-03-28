"""
Web route assembly entrypoint.

Code version: v4.0.0
"""

from flask import Flask

from app.web.routes.backtest import register_backtest_routes
from app.web.routes.compare import register_compare_routes
from app.web.routes.more import register_more_routes
from app.web.routes.portfolio import register_portfolio_routes
from app.web.routes.settings import register_settings_routes
from app.web.runtime import build_web_runtime


def register_routes(app: Flask) -> None:
    runtime = build_web_runtime()
    register_compare_routes(app, runtime)
    register_portfolio_routes(app, runtime)
    register_backtest_routes(app, runtime)
    register_more_routes(app, runtime)
    register_settings_routes(app, runtime)
