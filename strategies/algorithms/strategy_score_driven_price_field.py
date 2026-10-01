"""Score-Driven probability adapter. Code version: v1.0.0."""

from strategies.price_field.econometric.strategy import ScoreDrivenEconometricStrategy


class ScoreDrivenPriceFieldStrategy(ScoreDrivenEconometricStrategy):
    strategy_id = "score-driven-price-field"
    strategy_name = "Score-Driven Price Field"
    strategy_description = (
        "Range-augmented Beta-t-EGARCH score-driven volatility forecasts around a Bayesian Sharpe-ratio drift."
    )
    strategy_display_order = 56
    strategy_parameter_title = "Score-Driven parameters"
