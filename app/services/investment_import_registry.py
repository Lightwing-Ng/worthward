"""Registry and commit boundaries for broker investment imports.

Code version: v1.2.0
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from copy import deepcopy
from dataclasses import dataclass
from typing import Any


InvestmentPayload = dict[str, Any]
InvestmentParser = Callable[..., InvestmentPayload]


def _normalize_key_part(value: object, field_name: str) -> str:
    normalized = str(value or "").strip().lower().replace("-", "_")
    if not normalized:
        raise ValueError(f"Investment import {field_name} is required.")
    return normalized


@dataclass(frozen=True, order=True)
class InvestmentParserKey:
    """Canonical broker and source-format identity for one parser."""

    broker: str
    source_format: str

    @classmethod
    def build(cls, broker: object, source_format: object) -> InvestmentParserKey:
        return cls(
            broker=_normalize_key_part(broker, "broker"),
            source_format=_normalize_key_part(source_format, "source format"),
        )


@dataclass(frozen=True)
class InvestmentParserRegistration:
    """Immutable metadata and callable for a registered parser."""

    key: InvestmentParserKey
    parser: InvestmentParser
    description: str


class InvestmentParserRegistry:
    """Explicit parser registry that prevents route-level broker dispatch drift."""

    def __init__(self) -> None:
        self._registrations: dict[InvestmentParserKey, InvestmentParserRegistration] = {}

    def register(
            self,
            broker: object,
            source_format: object,
            parser: InvestmentParser,
            *,
            description: str = "",
    ) -> None:
        key = InvestmentParserKey.build(broker, source_format)
        if not callable(parser):
            raise TypeError(f"Investment parser {key.broker}:{key.source_format} must be callable.")
        if key in self._registrations:
            raise ValueError(f"Investment parser {key.broker}:{key.source_format} is already registered.")
        self._registrations[key] = InvestmentParserRegistration(
            key=key,
            parser=parser,
            description=str(description or "").strip(),
        )

    def parse(self, broker: object, source_format: object, /, **parser_kwargs: Any) -> InvestmentPayload:
        key = InvestmentParserKey.build(broker, source_format)
        registration = self._registrations.get(key)
        if registration is None:
            raise ValueError(
                f"Unsupported investment import parser: {key.broker}:{key.source_format}."
            )
        payload = registration.parser(**parser_kwargs)
        return validate_investment_import_payload(payload, key=key)

    def registrations(self) -> tuple[InvestmentParserRegistration, ...]:
        return tuple(self._registrations[key] for key in sorted(self._registrations))


def validate_investment_import_payload(
        payload: object,
        *,
        key: InvestmentParserKey | None = None,
) -> InvestmentPayload:
    """Validate the shared payload boundary without inventing missing records."""
    context = f" for {key.broker}:{key.source_format}" if key else ""
    if not isinstance(payload, dict):
        raise TypeError(f"Investment parser{context} must return a dictionary payload.")
    transactions = payload.get("transactions")
    if not isinstance(transactions, list):
        raise ValueError(f"Investment parser{context} must return a transactions list.")
    if any(not isinstance(record, dict) for record in transactions):
        raise ValueError(f"Investment parser{context} returned a non-dictionary transaction.")
    return payload


def commit_investment_import(
        imported_payload: InvestmentPayload,
        *,
        normalize_payload: Callable[[InvestmentPayload], InvestmentPayload],
        merge_payloads: Callable[[InvestmentPayload, InvestmentPayload], InvestmentPayload],
        update_store: Callable[
            [Callable[[dict[str, object]], tuple[dict[str, object], InvestmentPayload]]],
            InvestmentPayload,
        ],
        load_store: Callable[[], InvestmentPayload],
        invalidate_cache: Callable[[], None],
        materialize_payload: Callable[[InvestmentPayload], InvestmentPayload],
        verify_persisted_payload: Callable[[InvestmentPayload], None],
) -> InvestmentPayload:
    """Atomically normalize, idempotently merge, persist, and verify one import."""
    if not callable(materialize_payload):
        raise TypeError("Investment import requires a source-evidence materializer.")
    if not callable(verify_persisted_payload):
        raise TypeError("Investment import requires a persisted source-evidence verifier.")
    normalized_import = normalize_payload(deepcopy(validate_investment_import_payload(imported_payload)))

    def merge_current_payload(
            current_payload: dict[str, object],
    ) -> tuple[dict[str, object], InvestmentPayload]:
        normalized_current = normalize_payload(dict(current_payload))
        merged_payload = merge_payloads(normalized_current, normalized_import)
        merged_payload = materialize_payload(merged_payload)
        normalized_merged = normalize_payload(merged_payload)
        validate_investment_import_payload(normalized_merged)
        return normalized_merged, normalized_merged

    committed_payload = update_store(merge_current_payload)
    invalidate_cache()
    persisted_payload = normalize_payload(load_store())
    validate_investment_import_payload(persisted_payload)
    for section_name in ("transactions", "source_artifacts", "broker_snapshots"):
        if persisted_payload.get(section_name) == committed_payload.get(section_name):
            continue
        raise RuntimeError(
            f"Investment import store readback did not match committed {section_name}."
        )
    verify_persisted_payload(persisted_payload)
    return persisted_payload


def build_registry_from_parsers(
        parsers: Mapping[tuple[str, str], InvestmentParser],
) -> InvestmentParserRegistry:
    """Build a registry from an explicit mapping for tests and composition roots."""
    registry = InvestmentParserRegistry()
    for (broker, source_format), parser in parsers.items():
        registry.register(broker, source_format, parser)
    return registry
