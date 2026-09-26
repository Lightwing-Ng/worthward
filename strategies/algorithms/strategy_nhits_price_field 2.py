"""N-HiTS probability strategy adapter. Code version: v1.0.0."""

from strategies.neural_price_field import NeuralPriceFieldStrategy


class NHiTSPriceFieldStrategy(NeuralPriceFieldStrategy):
    architecture = "nhits"
    strategy_id = "nhits-price-field"
    strategy_name = "N-HiTS Price Field"
    strategy_description = "Multiscale residual interpolation with direct causal 1–20-session probability forecasts."
    strategy_display_order = 46
    strategy_parameter_title = "N-HiTS parameters"
