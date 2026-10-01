"""CRPS Learning probability adapter. Code version: v1.0.0."""

from strategies.price_field.econometric.strategy import CrpsLearningEconometricStrategy


class CrpsLearningPriceFieldStrategy(CrpsLearningEconometricStrategy):
    strategy_id = "crps-learning-price-field"
    strategy_name = "CRPS Learning Price Field"
    strategy_description = (
        "Online CRPS learning that blends the HAR Range, Score-Driven, and Rough Volatility scales with a drift."
    )
    strategy_display_order = 58
    strategy_parameter_title = "CRPS Learning parameters"
