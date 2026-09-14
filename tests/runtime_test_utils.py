"""Helpers for static contracts spanning the split web runtime.

Code version: v0.1.0
"""

from __future__ import annotations

from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_RUNTIME_ROOT = PROJECT_ROOT / "app" / "web"


def read_runtime_bundle() -> str:
    """Read the facade and every bounded runtime domain in stable order."""
    return "\n".join(
        path.read_text(encoding="utf-8")
        for path in sorted(WEB_RUNTIME_ROOT.glob("runtime*.py"))
    )
