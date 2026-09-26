"""ModernTCN probability adapter. Code version: v1.0.1."""

from strategies.price_field.neural.frontier import FrontierPriceFieldStrategy


class ModernTCNPriceFieldStrategy(FrontierPriceFieldStrategy):
    architecture = "moderntcn"
    strategy_id = "moderntcn-price-field"
    strategy_name = "ModernTCN Price Field"
    strategy_description = "Large-kernel temporal convolution with separate channel and variate mixing."
    strategy_display_order = 53
    strategy_parameter_title = "ModernTCN parameters"
