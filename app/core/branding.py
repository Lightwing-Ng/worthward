"""Application branding and legacy environment compatibility.

Code version: v0.1.0
"""

from __future__ import annotations

import os
from collections.abc import Mapping

APP_NAME = "Worthward"
APP_SLUG = "worthward"
LEGACY_APP_NAME = "Antigravity"
LEGACY_APP_SLUG = "antigravity"


def read_compatible_environment(
        primary_name: str,
        legacy_name: str,
        *,
        environ: Mapping[str, str] | None = None,
) -> str:
    """Read the Worthward variable first, then the legacy Antigravity alias."""
    environment = os.environ if environ is None else environ
    primary_value = str(environment.get(primary_name, "") or "").strip()
    if primary_value:
        return primary_value
    return str(environment.get(legacy_name, "") or "").strip()
