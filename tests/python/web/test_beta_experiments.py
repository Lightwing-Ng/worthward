"""Numerical invariants for bounded Beta experiments. Code version: v0.1.0."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from app.beta import analysis
from tests.factories.market import close_frame_for_dates


def research_frame(closes):
    dates = pd.bdate_range("2010-01-01", periods=len(closes)).strftime("%Y-%m-%d").tolist()
    return close_frame_for_dates(dates, list(closes))


def metric_values(payload):
    return {item["label"]: item["value"] for item in payload["metrics"]}


def test_remix_keeps_endpoint_while_exposing_order_risk():
    frame = research_frame([100.0, 125.0, 100.0, 125.0, 100.0])
    payload = analysis.path_remix(frame)
    paths = {item["label"]: item["values"] for item in payload["chart"]["series"]}
    assert paths["Observed order (%)"] == [0.0, 25.0, 0.0, 25.0, 0.0]
    assert paths["Lowest returns first (%)"] == [0.0, -20.0, -36.0, -20.0, 0.0]
    assert paths["Highest returns first (%)"] == [0.0, 25.0, 56.25, 25.0, 0.0]
    assert {path[-1] for path in paths.values()} == {0.0}
    rows = payload["rows"]["values"]
    assert rows[0] == ["Observed order", "+0.00%", "-20.00%", "1"]
    assert rows[2] == ["Lowest returns first", "+0.00%", "-36.00%", "3"]
    assert rows[3] == ["Highest returns first", "+0.00%", "-36.00%", "2"]
    assert metric_values(payload)["Drawdown spread"] == "16.00 pp"


def test_remix_uses_latest_252_returns_and_is_deterministic():
    closes = np.concatenate(([1.0, 500.0], np.linspace(100.0, 200.0, 253)))
    frame = research_frame(closes)
    first = analysis.path_remix(frame)
    assert first == analysis.path_remix(frame)
    assert len(first["chart"]["labels"]) == 253
    assert metric_values(first)["Returns rearranged"] == "252"
    assert {item["values"][-1] for item in first["chart"]["series"]} == {100.0}
    assert all(row[2] == "+0.00%" for row in first["rows"]["values"])


def test_recovery_tracks_tied_peaks_first_recovery_and_censoring():
    closes = np.array([100.0, 100.0, 80.0, 80.0, 100.0, 100.0, 90.0, 110.0, 88.0, 99.0])
    assert analysis.drawdown_episodes(closes) == [
        {"peak": 1, "trough": 2, "recovery": 4},
        {"peak": 5, "trough": 6, "recovery": 7},
        {"peak": 7, "trough": 8, "recovery": None},
    ]
    payload = analysis.recovery_clock(research_frame(closes))
    assert metric_values(payload) == {
        "Maximum observed drawdown": "-20.00%",
        "Recovered episodes": "2",
        "Median recovery time": "2.5 sessions",
        "Current underwater age": "2 sessions",
    }
    assert payload["rows"]["values"][0][-2:] == ["Unrecovered (censored)", "2"]
    assert payload["chart"]["series"][0]["values"] == [0, 0, -20, -20, 0, 0, -10, 0, -20, -10]


def test_recovery_chart_retains_peak_before_252_close_display_window():
    frame = research_frame([200.0] + [100.0] * 300)
    payload = analysis.recovery_clock(frame)
    assert len(payload["chart"]["labels"]) == 252
    assert payload["chart"]["series"][0]["values"] == [-50.0] * 252
    assert metric_values(payload)["Median recovery time"] == "Not observed"
    assert metric_values(payload)["Recovered episodes"] == "0"
    assert metric_values(payload)["Current underwater age"] == "300 sessions"
    assert len(payload["rows"]["values"]) == 1


def test_recovery_table_deduplicates_recent_deepest_and_longest_episodes():
    closes = [100.0]
    for depth in range(15, 0, -1):
        closes.extend([100.0 - depth, 100.0])
    frame = research_frame(closes)
    rows = analysis.recovery_clock(frame)["rows"]["values"]
    expected_peaks = [analysis.display_date(frame["Date"].iloc[index * 2]) for index in [14, 13, 12, 11, 10, 4, 3, 2, 1, 0]]
    assert len(rows) == 10
    assert [row[0] for row in rows] == expected_peaks


@pytest.mark.parametrize("long_episodes", [1, 2])
def test_recovery_table_keeps_latest_longest_episode_outside_recent_and_deepest(long_episodes):
    closes = [100.0]
    for _ in range(long_episodes):
        closes.extend([99.0] * 100 + [100.0])
    for depth in range(20, 10, -1):
        closes.extend([100.0 - depth, 100.0])
    frame = research_frame(closes)
    rows = analysis.recovery_clock(frame)["rows"]["values"]
    assert len(rows) == 11
    peak = (long_episodes - 1) * 101
    assert rows[-1] == [
        analysis.display_date(frame["Date"].iloc[peak]),
        analysis.display_date(frame["Date"].iloc[peak + 1]),
        "-1.00%",
        analysis.display_date(frame["Date"].iloc[peak + 101]),
        "101",
    ]


@pytest.mark.parametrize("closes", [np.full(120, 100.0), np.arange(1.0, 121.0)])
def test_flat_and_rising_paths_have_no_drawdown_episodes(closes):
    frame = research_frame(closes)
    assert analysis.drawdown_episodes(closes) == []
    recovery = analysis.recovery_clock(frame)
    assert recovery["rows"]["values"] == []
    assert metric_values(recovery)["Median recovery time"] == "Not observed"
    assert metric_values(recovery)["Current underwater age"] == "0 sessions"
    assert recovery["chart"]["series"][0]["values"] == [0.0] * 120
    remix = analysis.path_remix(frame)
    assert all(row[2:] == ["+0.00%", "0"] for row in remix["rows"]["values"])


def test_calibration_has_exact_linear_quantiles_and_next_return_alignment():
    returns = np.tile(np.linspace(-0.03, 0.03, 60), 2)
    closes = 100 * np.concatenate(([1.0], np.cumprod(1 + returns)))
    lower, upper, observed = analysis.prequential_bands(closes)
    assert len(observed) == 60
    assert lower == pytest.approx(np.full(60, -0.024))
    assert upper == pytest.approx(np.full(60, 0.024))
    assert observed == pytest.approx(returns[60:])
    payload = analysis.calibration_lab(research_frame(closes))
    assert metric_values(payload) == {
        "Observed coverage": "80.0%",
        "Mean band width": "4.80 pp",
        "Outside band": "12",
        "Evaluated sessions": "60",
    }
    assert payload["chart"]["series"][0]["values"][0] == -2.4
    assert payload["chart"]["series"][1]["values"][0] == -3.0
    assert payload["chart"]["series"][2]["values"][0] == 2.4
    assert payload["chart"]["labels"][0] == analysis.display_date(research_frame(closes)["Date"].iloc[61])


def test_calibration_does_not_include_scored_return_or_future_closes():
    closes = 100 * np.exp(np.linspace(0, 0.5, 180) + np.sin(np.arange(180) / 11) * 0.08)
    lower, upper, observed = analysis.prequential_bands(closes)
    changed = closes.copy()
    changed[100:] *= 1.4
    changed_lower, changed_upper, changed_observed = analysis.prequential_bands(changed)
    scored = 100 - analysis.CALIBRATION_WINDOW - 1
    assert lower[:scored + 1] == pytest.approx(changed_lower[:scored + 1])
    assert upper[:scored + 1] == pytest.approx(changed_upper[:scored + 1])
    assert observed[:scored] == pytest.approx(changed_observed[:scored])
    assert observed[scored] != pytest.approx(changed_observed[scored])
    truncated = analysis.prequential_bands(closes[:101])
    assert truncated[0] == pytest.approx(lower[:scored + 1])
    assert truncated[1] == pytest.approx(upper[:scored + 1])


def test_calibration_flat_history_has_inclusive_zero_width_bands():
    payload = analysis.calibration_lab(research_frame([100.0] * 120))
    assert metric_values(payload) == {
        "Observed coverage": "100.0%",
        "Mean band width": "0.00 pp",
        "Outside band": "0",
        "Evaluated sessions": "59",
    }
    assert all(row[-1] == "Inside band" for row in payload["rows"]["values"])
    assert all(series["values"] == [0.0] * 59 for series in payload["chart"]["series"])


def test_calibration_chart_and_table_remain_bounded():
    payload = analysis.calibration_lab(research_frame(np.linspace(100.0, 200.0, 650)))
    assert metric_values(payload)["Evaluated sessions"] == "589"
    assert len(payload["chart"]["labels"]) == 252
    assert len(payload["rows"]["values"]) == 12
    assert all(len(series["values"]) == 252 for series in payload["chart"]["series"])
