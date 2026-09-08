"""DCA daily-input and finite-arithmetic boundaries. Code version: v1.0.0."""

from __future__ import annotations

import pandas as pd
import pytest

from app.services.dca import simulate_recurring_investment
from tests.factories.market import close_frame_for_dates


def simulate(frame, **options):
    return simulate_recurring_investment(
        "QQQ",
        frame,
        **{
            "amount_per_period": 100.0,
            "frequency": "weekly",
            "weekday": 0,
            "month_day": 15,
            **options,
        },
    )


@pytest.mark.parametrize("second_date", ["2026-01-05", "2026-01-05 16:00:00"])
def test_duplicate_calendar_bars_cannot_repeat_a_planned_contribution(second_date):
    frame = close_frame_for_dates(["2026-01-05", "2026-01-12"], [100.0, 110.0])
    duplicate = frame.iloc[[0]].copy()
    duplicate["Date"] = pd.Timestamp(second_date)
    frame = pd.concat([frame, duplicate], ignore_index=True)
    original = frame.copy(deep=True)
    with pytest.raises(ValueError, match="duplicate calendar dates"):
        simulate(frame)
    pd.testing.assert_frame_equal(frame, original)


@pytest.mark.parametrize("invalid", ["not-a-date", None, pd.NaT, 42, True])
def test_invalid_daily_dates_are_rejected_before_scheduling(invalid):
    frame = close_frame_for_dates(["2026-01-05", "2026-01-12"], [100.0, 110.0])
    frame["Date"] = frame["Date"].astype(object)
    frame.loc[0, "Date"] = invalid
    with pytest.raises(ValueError, match="valid calendar dates"):
        simulate(frame)


def test_daily_strings_are_normalized_before_sorting_without_changing_results():
    chronological = close_frame_for_dates(["2026-01-05", "2026-02-02"], [100.0, 110.0])
    expected = simulate(chronological)
    unordered = chronological.iloc[::-1].copy()
    unordered["Date"] = ["2026-2-2 16:00:00", "2026-1-5 09:30:00"]
    original = unordered.copy(deep=True)
    assert simulate(unordered) == expected
    pd.testing.assert_frame_equal(unordered, original)


def test_zoned_daily_bars_keep_their_local_trading_calendar_dates():
    frame = close_frame_for_dates(["2026-01-05", "2026-01-12"], [100.0, 110.0])
    expected = simulate(frame)
    frame["Date"] = ["2026-01-05 23:30:00-05:00", "2026-01-12 23:30:00-05:00"]
    assert simulate(frame) == expected


@pytest.mark.parametrize("missing", ["Date", "Close"])
def test_missing_required_market_columns_are_reported_clearly(missing):
    frame = close_frame_for_dates(["2026-01-05", "2026-01-12"], [100.0, 110.0])
    with pytest.raises(ValueError, match="Date and Close columns"):
        simulate(frame.drop(columns=[missing]))


@pytest.mark.parametrize("invalid", [float("nan"), float("inf"), -float("inf"), "invalid", None, True])
def test_nonfinite_or_malformed_contribution_amount_is_rejected(invalid):
    frame = close_frame_for_dates(["2026-01-05", "2026-01-12"], [100.0, 110.0])
    with pytest.raises(ValueError, match="finite contribution amount"):
        simulate(frame, amount_per_period=invalid)


@pytest.mark.parametrize("column", ["Close", "Dividends"])
@pytest.mark.parametrize("invalid", [float("nan"), float("inf"), -float("inf"), -1.0, "invalid", None, True])
def test_invalid_financial_observations_never_reach_output(column, invalid):
    frame = close_frame_for_dates(["2026-01-05", "2026-01-12"], [100.0, 110.0], dividends=[0.0, 1.0])
    frame[column] = frame[column].astype(object)
    frame.loc[1, column] = invalid
    with pytest.raises(ValueError, match=column):
        simulate(frame)


def test_sparse_schedule_keeps_distinct_planned_events_and_zero_close_cash():
    frame = close_frame_for_dates(["2026-01-05", "2026-01-19"], [0.0, 100.0])
    result = simulate(frame)
    assert result["summary"]["planned_capital"] == 300.0
    assert result["summary"]["total_invested"] == 200.0
    assert result["summary"]["contribution_count"] == 3
    assert result["trades"][0]["events"] == 2
    assert result["trades"][0]["cash"] == 100.0
    assert result["summary"]["final_equity"] == 300.0
    # Preserve the existing zero-first-price comparator contract.
    assert result["summary"]["all_in_equity"] == 0.0


@pytest.mark.parametrize(
    "amount,closes",
    [
        (1e308, [100.0, 110.0]),
        (100.0, [1e-308, 1e308]),
        (100.0, [100.0, 1e308]),
        (1.0, [1.0, 1e307]),
    ],
)
def test_finite_inputs_that_overflow_arithmetic_fail_closed(amount, closes):
    frame = close_frame_for_dates(["2026-01-05", "2026-01-12"], closes)
    with pytest.raises(ValueError, match="finite arithmetic"):
        simulate(frame, amount_per_period=amount)


@pytest.mark.parametrize("reinvest", [False, True])
def test_finite_dividends_that_overflow_cash_or_reinvestment_fail_closed(reinvest):
    frame = close_frame_for_dates(
        ["2026-01-05", "2026-01-12"], [100.0, 110.0], dividends=[0.0, 1e200],
    )
    with pytest.raises(ValueError, match="finite arithmetic"):
        simulate(frame, amount_per_period=1e200, reinvest_cash_dividends=reinvest)
