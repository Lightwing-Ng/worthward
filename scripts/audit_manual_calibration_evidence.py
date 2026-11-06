#!/usr/bin/env python3
"""Audit manual performance scopes against immutable-source linkage, read-only.

Code version: v1.1.0
"""

from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
import hashlib
import json
import os
from pathlib import Path
import re
import sys
from xml.etree import ElementTree
from zipfile import ZipFile

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

MANUAL_SOURCE = "user_confirmed_broker_performance_calibration"
PRIVATE_KEYS = {
    "longbridge_hk": "longbridge_hk_performance_calibrations",
    "longbridge_sg": "longbridge_sg_performance_calibrations",
}
XML_NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
SOURCE_OCCURRENCE_FIELDS = (
    "file_kind", "source_filename", "filename", "source_path", "source_file_path",
    "row_number", "fund_details_entry_number", "cash_flow_contract_row_number",
    "cash_flow_contract_row_numbers", "history_order_row_number", "history_order_id",
)


def sha256_file(path: Path) -> str:
    expected = path.stat().st_size
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        remaining = expected
        while remaining:
            chunk = handle.read(min(64 * 1024, remaining))
            if not chunk:
                raise OSError("A source read was incomplete; its contents were not classified as corrupt.")
            digest.update(chunk)
            remaining -= len(chunk)
    return digest.hexdigest()


def path_is_within(path: Path, root: Path) -> bool:
    """Conservatively treat case aliases as one protected path on every host."""
    path_parts = tuple(part.casefold() for part in path.resolve().parts)
    root_parts = tuple(part.casefold() for part in root.resolve().parts)
    return path_parts[:len(root_parts)] == root_parts


def _text(value) -> str:
    return str(value).strip() if value is not None else ""


def _ticker(value) -> str:
    value = _text(value).upper()
    return value[:-3] if value.endswith(".US") else value


def _money_equal(left, right) -> bool:
    try:
        lhs, rhs = Decimal(_text(left).replace(",", "")), Decimal(_text(right).replace(",", ""))
        return lhs.is_finite() and rhs.is_finite() and lhs == rhs
    except (InvalidOperation, ValueError):
        return False


def _decimal(value):
    try:
        result = Decimal(_text(value).replace(",", ""))
        return result if result.is_finite() else None
    except (InvalidOperation, ValueError):
        return None


def _source_digests(source: dict) -> list[str]:
    return sorted({
        value.lower() for key, value in source.items()
        if ("sha256" in key or key == "storage_key") and isinstance(value, str)
        and re.fullmatch(r"[0-9a-fA-F]{64}", value)
    })


def _native_fund_records(path: Path) -> tuple[list[dict], dict]:
    lines = path.read_text(encoding="utf-8-sig").splitlines()
    starts = []
    amount_pattern = re.compile(r"^(-?[\d,]+\.\d+)\s+([A-Z]{3})$")
    for index in range(len(lines) - 2):
        if (
            lines[index].strip()
            and amount_pattern.fullmatch(lines[index + 1].strip())
            and re.fullmatch(r"\d{4}\.\d{2}\.\d{2}", lines[index + 2].strip())
        ):
            starts.append(index)
    records = []
    for ordinal, start in enumerate(starts):
        end = starts[ordinal + 1] if ordinal + 1 < len(starts) else len(lines)
        amount = amount_pattern.fullmatch(lines[start + 1].strip())
        extras = "\n".join(lines[start + 3:end])
        symbols = {
            _ticker(match.group(1)) for match in re.finditer(
                r"\b([A-Z0-9]+\.(?:US|HK|SH|SZ|SG))\b", extras, re.I,
            )
        }
        symbols.update(
            match.group(1).upper() for match in re.finditer(
                r"\b([A-Z][A-Z0-9]{0,15})\((?:US|HK)[A-Z0-9]+\)", extras, re.I,
            )
        )
        records.append({
            "entry_ordinal": ordinal + 1,
            "line_start": start + 1, "amount_line": start + 2, "date_line": start + 3,
            "line_end": end, "flow_name": lines[start].strip(),
            "amount_raw": amount.group(1), "currency": amount.group(2),
            "date": lines[start + 2].strip().replace(".", "-"),
            "explicit_symbols": sorted(symbols),
            "explicit_isin_identifiers": sorted(set(re.findall(
                r"\b[A-Z]{2}[A-Z0-9]{9}[0-9]\b", extras.upper(),
            ))),
            "share_quantity_occurrences": [
                {"line": line_number, "quantity_raw": match.group(1)}
                for line_number, line in enumerate(lines[start + 3:end], start=start + 4)
                if (match := re.search(r"(-?[\d,]+(?:\.\d+)?)\s+Shares\b", line, re.I))
            ],
        })
    text = "\n".join(lines)
    dates = sorted(row["date"] for row in records)
    return records, {
        "kind": "fund_details_cash_movements", "physical_line_count": len(lines),
        "record_count": len(records),
        "direct_realized_pnl_field": False,
        "performance_label_matches": re.findall(
            r"realized|unrealized|profit|loss|P&L|盈亏|損益|收益", text, re.I,
        ),
        "account_label_in_body": bool(re.search(r"account|账户|帳戶", text, re.I)),
        "explicit_opening_position_snapshot": False,
        "explicit_ending_position_snapshot": False,
        "full_lifetime_coverage_attestation": False,
        "observed_export_window": {"first": dates[0] if dates else "", "last": dates[-1] if dates else ""},
    }


def _native_order_rows(path: Path) -> tuple[list[dict], dict]:
    records, sheets, formulas = [], [], 0
    with ZipFile(path) as archive:
        shared = []
        if "xl/sharedStrings.xml" in archive.namelist():
            shared = [
                "".join(node.text or "" for node in item.findall(".//m:t", XML_NS))
                for item in ElementTree.fromstring(archive.read("xl/sharedStrings.xml"))
            ]
        book = ElementTree.fromstring(archive.read("xl/workbook.xml"))
        relationships = ElementTree.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
        targets = {item.attrib["Id"]: item.attrib["Target"] for item in relationships}
        for sheet in book.find("m:sheets", XML_NS):
            relation = sheet.attrib["{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"]
            target = targets[relation]
            member = target.lstrip("/") if target.startswith("/") else "xl/" + target
            rows = ElementTree.fromstring(archive.read(member)).findall(".//m:sheetData/m:row", XML_NS)
            parsed = []
            for row in rows:
                values = {}
                for cell in row:
                    if cell.find("m:f", XML_NS) is not None:
                        formulas += 1
                    raw = cell.find("m:v", XML_NS)
                    value = raw.text if raw is not None and raw.text is not None else ""
                    if cell.attrib.get("t") == "s" and value:
                        value = shared[int(value)]
                    elif cell.attrib.get("t") == "inlineStr":
                        value = "".join(item.text or "" for item in cell.findall(".//m:t", XML_NS))
                    values[re.sub(r"\d+$", "", cell.attrib["r"])] = value
                parsed.append((int(row.attrib["r"]), values))
            headers = parsed[0][1] if parsed else {}
            sheets.append({
                "name": sheet.attrib["name"], "xml_member": member,
                "data_rows": max(0, len(parsed) - 1), "headers": headers,
            })
            if sheet.attrib["name"] != "Orders":
                continue
            for row_number, values in parsed[1:]:
                named = {label: values.get(column, "") for column, label in headers.items()}
                raw_symbol, market = named.get("Symbol", ""), named.get("Market", "")
                symbol = _ticker(f"{raw_symbol}.{market}" if market else raw_symbol)
                dates = re.findall(r"\d{4}[-./]\d{2}[-./]\d{2}", named.get("Order Time", ""))
                records.append({
                    "sheet": sheet.attrib["name"], "row": row_number,
                    "symbol": symbol, "cells": {
                        label: f"{column}{row_number}" for column, label in headers.items()
                    },
                    "order_status": named.get("Order Status"), "currency": named.get("Currency"),
                    "direction": named.get("Direction"), "executed_quantity": named.get("Executed Qty"),
                    "average_price": named.get("Avg Price"), "turnover": named.get("Turnover"),
                    "order_time_raw": named.get("Order Time"), "order_id": named.get("Order No."),
                    "date": dates[0].replace(".", "-").replace("/", "-") if dates else "",
                })
    labels = [label for sheet in sheets for label in sheet["headers"].values()]
    return records, {
        "kind": "history_orders_and_execution_logs", "sheets": sheets,
        "formula_cells": formulas,
        "direct_realized_pnl_field": any(
            re.search(r"realized|profit|P&L|盈亏|損益", label, re.I) for label in labels
        ),
        "account_label_in_body": any(re.search(r"account|账户|帳戶", label, re.I) for label in labels),
        "explicit_opening_position_snapshot": False,
        "explicit_ending_position_snapshot": False,
        "full_lifetime_coverage_attestation": False,
    }


def review_native_originals(report: dict, broker_root: Path) -> list[Path]:
    """Attach exact native occurrences and bounded diagnostics, without inventing aliases."""
    originals = []
    by_broker = {}
    for broker, folder in (("longbridge_hk", "Longbridge HK"), ("longbridge_sg", "Longbridge SG")):
        sources = []
        for path in sorted((broker_root / folder).iterdir()):
            if not path.is_file() or path.suffix.lower() not in {".txt", ".xlsx"}:
                continue
            before = sha256_file(path)
            records, metadata = (
                _native_fund_records(path) if path.suffix.lower() == ".txt" else _native_order_rows(path)
            )
            account_match = re.search(r"(H\d{6,}|SG\d{6,})", path.name, re.I)
            source = {
                "path": str(path), "sha256": before, "byte_count": path.stat().st_size,
                "account_label_in_filename": account_match.group(1).upper() if account_match else "",
                "account_filename_is_not_body_identity_proof": True, "structure": metadata,
                "records": records,
            }
            if sha256_file(path) != before:
                raise RuntimeError("A native original changed during its read-only review.")
            sources.append(source)
            originals.append(path)
        by_broker[broker] = sources
    for item in report["items"]:
        symbol, currency = item["scope"]["ticker"], item["scope"]["currency"]
        observations = []
        for source in by_broker[item["scope"]["broker"]]:
            is_fund = source["structure"]["kind"] == "fund_details_cash_movements"
            rows = [row for row in source["records"] if (
                symbol in row["explicit_symbols"] or symbol in row["explicit_isin_identifiers"]
                if is_fund else row["symbol"] == symbol
            )]
            dates = sorted(row["date"] for row in rows if row.get("date"))
            account_label = source["account_label_in_filename"]
            observation = {
                key: source[key] for key in (
                    "path", "sha256", "byte_count", "account_label_in_filename",
                    "account_filename_is_not_body_identity_proof",
                )
            }
            observation.update({
                "structure": source["structure"], "matching_occurrence_count": len(rows),
                "observed_window": {"first": dates[0] if dates else "", "last": dates[-1] if dates else ""},
                "filename_account_equals_ledger_scope": account_label == item["scope"]["account"],
                "filename_account_equals_private_candidate": any(
                    account_label == candidate["account"] for candidate in item["private_mapping_candidates"]
                ),
                "source_occurrences": rows,
            })
            if is_fund:
                exact = [row for row in rows if row["currency"] == currency and (
                    row["explicit_symbols"] == [symbol] or row["explicit_isin_identifiers"] == [symbol]
                )]
                movement_sum = sum((Decimal(row["amount_raw"].replace(",", "")) for row in exact), Decimal("0"))
                observation["cash_movement_window_diagnostic"] = {
                    "measure": "sum of explicitly ticker-tagged cash movements; not certified realized P&L",
                    "currency": currency, "occurrences": len(exact),
                    "other_source_currencies": sorted({
                        row["currency"] for row in rows if row["currency"] != currency
                    }),
                    "currency_conversion_not_inferred": True,
                    "sum": str(movement_sum) if exact else None,
                    "equal_to_manual_value": _money_equal(str(movement_sum), item["ledger_value"]) if exact else None,
                    "difference_from_manual_value": (
                        str(movement_sum - Decimal(_text(item["ledger_value"]).replace(",", "")))
                        if exact else None
                    ),
                    "requires_unproven_complete_history_and_zero_position_boundaries": True,
                }
                ticker_dates = {row["date"] for row in rows}
                observation["same_day_unattributed_fee_occurrences"] = [
                    row for row in source["records"]
                    if not row["explicit_symbols"] and not row["explicit_isin_identifiers"]
                    and row["date"] in ticker_dates
                    and re.search(r"fee|commission|tax|withholding|stamp", row["flow_name"], re.I)
                ]
                observation["transfer_or_corporate_action_occurrences"] = [
                    row for row in rows
                    if re.search(r"transfer|split|merger|spin.off|rights|stock dividend", row["flow_name"], re.I)
                ]
            else:
                executed = [row for row in rows if (_decimal(row["executed_quantity"]) or Decimal(0)) > 0]
                ledger_ids = [
                    _text(row["source_references"].get("history_order_id"))
                    for row in item["exact_scope_ledger_source_occurrences"]
                    if row["source_references"].get("history_order_id")
                ]
                original_ids = {_text(row["order_id"]) for row in rows if row.get("order_id")}
                observation["ledger_order_id_correspondence"] = {
                    "ledger_occurrences_with_order_id": len(ledger_ids),
                    "matched_occurrences": sum(order_id in original_ids for order_id in ledger_ids),
                    "unmatched_order_ids": sorted(set(ledger_ids) - original_ids),
                    "role": "exact original order-ID correspondence; not a cumulative P&L attestation",
                }
                buy_qty = sum((
                    _decimal(row["executed_quantity"]) for row in executed if _text(row["direction"]).lower() == "buy"
                ), Decimal(0))
                sell_qty = sum((
                    _decimal(row["executed_quantity"]) for row in executed if _text(row["direction"]).lower() == "sell"
                ), Decimal(0))
                observation["executed_quantity_window_diagnostic"] = {
                    "executed_order_count": len(executed),
                    "buy_quantity": str(buy_qty) if executed else None,
                    "sell_quantity": str(sell_qty) if executed else None,
                    "net_quantity": str(buy_qty - sell_qty) if executed else None,
                    "net_quantity_zero": buy_qty == sell_qty if executed else None,
                    "opening_and_ending_positions_attested": False,
                    "unknown_direction_occurrences": [
                        row for row in executed if _text(row["direction"]).lower() not in {"buy", "sell"}
                    ],
                    "order_time_is_not_an_execution_log_reconstruction": True,
                    "first_buy_order_date": min((
                        row["date"] for row in executed
                        if _text(row["direction"]).lower() == "buy" and row["date"]
                    ), default=""),
                    "last_sell_order_date": max((
                        row["date"] for row in executed
                        if _text(row["direction"]).lower() == "sell" and row["date"]
                    ), default=""),
                }
            observations.append(observation)
        item["native_original_review"] = observations
        cash = next((row.get("cash_movement_window_diagnostic") for row in observations
            if "cash_movement_window_diagnostic" in row), None)
        quantity = next((row.get("executed_quantity_window_diagnostic") for row in observations
            if "executed_quantity_window_diagnostic" in row), None)
        fund_observation = next((row for row in observations
            if row["structure"]["kind"] == "fund_details_cash_movements"), None)
        fund_export_window = fund_observation["structure"]["observed_export_window"] if fund_observation else {}
        first_buy = quantity.get("first_buy_order_date", "") if quantity else ""
        item["evidence_dimensions"] = {
            "filename_declared_account_matches_ledger_scope": any(
                row["filename_account_equals_ledger_scope"] for row in observations
            ),
            "filename_declared_account_matches_private_mapping": any(
                row["filename_account_equals_private_candidate"] for row in observations
            ),
            "account_identity_declared_in_body": any(
                row["structure"]["account_label_in_body"] for row in observations
            ),
            "raw_ticker_occurrences_exist": any(row["matching_occurrence_count"] for row in observations),
            "explicit_tagged_cash_net": cash,
            "visible_executed_quantity_net": quantity,
            "zero_opening_inventory_proven": False, "zero_ending_inventory_proven": False,
            "complete_lifetime_coverage_proven": False,
            "native_reported_realized_pnl_field": any(
                row["structure"]["direct_realized_pnl_field"] for row in observations
            ),
            "canonical_source_links_preexisting": bool(item["canonical_source_artifact_candidates"]),
            "identifier_form": "ISIN" if re.fullmatch(r"[A-Z]{2}[A-Z0-9]{9}[0-9]", symbol) else "ticker",
            "unit_trust_contracts_in_native_fund_details": any(
                "unit trust" in row["flow_name"].lower()
                for observation in observations for row in observation["source_occurrences"]
                if "flow_name" in row
            ),
            "first_buy_vs_fund_coverage": {
                "first_buy_order_date": first_buy,
                "fund_export_observed_window": fund_export_window,
                "fund_ticker_observed_window": fund_observation["observed_window"] if fund_observation else {},
                "export_window_contains_first_buy_order_date": bool(
                    first_buy and fund_export_window.get("first", "") <= first_buy
                    <= fund_export_window.get("last", "")
                ),
                "a_date_window_does_not_attest_starting_inventory_or_history_completeness": True,
            },
        }
        item["gaps"] = [
            "exports do not attest the starting inventory or its carried cost basis",
            "exports do not attest the ending inventory or complete cumulative coverage",
            "the manual calibration has no independently established matching coverage window",
        ]
        if not any(row["matching_occurrence_count"] for row in observations):
            item["gaps"].append("no ticker occurrence was located in either supplied native export")
        if quantity and quantity["net_quantity_zero"] is False:
            item["gaps"].append("visible executed buys and sells have a nonzero net share quantity")
        if cash and cash["equal_to_manual_value"] is False:
            item["gaps"].append(
                "tagged cash net differs numerically; its measure is not proven equivalent to realized P&L"
            )
        if any(row.get("same_day_unattributed_fee_occurrences") for row in observations):
            item["gaps"].append("same-day source fees without explicit ticker attribution remain unallocated")
        item["claim"] = (
            "Native trade and cash windows were reviewed; cumulative realized P&L remains unverified "
            "for the stated gaps."
            if any(row["matching_occurrence_count"] for row in observations)
            else "No native ticker occurrence was located; cumulative realized P&L remains unverified."
        )
    report["native_original_sources"] = [
        {key: value for key, value in source.items() if key != "records"}
        for sources in by_broker.values() for source in sources
    ]

    def dimension_flag(item, dimension, key):
        return (item["evidence_dimensions"].get(dimension) or {}).get(key)

    def comparison_label(value, positive, negative):
        return "missing" if value is None else positive if value else negative

    report["native_original_review_summary"] = {
        "files_read": len(originals), "all_originals_read_only": True,
        "filename_declared_account_matches_ledger_scope": sum(
            item["evidence_dimensions"]["filename_declared_account_matches_ledger_scope"]
            for item in report["items"]
        ),
        "filename_declared_account_matches_private_mapping": sum(
            item["evidence_dimensions"]["filename_declared_account_matches_private_mapping"]
            for item in report["items"]
        ),
        "items_with_native_unit_trust_contracts": sum(
            item["evidence_dimensions"]["unit_trust_contracts_in_native_fund_details"]
            for item in report["items"]
        ),
        "items_with_any_native_occurrence": sum(
            any(source["matching_occurrence_count"] for source in item["native_original_review"])
            for item in report["items"]
        ),
        "direct_native_performance_fields": sum(
            bool(source["structure"]["direct_realized_pnl_field"])
            for sources in by_broker.values() for source in sources
        ),
        "cash_net_comparison": dict(Counter(
            comparison_label(
                dimension_flag(item, "explicit_tagged_cash_net", "equal_to_manual_value"), "equal", "different",
            )
            for item in report["items"]
        )),
        "executed_quantity_comparison": dict(Counter(
            comparison_label(
                dimension_flag(item, "visible_executed_quantity_net", "net_quantity_zero"), "zero", "nonzero",
            )
            for item in report["items"]
        )),
        "cash_agrees_and_visible_trade_quantity_flat": sum(
            (item["evidence_dimensions"]["explicit_tagged_cash_net"] or {}).get("equal_to_manual_value") is True
            and (item["evidence_dimensions"]["visible_executed_quantity_net"] or {}).get("net_quantity_zero") is True
            for item in report["items"]
        ),
    }
    return originals


def audit_calibrations(payload: dict, private_evidence: dict) -> dict:
    """Enumerate exact scopes and gaps without promoting user labels to broker proof.

    This audit does not reconstruct broker-reported realized P&L from trades.
    It reports insufficient evidence until a native performance source has
    been independently decoded with its account, measure, period, and row.
    A matching private mapping, amount, or filename cannot supply that proof.
    """
    artifacts = payload.get("source_artifacts", [])
    artifacts = artifacts if isinstance(artifacts, list) else []
    transactions = payload.get("transactions", [])
    transactions = transactions if isinstance(transactions, list) else []
    summaries = payload.get("broker_summaries", {})
    items = []
    all_referenced_digests = set()
    for broker, private_key in PRIVATE_KEYS.items():
        summary = summaries.get(broker, {})
        if not isinstance(summary, dict):
            continue
        account = _text(summary.get("account_id") or summary.get("account"))
        snapshot = summary.get("performance_snapshot", {})
        if not isinstance(snapshot, dict):
            continue
        mappings = private_evidence.get(private_key, {})
        mappings = mappings if isinstance(mappings, dict) else {}
        for ticker, entry in snapshot.items():
            if not isinstance(entry, dict) or entry.get("calibration_source") != MANUAL_SOURCE:
                continue
            symbol, currency = _ticker(ticker), _text(entry.get("currency")).upper()
            scope = {"broker": broker, "account": account, "ticker": symbol, "currency": currency}
            target_id = hashlib.sha256(json.dumps(scope, sort_keys=True).encode()).hexdigest()
            mapping_candidates = []
            for private_account, values in mappings.items():
                if not isinstance(values, dict):
                    continue
                for mapped_ticker, value in values.items():
                    if _ticker(mapped_ticker) == symbol:
                        mapping_candidates.append({
                            "broker": broker, "account": _text(private_account),
                            "ticker": _ticker(mapped_ticker), "value": value,
                            "same_account_literal": account == _text(private_account),
                            "same_value_decimal": _money_equal(entry.get("realized_total"), value),
                            "role": "private user mapping; not native broker performance evidence",
                        })
            occurrences = []
            alternate_accounts = Counter()
            digests = set()
            for ordinal, transaction in enumerate(transactions):
                if not isinstance(transaction, dict):
                    continue
                source = transaction.get("source")
                source = source if isinstance(source, dict) else {}
                txn_broker = _text(transaction.get("broker") or source.get("broker")).lower()
                txn_account = _text(transaction.get("account") or source.get("account"))
                if txn_broker != broker or _ticker(transaction.get("ticker")) != symbol:
                    continue
                if txn_account != account:
                    alternate_accounts[txn_account] += 1
                    continue
                source_refs = _source_digests(source)
                digests.update(source_refs)
                occurrences.append({
                    "ledger_transaction_ordinal": ordinal,
                    "ledger_transaction_id": transaction.get("id"),
                    "currency": transaction.get("currency"),
                    "source_references": {key: source[key] for key in SOURCE_OCCURRENCE_FIELDS if key in source},
                    "immutable_source_sha256": source_refs,
                })
            candidate_artifacts = []
            for ordinal, artifact in enumerate(artifacts):
                if not isinstance(artifact, dict):
                    continue
                digest = _text(artifact.get("sha256")).lower()
                exact_scope = (
                    _text(artifact.get("broker")).lower() == broker
                    and _text(artifact.get("account")) == account
                )
                if digest not in digests and not exact_scope:
                    continue
                candidate_artifacts.append({
                    "ledger_manifest_ordinal": ordinal, "sha256": digest,
                    "storage_key": artifact.get("storage_key"),
                    "byte_count": artifact.get("byte_count"), "source_kind": artifact.get("source_kind"),
                    "filename": artifact.get("filename"),
                    "account_literal_matches": exact_scope,
                    "transaction_digest_reference": digest in digests,
                    "native_performance_proof": "not decoded or attested by this audit",
                })
            all_referenced_digests.update(digests)
            all_referenced_digests.update(item["sha256"] for item in candidate_artifacts if item["sha256"])
            gaps = [
                "no independently decoded native cumulative-realized-P&L observation for this exact scope",
                "manual calibration has no independently established statement as-of or cumulative coverage window",
            ]
            if not candidate_artifacts:
                gaps.append("no canonical immutable broker source artifact links this scope")
            if occurrences and not digests:
                gaps.append("ledger row numbers exist without immutable source-file digests")
            if not occurrences:
                gaps.append("no transaction occurrence matched the exact broker/account/ticker scope")
            if mapping_candidates and not any(item["same_account_literal"] for item in mapping_candidates):
                gaps.append("current private mapping uses a different account literal; no alias is inferred")
            items.append({
                "target_id": target_id, "scope": scope,
                "ledger_value": entry.get("realized_total"),
                "ledger_entry": entry,
                "ledger_occurrence": {
                    "container": "broker_summaries", "broker_key": broker,
                    "performance_snapshot_key": ticker,
                },
                "private_mapping_candidates": mapping_candidates,
                "exact_scope_ledger_transaction_count": len(occurrences),
                "exact_scope_ledger_source_occurrences": occurrences,
                "same_broker_ticker_other_account_occurrences": dict(alternate_accounts),
                "canonical_source_artifact_candidates": candidate_artifacts,
                "verdict": "insufficient", "gaps": gaps,
                "claim": "No broker-level correctness or error conclusion is supported by linkage alone.",
            })
    return {
        "audit_version": "1.1.0", "created_at_utc": datetime.now(timezone.utc).isoformat(),
        "read_only": True, "items": items,
        "summary": {
            "target_count": len(items),
            "by_broker": dict(Counter(item["scope"]["broker"] for item in items)),
            "verdicts": {
                verdict: sum(item["verdict"] == verdict for item in items)
                for verdict in ("source_backed", "conflict", "insufficient")
            },
            "all_private_values_match_candidates": all(
                any(candidate["same_value_decimal"] for candidate in item["private_mapping_candidates"])
                for item in items
            ),
            "exact_private_account_matches": sum(
                any(candidate["same_account_literal"] for candidate in item["private_mapping_candidates"])
                for item in items
            ),
        },
        "referenced_raw_source_sha256": sorted(all_referenced_digests),
        "verdict_policy": {
            "source_backed": (
                "requires an independently decoded native observation with exact scope, measure, period and row"
            ),
            "conflict": (
                "requires a contradictory native observation for the same proven scope, measure and coverage window"
            ),
            "insufficient": (
                "missing source, source linkage, account identity, measure, coverage or independent decoding"
            ),
        },
        "limits": [
            "No account alias is inferred from matching amounts, tickers, labels, filenames or row numbers.",
            "Fund Details and History Orders can evidence trades without proving cumulative closed-position P&L.",
            "A private user mapping and its materialized copy are one provenance chain, "
            "not independent corroboration.",
            "This linkage audit does not certify new native performance formats or reconstruct tax lots.",
        ],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ledger", required=True, type=Path)
    parser.add_argument("--private-evidence", required=True, type=Path)
    parser.add_argument("--native-source-inventory", type=Path)
    parser.add_argument("--source-artifact-audit", type=Path)
    parser.add_argument("--broker-root", type=Path)
    parser.add_argument("--report", required=True, type=Path)
    args = parser.parse_args()
    source_paths = [args.ledger.resolve(), args.private_evidence.resolve()]
    supporting = {
        label: path.resolve() for label, path in (
            ("native_source_discovery_inventory", args.native_source_inventory),
            ("source_artifact_byte_audit", args.source_artifact_audit),
        ) if path is not None
    }
    source_paths.extend(supporting.values())
    report_path = args.report.resolve()
    protected = [
        PROJECT_ROOT / "settings_store", PROJECT_ROOT / "market_store",
        *(path.parent for path in source_paths[:2]),
    ]
    if args.broker_root:
        protected.append(args.broker_root.resolve())
    if report_path.exists() or any(path_is_within(report_path, path) for path in protected):
        parser.error("Use a new report outside protected stores and input files.")
    before = {str(path): sha256_file(path) for path in source_paths}
    from app.core.object_sqlite import read_object
    from app.infrastructure.investment_sqlite import load_payload, payload_sha256

    payload, evidence = load_payload(source_paths[0]), read_object(source_paths[1])
    report = audit_calibrations(payload, evidence)
    if args.broker_root:
        raw_paths = review_native_originals(report, args.broker_root.resolve())
        source_paths.extend(raw_paths)
        before.update({source["path"]: source["sha256"] for source in report["native_original_sources"]})
    report["inputs"] = {
        str(path): {"sha256": before[str(path)], "bytes": path.stat().st_size} for path in source_paths
    }
    report["ledger_payload_sha256"] = payload_sha256(payload)
    report["ledger_transaction_count"] = len(payload.get("transactions", []))
    report["ledger_source_artifact_count"] = len(payload.get("source_artifacts", []))
    for label, path in supporting.items():
        contents = json.loads(path.read_text(encoding="utf-8"))
        if (
            label == "source_artifact_byte_audit"
            and contents.get("snapshot_file_sha256") != before[str(source_paths[0])]
        ):
            raise RuntimeError("The source-artifact audit does not describe this pinned ledger snapshot.")
        report[label] = {
            "path": str(path), "sha256": before[str(path)],
            "summary": {key: value for key, value in contents.items() if not isinstance(value, list)},
        }
    if supporting:
        report["limits"].append(
            "Discovery inventory paths are not native financial observations or proof of their contents."
        )
    if before != {str(path): sha256_file(path) for path in source_paths}:
        raise RuntimeError("An audit input changed; no per-item report was published.")
    report["input_files_unchanged"] = True
    report_path.parent.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(report_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    print(json.dumps({"report": str(report_path), "summary": report["summary"], "input_files_unchanged": True}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
