"""PatchTST probability strategy adapter. Code version: v1.0.0."""

from strategies.neural_price_field import NeuralPriceFieldStrategy


class PatchTSTPriceFieldStrategy(NeuralPriceFieldStrategy):
    architecture = "patchtst"
    strategy_id = "patchtst-price-field"
    strategy_name = "PatchTST Price Field"
    strategy_description = "Channel-independent temporal patch attention with direct causal 1–20-session probability forecasts."
    strategy_display_order = 44
    strategy_parameter_title = "PatchTST parameters"
