"""SuperTrend catalog variant sharing the causal vectorized implementation.

Code version: v0.5.0
"""

from __future__ import annotations

from .strategy_supertrend_ai import SupertrendAiStrategy as _SupertrendAiStrategy


class SupertrendAiStrategy(_SupertrendAiStrategy):
    strategy_id = "supertrend_ai_gemini"
    strategy_name = "SuperTrend AI (Gemini)"
    strategy_description = "Adaptive multi-factor SuperTrend strategy using causal performance clustering and vectorized factor states."
    strategy_display_order = 31
