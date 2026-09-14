"""Read the split application JavaScript bundle for static contract tests.

Code version: v0.1.0
"""

from __future__ import annotations

from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
APP_JS_ROOT = PROJECT_ROOT / "app" / "web" / "static" / "assets" / "js"
APP_BUNDLE_PATHS = (
    APP_JS_ROOT / "app" / "chart-export.js",
    APP_JS_ROOT / "app" / "navigation.js",
    APP_JS_ROOT / "app" / "workspace-enhancements.js",
    APP_JS_ROOT / "app" / "workspace-hydration.js",
    APP_JS_ROOT / "app" / "ticker-controls.js",
    APP_JS_ROOT / "app" / "select-controls.js",
    APP_JS_ROOT / "app" / "date-controls.js",
    APP_JS_ROOT / "app" / "range-controls.js",
    APP_JS_ROOT / "app" / "strategy-controls.js",
    APP_JS_ROOT / "app.js",
)


def read_app_bundle(*, encoding: str = "utf-8") -> str:
    """Return application scripts in their explicit browser load order."""
    return "\n".join(path.read_text(encoding=encoding) for path in APP_BUNDLE_PATHS)
