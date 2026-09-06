"""LSTM compute backend and causality tests. Code version: v1.5.0."""

from __future__ import annotations

import math
import unittest
from unittest.mock import patch

import numpy as np

from strategies.lstm_compute import (
    LstmBackend,
    TrainingWork,
    _NumpyLSTM,
    _initialize_torch_lstm_biases,
    _load_optional_module,
    detect_lstm_capabilities,
    lagged_close_return,
    probe_neural_engine,
    probe_torch_device,
    resolve_lstm_backend,
    walk_forward_lstm_predictions,
)


class LstmComputeTests(unittest.TestCase):
    def test_backends_receive_identical_causal_standardized_inputs(self):
        features = np.column_stack((np.linspace(-0.01, 0.02, 30), np.arange(30) + 100_000.0))
        targets = np.linspace(-0.01, 0.01, 30)
        captured = {}
        for engine, function in (("numpy", "_numpy_origin_prediction"), ("torch", "_torch_train_and_predict")):
            batches = []

            def predict(*args, **kwargs):
                offset = int(engine == "torch")
                train, labels, current = args[offset:offset + 3]
                batches.append((train.copy(), labels.copy(), current.copy()))
                kwargs["timings"].update(train_ms=7.0, infer_ms=2.0)
                return 0.01, 0.02

            backend = LstmBackend("CPU", engine=engine)
            with patch(f"strategies.lstm_compute.{function}", side_effect=predict):
                walk_forward_lstm_predictions(features, targets, training_window=20,
                                              lookback=4, hidden_size=4, epochs=1,
                                              learning_rate=0.01, seed=1, backend=backend)
            self.assertEqual(backend.train_ms, backend.origins_trained * 7.0)
            self.assertEqual(backend.infer_ms, backend.origins_trained * 2.0)
            captured[engine] = batches
        self.assertGreater(len(captured["numpy"]), 0)
        for cpu, gpu in zip(captured["numpy"], captured["torch"], strict=True):
            for left, right in zip(cpu, gpu, strict=True):
                np.testing.assert_array_equal(left, right)
            np.testing.assert_allclose(cpu[0].mean(axis=(0, 1)), 0.0, atol=1e-10)
            np.testing.assert_allclose(cpu[0].std(axis=(0, 1)), 1.0, atol=1e-10)
            self.assertGreater(cpu[2][-1, 1], cpu[0][-1, -1, 1])

    def test_minimum_work_continues_optimizer_updates_without_reinitializing(self):
        sequences = np.ones((16, 4, 1), dtype=np.float64) * 0.01
        targets = np.linspace(-0.02, 0.02, 16)
        model = _NumpyLSTM(1, 4, np.random.default_rng(17))
        before = model.W_out.copy()
        ticks = []
        work = TrainingWork(3.0, lambda: ticks.append(True))
        # A deterministic clock verifies the loop, not real hardware performance.
        with patch("strategies.lstm_compute.time.perf_counter", side_effect=[0, 1, 1, 2, 2, 3]):
            model.train(sequences, targets, epochs=1, learning_rate=0.01, work=work)
        self.assertEqual(work.optimizer_steps, 3)
        self.assertEqual(work.compute_seconds, 3.0)
        self.assertEqual(len(ticks), 3)
        self.assertFalse(np.array_equal(before, model.W_out))

    def test_work_budget_does_not_skip_requested_epochs(self):
        work = TrainingWork(0.0)
        model = _NumpyLSTM(1, 4, np.random.default_rng(17))
        model.train(np.ones((16, 4, 1)), np.zeros(16), epochs=4, learning_rate=0.01, work=work)
        self.assertEqual(work.optimizer_steps, 4)

    def test_durable_gpu_errors_do_not_claim_a_cpu_training_success(self):
        backend = LstmBackend("GPU", resolved="mps", engine="torch", minimum_training_seconds=60, require_accelerator=True)
        with patch("strategies.lstm_compute._torch_train_and_predict", side_effect=RuntimeError("device lost")):
            with self.assertRaisesRegex(RuntimeError, "Training failed on mps"):
                walk_forward_lstm_predictions(np.ones((50, 1)), np.linspace(-0.01, 0.01, 50), training_window=25,
                                              lookback=4, hidden_size=4, epochs=1, learning_rate=0.01,
                                              seed=17, backend=backend)
        self.assertEqual(backend.resolved, "mps")

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

    def test_numpy_lstm_applies_positive_bias_to_forget_gate(self) -> None:
        hidden_size = 4
        model = _NumpyLSTM(
            input_size=2,
            hidden_size=hidden_size,
            rng=np.random.default_rng(1),
        )
        np.testing.assert_array_equal(model.b[:hidden_size], np.zeros(hidden_size))
        np.testing.assert_array_equal(
            model.b[hidden_size:2 * hidden_size],
            np.ones(hidden_size),
        )

    def test_torch_lstm_matches_gate_bias_initialization_when_available(self) -> None:
        torch_module = _load_optional_module("torch")
        if torch_module is None:
            self.skipTest("Torch is not installed on this host.")
        hidden_size = 4
        model = torch_module.nn.LSTM(
            input_size=2,
            hidden_size=hidden_size,
            batch_first=True,
        )
        _initialize_torch_lstm_biases(torch_module, model, hidden_size)
        input_bias = model.bias_ih_l0.detach().cpu().numpy()
        recurrent_bias = model.bias_hh_l0.detach().cpu().numpy()
        np.testing.assert_array_equal(input_bias[:hidden_size], np.zeros(hidden_size))
        np.testing.assert_array_equal(
            input_bias[hidden_size:2 * hidden_size],
            np.ones(hidden_size),
        )
        np.testing.assert_array_equal(
            input_bias[2 * hidden_size:],
            np.zeros(2 * hidden_size),
        )
        np.testing.assert_array_equal(
            recurrent_bias,
            np.zeros(4 * hidden_size),
        )

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

    def test_unavailable_factor_columns_do_not_zero_the_lag_return_lstm(self) -> None:
        generator = np.random.default_rng(11)
        lag_return = generator.normal(0.0, 0.01, size=48)
        lag_return[0] = np.nan
        features = np.column_stack(
            (
                lag_return,
                np.full(48, np.nan, dtype=np.float64),
            )
        )
        targets = generator.normal(0.0, 0.01, size=48)
        targets[-2:] = np.nan
        backend = LstmBackend(requested="CPU")
        means, scales = walk_forward_lstm_predictions(
            features,
            targets,
            training_window=24,
            lookback=4,
            hidden_size=4,
            epochs=1,
            learning_rate=0.05,
            seed=11,
            backend=backend,
        )
        self.assertGreater(int(np.isfinite(means).sum()), 0)
        self.assertTrue(np.all(scales[np.isfinite(scales)] > 0.0))
        self.assertGreater(backend.origins_trained, 0)
        self.assertGreater(backend.train_ms or 0.0, 0.0)

    def test_lagged_close_return_is_causal(self) -> None:
        close = np.asarray([100.0, 110.0, 99.0], dtype=np.float64)
        lagged = lagged_close_return(close)
        self.assertTrue(math.isnan(lagged[0]))
        self.assertAlmostEqual(lagged[1], math.log(1.1))
        self.assertAlmostEqual(lagged[2], math.log(99.0 / 110.0))


if __name__ == "__main__":
    unittest.main()
