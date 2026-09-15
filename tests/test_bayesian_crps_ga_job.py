"""Durable Bayesian CRPS GA job contracts. Code version: v1.2.0."""

from __future__ import annotations

import gzip
import json
from datetime import date
from pathlib import Path
import random

import pytest

from scripts import bayesian_crps_ga_job as job
from scripts import prepare_bayesian_crps_ga_config as prepare


def _sha256(payload: bytes) -> str:
    return job._sha256(payload)


def _spec(*, duration: int = 10) -> job.SearchSpec:
    return job.SearchSpec(
        seed=20260914,
        population_size=4,
        search_duration_seconds=duration,
        validation_fraction_start=0.20,
        holdout_fraction_start=0.80,
        numeric_domains={
            "training_window": (30.0, 33.0, 1.0),
            "chip_window": (5.0, 8.0, 1.0),
            "prior_strength": (0.01, 1.00, 0.01),
        },
        factor_parameters=("use_volume",),
        baseline_params={
            "training_window": 30,
            "chip_window": 5,
            "prior_strength": 0.50,
            "use_volume": True,
            "cell_display_threshold": 2.50,
            "entry_probability": 60.0,
        },
    )


def _context(root: Path) -> job.EvaluationContext:
    return job.EvaluationContext(
        project_root=root,
        snapshot={},
        snapshot_sha256="a" * 64,
        visible_frame=None,
        selection_frame=None,
        selection_bundle={},
        validation_folds=(("validation-1", 0, 21),),
        holdout_start=21,
    )


def _complete_score(skill: float = -0.25) -> dict[str, object]:
    horizons = {
        str(index): {
            "crps_skill_score": skill,
            "eligible_pairs": 2,
            "valid_pairs": 2,
        }
        for index in range(1, 21)
    }
    return {
        "crps_skill_score": skill,
        "horizon_count": 20,
        "crps_skill_valid_horizon_count": 20,
        "crps_skill_required_horizon_count": 20,
        "crps_skill_has_complete_pair_coverage": True,
        "eligible_pairs": 40,
        "valid_pairs": 40,
        "horizons": horizons,
    }


def _selection_record(
    params: dict[str, object],
    spec: job.SearchSpec,
    *,
    skill: float,
) -> dict[str, object]:
    candidate = job.canonical_candidate(params, spec)
    return {
        "status": "ok",
        "phase": "selection",
        "candidate_key": job.candidate_key(candidate, spec),
        "params": candidate,
        "feasible": True,
        "mean_validation_crps_skill": skill,
        "worst_validation_crps_skill": skill,
        "enabled_factor_count": sum(
            bool(candidate[name]) for name in spec.factor_parameters
        ),
        "folds": {"validation-1": _complete_score(skill)},
        "compute": {
            "runner_backend_policy": job.BACKEND_POLICY,
            "compute_device": "cpu",
            "compute_parallel_workers": 1,
            "compute_parallel_executor": "serial",
            "fingerprint": "f" * 64,
        },
        "elapsed_seconds": 1.0,
    }


def _resume_state(
    spec: job.SearchSpec,
    overrides: dict[str, object],
) -> dict[str, object]:
    evaluation_count = int(overrides.get("evaluation_count", 0))
    phase = str(overrides.get("phase", "search"))
    elapsed_seconds = float(overrides.get("elapsed_seconds", 0.0))
    state: dict[str, object] = {
        "phase": phase,
        "generation": 0,
        "pending": [],
        "inflight": None,
        "leaderboard": [],
        "seen": [],
        "evaluation_count": evaluation_count,
        "successful_evaluation_count": evaluation_count,
        "failed_evaluation_count": 0,
        "feasible_evaluation_count": evaluation_count,
        "elapsed_seconds": elapsed_seconds,
        "selection_elapsed_seconds": (
            None if phase == "search" else spec.search_duration_seconds
        ),
        "url_baseline_validation": None,
        "frozen_winner": None,
        "winner_holdout": None,
        "baseline_holdout": None,
    }
    state.update(overrides)
    return state


def _write_resume_fixture(path: Path, checkpoint: dict[str, object]) -> None:
    path.write_bytes(job._canonical_json_bytes(checkpoint) + b"\n")


def _source_tree(tmp_path: Path) -> tuple[Path, Path, dict[str, str]]:
    project = tmp_path / "worthward"
    staged = tmp_path / "runtime" / "entrypoint.py"
    staged.parent.mkdir(parents=True)
    staged.write_text("approved entrypoint\n", encoding="utf-8")
    hashes: dict[str, str] = {}
    for relative in sorted(job.REQUIRED_RUNTIME_SOURCE_PATHS):
        path = project / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        content = (
            b"different live entrypoint\n"
            if relative == "scripts/bayesian_crps_ga_job.py"
            else f"{relative}\n".encode("utf-8")
        )
        path.write_bytes(content)
        pinned = staged.read_bytes() if relative.startswith("scripts/") else content
        hashes[relative] = _sha256(pinned)
    return project, staged, hashes


def _encode_snapshot(payload: dict[str, object]) -> tuple[dict[str, object], str]:
    raw = job._canonical_json_bytes(payload)
    compressed = gzip.compress(raw, mtime=0)
    import base64

    return (
        {
            "encoding": "gzip+base64",
            "sha256": _sha256(raw),
            "uncompressed_bytes": len(raw),
            "compressed_bytes": len(compressed),
            "data": base64.b64encode(compressed).decode("ascii"),
        },
        _sha256(raw),
    )


def _snapshot_payload() -> dict[str, object]:
    return {
        "schema_version": 1,
        "kind": "worthward-price-field-market-bundle",
        "ticker": "QQQ",
        "interval": "1d",
        "visible_start": "2021-09-14",
        "visible_end": "2026-09-14",
        "symbol": "QQQ.US",
        "start": "2019-09-14",
        "end": "2026-09-14",
        "ohlcv": [],
        "pe_history": [],
        "dynamic_pe_history": [],
        "option_history": [],
        "research_history": [],
        "fetched_at": "2026-09-14T12:00:00+00:00",
        "fingerprint": "snapshot-fingerprint",
        "factor_status": {"ohlcv": "available", "options": "available"},
        "source_commands": [],
    }


def _snapshot_record() -> tuple[dict[str, object], str]:
    return _encode_snapshot(_snapshot_payload())


def _config(source_hashes: dict[str, str]) -> dict[str, object]:
    snapshot, _digest = _snapshot_record()
    backtest_url = (
        "http://localhost:8688/workspaces/backtest?"
        "ticker=QQQ&range=5y&strategy=bayesian-price-field"
    )
    resolved = prepare._resolve_request(
        backtest_url,
        as_of=date(2026, 9, 14),
    )
    canonical_url = resolved["canonical_url"]
    baseline = resolved["baseline_params"]
    return {
        "schema_version": 1,
        "kind": job.CONFIG_KIND,
        "source": {
            "backtest_url": backtest_url,
            "canonical_url": canonical_url,
            "sha256": _sha256(canonical_url.encode("utf-8")),
        },
        "request": {
            "ticker": "QQQ",
            "provider_symbol": "QQQ.US",
            "strategy": "bayesian-price-field",
            "interval": "1d",
            "query_params": resolved["query"],
        },
        "range": {
            "requested": "5y",
            "start": "2021-09-14",
            "end": "2026-09-14",
            "warmup_start": "2019-09-14",
        },
        "baseline_params": baseline,
        "snapshot": snapshot,
        "optimizer": {
            "version": job.OPTIMIZER_VERSION,
            "seed": 20260914,
            "population_size": 4,
            "search_duration_seconds": 600,
            "numeric_domains": {
                name: list(domain)
                for name, domain in job.APPROVED_NUMERIC_DOMAINS.items()
            },
            "factor_parameters": list(job.APPROVED_FACTOR_PARAMETERS),
            "source_sha256": source_hashes,
        },
    }


def test_load_config_validates_canonical_snapshot_and_staged_source_hashes(
    tmp_path: Path,
) -> None:
    project, staged, source_hashes = _source_tree(tmp_path)
    config = _config(source_hashes)
    config_path = tmp_path / "config.json"
    config_path.write_text(json.dumps(config), encoding="utf-8")

    loaded, config_hash, snapshot, snapshot_hash, spec, loaded_hashes = job.load_config(
        config_path, project, staged
    )

    assert loaded == config
    assert config_hash == _sha256(config_path.read_bytes())
    assert snapshot["ticker"] == "QQQ"
    assert snapshot_hash == config["snapshot"]["sha256"]
    assert (
        spec.baseline_params["cell_display_threshold"]
        == config["baseline_params"]["cell_display_threshold"]
    )
    assert loaded_hashes == source_hashes

    config["snapshot"]["sha256"] = "0" * 64
    config_path.write_text(json.dumps(config), encoding="utf-8")
    with pytest.raises(ValueError, match="Snapshot SHA-256"):
        job.load_config(config_path, project, staged)


def test_source_hash_validation_rejects_post_approval_dependency_change(
    tmp_path: Path,
) -> None:
    project, staged, source_hashes = _source_tree(tmp_path)
    config = _config(source_hashes)
    config_path = tmp_path / "config.json"
    config_path.write_text(json.dumps(config), encoding="utf-8")
    changed = project / "strategies/price_field_scoring.py"
    changed.write_text("changed after approval\n", encoding="utf-8")

    with pytest.raises(ValueError, match="Pinned source changed"):
        job.load_config(config_path, project, staged)


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("ticker", "SPY"),
        ("interval", "1m"),
        ("visible_start", "2021-09-15"),
        ("visible_end", "2026-09-11"),
    ],
)
def test_snapshot_identity_must_match_top_level_request_and_range(
    tmp_path: Path,
    field: str,
    value: str,
) -> None:
    project, staged, source_hashes = _source_tree(tmp_path)
    config = _config(source_hashes)
    snapshot_payload = _snapshot_payload()
    snapshot_payload[field] = value
    config["snapshot"], _digest = _encode_snapshot(snapshot_payload)
    config_path = tmp_path / "config.json"
    config_path.write_text(json.dumps(config), encoding="utf-8")

    with pytest.raises(ValueError, match="Snapshot .* does not match"):
        job.load_config(config_path, project, staged)


def test_snapshot_provider_symbol_must_match_request(
    tmp_path: Path,
) -> None:
    project, staged, source_hashes = _source_tree(tmp_path)
    config = _config(source_hashes)
    snapshot_payload = _snapshot_payload()
    snapshot_payload["symbol"] = "SPY.US"
    config["snapshot"], _digest = _encode_snapshot(snapshot_payload)
    config_path = tmp_path / "config.json"
    config_path.write_text(json.dumps(config), encoding="utf-8")

    with pytest.raises(ValueError, match="Snapshot symbol does not match"):
        job.load_config(config_path, project, staged)


def test_nested_snapshot_wrapper_is_rejected(tmp_path: Path) -> None:
    project, staged, source_hashes = _source_tree(tmp_path)
    config = _config(source_hashes)
    config["snapshot"], _digest = _encode_snapshot(
        {
            "schema_version": 1,
            "kind": job.SNAPSHOT_KIND,
            "bundle": _snapshot_payload(),
        }
    )
    config_path = tmp_path / "config.json"
    config_path.write_text(json.dumps(config), encoding="utf-8")

    with pytest.raises(ValueError, match="direct market-bundle schema"):
        job.load_config(config_path, project, staged)


def test_project_root_comes_from_source_cwd_when_entrypoint_is_staged(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    project, staged, _hashes = _source_tree(tmp_path)
    monkeypatch.chdir(project / "scripts")
    monkeypatch.setattr(job, "__file__", str(staged))

    assert job.resolve_project_root() == project.resolve()


def test_complete_negative_crps_skill_is_feasible() -> None:
    assert job.score_is_feasible(_complete_score(-0.25)) is True


@pytest.mark.parametrize(
    "mutate",
    [
        lambda score: score.update(horizon_count=19),
        lambda score: score.update(crps_skill_valid_horizon_count=19),
        lambda score: score.update(crps_skill_has_complete_pair_coverage=False),
        lambda score: score.update(valid_pairs=39),
        lambda score: score["horizons"].pop("20"),
        lambda score: score["horizons"]["7"].update(valid_pairs=1),
        lambda score: score.update(crps_skill_score=None),
    ],
)
def test_crps_feasibility_fails_closed_for_incomplete_evidence(mutate) -> None:
    score = _complete_score(0.10)
    mutate(score)

    assert job.score_is_feasible(score) is False


def test_checkpoint_resume_restores_exact_rng_and_next_population(
    tmp_path: Path,
) -> None:
    spec = _spec()
    context = _context(tmp_path)
    baseline = job.canonical_candidate(spec.baseline_params, spec)
    record = _selection_record(baseline, spec, skill=-0.10)
    state = _resume_state(spec, {
        "phase": "search",
        "generation": 4,
        "pending": [],
        "inflight": None,
        "leaderboard": [record],
        "seen": [record["candidate_key"]],
        "evaluation_count": 1,
        "elapsed_seconds": 123.5,
        "url_baseline_validation": record,
        "frozen_winner": None,
    })
    original_rng = random.Random(spec.seed)
    for _ in range(11):
        original_rng.random()
    checkpoint = job._checkpoint_payload(
        state,
        original_rng,
        spec,
        "b" * 64,
        context,
        {"source.py": "c" * 64},
    )
    checkpoint_path = tmp_path / "resume.json"
    _write_resume_fixture(checkpoint_path, checkpoint)

    restored_state, restored_rng = job._load_resume(
        checkpoint_path,
        spec,
        "b" * 64,
        context,
        {"source.py": "c" * 64},
    )
    original_next = job._next_population(
        original_rng,
        spec,
        state["leaderboard"],
        set(state["seen"]),
    )
    restored_next = job._next_population(
        restored_rng,
        spec,
        restored_state["leaderboard"],
        set(restored_state["seen"]),
    )

    assert restored_state == state
    assert restored_next == original_next
    assert restored_rng.random() == original_rng.random()


def test_resume_rejects_runtime_mismatch(tmp_path: Path) -> None:
    spec = _spec()
    context = _context(tmp_path)
    baseline = _selection_record(spec.baseline_params, spec, skill=0.10)
    state = _resume_state(spec, {
        "phase": "search",
        "generation": 1,
        "pending": [],
        "inflight": None,
        "leaderboard": [baseline],
        "seen": [baseline["candidate_key"]],
        "evaluation_count": 1,
        "elapsed_seconds": 4.0,
        "url_baseline_validation": baseline,
        "frozen_winner": None,
    })
    checkpoint = job._checkpoint_payload(
        state,
        random.Random(spec.seed),
        spec,
        "b" * 64,
        context,
        {"source.py": "c" * 64},
    )
    checkpoint["runtime"] = {**checkpoint["runtime"], "python": "0.0.0"}
    checkpoint_path = tmp_path / "runtime-mismatch.json"
    _write_resume_fixture(checkpoint_path, checkpoint)

    with pytest.raises(ValueError, match="runtime does not match this request"):
        job._load_resume(
            checkpoint_path,
            spec,
            "b" * 64,
            context,
            {"source.py": "c" * 64},
        )


def test_resume_rejects_coordinated_url_baseline_params_and_key_tampering(
    tmp_path: Path,
) -> None:
    spec = _spec()
    context = _context(tmp_path)
    actual_baseline = _selection_record(spec.baseline_params, spec, skill=0.10)
    replacement_params = dict(spec.baseline_params)
    replacement_params["training_window"] = 31
    replacement = _selection_record(replacement_params, spec, skill=0.20)
    leaderboard = sorted(
        [actual_baseline, replacement],
        key=job.record_rank,
        reverse=True,
    )
    state = _resume_state(spec, {
        "phase": "search",
        "generation": 1,
        "pending": [],
        "inflight": None,
        "leaderboard": leaderboard,
        "seen": sorted(record["candidate_key"] for record in leaderboard),
        "evaluation_count": 2,
        "elapsed_seconds": 8.0,
        "url_baseline_validation": replacement,
        "frozen_winner": None,
    })
    checkpoint = job._checkpoint_payload(
        state,
        random.Random(spec.seed),
        spec,
        "b" * 64,
        context,
        {"source.py": "c" * 64},
    )
    checkpoint_path = tmp_path / "tampered-baseline.json"
    _write_resume_fixture(checkpoint_path, checkpoint)

    with pytest.raises(ValueError, match="URL baseline is inconsistent"):
        job._load_resume(
            checkpoint_path,
            spec,
            "b" * 64,
            context,
            {"source.py": "c" * 64},
        )


def test_resume_rejects_frozen_winner_that_is_not_leaderboard_top(
    tmp_path: Path,
) -> None:
    spec = _spec()
    context = _context(tmp_path)
    baseline = _selection_record(spec.baseline_params, spec, skill=0.10)
    winner_params = dict(spec.baseline_params)
    winner_params["training_window"] = 31
    leaderboard_top = _selection_record(winner_params, spec, skill=0.30)
    leaderboard = sorted(
        [baseline, leaderboard_top],
        key=job.record_rank,
        reverse=True,
    )
    state = _resume_state(spec, {
        "phase": "holdout",
        "generation": 1,
        "pending": [],
        "inflight": None,
        "leaderboard": leaderboard,
        "seen": sorted(record["candidate_key"] for record in leaderboard),
        "evaluation_count": 2,
        "elapsed_seconds": 10.0,
        "url_baseline_validation": baseline,
        "frozen_winner": baseline,
    })
    checkpoint = job._checkpoint_payload(
        state,
        random.Random(spec.seed),
        spec,
        "b" * 64,
        context,
        {"source.py": "c" * 64},
    )
    checkpoint_path = tmp_path / "tampered-winner.json"
    _write_resume_fixture(checkpoint_path, checkpoint)

    with pytest.raises(ValueError, match="frozen winner is inconsistent"):
        job._load_resume(
            checkpoint_path,
            spec,
            "b" * 64,
            context,
            {"source.py": "c" * 64},
        )


def test_resume_rejects_pending_candidate_already_present_in_seen(
    tmp_path: Path,
) -> None:
    spec = _spec()
    context = _context(tmp_path)
    baseline = _selection_record(spec.baseline_params, spec, skill=0.10)
    state = _resume_state(spec, {
        "phase": "search",
        "generation": 1,
        "pending": [baseline["params"]],
        "inflight": None,
        "leaderboard": [baseline],
        "seen": [baseline["candidate_key"]],
        "evaluation_count": 1,
        "elapsed_seconds": 4.0,
        "url_baseline_validation": baseline,
        "frozen_winner": None,
    })
    checkpoint = job._checkpoint_payload(
        state,
        random.Random(spec.seed),
        spec,
        "b" * 64,
        context,
        {"source.py": "c" * 64},
    )
    checkpoint_path = tmp_path / "pending-seen-overlap.json"
    _write_resume_fixture(checkpoint_path, checkpoint)

    with pytest.raises(ValueError, match="queued candidates are inconsistent"):
        job._load_resume(
            checkpoint_path,
            spec,
            "b" * 64,
            context,
            {"source.py": "c" * 64},
        )


def _install_job_harness(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    spec: job.SearchSpec,
    clock: dict[str, float],
    evaluator,
) -> list[dict[str, object]]:
    baseline = job.canonical_candidate(spec.baseline_params, spec)
    population = [baseline, *[
        job.canonical_candidate(
            {
                "training_window": 30 + index,
                "chip_window": 5 + index,
                "prior_strength": 0.50 + index / 100,
                "use_volume": bool(index % 2),
            },
            spec,
        )
        for index in range(1, 4)
    ]]
    config = {
        "source": {
            "canonical_url": "http://localhost:8688/workspaces/backtest",
        },
        "request": {"ticker": "QQQ", "strategy": "bayesian-price-field"},
        "range": {"requested": "5y"},
    }
    context = _context(tmp_path)
    calls: list[dict[str, object]] = []

    def tracked_evaluator(params, current_spec, current_context, *, phase):
        calls.append({"params": dict(params), "phase": phase})
        return evaluator(params, current_spec, current_context, phase=phase)

    monkeypatch.setattr(job, "resolve_project_root", lambda: tmp_path)
    monkeypatch.setattr(
        job,
        "load_config",
        lambda *_args: (
            config,
            "b" * 64,
            {},
            context.snapshot_sha256,
            spec,
            {"source.py": "c" * 64},
        ),
    )
    monkeypatch.setattr(job, "build_evaluation_context", lambda *_args: context)
    monkeypatch.setattr(job, "_initial_population", lambda *_args: population)
    monkeypatch.setattr(job, "evaluate_candidate", tracked_evaluator)
    monkeypatch.setattr(job.time, "monotonic", lambda: clock["now"])
    return calls


def _fake_evaluation(params, spec, _context, *, phase, clock, selection_seconds=3.0):
    candidate = job.canonical_candidate(params, spec)
    key = job.candidate_key(candidate, spec)
    skill = (candidate["training_window"] - 30) / 10
    if phase == "selection":
        clock["now"] += selection_seconds
        return {
            "status": "ok",
            "phase": phase,
            "candidate_key": key,
            "params": candidate,
            "feasible": True,
            "mean_validation_crps_skill": skill,
            "worst_validation_crps_skill": skill - 0.01,
            "enabled_factor_count": int(candidate["use_volume"]),
            "folds": {"validation-1": _complete_score(skill)},
            "compute": {
                "runner_backend_policy": job.BACKEND_POLICY,
                "compute_device": "cpu",
                "compute_parallel_workers": 1,
                "compute_parallel_executor": "serial",
                "fingerprint": "e" * 64,
            },
            "elapsed_seconds": selection_seconds,
        }
    holdout_skill = -0.90 if candidate["training_window"] == 33 else 0.90
    return {
        "status": "ok",
        "phase": phase,
        "candidate_key": key,
        "params": candidate,
        "feasible": True,
        "holdout": _complete_score(holdout_skill),
        "compute": {
            "runner_backend_policy": job.BACKEND_POLICY,
            "compute_device": "cpu",
            "compute_parallel_workers": 1,
            "compute_parallel_executor": "serial",
            "fingerprint": "d" * 64,
        },
        "elapsed_seconds": 1.0,
    }


def test_expired_budget_does_not_schedule_another_pending_candidate(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    spec = _spec(duration=10)
    clock = {"now": 0.0}
    calls = _install_job_harness(
        monkeypatch,
        tmp_path,
        spec,
        clock,
        lambda *args, **kwargs: _fake_evaluation(
            *args,
            **kwargs,
            clock=clock,
            selection_seconds=11.0,
        ),
    )

    assert job.run_job(tmp_path / "config.json", tmp_path) == 0
    assert [call["phase"] for call in calls].count("selection") == 1


def test_infeasible_url_baseline_fails_before_ga_or_holdout(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    spec = _spec(duration=10)
    clock = {"now": 0.0}

    def infeasible_baseline(params, current_spec, _context, *, phase):
        candidate = job.canonical_candidate(params, current_spec)
        clock["now"] += 1.0
        return {
            "status": "ok",
            "phase": phase,
            "candidate_key": job.candidate_key(candidate, current_spec),
            "params": candidate,
            "feasible": False,
            "mean_validation_crps_skill": -1e308,
            "worst_validation_crps_skill": -1e308,
            "enabled_factor_count": int(candidate["use_volume"]),
            "folds": {"validation-1": {"crps_skill_score": None}},
            "elapsed_seconds": 1.0,
        }

    calls = _install_job_harness(
        monkeypatch,
        tmp_path,
        spec,
        clock,
        infeasible_baseline,
    )

    with pytest.raises(
        RuntimeError,
        match="URL baseline did not produce complete CRPS validation evidence",
    ):
        job.run_job(tmp_path / "config.json", tmp_path)

    assert [call["phase"] for call in calls] == ["selection"]
    assert not (tmp_path / "result.json").exists()


def test_selection_is_frozen_before_holdout_and_holdout_cannot_reselect(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    spec = _spec(duration=10)
    clock = {"now": 0.0}
    calls = _install_job_harness(
        monkeypatch,
        tmp_path,
        spec,
        clock,
        lambda *args, **kwargs: _fake_evaluation(
            *args,
            **kwargs,
            clock=clock,
            selection_seconds=3.0,
        ),
    )

    assert job.run_job(tmp_path / "config.json", tmp_path) == 0
    phases = [call["phase"] for call in calls]
    assert phases == [
        "selection",
        "selection",
        "selection",
        "selection",
        "winner-holdout",
        "url-baseline-holdout",
    ]
    result = json.loads((tmp_path / "result.json").read_text(encoding="utf-8"))
    assert result["selection_uses_holdout"] is False
    assert result["winner"]["params"]["training_window"] == 33
    assert result["winner"]["holdout"]["crps_skill_score"] == -0.90
    assert result["url_baseline"]["holdout"]["crps_skill_score"] == 0.90
