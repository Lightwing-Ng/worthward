"""
Project entrypoint.

Code version: v0.3.6
"""

from app.infrastructure.runtime_network import bootstrap_runtime_network_for_yfinance

bootstrap_runtime_network_for_yfinance()

from app import create_app
from app.infrastructure.broker_market_data import prewarm_longbridge_quote_context
from app.core.settings import get_settings

try:
    prewarmed, prewarm_message = prewarm_longbridge_quote_context()
    if prewarmed:
        print(f"[antigravity] {prewarm_message}")
    else:
        print(f"[antigravity] {prewarm_message}")
except Exception as exc:
    print(f"[antigravity] Longbridge prewarm failed: {exc}")

app = create_app()
settings = get_settings()

if __name__ == "__main__":
    app.run(
        debug=settings["app"].get("debug", True),
        host=settings["server"].get("host", "127.0.0.1"),
        port=settings["server"].get("port", 8688),
    )
