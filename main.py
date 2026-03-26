"""
Project entrypoint.

Code version: v2.0.0
"""

from app import create_app
from app.settings import get_settings

app = create_app()
settings = get_settings()

if __name__ == "__main__":
    app.run(
        debug=settings["app"].get("debug", True),
        host=settings["server"].get("host", "127.0.0.1"),
        port=settings["server"].get("port", 8688),
    )
