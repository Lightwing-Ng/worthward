"""
Portfolio route registration.

Code version: v1.0.0
"""

from flask import Flask

from ..web_runtime import WebRuntime


def register_portfolio_routes(app: Flask, runtime: WebRuntime) -> None:
    app.get("/portfolio")(runtime.portfolio_page)
