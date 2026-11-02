"""Isolated HSBC credit-card persistence and reconciliation contracts.

Code version: v1.1.0
- Added: Foreign pending-currency isolation and expanded-detail provenance coverage.
- Added: Preview isolation, replay, conservative reconciliation, concurrency,
  corruption handling, atomic failure, and browser-safe readback coverage.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from decimal import Decimal
import hashlib
import json
import multiprocessing
from pathlib import Path

import pytest

from app.services import credit_card_ledger as ledger


def _digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def _row(
    amount: str = "10.00",
    *,
    day: str = "2026-10-12",
    status: str = "posted",
    kind: str = "purchase",
    occurrence: int = 1,
    description: str = "MERCHANT",
    account: str = "card-a",
    currency: str = "HKD",
) -> dict:
    return {
        "id": _digest(
            json.dumps([account, day, amount, kind, occurrence, description, currency])
        ),
        "transaction_date": day,
        "card_last4": "1111",
        "description": description,
        "kind": kind,
        "status": status,
        "currency": currency,
        "amount": amount,
        "liability_delta": None
        if status == "pending"
        else format(Decimal(amount) if kind == "purchase" else -Decimal(amount), ".2f"),
        "occurrence": occurrence,
    }


def _capture(
    rows: list[dict] | None = None,
    *,
    account: str = "card-a",
    balance: str = "100.00",
    marker: str = "",
) -> str:
    rows = deepcopy(rows if rows is not None else [_row(account=account)])
    raw = json.dumps([account, rows, balance, marker], sort_keys=True)
    return json.dumps(
        {
            "schema_version": 1,
            "broker": "hsbc",
            "account_id": _digest(account),
            "account_last4": "1111",
            "account_name": "HSBC Red Credit Card",
            "currency": "HKD",
            "snapshot": {
                "account_balance": balance,
                "current_amount_due": "0.00",
                "minimum_payment": "0.00",
                "payment_due_date": "2026-11-06",
                "rewardcash_balance": "0.00",
            },
            "transactions": rows,
            "source": {"sha256": _digest(raw), "text": raw},
            "warnings": [],
        }
    )


def _mock_parse(text: str) -> dict:
    parsed = json.loads(text)
    if isinstance(parsed, dict):
        return parsed
    account, rows, balance, marker = parsed
    return json.loads(_capture(rows, account=account, balance=balance, marker=marker))


@pytest.fixture
def isolated(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    protected = (
        Path(__file__).resolve().parents[3] / "settings_store" / "investment.parquet"
    )
    before = (
        hashlib.sha256(protected.read_bytes()).hexdigest()
        if protected.exists()
        else None
    )
    monkeypatch.setattr(ledger, "_parse_capture", _mock_parse)
    yield tmp_path / "cards" / "credit_cards.json"
    after = (
        hashlib.sha256(protected.read_bytes()).hexdigest()
        if protected.exists()
        else None
    )
    assert after == before


def test_preview_never_creates_store_parent_or_lock(isolated: Path) -> None:
    result = ledger.preview_hsbc_credit_card_import(_capture(), isolated)
    assert result["ready"] is True
    assert result["summary"]["added_count"] == 1
    assert not isolated.parent.exists()


def test_commit_readback_replay_and_private_evidence(isolated: Path) -> None:
    text = _capture()
    result = ledger.commit_hsbc_credit_card_import(text, isolated)
    before = isolated.read_bytes()
    repeated = ledger.commit_hsbc_credit_card_import(text, isolated)
    assert result["committed"] is True
    assert repeated["summary"]["duplicate_count"] == 1
    assert repeated["summary"]["added_count"] == 0
    assert isolated.read_bytes() == before
    stored = ledger.load_credit_card_ledger(isolated)
    assert len(stored["sources"]) == 1
    assert (
        next(iter(stored["sources"].values()))["text"]
        == json.loads(text)["source"]["text"]
    )
    public = ledger.read_credit_card_ledger(isolated)
    assert public["accounts"][0]["last4"] == "1111"
    assert len(public["transactions"]) == 1
    assert "sources" not in public
    assert "capture_ids" not in public["transactions"][0]
    assert "source_sha256s" not in public["transactions"][0]


def test_reordered_and_overlapping_captures_keep_occurrence_multiplicity(
    isolated: Path,
) -> None:
    first, second = _row(), _row(occurrence=2)
    ledger.commit_hsbc_credit_card_import(_capture([first, second]), isolated)
    reversed_result = ledger.commit_hsbc_credit_card_import(
        _capture([second, first]), isolated
    )
    subset_result = ledger.commit_hsbc_credit_card_import(_capture([first]), isolated)
    assert reversed_result["summary"]["posted_purchase_count"] == 2
    assert reversed_result["summary"]["duplicate_count"] == 2
    assert subset_result["summary"]["posted_purchase_total"] == "20.00"
    assert subset_result["capture_summary"]["posted_purchase_count"] == 1


def test_same_day_pending_promotes_once_without_downgrade(isolated: Path) -> None:
    pending, posted = _capture([_row(status="pending")]), _capture([_row()])
    ledger.commit_hsbc_credit_card_import(pending, isolated)
    promotion = ledger.commit_hsbc_credit_card_import(posted, isolated)
    replay = ledger.commit_hsbc_credit_card_import(pending, isolated)
    assert promotion["summary"]["promoted_count"] == 1
    assert promotion["summary"]["pending_count"] == 0
    assert replay["summary"]["posted_purchase_total"] == "10.00"
    assert replay["summary"]["promoted_count"] == 0
    assert replay["transactions"][0]["status"] == "posted"


@pytest.mark.parametrize("reverse", [False, True])
def test_even_unique_cross_date_match_requires_review_in_either_order(
    isolated: Path, reverse: bool
) -> None:
    pending = _capture([_row(day="2026-10-10", status="pending")])
    posted = _capture([_row(day="2026-10-13")])
    first, second = (posted, pending) if reverse else (pending, posted)
    ledger.commit_hsbc_credit_card_import(first, isolated)
    before = isolated.read_bytes()
    result = ledger.commit_hsbc_credit_card_import(second, isolated)
    assert result["ready"] is False
    assert result["review_required"] is True
    assert result["summary"]["promoted_count"] == 0
    assert isolated.read_bytes() == before
    assert len(ledger.load_credit_card_ledger(isolated)["transactions"]) == 1
    assert (
        ledger.commit_hsbc_credit_card_import(second, isolated)["summary"][
            "added_count"
        ]
        == 0
    )


@pytest.mark.parametrize("posted_day", ["2026-10-09", "2026-10-18"])
def test_cross_date_match_requires_forward_posting_within_seven_days(
    isolated: Path, posted_day: str
) -> None:
    ledger.commit_hsbc_credit_card_import(
        _capture([_row(day="2026-10-10", status="pending")]), isolated
    )
    result = ledger.commit_hsbc_credit_card_import(
        _capture([_row(day=posted_day)]), isolated
    )
    assert result["summary"]["added_count"] == 1
    assert result["summary"]["pending_count"] == 1
    assert result["summary"]["posted_purchase_count"] == 1


@pytest.mark.parametrize("multiple_pending", [True, False])
def test_ambiguous_cross_date_matches_block_entire_commit(
    isolated: Path, multiple_pending: bool
) -> None:
    pending_rows = [
        _row(day="2026-10-10", status="pending", occurrence=value) for value in (1, 2)
    ][: 2 if multiple_pending else 1]
    posted_rows = [_row(day="2026-10-13", occurrence=value) for value in (1, 2)][
        : 1 if multiple_pending else 2
    ]
    ledger.commit_hsbc_credit_card_import(_capture(pending_rows), isolated)
    before = isolated.read_bytes()
    result = ledger.commit_hsbc_credit_card_import(_capture(posted_rows), isolated)
    assert result["ready"] is False
    assert result["review_required"] is True
    assert result["committed"] is False
    assert isolated.read_bytes() == before


def test_missing_pending_rows_are_retained(isolated: Path) -> None:
    ledger.commit_hsbc_credit_card_import(_capture([_row(status="pending")]), isolated)
    result = ledger.commit_hsbc_credit_card_import(_capture([_row("20.00")]), isolated)
    assert result["summary"]["pending_total"] == "10.00"
    assert result["summary"]["posted_purchase_total"] == "20.00"


def test_snapshot_capture_order_does_not_use_transaction_date(isolated: Path) -> None:
    first = _capture([_row(day="2026-10-14")], balance="100.00")
    second = _capture([_row(day="2026-10-01")], balance="200.00")
    ledger.commit_hsbc_credit_card_import(first, isolated)
    ledger.commit_hsbc_credit_card_import(second, isolated)
    replay = ledger.commit_hsbc_credit_card_import(first, isolated)
    account = next(iter(ledger.load_credit_card_ledger(isolated)["accounts"].values()))
    assert account["snapshot"]["account_balance"] == "200.00"
    assert [item["sequence"] for item in account["captures"]] == [1, 2]
    assert "as_of" not in account["snapshot"]
    assert replay["capture_snapshot"]["account_balance"] == "100.00"
    assert replay["snapshot"]["account_balance"] == "200.00"
    assert replay["merged_snapshot"]["account_balance"] == "200.00"


def test_repayment_rewardcash_and_pending_are_separate(isolated: Path) -> None:
    result = ledger.commit_hsbc_credit_card_import(
        _capture(
            [
                _row("30.00"),
                _row("10.00", kind="repayment"),
                _row("5.00", kind="rewardcash"),
                _row("8.00", status="pending"),
            ]
        ),
        isolated,
    )
    assert result["summary"] == {
        "posted_purchase_count": 1,
        "posted_purchase_total": "30.00",
        "repayment_count": 1,
        "repayment_total": "10.00",
        "rewardcash_count": 1,
        "rewardcash_total": "5.00",
        "pending_count": 1,
        "pending_total": "8.00",
        "pending_totals_by_currency": {"HKD": "8.00"},
        "added_count": 4,
        "promoted_count": 0,
        "duplicate_count": 0,
    }


def test_accounts_with_same_suffix_stay_separate(isolated: Path) -> None:
    ledger.commit_hsbc_credit_card_import(
        _capture([_row(account="a", status="pending")], account="a"), isolated
    )
    result = ledger.commit_hsbc_credit_card_import(
        _capture([_row(account="b", day="2026-10-13")], account="b"), isolated
    )
    assert result["summary"]["pending_count"] == 0
    public = ledger.read_credit_card_ledger(isolated)
    assert len(public["accounts"]) == 2
    assert len({row["account_id"] for row in public["transactions"]}) == 2
    assert public["summary"]["pending_count"] == 1


def test_threads_do_not_lose_independent_updates(isolated: Path) -> None:
    payloads = [_capture([_row(f"{value}.00")]) for value in range(1, 13)]
    with ThreadPoolExecutor(max_workers=6) as executor:
        results = list(
            executor.map(
                lambda text: ledger.commit_hsbc_credit_card_import(text, isolated),
                payloads,
            )
        )
    assert all(result["committed"] for result in results)
    assert len(ledger.load_credit_card_ledger(isolated)["transactions"]) == 12


def _process_commit(text: str, path: str) -> None:
    ledger._parse_capture = _mock_parse
    ledger.commit_hsbc_credit_card_import(text, Path(path))


def test_processes_do_not_lose_independent_updates(isolated: Path) -> None:
    context = multiprocessing.get_context("spawn")
    processes = [
        context.Process(
            target=_process_commit,
            args=(_capture([_row(f"{value}.00")]), str(isolated)),
        )
        for value in range(1, 5)
    ]
    for process in processes:
        process.start()
    for process in processes:
        process.join(20)
        assert process.exitcode == 0
    assert len(ledger.load_credit_card_ledger(isolated)["transactions"]) == 4


@pytest.mark.parametrize(
    "damage",
    ["json", "hash", "ownership", "liability", "economics", "snapshot", "omitted_row"],
)
def test_damaged_store_is_rejected_without_repair_or_overwrite(
    isolated: Path, damage: str
) -> None:
    ledger.commit_hsbc_credit_card_import(_capture(), isolated)
    payload = json.loads(isolated.read_text())
    if damage == "json":
        isolated.write_text("{broken")
    else:
        if damage == "hash":
            next(iter(payload["sources"].values()))["text"] += "tampered"
        elif damage == "ownership":
            next(iter(payload["transactions"].values()))["account_id"] = _digest(
                "missing"
            )
        elif damage == "liability":
            next(iter(payload["transactions"].values()))["liability_delta"] = "999.00"
        elif damage == "economics":
            next(iter(payload["transactions"].values())).update(
                amount="999.00", liability_delta="999.00"
            )
        elif damage == "snapshot":
            account = next(iter(payload["accounts"].values()))
            account["snapshot"]["account_balance"] = "999.00"
            account["captures"][-1]["snapshot"]["account_balance"] = "999.00"
        else:
            payload["transactions"].clear()
        isolated.write_text(json.dumps(payload))
    before = isolated.read_bytes()
    with pytest.raises(ValueError, match="damaged or incompatible"):
        ledger.commit_hsbc_credit_card_import(_capture([_row("20.00")]), isolated)
    assert isolated.read_bytes() == before


def test_failed_atomic_replace_preserves_original(
    isolated: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    ledger.commit_hsbc_credit_card_import(_capture(), isolated)
    before = isolated.read_bytes()

    def fail_replace(*_args):
        raise OSError("simulated isolated filesystem failure")

    monkeypatch.setattr(ledger.os, "replace", fail_replace)
    with pytest.raises(OSError, match="simulated"):
        ledger.commit_hsbc_credit_card_import(_capture([_row("20.00")]), isolated)
    assert isolated.read_bytes() == before
    assert not list(isolated.parent.glob("*.tmp"))


def test_invalid_input_never_creates_any_files(isolated: Path) -> None:
    with pytest.raises(ValueError):
        ledger.commit_hsbc_credit_card_import("invalid", isolated)
    assert not isolated.parent.exists()


def test_cross_date_match_cannot_reuse_an_exact_match(isolated: Path) -> None:
    pending = _row(day="2026-10-10", status="pending")
    ledger.commit_hsbc_credit_card_import(_capture([pending]), isolated)
    before = isolated.read_bytes()
    result = ledger.commit_hsbc_credit_card_import(
        _capture(
            [
                pending,
                _row(day="2026-10-13"),
            ]
        ),
        isolated,
    )
    assert result["review_required"] is True
    assert isolated.read_bytes() == before


def test_cross_date_ambiguity_inside_first_capture_blocks_store_creation(
    isolated: Path,
) -> None:
    result = ledger.commit_hsbc_credit_card_import(
        _capture(
            [
                _row(day="2026-10-10", status="pending"),
                _row(day="2026-10-12"),
            ]
        ),
        isolated,
    )
    assert result["ready"] is False
    assert not isolated.exists()


def test_public_transaction_redacts_card_numbers_from_descriptions(
    isolated: Path,
) -> None:
    text = _capture([_row(description="PAYMENT 4111-1111-1111-1111")])
    result = ledger.commit_hsbc_credit_card_import(text, isolated)
    public = ledger.read_credit_card_ledger(isolated)
    assert "4111-1111-1111-1111" not in json.dumps([result, public])
    assert "4111-1111-1111-1111" in isolated.read_text()


def test_actual_parser_preview_commit_and_readback(tmp_path: Path) -> None:
    from tests.factories.hsbc_credit_card import hsbc_credit_card_text

    path = tmp_path / "integration" / "cards.json"
    text = hsbc_credit_card_text()
    preview = ledger.preview_hsbc_credit_card_import(text, path)
    assert preview["capture_summary"]["posted_purchase_total"] == "4218.50"
    assert preview["capture_summary"]["pending_total"] == "2450.00"
    assert len(preview["transactions"]) == 11
    assert not path.parent.exists()
    result = ledger.commit_hsbc_credit_card_import(text, path)
    assert result["committed"] is True
    assert len(ledger.read_credit_card_ledger(path)["transactions"]) == 11
    assert "4111-1111-1111-1111" not in json.dumps(result)
    assert len(ledger.load_credit_card_ledger(path)["sources"]) == 1


@pytest.mark.parametrize("include_hkd", [False, True])
def test_foreign_pending_purchase_keeps_native_currency_and_no_liability(
    isolated: Path, include_hkd: bool
) -> None:
    foreign = _row("36.00", status="pending", currency="CNY")
    rows = [foreign]
    if include_hkd:
        rows.append(_row("5.99", status="pending"))
    text = _capture(rows)
    preview = ledger.preview_hsbc_credit_card_import(text, isolated)
    assert preview["ready"] is True
    assert preview["summary"]["pending_total"] is None
    expected = {"CNY": "36.00", **({"HKD": "5.99"} if include_hkd else {})}
    assert preview["summary"]["pending_totals_by_currency"] == expected
    assert not isolated.parent.exists()
    ledger.commit_hsbc_credit_card_import(text, isolated)
    public = ledger.read_credit_card_ledger(isolated)
    assert public["summary"]["pending_totals_by_currency"] == expected
    assert public["summary"]["pending_total"] is None
    assert all(row["liability_delta"] is None for row in public["transactions"])
    before = isolated.read_bytes()
    replay = ledger.commit_hsbc_credit_card_import(text, isolated)
    assert replay["summary"]["added_count"] == 0
    assert isolated.read_bytes() == before


def test_foreign_pending_and_hkd_posted_are_distinct_without_fx_inference(
    isolated: Path,
) -> None:
    ledger.commit_hsbc_credit_card_import(
        _capture([_row("36.00", status="pending", currency="CNY")]), isolated
    )
    result = ledger.commit_hsbc_credit_card_import(_capture([_row("36.00")]), isolated)
    assert result["ready"] is True
    assert result["summary"]["promoted_count"] == 0
    assert result["summary"]["pending_count"] == 1
    assert result["summary"]["posted_purchase_total"] == "36.00"
    assert len(result["transactions"]) == 2


@pytest.mark.parametrize(
    ("status", "kind", "currency"),
    [
        ("posted", "purchase", "CNY"),
        ("pending", "repayment", "CNY"),
        ("pending", "rewardcash", "CNY"),
        ("pending", "purchase", "USD"),
    ],
)
def test_foreign_currency_support_is_limited_to_cny_pending_purchases(
    status: str, kind: str, currency: str
) -> None:
    with pytest.raises(ValueError, match="status or currency"):
        ledger._validate_transaction(_row(status=status, kind=kind, currency=currency))


def test_expanded_duplicate_enriches_one_source_backed_row_without_losing_aliases(
    isolated: Path,
) -> None:
    row = _row()
    details = {
        "post_date": "2026-10-13",
        "transaction_time": "17:40:23",
        "merchant_name": "MERCHANT",
        "area_district": "Beijing",
        "country_region": "CHINA",
        "original_currency": "CNY",
        "original_amount": "8.00",
    }
    collapsed = _capture([row])
    expanded = _capture([{**row, **details}])
    ledger.commit_hsbc_credit_card_import(collapsed, isolated)
    result = ledger.commit_hsbc_credit_card_import(expanded, isolated)
    assert result["summary"]["duplicate_count"] == 1
    assert result["summary"]["added_count"] == 0
    public = ledger.read_credit_card_ledger(isolated)["transactions"]
    assert len(public) == 1
    assert all(public[0][field] == value for field, value in details.items())
    assert public[0]["post_dates"] == ["2026-10-13"]
    before = isolated.read_bytes()
    ledger.commit_hsbc_credit_card_import(collapsed, isolated)
    assert isolated.read_bytes() == before
    stored = ledger.load_credit_card_ledger(isolated)
    assert len(stored["sources"]) == 2
    assert len(next(iter(stored["transactions"].values()))["source_sha256s"]) == 2


def test_optional_details_must_match_one_retained_source_without_stitching(
    isolated: Path,
) -> None:
    first = {**_row(), "merchant_name": "MERCHANT", "country_region": "CHINA"}
    second = {**_row(), "transaction_time": "17:40:23"}
    ledger.commit_hsbc_credit_card_import(_capture([first]), isolated)
    ledger.commit_hsbc_credit_card_import(_capture([second]), isolated)
    row = ledger.read_credit_card_ledger(isolated)["transactions"][0]
    assert row["country_region"] == "CHINA"
    assert "transaction_time" not in row
    payload = json.loads(isolated.read_text())
    next(iter(payload["transactions"].values()))["transaction_time"] = "17:40:23"
    isolated.write_text(json.dumps(payload))
    with pytest.raises(ValueError, match="damaged or incompatible"):
        ledger.load_credit_card_ledger(isolated)


def test_posted_promotion_does_not_stitch_expanded_pending_metadata(
    isolated: Path,
) -> None:
    pending = {
        **_row(status="pending"),
        "post_date": None,
        "transaction_time": "17:40:23",
        "merchant_name": "MERCHANT",
    }
    ledger.commit_hsbc_credit_card_import(_capture([pending]), isolated)
    result = ledger.commit_hsbc_credit_card_import(_capture([_row()]), isolated)
    assert result["summary"]["promoted_count"] == 1
    row = ledger.read_credit_card_ledger(isolated)["transactions"][0]
    assert row["status"] == "posted"
    assert "post_date" not in row
    assert "transaction_time" not in row
    assert len(ledger.load_credit_card_ledger(isolated)["sources"]) == 2


def test_actual_expanded_parser_preview_commit_and_readback(tmp_path: Path) -> None:
    from tests.factories.hsbc_credit_card import hsbc_credit_card_expanded_text

    path = tmp_path / "expanded" / "cards.json"
    text = hsbc_credit_card_expanded_text()
    preview = ledger.preview_hsbc_credit_card_import(text, path)
    assert preview["ready"] is True
    assert preview["capture_summary"]["posted_purchase_total"] == "57.74"
    assert preview["capture_summary"]["pending_total"] is None
    assert preview["capture_summary"]["pending_totals_by_currency"] == {"CNY": "36.00"}
    assert not path.parent.exists()
    result = ledger.commit_hsbc_credit_card_import(text, path)
    assert result["committed"] is True
    public = ledger.read_credit_card_ledger(path)
    assert len(public["transactions"]) == 5
    pending = next(row for row in public["transactions"] if row["status"] == "pending")
    assert pending["currency"] == "CNY"
    assert pending["amount"] == "36.00"
    assert pending["liability_delta"] is None
    posted = next(
        row for row in public["transactions"] if row["description"].startswith("SALES:")
    )
    assert posted["post_dates"] == ["2026-10-30"]
    assert posted["original_amount"] == "43.00"
    assert posted["original_currency"] == "CNY"
    assert posted["liability_delta"] == "51.75"
    before = path.read_bytes()
    replay = ledger.commit_hsbc_credit_card_import(text, path)
    assert replay["summary"]["duplicate_count"] == 5
    assert path.read_bytes() == before
