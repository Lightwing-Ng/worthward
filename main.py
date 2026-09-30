"""
Project entrypoint.

Code version: v0.7.0
- Changed: Enable configured development reloads without an interactive browser
  debugger, and prewarm only the serving process while preserving WSGI startup.
"""

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

from app.core.settings import CONFIG_PATH, get_settings  # noqa: E402
from app.infrastructure.broker_market_data import prewarm_longbridge_quote_context  # noqa: E402
from app.infrastructure.runtime_network import bootstrap_runtime_network_for_yfinance  # noqa: E402

DEFAULT_DEBUG = False
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8688
LOGGER = logging.getLogger("app.bootstrap")


def _log_startup(message: str) -> None:
    LOGGER.info(message)


def _is_werkzeug_serving_process(use_reloader: bool) -> bool:
    if not use_reloader:
        return True
    return os.environ.get("WERKZEUG_RUN_MAIN") == "true"


def _prewarm_broker_context(use_reloader: bool) -> None:
    if not _is_werkzeug_serving_process(use_reloader):
        _log_startup("Skipped Longbridge prewarm in the Werkzeug reloader supervisor process.")
        return
    try:
        _primed, prewarm_message = prewarm_longbridge_quote_context()
        _log_startup(prewarm_message)
    except Exception as exc:
        _log_startup(f"Longbridge prewarm failed: {exc}")


def _build_run_options(config: dict) -> dict:
    debug_enabled = config["app"].get("debug", DEFAULT_DEBUG)
    debug_override = read_compatible_environment("WORTHWARD_DEBUG", "ANTIGRAVITY_DEBUG")
    if debug_override:
        value = debug_override.strip().lower()
        if value not in {"1", "true", "yes", "on", "0", "false", "no", "off"}:
            raise ValueError("WORTHWARD_DEBUG must be 1/true/yes/on or 0/false/no/off.")
        debug_enabled = value in {"1", "true", "yes", "on"}
    # Note: IBKR remains an offline historical-import source; no local broker process is managed.
    return {
        "debug": debug_enabled,
        "host": read_compatible_environment("WORTHWARD_HOST", "ANTIGRAVITY_HOST") or config["server"].get("host", DEFAULT_HOST),
        "port": int(read_compatible_environment("WORTHWARD_PORT", "ANTIGRAVITY_PORT") or config["server"].get("port", DEFAULT_PORT)),
        "use_reloader": debug_enabled,
        # Keep automatic reloads without exposing an executable browser console.
        "use_debugger": False,
        "extra_files": [str(CONFIG_PATH)] if debug_enabled else [],
    }


def _initialize_runtime():
    configure_logging()
    runtime_settings = get_settings()
    use_reloader = (
        __name__ == "__main__"
        and _build_run_options(runtime_settings)["use_reloader"]
    )
    network_settings = runtime_settings.get("network", {})
    bootstrap_runtime_network_for_yfinance(network_settings.get("yahoo_ca_pem"))
    _prewarm_broker_context(use_reloader)
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
