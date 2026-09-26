"""Compatibility bridge for patchable investment-import dependencies.

`investment_import.py` is a stable import facade: broker parsing, statement
evidence, merge identity, reconciliation, and payload summaries live in bounded
`investment/importing/` domain modules, and the facade re-exports them.

A few of those domain functions are also *patch seams*. Production code and
tests both address them at the facade, so a domain module that needs one must
resolve it through the facade at call time instead of binding the owning
module's function at import time. This module is that indirection, and nothing
else: every function here is a one-line late-bound forward.

Each seam is declared in `PATCHABLE_SEAMS` together with the module that really
owns the implementation. `tests/python/architecture/test_investment_import_compat_boundary.py`
proves that every declared seam still resolves to its owner when unpatched and
is still observed through this bridge when patched, so a silent move of a patch
target fails the gate instead of a broker import.

This module holds no parsing, reconciliation, deduplication, cash-replay, or
commit behavior of its own.

Code version: v0.2.1
"""

from __future__ import annotations

from typing import Any

from app.core.preferences.broker import BrokerSettings


# seam name -> module that owns the implementation behind the facade re-export.
PATCHABLE_SEAMS: dict[str, str] = {
    "_load_local_private_investment_evidence": (
        "app.services.investment.importing.basics"
    ),
    "_extract_statement_pdf_text": "app.services.investment.importing.brokers.usmart_tiger",
    "run_longbridge_cli_json": "app.infrastructure.longbridge_cli",
    "get_longbridge_cli_auth_status": "app.infrastructure.longbridge_cli",
    "_has_same_hsbc_cash_source_row": (
        "app.services.investment.importing.payload_summaries"
    ),
    "build_investment_internal_transfer_binding_index": (
        "app.services.investment.importing.bindings"
    ),
}


def load_local_private_investment_evidence() -> dict[str, Any]:
    from app.services import investment_import

    return investment_import._load_local_private_investment_evidence()


def extract_statement_pdf_text(pdf_bytes: bytes, broker_label: str) -> str:
    from app.services import investment_import

    return investment_import._extract_statement_pdf_text(pdf_bytes, broker_label)


def run_longbridge_cli_json(
    settings: BrokerSettings,
    arguments: list[str],
    *,
    timeout_seconds: int = 30,
) -> dict[str, Any] | list[Any] | None:
    from app.services import investment_import

    return investment_import.run_longbridge_cli_json(
        settings,
        arguments,
        timeout_seconds=timeout_seconds,
    )


def get_longbridge_cli_auth_status(settings: BrokerSettings) -> dict[str, Any]:
    from app.services import investment_import

    return investment_import.get_longbridge_cli_auth_status(settings)


def has_same_hsbc_cash_source_row(
    left: dict[str, Any],
    right: dict[str, Any],
) -> bool:
    from app.services import investment_import

    return investment_import._has_same_hsbc_cash_source_row(left, right)


def build_investment_internal_transfer_binding_index(
    transactions: Any,
    *,
    base_key_counts: Any = None,
) -> dict[str, list[dict[str, Any]]]:
    from app.services import investment_import

    return investment_import.build_investment_internal_transfer_binding_index(
        transactions,
        base_key_counts=base_key_counts,
    )
