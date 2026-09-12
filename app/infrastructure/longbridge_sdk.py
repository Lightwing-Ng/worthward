"""Shared Longbridge SDK construction helpers.

Code version: v1.0.0
"""

from __future__ import annotations

from typing import Any

from app.core.broker_settings import BrokerSettings, normalize_longbridge_access_token


def build_longbridge_sdk_config(config_cls: Any, settings: BrokerSettings) -> Any:
    """Build an SDK config across supported Longbridge package versions."""
    app_key = settings.longbridge_app_key.strip()
    app_secret = settings.longbridge_app_secret.strip()
    access_token = normalize_longbridge_access_token(settings.longbridge_access_token)
    factory = getattr(config_cls, "from_apikey", None)
    if callable(factory):
        return factory(app_key, app_secret, access_token)
    return config_cls(app_key, app_secret, access_token)
