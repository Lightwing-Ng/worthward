"""LSTM compute backend and causality tests. Code version: v1.0.0."""

from __future__ import annotations

import math
import unittest
from unittest.mock import patch

import numpy as np

from strategies.lstm_compute import (
    LstmBackend,
    detect_lstm_capabilities,
    lagged_close_return,
    probe_neural_engine,
    probe_torch_device,
    resolve_lstm_backend,
    walk_forward_lstm_predictions,
)


class LstmComputeTests(unittest.TestCase):
    def test_missing_optional_modules_fail_closed_without_crashing(self) -> None:
        with patch("strategies.lstm_compute._load_optional_module", return_value=None):
            capabilities = detect_lstm_capabilities()
        self.assertTrue(capabilities["numpy"])
        self.assertFalse(capabilities["torch_installed"])
        self.assertFalse(capabilities["mps"]["confirmed"])
        self.assertFalse(capabilities["cuda"]["confirmed"])
        self.assertFalse(capabilities["mlx"]["confirmed"])
        self.assertFalse(capabilities["neural_engine"]["confirmed"])

    def test_cpu_backend_does_not_require_a_gpu_probe(self) -> None:
        with patch("strategies.lstm_compute.probe_torch_device") as probe:
            backend = resolve_lstm_backend("CPU")
        self.assertEqual(backend.requested, "CPU")
        self.assertEqual(backend.resolved, "cpu")
        self.assertEqual(backend.engine, "numpy")
        probe.assert_not_called()

    def test_gpu_backend_falls_back_when_torch_is_missing(self) -> None:
        with patch("strategies.lstm_compute._load_optional_module", return_value=None):
            backend = resolve_lstm_backend("GPU")
        self.assertEqual(backend.requested, "GPU")
        self.assertEqual(backend.resolved, "cpu")
        self.assertEqual(backend.engine, "numpy-fallback")
        self.assertFalse(backend.runtime_fallback)
        self.assertIn("torch is not installed", str(backend.fallback_reason))

    def test_neural_engine_falls_back_without_claiming_npu_use(self) -> None:
        backend = resolve_lstm_backend("Neural Engine")
        report = probe_neural_engine()
        self.assertEqual(backend.resolved, "cpu")
        self.assertFalse(report["confirmed"])
        self.assertFalse(backend.capabilities["neural_engine"]["confirmed"])
        self.assertIn("coremltools is not installed", str(backend.fallback_reason))

    def test_auto_reports_the_resolved_backend_not_the_request(self) -> None:
        backend = resolve_lstm_backend("Auto")
        self.assertEqual(backend.requested, "Auto")
        self.assertEqual(backend.resolved, "cpu")
        self.assertEqual(backend.engine, "numpy")
        self.assertIsNone(backend.torch_module)

    def test_gpu_uses_confirmed_mps_and_reports_that_device(self) -> None:
        capabilities = detect_lstm_capabilities()
        backend = resolve_lstm_backend("GPU")
        self.assertEqual(backend.requested, "GPU")
        if capabilities["mps"]["confirmed"]:
            self.assertEqual(backend.resolved, "mps")
            self.assertEqual(backend.engine, "torch")
            self.assertEqual(capabilities["mps"]["readback"], 2.0)
        elif capabilities["cuda"]["confirmed"]:
            self.assertEqual(backend.resolved, "cuda")
            self.assertEqual(backend.engine, "torch")
        else:
            self.assertEqual(backend.resolved, "cpu")
            self.assertEqual(backend.engine, "numpy-fallback")

    def test_torch_device_probe_fails_closed_without_torch(self) -> None:
        with patch("strategies.lstm_compute._load_optional_module", return_value=None):
            probe = probe_torch_device("mps")
        self.assertFalse(probe["available"])
        self.assertFalse(probe["confirmed"])
        self.assertEqual(probe["reason"], "torch is not installed")

    def test_walk_forward_fails_closed_without_enough_history(self) -> None:
        features = np.ones((12, 2), dtype=np.float64)
        targets = np.linspace(-0.01, 0.01, 12)
        backend = LstmBackend(requested="CPU")
        means, scales = walk_forward_lstm_predictions(
            features,
            targets,
            training_window=30,
            lookback=8,
            hidden_size=4,
            epochs=1,
            learning_rate=0.05,
            seed=1,
            backend=backend,
        )
        self.assertTrue(np.all(np.isnan(means)))
        self.assertTrue(np.all(np.isnan(scales)))
        self.assertEqual(backend.origins_trained, 0)
        self.assertGreater(backend.origins_failed_closed, 0)

    def test_walk_forward_is_causal_in_features_and_targets(self) -> None:
        generator = np.random.default_rng(11)
        row_count = 64
        features = generator.normal(0.0, 1.0, size=(row_count, 2))
        targets = generator.normal(0.0, 0.01, size=row_count)
        targets[-2:] = np.nan
        backend = LstmBackend(requested="CPU")
        kwargs = {
            "training_window": 36,
            "lookback": 4,
            "hidden_size": 4,
            "epochs": 1,
            "learning_rate": 0.05,
            "seed": 7,
        }
        first, _first_scale = walk_forward_lstm_predictions(
            features,
            targets,
            backend=backend,
            **kwargs,
        )
        leaked_features = features.copy()
        leaked_features[40:] += 8.0
        leaked_targets = targets.copy()
        leaked_targets[40:] += 0.5
        second, _ = walk_forward_lstm_predictions(
            leaked_features,
            leaked_targets,
            backend=LstmBackend(requested="CPU"),
            **kwargs,
        )
        np.testing.assert_allclose(
            first[:40],
            second[:40],
            rtol=0.0,
            atol=1e-12,
            equal_nan=True,
        )
        self.assertTrue(np.isfinite(first[50]) or np.isnan(first[50]))

    def test_confirmed_gpu_walk_forward_reports_mps_not_the_request(self) -> None:
        capabilities = detect_lstm_capabilities()
        if not capabilities["mps"]["confirmed"]:
            self.skipTest("Apple MPS is not confirmed on this host.")
        features = np.random.default_rng(3).normal(0.0, 1.0, size=(36, 2))
        targets = np.random.default_rng(4).normal(0.0, 0.01, size=36)
        targets[-2:] = np.nan
        backend = resolve_lstm_backend("GPU")
        means, scales = walk_forward_lstm_predictions(
            features,
            targets,
            training_window=24,
            lookback=4,
            hidden_size=4,
            epochs=1,
            learning_rate=0.05,
            seed=3,
            backend=backend,
        )
        self.assertEqual(backend.requested, "GPU")
        self.assertEqual(backend.resolved, "mps")
        self.assertEqual(backend.engine, "torch")
        self.assertFalse(backend.runtime_fallback)
        self.assertGreater(backend.origins_trained, 0)
        self.assertGreater(int(np.isfinite(means).sum()), 0)
        self.assertTrue(np.all(scales[np.isfinite(scales)] > 0.0))

    def test_lagged_close_return_is_causal(self) -> None:
        close = np.asarray([100.0, 110.0, 99.0], dtype=np.float64)
        lagged = lagged_close_return(close)
        self.assertTrue(math.isnan(lagged[0]))
        self.assertAlmostEqual(lagged[1], math.log(1.1))
        self.assertAlmostEqual(lagged[2], math.log(99.0 / 110.0))


if __name__ == "__main__":
    unittest.main()
