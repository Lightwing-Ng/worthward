"""Tests for the durable web-managed LSTM training runs. Code version: v0.1.0."""

from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.services import lstm_training
from app.web.request_security import INVESTMENT_CSRF_SESSION_KEY
from scripts import lstm_ga_tune as ga_runner


def _run_paths(manager: lstm_training.LstmTrainingManager, tmp_path: Path, seed: int = 42):
    args = manager._build_runner_args("NVDA", "1y", seed)
    spec = ga_runner.build_request_spec(args)
    paths = ga_runner.build_run_paths(args, spec)
    paths.state.mkdir(parents=True)
    return paths, spec


def _write_json(path: Path, payload: dict[str, object]) -> None:
    path.write_text(json.dumps(payload), encoding="utf-8")


def test_list_runs_reads_terminal_history_without_touching_market_stores(tmp_path: Path) -> None:
    manager = lstm_training.LstmTrainingManager(tmp_path)
    paths, spec = _run_paths(manager, tmp_path)
    _write_json(paths.request, spec)
    _write_json(paths.status, {
        "status": "completed",
        "phase": "completed",
        "ticker": "NVDA",
        "period": "1y",
        "started_at": "2026-09-04T00:00:00+00:00",
        "updated_at": "2026-09-04T01:00:00+00:00",
        "elapsed_seconds": 3600,
        "generation": 4,
        "evaluated": 128,
        "best": {"holdout_median_hit_rate_pct": 58.25},
    })
    _write_json(paths.result, {
        "completed_at": "2026-09-04T01:00:00+00:00",
        "best": {"holdout_median_hit_rate_pct": 58.25},
    })

    runs = manager.list_runs()

    assert len(runs) == 1
    assert runs[0]["status"] == "completed"
    assert runs[0]["result_available"] is True
    assert runs[0]["best"] == {"holdout_median_hit_rate_pct": 58.25}


def test_start_uses_isolated_runner_process_and_returns_starting_run(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    manager = lstm_training.LstmTrainingManager(tmp_path)
    commands: list[list[str]] = []

    def fake_popen(command, **kwargs):
        commands.append(command)
        assert kwargs["cwd"] == str(lstm_training.PROJECT_ROOT)
        assert kwargs["start_new_session"] is True
        return SimpleNamespace(pid=12345)

    monkeypatch.setattr(lstm_training.subprocess, "Popen", fake_popen)
    monkeypatch.setattr(lstm_training.secrets, "randbelow", lambda _limit: 20260904)

    run = manager.start("nvda", "1y")

    assert run["status"] == "starting"
    assert run["active"] is True
    assert run["ticker"] == "NVDA"
    assert commands[0][0] == lstm_training.sys.executable
    assert "--ticker" in commands[0]
    assert commands[0][commands[0].index("--ticker") + 1] == "NVDA"
    assert "--state-root" in commands[0]


def test_stop_only_signals_a_process_matching_the_runner_seed(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    manager = lstm_training.LstmTrainingManager(tmp_path)
    paths, spec = _run_paths(manager, tmp_path)
    _write_json(paths.request, spec)
    _write_json(paths.status, {
        "status": "running",
        "phase": "evaluate",
        "pid": 321,
        "ticker": "NVDA",
        "period": "1y",
    })
    process_commands: list[list[str]] = []

    def fake_run(command, **_kwargs):
        process_commands.append(command)
        return SimpleNamespace(stdout=f"python {lstm_training.PROJECT_ROOT}/scripts/lstm_ga_tune.py --ga-seed {spec['ga_seed']}\n")

    signalled: list[tuple[int, int]] = []
    monkeypatch.setattr(lstm_training.subprocess, "run", fake_run)
    monkeypatch.setattr(lstm_training.os, "killpg", lambda pid, sig: signalled.append((pid, sig)))

    run = manager.stop(paths.state.name)

    assert run["status"] == "stopping"
    assert run["active"] is True
    assert signalled == [(321, lstm_training.signal.SIGTERM)]
    assert process_commands[0][:3] == ["ps", "-p", "321"]


def test_start_and_stop_endpoints_require_same_origin_csrf_proof(client) -> None:
    response = client.post("/api/lstm-training/start", json={"ticker": "NVDA", "period": "1y"})

    assert response.status_code == 403
    assert response.json["success"] is False


def test_start_endpoint_delegates_validated_request_to_manager(client, monkeypatch: pytest.MonkeyPatch) -> None:
    expected_run = {"id": "lstm-ga-" + ("a" * 24), "ticker": "NVDA", "period": "1y", "status": "starting", "active": True}
    captured: dict[str, str] = {}

    def fake_start(_manager, ticker: str, period: str):
        captured.update({"ticker": ticker, "period": period})
        return expected_run

    monkeypatch.setattr(lstm_training.LstmTrainingManager, "start", fake_start)
    token = "a" * 32
    with client.session_transaction() as browser_session:
        browser_session[INVESTMENT_CSRF_SESSION_KEY] = token

    response = client.post(
        "/api/lstm-training/start",
        json={"ticker": "NVDA", "period": "1y"},
        headers={
            "Origin": "http://localhost",
            "Sec-Fetch-Site": "same-origin",
            "X-CSRF-Token": token,
        },
    )

    assert response.status_code == 202
    assert response.json == {"success": True, "run": expected_run}
    assert captured == {"ticker": "NVDA", "period": "1y"}
