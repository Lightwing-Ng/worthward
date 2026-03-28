"""
Application factory for the stock comparison web app.

Code version: v2.4.1
"""

from flask import Flask

from app.web.routes_entry import register_routes


def create_app() -> Flask:
    app = Flask(
        __name__,
        template_folder="web/templates",
        static_folder="web/static",
    )
    register_routes(app)
    return app
