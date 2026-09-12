"""Tests for the shared Longbridge SDK config adapter.

Code version: v1.0.0
"""

from __future__ import annotations

from app.core.broker_settings import BrokerSettings
from app.infrastructure.longbridge_sdk import build_longbridge_sdk_config


def _raw_settings() -> BrokerSettings:
    settings = BrokerSettings()
    settings.longbridge_app_key = "  app-key  "
    settings.longbridge_app_secret = "  app-secret  "
    settings.longbridge_access_token = "  'Bearer \"access-token\"'  "
    return settings


def test_build_longbridge_sdk_config_uses_supported_factory() -> None:
    expected = object()

    class FactoryConfig:
        received: tuple[str, str, str] | None = None

        @classmethod
        def from_apikey(
                cls,
                app_key: str,
                app_secret: str,
                access_token: str,
        ) -> object:
            cls.received = (app_key, app_secret, access_token)
            return expected

    config = build_longbridge_sdk_config(FactoryConfig, _raw_settings())

    assert config is expected
    assert FactoryConfig.received == ("app-key", "app-secret", "access-token")


def test_build_longbridge_sdk_config_falls_back_to_constructor() -> None:
    class ConstructorConfig:
        def __init__(
                self,
                app_key: str,
                app_secret: str,
                access_token: str,
        ) -> None:
            self.received = (app_key, app_secret, access_token)

    config = build_longbridge_sdk_config(ConstructorConfig, _raw_settings())

    assert config.received == ("app-key", "app-secret", "access-token")
