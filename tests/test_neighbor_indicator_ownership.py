"""Neutral ownership of shared neighbor-strategy primitives.

Code version: v1.0.0
"""

from __future__ import annotations

import ast
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from strategies import neighbor_indicators
from strategies.algorithms import strategy_knn_machine_learning as knn
from strategies.algorithms import strategy_lorentzian_classification as lorentzian


PROJECT_ROOT = Path(__file__).resolve().parents[1]
SHARED_ALIASES = (
    ("_atr", "average_true_range"),
    ("_ensure_ohlcv_columns", "ensure_neighbor_ohlcv_columns"),
    ("_normalize_neighbor_params", "normalize_neighbor_params"),
    ("_rsi", "wilder_rsi"),
    ("_true_range", "true_range"),
    ("_wilder_average", "wilder_average"),
)


@pytest.mark.parametrize(("alias", "owner_name"), SHARED_ALIASES)
def test_both_neighbor_strategies_reuse_the_neutral_owner(
        alias: str,
        owner_name: str,
) -> None:
    owner = getattr(neighbor_indicators, owner_name)

    assert getattr(knn, alias) is owner
    assert getattr(lorentzian, alias) is owner


def test_neither_neighbor_strategy_imports_the_other() -> None:
    for module in (knn, lorentzian):
        tree = ast.parse(Path(module.__file__).read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom):
                module_name = node.module or ""
                assert "strategy_knn_machine_learning" not in module_name
                assert "strategy_lorentzian_classification" not in module_name


def test_the_neutral_module_depends_on_no_strategy_adapter() -> None:
    tree = ast.parse(
        (PROJECT_ROOT / "strategies/neighbor_indicators.py").read_text(encoding="utf-8")
    )
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            assert "algorithms" not in (node.module or "")


def test_wilder_smoothing_keeps_an_unknown_warmup_missing() -> None:
    values = pd.Series([1.0, 2.0, 3.0, 4.0], dtype="float64")

    result = neighbor_indicators.wilder_average(values, 3)

    assert result.iloc[:2].isna().all()
    assert result.iloc[2] == pytest.approx(2.0)
    assert result.iloc[3] == pytest.approx(2.0 + ((4.0 - 2.0) / 3.0))


def test_observed_bar_validation_rejects_incoherent_and_missing_prices() -> None:
    frame = pd.DataFrame(
        {
            "Date": pd.date_range("2026-01-05", periods=3, freq="D"),
            "Open": [10.0, 10.5, 11.0],
            "High": [10.6, 11.0, 11.4],
            "Low": [9.8, 10.2, 10.7],
            "Close": [10.4, 10.9, 11.2],
        }
    )

    validated = neighbor_indicators.ensure_neighbor_ohlcv_columns(frame)
    assert list(validated["Close"]) == [10.4, 10.9, 11.2]

    broken_high = frame.copy()
    broken_high.loc[1, "High"] = 9.0
    with pytest.raises(ValueError, match="coherent OHLC"):
        neighbor_indicators.ensure_neighbor_ohlcv_columns(broken_high)

    missing_close = frame.drop(columns=["Close"])
    with pytest.raises(ValueError, match="observed Close"):
        neighbor_indicators.ensure_neighbor_ohlcv_columns(missing_close)

    out_of_order = frame.copy()
    out_of_order.loc[2, "Date"] = frame.loc[0, "Date"]
    with pytest.raises(ValueError, match="chronological"):
        neighbor_indicators.ensure_neighbor_ohlcv_columns(out_of_order)


def test_average_true_range_matches_wilder_smoothing_of_true_range() -> None:
    frame = pd.DataFrame(
        {
            "High": [11.0, 11.5, 12.0, 12.5, 12.2],
            "Low": [10.0, 10.4, 11.1, 11.6, 11.3],
            "Close": [10.5, 11.2, 11.8, 12.1, 11.9],
        }
    )

    expected = neighbor_indicators.wilder_average(
        neighbor_indicators.true_range(frame), 3
    )
    result = neighbor_indicators.average_true_range(frame, 3)

    np.testing.assert_allclose(
        result.to_numpy(dtype=float),
        expected.to_numpy(dtype=float),
        equal_nan=True,
    )
