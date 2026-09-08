"""MACD catalog variant sharing the validated crossover implementation.

Code version: v0.5.0
"""

from __future__ import annotations

from .strategy_macd import MacdStrategy as _MacdStrategy


class MacdStrategy(_MacdStrategy):
    strategy_id = "macd-gemini"
    strategy_name = "MACD (Gemini)"
    strategy_display_order = 21
