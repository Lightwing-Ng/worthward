"""Render the real Beta shell without market or strategy execution. Code version: v0.2.0."""

from app.beta.registry import EXPERIMENTS


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
        assert 'assets/js/lstm-training.js' not in html
        assert 'id="global_language_toggle" disabled' in html
        assert '"currentView": "beta"' in html
        assert response.headers['Cache-Control'] == 'no-store'


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
