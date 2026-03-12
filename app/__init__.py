"""
Application factory for the stock comparison web app.

Code version: v2.4.0
"""

from flask import Flask

from .web import register_routes


def create_app() -> Flask:
    app = Flask(
        __name__,
        template_folder="web/static/templates",
        static_folder="web/static",
    )
    register_routes(app)
    return app
