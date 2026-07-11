"""Tests for the grid trading strategy and workspace. Code version: v1.0.0."""

from __future__ import annotations

from unittest.mock import patch

import pandas as pd

from app import create_app
from strategies.loader import instantiate_strategy, list_enabled_strategies
from tests.factories.market import backtest_result, fetch_history_stub, quote_profile_stub


def test_grid_trading_strategy_is_discoverable_and_builds_grid_signals() -> None:
    strategy = instantiate_strategy("grid-trading")
    dataset = pd.DataFrame({
        "Date": pd.date_range("2026-01-01", periods=5),
        "Close": [100.0, 104.0, 96.0, 104.0, 96.0],
    })

    result = strategy.compute_signals(dataset, {"center_window": 2, "grid_spacing_pct": 1.0})

    assert "grid-trading" in {item["id"] for item in list_enabled_strategies()}
    assert result.frame["buy_signal"].any()
    assert result.frame["sell_signal"].any()


def test_grid_trading_workspace_defaults_to_grid_strategy() -> None:
    client = create_app().test_client()

    with (
        patch("app.web.runtime.fetch_history", side_effect=fetch_history_stub),
        patch("app.web.runtime.fetch_quote_profile", side_effect=quote_profile_stub),
        patch("app.web.runtime.ensure_latest_backtest_caches", return_value={}),
        patch("app.web.runtime.run_single_ticker_backtest", return_value=backtest_result()),
        patch("app.web.runtime.record_strategy_usage"),
    ):
        response = client.get("/workspaces/grid-trading?ticker=QQQ&period=1y&capital=10000")

    html = response.get_data(as_text=True)
    assert response.status_code == 200
    assert 'value="grid-trading"' in html
    assert 'data-fallback-label="Grid Trading"' in html
    assert 'workspace-nav-item-grid-trading is-active' in html
