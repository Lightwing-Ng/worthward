"""HSBC cash settlement does not establish an unreported gross fill price.

Code version: v1.0.0
"""

from __future__ import annotations

from copy import deepcopy
from decimal import Decimal
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
from types import SimpleNamespace

import pytest


@pytest.fixture(scope="module")
def domain():
    """Use normal application imports and the suite's isolated store configuration."""
    import app
    from app.services.investment.importing.brokers.hsbc import cash, reconciliation
    from app.services.investment.importing.merge import identity
    from app.services.investment.importing.support import _build_normalized_view
    from tests.python.services.test_hsbc_authoritative_settlement_regressions import (
        csv_artifact,
        settlement_order,
    )

    return SimpleNamespace(
        cash=cash,
        reconciliation=reconciliation,
        identity=identity,
        factories=SimpleNamespace(
            csv_artifact=csv_artifact,
            settlement_order=settlement_order,
        ),
        normalized=_build_normalized_view,
        repository_root=Path(app.__file__).resolve().parents[1],
    )


def _limit_order(domain, *, side="sell", principal="1000.00"):
    record = domain.factories.settlement_order(principal)
    quantity = Decimal(record["quantity_abs"])
    price = Decimal(principal) / quantity
    gross = Decimal(principal) * (-1 if side == "buy" else 1)
    record.update(
        type=side,
        quantity_raw=str(quantity if side == "buy" else -quantity),
        price_raw=str(price),
        gross_amount_raw=str(gross),
        net_amount_raw=str(gross),
        normalized=domain.normalized(side, quantity, price, gross, Decimal(0), gross),
    )
    order_id = "P-100001" if side == "buy" else "S-100001"
    record["source"].update(
        file_kind="hsbc_order_status_text",
        order_id=order_id,
        statement_order_id=order_id,
        order_type="Limit Price Order",
        order_status="Fully Executed",
        execution_price_source="hsbc_order_status_price",
        cash_replay_pending_settlement=True,
    )
    return record


def _artifact(domain, amounts, *, side="sell"):
    artifact = domain.factories.csv_artifact(amounts)
    if side == "buy":
        import base64

        content = base64.b64decode(artifact["content_base64"]).replace(
            b"REF S100001001 SEC", b"REF P100001001 SEC"
        )
        artifact.update(
            content_base64=base64.b64encode(content).decode(),
            sha256=hashlib.sha256(content).hexdigest(),
            byte_count=len(content),
        )
    return artifact


def _settle(domain, order, amounts):
    settled = deepcopy(order)
    artifact = _artifact(domain, amounts, side=order["type"])
    updated = domain.reconciliation._reconcile_hsbc_orders_with_authoritative_cash_evidence(
        [settled], [artifact]
    )
    assert updated == 1
    return domain.identity._merge_transaction_records(order, settled)


def _price_evidence(record):
    source = record["source"]
    return {
        "price_raw": record["price_raw"],
        "gross_amount_raw": record["gross_amount_raw"],
        "unit_price": record["normalized"]["unit_price"],
        "gross_amount": record["normalized"]["gross_amount"],
        "source": {
            key: value
            for key, value in source.items()
            if key.startswith("execution_price_")
        },
    }


def _legacy_final(domain):
    record = _limit_order(domain)
    record.update(
        price_raw="100.003", gross_amount_raw="1000.03", commission_raw="-0.03"
    )
    record["normalized"].update(
        unit_price="100.003", gross_amount="1000.03", commission="-0.03"
    )
    record["source"].update(
        execution_price_source="hsbc_cash_settlement_amount",
        execution_price_status="final_settled",
        execution_price_calibration_status="settled_cash_reconciled",
        execution_price_raw="100.003",
        execution_price_final_raw="100.003",
        execution_price_provisional_raw="100.000",
        execution_price_provisional_source="hsbc_order_status_price",
        execution_price_settlement_date="2026-07-15",
        execution_price_settlement_amount_raw="1000.00",
    )
    record["source"].pop("cash_replay_pending_settlement", None)
    return record


def test_limit_sell_preserves_estimate_while_postings_settle_cash(domain):
    original = _limit_order(domain)
    settled = _settle(domain, original, ["1000.00", "-0.03"])
    source = settled["source"]

    assert settled["price_raw"] == original["price_raw"]
    assert settled["gross_amount_raw"] == original["gross_amount_raw"]
    assert settled["normalized"]["unit_price"] == original["normalized"]["unit_price"]
    assert source["execution_price_status"] == "settled_cash_price_unconfirmed"
    assert "execution_price_final_raw" not in source
    assert source.get("cash_replay_pending_settlement") is not True
    assert source["cash_settlement_date"] == "2026-07-15"
    postings = source["cash_settlement_postings"]
    assert [Decimal(row["amount_raw"]) for row in postings] == [
        Decimal("1000.00"),
        Decimal("-0.03"),
    ]
    assert Decimal(source["cash_settlement_balance_after_raw"]) == Decimal("1999.97")
    assert Decimal(settled["commission_raw"]) == Decimal("-0.03")
    for container in (settled, source, settled["normalized"]):
        assert "settlement_adjustment_raw" not in container
        assert "settlement_adjustment" not in container
        assert "settlement_component_total_raw" not in container
        assert "settlement_component_total" not in container


def test_same_owner_legacy_final_survives_new_cash_and_repeat_merge(domain):
    previous = _legacy_final(domain)
    incoming = _settle(domain, _limit_order(domain), ["1000.00", "-0.03"])
    expected = _price_evidence(previous)

    merged = domain.identity._merge_transaction_records(previous, incoming)

    assert _price_evidence(merged) == expected
    assert merged["source"]["cash_settlement_postings"] == incoming["source"][
        "cash_settlement_postings"
    ]
    assert merged["source"].get("cash_replay_pending_settlement") is not True
    assert domain.identity._merge_transaction_records(merged, incoming) == merged
    assert previous["source"].get("cash_settlement_postings") is None


@pytest.mark.parametrize("different_field", ["account", "currency", "quantity", "order"])
def test_another_owner_cannot_borrow_a_legacy_final_price(domain, different_field):
    previous = _legacy_final(domain)
    incoming = _settle(domain, _limit_order(domain), ["1000.00", "-0.03"])
    if different_field == "account":
        incoming["account"] = "000-888888-888"
        incoming["source"]["account"] = incoming["account"]
        incoming["source"]["account_number"] = incoming["account"]
    elif different_field == "currency":
        incoming["currency"] = "HKD"
    elif different_field == "quantity":
        incoming.update(quantity_abs="5", quantity_raw="-5", price_raw="200")
        incoming["normalized"].update(position_quantity="5", unit_price="200")
    else:
        incoming["source"].update(order_id="S-100002", statement_order_id="S-100002")

    # Generic record merging requires an equal transaction identity. Exercise
    # only the final-price preservation boundary for deliberately unequal owners.
    expected = deepcopy(incoming)
    result = domain.identity._preserve_hsbc_final_price_on_unconfirmed_cash_merge(
        deepcopy(incoming), previous, incoming
    )
    assert result == expected
    assert result["price_raw"] == incoming["price_raw"]
    assert result["normalized"]["unit_price"] == incoming["normalized"]["unit_price"]
    assert result["source"]["execution_price_status"] == "settled_cash_price_unconfirmed"
    assert "execution_price_final_raw" not in result["source"]


def test_buy_settlement_retains_cash_derived_price_behavior(domain):
    order = _limit_order(domain, side="buy")
    settled = _settle(domain, order, ["-999.99"])

    assert Decimal(settled["price_raw"]) == Decimal("99.999")
    assert settled["source"]["execution_price_status"] == "final_settled"
    assert Decimal(settled["net_amount_raw"]) == Decimal("-999.99")


def test_sell_without_separate_debit_keeps_existing_settlement_behavior(domain):
    settled = _settle(domain, _limit_order(domain), ["1000.00"])

    assert settled["source"]["execution_price_status"] == "final_settled"
    assert Decimal(settled["price_raw"]) == Decimal("100")
    assert Decimal(settled["commission_raw"]) == Decimal("0")


def test_direct_reported_fill_is_not_recalibrated_from_cash(domain):
    order = _limit_order(domain)
    order.update(price_raw="100.001", gross_amount_raw="1000.01")
    order["normalized"].update(unit_price="100.001", gross_amount="1000.01")
    order["source"].update(
        file_kind="hsbc_execution_confirmation",
        execution_price_source="hsbc_reported_execution",
        execution_price_status="reported_execution",
        execution_price_raw="100.001",
        execution_price_final_raw="100.001",
    )
    expected = _price_evidence(order)

    settled = _settle(domain, order, ["1000.00", "-0.03"])

    assert _price_evidence(settled) == expected
    assert Decimal(settled["source"]["cash_settlement_balance_after_raw"]) == Decimal(
        "1999.97"
    )


def test_realized_net_proceeds_use_postings_even_if_the_estimate_changes(domain):
    if shutil.which("node") is None:
        pytest.skip("The existing JavaScript accounting consumer requires Node.js.")
    sell = _settle(domain, _limit_order(domain), ["1000.00", "-0.03"])
    buy = _limit_order(domain, side="buy", principal="900")
    buy["date"] = "2026-07-13"
    buy["source"].update(order_id="P-100002", statement_order_id="P-100002")
    buy["source"].pop("cash_replay_pending_settlement", None)
    script = """
        import fs from 'node:fs';
        import {createUtils} from './tests/js/investment/data_utils/context.mjs';
        const {buy, sell} = JSON.parse(fs.readFileSync(0, 'utf8'));
        globalThis.window = {WORTHWARD_INVESTMENT_DATA: {
            ticker_lineage: {}, money_market_tickers: [], broker_snapshots: {}
        }};
        const utils = createUtils();
        const compute = (sale) => {
            const summary = utils.createPositionState('TEST');
            utils.applyInvestmentTransactionToState(
                summary, buy, 'buy', 10, -900, buy.date,
                {preferTradePriceAndCommission: true}
            );
            utils.applyInvestmentTransactionToState(
                summary, sale, 'sell', 10,
                utils.getTransactionAmount(sale), sale.date,
                {preferTradePriceAndCommission: true}
            );
            return {cash: utils.getTransactionEvidencedTradeCashAmount(sale),
                    realized: summary.realizedPnl, shares: summary.shares};
        };
        const changed = structuredClone(sell);
        changed.price_raw = '137';
        changed.gross_amount_raw = '1370';
        changed.normalized.unit_price = '137';
        changed.normalized.gross_amount = '1370';
        console.log(JSON.stringify([compute(sell), compute(changed)]));
    """
    result = subprocess.run(
        ["node", "--input-type=module", "-e", script],
        input=json.dumps({"buy": buy, "sell": sell}),
        text=True,
        capture_output=True,
        cwd=domain.repository_root,
        check=True,
    )
    results = json.loads(result.stdout)
    for value in results:
        assert value["cash"] == pytest.approx(999.97)
        assert value["realized"] == pytest.approx(99.97)
        assert value["shares"] == pytest.approx(0)
    assert results[0] == results[1]
