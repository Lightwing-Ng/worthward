"""
Project entrypoint.

Code version: v0.4.0
"""

from app.infrastructure.runtime_network import bootstrap_runtime_network_for_yfinance
from app.infrastructure.broker_market_data import prewarm_longbridge_quote_context
from app.core.settings import get_settings

LOG_PREFIX = "[antigravity]"
DEFAULT_DEBUG = True
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8688


def _log_startup(message: str) -> None:
    print(f"{LOG_PREFIX} {message}")


def _prewarm_broker_context() -> None:
    try:
        _prewarmed, prewarm_message = prewarm_longbridge_quote_context()
        _log_startup(prewarm_message)
    except Exception as exc:
        _log_startup(f"Longbridge prewarm failed: {exc}")


def _build_run_options(config: dict) -> dict:
    return {
        "debug": config["app"].get("debug", DEFAULT_DEBUG),
        "host": config["server"].get("host", DEFAULT_HOST),
        "port": config["server"].get("port", DEFAULT_PORT),
    }


def _initialize_runtime():
    bootstrap_runtime_network_for_yfinance()
    _prewarm_broker_context()
    from app import create_app
    return create_app(), get_settings()


app, settings = _initialize_runtime()

if __name__ == "__main__":
    app.run(**_build_run_options(settings))
