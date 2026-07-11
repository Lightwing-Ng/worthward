"""Shared pytest fixtures for Flask integration tests. Code version: v1.0.0."""

from __future__ import annotations

import pytest
from flask import Flask
from flask.testing import FlaskClient

from app import create_app


@pytest.fixture
def app() -> Flask:
    """Create an isolated Flask application instance."""
    application = create_app()
    application.config.update(TESTING=True)
    return application


@pytest.fixture
def client(app: Flask) -> FlaskClient:
    """Return the shared Flask test client."""
    return app.test_client()
