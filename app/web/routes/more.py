"""
More route registration.

Code version: v0.3.0
"""

from flask import Flask

from app.web.runtime import WebRuntime


def register_more_routes(app: Flask, runtime: WebRuntime) -> None:
    app.get("/more")(runtime.more_root)
    app.get("/more/<section_name>")(runtime.more_page)
    app.get("/test/chart/1m/<ticker>/<date_str>")(runtime.test_chart_1m_view)
