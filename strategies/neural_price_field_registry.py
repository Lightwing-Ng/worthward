"""Immutable architecture identities and bounded research domains. Code version: v1.0.0."""

from dataclasses import dataclass
from types import MappingProxyType


@dataclass(frozen=True)
class NeuralArchitectureSpec:
    architecture: str
    strategy_id: str
    name: str
    hidden_default: int = 32
    hidden_maximum: int = 64
    search_hidden: tuple[int, ...] = (16, 32, 48)


NEURAL_SPECS = (
    NeuralArchitectureSpec("patchtst", "patchtst-price-field", "PatchTST"),
    NeuralArchitectureSpec("tsmixer", "tsmixer-price-field", "TSMixer"),
    NeuralArchitectureSpec("nhits", "nhits-price-field", "N-HiTS"),
    NeuralArchitectureSpec("timexer", "timexer-price-field", "TimeXer"),
    NeuralArchitectureSpec("itransformer", "itransformer-price-field", "iTransformer", 16, 32, (16, 32)),
    NeuralArchitectureSpec("tide", "tide-price-field", "TiDE", 16, 32, (16, 32)),
    NeuralArchitectureSpec("moderntcn", "moderntcn-price-field", "ModernTCN", 8, 32, (8, 16)),
    NeuralArchitectureSpec("tft", "tft-price-field", "TFT", 16, 32, (8, 16)),
)
NEURAL_ARCHITECTURES = tuple(spec.architecture for spec in NEURAL_SPECS)
LEGACY_NEURAL_STRATEGY_IDS = tuple(spec.strategy_id for spec in NEURAL_SPECS[:4])
FRONTIER_NEURAL_STRATEGY_IDS = tuple(spec.strategy_id for spec in NEURAL_SPECS[4:])
_BY_ARCHITECTURE = MappingProxyType({spec.architecture: spec for spec in NEURAL_SPECS})
_BY_STRATEGY = MappingProxyType({spec.strategy_id: spec for spec in NEURAL_SPECS})


def neural_architecture_spec(architecture: str) -> NeuralArchitectureSpec:
    try:
        return _BY_ARCHITECTURE[architecture]
    except KeyError:
        raise ValueError(f"Unknown neural architecture: {architecture}") from None


def research_choices(strategy_id: str, common: dict) -> dict:
    """Return independent domains without changing original-model search policy."""
    try:
        spec = _BY_STRATEGY[strategy_id]
    except KeyError:
        raise ValueError(f"Unknown neural strategy: {strategy_id}") from None
    choices = dict(common)
    if strategy_id in FRONTIER_NEURAL_STRATEGY_IDS:
        choices.update(hidden_size=spec.search_hidden, lookback=(16, 24, 32), epochs=(4, 8, 12))
    return choices
