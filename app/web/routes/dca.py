"""
Recurring investment route registration.

Code version: v0.1.0
"""

from flask import Flask

from app.web.runtime import WebRuntime


def register_dca_routes(app: Flask, runtime: WebRuntime) -> None:
    app.get("/workspaces/dca")(runtime.dca_page)
    app.get("/dca")(runtime.legacy_dca_page)
