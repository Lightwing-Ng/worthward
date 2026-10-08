"""Render the real Beta shell without market or strategy execution. Code version: v0.3.1."""

import pytest
from bs4 import BeautifulSoup

from app.beta.registry import EXPERIMENTS


INTERACTIVE_EXPERIMENTS = (
    "regime-radar",
    "analog-explorer",
    "stress-lab",
    "robustness-lab",
    "path-remix",
    "recovery-clock",
    "calibration-lab",
)


def test_real_beta_pages_reuse_shell_with_scoped_assets(client):
    for experiment in EXPERIMENTS:
        response = client.get(f"/beta/{experiment['id']}")
        assert response.status_code == 200
        html = response.get_data(as_text=True)
        assert 'data-dock-group="beta"' in html
        assert '/static/images/sparkles.2.svg' in html
        assert html.index('data-dock-group="trade"') < html.index('data-dock-group="beta"') < html.index('data-dock-group="settings"')
        assert 'aria-label="Beta experiments"' in html
        assert 'assets/js/beta.js' in html
        assert 'assets/css/views/beta.css' in html
        assert ('assets/js/beta-notebook.js' in html) == (experiment['id'] == 'thesis-lab')
        assert ('assets/js/beta-buy-analysis.js' in html) == (experiment['id'] == 'buy-analysis')
        assert 'assets/js/lstm-training.js' not in html
        assert 'id="global_language_toggle" disabled' in html
        assert '"currentView": "beta"' in html
        assert response.headers['Cache-Control'] == 'no-store'
        soup = BeautifulSoup(html, "html.parser")
        navigation = soup.select_one('nav[aria-label="Beta experiments"]')
        assert {link["href"] for link in navigation.select("a")} == {
            f"/beta/{identifier}"
            for identifier in (*INTERACTIVE_EXPERIMENTS, "buy-analysis", "thesis-lab", "research-frontier")
        }


@pytest.mark.parametrize("experiment", INTERACTIVE_EXPERIMENTS)
def test_interactive_beta_pages_offer_native_guided_steps(client, experiment):
    response = client.get(f"/beta/{experiment}")
    assert response.status_code == 200
    soup = BeautifulSoup(response.data, "html.parser")
    guide = soup.select_one(".beta-guide")
    assert guide is not None
    assert guide.select_one('ol.process-list[role="list"]') is not None
    steps = guide.select("ol.process-list > li.process-list-step")
    assert len(steps) == 3
    assert [step.has_attr("data-process-continues") for step in steps] == [True, True, False]
    for step in steps:
        assert step.select_one('.process-list-marker[aria-hidden="true"]') is not None
        disclosure = step.select_one("details.ui-collapse")
        assert disclosure is not None
        assert disclosure.find("summary", recursive=False).get_text(strip=True)
        assert disclosure.select_one(":scope > .ui-collapse-body").get_text(strip=True)
    first_disclosure = steps[0].select_one("details.ui-collapse")
    assert first_disclosure.has_attr("open")
    assert first_disclosure.select_one("[data-beta-analysis-form] [data-beta-run]") is not None
    assert first_disclosure.select_one("#beta_ticker[required]") is not None
    results = soup.select_one("[data-beta-results]")
    assert results.has_attr("hidden")
    assert results.select_one("[data-beta-chart]") is not None
    assert results.select_one("[data-beta-develop]") is not None


def test_settings_remain_outside_beta_asset_lifecycle(client):
    response = client.get('/settings/about')
    assert response.status_code == 200
    html = response.get_data(as_text=True)
    assert 'data-dock-group="beta"' in html
    assert 'assets/js/beta.js' not in html
    assert 'assets/css/views/beta.css' not in html
    assert 'assets/js/beta-notebook.js' not in html


def test_disable_switch_removes_only_beta(monkeypatch):
    monkeypatch.setenv('WORTHWARD_BETA_ENABLED', '0')
    from app import create_app
    client = create_app().test_client()
    assert client.get('/beta').status_code == 404
    assert client.get('/beta/api/analyze?experiment=regime-radar&ticker=QQQ').status_code == 404
    response = client.get('/settings/about')
    assert response.status_code == 200
    assert 'data-dock-group="beta"' not in response.get_data(as_text=True)
