"""TiDE probability adapter. Code version: v1.0.1."""

from strategies.price_field.neural.frontier import FrontierPriceFieldStrategy


class TiDEPriceFieldStrategy(FrontierPriceFieldStrategy):
    architecture = "tide"
    strategy_id = "tide-price-field"
    strategy_name = "TiDE Price Field"
    strategy_description = "Residual dense encoding and horizon decoding with causal observed covariates."
    strategy_display_order = 49
    strategy_parameter_title = "TiDE parameters"
