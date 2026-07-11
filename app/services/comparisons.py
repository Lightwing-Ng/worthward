"""
Comparison and return-series logic.

Code version: v0.7.0
"""

from __future__ import annotations

import pandas as pd

from app.core.config import PERIOD_OFFSETS
from app.infrastructure.storage import normalize_ticker
from app.services.presentation import format_display_date, format_display_datetime, format_period_label
from app.models.schemas import SeriesPayload

_REGULAR_SESSION_OPEN_MINUTE = (9 * 60) + 30
_REGULAR_SESSION_CLOSE_MINUTE = (16 * 60) - 1
_HONG_KONG_TIMEZONE = "Asia/Hong_Kong"
_NEW_YORK_TIMEZONE = "America/New_York"
_SOUTH_KOREA_TIMEZONE = "Asia/Seoul"
_JAPAN_TIMEZONE = "Asia/Tokyo"
_CHINA_TIMEZONE = "Asia/Shanghai"
_UNITED_KINGDOM_TIMEZONE = "Europe/London"


def _market_for_ticker(ticker: str | None) -> str:
    normalized = normalize_ticker(str(ticker or ""))
    if normalized.endswith(".HK"):
        return "HK"
    if normalized.endswith((".KS", ".KQ")):
        return "KR"
    if normalized.endswith((".T", ".JP")):
        return "JP"
    if normalized.endswith((".SH", ".SS", ".SZ")):
        return "CN"
    if normalized.endswith((".SG", ".SI")):
        return "SG"
    if normalized.endswith(".L"):
        return "UK"
    if normalized.endswith(".AX"):
        return "AU"
    if normalized.endswith((".TO", ".V", ".NE", ".CN", ".CA")):
        return "CA"
    if normalized.endswith((".PA", ".AS", ".BR", ".MI", ".MC", ".DE", ".F", ".HM", ".BE", ".DU", ".MU", ".HA", ".SW", ".VI", ".ST", ".CO", ".OL", ".IR", ".IS")):
        return "EU"
    if normalized.endswith(".HE"):
        return "FI"
    if normalized.endswith((".NS", ".BO")):
        return "IN"
    if normalized.endswith((".TW", ".TWO")):
        return "TW"
    if normalized.endswith(".KL"):
        return "MY"
    if normalized.endswith(".BK"):
        return "TH"
    if normalized.endswith(".JK"):
        return "ID"
    if normalized.endswith(".NZ"):
        return "NZ"
    if normalized.endswith(".SA"):
        return "BR"
    if normalized.endswith((".BA", ".MX")):
        return "LATAM"
    if normalized.endswith(".TA"):
        return "IL"
    if normalized.endswith((".SR", ".SE")):
        return "SA"
    if normalized.endswith(".JO"):
        return "ZA"
    if normalized.endswith(".QA"):
        return "QA"
    return "US"


def _minute_of_day(timestamp: pd.Timestamp) -> int:
    return (timestamp.hour * 60) + timestamp.minute


def _is_regular_session_timestamp(timestamp: pd.Timestamp) -> bool:
    minute_of_day = _minute_of_day(timestamp)
    return _REGULAR_SESSION_OPEN_MINUTE <= minute_of_day <= _REGULAR_SESSION_CLOSE_MINUTE


def _timestamp_as_new_york(timestamp: object) -> pd.Timestamp:
    parsed_timestamp = pd.Timestamp(timestamp)
    if parsed_timestamp.tzinfo is None:
        return parsed_timestamp.tz_localize(_NEW_YORK_TIMEZONE)
    return parsed_timestamp.tz_convert(_NEW_YORK_TIMEZONE)


def _timestamp_as_market_local(timestamp: object, ticker: str | None = None) -> pd.Timestamp:
    new_york_timestamp = _timestamp_as_new_york(timestamp)
    return new_york_timestamp.tz_convert(_market_timezone_for_ticker(ticker))


def _market_timezone_for_ticker(ticker: str | None = None) -> str:
    market = _market_for_ticker(ticker)
    if market == "HK":
        return _HONG_KONG_TIMEZONE
    if market == "KR":
        return _SOUTH_KOREA_TIMEZONE
    if market == "JP":
        return _JAPAN_TIMEZONE
    if market == "CN":
        return _CHINA_TIMEZONE
    if market == "UK":
        return _UNITED_KINGDOM_TIMEZONE
    if market == "SG":
        return "Asia/Singapore"
    if market == "AU":
        return "Australia/Sydney"
    if market == "CA":
        return "America/Toronto"
    if market == "EU":
        return "Europe/Paris"
    if market == "FI":
        return "Europe/Helsinki"
    if market == "IN":
        return "Asia/Kolkata"
    if market == "TW":
        return "Asia/Taipei"
    if market == "MY":
        return "Asia/Kuala_Lumpur"
    if market == "TH":
        return "Asia/Bangkok"
    if market == "ID":
        return "Asia/Jakarta"
    if market == "NZ":
        return "Pacific/Auckland"
    if market == "BR":
        return "America/Sao_Paulo"
    if market == "LATAM":
        return "America/Mexico_City"
    if market == "IL":
        return "Asia/Jerusalem"
    if market == "SA":
        return "Asia/Riyadh"
    if market == "ZA":
        return "Africa/Johannesburg"
    if market == "QA":
        return "Asia/Qatar"
    return _NEW_YORK_TIMEZONE


def _is_market_session_timestamp(timestamp: pd.Timestamp, ticker: str | None = None) -> bool:
    market = _market_for_ticker(ticker)
    localized = _timestamp_as_market_local(timestamp, ticker)
    if localized.weekday() >= 5:
        return False
    minute_of_day = _minute_of_day(localized)
    if market == "HK":
        return ((9 * 60) + 30 <= minute_of_day < 12 * 60) or (13 * 60 <= minute_of_day < 16 * 60)
    if market == "CN":
        return ((9 * 60) + 30 <= minute_of_day < (11 * 60) + 30) or (13 * 60 <= minute_of_day < 15 * 60)
    if market == "KR":
        return 9 * 60 <= minute_of_day <= (15 * 60) + 30
    if market == "JP":
        return (9 * 60 <= minute_of_day < (11 * 60) + 30) or ((12 * 60) + 30 <= minute_of_day <= (15 * 60) + 30)
    if market == "UK":
        return 8 * 60 <= minute_of_day < (16 * 60) + 30
    return any(start_minute <= minute_of_day <= end_minute for start_minute, end_minute in _market_session_segments(ticker))


def _market_session_close_minute(ticker: str | None = None) -> int:
    market = _market_for_ticker(ticker)
    if market == "HK":
        return (16 * 60) - 1
    if market == "CN":
        return (15 * 60) - 1
    if market in {"KR", "JP"}:
        return (15 * 60) + 30
    if market == "UK":
        return (16 * 60) + 29
    if market in {"AU", "CA", "ID"}:
        return (16 * 60) - 1
    if market == "SG":
        return (17 * 60) - 1
    if market in {"BR", "ZA"}:
        return (17 * 60) - 1
    if market in {"EU", "FI", "IL"}:
        return (17 * 60) + 30
    if market == "IN":
        return (15 * 60) + 30
    if market == "TW":
        return (13 * 60) + 30
    if market == "MY":
        return (17 * 60) - 1
    if market == "TH":
        return (16 * 60) + 30
    if market == "NZ":
        return (16 * 60) + 44
    if market == "LATAM":
        return (15 * 60) - 1
    if market == "SA":
        return (15 * 60) - 1
    if market == "QA":
        return (13 * 60) + 9
    return _REGULAR_SESSION_CLOSE_MINUTE


def _market_session_open_minute(ticker: str | None = None) -> int:
    market = _market_for_ticker(ticker)
    if market in {"HK", "CN"}:
        return (9 * 60) + 30
    if market in {"KR", "JP"}:
        return 9 * 60
    if market == "UK":
        return 8 * 60
    if market in {"AU", "MY", "EU", "FI", "ID", "SG", "ZA"}:
        return 9 * 60
    if market == "CA":
        return (9 * 60) + 30
    if market == "IN":
        return (9 * 60) + 15
    if market == "TW":
        return 9 * 60
    if market == "TH":
        return 10 * 60
    if market == "NZ":
        return 10 * 60
    if market == "BR":
        return 10 * 60
    if market == "LATAM":
        return (8 * 60) + 30
    if market == "IL":
        return (9 * 60) + 30
    if market == "SA":
        return 10 * 60
    if market == "QA":
        return (9 * 60) + 30
    return _REGULAR_SESSION_OPEN_MINUTE


def _market_session_segments(ticker: str | None = None) -> list[tuple[int, int]]:
    market = _market_for_ticker(ticker)
    if market == "HK":
        return [((9 * 60) + 30, (12 * 60) - 1), (13 * 60, (16 * 60) - 1)]
    if market == "CN":
        return [((9 * 60) + 30, (11 * 60) + 29), (13 * 60, (15 * 60) - 1)]
    if market == "JP":
        return [(9 * 60, (11 * 60) + 29), ((12 * 60) + 30, (15 * 60) + 30)]
    if market == "SG":
        return [(9 * 60, (12 * 60) - 1), (13 * 60, (17 * 60) - 1)]
    return [(_market_session_open_minute(ticker), _market_session_close_minute(ticker))]


def _timestamp_to_compare_axis(timestamp: object, ticker: str | None = None) -> pd.Timestamp:
    del ticker
    return _timestamp_as_new_york(timestamp).tz_localize(None)


def prepare_intraday_dataset_for_compare(
        dataset: pd.DataFrame,
        ticker: str | None = None,
        *,
        regular_session_only: bool = False,
) -> pd.DataFrame:
    if dataset.empty or "Date" not in dataset.columns:
        return dataset.copy()
    prepared = dataset.copy()
    prepared["Date"] = prepared["Date"].map(lambda value: _timestamp_to_compare_axis(value, ticker))
    prepared = prepared.dropna(subset=["Date"]).drop_duplicates(subset=["Date"], keep="last").sort_values("Date")
    if regular_session_only or _market_for_ticker(ticker) in {"HK", "KR", "JP", "CN", "UK", "SG", "TW"}:
        prepared = prepared[prepared["Date"].map(lambda value: _is_market_session_timestamp(pd.Timestamp(value), ticker))].copy()
    return prepared.reset_index(drop=True)


def _has_complete_regular_session(dataset: pd.DataFrame, ticker: str | None = None) -> bool:
    if dataset.empty:
        return False
    regular_session = dataset[dataset["Date"].map(lambda value: _is_market_session_timestamp(pd.Timestamp(value), ticker))]
    if regular_session.empty:
        return False
    regular_minutes = regular_session["Date"].map(
        lambda value: _minute_of_day(_timestamp_as_market_local(value, ticker))
    )
    return (
        int(regular_minutes.min()) <= _market_session_open_minute(ticker)
        and int(regular_minutes.max()) >= _market_session_close_minute(ticker)
    )


def _complete_intraday_trading_days(dataset: pd.DataFrame, ticker: str | None = None) -> set[object]:
    if dataset.empty:
        return set()
    return {
        new_york_day
        for new_york_day, day_frame in dataset.groupby(dataset["Date"].dt.date)
        if _has_complete_regular_session(day_frame, ticker)
    }


def _complete_market_local_trading_days(dataset: pd.DataFrame, ticker: str | None = None) -> set[object]:
    if dataset.empty:
        return set()
    local_dates = dataset["Date"].map(lambda value: _timestamp_as_market_local(value, ticker).date())
    return {
        trading_day
        for trading_day in sorted(local_dates.dropna().unique())
        if _has_complete_regular_session(dataset.loc[local_dates == trading_day], ticker)
    }


def _slice_dataset_to_market_local_day(dataset: pd.DataFrame, ticker: str | None, trading_day: object) -> pd.DataFrame:
    local_dates = dataset["Date"].map(lambda value: _timestamp_as_market_local(value, ticker).date())
    return dataset.loc[local_dates == trading_day].copy()


def _pad_dataset_to_market_session_close(dataset: pd.DataFrame, ticker: str | None = None) -> pd.DataFrame:
    if dataset.empty or _market_for_ticker(ticker) == "US":
        return dataset
    regular_session = dataset[dataset["Date"].map(lambda value: _is_market_session_timestamp(pd.Timestamp(value), ticker))].copy()
    if regular_session.empty:
        return dataset

    regular_session = regular_session.sort_values("Date")
    last_row = regular_session.iloc[-1]
    last_timestamp = pd.Timestamp(last_row["Date"])

    local_last = _timestamp_as_market_local(last_timestamp, ticker)
    close_minute = _market_session_close_minute(ticker)
    close_local = pd.Timestamp(
        year=int(local_last.year),
        month=int(local_last.month),
        day=int(local_last.day),
        hour=close_minute // 60,
        minute=close_minute % 60,
        tz=_market_timezone_for_ticker(ticker),
    )
    close_timestamp = close_local.tz_convert(_NEW_YORK_TIMEZONE).tz_localize(None)
    missing_minutes = int((close_timestamp - last_timestamp) / pd.Timedelta(minutes=1))
    if missing_minutes <= 0 or missing_minutes > 90:
        return dataset

    missing_dates = pd.date_range(
        last_timestamp + pd.Timedelta(minutes=1),
        close_timestamp,
        freq="min",
    )
    if missing_dates.empty:
        return dataset

    padding_rows: list[dict[str, object]] = []
    for missing_date in missing_dates:
        row: dict[str, object] = {column: pd.NA for column in dataset.columns}
        row["Date"] = missing_date
        padding_rows.append(row)

    padded = pd.concat([dataset, pd.DataFrame(padding_rows)], ignore_index=True)
    return padded.drop_duplicates(subset=["Date"], keep="first").sort_values("Date").reset_index(drop=True)


def _fill_intraday_market_session_gaps(dataset: pd.DataFrame, ticker: str | None = None) -> pd.DataFrame:
    if dataset.empty or "Date" not in dataset.columns:
        return dataset

    prepared = dataset.drop_duplicates(subset=["Date"], keep="last").sort_values("Date").copy()
    if "Synthetic" not in prepared.columns:
        prepared["Synthetic"] = False
    local_dates = prepared["Date"].map(lambda value: _timestamp_as_market_local(value, ticker).date())
    filled_segments: list[pd.DataFrame] = []

    for trading_day in sorted(local_dates.dropna().unique()):
        for start_minute, end_minute in _market_session_segments(ticker):
            session_start_local = pd.Timestamp(
                year=int(trading_day.year),
                month=int(trading_day.month),
                day=int(trading_day.day),
                hour=start_minute // 60,
                minute=start_minute % 60,
                tz=_market_timezone_for_ticker(ticker),
            )
            session_end_local = pd.Timestamp(
                year=int(trading_day.year),
                month=int(trading_day.month),
                day=int(trading_day.day),
                hour=end_minute // 60,
                minute=end_minute % 60,
                tz=_market_timezone_for_ticker(ticker),
            )
            session_start = session_start_local.tz_convert(_NEW_YORK_TIMEZONE).tz_localize(None)
            session_end = session_end_local.tz_convert(_NEW_YORK_TIMEZONE).tz_localize(None)
            segment = prepared[(prepared["Date"] >= session_start) & (prepared["Date"] <= session_end)].copy()
            if segment.empty:
                continue

            fill_start = max(pd.Timestamp(segment["Date"].min()), session_start)
            fill_end = min(pd.Timestamp(segment["Date"].max()), session_end)
            full_index = pd.date_range(fill_start, fill_end, freq="min")
            if full_index.empty:
                continue

            indexed = segment.set_index("Date").sort_index().reindex(full_index)
            if "Synthetic" in indexed.columns:
                indexed["Synthetic"] = indexed["Synthetic"].astype("boolean").fillna(True).astype(bool)
            previous_close = pd.to_numeric(indexed["Close"], errors="coerce").ffill()
            for column in ("Open", "High", "Low", "Close", "Adj Close"):
                if column in indexed.columns:
                    indexed[column] = pd.to_numeric(indexed[column], errors="coerce").fillna(previous_close)
            for column in ("Volume", "Turnover"):
                if column in indexed.columns:
                    indexed[column] = pd.to_numeric(indexed[column], errors="coerce").fillna(0)
            filled_segments.append(indexed.reset_index().rename(columns={"index": "Date"}))

    if not filled_segments:
        return prepared.reset_index(drop=True)

    filled = pd.concat(filled_segments, ignore_index=True)
    outside_segments = prepared.loc[~prepared["Date"].isin(filled["Date"])].copy()
    return (
        pd.concat([outside_segments, filled], ignore_index=True)
        .drop_duplicates(subset=["Date"], keep="last")
        .sort_values("Date")
        .reset_index(drop=True)
    )


def fill_intraday_market_session_gaps(dataset: pd.DataFrame, ticker: str | None = None) -> pd.DataFrame:
    return _fill_intraday_market_session_gaps(dataset, ticker)


def complete_market_local_trading_days(dataset: pd.DataFrame, ticker: str | None = None) -> set[object]:
    return _complete_market_local_trading_days(dataset, ticker)


def _align_intraday_datasets_on_union_dates(datasets: list[pd.DataFrame]) -> list[pd.DataFrame]:
    if not datasets:
        return []
    union_dates = sorted({
        pd.Timestamp(value)
        for dataset in datasets
        for value in dataset["Date"].tolist()
    })
    if not union_dates:
        raise ValueError("The selected tickers do not have intraday comparison data.")

    aligned_datasets: list[pd.DataFrame] = []
    for dataset in datasets:
        indexed = dataset.drop_duplicates(subset=["Date"], keep="last").set_index("Date").sort_index()
        reindexed = indexed.reindex(union_dates).reset_index().rename(columns={"index": "Date"})
        aligned_datasets.append(reindexed)
    return aligned_datasets


def _align_us_intraday_datasets_on_full_sessions(
        datasets: list[pd.DataFrame],
        trading_days: list[object] | None = None,
) -> list[pd.DataFrame]:
    if not datasets:
        return []
    selected_days = sorted({
        pd.Timestamp(day).date()
        for day in (
            trading_days
            if trading_days is not None
            else [value for dataset in datasets for value in dataset["Date"].dt.date.tolist()]
        )
    })
    if not selected_days:
        raise ValueError("The selected tickers do not have intraday comparison data.")
    full_axis = pd.DatetimeIndex([
        timestamp
        for day in selected_days
        for timestamp in pd.date_range(
            f"{day.isoformat()} 09:30",
            f"{day.isoformat()} 15:59",
            freq="1min",
        )
    ], name="Date")
    aligned_datasets: list[pd.DataFrame] = []
    for dataset in datasets:
        indexed = dataset.drop_duplicates(subset=["Date"], keep="last").set_index("Date").sort_index()
        aligned_datasets.append(indexed.reindex(full_axis).reset_index())
    return aligned_datasets


def latest_common_complete_intraday_trading_day(
        datasets: list[pd.DataFrame],
        reference_end_date: pd.Timestamp | None = None,
        tickers: list[str] | None = None,
) -> object:
    if not datasets:
        raise ValueError("At least one dataset is required.")

    common_days: set[object] | None = None
    common_observed_days: set[object] | None = None
    ticker_values = tickers or [None] * len(datasets)
    for index, dataset in enumerate(datasets):
        bounded_dataset = dataset.copy()
        if reference_end_date is not None:
            bounded_dataset = bounded_dataset[bounded_dataset["Date"] <= pd.Timestamp(reference_end_date)].copy()
        ticker = ticker_values[index] if index < len(ticker_values) else None
        complete_days = _complete_intraday_trading_days(bounded_dataset, ticker)
        common_days = complete_days if common_days is None else common_days & complete_days
        observed_days = {
            _timestamp_as_market_local(value, ticker).date()
            for value in bounded_dataset["Date"].tolist()
        }
        common_observed_days = (
            observed_days
            if common_observed_days is None
            else common_observed_days & observed_days
        )

    if common_days:
        return max(common_days)
    if common_observed_days:
        # A newly listed security can legitimately start after the opening
        # bell, so its debut can never satisfy the normal full-session test.
        # Use the latest shared observed day and preserve the pre-listing
        # portion as empty data rather than rejecting the comparison.
        return max(common_observed_days)
    raise ValueError("The selected tickers do not share an intraday trading day.")


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


def align_many_datasets_on_union_dates(datasets: list[pd.DataFrame]) -> list[pd.DataFrame]:
    if not datasets:
        return []
    union_dates = sorted({
        pd.Timestamp(value)
        for dataset in datasets
        for value in dataset["Date"].tolist()
    })
    if not union_dates:
        raise ValueError("The selected tickers do not have comparison data.")
    return [
        dataset[["Date", "Close"]]
        .drop_duplicates(subset=["Date"], keep="last")
        .set_index("Date")
        .reindex(union_dates)
        .rename_axis("Date")
        .reset_index()
        for dataset in datasets
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


def align_intraday_datasets_for_compare(
        datasets: list[pd.DataFrame],
        tickers: list[str] | None = None,
) -> list[pd.DataFrame]:
    ticker_values = tickers or [None] * len(datasets)
    selected_markets = {
        _market_for_ticker(ticker_values[index] if index < len(ticker_values) else None)
        for index in range(len(datasets))
    }
    if selected_markets == {"US"}:
        return _align_us_intraday_datasets_on_full_sessions(datasets)
    if len(selected_markets) <= 1:
        return align_many_intraday_datasets_on_common_dates(datasets)
    return _align_intraday_datasets_on_union_dates(datasets)


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

    earliest_start = min(pd.Timestamp(dataset["Date"].min()) for dataset in datasets).normalize()
    if earliest_start <= requested_start:
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
    if period == "max":
        effective_start = latest_common_start(datasets).normalize()
    else:
        effective_start = (common_end - PERIOD_OFFSETS[period]).normalize()

    sliced_datasets: list[pd.DataFrame] = []
    for dataset in datasets:
        bounded_dataset = dataset[dataset["Date"] <= common_end].copy()
        if bounded_dataset.empty:
            sliced_datasets.append(dataset.tail(1).copy())
            continue
        trimmed = bounded_dataset[bounded_dataset["Date"] >= effective_start].copy()
        sliced_datasets.append(trimmed if not trimmed.empty else bounded_dataset.tail(1).copy())

    if period == "max":
        return align_many_datasets_on_common_dates(sliced_datasets)
    return align_many_datasets_on_union_dates(sliced_datasets)


def slice_intraday_datasets_for_compare_period(
        datasets: list[pd.DataFrame],
        period: str,
        reference_end_date: pd.Timestamp,
        tickers: list[str] | None = None,
) -> list[pd.DataFrame]:
    if not datasets:
        raise ValueError("At least one dataset is required.")

    ticker_values = tickers or [None] * len(datasets)
    prepared_datasets = [
        prepare_intraday_dataset_for_compare(
            dataset,
            ticker_values[index] if index < len(ticker_values) else None,
        )
        for index, dataset in enumerate(datasets)
    ]
    all_tickers_are_us = all(_market_for_ticker(ticker) == "US" for ticker in ticker_values[:len(datasets)])
    common_end = pd.Timestamp(reference_end_date) if all_tickers_are_us else max(
        dataset["Date"].max()
        for dataset in prepared_datasets
        if not dataset.empty
    )
    sliced_datasets: list[pd.DataFrame] = []
    target_trading_days: list[object] | None = None
    target_one_day: object | None = None
    common_market_local_days: set[object] | None = None
    if not all_tickers_are_us:
        for index, dataset in enumerate(prepared_datasets):
            ticker = ticker_values[index] if index < len(ticker_values) else None
            market_local_days = set(
                dataset["Date"].map(lambda value: _timestamp_as_market_local(value, ticker).date())
            )
            common_market_local_days = (
                market_local_days
                if common_market_local_days is None
                else common_market_local_days & market_local_days
            )
        if not common_market_local_days:
            raise ValueError("The selected tickers do not share a market-local trading date.")
    if period == "1d":
        if all_tickers_are_us:
            target_one_day = latest_common_complete_intraday_trading_day(prepared_datasets, common_end, ticker_values)
        else:
            common_complete_days: set[object] | None = None
            for index, dataset in enumerate(prepared_datasets):
                ticker = ticker_values[index] if index < len(ticker_values) else None
                complete_days = _complete_market_local_trading_days(dataset, ticker)
                common_complete_days = (
                    complete_days
                    if common_complete_days is None
                    else common_complete_days & complete_days
                )
            target_one_day = max(common_complete_days or common_market_local_days or set())
    elif not all_tickers_are_us:
        requested_day_count = 3 if period == "3d" else 5 if period == "1w" else 0
        if requested_day_count <= 0:
            raise ValueError(f"Unsupported intraday comparison period: {period}")
        target_trading_days = sorted(common_market_local_days or set())[-requested_day_count:]

    for index, dataset in enumerate(prepared_datasets):
        ticker = ticker_values[index] if index < len(ticker_values) else None
        bounded_dataset = dataset[dataset["Date"] <= common_end].copy()
        if bounded_dataset.empty:
            sliced_datasets.append(dataset.tail(1).copy())
            continue
        bounded_dataset = bounded_dataset.sort_values("Date")

        if period == "1d":
            if all_tickers_are_us:
                trimmed = bounded_dataset[bounded_dataset["Date"].dt.date == target_one_day].copy()
            else:
                trimmed = _slice_dataset_to_market_local_day(bounded_dataset, ticker, target_one_day)
                trimmed = _pad_dataset_to_market_session_close(trimmed, ticker)
        else:
            requested_day_count = 3 if period == "3d" else 5 if period == "1w" else 0
            if requested_day_count <= 0:
                raise ValueError(f"Unsupported intraday comparison period: {period}")
            if all_tickers_are_us and target_trading_days is None:
                trading_days = sorted(bounded_dataset["Date"].dt.date.unique())
                target_trading_days = trading_days[-requested_day_count:]
            selected_days = set(target_trading_days or [])
            if all_tickers_are_us:
                selected_mask = bounded_dataset["Date"].dt.date.isin(selected_days)
            else:
                selected_mask = bounded_dataset["Date"].map(
                    lambda value: _timestamp_as_market_local(value, ticker).date() in selected_days
                )
            trimmed = bounded_dataset[selected_mask].copy()
            trimmed = trimmed[trimmed["Date"].map(lambda value: _is_market_session_timestamp(pd.Timestamp(value), ticker))].copy()
            trimmed = _fill_intraday_market_session_gaps(trimmed, ticker)

        sliced_datasets.append(trimmed if not trimmed.empty else bounded_dataset.tail(1).copy())

    if all_tickers_are_us:
        # A newly listed security can begin trading after the opening bell and
        # has no legitimate bars before its first quote. Preserve the full
        # comparison axis and leave those pre-listing points empty instead of
        # collapsing every established constituent to the ADR's first minute.
        if period != "1d":
            return _align_us_intraday_datasets_on_full_sessions(
                sliced_datasets,
                target_trading_days,
            )
        first_dates = [pd.Timestamp(dataset["Date"].min()) for dataset in sliced_datasets if not dataset.empty]
        if first_dates and len(set(first_dates)) > 1:
            return _align_intraday_datasets_on_union_dates(sliced_datasets)
        return align_many_intraday_datasets_on_common_dates(sliced_datasets)
    return _align_intraday_datasets_on_union_dates(sliced_datasets)


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
    baseline_source = dataset["Open"] if has_ohlc else dataset["Close"]
    baseline_values = pd.to_numeric(baseline_source, errors="coerce").dropna()
    if baseline_values.empty:
        raise ValueError(f"The selected range does not contain usable price data for {ticker}.")
    baseline_price = float(baseline_values.iloc[0])
    close_values = pd.to_numeric(dataset["Close"], errors="coerce")
    normalized_returns = ((close_values / baseline_price) - 1.0) * 100.0
    candlestick_returns = None
    candlestick_prices = None
    if has_ohlc:
        candlestick_returns = []
        candlestick_prices = []
        has_volume = "Volume" in dataset.columns
        has_synthetic = "Synthetic" in dataset.columns
        volume_values = dataset["Volume"] if has_volume else [None] * len(dataset)
        synthetic_values = dataset["Synthetic"] if has_synthetic else [False] * len(dataset)
        for index, (open_value, high_value, low_value, close_value, volume_value, synthetic_value) in enumerate(zip(
                dataset["Open"],
                dataset["High"],
                dataset["Low"],
                dataset["Close"],
                volume_values,
                synthetic_values,
        )):
            is_synthetic = bool(synthetic_value) if pd.notna(synthetic_value) else False
            price_values = [open_value, high_value, low_value, close_value]
            if pd.isna(price_values).any():
                candlestick = {"x": index, "o": None, "h": None, "l": None, "c": None}
                price_candlestick = {"x": index, "o": None, "h": None, "l": None, "c": None}
                if has_volume:
                    candlestick["v"] = None
                    price_candlestick["v"] = None
                if has_synthetic:
                    candlestick["synthetic"] = is_synthetic
                    price_candlestick["synthetic"] = is_synthetic
                candlestick_returns.append(candlestick)
                candlestick_prices.append(price_candlestick)
                continue
            volume = float(volume_value) if pd.notna(volume_value) else None
            candlestick = {
                "x": index,
                "o": round(((float(open_value) / baseline_price) - 1.0) * 100.0, 4),
                "h": round(((float(high_value) / baseline_price) - 1.0) * 100.0, 4),
                "l": round(((float(low_value) / baseline_price) - 1.0) * 100.0, 4),
                "c": round(((float(close_value) / baseline_price) - 1.0) * 100.0, 4),
            }
            price_candlestick = {
                "x": index,
                "o": round(float(open_value), 4),
                "h": round(float(high_value), 4),
                "l": round(float(low_value), 4),
                "c": round(float(close_value), 4),
            }
            if has_volume:
                candlestick["v"] = round(volume, 4) if volume is not None else None
                price_candlestick["v"] = round(volume, 4) if volume is not None else None
            if has_synthetic:
                candlestick["synthetic"] = is_synthetic
                price_candlestick["synthetic"] = is_synthetic
            candlestick_returns.append(candlestick)
            candlestick_prices.append(price_candlestick)
    return SeriesPayload(
        ticker=ticker.upper(),
        dates=dataset["Date"].map(
            lambda value: format_display_datetime(value) if has_intraday_timestamps else format_display_date(value)
        ).tolist(),
        raw_dates=dataset["Date"].map(
            lambda value: pd.Timestamp(value).strftime("%Y-%m-%d %H:%M")
        ).tolist(),
        normalized_returns=[
            round(float(value), 4) if pd.notna(value) else None
            for value in normalized_returns.tolist()
        ],
        color=color,
        glow=glow,
        candlestick_returns=candlestick_returns,
        candlestick_prices=candlestick_prices,
        prices=[
            round(float(value), 4) if pd.notna(value) else None
            for value in close_values.tolist()
        ],
    )


def calculate_ttm_dividend_yield(
        dataset: pd.DataFrame,
        end_date: object | None = None,
) -> float | None:
    if dataset.empty or "Date" not in dataset.columns or "Close" not in dataset.columns or "Dividends" not in dataset.columns:
        return None

    prepared = dataset[["Date", "Close", "Dividends"]].copy()
    prepared["Date"] = pd.to_datetime(prepared["Date"], errors="coerce")
    prepared["Close"] = pd.to_numeric(prepared["Close"], errors="coerce")
    prepared["Dividends"] = pd.to_numeric(prepared["Dividends"], errors="coerce").fillna(0.0)
    prepared = prepared.dropna(subset=["Date", "Close"]).sort_values("Date")
    if prepared.empty:
        return None

    requested_end = pd.to_datetime(end_date, errors="coerce") if end_date is not None else pd.NaT
    cutoff_end = pd.Timestamp(requested_end) if pd.notna(requested_end) else pd.Timestamp(prepared["Date"].max())
    cutoff_end = cutoff_end.tz_localize(None) if cutoff_end.tzinfo is not None else cutoff_end
    bounded = prepared[prepared["Date"] <= cutoff_end].copy()
    if bounded.empty:
        return None

    close_price = float(bounded["Close"].iloc[-1])
    if close_price <= 0:
        return None

    cutoff_start = pd.Timestamp(bounded["Date"].iloc[-1]) - pd.DateOffset(years=1)
    trailing = bounded[(bounded["Date"] > cutoff_start) & (bounded["Date"] <= pd.Timestamp(bounded["Date"].iloc[-1]))]
    dividend_total = float(trailing["Dividends"].sum())
    return (dividend_total / close_price) * 100.0
