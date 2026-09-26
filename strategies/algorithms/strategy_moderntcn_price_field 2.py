"""ModernTCN probability adapter. Code version: v1.0.0."""

from strategies.frontier_price_field import FrontierPriceFieldStrategy


class ModernTCNPriceFieldStrategy(FrontierPriceFieldStrategy):
    architecture = "moderntcn"
    strategy_id = "moderntcn-price-field"
    strategy_name = "ModernTCN Price Field"
    strategy_description = "Large-kernel temporal convolution with separate channel and variate mixing."
    strategy_display_order = 53
    strategy_parameter_title = "ModernTCN parameters"
