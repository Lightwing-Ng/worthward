"""
Single-ticker long-only backtest engine.

Code version: v1.2.0
"""

from __future__ import annotations

from math import floor

import pandas as pd

from .base import StrategySignalResult
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
                    "side": "BUY",
                    "price": round(close_price, 4),
                    "shares": shares,
                    "equity": round(cash + (shares * close_price), 4),
                })

        elif sell_signal and shares > 0:
            proceeds = shares * close_price
            pnl = proceeds - (shares * float(entry_price or close_price))
            cash += proceeds
            trades.append({
                "date": trade_date.strftime("%Y/%m/%d"),
                "side": "SELL",
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
    sell_trades = [trade for trade in trades if trade["side"] == "SELL"]
    wins = [trade for trade in sell_trades if float(trade.get("pnl", 0.0)) > 0]
    final_equity = float(frame["Equity"].iloc[-1])
    total_return = ((final_equity / float(initial_capital)) - 1.0) * 100.0

    return {
        "summary": {
            "initial_capital": round(float(initial_capital), 2),
            "final_equity": round(final_equity, 2),
            "net_return_pct": round(total_return, 2),
            "max_drawdown_pct": round(float(drawdown.min()) * 100.0, 2),
            "trade_count": len(sell_trades),
            "win_rate_pct": round((len(wins) / len(sell_trades)) * 100.0, 2) if sell_trades else 0.0,
        },
        "chart": {
            "dates": frame["Date"].dt.strftime("%Y/%m/%d").tolist(),
            "close": [round(float(value), 4) for value in frame["Close"].tolist()],
            "equity": [round(float(value), 4) for value in frame["Equity"].tolist()],
            "buy_markers": [bool(value) for value in frame[buy_column].tolist()],
            "sell_markers": [bool(value) for value in frame[sell_column].tolist()],
        },
        "trades": trades,
    }
