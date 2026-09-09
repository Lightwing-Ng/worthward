"""
Long-only backtest engines.

Code version: v0.13.1
"""

from __future__ import annotations

from math import floor, isfinite
from typing import Any

import pandas as pd

from .base import StrategySignalResult, normalize_strategy_presentation


def _attach_strategy_presentation(
        result: dict[str, object],
        signal_result: StrategySignalResult,
) -> dict[str, object]:
    """Attach only validated declarative browser presentation data."""
    presentation = normalize_strategy_presentation(signal_result.presentation)
    if presentation:
        data_keys = presentation.get("data_keys")
        if data_keys is not None:
            if not isinstance(data_keys, list):
                raise ValueError("Strategy presentation data_keys must be a list.")
            chart = result.get("chart")
            raw_dates = chart.get("raw_dates") if isinstance(chart, dict) else None
            if not isinstance(raw_dates, list):
                raise ValueError(
                    "Strategy presentation data_keys require chart.raw_dates."
                )
            if len(data_keys) != len(raw_dates):
                raise ValueError(
                    "Strategy presentation data_keys must match chart.raw_dates length."
                )
            if data_keys != raw_dates:
                raise ValueError(
                    "Strategy presentation data_keys must exactly match chart.raw_dates."
                )
        result["strategy_presentation"] = presentation
        summary = result.get("summary")
        diagnostics = presentation.get("diagnostics")
        if isinstance(summary, dict) and isinstance(diagnostics, dict):
            direction_hit_rate = diagnostics.get("direction_hit_rate_pct")
            probability_score = diagnostics.get("probability_score_pct")
            scored_points = diagnostics.get("scored_points")
            direction_hits = diagnostics.get("direction_hits")
            direction_scored_points = diagnostics.get("direction_scored_points")
            if isinstance(direction_hit_rate, (int, float)):
                normalized_hit_rate = round(float(direction_hit_rate), 2)
                summary["probability_field_direction_hit_rate_pct"] = normalized_hit_rate
                # Preserve the generic historical summary key with truthful new
                # semantics for downstream consumers that have not migrated.
                summary["probability_field_hit_rate_pct"] = normalized_hit_rate
            if isinstance(probability_score, (int, float)):
                summary["probability_field_probability_score_pct"] = round(
                    float(probability_score),
                    2,
                )
            if isinstance(scored_points, int):
                summary["probability_field_scored_points"] = scored_points
                summary["probability_field_hit_rate_scored_points"] = scored_points
            if isinstance(direction_hits, int):
                summary["probability_field_direction_hits"] = direction_hits
            if isinstance(direction_scored_points, int):
                summary["probability_field_direction_scored_points"] = (
                    direction_scored_points
                )
            brier_score = diagnostics.get("brier_score")
            if isinstance(brier_score, (int, float)):
                summary["probability_field_brier_score"] = float(brier_score)
            for source_key, destination_key in (
                    (
                        "mean_negative_log_predictive_density",
                        "probability_field_mean_nlpd",
                    ),
                    (
                        "mean_crps_log_return",
                        "probability_field_mean_crps_log_return",
                    ),
            ):
                value = diagnostics.get(source_key)
                if isinstance(value, (int, float)):
                    summary[destination_key] = float(value)
    return result


def _resolve_execution_mode(
        signal_result: StrategySignalResult,
        requested_execution_mode: str,
) -> str:
    """Resolve a strategy-required fill mode ahead of the global preference."""
    required_execution_mode = signal_result.required_execution_mode
    if required_execution_mode is not None:
        normalized_required = str(required_execution_mode).strip().lower()
        if normalized_required not in {"signal_close", "next_open"}:
            raise ValueError("Strategy required_execution_mode is invalid.")
        return normalized_required
    return (
        "next_open"
        if str(requested_execution_mode).strip().lower() == "next_open"
        else "signal_close"
    )


def combine_backtest_datasets(datasets: list[pd.DataFrame]) -> pd.DataFrame:
    """Align ordered ticker histories on their common timestamps for multi-asset strategies."""
    if len(datasets) < 2:
        raise ValueError("A multi-asset backtest requires at least two market datasets.")

    merged: pd.DataFrame | None = None
    for ticker_index, source in enumerate(datasets, start=1):
        if source.empty or "Date" not in source.columns or "Close" not in source.columns:
            raise ValueError("Each ticker must provide Date and Close market history.")
        frame = source.copy()
        frame["Date"] = pd.to_datetime(frame["Date"], errors="coerce", utc=True).dt.tz_localize(None)
        frame["Close"] = pd.to_numeric(frame["Close"], errors="coerce")
        frame = frame.dropna(subset=["Date", "Close"]).drop_duplicates(subset=["Date"]).sort_values("Date")
        if frame.empty:
            raise ValueError("Each ticker must provide usable market history.")

        for column, fallback in {
            "Open": frame["Close"],
            "High": frame["Close"],
            "Low": frame["Close"],
            "Dividends": 0.0,
        }.items():
            if column not in frame.columns:
                frame[column] = fallback
            frame[column] = pd.to_numeric(frame[column], errors="coerce").fillna(fallback)

        columns = ["Date", "Open", "High", "Low", "Close", "Dividends"]
        frame = frame[columns]
        if ticker_index > 1:
            frame = frame.rename(columns={column: f"{column}_{ticker_index}" for column in columns if column != "Date"})
        merged = frame if merged is None else merged.merge(frame, on="Date", how="inner", sort=True)

    if merged is None or merged.empty:
        raise ValueError("The selected tickers do not have overlapping market history.")
    return merged.sort_values("Date").reset_index(drop=True)


def _format_display_date(value: pd.Timestamp | str) -> str:
    timestamp = pd.Timestamp(value)
    return f"{timestamp.day} {timestamp.strftime('%b %Y')}"


def _format_chart_date(value: pd.Timestamp | str, interval: str) -> str:
    timestamp = pd.Timestamp(value)
    if interval == "1m":
        return f"{timestamp.day} {timestamp.strftime('%b %Y %H:%M')}"
    return _format_display_date(timestamp)


def _is_winning_trade_pair(first_trade: dict[str, object], second_trade: dict[str, object]) -> bool:
    first_side = str(first_trade.get("side", ""))
    second_side = str(second_trade.get("side", ""))
    first_price = float(first_trade.get("price", 0.0))
    second_price = float(second_trade.get("price", 0.0))

    if first_side == "Buy" and second_side == "Sell":
        return second_price > first_price
    if first_side == "Sell" and second_side == "Buy":
        return second_price < first_price
    return False


def _build_trade_pairs(trades: list[dict[str, object]]) -> list[tuple[dict[str, object], dict[str, object]]]:
    trade_pairs: list[tuple[dict[str, object], dict[str, object]]] = []
    for index in range(len(trades) - 1):
        first_trade = trades[index]
        second_trade = trades[index + 1]
        if first_trade.get("side") == second_trade.get("side"):
            continue
        trade_pairs.append((first_trade, second_trade))
    return trade_pairs


def _coerce_trade_float(value: object, default: float = 0.0) -> float:
    try:
        parsed = float(value or 0.0)
    except (TypeError, ValueError):
        return default
    return parsed if isfinite(parsed) else default


def _normalize_transaction_rows(
        trades: list[dict[str, object]],
        *,
        initial_quantity: float = 0.0,
        initial_unit_cost: float = 0.0,
) -> None:
    """Add the shared Backtest transaction fields while preserving legacy keys."""
    positions: dict[str, dict[str, float]] = {}
    if initial_quantity > 0:
        positions["__single__"] = {
            "quantity": initial_quantity,
            "cost": initial_quantity * initial_unit_cost,
        }
    for trade in trades:
        ticker_key = str(trade.get("ticker") or "__single__")
        position = positions.setdefault(ticker_key, {"quantity": 0.0, "cost": 0.0})
        quantity = abs(_coerce_trade_float(trade.get("quantity", trade.get("shares"))))
        price = _coerce_trade_float(trade.get("price"))
        cash = _coerce_trade_float(trade.get("cash"))
        equity = _coerce_trade_float(trade.get("equity"))
        realized_pnl = _coerce_trade_float(
            trade.get("realized_pnl", trade.get("pnl"))
        )
        side = str(trade.get("side") or "").strip().lower()

        if side == "buy":
            position["quantity"] += quantity
            position["cost"] += quantity * price
        elif side == "sell" and position["quantity"] > 0:
            released_quantity = min(quantity, position["quantity"])
            average_cost = position["cost"] / position["quantity"]
            position["quantity"] -= released_quantity
            position["cost"] -= average_cost * released_quantity
            if position["quantity"] <= 1e-9:
                position["quantity"] = 0.0
                position["cost"] = 0.0

        market_value = equity - cash
        unrealized_pnl = market_value - sum(item["cost"] for item in positions.values())
        trade.update({
            "quantity": round(quantity, 6),
            "realized_pnl": round(realized_pnl, 4),
            "unrealized_pnl": round(unrealized_pnl, 4),
            "market_value": round(market_value, 4),
        })


def _build_win_rate_trade_pairs(
        trades: list[dict[str, object]],
        final_close_price: float,
        final_trade_date: pd.Timestamp,
        open_shares: float,
) -> list[tuple[dict[str, object], dict[str, object]]]:
    # We work on a copy for win rate calculation only
    # Original trades list remains unchanged for UI display
    metric_trades = list(trades)
    if not metric_trades or final_close_price <= 0:
        return _build_trade_pairs(metric_trades)

    last_side = str(metric_trades[-1].get("side", ""))
    # 1. Handle unclosed Long positions (Last was Buy)
    if last_side == "Buy" and open_shares > 0:
        entry_price = float(metric_trades[-1].get("price", 0.0))
        # Calculate current cash after closing position
        current_cash = 0.0
        if len(metric_trades) > 0:
            # Get cash from previous trade, which is before this closing trade
            prev_cash = float(metric_trades[-1].get("cash", 0.0))
            current_cash = prev_cash + (open_shares * final_close_price)
        metric_trades.append({
            "date": final_trade_date.strftime("%Y/%m/%d"),
            "side": "Sell",
            "price": round(final_close_price, 4),
            "shares": round(open_shares, 6),
            "pnl": round((final_close_price - entry_price) * open_shares, 4),
            "cash": round(current_cash, 4),
            "equity": round(current_cash, 4),
            "_virtual_close": True,
        })
    # 2. Handle unclosed Short positions (Last was Sell)
    # Note: Currently the backtester is primarily long-only, but this logic
    # ensures that if a Short strategy is implemented, the win rate counts it.
    elif last_side == "Sell" and open_shares < 0:
        entry_price = float(metric_trades[-1].get("price", 0.0))
        short_shares = abs(open_shares)
        # Calculate current cash after closing position
        current_cash = 0.0
        if len(metric_trades) > 0:
            prev_cash = float(metric_trades[-1].get("cash", 0.0))
            current_cash = prev_cash - (short_shares * final_close_price)
        metric_trades.append({
            "date": final_trade_date.strftime("%Y/%m/%d"),
            "side": "Buy",
            "price": round(final_close_price, 4),
            "shares": short_shares,
            "pnl": round((entry_price - final_close_price) * short_shares, 4),
            "cash": round(current_cash, 4),
            "equity": round(current_cash, 4),
            "_virtual_close": True,
        })

    return _build_trade_pairs(metric_trades)


def _calculate_win_rate_pct(
        trade_pairs: list[tuple[dict[str, object], dict[str, object]]],
        wins: list[tuple[dict[str, object], dict[str, object]]],
        total_trades: int,
) -> float | None:
    if trade_pairs:
        return round((len(wins) / len(trade_pairs)) * 100.0, 2)
    if total_trades == 0:
        return 0.0
    return None


def _build_trade_markers(frame: pd.DataFrame, trades: list[dict[str, object]], interval: str = "1d") -> tuple[list[bool], list[bool]]:
    buy_markers = [False] * len(frame)
    sell_markers = [False] * len(frame)
    if frame.empty or not trades:
        return buy_markers, sell_markers

    date_format = "%Y/%m/%d %H:%M" if interval == "1m" else "%Y/%m/%d"
    date_index_by_key: dict[str, int] = {}
    for index, value in enumerate(frame["Date"].tolist()):
        date_index_by_key[pd.Timestamp(value).strftime(date_format)] = index

    for trade in trades:
        trade_date = str(trade.get("date", ""))
        trade_index = date_index_by_key.get(trade_date)
        if trade_index is None:
            continue
        trade_side = str(trade.get("side", ""))
        if trade_side == "Buy":
            buy_markers[trade_index] = True
        elif trade_side == "Sell":
            sell_markers[trade_index] = True

    return buy_markers, sell_markers


def _apply_dividend_cash_flow(
        *,
        cash: float,
        shares: float,
        close_price: float,
        dividend_per_share: float,
        reinvest_cash_dividends: bool,
) -> tuple[float, float]:
    if shares <= 0 or not isfinite(dividend_per_share) or dividend_per_share <= 0:
        return cash, shares
    dividend_cash = shares * dividend_per_share
    if reinvest_cash_dividends and close_price > 0:
        return cash, shares + (dividend_cash / close_price)
    return cash + dividend_cash, shares


def _build_buy_hold_equity_series(
        frame: pd.DataFrame,
        initial_capital: float,
        *,
        reinvest_cash_dividends: bool,
        include_cash_dividends: bool,
) -> tuple[pd.Series, float]:
    first_price = float(frame["Open"].iloc[0] if "Open" in frame.columns else frame["Close"].iloc[0])
    shares = float(floor(initial_capital / first_price)) if first_price > 0 else 0.0
    cash = float(initial_capital) - (shares * first_price)
    equity_values: list[float] = []
    for index, row in enumerate(frame.itertuples(index=False)):
        close_price = float(row.Close)
        dividend_per_share = float(getattr(row, "Dividends", 0.0) or 0.0)
        if include_cash_dividends and index > 0:
            cash, shares = _apply_dividend_cash_flow(
                cash=cash,
                shares=shares,
                close_price=close_price,
                dividend_per_share=dividend_per_share,
                reinvest_cash_dividends=reinvest_cash_dividends,
            )
        equity_values.append(cash + (shares * close_price))
    return pd.Series(equity_values, index=frame.index, dtype="float64"), float(equity_values[-1] if equity_values else initial_capital)


def run_leveraged_rotation_backtest(
        signal_result: StrategySignalResult,
        initial_capital: float,
        execution_mode: str = "signal_close",
        interval: str = "1d",
        reinvest_cash_dividends: bool = False,
        include_cash_dividends: bool = True,
        stop_loss_enabled: bool = True,
) -> dict[str, object]:
    """Rebalance integer holdings between two assets within allocation bounds."""
    frame = signal_result.frame.copy()
    if frame.empty:
        raise ValueError("No market data available for backtest.")

    metadata = signal_result.metadata if isinstance(signal_result.metadata, dict) else {}
    primary_close_column = str(metadata.get("primary_close_column") or "Close")
    secondary_close_column = str(metadata.get("secondary_close_column") or "Close_2")
    if primary_close_column not in frame.columns or secondary_close_column not in frame.columns:
        raise ValueError("Leveraged Rotation requires two aligned close-price columns.")

    ticker_values = metadata.get("tickers", ("Ticker 1", "Ticker 2"))
    tickers = tuple(str(value) for value in ticker_values) if isinstance(ticker_values, (list, tuple)) else ()
    if len(tickers) < 2:
        tickers = ("Ticker 1", "Ticker 2")
    trade_date_format = "%Y/%m/%d %H:%M" if interval == "1m" else "%Y/%m/%d"
    normalized_execution_mode = _resolve_execution_mode(signal_result, execution_mode)
    raw_rotation_params = metadata.get("rotation_parameters", {})
    rotation_params = raw_rotation_params if isinstance(raw_rotation_params, dict) else {}
    cash = float(initial_capital)
    holdings = [0, 0]
    average_costs: list[float | None] = [None, None]
    target_regime = "initial"
    pending_regime: str | None = None
    equity_points: list[float] = []
    trades: list[dict[str, object]] = []
    realized_gains: list[float] = []
    rotation_results: list[float] = []
    initial_allocation: dict[str, object] = {}

    def asset_column(field: str, asset: int) -> str:
        return field if asset == 1 else f"{field}_2"

    def row_value(row: Any, field: str, asset: int) -> float:
        return float(getattr(row, asset_column(field, asset), 0.0) or 0.0)

    def portfolio_equity(row: Any, price_field: str = "Close") -> float:
        return cash + sum(
            holdings[asset - 1] * row_value(row, price_field, asset)
            for asset in (1, 2)
        )

    def append_trade(
            row: Any,
            side: str,
            asset: int,
            price: float,
            pnl: float,
            share_count: int,
    ) -> None:
        trades.append({
            "date": pd.Timestamp(row.Date).strftime(trade_date_format),
            "side": side,
            "ticker": tickers[asset - 1],
            "price": round(price, 4),
            "shares": int(share_count),
            "pnl": round(pnl, 4),
            "cash": round(cash, 4),
            "equity": round(portfolio_equity(row), 4),
        })

    def allocation_targets(regime: str) -> tuple[float, float]:
        if regime == "leveraged":
            return (
                float(rotation_params.get("primary_min_pct", 20.0)),
                float(rotation_params.get("leveraged_max_pct", 75.0)),
            )
        if regime == "primary":
            return (
                float(rotation_params.get("primary_max_pct", 95.0)),
                float(rotation_params.get("leveraged_min_pct", 0.0)),
            )
        return (
            float(rotation_params.get("initial_primary_pct", 70.0)),
            float(rotation_params.get("initial_leveraged_pct", 25.0)),
        )

    def rebalance(row: Any, regime: str, price_field: str) -> bool:
        nonlocal cash, target_regime
        prices = [row_value(row, price_field, asset) for asset in (1, 2)]
        if any(price <= 0 for price in prices):
            return False
        equity = portfolio_equity(row, price_field)
        target_pcts = allocation_targets(regime)
        desired = [int(floor(equity * pct / 100.0 / price)) for pct, price in zip(target_pcts, prices, strict=True)]
        changed = False

        for index, asset in enumerate((1, 2)):
            quantity = max(0, holdings[index] - desired[index])
            price = prices[index]
            if quantity <= 0:
                continue
            if (
                not stop_loss_enabled
                and average_costs[index] is not None
                and price < float(average_costs[index])
            ):
                continue
            pnl = (price - float(average_costs[index] or price)) * quantity
            cash += quantity * price
            holdings[index] -= quantity
            append_trade(row, "Sell", asset, price, pnl, quantity)
            realized_gains.append(pnl)
            if asset == 2:
                rotation_results.append(pnl)
            if holdings[index] == 0:
                average_costs[index] = None
            changed = True

        for index, asset in enumerate((1, 2)):
            price = prices[index]
            quantity = min(
                max(0, desired[index] - holdings[index]),
                int(floor(max(cash, 0.0) / price)),
            )
            if quantity <= 0:
                continue
            previous_holding = holdings[index]
            previous_cost = float(average_costs[index] or 0.0)
            cash -= quantity * price
            holdings[index] += quantity
            average_costs[index] = (
                (previous_holding * previous_cost) + (quantity * price)
            ) / holdings[index]
            append_trade(row, "Buy", asset, price, 0.0, quantity)
            changed = True
        if changed:
            target_regime = regime
        return changed

    for index, row in enumerate(frame.itertuples(index=False)):
        if include_cash_dividends and index > 0:
            for asset in (1, 2):
                dividend_cash = holdings[asset - 1] * row_value(row, "Dividends", asset)
                cash += dividend_cash
                if reinvest_cash_dividends:
                    close_price = row_value(row, "Close", asset)
                    quantity = int(floor(dividend_cash / close_price)) if close_price > 0 else 0
                    if quantity > 0 and quantity * close_price <= cash:
                        previous_holding = holdings[asset - 1]
                        previous_cost = float(average_costs[asset - 1] or 0.0)
                        cash -= quantity * close_price
                        holdings[asset - 1] += quantity
                        average_costs[asset - 1] = (
                            previous_holding * previous_cost + quantity * close_price
                        ) / holdings[asset - 1]

        if index == 0:
            opening_prices = [row_value(row, "Open", asset) for asset in (1, 2)]
            if any(not isfinite(price) or price <= 0 for price in opening_prices):
                raise ValueError("The selected tickers have no usable opening allocation.")
            # Zero target shares are a valid cash allocation, not missing market data.
            rebalance(row, "initial", "Open")
            initial_allocation = {
                "primary_shares": holdings[0],
                "leveraged_shares": holdings[1],
                "primary_open": round(row_value(row, "Open", 1), 4),
                "leveraged_open": round(row_value(row, "Open", 2), 4),
                "cash": round(cash, 2),
            }

        executed_pending = False
        if pending_regime is not None and index > 0:
            executed_pending = rebalance(row, pending_regime, "Open")
            pending_regime = None

        enter_signal = bool(getattr(row, signal_result.buy_signal_column, False))
        exit_signal = bool(getattr(row, signal_result.sell_signal_column, False))
        if enter_signal and not executed_pending:
            if normalized_execution_mode == "next_open":
                pending_regime = "leveraged"
            else:
                rebalance(row, "leveraged", "Close")
        elif exit_signal and not executed_pending:
            if normalized_execution_mode == "next_open":
                pending_regime = "primary"
            else:
                rebalance(row, "primary", "Close")

        equity_points.append(portfolio_equity(row))

    frame["Equity"] = equity_points
    bh_equity_series, bh_final_equity = _build_buy_hold_equity_series(
        frame,
        initial_capital,
        reinvest_cash_dividends=reinvest_cash_dividends,
        include_cash_dividends=include_cash_dividends,
    )
    beat_bh_mask = frame["Equity"] > bh_equity_series
    beat_bh_pct = (beat_bh_mask.sum() / len(frame)) * 100.0 if len(frame) > 0 else 0.0
    total_trades = len(trades)
    wins = [result for result in rotation_results if result > 0]
    win_rate_pct = (
        round((len(wins) / len(rotation_results)) * 100.0, 2)
        if rotation_results
        else 0.0
    )
    buy_markers, sell_markers = _build_trade_markers(frame, trades, interval)
    final_equity = float(frame["Equity"].iloc[-1])
    total_return = ((final_equity / float(initial_capital)) - 1.0) * 100.0
    benchmark_alpha = final_equity - bh_final_equity
    long_gain = sum(max(value, 0.0) for value in realized_gains)
    long_loss = sum(max(-value, 0.0) for value in realized_gains)
    _normalize_transaction_rows(trades)

    return _attach_strategy_presentation({
        "interval": interval,
        "execution_mode": normalized_execution_mode,
        "multi_asset": True,
        "tickers": list(tickers),
        "summary": {
            "initial_capital": round(float(initial_capital), 2),
            "final_equity": round(final_equity, 2),
            "net_return_pct": round(total_return, 2),
            "beat_bh_pct": round(float(beat_bh_pct), 2),
            "total_trades": total_trades,
            "win_rate_pct": win_rate_pct,
            "benchmark_alpha": round(benchmark_alpha, 2),
            "long_gain": round(long_gain, 2),
            "long_loss": round(long_loss, 2),
            "short_gain": 0.0,
            "rotation_count": len(rotation_results),
            "active_ticker": tickers[1] if target_regime == "leveraged" else tickers[0],
        },
        "initial_allocation": initial_allocation,
        "chart": {
            "dates": frame["Date"].map(lambda value: _format_chart_date(value, interval)).tolist(),
            "raw_dates": [pd.Timestamp(value).isoformat() for value in frame["Date"].tolist()],
            "open": [round(float(value), 4) for value in frame["Open"].tolist()],
            "high": [round(float(value), 4) for value in frame["High"].tolist()],
            "low": [round(float(value), 4) for value in frame["Low"].tolist()],
            "close": [round(float(value), 4) for value in frame["Close"].tolist()],
            "equity": [round(float(value), 4) for value in frame["Equity"].tolist()],
            "all_in_equity": [round(float(value), 4) for value in bh_equity_series.tolist()],
            "buy_markers": buy_markers,
            "sell_markers": sell_markers,
        },
        "trades": trades,
    }, signal_result)


def run_single_ticker_backtest(
        signal_result: StrategySignalResult,
        initial_capital: float,
        execution_mode: str = "signal_close",
        interval: str = "1d",
        reinvest_cash_dividends: bool = False,
        include_cash_dividends: bool = True,
        stop_loss_enabled: bool = True,
) -> dict[str, object]:
    if signal_result.execution_profile == "leveraged_rotation":
        return run_leveraged_rotation_backtest(
            signal_result,
            initial_capital,
            execution_mode=execution_mode,
            interval=interval,
            reinvest_cash_dividends=reinvest_cash_dividends,
            include_cash_dividends=include_cash_dividends,
            stop_loss_enabled=stop_loss_enabled,
        )

    frame = signal_result.frame.copy()
    if frame.empty:
        raise ValueError("No market data available for backtest.")

    trade_date_format = "%Y/%m/%d %H:%M" if interval == "1m" else "%Y/%m/%d"
    cash = float(initial_capital)
    starting_equity = float(initial_capital)
    shares = 0.0
    entry_price = None
    equity_points: list[float] = []
    trades: list[dict[str, object]] = []
    normalized_execution_mode = _resolve_execution_mode(signal_result, execution_mode)

    buy_column = signal_result.buy_signal_column
    sell_column = signal_result.sell_signal_column
    pending_order: str | None = None
    is_at_backtest_start = True
    is_grid_execution = signal_result.execution_profile == "grid_trading"
    grid_metadata = signal_result.metadata if isinstance(signal_result.metadata, dict) else {}
    raw_grid_params = grid_metadata.get("grid_parameters", {})
    grid_params = raw_grid_params if isinstance(raw_grid_params, dict) else {}
    grid_initial_holding = float(max(0, int(grid_params.get("initial_holding", 0))))
    grid_holding_min = float(max(0, int(grid_params.get("holding_min", 0))))
    grid_holding_max = float(max(grid_holding_min, int(grid_params.get("holding_max", 1_000_000))))
    grid_rise_value = grid_params.get("rise", 0.0)
    grid_fall_value = grid_params.get("fall", 0.0)
    grid_rise = float(0.0 if grid_rise_value is None else grid_rise_value)
    grid_fall = float(0.0 if grid_fall_value is None else grid_fall_value)
    grid_initial_unit_cost = 0.0
    grid_reference_price: float | None = None
    grid_reference_prices: list[float] = []
    grid_lower_prices: list[float] = []
    grid_upper_prices: list[float] = []
    grid_buy_signals: list[bool] = []
    grid_sell_signals: list[bool] = []

    if is_grid_execution:
        first_row = frame.iloc[0]
        first_open = float(first_row.get("Open", first_row["Close"]))
        grid_initial_unit_cost = first_open if first_open > 0 else float(first_row["Close"])
        if not isfinite(grid_initial_unit_cost) or grid_initial_unit_cost <= 0:
            raise ValueError("Grid Trading requires a finite positive initial price.")
        shares = grid_initial_holding
        starting_equity = cash + (shares * grid_initial_unit_cost)
        entry_price = grid_initial_unit_cost if shares > 0 else None

    def record_grid_execution(execution_price: float) -> None:
        """Advance Grid's trigger anchor only after an order actually fills."""
        nonlocal grid_reference_price
        if is_grid_execution and execution_price > 0:
            grid_reference_price = execution_price

    def stop_loss_allows_exit(exit_price: float, *, short_position: bool = False) -> bool:
        if stop_loss_enabled or entry_price is None:
            return True
        return exit_price <= float(entry_price) if short_position else exit_price >= float(entry_price)

    def execute_grid_buy(
            execution_price: float,
            trade_date: pd.Timestamp,
            marked_price: float,
    ) -> bool:
        """Buy toward Grid's maximum holding without exceeding available cash."""
        nonlocal cash, shares, entry_price
        available_capacity = max(0.0, grid_holding_max - shares)
        quantity = min(available_capacity, float(floor(cash / execution_price)))
        if quantity <= 0:
            return False
        previous_holding = shares
        cash -= quantity * execution_price
        shares += quantity
        entry_price = (
            execution_price
            if previous_holding <= 0 or entry_price is None
            else (
                (previous_holding * float(entry_price))
                + (quantity * execution_price)
            ) / shares
        )
        trades.append({
            "date": trade_date.strftime(trade_date_format),
            "side": "Buy",
            "price": round(execution_price, 4),
            "shares": round(quantity, 6),
            "pnl": 0.0,
            "cash": round(cash, 4),
            "equity": round(cash + (shares * marked_price), 4),
        })
        record_grid_execution(execution_price)
        return True

    def execute_grid_sell(
            execution_price: float,
            trade_date: pd.Timestamp,
            marked_price: float,
    ) -> bool:
        """Sell toward Grid's minimum holding without crossing its floor."""
        nonlocal cash, shares, entry_price
        quantity = max(0.0, shares - grid_holding_min)
        if quantity <= 0 or not stop_loss_allows_exit(execution_price):
            return False
        pnl = (execution_price - float(entry_price or execution_price)) * quantity
        cash += quantity * execution_price
        shares -= quantity
        trades.append({
            "date": trade_date.strftime(trade_date_format),
            "side": "Sell",
            "price": round(execution_price, 4),
            "shares": round(quantity, 6),
            "pnl": round(pnl, 4),
            "cash": round(cash, 4),
            "equity": round(cash + (shares * marked_price), 4),
        })
        record_grid_execution(execution_price)
        if shares <= 0:
            entry_price = None
        return True

    for row in frame.itertuples(index=False):
        is_first_row = is_at_backtest_start
        trade_date = pd.Timestamp(row.Date)
        open_price = float(getattr(row, "Open", 0.0))
        close_price = float(row.Close)
        dividend_per_share = float(getattr(row, "Dividends", 0.0) or 0.0)
        buy_signal = False if is_grid_execution else bool(getattr(row, buy_column))
        sell_signal = False if is_grid_execution else bool(getattr(row, sell_column))

        if include_cash_dividends:
            cash, shares = _apply_dividend_cash_flow(
                cash=cash,
                shares=shares,
                close_price=close_price,
                dividend_per_share=dividend_per_share,
                reinvest_cash_dividends=reinvest_cash_dividends,
            )

        # Special Case: Entry-at-Point-Zero for strategies with initial signals
        if (
                not is_grid_execution
                and is_first_row
                and (buy_signal or sell_signal)
                and shares == 0
                and open_price > 0
        ):
            if normalized_execution_mode == "next_open":
                # In next_open mode, even initial signals get deferred to the next bar open
                if buy_signal:
                    pending_order = "buy"
                    buy_signal = False
                elif sell_signal:
                    pending_order = "sell"
                    sell_signal = False
            else:
                # In signal_close mode, execute immediately at the open price
                if buy_signal:
                    shares = float(floor(cash / open_price))
                    if shares > 0:
                        cash -= (shares * open_price)
                        entry_price = open_price
                        trades.append({
                            "date": trade_date.strftime(trade_date_format),
                            "side": "Buy",
                            "price": round(open_price, 4),
                            "shares": round(shares, 6),
                            "pnl": 0.0,
                            "cash": round(cash, 4),
                            "equity": round(cash + (shares * close_price), 4),
                        })
                        record_grid_execution(open_price)
                    buy_signal = False
                # Do NOT allow short selling when starting with zero shares (long-only)
                elif sell_signal:
                    sell_signal = False
        # Always retire the backtest-start sentinel after the first loop iteration.
        is_at_backtest_start = False

        if normalized_execution_mode == "next_open" and pending_order and not is_first_row:
            if not isfinite(open_price) or open_price <= 0.0:
                raise ValueError(
                    "next_open execution requires a finite positive Open price; "
                    "Close fallback is not permitted."
                )
            execution_price = open_price

            if is_grid_execution and pending_order == "buy" and execution_price > 0:
                execute_grid_buy(execution_price, trade_date, close_price)
                pending_order = None
            elif is_grid_execution and pending_order == "sell" and execution_price > 0:
                execute_grid_sell(execution_price, trade_date, close_price)
                pending_order = None
            elif pending_order == "buy" and execution_price > 0:
                if shares == 0:  # Entry Long
                    shares = float(floor(cash / execution_price))
                    if shares > 0:
                        cash -= (shares * execution_price)
                        entry_price = execution_price
                        trades.append({
                            "date": trade_date.strftime(trade_date_format),
                            "side": "Buy",
                            "price": round(execution_price, 4),
                            "shares": round(shares, 6),
                            "pnl": 0.0,
                            "cash": round(cash, 4),
                            "equity": round(cash + (shares * close_price), 4),
                        })
                        record_grid_execution(execution_price)
                elif shares < 0 and stop_loss_allows_exit(execution_price, short_position=True):  # Exit Short (Cover)
                    short_shares = abs(shares)
                    cost = short_shares * execution_price
                    pnl = (short_shares * float(entry_price or execution_price)) - cost
                    cash -= cost
                    trades.append({
                        "date": trade_date.strftime(trade_date_format),
                        "side": "Buy",
                        "price": round(execution_price, 4),
                        "shares": round(short_shares, 6),
                        "pnl": round(pnl, 4),
                        "cash": round(cash, 4),
                        "equity": round(cash, 4),
                    })
                    record_grid_execution(execution_price)
                    shares = 0.0
                    entry_price = None
                pending_order = None
            elif pending_order == "sell" and execution_price > 0:
                if shares > 0 and stop_loss_allows_exit(execution_price):  # Exit Long (Sell)
                    proceeds = shares * execution_price
                    pnl = proceeds - (shares * float(entry_price or execution_price))
                    cash += proceeds
                    trades.append({
                        "date": trade_date.strftime(trade_date_format),
                        "side": "Sell",
                        "price": round(execution_price, 4),
                        "shares": round(shares, 6),
                        "pnl": round(pnl, 4),
                        "cash": round(cash, 4),
                        "equity": round(cash, 4),
                    })
                    record_grid_execution(execution_price)
                    shares = 0.0
                    entry_price = None
                # Do NOT allow entry short in long-only mode
                pending_order = None

        if is_grid_execution:
            if grid_reference_price is None:
                grid_reference_price = open_price if open_price > 0 else close_price
            reference_price = grid_reference_price if grid_reference_price and grid_reference_price > 0 else 0.0
            grid_lower = reference_price * (1.0 - grid_fall)
            grid_upper = reference_price * (1.0 + grid_rise)
            high_price = getattr(row, "High", close_price)
            low_price = getattr(row, "Low", close_price)
            sell_signal = bool(
                pd.notna(close_price)
                and shares > grid_holding_min
                and pd.notna(high_price)
                and float(high_price) >= grid_upper
            )
            buy_signal = bool(
                pd.notna(close_price)
                and not sell_signal
                and shares < grid_holding_max
                and cash >= close_price
                and pd.notna(low_price)
                and float(low_price) <= grid_lower
            )
            grid_reference_prices.append(reference_price)
            grid_lower_prices.append(grid_lower)
            grid_upper_prices.append(grid_upper)
            grid_buy_signals.append(buy_signal)
            grid_sell_signals.append(sell_signal)

        if normalized_execution_mode == "signal_close":
            if is_grid_execution and buy_signal and close_price > 0:
                execute_grid_buy(close_price, trade_date, close_price)
            elif is_grid_execution and sell_signal and close_price > 0:
                execute_grid_sell(close_price, trade_date, close_price)
            elif buy_signal and close_price > 0:
                if shares == 0:  # Entry Long
                    shares = float(floor(cash / close_price))
                    if shares > 0:
                        cash -= (shares * close_price)
                        entry_price = close_price
                        trades.append({
                            "date": trade_date.strftime(trade_date_format),
                            "side": "Buy",
                            "price": round(close_price, 4),
                            "shares": round(shares, 6),
                            "pnl": 0.0,
                            "cash": round(cash, 4),
                            "equity": round(cash + (shares * close_price), 4),
                        })
                        record_grid_execution(close_price)
                elif shares < 0 and stop_loss_allows_exit(close_price, short_position=True):  # Exit Short (Cover)
                    short_shares = abs(shares)
                    cost = short_shares * close_price
                    pnl = (short_shares * float(entry_price or close_price)) - cost
                    cash -= cost
                    trades.append({
                        "date": trade_date.strftime(trade_date_format),
                        "side": "Buy",
                        "price": round(close_price, 4),
                        "shares": round(short_shares, 6),
                        "pnl": round(pnl, 4),
                        "cash": round(cash, 4),
                        "equity": round(cash, 4),
                    })
                    record_grid_execution(close_price)
                    shares = 0.0
                    entry_price = None
            elif sell_signal and close_price > 0:
                if shares > 0 and stop_loss_allows_exit(close_price):  # Exit Long (Sell)
                    proceeds = shares * close_price
                    pnl = proceeds - (shares * float(entry_price or close_price))
                    cash += proceeds
                    trades.append({
                        "date": trade_date.strftime(trade_date_format),
                        "side": "Sell",
                        "price": round(close_price, 4),
                        "shares": round(shares, 6),
                        "pnl": round(pnl, 4),
                        "cash": round(cash, 4),
                        "equity": round(cash, 4),
                    })
                    record_grid_execution(close_price)
                    shares = 0.0
                    entry_price = None
                # Do NOT allow entry short in long-only mode
        else:
            if buy_signal and pending_order is None:
                if (is_grid_execution and shares < grid_holding_max) or shares <= 0:
                    pending_order = "buy"
            elif sell_signal and pending_order is None:
                if (is_grid_execution and shares > grid_holding_min) or shares > 0:
                    pending_order = "sell"

        equity_points.append(cash + (shares * close_price))

    if is_grid_execution:
        frame["grid_reference_price"] = grid_reference_prices
        frame["grid_lower"] = grid_lower_prices
        frame["grid_upper"] = grid_upper_prices
        frame["buy_signal"] = grid_buy_signals
        frame["sell_signal"] = grid_sell_signals
    frame["Equity"] = equity_points
    bh_equity_series, bh_final_equity = _build_buy_hold_equity_series(
        frame,
        starting_equity,
        reinvest_cash_dividends=reinvest_cash_dividends,
        include_cash_dividends=include_cash_dividends,
    )
    beat_bh_mask = frame["Equity"] > bh_equity_series
    beat_bh_pct = (beat_bh_mask.sum() / len(frame)) * 100.0 if len(frame) > 0 else 0.0
    total_trades = len([trade for trade in trades if not trade.get("_virtual_close")])
    final_close_price = float(frame["Close"].iloc[-1])
    final_trade_date = pd.Timestamp(frame["Date"].iloc[-1])
    trade_pairs = _build_win_rate_trade_pairs(trades, final_close_price, final_trade_date, shares)
    wins = [pair for pair in trade_pairs if _is_winning_trade_pair(*pair)]
    win_rate_pct = _calculate_win_rate_pct(trade_pairs, wins, total_trades)
    buy_markers, sell_markers = _build_trade_markers(frame, trades, interval)
    final_equity = float(frame["Equity"].iloc[-1])
    total_return = ((final_equity / starting_equity) - 1.0) * 100.0

    # Advanced Metrics    # 1. Benchmark P&L (Buy and Hold at first open)
    benchmark_alpha = final_equity - bh_final_equity

    # 2. Strategy Component Gains
    # Long Gain: realized positive gain from Buy -> Sell cycles
    # Long Loss: realized loss from Buy -> Sell cycles where the exit is lower than the entry
    # Short Gain: realized positive avoidance gain from Sell -> Buy intervals
    long_gain = 0.0
    long_loss = 0.0
    short_gain = 0.0

    # Process sequential trade interactions
    for i in range(len(trades) - 1):
        t1, t2 = trades[i], trades[i + 1]
        t1_side = str(t1.get("side"))
        t2_side = str(t2.get("side"))

        if t1_side == "Buy" and t2_side == "Sell":
            # Split long round-trips into realized gains vs realized losses.
            realized_long_pnl = float(t2.get("pnl", 0.0))
            long_gain += max(realized_long_pnl, 0.0)
            long_loss += max(-realized_long_pnl, 0.0)

        elif t1_side == "Sell" and t2_side == "Buy":
            # Only count realized profitable sell-high / buy-back-lower intervals here.
            s_price = float(t1.get("price", 0.0))
            b_price = float(t2.get("price", 0.0))
            s_shares = float(t1.get("shares", 0.0))
            realized_short_pnl = (s_price - b_price) * s_shares
            short_gain += max(realized_short_pnl, 0.0)

    _normalize_transaction_rows(
        trades,
        initial_quantity=grid_initial_holding if is_grid_execution else 0.0,
        initial_unit_cost=grid_initial_unit_cost if is_grid_execution else 0.0,
    )

    return _attach_strategy_presentation({
        "interval": interval,
        "execution_mode": normalized_execution_mode,
        "summary": {
            "initial_capital": round(starting_equity, 2),
            "initial_cash": round(float(initial_capital), 2),
            "final_equity": round(final_equity, 2),
            "net_return_pct": round(total_return, 2),
            "beat_bh_pct": round(float(beat_bh_pct), 2),
            "total_trades": total_trades,
            "win_rate_pct": win_rate_pct,
            "benchmark_alpha": round(benchmark_alpha, 2),
            "long_gain": round(long_gain, 2),
            "long_loss": round(long_loss, 2),
            "short_gain": round(short_gain, 2),
        },
        "chart": {
            "dates": frame["Date"].map(lambda value: _format_chart_date(value, interval)).tolist(),
            "raw_dates": [pd.Timestamp(value).isoformat() for value in frame["Date"].tolist()],
            "open": [round(float(getattr(row, "Open", row.Close)), 4) for row in frame.itertuples(index=False)],
            "high": [round(float(getattr(row, "High", row.Close)), 4) for row in frame.itertuples(index=False)],
            "low": [round(float(getattr(row, "Low", row.Close)), 4) for row in frame.itertuples(index=False)],
            "close": [round(float(value), 4) for value in frame["Close"].tolist()],
            "equity": [round(float(value), 4) for value in frame["Equity"].tolist()],
            "all_in_equity": [round(float(value), 4) for value in bh_equity_series.tolist()],
            "buy_markers": buy_markers,
            "sell_markers": sell_markers,
        },
        "trades": trades,
    }, signal_result)
