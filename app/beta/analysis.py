"""Bounded, read-only Close diagnostics for Beta. Code version: v0.2.0."""

from __future__ import annotations

import re
from math import fsum
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow.parquet as parquet

from app.infrastructure.storage import (
    HISTORICAL_STORE_DIR,
    history_store_path_for,
    market_ticker_store_aliases,
    normalize_ticker,
)

MAX_OBSERVATIONS = 2_500
MAX_SOURCE_BYTES = 32 * 1024 * 1024
MAX_SOURCE_ROWS = 100_000
WINDOW = 20
HORIZONS = (5, 20, 60)
CALIBRATION_WINDOW = 60
MINIMUM_CLOSES = {"analog-explorer": 120, "calibration-lab": 120}
TICKER_PATTERN = re.compile(r"[A-Z0-9]{1,12}(?:[.-][A-Z0-9]{1,6}){0,2}", re.ASCII)


class BetaDataError(ValueError):
    """Represent an expected, safe-to-display request or local-data failure."""

    def __init__(self, message: str, status: int = 422) -> None:
        super().__init__(message)
        self.status = status


def validate_ticker(raw: str) -> str:
    ticker = str(raw).strip().upper()
    if not TICKER_PATTERN.fullmatch(ticker):
        raise BetaDataError("Enter one ticker using letters, digits, periods, or hyphens.", 400)
    return normalize_ticker(ticker)


def load_closes(raw_ticker: str, minimum: int = 80) -> tuple[str, pd.DataFrame]:
    """Read only the selected daily file; never refresh, migrate, or create a cache."""
    ticker = validate_ticker(raw_ticker)
    root = Path(HISTORICAL_STORE_DIR).resolve()
    path = None
    source_ticker = ticker
    try:
        # Market aliases represent the same listed security, never an investment proxy.
        for candidate in market_ticker_store_aliases(ticker):
            candidate = validate_ticker(candidate)
            candidate_path = history_store_path_for(candidate)
            if candidate_path.is_symlink() or candidate_path.resolve().parent != root:
                raise BetaDataError("This ticker does not resolve to an ordinary local daily cache.", 400)
            if candidate_path.is_file():
                path = candidate_path
                source_ticker = candidate
                break
        if path is None:
            raise BetaDataError(f"No local daily Close cache is available for {ticker}.", 404)
        if path.stat().st_size > MAX_SOURCE_BYTES:
            raise BetaDataError("This daily cache exceeds Beta's 32 MiB read limit.")
        with path.open("rb") as source:
            reader = parquet.ParquetFile(source)
            if reader.metadata.num_rows > MAX_SOURCE_ROWS:
                raise BetaDataError("This daily cache exceeds Beta's 100,000-row source limit.")
            if not {"Date", "Close"}.issubset(reader.schema_arrow.names):
                raise BetaDataError("The local daily cache must contain Date and Close columns.")
            groups: list[int] = []
            count = 0
            for group in range(reader.num_row_groups - 1, -1, -1):
                groups.append(group)
                count += reader.metadata.row_group(group).num_rows
                if count >= MAX_OBSERVATIONS:
                    break
            table = reader.read_row_groups(sorted(groups), columns=["Date", "Close"], use_threads=False)
            frame = table.slice(max(0, len(table) - MAX_OBSERVATIONS)).to_pandas()
    except BetaDataError:
        raise
    except (OSError, ValueError, TypeError) as exc:
        raise BetaDataError("The local daily cache could not be read. No refresh was attempted.") from exc

    if len(frame) < minimum:
        raise BetaDataError(f"This experiment needs at least {minimum:,} daily closes; the cache contains {len(frame):,}.")
    dates = pd.to_datetime(frame["Date"], errors="coerce", utc=True)
    closes = pd.to_numeric(frame["Close"], errors="coerce")
    if dates.isna().any() or dates.dt.normalize().duplicated().any() or not dates.is_monotonic_increasing:
        raise BetaDataError("Daily dates must be valid, unique, and in ascending order; no rows were repaired.")
    if (dates.dt.normalize() > pd.Timestamp.now(tz="UTC").normalize()).any():
        raise BetaDataError("The local cache contains future-dated daily rows.")
    if not np.isfinite(closes.to_numpy(dtype=float)).all() or (closes <= 0).any():
        raise BetaDataError("Daily closes must be finite and positive; invalid rows were not dropped or bridged.")
    result = pd.DataFrame({"Date": dates, "Close": closes.astype(float)}).reset_index(drop=True)
    result.attrs["source_ticker"] = source_ticker
    return ticker, result


def display_date(value: object) -> str:
    date = pd.Timestamp(value)
    return f"{date.day} {date.strftime('%b %Y')}"


def percent(value: float) -> str:
    return f"{value * 100:+,.2f}%"


def metric(label: str, value: str, note: str) -> dict[str, str]:
    return {"label": label, "value": value, "note": note}


def number_series(values: object) -> list[float | None]:
    return [round(float(value), 6) if np.isfinite(value) else None for value in values]


def horizon_returns(closes: np.ndarray, horizon: int) -> np.ndarray:
    return closes[horizon:] / closes[:-horizon] - 1


def regime(frame: pd.DataFrame) -> dict[str, object]:
    closes = frame["Close"]
    log_returns = np.log(closes).diff()
    volatility = log_returns.rolling(WINDOW).std(ddof=1) * np.sqrt(252)
    moving_average = closes.rolling(60).mean()
    trend = closes.iloc[-1] / closes.iloc[-WINDOW - 1] - 1
    distance = closes.iloc[-1] / moving_average.iloc[-1] - 1
    drawdown = closes.iloc[-1] / closes.tail(252).max() - 1
    current_vol = volatility.iloc[-1]
    reference_vols = volatility.iloc[:-1].dropna()
    rank = float((reference_vols <= current_vol).mean()) * 100
    texture = "Rising" if trend > 0 and distance > 0 else "Falling" if trend < 0 and distance < 0 else "Mixed"
    tail = frame.tail(252)
    anchor = tail["Close"].iloc[0]
    return {
        "metrics": [
            metric("Trend texture", texture, "Agreement between 20-session return and distance from the 60-close mean."),
            metric("20-session return", percent(trend), "Close-to-close price change; excludes cash dividends."),
            metric("Realized volatility", f"{current_vol * 100:,.2f}%", f"20 log returns, annualized with 252 sessions; historical rank {rank:,.0f}%."),
            metric("Trailing drawdown", percent(drawdown), "Latest close below the highest close in up to 252 observations."),
        ],
        "chart": {
            "labels": [display_date(value) for value in tail["Date"]],
            "series": [
                {"label": "Close return (%)", "values": number_series((tail["Close"] / anchor - 1) * 100)},
                {"label": "60-close mean, rebased (%)", "values": number_series((moving_average.loc[tail.index] / anchor - 1) * 100)},
            ],
        },
        "rows": {
            "columns": ["Measure", "Value", "Interpretation"],
            "values": [
                ["Distance from 60-close mean", percent(distance), "A trailing comparison, not a fitted regime."],
                ["Volatility historical rank", f"{rank:,.0f}%", f"Compared with {len(reference_vols):,} prior 20-return windows."],
                ["Drawdown reference length", f"{min(252, len(frame)):,} closes", "Limited to the available trailing history."],
            ],
        },
        "notes": ["Rising, Falling, and Mixed describe two trailing indicators; no hidden-state model is fitted.", "The volatility rank describes past windows and is not a forecast probability."],
    }


def find_analogs(closes: np.ndarray) -> list[dict[str, object]]:
    """Rank shapes using past inputs; each complete continuation precedes the query."""
    query_start = len(closes) - WINDOW
    query_shape = np.log(closes[query_start:]) - np.log(closes[query_start])
    candidates = []
    for start in range(query_start - (2 * WINDOW) + 1):
        end = start + WINDOW - 1
        outcome_end = end + WINDOW
        shape = np.log(closes[start:end + 1]) - np.log(closes[start])
        distance = float(np.sqrt(np.mean(np.square(shape - query_shape))))
        candidates.append({"start": start, "end": end, "outcome_end": outcome_end, "distance": distance})
    selected = []
    for candidate in sorted(candidates, key=lambda item: (item["distance"], item["start"])):
        if any(candidate["start"] <= previous["outcome_end"] and previous["start"] <= candidate["outcome_end"] for previous in selected):
            continue
        selected.append(candidate)
        if len(selected) == 5:
            break
    return selected


def analog(frame: pd.DataFrame) -> dict[str, object]:
    closes = frame["Close"].to_numpy()
    candidates = find_analogs(closes)
    query_start = len(closes) - WINDOW
    outcomes = [float(closes[item["outcome_end"]] / closes[item["end"]] - 1) for item in candidates]
    series = [{"label": "Latest 20 closes (%)", "values": number_series((closes[query_start:] / closes[query_start] - 1) * 100) + [None] * WINDOW}]
    rows = []
    for index, (candidate, outcome) in enumerate(zip(candidates, outcomes), start=1):
        start, end, outcome_end = candidate["start"], candidate["end"], candidate["outcome_end"]
        series.append({"label": f"Analog {index} (%)", "values": number_series((closes[start:outcome_end + 1] / closes[start] - 1) * 100)})
        rows.append([display_date(frame["Date"].iloc[start]), display_date(frame["Date"].iloc[end]), f"{candidate['distance'] * 100:,.3f}", percent(outcome), display_date(frame["Date"].iloc[outcome_end])])
    return {
        "metrics": [
            metric("Distinct analogs", str(len(candidates)), "Up to five disjoint shape-and-continuation windows, ranked only by shape distance."),
            metric("Median continuation", percent(float(np.median(outcomes))), "Selected analogs' next 20-session price returns; not a forecast."),
            metric("Worst continuation", percent(min(outcomes)), "Minimum observed continuation among the selected analogs."),
            metric("Query begins", display_date(frame["Date"].iloc[query_start]), "Every candidate continuation ends strictly before this date."),
        ],
        "chart": {"labels": [str(value) for value in range(-WINDOW + 1, WINDOW + 1)], "series": series},
        "rows": {"columns": ["Shape start", "Shape end", "Log-shape RMS × 100", "Next 20 sessions", "Continuation end"], "values": rows},
        "notes": ["Session 0 is each shape's final observed close; positive sessions are historical continuations only.", "Distance is root-mean-square difference between log-price paths rebased at their first close; smaller is closer.", "Candidate outcome dates precede the latest query window, and selected 40-close windows do not overlap.", "Similarity selection and a small dependent market sample cannot establish calibrated probabilities."],
    }


def stress(frame: pd.DataFrame) -> dict[str, object]:
    closes = frame["Close"].to_numpy()
    rows = []
    metrics = []
    for horizon in HORIZONS:
        values = horizon_returns(closes, horizon)
        start = int(np.argmin(values))
        worst = float(values[start])
        rows.append([f"{horizon} sessions", percent(worst), display_date(frame["Date"].iloc[start]), display_date(frame["Date"].iloc[start + horizon]), f"{len(values):,}"])
        metrics.append(metric(f"Worst {horizon}-session window", percent(worst), "Lowest observed price return across all complete windows."))
    selected = int(np.argmin(horizon_returns(closes, WINDOW)))
    path = closes[selected:selected + WINDOW + 1]
    full_drawdown = closes / np.maximum.accumulate(closes) - 1
    metrics.append(metric("Maximum observed drawdown", percent(float(np.min(full_drawdown))), "Largest peak-to-later-trough decline in the analyzed history."))
    return {
        "metrics": metrics,
        "chart": {"labels": [str(value) for value in range(WINDOW + 1)], "series": [{"label": "Worst 20-session path (%)", "values": number_series((path / path[0] - 1) * 100)}]},
        "rows": {"columns": ["Horizon", "Minimum return", "Start", "End", "Windows examined"], "values": rows},
        "notes": ["Session 0 is the observed starting close. Window minima may be positive when every window rose.", "Worst windows are selected retrospectively; selection is appropriate for a historical stress inventory, not a tradable forecast.", "This single-instrument price replay does not model a portfolio, leverage, fees, liquidity, or cash dividends."],
    }


def robustness(frame: pd.DataFrame) -> dict[str, object]:
    closes = frame["Close"].to_numpy()
    rows = []
    for horizon in HORIZONS:
        values = horizon_returns(closes, horizon)
        rows.append([f"{horizon} sessions", percent(float(np.min(values))), percent(float(np.median(values))), percent(float(np.max(values))), f"{float((values < 0).mean()) * 100:,.1f}%", f"{len(values):,}"])
    values = horizon_returns(closes, WINDOW)
    return {
        "metrics": [
            metric("Median 20-session outcome", percent(float(np.median(values))), "Median of every fully observed 20-session price return."),
            metric("Worst 20-session outcome", percent(float(np.min(values))), "Smallest observed outcome across all start dates."),
            metric("Negative-window share", f"{float((values < 0).mean()) * 100:,.1f}%", "Historical frequency among overlapping windows; not an independent probability estimate."),
            metric("Start-date spread", f"{(float(np.max(values)) - float(np.min(values))) * 100:,.2f} pp", "Difference between the best and worst 20-session outcomes."),
        ],
        "chart": {"labels": [display_date(value) for value in frame["Date"].iloc[WINDOW:].tail(252)], "series": [{"label": "Trailing 20-session price return (%)", "values": number_series(values[-252:] * 100)}]},
        "rows": {"columns": ["Horizon", "Worst", "Median", "Best", "Negative windows", "Complete windows"], "values": rows},
        "notes": ["Chart dates are outcome end dates; every plotted return uses only closes observed by that date.", "Adjacent windows overlap, so their outcomes are dependent and the window count is not an independent sample size.", "No strategy, signals, trades, optimization, or out-of-sample validation are performed."],
    }


def longest_underwater_run(drawdown: np.ndarray) -> int:
    """Count consecutive observed sessions strictly below an earlier high."""
    longest = current = 0
    for value in drawdown:
        current = current + 1 if value < 0 else 0
        longest = max(longest, current)
    return longest


def path_remix(frame: pd.DataFrame) -> dict[str, object]:
    closes = frame["Close"].to_numpy()[-253:]
    log_returns = np.diff(np.log(closes))
    terminal = float(np.expm1(fsum(log_returns)))
    orders = [
        ("Observed order", log_returns),
        ("Reversed order", log_returns[::-1]),
        ("Lowest returns first", np.sort(log_returns)),
        ("Highest returns first", np.sort(log_returns)[::-1]),
    ]
    series = []
    rows = []
    depths = []
    for label, ordered in orders:
        # Compensated sums preserve tied peaks across different return orders.
        log_wealth = np.array([0.0, *[fsum(ordered[:end]) for end in range(1, len(ordered) + 1)]])
        wealth_return = np.expm1(log_wealth)
        drawdown = np.expm1(log_wealth - np.maximum.accumulate(log_wealth))
        depth = float(drawdown.min())
        depths.append(depth)
        series.append({"label": f"{label} (%)", "values": number_series(wealth_return * 100)})
        rows.append([label, percent(terminal), percent(depth), f"{longest_underwater_run(drawdown):,}"])
    return {
        "metrics": [
            metric("Shared final return", percent(terminal), "Every path compounds exactly the same daily returns once."),
            metric("Observed maximum drawdown", percent(depths[0]), "Peak-to-trough decline within this selected path, including its starting close."),
            metric("Drawdown spread", f"{(max(depths) - min(depths)) * 100:,.2f} pp", "Difference between the shallowest and deepest of the four paths."),
            metric("Returns rearranged", f"{len(log_returns):,}", "Up to the latest 252 daily returns, with one fixed starting close."),
        ],
        "chart": {"labels": [str(value) for value in range(len(log_returns) + 1)], "series": series},
        "rows": {"columns": ["Order", "Final return", "Maximum drawdown", "Longest underwater run (sessions)"], "values": rows},
        "notes": [
            "Session 0 starts at a zero price return. Only the observed-order curve follows actual chronology; the other paths are deterministic rearrangements.",
            "The final compounded return stays equal because multiplication is independent of order. Interim drawdown and time underwater can change.",
            "Underwater runs count consecutive closes below a previous high; the recovery close is excluded and unfinished runs are included.",
            "Rearrangement changes serial dependence. These paths are thought experiments, not simulated probabilities, forecasts, or executable strategies.",
        ],
    }


def drawdown_episodes(closes: np.ndarray) -> list[dict[str, int | None]]:
    """Track each strict drawdown from its latest peak until first recovery."""
    episodes = []
    peak = 0
    trough = None
    for index in range(1, len(closes)):
        if closes[index] >= closes[peak]:
            if trough is not None:
                episodes.append({"peak": peak, "trough": trough, "recovery": index})
            peak, trough = index, None
        elif trough is None or closes[index] < closes[trough]:
            trough = index
    if trough is not None:
        episodes.append({"peak": peak, "trough": trough, "recovery": None})
    return episodes


def recovery_clock(frame: pd.DataFrame) -> dict[str, object]:
    closes = frame["Close"].to_numpy()
    episodes = drawdown_episodes(closes)
    drawdown = closes / np.maximum.accumulate(closes) - 1
    completed = [item["recovery"] - item["peak"] for item in episodes if item["recovery"] is not None]
    current = episodes[-1] if episodes and episodes[-1]["recovery"] is None else None
    current_age = len(closes) - 1 - current["peak"] if current else 0
    depths = [float(closes[item["trough"]] / closes[item["peak"]] - 1) for item in episodes]
    selected = set(range(max(0, len(episodes) - 5), len(episodes)))
    selected.update(sorted(range(len(episodes)), key=lambda index: (depths[index], -index))[:5])
    completed_indexes = [index for index, item in enumerate(episodes) if item["recovery"] is not None]
    if completed_indexes:
        selected.add(max(completed_indexes, key=lambda index: (episodes[index]["recovery"] - episodes[index]["peak"], index)))
    rows = []
    for index in sorted(selected, reverse=True):
        item = episodes[index]
        recovery = item["recovery"]
        end = recovery if recovery is not None else len(closes) - 1
        rows.append([
            display_date(frame["Date"].iloc[item["peak"]]),
            display_date(frame["Date"].iloc[item["trough"]]),
            percent(depths[index]),
            display_date(frame["Date"].iloc[recovery]) if recovery is not None else "Unrecovered (censored)",
            f"{end - item['peak']:,}",
        ])
    return {
        "metrics": [
            metric("Maximum observed drawdown", percent(float(drawdown.min())), "Uses running peaks across the entire analyzed sample."),
            metric("Recovered episodes", f"{len(completed):,}", "Only episodes with an observed first return to or above their previous peak."),
            metric("Median recovery time", f"{float(np.median(completed)):,.1f} sessions" if completed else "Not observed", "Peak-to-recovery duration among completed episodes only; unfinished episodes are excluded."),
            metric("Current underwater age", f"{current_age:,} sessions", "Elapsed sessions since the latest peak; zero means the latest close is at a running high."),
        ],
        "chart": {
            "labels": [display_date(value) for value in frame["Date"].tail(252)],
            "series": [{"label": "Drawdown from running peak (%)", "values": number_series(drawdown[-252:] * 100)}],
        },
        "rows": {"columns": ["Peak date", "Trough date", "Depth", "First recovery", "Elapsed sessions"], "values": rows},
        "notes": [
            "An episode begins at the latest tied peak and ends at the first close at or above that peak. Trough dates show the first occurrence of each episode's lowest close.",
            "Unrecovered episodes are right-censored: the last cached close ends observation, not the drawdown. Their elapsed age is not a completed recovery time.",
            "The table combines the five most recent and five deepest episodes with the longest completed recovery, removes duplicates, and shows at most eleven rows, newest first. Equal longest recoveries favor the most recent episode.",
            "The chart shows up to 252 recent closes while retaining earlier running peaks from the analyzed sample. Peaks before that sample are unknown.",
            "Completed-only recovery times favor episodes that recovered within the sample; they do not estimate how long an ongoing drawdown will last.",
            *([] if episodes else ["No strict drawdown episodes were observed in this sample."]),
        ],
    }


def prequential_bands(closes: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Score each next return against quantiles of its 60 earlier returns only."""
    returns = closes[1:] / closes[:-1] - 1
    bounds = np.array([
        np.quantile(returns[index - CALIBRATION_WINDOW:index], [0.1, 0.9], method="linear")
        for index in range(CALIBRATION_WINDOW, len(returns))
    ])
    return bounds[:, 0], bounds[:, 1], returns[CALIBRATION_WINDOW:]


def calibration_lab(frame: pd.DataFrame) -> dict[str, object]:
    lower, upper, observed = prequential_bands(frame["Close"].to_numpy())
    below, above = observed < lower, observed > upper
    covered = ~(below | above)
    width = upper - lower
    dates = frame["Date"].iloc[CALIBRATION_WINDOW + 1:]
    rows = [
        [display_date(dates.iloc[index]), percent(lower[index]), percent(observed[index]), percent(upper[index]), "Below band" if below[index] else "Above band" if above[index] else "Inside band"]
        for index in range(max(0, len(observed) - 12), len(observed))
    ]
    return {
        "metrics": [
            metric("Observed coverage", f"{float(covered.mean()) * 100:,.1f}%", "Fraction of evaluated returns inside the inclusive 10th–90th percentile band; 80% is the reference level."),
            metric("Mean band width", f"{float(width.mean()) * 100:,.2f} pp", "Average upper-minus-lower daily return bound across all evaluated sessions."),
            metric("Outside band", f"{int((~covered).sum()):,}", f"{int(below.sum()):,} below and {int(above.sum()):,} above the band."),
            metric("Evaluated sessions", f"{len(observed):,}", "Each realized daily return is compared with a band formed from the previous 60 returns only."),
        ],
        "chart": {
            "labels": [display_date(value) for value in dates.tail(252)],
            "series": [
                {"label": "Prior-return 10th percentile (%)", "values": number_series(lower[-252:] * 100)},
                {"label": "Observed next-day return (%)", "values": number_series(observed[-252:] * 100)},
                {"label": "Prior-return 90th percentile (%)", "values": number_series(upper[-252:] * 100)},
            ],
        },
        "rows": {"columns": ["Outcome date", "Lower bound", "Observed return", "Upper bound", "Outcome"], "values": rows},
        "notes": [
            "This prequential check constructs a band before observing each next daily simple return, then scores that outcome. Quantiles use linear interpolation on exactly 60 earlier returns.",
            "The central 80% is a nominal reference, not a coverage guarantee. Ties can produce zero-width bands; outcomes exactly on a bound count as inside.",
            "Rolling windows overlap, and changing market conditions can make historical quantile bands poorly calibrated. Evaluation counts are not independent sample sizes.",
            "This is a historical quantile baseline, not a fitted machine-learning model or a conformal prediction procedure. No future forecast is generated.",
            "Metrics use every evaluated session; the chart shows at most 252 and the table the latest 12 outcomes.",
        ],
    }


ANALYZERS = {
    "regime-radar": regime,
    "analog-explorer": analog,
    "stress-lab": stress,
    "robustness-lab": robustness,
    "path-remix": path_remix,
    "recovery-clock": recovery_clock,
    "calibration-lab": calibration_lab,
}


def analyze(experiment: str, raw_ticker: str) -> dict[str, object]:
    if experiment not in ANALYZERS:
        raise BetaDataError("This experiment has no local Close analysis endpoint.", 404)
    ticker, frame = load_closes(raw_ticker, minimum=MINIMUM_CLOSES.get(experiment, 80))
    try:
        with np.errstate(over="raise", divide="raise", invalid="raise"):
            result = ANALYZERS[experiment](frame)
    except (FloatingPointError, OverflowError) as exc:
        raise BetaDataError("The local price scale cannot be analyzed safely.") from exc
    return {
        "experiment": experiment,
        "ticker": ticker,
        "as_of": display_date(frame["Date"].iloc[-1]),
        "observations": len(frame),
        "source": f"Local daily Close cache ({frame.attrs['source_ticker']}); no refresh",
        **result,
        "notes": [
            f"Uses the latest {len(frame):,} cached observations, capped at {MAX_OBSERVATIONS:,}; the latest cache date may be stale.",
            "Returns use stored Close values only. Dividend reinvestment, fees, and independent corporate-action verification are excluded.",
            "Session horizons count cached rows; missing exchange sessions are not independently verified.",
            *result["notes"],
        ],
    }
