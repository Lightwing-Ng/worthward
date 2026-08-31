"""Focused tests for the read-only Bayesian Longbridge factor provider.

Code version: v1.6.0
"""

from __future__ import annotations

from concurrent.futures import Future, ThreadPoolExecutor
from datetime import datetime, timezone
from threading import Event, Lock
import unittest
from unittest.mock import patch

from app.core.broker_settings import BrokerSettings
from app.services import bayesian_market_factors as factors


UTC = timezone.utc
FIXED_NOW = datetime(2026, 8, 29, 12, 0, tzinfo=UTC)


def _bar(timestamp: str, close: str = "10.0") -> dict[str, str]:
    return {
        "time": timestamp,
        "open": "9.0",
        "high": "11.0",
        "low": "8.0",
        "close": close,
        "volume": "1,000",
        "turnover": "10,000",
    }


class BayesianMarketFactorProviderTests(unittest.TestCase):
    def setUp(self) -> None:
        factors.clear_bayesian_factor_cache()
        factors._LAST_CLI_CALL_MONOTONIC = 0.0
        self.settings = BrokerSettings(
            selected_broker="longbridge",
            longbridge_auth_mode="cli_oauth",
        )

    def _provider_patches(self):
        return (
            patch.object(factors, "CLI_MIN_INTERVAL_SECONDS", 0.0),
            patch.object(factors, "_utc_now", return_value=FIXED_NOW),
        )

    @staticmethod
    def _ohlcv_fetch_result(
            _settings: BrokerSettings,
            _symbol: str,
            _start: object,
            _end: object,
    ) -> tuple[tuple[factors.OhlcvBar, ...], list[str]]:
        return (
            (
                factors.OhlcvBar(
                    observed_at=datetime(2026, 8, 28),
                    open=9.0,
                    high=11.0,
                    low=8.0,
                    close=10.0,
                    volume=1_000.0,
                    turnover=10_000.0,
                    source="longbridge-cli:kline-history:day",
                ),
            ),
            ["longbridge kline history AAPL.US"],
        )

    def test_chunks_daily_ohlcv_and_deduplicates_boundary_rows(self) -> None:
        kline_call_count = 0

        def fake_cli(settings, arguments, *, timeout_seconds):
            nonlocal kline_call_count
            self.assertIs(settings, self.settings)
            self.assertEqual(arguments[:2], ["kline", "history"])
            self.assertEqual(timeout_seconds, 45)
            kline_call_count += 1
            if kline_call_count == 1:
                return [
                    _bar("2024-01-02T21:00:00Z", "10.0"),
                    _bar("2024-12-30T21:00:00Z", "20.0"),
                ]
            return [
                _bar("2024-12-30T21:00:00Z", "21.0"),
                _bar("2025-01-02T21:00:00Z", "22.0"),
            ]

        interval_patch, now_patch = self._provider_patches()
        with (
            interval_patch,
            now_patch,
            patch.object(factors, "run_longbridge_cli_json", side_effect=fake_cli),
        ):
            bundle = factors.fetch_bayesian_factor_bundle(
                "aapl",
                "2024-01-01",
                "2025-01-02",
                settings=self.settings,
                include_pe=False,
                include_options=False,
                ttl_seconds=0,
            )

        self.assertEqual(kline_call_count, 2)
        self.assertEqual(bundle.symbol, "AAPL.US")
        self.assertEqual([bar.close for bar in bundle.ohlcv], [10.0, 21.0, 22.0])
        self.assertEqual(len(bundle.source_commands), 2)
        self.assertTrue(all("--adjust forward" in command for command in bundle.source_commands))
        self.assertEqual(
            bundle.factor_status,
            {
                "ohlcv": "available",
                "pe": "disabled",
                "dynamic_pe": "disabled",
                "options": "disabled",
            },
        )

    def test_drops_dash_and_non_finite_pe_values_without_fabricating_history(self) -> None:
        def fake_cli(settings, arguments, *, timeout_seconds):
            if arguments[:2] == ["kline", "history"]:
                return [_bar("2024-01-02T21:00:00Z")]
            self.assertEqual(arguments[:2], ["valuation", "AAPL.US"])
            return {
                "metrics": {
                    "pe": {
                        "list": [
                            {"timestamp": "2024-01-01T05:00:00Z", "value": "-"},
                            {"timestamp": "2024-01-02T05:00:00Z", "value": "17.25"},
                            {"timestamp": "2024-01-03T05:00:00Z", "value": "NaN"},
                        ]
                    }
                }
            }

        interval_patch, now_patch = self._provider_patches()
        with (
            interval_patch,
            now_patch,
            patch.object(factors, "run_longbridge_cli_json", side_effect=fake_cli),
        ):
            bundle = factors.fetch_bayesian_factor_bundle(
                "AAPL.US",
                "2024-01-01",
                "2024-01-03",
                settings=self.settings,
                include_options=False,
                ttl_seconds=0,
            )

        self.assertEqual(len(bundle.pe_history), 1)
        self.assertEqual(bundle.pe_history[0].value, 17.25)
        self.assertEqual(bundle.pe_history[0].source, "longbridge-cli:valuation-history:pe")
        self.assertEqual(bundle.factor_status["pe"], "available")

    def test_fetches_dynamic_pe_snapshot_only_on_its_availability_date(self) -> None:
        snapshot_now = datetime(2026, 8, 28, 20, 0, tzinfo=UTC)

        def fake_cli(settings, arguments, *, timeout_seconds):
            del settings
            self.assertEqual(timeout_seconds, 45)
            if arguments[:2] == ["kline", "history"]:
                return [_bar("2026-08-28T20:00:00Z")]
            self.assertEqual(
                arguments,
                [
                    "calc-index",
                    "AAPL.US",
                    "--fields",
                    "pe",
                    "--format",
                    "json",
                ],
            )
            return [{"symbol": "AAPL.US", "pe": "18.75"}]

        interval_patch, _now_patch = self._provider_patches()
        with (
            interval_patch,
            patch.object(factors, "_utc_now", return_value=snapshot_now),
            patch.object(factors, "run_longbridge_cli_json", side_effect=fake_cli),
        ):
            bundle = factors.fetch_bayesian_factor_bundle(
                "AAPL.US",
                "2026-08-01",
                "2026-08-28",
                settings=self.settings,
                include_pe=False,
                include_dynamic_pe=True,
                include_options=False,
                ttl_seconds=0,
            )

        self.assertEqual(len(bundle.dynamic_pe_history), 1)
        self.assertEqual(bundle.dynamic_pe_history[0].value, 18.75)
        self.assertEqual(
            bundle.dynamic_pe_history[0].observed_at,
            datetime(2026, 8, 28),
        )
        self.assertEqual(
            bundle.dynamic_pe_history[0].source,
            "longbridge-cli:calc-index:pe",
        )
        self.assertEqual(bundle.factor_status["dynamic_pe"], "available")
        self.assertTrue(
            any(
                "longbridge calc-index AAPL.US --fields pe" in command
                for command in bundle.source_commands
            )
        )

    def test_does_not_backfill_dynamic_pe_snapshot_into_an_earlier_window(self) -> None:
        snapshot_now = datetime(2026, 8, 28, 20, 0, tzinfo=UTC)

        def fake_cli(settings, arguments, *, timeout_seconds):
            del settings, timeout_seconds
            if arguments[:2] == ["kline", "history"]:
                return [_bar("2026-08-27T20:00:00Z")]
            self.assertEqual(arguments[:2], ["calc-index", "AAPL.US"])
            return [{"symbol": "AAPL.US", "pe": "18.75"}]

        interval_patch, _now_patch = self._provider_patches()
        with (
            interval_patch,
            patch.object(factors, "_utc_now", return_value=snapshot_now),
            patch.object(factors, "run_longbridge_cli_json", side_effect=fake_cli),
        ):
            bundle = factors.fetch_bayesian_factor_bundle(
                "AAPL.US",
                "2026-08-01",
                "2026-08-27",
                settings=self.settings,
                include_pe=False,
                include_dynamic_pe=True,
                include_options=False,
                ttl_seconds=0,
            )

        self.assertEqual(bundle.dynamic_pe_history, ())
        self.assertEqual(bundle.factor_status["dynamic_pe"], "missing")

    def test_reports_missing_option_history_without_inventing_neutral_ratios(self) -> None:
        def fake_cli(settings, arguments, *, timeout_seconds):
            if arguments[:2] == ["kline", "history"]:
                return [_bar("2026-08-28T20:00:00Z")]
            self.assertEqual(arguments[:3], ["option", "volume", "daily"])
            return {"stats": []}

        interval_patch, now_patch = self._provider_patches()
        with (
            interval_patch,
            now_patch,
            patch.object(factors, "run_longbridge_cli_json", side_effect=fake_cli),
        ):
            bundle = factors.fetch_bayesian_factor_bundle(
                "AAPL.US",
                "2026-08-28",
                "2026-08-29",
                settings=self.settings,
                include_pe=False,
                ttl_seconds=0,
            )

        self.assertEqual(bundle.option_history, ())
        self.assertEqual(bundle.factor_status["options"], "missing")

    def test_retries_both_rate_limit_codes_with_a_bounded_budget(self) -> None:
        attempts = 0

        def fake_cli(settings, arguments, *, timeout_seconds):
            nonlocal attempts
            attempts += 1
            if attempts == 1:
                raise RuntimeError("429002 request frequency exceeded")
            if attempts == 2:
                raise RuntimeError("429003 concurrent request exceeded")
            return [_bar("2026-08-28T20:00:00Z")]

        interval_patch, now_patch = self._provider_patches()
        with (
            interval_patch,
            now_patch,
            patch.object(factors, "run_longbridge_cli_json", side_effect=fake_cli),
            patch.object(factors.time, "sleep") as sleep_mock,
        ):
            bundle = factors.fetch_bayesian_factor_bundle(
                "AAPL.US",
                "2026-08-28",
                "2026-08-29",
                settings=self.settings,
                include_pe=False,
                include_options=False,
                ttl_seconds=0,
            )

        self.assertEqual(attempts, factors.CLI_MAX_ATTEMPTS)
        self.assertEqual(len(bundle.ohlcv), 1)
        self.assertEqual(
            [call.args[0] for call in sleep_mock.call_args_list],
            [factors.CLI_RETRY_BASE_SECONDS, factors.CLI_RETRY_BASE_SECONDS * 2],
        )

    def test_stops_after_the_rate_limit_retry_budget_is_exhausted(self) -> None:
        def fake_cli(settings, arguments, *, timeout_seconds):
            raise RuntimeError("429002 request frequency exceeded")

        interval_patch, now_patch = self._provider_patches()
        with (
            interval_patch,
            now_patch,
            patch.object(
                factors,
                "run_longbridge_cli_json",
                side_effect=fake_cli,
            ) as cli_mock,
            patch.object(factors.time, "sleep"),
        ):
            with self.assertRaisesRegex(RuntimeError, "429002"):
                factors.fetch_bayesian_factor_bundle(
                    "AAPL.US",
                    "2026-08-28",
                    "2026-08-29",
                    settings=self.settings,
                    include_pe=False,
                    include_options=False,
                    ttl_seconds=0,
                )

        self.assertEqual(cli_mock.call_count, factors.CLI_MAX_ATTEMPTS)

    def test_filters_every_factor_to_the_requested_observation_window(self) -> None:
        before = "2024-01-01T05:00:00Z"
        inside = "2024-01-02T05:00:00Z"
        after = "2024-01-04T05:00:00Z"

        def fake_cli(settings, arguments, *, timeout_seconds):
            if arguments[:2] == ["kline", "history"]:
                return [_bar(before), _bar(inside), _bar(after)]
            if arguments[0] == "valuation":
                return {
                    "metrics": {
                        "pe": {
                            "list": [
                                {"timestamp": before, "value": "10"},
                                {"timestamp": inside, "value": "11"},
                                {"timestamp": after, "value": "12"},
                            ]
                        }
                    }
                }
            return {
                "stats": [
                    {"timestamp": before, "put_call_volume_ratio": "0.9"},
                    {
                        "timestamp": inside,
                        "put_call_volume_ratio": "0.8",
                        "put_call_open_interest_ratio": "0.7",
                        "total_call_volume": "600",
                        "total_put_volume": "400",
                        "total_volume": "1,000",
                    },
                    {"timestamp": after, "put_call_volume_ratio": "0.6"},
                ]
            }

        interval_patch, now_patch = self._provider_patches()
        with (
            interval_patch,
            now_patch,
            patch.object(factors, "run_longbridge_cli_json", side_effect=fake_cli),
        ):
            bundle = factors.fetch_bayesian_factor_bundle(
                "AAPL.US",
                "2024-01-02",
                "2024-01-03",
                settings=self.settings,
                ttl_seconds=0,
            )

        self.assertEqual([row.observed_at.date().isoformat() for row in bundle.ohlcv], ["2024-01-02"])
        self.assertEqual(
            [row.observed_at.date().isoformat() for row in bundle.pe_history],
            ["2024-01-02"],
        )
        self.assertEqual(
            [row.observed_at.date().isoformat() for row in bundle.option_history],
            ["2024-01-02"],
        )
        self.assertEqual(bundle.option_history[0].total_volume, 1_000.0)
        self.assertEqual(bundle.fetched_at, FIXED_NOW)
        self.assertRegex(bundle.fingerprint, r"^[0-9a-f]{64}$")
        self.assertTrue(all(row.source.startswith("longbridge-cli:") for row in bundle.ohlcv))

    def test_normalizes_real_cli_timestamps_to_each_market_local_trading_day(self) -> None:
        market_timestamps = (
            ("AAPL.US", "2026-08-28T04:00:00Z"),
            ("700.HK", "2026-08-27T16:00:00Z"),
            ("600519.SH", "2026-08-27T16:00:00Z"),
            ("000001.SZ", "2026-08-27T16:00:00Z"),
            ("D05.SG", "2026-08-27T16:00:00Z"),
        )
        expected_trading_day = datetime(2026, 8, 28)

        for symbol, cli_timestamp in market_timestamps:
            with self.subTest(symbol=symbol):
                def fake_cli(settings, arguments, *, timeout_seconds):
                    del settings, timeout_seconds
                    if arguments[:2] == ["kline", "history"]:
                        return [_bar(cli_timestamp)]
                    if arguments[0] == "valuation":
                        return {
                            "metrics": {
                                "pe": {
                                    "list": [
                                        {"timestamp": cli_timestamp, "value": "17.25"},
                                    ]
                                }
                            }
                        }
                    self.assertEqual(arguments[:3], ["option", "volume", "daily"])
                    return {
                        "stats": [
                            {
                                "timestamp": cli_timestamp,
                                "put_call_volume_ratio": "0.8",
                            }
                        ]
                    }

                interval_patch, now_patch = self._provider_patches()
                with (
                    interval_patch,
                    now_patch,
                    patch.object(
                        factors,
                        "run_longbridge_cli_json",
                        side_effect=fake_cli,
                    ),
                ):
                    bundle = factors.fetch_bayesian_factor_bundle(
                        symbol,
                        "2026-08-28",
                        "2026-08-28",
                        settings=self.settings,
                        ttl_seconds=0,
                    )

                self.assertEqual(
                    [row.observed_at for row in bundle.ohlcv],
                    [expected_trading_day],
                )
                self.assertEqual(
                    [row.observed_at for row in bundle.pe_history],
                    [expected_trading_day],
                )
                self.assertTrue(
                    all(row.observed_at.tzinfo is None for row in bundle.ohlcv)
                )
                self.assertTrue(
                    all(row.observed_at.tzinfo is None for row in bundle.pe_history)
                )
                if symbol.endswith(".US"):
                    self.assertEqual(
                        [row.observed_at for row in bundle.option_history],
                        [expected_trading_day],
                    )
                    self.assertIsNone(bundle.option_history[0].observed_at.tzinfo)
                else:
                    self.assertEqual(bundle.option_history, ())
                    self.assertEqual(
                        bundle.factor_status["options"],
                        "unsupported_market",
                    )

    def test_ttl_cache_and_disabled_factors_avoid_redundant_cli_calls(self) -> None:
        interval_patch, now_patch = self._provider_patches()
        with (
            interval_patch,
            now_patch,
            patch.object(
                factors,
                "run_longbridge_cli_json",
                return_value=[_bar("2026-08-28T20:00:00Z")],
            ) as cli_mock,
        ):
            first = factors.fetch_bayesian_factor_bundle(
                "AAPL.US",
                "2026-08-28",
                "2026-08-29",
                settings=self.settings,
                include_pe=False,
                include_options=False,
            )
            second = factors.fetch_bayesian_factor_bundle(
                "AAPL.US",
                "2026-08-28",
                "2026-08-29",
                settings=self.settings,
                include_pe=False,
                include_options=False,
            )

        self.assertIs(first, second)
        self.assertEqual(cli_mock.call_count, 1)
        self.assertEqual(first.factor_status["pe"], "disabled")
        self.assertEqual(first.factor_status["options"], "disabled")
        self.assertNotIn("trade-stats", " ".join(first.source_commands))

    def test_opt_in_research_factors_are_date_filtered_and_selective(self) -> None:
        commands: list[tuple[str, ...]] = []

        def fake_cli(settings, arguments, *, timeout_seconds):
            del settings, timeout_seconds
            commands.append(tuple(arguments))
            if arguments[:2] == ["kline", "history"]:
                return [_bar("2026-08-27T20:00:00Z"), _bar("2026-08-28T20:00:00Z")]
            if arguments[0] == "valuation":
                return {
                    "metrics": {
                        "pb": {
                            "list": [
                                {"timestamp": "2026-08-27T04:00:00Z", "pb": "2.1"},
                                {"timestamp": "2026-08-30T04:00:00Z", "pb": "9.9"},
                            ]
                        }
                    }
                }
            raise AssertionError(f"Unexpected command: {arguments}")

        interval_patch, now_patch = self._provider_patches()
        with (
            interval_patch,
            now_patch,
            patch.object(factors, "run_longbridge_cli_json", side_effect=fake_cli),
        ):
            bundle = factors.fetch_bayesian_factor_bundle(
                "AAPL.US",
                "2026-08-27",
                "2026-08-29",
                settings=self.settings,
                include_pe=False,
                include_options=False,
                research_factors=("pb_ratio",),
                ttl_seconds=0,
            )

        self.assertEqual(
            [(row.factor, row.value, row.observed_at.date().isoformat()) for row in bundle.research_history],
            [("pb_ratio", 2.1, "2026-08-27")],
        )
        self.assertEqual(bundle.factor_status["pb_ratio"], "available")
        self.assertIn("valuation", " ".join(bundle.source_commands))
        self.assertEqual(len(commands), 2)

    def test_research_period_metadata_cannot_be_used_as_availability(self) -> None:
        period_only = {
            "report_period": "2026-08-28",
            "period": "2026-08-28",
            "end_date": "2026-08-28",
            "period_end": "2026-08-28",
            "date": "2026-08-28",
            "value": "2.0",
        }
        self.assertIsNone(factors._research_timestamp(period_only))
        self.assertEqual(
            factors._research_observations(
                [period_only],
                symbol="NVDA.US",
                start=datetime(2026, 8, 1).date(),
                end=datetime(2026, 8, 31).date(),
                factor="pb_ratio",
                source="test",
            ),
            (),
        )

    def test_research_observation_requires_publication_not_filing_period_date(self) -> None:
        row = {
            "report_period": "2026-06-30",
            "period": "2026-06-30",
            "filing_date": "2026-08-15T13:00:00Z",
            "pb": "2.0",
        }
        timestamp = factors._research_timestamp(row)
        self.assertIsNone(timestamp)
        self.assertEqual(
            factors._research_observations(
                [row],
                symbol="NVDA.US",
                start=datetime(2026, 8, 1).date(),
                end=datetime(2026, 8, 31).date(),
                factor="pb_ratio",
                source="test",
            ),
            (),
        )

        publication_row = {
            **row,
            "published_at": "2026.08.15T13:00:00Z",
        }
        timestamp = factors._research_timestamp(publication_row)
        self.assertIsNotNone(timestamp)
        self.assertEqual(timestamp.date().isoformat(), "2026-08-15")
        observations = factors._research_observations(
            [publication_row],
            symbol="NVDA.US",
            start=datetime(2026, 8, 1).date(),
            end=datetime(2026, 8, 31).date(),
            factor="pb_ratio",
            source="test",
        )
        self.assertEqual(len(observations), 1)
        self.assertEqual(observations[0].observed_at.date().isoformat(), "2026-08-15")

    def test_report_date_only_rows_are_excluded_from_research_history(self) -> None:
        self.assertIsNone(factors._research_timestamp({"report_date": "2026-06-30"}))

    def test_shareholder_concentration_uses_disclosure_time_and_aggregates_unique_holders(self) -> None:
        observations = factors._research_observations(
            {
                "info": [
                    {
                        "period": "Q2 2026",
                        "share_holders": [
                            {
                                "published_at": "2026/08/15",
                                "object_id": "one",
                                "percent_shares_held": "8.04%",
                            },
                            {
                                "published_at": "2026/08/15",
                                "object_id": "two",
                                "percent_shares_held": "6.95%",
                            },
                            # The CLI may repeat the same holder under a
                            # current "Latest" group. It must not double the
                            # concentration feature.
                            {
                                "published_at": "2026/08/15",
                                "object_id": "one",
                                "percent_shares_held": "8.04%",
                            }
                        ],
                    }
                ]
            },
            symbol="NVDA.US",
            start=datetime(2026, 8, 1).date(),
            end=datetime(2026, 8, 31).date(),
            factor="shareholder_concentration",
            source="test",
        )
        self.assertEqual(len(observations), 1)
        self.assertAlmostEqual(observations[0].value, 14.99)

    def test_non_point_in_time_research_sources_are_not_requested_or_backfilled(self) -> None:
        commands: list[tuple[str, ...]] = []

        def fake_cli(settings, arguments, *, timeout_seconds):
            del settings, timeout_seconds
            commands.append(tuple(arguments))
            self.assertEqual(arguments[:2], ["kline", "history"])
            return [_bar("2026-08-27T20:00:00Z"), _bar("2026-08-28T20:00:00Z")]

        interval_patch, now_patch = self._provider_patches()
        with (
            interval_patch,
            now_patch,
            patch.object(factors, "run_longbridge_cli_json", side_effect=fake_cli),
        ):
            bundle = factors.fetch_bayesian_factor_bundle(
                "NVDA.US",
                "2026-08-27",
                "2026-08-29",
                settings=self.settings,
                include_pe=False,
                include_options=False,
                research_factors=(
                    "capital_flow",
                    "shareholder_concentration",
                    "fund_holder_weight",
                    "short_interest",
                    "short_volume",
                    "broker_holding",
                ),
                ttl_seconds=0,
            )

        self.assertEqual(len(commands), 1)
        self.assertEqual(commands[0][:5], ("kline", "history", "NVDA.US", "--period", "day"))
        self.assertIn("--adjust", commands[0])
        self.assertIn("forward", commands[0])
        self.assertEqual(bundle.research_history, ())
        self.assertEqual(bundle.factor_status["capital_flow"], "unsupported_history")
        self.assertEqual(bundle.factor_status["broker_holding"], "unsupported_market")
        for factor in (
            "shareholder_concentration",
            "fund_holder_weight",
            "short_interest",
            "short_volume",
        ):
            self.assertEqual(bundle.factor_status[factor], "unavailable_point_in_time")

    def test_a_shorter_call_level_ttl_cannot_reuse_a_longer_ttl_entry(self) -> None:
        with (
            patch.object(factors, "_utc_now", return_value=FIXED_NOW),
            patch.object(
                factors,
                "_fetch_ohlcv",
                side_effect=self._ohlcv_fetch_result,
            ) as fetch_mock,
            patch.object(factors.time, "monotonic", side_effect=[100.0, 100.0, 102.0, 102.0]),
        ):
            long_ttl_bundle = factors.fetch_bayesian_factor_bundle(
                "AAPL.US",
                "2026-08-28",
                "2026-08-29",
                settings=self.settings,
                include_pe=False,
                include_options=False,
                ttl_seconds=60.0,
            )
            short_ttl_bundle = factors.fetch_bayesian_factor_bundle(
                "AAPL.US",
                "2026-08-28",
                "2026-08-29",
                settings=self.settings,
                include_pe=False,
                include_options=False,
                ttl_seconds=1.0,
            )

        self.assertEqual(fetch_mock.call_count, 2)
        self.assertIsNot(long_ttl_bundle, short_ttl_bundle)

    def test_cached_factor_status_is_immutable(self) -> None:
        with (
            patch.object(factors, "_utc_now", return_value=FIXED_NOW),
            patch.object(
                factors,
                "_fetch_ohlcv",
                side_effect=self._ohlcv_fetch_result,
            ),
        ):
            first = factors.fetch_bayesian_factor_bundle(
                "AAPL.US",
                "2026-08-28",
                "2026-08-29",
                settings=self.settings,
                include_pe=False,
                include_options=False,
            )
            second = factors.fetch_bayesian_factor_bundle(
                "AAPL.US",
                "2026-08-28",
                "2026-08-29",
                settings=self.settings,
                include_pe=False,
                include_options=False,
            )

        self.assertIs(first, second)
        with self.assertRaises(TypeError):
            first.factor_status["pe"] = "available"  # type: ignore[index]
        self.assertEqual(second.factor_status["pe"], "disabled")

    def test_cache_prunes_expired_entries_on_the_next_access(self) -> None:
        with (
            patch.object(factors, "_utc_now", return_value=FIXED_NOW),
            patch.object(
                factors,
                "_fetch_ohlcv",
                side_effect=self._ohlcv_fetch_result,
            ),
            patch.object(factors.time, "monotonic", return_value=100.0) as monotonic,
        ):
            factors.fetch_bayesian_factor_bundle(
                "AAPL.US",
                "2026-08-28",
                "2026-08-29",
                settings=self.settings,
                include_pe=False,
                include_options=False,
                ttl_seconds=1.0,
            )
            monotonic.return_value = 102.0
            factors.fetch_bayesian_factor_bundle(
                "MSFT.US",
                "2026-08-28",
                "2026-08-29",
                settings=self.settings,
                include_pe=False,
                include_options=False,
                ttl_seconds=60.0,
            )

        self.assertEqual(len(factors._BUNDLE_CACHE), 1)
        self.assertEqual(next(iter(factors._BUNDLE_CACHE))[0], "MSFT.US")

    def test_cache_is_bounded_and_evicts_the_least_recently_used_bundle(self) -> None:
        with (
            patch.object(factors, "_utc_now", return_value=FIXED_NOW),
            patch.object(
                factors,
                "_fetch_ohlcv",
                side_effect=self._ohlcv_fetch_result,
            ) as fetch_mock,
        ):
            for index in range(factors.BUNDLE_CACHE_MAX_ENTRIES):
                factors.fetch_bayesian_factor_bundle(
                    f"S{index:03d}.US",
                    "2026-08-28",
                    "2026-08-29",
                    settings=self.settings,
                    include_pe=False,
                    include_options=False,
                )
            factors.fetch_bayesian_factor_bundle(
                "S000.US",
                "2026-08-28",
                "2026-08-29",
                settings=self.settings,
                include_pe=False,
                include_options=False,
            )
            factors.fetch_bayesian_factor_bundle(
                "S999.US",
                "2026-08-28",
                "2026-08-29",
                settings=self.settings,
                include_pe=False,
                include_options=False,
            )

        cached_symbols = {str(cache_key[0]) for cache_key in factors._BUNDLE_CACHE}
        self.assertEqual(len(factors._BUNDLE_CACHE), factors.BUNDLE_CACHE_MAX_ENTRIES)
        self.assertEqual(fetch_mock.call_count, factors.BUNDLE_CACHE_MAX_ENTRIES + 1)
        self.assertIn("S000.US", cached_symbols)
        self.assertNotIn("S001.US", cached_symbols)
        self.assertIn("S999.US", cached_symbols)

    def test_concurrent_same_key_cache_miss_uses_one_provider_flight(self) -> None:
        fetch_started = Event()
        release_fetch = Event()
        waiter_started = Event()
        count_lock = Lock()
        fetch_count = 0

        class ObservedFuture(Future):
            def result(self, timeout=None):
                waiter_started.set()
                return super().result(timeout=timeout)

        def blocking_fetch(*args, **kwargs):
            nonlocal fetch_count
            del args, kwargs
            with count_lock:
                fetch_count += 1
            fetch_started.set()
            self.assertTrue(release_fetch.wait(timeout=2.0))
            return self._ohlcv_fetch_result(self.settings, "AAPL.US", None, None)

        def fetch_bundle() -> factors.BayesianFactorBundle:
            return factors.fetch_bayesian_factor_bundle(
                "AAPL.US",
                "2026-08-28",
                "2026-08-29",
                settings=self.settings,
                include_pe=False,
                include_options=False,
            )

        with (
            patch.object(factors, "_utc_now", return_value=FIXED_NOW),
            patch.object(factors, "_fetch_ohlcv", side_effect=blocking_fetch),
            patch.object(factors, "Future", ObservedFuture),
            ThreadPoolExecutor(max_workers=2) as executor,
        ):
            first_future = executor.submit(fetch_bundle)
            self.assertTrue(fetch_started.wait(timeout=2.0))
            second_future = executor.submit(fetch_bundle)
            self.assertTrue(waiter_started.wait(timeout=2.0))
            release_fetch.set()
            first = first_future.result(timeout=2.0)
            second = second_future.result(timeout=2.0)

        self.assertEqual(fetch_count, 1)
        self.assertIs(first, second)
        self.assertEqual(factors._BUNDLE_IN_FLIGHT, {})

    def test_non_us_symbols_do_not_request_unsupported_option_history(self) -> None:
        interval_patch, now_patch = self._provider_patches()
        with (
            interval_patch,
            now_patch,
            patch.object(
                factors,
                "run_longbridge_cli_json",
                return_value=[_bar("2026-08-28T08:00:00Z")],
            ) as cli_mock,
        ):
            bundle = factors.fetch_bayesian_factor_bundle(
                "700.HK",
                "2026-08-28",
                "2026-08-29",
                settings=self.settings,
                include_pe=False,
                ttl_seconds=0,
            )

        self.assertEqual(cli_mock.call_count, 1)
        self.assertEqual(bundle.factor_status["options"], "unsupported_market")


if __name__ == "__main__":
    unittest.main()
