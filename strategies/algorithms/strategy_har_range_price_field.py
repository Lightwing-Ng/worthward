"""HAR Range probability adapter. Code version: v1.0.0."""

from strategies.price_field.econometric.strategy import HarRangeEconometricStrategy


class HarRangePriceFieldStrategy(HarRangeEconometricStrategy):
    strategy_id = "har-range-price-field"
    strategy_name = "HAR Range Price Field"
    strategy_description = (
        "Direct 1-20 day log-HAR forecasts of range-based realized variance around a Bayesian Sharpe-ratio drift."
    )
    strategy_display_order = 55
    strategy_parameter_title = "HAR Range parameters"
