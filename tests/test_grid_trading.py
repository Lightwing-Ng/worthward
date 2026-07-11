"""Tests for the grid trading strategy and workspace. Code version: v1.1.0."""

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

    result = strategy.compute_signals(dataset, {
        "center_mode": "EMA",
        "center_window": 2,
        "grid_spacing_pct": 1.0,
        "entry_level": 1,
        "exit_level": 1,
    })

    assert "grid-trading" in {item["id"] for item in list_enabled_strategies()}
    assert result.frame["buy_signal"].any()
    assert result.frame["sell_signal"].any()


def test_grid_trading_workspace_is_parallel_and_locks_its_strategy() -> None:
    client = create_app().test_client()

    with (
        patch("app.web.runtime.fetch_history", side_effect=fetch_history_stub),
        patch("app.web.runtime.fetch_quote_profile", side_effect=quote_profile_stub),
        patch("app.web.runtime.ensure_latest_backtest_caches", return_value={}),
        patch("app.web.runtime.instantiate_strategy", wraps=instantiate_strategy) as strategy_factory,
        patch("app.web.runtime.run_single_ticker_backtest", return_value=backtest_result()),
        patch("app.web.runtime.record_strategy_usage"),
    ):
        response = client.get(
            "/workspaces/grid-trading?ticker=QQQ&period=1y&capital=10000"
            "&strategy=macd&center_mode=EMA&center_window=30&grid_spacing_pct=1.5"
            "&entry_level=2&exit_level=3"
        )

    html = response.get_data(as_text=True)
    assert response.status_code == 200
    assert strategy_factory.call_args_list
    assert {call.args[0] for call in strategy_factory.call_args_list} == {"grid-trading"}
    assert 'name="strategy" value="grid-trading"' in html
    assert 'name="workspace" value="grid-trading"' in html
    assert 'data-grid-trading-parameters' in html
    assert 'name="center_mode"' in html
    assert '<option value="EMA" selected>EMA</option>' in html
    assert 'name="center_window"' in html
    assert 'value="30"' in html
    assert 'name="entry_level"' in html
    assert 'value="2"' in html
    assert 'name="exit_level"' in html
    assert 'value="3"' in html
    assert 'data-trade-strategy-combobox' not in html
    assert 'workspace-nav-item-grid-trading is-active' in html


def test_backtest_workspace_keeps_the_general_strategy_selector() -> None:
    client = create_app().test_client()

    with (
        patch("app.web.runtime.fetch_history", side_effect=fetch_history_stub),
        patch("app.web.runtime.fetch_quote_profile", side_effect=quote_profile_stub),
        patch("app.web.runtime.ensure_latest_backtest_caches", return_value={}),
        patch("app.web.runtime.run_single_ticker_backtest", return_value=backtest_result()),
        patch("app.web.runtime.record_strategy_usage"),
    ):
        response = client.get("/workspaces/backtest?ticker=QQQ&period=1y&capital=10000&strategy=macd")

    html = response.get_data(as_text=True)
    assert response.status_code == 200
    assert 'data-trade-strategy-combobox' in html
    assert 'data-grid-trading-parameters' not in html
