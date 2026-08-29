"""
Tests for backtest metrics.

Code version: v0.6.0
"""

from __future__ import annotations

import unittest
from unittest.mock import patch

import pandas as pd

from strategies.backtest import _calculate_win_rate_pct, run_single_ticker_backtest
from strategies.base import StrategySignalResult


class BacktestMetricTests(unittest.TestCase):
    def test_strategy_signal_result_preserves_legacy_positional_field_order(self) -> None:
        frame = pd.DataFrame()
        result = StrategySignalResult(
            frame,
            "buy_signal",
            "sell_signal",
            "single_ticker",
            {"legacy": True},
            {"schema": "legacy/v1"},
        )

        self.assertEqual(result.metadata, {"legacy": True})
        self.assertEqual(result.presentation, {"schema": "legacy/v1"})
        self.assertIsNone(result.required_execution_mode)

    def test_backtest_transmits_a_validated_declarative_strategy_presentation(self) -> None:
        frame = pd.DataFrame(
            {
                "Date": pd.date_range("2025-01-01", periods=2, freq="D"),
                "Close": [100.0, 101.0],
                "buy_signal": [False, False],
                "sell_signal": [False, False],
            }
        )
        presentation = {
            "schema": "bayesian-price-field/v1",
            "predictive_mean": [None, 0.001],
            "data_keys": [
                "2025-01-01T00:00:00",
                "2025-01-02T00:00:00",
            ],
        }

        result = run_single_ticker_backtest(
            StrategySignalResult(
                frame=frame,
                buy_signal_column="buy_signal",
                sell_signal_column="sell_signal",
                presentation=presentation,
            ),
            initial_capital=10_000.0,
        )

        self.assertEqual(result["strategy_presentation"], presentation)
        self.assertIsNot(result["strategy_presentation"], presentation)

    def test_backtest_rejects_strategy_presentation_data_key_length_mismatch(self) -> None:
        frame = pd.DataFrame(
            {
                "Date": pd.date_range("2025-01-01", periods=2, freq="D"),
                "Close": [100.0, 101.0],
                "buy_signal": [False, False],
                "sell_signal": [False, False],
            }
        )

        with self.assertRaisesRegex(ValueError, "data_keys must match.*length"):
            run_single_ticker_backtest(
                StrategySignalResult(
                    frame=frame,
                    buy_signal_column="buy_signal",
                    sell_signal_column="sell_signal",
                    presentation={"data_keys": ["2025-01-01T00:00:00"]},
                ),
                initial_capital=10_000.0,
            )

    def test_backtest_rejects_strategy_presentation_data_key_value_mismatch(self) -> None:
        frame = pd.DataFrame(
            {
                "Date": pd.date_range("2025-01-01", periods=2, freq="D"),
                "Close": [100.0, 101.0],
                "buy_signal": [False, False],
                "sell_signal": [False, False],
            }
        )

        with self.assertRaisesRegex(ValueError, "exactly match"):
            run_single_ticker_backtest(
                StrategySignalResult(
                    frame=frame,
                    buy_signal_column="buy_signal",
                    sell_signal_column="sell_signal",
                    presentation={
                        "data_keys": [
                            "2025-01-01T00:00:00",
                            "2025-01-03T00:00:00",
                        ]
                    },
                ),
                initial_capital=10_000.0,
            )

    def test_backtest_rejects_non_finite_strategy_presentation_values(self) -> None:
        frame = pd.DataFrame(
            {
                "Date": pd.date_range("2025-01-01", periods=2, freq="D"),
                "Close": [100.0, 101.0],
                "buy_signal": [False, False],
                "sell_signal": [False, False],
            }
        )

        with self.assertRaisesRegex(ValueError, "non-finite"):
            run_single_ticker_backtest(
                StrategySignalResult(
                    frame=frame,
                    buy_signal_column="buy_signal",
                    sell_signal_column="sell_signal",
                    presentation={"predictive_mean": [float("nan")]},
                ),
                initial_capital=10_000.0,
            )

    def test_win_rate_returns_none_when_trades_exist_without_valid_pairs(self) -> None:
        self.assertIsNone(_calculate_win_rate_pct([], [], total_trades=1))

    def test_win_rate_counts_buy_then_higher_sell_as_win(self) -> None:
        frame = pd.DataFrame(
            {
                "Date": pd.date_range("2025-01-01", periods=4, freq="D"),
                "Close": [100.0, 110.0, 105.0, 115.0],
                "buy_signal": [True, False, True, False],
                "sell_signal": [False, True, False, True],
            }
        )

        result = run_single_ticker_backtest(
            StrategySignalResult(
                frame=frame,
                buy_signal_column="buy_signal",
                sell_signal_column="sell_signal",
            ),
            initial_capital=10_000.0,
        )

        self.assertEqual(result["summary"]["total_trades"], 4)
        # 2 completed pairs, both wins → 2/2 = 100% win rate
        self.assertEqual(result["summary"]["win_rate_pct"], 100.0)
        for trade in result["trades"]:
            self.assertEqual(trade["quantity"], trade["shares"])
            self.assertEqual(trade["realized_pnl"], trade["pnl"])
            self.assertIn("unrealized_pnl", trade)
            self.assertAlmostEqual(trade["market_value"], trade["equity"] - trade["cash"])

    def test_transaction_dates_preserve_intraday_precision(self) -> None:
        frame = pd.DataFrame(
            {
                "Date": pd.to_datetime(["2026-08-19 09:40", "2026-08-19 10:40"]),
                "Open": [72.50, 72.60],
                "Close": [72.56, 72.70],
                "High": [72.60, 72.80],
                "Low": [72.40, 72.50],
                "buy_signal": [True, False],
                "sell_signal": [False, True],
            }
        )

        result = run_single_ticker_backtest(
            StrategySignalResult(
                frame=frame,
                buy_signal_column="buy_signal",
                sell_signal_column="sell_signal",
            ),
            initial_capital=10_000.0,
            interval="1m",
        )

        self.assertIn("09:40", result["trades"][0]["date"])

    def test_win_rate_counts_sell_then_lower_rebuy_as_win(self) -> None:
        frame = pd.DataFrame(
            {
                "Date": pd.date_range("2025-01-01", periods=4, freq="D"),
                "Close": [100.0, 120.0, 90.0, 95.0],
                "buy_signal": [True, False, True, False],
                "sell_signal": [False, True, False, False],
            }
        )

        result = run_single_ticker_backtest(
            StrategySignalResult(
                frame=frame,
                buy_signal_column="buy_signal",
                sell_signal_column="sell_signal",
            ),
            initial_capital=10_000.0,
        )

        # Original data: buy day 1, sell day 2 → 2 trades (pair completed), buy day 3 never closed → 3 total
        # Backtester is long-only, and we allow all executed trades → 3 total trades
        # One completed pair → 1/1 → 100% win rate
        self.assertEqual(result["summary"]["total_trades"], 3)
        self.assertEqual(result["summary"]["win_rate_pct"], 100.0)

    def test_win_rate_uses_pair_direction_not_just_realized_pnl(self) -> None:
        frame = pd.DataFrame(
            {
                "Date": pd.date_range("2025-01-01", periods=5, freq="D"),
                "Close": [100.0, 95.0, 105.0, 110.0, 108.0],
                "buy_signal": [True, False, True, False, False],
                "sell_signal": [False, True, False, True, False],
            }
        )

        result = run_single_ticker_backtest(
            StrategySignalResult(
                frame=frame,
                buy_signal_column="buy_signal",
                sell_signal_column="sell_signal",
            ),
            initial_capital=10_000.0,
        )

        # Two buy + two sell = 4 total trades
        # Consecutive pairing produces 3 pairs (Buy-Sell, Sell-Buy, Buy-Sell)
        # Only the first and third pairs are complete entry-exit → 1 win out of 3 completed pairs → 33.33% win rate
        self.assertEqual(result["summary"]["total_trades"], 4)
        self.assertAlmostEqual(result["summary"]["win_rate_pct"], 33.33, places=2)

    def test_win_rate_counts_open_buy_as_win_when_last_price_is_higher(self) -> None:
        frame = pd.DataFrame(
            {
                "Date": pd.date_range("2025-01-01", periods=5, freq="D"),
                "Close": [100.0, 110.0, 90.0, 95.0, 120.0],
                "buy_signal": [True, False, True, False, False],
                "sell_signal": [False, True, False, False, False],
            }
        )

        result = run_single_ticker_backtest(
            StrategySignalResult(
                frame=frame,
                buy_signal_column="buy_signal",
                sell_signal_column="sell_signal",
            ),
            initial_capital=10_000.0,
        )

        # One buy on day 1, one sell on day 2 → 2 total trades
        # The second buy on day 3 never gets closed → 3 total trades
        # Virtual close is not counted in total_trades → 3 total
        self.assertEqual(result["summary"]["total_trades"], 3)
        # One completed pair → it's a win → 1/1 = 100%
        self.assertEqual(result["summary"]["win_rate_pct"], 100.0)

    def test_backtest_surfaces_na_win_rate_when_pair_builder_returns_empty(self) -> None:
        frame = pd.DataFrame(
            {
                "Date": pd.date_range("2025-01-01", periods=3, freq="D"),
                "Close": [100.0, 110.0, 105.0],
                "buy_signal": [True, False, False],
                "sell_signal": [False, True, False],
            }
        )

        with patch("strategies.backtest._build_win_rate_trade_pairs", return_value=[]):
            result = run_single_ticker_backtest(
                StrategySignalResult(
                    frame=frame,
                    buy_signal_column="buy_signal",
                    sell_signal_column="sell_signal",
                ),
                initial_capital=10_000.0,
            )

        self.assertEqual(result["summary"]["total_trades"], 2)
        self.assertIsNone(result["summary"]["win_rate_pct"])

    def test_chart_markers_only_reflect_executed_trades_not_raw_signals(self) -> None:
        frame = pd.DataFrame(
            {
                "Date": pd.date_range("2025-01-01", periods=5, freq="D"),
                "Close": [100.0, 105.0, 110.0, 115.0, 120.0],
                "buy_signal": [True, True, True, False, False],
                "sell_signal": [False, False, False, True, True],
            }
        )

        result = run_single_ticker_backtest(
            StrategySignalResult(
                frame=frame,
                buy_signal_column="buy_signal",
                sell_signal_column="sell_signal",
            ),
            initial_capital=10_000.0,
        )

        self.assertEqual(result["chart"]["buy_markers"], [True, False, False, False, False])
        self.assertEqual(result["chart"]["sell_markers"], [False, False, False, True, False])

    def test_stop_loss_switch_blocks_loss_exit_but_keeps_position_open(self) -> None:
        frame = pd.DataFrame(
            {
                "Date": pd.date_range("2026-02-19", periods=3, freq="D"),
                "Open": [100.0, 90.0, 80.0],
                "Close": [100.0, 90.0, 80.0],
                "buy_signal": [True, False, False],
                "sell_signal": [False, True, False],
            }
        )

        result = run_single_ticker_backtest(
            StrategySignalResult(
                frame=frame,
                buy_signal_column="buy_signal",
                sell_signal_column="sell_signal",
            ),
            initial_capital=10_000.0,
            stop_loss_enabled=False,
        )

        self.assertEqual([trade["side"] for trade in result["trades"]], ["Buy"])
        self.assertEqual(result["summary"]["total_trades"], 1)

    def test_stop_loss_switch_does_not_block_profitable_exit(self) -> None:
        frame = pd.DataFrame(
            {
                "Date": pd.date_range("2026-02-19", periods=2, freq="D"),
                "Open": [100.0, 110.0],
                "Close": [100.0, 110.0],
                "buy_signal": [True, False],
                "sell_signal": [False, True],
            }
        )

        result = run_single_ticker_backtest(
            StrategySignalResult(
                frame=frame,
                buy_signal_column="buy_signal",
                sell_signal_column="sell_signal",
            ),
            initial_capital=10_000.0,
            stop_loss_enabled=False,
        )

        self.assertEqual([trade["side"] for trade in result["trades"]], ["Buy", "Sell"])
        self.assertEqual(result["summary"]["total_trades"], 2)

    def test_all_in_equity_uses_first_open_and_marks_each_close(self) -> None:
        frame = pd.DataFrame(
            {
                "Date": pd.date_range("2025-01-01", periods=2, freq="D"),
                "Open": [100.0, 110.0],
                "Close": [105.0, 120.0],
                "buy_signal": [False, False],
                "sell_signal": [False, False],
            }
        )

        result = run_single_ticker_backtest(
            StrategySignalResult(
                frame=frame,
                buy_signal_column="buy_signal",
                sell_signal_column="sell_signal",
            ),
            initial_capital=1_000.0,
        )

        self.assertEqual(result["chart"]["all_in_equity"], [1_050.0, 1_200.0])

    def test_missing_dividends_do_not_poison_intraday_equity_series(self) -> None:
        frame = pd.DataFrame(
            {
                "Date": pd.date_range("2026-02-20", periods=3, freq="min"),
                "Open": [100.0, 101.0, 102.0],
                "Close": [100.0, 101.0, 102.0],
                "Dividends": [0.0, float("nan"), float("nan")],
                "buy_signal": [True, False, False],
                "sell_signal": [False, False, False],
            }
        )

        result = run_single_ticker_backtest(
            StrategySignalResult(
                frame=frame,
                buy_signal_column="buy_signal",
                sell_signal_column="sell_signal",
            ),
            initial_capital=10_000.0,
            interval="1m",
        )

        self.assertEqual(result["chart"]["equity"], [10_000.0, 10_100.0, 10_200.0])
        self.assertEqual(result["chart"]["all_in_equity"], [10_000.0, 10_100.0, 10_200.0])
        self.assertEqual(result["summary"]["final_equity"], 10_200.0)

    def test_chart_raw_dates_and_trade_dates_stay_aligned(self) -> None:
        frame = pd.DataFrame(
            {
                "Date": pd.to_datetime(["2026-02-19", "2026-02-20", "2026-02-21"]),
                "Close": [100.0, 110.0, 108.0],
                "buy_signal": [False, True, False],
                "sell_signal": [False, False, True],
            }
        )

        result = run_single_ticker_backtest(
            StrategySignalResult(
                frame=frame,
                buy_signal_column="buy_signal",
                sell_signal_column="sell_signal",
            ),
            initial_capital=10_000.0,
        )

        self.assertEqual(result["trades"][0]["date"], "2026/02/20")
        self.assertEqual(result["chart"]["raw_dates"][1], "2026-02-20T00:00:00")
        self.assertTrue(result["chart"]["buy_markers"][1])
        self.assertEqual(result["chart"]["dates"][1], "20 Feb 2026")

    def test_intraday_chart_labels_preserve_time_component(self) -> None:
        frame = pd.DataFrame(
            {
                "Date": pd.to_datetime(["2026-02-20 09:30", "2026-02-20 09:31", "2026-02-20 09:32"]),
                "Open": [100.0, 101.0, 102.0],
                "High": [101.0, 102.0, 103.0],
                "Low": [99.5, 100.5, 101.5],
                "Close": [100.5, 101.5, 102.5],
                "buy_signal": [False, True, False],
                "sell_signal": [False, False, True],
            }
        )

        result = run_single_ticker_backtest(
            StrategySignalResult(
                frame=frame,
                buy_signal_column="buy_signal",
                sell_signal_column="sell_signal",
            ),
            initial_capital=10_000.0,
            interval="1m",
        )

        self.assertEqual(result["trades"][0]["date"], "2026/02/20 09:31")
        self.assertEqual(result["chart"]["raw_dates"][1], "2026-02-20T09:31:00")
        self.assertEqual(result["chart"]["dates"][1], "20 Feb 2026 09:31")

    def test_realized_long_and_short_metrics_only_accumulate_positive_pairs(self) -> None:
        frame = pd.DataFrame(
            {
                "Date": pd.to_datetime(
                    [
                        "2026-02-20 09:30",
                        "2026-02-20 09:31",
                        "2026-02-20 09:32",
                        "2026-02-20 09:33",
                        "2026-02-20 09:34",
                        "2026-02-20 09:35",
                        "2026-02-20 09:36",
                    ]
                ),
                "Open": [10.0, 10.0, 12.0, 12.0, 11.0, 10.0, 10.0],
                "Close": [10.0, 10.5, 12.0, 11.5, 11.0, 10.0, 10.0],
                "buy_signal": [True, False, False, False, True, False, False],
                "sell_signal": [False, False, True, False, False, True, False],
            }
        )

        result = run_single_ticker_backtest(
            StrategySignalResult(
                frame=frame,
                buy_signal_column="buy_signal",
                sell_signal_column="sell_signal",
            ),
            initial_capital=100.0,
            interval="1m",
        )

        self.assertEqual(result["summary"]["long_gain"], 20.0)
        self.assertEqual(result["summary"]["long_loss"], 10.0)
        self.assertEqual(result["summary"]["short_gain"], 10.0)

    def test_next_open_execution_uses_following_session_open_price(self) -> None:
        frame = pd.DataFrame(
            {
                "Date": pd.to_datetime(["2026-02-19", "2026-02-20", "2026-02-21", "2026-02-24"]),
                "Open": [100.0, 101.0, 112.0, 118.0],
                "Close": [100.0, 110.0, 115.0, 120.0],
                "buy_signal": [False, True, False, False],
                "sell_signal": [False, False, True, False],
            }
        )

        result = run_single_ticker_backtest(
            StrategySignalResult(
                frame=frame,
                buy_signal_column="buy_signal",
                sell_signal_column="sell_signal",
            ),
            initial_capital=10_000.0,
            execution_mode="next_open",
        )

        self.assertEqual(result["trades"][0]["date"], "2026/02/21")
        self.assertEqual(result["trades"][0]["price"], 112.0)
        self.assertEqual(result["trades"][1]["date"], "2026/02/24")
        self.assertEqual(result["trades"][1]["price"], 118.0)
        self.assertEqual(result["execution_mode"], "next_open")

    def test_strategy_required_execution_mode_overrides_global_signal_close(self) -> None:
        frame = pd.DataFrame(
            {
                "Date": pd.to_datetime(
                    ["2026-02-19", "2026-02-20", "2026-02-21"]
                ),
                "Open": [100.0, 105.0, 110.0],
                "Close": [102.0, 108.0, 112.0],
                "buy_signal": [True, False, False],
                "sell_signal": [False, True, False],
            }
        )

        result = run_single_ticker_backtest(
            StrategySignalResult(
                frame=frame,
                buy_signal_column="buy_signal",
                sell_signal_column="sell_signal",
                required_execution_mode="next_open",
            ),
            initial_capital=10_000.0,
            execution_mode="signal_close",
        )

        self.assertEqual(result["execution_mode"], "next_open")
        self.assertEqual(
            [(trade["date"], trade["price"]) for trade in result["trades"]],
            [("2026/02/20", 105.0), ("2026/02/21", 110.0)],
        )

    def test_signal_close_does_not_treat_later_signal_as_start_bar_trade(self) -> None:
        frame = pd.DataFrame(
            {
                "Date": pd.to_datetime(["2026-02-19", "2026-02-20", "2026-02-21"]),
                "Open": [100.0, 101.0, 102.0],
                "Close": [100.0, 110.0, 120.0],
                "buy_signal": [False, True, False],
                "sell_signal": [False, False, True],
            }
        )

        result = run_single_ticker_backtest(
            StrategySignalResult(
                frame=frame,
                buy_signal_column="buy_signal",
                sell_signal_column="sell_signal",
            ),
            initial_capital=10_000.0,
            execution_mode="signal_close",
        )

        self.assertEqual(result["trades"][0]["date"], "2026/02/20")
        self.assertEqual(result["trades"][0]["price"], 110.0)
        self.assertEqual(result["trades"][1]["date"], "2026/02/21")
        self.assertEqual(result["trades"][1]["price"], 120.0)
        self.assertEqual(result["execution_mode"], "signal_close")

    def test_next_open_initial_signal_executes_on_following_bar(self) -> None:
        frame = pd.DataFrame(
            {
                "Date": pd.to_datetime(["2026-02-19", "2026-02-20", "2026-02-21"]),
                "Open": [100.0, 105.0, 110.0],
                "Close": [102.0, 108.0, 112.0],
                "buy_signal": [True, False, False],
                "sell_signal": [False, True, False],
            }
        )

        result = run_single_ticker_backtest(
            StrategySignalResult(
                frame=frame,
                buy_signal_column="buy_signal",
                sell_signal_column="sell_signal",
            ),
            initial_capital=10_000.0,
            execution_mode="next_open",
        )

        self.assertEqual(result["trades"][0]["date"], "2026/02/20")
        self.assertEqual(result["trades"][0]["price"], 105.0)
        self.assertEqual(result["trades"][1]["date"], "2026/02/21")
        self.assertEqual(result["trades"][1]["price"], 110.0)


if __name__ == "__main__":
    unittest.main()
