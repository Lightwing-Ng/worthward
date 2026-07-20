"""Pure form and query parsing helpers for workspace request handling.

Code version: v1.0.0
"""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from typing import Any


def parse_int_value(raw_value: object, fallback: int) -> int:
    """Parse an integer from a form or query value, returning fallback on failure."""
    if raw_value is None:
        return fallback
    try:
        return int(str(raw_value).strip())
    except (TypeError, ValueError):
        return fallback


def parse_float_value(raw_value: object, fallback: float) -> float:
    """Parse a float from a form or query value, stripping thousands separators."""
    if raw_value is None:
        return fallback
    normalized = str(raw_value).strip().replace(",", "")
    if not normalized:
        return fallback
    try:
        return float(normalized)
    except (TypeError, ValueError):
        return fallback


def compact_normalized_tickers(
    raw_values: Sequence[object],
    *,
    max_tickers: int,
    normalize: Callable[[str], str],
) -> list[str]:
    """Normalize ticker tokens and drop empties, preserving order up to max_tickers."""
    compacted: list[str] = []
    for raw_value in raw_values:
        normalized = normalize(str(raw_value or ""))
        if normalized:
            compacted.append(normalized)
    return compacted[:max_tickers]


def parse_requested_tickers_from_args(
    args: Mapping[str, Any],
    *,
    max_tickers: int,
    normalize: Callable[[str], str],
    getlist: Callable[[str], list[str]] | None = None,
) -> list[str]:
    """Parse tickers from repeated, CSV, numbered, or legacy a/b query shapes."""
    list_values = getlist or (lambda key: list(args.getlist(key)) if hasattr(args, "getlist") else [])  # type: ignore[attr-defined]

    repeated = list_values("ticker")
    if repeated:
        return compact_normalized_tickers(repeated, max_tickers=max_tickers, normalize=normalize)

    csv_tickers = str(args.get("tickers", "") or "").strip()
    if csv_tickers:
        return compact_normalized_tickers(
            csv_tickers.split(","),
            max_tickers=max_tickers,
            normalize=normalize,
        )

    numbered = [str(args.get(f"ticker_{index}", "") or "") for index in range(1, max_tickers + 1)]
    has_numbered = any(value.strip() for value in numbered) or any(
        f"ticker_{index}" in args for index in range(1, max_tickers + 1)
    )
    if has_numbered:
        raw_tickers = numbered
    elif "ticker_a" in args or "ticker_b" in args:
        raw_tickers = [str(args.get("ticker_a", "") or ""), str(args.get("ticker_b", "") or "")]
    else:
        return []
    return compact_normalized_tickers(raw_tickers, max_tickers=max_tickers, normalize=normalize)


def parse_requested_weights_from_args(
    args: Mapping[str, Any],
    slot_count: int,
    *,
    getlist: Callable[[str], list[str]] | None = None,
) -> list[int]:
    """Parse portfolio weights clamped to 0..100 for the active slot count."""
    list_values = getlist or (lambda key: list(args.getlist(key)) if hasattr(args, "getlist") else [])  # type: ignore[attr-defined]
    repeated = list_values("weight")
    raw_values = repeated[:slot_count] if repeated else [
        args.get(f"weight_{index}", "")
        for index in range(1, slot_count + 1)
    ]
    weights: list[int] = []
    for raw_value in raw_values:
        if raw_value is None or str(raw_value).strip() == "":
            weights.append(0)
        else:
            weights.append(min(max(parse_int_value(raw_value, 0), 0), 100))
    return weights


def parse_portfolio_allocation_mode_from_args(args: Mapping[str, Any]) -> str:
    """Return shares when allocation=shares, otherwise weight."""
    return "shares" if str(args.get("allocation", "") or "").strip().lower() == "shares" else "weight"


def parse_requested_shares_from_args(
    args: Mapping[str, Any],
    slot_count: int,
    *,
    getlist: Callable[[str], list[str]] | None = None,
) -> list[int]:
    """Parse non-negative whole-share counts for the active slot count."""
    list_values = getlist or (lambda key: list(args.getlist(key)) if hasattr(args, "getlist") else [])  # type: ignore[attr-defined]
    repeated = list_values("shares")
    raw_values = repeated[:slot_count] if repeated else [
        args.get(f"shares_{index}", "")
        for index in range(1, slot_count + 1)
    ]
    return [max(parse_int_value(raw_value, 0), 0) for raw_value in raw_values]


def parse_bool_flag_from_args(
    args: Mapping[str, Any],
    *names: str,
    default: bool = False,
    getlist: Callable[[str], list[str]] | None = None,
) -> bool:
    """Return True when the last provided flag value for any name is the string '1'."""
    list_values = getlist or (lambda key: list(args.getlist(key)) if hasattr(args, "getlist") else [])  # type: ignore[attr-defined]
    for name in names:
        values = list_values(name)
        if values:
            return values[-1] == "1"
    return default


def resolve_workspace_dividend_mode(price_only: bool, reinvest_cash_dividends: bool) -> str:
    """Map workspace dividend UI flags to the service dividend_mode contract."""
    if price_only:
        return "price"
    return "reinvest" if reinvest_cash_dividends else "cash"


def parse_range_request_args_from_args(
    args: Mapping[str, Any],
    *,
    default_range_mode: str,
    default_period: str,
) -> tuple[str, str, str, str]:
    """Parse range mode, period, and exact start/end bounds from workspace query args."""
    range_mode = str(
        args.get("range", args.get("range_mode", default_range_mode)) or default_range_mode
    ).strip().lower()
    period = str(args.get("period", default_period) or default_period).strip().lower()
    exact_trading_date = str(
        args.get("trading_date", args.get("exact_trading_date", "")) or ""
    ).strip()
    exact_start = str(args.get("from", args.get("exact_start", "")) or "").strip()
    exact_end = str(args.get("to", args.get("exact_end", "")) or "").strip()
    if range_mode == "exact" and period == "1d" and exact_trading_date:
        exact_start = exact_trading_date
        exact_end = exact_trading_date
    return range_mode, period, exact_start, exact_end


def build_default_weights(count: int) -> list[int]:
    """Split 100% evenly across count slots, distributing remainder to leading slots."""
    if count <= 0:
        return []
    base_weight = 100 // count
    remainder = 100 % count
    return [base_weight + (1 if index < remainder else 0) for index in range(count)]


def normalize_portfolio_weights(raw_weights: list[int], active_count: int) -> list[int]:
    """Scale or default portfolio weights so they sum to 100 for active_count slots."""
    if active_count <= 0:
        return []
    trimmed = raw_weights[:active_count]
    if len(trimmed) < active_count:
        trimmed.extend([0] * (active_count - len(trimmed)))
    total = sum(trimmed)
    if total == 100:
        return trimmed
    if total <= 0:
        return build_default_weights(active_count)
    scaled = [int((value * 100) / total) for value in trimmed]
    remainder = 100 - sum(scaled)
    for index in range(active_count):
        if remainder == 0:
            break
        scaled[index] += 1
        remainder -= 1
    return scaled


def ensure_positive_portfolio_weights(raw_weights: list[int], active_count: int) -> list[int]:
    """Require every active weight to be strictly positive."""
    trimmed = raw_weights[:active_count]
    if len(trimmed) < active_count:
        trimmed.extend([0] * (active_count - len(trimmed)))
    if any(weight <= 0 for weight in trimmed):
        raise ValueError("Each selected ticker must have a weight above 0%.")
    return trimmed
