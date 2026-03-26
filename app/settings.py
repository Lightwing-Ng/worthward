"""
Application settings loader.

Code version: v2.2.0
"""

from __future__ import annotations

import tomllib
from pathlib import Path
from typing import Any

from .config import BASE_DIR

CONFIG_PATH = BASE_DIR / "config.toml"


def get_settings() -> dict[str, Any]:
    with CONFIG_PATH.open("rb") as config_file:
        return tomllib.load(config_file)
