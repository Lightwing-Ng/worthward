"""One-to-one IBKR execution evidence reconciliation.

Code version: v0.1.0
"""

from typing import Any

from app.services.investment.importing import basics
from app.services.investment.importing.support import _normalize_text, normalize_ticker


def closed_lot_match_rank(current, incoming) -> int:
    """Prefer an evidenced execution time and reject a conflicting occurrence."""
    from app.services.investment.importing.merge import identity

    if not identity._is_ibkr_csv_gainskeeper_precision_pair(current, incoming):
        return 1
    csv, official = (
        (current, incoming)
        if (current.get("source") or {}).get("file_kind") == "transactions"
        else (incoming, current)
    )
    timestamp = _normalize_text(
        (csv.get("source") or {}).get("closed_lot_trade_datetime")
    ).replace(", ", " ")
    if not timestamp:
        return 1
    return 0 if timestamp == official.get("datetime") else 2


def merge_closed_trade_metadata(existing, incoming) -> None:
    from app.services.investment.importing.merge import identity

    official = [
        row
        for row in (*existing, *incoming)
        if identity._is_ibkr_source_stock_trade(row, file_kind="gainskeeper")
    ]
    csv_trades = [
        row
        for row in (*existing, *incoming)
        if identity._is_ibkr_source_stock_trade(row, file_kind="transactions")
    ]
    csv = [row for row in csv_trades if identity._has_ibkr_closed_trade_metadata(row)]
    incoming_ids = {id(row) for row in incoming}
    claimed: set[int] = set()

    def source_time(row):
        return _normalize_text(
            (row.get("source") or {}).get("closed_lot_trade_datetime")
        ).replace(", ", " ")

    def can_attribute(official_row, csv_row):
        return identity._is_ibkr_csv_gainskeeper_equivalent_stock_trade(
            official_row, csv_row
        ) and (
            not source_time(csv_row)
            or source_time(csv_row) == official_row.get("datetime")
        )

    for record in official:
        if identity._has_ibkr_closed_trade_metadata(record):
            continue
        key = identity._ibkr_source_fitid_identity_key(record)
        prior_ambiguity = any(
            key
            and identity._ibkr_source_fitid_identity_key(other) == key
            and (other.get("source") or {}).get("closed_trade_metadata_status")
            == "ambiguous"
            for other in official
        )
        # A leftover CSV occurrence is not a new complete evidence set. Replaying
        # the same authoritative execution cannot resolve its earlier ambiguity.
        if prior_ambiguity and not any(
            id(row) in incoming_ids
            and identity._is_ibkr_csv_gainskeeper_equivalent_stock_trade(record, row)
            for row in csv
        ):
            record.setdefault("source", {})["closed_trade_metadata_status"] = (
                "ambiguous"
            )
            continue
        candidates = [
            row
            for row in csv
            if id(row) not in claimed
            and identity._is_ibkr_csv_gainskeeper_equivalent_stock_trade(record, row)
        ]
        eligible = [row for row in candidates if can_attribute(record, row)]
        precise = [row for row in eligible if source_time(row)]
        eligible = precise or eligible
        if len(eligible) != 1:
            if candidates:
                record.setdefault("source", {})["closed_trade_metadata_status"] = (
                    "ambiguous" if eligible else "unmatched"
                )
            continue
        row = eligible[0]
        if (
            not source_time(row)
            and sum(
                identity._is_ibkr_csv_gainskeeper_equivalent_stock_trade(record, other)
                for other in csv_trades
            )
            != 1
        ):
            record.setdefault("source", {})["closed_trade_metadata_status"] = (
                "ambiguous"
            )
            continue
        possible_executions = {
            identity._ibkr_source_fitid_identity_key(other) or (id(other),)
            for other in official
            if can_attribute(other, row)
        }
        if len(possible_executions) != 1:
            record.setdefault("source", {})["closed_trade_metadata_status"] = (
                "ambiguous"
            )
            continue
        claimed.add(id(row))
        record.setdefault("source", {}).pop("closed_trade_metadata_status", None)
        merged = identity._merge_transaction_records(record, row)
        record.clear()
        record.update(merged)


def remove_superseded_csv_trades(
    existing: list[dict[str, Any]],
    incoming: list[dict[str, Any]],
    artifacts: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], int]:
    from app.services.investment.importing.merge import identity

    merge_closed_trade_metadata(existing, incoming)
    official = [
        row
        for row in incoming
        if identity._is_ibkr_source_stock_trade(row, file_kind="gainskeeper")
    ]
    coverage: dict[tuple[str, str], list[tuple[str, str]]] = {}
    for record in official:
        source = record.get("source") or {}
        account = basics._account_identity_token(
            "ibkr", record.get("account") or source.get("account")
        )
        ticker = normalize_ticker(_normalize_text(record.get("ticker")))
        filename = _normalize_text(source.get("source_filename"))
        for artifact in artifacts:
            if artifact.get("source_kind") != "ibkr_gainskeeper_ofx_gkx":
                continue
            if (
                basics._account_identity_token("ibkr", artifact.get("account"))
                != account
            ):
                continue
            names = artifact.get("filenames") or [artifact.get("filename")]
            if not filename or filename not in names:
                continue
            start = _normalize_text(artifact.get("statement_period_start"))
            end = _normalize_text(artifact.get("statement_period_end"))
            if start and end and start <= end:
                coverage.setdefault((account, ticker), []).append((start, end))
    retained = []
    claimed_legacy: set[int] = set()
    for record in existing:
        if record.get("type") == "dividend_reinvestment":
            legacy = next(
                (
                    row
                    for row in official
                    if id(row) not in claimed_legacy
                    and identity._is_ibkr_legacy_transaction_gainskeeper_match(
                        record, row
                    )
                ),
                None,
            )
            if legacy is not None:
                claimed_legacy.add(id(legacy))
                continue
        if not identity._is_ibkr_source_stock_trade(record, file_kind="transactions"):
            retained.append(record)
            continue
        # Economic matches are merged once by the occurrence-aware matcher.
        # Removing them here would let its second pass consume surplus fills.
        if any(
            identity._is_ibkr_csv_gainskeeper_equivalent_stock_trade(record, row)
            for row in official
        ):
            retained.append(record)
            continue
        source = record.get("source") or {}
        account = basics._account_identity_token(
            "ibkr", record.get("account") or source.get("account")
        )
        ticker = normalize_ticker(_normalize_text(record.get("ticker")))
        day = identity._ibkr_stock_identity_date_token(record, source)
        if not any(
            start <= day <= end for start, end in coverage.get((account, ticker), [])
        ):
            retained.append(record)
    return retained, len(existing) - len(retained)
