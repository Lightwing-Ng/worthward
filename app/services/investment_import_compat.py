"""Compatibility bridge for patchable investment-import dependencies.

Code version: v0.1.0
"""

from __future__ import annotations

from typing import Any

from app.core.broker_settings import BrokerSettings


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
