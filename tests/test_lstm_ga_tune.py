"""Tests for the durable LSTM GA runner. Code version: v1.0.2."""

from __future__ import annotations

from datetime import date, datetime, timezone
import unittest

import numpy as np

from app.services.price_field_market_factors import (
    PriceFieldMarketFactorBundle,
    OhlcvBar,
    OptionVolumeObservation,
    PeObservation,
)
from scripts import lstm_ga_tune as ga


class LstmGaTuneTests(unittest.TestCase):
    def test_bundle_payload_round_trips_dataclass_records(self) -> None:
        observed_at = datetime(2026, 1, 2, tzinfo=timezone.utc)
        bundle = PriceFieldMarketFactorBundle(
            symbol="NVDA.US",
            start=date(2026, 1, 2),
            end=date(2026, 1, 2),
            ohlcv=(OhlcvBar(
                observed_at=observed_at,
                open=100.0,
                high=101.0,
                low=99.0,
                close=100.5,
                volume=1_000.0,
                turnover=100_500.0,
                source="test",
            ),),
            pe_history=(PeObservation(
                observed_at=observed_at,
                value=30.0,
                source="test",
            ),),
            option_history=(OptionVolumeObservation(
                observed_at=observed_at,
                put_call_volume_ratio=0.8,
                put_call_open_interest_ratio=0.7,
                call_volume=100.0,
                put_volume=80.0,
                total_volume=180.0,
                call_open_interest=200.0,
                put_open_interest=140.0,
                total_open_interest=340.0,
                source="test",
            ),),
            fetched_at=observed_at,
            fingerprint="bundle-test",
            factor_status={
                "ohlcv": "available",
                "pe": "available",
                "options": "available",
            },
            source_commands=("test command",),
        )

        payload = ga._bundle_payload(bundle)
        frame = ga._bundle_ohlcv_frame(payload)
        merged = ga._merge_bundle_observations(frame, payload)

        self.assertEqual(payload["ohlcv"][0]["open"], 100.0)
        self.assertEqual(payload["pe_history"][0]["value"], 30.0)
        self.assertEqual(payload["option_history"][0]["put_volume"], 80.0)
        self.assertEqual(float(merged.iloc[0]["bayesian_pe_ratio"]), 30.0)
        self.assertEqual(
            float(merged.iloc[0]["bayesian_option_put_call_ratio"]),
            0.75,
        )

    def test_score_slice_excludes_flat_and_neutral_directional_decisions(self) -> None:
        score = ga._score_slice(
            np.array([100.0, 101.0, 102.0, 101.0, 101.0]),
            np.zeros(5),
            np.ones(5),
            np.array([0.6, 0.4, 0.5, 0.6, 0.6]),
            0,
            5,
        )

        self.assertEqual(score["direction_hits"], 2)
        self.assertEqual(score["direction_scored_points"], 2)
        self.assertEqual(score["eligible_direction_points"], 2)
        self.assertEqual(score["coverage_pct"], 100.0)
        self.assertEqual(score["valid_prediction_points"], 3)

    def test_canonical_params_lock_unavailable_factors_and_fixed_controls(self) -> None:
        strategy = ga.LSTMPriceFieldStrategy()
        base = ga._base_params(strategy)
        bounds = {
            "training_window": (30, 100),
            "chip_window": (5, 100),
            "lstm_lookback": (4, 16),
            "lstm_hidden_size": (4, 32),
            "lstm_epochs": (1, 20),
            "lstm_learning_rate": (0.001, 0.5),
        }
        params = ga._canonical_params(
            {
                "use_options": True,
                "entry_probability": 95.0,
                "compute_backend": "GPU",
                "lstm_learning_rate": 0.1234,
            },
            base,
            ("volume",),
            bounds,
        )

        self.assertFalse(params["use_options"])
        self.assertEqual(params["cell_display_threshold"], 5.0)
        self.assertEqual(params["entry_probability"], 60.0)
        self.assertEqual(params["compute_backend"], "CPU")
        self.assertEqual(params["lstm_learning_rate"], 0.123)

    def test_canonical_params_preserve_explicit_gpu_baseline(self) -> None:
        strategy = ga.LSTMPriceFieldStrategy()
        base = ga._base_params(strategy, {"compute_backend": "GPU"})
        bounds = {
            "training_window": (30, 100),
            "chip_window": (5, 100),
            "lstm_lookback": (4, 16),
            "lstm_hidden_size": (4, 32),
            "lstm_epochs": (1, 20),
            "lstm_learning_rate": (0.001, 0.5),
        }

        params = ga._canonical_params(
            {},
            base,
            ("volume",),
            bounds,
        )

        self.assertEqual(params["compute_backend"], "GPU")

    def test_canonical_params_preserve_presentation_threshold_baseline(self) -> None:
        strategy = ga.LSTMPriceFieldStrategy()
        base = ga._base_params(strategy, {"cell_display_threshold": 2.0})
        bounds = {
            "training_window": (30, 100),
            "chip_window": (5, 100),
            "lstm_lookback": (4, 16),
            "lstm_hidden_size": (4, 32),
            "lstm_epochs": (1, 20),
            "lstm_learning_rate": (0.001, 0.5),
        }

        params = ga._canonical_params(
            {},
            base,
            ("volume",),
            bounds,
        )

        self.assertEqual(params["cell_display_threshold"], 2.0)

    def test_fitness_requires_all_validation_folds_and_holdout_coverage(self) -> None:
        result = {
            "validation_folds": {
                f"validation-{index}": {
                    "direction_hit_rate_pct": 54.0 + index,
                    "direction_scored_points": 25,
                    "coverage_pct": 100.0,
                    "probability_score_pct": 65.0,
                }
                for index in range(1, 4)
            },
            "holdout": {
                "direction_hit_rate_pct": 58.0,
                "direction_scored_points": 25,
                "coverage_pct": 100.0,
            },
        }

        fitness = ga._fitness_fields(result)

        self.assertTrue(fitness["feasible"])
        self.assertGreater(fitness["fitness"], 0.0)
        self.assertEqual(fitness["validation_min_coverage_pct"], 100.0)


if __name__ == "__main__":
    unittest.main()
