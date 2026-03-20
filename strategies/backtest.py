"""
Single-ticker long-only backtest engine.

Code version: v1.5.0
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


def run_single_ticker_backtest(
    signal_result: StrategySignalResult,
    initial_capital: float,
) -> dict[str, object]:
    frame = signal_result.frame.copy()
    if frame.empty:
        raise ValueError("No market data available for backtest.")

    cash = float(initial_capital)
    shares = 0
    entry_price = None
    equity_points: list[float] = []
    trades: list[dict[str, object]] = []

    buy_column = signal_result.buy_signal_column
    sell_column = signal_result.sell_signal_column

    for row in frame.itertuples(index=False):
        close_price = float(row.Close)
        trade_date = pd.Timestamp(row.Date)
        buy_signal = bool(getattr(row, buy_column))
        sell_signal = bool(getattr(row, sell_column))

        if buy_signal and shares == 0 and close_price > 0:
            shares = floor(cash / close_price)
            if shares > 0:
                spent = shares * close_price
                cash -= spent
                entry_price = close_price
                trades.append({
                    "date": trade_date.strftime("%Y/%m/%d"),
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
                "date": trade_date.strftime("%Y/%m/%d"),
                "side": "Sell",
                "price": round(close_price, 4),
                "shares": shares,
                "pnl": round(pnl, 4),
                "equity": round(cash, 4),
            })
            shares = 0
            entry_price = None

        equity_points.append(cash + (shares * close_price))

    frame["Equity"] = equity_points
    drawdown = (frame["Equity"] / frame["Equity"].cummax()) - 1.0
    sell_trades = [trade for trade in trades if trade["side"] == "Sell"]
    final_close_price = float(frame["Close"].iloc[-1])
    final_trade_date = pd.Timestamp(frame["Date"].iloc[-1])
    trade_pairs = _build_win_rate_trade_pairs(trades, final_close_price, final_trade_date, shares)
    wins = [pair for pair in trade_pairs if _is_winning_trade_pair(*pair)]
    final_equity = float(frame["Equity"].iloc[-1])
    total_return = ((final_equity / float(initial_capital)) - 1.0) * 100.0

    return {
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
            "close": [round(float(value), 4) for value in frame["Close"].tolist()],
            "equity": [round(float(value), 4) for value in frame["Equity"].tolist()],
            "buy_markers": [bool(value) for value in frame[buy_column].tolist()],
            "sell_markers": [bool(value) for value in frame[sell_column].tolist()],
        },
        "trades": trades,
    }
