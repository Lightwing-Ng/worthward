"""
Single-ticker long-only backtest engine.

Code version: v1.8.0
"""

from __future__ import annotations

from math import floor

import pandas as pd

from .base import StrategySignalResult


def _format_display_date(value: pd.Timestamp | str) -> str:
    timestamp = pd.Timestamp(value)
    return f"{timestamp.day} {timestamp.strftime('%b %Y')}"


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


def _build_win_rate_trade_pairs(
    trades: list[dict[str, object]],
    final_close_price: float,
    final_trade_date: pd.Timestamp,
    open_shares: int,
) -> list[tuple[dict[str, object], dict[str, object]]]:
    metric_trades = list(trades)
    if metric_trades and str(metric_trades[-1].get("side", "")) == "Buy" and open_shares > 0 and final_close_price > 0:
        entry_price = float(metric_trades[-1].get("price", 0.0))
        metric_trades.append({
            "date": final_trade_date.strftime("%Y/%m/%d"),
            "side": "Sell",
            "price": round(final_close_price, 4),
            "shares": open_shares,
            "pnl": round((final_close_price - entry_price) * open_shares, 4),
            "equity": 0.0,
        })
    return _build_trade_pairs(metric_trades)


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


def run_single_ticker_backtest(
    signal_result: StrategySignalResult,
    initial_capital: float,
    execution_mode: str = "signal_close",
    interval: str = "1d",
) -> dict[str, object]:
    frame = signal_result.frame.copy()
    if frame.empty:
        raise ValueError("No market data available for backtest.")

    trade_date_format = "%Y/%m/%d %H:%M" if interval == "1m" else "%Y/%m/%d"
    cash = float(initial_capital)
    shares = 0
    entry_price = None
    equity_points: list[float] = []
    trades: list[dict[str, object]] = []
    normalized_execution_mode = "next_open" if str(execution_mode).strip().lower() == "next_open" else "signal_close"

    buy_column = signal_result.buy_signal_column
    sell_column = signal_result.sell_signal_column
    pending_order: str | None = None
    is_at_backtest_start = True
    for row in frame.itertuples(index=False):
        trade_date = pd.Timestamp(row.Date)
        open_price = float(getattr(row, "Open", 0.0))
        close_price = float(row.Close)
        buy_signal = bool(getattr(row, buy_column))
        sell_signal = bool(getattr(row, sell_column))

        # Special Case: Buy-at-Point-Zero for strategies with initial signals (like Buy and Hold)
        if is_at_backtest_start and buy_signal and shares == 0 and open_price > 0:
            shares = floor(cash / open_price)
            if shares > 0:
                spent = shares * open_price
                cash -= spent
                entry_price = open_price
                trades.append({
                    "date": trade_date.strftime(trade_date_format),
                    "side": "Buy",
                    "price": round(open_price, 4),
                    "shares": shares,
                    "pnl": 0.0,
                    "equity": round(cash + (shares * close_price), 4),
                })
            # Important: bypass subsequent signal booking since we entered here
            buy_signal = False 
            is_at_backtest_start = False

        if normalized_execution_mode == "next_open" and pending_order:
            execution_price = open_price if open_price > 0 else close_price
            
            if pending_order == "buy" and shares == 0 and execution_price > 0:
                shares = floor(cash / execution_price)
                if shares > 0:
                    spent = shares * execution_price
                    cash -= spent
                    entry_price = execution_price
                    trades.append({
                        "date": trade_date.strftime(trade_date_format),
                        "side": "Buy",
                        "price": round(execution_price, 4),
                        "shares": shares,
                        "pnl": 0.0,
                        "equity": round(cash + (shares * close_price), 4),
                    })
                pending_order = None
            elif pending_order == "sell" and shares > 0 and execution_price > 0:
                proceeds = shares * execution_price
                pnl = proceeds - (shares * float(entry_price or execution_price))
                cash += proceeds
                trades.append({
                    "date": trade_date.strftime(trade_date_format),
                    "side": "Sell",
                    "price": round(execution_price, 4),
                    "shares": shares,
                    "pnl": round(pnl, 4),
                    "equity": round(cash, 4),
                })
                shares = 0
                entry_price = None
                pending_order = None

        if normalized_execution_mode == "signal_close":
            if buy_signal and shares == 0 and close_price > 0:
                shares = floor(cash / close_price)
                if shares > 0:
                    spent = shares * close_price
                    cash -= spent
                    entry_price = close_price
                    trades.append({
                        "date": trade_date.strftime(trade_date_format),
                        "side": "Buy",
                        "price": round(close_price, 4),
                        "shares": shares,
                        "pnl": 0.0,
                        "equity": round(cash + (shares * close_price), 4),
                    })
            elif sell_signal and shares > 0:
                proceeds = shares * close_price
                pnl = proceeds - (shares * float(entry_price or close_price))
                cash += proceeds
                trades.append({
                    "date": trade_date.strftime(trade_date_format),
                    "side": "Sell",
                    "price": round(close_price, 4),
                    "shares": shares,
                    "pnl": round(pnl, 4),
                    "equity": round(cash, 4),
                })
                shares = 0
                entry_price = None
        else:
            if buy_signal and shares == 0 and pending_order is None:
                pending_order = "buy"
            elif sell_signal and shares > 0 and pending_order is None:
                pending_order = "sell"

        equity_points.append(cash + (shares * close_price))

    frame["Equity"] = equity_points
    drawdown = (frame["Equity"] / frame["Equity"].cummax()) - 1.0
    sell_trades = [trade for trade in trades if trade["side"] == "Sell"]
    final_close_price = float(frame["Close"].iloc[-1])
    final_trade_date = pd.Timestamp(frame["Date"].iloc[-1])
    trade_pairs = _build_win_rate_trade_pairs(trades, final_close_price, final_trade_date, shares)
    wins = [pair for pair in trade_pairs if _is_winning_trade_pair(*pair)]
    buy_markers, sell_markers = _build_trade_markers(frame, trades, interval)
    final_equity = float(frame["Equity"].iloc[-1])
    total_return = ((final_equity / float(initial_capital)) - 1.0) * 100.0

    return {
        "interval": interval,
        "summary": {
            "initial_capital": round(float(initial_capital), 2),
            "final_equity": round(final_equity, 2),
            "net_return_pct": round(total_return, 2),
            "max_drawdown_pct": round(float(drawdown.min()) * 100.0, 2),
            "trade_count": len(sell_trades),
            "win_rate_pct": round((len(wins) / len(trade_pairs)) * 100.0, 2) if trade_pairs else 0.0,
        },
        "chart": {
            "dates": frame["Date"].map(_format_display_date).tolist(),
            "raw_dates": [pd.Timestamp(value).isoformat() for value in frame["Date"].tolist()],
            "open": [round(float(getattr(row, "Open", row.Close)), 4) for row in frame.itertuples(index=False)],
            "high": [round(float(getattr(row, "High", row.Close)), 4) for row in frame.itertuples(index=False)],
            "low": [round(float(getattr(row, "Low", row.Close)), 4) for row in frame.itertuples(index=False)],
            "close": [round(float(value), 4) for value in frame["Close"].tolist()],
            "equity": [round(float(value), 4) for value in frame["Equity"].tolist()],
            "buy_markers": buy_markers,
            "sell_markers": sell_markers,
        },
        "trades": trades,
    }
