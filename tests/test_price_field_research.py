"""Research chronology, selection, and lifecycle contracts. Code version: v1.1.0."""

from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import json
import multiprocessing
import random
import signal
import threading
import time
from types import SimpleNamespace

import numpy as np
import pandas as pd
import pytest

from scripts import price_field_research as research
from tests.factories.market import ohlc_frame_for_dates


def _snapshot(tmp_path, count=500):
    dates = pd.bdate_range("2024-01-02", periods=count).strftime("%Y-%m-%d").tolist()
    frame = ohlc_frame_for_dates("NVDA", dates)
    frame["Volume"] = 1_000_000 + np.arange(count) * 101
    frame["Turnover"] = frame["Volume"] * frame["Close"]
    rows = [{"observed_at": row.Date.isoformat(), "open": row.Open, "high": row.High, "low": row.Low,
             "close": row.Close, "volume": row.Volume, "turnover": row.Turnover} for row in frame.itertuples()]
    payload = {"ticker": "NVDA", "interval": "1d", "bundle": {"ohlcv": rows, "research_history": [], "option_history": [], "factor_status": {}}}
    path = tmp_path / "NVDA.json"
    path.write_text(json.dumps(payload))
    return path, payload


def test_holdout_and_fold_boundaries_are_candidate_independent():
    holdout, folds = research.validation_folds(500)
    assert holdout == 400
    assert folds[0][0] == 128 and folds[-1][1] == 400
    assert all(end - start >= 90 for start, end in folds)
    with pytest.raises(ValueError, match="Insufficient"):
        research.validation_folds(108)


def test_all_dated_factor_and_benchmark_rows_are_physically_clipped():
    bundle = {"ohlcv": [{"observed_at": "2025-01-02"}, {"observed_at": "2025-01-03"}],
              "research_history": [{"observed_at": "2025-01-02", "value": 1}, {"observed_at": "2025-01-06", "value": 9}],
              "benchmarks": {"QQQ": [{"observed_at": "2025-01-02"}, {"observed_at": "2025-01-06"}]}}
    before = deepcopy(bundle)
    clipped = research.clip_bundle(bundle, pd.Timestamp("2025-01-02"))
    assert bundle == before
    assert all(len(clipped[key]) == 1 for key in ("ohlcv", "research_history"))
    assert len(clipped["benchmarks"]["QQQ"]) == 1


def test_post_holdout_mutations_do_not_change_factor_eligibility(tmp_path):
    from strategies.loader import instantiate_strategy
    from strategies.price_field_pipeline import bundle_to_price_field_ohlcv

    _path, payload = _snapshot(tmp_path)
    original = payload["bundle"]
    cutoff = pd.Timestamp(original["ohlcv"][399]["observed_at"])
    prefix = research.clip_bundle(original, cutoff)
    strategy = instantiate_strategy("timexer-price-field")
    before = research.factor_eligibility(bundle_to_price_field_ohlcv(prefix), prefix, strategy)
    for row in original["ohlcv"][400:]:
        row["close"], row["volume"] = 1e12, 0
    original["research_history"].append({"observed_at": original["ohlcv"][-1]["observed_at"], "pe_ratio": 1e10})
    after_prefix = research.clip_bundle(original, cutoff)
    after = research.factor_eligibility(bundle_to_price_field_ohlcv(after_prefix), after_prefix, strategy)
    assert before == after
    assert before["use_return_1d"]["reason"] == "duplicate endogenous return"


def _record(score, seed, *, width=16, status="ok"):
    return {"strategy_id": "test", "params": {"hidden_size": width, "seed": seed, "compute_backend": "GPU"},
            "fitness": score, "feasible": status == "ok", "status": status}


def test_incomplete_seed_group_cannot_displace_complete_validation_winner():
    records = [_record(50, seed) for seed in research.ROBUST_SEEDS]
    records.extend([_record(99, 42, width=32), _record(99, 101, width=32)])
    selected = research.replicated_selection(records, ("test",), research.ROBUST_SEEDS)
    assert selected["test"]["params"]["hidden_size"] == 16
    with pytest.raises(RuntimeError, match="No complete"):
        research.replicated_selection(records[3:], ("test",), research.ROBUST_SEEDS)


def test_selection_uses_validation_mean_then_seed_stability_only():
    records = [_record(score, seed) for score, seed in zip((40, 50, 60), research.ROBUST_SEEDS, strict=True)]
    records.extend(_record(50, seed, width=32) for seed in research.ROBUST_SEEDS)
    for row in records:
        row["holdout_score"] = 100 if row["params"]["hidden_size"] == 16 else 0
    assert research.replicated_selection(records, ("test",), research.ROBUST_SEEDS)["test"]["params"]["hidden_size"] == 32


def test_smoke_exercises_search_selection_report_without_real_holdout(tmp_path, monkeypatch):
    snapshot, _payload = _snapshot(tmp_path)
    output = tmp_path / "smoke"
    seen_phases = []

    def evaluate(task):
        seen_phases.append(task["phase"])
        expected_count = 400 if task["phase"] == "frozen-selection-reporting" else 300
        assert len(task["frame"]) == expected_count
        assert len(task["bundle"]["ohlcv"]) == expected_count
        if task["phase"] == "frozen-selection-reporting":
            assert (output / "selection.json").is_file()
        return {"strategy_id": task["strategy_id"], "params": task["params"], "phase": task["phase"],
                "ticker": task["ticker"], "status": "ok", "feasible": True, "fitness": 60.0,
                "worst_fold": 59.0, "folds": [], "elapsed_seconds": 0.001}

    monkeypatch.setattr(research, "evaluate_candidate", evaluate)
    monkeypatch.setattr(research, "_configure_process_environment", lambda: None)
    monkeypatch.setattr(research.signal, "signal", lambda *_args: None)
    monkeypatch.setattr(research, "ProcessPoolExecutor", lambda max_workers, **_kwargs: ThreadPoolExecutor(max_workers=max_workers))
    assert research.main(["--snapshot", str(snapshot), "--output", str(output), "--seconds", "60", "--cpu-workers", "2", "--smoke"]) == 0
    assert set(seen_phases) == {"search", "replicated-validation", "frozen-selection-reporting"}
    assert (output / "smoke.json").is_file()
    assert not (output / "result.json").exists()
    assert json.loads((output / "status.json").read_text())["status"] == "completed"
    assert research.main(["--snapshot", str(snapshot), "--output", str(output), "--seconds", "60", "--cpu-workers", "2", "--smoke"]) == 1


def test_stop_file_and_deadline_are_independent_cancellation_paths(tmp_path):
    snapshot, _ = _snapshot(tmp_path)
    output = tmp_path / "cancel"
    args = research._parser().parse_args(["--snapshot", str(snapshot), "--output", str(output), "--seconds", "60", "--cpu-workers", "1", "--smoke"])
    run = research.ResearchRun(args)
    assert not run.cancelled()
    run.deadline = time.monotonic() - 1
    assert run.cancelled()
    run.deadline = time.monotonic() + 100
    (output / "STOP").touch()
    assert run.cancelled()


def test_input_hash_change_fails_before_reporting(tmp_path):
    snapshot, _ = _snapshot(tmp_path)
    args = research._parser().parse_args(["--snapshot", str(snapshot), "--output", str(tmp_path / "hash"), "--seconds", "60", "--cpu-workers", "1", "--smoke"])
    run = research.ResearchRun(args)
    run.verify_inputs()
    snapshot.write_text(snapshot.read_text() + " ")
    with pytest.raises(RuntimeError, match="Frozen research input changed"):
        run.verify_inputs()


def test_expected_search_deadline_cancellation_never_counts_as_failure(tmp_path):
    snapshot, _ = _snapshot(tmp_path)
    args = research._parser().parse_args(["--snapshot", str(snapshot), "--output", str(tmp_path / "drain"), "--seconds", "60", "--cpu-workers", "1", "--smoke"])
    run = research.ResearchRun(args)
    for index in range(6):
        row = _record(-1, 42, status="cancelled")
        row["params"]["compute_backend"] = "GPU"
        row["elapsed_seconds"] = 0.01
        run.record(row)
    assert run.failures == 0
    assert run.consecutive_failures["GPU"] == 0
    assert run.cancelled_counts["GPU"] == 6


def test_one_missing_horizon_cannot_hide_inside_aggregate_coverage():
    from strategies.neural_price_field_scoring import score_neural_price_field

    frame = ohlc_frame_for_dates("NVDA", pd.bdate_range("2025-01-02", periods=120).strftime("%Y-%m-%d").tolist())
    for horizon in range(1, 21):
        frame[f"pf_mean_h{horizon:02d}"] = 0.0
        frame[f"pf_std_h{horizon:02d}"] = 0.01 * np.sqrt(horizon)
    assert research._score_feasible(score_neural_price_field(frame, 25, 115))
    frame["pf_std_h20"] = np.nan
    score = score_neural_price_field(frame, 25, 115)
    assert score["coverage_pct"] >= 95
    assert score["horizon_count"] == 20
    assert not research._score_feasible(score)


def test_coordinator_failure_broadcasts_stop_before_pool_shutdown(tmp_path, monkeypatch):
    snapshot, _ = _snapshot(tmp_path)
    output = tmp_path / "failure"
    args = research._parser().parse_args(["--snapshot", str(snapshot), "--output", str(output), "--seconds", "60", "--cpu-workers", "1", "--smoke"])
    run = research.ResearchRun(args)
    started_worker = threading.Event()
    futures = []

    def active_worker():
        started_worker.set()
        deadline = time.monotonic() + 2
        while not run.worker_stop.is_set() and time.monotonic() < deadline:
            time.sleep(0.01)
        return run.worker_stop.is_set()

    def fail_with_work_in_other_pool(_cpu_pool, gpu_pool):
        futures.append(gpu_pool.submit(active_worker))
        assert started_worker.wait(timeout=1)
        raise RuntimeError("five consecutive CPU failures")

    monkeypatch.setattr(research, "ProcessPoolExecutor", lambda max_workers, **_kwargs: ThreadPoolExecutor(max_workers=max_workers))
    monkeypatch.setattr(run, "_run_with_pools", fail_with_work_in_other_pool)
    started = time.monotonic()
    with pytest.raises(RuntimeError, match="five consecutive"):
        run.run()
    assert time.monotonic() - started < 1
    assert futures[0].result(timeout=1) is True
    assert json.loads((output / "status.json").read_text())["status"] == "failed"
    assert json.loads((output / "worker-cleanup.json").read_text())["surviving_pids"] == []


def _ignore_termination_until_killed(ready):
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
    ready.set()
    time.sleep(60)


def test_bounded_cleanup_kills_only_new_owned_children():
    context = multiprocessing.get_context("spawn")
    previous = {child.pid for child in multiprocessing.active_children()}
    ready = context.Event()
    child = context.Process(target=_ignore_termination_until_killed, args=(ready,))
    child.start()
    try:
        assert ready.wait(timeout=10)
        started = time.monotonic()
        result = research._shutdown_owned_workers([], previous, grace_seconds=0.05)
        assert time.monotonic() - started < 3
        assert child.pid in result["owned_pids"]
        assert child.pid in result["killed_pids"]
        assert result["surviving_pids"] == []
        assert child.pid not in previous
        assert not child.is_alive()
    finally:
        if child.is_alive():
            child.kill()
        child.join(timeout=3)


def test_shared_worker_stop_event_is_an_independent_cancellation_path(tmp_path, monkeypatch):
    event = threading.Event()
    monkeypatch.setattr(research, "_WORKER_STOP_EVENT", event)
    task = {"deadline": time.monotonic() + 60, "stop_file": str(tmp_path / "STOP")}
    assert not research._worker_cancelled(task)
    event.set()
    assert research._worker_cancelled(task)


def test_os_exit_sentinel_overrides_a_stale_process_alive_cache():
    receiver, sender = multiprocessing.Pipe(duplex=False)
    child = SimpleNamespace(sentinel=receiver.fileno(), is_alive=lambda: True)
    try:
        assert research._child_is_running(child)
        sender.close()
        assert not research._child_is_running(child)
    finally:
        receiver.close()
        sender.close()


def test_finalization_reserve_accounts_for_measured_latency_and_longer_report_frame():
    assert research.finalization_reserve([], 500, 400) == 900.0
    assert research.finalization_reserve([1.0] * 10, 500, 400) == 900.0
    assert research.finalization_reserve([10.0] * 10, 500, 400) == 2475.0
    assert research.finalization_reserve([100.0] * 100 + [1.0] * 256, 500, 400) == 900.0


def test_explicit_research_group_keeps_original_default_and_rejects_ambiguous_ids():
    from strategies.neural_price_field_registry import FRONTIER_NEURAL_STRATEGY_IDS, LEGACY_NEURAL_STRATEGY_IDS

    assert research._strategy_ids() == tuple(sorted(LEGACY_NEURAL_STRATEGY_IDS))
    assert research._strategy_ids(list(FRONTIER_NEURAL_STRATEGY_IDS)) == FRONTIER_NEURAL_STRATEGY_IDS
    for requested in ([], ["grid-trading"], ["unknown"], ["tft-price-field", "tft-price-field"]):
        with pytest.raises(ValueError):
            research._strategy_ids(requested)


def test_cpu_finalization_uses_its_own_model_count_and_worker_capacity():
    assert research.finalization_reserve([100.0] * 10, 500, 400,
                                         model_count=4, search_backends=1, final_workers=2) == 10_125.0
    with pytest.raises(ValueError, match="positive"):
        research.finalization_reserve([], 500, 400, final_workers=0)


def test_frontier_mutations_stay_in_the_architecture_declared_small_sample_domain():
    from strategies.loader import instantiate_strategy
    from strategies.neural_price_field_registry import FRONTIER_NEURAL_STRATEGY_IDS, research_choices

    rng = random.Random(882)
    for strategy_id in FRONTIER_NEURAL_STRATEGY_IDS:
        strategy = instantiate_strategy(strategy_id)
        defaults = strategy.get_default_params()
        domains = research_choices(strategy_id, research.SEARCH_CHOICES)
        leaders = []
        for _ in range(100):
            params = research._new_params(rng, defaults, [], leaders, "CPU", domains)
            assert all(params[key] in values for key, values in domains.items())
            assert strategy.normalize_params(params) == params
            leaders.append({"feasible": True, "fitness": 50, "worst_fold": 49, "params": params})
    assert research_choices("patchtst-price-field", research.SEARCH_CHOICES) == research.SEARCH_CHOICES


def test_cpu_only_run_never_creates_gpu_work_and_freezes_before_reporting(tmp_path, monkeypatch):
    from strategies.neural_price_field_registry import FRONTIER_NEURAL_STRATEGY_IDS

    snapshot, _ = _snapshot(tmp_path)
    output = tmp_path / "cpu-only"
    pools, phases = [], set()

    def pool(max_workers, **_kwargs):
        pools.append(max_workers)
        return ThreadPoolExecutor(max_workers=max_workers)

    def evaluate(task):
        assert task["params"]["compute_backend"] == "CPU"
        assert task["strategy_id"] in FRONTIER_NEURAL_STRATEGY_IDS
        phases.add(task["phase"])
        if task["phase"] == "frozen-selection-reporting":
            assert (output / "selection.json").is_file()
            assert len(task["frame"]) == 400
        else:
            assert len(task["frame"]) == 300
        return {"strategy_id": task["strategy_id"], "params": task["params"], "phase": task["phase"],
                "ticker": task["ticker"], "status": "ok", "feasible": True, "fitness": 60.0,
                "worst_fold": 59.0, "folds": [], "elapsed_seconds": 0.001}

    monkeypatch.setattr(research, "evaluate_candidate", evaluate)
    monkeypatch.setattr(research, "ProcessPoolExecutor", pool)
    monkeypatch.setattr(research, "_configure_process_environment", lambda: None)
    monkeypatch.setattr(research.signal, "signal", lambda *_args: None)
    shutdown = research._shutdown_owned_workers

    def checked_shutdown(*args, **kwargs):
        assert not (output / "smoke.json").exists()
        assert not (output / "result.json").exists()
        assert json.loads((output / "status.json").read_text())["status"] == "running"
        assert json.loads((output / "pending-result.json").read_text())["status"] == "awaiting-cleanup"
        return shutdown(*args, **kwargs)

    monkeypatch.setattr(research, "_shutdown_owned_workers", checked_shutdown)
    selected = [part for strategy_id in FRONTIER_NEURAL_STRATEGY_IDS for part in ("--strategy-id", strategy_id)]
    assert research.main(["--snapshot", str(snapshot), "--output", str(output), "--seconds", "60",
                          "--cpu-workers", "2", "--cpu-only", "--smoke", *selected]) == 0
    assert pools == [2]
    result = json.loads((output / "smoke.json").read_text())
    assert result["protocol"]["gpu_workers"] == 0
    assert result["protocol"]["final_backend"] == "CPU"
    assert result["protocol"]["final_workers"] == 2
    assert result["backend_counts"]["GPU"] == 0
    assert len(result["selection"]["winners"]) == 4
    assert phases == {"search", "replicated-validation", "frozen-selection-reporting"}
    assert not (output / "result.json").exists()


@pytest.mark.parametrize("seconds", ["nan", "inf", "0", "-1"])
def test_research_rejects_unbounded_or_nonpositive_budget(tmp_path, seconds):
    snapshot, _ = _snapshot(tmp_path)
    args = research._parser().parse_args(["--snapshot", str(snapshot), "--output", str(tmp_path / "invalid"),
                                         "--seconds", seconds])
    with pytest.raises(ValueError, match="deadline"):
        research.ResearchRun(args)


def test_partially_initialized_output_is_never_overwritten(tmp_path):
    snapshot, _ = _snapshot(tmp_path)
    output = tmp_path / "partial"
    output.mkdir()
    evidence = output / "protocol.json"
    evidence.write_text('{"previous": "incomplete"}')
    args = research._parser().parse_args(["--snapshot", str(snapshot), "--output", str(output), "--seconds", "60"])
    with pytest.raises(ValueError, match="already contains"):
        research.ResearchRun(args)
    assert evidence.read_text() == '{"previous": "incomplete"}'


def test_authorized_deadline_metadata_does_not_shift_with_initialization_clock(tmp_path, monkeypatch):
    snapshot, _ = _snapshot(tmp_path)
    deadline = (datetime.now(timezone.utc) + timedelta(minutes=30)).isoformat()
    args = research._parser().parse_args(["--snapshot", str(snapshot), "--output", str(tmp_path / "deadline"),
                                         "--deadline", deadline])
    later_wall_clock = time.time() + 120
    monkeypatch.setattr(research.time, "time", lambda: later_wall_clock)
    run = research.ResearchRun(args)
    assert run.manifest["deadline_utc"] == deadline


def test_repeated_ga_collisions_do_not_exhaust_an_unseen_candidate(tmp_path, monkeypatch):
    snapshot, _ = _snapshot(tmp_path)
    args = research._parser().parse_args(["--snapshot", str(snapshot), "--output", str(tmp_path / "collisions"),
                                         "--seconds", "120", "--cpu-only", "--strategy-id", "tft-price-field"])
    run = research.ResearchRun(args)
    first = run.unseen_candidate("tft-price-field", "CPU")
    attempts = []

    def draw(*_args):
        attempts.append(1)
        return dict(first, hidden_size=8 if len(attempts) > 3 else first["hidden_size"])

    monkeypatch.setattr(research, "_new_params", draw)
    second = run.unseen_candidate("tft-price-field", "CPU")
    assert second["hidden_size"] == 8
    assert len(attempts) == 4
    assert run.candidate_collisions == 4
    monkeypatch.setattr(research, "_new_params", lambda *_args: dict(first))
    assert run.unseen_candidate("tft-price-field", "CPU") is None
    assert not (run.output / "result.json").exists()


def test_cleanup_failure_cannot_leave_a_completed_result(tmp_path, monkeypatch):
    snapshot, _ = _snapshot(tmp_path)
    output = tmp_path / "cleanup-failure"
    args = research._parser().parse_args(["--snapshot", str(snapshot), "--output", str(output),
                                         "--seconds", "120", "--cpu-only"])
    run = research.ResearchRun(args)

    def reports_ready(*_pools):
        run.pending_result = {"status": "awaiting-cleanup"}
        run.phase = "cleanup"
        run.status(force=True)

    def cleanup_failed(*_args, **_kwargs):
        raise RuntimeError("worker did not exit")

    monkeypatch.setattr(research, "ProcessPoolExecutor", lambda max_workers, **_kwargs: ThreadPoolExecutor(max_workers=max_workers))
    monkeypatch.setattr(run, "_run_with_pools", reports_ready)
    monkeypatch.setattr(research, "_shutdown_owned_workers", cleanup_failed)
    with pytest.raises(RuntimeError, match="worker did not exit"):
        run.run()
    assert not (output / "result.json").exists()
    assert not (output / "smoke.json").exists()
    assert json.loads((output / "status.json").read_text())["status"] == "failed"


def test_endogenous_ablation_reports_paired_deltas_without_reselection():
    selected_rows = [_record(score, seed) for score, seed in zip((52, 55, 58), research.ROBUST_SEEDS, strict=True)]
    for row in selected_rows:
        row["params"]["use_volume"] = True
    selected = research.replicated_selection(selected_rows, ("test",), research.ROBUST_SEEDS)
    frozen = deepcopy(selected)
    ablated = [_record(score, seed) for score, seed in zip((60, 61, 62), research.ROBUST_SEEDS, strict=True)]
    for row in ablated:
        row["params"]["use_volume"] = False
    report = research.endogenous_ablation_summary(selected, ablated, research.ROBUST_SEEDS)
    assert selected == frozen
    assert report["selection_unchanged"] is True
    assert report["by_strategy"]["test"]["removed_factors"] == ["use_volume"]
    assert report["by_strategy"]["test"]["selected_minus_endogenous_only_points"] == -6.0
    assert report["by_strategy"]["test"]["paired_seed_deltas"] == {"42": -8, "101": -6, "202": -4}
    with pytest.raises(RuntimeError, match="No complete"):
        research.endogenous_ablation_summary(selected, ablated[:-1], research.ROBUST_SEEDS)


def test_formal_ablation_stays_on_validation_between_selection_and_holdout(tmp_path, monkeypatch):
    snapshot, _ = _snapshot(tmp_path)
    output = tmp_path / "formal-flow"
    args = research._parser().parse_args(["--snapshot", str(snapshot), "--output", str(output), "--seconds", "60", "--cpu-workers", "1", "--transfer-snapshot", str(snapshot)])
    run = research.ResearchRun(args)
    for params in run.defaults.values():
        params["use_volume"] = True
    phases = []
    frozen_selection = []

    def evaluate(task):
        phases.append(task["phase"])
        if task["phase"] == "validation-ablation":
            assert len(task["frame"]) == 400
            assert not any(value for key, value in task["params"].items() if key.startswith("use_"))
            frozen_selection.append((output / "selection.json").read_bytes())
        if task["phase"] == "frozen-selection-reporting":
            assert len(task["frame"]) == 500
            assert (output / "factor-ablation.json").is_file()
            assert (output / "selection.json").read_bytes() == frozen_selection[0]
        return {"strategy_id": task["strategy_id"], "params": task["params"], "phase": task["phase"],
                "ticker": task["ticker"], "role": task.get("role", "candidate"),
                "status": "ok", "feasible": True, "fitness": 70.0 if task["phase"] == "validation-ablation" else 60.0,
                "worst_fold": 59.0, "folds": [], "elapsed_seconds": 0.001}

    monkeypatch.setattr(research, "evaluate_candidate", evaluate)
    monkeypatch.setattr(research, "ProcessPoolExecutor", lambda max_workers, **_kwargs: ThreadPoolExecutor(max_workers=max_workers))
    run.run()
    assert phases.count("validation-ablation") == 12
    result = json.loads((output / "result.json").read_text())
    assert result["status"] == "completed"
    assert result["factor_ablation"]["selection_unchanged"] is True
    assert all(item["selected_minus_endogenous_only_points"] == -10.0 for item in result["factor_ablation"]["by_strategy"].values())
