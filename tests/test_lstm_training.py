"""Tests for the durable web-managed LSTM training runs. Code version: v0.3.0."""

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
    assert runs[0]["progress"]["percent"] == 100
    assert {item["name"] for item in runs[0]["files"]} == {"request.json", "status.json", "result.json"}
    assert all(item["size_bytes"] > 0 for item in runs[0]["files"])


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
    monkeypatch.setattr(manager, "_process_matches", lambda *_args: True)

    selected = {"use_broker_holding": True, "lstm_epochs": 3, "lstm_seed": 17}
    run = manager.start("nvda", "1y", selected)

    assert run["status"] == "starting"
    assert run["active"] is True
    assert run["ticker"] == "NVDA"
    assert commands[0][0] == lstm_training.sys.executable
    assert "--ticker" in commands[0]
    assert commands[0][commands[0].index("--ticker") + 1] == "NVDA"
    assert "--state-root" in commands[0]
    submitted = json.loads(commands[0][commands[0].index("--selected-params") + 1])
    assert submitted == ga_runner.validate_selected_params(selected)
    assert run["selected_params"] == submitted


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


def test_launch_stays_active_before_runner_writes_request(tmp_path, monkeypatch):
    manager = lstm_training.LstmTrainingManager(tmp_path)
    paths, spec = _run_paths(manager, tmp_path)
    _write_json(paths.state / "launch.json", {"pid": 321, "ticker": "NVDA", "ga_seed": spec["ga_seed"]})
    monkeypatch.setattr(manager, "_process_matches", lambda pid, identity: pid == 321 and identity.get("ga_seed") == spec["ga_seed"])
    signalled = []
    monkeypatch.setattr(lstm_training.os, "killpg", lambda pid, sig: signalled.append((pid, sig)))
    assert manager.list_runs()[0]["active"] is True
    assert manager.stop(paths.state.name)["status"] == "stopping"
    assert len(signalled) == 1


def test_start_and_stop_endpoints_require_same_origin_csrf_proof(client) -> None:
    response = client.post("/api/lstm-training/start", json={"ticker": "NVDA", "period": "1y"})

    assert response.status_code == 403
    assert response.json["success"] is False


def test_start_endpoint_delegates_validated_request_to_manager(client, monkeypatch: pytest.MonkeyPatch) -> None:
    expected_run = {"id": "lstm-ga-" + ("a" * 24), "ticker": "NVDA", "period": "1y", "status": "starting", "active": True}
    captured: dict[str, str] = {}

    def fake_start(_manager, ticker: str, period: str, params):
        captured.update({"ticker": ticker, "period": period, "params": params})
        return expected_run

    monkeypatch.setattr(lstm_training.LstmTrainingManager, "start", fake_start)
    token = "a" * 32
    with client.session_transaction() as browser_session:
        browser_session[INVESTMENT_CSRF_SESSION_KEY] = token

    response = client.post(
        "/api/lstm-training/start",
        json={"ticker": "NVDA", "period": "1y", "params": {"lstm_epochs": 3}},
        headers={
            "Origin": "http://localhost",
            "Sec-Fetch-Site": "same-origin",
            "X-CSRF-Token": token,
        },
    )

    assert response.status_code == 202
    assert response.json == {"success": True, "run": expected_run}
    assert captured == {"ticker": "NVDA", "period": "1y", "params": {"lstm_epochs": 3}}


@pytest.mark.parametrize("params", [None, [], {"unknown": 1}, {"lstm_epochs": "nan"}, {"lstm_epochs": 1.5}, {"compute_backend": "bogus"}, {"use_broker_holding": "maybe"}])
def test_invalid_selection_never_launches(params, tmp_path, monkeypatch):
    def forbidden(*_args, **_kwargs):
        pytest.fail("Invalid selection must not launch a process")
    monkeypatch.setattr(lstm_training.subprocess, "Popen", forbidden)
    with pytest.raises(ValueError):
        lstm_training.LstmTrainingManager(tmp_path).start("NVDA", "1y", params)
    assert list(tmp_path.iterdir()) == []


def test_selected_configuration_reaches_evaluation_unchanged(tmp_path, monkeypatch):
    manager = lstm_training.LstmTrainingManager(tmp_path)
    args = manager._build_runner_args("NVDA", "1y", 42)
    args.selected_params = {"use_broker_holding": True, "lstm_epochs": 3}
    spec = ga_runner.build_request_spec(args)
    paths = ga_runner.build_run_paths(args, spec)
    paths.state.mkdir(parents=True)
    context = SimpleNamespace(snapshot_fingerprint="selection-test", active_factor_keys=())
    observed = []
    def evaluate(candidate, actual_context, progress=None):
        assert actual_context is context
        observed.append(candidate["params"])
        progress(25, 100)
        assert json.loads(paths.status.read_text())["progress"] == {"completed": 25, "total": 100, "unit": "origins"}
        return {**candidate, "status": "ok"}
    monkeypatch.setattr(ga_runner, "_evaluate_signal_result", evaluate)
    monkeypatch.setattr(ga_runner, "_build_snapshot", lambda *_args: (context, {}))
    def forbidden(*_args, **_kwargs):
        pytest.fail("Selected configuration must bypass GA population generation")
    monkeypatch.setattr(ga_runner, "_new_population", forbidden)
    assert ga_runner._run(args) == 0
    assert observed == [spec["selected_params"]]
    assert observed[0]["use_broker_holding"] is True
    assert observed[0]["lstm_epochs"] == 3
    assert json.loads(paths.result.read_text())["request"]["selected_params"] == observed[0]
    assert json.loads(paths.result.read_text())["progress"]["completed"] == 100
    other = dict(spec, selected_params=dict(observed[0], lstm_epochs=4))
    assert ga_runner.build_run_paths(args, other).state != paths.state


@pytest.mark.parametrize("outcome", ["failed_closed", "interrupted", "time_budget_reached"])
def test_selected_configuration_records_terminal_state(tmp_path, monkeypatch, outcome):
    manager = lstm_training.LstmTrainingManager(tmp_path)
    args = manager._build_runner_args("NVDA", "1y", 42)
    args.selected_params = {"lstm_epochs": 3}
    spec = ga_runner.build_request_spec(args)
    paths = ga_runner.build_run_paths(args, spec)
    paths.state.mkdir(parents=True)
    context = SimpleNamespace(snapshot_fingerprint="terminal-test", active_factor_keys=())
    previous_handler = ga_runner.signal.getsignal(ga_runner.signal.SIGTERM)
    def evaluate(candidate, _context, progress=None):
        progress(25, 100)
        if outcome != "failed_closed":
            number = ga_runner.signal.SIGTERM if outcome == "interrupted" else ga_runner.signal.SIGALRM
            ga_runner.signal.getsignal(number)(number, None)
        return {**candidate, "status": "failed_closed", "error": "Unavailable training data"}
    monkeypatch.setattr(ga_runner, "_evaluate_signal_result", evaluate)
    if outcome == "interrupted":
        with pytest.raises(KeyboardInterrupt):
            ga_runner._run_selected_configuration(spec, paths, context)
    else:
        assert ga_runner._run_selected_configuration(spec, paths, context) == 1
    assert json.loads(paths.status.read_text())["status"] == outcome
    assert json.loads(paths.status.read_text())["progress"]["completed"] == 25
    assert ga_runner.signal.getsignal(ga_runner.signal.SIGTERM) == previous_handler
    assert ga_runner.signal.getitimer(ga_runner.signal.ITIMER_REAL)[0] == 0


@pytest.mark.parametrize("progress, expected", [
    ({"completed": 25, "total": 100}, 25.0),
    (None, None),
    ({"completed": 0, "total": 0}, None),
    ({"completed": -1, "total": 100}, None),
    ({"completed": 101, "total": 100}, None),
    ({"completed": True, "total": 100}, None),
    ({"completed": "25", "total": 100}, None),
])
def test_progress_uses_actual_work_not_elapsed_budget(progress, expected):
    result = lstm_training.LstmTrainingManager._progress_summary({
        "progress": progress, "elapsed_seconds": 21_600, "duration_seconds": 43_200,
    }, "running")
    assert result["percent"] == expected


def test_training_files_exclude_unknown_files_and_symlinks(tmp_path):
    (tmp_path / "result.json").write_text("{}")
    (tmp_path / "secret.json").write_text("{}")
    (tmp_path / "snapshot.json").symlink_to(tmp_path / "secret.json")
    assert lstm_training.LstmTrainingManager._training_files(tmp_path) == [
        {"name": "result.json", "size_bytes": 2},
    ]


def test_lstm_parameter_labels_use_sentence_case():
    labels = {item.key: item.label for item in ga_runner.LSTMPriceFieldStrategy().get_parameter_definitions()}
    assert labels["cell_display_threshold"] == "Cell display threshold (%)"
    assert labels["compute_backend"] == "Compute backend"
    assert labels["lstm_learning_rate"] == "LSTM learning rate"
    assert labels["use_broker_holding"] == "Broker holding"
    assert labels["use_option_total_open_interest"] == "Total OI"
