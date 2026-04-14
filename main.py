"""
Project entrypoint.

Code version: v0.4.1
"""

import os

from app.core.broker_settings import has_longbridge_credentials, load_broker_settings
from app.core.settings import get_settings
from app.infrastructure.broker_market_data import prewarm_longbridge_quote_context
from app.infrastructure.runtime_network import bootstrap_runtime_network_for_yfinance

LOG_PREFIX = "[antigravity]"
DEFAULT_DEBUG = True
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8688


def _log_startup(message: str) -> None:
    print(f"{LOG_PREFIX} {message}")


def _should_manage_longbridge_as_long_lived() -> bool:
    try:
        broker_settings = load_broker_settings()
    except Exception:
        return False
    return (
        broker_settings.selected_broker == "longbridge"
        and has_longbridge_credentials(broker_settings)
    )


def _is_werkzeug_serving_process(debug_enabled: bool) -> bool:
    if not debug_enabled:
        return True
    return os.environ.get("WERKZEUG_RUN_MAIN") == "true"


def _prewarm_broker_context(debug_enabled: bool) -> None:
    if not _is_werkzeug_serving_process(debug_enabled):
        _log_startup("Skipped Longbridge prewarm in the Werkzeug reloader supervisor process.")
        return
    try:
        _prewarmed, prewarm_message = prewarm_longbridge_quote_context()
        _log_startup(prewarm_message)
    except Exception as exc:
        _log_startup(f"Longbridge prewarm failed: {exc}")


def _build_run_options(config: dict) -> dict:
    debug_enabled = config["app"].get("debug", DEFAULT_DEBUG)
    use_reloader = debug_enabled
    if use_reloader and _should_manage_longbridge_as_long_lived():
        _log_startup("Disabled Flask reloader to keep the Longbridge quote context long-lived.")
        use_reloader = False
    return {
        "debug": debug_enabled,
        "host": config["server"].get("host", DEFAULT_HOST),
        "port": config["server"].get("port", DEFAULT_PORT),
        "use_reloader": use_reloader,
    }


def _initialize_runtime():
    settings = get_settings()
    debug_enabled = settings["app"].get("debug", DEFAULT_DEBUG)
    bootstrap_runtime_network_for_yfinance()
    _prewarm_broker_context(debug_enabled)
    from app import create_app
    return create_app(), settings


app, settings = _initialize_runtime()

if __name__ == "__main__":
    app.run(**_build_run_options(settings))
