"""Tests for mixed-frequency strategy execution. Code version: v0.2.0."""

from __future__ import annotations

import unittest

import pandas as pd

from strategies.backtest import run_single_ticker_backtest
from strategies.base import StrategySignalResult
from strategies.interval_bridge import bridge_daily_signals_to_intraday
from app.web.market_history import market_trading_dates_for_history
from tests.factories.market import ohlc_frame_for_dates


class StrategyIntervalBridgeTests(unittest.TestCase):
    @staticmethod
    def _daily_signal_result(
            dates: list[str],
            buy_signals: list[bool],
            sell_signals: list[bool],
    ) -> StrategySignalResult:
        frame = ohlc_frame_for_dates("NVDA", dates)
        frame["buy_signal"] = buy_signals
        frame["sell_signal"] = sell_signals
        return StrategySignalResult(
            frame=frame,
            buy_signal_column="buy_signal",
            sell_signal_column="sell_signal",
            required_execution_mode="next_open",
            presentation={
                "schema": "bayesian-price-field/v1",
                "data_keys": [pd.Timestamp(value).isoformat() for value in frame["Date"]],
            },
        )

    @staticmethod
    def _bridge(
            daily_result: StrategySignalResult,
            intraday: pd.DataFrame,
            ticker: str = "NVDA",
    ) -> StrategySignalResult:
        return bridge_daily_signals_to_intraday(
            daily_result,
            intraday,
            market_trading_dates_for_history(intraday, ticker),
        )

    def test_daily_close_signal_executes_at_next_session_first_minute_open(self) -> None:
        daily_result = self._daily_signal_result(
            ["2026-08-28"],
            [True],
            [False],
        )
        intraday = ohlc_frame_for_dates(
            "NVDA",
            [
                "2026-08-28 15:58",
                "2026-08-28 15:59",
                "2026-08-31 09:30",
                "2026-08-31 09:31",
            ],
        )

        bridged = self._bridge(daily_result, intraday)
        result = run_single_ticker_backtest(
            bridged,
            10_000.0,
            interval="1m",
        )

        self.assertEqual(
            bridged.frame.loc[bridged.frame["buy_signal"], "Date"].tolist(),
            [pd.Timestamp("2026-08-28 15:59")],
        )
        self.assertEqual(result["trades"][0]["date"], "2026/08/31 09:30")
        self.assertEqual(result["trades"][0]["price"], intraday.iloc[2]["Open"])
        self.assertEqual(bridged.presentation, {})
        self.assertEqual(bridged.metadata["model_interval"], "1d")
        self.assertEqual(bridged.metadata["execution_interval"], "1m")
        self.assertEqual(
            bridged.metadata["signal_bridge"],
            "daily-close-to-next-session-open",
        )

    def test_missing_intraday_signal_session_fails_closed(self) -> None:
        daily_result = self._daily_signal_result(
            ["2026-08-28"],
            [True],
            [False],
        )
        intraday = ohlc_frame_for_dates(
            "NVDA",
            ["2026-08-27 15:59", "2026-08-31 09:30"],
        )

        with self.assertRaisesRegex(
            ValueError,
            "missing a daily signal session: 2026-08-28",
        ):
            self._bridge(daily_result, intraday)

    def test_sell_projection_obeys_algorithmic_stop_loss_permission(self) -> None:
        daily_result = self._daily_signal_result(
            ["2026-08-27", "2026-08-28"],
            [True, False],
            [False, True],
        )
        intraday = ohlc_frame_for_dates(
            "NVDA",
            [
                "2026-08-27 15:59",
                "2026-08-28 09:30",
                "2026-08-28 15:59",
                "2026-08-31 09:30",
            ],
        )
        prices = [99.0, 100.0, 95.0, 90.0]
        intraday["Open"] = prices
        intraday["Close"] = prices
        intraday["High"] = [price + 1.0 for price in prices]
        intraday["Low"] = [price - 1.0 for price in prices]

        bridged = self._bridge(daily_result, intraday)
        allowed = run_single_ticker_backtest(
            bridged,
            10_000.0,
            interval="1m",
            stop_loss_enabled=True,
        )
        blocked = run_single_ticker_backtest(
            bridged,
            10_000.0,
            interval="1m",
            stop_loss_enabled=False,
        )

        self.assertEqual(
            bridged.frame.loc[bridged.frame["sell_signal"], "Date"].tolist(),
            [pd.Timestamp("2026-08-28 15:59")],
        )
        self.assertEqual(
            [trade["side"] for trade in allowed["trades"]],
            ["Buy", "Sell"],
        )
        self.assertEqual(
            [trade["price"] for trade in allowed["trades"]],
            [100.0, 90.0],
        )
        self.assertEqual(
            [trade["side"] for trade in blocked["trades"]],
            ["Buy"],
        )

    def test_duplicate_intraday_timestamps_fail_closed(self) -> None:
        daily_result = self._daily_signal_result(
            ["2026-08-28"],
            [False],
            [False],
        )
        intraday = ohlc_frame_for_dates(
            "NVDA",
            ["2026-08-28 15:59", "2026-08-28 15:59"],
        )

        with self.assertRaisesRegex(ValueError, "duplicate timestamps"):
            self._bridge(daily_result, intraday)

    def test_hong_kong_session_uses_market_trading_date_across_new_york_midnight(self) -> None:
        daily_result = self._daily_signal_result(
            ["2026-07-14"],
            [True],
            [False],
        )
        intraday = ohlc_frame_for_dates(
            "7709.HK",
            [
                "2026-07-13 21:30",
                "2026-07-14 03:59",
                "2026-07-14 21:30",
            ],
        )

        bridged = self._bridge(daily_result, intraday, "7709.HK")
        result = run_single_ticker_backtest(
            bridged,
            10_000.0,
            interval="1m",
        )

        self.assertEqual(
            bridged.frame.loc[bridged.frame["buy_signal"], "Date"].tolist(),
            [pd.Timestamp("2026-07-14 03:59")],
        )
        self.assertEqual(result["trades"][0]["date"], "2026/07/14 21:30")

    def test_bridge_forces_next_open_and_rejects_signal_close(self) -> None:
        daily_result = self._daily_signal_result(
            ["2026-08-28"],
            [True],
            [False],
        )
        daily_result.required_execution_mode = None
        intraday = ohlc_frame_for_dates(
            "NVDA",
            ["2026-08-28 15:59", "2026-08-31 09:30"],
        )

        bridged = self._bridge(daily_result, intraday)
        self.assertEqual(bridged.required_execution_mode, "next_open")

        daily_result.required_execution_mode = "signal_close"
        with self.assertRaisesRegex(ValueError, "requires next_open execution"):
            self._bridge(daily_result, intraday)

    def test_misaligned_execution_trading_dates_fail_closed(self) -> None:
        daily_result = self._daily_signal_result(
            ["2026-08-28"],
            [False],
            [False],
        )
        intraday = ohlc_frame_for_dates(
            "NVDA",
            ["2026-08-28 15:58", "2026-08-28 15:59"],
        )
        misaligned_dates = pd.Series(
            pd.to_datetime(["2026-08-28", "2026-08-28"]),
            index=[10, 11],
        )

        with self.assertRaisesRegex(ValueError, "trading dates are misaligned"):
            bridge_daily_signals_to_intraday(
                daily_result,
                intraday,
                misaligned_dates,
            )


if __name__ == "__main__":
    unittest.main()
