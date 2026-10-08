"""Keep offline research output away from the production stores. Code version: v1.0.0.

The research CLIs write only to a new output directory. A directory inside the
configured market or settings store, or inside the repository's own stores when
the store variables are redirected, is refused. Paths are compared both
lexically and by filesystem identity, so a case-variant spelling on a
case-insensitive volume cannot reach a protected store.
"""

from __future__ import annotations

import os
from pathlib import Path

from app.core import config


def is_within(path: Path, root: Path) -> bool:
    """Whether the resolved ``path`` is ``root`` or lies below it."""
    root = root.resolve()
    if path == root or root in path.parents:
        return True
    if not root.exists():
        return False
    for candidate in (path, *path.parents):
        try:
            if candidate.exists() and os.path.samefile(candidate, root):
                return True
        except OSError:
            continue
    return False


def protected_store_roots() -> tuple[Path, ...]:
    """The configured stores and the repository's own stores, read at call time.

    Redirected store variables never unprotect the repository's own stores.
    """
    return (
        config.MARKET_STORE_DIR,
        config.SETTINGS_STORE_DIR,
        config.BASE_DIR / "market_store",
        config.BASE_DIR / "settings_store",
    )


def is_protected_output(path: Path) -> bool:
    """Whether an output directory would lie inside a market or settings store."""
    resolved = Path(path).expanduser().resolve()
    return any(is_within(resolved, root) for root in protected_store_roots())
