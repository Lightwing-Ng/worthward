"""Keep native Schwab validation scoped to the merged as-of inventory.

Code version: v1.1.0
"""

from __future__ import annotations

from copy import deepcopy

import pytest

from app.services.investment.importing.merge.schwab_position_validation import (
    validate_merged_schwab_positions,
)
from tests.python.services.test_schwab_provisional_reconciliation import buy_csv_payload


def _row(payload, **changes):
    row = {
        "date": "2026-10-13",
        "datetime": "2026-10-13 20:00:00",
        "type": "buy",
        "ticker": "DRAM",
        "currency": "USD",
        "quantity_raw": "5",
        "quantity_abs": "5",
        "price_raw": "52.15",
        "broker": "schwab",
        "account": payload["account"],
        "source": {
            "file_kind": "manual_investment_xlsx",
            "source_has_intraday_timestamp": False,
        },
    }
    row.update(changes)
    return row


def test_extra_manual_buy_cannot_reuse_incoming_matched_flag():
    incoming = buy_csv_payload()
    assert incoming["summary"]["holdings_validation"]["matched"] is True
    merged = deepcopy(incoming)
    merged["transactions"].append(_row(incoming))
    with pytest.raises(
        ValueError, match=r"Schwab merged holdings.*DRAM: replayed 10, Positions 5"
    ):
        validate_merged_schwab_positions(merged, incoming)


def test_stale_incoming_match_flag_does_not_prove_native_history_coverage():
    incoming = buy_csv_payload()
    incoming["transactions"] = [
        row for row in incoming["transactions"] if row.get("ticker") != "DRAM"
    ]
    assert incoming["summary"]["holdings_validation"]["matched"] is True
    merged = deepcopy(incoming)
    merged["transactions"].extend([_row(incoming), _row(incoming)])
    assert validate_merged_schwab_positions(merged, incoming) is None


def test_native_rows_after_snapshot_do_not_authorize_merged_rejection():
    incoming = buy_csv_payload()
    trade = next(row for row in incoming["transactions"] if row.get("ticker") == "DRAM")
    trade["datetime"] = "2026-10-13 10:00:00"
    trade["source"]["source_has_intraday_timestamp"] = True
    assert incoming["summary"]["holdings_validation"]["matched"] is True
    assert validate_merged_schwab_positions(deepcopy(incoming), incoming) is None


def test_success_is_fresh_and_does_not_mutate_either_payload():
    incoming = buy_csv_payload()
    merged = deepcopy(incoming)
    original_incoming = deepcopy(incoming)
    original_merged = deepcopy(merged)
    result = validate_merged_schwab_positions(merged, incoming)
    assert result == {
        "broker": "schwab",
        "account": incoming["account"],
        "as_of": "2026-10-13 09:00:00",
        "matched": True,
        "mismatch_count": 0,
        "mismatches": [],
        "source": "post_merge_scoped_transaction_replay",
        "excluded_post_snapshot_count": 0,
    }
    assert result is not incoming["summary"]["holdings_validation"]
    assert incoming == original_incoming
    assert merged == original_merged


def test_other_broker_and_other_account_are_not_merged_into_snapshot_scope():
    incoming = buy_csv_payload()
    merged = deepcopy(incoming)
    merged["transactions"].extend(
        [
            _row(incoming, broker="ibkr", account="U00000001"),
            _row(incoming, account="Individual ...002"),
        ]
    )
    assert validate_merged_schwab_positions(merged, incoming)["matched"] is True


@pytest.mark.parametrize("precise", [False, True])
def test_future_booking_date_does_not_invalidate_older_report(precise):
    incoming = buy_csv_payload()
    merged = deepcopy(incoming)
    merged["transactions"].append(
        _row(
            incoming,
            date="2026-10-15",
            datetime="2026-10-15 10:00:00",
            source={"source_has_intraday_timestamp": precise},
        )
    )
    merged["broker_summaries"]["schwab"]["position_snapshot_as_of"] = "2026-10-15"
    result = validate_merged_schwab_positions(merged, incoming)
    assert result["matched"] is True
    assert result["excluded_post_snapshot_count"] == 1


def test_source_proven_same_day_post_snapshot_execution_is_excluded():
    incoming = buy_csv_payload()
    merged = deepcopy(incoming)
    merged["transactions"].append(
        _row(
            incoming,
            datetime="2026-10-13 10:00:00",
            source={"source_has_intraday_timestamp": True},
        )
    )
    result = validate_merged_schwab_positions(merged, incoming)
    assert result["matched"] is True
    assert result["excluded_post_snapshot_count"] == 1


def test_newer_selected_same_account_snapshot_preserves_older_same_day_import():
    incoming = buy_csv_payload()
    merged = deepcopy(incoming)
    merged["transactions"].append(_row(incoming))
    selected = merged["broker_summaries"]["schwab"]
    for position in selected["position_snapshot"].values():
        position["as_of"] = "2026-10-13 11:00:00"
    selected["position_snapshot"]["DRAM"]["quantity"] = "10"
    assert validate_merged_schwab_positions(merged, incoming) is None


@pytest.mark.parametrize("other_scope", ["broker", "account"])
def test_another_scope_newer_snapshot_cannot_bypass_current_scope_guard(other_scope):
    incoming = buy_csv_payload()
    merged = deepcopy(incoming)
    merged["transactions"].append(_row(incoming))
    newer = deepcopy(merged["broker_summaries"]["schwab"])
    for position in newer["position_snapshot"].values():
        position["as_of"] = "2026-10-13 11:00:00"
    if other_scope == "broker":
        newer["broker"] = "hsbc"
        merged["broker_summaries"]["hsbc"] = newer
    else:
        newer["account"] = "Individual ...002"
        merged["broker_summaries"]["schwab"] = newer
    with pytest.raises(ValueError, match="replayed 10, Positions 5"):
        validate_merged_schwab_positions(merged, incoming)


def test_same_day_pre_snapshot_execution_is_counted():
    incoming = buy_csv_payload()
    merged = deepcopy(incoming)
    merged["transactions"].append(
        _row(
            incoming,
            datetime="2026-10-13 08:30:00",
            source={"source_has_intraday_timestamp": True},
        )
    )
    with pytest.raises(ValueError, match="replayed 10, Positions 5"):
        validate_merged_schwab_positions(merged, incoming)


def test_same_minute_unrelated_execution_is_not_placed_at_an_invented_boundary():
    incoming = buy_csv_payload()
    merged = deepcopy(incoming)
    merged["transactions"].append(
        _row(
            incoming,
            datetime="2026-10-13 09:00:30",
            source={"source_has_intraday_timestamp": True},
        )
    )
    assert validate_merged_schwab_positions(merged, incoming) is None


def test_native_paired_same_minute_execution_is_covered_by_its_own_snapshot():
    incoming = buy_csv_payload()
    trade = next(row for row in incoming["transactions"] if row.get("ticker") == "DRAM")
    trade["datetime"] = "2026-10-13 09:00:30"
    trade["source"]["source_has_intraday_timestamp"] = True
    assert (
        validate_merged_schwab_positions(deepcopy(incoming), incoming)["matched"]
        is True
    )


@pytest.mark.parametrize(
    "change",
    [
        {"position_snapshot_authoritative": False},
        {"position_snapshot_source": "manual"},
        {"holdings_validation": {"matched": False}},
        {"holdings_validation": {"matched": True, "history_complete": False}},
        {"unknown_transaction_type_count": 1},
    ],
)
def test_insufficient_native_coverage_does_not_claim_merged_validation(change):
    incoming = buy_csv_payload()
    incoming["summary"].update(change)
    assert validate_merged_schwab_positions(deepcopy(incoming), incoming) is None


def test_unpaired_artifacts_do_not_authorize_a_validation():
    incoming = buy_csv_payload()
    incoming["source_artifacts"] = incoming["source_artifacts"][:1]
    assert validate_merged_schwab_positions(deepcopy(incoming), incoming) is None


def test_missing_scope_or_boundary_is_not_filled_in():
    incoming = buy_csv_payload()
    merged = deepcopy(incoming)
    merged["transactions"].append(_row(incoming, account="", source={}))
    assert validate_merged_schwab_positions(merged, incoming) is None
    for snapshot in incoming["position_snapshot"].values():
        snapshot.pop("as_of", None)
    incoming["summary"].pop("position_snapshot_as_of", None)
    assert validate_merged_schwab_positions(deepcopy(incoming), incoming) is None


def test_shared_quantity_replay_includes_transfers_grants_drips_and_disposals():
    incoming = buy_csv_payload()
    for kind, quantity in [
        ("transfer_in", "2"),
        ("grant", "1"),
        ("dividend_reinvestment", "1"),
        ("transfer_out", "1"),
        ("sell", "1"),
    ]:
        incoming["transactions"].append(
            _row(
                incoming,
                date="2026-10-12",
                datetime="2026-10-12 20:00:00",
                type=kind,
                quantity_raw=quantity,
                quantity_abs=quantity,
            )
        )
    incoming["position_snapshot"]["DRAM"]["quantity"] = "7"
    assert (
        validate_merged_schwab_positions(deepcopy(incoming), incoming)["matched"]
        is True
    )


def test_unsupported_split_semantics_do_not_create_a_false_validation():
    incoming = buy_csv_payload()
    merged = deepcopy(incoming)
    merged["transactions"].append(_row(incoming, type="stock_split"))
    assert validate_merged_schwab_positions(merged, incoming) is None


def test_future_split_does_not_block_an_older_covered_snapshot():
    incoming = buy_csv_payload()
    merged = deepcopy(incoming)
    merged["transactions"].append(
        _row(
            incoming,
            date="2026-10-14",
            datetime="2026-10-14 20:00:00",
            type="stock_split",
        )
    )
    assert validate_merged_schwab_positions(merged, incoming)["matched"] is True
