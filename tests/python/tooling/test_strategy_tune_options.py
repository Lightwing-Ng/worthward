"""CLI discovery, reusable configuration, and preflight guards. Code version: v1.1.0."""

from dataclasses import asdict
import json
import os

import pandas as pd
import pytest

from app.core.config import BASE_DIR, MARKET_STORE_DIR, SETTINGS_STORE_DIR
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
    assert result["objectives"][:2] == ["risk-adjusted-return", "net-return"]
    assert ("crps-skill" in result["objectives"]) == (
        entry["presentation_renderer"] == "probability-grid-v1"
    )


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


@pytest.mark.parametrize(
    ("strategy", "options", "message"),
    [
        ("macd", [], "requires a Price Field strategy"),
        ("buy-and-hold", [], "requires a Price Field strategy"),
        ("bayesian-price-field", ["--interval", "1m"], "requires --interval 1d"),
        ("missing-strategy", [], "Unknown strategy: missing-strategy"),
    ],
)
def test_crps_skill_rejects_unsupported_requests_before_provider_access(
    strategy, options, message, tmp_path, monkeypatch, capsys
):
    def unexpected_session(*_args, **_kwargs):
        pytest.fail("An unsupported CRPS request must fail before provider access.")

    monkeypatch.setattr(strategy_tune, "ResearchSession", unexpected_session)
    output = tmp_path / "run"
    arguments = [
        "--strategy", strategy, "--ticker", "NVDA", "--objective", "crps-skill",
        "--output", str(output), *options,
    ]
    assert strategy_tune.main(arguments) == 1
    error = capsys.readouterr().err
    assert error.startswith("strategy_tune failed:")
    assert message in error
    assert not output.exists()


@pytest.mark.parametrize("offline", [True, False])
def test_offline_disables_remote_market_access_before_provider_access(
    offline, tmp_path, monkeypatch, capsys
):
    observed = []

    def inspect_session(*_args, **_kwargs):
        observed.append(os.environ.get("WORTHWARD_REMOTE_MARKET_ACCESS"))
        raise ValueError("stop after the provider boundary")

    monkeypatch.setenv("WORTHWARD_REMOTE_MARKET_ACCESS", "enabled")
    monkeypatch.setattr(strategy_tune, "ResearchSession", inspect_session)
    output = tmp_path / "run"
    arguments = ["--strategy", "macd", "--ticker", "NVDA", "--output", str(output)]
    assert strategy_tune.main([*arguments, *(["--offline"] if offline else [])]) == 1
    assert "stop after the provider boundary" in capsys.readouterr().err
    assert observed == ["disabled" if offline else "enabled"]
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


@pytest.mark.parametrize(
    "relative_output",
    [
        "market_store",
        "market_store/strategy-tune-guard-probe",
        "settings_store/strategy-tune-guard-probe/run",
    ],
)
@pytest.mark.parametrize("from_repository_root", [False, True])
def test_repository_stores_stay_protected_when_store_variables_are_redirected(
    relative_output, from_repository_root, monkeypatch, capsys
):
    # conftest redirects both stores, so only the new default-root guard applies.
    assert MARKET_STORE_DIR.resolve() != (BASE_DIR / "market_store").resolve()
    assert SETTINGS_STORE_DIR.resolve() != (BASE_DIR / "settings_store").resolve()
    output = BASE_DIR / relative_output
    existed = output.exists()

    def unexpected_session(*_args, **_kwargs):
        pytest.fail("A protected output must be rejected before provider access.")

    monkeypatch.setattr(strategy_tune, "ResearchSession", unexpected_session)
    if from_repository_root:
        monkeypatch.chdir(BASE_DIR)
    arguments = [
        "--strategy", "macd", "--ticker", "NVDA", "--trials", "1",
        "--output", relative_output if from_repository_root else str(output),
    ]
    with pytest.raises(SystemExit) as stopped:
        strategy_tune.main(arguments)
    assert stopped.value.code == 2
    assert "cannot be inside production market or settings stores" in (
        capsys.readouterr().err
    )
    assert output.exists() == existed


def test_case_variant_output_cannot_reach_a_protected_store(tmp_path, monkeypatch, capsys):
    store = tmp_path / "store"
    store.mkdir()
    variant = tmp_path / "STORE"
    if not variant.exists():
        pytest.skip("Case-variant spellings name a different directory on this filesystem.")
    monkeypatch.setattr("app.core.config.MARKET_STORE_DIR", store)

    def unexpected_session(*_args, **_kwargs):
        pytest.fail("A protected output must be rejected before provider access.")

    monkeypatch.setattr(strategy_tune, "ResearchSession", unexpected_session)
    with pytest.raises(SystemExit) as stopped:
        strategy_tune.main([
            "--strategy", "macd", "--ticker", "NVDA", "--trials", "1",
            "--output", str(variant / "case-probe"),
        ])
    assert stopped.value.code == 2
    assert "cannot be inside production market or settings stores" in capsys.readouterr().err
    assert list(store.iterdir()) == []


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
