"""
Read-only Longbridge CLI factor data for Bayesian price models.

Code version: v1.6.0
- Added: An opt-in current P/E snapshot from Longbridge ``calc-index`` is
  retained only on its own market-local availability date and never backfilled
  into an earlier historical window.
- Fixed: Daily OHLCV and factor observations now use each symbol's local
  trading date, preventing Asia-market midnight timestamps from shifting to
  the previous UTC calendar day.
- Changed: The process cache is a bounded LRU with eager expiry cleanup,
  same-key single-flight loading, and immutable cached factor status.
- Added: Chunked daily OHLCV, historical P/E, and daily option-volume
  observations with serialized rate limiting, bounded retry, and memory TTL.
- Added: Opt-in research factors from Longbridge valuation, capital, market
  temperature, ownership, short-interest, and broker-holding commands. Every
  observation is date-filtered before it can enter a walk-forward model.
- Fixed: Research observations now require an availability or disclosure
  timestamp. Report-period fields such as ``period`` and ``end_date`` are
  never treated as point-in-time availability dates.
- Fixed: Commands that provide only intraday snapshots, report-period dates,
  or short-interest settlement dates are explicitly unavailable to the causal
  backtest. They remain visible as research controls, but cannot enter a
  walk-forward feature matrix until Longbridge exposes a verifiable
  availability timestamp.
"""

from __future__ import annotations

from collections import OrderedDict
from collections.abc import Mapping
from concurrent.futures import Future
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone, tzinfo
import hashlib
import json
import logging
import math
import re
from threading import Lock
import time
from types import MappingProxyType
from typing import Any, Sequence
from zoneinfo import ZoneInfo

from app.core.broker_settings import BrokerSettings, load_broker_settings
from app.infrastructure.longbridge_cli import run_longbridge_cli_json


LOGGER = logging.getLogger(__name__)
UTC = timezone.utc
KLINE_CHUNK_CALENDAR_DAYS = 365
OPTION_HISTORY_MAX_DAYS = 4_000
DEFAULT_CACHE_TTL_SECONDS = 300.0
BUNDLE_CACHE_MAX_ENTRIES = 32
CLI_MIN_INTERVAL_SECONDS = 0.15
CLI_MAX_ATTEMPTS = 3
CLI_RETRY_BASE_SECONDS = 0.25
RETRYABLE_RATE_LIMIT_CODES = ("429002", "429003")

RESEARCH_FACTOR_KEYS = (
    "pb_ratio",
    "ps_ratio",
    "dividend_yield",
    "market_temperature",
    "capital_flow",
    "shareholder_concentration",
    "fund_holder_weight",
    "short_interest",
    "short_volume",
    "broker_holding",
)

_RESEARCH_VALUE_KEYS: dict[str, tuple[str, ...]] = {
    "pb_ratio": ("pb", "pb_ratio", "value"),
    "ps_ratio": ("ps", "ps_ratio", "value"),
    "dividend_yield": ("dvd_yld", "dividend_yield", "yield", "value"),
    "market_temperature": ("temperature", "temp", "score", "value"),
    "capital_flow": ("capital_flow", "net_inflow", "net_flow", "inflow", "value", "amount"),
    "shareholder_concentration": (
        "owned_ratio", "holding_ratio", "ownership_ratio", "percent_shares_held",
        "ratio", "percent", "value",
    ),
    "fund_holder_weight": ("weight", "position_ratio", "holding_ratio", "ratio", "percent", "value"),
    "short_interest": (
        "short_interest", "open_short_shares", "balance", "short_shares", "rate", "value",
    ),
    "short_volume": ("total_amount", "amount", "nus_amount", "ny_amount", "rate", "value"),
    "broker_holding": ("holding_ratio", "ratio", "balance", "quantity", "amount", "value"),
}

# These sources are useful research surfaces, but their current Longbridge CLI
# commands cannot construct a time-series feature with a defensible as-of
# timestamp. In particular, ``capital --flow`` is an intraday snapshot and
# broker history requires a caller-selected broker participant plus a defined
# aggregation policy.
_UNSUPPORTED_HISTORY_FACTORS = frozenset({
    "capital_flow",
    "broker_holding",
})

# The commands return historical measurements, but the payload has no
# publication/availability timestamp. A measurement date, a filing-period end
# date, and a FINRA short-interest settlement date are not the date at which a
# model could have known the value. Fail closed until the CLI can supply one.
_UNAVAILABLE_POINT_IN_TIME_FACTORS = frozenset({
    "shareholder_concentration",
    "fund_holder_weight",
    "short_interest",
    "short_volume",
})

_DISCLOSURE_TIMESTAMP_KEYS = (
    "available_at",
    "availability_date",
    "published_at",
    "publication_date",
    "disclosed_at",
    "announcement_date",
    "release_date",
)

_HISTORICAL_OBSERVATION_TIMESTAMP_KEYS = (
    "timestamp",
    "time",
    "date",
    "date_time",
)

_MARKET_TIMEZONES = {
    "US": ZoneInfo("America/New_York"),
    "HK": ZoneInfo("Asia/Hong_Kong"),
    "SH": ZoneInfo("Asia/Shanghai"),
    "SZ": ZoneInfo("Asia/Shanghai"),
    "SG": ZoneInfo("Asia/Singapore"),
    "HAS": UTC,
}

_SUPPORTED_SYMBOL = re.compile(r"^[A-Z0-9._-]+\.(?:US|HK|SH|SZ|SG|HAS)$")
_CLI_CALL_LOCK = Lock()
_LAST_CLI_CALL_MONOTONIC = 0.0
_CACHE_LOCK = Lock()
_BUNDLE_CACHE: OrderedDict[
    tuple[object, ...],
    tuple[float, "BayesianFactorBundle"],
] = OrderedDict()
_BUNDLE_IN_FLIGHT: dict[
    tuple[object, ...],
    Future["BayesianFactorBundle"],
] = {}


@dataclass(frozen=True)
class OhlcvBar:
    observed_at: datetime
    open: float
    high: float
    low: float
    close: float
    volume: float
    turnover: float | None
    source: str


@dataclass(frozen=True)
class PeObservation:
    observed_at: datetime
    value: float
    source: str


@dataclass(frozen=True)
class OptionVolumeObservation:
    observed_at: datetime
    put_call_volume_ratio: float | None
    put_call_open_interest_ratio: float | None
    call_volume: float | None
    put_volume: float | None
    total_volume: float | None
    call_open_interest: float | None
    put_open_interest: float | None
    total_open_interest: float | None
    source: str


@dataclass(frozen=True)
class ResearchFactorObservation:
    observed_at: datetime
    factor: str
    value: float
    source: str


@dataclass(frozen=True)
class BayesianFactorBundle:
    symbol: str
    start: date
    end: date
    ohlcv: tuple[OhlcvBar, ...]
    pe_history: tuple[PeObservation, ...]
    option_history: tuple[OptionVolumeObservation, ...]
    fetched_at: datetime
    fingerprint: str
    factor_status: Mapping[str, str]
    source_commands: tuple[str, ...]
    research_history: tuple[ResearchFactorObservation, ...] = ()
    dynamic_pe_history: tuple[PeObservation, ...] = ()


def clear_bayesian_factor_cache() -> None:
    """Clear only the in-memory factor bundle cache."""
    with _CACHE_LOCK:
        _BUNDLE_CACHE.clear()


def _prune_bundle_cache_locked(now_monotonic: float) -> None:
    """Remove every expired cache entry while the caller holds `_CACHE_LOCK`."""
    expired_keys = [
        key
        for key, (expires_at, _bundle) in _BUNDLE_CACHE.items()
        if expires_at <= now_monotonic
    ]
    for key in expired_keys:
        _BUNDLE_CACHE.pop(key, None)


def _store_bundle_cache_locked(
        cache_key: tuple[object, ...],
        expires_at: float,
        bundle: "BayesianFactorBundle",
) -> None:
    """Store one bundle and evict least-recently-used entries over the cap."""
    _BUNDLE_CACHE[cache_key] = (expires_at, bundle)
    _BUNDLE_CACHE.move_to_end(cache_key)
    while len(_BUNDLE_CACHE) > BUNDLE_CACHE_MAX_ENTRIES:
        _BUNDLE_CACHE.popitem(last=False)


def _normalize_symbol(symbol: str) -> str:
    normalized = str(symbol or "").strip().upper()
    if normalized and "." not in normalized:
        normalized = f"{normalized}.US"
    if not _SUPPORTED_SYMBOL.fullmatch(normalized):
        raise ValueError("Longbridge symbols must use the <CODE>.<MARKET> format.")
    return normalized


def _market_timezone_for_symbol(symbol: str) -> tzinfo:
    market = symbol.rsplit(".", 1)[-1]
    return _MARKET_TIMEZONES.get(market, UTC)


def _coerce_date(
        value: date | datetime | str,
        field_name: str,
        symbol: str,
) -> date:
    if isinstance(value, datetime):
        if value.tzinfo is not None:
            return value.astimezone(_market_timezone_for_symbol(symbol)).date()
        return value.date()
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value).strip())
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{field_name} must use YYYY-MM-DD format.") from exc


def _utc_now() -> datetime:
    return datetime.now(tz=UTC)


def _parse_observed_at(value: Any) -> datetime | None:
    if value is None or isinstance(value, bool):
        return None
    text = str(value).strip()
    if not text:
        return None

    try:
        numeric = float(text)
    except ValueError:
        numeric = None
    if numeric is not None and math.isfinite(numeric):
        if abs(numeric) >= 1_000_000_000_000:
            numeric /= 1_000.0
        try:
            return datetime.fromtimestamp(numeric, tz=UTC)
        except (OSError, OverflowError, ValueError):
            return None

    normalized_text = text.replace("/", "-").replace(".", "-")
    try:
        parsed = datetime.fromisoformat(normalized_text.replace("Z", "+00:00"))
    except ValueError:
        try:
            parsed_date = date.fromisoformat(normalized_text)
        except ValueError:
            return None
        return datetime.combine(parsed_date, datetime.min.time())
    if parsed.tzinfo is None:
        return parsed
    return parsed.astimezone(UTC)


def _market_local_trading_day(observed_at: datetime, symbol: str) -> datetime:
    """Return one provider timestamp as its market-local naive trading day."""
    if observed_at.tzinfo is None:
        local_date = observed_at.date()
    else:
        local_date = observed_at.astimezone(
            _market_timezone_for_symbol(symbol)
        ).date()
    return datetime.combine(local_date, datetime.min.time())


def _finite_float(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    text = str(value).strip()
    if not text or text.lower() in {"-", "--", "n/a", "na", "null", "none"}:
        return None
    try:
        parsed = float(text.replace(",", ""))
    except ValueError:
        return None
    return parsed if math.isfinite(parsed) else None


def _is_in_window(observed_at: datetime, start: date, end: date) -> bool:
    return start <= observed_at.date() <= end


def _display_command(arguments: list[str]) -> str:
    return "longbridge " + " ".join(arguments)


def _run_serialized_cli(
        settings: BrokerSettings,
        arguments: list[str],
        *,
        timeout_seconds: int,
) -> Any:
    global _LAST_CLI_CALL_MONOTONIC

    with _CLI_CALL_LOCK:
        now = time.monotonic()
        delay = CLI_MIN_INTERVAL_SECONDS - (now - _LAST_CLI_CALL_MONOTONIC)
        if delay > 0:
            time.sleep(delay)
        try:
            return run_longbridge_cli_json(
                settings,
                arguments,
                timeout_seconds=timeout_seconds,
            )
        finally:
            _LAST_CLI_CALL_MONOTONIC = time.monotonic()


def _run_readonly_cli(
        settings: BrokerSettings,
        arguments: list[str],
        *,
        timeout_seconds: int = 30,
) -> Any:
    for attempt in range(CLI_MAX_ATTEMPTS):
        try:
            return _run_serialized_cli(
                settings,
                arguments,
                timeout_seconds=timeout_seconds,
            )
        except Exception as exc:
            diagnostic = str(exc)
            retryable = any(code in diagnostic for code in RETRYABLE_RATE_LIMIT_CODES)
            if not retryable or attempt + 1 >= CLI_MAX_ATTEMPTS:
                raise
            time.sleep(CLI_RETRY_BASE_SECONDS * (2 ** attempt))
    raise RuntimeError("Longbridge CLI retry budget was exhausted.")


def _extract_rows(payload: Any, *keys: str) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [row for row in payload if isinstance(row, dict)]
    if not isinstance(payload, dict):
        return []
    for key in keys:
        candidate = payload.get(key)
        if isinstance(candidate, list):
            return [row for row in candidate if isinstance(row, dict)]
    return []


def _fetch_ohlcv(
        settings: BrokerSettings,
        symbol: str,
        start: date,
        end: date,
) -> tuple[tuple[OhlcvBar, ...], list[str]]:
    source = "longbridge-cli:kline-history:day"
    commands: list[str] = []
    bars_by_time: dict[datetime, OhlcvBar] = {}
    chunk_start = start
    while chunk_start <= end:
        chunk_end = min(
            chunk_start + timedelta(days=KLINE_CHUNK_CALENDAR_DAYS - 1),
            end,
        )
        arguments = [
            "kline",
            "history",
            symbol,
            "--period",
            "day",
            "--start",
            chunk_start.isoformat(),
            "--end",
            chunk_end.isoformat(),
            "--adjust",
            "forward",
            "--format",
            "json",
        ]
        commands.append(_display_command(arguments))
        payload = _run_readonly_cli(settings, arguments, timeout_seconds=45)
        for row in _extract_rows(payload, "candlesticks", "klines", "data"):
            parsed_observed_at = _parse_observed_at(
                row.get("time", row.get("timestamp", row.get("date")))
            )
            observed_at = (
                _market_local_trading_day(parsed_observed_at, symbol)
                if parsed_observed_at is not None
                else None
            )
            open_price = _finite_float(row.get("open"))
            high_price = _finite_float(row.get("high"))
            low_price = _finite_float(row.get("low"))
            close_price = _finite_float(row.get("close"))
            volume = _finite_float(row.get("volume"))
            if (
                observed_at is None
                or open_price is None
                or high_price is None
                or low_price is None
                or close_price is None
                or volume is None
                or not _is_in_window(observed_at, start, end)
            ):
                continue
            bars_by_time[observed_at] = OhlcvBar(
                observed_at=observed_at,
                open=open_price,
                high=high_price,
                low=low_price,
                close=close_price,
                volume=volume,
                turnover=_finite_float(row.get("turnover")),
                source=source,
            )
        chunk_start = chunk_end + timedelta(days=1)
    return tuple(bars_by_time[key] for key in sorted(bars_by_time)), commands


def _history_range_years(start: date, fetched_at: datetime) -> int:
    calendar_days = max(1, (fetched_at.date() - start).days + 1)
    for years in (1, 3, 5, 10):
        if calendar_days <= years * 366:
            return years
    return 10


def _pe_rows(payload: Any) -> list[dict[str, Any]]:
    if not isinstance(payload, dict):
        return []
    metrics = payload.get("metrics")
    if isinstance(metrics, dict):
        pe_payload = metrics.get("pe")
        if isinstance(pe_payload, dict) and isinstance(pe_payload.get("list"), list):
            return [row for row in pe_payload["list"] if isinstance(row, dict)]
    return _extract_rows(payload, "history", "pe", "data")


def _fetch_pe_history(
        settings: BrokerSettings,
        symbol: str,
        start: date,
        end: date,
        fetched_at: datetime,
) -> tuple[tuple[PeObservation, ...], str]:
    range_years = _history_range_years(start, fetched_at)
    arguments = [
        "valuation",
        symbol,
        "--history",
        "--indicator",
        "pe",
        "--range",
        str(range_years),
        "--format",
        "json",
    ]
    payload = _run_readonly_cli(settings, arguments, timeout_seconds=45)
    source = "longbridge-cli:valuation-history:pe"
    observations: dict[datetime, PeObservation] = {}
    for row in _pe_rows(payload):
        parsed_observed_at = _parse_observed_at(
            row.get("timestamp", row.get("time", row.get("date")))
        )
        observed_at = (
            _market_local_trading_day(parsed_observed_at, symbol)
            if parsed_observed_at is not None
            else None
        )
        value = _finite_float(row.get("value", row.get("pe")))
        if (
            observed_at is None
            or value is None
            or not _is_in_window(observed_at, start, end)
        ):
            continue
        observations[observed_at] = PeObservation(
            observed_at=observed_at,
            value=value,
            source=source,
        )
    return tuple(observations[key] for key in sorted(observations)), _display_command(arguments)


def _dynamic_pe_rows(payload: Any) -> list[dict[str, Any]]:
    """Extract current P/E rows from the real-time calc-index response."""
    if isinstance(payload, list):
        return [row for row in payload if isinstance(row, dict)]
    if not isinstance(payload, dict):
        return []
    rows = _extract_rows(payload, "data", "items", "list", "results")
    if rows:
        return rows
    return [payload] if "pe" in payload else []


def _fetch_dynamic_pe_history(
        settings: BrokerSettings,
        symbol: str,
        start: date,
        end: date,
        fetched_at: datetime,
) -> tuple[tuple[PeObservation, ...], str]:
    """Fetch Longbridge's current P/E and bind it to the request date.

    ``calc-index`` returns a current snapshot without an observation timestamp.
    The provider therefore uses the request's market-local date as a conservative
    availability boundary and excludes the snapshot from earlier backtests.
    """
    arguments = [
        "calc-index",
        symbol,
        "--fields",
        "pe",
        "--format",
        "json",
    ]
    payload = _run_readonly_cli(settings, arguments, timeout_seconds=45)
    observed_at = _market_local_trading_day(fetched_at, symbol)
    if not _is_in_window(observed_at, start, end):
        return (), _display_command(arguments)

    observations: dict[datetime, PeObservation] = {}
    source = "longbridge-cli:calc-index:pe"
    for row in _dynamic_pe_rows(payload):
        value = _finite_float(row.get("pe", row.get("value")))
        if value is None:
            continue
        observations[observed_at] = PeObservation(
            observed_at=observed_at,
            value=value,
            source=source,
        )
    return tuple(observations[key] for key in sorted(observations)), _display_command(arguments)


def _option_history_count(start: date, fetched_at: datetime) -> int:
    calendar_days = max(0, (fetched_at.date() - start).days)
    return min(OPTION_HISTORY_MAX_DAYS, max(20, calendar_days + 15))


def _fetch_option_history(
        settings: BrokerSettings,
        symbol: str,
        start: date,
        end: date,
        fetched_at: datetime,
) -> tuple[tuple[OptionVolumeObservation, ...], str]:
    arguments = [
        "option",
        "volume",
        "daily",
        symbol,
        "--count",
        str(_option_history_count(start, fetched_at)),
        "--format",
        "json",
    ]
    payload = _run_readonly_cli(settings, arguments, timeout_seconds=45)
    source = "longbridge-cli:option-volume-daily"
    observations: dict[datetime, OptionVolumeObservation] = {}
    for row in _extract_rows(payload, "stats", "history", "data"):
        parsed_observed_at = _parse_observed_at(
            row.get("timestamp", row.get("time", row.get("date")))
        )
        observed_at = (
            _market_local_trading_day(parsed_observed_at, symbol)
            if parsed_observed_at is not None
            else None
        )
        if observed_at is None or not _is_in_window(observed_at, start, end):
            continue
        observation = OptionVolumeObservation(
            observed_at=observed_at,
            put_call_volume_ratio=_finite_float(
                row.get("put_call_volume_ratio", row.get("pc_ratio"))
            ),
            put_call_open_interest_ratio=_finite_float(
                row.get("put_call_open_interest_ratio")
            ),
            call_volume=_finite_float(row.get("total_call_volume", row.get("call_vol"))),
            put_volume=_finite_float(row.get("total_put_volume", row.get("put_vol"))),
            total_volume=_finite_float(row.get("total_volume")),
            call_open_interest=_finite_float(row.get("total_call_open_interest")),
            put_open_interest=_finite_float(row.get("total_put_open_interest")),
            total_open_interest=_finite_float(row.get("total_open_interest")),
            source=source,
        )
        if not any(
            value is not None
            for value in (
                observation.put_call_volume_ratio,
                observation.put_call_open_interest_ratio,
                observation.call_volume,
                observation.put_volume,
                observation.total_volume,
                observation.call_open_interest,
                observation.put_open_interest,
                observation.total_open_interest,
            )
        ):
            continue
        observations[observed_at] = observation
    return tuple(observations[key] for key in sorted(observations)), _display_command(arguments)


def _iter_payload_rows(payload: Any) -> list[dict[str, Any]]:
    """Flatten Longbridge JSON containers while retaining mapping rows only."""
    rows: list[dict[str, Any]] = []
    if isinstance(payload, list):
        for value in payload:
            rows.extend(_iter_payload_rows(value))
        return rows
    if not isinstance(payload, dict):
        return rows
    timestamp_keys = {
        "available_at", "availability_date", "published_at", "publication_date",
        "disclosed_at", "filing_date", "announcement_date", "release_date",
        "timestamp", "time", "date", "date_time", "updated_at",
        # Keep period keys in the traversal set so rows that also carry an
        # availability key are still discovered. They are deliberately not
        # accepted by _research_timestamp below.
        "report_date", "report_period", "period", "end_date", "period_end",
        "holding_date",
    }
    if timestamp_keys.intersection(payload):
        rows.append(payload)
    for value in payload.values():
        if isinstance(value, (dict, list)):
            rows.extend(_iter_payload_rows(value))
    return rows


def _research_timestamp(
        row: Mapping[str, Any],
        factor: str | None = None,
) -> datetime | None:
    """Return a time at which a research observation was knowable.

    Ownership and fund payloads sometimes call a report-period end a
    ``filing_date``. That label is not an availability timestamp, so it is
    deliberately excluded. The default is disclosure-only, which keeps direct
    callers safe. The few historical time-series factors may explicitly opt
    into their provider observation timestamp.
    """
    timestamp_keys = _DISCLOSURE_TIMESTAMP_KEYS
    if factor in {
        "pb_ratio",
        "ps_ratio",
        "dividend_yield",
        "market_temperature",
    }:
        # Prefer an explicit disclosure timestamp even for a historical
        # series. A bare ``date`` is usable only when the row does not also
        # advertise itself as a report-period payload; that combination is
        # ambiguous and must fail closed.
        timestamp_keys = _DISCLOSURE_TIMESTAMP_KEYS + tuple(
            key
            for key in _HISTORICAL_OBSERVATION_TIMESTAMP_KEYS
            if key != "date" or not any(
                report_key in row
                for report_key in (
                    "report_date",
                    "report_period",
                    "period",
                    "end_date",
                    "period_end",
                    "filing_date",
                )
            )
        )
    for key in timestamp_keys:
        parsed = _parse_observed_at(row.get(key))
        if parsed is not None:
            return parsed
    return None


def _research_value(row: Mapping[str, Any], factor: str) -> float | None:
    for key in _RESEARCH_VALUE_KEYS.get(factor, ("value",)):
        value = _finite_float(row.get(key))
        if value is None:
            raw = str(row.get(key, "")).strip().replace(",", "")
            if raw.endswith("%"):
                try:
                    value = float(raw[:-1].lstrip("<>").strip())
                except ValueError:
                    value = None
        if value is not None:
            return value
    return None


def _research_observations(
        payload: Any,
        *,
        symbol: str,
        start: date,
        end: date,
        factor: str,
        source: str,
) -> tuple[ResearchFactorObservation, ...]:
    observations: dict[datetime, ResearchFactorObservation] = {}
    shareholder_values: dict[datetime, dict[str, float]] = {}
    for row in _iter_payload_rows(payload):
        parsed_timestamp = _research_timestamp(row, factor)
        value = _research_value(row, factor)
        if parsed_timestamp is None or value is None:
            continue
        observed_at = _market_local_trading_day(parsed_timestamp, symbol)
        if not _is_in_window(observed_at, start, end):
            continue
        if factor == "shareholder_concentration":
            # Top-holder payloads commonly repeat a current "Latest" group
            # beside the same quarterly group. Preserve the first value for
            # each real holder instead of accidentally summing that duplicate
            # group or replacing the whole factor with the last holder.
            holder_key = str(
                row.get("object_id") or row.get("name") or ""
            ).strip()
            if not holder_key:
                continue
            shareholder_values.setdefault(observed_at, {}).setdefault(
                holder_key,
                value,
            )
            continue
        observations[observed_at] = ResearchFactorObservation(
            observed_at=observed_at,
            factor=factor,
            value=value,
            source=source,
        )
    if factor == "shareholder_concentration":
        for observed_at, values_by_holder in shareholder_values.items():
            # The factor is an explicit Top-20 reported ownership sum in
            # percent, not a last-row shareholder percentage or an invented
            # whole-market ownership statistic.
            observations[observed_at] = ResearchFactorObservation(
                observed_at=observed_at,
                factor=factor,
                value=float(sum(values_by_holder.values())),
                source=source,
            )
    return tuple(observations[key] for key in sorted(observations))


def _market_from_symbol(symbol: str) -> str:
    return symbol.rsplit(".", 1)[-1]


def _research_command(
        factor: str,
        symbol: str,
        start: date,
        end: date,
        fetched_at: datetime,
) -> list[str] | None:
    if factor in {"pb_ratio", "ps_ratio", "dividend_yield"}:
        indicator = {
            "pb_ratio": "pb",
            "ps_ratio": "ps",
            "dividend_yield": "dvd_yld",
        }[factor]
        return [
            "valuation", symbol, "--history", "--indicator", indicator,
            "--range", str(_history_range_years(start, fetched_at)), "--format", "json",
        ]
    if factor == "market_temperature":
        return [
            "market-temp", _market_from_symbol(symbol), "--history",
            "--start", start.isoformat(), "--end", end.isoformat(), "--format", "json",
        ]
    if factor == "capital_flow":
        return ["capital", symbol, "--flow", "--format", "json"]
    if factor == "shareholder_concentration":
        return [
            "shareholder", symbol, "--top", "--periods", "8", "--format", "json",
        ]
    if factor == "fund_holder_weight":
        return ["fund-holder", symbol, "--count", "-1", "--format", "json"]
    if factor == "short_interest":
        return ["short-positions", symbol, "--count", "100", "--format", "json"]
    if factor == "short_volume":
        return ["short-trades", symbol, "--count", "100", "--format", "json"]
    if factor == "broker_holding":
        return ["broker-holding", symbol, "--format", "json"]
    return None


def _fetch_research_history(
        settings: BrokerSettings,
        symbol: str,
        start: date,
        end: date,
        fetched_at: datetime,
        requested_factors: Sequence[str],
) -> tuple[tuple[ResearchFactorObservation, ...], dict[str, str], list[str]]:
    observations: list[ResearchFactorObservation] = []
    statuses: dict[str, str] = {}
    commands: list[str] = []
    for factor in dict.fromkeys(str(item) for item in requested_factors):
        if factor not in RESEARCH_FACTOR_KEYS:
            statuses[factor] = "unsupported"
            continue
        if factor == "broker_holding" and not symbol.endswith(".HK"):
            statuses[factor] = "unsupported_market"
            continue
        if factor in _UNSUPPORTED_HISTORY_FACTORS:
            statuses[factor] = "unsupported_history"
            continue
        if factor in _UNAVAILABLE_POINT_IN_TIME_FACTORS:
            statuses[factor] = "unavailable_point_in_time"
            continue
        arguments = _research_command(factor, symbol, start, end, fetched_at)
        if arguments is None:
            statuses[factor] = "unsupported"
            continue
        commands.append(_display_command(arguments))
        try:
            payload = _run_readonly_cli(settings, arguments, timeout_seconds=45)
            parsed = _research_observations(
                payload,
                symbol=symbol,
                start=start,
                end=end,
                factor=factor,
                source=f"longbridge-cli:{factor}",
            )
            observations.extend(parsed)
            statuses[factor] = "available" if parsed else "missing"
        except Exception:
            LOGGER.warning("Longbridge CLI research factor %s was unavailable for %s.", factor, symbol)
            statuses[factor] = "error"
    return tuple(observations), statuses, commands


def _fingerprint_payload(
        *,
        symbol: str,
        start: date,
        end: date,
        ohlcv: tuple[OhlcvBar, ...],
        pe_history: tuple[PeObservation, ...],
        dynamic_pe_history: tuple[PeObservation, ...],
        option_history: tuple[OptionVolumeObservation, ...],
        research_history: tuple[ResearchFactorObservation, ...],
        factor_status: dict[str, str],
        source_commands: tuple[str, ...],
) -> str:
    def timestamp(value: datetime) -> str:
        if value.tzinfo is None:
            return value.isoformat()
        return value.astimezone(UTC).isoformat()

    canonical = {
        "symbol": symbol,
        "start": start.isoformat(),
        "end": end.isoformat(),
        "ohlcv": [
            {
                "observed_at": timestamp(row.observed_at),
                "open": row.open,
                "high": row.high,
                "low": row.low,
                "close": row.close,
                "volume": row.volume,
                "turnover": row.turnover,
                "source": row.source,
            }
            for row in ohlcv
        ],
        "pe_history": [
            {
                "observed_at": timestamp(row.observed_at),
                "value": row.value,
                "source": row.source,
            }
            for row in pe_history
        ],
        "dynamic_pe_history": [
            {
                "observed_at": timestamp(row.observed_at),
                "value": row.value,
                "source": row.source,
            }
            for row in dynamic_pe_history
        ],
        "option_history": [
            {
                "observed_at": timestamp(row.observed_at),
                "put_call_volume_ratio": row.put_call_volume_ratio,
                "put_call_open_interest_ratio": row.put_call_open_interest_ratio,
                "call_volume": row.call_volume,
                "put_volume": row.put_volume,
                "total_volume": row.total_volume,
                "call_open_interest": row.call_open_interest,
                "put_open_interest": row.put_open_interest,
                "total_open_interest": row.total_open_interest,
                "source": row.source,
            }
            for row in option_history
        ],
        "research_history": [
            {
                "observed_at": timestamp(row.observed_at),
                "factor": row.factor,
                "value": row.value,
                "source": row.source,
            }
            for row in research_history
        ],
        "factor_status": factor_status,
        "source_commands": source_commands,
    }
    encoded = json.dumps(
        canonical,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _settings_cache_identity(settings: BrokerSettings) -> tuple[str, str, str]:
    return (
        settings.longbridge_auth_mode,
        settings.longbridge_cli_path,
        settings.longbridge_cli_home,
    )


def fetch_bayesian_factor_bundle(
        symbol: str,
        start: date | datetime | str,
        end: date | datetime | str,
        *,
        settings: BrokerSettings | None = None,
        include_pe: bool = True,
        include_dynamic_pe: bool = False,
        include_options: bool = True,
        research_factors: Sequence[str] = (),
        ttl_seconds: float = DEFAULT_CACHE_TTL_SECONDS,
) -> BayesianFactorBundle:
    """Fetch a time-bounded, read-only factor bundle from Longbridge CLI OAuth."""
    normalized_symbol = _normalize_symbol(symbol)
    normalized_start = _coerce_date(start, "start", normalized_symbol)
    normalized_end = _coerce_date(end, "end", normalized_symbol)
    if normalized_start > normalized_end:
        raise ValueError("start must not be after end.")

    broker_settings = settings or load_broker_settings()
    normalized_ttl = max(0.0, float(ttl_seconds))
    normalized_research_factors = tuple(
        sorted(dict.fromkeys(str(item) for item in (research_factors or ())))
    )
    cache_key = (
        normalized_symbol,
        normalized_start,
        normalized_end,
        bool(include_pe),
        bool(include_dynamic_pe),
        bool(include_options),
        normalized_research_factors,
        normalized_ttl,
        *_settings_cache_identity(broker_settings),
    )
    now_monotonic = time.monotonic()
    owns_flight = False
    with _CACHE_LOCK:
        _prune_bundle_cache_locked(now_monotonic)
        if normalized_ttl > 0:
            cached = _BUNDLE_CACHE.get(cache_key)
            if cached is not None:
                _BUNDLE_CACHE.move_to_end(cache_key)
                return cached[1]

        flight = _BUNDLE_IN_FLIGHT.get(cache_key)
        if flight is None:
            flight = Future()
            _BUNDLE_IN_FLIGHT[cache_key] = flight
            owns_flight = True

    if not owns_flight:
        bundle = flight.result()
        if normalized_ttl > 0:
            with _CACHE_LOCK:
                resumed_at = time.monotonic()
                _prune_bundle_cache_locked(resumed_at)
                if cache_key not in _BUNDLE_CACHE:
                    _store_bundle_cache_locked(
                        cache_key,
                        resumed_at + normalized_ttl,
                        bundle,
                    )
        return bundle

    try:
        fetched_at = _utc_now()
        ohlcv, source_commands_list = _fetch_ohlcv(
            broker_settings,
            normalized_symbol,
            normalized_start,
            normalized_end,
        )
        factor_status = {"ohlcv": "available" if ohlcv else "missing"}

        pe_history: tuple[PeObservation, ...] = ()
        if not include_pe:
            factor_status["pe"] = "disabled"
        else:
            try:
                pe_history, pe_command = _fetch_pe_history(
                    broker_settings,
                    normalized_symbol,
                    normalized_start,
                    normalized_end,
                    fetched_at,
                )
                source_commands_list.append(pe_command)
                factor_status["pe"] = "available" if pe_history else "missing"
            except Exception:
                LOGGER.warning(
                    "Longbridge CLI P/E history was unavailable for %s.",
                    normalized_symbol,
                )
                factor_status["pe"] = "error"

        dynamic_pe_history: tuple[PeObservation, ...] = ()
        if not include_dynamic_pe:
            factor_status["dynamic_pe"] = "disabled"
        else:
            try:
                dynamic_pe_history, dynamic_pe_command = _fetch_dynamic_pe_history(
                    broker_settings,
                    normalized_symbol,
                    normalized_start,
                    normalized_end,
                    fetched_at,
                )
                source_commands_list.append(dynamic_pe_command)
                factor_status["dynamic_pe"] = (
                    "available" if dynamic_pe_history else "missing"
                )
            except Exception:
                LOGGER.warning(
                    "Longbridge CLI dynamic P/E was unavailable for %s.",
                    normalized_symbol,
                )
                factor_status["dynamic_pe"] = "error"

        option_history: tuple[OptionVolumeObservation, ...] = ()
        if not include_options:
            factor_status["options"] = "disabled"
        elif not normalized_symbol.endswith(".US"):
            factor_status["options"] = "unsupported_market"
        else:
            try:
                option_history, option_command = _fetch_option_history(
                    broker_settings,
                    normalized_symbol,
                    normalized_start,
                    normalized_end,
                    fetched_at,
                )
                source_commands_list.append(option_command)
                factor_status["options"] = "available" if option_history else "missing"
            except Exception:
                LOGGER.warning(
                    "Longbridge CLI option-volume history was unavailable for %s.",
                    normalized_symbol,
                )
                factor_status["options"] = "error"

        research_history, research_status, research_commands = _fetch_research_history(
            broker_settings,
            normalized_symbol,
            normalized_start,
            normalized_end,
            fetched_at,
            normalized_research_factors,
        )
        factor_status.update(research_status)
        source_commands_list.extend(research_commands)

        source_commands = tuple(source_commands_list)
        fingerprint = _fingerprint_payload(
            symbol=normalized_symbol,
            start=normalized_start,
            end=normalized_end,
            ohlcv=ohlcv,
            pe_history=pe_history,
            dynamic_pe_history=dynamic_pe_history,
            option_history=option_history,
            research_history=research_history,
            factor_status=factor_status,
            source_commands=source_commands,
        )
        bundle = BayesianFactorBundle(
            symbol=normalized_symbol,
            start=normalized_start,
            end=normalized_end,
            ohlcv=ohlcv,
            pe_history=pe_history,
            dynamic_pe_history=dynamic_pe_history,
            option_history=option_history,
            fetched_at=fetched_at,
            fingerprint=fingerprint,
            factor_status=MappingProxyType(dict(factor_status)),
            source_commands=source_commands,
            research_history=research_history,
        )
    except BaseException as exc:
        flight.set_exception(exc)
        with _CACHE_LOCK:
            _BUNDLE_IN_FLIGHT.pop(cache_key, None)
        raise

    with _CACHE_LOCK:
        completed_at = time.monotonic()
        _prune_bundle_cache_locked(completed_at)
        if normalized_ttl > 0:
            _store_bundle_cache_locked(
                cache_key,
                completed_at + normalized_ttl,
                bundle,
            )
    flight.set_result(bundle)
    with _CACHE_LOCK:
        _BUNDLE_IN_FLIGHT.pop(cache_key, None)
    return bundle
