"""CLI discovery, reusable configuration, and preflight guards. Code version: v1.0.1."""

from dataclasses import asdict
import json

import pandas as pd
import pytest

from app.services.research.strategy_tuning import ResearchSession
from scripts import strategy_tune
from strategies.loader import instantiate_strategy, list_enabled_strategies
from tests.factories.market import ohlc_frame_for_dates


@pytest.mark.parametrize("entry", list_enabled_strategies(), ids=lambda row: row["id"])
def test_describe_exposes_all_parameters_without_loading_market_data(
    entry, monkeypatch, capsys
):
    def unexpected_session(*_args, **_kwargs):
        pytest.fail("Discovery must not create a market-data session.")

    monkeypatch.setattr(strategy_tune, "ResearchSession", unexpected_session)
    assert strategy_tune.main(["--describe", entry["id"]]) == 0
    result = json.loads(capsys.readouterr().out)
    strategy = instantiate_strategy(entry["id"])
    assert result["id"] == entry["id"]
    assert result["default_params"] == strategy.get_startup_params()
    assert result["parameters"] == json.loads(
        json.dumps(
            [asdict(definition) for definition in strategy.get_parameter_definitions()]
        )
    )
    assert result["market_data_source"] == strategy.strategy_market_data_source
    assert result["execution_intervals"] == {
        interval: {
            "model_interval": strategy.get_model_interval(interval),
            "signal_bridge": strategy.get_signal_bridge(interval),
        }
        for interval in strategy.get_supported_intervals()
    }


def test_describe_unknown_strategy_returns_actionable_error(capsys):
    assert strategy_tune.main(["--describe", "missing-strategy"]) == 1
    captured = capsys.readouterr()
    assert captured.out == ""
    assert "Unknown strategy: missing-strategy" in captured.err


@pytest.mark.parametrize("field", ["params", "bounds"])
@pytest.mark.parametrize("source", ["[]", "null", "", "{broken}"])
def test_invalid_json_does_not_load_market_data_or_create_output(
    field, source, tmp_path, monkeypatch, capsys
):
    def unexpected_session(*_args, **_kwargs):
        pytest.fail("Invalid input must fail before a market-data session.")

    monkeypatch.setattr(strategy_tune, "ResearchSession", unexpected_session)
    output = tmp_path / "run"
    assert (
        strategy_tune.main(
            [
                "--strategy",
                "macd",
                "--ticker",
                "NVDA",
                "--output",
                str(output),
                f"--{field}",
                source,
            ]
        )
        == 1
    )
    assert "strategy_tune failed:" in capsys.readouterr().err
    assert not output.exists()


@pytest.mark.parametrize(
    "options",
    [
        ["--trials", "0"],
        ["--trials", "1001"],
        ["--time-budget", "nan"],
        ["--time-budget", "inf"],
        ["--time-budget", "0"],
        ["--seed", "-1"],
        ["--params", "@missing-params.json"],
    ],
)
def test_invalid_search_controls_fail_before_provider_access(
    options, tmp_path, monkeypatch
):
    def unexpected_session(*_args, **_kwargs):
        pytest.fail("Invalid search controls must fail before provider access.")

    monkeypatch.setattr(strategy_tune, "ResearchSession", unexpected_session)
    output = tmp_path / "run"
    assert (
        strategy_tune.main(
            [
                "--strategy",
                "macd",
                "--ticker",
                "NVDA",
                "--output",
                str(output),
                *options,
            ]
        )
        == 1
    )
    assert not output.exists()


def test_existing_output_is_preserved_without_provider_access(tmp_path, monkeypatch):
    def unexpected_session(*_args, **_kwargs):
        pytest.fail("An existing output must be rejected before provider access.")

    monkeypatch.setattr(strategy_tune, "ResearchSession", unexpected_session)
    sentinel = tmp_path / "result.json"
    sentinel.write_text("prior evidence", encoding="utf-8")
    assert (
        strategy_tune.main(
            [
                "--strategy",
                "macd",
                "--ticker",
                "NVDA",
                "--output",
                str(tmp_path),
            ]
        )
        == 1
    )
    assert sentinel.read_text(encoding="utf-8") == "prior evidence"


def test_json_files_match_inline_configuration_and_remain_unchanged(
    tmp_path, monkeypatch
):
    frame = ohlc_frame_for_dates(
        "NVDA", pd.bdate_range("2025-01-02", periods=100).strftime("%Y-%m-%d").tolist()
    )
    monkeypatch.setattr(
        strategy_tune,
        "ResearchSession",
        lambda request, **kwargs: ResearchSession(
            request, history_loader=lambda *_args: frame, **kwargs
        ),
    )
    fixed = '{"slow_span":30,"signal_span":8}'
    bounds = '{"fast_span":[4,10]}'
    params_file = tmp_path / "my params.json"
    bounds_file = tmp_path / "my bounds.json"
    params_file.write_text(fixed, encoding="utf-8")
    bounds_file.write_text(bounds, encoding="utf-8")
    results = []
    for name, params_arg, bounds_arg in (
        ("inline", fixed, bounds),
        ("files", f"@{params_file}", f"@{bounds_file}"),
    ):
        output = tmp_path / name
        assert (
            strategy_tune.main(
                [
                    "--strategy",
                    "macd",
                    "--ticker",
                    "NVDA",
                    "--from",
                    "2025-01-02",
                    "--to",
                    "2026-01-02",
                    "--params",
                    params_arg,
                    "--bounds",
                    bounds_arg,
                    "--trials",
                    "3",
                    "--output",
                    str(output),
                ]
            )
            == 0
        )
        results.append(json.loads((output / "result.json").read_text(encoding="utf-8")))
    for key in ("request", "trials", "best", "holdout", "data_fingerprint"):
        assert results[0][key] == results[1][key]
    assert results[0]["cli_version"] == strategy_tune.CODE_VERSION
    assert params_file.read_text(encoding="utf-8") == fixed
    assert bounds_file.read_text(encoding="utf-8") == bounds
