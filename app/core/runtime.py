"""Runtime compatibility helpers.

Code version: v0.2.0
"""

from __future__ import annotations

from collections.abc import Sequence

MINIMUM_PYTHON_VERSION = (3, 13)


def require_supported_python(version_info: Sequence[int]) -> None:
    """Raise a clear error when the interpreter is outside the supported range."""
    if tuple(version_info[:2]) >= MINIMUM_PYTHON_VERSION:
        return

    detected_version = ".".join(str(part) for part in version_info[:3])
    minimum_version = ".".join(str(part) for part in MINIMUM_PYTHON_VERSION)
    raise RuntimeError(
        f"Worthward requires Python {minimum_version} or newer. "
        f"Detected Python {detected_version}."
    )
