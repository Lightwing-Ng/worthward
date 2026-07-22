"""Shared pytest fixtures for Flask integration tests. Code version: v1.1.1."""

from __future__ import annotations

import os
from tempfile import TemporaryDirectory

import pytest
from flask import Flask
from flask.testing import FlaskClient

# Configure the settings store before importing the application so every module-level
# derived path remains isolated for the complete pytest process.
_PYTEST_SETTINGS_STORE = TemporaryDirectory(prefix="antigravity-pytest-settings-")
os.environ["ANTIGRAVITY_SETTINGS_STORE_DIR"] = _PYTEST_SETTINGS_STORE.name


def pytest_sessionfinish() -> None:
    """Remove the process-wide isolated settings store after pytest finishes."""
    _PYTEST_SETTINGS_STORE.cleanup()


@pytest.fixture
def app() -> Flask:
    """Create an isolated Flask application instance."""
    from app import create_app

    application = create_app()
    application.config.update(TESTING=True)
    return application


@pytest.fixture
def client(app: Flask) -> FlaskClient:
    """Return the shared Flask test client."""
    return app.test_client()
