"""Shared pytest fixtures for Flask integration tests. Code version: v1.2.0."""

from __future__ import annotations

import os
from tempfile import TemporaryDirectory

import pytest
from flask import Flask
from flask.testing import FlaskClient

# Configure the settings store before importing the application so every module-level
# derived path remains isolated for the complete pytest process.
_PYTEST_SETTINGS_STORE = TemporaryDirectory(prefix="worthward-pytest-settings-")
os.environ["WORTHWARD_SETTINGS_STORE_DIR"] = _PYTEST_SETTINGS_STORE.name
_PYTEST_MARKET_STORE = TemporaryDirectory(prefix="worthward-pytest-market-")
_PYTEST_COMPUTE_STORE = TemporaryDirectory(prefix="worthward-pytest-compute-")
os.environ["WORTHWARD_MARKET_STORE_DIR"] = _PYTEST_MARKET_STORE.name
os.environ["WORTHWARD_COMPUTE_ROOT"] = _PYTEST_COMPUTE_STORE.name
os.environ["WORTHWARD_REMOTE_MARKET_ACCESS"] = "disabled"
os.environ["WORTHWARD_LONGBRIDGE_CLI_ACCESS"] = "disabled"


def pytest_sessionfinish() -> None:
    """Remove the process-wide isolated settings store after pytest finishes."""
    _PYTEST_SETTINGS_STORE.cleanup()
    _PYTEST_MARKET_STORE.cleanup()
    _PYTEST_COMPUTE_STORE.cleanup()


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
