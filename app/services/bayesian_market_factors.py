"""Backward-compatible alias for the shared Price Field factor provider.

The canonical implementation lives in ``price_field_market_factors``. This
module remains import-compatible for external callers and older local tools.

Code version: v1.8.0
"""

from __future__ import annotations

import sys as _sys

from . import price_field_market_factors as _canonical

# Replace this compatibility module with the canonical module object so legacy
# imports and monkeypatches observe the same provider state and cache.
_sys.modules[__name__] = _canonical
