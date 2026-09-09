"""Immutable architecture identities and bounded research domains. Code version: v1.1.0."""

from dataclasses import dataclass
from types import MappingProxyType


@dataclass(frozen=True)
class NeuralStartupProfile:
    training_window: int
    chip_window: int
    lookback: int
    hidden_size: int
    epochs: int
    learning_rate: float
    retrain_interval: int
    weight_decay: float
    dropout: float
    enabled_factor_parameters: frozenset[str]


@dataclass(frozen=True)
class NeuralArchitectureSpec:
    architecture: str
    strategy_id: str
    name: str
    startup_profile: NeuralStartupProfile
    hidden_maximum: int = 64
    search_hidden: tuple[int, ...] = (16, 32, 48)

    @property
    def hidden_default(self) -> int:
        return self.startup_profile.hidden_size


def _startup_profile(
        *, chip_window: int, lookback: int, hidden_size: int, epochs: int,
        learning_rate: float, retrain_interval: int, weight_decay: float,
        dropout: float, enabled_factors: tuple[str, ...],
) -> NeuralStartupProfile:
    return NeuralStartupProfile(
        training_window=252,
        chip_window=chip_window,
        lookback=lookback,
        hidden_size=hidden_size,
        epochs=epochs,
        learning_rate=learning_rate,
        retrain_interval=retrain_interval,
        weight_decay=weight_decay,
        dropout=dropout,
        enabled_factor_parameters=frozenset(f"use_{key}" for key in enabled_factors),
    )


NEURAL_SPECS = (
    NeuralArchitectureSpec(
        "patchtst", "patchtst-price-field", "PatchTST",
        _startup_profile(
            chip_window=84, lookback=32, hidden_size=32, epochs=8,
            learning_rate=0.0003, retrain_interval=20, weight_decay=0.001,
            dropout=0.0,
            enabled_factors=("illiquidity_20d", "close_location", "amplitude"),
        ),
    ),
    NeuralArchitectureSpec(
        "tsmixer", "tsmixer-price-field", "TSMixer",
        _startup_profile(
            chip_window=63, lookback=16, hidden_size=16, epochs=8,
            learning_rate=0.0003, retrain_interval=10, weight_decay=0.001,
            dropout=0.1,
            enabled_factors=(
                "illiquidity_20d", "momentum_20d", "relative_volume_20d",
                "momentum_5d", "close_location", "amplitude",
                "intraday_return", "overnight_gap", "volume_change",
            ),
        ),
    ),
    NeuralArchitectureSpec(
        "nhits", "nhits-price-field", "N-HiTS",
        _startup_profile(
            chip_window=21, lookback=32, hidden_size=16, epochs=4,
            learning_rate=0.0003, retrain_interval=20, weight_decay=0.001,
            dropout=0.0,
            enabled_factors=(
                "momentum_20d", "relative_volume_20d", "momentum_5d",
                "momentum_60d", "amplitude", "turnover",
            ),
        ),
    ),
    NeuralArchitectureSpec(
        "timexer", "timexer-price-field", "TimeXer",
        _startup_profile(
            chip_window=21, lookback=32, hidden_size=16, epochs=4,
            learning_rate=0.0003, retrain_interval=10, weight_decay=0.001,
            dropout=0.1,
            enabled_factors=("illiquidity_20d", "momentum_5d", "turnover", "volume"),
        ),
    ),
    NeuralArchitectureSpec(
        "itransformer", "itransformer-price-field", "iTransformer",
        _startup_profile(
            chip_window=63, lookback=32, hidden_size=16, epochs=8,
            learning_rate=0.0003, retrain_interval=10, weight_decay=0.001,
            dropout=0.1,
            enabled_factors=(
                "momentum_20d", "volatility_20d", "amplitude",
                "intraday_return", "overnight_gap", "volume_change",
            ),
        ),
        hidden_maximum=32,
        search_hidden=(16, 32),
    ),
    NeuralArchitectureSpec(
        "tide", "tide-price-field", "TiDE",
        _startup_profile(
            chip_window=21, lookback=16, hidden_size=16, epochs=4,
            learning_rate=0.001, retrain_interval=10, weight_decay=0.01,
            dropout=0.0,
            enabled_factors=(
                "illiquidity_20d", "relative_volume_20d", "volatility_20d",
                "close_location", "amplitude", "intraday_return",
                "overnight_gap", "turnover",
            ),
        ),
        hidden_maximum=32,
        search_hidden=(16, 32),
    ),
    NeuralArchitectureSpec(
        "moderntcn", "moderntcn-price-field", "ModernTCN",
        _startup_profile(
            chip_window=42, lookback=16, hidden_size=8, epochs=4,
            learning_rate=0.0006, retrain_interval=10, weight_decay=0.01,
            dropout=0.0, enabled_factors=("turnover",),
        ),
        hidden_maximum=32,
        search_hidden=(8, 16),
    ),
    NeuralArchitectureSpec(
        "tft", "tft-price-field", "TFT",
        _startup_profile(
            chip_window=42, lookback=16, hidden_size=8, epochs=4,
            learning_rate=0.001, retrain_interval=10, weight_decay=0.001,
            dropout=0.0,
            enabled_factors=(
                "momentum_20d", "volatility_20d", "intraday_return", "overnight_gap",
            ),
        ),
        hidden_maximum=32,
        search_hidden=(8, 16),
    ),
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
