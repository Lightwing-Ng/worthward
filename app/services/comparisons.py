"""
Comparison and return-series logic.

Code version: v0.5.2
"""

from __future__ import annotations

import pandas as pd

from app.core.config import PERIOD_OFFSETS
from app.services.presentation import format_display_date, format_display_datetime, format_period_label
from app.models.schemas import SeriesPayload

_REGULAR_SESSION_OPEN_MINUTE = (9 * 60) + 30
_REGULAR_SESSION_CLOSE_MINUTE = (16 * 60) - 1


def _minute_of_day(timestamp: pd.Timestamp) -> int:
    return (timestamp.hour * 60) + timestamp.minute


def _is_regular_session_timestamp(timestamp: pd.Timestamp) -> bool:
    minute_of_day = _minute_of_day(timestamp)
    return _REGULAR_SESSION_OPEN_MINUTE <= minute_of_day <= _REGULAR_SESSION_CLOSE_MINUTE


def _has_complete_regular_session(dataset: pd.DataFrame) -> bool:
    if dataset.empty:
        return False
    regular_session = dataset[dataset["Date"].map(_is_regular_session_timestamp)]
    if regular_session.empty:
        return False
    regular_minutes = regular_session["Date"].map(_minute_of_day)
    return (
        int(regular_minutes.min()) <= _REGULAR_SESSION_OPEN_MINUTE
        and int(regular_minutes.max()) >= _REGULAR_SESSION_CLOSE_MINUTE
    )


def _complete_intraday_trading_days(dataset: pd.DataFrame) -> set[object]:
    if dataset.empty:
        return set()
    return {
        trading_day
        for trading_day, day_frame in dataset.groupby(dataset["Date"].dt.date)
        if _has_complete_regular_session(day_frame)
    }


def latest_common_complete_intraday_trading_day(
        datasets: list[pd.DataFrame],
        reference_end_date: pd.Timestamp | None = None,
) -> object:
    if not datasets:
        raise ValueError("At least one dataset is required.")

    common_days: set[object] | None = None
    for dataset in datasets:
        bounded_dataset = dataset.copy()
        if reference_end_date is not None:
            bounded_dataset = bounded_dataset[bounded_dataset["Date"] <= pd.Timestamp(reference_end_date)].copy()
        complete_days = _complete_intraday_trading_days(bounded_dataset)
        common_days = complete_days if common_days is None else common_days & complete_days

    if not common_days:
        raise ValueError("The selected tickers do not share a complete intraday trading day.")
    return max(common_days)


def filter_intraday_dataset_to_regular_session(dataset: pd.DataFrame) -> pd.DataFrame:
    regular_session = dataset[dataset["Date"].map(_is_regular_session_timestamp)].copy()
    return regular_session if not regular_session.empty else dataset.copy()


def latest_common_start(datasets: list[pd.DataFrame]) -> pd.Timestamp:
    if not datasets:
        raise ValueError("At least one dataset is required.")
    return max(pd.Timestamp(dataset["Date"].min()) for dataset in datasets)


def align_datasets_on_common_dates(dataset_a: pd.DataFrame, dataset_b: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    aligned = align_many_datasets_on_common_dates([dataset_a, dataset_b])
    return aligned[0], aligned[1]


def align_many_datasets_on_common_dates(datasets: list[pd.DataFrame]) -> list[pd.DataFrame]:
    if not datasets:
        return []
    merged = datasets[0][["Date", "Close"]].rename(columns={"Close": "Close_0"}).copy()
    for index, dataset in enumerate(datasets[1:], start=1):
        merged = pd.merge(
            merged,
            dataset[["Date", "Close"]].rename(columns={"Close": f"Close_{index}"}),
            on="Date",
            how="inner",
        ).sort_values("Date")
    if merged.empty:
        raise ValueError("The selected tickers do not share any common trading dates.")
    return [
        merged[["Date", f"Close_{index}"]].rename(columns={f"Close_{index}": "Close"}).copy()
        for index in range(len(datasets))
    ]


def align_many_intraday_datasets_on_common_dates(datasets: list[pd.DataFrame]) -> list[pd.DataFrame]:
    if not datasets:
        return []
    price_columns = [
        column
        for column in ("Open", "High", "Low", "Close")
        if all(column in dataset.columns for dataset in datasets)
    ]
    if "Close" not in price_columns:
        price_columns.append("Close")
    merged = datasets[0][["Date", *price_columns]].rename(
        columns={column: f"{column}_0" for column in price_columns}
    ).copy()
    for index, dataset in enumerate(datasets[1:], start=1):
        merged = pd.merge(
            merged,
            dataset[["Date", *price_columns]].rename(
                columns={column: f"{column}_{index}" for column in price_columns}
            ),
            on="Date",
            how="inner",
        ).sort_values("Date")
    if merged.empty:
        raise ValueError("The selected tickers do not share any common trading dates.")
    return [
        merged[["Date", *[f"{column}_{index}" for column in price_columns]]].rename(
            columns={f"{column}_{index}": column for column in price_columns}
        ).copy()
        for index in range(len(datasets))
    ]


def build_compare_start_notice(effective_start: pd.Timestamp) -> str:
    return f"Comparison starts from {format_display_date(effective_start)}."


def build_period_shortfall_notice(
        requested_period: str,
        effective_start: pd.Timestamp,
) -> str:
    period_label = format_period_label(requested_period)
    return (
        f"Requested period {period_label} exceeds the shared trading history. "
        f"Using the latest available start date among the selected tickers: "
        f"{format_display_date(effective_start)}."
    )


def resolve_effective_period(
        requested_period: str,
        dataset_a: pd.DataFrame,
        dataset_b: pd.DataFrame,
) -> tuple[str, str | None]:
    return resolve_effective_period_for_datasets(requested_period, [dataset_a, dataset_b])


def resolve_effective_period_for_datasets(
        requested_period: str,
        datasets: list[pd.DataFrame],
) -> tuple[str, str | None]:
    if not datasets:
        raise ValueError("At least one dataset is required.")

    common_start = latest_common_start(datasets)
    common_end = min(dataset["Date"].max() for dataset in datasets)
    available_days = (common_end - common_start).days

    if requested_period == "max":
        earliest_listing = min(pd.Timestamp(dataset["Date"].min()) for dataset in datasets)
        if earliest_listing.normalize() < common_start.normalize():
            return "max", build_compare_start_notice(common_start)
        return "max", None

    requested_start = (common_end - PERIOD_OFFSETS[requested_period]).normalize()
    if requested_start >= common_start.normalize():
        return requested_period, None

    if available_days <= 0:
        raise ValueError("The selected tickers do not have overlapping trading history.")

    return requested_period, build_period_shortfall_notice(
        requested_period,
        common_start,
    )


def slice_dataset_for_period(dataset: pd.DataFrame, period: str, reference_end_date: pd.Timestamp) -> pd.DataFrame:
    bounded_dataset = dataset[dataset["Date"] <= reference_end_date].copy()
    if bounded_dataset.empty:
        return dataset.tail(1).copy()
    if period == "max":
        return bounded_dataset

    if period == "1d":
        last_date = bounded_dataset["Date"].dt.date.max()
        return bounded_dataset[bounded_dataset["Date"].dt.date == last_date].copy()
    if period == "3d":
        unique_dates = sorted(bounded_dataset["Date"].dt.date.unique(), reverse=True)
        target_dates = unique_dates[:3]
        return bounded_dataset[bounded_dataset["Date"].dt.date.isin(target_dates)].copy()

    start_date = (reference_end_date - PERIOD_OFFSETS[period]).normalize()
    sliced = bounded_dataset[bounded_dataset["Date"] >= start_date].copy()
    return sliced if not sliced.empty else bounded_dataset.tail(1).copy()


def slice_datasets_for_compare_period(
        datasets: list[pd.DataFrame],
        period: str,
        reference_end_date: pd.Timestamp,
) -> list[pd.DataFrame]:
    if not datasets:
        raise ValueError("At least one dataset is required.")

    common_end = pd.Timestamp(reference_end_date)
    common_start = latest_common_start(datasets).normalize()

    if period == "max":
        effective_start = common_start
        requested_start = None
    else:
        requested_start = (common_end - PERIOD_OFFSETS[period]).normalize()
        effective_start = max(requested_start, common_start)

    sliced_datasets: list[pd.DataFrame] = []
    for dataset in datasets:
        bounded_dataset = dataset[dataset["Date"] <= common_end].copy()
        if bounded_dataset.empty:
            sliced_datasets.append(dataset.tail(1).copy())
            continue
        trimmed = bounded_dataset[bounded_dataset["Date"] >= effective_start].copy()
        sliced_datasets.append(trimmed if not trimmed.empty else bounded_dataset.tail(1).copy())

    return align_many_datasets_on_common_dates(sliced_datasets)


def slice_intraday_datasets_for_compare_period(
        datasets: list[pd.DataFrame],
        period: str,
        reference_end_date: pd.Timestamp,
) -> list[pd.DataFrame]:
    if not datasets:
        raise ValueError("At least one dataset is required.")

    common_end = pd.Timestamp(reference_end_date)
    sliced_datasets: list[pd.DataFrame] = []
    target_trading_days: list[object] | None = None
    target_one_day: object | None = None
    if period == "1d":
        target_one_day = latest_common_complete_intraday_trading_day(datasets, common_end)

    for dataset in datasets:
        bounded_dataset = dataset[dataset["Date"] <= common_end].copy()
        if bounded_dataset.empty:
            sliced_datasets.append(dataset.tail(1).copy())
            continue
        bounded_dataset = bounded_dataset.sort_values("Date")

        if period == "1d":
            trimmed = bounded_dataset[bounded_dataset["Date"].dt.date == target_one_day].copy()
        else:
            trading_days = sorted(bounded_dataset["Date"].dt.date.unique())
            requested_day_count = 3 if period == "3d" else 5 if period == "1w" else 0
            if requested_day_count <= 0:
                raise ValueError(f"Unsupported intraday comparison period: {period}")
            if target_trading_days is None:
                target_trading_days = trading_days[-requested_day_count:]
            selected_days = set(target_trading_days or trading_days[-requested_day_count:])
            trimmed = bounded_dataset[bounded_dataset["Date"].dt.date.isin(selected_days)].copy()
            trimmed = trimmed[trimmed["Date"].map(_is_regular_session_timestamp)].copy()

        sliced_datasets.append(trimmed if not trimmed.empty else bounded_dataset.tail(1).copy())

    return align_many_intraday_datasets_on_common_dates(sliced_datasets)


def build_series_payload(
        ticker: str,
        dataset: pd.DataFrame,
        color: str | None = None,
        *,
        glow: bool = True,
) -> SeriesPayload:
    has_intraday_timestamps = dataset["Date"].map(
        lambda value: pd.Timestamp(value).hour != 0 or pd.Timestamp(value).minute != 0
    ).any()
    has_ohlc = has_intraday_timestamps and all(column in dataset.columns for column in ("Open", "High", "Low", "Close"))
    baseline_price = float(dataset["Open"].iloc[0]) if has_ohlc else float(dataset["Close"].iloc[0])
    normalized_returns = ((dataset["Close"] / baseline_price) - 1.0) * 100.0
    candlestick_returns = None
    if has_ohlc:
        candlestick_returns = [
            {
                "x": index,
                "o": round(((float(open_value) / baseline_price) - 1.0) * 100.0, 4),
                "h": round(((float(high_value) / baseline_price) - 1.0) * 100.0, 4),
                "l": round(((float(low_value) / baseline_price) - 1.0) * 100.0, 4),
                "c": round(((float(close_value) / baseline_price) - 1.0) * 100.0, 4),
            }
            for index, (open_value, high_value, low_value, close_value) in enumerate(zip(
                dataset["Open"],
                dataset["High"],
                dataset["Low"],
                dataset["Close"],
            ))
        ]
    return SeriesPayload(
        ticker=ticker.upper(),
        dates=dataset["Date"].map(
            lambda value: format_display_datetime(value) if has_intraday_timestamps else format_display_date(value)
        ).tolist(),
        raw_dates=dataset["Date"].map(
            lambda value: pd.Timestamp(value).strftime("%Y-%m-%d %H:%M")
        ).tolist(),
        normalized_returns=[round(value, 4) for value in normalized_returns.tolist()],
        color=color,
        glow=glow,
        candlestick_returns=candlestick_returns,
    )
