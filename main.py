"""
Project entrypoint.

Code version: v0.6.0
- Changed: Spawned CPU workers skip application bootstrap when importing this
  entrypoint, preventing Flask and broker prewarm side effects in child
  processes while preserving the normal WSGI and CLI launch paths.
"""

from json import JSONDecodeError
import logging
import os
import sys

from app.core.logging_setup import configure_logging
from app.core.branding import read_compatible_environment
from app.core.runtime import require_supported_python

try:
    require_supported_python(sys.version_info)
except RuntimeError as exc:
    raise SystemExit(str(exc)) from exc

from app.core.broker_settings import (  # noqa: E402
    has_longbridge_credentials,
    load_broker_settings,
    uses_longbridge_cli_oauth,
)
from app.core.settings import get_settings  # noqa: E402
from app.infrastructure.broker_market_data import prewarm_longbridge_quote_context  # noqa: E402
from app.infrastructure.runtime_network import bootstrap_runtime_network_for_yfinance  # noqa: E402

DEFAULT_DEBUG = False
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8688
LOGGER = logging.getLogger("app.bootstrap")


def _log_startup(message: str) -> None:
    LOGGER.info(message)


def _should_manage_longbridge_as_long_lived() -> bool:
    try:
        broker_settings = load_broker_settings()
    except (OSError, JSONDecodeError):
        return False
    if uses_longbridge_cli_oauth(broker_settings):
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
        _primed, prewarm_message = prewarm_longbridge_quote_context()
        _log_startup(prewarm_message)
    except Exception as exc:
        _log_startup(f"Longbridge prewarm failed: {exc}")


def _build_run_options(config: dict) -> dict:
    debug_enabled = config["app"].get("debug", DEFAULT_DEBUG)
    use_reloader = debug_enabled
    if use_reloader and _should_manage_longbridge_as_long_lived():
        _log_startup("Disabled Flask reloader to keep the Longbridge quote context long-lived.")
        use_reloader = False
    # Note: IBKR remains an offline historical-import source; no local broker process is managed.
    return {
        "debug": debug_enabled,
        "host": read_compatible_environment("WORTHWARD_HOST", "WORTHWARD_HOST") or config["server"].get("host", DEFAULT_HOST),
        "port": int(read_compatible_environment("WORTHWARD_PORT", "WORTHWARD_PORT") or config["server"].get("port", DEFAULT_PORT)),
        "use_reloader": use_reloader,
    }


def _initialize_runtime():
    configure_logging()
    runtime_settings = get_settings()
    debug_enabled = runtime_settings["app"].get("debug", DEFAULT_DEBUG)
    network_settings = runtime_settings.get("network", {})
    bootstrap_runtime_network_for_yfinance(network_settings.get("yahoo_ca_pem"))
    _prewarm_broker_context(debug_enabled)
    from app import create_app
    return create_app(), runtime_settings


if __name__ == "__mp_main__":
    # ``spawn`` imports the parent's entrypoint in each worker. The worker only
    # needs the pickled strategy task; it must not create a Flask app or touch
    # broker/network bootstrap state.
    app = None
    settings = {}
else:
    app, settings = _initialize_runtime()

if __name__ == "__main__":
    app.run(**_build_run_options(settings))
