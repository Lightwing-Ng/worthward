"""
Application settings loader.

Code version: v2.3.0
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

try:
    import tomllib
except ModuleNotFoundError:  # pragma: no cover - Python 3.11+ uses tomllib.
    import tomli as tomllib

from .config import BASE_DIR

CONFIG_PATH = BASE_DIR / "config.toml"


def get_settings() -> dict[str, Any]:
    with CONFIG_PATH.open("rb") as config_file:
        return tomllib.load(config_file)
