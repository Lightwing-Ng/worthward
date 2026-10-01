"""Rough Volatility probability adapter. Code version: v1.0.0."""

from strategies.price_field.econometric.strategy import RoughVolatilityEconometricStrategy


class RoughVolatilityPriceFieldStrategy(RoughVolatilityEconometricStrategy):
    strategy_id = "rough-volatility-price-field"
    strategy_name = "Rough Volatility Price Field"
    strategy_description = (
        "Noise-aware rough-volatility kriging of daily log variance around a Bayesian Sharpe-ratio drift."
    )
    strategy_display_order = 57
    strategy_parameter_title = "Rough Volatility parameters"
