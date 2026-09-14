"""Read split Jinja ownership bundles for static contract tests.

Code version: v1.0.0
"""

from __future__ import annotations

from pathlib import Path


SETTINGS_PARTIAL_ORDER = (
    "_about.html",
    "_general.html",
    "_investment.html",
    "_backtest.html",
    "_font_tokens.html",
    "_network.html",
    "_strategies.html",
    "_email_smtp.html",
    "_local_market_store.html",
    "_broker_access.html",
    "_clear_caches.html",
    "_material_tokens.html",
    "_cash_equivalents.html",
    "_color_tokens.html",
    "_style_tokens.html",
    "_export_image.html",
)


def read_template_bundle(path: Path, *, encoding: str = "utf-8") -> str:
    """Return a template followed by its ordered static-analysis partials."""
    sources = [path.read_text(encoding=encoding)]
    if path.name == "settings.html":
        partial_root = path.with_suffix("")
        sources.extend(
            (partial_root / partial_name).read_text(encoding=encoding)
            for partial_name in SETTINGS_PARTIAL_ORDER
        )
    return "\n".join(sources)
