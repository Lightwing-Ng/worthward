"""TSMixer probability strategy adapter. Code version: v1.0.1."""

from strategies.price_field.neural.strategy import NeuralPriceFieldStrategy


class TSMixerPriceFieldStrategy(NeuralPriceFieldStrategy):
    architecture = "tsmixer"
    strategy_id = "tsmixer-price-field"
    strategy_name = "TSMixer Price Field"
    strategy_description = "Residual temporal and feature mixing with direct causal 1–20-session probability forecasts."
    strategy_display_order = 45
    strategy_parameter_title = "TSMixer parameters"
