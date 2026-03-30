"""
Portfolio route registration.

Code version: v0.3.0
"""

from flask import Flask

from app.web.runtime import WebRuntime


def register_portfolio_routes(app: Flask, runtime: WebRuntime) -> None:
    app.get("/portfolio")(runtime.portfolio_page)
