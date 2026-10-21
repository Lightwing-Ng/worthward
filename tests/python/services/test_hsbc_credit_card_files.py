"""Anonymous real-byte card file imports in isolated stores.

Code version: v1.0.0
"""

import base64
from copy import deepcopy
from decimal import Decimal
import hashlib
import json
from pathlib import Path
import shutil

import pytest

from app.services import credit_card_ledger as ledger
from app.services.hsbc_credit_card_files import capture_hsbc_credit_card_file
from tests.factories.hsbc_credit_card import hsbc_credit_card_text


pytestmark = pytest.mark.skipif(
    shutil.which("pdftotext") is None, reason="pdftotext is required"
)
_ACCOUNT = "4111111111111111"
_HEADER = (
    "Transaction date,Post date,Description,Billing amount,Billing currency,"
    "Transaction status,Merchant name,Country / region,Area / district,Credit / Debit\n"
)


def _pdf_bytes(*, amount="10.00", count=1, credit=False, month="OCT", year="2026"):
    """Build a small, valid PDF containing anonymous bank-shaped text evidence."""
    balance = format(Decimal(amount) * count * (-1 if credit else 1), ".2f")
    closing = balance.removeprefix("-") + ("CR" if credit else "")
    rows = [
        "Statement of HSBC Red Credit Card Account",
        "Account number 4111 1111 1111 1111",
        f"15 {month} {year} HKD{closing}",
        "Post date Trans date Description of transaction Amount (HKD)",
        "PREVIOUS BALANCE 0.00",
    ]
    for _ in range(count):
        rows.append(
            f"14{month} 12{month} {'IFS PAYMENT - THANK YOU' if credit else 'SAMPLE SHOP HONG KONG HK'} {amount}{'CR' if credit else ''}"
        )
    rows.extend(
        [
            "REWARDCASH OPENING BALANCE : 0",
            "REWARDCASH EARNED : 0",
            "REWARDCASH ADJUSTED : 0",
            "REWARDCASH REDEEMED : 0",
            "REWARDCASH CLOSING BALANCE : 0",
            "Total minimum payment due 0.00",
        ]
    )
    stream = (
        "BT /F1 10 Tf 40 780 Td 15 TL\n"
        + "\n".join(
            "("
            + row.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
            + ") Tj T*"
            for row in rows
        )
        + "\nET"
    )
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        f"<< /Length {len(stream.encode())} >>\nstream\n{stream}\nendstream".encode(),
    ]
    raw = b"%PDF-1.4\n"
    offsets = [0]
    for number, obj in enumerate(objects, 1):
        offsets.append(len(raw))
        raw += f"{number} 0 obj\n".encode() + obj + b"\nendobj\n"
    xref = len(raw)
    raw += b"xref\n0 6\n0000000000 65535 f \n" + b"".join(
        f"{offset:010d} 00000 n \n".encode() for offset in offsets[1:]
    )
    return (
        raw + f"trailer << /Size 6 /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    )


def _csv_bytes(*, count=1, reward=False):
    purchase = "12/10/2026,14/10/2026,APPLEPAY SAMPLE SHOP HONG KONG HK,-10.00,HKD,POSTED,SAMPLE SHOP,HONG KONG,HONG KONG,DEBIT\n"
    return (
        _HEADER
        + purchase * count
        + (
            "15/10/2026,15/10/2026,PAY w/RC SAMPLE SHOP HONG KONG HK,2.00,HKD,POSTED,SAMPLE SHOP,HONG KONG,HONG KONG,CREDIT\n"
            if reward
            else ""
        )
    ).encode()


def _files(tmp_path, *, count=1, reward=False):
    pdf = tmp_path / "statement.pdf"
    csv = tmp_path / "transactions.csv"
    pdf.write_bytes(_pdf_bytes(count=count))
    csv.write_bytes(_csv_bytes(count=count, reward=reward))
    return [pdf, csv]


@pytest.fixture(autouse=True)
def protected_store_unchanged():
    path = Path(__file__).resolve().parents[3] / "settings_store" / "investment.parquet"
    before = hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else None
    yield
    assert (
        hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else None
    ) == before


def _page(
    *, pending=False, amount="10.00", description="APPLEPAY SAMPLE SHOP HONG KONG HK"
):
    return hsbc_credit_card_text(
        transactions=(
            f"12 Oct 2026\nCard ending in 1111\n{description}\n{amount} HKD"
            + ("\nPending" if pending else "")
        )
    )


def test_pdf_original_bytes_dated_signed_snapshot_and_separate_dates():
    raw = _pdf_bytes(credit=True)
    capture = capture_hsbc_credit_card_file(raw, "statement.pdf")
    assert capture["snapshot"]["account_balance"] == "-10.00"
    assert capture["snapshot"]["current_amount_due"] is None
    assert capture["snapshot_as_of"] == "2026-10-15"
    assert capture["transactions"][0]["transaction_date"] == "2026-10-12"
    assert capture["transactions"][0]["post_date"] == "2026-10-14"
    assert capture["transactions"][0]["kind"] == "repayment"
    assert base64.b64decode(capture["source"]["content_base64"]) == raw
    assert capture["source"]["sha256"] == hashlib.sha256(raw).hexdigest()
    assert "Account balance:" not in capture["source"]["text"]


def test_bundle_preview_is_read_only_and_preserves_current_page_snapshot(tmp_path):
    files = _files(tmp_path, reward=True)
    path = tmp_path / "uncreated" / "cards.json"
    preview = ledger.preview_hsbc_credit_card_files(files, path)
    assert preview["input_file_count"] == 2
    assert preview["input_row_count"] == 3
    assert preview["unique_transaction_count"] == 2
    assert preview["summary"]["rewardcash_total"] == "2.00"
    assert not path.parent.exists()
    ledger.commit_hsbc_credit_card_import(_page(pending=True), path)
    before = path.read_bytes()
    page_snapshot = ledger.read_credit_card_ledger(path)["accounts"][0]["snapshot"]
    preview = ledger.preview_hsbc_credit_card_files(files, path)
    assert path.read_bytes() == before
    assert preview["summary"]["added_count"] == 1
    assert preview["summary"]["promoted_count"] == 1
    result = ledger.commit_hsbc_credit_card_files(files, path)
    assert result["snapshot"] == page_snapshot
    stored = ledger.load_credit_card_ledger(path)
    history = next(iter(stored["accounts"].values()))["captures"]
    assert history[-2]["snapshot_as_of"] == "2026-10-15"
    assert history[-1]["snapshot"] is None
    row = next(
        row for row in stored["transactions"].values() if row["kind"] == "purchase"
    )
    assert row["status"] == "posted"
    assert row["transaction_date"] == "2026-10-12"
    assert row["post_dates"] == ["2026-10-14"]
    assert len(row["source_sha256s"]) == 3
    before = path.read_bytes()
    assert (
        ledger.commit_hsbc_credit_card_files(files, path)["summary"]["added_count"] == 0
    )
    assert path.read_bytes() == before


def test_file_to_page_to_file_does_not_double_count(tmp_path):
    files = _files(tmp_path, reward=True)
    path = tmp_path / "cards.json"
    ledger.commit_hsbc_credit_card_files(files, path)
    page = _page().replace(
        "Download",
        "15 Oct 2026\nCard ending in 1111\nPAY w/RC SAMPLE SHOP HONG KONG HK\n2.00 HKD\nDownload",
    )
    result = ledger.commit_hsbc_credit_card_import(page, path)
    assert result["summary"]["added_count"] == 0
    assert len(result["transactions"]) == 2
    result = ledger.commit_hsbc_credit_card_files(list(reversed(files)), path)
    assert result["summary"]["added_count"] == 0
    assert result["summary"]["rewardcash_total"] == "2.00"


def test_identical_occurrences_survive_overlapping_files(tmp_path):
    files = _files(tmp_path, count=2)
    result = ledger.commit_hsbc_credit_card_files(files, tmp_path / "cards.json")
    assert result["unique_transaction_count"] == 2
    assert result["summary"]["posted_purchase_total"] == "20.00"
    assert result["summary"]["duplicate_count"] == 2


def test_csv_requires_full_account_proven_by_non_csv_evidence(tmp_path):
    files = _files(tmp_path)
    path = tmp_path / "cards.json"
    with pytest.raises(ValueError, match="complete verified account"):
        ledger.preview_hsbc_credit_card_files([files[1]], path)
    with pytest.raises(ValueError, match="proven"):
        ledger.preview_hsbc_credit_card_files([files[1]], path, account_number=_ACCOUNT)
    ledger.commit_hsbc_credit_card_import(_page(), path)
    assert ledger.commit_hsbc_credit_card_files(
        [files[1]], path, account_number=_ACCOUNT
    )["committed"]
    with pytest.raises(ValueError, match="explicit account scope"):
        ledger.preview_hsbc_credit_card_files(
            files, path, account_number="4222222222221111"
        )


@pytest.mark.parametrize(
    "target",
    ["raw", "text", "parser", "snapshot", "snapshot_date", "post_dates", "binding"],
)
def test_file_ledger_rejects_tampered_evidence(tmp_path, target):
    path = tmp_path / "cards.json"
    ledger.commit_hsbc_credit_card_files(_files(tmp_path), path)
    original = json.loads(path.read_text())
    altered = deepcopy(original)
    pdf = next(
        source
        for source in altered["sources"].values()
        if source["format"] == "statement_pdf"
    )
    if target == "raw":
        pdf["content_base64"] = base64.b64encode(b"%PDF-altered").decode()
    elif target == "text":
        pdf["text"] += "\nchanged"
        pdf["text_sha256"] = hashlib.sha256(pdf["text"].encode()).hexdigest()
    elif target == "parser":
        pdf["parser_version"] = "unsupported"
    elif target == "snapshot":
        next(iter(altered["accounts"].values()))["snapshot"]["account_balance"] = (
            "999.00"
        )
    elif target == "snapshot_date":
        next(iter(altered["accounts"].values()))["captures"][0]["snapshot_as_of"] = (
            "2026-10-16"
        )
    elif target == "post_dates":
        next(iter(altered["transactions"].values()))["post_dates"] = ["2026-10-16"]
    else:
        next(
            source
            for source in altered["sources"].values()
            if source["format"] == "transaction_csv"
        )["binding_source_sha256"] = "0" * 64
    path.write_text(json.dumps(altered))
    with pytest.raises(ValueError, match="damaged or incompatible"):
        ledger.load_credit_card_ledger(path)


def test_invalid_bundle_is_atomic_and_does_not_commit_valid_pdf(tmp_path):
    path = tmp_path / "cards.json"
    ledger.commit_hsbc_credit_card_import(_page(), path)
    before = path.read_bytes()
    files = _files(tmp_path)
    files[1].write_bytes(_csv_bytes().replace(b"DEBIT", b"CREDIT"))
    with pytest.raises(ValueError, match="direction"):
        ledger.commit_hsbc_credit_card_files(files, path)
    assert path.read_bytes() == before
