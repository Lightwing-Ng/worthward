"""Train one saved neural Price Field configuration. Code version: v1.1.1."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import signal
import sys
import time

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


def run(request_path: Path, run_token: str) -> dict:
    from scripts.price_field_runtime import ensure_price_field_runtime

    if request_path.is_symlink() or not request_path.is_file():
        raise ValueError("Invalid training request path.")
    request = json.loads(request_path.read_text(encoding="utf-8"))
    if not run_token or request.get("run_token") != run_token:
        raise ValueError("Training request ownership could not be verified.")
    os.environ["PYTORCH_ENABLE_MPS_FALLBACK"] = "0"
    ensure_price_field_runtime(request["params"]["compute_backend"], Path(__file__), sys.argv[1:])

    import pandas as pd
    from app.services.price_field_training import completed_probability_score, training_strategy, validate_parameters, write_json
    from scripts.lstm_ga_tune import _date_bounds, _frame_rows, _json_safe
    from strategies.neural_price_field_inputs import plain_market_bundle
    from strategies.neural_price_field_compute import NeuralTrainingCancelled
    from strategies.price_field_pipeline import bundle_to_price_field_ohlcv

    state = request_path.parent
    started = time.monotonic()
    cancelled = False

    def stop(_signum=None, _frame=None):
        nonlocal cancelled
        cancelled = True

    previous_signals = {sig: signal.getsignal(sig) for sig in (signal.SIGTERM, signal.SIGINT)}
    for sig in previous_signals:
        signal.signal(sig, stop)

    def cancellation_requested():
        return cancelled or (state / "stop-request.json").is_file()

    def check_cancel():
        if cancellation_requested():
            raise InterruptedError("Training was stopped by the user.")

    status = {"status": "running", "phase": "loading", "started_at": request["started_at"],
              "pid": os.getpid(), "progress": {"percent": None}}

    def record(phase: str, completed: int | None = None, total: int | None = None):
        check_cancel()
        status.update({"phase": phase, "updated_at": datetime.now(timezone.utc).isoformat(),
                       "elapsed_seconds": time.monotonic() - started})
        if completed is not None and total and 0 <= completed <= total:
            status["progress"] = {"completed": completed, "total": total, "unit": "origins",
                                  "percent": round(completed / total * 100, 1)}
        write_json(state / "status.json", status)

    try:
        record("loading")
        strategy = training_strategy(request["strategy"])
        params = validate_parameters(strategy, request["params"])
        configuration = request["configuration"]
        start, end = ((pd.Timestamp(configuration["from"]).date(), pd.Timestamp(configuration["to"]).date())
                      if configuration["range"] == "exact" else _date_bounds(request["period"]))
        datasets = strategy.load_market_datasets((request["ticker"],), interval="1d", start=start, end=end, params=params)
        if not datasets or strategy._warmup_bundle is None:
            raise ValueError("The selected ticker has no usable daily factor bundle.")
        full = bundle_to_price_field_ohlcv(strategy._warmup_bundle)
        visible = full.loc[(full["Date"].dt.date >= start) & (full["Date"].dt.date <= end)].copy()
        if visible.empty:
            raise ValueError("The selected range has no daily observations.")
        write_json(state / "snapshot.json", _json_safe({"schema": 1, "ticker": request["ticker"],
                   "start": str(start), "end": str(end), "interval": "1d", "visible_rows": _frame_rows(visible),
                   "bundle": plain_market_bundle(strategy._warmup_bundle)}))
        strategy.training_progress = lambda completed, total: record("training", completed, total)
        strategy.training_cancel = cancellation_requested
        strategy.training_min_seconds = 0.0
        record("training")
        result = strategy.compute_signals(visible, params)
        check_cancel()
        presentation = result.presentation
        diagnostics = presentation.get("diagnostics", {})
        completed_probability_score(diagnostics)
        exact = {**configuration, "range": "exact", "from": visible["Date"].min().date().isoformat(),
                 "to": visible["Date"].max().date().isoformat(), "ticker": request["ticker"],
                 "period": request["period"], "interval": "1d", "strategy": request["strategy"], "params": params}
        completed = datetime.now(timezone.utc).isoformat()
        payload = _json_safe({"schema": 1, "status": "completed", "completed_at": completed,
                             "configuration": exact, "diagnostics": diagnostics, "device": presentation.get("device"),
                             "fingerprint": presentation.get("fingerprint"), "model_version": presentation.get("model_version"),
                             "evaluation_kind": "exact-configuration-causal-walk-forward", "presentation": presentation})
        write_json(state / "result.json", payload)
        status.update({"status": "completed", "phase": "completed", "completed_at": completed,
                       "updated_at": completed, "progress": {"percent": 100.0}})
        write_json(state / "status.json", status)
        return payload
    except Exception as exc:
        status.update({"status": "stopped" if isinstance(exc, (InterruptedError, NeuralTrainingCancelled)) else "failed",
                       "error": str(exc), "updated_at": datetime.now(timezone.utc).isoformat()})
        write_json(state / "status.json", status)
        raise
    finally:
        for sig, handler in previous_signals.items():
            signal.signal(sig, handler)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--request", type=Path, required=True)
    parser.add_argument("--run-token", required=True)
    args = parser.parse_args()
    try:
        run(args.request.resolve(), args.run_token)
    except Exception as exc:
        # Runtime discovery can fail before application imports. Preserve that
        # startup error beside the owned request so the GUI can explain it.
        try:
            request = json.loads(args.request.read_text(encoding="utf-8"))
            if not args.request.is_symlink() and request.get("run_token") == args.run_token:
                status_path = args.request.parent / "status.json"
                previous = json.loads(status_path.read_text(encoding="utf-8")) if status_path.is_file() else {}
                if previous.get("status") not in {"completed", "stopped", "failed"}:
                    temporary = status_path.with_name(f".status.json.{os.getpid()}.tmp")
                    temporary.write_text(json.dumps({"status": "failed", "error": str(exc),
                                         "updated_at": datetime.now(timezone.utc).isoformat()}), encoding="utf-8")
                    temporary.replace(status_path)
        except (OSError, ValueError, TypeError):
            pass
        print(f"price_field_train failed: {exc}", file=sys.stderr, flush=True)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
