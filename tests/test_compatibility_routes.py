"""Compatibility redirects that must not regain independent renderers.

Code version: v1.1.0
"""

from __future__ import annotations

from app import create_app


def test_legacy_routes_redirect_to_documented_canonical_surfaces() -> None:
    client = create_app().test_client()
    redirects = {
        "/compare": "/workspaces/compare",
        "/portfolio": "/workspaces/portfolio",
        "/backtest": "/workspaces/backtest",
        "/trade-messages": "/workspaces/backtest",
        "/dca": "/workspaces/backtest?strategy=dca",
        "/workspaces/dca": "/workspaces/backtest?strategy=dca",
        "/workspaces/market-caps": "/workspaces/prices?metric=market-cap",
        "/workspaces/grid-trading": "/workspaces/backtest?strategy=grid-trading",
        "/more": "/trade/investment",
        "/invest": "/trade/investment",
        "/investment": "/trade/investment",
    }

    for source_path, expected_target in redirects.items():
        response = client.get(source_path, follow_redirects=False)
        assert response.status_code in {301, 302, 307, 308}, source_path
        assert response.headers["Location"] == expected_target, source_path


def test_legacy_more_sections_redirect_to_normalized_trade_surfaces() -> None:
    client = create_app().test_client()
    redirects = {
        "/more/investment": "/trade/investment",
        "/more/live-trading": "/trade/live-trading",
        "/more/timing": "/trade/investment",
        "/more/invest": "/trade/investment",
        "/more/live": "/trade/live-trading",
        "/more/live_trading": "/trade/live-trading",
        "/more/unknown": "/trade/investment",
    }

    for source_path, expected_target in redirects.items():
        response = client.get(source_path, follow_redirects=False)
        assert response.status_code in {301, 302, 307, 308}, source_path
        assert response.headers["Location"] == expected_target, source_path


def test_root_legacy_views_redirect_to_documented_canonical_surfaces() -> None:
    client = create_app().test_client()
    redirects = {
        "/?view=tickers": "/workspaces/compare",
        "/?view=prices": "/workspaces/prices",
        "/?view=market-caps": "/workspaces/prices?metric=market-cap",
        "/?view=portfolio": "/workspaces/portfolio",
        "/?view=backtest": "/workspaces/backtest",
        "/?view=trade-messages": "/workspaces/backtest",
        "/?view=grid-trading": "/workspaces/backtest",
        "/?view=trade": "/trade/investment",
        "/?view=settings": "/settings/about",
        "/?view=unknown": "/workspaces/compare",
    }

    for source_path, expected_target in redirects.items():
        response = client.get(source_path, follow_redirects=False)
        assert response.status_code in {301, 302, 307, 308}, source_path
        assert response.headers["Location"] == expected_target, source_path


def test_root_legacy_dca_view_reaches_the_canonical_backtest_strategy() -> None:
    client = create_app().test_client()

    legacy_response = client.get("/?view=dca", follow_redirects=False)
    assert legacy_response.status_code in {301, 302, 307, 308}
    assert legacy_response.headers["Location"] == "/workspaces/dca"

    canonical_response = client.get(
        legacy_response.headers["Location"],
        follow_redirects=False,
    )
    assert canonical_response.status_code in {301, 302, 307, 308}
    assert canonical_response.headers["Location"] == (
        "/workspaces/backtest?strategy=dca"
    )
