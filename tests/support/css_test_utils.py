"""Read split CSS ownership bundles for static contract tests.

Code version: v1.0.1
"""

from __future__ import annotations

from pathlib import Path


CSS_BUNDLE_SUFFIXES = {
    "investment.css": ("investment-tables.css",),
    "settings.css": ("settings-sections.css",),
}


def read_css_bundle(path: Path, *, encoding: str = "utf-8") -> str:
    """Return one stylesheet followed by its ordered ownership continuations."""
    sources = [path.read_text(encoding=encoding)]
    sources.extend(
        path.with_name(sibling_name).read_text(encoding=encoding)
        for sibling_name in CSS_BUNDLE_SUFFIXES.get(path.name, ())
    )
    return "\n".join(sources)
