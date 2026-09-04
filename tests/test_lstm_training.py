"""Tests for the durable web-managed LSTM training runs. Code version: v0.6.0."""

from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import pandas as pd
import pytest

from app.services import lstm_training
from app.web.request_security import INVESTMENT_CSRF_SESSION_KEY
from scripts import lstm_ga_tune as ga_runner
from tests.factories.market import ohlc_frame_for_dates


def _run_paths(manager: lstm_training.LstmTrainingManager, tmp_path: Path, seed: int = 42):
    args = manager._build_runner_args("NVDA", "1y", seed)
    spec = ga_runner.build_request_spec(args)
    paths = ga_runner.build_run_paths(args, spec)
    paths.state.mkdir(parents=True)
    return paths, spec


def _write_json(path: Path, payload: dict[str, object]) -> None:
    path.write_text(json.dumps(payload), encoding="utf-8")


def _completed_case(manager, tmp_path, seed=42, started="2026-09-04T00:00:00Z"):
    paths, spec = _run_paths(manager, tmp_path, seed)
    params = ga_runner.validate_selected_params({"use_broker_holding": True, "lstm_seed": 17})
    spec.update({"selected_params": params, "configuration": {
        "initial_capital": 25000, "reinvest_dividends": True, "stop_loss": False,
    }})
    _write_json(paths.request, spec)
    _write_json(paths.snapshot, {"ticker": "NVDA", "start": "2025-09-04", "end": "2026-09-04", "interval": "1d"})
    _write_json(paths.status, {"status": "completed", "started_at": started})
    _write_json(paths.result, {"status": "completed", "best": {
        "params": params, "holdout": {"direction_scored_points": 20, "direction_hit_rate_pct": 65.0},
    }})
    return paths


def test_history_exposes_complete_exact_configuration_and_measured_score(tmp_path):
    manager = lstm_training.LstmTrainingManager(tmp_path)
    _completed_case(manager, tmp_path)
    run = manager.list_runs()[0]
    config = run["configuration"]
    assert run["accuracy_pct"] == 65.0
    assert run["identifier"] == "260904(01)"
    assert config["ticker"] == "NVDA"
    assert config["range"] == "exact"
    assert (config["from"], config["to"], config["interval"]) == ("2025-09-04", "2026-09-04", "1d")
    assert config["initial_capital"] == 25000
    assert config["reinvest_dividends"] is True
    assert config["stop_loss"] is False
    assert config["params"]["lstm_seed"] == 17
    assert config["params"]["use_broker_holding"] is True
    assert len(config["params"]) == 33


def test_delete_is_recoverable_and_does_not_renumber_survivors(tmp_path):
    manager = lstm_training.LstmTrainingManager(tmp_path)
    first = _completed_case(manager, tmp_path)
    second = _completed_case(manager, tmp_path, 43, "2026-09-04T01:00:00Z")
    original = first.result.read_bytes()
    outcome = manager.delete(first.state.name)
    assert outcome["recoverable"] is True
    assert not first.state.exists()
    assert (manager._workspace_root() / ".deleted" / first.state.name / "result.json").read_bytes() == original
    assert [(run["id"], run["identifier"]) for run in manager.list_runs()] == [(second.state.name, "260904(02)")]


def test_delete_rejects_active_locked_and_symlink_runs(tmp_path, monkeypatch):
    manager = lstm_training.LstmTrainingManager(tmp_path)
    paths = _completed_case(manager, tmp_path)
    _write_json(paths.status, {"status": "running", "pid": 321})
    monkeypatch.setattr(manager, "_process_matches", lambda *_args: True)
    with pytest.raises(lstm_training.LstmTrainingConflict, match="Stop training"):
        manager.delete(paths.state.name)
    _write_json(paths.status, {"status": "completed"})
    with ga_runner._run_lock(paths.lock), pytest.raises(RuntimeError, match="run lock"):
        manager.delete(paths.state.name)
    target = tmp_path / "protected"
    target.mkdir()
    link = manager._workspace_root() / ("lstm-ga-" + "f" * 24)
    link.symlink_to(target, target_is_directory=True)
    with pytest.raises(ValueError):
        manager.delete(link.name)
    assert target.exists() and paths.result.exists()
    assert len(manager.list_runs()) == 1


def test_legacy_aggregate_and_missing_snapshot_never_invent_configuration(tmp_path):
    manager = lstm_training.LstmTrainingManager(tmp_path)
    paths = _completed_case(manager, tmp_path)
    saved = json.loads(paths.result.read_text())
    del saved["best"]["params"]["lstm_seed"]
    _write_json(paths.result, saved)
    run = manager.list_runs()[0]
    assert run["configuration"] is None
    assert "single-seed" in run["configuration_error"]
    assert run["accuracy_pct"] == 65.0


def test_history_restores_actual_data_dates_without_erasing_requested_period(tmp_path):
    manager = lstm_training.LstmTrainingManager(tmp_path)
    paths = _completed_case(manager, tmp_path)
    snapshot = json.loads(paths.snapshot.read_text())
    snapshot["visible_rows"] = [{"Date": "2026-04-02T00:00:00"}, {"Date": "2026-09-03T00:00:00"}]
    _write_json(paths.snapshot, snapshot)
    run = manager.list_runs()[0]
    assert run["configuration"]["from"] == "2026-04-02"
    assert run["configuration"]["to"] == "2026-09-03"
    assert run["configuration"]["period"] == "1y"
    assert run["requested_range"] == {"from": "2025-09-04", "to": "2026-09-04"}


def test_delete_endpoint_requires_csrf_and_delegates_one_id(client, monkeypatch):
    assert client.post("/api/lstm-training/delete", json={"run_id": "a"}).status_code == 403
    token = "c" * 32
    with client.session_transaction() as session:
        session[INVESTMENT_CSRF_SESSION_KEY] = token
    called = []
    def archive(_manager, run_id):
        called.append(run_id)
        return {"id": run_id, "recoverable": True}
    monkeypatch.setattr(lstm_training.LstmTrainingManager, "delete", archive)
    response = client.post("/api/lstm-training/delete", json={"run_id": "lstm-ga-" + "a" * 24}, headers={
        "Origin": "http://localhost", "Sec-Fetch-Site": "same-origin", "X-CSRF-Token": token,
    })
    assert response.status_code == 200
    assert called == ["lstm-ga-" + "a" * 24]
    assert response.json["recoverable"] is True


def test_training_configuration_validates_exact_dates_and_settings():
    config = ga_runner.validate_training_configuration({"range": "exact", "from": "2025-09-04", "to": "2026-09-04", "initial_capital": 23000})
    assert config["from"] == "2025-09-04"
    assert config["initial_capital"] == 23000
    for value in ({"initial_capital": "nan"}, {"range": "exact", "from": "2026-09-04", "to": "2025-09-04"}, {"stop_loss": "maybe"}):
        with pytest.raises(ValueError):
            ga_runner.validate_training_configuration(value)


def test_web_launch_reservation_is_claimed_once_without_implicit_resume(tmp_path, monkeypatch):
    manager = lstm_training.LstmTrainingManager(tmp_path)
    commands = []
    monkeypatch.setattr(manager, "_process_matches", lambda *_args: False)
    monkeypatch.setattr(lstm_training.subprocess, "Popen", lambda command, **_kwargs: commands.append(command) or SimpleNamespace(pid=123))
    run = manager.start("NVDA", "1y", {}, interval="1d")
    command = commands[0]
    args = ga_runner._build_parser().parse_args(command[2:])
    assert "--resume" not in command
    assert Path(args.prepared_request).parent.name == run["id"]
    reached = []
    monkeypatch.setattr(ga_runner, "_build_snapshot", lambda *_args: (None, {}))
    monkeypatch.setattr(ga_runner, "_run_selected_configuration", lambda spec, paths, context: reached.append(paths.state.name) or 0)
    assert ga_runner._run(args) == 0
    assert reached == [run["id"]]
    with pytest.raises(FileExistsError):
        ga_runner._run(args)
    args.prepared_request = None
    with pytest.raises(RuntimeError, match="use --resume"):
        ga_runner._run(args)


def test_startup_failure_is_reported_without_rewriting_saved_history(tmp_path, monkeypatch):
    manager = lstm_training.LstmTrainingManager(tmp_path)
    paths, spec = _run_paths(manager, tmp_path)
    _write_json(paths.request, spec)
    _write_json(paths.state / "launch.json", {"pid": 123})
    paths.log.write_text("lstm_ga_tune failed: RuntimeError: worker startup failure\n")
    monkeypatch.setattr(manager, "_process_matches", lambda *_args: False)
    original = paths.log.read_bytes()
    run = manager._read_run(paths.state)
    assert run["status"] == "failed_closed"
    assert "worker startup failure" in run["error"]
    assert paths.log.read_bytes() == original
    assert not paths.status.exists()


def test_windows_process_identity_uses_cim_and_exact_seed(tmp_path, monkeypatch):
    manager = lstm_training.LstmTrainingManager(tmp_path)
    calls = []
    command_line = "python lstm_ga_tune.py --ga-seed 420 --ticker NVDA"
    def process(command, **_kwargs):
        calls.append(command)
        return SimpleNamespace(stdout=command_line)
    monkeypatch.setattr(lstm_training, "os", SimpleNamespace(name="nt"))
    monkeypatch.setattr(lstm_training.subprocess, "run", process)
    assert not manager._process_matches(321, {"ga_seed": 42})
    assert manager._process_matches(321, {"ga_seed": 420})
    assert calls[0][:3] == ["powershell", "-NoProfile", "-NonInteractive"]
    assert "ProcessId = 321" in calls[0][-1]


def test_exact_training_cli_receives_dates_and_general_settings(tmp_path, monkeypatch):
    manager = lstm_training.LstmTrainingManager(tmp_path)
    captured = []
    monkeypatch.setattr(manager, "_process_matches", lambda *_args: False)
    monkeypatch.setattr(lstm_training.subprocess, "Popen", lambda command, **_kwargs: captured.append(command) or SimpleNamespace(pid=123))
    config = {"range": "exact", "from": "2026-03-04", "to": "2026-07-14", "initial_capital": 25000, "stop_loss": False}
    run = manager.start("DRAM", "6mo", {}, interval="1d", configuration=config)
    sent = json.loads(captured[0][captured[0].index("--configuration") + 1])
    assert sent == ga_runner.validate_training_configuration(config)
    paths = manager._paths_for_run_id(run["id"])
    assert json.loads(paths.request.read_text())["minimum_training_seconds"] == 60
    assert json.loads(paths.request.read_text())["configuration"] == sent


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
    run = manager.start("dram", "6mo", selected, interval="1d")

    assert run["status"] == "starting"
    assert run["active"] is True
    assert run["ticker"] == "DRAM"
    assert run["period"] == "6mo"
    assert run["interval"] == "1d"
    assert commands[0][0] == lstm_training.sys.executable
    assert "--ticker" in commands[0]
    assert commands[0][commands[0].index("--ticker") + 1] == "DRAM"
    assert commands[0][commands[0].index("--period") + 1] == "6mo"
    assert commands[0][commands[0].index("--interval") + 1] == "1d"
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

    def fake_start(_manager, ticker: str, period: str, params, interval):
        captured.update({"ticker": ticker, "period": period, "params": params, "interval": interval})
        return expected_run

    monkeypatch.setattr(lstm_training.LstmTrainingManager, "start", fake_start)
    token = "a" * 32
    with client.session_transaction() as browser_session:
        browser_session[INVESTMENT_CSRF_SESSION_KEY] = token

    response = client.post(
        "/api/lstm-training/start",
        json={"ticker": "NVDA", "period": "1y", "interval": "1d", "params": {"lstm_epochs": 3}},
        headers={
            "Origin": "http://localhost",
            "Sec-Fetch-Site": "same-origin",
            "X-CSRF-Token": token,
        },
    )

    assert response.status_code == 202
    assert response.json == {"success": True, "run": expected_run}
    assert captured == {"ticker": "NVDA", "period": "1y", "interval": "1d", "params": {"lstm_epochs": 3}}


@pytest.mark.parametrize("interval", [None, "1m"])
def test_start_endpoint_rejects_unsupported_interval_before_launch(client, monkeypatch, interval):
    def forbidden(*_args, **_kwargs):
        pytest.fail("Invalid interval must not reach process launch")
    monkeypatch.setattr(lstm_training.subprocess, "Popen", forbidden)
    token = "b" * 32
    with client.session_transaction() as browser_session:
        browser_session[INVESTMENT_CSRF_SESSION_KEY] = token
    payload = {"ticker": "DRAM", "period": "6mo", "params": {"lstm_epochs": 3}}
    if interval is not None:
        payload["interval"] = interval
    response = client.post("/api/lstm-training/start", json=payload, headers={
        "Origin": "http://localhost", "Sec-Fetch-Site": "same-origin", "X-CSRF-Token": token,
    })
    assert response.status_code == 400
    assert "requires Interval 1d" in response.json["error"]


@pytest.mark.parametrize("params", [None, [], {"unknown": 1}, {"lstm_epochs": "nan"}, {"lstm_epochs": 1.5}, {"compute_backend": "bogus"}, {"use_broker_holding": "maybe"}])
def test_invalid_selection_never_launches(params, tmp_path, monkeypatch):
    def forbidden(*_args, **_kwargs):
        pytest.fail("Invalid selection must not launch a process")
    monkeypatch.setattr(lstm_training.subprocess, "Popen", forbidden)
    with pytest.raises(ValueError):
        lstm_training.LstmTrainingManager(tmp_path).start("NVDA", "1y", params, interval="1d")
    assert list(tmp_path.iterdir()) == []


@pytest.mark.parametrize("interval", ["", "1m", "5m", None])
def test_unsupported_interval_never_launches_or_creates_state(interval, tmp_path, monkeypatch):
    def forbidden(*_args, **_kwargs):
        pytest.fail("Unsupported intervals must not launch a process")
    monkeypatch.setattr(lstm_training.subprocess, "Popen", forbidden)
    with pytest.raises(ValueError, match="requires Interval 1d"):
        lstm_training.LstmTrainingManager(tmp_path).start("DRAM", "6mo", {}, interval=interval)
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


@pytest.mark.parametrize("exact", [False, True])
def test_snapshot_uses_requested_market_window_and_selected_parameters(tmp_path, monkeypatch, exact):
    manager = lstm_training.LstmTrainingManager(tmp_path)
    args = manager._build_runner_args("DRAM", "6mo", 42)
    args.selected_params = {"use_option_total_volume": True, "lstm_epochs": 3, "lstm_seed": 17}
    spec = ga_runner.build_request_spec(args)
    paths = ga_runner.build_run_paths(args, spec)
    paths.state.mkdir(parents=True)
    frame = ohlc_frame_for_dates("DRAM", pd.bdate_range("2026-01-01", periods=120).strftime("%Y-%m-%d").tolist())
    start, end = frame.Date.iloc[10].date(), frame.Date.iloc[-1].date()
    if exact:
        args.configuration = {"range": "exact", "from": start.isoformat(), "to": end.isoformat()}
    bundle = {
        "symbol": "DRAM.US", "fingerprint": "provider-evidence",
        "source_commands": ["provider evidence from isolated test double"],
        "factor_status": {"ohlcv": "available"},
        "ohlcv": [{
            "observed_at": row.Date.isoformat(), "open": row.Open, "high": row.High,
            "low": row.Low, "close": row.Close, "volume": 1000, "source": "isolated-test-provider",
        } for row in frame.itertuples()],
    }
    observed = []
    def date_bounds(period):
        assert not exact, "Exact training must not substitute a rolling relative period"
        assert period == "6mo"
        return start, end
    def load(strategy, tickers, **kwargs):
        observed.append((tickers, kwargs))
        strategy._warmup_bundle = bundle
        return [frame]
    monkeypatch.setattr(ga_runner, "_date_bounds", date_bounds)
    monkeypatch.setattr(ga_runner.LSTMPriceFieldStrategy, "load_market_datasets", load)
    context, snapshot = ga_runner._build_snapshot(args, paths)
    assert observed == [(('DRAM',), {"interval": "1d", "start": start, "end": end, "params": spec["selected_params"]})]
    assert context.interval == snapshot["interval"] == "1d"
    assert snapshot["ticker"] == "DRAM"
    assert snapshot["period"] == "6mo"
    assert snapshot["bundle"]["ohlcv"] == bundle["ohlcv"]
    assert context.visible_frame.Close.tolist() == frame.Close.iloc[10:].tolist()
    assert snapshot["bundle"]["source_commands"] == bundle["source_commands"]


def test_missing_provider_data_never_falls_back_to_demo_rows(tmp_path, monkeypatch):
    manager = lstm_training.LstmTrainingManager(tmp_path)
    args = manager._build_runner_args("DRAM", "6mo", 42)
    args.selected_params = {}
    paths = ga_runner.build_run_paths(args, ga_runner.build_request_spec(args))
    monkeypatch.setattr(ga_runner.LSTMPriceFieldStrategy, "load_market_datasets", lambda *_args, **_kwargs: [])
    with pytest.raises(ValueError, match="did not return a factor bundle"):
        ga_runner._build_snapshot(args, paths)
    assert not paths.snapshot.exists()


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
