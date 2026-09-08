"""TimeXer probability strategy adapter. Code version: v1.0.0."""

from strategies.neural_price_field import NeuralPriceFieldStrategy


class TimeXerPriceFieldStrategy(NeuralPriceFieldStrategy):
    architecture = "timexer"
    strategy_id = "timexer-price-field"
    strategy_name = "TimeXer Price Field"
    strategy_description = "Endogenous patch and exogenous variable attention with direct causal 1–20-session probability forecasts."
    strategy_display_order = 47
    strategy_parameter_title = "TimeXer parameters"
