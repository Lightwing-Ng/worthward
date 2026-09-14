"""Investment import domain: artifacts.

Code version: v0.1.0
"""

from __future__ import annotations

from app.services.investment_import_support import (
    Any,
    Decimal,
    IBKR_USER_VERIFIED_POSITION_SNAPSHOT_SOURCE,
    IBKR_WEB_CAPTURE_METADATA_FIELDS,
    LONGBRIDGE_USER_CONFIRMED_PERFORMANCE_CALIBRATION_SOURCE,
    ZERO,
    _REALIZED_PNL_REPLAY_TRANSACTION_TYPES,
    _decimal_to_str,
    _normalize_text,
    date,
    deepcopy,
    defaultdict,
    hashlib,
    json,
    normalize_ticker,
    re,
)

import app.services.investment_import_basics as _ii_basics

import app.services.investment_import_hsbc_cash as _ii_hsbc_cash

import app.services.investment_import_merge_identity as _ii_merge_identity

import app.services.investment_import_merge_reconciliation as _ii_merge_reconciliation

import app.services.investment_import_payload_summaries as _ii_payload_summaries


def _normalize_snapshot_keys(snapshot: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(snapshot, dict):
        return {}

    normalized_snapshot: dict[str, Any] = {}
    for raw_ticker, payload in snapshot.items():
        normalized_ticker = normalize_ticker(str(raw_ticker or ""))
        if not normalized_ticker:
            continue
        if (
            normalized_ticker in normalized_snapshot
            and isinstance(normalized_snapshot[normalized_ticker], dict)
            and isinstance(payload, dict)
        ):
            normalized_snapshot[normalized_ticker] = {
                **normalized_snapshot[normalized_ticker],
                **payload,
            }
            continue
        normalized_snapshot[normalized_ticker] = payload
    return normalized_snapshot


def _normalize_source_artifact(raw_artifact: Any) -> dict[str, Any]:
    if not isinstance(raw_artifact, dict):
        raise ValueError("Investment source evidence manifest is malformed.")
    sha256 = _normalize_text(raw_artifact.get("sha256")).lower()
    if not re.fullmatch(r"[0-9a-f]{64}", sha256):
        raise ValueError("Investment source evidence requires a valid SHA-256 digest.")
    raw_byte_count = raw_artifact.get("byte_count")
    if isinstance(raw_byte_count, bool) or raw_byte_count is None:
        raise ValueError("Investment source evidence has an invalid byte count.")
    if isinstance(raw_byte_count, int):
        byte_count = raw_byte_count
    elif isinstance(raw_byte_count, str) and re.fullmatch(
        r"\d+", raw_byte_count.strip()
    ):
        byte_count = int(raw_byte_count.strip())
    else:
        raise ValueError("Investment source evidence has an invalid byte count.")
    if byte_count < 0:
        raise ValueError("Investment source evidence byte count cannot be negative.")

    storage_key = _normalize_text(raw_artifact.get("storage_key")).lower()
    if storage_key and storage_key != sha256:
        raise ValueError(
            "Investment source evidence storage key does not match its SHA-256 digest."
        )
    content_encoding = _normalize_text(raw_artifact.get("content_encoding")).lower()
    content_base64 = raw_artifact.get("content_base64")
    has_content_bytes = isinstance(content_base64, str) and bool(content_base64)
    if content_encoding:
        if content_encoding != "base64" or not has_content_bytes:
            raise ValueError("Investment source evidence is not valid Base64 data.")
    elif content_base64 is not None and content_base64 != "":
        raise ValueError(
            "Investment source evidence uses an unsupported content encoding."
        )
    if not storage_key and not has_content_bytes:
        raise ValueError(
            "Investment source evidence requires uploaded bytes or a verified storage key."
        )

    filename = _normalize_text(raw_artifact.get("filename"))
    filenames = (
        {
            _normalize_text(value)
            for value in raw_artifact.get("filenames", [])
            if _normalize_text(value)
        }
        if isinstance(raw_artifact.get("filenames"), list)
        else set()
    )
    if filename:
        filenames.add(filename)
    bundle_id = _normalize_text(raw_artifact.get("bundle_id"))
    bundle_ids = (
        {
            _normalize_text(value)
            for value in raw_artifact.get("bundle_ids", [])
            if _normalize_text(value)
        }
        if isinstance(raw_artifact.get("bundle_ids"), list)
        else set()
    )
    if bundle_id:
        bundle_ids.add(bundle_id)

    artifact: dict[str, Any] = {
        "evidence_schema_version": _normalize_text(
            raw_artifact.get("evidence_schema_version")
        )
        or "1.0",
        "sha256": sha256,
        "byte_count": byte_count,
        "filename": min(filenames) if filenames else "",
        "filenames": sorted(filenames),
        "broker": _ii_basics._normalize_broker_code(raw_artifact.get("broker")),
        "account": _normalize_text(raw_artifact.get("account")),
        "source_kind": _normalize_text(raw_artifact.get("source_kind")),
        "bundle_id": min(bundle_ids) if bundle_ids else "",
        "bundle_ids": sorted(bundle_ids),
        "bundle_role": _normalize_text(raw_artifact.get("bundle_role")),
        "related_sha256": _normalize_text(raw_artifact.get("related_sha256")).lower(),
        "statement_title": _normalize_text(raw_artifact.get("statement_title")),
        "statement_period": _normalize_text(raw_artifact.get("statement_period")),
        "statement_period_start": _normalize_text(
            raw_artifact.get("statement_period_start")
        ),
        "statement_period_end": _normalize_text(
            raw_artifact.get("statement_period_end")
        ),
        "statement_generated_at": _normalize_text(
            raw_artifact.get("statement_generated_at")
        ),
    }
    for field_name in IBKR_WEB_CAPTURE_METADATA_FIELDS:
        field_value = _normalize_text(raw_artifact.get(field_name))
        if field_value:
            artifact[field_name] = field_value
    if storage_key:
        artifact["storage_key"] = storage_key
    if has_content_bytes:
        artifact["content_encoding"] = "base64"
        artifact["content_base64"] = content_base64
    return artifact


def _merge_source_artifact_records(
    current: dict[str, Any],
    incoming: dict[str, Any],
) -> dict[str, Any]:
    merged = dict(current)
    merged["filenames"] = sorted(
        {
            *_normalize_source_artifact(current).get("filenames", []),
            *_normalize_source_artifact(incoming).get("filenames", []),
        }
    )
    merged["filename"] = min(merged["filenames"]) if merged["filenames"] else ""
    merged["bundle_ids"] = sorted(
        {
            *_normalize_source_artifact(current).get("bundle_ids", []),
            *_normalize_source_artifact(incoming).get("bundle_ids", []),
        }
    )
    merged["bundle_id"] = min(merged["bundle_ids"]) if merged["bundle_ids"] else ""
    for key, value in incoming.items():
        if key in {"filename", "filenames", "bundle_id", "bundle_ids"}:
            continue
        if _ii_merge_identity._is_missing_merge_value(
            merged.get(key)
        ) and not _ii_merge_identity._is_missing_merge_value(value):
            merged[key] = value
        if key == "content_base64" and isinstance(value, str) and value:
            merged[key] = value
            merged["content_encoding"] = "base64"
    return merged


def _normalize_source_artifacts(raw_artifacts: Any) -> list[dict[str, Any]]:
    if not isinstance(raw_artifacts, list):
        return []
    artifacts_by_sha256: dict[str, dict[str, Any]] = {}
    for raw_artifact in raw_artifacts:
        artifact = _normalize_source_artifact(raw_artifact)
        sha256 = artifact["sha256"]
        if sha256 in artifacts_by_sha256:
            artifacts_by_sha256[sha256] = _merge_source_artifact_records(
                artifacts_by_sha256[sha256], artifact
            )
            continue
        artifacts_by_sha256[sha256] = artifact
    return [artifacts_by_sha256[sha256] for sha256 in sorted(artifacts_by_sha256)]


def _broker_snapshot_evidence_from_payload(
    payload: dict[str, Any],
) -> list[dict[str, Any]]:
    """Separate position evidence from any user-confirmed P&L calibration.

    An uploaded Fund Details file can establish an import period for transaction
    and replay context.  It is not, by itself, a dated broker performance
    report.  Keeping the user-confirmed performance calibration in its own
    evidence record prevents that period from being misrepresented as the
    calibration's as-of date or source artifact.
    """
    broker = _ii_basics._normalize_broker_code(payload.get("broker"))
    if broker in {"", "multiple"}:
        return []
    summary = payload.get("summary") if isinstance(payload.get("summary"), dict) else {}
    account = _normalize_text(
        payload.get("account_id")
        or payload.get("account")
        or summary.get("account_id")
        or summary.get("account")
    )
    position_snapshot = _normalize_snapshot_keys(payload.get("position_snapshot"))
    performance_snapshot = _normalize_snapshot_keys(payload.get("performance_snapshot"))
    if not position_snapshot and not performance_snapshot:
        return []
    source_artifacts = _normalize_source_artifacts(payload.get("source_artifacts"))
    period_ends = [
        _normalize_text(artifact.get("statement_period_end"))
        for artifact in source_artifacts
        if _normalize_text(artifact.get("statement_period_end"))
    ]
    snapshot_as_of_values = [
        _normalize_text(item.get("as_of"))
        for item in position_snapshot.values()
        if isinstance(item, dict) and _normalize_text(item.get("as_of"))
    ]
    transaction_dates = _ii_payload_summaries._payload_transaction_dates(payload)
    snapshot_as_of = max(
        period_ends or snapshot_as_of_values or transaction_dates or [""]
    )
    generator = (
        payload.get("generator") if isinstance(payload.get("generator"), dict) else {}
    )
    position_source = _ii_payload_summaries._summary_text(
        summary, "position_snapshot_source"
    ) or _normalize_text(generator.get("name"))
    performance_source = (
        _ii_payload_summaries._summary_text(summary, "performance_snapshot_source")
        or position_source
    )
    position_snapshot_as_of = _normalize_text(
        payload.get("position_snapshot_as_of")
        or summary.get("position_snapshot_as_of")
        or (snapshot_as_of if position_snapshot else "")
    )
    performance_snapshot_as_of = _normalize_text(
        payload.get("performance_snapshot_as_of")
        or summary.get("performance_snapshot_as_of")
        or (
            snapshot_as_of
            if performance_snapshot
            and performance_source
            != LONGBRIDGE_USER_CONFIRMED_PERFORMANCE_CALIBRATION_SOURCE
            else ""
        )
    )
    snapshot_updated_at = ""
    hsbc_snapshot = summary.get("hsbc_snapshot")
    if isinstance(hsbc_snapshot, dict):
        market_data_updated_at = hsbc_snapshot.get("portfolio_market_data_updated_at")
        if isinstance(market_data_updated_at, dict):
            updated_date = _normalize_text(market_data_updated_at.get("date"))
            updated_time = _normalize_text(market_data_updated_at.get("time"))
            if updated_date and updated_time:
                snapshot_updated_at = f"{updated_date} {updated_time}"
    source_artifact_sha256 = [artifact["sha256"] for artifact in source_artifacts]
    is_user_confirmed_calibration = (
        bool(performance_snapshot)
        and performance_source
        == LONGBRIDGE_USER_CONFIRMED_PERFORMANCE_CALIBRATION_SOURCE
    )
    if not is_user_confirmed_calibration:
        candidate: dict[str, Any] = {
            "broker": broker,
            "account": account,
            "snapshot_as_of": snapshot_as_of,
            "position_snapshot_as_of": position_snapshot_as_of,
            "performance_snapshot_as_of": performance_snapshot_as_of,
            "position_snapshot": position_snapshot,
            "performance_snapshot": performance_snapshot,
            "position_snapshot_authoritative": bool(
                summary.get("position_snapshot_authoritative") and position_snapshot
            ),
            "performance_snapshot_authoritative": bool(
                summary.get("performance_snapshot_authoritative")
                and performance_snapshot
            ),
            "position_snapshot_source": position_source,
            "performance_snapshot_source": performance_source,
            "source_artifact_sha256": source_artifact_sha256,
            "holdings_validation": summary.get("holdings_validation")
            if isinstance(summary.get("holdings_validation"), dict)
            else {},
        }
        if snapshot_updated_at:
            candidate["snapshot_updated_at"] = snapshot_updated_at
        candidate["evidence_id"] = hashlib.sha256(
            json.dumps(
                candidate,
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
            ).encode("utf-8")
        ).hexdigest()
        return [candidate]

    candidates: list[dict[str, Any]] = []

    if position_snapshot:
        position_candidate: dict[str, Any] = {
            "broker": broker,
            "account": account,
            "snapshot_as_of": snapshot_as_of,
            "position_snapshot_as_of": position_snapshot_as_of,
            "position_snapshot": position_snapshot,
            "performance_snapshot": {},
            "position_snapshot_authoritative": bool(
                summary.get("position_snapshot_authoritative") and position_snapshot
            ),
            "performance_snapshot_authoritative": False,
            "position_snapshot_source": position_source,
            "performance_snapshot_source": "",
            "source_artifact_sha256": source_artifact_sha256,
            "holdings_validation": summary.get("holdings_validation")
            if isinstance(summary.get("holdings_validation"), dict)
            else {},
        }
        if snapshot_updated_at:
            position_candidate["snapshot_updated_at"] = snapshot_updated_at
        position_candidate["evidence_id"] = hashlib.sha256(
            json.dumps(
                position_candidate,
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
            ).encode("utf-8")
        ).hexdigest()
        candidates.append(position_candidate)

    if performance_snapshot:
        performance_candidate: dict[str, Any] = {
            "broker": broker,
            "account": account,
            "snapshot_as_of": "",
            "performance_snapshot_as_of": performance_snapshot_as_of,
            "position_snapshot": {},
            "performance_snapshot": performance_snapshot,
            "position_snapshot_authoritative": False,
            "performance_snapshot_authoritative": bool(
                summary.get("performance_snapshot_authoritative")
                and performance_snapshot
            ),
            "position_snapshot_source": "",
            "performance_snapshot_source": performance_source,
            "source_artifact_sha256": [],
            "holdings_validation": {},
        }
        performance_candidate["evidence_id"] = hashlib.sha256(
            json.dumps(
                performance_candidate,
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
            ).encode("utf-8")
        ).hexdigest()
        candidates.append(performance_candidate)

    return candidates


def _normalize_broker_snapshot_evidence(raw_evidence: Any) -> dict[str, Any] | None:
    if not isinstance(raw_evidence, dict):
        return None
    broker = _ii_basics._normalize_broker_code(raw_evidence.get("broker"))
    if not broker or broker == "multiple":
        return None
    position_snapshot = _normalize_snapshot_keys(raw_evidence.get("position_snapshot"))
    performance_snapshot = _normalize_snapshot_keys(
        raw_evidence.get("performance_snapshot")
    )
    if not position_snapshot and not performance_snapshot:
        return None
    source_artifact_sha256 = (
        sorted(
            {
                _normalize_text(value).lower()
                for value in raw_evidence.get("source_artifact_sha256", [])
                if re.fullmatch(r"[0-9a-f]{64}", _normalize_text(value).lower())
            }
        )
        if isinstance(raw_evidence.get("source_artifact_sha256"), list)
        else []
    )
    candidate: dict[str, Any] = {
        "broker": broker,
        "account": _normalize_text(
            raw_evidence.get("account_id") or raw_evidence.get("account")
        ),
        "snapshot_as_of": _normalize_text(raw_evidence.get("snapshot_as_of")),
        "position_snapshot_as_of": _normalize_text(
            raw_evidence.get("position_snapshot_as_of")
        ),
        "performance_snapshot_as_of": _normalize_text(
            raw_evidence.get("performance_snapshot_as_of")
        ),
        "position_snapshot": position_snapshot,
        "performance_snapshot": performance_snapshot,
        "position_snapshot_authoritative": bool(
            raw_evidence.get("position_snapshot_authoritative") and position_snapshot
        ),
        "performance_snapshot_authoritative": bool(
            raw_evidence.get("performance_snapshot_authoritative")
            and performance_snapshot
        ),
        "position_snapshot_source": _normalize_text(
            raw_evidence.get("position_snapshot_source")
        ),
        "performance_snapshot_source": _normalize_text(
            raw_evidence.get("performance_snapshot_source")
        ),
        "source_artifact_sha256": source_artifact_sha256,
        "holdings_validation": raw_evidence.get("holdings_validation")
        if isinstance(raw_evidence.get("holdings_validation"), dict)
        else {},
    }
    if isinstance(raw_evidence.get("realized_pnl_reconciliation"), dict):
        candidate["realized_pnl_reconciliation"] = deepcopy(
            raw_evidence["realized_pnl_reconciliation"]
        )
    snapshot_updated_at = _normalize_text(raw_evidence.get("snapshot_updated_at"))
    if snapshot_updated_at:
        candidate["snapshot_updated_at"] = snapshot_updated_at
    candidate["evidence_id"] = hashlib.sha256(
        json.dumps(
            candidate, ensure_ascii=False, sort_keys=True, separators=(",", ":")
        ).encode("utf-8")
    ).hexdigest()
    return candidate


def _snapshot_source_reliability(source: str) -> int:
    normalized_source = _normalize_text(source)
    if normalized_source == IBKR_USER_VERIFIED_POSITION_SNAPSHOT_SOURCE:
        return 350
    if normalized_source == "ibkr_csv_open_positions":
        return 400
    if normalized_source == "ibkr_gainskeeper_positions":
        return 300
    if normalized_source in {"hsbc_portfolio_text", "hsbc_investment_statement_pdf"}:
        return 300
    if normalized_source.endswith("_positions_cli"):
        return 200
    return 100


def _enrich_ibkr_gainskeeper_position_cost_basis(
    selected_snapshot: dict[str, Any],
    position_candidates: list[dict[str, Any]],
    *,
    selected_evidence: dict[str, Any],
    transactions: list[dict[str, Any]],
    source_artifacts: list[dict[str, Any]],
    account: str,
) -> dict[str, Any]:
    """Keep current GainsKeeper marks while extending only verified cost basis."""
    enriched = deepcopy(_normalize_snapshot_keys(selected_snapshot))
    csv_candidates = [
        candidate
        for candidate in position_candidates
        if _normalize_text(candidate.get("position_snapshot_source"))
        == "ibkr_csv_open_positions"
        and bool(candidate.get("position_snapshot_authoritative"))
    ]
    csv_candidates.sort(
        key=lambda candidate: _broker_snapshot_evidence_sort_key(
            candidate,
            snapshot_kind="position",
        ),
        reverse=True,
    )
    for ticker, selected_row in enriched.items():
        if not isinstance(selected_row, dict):
            continue
        for candidate in csv_candidates:
            csv_row = candidate.get("position_snapshot", {}).get(ticker)
            if not isinstance(csv_row, dict):
                continue
            selected_quantity = _ii_hsbc_cash._parse_decimal_text_or_none(
                selected_row.get("quantity")
            )
            csv_quantity = _ii_hsbc_cash._parse_decimal_text_or_none(
                csv_row.get("quantity")
            )
            if (
                selected_quantity is not None
                and csv_quantity is not None
                and selected_quantity != csv_quantity
            ):
                # A newer GainsKeeper snapshot can include trades after the
                # CSV open-positions baseline. Carrying the older basis onto a
                # different share count would create a false authoritative P&L.
                continue
            copied_fields = False
            for field_name in ("cost_price", "cost_basis", "cost_basis_status"):
                if _normalize_text(selected_row.get(field_name)):
                    continue
                value = csv_row.get(field_name)
                if _normalize_text(value):
                    selected_row[field_name] = value
                    copied_fields = True
            if copied_fields:
                selected_row.setdefault("cost_basis_source", "ibkr_csv_open_positions")
                break

        if _normalize_text(selected_row.get("cost_basis")):
            continue
        selected_quantity = _ii_hsbc_cash._parse_decimal_text_or_none(
            selected_row.get("quantity")
        )
        selected_day = _normalize_text(selected_evidence.get("snapshot_as_of"))[:10]
        if (
            selected_quantity is None
            or selected_quantity <= ZERO
            or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", selected_day)
        ):
            continue

        baseline_candidates: list[dict[str, Any]] = []
        for candidate in position_candidates:
            if candidate is selected_evidence:
                continue
            if not bool(candidate.get("position_snapshot_authoritative")):
                continue
            baseline_day = _normalize_text(candidate.get("snapshot_as_of"))[:10]
            if (
                not re.fullmatch(r"\d{4}-\d{2}-\d{2}", baseline_day)
                or baseline_day >= selected_day
            ):
                continue
            baseline_row = candidate.get("position_snapshot", {}).get(ticker)
            if not isinstance(baseline_row, dict):
                continue
            baseline_quantity = _ii_hsbc_cash._parse_decimal_text_or_none(
                baseline_row.get("quantity")
            )
            baseline_cost_basis = _ii_hsbc_cash._parse_decimal_text_or_none(
                baseline_row.get("cost_basis")
            )
            baseline_status = _normalize_text(
                baseline_row.get("cost_basis_status")
            ).lower()
            if (
                baseline_quantity is None
                or baseline_quantity < ZERO
                or baseline_cost_basis is None
                or baseline_cost_basis < ZERO
                or baseline_status in {"partial", "unknown"}
            ):
                continue
            baseline_candidates.append(candidate)
        baseline_candidates.sort(
            key=lambda candidate: _broker_snapshot_evidence_sort_key(
                candidate,
                snapshot_kind="position",
            ),
            reverse=True,
        )

        artifacts_by_sha256 = {
            _normalize_text(artifact.get("sha256")): artifact
            for artifact in source_artifacts
            if isinstance(artifact, dict) and _normalize_text(artifact.get("sha256"))
        }
        selected_artifact_digests = [
            _normalize_text(value)
            for value in selected_evidence.get("source_artifact_sha256", [])
            if _normalize_text(value)
        ]
        for baseline_candidate in baseline_candidates:
            baseline_day = _normalize_text(baseline_candidate.get("snapshot_as_of"))[
                :10
            ]
            covering_artifact = next(
                (
                    artifacts_by_sha256[digest]
                    for digest in selected_artifact_digests
                    if digest in artifacts_by_sha256
                    and _normalize_text(artifacts_by_sha256[digest].get("source_kind"))
                    == "ibkr_gainskeeper_ofx_gkx"
                    and _normalize_text(
                        artifacts_by_sha256[digest].get("statement_period_start")
                    )
                    <= baseline_day
                    and _normalize_text(
                        artifacts_by_sha256[digest].get("statement_period_end")
                    )
                    >= selected_day
                ),
                None,
            )
            if covering_artifact is None:
                continue

            baseline_row = baseline_candidate["position_snapshot"][ticker]
            baseline_quantity = _ii_hsbc_cash._parse_decimal_text_or_none(
                baseline_row.get("quantity")
            )
            baseline_cost_basis = _ii_hsbc_cash._parse_decimal_text_or_none(
                baseline_row.get("cost_basis")
            )
            if baseline_quantity is None or baseline_cost_basis is None:
                continue

            interval_records: list[dict[str, Any]] = []
            for transaction in transactions:
                source = (
                    transaction.get("source")
                    if isinstance(transaction.get("source"), dict)
                    else {}
                )
                transaction_broker = _ii_basics._normalize_broker_code(
                    transaction.get("broker") or source.get("broker")
                )
                transaction_account = _normalize_text(
                    transaction.get("account") or source.get("account")
                )
                transaction_day = _normalize_text(transaction.get("date"))[:10]
                if (
                    transaction_broker != "ibkr"
                    or not transaction_account
                    or not _ii_basics._accounts_are_compatible(
                        "ibkr",
                        account,
                        transaction_account,
                    )
                    or normalize_ticker(_normalize_text(transaction.get("ticker")))
                    != ticker
                    or transaction_day <= baseline_day
                    or transaction_day > selected_day
                ):
                    continue
                if _normalize_text(transaction.get("type")).lower() in {
                    "buy",
                    "sell",
                    "dividend_reinvestment",
                    "grant",
                    "transfer_in",
                    "transfer_out",
                }:
                    interval_records.append(transaction)
            interval_records.sort(
                key=lambda transaction: (
                    _normalize_text(transaction.get("date")),
                    _normalize_text(transaction.get("datetime")),
                    _normalize_text((transaction.get("source") or {}).get("fitid"))
                    if isinstance(transaction.get("source"), dict)
                    else "",
                )
            )
            if not interval_records:
                continue

            purchased_quantity = ZERO
            purchased_net_cost = ZERO
            applied_fitids: list[str] = []
            is_complete_buy_only_interval = True
            for transaction in interval_records:
                source = (
                    transaction.get("source")
                    if isinstance(transaction.get("source"), dict)
                    else {}
                )
                quantity = _ii_hsbc_cash._parse_decimal_text_or_none(
                    transaction.get("quantity_abs") or transaction.get("quantity_raw")
                )
                net_amount = _ii_hsbc_cash._parse_decimal_text_or_none(
                    transaction.get("net_amount_raw")
                )
                fitid = _normalize_text(source.get("fitid"))
                if (
                    _normalize_text(transaction.get("type")).lower() != "buy"
                    or _normalize_text(source.get("file_kind")) != "gainskeeper"
                    or _normalize_text(source.get("source_format")) != "ofx_gkx"
                    or not fitid
                    or quantity is None
                    or quantity <= ZERO
                    or net_amount is None
                    or net_amount >= ZERO
                ):
                    is_complete_buy_only_interval = False
                    break
                purchased_quantity += quantity
                purchased_net_cost += abs(net_amount)
                applied_fitids.append(fitid)
            if (
                not is_complete_buy_only_interval
                or baseline_quantity + purchased_quantity != selected_quantity
            ):
                continue

            repaired_cost_basis = baseline_cost_basis + purchased_net_cost
            selected_row.update(
                {
                    "cost_price": _decimal_to_str(
                        repaired_cost_basis / selected_quantity
                    ),
                    "cost_basis": _decimal_to_str(repaired_cost_basis),
                    "cost_basis_status": "known",
                    "cost_basis_source": (
                        "ibkr_verified_snapshot_plus_gainskeeper_buys"
                    ),
                    "cost_basis_repair": {
                        "method": (
                            "verified_snapshot_basis_plus_exact_gainskeeper_buys"
                        ),
                        "baseline_snapshot_as_of": baseline_day,
                        "baseline_position_snapshot_evidence_id": _normalize_text(
                            baseline_candidate.get("evidence_id")
                        ),
                        "baseline_cost_basis_source": _normalize_text(
                            baseline_row.get("cost_basis_source")
                        ),
                        "source_window_start": _normalize_text(
                            covering_artifact.get("statement_period_start")
                        ),
                        "source_window_end": _normalize_text(
                            covering_artifact.get("statement_period_end")
                        ),
                        "source_artifact_sha256": _normalize_text(
                            covering_artifact.get("sha256")
                        ),
                        "applied_transaction_fitids": applied_fitids,
                        "applied_quantity_raw": _decimal_to_str(purchased_quantity),
                        "applied_net_cost_raw": _decimal_to_str(purchased_net_cost),
                    },
                }
            )
            break
    return enriched


def _broker_snapshot_evidence_sort_key(
    evidence: dict[str, Any],
    *,
    snapshot_kind: str,
) -> tuple[str, str, int, int, str, int, int, str]:
    if snapshot_kind == "position":
        snapshot = evidence.get("position_snapshot")
        authoritative = bool(evidence.get("position_snapshot_authoritative"))
        source = _normalize_text(evidence.get("position_snapshot_source"))
    else:
        snapshot = evidence.get("performance_snapshot")
        authoritative = bool(evidence.get("performance_snapshot_authoritative"))
        source = _normalize_text(evidence.get("performance_snapshot_source"))
    snapshot_as_of = _normalize_text(
        evidence.get(
            "position_snapshot_as_of"
            if snapshot_kind == "position"
            else "performance_snapshot_as_of"
        )
        or evidence.get("snapshot_as_of")
    )
    snapshot_day = (
        snapshot_as_of[:10]
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}.*", snapshot_as_of)
        else snapshot_as_of
    )
    snapshot_updated_at = _normalize_text(evidence.get("snapshot_updated_at"))
    snapshot_observed_at = snapshot_as_of
    if snapshot_kind == "position" and isinstance(snapshot, dict):
        observed_times = sorted(
            _normalize_text(position.get("as_of") or position.get("asOf"))
            for position in snapshot.values()
            if isinstance(position, dict)
            and re.fullmatch(
                r"\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}.*",
                _normalize_text(position.get("as_of") or position.get("asOf")),
            )
        )
        if observed_times:
            latest_observed_at = observed_times[-1].replace("T", " ")
            if not snapshot_day or latest_observed_at[:10] == snapshot_day:
                snapshot_observed_at = latest_observed_at
    cost_basis_completeness = 0
    if snapshot_kind == "position" and isinstance(snapshot, dict):
        cost_basis_completeness = sum(
            1
            for position in snapshot.values()
            if isinstance(position, dict)
            and (
                _normalize_text(position.get("cost_price"))
                or _normalize_text(position.get("cost_basis"))
                or _normalize_text(position.get("cost_basis_status"))
            )
        )
    return (
        snapshot_day,
        snapshot_updated_at,
        1 if authoritative else 0,
        _snapshot_source_reliability(source),
        snapshot_observed_at,
        cost_basis_completeness,
        len(snapshot) if isinstance(snapshot, dict) else 0,
        _normalize_text(evidence.get("evidence_id")),
    )


def _source_artifact_date_window(
    evidence: dict[str, Any],
    source_artifacts: list[dict[str, Any]],
    *,
    source_kind: str,
) -> tuple[str, str]:
    artifact_by_sha256 = {
        _normalize_text(artifact.get("sha256")).lower(): artifact
        for artifact in source_artifacts
        if _normalize_text(artifact.get("sha256"))
    }
    windows = [
        (
            _normalize_text(
                artifact_by_sha256.get(digest, {}).get("statement_period_start")
            ),
            _normalize_text(
                artifact_by_sha256.get(digest, {}).get("statement_period_end")
            ),
        )
        for digest in evidence.get("source_artifact_sha256", [])
        if digest in artifact_by_sha256
        and _normalize_text(artifact_by_sha256[digest].get("source_kind"))
        == source_kind
    ]
    windows = [window for window in windows if window[0] and window[1]]
    if windows:
        return min(window[0] for window in windows), max(
            window[1] for window in windows
        )
    snapshot_as_of = _normalize_text(
        evidence.get("performance_snapshot_as_of") or evidence.get("snapshot_as_of")
    )[:10]
    return snapshot_as_of, snapshot_as_of


def _ibkr_csv_performance_snapshot_candidates(
    evidence_records: list[dict[str, Any]],
    *,
    source_artifacts: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    for evidence in evidence_records:
        if (
            _normalize_text(evidence.get("performance_snapshot_source"))
            != "ibkr_csv_realized_summary"
            or evidence.get("performance_snapshot_authoritative") is not True
            or not isinstance(evidence.get("performance_snapshot"), dict)
            or not evidence["performance_snapshot"]
        ):
            continue
        window_start, window_end = _source_artifact_date_window(
            evidence,
            source_artifacts,
            source_kind="ibkr_realized_summary_csv",
        )
        if not window_start or not window_end:
            # A performance summary without its statement period cannot be
            # proven to be a non-overlapping window. Keep it as source
            # evidence, but never promote it into a cumulative aggregate.
            continue
        candidates.append(
            {
                "evidence": evidence,
                "window_start": window_start,
                "window_end": window_end,
            }
        )
    return candidates


def _ibkr_realized_component_from_transaction(
    transaction: dict[str, Any],
) -> tuple[str, str, Decimal | None] | None:
    """Return one dated broker-native realized component, including missing values."""
    transaction_type = _normalize_text(transaction.get("type")).lower()
    source = (
        transaction.get("source") if isinstance(transaction.get("source"), dict) else {}
    )
    if transaction_type == "sell":
        ticker = normalize_ticker(_normalize_text(transaction.get("ticker")))
        component_date = _normalize_reconciliation_date(
            source.get("closed_lot_trade_datetime") or transaction.get("date")
        )
    elif transaction_type == "forex_trade_component":
        ticker = normalize_ticker(
            _normalize_text(source.get("broker_realized_pnl_ticker"))
        )
        if not ticker:
            pair = normalize_ticker(_normalize_text(transaction.get("ticker")))
            ticker = pair.split(".", 1)[1] if "." in pair else ""
        component_date = _normalize_reconciliation_date(
            source.get("broker_realized_pnl_date")
            or source.get("broker_realized_pnl_datetime")
            or transaction.get("date")
        )
    else:
        return None
    if not ticker:
        return None
    normalized = (
        transaction.get("normalized")
        if isinstance(transaction.get("normalized"), dict)
        else {}
    )
    realized_pnl = _ii_hsbc_cash._parse_decimal_text_or_none(
        transaction.get("broker_realized_pnl_raw")
        or transaction.get("broker_realized_pnl")
        or normalized.get("broker_realized_pnl")
    )
    return ticker, component_date, realized_pnl


def _verified_ibkr_overlapping_realized_tail(
    candidate: dict[str, Any],
    *,
    covered_through: str,
    transactions: list[dict[str, Any]],
    broker: str,
    account: str,
) -> dict[str, Decimal] | None:
    """Reconcile a whole overlapping report before returning its uncovered tail."""
    raw_snapshot = candidate["evidence"].get("performance_snapshot", {})
    if not isinstance(raw_snapshot, dict):
        return None
    report_totals: dict[str, Decimal] = {}
    for raw_ticker, raw_entry in raw_snapshot.items():
        if not isinstance(raw_entry, dict):
            continue
        realized_total = _ii_hsbc_cash._parse_decimal_text_or_none(
            raw_entry.get("realized_total")
        )
        ticker = normalize_ticker(_normalize_text(raw_ticker))
        if not ticker or realized_total is None:
            return None
        report_totals[ticker] = realized_total
    if not report_totals:
        return None

    try:
        window_start = date.fromisoformat(candidate["window_start"])
        window_end = date.fromisoformat(candidate["window_end"])
        coverage_end = date.fromisoformat(covered_through)
    except (TypeError, ValueError):
        return None

    component_totals = {ticker: ZERO for ticker in report_totals}
    tail_totals = {ticker: ZERO for ticker in report_totals}
    component_counts = {ticker: 0 for ticker in report_totals}
    incomplete_tickers: set[str] = set()
    for transaction in transactions:
        if not isinstance(transaction, dict):
            continue
        transaction_broker, transaction_account, _ticker, _currency = (
            _reconciliation_transaction_scope(
                transaction,
                broker=broker,
                account=account,
            )
        )
        if transaction_broker != broker or not _ii_basics._accounts_are_compatible(
            broker, account, transaction_account
        ):
            continue
        component = _ibkr_realized_component_from_transaction(transaction)
        if component is None:
            continue
        ticker, component_date_text, realized_pnl = component
        if ticker not in report_totals:
            continue
        try:
            component_date = date.fromisoformat(component_date_text)
        except ValueError:
            incomplete_tickers.add(ticker)
            continue
        if component_date < window_start or component_date > window_end:
            continue
        component_counts[ticker] += 1
        if realized_pnl is None:
            incomplete_tickers.add(ticker)
            continue
        component_totals[ticker] += realized_pnl
        if component_date > coverage_end:
            tail_totals[ticker] += realized_pnl

    for ticker, report_total in report_totals.items():
        tolerance = max(
            Decimal("0.000001"),
            Decimal(component_counts[ticker]) * Decimal("0.0000005"),
        )
        if (
            ticker in incomplete_tickers
            or abs(component_totals[ticker] - report_total) > tolerance
        ):
            return None
    return tail_totals


def _aggregate_ibkr_csv_performance_snapshot(
    evidence_records: list[dict[str, Any]],
    *,
    source_artifacts: list[dict[str, Any]],
    transactions: list[dict[str, Any]],
    broker: str,
    account: str,
) -> tuple[dict[str, Any], str, str, list[str]] | None:
    candidates = _ibkr_csv_performance_snapshot_candidates(
        evidence_records,
        source_artifacts=source_artifacts,
    )
    if not candidates:
        return None

    # Keep the longest report for one start date. Adjacent reports contribute
    # their full realized totals. A partially overlapping report contributes
    # only its broker-native, fully reconciled tail after the closed boundary.
    candidates.sort(
        key=lambda item: (
            item["window_start"],
            item["window_end"],
            _normalize_text(item["evidence"].get("snapshot_updated_at")),
            _normalize_text(item["evidence"].get("evidence_id")),
        ),
        reverse=True,
    )
    by_start: dict[str, dict[str, Any]] = {}

    def is_closed_trade_override(candidate: dict[str, Any]) -> bool:
        entries = [
            entry
            for entry in candidate["evidence"].get("performance_snapshot", {}).values()
            if isinstance(entry, dict)
            and _ii_hsbc_cash._parse_decimal_text_or_none(entry.get("realized_total"))
            not in {None, ZERO}
        ]
        closed_count = sum(
            _normalize_text(entry.get("realized_total_source")) == "ibkr_closed_trades"
            for entry in entries
        )
        raw_count = len(entries) - closed_count
        return bool(entries) and closed_count > raw_count

    for candidate in candidates:
        start = candidate["window_start"]
        current = by_start.get(start)
        candidate_rank = (
            1 if is_closed_trade_override(candidate) else 0,
            candidate["window_end"],
            _normalize_text(candidate["evidence"].get("snapshot_updated_at")),
            _normalize_text(candidate["evidence"].get("evidence_id")),
        )
        current_rank = (
            (
                1 if is_closed_trade_override(current) else 0,
                current["window_end"],
                _normalize_text(current["evidence"].get("snapshot_updated_at")),
                _normalize_text(current["evidence"].get("evidence_id")),
            )
            if current is not None
            else None
        )
        if current is None or (
            candidate_rank[0] < current_rank[0]
            or (
                candidate_rank[0] == current_rank[0]
                and candidate_rank[1:] > current_rank[1:]
            )
        ):
            by_start[start] = candidate

    remaining = sorted(
        by_start.values(), key=lambda item: (item["window_start"], item["window_end"])
    )
    selected: list[dict[str, Any]] = []
    while remaining:
        if not selected:
            baseline = remaining.pop(0)
            baseline["realized_increment"] = {
                normalize_ticker(_normalize_text(ticker)): realized_total
                for ticker, raw_entry in baseline["evidence"]
                .get(
                    "performance_snapshot",
                    {},
                )
                .items()
                if isinstance(raw_entry, dict)
                and (
                    realized_total := _ii_hsbc_cash._parse_decimal_text_or_none(
                        raw_entry.get("realized_total")
                    )
                )
                is not None
            }
            selected.append(baseline)
            continue
        cursor = selected[-1]["window_end"]
        extension_candidates: list[dict[str, Any]] = []
        for item in remaining:
            if not cursor or not item["window_start"] or item["window_end"] <= cursor:
                continue
            day_gap = (
                date.fromisoformat(item["window_start"]) - date.fromisoformat(cursor)
            ).days
            if day_gap in {1, 2, 3}:
                item["realized_increment"] = {
                    normalize_ticker(_normalize_text(ticker)): realized_total
                    for ticker, raw_entry in item["evidence"]
                    .get(
                        "performance_snapshot",
                        {},
                    )
                    .items()
                    if isinstance(raw_entry, dict)
                    and (
                        realized_total := _ii_hsbc_cash._parse_decimal_text_or_none(
                            raw_entry.get("realized_total")
                        )
                    )
                    is not None
                }
                extension_candidates.append(item)
                continue
            if day_gap <= 0:
                tail = _verified_ibkr_overlapping_realized_tail(
                    item,
                    covered_through=cursor,
                    transactions=transactions,
                    broker=broker,
                    account=account,
                )
                if tail is not None:
                    item["realized_increment"] = tail
                    extension_candidates.append(item)
        if not extension_candidates:
            break
        next_candidate = max(
            extension_candidates,
            key=lambda item: (item["window_end"], item["window_start"]),
        )
        selected.append(next_candidate)
        remaining.remove(next_candidate)

    if not selected:
        return None
    latest_candidate = max(
        selected,
        key=lambda item: (
            item["window_end"],
            _normalize_text(item["evidence"].get("snapshot_updated_at")),
            _normalize_text(item["evidence"].get("evidence_id")),
        ),
    )
    latest_snapshot = latest_candidate["evidence"].get("performance_snapshot", {})
    cumulative_snapshot: dict[str, dict[str, Any]] = {}
    for candidate in selected:
        for ticker, raw_entry in (
            candidate["evidence"].get("performance_snapshot", {}).items()
        ):
            if not isinstance(raw_entry, dict):
                continue
            realized_total = candidate.get("realized_increment", {}).get(
                normalize_ticker(_normalize_text(ticker))
            )
            if realized_total is None:
                continue
            entry = cumulative_snapshot.setdefault(
                ticker,
                {
                    **raw_entry,
                    "realized_total": "0",
                },
            )
            entry.setdefault(
                "asset_category", raw_entry.get("asset_category", "Stocks")
            )
            entry.setdefault("currency", raw_entry.get("currency", "USD"))
            entry["realized_total"] = (
                _decimal_to_str(
                    (
                        _ii_hsbc_cash._parse_decimal_text_or_none(
                            entry.get("realized_total")
                        )
                        or ZERO
                    )
                    + realized_total
                )
                or "0"
            )

    for ticker, entry in cumulative_snapshot.items():
        latest_entry = (
            latest_snapshot.get(ticker) if isinstance(latest_snapshot, dict) else None
        )
        if isinstance(latest_entry, dict):
            for key in ("asset_category", "currency", "unrealized_total", "code"):
                if key in latest_entry:
                    entry[key] = latest_entry[key]
            unrealized_total = _ii_hsbc_cash._parse_decimal_text_or_none(
                latest_entry.get("unrealized_total")
            )
            realized_total = _ii_hsbc_cash._parse_decimal_text_or_none(
                entry.get("realized_total")
            )
            if unrealized_total is not None and realized_total is not None:
                entry["total"] = (
                    _decimal_to_str(realized_total + unrealized_total) or "0"
                )
        else:
            entry["unrealized_total"] = "0"
            entry["total"] = _normalize_text(entry.get("realized_total")) or "0"
        entry["realized_total_source"] = "ibkr_csv_cumulative_non_overlapping_periods"

    latest_evidence_id = _normalize_text(
        latest_candidate["evidence"].get("evidence_id")
    )
    contributor_ids = [
        evidence_id
        for candidate in selected
        if (evidence_id := _normalize_text(candidate["evidence"].get("evidence_id")))
    ]
    return (
        cumulative_snapshot,
        latest_candidate["window_end"],
        latest_evidence_id,
        contributor_ids,
    )


def _normalize_reconciliation_date(value: Any) -> str:
    raw_value = _normalize_text(value).replace("T", " ")
    match = re.match(r"^(20\d{2}-\d{2}-\d{2})", raw_value)
    if not match:
        return ""
    try:
        date.fromisoformat(match.group(1))
    except ValueError:
        return ""
    return match.group(1)


def _reconciliation_transaction_scope(
    transaction: dict[str, Any],
    *,
    broker: str,
    account: str,
) -> tuple[str, str, str, str]:
    source = (
        transaction.get("source") if isinstance(transaction.get("source"), dict) else {}
    )
    raw_broker = _normalize_text(transaction.get("broker") or source.get("broker"))
    transaction_broker = (
        _ii_basics._normalize_broker_code(raw_broker) if raw_broker else broker
    )
    transaction_account = _normalize_text(
        transaction.get("account_id")
        or transaction.get("account")
        or source.get("account_id")
        or source.get("account")
        or source.get("account_number")
    )
    ticker = normalize_ticker(_normalize_text(transaction.get("ticker")))
    currency = _normalize_text(
        transaction.get("currency") or source.get("currency")
    ).upper()
    return transaction_broker, transaction_account, ticker, currency


def _build_broker_realized_pnl_reconciliation(
    broker: str,
    account: str,
    *,
    position_snapshot: dict[str, Any],
    position_snapshot_as_of: str,
    performance_snapshot: dict[str, Any],
    performance_snapshot_as_of: str,
    performance_snapshot_source: str,
    position_snapshot_source: str,
    holdings_validation: dict[str, Any],
    transactions: list[dict[str, Any]],
    evidence_records: list[dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    """Emit source coverage without claiming that browser replay succeeded."""
    if not broker:
        return {}
    normalized_position_snapshot = _normalize_snapshot_keys(position_snapshot)
    normalized_performance_snapshot = _normalize_snapshot_keys(performance_snapshot)
    validation = holdings_validation if isinstance(holdings_validation, dict) else {}
    history_complete = validation.get("history_complete")
    if not isinstance(history_complete, bool):
        history_complete = None
    history_matched = validation.get("matched") is True
    performance_as_of = _normalize_reconciliation_date(performance_snapshot_as_of)
    position_as_of = _normalize_reconciliation_date(position_snapshot_as_of)
    ticker_transactions: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for transaction in transactions:
        if not isinstance(transaction, dict):
            continue
        transaction_broker, transaction_account, ticker, _currency = (
            _reconciliation_transaction_scope(
                transaction,
                broker=broker,
                account=account,
            )
        )
        if (
            transaction_broker != broker
            or not _ii_basics._accounts_are_compatible(
                broker, account, transaction_account
            )
            or not ticker
            or _normalize_text(transaction.get("type")).lower()
            not in _REALIZED_PNL_REPLAY_TRANSACTION_TYPES
        ):
            continue
        ticker_transactions[ticker].append(transaction)

    tickers = set(normalized_position_snapshot) | set(normalized_performance_snapshot)
    tickers.update(ticker_transactions)
    reconciliations: dict[str, dict[str, Any]] = {}
    for ticker in sorted(tickers):
        position_entry = normalized_position_snapshot.get(ticker)
        performance_entry = normalized_performance_snapshot.get(ticker)
        scoped_transactions = ticker_transactions.get(ticker, [])
        transaction_dates = [
            _normalize_reconciliation_date(transaction.get("date"))
            for transaction in scoped_transactions
        ]
        transaction_dates = [value for value in transaction_dates if value]
        history_through = max(transaction_dates, default="")
        later_transactions = (
            [
                date_value
                for date_value in transaction_dates
                if date_value > performance_as_of
            ]
            if performance_as_of
            else []
        )
        later_sell_count = sum(
            1
            for transaction in scoped_transactions
            if performance_as_of
            and _normalize_reconciliation_date(transaction.get("date"))
            > performance_as_of
            and _normalize_text(transaction.get("type")).lower() == "sell"
        )
        performance_has_ticker = isinstance(performance_entry, dict)
        position_has_ticker = isinstance(position_entry, dict)
        replay_required = bool(performance_has_ticker and later_transactions)
        if not replay_required:
            replay_status = "not_required"
            replay_reason = "no_transactions_after_performance_snapshot"
        elif position_has_ticker:
            replay_status = "required_boundary_available"
            replay_reason = "performance_snapshot_precedes_transaction_history"
        elif history_complete is False and history_matched:
            replay_status = "required_partial_boundary_reconstructable"
            replay_reason = "partial_position_snapshot_requires_history_boundary"
        else:
            replay_status = "required_boundary_unavailable"
            replay_reason = "position_boundary_unavailable"

        if not performance_has_ticker:
            coverage_status = "complete" if history_complete is not False else "partial"
        elif not replay_required:
            coverage_status = "complete"
        elif replay_status == "required_boundary_unavailable":
            coverage_status = "unavailable"
        else:
            # The browser must still execute and validate the supplemental
            # replay before this source coverage can become complete.
            coverage_status = "partial"

        baseline_realized_total = ""
        baseline_currency = ""
        if isinstance(performance_entry, dict):
            baseline_realized_total = _normalize_text(
                performance_entry.get("realized_total")
            )
            baseline_currency = _normalize_text(
                performance_entry.get("currency")
            ).upper()
        if not baseline_currency and isinstance(position_entry, dict):
            baseline_currency = _normalize_text(position_entry.get("currency")).upper()

        position_entry_as_of = (
            _normalize_reconciliation_date(position_entry.get("as_of"))
            if isinstance(position_entry, dict)
            else ""
        )
        source = _normalize_text(
            performance_snapshot_source or position_snapshot_source
        )
        if not source:
            source = "broker_transaction_history"
        reconciliations[ticker] = {
            "schema_version": "v1",
            "broker": broker,
            "account": account,
            "ticker": ticker,
            "coverage_status": coverage_status,
            "as_of": {
                "performance_snapshot": performance_as_of,
                "position_snapshot": position_entry_as_of or position_as_of,
                "transaction_history": history_through,
            },
            "replay": {
                "status": replay_status,
                "required": replay_required,
                "reason": replay_reason,
                "post_performance_transaction_count": len(later_transactions),
                "post_performance_sell_count": later_sell_count,
            },
            "baseline": {
                "realized_pnl": baseline_realized_total,
                "currency": baseline_currency,
            },
            "history_complete": history_complete,
            "history_matched": history_matched,
            "source": source,
            "evidence_count": len(evidence_records),
        }
    return reconciliations


def _build_broker_snapshot_entry(
    broker: str,
    account: str,
    evidence_records: list[dict[str, Any]],
    *,
    transactions: list[dict[str, Any]],
    source_artifacts: list[dict[str, Any]],
) -> dict[str, Any]:
    evidence_by_id = {
        evidence["evidence_id"]: evidence
        for evidence in evidence_records
        if _normalize_text(evidence.get("evidence_id"))
    }
    evidence = [evidence_by_id[key] for key in sorted(evidence_by_id)]
    entry: dict[str, Any] = {
        "broker": broker,
        "account": account,
        "evidence": evidence,
    }
    position_candidates = [
        item
        for item in evidence
        if isinstance(item.get("position_snapshot"), dict) and item["position_snapshot"]
    ]
    if position_candidates:
        selected = max(
            position_candidates,
            key=lambda item: _broker_snapshot_evidence_sort_key(
                item, snapshot_kind="position"
            ),
        )
        selected_position_snapshot = selected["position_snapshot"]
        if (
            _normalize_text(selected.get("position_snapshot_source"))
            == "ibkr_gainskeeper_positions"
        ):
            selected_position_snapshot = _enrich_ibkr_gainskeeper_position_cost_basis(
                selected_position_snapshot,
                position_candidates,
                selected_evidence=selected,
                transactions=transactions,
                source_artifacts=source_artifacts,
                account=account,
            )
        position_snapshot_as_of = _normalize_text(
            selected.get("position_snapshot_as_of")
        ) or _normalize_text(selected.get("snapshot_as_of"))
        entry.update(
            {
                "position_snapshot": selected_position_snapshot,
                "position_snapshot_authoritative": selected[
                    "position_snapshot_authoritative"
                ],
                "position_snapshot_source": selected["position_snapshot_source"],
                "position_snapshot_as_of": position_snapshot_as_of,
                "position_snapshot_evidence_id": selected["evidence_id"],
                "holdings_validation": selected.get("holdings_validation", {}),
            }
        )
    performance_candidates = [
        item
        for item in evidence
        if isinstance(item.get("performance_snapshot"), dict)
        and item["performance_snapshot"]
    ]
    if performance_candidates:
        selected = max(
            performance_candidates,
            key=lambda item: _broker_snapshot_evidence_sort_key(
                item, snapshot_kind="performance"
            ),
        )
        performance_snapshot = selected["performance_snapshot"]
        performance_snapshot_as_of = _normalize_text(
            selected.get("performance_snapshot_as_of")
        ) or _normalize_text(selected.get("snapshot_as_of"))
        if broker == "ibkr":
            cumulative_result = _aggregate_ibkr_csv_performance_snapshot(
                evidence,
                source_artifacts=source_artifacts,
                transactions=transactions,
                broker=broker,
                account=account,
            )
            if cumulative_result is not None:
                (
                    performance_snapshot,
                    performance_snapshot_as_of,
                    performance_snapshot_evidence_id,
                    performance_snapshot_realized_evidence_ids,
                ) = cumulative_result
            else:
                performance_snapshot_evidence_id = selected["evidence_id"]
                performance_snapshot_realized_evidence_ids = []
        else:
            performance_snapshot_evidence_id = selected["evidence_id"]
            performance_snapshot_realized_evidence_ids = []
        entry.update(
            {
                "performance_snapshot": performance_snapshot,
                "performance_snapshot_authoritative": selected[
                    "performance_snapshot_authoritative"
                ],
                "performance_snapshot_source": selected["performance_snapshot_source"],
                "performance_snapshot_as_of": performance_snapshot_as_of,
                "performance_snapshot_evidence_id": performance_snapshot_evidence_id,
            }
        )
        if performance_snapshot_realized_evidence_ids:
            entry["performance_snapshot_realized_evidence_ids"] = (
                performance_snapshot_realized_evidence_ids
            )
    reconciliation = _build_broker_realized_pnl_reconciliation(
        broker,
        account,
        position_snapshot=entry.get("position_snapshot", {}),
        position_snapshot_as_of=entry.get("position_snapshot_as_of", ""),
        performance_snapshot=entry.get("performance_snapshot", {}),
        performance_snapshot_as_of=entry.get("performance_snapshot_as_of", ""),
        performance_snapshot_source=entry.get("performance_snapshot_source", ""),
        position_snapshot_source=entry.get("position_snapshot_source", ""),
        holdings_validation=entry.get("holdings_validation", {}),
        transactions=transactions,
        evidence_records=evidence,
    )
    if reconciliation:
        entry["realized_pnl_reconciliation"] = reconciliation
    return entry


def _normalize_broker_snapshots(payload: dict[str, Any]) -> dict[str, dict[str, Any]]:
    transactions = _ii_merge_reconciliation._payload_transactions(payload)
    source_artifacts = _normalize_source_artifacts(payload.get("source_artifacts"))
    evidence_by_identity: dict[tuple[str, str], list[dict[str, Any]]] = {}
    raw_snapshots = payload.get("broker_snapshots")
    if isinstance(raw_snapshots, dict):
        for raw_snapshot in raw_snapshots.values():
            if not isinstance(raw_snapshot, dict):
                continue
            raw_evidence = raw_snapshot.get("evidence")
            if not isinstance(raw_evidence, list):
                raw_evidence = [raw_snapshot]
            for raw_item in raw_evidence:
                evidence = _normalize_broker_snapshot_evidence(raw_item)
                if evidence is None:
                    continue
                identity = (evidence["broker"], evidence["account"])
                evidence_by_identity.setdefault(identity, []).append(evidence)

    if not evidence_by_identity:
        for direct_evidence in _broker_snapshot_evidence_from_payload(payload):
            identity = (direct_evidence["broker"], direct_evidence["account"])
            evidence_by_identity.setdefault(identity, []).append(direct_evidence)

    snapshots: dict[str, dict[str, Any]] = {}
    for (broker, account), evidence in sorted(evidence_by_identity.items()):
        account_token = account or "unknown"
        snapshots[f"{broker}:{account_token}"] = _build_broker_snapshot_entry(
            broker,
            account,
            evidence,
            transactions=transactions,
            source_artifacts=source_artifacts,
        )
    return snapshots


def _merge_source_artifacts(
    existing_payload: dict[str, Any],
    incoming_payload: dict[str, Any],
) -> list[dict[str, Any]]:
    return _normalize_source_artifacts(
        [
            *_normalize_source_artifacts(existing_payload.get("source_artifacts")),
            *_normalize_source_artifacts(incoming_payload.get("source_artifacts")),
        ]
    )


def _merge_broker_snapshots(
    existing_payload: dict[str, Any],
    incoming_payload: dict[str, Any],
    *,
    merged_transactions: list[dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    existing_snapshots = _normalize_broker_snapshots(existing_payload)
    incoming_snapshots = _normalize_broker_snapshots(incoming_payload)
    combined = {
        "broker": "multiple",
        "account": "multiple",
        "transactions": merged_transactions,
        "source_artifacts": _merge_source_artifacts(
            existing_payload,
            incoming_payload,
        ),
        "broker_snapshots": {
            **existing_snapshots,
            **incoming_snapshots,
        },
    }
    for key, existing_snapshot in existing_snapshots.items():
        incoming_snapshot = incoming_snapshots.get(key)
        if incoming_snapshot is None:
            continue
        combined["broker_snapshots"][key] = {
            **existing_snapshot,
            "evidence": [
                *(existing_snapshot.get("evidence") or []),
                *(incoming_snapshot.get("evidence") or []),
            ],
        }
    return _normalize_broker_snapshots(combined)
