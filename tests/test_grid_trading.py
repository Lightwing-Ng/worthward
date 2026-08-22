"""Tests for the grid trading strategy and workspace. Code version: v1.4.0."""

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
        "Open": [100.0, 100.0, 101.2, 99.0, 100.0],
        "High": [100.0, 100.0, 102.2, 99.0, 100.0],
        "Low": [100.0, 100.0, 101.2, 99.0, 100.0],
        "Close": [100.0, 100.0, 101.2, 99.0, 100.0],
    })

    result = strategy.compute_signals(dataset, {
        "price_floor": 1.0,
        "price_ceiling": 1000.0,
        "rise": 2.0,
        "fall": 0.5,
    })

    assert "grid-trading" in {item["id"] for item in list_enabled_strategies()}
    assert result.frame["buy_signal"].any()
    assert result.frame["sell_signal"].any()


def test_grid_trading_uses_reference_project_parameter_defaults_and_bounds() -> None:
    strategy = instantiate_strategy("grid-trading")
    definitions = {item.key: item for item in strategy.get_parameter_definitions()}

    assert tuple(definitions) == ("price_floor", "price_ceiling", "rise", "fall")
    assert definitions["price_floor"].default == 1.0
    assert definitions["price_ceiling"].default == 1000.0
    assert definitions["rise"].default == 2.0
    assert definitions["fall"].default == 0.5
    assert definitions["rise"].minimum == 0.5
    assert definitions["rise"].maximum == 5.0
    assert definitions["fall"].minimum == 0.5
    assert definitions["fall"].maximum == 5.0
    assert strategy.normalize_params({
        "price_floor": "1.00",
        "price_ceiling": "1000.00",
        "rise": "2.00",
        "fall": "0.50",
    }) == {
        "price_floor": 1.0,
        "price_ceiling": 1000.0,
        "rise": 2.0,
        "fall": 0.5,
    }


def test_legacy_grid_trading_workspace_redirects_to_generic_backtest() -> None:
    client = create_app().test_client()

    response = client.get(
        "/workspaces/grid-trading?ticker=QQQ&period=1y&capital=10000"
        "&strategy=macd&price_floor=1.00&price_ceiling=1000.00"
        "&rise=1.00&fall=0.50"
    )

    assert response.status_code == 302
    location = response.headers["Location"]
    assert location.startswith("/workspaces/backtest?")
    assert "strategy=grid-trading" in location
    assert "workspace=grid-trading" not in location


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
    assert 'is-grid-trading-inline' not in html
    assert 'grid-trading-parameters-panel' not in html


def test_backtest_workspace_exposes_grid_parameters_from_the_strategy_catalog() -> None:
    client = create_app().test_client()

    with (
        patch("app.web.runtime.fetch_history", side_effect=fetch_history_stub),
        patch("app.web.runtime.fetch_quote_profile", side_effect=quote_profile_stub),
        patch("app.web.runtime.ensure_latest_backtest_caches", return_value={}),
        patch("app.web.runtime.run_single_ticker_backtest", return_value=backtest_result()),
        patch("app.web.runtime.record_strategy_usage"),
    ):
        response = client.get(
            "/workspaces/backtest?ticker=QQQ&period=1y&capital=10000&strategy=grid-trading"
            "&price_floor=1.00&price_ceiling=1000.00&rise=1.00&fall=0.50"
        )

    html = response.get_data(as_text=True)
    assert response.status_code == 200
    assert 'data-backtest-parameter-panel' in html
    assert 'data-backtest-parameter-form' in html
    assert 'data-trade-strategy-combobox' in html
    assert 'is-grid-trading-inline' not in html
    assert 'data-grid-trading-parameters-heading' not in html
    assert 'grid-trading-parameters-panel' not in html
    assert 'class="trade-strategy-tune-button"' in html
    assert 'data-shared-select-kind="period"' in html
    assert 'id="period_dropdown"' in html
    assert 'class="trade-strategy-param-select form-select"' not in html
    assert 'name="price_floor"' in html
    assert 'value="1.00"' in html
    assert 'name="price_ceiling"' in html
    assert 'value="1000.00"' in html
    assert 'name="rise"' in html
    assert 'value="1.00"' in html
    assert 'name="fall"' in html
    assert 'value="0.50"' in html
    assert 'name="workspace"' not in html


def test_backtest_results_match_investment_surface_layout() -> None:
    client = create_app().test_client()

    with (
        patch("app.web.runtime.fetch_history", side_effect=fetch_history_stub),
        patch("app.web.runtime.fetch_quote_profile", side_effect=quote_profile_stub),
        patch("app.web.runtime.ensure_latest_backtest_caches", return_value={}),
        patch("app.web.runtime.run_single_ticker_backtest", return_value=backtest_result()),
        patch("app.web.runtime.record_strategy_usage"),
    ):
        response = client.get("/workspaces/backtest?ticker=QQQ&period=1y&strategy=grid-trading")

    html = response.get_data(as_text=True)
    assert response.status_code == 200
    assert 'id="backtest_view_segmented"' in html
    assert 'value="overview"' in html
    assert 'value="metrics"' in html
    assert 'data-backtest-view-panel="overview"' in html
    assert 'data-backtest-view-panel="metrics"' in html
    assert 'data-trade-detail-shell' not in html
    assert 'id="trade_detail_transactions"' not in html
    assert 'id="backtest_overview_panel"' in html
    assert 'Trade actions and net asset curve' in html
    assert 'class="chart-surface investment-history-surface backtest-history-surface"' in html
    assert 'data-table-header' in html
    assert 'id="tradeTransactionsTable"' in html
