"""Runtime compatibility helpers.

Code version: v0.1.0
"""

from __future__ import annotations

from collections.abc import Sequence

SUPPORTED_PYTHON_VERSIONS = ((3, 13), (3, 14))


def require_supported_python(version_info: Sequence[int]) -> None:
    """Raise a clear error when the interpreter is outside the supported range."""
    if tuple(version_info[:2]) in SUPPORTED_PYTHON_VERSIONS:
        return

    detected_version = ".".join(str(part) for part in version_info[:3])
    supported_versions = " or ".join(
        f"{major}.{minor}" for major, minor in SUPPORTED_PYTHON_VERSIONS
    )
    raise RuntimeError(
        f"Antigravity requires Python {supported_versions}. "
        f"Detected Python {detected_version}."
    )
