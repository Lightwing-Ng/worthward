"""Isolated generic probability training contracts. Code version: v1.2.0."""

from __future__ import annotations

import hashlib
import json
from types import SimpleNamespace

import pytest
import pandas as pd

from app.services import price_field_training as training
from app.web.request_security import INVESTMENT_CSRF_SESSION_KEY
from tests.factories.market import ohlc_frame_for_dates

FRONTIER_STRATEGIES = (
    "itransformer-price-field", "tide-price-field", "moderntcn-price-field", "tft-price-field",
)
STRATEGIES = (
    "patchtst-price-field", "tsmixer-price-field", "nhits-price-field", "timexer-price-field",
    *FRONTIER_STRATEGIES,
)


def complete_diagnostics():
    return {"probability_score_pct": 55.25, "horizon_count": 20, "valid_pairs": 200, "eligible_pairs": 200,
            "horizons": {str(horizon): {"valid_pairs": 10, "eligible_pairs": 10, "brier_loss": 0.4475}
                         for horizon in range(1, 21)}}


@pytest.fixture
def prepared_manager(tmp_path, monkeypatch):
    manager = training.PriceFieldTrainingManager(tmp_path / "compute")
    commands = []
    monkeypatch.setattr(training.subprocess, "Popen", lambda command, **kwargs: (
        commands.append((command, kwargs)) or SimpleNamespace(pid=123456)
    ))
    monkeypatch.setattr(manager, "process_matches", lambda *_args: True)
    return manager, commands


@pytest.mark.parametrize("strategy_id", STRATEGIES)
def test_each_strategy_launches_exact_configuration_and_owns_its_state(prepared_manager, strategy_id):
    manager, commands = prepared_manager
    run = manager.start(strategy_id, "NVDA", "2y", {}, interval="1d",
                        configuration={"range": "exact", "from": "2024-09-04", "to": "2026-09-04"})
    request = training.read_json(manager._path(run["id"]) / "request.json")
    assert request["strategy"] == strategy_id
    assert request["interval"] == "1d"
    assert request["configuration"]["from"] == "2024-09-04"
    assert request["params"]["compute_backend"] == "Auto"
    assert "seed" in request["params"] and "lstm_seed" not in request["params"]
    assert commands[0][1]["start_new_session"] is True
    assert "price_field_train.py" in commands[0][0][2]
    assert "--run-token" in commands[0][0]
    assert len(manager.list_runs(strategy_id)) == 1
    assert manager.list_runs("timexer-price-field" if strategy_id != "timexer-price-field" else "patchtst-price-field") == []


@pytest.mark.parametrize("params", [None, [], {"unknown": 1}, {"epochs": 1.5}, {"learning_rate": "nan"}, {"compute_backend": "invalid"}])
def test_invalid_parameters_create_no_job(tmp_path, monkeypatch, params):
    monkeypatch.setattr(training.subprocess, "Popen", lambda *_a, **_k: pytest.fail("Unexpected launch"))
    manager = training.PriceFieldTrainingManager(tmp_path / "compute")
    with pytest.raises(ValueError):
        manager.start("patchtst-price-field", "NVDA", "2y", params, interval="1d")
    assert not manager.workspace_root().exists()


def test_legacy_lstm_and_minute_training_are_not_silently_converted(tmp_path):
    manager = training.PriceFieldTrainingManager(tmp_path)
    with pytest.raises(ValueError, match="does not support"):
        manager.start("lstm-price-field", "NVDA", "2y", {}, interval="1d")
    with pytest.raises(ValueError, match="Interval 1d"):
        manager.start("patchtst-price-field", "NVDA", "2y", {}, interval="1m")


@pytest.mark.parametrize("strategy_id", STRATEGIES)
def test_history_requires_both_completion_artifacts_and_preserves_archives(prepared_manager, strategy_id):
    manager, _commands = prepared_manager
    run = manager.start(strategy_id, "NVDA", "2y", {}, interval="1d")
    path = manager._path(run["id"])
    training.write_json(path / "status.json", {"status": "completed"})
    assert manager.read_run(path)["status"] == "failed"
    request = training.read_json(path / "request.json")
    result = {"status": "completed", "diagnostics": complete_diagnostics(),
              "configuration": {"strategy": strategy_id, "ticker": "NVDA", "period": "2y", "interval": "1d",
                                "range": "exact", "params": request["params"], "from": "2024-09-04", "to": "2026-09-04"}}
    training.write_json(path / "result.json", result)
    assert manager.read_run(path)["probability_score_pct"] == 55.25
    assert manager.read_run(path)["accuracy_pct"] is None
    assert manager.read_run(path)["result_available"] is True
    result_bytes = (path / "result.json").read_bytes()
    assert manager.delete(run["id"])["recoverable"] is True
    assert (path.parent / ".deleted" / path.name / "result.json").read_bytes() == result_bytes
    assert manager.list_runs() == []


@pytest.mark.parametrize("strategy_id", FRONTIER_STRATEGIES)
def test_new_model_history_cannot_restore_another_models_complete_configuration(prepared_manager, strategy_id):
    manager, _commands = prepared_manager
    run = manager.start(strategy_id, "NVDA", "2y", {}, interval="1d")
    path = manager._path(run["id"])
    request = training.read_json(path / "request.json")
    other_strategy = "tft-price-field" if strategy_id != "tft-price-field" else "itransformer-price-field"
    result = {
        "status": "completed", "diagnostics": complete_diagnostics(),
        "configuration": {
            "strategy": other_strategy, "ticker": "NVDA", "period": "2y", "interval": "1d",
            "range": "exact", "params": request["params"], "from": "2024-09-04", "to": "2026-09-04",
        },
    }
    training.write_json(path / "status.json", {"status": "completed"})
    training.write_json(path / "result.json", result)
    restored = manager.read_run(path)
    assert restored["status"] == "failed"
    assert restored["result_available"] is False
    assert restored["configuration"] is None
    assert restored["probability_score_pct"] is None
    assert "matching configuration" in restored["error"]
    assert manager.list_runs(other_strategy) == []
    assert len(manager.list_runs(strategy_id)) == 1


@pytest.mark.parametrize("corruption", [
    "missing", "not_a_mapping", "nan", "infinity", "negative", "too_high", "text_score",
    "partial_horizons", "missing_horizon", "unobserved_horizon", "invalid_loss", "count_mismatch", "wrong_weighting",
])
def test_corrupted_or_partial_results_cannot_be_selected_as_completed(prepared_manager, corruption):
    manager, _commands = prepared_manager
    run = manager.start("patchtst-price-field", "NVDA", "2y", {}, interval="1d")
    path = manager._path(run["id"])
    request = training.read_json(path / "request.json")
    diagnostics = complete_diagnostics()
    bad_scores = {"nan": float("nan"), "infinity": float("inf"), "negative": -1, "too_high": 101, "text_score": "55.25"}
    if corruption == "missing":
        diagnostics = None
    elif corruption == "not_a_mapping":
        diagnostics = []
    elif corruption in bad_scores:
        diagnostics["probability_score_pct"] = bad_scores[corruption]
    elif corruption == "partial_horizons":
        diagnostics["horizon_count"] = 19
    elif corruption == "missing_horizon":
        del diagnostics["horizons"]["20"]
    elif corruption == "unobserved_horizon":
        diagnostics["horizons"]["20"]["valid_pairs"] = 0
    elif corruption == "invalid_loss":
        diagnostics["horizons"]["20"]["brier_loss"] = None
    elif corruption == "count_mismatch":
        diagnostics["valid_pairs"] = 0
    elif corruption == "wrong_weighting":
        diagnostics["horizons"]["20"]["brier_loss"] = 0.8
    result = {"status": "completed", "diagnostics": diagnostics,
              "configuration": {**request["configuration"], "strategy": request["strategy"], "ticker": "NVDA",
                                "period": "2y", "interval": "1d", "range": "exact", "params": request["params"],
                                "from": "2024-09-04", "to": "2026-09-04"}}
    training.write_json(path / "status.json", {"status": "completed", "phase": "completed"})
    # Simulate corrupted external artifacts in the isolated compute root;
    # the production writer already refuses non-finite JSON values.
    (path / "result.json").write_text(json.dumps(result), encoding="utf-8")
    restored = manager.read_run(path)
    assert restored["status"] == restored["phase"] == "failed"
    assert restored["result_available"] is False
    assert restored["configuration"] is restored["probability_score_pct"] is None
    assert restored["diagnostics"] == {} and restored["completed_at"] == ""
    assert restored["configuration_error"] == restored["error"]
    assert restored["error"]


def test_conflicting_active_jobs_and_symlink_archives_are_rejected(prepared_manager):
    manager, _commands = prepared_manager
    run = manager.start("patchtst-price-field", "NVDA", "2y", {}, interval="1d")
    with pytest.raises(training.PriceFieldTrainingConflict):
        manager.start("tsmixer-price-field", "QQQ", "2y", {}, interval="1d")
    with pytest.raises(training.PriceFieldTrainingConflict):
        manager.delete(run["id"])
    path = manager._path(run["id"])
    training.write_json(path / "status.json", {"status": "stopped"})
    (path.parent / ".deleted").symlink_to(path, target_is_directory=True)
    with pytest.raises(ValueError, match="archive"):
        manager.delete(run["id"])


@pytest.mark.parametrize("strategy_id", STRATEGIES)
def test_stop_verifies_process_group_and_escalates_only_owned_process(prepared_manager, monkeypatch, strategy_id):
    manager, _commands = prepared_manager
    run = manager.start(strategy_id, "NVDA", "2y", {}, interval="1d")
    kills = []
    monkeypatch.setattr(training.os, "getpgid", lambda pid: pid)
    monkeypatch.setattr(training.os, "killpg", lambda pid, sig: kills.append((pid, sig)))
    monotonic = iter((0, 3))
    monkeypatch.setattr(training.time, "monotonic", lambda: next(monotonic))
    result = manager.stop(run["id"])
    assert [sig for _pid, sig in kills] == [training.signal.SIGTERM, training.signal.SIGKILL]
    assert {pid for pid, _sig in kills} == {123456}
    assert result["status"] == "stopped" and not result["active"]


def test_process_identity_rejects_unrelated_python(prepared_manager, monkeypatch):
    manager, _commands = prepared_manager
    path = manager.workspace_root()
    monkeypatch.setattr(training.subprocess, "run", lambda *_a, **_k: SimpleNamespace(stdout="python other.py --run-token abc"))
    assert not training.PriceFieldTrainingManager.process_matches(123, path, "abc")


@pytest.mark.parametrize("strategy_id", STRATEGIES)
def test_training_api_csrf_and_strategy_dispatch(client, monkeypatch, strategy_id):
    captured = []
    monkeypatch.setattr(training.PriceFieldTrainingManager, "start", lambda _self, **kwargs: captured.append(kwargs) or {"id": "run"})
    payload = {"strategy": strategy_id, "ticker": "NVDA", "period": "2y", "interval": "1d", "params": {"epochs": 2}}
    assert client.post("/api/price-field-training/start", json=payload).status_code == 403
    token = "p" * 32
    with client.session_transaction() as session:
        session[INVESTMENT_CSRF_SESSION_KEY] = token
    response = client.post("/api/price-field-training/start", json=payload,
                           headers={"Origin": "http://localhost", "X-CSRF-Token": token})
    assert response.status_code == 202
    assert captured[0]["strategy_id"] == strategy_id
    assert captured[0]["params"] == {"epochs": 2}
    assert "no-store" in response.headers["Cache-Control"]


def test_compute_history_read_preserves_production_ledger(tmp_path):
    protected = training.PROJECT_ROOT / "settings_store/investment.parquet"
    before = hashlib.sha256(protected.read_bytes()).hexdigest() if protected.is_file() else None
    assert training.PriceFieldTrainingManager(tmp_path).list_runs() == []
    after = hashlib.sha256(protected.read_bytes()).hexdigest() if protected.is_file() else None
    assert after == before


@pytest.mark.parametrize("strategy_id", ("tsmixer-price-field", *FRONTIER_STRATEGIES))
def test_exact_worker_trains_real_cpu_model_with_isolated_market_snapshot(tmp_path, monkeypatch, strategy_id):
    pytest.importorskip("torch")
    from scripts import price_field_train, price_field_runtime
    from strategies.neural_price_field import NeuralPriceFieldStrategy

    frame = ohlc_frame_for_dates("NVDA", pd.bdate_range("2025-01-02", periods=110).strftime("%Y-%m-%d").tolist())
    frame["Volume"] = [1_000_000 + 1_000 * index for index in range(len(frame))]
    rows = frame.rename(columns={"Date": "observed_at", "Open": "open", "High": "high", "Low": "low",
                                 "Close": "close", "Volume": "volume"}).to_dict(orient="records")
    for row in rows:
        row["observed_at"] = row["observed_at"].isoformat()
    benchmarks = {"QQQ": [{"observed_at": row["observed_at"], "close": row["close"]} for row in rows]}

    def load(strategy, tickers, **kwargs):
        assert tickers == ("NVDA",)
        assert kwargs["interval"] == "1d"
        strategy._warmup_bundle = {"ohlcv": rows, "symbol": "NVDA.US", "factor_status": {},
                                  "benchmarks": benchmarks, "benchmark_status": {"QQQ": "available"}}
        return [frame]

    monkeypatch.setattr(NeuralPriceFieldStrategy, "load_market_datasets", load)
    monkeypatch.setattr(price_field_runtime, "ensure_price_field_runtime", lambda *_args: None)
    params = training.validate_parameters(training.training_strategy(strategy_id), {
        "compute_backend": "CPU", "lookback": 8, "hidden_size": 8,
        "epochs": 1, "training_window": 64, "retrain_interval": 20,
        "use_benchmark_qqq_return": True,
    })
    request = {"strategy": strategy_id, "ticker": "NVDA", "period": "2y", "interval": "1d",
               "params": params, "run_token": "owned-worker-test", "started_at": "2026-09-07T00:00:00Z",
               "configuration": {"range": "exact", "from": "2025-01-02", "to": "2025-06-30"}}
    path = tmp_path / "request.json"
    training.write_json(path, request)
    result = price_field_train.run(path, request["run_token"])
    assert result["status"] == "completed"
    assert result["device"]["resolved"] == "cpu"
    assert result["diagnostics"]["valid_pairs"] > 0
    assert result["diagnostics"]["horizon_count"] == 20
    assert result["configuration"]["strategy"] == strategy_id
    assert result["configuration"]["params"] == params
    assert result["configuration"]["to"] == frame["Date"].max().date().isoformat()
    assert training.read_json(tmp_path / "status.json")["status"] == "completed"
    assert training.read_json(tmp_path / "snapshot.json")["bundle"]["ohlcv"] == rows
    assert training.read_json(tmp_path / "snapshot.json")["bundle"]["benchmarks"] == benchmarks
    assert training.read_json(tmp_path / "snapshot.json")["bundle"]["benchmark_status"] == {"QQQ": "available"}
    restored = training.PriceFieldTrainingManager(tmp_path / "compute").read_run(tmp_path)
    assert restored["status"] == "completed" and restored["result_available"] is True
    assert {key: restored["configuration"][key] for key in result["configuration"]} == result["configuration"]
    assert restored["selected_params"] == params
    assert restored["probability_score_pct"] == result["diagnostics"]["probability_score_pct"]
    assert restored["diagnostics"] == result["diagnostics"]
    assert restored["device"] == result["device"]
    # A short visible range can have valid next-day scores without observed
    # outcomes for all 20 horizons; it must not become durable completed history.
    partial_path = tmp_path / "partial"
    partial_path.mkdir()
    partial_request = {**request, "configuration": {**request["configuration"],
                       "from": frame["Date"].iloc[-30].date().isoformat()}}
    training.write_json(partial_path / "request.json", partial_request)
    with pytest.raises(ValueError, match="Insufficient scoring window"):
        price_field_train.run(partial_path / "request.json", request["run_token"])
    assert training.read_json(partial_path / "status.json")["status"] == "failed"
    assert not (partial_path / "result.json").exists()
    # A standalone worker must classify cancellation inside an optimizer step
    # correctly even when no web manager exists to rewrite its terminal state.
    from strategies import neural_price_field_compute as engine
    cancelled_path = tmp_path / "cancelled"
    cancelled_path.mkdir()
    training.write_json(cancelled_path / "request.json", request)
    original_train = engine._train_model

    def stop_in_optimizer(*args, **kwargs):
        training.write_json(cancelled_path / "stop-request.json", {"requested": True})
        return original_train(*args, **kwargs)

    monkeypatch.setattr(engine, "_train_model", stop_in_optimizer)
    with pytest.raises(engine.NeuralTrainingCancelled):
        price_field_train.run(cancelled_path / "request.json", request["run_token"])
    assert training.read_json(cancelled_path / "status.json")["status"] == "stopped"
    assert not (cancelled_path / "result.json").exists()
