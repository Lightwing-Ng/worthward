"""
Causal signal bridges between strategy-model and execution intervals.

Code version: v0.2.0
"""

from __future__ import annotations

import pandas as pd

from .base import StrategySignalResult


DAILY_CLOSE_TO_NEXT_SESSION_OPEN = "daily-close-to-next-session-open"


def _naive_wall_times(values: pd.Series, *, label: str) -> pd.Series:
    """Normalize one timestamp series while preserving market-local wall time."""
    timestamps = pd.to_datetime(values, errors="coerce")
    if timestamps.isna().any():
        raise ValueError(f"{label} contains an invalid timestamp.")
    if timestamps.dt.tz is not None:
        timestamps = timestamps.dt.tz_localize(None)
    return timestamps


def bridge_daily_signals_to_intraday(
        signal_result: StrategySignalResult,
        intraday_dataset: pd.DataFrame,
        intraday_trading_dates: pd.Series,
) -> StrategySignalResult:
    """Place each daily close signal on that exchange session's final bar."""
    daily_frame = signal_result.frame.copy()
    execution_frame = intraday_dataset.copy().reset_index(drop=True)
    buy_column = signal_result.buy_signal_column
    sell_column = signal_result.sell_signal_column

    if daily_frame.empty or execution_frame.empty:
        raise ValueError("The daily-to-intraday signal bridge requires non-empty datasets.")
    normalized_execution_mode = str(
        signal_result.required_execution_mode or "next_open"
    ).strip().lower()
    if normalized_execution_mode != "next_open":
        raise ValueError(
            "The daily-close-to-next-session-open bridge requires next_open execution."
        )
    for label, frame in (("Daily model data", daily_frame), ("Intraday execution data", execution_frame)):
        if "Date" not in frame.columns:
            raise ValueError(f"{label} is missing Date.")
    for column in (buy_column, sell_column):
        if column not in daily_frame.columns:
            raise ValueError(f"Daily model data is missing signal column {column}.")

    daily_frame["Date"] = _naive_wall_times(
        daily_frame["Date"],
        label="Daily model data",
    ).dt.normalize()
    execution_frame["Date"] = _naive_wall_times(
        execution_frame["Date"],
        label="Intraday execution data",
    )
    raw_execution_days = pd.Series(intraday_trading_dates)
    if not raw_execution_days.index.equals(intraday_dataset.index):
        raise ValueError("Intraday execution trading dates are misaligned.")
    execution_days = pd.to_datetime(
        raw_execution_days.reset_index(drop=True),
        errors="coerce",
    )
    if len(execution_days) != len(execution_frame) or execution_days.isna().any():
        raise ValueError("Intraday execution trading dates are invalid or misaligned.")
    execution_days = execution_days.dt.normalize()
    if not execution_days.is_monotonic_increasing:
        raise ValueError("Intraday execution trading dates must be ordered.")
    if daily_frame["Date"].duplicated().any():
        raise ValueError("Daily model data contains duplicate trading dates.")
    if not daily_frame["Date"].is_monotonic_increasing:
        raise ValueError("Daily model data must be ordered by trading date.")
    if execution_frame["Date"].duplicated().any():
        raise ValueError("Intraday execution data contains duplicate timestamps.")
    if not execution_frame["Date"].is_monotonic_increasing:
        raise ValueError("Intraday execution data must be ordered by timestamp.")

    final_index_by_day = (
        pd.Series(execution_frame.index, index=execution_days)
        .groupby(level=0, sort=False)
        .last()
        .to_dict()
    )
    execution_frame[buy_column] = False
    execution_frame[sell_column] = False

    daily_intents = daily_frame.loc[
        daily_frame[buy_column].fillna(False).astype(bool)
        | daily_frame[sell_column].fillna(False).astype(bool)
    ]
    if (
        daily_intents[buy_column].fillna(False).astype(bool)
        & daily_intents[sell_column].fillna(False).astype(bool)
    ).any():
        raise ValueError("Daily model data contains conflicting buy and sell signals.")
    missing_signal_days = [
        timestamp
        for timestamp in daily_intents["Date"].tolist()
        if timestamp not in final_index_by_day
    ]
    if missing_signal_days:
        raise ValueError(
            "Intraday execution data is missing a daily signal session: "
            f"{pd.Timestamp(missing_signal_days[0]).date().isoformat()}."
        )

    for row in daily_intents.itertuples(index=False):
        row_values = row._asdict()
        target_index = int(final_index_by_day[pd.Timestamp(row_values["Date"])])
        execution_frame.at[target_index, buy_column] = bool(row_values[buy_column])
        execution_frame.at[target_index, sell_column] = bool(row_values[sell_column])

    metadata = dict(signal_result.metadata)
    metadata.update(
        {
            "model_interval": "1d",
            "execution_interval": "1m",
            "signal_bridge": DAILY_CLOSE_TO_NEXT_SESSION_OPEN,
        }
    )
    return StrategySignalResult(
        frame=execution_frame,
        buy_signal_column=buy_column,
        sell_signal_column=sell_column,
        execution_profile=signal_result.execution_profile,
        metadata=metadata,
        presentation={},
        required_execution_mode="next_open",
    )
