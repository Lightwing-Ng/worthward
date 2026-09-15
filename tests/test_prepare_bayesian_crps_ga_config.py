"""Tests for Bayesian CRPS GA configuration preparation. Code version: v1.2.0."""

from __future__ import annotations

import base64
from datetime import date, datetime, timezone
import gzip
import hashlib
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from scripts import bayesian_crps_ga_job as job
from scripts import prepare_bayesian_crps_ga_config as prepare


BACKTEST_URL = (
    "http://localhost:8688/workspaces/backtest?ticker=QQQ&range=5y"
    "&strategy=bayesian-price-field&cell_display_threshold=2.50"
    "&training_window=30&chip_window=41&prior_strength=1.51"
    "&use_illiquidity_20d=1&use_close_location=0"
    "&use_intraday_return=0&use_volume=1&use_volume_change=0"
    "&use_option_call_volume=1&use_options=1"
    "&use_option_put_call_open_interest_ratio=1"
    "&use_option_put_call_volume_ratio=1"
)


def _bundle(*, option_status: str = "available", option_history=None):
    resolved_option_history = (
        [
            {
                "observed_at": "2026-09-10T00:00:00-04:00",
                "put_call_volume_ratio": 0.8,
                "put_call_open_interest_ratio": 0.9,
                "call_volume": 1_200.0,
                "put_volume": 960.0,
                "total_volume": 2_160.0,
                "call_open_interest": 2_000.0,
                "put_open_interest": 1_800.0,
                "total_open_interest": 3_800.0,
                "source": "mock-longbridge",
            }
        ]
        if option_history is None
        else option_history
    )
    return {
        "symbol": "QQQ.US",
        "start": date(2020, 4, 1),
        "end": date(2026, 9, 14),
        "ohlcv": [
            {
                "observed_at": "2020-04-01T00:00:00-04:00",
                "open": 100.0,
                "high": 101.0,
                "low": 99.0,
                "close": 100.5,
                "volume": 10_000.0,
                "turnover": 1_005_000.0,
                "source": "mock-longbridge",
            },
            {
                "observed_at": "2026-09-11T00:00:00-04:00",
                "open": 600.0,
                "high": 606.0,
                "low": 594.0,
                "close": 602.0,
                "volume": 20_000.0,
                "turnover": 12_040_000.0,
                "source": "mock-longbridge",
            },
        ],
        "pe_history": [],
        "dynamic_pe_history": [],
        "option_history": resolved_option_history,
        "research_history": [],
        "fetched_at": datetime(2026, 9, 14, 12, tzinfo=timezone.utc),
        "fingerprint": "mock-bundle-fingerprint",
        "factor_status": {
            "ohlcv": "available",
            "pe": "disabled",
            "options": option_status,
        },
        "source_commands": ["longbridge option QQQ.US --volume-history"],
    }


class PrepareBayesianCrpsGaConfigTests(unittest.TestCase):
    def test_maps_the_complete_url_and_requests_maximum_warmup(self) -> None:
        prepared_at = datetime(2026, 9, 14, 12, tzinfo=timezone.utc)
        with patch.object(
            prepare,
            "load_price_field_market_bundle",
            return_value=_bundle(),
        ) as loader:
            config = prepare.build_config(
                BACKTEST_URL,
                as_of=date(2026, 9, 14),
                prepared_at=prepared_at,
            )

        loader.assert_called_once()
        args, kwargs = loader.call_args
        self.assertEqual(args, (("QQQ",),))
        self.assertEqual(kwargs["interval"], "1d")
        self.assertEqual(kwargs["start"], date(2021, 9, 14))
        self.assertEqual(kwargs["end"], date(2026, 9, 14))
        self.assertEqual(kwargs["params"]["training_window"], 504)
        self.assertEqual(kwargs["params"]["chip_window"], 252)

        self.assertEqual(config["request"]["ticker"], "QQQ")
        self.assertEqual(config["request"]["provider_symbol"], "QQQ.US")
        self.assertEqual(config["request"]["query_params"], {
            "cell_display_threshold": "2.50",
            "chip_window": "41",
            "prior_strength": "1.51",
            "range": "5y",
            "strategy": "bayesian-price-field",
            "ticker": "QQQ",
            "training_window": "30",
            "use_close_location": "0",
            "use_illiquidity_20d": "1",
            "use_intraday_return": "0",
            "use_option_call_volume": "1",
            "use_option_put_call_open_interest_ratio": "1",
            "use_option_put_call_volume_ratio": "1",
            "use_options": "1",
            "use_volume": "1",
            "use_volume_change": "0",
        })
        baseline = config["baseline_params"]
        self.assertEqual(baseline["cell_display_threshold"], 2.5)
        self.assertEqual(baseline["training_window"], 30)
        self.assertEqual(baseline["chip_window"], 41)
        self.assertEqual(baseline["prior_strength"], 1.51)
        self.assertTrue(baseline["use_illiquidity_20d"])
        self.assertFalse(baseline["use_close_location"])
        self.assertFalse(baseline["use_intraday_return"])
        self.assertTrue(baseline["use_volume"])
        self.assertFalse(baseline["use_volume_change"])
        self.assertTrue(baseline["use_option_call_volume"])
        self.assertTrue(baseline["use_options"])
        self.assertTrue(baseline["use_option_put_call_open_interest_ratio"])
        self.assertTrue(baseline["use_option_put_call_volume_ratio"])
        self.assertEqual(config["range"]["start"], "2021-09-11")
        self.assertEqual(config["range"]["end"], "2026-09-11")
        self.assertEqual(
            config["optimizer"]["factor_parameters"],
            list(prepare.FACTOR_PARAMETERS),
        )
        self.assertEqual(
            config["optimizer"]["numeric_domains"],
            prepare.NUMERIC_DOMAINS,
        )

    def test_rejects_unavailable_or_empty_requested_options(self) -> None:
        failures = (
            (_bundle(option_status="missing"), "options status: missing"),
            (_bundle(option_history=[]), "options status: available"),
        )
        for bundle, message in failures:
            with self.subTest(message=message), patch.object(
                prepare,
                "load_price_field_market_bundle",
                return_value=bundle,
            ):
                with self.assertRaisesRegex(ValueError, message):
                    prepare.build_config(
                        BACKTEST_URL,
                        as_of=date(2026, 9, 14),
                    )

    def test_snapshot_hash_round_trip_size_and_atomic_output(self) -> None:
        with patch.object(
            prepare,
            "load_price_field_market_bundle",
            return_value=_bundle(),
        ):
            config = prepare.build_config(
                BACKTEST_URL,
                as_of=date(2026, 9, 14),
                prepared_at=datetime(2026, 9, 14, 12, tzinfo=timezone.utc),
            )

        snapshot = config["snapshot"]
        decoded = gzip.decompress(base64.b64decode(snapshot["data"]))
        self.assertEqual(hashlib.sha256(decoded).hexdigest(), snapshot["sha256"])
        self.assertEqual(len(decoded), snapshot["uncompressed_bytes"])
        self.assertEqual(
            json.dumps(
                json.loads(decoded),
                ensure_ascii=True,
                sort_keys=True,
                separators=(",", ":"),
                allow_nan=False,
            ).encode("utf-8"),
            decoded,
        )
        decoded_payload = json.loads(decoded)
        self.assertEqual(decoded_payload["symbol"], "QQQ.US")
        self.assertEqual(decoded_payload["factor_status"]["options"], "available")
        self.assertEqual(decoded_payload["option_history"][0]["call_volume"], 1_200.0)
        self.assertLess(
            len(prepare._canonical_json_bytes(config)) + 1,
            prepare.MAX_CONFIG_BYTES,
        )
        for path, digest in config["optimizer"]["source_sha256"].items():
            self.assertEqual(
                hashlib.sha256((prepare.PROJECT_ROOT / path).read_bytes()).hexdigest(),
                digest,
            )
        self.assertIn(
            "app/infrastructure/parallel.py",
            config["optimizer"]["source_sha256"],
        )
        self.assertIn(
            "strategies/base.py",
            config["optimizer"]["source_sha256"],
        )

        with TemporaryDirectory() as directory:
            workspace = Path(directory)
            output = workspace / "outputs" / "nested" / "ga-config.json"
            with patch.object(prepare, "PROJECT_ROOT", workspace):
                written = prepare.write_config(output, config)
            self.assertEqual(written, output.stat().st_size)
            self.assertEqual(json.loads(output.read_text()), config)
            self.assertFalse(any(output.parent.glob(".*.tmp")))

    def test_prepared_config_round_trips_through_the_approved_runner(self) -> None:
        with patch.object(
            prepare,
            "load_price_field_market_bundle",
            return_value=_bundle(),
        ):
            config = prepare.build_config(
                BACKTEST_URL,
                as_of=date(2026, 9, 14),
                prepared_at=datetime(2026, 9, 14, 12, tzinfo=timezone.utc),
            )

        with TemporaryDirectory() as directory:
            workspace = Path(directory)
            config_path = workspace / "outputs" / "ga-config.json"
            with patch.object(prepare, "PROJECT_ROOT", workspace):
                prepare.write_config(config_path, config)
            loaded = job.load_config(
                config_path,
                prepare.PROJECT_ROOT,
                prepare.PROJECT_ROOT / "scripts/bayesian_crps_ga_job.py",
            )

        loaded_config, _, snapshot, snapshot_sha256, spec, source_hashes = loaded
        self.assertEqual(loaded_config, config)
        self.assertEqual(snapshot["kind"], prepare.SNAPSHOT_KIND)
        self.assertEqual(snapshot["symbol"], "QQQ.US")
        self.assertEqual(snapshot["visible_start"], config["range"]["start"])
        self.assertEqual(snapshot["visible_end"], config["range"]["end"])
        self.assertEqual(snapshot_sha256, config["snapshot"]["sha256"])
        self.assertEqual(spec.search_duration_seconds, 37_800)
        self.assertTrue(job.REQUIRED_RUNTIME_SOURCE_PATHS.issubset(source_hashes))


if __name__ == "__main__":
    unittest.main()
