"""Anonymous HSBC debit-card cashback classification and replay contracts.

Code version: v1.0.0
"""

from copy import deepcopy
from decimal import Decimal
import json

import pytest

from app.services import investment_import as service
from app.services.investment.importing import basics, bindings
from app.services.investment.importing.brokers.hsbc import (
    core,
    reconciliation,
    rewards,
    statements,
)
from app.services.investment.importing.brokers.zircon_hk import (
    build_investment_payload_from_zircon_hk_manual_xlsx,
    build_standard_investment_xlsx,
)
from app.services.investment.importing.merge import identity
from app.services.investment.investment_record_basics import (
    build_normalized_transaction_view,
)


ACCOUNT = "000-999999-999"


@pytest.fixture(autouse=True)
def anonymous_context(monkeypatch):
    monkeypatch.setattr(service, "_load_local_private_investment_evidence", lambda: {})
    monkeypatch.setattr(basics, "_load_local_private_investment_evidence", lambda: {})
    monkeypatch.setattr(core, "HSBC_EXPECTED_ACCOUNT_NUMBER", ACCOUNT)
    monkeypatch.setattr(reconciliation, "HSBC_EXPECTED_ACCOUNT_NUMBER", ACCOUNT)
    monkeypatch.setattr(statements, "HSBC_EXPECTED_ACCOUNT_NUMBER", ACCOUNT)


def _record(
    description="CASH REBATE 0055",
    *,
    amount="12.50",
    currency="HKD",
    kind="credit_interest",
    file_kind="hsbc_multi_currency_cash_account_text",
):
    value = Decimal(amount)
    return {
        "broker": "hsbc",
        "account": ACCOUNT,
        "date": "2026-07-14",
        "datetime": "2026-07-14 12:00:00",
        "type": kind,
        "ticker": "",
        "currency": currency,
        "description": description,
        "gross_amount_raw": amount,
        "net_amount_raw": amount,
        "commission_raw": "0",
        "quantity_raw": "",
        "price_raw": "",
        "source": {
            "file_kind": file_kind,
            "broker": "hsbc",
            "account_number": ACCOUNT,
            "account_type": f"{currency} Savings",
            "row_number": 1,
            "balance_after_raw": format(Decimal("100") + value, "f"),
        },
        "normalized": build_normalized_transaction_view(
            kind, None, None, value, Decimal(0), value, is_cash_flow_override=True
        ),
    }


def _payload(rows):
    return {
        "schema_version": "3.0.0",
        "broker": "hsbc",
        "account": ACCOUNT,
        "summary": {},
        "transactions": rows,
    }


@pytest.mark.parametrize(
    "description,amount",
    [
        ("CASH REBATE 0055", "12.50"),
        ("cash rebate 0055 (14JUL26)", "12.50"),
        ("CASH REBATE 0055 CREDIT AS ADVISED", "12.50"),
        ("CASH REBATE 0055 (14JUL26) CREDIT AS ADVISED", "12.50"),
        ("CASH REBATE 0055 DEPABC123-01", "12.50"),
        ("CASH REBATE REV 0055", "-2.25"),
        ("CASH REBATE REV 0055 DEBIT AS ADVISED", "-2.25"),
        ("REFUND P HSBCPCLOTRANSIT", "1.75"),
        ("REFUND P MEITUAN REBATE", "3.25"),
    ],
)
@pytest.mark.parametrize("currency", ["USD", "HKD", "CNH", "CNY"])
def test_known_cashback_uses_own_type_and_preserves_signed_cash(
    description, amount, currency
):
    record = _record(
        description,
        amount=amount,
        currency=currency,
        kind="withdrawal" if amount.startswith("-") else "deposit",
    )
    before = deepcopy(record)
    assert (
        core._classify_hsbc_cash_account_transaction(description, Decimal(amount))
        == "cash_reward"
    )
    normalized = bindings.normalize_investment_payload_tickers(_payload([record]))[
        "transactions"
    ][0]
    assert normalized["type"] == "cash_reward"
    assert normalized["net_amount_raw"] == before["net_amount_raw"]
    assert normalized["normalized"] == before["normalized"]
    assert normalized["source"]["account_type"] == before["source"]["account_type"]
    assert normalized["currency"] == ("CNH" if currency == "CNY" else currency)


@pytest.mark.parametrize(
    "description,amount,expected",
    [
        ("CREDIT INTEREST", "1.00", "credit_interest"),
        ("USD CREDIT INTEREST", "1.00", "credit_interest"),
        ("DEBIT INTEREST", "-1.00", "debit_interest"),
        ("REFUND P OTHER MERCHANT", "1.00", "deposit"),
        ("REFUND P HSBCPCLOTRANSIT EXTRA", "1.00", "deposit"),
        ("CASH REBATE 9999", "1.00", "credit_interest"),
        ("SOME OTHER REBATE", "1.00", "credit_interest"),
        ("CASH REBATE 0055 UNKNOWN", "1.00", "credit_interest"),
        ("CASH REBATE REV 0055", "1.00", "credit_interest"),
        ("CASH REBATE 0055", "-1.00", "withdrawal"),
        ("REFUND P MEITUAN REBATE", "-1.00", "withdrawal"),
        ("CASH REBATE 0055 DEBIT AS ADVISED", "1.00", "credit_interest"),
        ("CASH REBATE REV 0055 CREDIT AS ADVISED", "-1.00", "withdrawal"),
        ("REFUND P MEITUAN REBATE DEPABC123-01", "1.00", "credit_interest"),
        ("CASH REBATE 0055 DEPABC123-01 EXTRA", "1.00", "credit_interest"),
    ],
)
def test_unknown_and_contradictory_rows_never_become_cash_rewards(
    description, amount, expected
):
    assert (
        core._classify_hsbc_cash_account_transaction(description, Decimal(amount))
        == expected
    )
    record = _record(description, amount=amount, kind=expected)
    assert not rewards.is_hsbc_cash_reward_record(record)
    assert (
        bindings.normalize_investment_payload_tickers(_payload([record]))[
            "transactions"
        ][0]["type"]
        == expected
    )


@pytest.mark.parametrize(
    "mutation",
    [
        {"broker": "ibkr"},
        {
            "source": {
                "file_kind": "hsbc_multi_currency_cash_account_text",
                "account_type": "HKD Savings",
                "broker": "ibkr",
            }
        },
        {"type": "kol_reward"},
        {"type": "dividend"},
        {"ticker": "TEST"},
        {"currency": "EUR"},
        {"source": {"file_kind": "hsbc_credit_card", "account_type": "HKD Savings"}},
        {"source": {"file_kind": "hsbc_order_status", "account_type": "HKD Savings"}},
        {"source": {"file_kind": "hsbc_multi_currency_cash_account_text"}},
        {
            "source": {
                "file_kind": "hsbc_multi_currency_cash_account_text",
                "account_type": "Investment Services",
            }
        },
        {
            "source": {
                "file_kind": "hsbc_multi_currency_cash_account_text",
                "account_type": "USD Savings",
            }
        },
        {
            "source": {
                "file_kind": "hsbc_multi_currency_cash_account_text",
                "account_type": "HKD Savings",
                "transaction_type_raw": "KOL",
            }
        },
    ],
)
def test_cashback_description_alone_does_not_establish_bank_cash_context(mutation):
    record = {**_record(), **deepcopy(mutation)}
    assert not rewards.is_hsbc_cash_reward_record(record, broker="hsbc")
    before = deepcopy(record)
    bindings.normalize_investment_payload_tickers(_payload([record]))
    assert record["type"] == before["type"]


@pytest.mark.parametrize("currency", ["USD", "HKD", "CNH", "CNY"])
@pytest.mark.parametrize(
    "description,amount",
    [
        ("CASH REBATE 0055", "12.50"),
        ("CASH REBATE REV 0055", "-2.25"),
        ("REFUND P HSBCPCLOTRANSIT", "1.75"),
        ("REFUND P MEITUAN REBATE", "3.25"),
    ],
)
def test_pasted_bank_cash_entrypoints_preserve_reward_and_reversal_direction(
    currency, description, amount
):
    ending = format(Decimal("100") + Decimal(amount), ".2f")
    text = "\n".join(
        [
            f"{currency} Savings",
            "Account number:",
            ACCOUNT,
            "Ledger balance:",
            f"{ending} {currency}",
            "Available balance:",
            f"{ending} {currency}",
            "Post date Description Amount in Amount out Balance Additional options",
            "14 Jul 2026",
            description,
            str(abs(Decimal(amount))),
            ending,
            "Download",
        ]
    )
    (record,) = core._build_hsbc_cash_account_capture_from_text(text, warnings=[])[
        "records"
    ]
    assert record["type"] == "cash_reward"
    assert Decimal(record["net_amount_raw"]) == Decimal(amount)
    assert Decimal(record["normalized"]["cash_flow_amount"]) == Decimal(amount)
    public = reconciliation.build_investment_payload_from_hsbc_pasted_text(
        portfolio_text="", order_status_text="", cash_account_text=text
    )
    (record,) = public["transactions"]
    assert record["type"] == "cash_reward"
    assert record["normalized"]["is_cash_flow"] is True
    assert Decimal(record["normalized"]["net_amount"]) == Decimal(amount)
    assert Decimal(record["commission_raw"]) == 0
    assert Decimal(
        public["ending_cash_by_currency"]["CNH" if currency == "CNY" else currency]
    ) == Decimal(ending)


def test_csv_entrypoint_preserves_billing_amount_and_classifies_rewards():
    raw = (
        "Date,Description,Billing amount,Billing currency,Balance,Balance currency\n"
        "15/07/2026,CASH REBATE REV 0055,-2.25,USD,110.25,USD\n"
        "14/07/2026,CASH REBATE 0055,12.50,USD,112.50,USD\n"
    ).encode()
    payload = reconciliation.build_investment_payload_from_hsbc_usd_savings_csv(raw)
    assert [record["type"] for record in payload["transactions"]] == [
        "cash_reward",
        "cash_reward",
    ]
    assert [
        Decimal(record["net_amount_raw"]) for record in payload["transactions"]
    ] == [Decimal("12.50"), Decimal("-2.25")]
    assert payload["ending_cash_by_currency"] == {"USD": "110.25"}


@pytest.mark.parametrize("currency", ["USD", "HKD", "CNH", "CNY"])
def test_pdf_cash_entrypoint_classifies_deposit_and_withdrawal_columns(currency):
    def row(day, description, deposit="", withdrawal="", balance=""):
        return f"{day:<12}{description:<76}{deposit:<28}{withdrawal:<27}{balance}"

    text = "\n".join(
        [
            f"ANONYMOUS HOLDER Number : {ACCOUNT}",
            "HSBC One Portfolio",
            "15 July 2026",
            f"{currency} Savings",
            row("Date", "Transaction Details", "Deposit", "Withdrawal", "Balance"),
            row("13 Jul", "B/F BALANCE", balance="100.00"),
            row(
                "14 Jul",
                "CASH REBATE 0055 CREDIT AS ADVISED",
                deposit="12.50",
                balance="112.50",
            ),
            row("15 Jul", "CASH REBATE REV 0055", withdrawal="2.25", balance="110.25"),
            "Total Relationship Balance",
        ]
    )
    capture = statements._build_hsbc_statement_pdf_cash_capture(
        b"anonymous-statement", extracted_text=text
    )
    assert [record["type"] for record in capture["records"]] == [
        "cash_reward",
        "cash_reward",
    ]
    assert [Decimal(record["net_amount_raw"]) for record in capture["records"]] == [
        Decimal("12.50"),
        Decimal("-2.25"),
    ]
    raw = b"anonymous-statement"
    public = statements.build_investment_payload_from_hsbc_statement_pdfs(
        [(raw, "anonymous.pdf")], _extracted_text_by_payload_id={id(raw): text}
    )
    assert [record["type"] for record in public["transactions"]] == [
        "cash_reward",
        "cash_reward",
    ]
    assert all(
        record["normalized"]["is_cash_flow"] is True
        for record in public["transactions"]
    )
    assert Decimal(
        public["ending_cash_by_currency"]["CNH" if currency == "CNY" else currency]
    ) == Decimal("110.25")


@pytest.mark.parametrize(
    "description,amount,legacy_type",
    [
        ("CASH REBATE 0055", "12.50", "credit_interest"),
        ("REFUND P HSBCPCLOTRANSIT", "1.75", "deposit"),
        ("REFUND P MEITUAN REBATE", "3.25", "credit_interest"),
        ("CASH REBATE REV 0055", "-2.25", "withdrawal"),
        ("CASH REBATE REV 0055", "-2.25", "debit_interest"),
    ],
)
@pytest.mark.parametrize(
    "file_kind",
    ["hsbc_usd_account_text", "hsbc_usd_savings_csv", "hsbc_statement_cash"],
)
def test_legacy_identity_and_standard_roundtrip_do_not_duplicate(
    description, amount, legacy_type, file_kind
):
    currency = (
        "USD"
        if file_kind in {"hsbc_usd_account_text", "hsbc_usd_savings_csv"}
        else "HKD"
    )
    old = _record(
        description,
        amount=amount,
        kind=legacy_type,
        file_kind=file_kind,
        currency=currency,
    )
    incoming = _record(
        description + " (14JUL26)",
        amount=amount,
        kind="cash_reward",
        file_kind=file_kind,
        currency=currency,
    )
    assert identity._transaction_identity_key(
        old
    ) == identity._transaction_identity_key(incoming)
    assert identity._hsbc_cash_cross_source_identity_key(
        old
    ) == identity._hsbc_cash_cross_source_identity_key(incoming)
    existing = _payload([old])
    current = service.merge_investment_payloads(
        deepcopy(existing), _payload([incoming])
    )
    for replay in (existing, _payload([incoming]), json.loads(json.dumps(current))):
        current = service.merge_investment_payloads(current, deepcopy(replay))
        assert len(current["transactions"]) == 1
        assert current["transactions"][0]["type"] == "cash_reward"
        assert Decimal(current["transactions"][0]["net_amount_raw"]) == Decimal(amount)


def test_reward_identity_preserves_account_currency_direction_and_occurrence():
    first = _record()
    for change in (
        {"account": "000-999999-998"},
        {"currency": "USD"},
        {"description": "REFUND P HSBCPCLOTRANSIT"},
        {"net_amount_raw": "-12.50"},
    ):
        assert identity._transaction_identity_key(
            first
        ) != identity._transaction_identity_key({**deepcopy(first), **change})
    old_rows = [deepcopy(first), deepcopy(first)]
    new_rows = [_record(kind="cash_reward"), _record(kind="cash_reward")]
    for rows in (old_rows, new_rows):
        for number, record in enumerate(rows, 1):
            record["source"]["row_number"] = number
            record["source"]["balance_after_raw"] = format(
                Decimal("100") + number * Decimal("12.50"), ".2f"
            )
    current = _payload(old_rows)
    incoming = _payload(new_rows)
    for _ in range(2):
        current = service.merge_investment_payloads(current, deepcopy(incoming))
        assert len(current["transactions"]) == 2
        assert sum(
            Decimal(record["net_amount_raw"]) for record in current["transactions"]
        ) == Decimal("25.00")


def test_posting_references_remain_distinct_evidence():
    left = _record("CASH REBATE 0055 DEPABC123-01")
    right = _record("CASH REBATE 0055 DEPABC123-02")
    assert identity._transaction_identity_key(
        left
    ) != identity._transaction_identity_key(right)


@pytest.mark.parametrize(
    "location",
    ["source.currency", "source.statement_currency_raw", "normalized.currency"],
)
@pytest.mark.parametrize("value", ["USD", "CNH", "EUR"])
def test_conflicting_currency_evidence_never_reclassifies_legacy_cash(location, value):
    record = _record()
    owner, field = location.split(".")
    record[owner][field] = value
    assert not rewards.is_hsbc_cash_reward_record(record)
    assert (
        bindings.normalize_investment_payload_tickers(_payload([record]))[
            "transactions"
        ][0]["type"]
        == "credit_interest"
    )


@pytest.mark.parametrize("file_kind", ["hsbc_usd_account_text", "hsbc_usd_savings_csv"])
@pytest.mark.parametrize(
    "currency,account_type",
    [("HKD", "HKD Savings"), ("CNH", "CNH Savings"), ("USD", "USD Current")],
)
def test_usd_savings_source_kinds_reject_conflicting_cash_scope(
    file_kind, currency, account_type
):
    record = _record(currency=currency, file_kind=file_kind)
    record["source"]["account_type"] = account_type
    assert not rewards.is_hsbc_cash_reward_record(record)
    assert (
        bindings.normalize_investment_payload_tickers(_payload([record]))[
            "transactions"
        ][0]["type"]
        == "credit_interest"
    )


@pytest.mark.parametrize(
    "account_type",
    ["HKD Current", "USD Savings", "Foreign Currency Current", "Savings HKD"],
)
def test_conflicting_or_unsupported_account_aliases_are_rejected(account_type):
    record = _record()
    record["account_type"] = account_type
    assert not rewards.is_hsbc_cash_reward_record(record)


def test_matching_currency_and_account_aliases_preserve_offshore_renminbi_scope():
    record = _record(currency="CNY")
    record["normalized"]["currency"] = "CNH"
    record["source"]["currency"] = "RMB"
    record["source"]["statement_currency_raw"] = "CNY"
    record["account_type"] = "Foreign Currency Savings CNH"
    assert rewards.is_hsbc_cash_reward_record(record)
    assert (
        bindings.normalize_investment_payload_tickers(_payload([record]))[
            "transactions"
        ][0]["currency"]
        == "CNH"
    )


@pytest.mark.parametrize(
    "location,value",
    [
        ("normalized.net_amount", "999.00"),
        ("amount", "-12.50"),
        ("cash", "1e2"),
        ("cash", True),
    ],
)
def test_conflicting_or_non_decimal_cash_evidence_is_rejected(location, value):
    record = _record()
    if "." in location:
        owner, field = location.split(".")
        record[owner][field] = value
    else:
        record[location] = value
    assert not rewards.is_hsbc_cash_reward_record(record)


@pytest.mark.parametrize(
    "base", ["REFUND P HSBCPCLOTRANSIT", "REFUND P MEITUAN REBATE"]
)
@pytest.mark.parametrize("posting", ["DEPABC123-01", "DEBIT AS ADVISED"])
def test_campaign_descriptions_cannot_claim_standard_or_reversal_posting_suffix(
    base, posting
):
    assert not rewards.hsbc_cash_reward_description(f"{base} {posting}")


@pytest.mark.parametrize(
    "base,posting",
    [
        ("CASH REBATE REV 0055", "DEPABC123-01"),
        ("CASH REBATE REV 0055", "CREDIT AS ADVISED"),
        ("CASH REBATE 0055", "DEBIT AS ADVISED"),
    ],
)
def test_standard_and_reversal_descriptions_reject_opposite_posting_suffixes(
    base, posting
):
    assert not rewards.hsbc_cash_reward_description(f"{base} {posting}")


@pytest.mark.parametrize("currency", ["USD", "HKD", "CNH"])
def test_standard_transactions_workbook_preserves_reward_type_signed_money_and_cash(
    currency,
):
    records = [
        _record(
            "CASH REBATE 0055", amount="12.50", kind="cash_reward", currency=currency
        ),
        _record(
            "CASH REBATE REV 0055 DEBIT AS ADVISED",
            amount="-2.25",
            kind="cash_reward",
            currency=currency,
        ),
    ]
    records[1]["source"]["row_number"] = 2
    for index, record in enumerate(records):
        record["source"]["reference_id"] = f"anonymous-reward-{index}"
    imported = build_investment_payload_from_zircon_hk_manual_xlsx(
        xlsx_bytes=build_standard_investment_xlsx(records),
        filename="anonymous-standard.xlsx",
    )
    assert imported["summary"]["transaction_count"] == 2
    actual = imported["transactions"]
    assert [record["type"] for record in actual] == ["cash_reward", "cash_reward"]
    assert {record["broker"] for record in actual} == {"hsbc"}
    assert {record["account"] for record in actual} == {ACCOUNT}
    assert {record["currency"] for record in actual} == {currency}
    assert [Decimal(record["normalized"]["cash_flow_amount"]) for record in actual] == [
        Decimal("12.50"),
        Decimal("-2.25"),
    ]
    assert all(record["normalized"]["is_cash_flow"] is True for record in actual)
    assert all(Decimal(record.get("commission_raw", "0")) == 0 for record in actual)
