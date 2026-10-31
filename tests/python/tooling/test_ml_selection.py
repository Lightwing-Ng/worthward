"""Model execution and metadata remain in their intended test groups.

Code version: v1.0.0
"""

from __future__ import annotations

import os
from pathlib import Path
import subprocess
import sys

import pytest


PROJECT_ROOT = Path(__file__).resolve().parents[3]
SERVICE_PATH = "tests/python/services/test_strategy_tuning.py"
CLI_PATH = "tests/python/tooling/test_strategy_tune_cli.py"
COMPUTE_PATH = "tests/python/strategies/test_lstm_compute.py"
MODEL_IDS = (
    "bayesian-price-field",
    "lstm-price-field",
    "moderntcn-price-field",
    "har-range-price-field",
)


@pytest.fixture(scope="module")
def selected_nodes(tmp_path_factory):
    """Collect real registry parameters without executing any forecast engine."""
    isolated = tmp_path_factory.mktemp("ml-test-selection")
    environment = {
        **os.environ,
        "PYTHONPATH": str(PROJECT_ROOT),
        "PYTHONDONTWRITEBYTECODE": "1",
        "PYTEST_ADDOPTS": "",
        "WORTHWARD_MARKET_STORE_DIR": str(isolated / "market"),
        "WORTHWARD_SETTINGS_STORE_DIR": str(isolated / "settings"),
        "WORTHWARD_COMPUTE_ROOT": str(isolated / "compute"),
        "WORTHWARD_REMOTE_MARKET_ACCESS": "disabled",
        "WORTHWARD_LONGBRIDGE_CLI_ACCESS": "disabled",
    }
    selections = {}
    for marker in ("not ml", "ml"):
        result = subprocess.run(
            [
                sys.executable, "-B", "-m", "pytest", "--collect-only", "-q",
                "-m", marker, SERVICE_PATH, CLI_PATH, COMPUTE_PATH,
            ],
            cwd=PROJECT_ROOT,
            env=environment,
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
        assert result.returncode == 0, result.stdout + result.stderr
        selections[marker] = {
            line.strip()
            for line in result.stdout.splitlines()
            if line.startswith("tests/") and "::" in line
        }
    return selections


@pytest.mark.parametrize("model_id", MODEL_IDS)
def test_real_forecast_execution_is_ml_while_its_metadata_stays_ordinary(
    selected_nodes, model_id,
):
    execution = (
        f"{SERVICE_PATH}::"
        "test_every_strategy_uses_real_execution_engines_on_isolated_factory_data"
        f"[{model_id}]"
    )
    metadata = (
        f"{SERVICE_PATH}::"
        f"test_every_dropdown_strategy_has_one_search_and_group_contract[{model_id}]"
    )
    assert execution in selected_nodes["ml"]
    assert execution not in selected_nodes["not ml"]
    assert metadata in selected_nodes["not ml"]
    assert metadata not in selected_nodes["ml"]

    # The CLI's registry parameters must classify the same real model engines.
    cli_cases = {
        node
        for node in selected_nodes["ml"]
        if node.startswith(
            f"{CLI_PATH}::test_every_registry_strategy_runs_through_cli_with_real_execution["
        )
        and node.endswith(f"-{model_id}]")
    }
    assert cli_cases
    assert cli_cases.isdisjoint(selected_nodes["not ml"])


def test_mocked_forecast_guards_and_classic_execution_remain_ordinary(selected_nodes):
    ordinary_cases = {
        f"{COMPUTE_PATH}::LstmComputeTests::"
        "test_target_normalization_is_causal_and_affine_equivariant",
        f"{COMPUTE_PATH}::LstmComputeTests::"
        "test_backends_receive_identical_causal_standardized_inputs",
        f"{SERVICE_PATH}::"
        "test_every_strategy_uses_real_execution_engines_on_isolated_factory_data[macd]",
    }
    assert ordinary_cases <= selected_nodes["not ml"]
    assert ordinary_cases.isdisjoint(selected_nodes["ml"])
