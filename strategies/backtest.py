"""
Single-ticker long-only backtest engine.

Code version: v0.3.2
"""

from __future__ import annotations

from math import floor

import pandas as pd

from .base import StrategySignalResult


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
    added_close_trade = False

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
        added_close_trade = True
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
        added_close_trade = True

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
    if shares <= 0 or dividend_per_share <= 0:
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


def run_single_ticker_backtest(
        signal_result: StrategySignalResult,
        initial_capital: float,
        execution_mode: str = "signal_close",
        interval: str = "1d",
        reinvest_cash_dividends: bool = False,
        include_cash_dividends: bool = True,
) -> dict[str, object]:
    frame = signal_result.frame.copy()
    if frame.empty:
        raise ValueError("No market data available for backtest.")

    trade_date_format = "%Y/%m/%d %H:%M" if interval == "1m" else "%Y/%m/%d"
    cash = float(initial_capital)
    shares = 0.0
    entry_price = None
    equity_points: list[float] = []
    trades: list[dict[str, object]] = []
    normalized_execution_mode = "next_open" if str(execution_mode).strip().lower() == "next_open" else "signal_close"

    buy_column = signal_result.buy_signal_column
    sell_column = signal_result.sell_signal_column
    pending_order: str | None = None
    is_at_backtest_start = True
    for row in frame.itertuples(index=False):
        is_first_row = is_at_backtest_start
        trade_date = pd.Timestamp(row.Date)
        open_price = float(getattr(row, "Open", 0.0))
        close_price = float(row.Close)
        dividend_per_share = float(getattr(row, "Dividends", 0.0) or 0.0)
        buy_signal = bool(getattr(row, buy_column))
        sell_signal = bool(getattr(row, sell_column))

        if include_cash_dividends:
            cash, shares = _apply_dividend_cash_flow(
                cash=cash,
                shares=shares,
                close_price=close_price,
                dividend_per_share=dividend_per_share,
                reinvest_cash_dividends=reinvest_cash_dividends,
            )

        # Special Case: Entry-at-Point-Zero for strategies with initial signals
        if is_first_row and (buy_signal or sell_signal) and shares == 0 and open_price > 0:
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
                    buy_signal = False
                # Do NOT allow short selling when starting with zero shares (long-only)
                elif sell_signal:
                    sell_signal = False
        # Always retire the backtest-start sentinel after the first loop iteration.
        is_at_backtest_start = False

        if normalized_execution_mode == "next_open" and pending_order and not is_first_row:
            execution_price = open_price if open_price > 0 else close_price

            if pending_order == "buy" and execution_price > 0:
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
                elif shares < 0:  # Exit Short (Cover)
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
                    shares = 0.0
                    entry_price = None
                pending_order = None
            elif pending_order == "sell" and execution_price > 0:
                if shares > 0:  # Exit Long (Sell)
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
                    shares = 0.0
                    entry_price = None
                # Do NOT allow entry short in long-only mode
                pending_order = None

        if normalized_execution_mode == "signal_close":
            if buy_signal and close_price > 0:
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
                elif shares < 0:  # Exit Short (Cover)
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
                    shares = 0.0
                    entry_price = None
            elif sell_signal and close_price > 0:
                if shares > 0:  # Exit Long (Sell)
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
                    shares = 0.0
                    entry_price = None
                # Do NOT allow entry short in long-only mode
        else:
            if buy_signal and pending_order is None:
                if shares <= 0: pending_order = "buy"
            elif sell_signal and pending_order is None:
                if shares > 0: pending_order = "sell"

        equity_points.append(cash + (shares * close_price))

    frame["Equity"] = equity_points
    bh_equity_series, bh_final_equity = _build_buy_hold_equity_series(
        frame,
        initial_capital,
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
    total_return = ((final_equity / float(initial_capital)) - 1.0) * 100.0

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

    return {
        "interval": interval,
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
    }
