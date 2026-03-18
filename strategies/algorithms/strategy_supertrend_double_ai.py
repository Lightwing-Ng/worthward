"""
SuperTrend Double AI strategy entrypoint.

Code version: v1.0.0
"""

from __future__ import annotations

from .strategy_supertrend_ai import SupertrendAiStrategy


class SupertrendDoubleAiStrategy(SupertrendAiStrategy):
    strategy_id = "supertrend-double-ai"
    strategy_name = "SuperTrend Double AI"
