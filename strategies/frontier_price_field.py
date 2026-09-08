"""Small-sample parameter policy for additional architectures. Code version: v1.0.0."""

from dataclasses import replace

from strategies.neural_price_field import NeuralPriceFieldStrategy
from strategies.neural_price_field_registry import neural_architecture_spec


class FrontierPriceFieldStrategy(NeuralPriceFieldStrategy):
    """Reuse the complete training/data/presentation contract with bounded width."""

    def get_parameter_definitions(self):
        spec = neural_architecture_spec(self.architecture)
        return tuple(
            replace(parameter, default=spec.hidden_default, maximum=spec.hidden_maximum)
            if parameter.key == "hidden_size" else parameter
            for parameter in super().get_parameter_definitions()
        )
