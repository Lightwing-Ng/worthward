"""Keep card reward disclosures fresh and outside investment persistence.

Code version: v1.0.0
"""

import json

from app.services.credit_card_ledger import commit_hsbc_credit_card_import
from app.web.runtime_domains.investment.credit_cards import read_credit_card_reward_payload
from tests.factories.hsbc_credit_card import hsbc_credit_card_text
from tests.python.services.test_schwab_provisional_reconciliation import buy_csv_payload
from tests.python.web import test_investment_persistence_audit as persistence_support


commit_runtime = persistence_support.commit_runtime
_get = persistence_support._get
_get_context = persistence_support._get_context


def _fx(rows):
    return {
        "HKD": {"dates": ["2026-09-01"], "values": {"2026-09-01": 7.8}}
    } if any(row.get("currency") == "HKD" for row in rows) else {}


def test_reward_read_is_privacy_safe_and_excludes_pending_and_card_cash(tmp_path):
    path = tmp_path / "credit_cards.json"
    rows = "\n".join(
        [
            "12 Oct 2026\nCard ending in 1111\nPAY w/RC SAMPLE SHOP HK\n25.00 HKD",
            "13 Oct 2026\nCard ending in 1111\nPAY w/RC SAMPLE SHOP HK\n5.00 HKD\nPending",
            "12 Oct 2026\nCard ending in 1111\nPAYMENT - THANK YOU\n100.00 HKD",
        ]
    )
    commit_hsbc_credit_card_import(hsbc_credit_card_text(transactions=rows), path)
    before = path.read_bytes()
    reward = read_credit_card_reward_payload(path, _fx)
    assert path.read_bytes() == before
    assert reward["status"] == "complete"
    assert len(reward["transactions"]) == 1
    row = reward["transactions"][0]
    assert set(row) == {"id", "date", "amount", "currency"}
    assert row["amount"] == "25.00"
    assert row["date"] == "2026-10-12"
    assert "1111" not in json.dumps(reward)
    assert "SAMPLE" not in json.dumps(reward)


def test_missing_card_store_is_read_only_but_corruption_is_unavailable(tmp_path):
    path = tmp_path / "missing" / "credit_cards.json"
    reward = read_credit_card_reward_payload(path, _fx)
    assert reward["status"] == "complete"
    assert reward["transactions"] == []
    assert not path.parent.exists()
    path.parent.mkdir()
    path.write_text("broken", encoding="utf-8")
    reward = read_credit_card_reward_payload(path, _fx)
    assert reward["status"] == "unavailable"
    assert reward["warnings"]
    assert path.read_text(encoding="utf-8") == "broken"


def test_api_card_disclosure_bypasses_investment_cache_and_preserves_ledger(commit_runtime):
    context, investment_path, cache_path = commit_runtime
    _get_context(context)
    card_path = investment_path.parent / "credit_cards.json"
    context["CREDIT_CARD_STORE_PATH"] = card_path
    context["build_investment_fx_rate_history_payload"] = _fx
    assert _get(context)["credit_card_rewards"]["transactions"] == []
    assert not card_path.exists()
    context["merge_and_write_investment_payload"](buy_csv_payload())
    before = investment_path.read_bytes()
    commit_hsbc_credit_card_import(hsbc_credit_card_text(), card_path)
    first = _get(context)
    assert first["investment_cache"]["status"] == "miss"
    assert len(first["credit_card_rewards"]["transactions"]) == 2
    assert "credit_card_rewards" not in cache_path.read_text()
    extra = "14 Oct 2026\nCard ending in 1111\nPAY w/RC SAMPLE SHOP HK\n5.00 HKD"
    commit_hsbc_credit_card_import(hsbc_credit_card_text(transactions=extra), card_path)
    second = _get(context)
    assert second["investment_cache"]["status"] == "hit"
    assert len(second["credit_card_rewards"]["transactions"]) == 3
    assert second["transactions"] == first["transactions"]
    assert second["investment_store_version"] == first["investment_store_version"]
    assert second["fx_rate_history_by_currency"] == first["fx_rate_history_by_currency"]
    assert investment_path.read_bytes() == before
    card_path.write_text("broken", encoding="utf-8")
    unavailable = _get(context)
    assert unavailable["success"]
    assert unavailable["credit_card_rewards"]["status"] == "unavailable"
    assert unavailable["transactions"] == first["transactions"]
