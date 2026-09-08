"""Gemini variant of the kNN regime classifier.

Code version: v0.5.0
- Fixed: Reuse the validated causal kNN implementation and next-open contract.
"""

from __future__ import annotations

from ..base import StrategyParameterDefinition, StrategySupportMatrix
from .strategy_knn_machine_learning import (
    KnnMachineLearningStrategy as _KnnStrategy,
    _atr as _atr,
    _cci as _cci,
    _knn_prediction_at_index as _knn_prediction_at_index,
    _knn_prediction_batch as _knn_prediction_batch,
    _minimax as _minimax,
    _roc as _roc,
    _rsi as _rsi,
    _select_feature_pair as _select_feature_pair,
    _true_range as _true_range,
)


class KnnMachineLearningStrategy(_KnnStrategy):
    strategy_id = "knn-machine-learning-gemini"
    strategy_name = "kNN Machine Learning (Gemini)"
    strategy_description = "kNN regime classifier with causal feature warmup and mature next-bar labels."
    strategy_category = "machine_learning"
    strategy_display_order = 41
    strategy_supports = StrategySupportMatrix(
        single_ticker=True,
        multi_ticker=False,
        long_only=True,
        short=False,
    )

    def get_parameter_definitions(self) -> tuple[StrategyParameterDefinition, ...]:
        return (
            StrategyParameterDefinition(
                key="indicator",
                group="factors",
                label="Indicator",
                kind="choice",
                default="All",
                options=("RSI", "ROC", "CCI", "Volume", "All"),
                help_text="Chooses which feature pair the kNN model compares. 'All' blends every supported feature into one average view.",
            ),
            StrategyParameterDefinition(
                key="short_window",
                group="factors",
                label="Short Period",
                kind="integer",
                default=14,
                minimum=1,
                unit_hint="bars",
                help_text="Sets the fast lookback window for the selected feature.",
            ),
            StrategyParameterDefinition(
                key="long_window",
                group="factors",
                label="Long Period",
                kind="integer",
                default=28,
                minimum=2,
                unit_hint="bars",
                help_text="Sets the slow lookback window for the selected feature.",
            ),
            StrategyParameterDefinition(
                key="base_k",
                label="Base Neighbours",
                kind="integer",
                default=252,
                minimum=5,
                help_text="Sets k as floor(sqrt(Base Neighbours)); all mature historical observations remain eligible.",
            ),
            StrategyParameterDefinition(
                key="volatility_filter",
                group="factors",
                label="Volatility Filter",
                kind="choice",
                default="Off",
                options=("Off", "On"),
                help_text="Turns the ATR filter on or off.",
            ),
            StrategyParameterDefinition(
                key="bar_threshold",
                label="Bar Threshold",
                kind="integer",
                default=300,
                minimum=2,
                maximum=5_000,
                unit_hint="bars",
                help_text="Sets the maximum holding length in bars before clearing the position.",
            ),
        )
