"""Keep anonymous Schwab transfer provenance stable across repeated exports.

Code version: v1.0.0
"""

from __future__ import annotations

import base64
from copy import deepcopy

from app.services.investment.importing.bindings import (
    _investment_internal_transfer_source_identity,
)
from app.services.investment_import import (
    build_investment_payload_from_schwab_csv,
    merge_investment_payloads,
)
from tests.python.services.test_schwab_provisional_reconciliation import buy_csv_payload


def _transfer(payload):
    return next(
        row
        for row in payload["transactions"]
        if row.get("type") == "transfer_in" and row.get("ticker") == "QQQI"
    )


def test_reordered_schwab_export_starts_with_canonical_alias_and_reimports_unchanged():
    first = buy_csv_payload()
    complete = buy_csv_payload(
        buys=(("10/13/2026", "52.15", "0"), ("10/13/2026", "51.50", "0")),
        positions_time="09:01 AM",
    )
    transaction_artifact = next(
        item
        for item in complete["source_artifacts"]
        if item["source_kind"] == "schwab_transactions_csv"
    )
    position_artifact = next(
        item
        for item in complete["source_artifacts"]
        if item["source_kind"] == "schwab_positions_csv"
    )
    original_lines = (
        base64.b64decode(transaction_artifact["content_base64"]).decode().splitlines()
    )
    reordered_bytes = (
        "\n".join([original_lines[0], *reversed(original_lines[1:])]) + "\n"
    ).encode()
    second = build_investment_payload_from_schwab_csv(
        reordered_bytes,
        base64.b64decode(position_artifact["content_base64"]),
        transaction_filename=transaction_artifact["filename"],
        positions_filename=position_artifact["filename"],
    )
    old_identity = _investment_internal_transfer_source_identity(_transfer(first))
    new_identity = _investment_internal_transfer_source_identity(_transfer(second))
    assert old_identity[3] == "2"
    assert new_identity[3] == "4"
    assert (
        next(
            item["sha256"]
            for item in second["source_artifacts"]
            if item["source_kind"] == "schwab_positions_csv"
        )
        == position_artifact["sha256"]
    )

    merged = merge_investment_payloads(first, second)

    transfer = _transfer(merged)
    aliases = transfer["source"]["transfer_source_identity_aliases"]
    assert aliases[0] == _investment_internal_transfer_source_identity(transfer)
    assert {tuple(alias) for alias in aliases} == {
        tuple(old_identity),
        tuple(new_identity),
    }
    expected_artifacts = {
        item["sha256"]
        for payload in (first, second)
        for item in payload["source_artifacts"]
    }
    assert len(expected_artifacts) == 4
    assert {item["sha256"] for item in merged["source_artifacts"]} == expected_artifacts
    first_transactions = deepcopy(merged["transactions"])

    repeated = merge_investment_payloads(merged, second)

    assert repeated["transactions"] == first_transactions
    assert len(repeated["transactions"]) == 3
    assert {
        item["sha256"] for item in repeated["source_artifacts"]
    } == expected_artifacts
