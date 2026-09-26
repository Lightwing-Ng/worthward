"""Investment import session-token readiness regressions. Code version: v1.0.1."""

from pathlib import Path
from unittest.mock import patch

from app import create_app


PROJECT_ROOT = Path(__file__).resolve().parents[3]
SAME_ORIGIN = {"Sec-Fetch-Site": "same-origin"}
SESSION_TOKEN_ROUTE = "/api/investment/session-token"


def _settings_write(client, token):
    with patch("app.web.runtime.clear_investment_store") as clear:
        response = client.post(
            "/settings/cache/action",
            data={"action": "investment-transactions"},
            headers={
                "Origin": "http://localhost",
                "Sec-Fetch-Site": "same-origin",
                "X-CSRF-Token": token,
            },
        )
    return response, clear


def test_session_token_route_returns_the_session_token_without_caching(client):
    response = client.get(SESSION_TOKEN_ROUTE, headers=SAME_ORIGIN)

    assert response.status_code == 200
    assert response.headers["Cache-Control"] == "no-store"
    with client.session_transaction() as session:
        expected = session["_investment_csrf_token"]
    assert response.get_json() == {"success": True, "investment_csrf_token": expected}


def test_session_token_route_rejects_cross_site_requests(client):
    response = client.get(SESSION_TOKEN_ROUTE, headers={"Sec-Fetch-Site": "cross-site"})

    assert response.status_code == 403
    assert "investment_csrf_token" not in response.get_json()
    with client.session_transaction() as session:
        assert "_investment_csrf_token" not in session


def test_refreshed_token_recovers_a_page_rendered_before_server_restart():
    before_restart = create_app()
    before_restart.config.update(TESTING=True)
    stale_client = before_restart.test_client()
    stale_token = stale_client.get(
        SESSION_TOKEN_ROUTE, headers=SAME_ORIGIN
    ).get_json()["investment_csrf_token"]
    stale_cookie = stale_client.get_cookie("session")
    assert stale_cookie is not None

    # A new process signs sessions with a new secret, so the old page's token
    # is rejected until the dialog refreshes it from the new process.
    after_restart = create_app()
    after_restart.config.update(TESTING=True)
    client = after_restart.test_client()
    client.set_cookie("session", stale_cookie.value, domain=stale_cookie.domain)

    rejected, clear = _settings_write(client, stale_token)
    assert rejected.status_code == 403
    clear.assert_not_called()

    refreshed_token = client.get(
        SESSION_TOKEN_ROUTE, headers=SAME_ORIGIN
    ).get_json()["investment_csrf_token"]
    assert refreshed_token != stale_token

    accepted, clear = _settings_write(client, refreshed_token)
    assert accepted.status_code == 303
    clear.assert_called_once()


def test_import_dialog_gates_submit_on_session_readiness():
    runtime_root = PROJECT_ROOT / "app/web/static/assets/js/investment"
    metrics_import = (runtime_root / "runtime/metrics-import.js").read_text(encoding="utf-8")
    entry = (runtime_root.parent / "investment.js").read_text(encoding="utf-8")
    workflows = (runtime_root / "runtime/import-workflows.js").read_text(encoding="utf-8")
    filters = (runtime_root / "runtime/stock-history-filters.js").read_text(encoding="utf-8")

    assert f"'{SESSION_TOKEN_ROUTE}'" in metrics_import
    assert "brokerReady && isInvestmentImportSessionReady() && (" in metrics_import
    open_body = metrics_import.split("function openInvestmentImportForm() {", 1)[1]
    assert "ensureInvestmentImportSession()" in open_body.split("function ", 1)[0]

    submit_body = entry.split("runtime.investmentForm.addEventListener('submit'", 1)[1]
    assert submit_body.index("runtime.ensureInvestmentImportSession()") < submit_body.index(
        "fetch('/api/investment/transactions'"
    )
    for source, endpoint in (
        (workflows, "runtime.HSBC_PASTE_VALIDATION_ENDPOINT"),
        (filters, "'/api/investment/imports/zircon-hk/validate'"),
    ):
        assert source.index("runtime.ensureInvestmentImportSession()") < source.index(endpoint)
