"""Prevent credit-card captures from entering HSBC investment cash imports.

Code version: v1.0.1
- Fixed: Wrong-mode guidance names the unified first Copy/paste account field.
- Added: Wrong-mode rejection precedes cash parsing and preserves valid cash
  captures containing ordinary credit-card navigation or payment descriptions.
"""

from decimal import Decimal

import pytest

from app.services.investment.importing.brokers.hsbc import core, reconciliation
from tests.factories.hsbc_credit_card import hsbc_credit_card_text
from tests.support.investment_import.investment_import_test_support import (
    InvestmentImportFixtureMixin,
)


def _fail_if_cash_is_parsed(*_args, **_kwargs):
    raise AssertionError("Credit-card input reached the cash parser.")


@pytest.mark.parametrize(
    "entrypoint",
    [
        reconciliation.validate_hsbc_pasted_text,
        reconciliation.build_investment_payload_from_hsbc_pasted_text,
    ],
)
def test_wrong_mode_has_actionable_error_before_account_or_balance_parsing(
    monkeypatch: pytest.MonkeyPatch, entrypoint
) -> None:
    monkeypatch.setattr(
        core, "_extract_hsbc_account_number_from_text", _fail_if_cash_is_parsed
    )
    monkeypatch.setattr(
        core, "_build_hsbc_pasted_cash_account_section", _fail_if_cash_is_parsed
    )
    with pytest.raises(
        ValueError, match="Refresh the page and reopen Import, select HSBC, then Copy/paste"
    ) as error:
        entrypoint(
            portfolio_text="",
            order_status_text="",
            cash_account_text=hsbc_credit_card_text(),
        )
    assert "first account-page field and select Preview" in str(error.value)
    assert "Keep cash and credit-card pages in separate captures" in str(error.value)
    assert "then Credit card" not in str(error.value)


@pytest.mark.parametrize(
    "text",
    [
        hsbc_credit_card_text(),
        hsbc_credit_card_text().lower().replace("\n", "\r\n"),
        hsbc_credit_card_text().replace("HSBC Red Credit Card", "Selected card"),
        "HSBC Red Credit Card\nChange account\nAccount number:\n",
        hsbc_credit_card_text() + "\nAvailable balance:\n100.00 HKD\n",
    ],
)
def test_credit_card_detection_does_not_require_a_complete_valid_card_page(
    monkeypatch: pytest.MonkeyPatch, text: str
) -> None:
    monkeypatch.setattr(
        core, "_extract_hsbc_account_number_from_text", _fail_if_cash_is_parsed
    )
    with pytest.raises(ValueError, match="credit-card page"):
        core._build_hsbc_cash_account_capture_from_text_single(text, warnings=[])


@pytest.mark.parametrize("card_first", [True, False])
def test_mixed_paste_batch_is_rejected_before_parsing_any_cash_chunk(
    monkeypatch: pytest.MonkeyPatch, card_first: bool
) -> None:
    cash_text = InvestmentImportFixtureMixin._synthetic_hsbc_non_usd_cash_paste()
    chunks = [hsbc_credit_card_text(), cash_text]
    if not card_first:
        chunks.reverse()
    mixed = f"\n{core.HSBC_PASTE_CHUNK_MARKER}\n".join(chunks)
    monkeypatch.setattr(
        core, "_build_hsbc_cash_account_capture_from_text_single", _fail_if_cash_is_parsed
    )
    with pytest.raises(ValueError, match="credit-card page"):
        core._build_hsbc_cash_account_capture_from_text(mixed, warnings=[])


def test_cash_navigation_and_credit_card_payment_descriptions_remain_valid(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(core, "HSBC_EXPECTED_ACCOUNT_NUMBER", "000-999999-999")
    cash_text = InvestmentImportFixtureMixin._synthetic_hsbc_non_usd_cash_paste()
    cash_text = (
        "Card, loan & mortgage\nCredit cards\nHSBC Red Credit Card offers\n"
        + cash_text.replace("HKD INTEREST", "HSBC RED CREDIT CARD PAYMENT")
    )
    capture = core._build_hsbc_cash_account_capture_from_text(cash_text, warnings=[])
    assert capture["available_by_currency"] == {
        "HKD": Decimal("1046.10"),
        "CNH": Decimal("12.00"),
    }


def test_non_card_cash_error_keeps_its_original_meaning() -> None:
    with pytest.raises(ValueError, match="missing the available balance"):
        core._build_hsbc_cash_account_capture_from_text_single(
            "HKD Savings\nAccount number:\n000-999999-999\n", warnings=[]
        )
