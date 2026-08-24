"""
Recurring investment simulator.

Code version: v0.1.8
"""

from __future__ import annotations

from calendar import monthrange
from collections import Counter
from datetime import date, timedelta

import pandas as pd

from app.services.presentation import format_display_date, format_short_display_date

WEEKDAY_LABELS = {
    0: "Monday",
    1: "Tuesday",
    2: "Wednesday",
    3: "Thursday",
    4: "Friday",
}


def _format_trade_date(value: pd.Timestamp | str) -> str:
    timestamp = pd.Timestamp(value)
    return format_short_display_date(timestamp)


def _normalize_frequency(raw_value: str | None) -> str:
    return "weekly" if str(raw_value or "").strip().lower() == "weekly" else "monthly"


def _normalize_weekday(raw_value: object, fallback: int = 0) -> int:
    try:
        value = int(str(raw_value).strip())
    except (TypeError, ValueError):
        return fallback
    return value if value in WEEKDAY_LABELS else fallback


def _normalize_month_day(raw_value: object, fallback: int = 15) -> int:
    try:
        value = int(str(raw_value).strip())
    except (TypeError, ValueError):
        return fallback
    return min(max(value, 1), 28)


def _align_to_next_trading_day(
    trading_index: pd.Index,
    target_date: date,
    range_end: pd.Timestamp,
) -> pd.Timestamp | None:
    normalized_target = pd.Timestamp(target_date).normalize()
    position = int(trading_index.searchsorted(normalized_target, side="left"))
    if position >= len(trading_index):
        return None
    aligned = pd.Timestamp(trading_index[position]).normalize()
    if aligned > range_end.normalize():
        return None
    return aligned


def build_recurring_schedule_dates(
    trading_dates: pd.Series,
    start_date: pd.Timestamp,
    end_date: pd.Timestamp,
    *,
    frequency: str,
    weekday: int,
    month_day: int,
) -> list[pd.Timestamp]:
    if trading_dates.empty:
        return []

    trading_index = pd.Index(pd.to_datetime(trading_dates).dt.normalize().sort_values().unique())
    normalized_start = pd.Timestamp(start_date).normalize()
    normalized_end = pd.Timestamp(end_date).normalize()
    normalized_frequency = _normalize_frequency(frequency)

    schedule_dates: list[pd.Timestamp] = []
    if normalized_frequency == "weekly":
        current = normalized_start.date()
        days_ahead = (weekday - current.weekday()) % 7
        intended = current + timedelta(days=days_ahead)
        while intended <= normalized_end.date():
            aligned = _align_to_next_trading_day(trading_index, intended, normalized_end)
            if aligned is not None:
                schedule_dates.append(aligned)
            intended += timedelta(days=7)
        return schedule_dates

    current_year = normalized_start.year
    current_month = normalized_start.month
    while date(current_year, current_month, 1) <= normalized_end.date():
        last_calendar_day = monthrange(current_year, current_month)[1]
        intended = date(current_year, current_month, min(month_day, last_calendar_day))
        if intended >= normalized_start.date() and intended <= normalized_end.date():
            aligned = _align_to_next_trading_day(trading_index, intended, normalized_end)
            if aligned is not None:
                schedule_dates.append(aligned)
        if current_month == 12:
            current_year += 1
            current_month = 1
        else:
            current_month += 1
    return schedule_dates


def simulate_recurring_investment(
    ticker: str,
    target_dataset: pd.DataFrame,
    *,
    amount_per_period: float,
    frequency: str,
    weekday: int,
    month_day: int,
    reinvest_cash_dividends: bool = False,
    include_cash_dividends: bool = True,
    stop_loss_enabled: bool = True,
) -> dict[str, object]:
    # DCA currently emits scheduled contribution buys only, so it has no exit
    # orders for the shared stop-loss guard to filter. Keep the flag in this
    # simulator contract so every Backtest strategy receives the same control.
    normalized_stop_loss_enabled = bool(stop_loss_enabled)
    if target_dataset.empty:
        raise ValueError(f"No market data available for {ticker}.")
    columns = ["Date", "Close"]
    if "Dividends" in target_dataset.columns:
        columns.append("Dividends")
    merged = target_dataset[columns].copy().sort_values("Date")

    periodic_amount = max(float(amount_per_period), 1.0)
    normalized_frequency = _normalize_frequency(frequency)
    normalized_weekday = _normalize_weekday(weekday, 0)
    normalized_month_day = _normalize_month_day(month_day, 15)
    schedule_dates = build_recurring_schedule_dates(
        merged["Date"],
        pd.Timestamp(merged["Date"].min()),
        pd.Timestamp(merged["Date"].max()),
        frequency=normalized_frequency,
        weekday=normalized_weekday,
        month_day=normalized_month_day,
    )
    if not schedule_dates:
        raise ValueError("No recurring contribution dates fall within the selected range.")

    schedule_counter = Counter(pd.Timestamp(value).normalize() for value in schedule_dates)
    total_planned_amount = periodic_amount * len(schedule_dates)
    first_bar_price = float(merged["Close"].iloc[0]) if not merged.empty else 0.0
    all_in_shares = (total_planned_amount / first_bar_price) if first_bar_price > 0 else 0.0
    all_in_dividend_cash = 0.0
    target_shares = 0.0
    target_dividend_cash = 0.0
    total_invested = 0.0
    target_equity_series: list[float] = []
    all_in_equity_series: list[float | None] = []
    contribution_markers: list[bool] = []
    trades: list[dict[str, object]] = []

    for row in merged.itertuples(index=False):
        trade_date = pd.Timestamp(row.Date).normalize()
        event_count = int(schedule_counter.get(trade_date, 0))
        contribution_amount = periodic_amount * event_count
        target_close = float(row.Close)
        dividend_per_share = float(getattr(row, "Dividends", 0.0) or 0.0)

        if include_cash_dividends and dividend_per_share > 0 and target_close > 0:
            target_dividend_amount = target_shares * dividend_per_share
            all_in_dividend_amount = all_in_shares * dividend_per_share
            if reinvest_cash_dividends:
                target_shares += target_dividend_amount / target_close
                all_in_shares += all_in_dividend_amount / target_close
            else:
                target_dividend_cash += target_dividend_amount
                all_in_dividend_cash += all_in_dividend_amount

        if event_count > 0 and target_close > 0:
            target_buy_shares = contribution_amount / target_close
            target_shares += target_buy_shares
            total_invested += contribution_amount
            remaining_cash = max(total_planned_amount - total_invested, 0.0)
            market_value = target_shares * target_close
            cash_value = remaining_cash + target_dividend_cash
            target_equity_after_buy = market_value + cash_value
            trades.append({
                "date": _format_trade_date(trade_date),
                "raw_date": trade_date.strftime("%Y-%m-%d"),
                "ticker": ticker,
                "side": "Buy",
                "price": round(target_close, 4),
                "amount": round(contribution_amount, 4),
                "shares": round(target_buy_shares, 6),
                "quantity": round(target_buy_shares, 6),
                "cumulative_shares": round(target_shares, 6),
                "invested": round(total_invested, 4),
                "realized_pnl": 0.0,
                "unrealized_pnl": round(market_value - total_invested, 4),
                "cash": round(cash_value, 4),
                "market_value": round(market_value, 4),
                "equity": round(target_equity_after_buy, 4),
                "events": event_count,
            })

        remaining_cash = max(total_planned_amount - total_invested, 0.0)
        target_equity = (target_shares * target_close) + remaining_cash + target_dividend_cash
        all_in_equity = ((all_in_shares * target_close) + all_in_dividend_cash) if all_in_shares > 0 else 0.0
        target_equity_series.append(round(target_equity, 4))
        all_in_equity_series.append(round(all_in_equity, 4))
        contribution_markers.append(event_count > 0)

    final_equity = float(target_equity_series[-1] if target_equity_series else 0.0)
    all_in_final_equity = 0.0
    if all_in_equity_series:
        all_in_final_equity = float(all_in_equity_series[-1])
    total_return_pct = ((final_equity / total_invested) - 1.0) * 100.0 if total_invested > 0 else 0.0
    all_in_return_pct = ((all_in_final_equity / total_planned_amount) - 1.0) * 100.0 if total_planned_amount > 0 else 0.0
    average_cost = (total_invested / target_shares) if target_shares > 0 else 0.0
    end_date = pd.Timestamp(merged["Date"].iloc[-1])

    return {
        "summary": {
            "ticker": ticker,
            "amount_per_period": round(periodic_amount, 2),
            "frequency": normalized_frequency,
            "weekday": normalized_weekday,
            "weekday_label": WEEKDAY_LABELS[normalized_weekday],
            "month_day": normalized_month_day,
            "schedule_label": (
                f"Every {WEEKDAY_LABELS[normalized_weekday]}"
                if normalized_frequency == "weekly"
                else f"Calendar day {normalized_month_day} of each month"
            ),
            "planned_capital": round(total_planned_amount, 2),
            "total_invested": round(total_invested, 2),
            "final_equity": round(final_equity, 2),
            "net_gain": round(final_equity - total_invested, 2),
            "net_return_pct": round(total_return_pct, 2),
            "contribution_count": len(schedule_dates),
            "investment_days": len(trades),
            "total_shares": round(target_shares, 6),
            "average_cost": round(average_cost, 4),
            "ending_price": round(float(merged["Close"].iloc[-1]), 4),
            "all_in_equity": round(all_in_final_equity, 2),
            "all_in_return_pct": round(all_in_return_pct, 2),
            "all_in_alpha": round(final_equity - all_in_final_equity, 2),
            "stop_loss_enabled": normalized_stop_loss_enabled,
            "ending_date_label": format_display_date(end_date),
        },
        "chart": {
            "dates": merged["Date"].map(format_display_date).tolist(),
            "raw_dates": merged["Date"].map(lambda value: pd.Timestamp(value).strftime("%Y-%m-%d")).tolist(),
            "close": [round(float(value), 4) for value in merged["Close"].tolist()],
            "equity": target_equity_series,
            "all_in_equity": all_in_equity_series,
            "contribution_markers": contribution_markers,
        },
        "trades": trades,
    }
