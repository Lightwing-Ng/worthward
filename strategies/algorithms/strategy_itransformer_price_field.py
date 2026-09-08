"""iTransformer probability adapter. Code version: v1.0.0."""

from strategies.frontier_price_field import FrontierPriceFieldStrategy


class ITransformerPriceFieldStrategy(FrontierPriceFieldStrategy):
    architecture = "itransformer"
    strategy_id = "itransformer-price-field"
    strategy_name = "iTransformer Price Field"
    strategy_description = "Inverted variate attention with direct causal 1–20-session Gaussian forecasts."
    strategy_display_order = 48
    strategy_parameter_title = "iTransformer parameters"
