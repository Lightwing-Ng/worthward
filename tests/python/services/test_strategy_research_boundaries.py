"""Research portfolio initialization boundaries. Code version: v1.0.1."""

from math import floor

import pandas as pd
import pytest

from app.services.research import strategy_tuning
from app.services.analysis.comparisons import market_trading_dates_for_history
from app.services.research.strategy_tuning import ResearchRequest, ResearchSession
from tests.factories.market import ohlc_frame_for_dates


@pytest.mark.parametrize("execution_mode", ["signal_close", "next_open"])
@pytest.mark.parametrize(
    ("ticker", "interval"),
    [("QQQ", "1d"), ("QQQ", "1m"), ("7709.HK", "1m")],
)
def test_buy_and_hold_enters_each_research_window_at_its_own_executable_bar(
    ticker, interval, execution_mode, monkeypatch
):
    trading_days = pd.bdate_range("2025-06-02", periods=100)
    if interval == "1d":
        timestamps = trading_days.strftime("%Y-%m-%d").tolist()
    else:
        opening = pd.Timedelta(hours=9, minutes=30)
        timezone = "Asia/Hong_Kong" if ticker.endswith(".HK") else "America/New_York"
        timestamps = [
            (day + opening + pd.Timedelta(minutes=minute))
            .tz_localize(timezone)
            .tz_convert("America/New_York")
            .tz_localize(None)
            .isoformat()
            for day in trading_days
            for minute in (0, 1)
        ]
    frame = ohlc_frame_for_dates(ticker, timestamps)
    request = ResearchRequest(
        "buy-and-hold",
        (ticker,),
        str(trading_days[20].date()),
        str(trading_days[-1].date()),
        interval=interval,
        execution_mode=execution_mode,
    )
    session = ResearchSession(request, history_loader=lambda *_args: frame)
    production_backtest = strategy_tuning.run_single_ticker_backtest
    executions = []

    def record_execution(*args, **kwargs):
        result = production_backtest(*args, **kwargs)
        executions.append(result)
        return result

    monkeypatch.setattr(strategy_tuning, "run_single_ticker_backtest", record_execution)
    dates = market_trading_dates_for_history(frame, ticker)
    for window in [*session.validation_windows, session.holdout_window]:
        metrics = session.evaluate_window({}, window)
        first, last = window
        scored = frame.loc[dates.between(first, last)]
        entry = scored.iloc[1 if execution_mode == "next_open" else 0]
        shares = floor(request.initial_capital / entry.Open)
        expected_gain = shares * (scored.Close.iloc[-1] - entry.Open)
        expected_return = expected_gain / request.initial_capital * 100
        date_format = "%Y/%m/%d %H:%M" if interval == "1m" else "%Y/%m/%d"
        buys = [trade for trade in executions[-1]["trades"] if trade["side"] == "Buy"]
        assert len(buys) == 1
        assert buys[0]["date"] == entry.Date.strftime(date_format)
        assert buys[0]["price"] == entry.Open
        assert buys[0]["shares"] == shares
        assert executions[-1]["summary"]["final_equity"] == request.initial_capital + expected_gain
        assert metrics["net_return_pct"] == pytest.approx(expected_return, abs=0.005001)
        assert metrics["net_return_pct"] > 0
