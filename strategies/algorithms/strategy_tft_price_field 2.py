"""Temporal Fusion Transformer probability adapter. Code version: v1.0.0."""

from strategies.frontier_price_field import FrontierPriceFieldStrategy


class TFTPriceFieldStrategy(FrontierPriceFieldStrategy):
    architecture = "tft"
    strategy_id = "tft-price-field"
    strategy_name = "TFT Price Field"
    strategy_description = "Gated variable selection, recurrent context, and temporal fusion with direct Gaussian heads."
    strategy_display_order = 54
    strategy_parameter_title = "TFT parameters"
