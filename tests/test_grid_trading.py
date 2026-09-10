"""Tests for the grid trading strategy and workspace. Code version: v1.7.0."""

from __future__ import annotations

from unittest.mock import patch

import pandas as pd

from app import create_app
from strategies.backtest import run_single_ticker_backtest
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
        "initial_holding": 0,
        "holding_min": 0,
        "holding_max": 1_000_000,
        "rise": 2.0,
        "fall": 0.5,
    })

    assert "grid-trading" in {item["id"] for item in list_enabled_strategies()}
    assert result.execution_profile == "grid_trading"
    assert result.frame["buy_signal"].any()
    assert result.frame["sell_signal"].any()


def test_grid_anchor_does_not_advance_after_an_unfilled_sell_signal() -> None:
    strategy = instantiate_strategy("grid-trading")
    signal_result = strategy.compute_signals(pd.DataFrame({
        "Date": pd.date_range("2026-01-01", periods=4),
        "Open": [100.0, 100.9, 98.0, 100.0],
        "High": [103.0, 100.9, 99.0, 100.0],
        "Low": [100.0, 100.5, 97.0, 99.0],
        "Close": [103.0, 100.9, 98.0, 100.0],
    }), {
        "initial_holding": 0,
        "holding_min": 0,
        "holding_max": 1_000_000,
        "rise": 1.0,
        "fall": 1.0,
    })

    result = run_single_ticker_backtest(
        signal_result,
        initial_capital=10_000.0,
        execution_mode="signal_close",
    )

    assert [(trade["date"], trade["side"], trade["price"]) for trade in result["trades"]] == [
        ("2026/01/03", "Buy", 98.0),
        ("2026/01/04", "Sell", 100.0),
    ]
    assert [trade["shares"] for trade in result["trades"]] == [10.0, 10.0]
    assert result["summary"]["grid_trade_quantity"] == 10


def test_grid_anchor_uses_the_next_open_fill_price_before_later_signals() -> None:
    strategy = instantiate_strategy("grid-trading")
    signal_result = strategy.compute_signals(pd.DataFrame({
        "Date": pd.date_range("2026-01-01", periods=4),
        "Open": [100.0, 90.0, 96.0, 95.0],
        "High": [100.0, 94.0, 97.0, 95.0],
        "Low": [99.0, 90.0, 95.0, 94.0],
        "Close": [99.0, 94.0, 96.0, 95.0],
    }), {
        "initial_holding": 0,
        "holding_min": 0,
        "holding_max": 1_000_000,
        "rise": 5.0,
        "fall": 0.5,
    })

    result = run_single_ticker_backtest(
        signal_result,
        initial_capital=10_000.0,
        execution_mode="next_open",
    )

    assert [(trade["date"], trade["side"], trade["price"]) for trade in result["trades"]] == [
        ("2026/01/02", "Buy", 90.0),
        ("2026/01/04", "Sell", 95.0),
    ]


def test_grid_trading_uses_integer_holding_parameters_without_price_bounds() -> None:
    strategy = instantiate_strategy("grid-trading")
    definitions = {item.key: item for item in strategy.get_parameter_definitions()}

    assert tuple(definitions) == (
        "initial_holding", "quantity", "holding_min", "holding_max", "rise", "fall",
    )
    assert definitions["initial_holding"].kind == "integer"
    assert definitions["quantity"].kind == "integer"
    assert definitions["holding_min"].kind == "integer"
    assert definitions["holding_max"].kind == "integer"
    assert definitions["initial_holding"].default == 0
    assert definitions["quantity"].default == 0
    assert definitions["quantity"].derived_default == "initial-cash-per-ten-shares"
    assert definitions["holding_min"].default == 0
    assert definitions["holding_min"].placeholder == "0"
    assert definitions["holding_min"].empty_default is True
    assert definitions["holding_max"].default == 1_000_000
    assert definitions["holding_max"].empty_default is True
    assert definitions["holding_max"].number_format == "grouped-integer"
    assert definitions["rise"].default == 2.0
    assert definitions["fall"].default == 0.5
    assert definitions["rise"].minimum == 0.5
    assert definitions["rise"].maximum == 5.0
    assert definitions["fall"].minimum == 0.5
    assert definitions["fall"].maximum == 5.0
    assert strategy.normalize_params({
        "initial_holding": "100",
        "quantity": "1,234",
        "holding_min": "10",
        "holding_max": "12,345",
        "rise": "2.00",
        "fall": "0.50",
    }) == {
        "initial_holding": 100,
        "quantity": 1_234,
        "holding_min": 10,
        "holding_max": 12_345,
        "rise": 2.0,
        "fall": 0.5,
    }


def test_grid_trading_moves_between_holding_limits() -> None:
    strategy = instantiate_strategy("grid-trading")
    signal_result = strategy.compute_signals(pd.DataFrame({
        "Date": pd.date_range("2026-01-01", periods=3),
        "Open": [100.0, 99.0, 100.0],
        "High": [100.0, 99.0, 101.0],
        "Low": [100.0, 98.0, 100.0],
        "Close": [100.0, 98.0, 100.0],
    }), {
        "initial_holding": 4,
        "quantity": 2,
        "holding_min": 2,
        "holding_max": 6,
        "rise": 1.0,
        "fall": 1.0,
    })

    result = run_single_ticker_backtest(
        signal_result,
        initial_capital=1_000.0,
        execution_mode="signal_close",
    )

    assert [(trade["side"], trade["shares"]) for trade in result["trades"]] == [
        ("Buy", 2.0),
        ("Sell", 2.0),
    ]
    assert result["trades"][0]["cash"] == 804.0
    assert result["trades"][1]["cash"] == 1_004.0
    assert result["summary"]["initial_cash"] == 1_000.0
    assert result["summary"]["initial_capital"] == 1_400.0
    assert result["summary"]["final_equity"] == 1_404.0


def test_grid_current_holding_is_existing_equity_in_addition_to_initial_cash() -> None:
    strategy = instantiate_strategy("grid-trading")
    signal_result = strategy.compute_signals(pd.DataFrame({
        "Date": pd.date_range("2026-01-01", periods=2),
        "Open": [450.0, 450.0],
        "High": [450.0, 450.0],
        "Low": [450.0, 450.0],
        "Close": [450.0, 450.0],
    }), {
        "initial_holding": 100,
        "holding_min": 100,
        "holding_max": 100,
        "rise": 2.0,
        "fall": 2.0,
    })

    result = run_single_ticker_backtest(
        signal_result,
        initial_capital=10_000.0,
        execution_mode="signal_close",
    )

    assert result["summary"]["initial_cash"] == 10_000.0
    assert result["summary"]["initial_capital"] == 55_000.0
    assert result["summary"]["final_equity"] == 55_000.0
    assert result["summary"]["net_return_pct"] == 0.0
    assert result["trades"] == []


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
            "&initial_holding=120&quantity=12&holding_min=15&holding_max=600"
            "&rise=1.00&fall=0.50"
        )

    html = response.get_data(as_text=True)
    assert response.status_code == 200
    assert 'data-backtest-parameter-panel' in html
    assert 'data-backtest-parameter-form' in html
    assert 'data-trade-strategy-combobox' in html
    assert 'is-grid-trading-inline' not in html
    assert 'data-grid-trading-parameters-heading' not in html
    assert 'grid-trading-parameters-panel' not in html
    assert 'class="trade-strategy-tune-button is-active"' in html
    assert 'aria-pressed="true"' in html
    assert 'aria-expanded="true"' in html
    assert 'data-trade-strategy-panel role="region" aria-label="Strategy parameters">' in html
    assert 'data-shared-select-kind="period"' in html
    assert 'id="period_dropdown"' in html
    assert 'class="trade-strategy-param-select form-select"' not in html
    assert 'name="price_floor"' not in html
    assert 'name="price_ceiling"' not in html
    assert 'name="initial_holding"' in html
    assert 'value="120"' in html
    assert 'name="quantity"' in html
    assert 'value="12"' in html
    assert 'name="holding_min"' in html
    assert 'value="15"' in html
    assert 'name="holding_max"' in html
    assert 'value="600"' in html
    assert html.index('name="initial_holding"') < html.index('name="quantity"')
    assert html.index('name="quantity"') < html.index('name="holding_min"')
    assert html.index('name="holding_min"') < html.index('name="holding_max"')
    assert html.index('name="holding_max"') < html.index('name="rise"')
    assert html.count('inputmode="numeric"') >= 4
    assert 'name="rise"' in html
    assert 'value="1.00"' in html
    assert 'name="fall"' in html
    assert 'value="0.50"' in html
    assert 'name="workspace"' not in html
    assert 'Initial cash (USD)' in html


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
    assert 'id="backtest_history_view_segmented"' in html
    assert 'value="metrics"' in html
    assert 'value="transactions"' in html
    assert 'id="backtest_view_segmented"' not in html
    assert 'data-backtest-view-panel="overview"' in html
    assert 'data-backtest-history-view-panel="metrics"' in html
    assert 'data-backtest-history-view-panel="transactions"' in html
    assert 'data-trade-detail-shell' not in html
    assert 'id="trade_detail_transactions"' not in html
    assert 'id="backtest_overview_panel"' in html
    assert 'Price and strategy analysis' in html
    assert 'class="chart-surface investment-history-surface backtest-history-surface"' in html
    assert 'data-table-header' in html
    assert 'id="tradeTransactionsTable"' in html
