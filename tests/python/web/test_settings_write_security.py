"""Settings request boundary regressions. Code version: v1.0.2."""

import json
from unittest.mock import patch

import pytest
from bs4 import BeautifulSoup

from app.core.preferences import store


@pytest.mark.parametrize("headers", [
    {},
    {"Origin": "https://attacker.example", "X-CSRF-Token": "t" * 43},
    {"Origin": "http://localhost", "Sec-Fetch-Site": "cross-site", "X-CSRF-Token": "t" * 43},
    {"Origin": "http://localhost", "X-CSRF-Token": "wrong"},
])
def test_settings_posts_reject_untrusted_requests_before_mutation(client, headers):
    with client.session_transaction() as session:
        session["_investment_csrf_token"] = "t" * 43
    routes = [rule.rule for rule in client.application.url_map.iter_rules()
              if "POST" in rule.methods and rule.rule.startswith(("/settings/", "/api/settings/"))]
    with patch("app.web.runtime.clear_investment_store") as clear:
        for route in routes:
            response = client.post(route, data={"action": "investment-transactions"}, headers=headers)
            assert response.status_code == 403, route
        clear.assert_not_called()


@pytest.mark.parametrize("use_header", [True, False])
def test_settings_accepts_same_origin_session_token(client, use_header):
    with client.session_transaction() as session:
        session["_investment_csrf_token"] = "t" * 43
    headers = {"Origin": "http://localhost", "Sec-Fetch-Site": "same-origin"}
    data = {"action": "investment-transactions"}
    if use_header:
        headers["X-CSRF-Token"] = "t" * 43
    else:
        data["csrf_token"] = "t" * 43
    with patch("app.web.runtime.clear_investment_store") as clear:
        response = client.post("/settings/cache/action", data=data, headers=headers)
    assert response.status_code == 303
    clear.assert_called_once()


@pytest.mark.parametrize("section", ["general", "investment", "backtest", "email-smtp", "broker-access", "clear-caches", "cash-equivalents", "local-market-store"])
def test_native_settings_forms_include_session_token(client, section):
    response = client.get(f"/settings/{section}")
    assert response.status_code == 200
    soup = BeautifulSoup(response.data, "html.parser")
    with client.session_transaction() as session:
        token = session["_investment_csrf_token"]
    for form in soup.select('form[method="post"]'):
        assert form.select_one('input[name="csrf_token"]')["value"] == token


def test_investment_pnl_display_toggle_persists_independently_of_lot_method(
    client, monkeypatch, tmp_path,
):
    monkeypatch.setattr(store, "SETTINGS_STORE_DIR", tmp_path)
    monkeypatch.setattr(store, "GENERAL_SETTINGS_PATH", tmp_path / "settings.sqlite3")

    def investment_state():
        response = client.get("/trade/investment")
        assert response.status_code == 200
        soup = BeautifulSoup(response.data, "html.parser")
        return json.loads(soup.select_one("#worthward_state").string)

    assert investment_state()["investmentShowBrokerRealizedPnl"] is False
    with client.session_transaction() as session:
        token = session["_investment_csrf_token"]

    def save_investment_setting(**fields):
        response = client.post(
            "/settings/investment/action",
            data={"csrf_token": token, **fields},
            headers={"Origin": "http://localhost", "Sec-Fetch-Site": "same-origin"},
        )
        assert response.status_code == 303
        assert response.headers["Location"] == "/settings/investment"

    save_investment_setting(
        action="set_show_broker_realized_pnl", investment_show_broker_realized_pnl="1",
    )
    save_investment_setting(investment_cost_basis_method="fifo")
    enabled = investment_state()
    assert enabled["investmentShowBrokerRealizedPnl"] is True
    assert enabled["investmentCostBasisMethod"] == "fifo"

    save_investment_setting(action="set_show_broker_realized_pnl")
    disabled = investment_state()
    assert disabled["investmentShowBrokerRealizedPnl"] is False
    assert disabled["investmentCostBasisMethod"] == "fifo"
