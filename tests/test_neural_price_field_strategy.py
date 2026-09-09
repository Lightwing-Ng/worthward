"""Shared neural strategy and causal input contracts. Code version: v1.3.0."""

from copy import deepcopy
import subprocess
import sys
from types import MappingProxyType

import numpy as np
import pandas as pd
import pytest

from strategies.base import normalize_strategy_presentation
from strategies.loader import instantiate_strategy, list_enabled_strategies
from strategies.neural_price_field_inputs import (
    causal_neural_market_bundle, factor_values_for_neural,
    plain_market_bundle, prepare_neural_price_field_inputs,
)
from strategies.neural_price_field_registry import NEURAL_ARCHITECTURES, NEURAL_SPECS
from tests.factories.market import ohlc_frame_for_dates

ARCHITECTURES = NEURAL_ARCHITECTURES
EXPECTED_AAPL_DEFAULTS = {
    "patchtst-price-field": {
        "chip_window": 84, "lookback": 32, "hidden_size": 32, "epochs": 8,
        "learning_rate": 0.0003, "retrain_interval": 20,
        "weight_decay": 0.001, "dropout": 0.0,
        "enabled_factors": {
            "use_illiquidity_20d", "use_close_location", "use_amplitude",
        },
    },
    "tsmixer-price-field": {
        "chip_window": 63, "lookback": 16, "hidden_size": 16, "epochs": 8,
        "learning_rate": 0.0003, "retrain_interval": 10,
        "weight_decay": 0.001, "dropout": 0.1,
        "enabled_factors": {
            "use_illiquidity_20d", "use_momentum_20d",
            "use_relative_volume_20d", "use_momentum_5d",
            "use_close_location", "use_amplitude", "use_intraday_return",
            "use_overnight_gap", "use_volume_change",
        },
    },
    "nhits-price-field": {
        "chip_window": 21, "lookback": 32, "hidden_size": 16, "epochs": 4,
        "learning_rate": 0.0003, "retrain_interval": 20,
        "weight_decay": 0.001, "dropout": 0.0,
        "enabled_factors": {
            "use_momentum_20d", "use_relative_volume_20d",
            "use_momentum_5d", "use_momentum_60d", "use_amplitude",
            "use_turnover",
        },
    },
    "timexer-price-field": {
        "chip_window": 21, "lookback": 32, "hidden_size": 16, "epochs": 4,
        "learning_rate": 0.0003, "retrain_interval": 10,
        "weight_decay": 0.001, "dropout": 0.1,
        "enabled_factors": {
            "use_illiquidity_20d", "use_momentum_5d", "use_turnover",
            "use_volume",
        },
    },
    "itransformer-price-field": {
        "chip_window": 63, "lookback": 32, "hidden_size": 16, "epochs": 8,
        "learning_rate": 0.0003, "retrain_interval": 10,
        "weight_decay": 0.001, "dropout": 0.1,
        "enabled_factors": {
            "use_momentum_20d", "use_volatility_20d", "use_amplitude",
            "use_intraday_return", "use_overnight_gap", "use_volume_change",
        },
    },
    "tide-price-field": {
        "chip_window": 21, "lookback": 16, "hidden_size": 16, "epochs": 4,
        "learning_rate": 0.001, "retrain_interval": 10,
        "weight_decay": 0.01, "dropout": 0.0,
        "enabled_factors": {
            "use_illiquidity_20d", "use_relative_volume_20d",
            "use_volatility_20d", "use_close_location", "use_amplitude",
            "use_intraday_return", "use_overnight_gap", "use_turnover",
        },
    },
    "moderntcn-price-field": {
        "chip_window": 42, "lookback": 16, "hidden_size": 8, "epochs": 4,
        "learning_rate": 0.0006, "retrain_interval": 10,
        "weight_decay": 0.01, "dropout": 0.0,
        "enabled_factors": {"use_turnover"},
    },
    "tft-price-field": {
        "chip_window": 42, "lookback": 16, "hidden_size": 8, "epochs": 4,
        "learning_rate": 0.001, "retrain_interval": 10,
        "weight_decay": 0.001, "dropout": 0.0,
        "enabled_factors": {
            "use_momentum_20d", "use_volatility_20d",
            "use_intraday_return", "use_overnight_gap",
        },
    },
}


def test_model_import_does_not_initialize_the_web_application():
    result = subprocess.run(
        [sys.executable, "-B", "-c", "import sys; import strategies.neural_price_field; assert 'app' not in sys.modules"],
        capture_output=True, text=True, timeout=15, check=False,
    )
    assert result.returncode == 0, result.stderr


def daily_frame(count=110):
    frame = ohlc_frame_for_dates("NVDA", pd.bdate_range("2025-01-02", periods=count).strftime("%Y-%m-%d").tolist())
    close = 100 * np.exp(np.cumsum(np.random.default_rng(919).normal(0.001, 0.013, count)))
    frame["Close"] = close
    frame["Open"] = close * 0.998
    frame["High"] = close * 1.01
    frame["Low"] = close * 0.99
    frame["Volume"] = 1_000_000 + np.arange(count) * 1_000
    return frame


def small_params():
    return {"compute_backend": "CPU", "lookback": 8, "hidden_size": 8,
            "epochs": 1, "retrain_interval": 20, "training_window": 64}


def test_eight_discovered_strategies_share_factors_and_training():
    names = {item["id"] for item in list_enabled_strategies()}
    assert {f"{key}-price-field" for key in ARCHITECTURES}.issubset(names)
    assert {"lstm-price-field", "bayesian-price-field"}.issubset(names)
    for architecture in ARCHITECTURES:
        strategy = instantiate_strategy(f"{architecture}-price-field")
        assert strategy.architecture == architecture
        assert strategy.strategy_training_family == "neural-price-field-v1"
        assert strategy.get_startup_params()["compute_backend"] == "Auto"
        assert len([d for d in strategy.get_parameter_definitions() if d.group == "factors"]) == 42
        assert strategy.get_parameter_sections()[1]["slot"] == "price-field-training"
        assert strategy.get_supported_intervals() == ("1d",)


@pytest.mark.parametrize("spec", NEURAL_SPECS, ids=lambda spec: spec.architecture)
def test_current_neural_tuning_profile_is_the_startup_default(spec):
    strategy = instantiate_strategy(spec.strategy_id)
    definitions = strategy.get_parameter_definitions()
    defaults = strategy.get_startup_params()
    expected = EXPECTED_AAPL_DEFAULTS[spec.strategy_id]
    assert {
        key: defaults[key]
        for key in (
            "cell_display_threshold", "training_window", "chip_window", "lookback",
            "hidden_size", "epochs", "learning_rate", "retrain_interval",
            "weight_decay", "dropout", "seed", "entry_probability", "compute_backend",
        )
    } == {
        "cell_display_threshold": 1.0,
        "training_window": 252,
        "chip_window": expected["chip_window"],
        "lookback": expected["lookback"],
        "hidden_size": expected["hidden_size"],
        "epochs": expected["epochs"],
        "learning_rate": expected["learning_rate"],
        "retrain_interval": expected["retrain_interval"],
        "weight_decay": expected["weight_decay"],
        "dropout": expected["dropout"],
        "seed": 42,
        "entry_probability": 60.0,
        "compute_backend": "Auto",
    }
    assert {
        definition.key
        for definition in definitions
        if definition.group == "factors" and defaults[definition.key]
    } == expected["enabled_factors"]
    assert spec.startup_profile.hidden_size == expected["hidden_size"]
    assert spec.startup_profile.enabled_factor_parameters == expected["enabled_factors"]
    assert defaults["hidden_size"] <= spec.hidden_maximum


@pytest.mark.parametrize("architecture", ARCHITECTURES)
def test_each_architecture_emits_direct_horizon_contract_on_cpu(architecture):
    pytest.importorskip("torch")
    strategy = instantiate_strategy(f"{architecture}-price-field")
    result = strategy.compute_signals(daily_frame(), small_params())
    presentation = normalize_strategy_presentation(result.presentation)
    assert presentation["distribution_kind"] == "direct-normal-horizon"
    assert presentation["target_interval"] == "signal-close-to-future-close"
    assert presentation["max_horizon"] == 20
    assert len(presentation["horizon_predictive_mean"][-1]) == 20
    assert all(np.isfinite(presentation["horizon_predictive_mean"][-1]))
    assert all(np.asarray(presentation["horizon_predictive_std"][-1]) > 0)
    assert presentation["device"]["resolved"] == "cpu"
    assert presentation["diagnostics"]["horizon_count"] == 20
    assert presentation["metric_geometry"]["diagnostic_outcome"]["horizons"] == list(range(1, 21))
    assert presentation["metric_geometry"]["diagnostic_outcome"]["proper_probability_rule"] == "one-minus-half-multiclass-brier"
    lattice = presentation["metric_geometry"]["render_lattice"]
    assert lattice["horizon_unit"] == "close-to-future-close-session"
    assert lattice["horizon_mapping"] == "direct-learned-1-through-20"
    assert lattice["spatial_mapping"] == "viewport-quantized-display-only"
    assert lattice["detail_horizons"] == list(range(1, 21))
    assert presentation["diagnostics"]["coverage_pct"] == 100
    assert result.frame["buy_signal"].dtype == bool


@pytest.mark.parametrize("architecture", ("tsmixer", "itransformer", "tide", "moderntcn", "tft"))
def test_future_prices_do_not_change_earlier_forecasts_or_model_fit(architecture):
    pytest.importorskip("torch")
    strategy = instantiate_strategy(f"{architecture}-price-field")
    original = daily_frame(140)
    changed = original.copy()
    changed.loc[110:, ["Open", "High", "Low", "Close"]] *= 10
    first = strategy.compute_signals(original, small_params())
    second = strategy.compute_signals(changed, small_params())
    columns = [f"pf_{kind}_h{horizon:02d}" for kind in ("mean", "std") for horizon in range(1, 21)]
    np.testing.assert_allclose(first.frame.loc[:109, columns], second.frame.loc[:109, columns], equal_nan=True)
    records = first.presentation["training_diagnostics"]["refits"]
    assert all(row["latest_training_outcome"] <= row["origin"] for row in records)


@pytest.mark.parametrize("architecture", ("tsmixer", "itransformer", "tide", "moderntcn", "tft"))
def test_display_threshold_does_not_change_training_or_probability_score(architecture):
    pytest.importorskip("torch")
    strategy = instantiate_strategy(f"{architecture}-price-field")
    first = strategy.compute_signals(daily_frame(), small_params())
    second = strategy.compute_signals(daily_frame(), {**small_params(), "cell_display_threshold": 40})
    assert first.presentation["fingerprint"] == second.presentation["fingerprint"]
    assert first.presentation["diagnostics"] == second.presentation["diagnostics"]


def test_external_publication_delay_is_idempotent_and_does_not_rewrite_raw():
    dates = pd.Series(pd.to_datetime(["2026-09-03", "2026-09-04", "2026-09-08"]))
    raw = {"factor_status": MappingProxyType({"options": "available"}),
           "option_history": [{"observed_at": "2026-09-04", "call_volume": 20}]}
    before = plain_market_bundle(raw)
    delayed = causal_neural_market_bundle(raw, dates)
    assert plain_market_bundle(raw) == before
    assert delayed["option_history"][0]["observed_at"] == "2026-09-08"
    assert delayed["option_history"][0]["measurement_at"] == "2026-09-04"
    assert causal_neural_market_bundle(delayed, dates) == delayed


def test_benchmark_features_are_causal_and_missing_sessions_remain_unknown():
    frame = daily_frame(70)
    benchmark = [{"observed_at": str(day.date()), "close": float(close)}
                 for day, close in zip(frame["Date"], frame["Close"])]
    bundle = {"benchmarks": {"QQQ": benchmark}}
    _, original, _ = factor_values_for_neural(frame, bundle, {})
    altered = deepcopy(bundle)
    for row in altered["benchmarks"]["QQQ"][50:]:
        row["close"] *= 10
    _, changed, _ = factor_values_for_neural(frame, altered, {})
    np.testing.assert_allclose(original["benchmark_qqq_return"][:50], changed["benchmark_qqq_return"][:50], equal_nan=True)
    assert np.isnan(original["benchmark_spy_return"]).all()
    assert np.isnan(original["benchmark_qqq_momentum20"][:20]).all()
    del altered["benchmarks"]["QQQ"][30]
    _, missing, _ = factor_values_for_neural(frame, altered, {})
    assert np.isnan(missing["benchmark_qqq_return"][30])


def test_requested_unavailable_factor_dimensions_do_not_depend_on_future_values():
    frame = daily_frame(80)
    params = {"use_pe_ratio": True, "use_benchmark_spy_return": True}
    _, features, names = prepare_neural_price_field_inputs(frame, {}, params)
    assert names == ("close_return", "pe", "benchmark_spy_return")
    assert features.shape == (80, 3)
    assert np.isnan(features[:, 1:]).all()
