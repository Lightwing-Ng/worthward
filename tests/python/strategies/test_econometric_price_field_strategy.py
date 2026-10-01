"""Econometric Price Field strategy adapters. Code version: v1.0.0."""

from __future__ import annotations

from copy import deepcopy
import math
import subprocess
import sys
import warnings

import numpy as np
import pandas as pd
import pytest

from strategies.backtest import run_single_ticker_backtest
from strategies.base import normalize_strategy_presentation
from strategies.loader import instantiate_strategy, list_enabled_strategies
from strategies.price_field.econometric import strategy as econometric
from strategies.price_field.econometric.measures import session_refit_origins
from strategies.price_field.econometric.score_driven import score_driven_sigma
from strategies.price_field.pipeline import PRICE_FIELD_FACTOR_DEFINITIONS, bundle_to_price_field_ohlcv
from tests.factories.market import clustered_ohlc_random_walk, price_field_bundle_for_frame

# id: (name, display order, fit window, CRPS scale multiplier, parameter title)
EXPECTED = {
    "har-range-price-field": ("HAR Range Price Field", 55, 2000, 0.94, "HAR Range parameters"),
    "score-driven-price-field": ("Score-Driven Price Field", 56, 1000, 0.96, "Score-Driven parameters"),
    "rough-volatility-price-field": ("Rough Volatility Price Field", 57, 2000, 0.94, "Rough Volatility parameters"),
    "crps-learning-price-field": ("CRPS Learning Price Field", 58, 2000, 1.0, "CRPS Learning parameters"),
}
IDS = tuple(EXPECTED)
MEAN_COLUMNS = [f"pf_mean_h{horizon:02d}" for horizon in range(1, 21)]
STD_COLUMNS = [f"pf_std_h{horizon:02d}" for horizon in range(1, 21)]
WARMUP_ROWS = 300
_RUNS: dict[str, tuple[object, pd.DataFrame]] = {}


def _history(count: int = 420) -> pd.DataFrame:
    return clustered_ohlc_random_walk(count)


def _warm_run(strategy_id: str):
    """Compute once per strategy: 300 warmup bars plus 120 visible bars from the bundle."""
    if strategy_id not in _RUNS:
        strategy = instantiate_strategy(strategy_id)
        full = _history()
        strategy._warmup_bundle = price_field_bundle_for_frame("NVDA", full)
        visible = full.iloc[WARMUP_ROWS:].reset_index(drop=True)
        _RUNS[strategy_id] = (strategy.compute_signals(visible, strategy.get_startup_params()), visible)
    return _RUNS[strategy_id]


def _builtin_only(node: object) -> bool:
    if node is None or type(node) in (str, bool, int, float):
        return True
    if type(node) is dict:
        return all(type(key) is str and _builtin_only(value) for key, value in node.items())
    if type(node) is list:
        return all(_builtin_only(item) for item in node)
    return False


def test_registry_declares_four_price_field_strategies_without_training():
    catalog = {entry["id"]: entry for entry in list_enabled_strategies()}
    price_field = [entry["id"] for entry in list_enabled_strategies() if entry["category"] == "price-field"]
    assert price_field[-5:] == ["tft-price-field", *IDS]
    for strategy_id, (name, order, _, _, title) in EXPECTED.items():
        entry = catalog[strategy_id]
        strategy = instantiate_strategy(strategy_id)
        assert entry["name"] == name
        assert entry["ui"]["display_order"] == order
        assert entry["category"] == "price-field"
        assert entry["presentation_renderer"] == "probability-grid-v1"
        assert isinstance(strategy, econometric.EconometricPriceFieldStrategy)
        assert not hasattr(strategy, "strategy_training_family")
        assert strategy.strategy_parameter_actions == ()
        assert [section["key"] for section in strategy.get_parameter_sections()] == ["parameters", "factors"]
        assert strategy.strategy_parameter_title == title
        assert strategy.get_supported_intervals() == ("1d",)
        assert strategy.strategy_market_data_source == "longbridge-cli"
        assert strategy.backtest_cacheable is False
        assert strategy.get_default_tickers() == ("NVDA",)
        description = strategy.strategy_description
        assert description.endswith(".") and description.count(". ") == 0


@pytest.mark.parametrize("strategy_id", IDS)
def test_startup_defaults_are_the_frozen_specification(strategy_id):
    strategy = instantiate_strategy(strategy_id)
    defaults = strategy.get_startup_params()
    _, _, window, multiplier, _ = EXPECTED[strategy_id]
    expected = {
        "cell_display_threshold": 1.0, "training_window": window, "retrain_interval": 20,
        "scale_multiplier": multiplier, "drift_prior_sharpe": 0.6, "drift_prior_strength": 2520,
        "drift_window": 1260, "entry_probability": 60.0, "use_drift": True, "use_intraday_range": True,
    }
    if strategy_id == "crps-learning-price-field":
        expected.update(learning_rate=0.5, forgetting=0.999)
    assert defaults == expected
    definitions = {definition.key: definition for definition in strategy.get_parameter_definitions()}
    assert (definitions["training_window"].minimum, definitions["training_window"].maximum) == (63, 2520)
    assert (definitions["retrain_interval"].minimum, definitions["retrain_interval"].maximum) == (1, 63)
    assert (definitions["scale_multiplier"].minimum, definitions["scale_multiplier"].maximum) == (0.5, 1.5)
    assert not definitions["cell_display_threshold"].optimizable
    assert not definitions["entry_probability"].optimizable
    factors = {key: definition.subgroup for key, definition in definitions.items() if definition.group == "factors"}
    assert factors == {"use_drift": "Location", "use_intraday_range": "Realized measures"}
    assert "narrower scale" in definitions["scale_multiplier"].help_text


# Requested bars = base + ceil(0.08 * base) + 60, with base = max(fit window + refit interval + 42,
# drift window + 252): the refit block before the first visible origin and a holiday allowance.
@pytest.mark.parametrize(("params", "requested"), [
    ({}, None),
    ({"training_window": 2520, "drift_window": 100}, 2849),
    ({"training_window": 63, "drift_window": 2520}, 3054),
    ({"training_window": 2000, "retrain_interval": 63, "drift_window": 100}, 2334),
])
@pytest.mark.parametrize("strategy_id", IDS)
def test_load_requests_ohlcv_warmup_for_the_fit_and_drift_windows(strategy_id, params, requested, monkeypatch):
    bundle = price_field_bundle_for_frame("NVDA", _history(80))
    calls = []

    def provider(tickers, *, interval, start, end, params):
        calls.append((tuple(tickers), interval, start, end, dict(params)))
        return deepcopy(bundle)

    monkeypatch.setattr(econometric, "load_price_field_market_bundle", provider)
    strategy = instantiate_strategy(strategy_id)
    frames = strategy.load_market_datasets(("NVDA",), interval="1d", start="2016-03-01", end="2016-04-22",
                                           params=params)

    fit_window = EXPECTED[strategy_id][2]
    base = max(fit_window + 20 + 42, 1260 + 252)
    expected = requested if requested is not None else base + math.ceil(0.08 * base) + 60
    (tickers, interval, start, end, load_params), = calls
    assert (tickers, interval, start, end) == (("NVDA",), "1d", "2016-03-01", "2016-04-22")
    assert load_params["training_window"] == expected
    assert load_params["use_volume_at_price"] is False
    assert all(load_params[definition.parameter_key] is False for definition in PRICE_FIELD_FACTOR_DEFINITIONS)
    assert strategy._warmup_bundle == bundle
    pd.testing.assert_frame_equal(frames[0], bundle_to_price_field_ohlcv(bundle))
    assert frames[0].attrs["market_data_source"] == "longbridge-cli"


@pytest.mark.parametrize("strategy_id", IDS)
def test_visible_forecasts_use_the_warmup_bundle(strategy_id):
    result, visible = _warm_run(strategy_id)
    diagnostics = result.presentation["diagnostics"]
    assert diagnostics["origin_start"] == WARMUP_ROWS
    assert diagnostics["distribution_warmup_history_points"] == WARMUP_ROWS
    assert diagnostics["distribution_visible_origin_points"] == len(visible)
    pd.testing.assert_series_equal(result.frame["Date"], visible["Date"], check_names=False)

    strategy = instantiate_strategy(strategy_id)
    whole = strategy.compute_signals(_history(), strategy.get_startup_params())
    np.testing.assert_allclose(result.frame[STD_COLUMNS].to_numpy(), whole.frame[STD_COLUMNS].to_numpy()[WARMUP_ROWS:],
                               rtol=1e-12)
    assert whole.presentation["diagnostics"]["origin_start"] == 0
    cold = instantiate_strategy(strategy_id).compute_signals(visible, strategy.get_startup_params())
    assert not np.allclose(cold.frame[STD_COLUMNS].to_numpy(), result.frame[STD_COLUMNS].to_numpy(), equal_nan=True)


@pytest.mark.parametrize("strategy_id", IDS)
def test_presentation_is_builtin_json_and_matches_the_browser_contract(strategy_id):
    result, visible = _warm_run(strategy_id)
    presentation = result.presentation
    assert _builtin_only(presentation)
    assert normalize_strategy_presentation(presentation) == presentation
    rows = len(visible)
    assert presentation["schema"] == f"{strategy_id}/v1"
    assert presentation["renderer"] == "probability-grid-v1"
    assert presentation["distribution_kind"] == "direct-normal-horizon"
    assert presentation["multi_step_kind"] == "direct-horizon"
    assert presentation["max_horizon"] == 20
    assert presentation["data_keys"] == [pd.Timestamp(value).isoformat() for value in visible["Date"]]
    for key in ("predictive_mean", "predictive_scale", "probability_up", "return_autoregression",
                "return_long_run_mean", "return_innovation_scale", "horizon_predictive_mean",
                "horizon_predictive_std"):
        assert len(presentation[key]) == rows
    for index in range(rows):
        mean, scale = presentation["predictive_mean"][index], presentation["predictive_scale"][index]
        horizon_means = presentation["horizon_predictive_mean"][index]
        horizon_stds = presentation["horizon_predictive_std"][index]
        assert len(horizon_means) == len(horizon_stds) == 20
        assert mean is not None and scale is not None
        assert all(math.isfinite(value) for value in horizon_means)
        assert all(value > 0 for value in horizon_stds)
        assert horizon_means[0] == mean and horizon_stds[0] == scale
        assert presentation["return_innovation_scale"][index] == scale
    assert set(presentation["return_autoregression"]) == set(presentation["return_long_run_mean"]) == {0.0}
    assert presentation["metric_geometry"]["render_lattice"]["horizon_mapping"] == "direct-estimated-1-through-20"
    assert presentation["fingerprint"]
    assert presentation["device"]["resolved"] == "cpu"
    assert [factor["key"] for factor in presentation["factors"]] == ["drift", "intraday_range"]
    assert all(factor["status"] == "active" for factor in presentation["factors"])
    assert presentation["econometric"]["first_forecast_origin"] is not None
    assert presentation["econometric"]["location"]["model"] == "bayesian-sharpe-drift"
    assert result.required_execution_mode == "next_open"
    assert result.frame["buy_signal"].dtype == bool


@pytest.mark.parametrize("strategy_id", IDS)
def test_backtest_reports_a_complete_distribution_headline(strategy_id):
    result, _ = _warm_run(strategy_id)
    summary = run_single_ticker_backtest(result, 10000.0, execution_mode="next_open", interval="1d")["summary"]
    headline = summary["probability_field_distribution_skill_pct"]
    assert type(headline) is float and math.isfinite(headline)
    assert summary["probability_field_valid_pairs"] == summary["probability_field_eligible_pairs"] > 0
    assert set(summary["probability_field_horizon_profile"]) == {"1", "5", "10", "20"}


@pytest.mark.parametrize("strategy_id", IDS)
def test_short_history_without_warmup_forecasts_from_row_sixty(strategy_id):
    strategy = instantiate_strategy(strategy_id)
    params = {**strategy.get_startup_params(), "use_drift": False, "use_intraday_range": False,
              "training_window": 63, "retrain_interval": 63}
    frame = _history(160)
    result = strategy.compute_signals(frame, params)
    assert strategy._warmup_bundle is None
    means = np.array([np.nan if value is None else value for value in result.presentation["predictive_mean"]])
    assert np.isfinite(means[60:]).all()
    assert (result.frame[STD_COLUMNS].to_numpy()[60:] > 0).all()
    assert result.presentation["diagnostics"]["origin_start"] == 0
    assert [factor["status"] for factor in result.presentation["factors"]] == ["disabled", "disabled"]


@pytest.mark.parametrize("strategy_id", IDS)
def test_factor_switches_change_the_forecasts_as_documented(strategy_id):
    strategy = instantiate_strategy(strategy_id)
    defaults = strategy.get_startup_params()
    frame = _history(260)
    widened = frame.copy()
    widened["Open"] = widened["Open"] * 1.004
    widened["High"] = widened[["High", "Open"]].max(axis=1) * 1.01
    widened["Low"] = widened[["Low", "Open"]].min(axis=1) * 0.99

    drift_on = strategy.compute_signals(frame, defaults).frame
    drift_off = strategy.compute_signals(frame, {**defaults, "use_drift": False}).frame
    finite = np.isfinite(drift_off[MEAN_COLUMNS].to_numpy())
    assert finite[60:].all()
    assert (drift_off[MEAN_COLUMNS].to_numpy()[finite] == 0.0).all()
    assert np.abs(drift_on[MEAN_COLUMNS].to_numpy()[60:]).max() > 0

    close_only = {**defaults, "use_intraday_range": False}
    first = strategy.compute_signals(frame, close_only).frame[STD_COLUMNS].to_numpy()
    second = strategy.compute_signals(widened, close_only).frame[STD_COLUMNS].to_numpy()
    np.testing.assert_allclose(first, second, rtol=1e-12, equal_nan=True)
    ranged = strategy.compute_signals(widened, defaults).frame[STD_COLUMNS].to_numpy()
    assert not np.allclose(ranged[60:], drift_on[STD_COLUMNS].to_numpy()[60:])


def test_score_driven_multiplier_maps_onto_the_close_only_fallback():
    strategy = instantiate_strategy("score-driven-price-field")
    frame = _history(200)
    close_only = {**strategy.get_startup_params(), "use_intraday_range": False}
    default = strategy.compute_signals(frame, close_only).frame[STD_COLUMNS].to_numpy()
    narrower = strategy.compute_signals(frame, {**close_only, "scale_multiplier": 0.72}).frame[STD_COLUMNS].to_numpy()
    arrays = [frame[column].to_numpy(dtype=float) for column in ("Open", "High", "Low", "Close")]
    origins = session_refit_origins(frame["Date"].to_numpy(), 20)            # the strategy refits on session dates
    fallback = score_driven_sigma(*arrays, use_range=False, refit_origins=origins)
    np.testing.assert_allclose(default, fallback, rtol=1e-12, equal_nan=True)
    np.testing.assert_allclose(narrower, 0.75 * fallback, rtol=1e-12, equal_nan=True)


def test_crps_learning_parameters_reach_the_combiner():
    strategy = instantiate_strategy("crps-learning-price-field")
    frame = _history(260)
    defaults = strategy.get_startup_params()
    base = strategy.compute_signals(frame, defaults).frame[STD_COLUMNS].to_numpy()
    wider = strategy.compute_signals(frame, {**defaults, "scale_multiplier": 1.2}).frame[STD_COLUMNS].to_numpy()
    faster = strategy.compute_signals(frame, {**defaults, "learning_rate": 3.0}).frame[STD_COLUMNS].to_numpy()
    np.testing.assert_allclose(wider, 1.2 * base, rtol=1e-12, equal_nan=True)
    assert not np.allclose(faster[100:], base[100:])


def test_strategy_modules_do_not_initialize_the_web_application():
    modules = ["strategies.price_field.econometric.strategy",
               *(f"strategies.algorithms.strategy_{name}_price_field"
                 for name in ("har_range", "score_driven", "rough_volatility", "crps_learning"))]
    script = "import importlib, sys\n" + "".join(f"importlib.import_module({name!r})\n" for name in modules)
    script += "assert 'app' not in sys.modules and 'torch' not in sys.modules\n"
    # The shared bundle helper lives in the model-neutral pipeline; the neural inputs only re-export it.
    script += "assert 'strategies.price_field.neural.inputs' not in sys.modules\n"
    script += ("from strategies.price_field import pipeline\nfrom strategies.price_field.neural import inputs\n"
               "assert inputs.plain_market_bundle is pipeline.plain_market_bundle\n")
    result = subprocess.run([sys.executable, "-B", "-c", script], capture_output=True, text=True, timeout=30,
                            check=False)
    assert result.returncode == 0, result.stderr


# Forecasts on these sessions come from fits whose windows lie inside every loaded history below.
START_HISTORY_ROWS, START_VISIBLE_FROM, START_LATEST_ROW = 560, 500, 19
START_PARAMS = {"training_window": 100, "drift_window": 100}


def _start_run(strategy_id: str, first_row: int):
    strategy = instantiate_strategy(strategy_id)
    full = _history(START_HISTORY_ROWS)
    strategy._warmup_bundle = price_field_bundle_for_frame("NVDA", full.iloc[first_row:].reset_index(drop=True))
    visible = full.iloc[START_VISIBLE_FROM:].reset_index(drop=True)
    result = strategy.compute_signals(visible, {**strategy.get_startup_params(), **START_PARAMS})
    return result.frame[MEAN_COLUMNS].to_numpy(), result.frame[STD_COLUMNS].to_numpy(), result


@pytest.mark.parametrize("strategy_id", ("har-range-price-field", "score-driven-price-field"))
def test_session_forecasts_do_not_depend_on_where_the_loaded_history_starts(strategy_id):
    means, stds, result = _start_run(strategy_id, START_LATEST_ROW)
    assert np.isfinite(stds).all()
    assert result.presentation["econometric"]["refit_schedule"] == "session-date-blocks"
    for extra in range(1, START_LATEST_ROW + 1):
        earlier_means, earlier_stds, _ = _start_run(strategy_id, START_LATEST_ROW - extra)
        # Date-anchored refits give the same fits; only running totals round differently.
        if strategy_id == "score-driven-price-field":
            np.testing.assert_array_equal(earlier_stds, stds)
        else:
            np.testing.assert_allclose(earlier_stds, stds, rtol=1e-10, atol=0.0)
        np.testing.assert_allclose(earlier_means, means, rtol=1e-12, atol=1e-18)


@pytest.mark.parametrize("strategy_id", ("rough-volatility-price-field", "crps-learning-price-field"))
def test_expanding_model_state_moves_little_with_the_loaded_start(strategy_id):
    """Frozen specification: the Rough Volatility log-variance mean and the CRPS Learning weights
    accumulate from the first loaded bar, so an earlier start moves forecasts slightly."""
    _, stds, result = _start_run(strategy_id, START_LATEST_ROW)
    assert np.isfinite(stds).all()
    diagnostics = result.presentation["econometric"]["scale"]
    state = diagnostics.get("log_variance_mean") or diagnostics.get("learning_state")
    assert state.endswith("from-first-loaded-bar")
    for extra in (1, 10, START_LATEST_ROW):
        _, earlier_stds, _ = _start_run(strategy_id, START_LATEST_ROW - extra)
        np.testing.assert_allclose(earlier_stds, stds, rtol=0.05)


BOUND_CASES = (
    {"drift_prior_strength": 0},
    {"training_window": 63, "drift_window": 21, "retrain_interval": 1},
    {"scale_multiplier": 1.5, "drift_prior_sharpe": 2.0, "learning_rate": 4.0, "forgetting": 1.0},
    {"scale_multiplier": 0.5, "drift_prior_sharpe": 0.0, "learning_rate": 0.05, "forgetting": 0.95},
    {"training_window": 2520, "drift_window": 2520, "drift_prior_strength": 10080, "retrain_interval": 63},
)
FIRST_FORECAST_ORIGIN = {"har-range-price-field": 22, "score-driven-price-field": 59,
                         "rough-volatility-price-field": 0, "crps-learning-price-field": 60}


@pytest.mark.parametrize("case", BOUND_CASES, ids=("no-prior", "shortest", "upper", "lower", "longest"))
@pytest.mark.parametrize("strategy_id", IDS)
def test_parameter_bounds_forecast_cleanly(strategy_id, case):
    strategy = instantiate_strategy(strategy_id)
    params = strategy.get_startup_params()
    params.update({key: value for key, value in case.items() if key in params})
    definitions = {definition.key: definition for definition in strategy.get_parameter_definitions()}
    for key in case.keys() & params.keys():
        assert case[key] in (definitions[key].minimum, definitions[key].maximum)
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        result = strategy.compute_signals(_history(200), params)
    first = FIRST_FORECAST_ORIGIN[strategy_id]
    assert np.isfinite(result.frame[MEAN_COLUMNS].to_numpy()[first:]).all()
    assert (result.frame[STD_COLUMNS].to_numpy()[first:] > 0).all()
    assert _builtin_only(result.presentation)


def _statuses(result) -> list[tuple[str, str, str, bool]]:
    return [(factor["key"], factor["status"], factor["selection_status"], factor["selected"])
            for factor in result.presentation["factors"]]


@pytest.mark.parametrize("strategy_id", IDS)
def test_factor_status_reports_whether_the_forecast_uses_the_input(strategy_id):
    strategy = instantiate_strategy(strategy_id)
    defaults = strategy.get_startup_params()

    # 21 sessions end inside the drift burn-in: the forecast mean never uses the drift.
    short = strategy.compute_signals(_history(21), defaults)
    assert _statuses(short) == [("drift", "insufficient", "ineligible", False),
                                ("intraday_range", "active", "selected", True)]
    assert short.presentation["factor_selection"]["selected"] == ["intraday_range"]
    means = short.frame[MEAN_COLUMNS].to_numpy()
    assert (means[np.isfinite(means)] == 0.0).all()

    # One session past the burn-in the prior alone sets the drift, before any standardized return.
    active = strategy.compute_signals(_history(22), defaults)
    assert _statuses(active)[0] == ("drift", "active", "selected", True)
    assert active.presentation["factors"][0]["finite_observations"] == 1

    # Without opens, highs and lows no session's range enters the variance proxy.
    no_range = strategy.compute_signals(clustered_ohlc_random_walk(80, missing_open_rows=tuple(range(80))), defaults)
    assert _statuses(no_range)[1] == ("intraday_range", "insufficient", "ineligible", False)
    assert no_range.presentation["factors"][1]["finite_observations"] == 0

    disabled = strategy.compute_signals(_history(80), {**defaults, "use_drift": False, "use_intraday_range": False})
    assert _statuses(disabled) == [("drift", "disabled", "disabled", False),
                                   ("intraday_range", "disabled", "disabled", False)]
    assert disabled.presentation["factor_selection"]["selected"] == []


def test_score_driven_skips_warmup_fits_without_changing_visible_outputs(monkeypatch):
    result, visible = _warm_run("score-driven-price-field")
    scale = result.presentation["econometric"]["scale"]
    assert result.presentation["econometric"]["first_forecast_origin"] == WARMUP_ROWS
    assert result.presentation["econometric"]["first_visible_origin"] == WARMUP_ROWS

    # Force every refit, as if the first visible origin were the first loaded row.
    monkeypatch.setattr(econometric, "visible_scoring_bounds", lambda full, shown: (0, len(full)))
    strategy = instantiate_strategy("score-driven-price-field")
    strategy._warmup_bundle = price_field_bundle_for_frame("NVDA", _history())
    every = strategy.compute_signals(visible, strategy.get_startup_params())

    pd.testing.assert_frame_equal(result.frame, every.frame, check_exact=True)
    trimmed = {key: value for key, value in result.presentation.items() if key != "econometric"}
    assert trimmed == {key: value for key, value in every.presentation.items() if key != "econometric"}
    assert scale["refit_count"] < every.presentation["econometric"]["scale"]["refit_count"]
    assert every.presentation["econometric"]["first_forecast_origin"] == 59
