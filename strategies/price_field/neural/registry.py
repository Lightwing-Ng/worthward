"""Immutable architecture identities and bounded research domains. Code version: v1.2.0."""

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
    seed: int
    compute_backend: str
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
        dropout: float, enabled_factors: tuple[str, ...], seed: int = 42,
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
        seed=seed,
        compute_backend="CPU",
        enabled_factor_parameters=frozenset(f"use_{key}" for key in enabled_factors),
    )


# Frozen NVDA 1d validation selections, promoted on 27 Sep 2026.
NEURAL_SPECS = (
    NeuralArchitectureSpec(
        "patchtst", "patchtst-price-field", "PatchTST",
        _startup_profile(
            chip_window=84, lookback=24, hidden_size=32, epochs=8,
            learning_rate=0.0006, retrain_interval=20, weight_decay=0.0001,
            dropout=0.0, seed=42,
            enabled_factors=(
                "benchmark_qqq_return",
                "benchmark_spy_momentum20",
                "options",
                "overnight_gap",
                "relative_volume_20d",
                "volatility_20d",
            ),
        ),
    ),
    NeuralArchitectureSpec(
        "tsmixer", "tsmixer-price-field", "TSMixer",
        _startup_profile(
            chip_window=84, lookback=32, hidden_size=16, epochs=24,
            learning_rate=0.001, retrain_interval=20, weight_decay=0.0001,
            dropout=0.2, seed=42,
            enabled_factors=(
                "amplitude",
                "benchmark_qqq_momentum20",
                "benchmark_smh_momentum20",
                "benchmark_spy_momentum20",
                "benchmark_spy_return",
                "illiquidity_20d",
                "intraday_return",
                "momentum_20d",
                "momentum_5d",
                "option_call_volume",
                "option_put_call_volume_ratio",
                "options",
                "pb_ratio",
                "volatility_20d",
                "volume",
                "volume_change",
            ),
        ),
    ),
    NeuralArchitectureSpec(
        "nhits", "nhits-price-field", "N-HiTS",
        _startup_profile(
            chip_window=84, lookback=16, hidden_size=48, epochs=24,
            learning_rate=0.0006, retrain_interval=20, weight_decay=0.01,
            dropout=0.0, seed=42,
            enabled_factors=(
                "benchmark_qqq_return",
                "benchmark_smh_return",
                "benchmark_spy_momentum20",
                "close_location",
                "option_put_call_open_interest_ratio",
                "options",
                "overnight_gap",
                "pb_ratio",
                "volume_change",
            ),
        ),
    ),
    NeuralArchitectureSpec(
        "timexer", "timexer-price-field", "TimeXer",
        _startup_profile(
            chip_window=84, lookback=48, hidden_size=16, epochs=24,
            learning_rate=0.0003, retrain_interval=20, weight_decay=0.01,
            dropout=0.2, seed=42,
            enabled_factors=(
                "benchmark_qqq_momentum20",
                "benchmark_qqq_return",
                "benchmark_smh_momentum20",
                "benchmark_smh_return",
                "benchmark_spy_momentum20",
                "benchmark_spy_return",
                "close_location",
                "dividend_yield",
                "illiquidity_20d",
                "option_call_open_interest",
                "option_call_volume",
                "option_put_call_open_interest_ratio",
                "overnight_gap",
                "pb_ratio",
                "volume_at_price",
            ),
        ),
    ),
    NeuralArchitectureSpec(
        "itransformer", "itransformer-price-field", "iTransformer",
        _startup_profile(
            chip_window=84, lookback=24, hidden_size=16, epochs=12,
            learning_rate=0.003, retrain_interval=20, weight_decay=0.001,
            dropout=0.1, seed=42,
            enabled_factors=(
                "benchmark_smh_momentum20",
                "benchmark_smh_return",
                "benchmark_spy_return",
                "illiquidity_20d",
                "pb_ratio",
                "pe_ratio",
                "relative_volume_20d",
                "volume_change",
            ),
        ),
        hidden_maximum=32,
        search_hidden=(16, 32),
    ),
    NeuralArchitectureSpec(
        "tide", "tide-price-field", "TiDE",
        _startup_profile(
            chip_window=21, lookback=16, hidden_size=32, epochs=12,
            learning_rate=0.001, retrain_interval=20, weight_decay=0.001,
            dropout=0.0, seed=42,
            enabled_factors=(
                "amplitude",
                "benchmark_spy_momentum20",
                "close_location",
                "dividend_yield",
                "illiquidity_20d",
                "momentum_20d",
                "option_call_volume",
                "option_put_call_open_interest_ratio",
                "options",
                "pb_ratio",
                "pe_ratio",
                "volatility_20d",
            ),
        ),
        hidden_maximum=32,
        search_hidden=(16, 32),
    ),
    NeuralArchitectureSpec(
        "moderntcn", "moderntcn-price-field", "ModernTCN",
        _startup_profile(
            chip_window=42, lookback=24, hidden_size=8, epochs=12,
            learning_rate=0.001, retrain_interval=20, weight_decay=0.01,
            dropout=0.1, seed=43,
            enabled_factors=(
                "amplitude",
                "benchmark_qqq_momentum20",
                "benchmark_spy_momentum20",
                "benchmark_spy_return",
                "dividend_yield",
                "illiquidity_20d",
                "momentum_5d",
                "option_put_call_open_interest_ratio",
                "option_put_open_interest",
                "option_total_volume",
                "overnight_gap",
                "turnover",
                "volatility_20d",
            ),
        ),
        hidden_maximum=32,
        search_hidden=(8, 16),
    ),
    NeuralArchitectureSpec(
        "tft", "tft-price-field", "TFT",
        _startup_profile(
            chip_window=63, lookback=16, hidden_size=8, epochs=4,
            learning_rate=0.0003, retrain_interval=10, weight_decay=0.001,
            dropout=0.2, seed=42,
            enabled_factors=(
                "amplitude",
                "dividend_yield",
                "option_call_open_interest",
                "option_total_volume",
                "volatility_20d",
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
