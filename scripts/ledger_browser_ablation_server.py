#!/usr/bin/env python3
"""Serve the real Investment page from guarded disposable audit inputs.

Code version: v1.0.0
"""

from __future__ import annotations

import argparse
from collections import Counter
import json
import os
from pathlib import Path
import sqlite3
import sys
from urllib.parse import unquote, urlparse

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from scripts.audit_investment_storage_ablation import path_is_within  # noqa: E402


def validate_roots(inputs: list[Path], protected: list[Path]) -> list[Path]:
    resolved = [path.resolve() for path in inputs]
    for path in resolved:
        for source in protected:
            if path_is_within(path, source) or path_is_within(source, path):
                raise ValueError("Browser audit inputs must be separate from protected source stores.")
        if path.exists() and any(child.is_symlink() for child in path.rglob("*")):
            raise ValueError("Browser audit stores cannot contain symbolic links.")
        if path.exists() and any(child.is_file() and child.stat().st_nlink > 1 for child in path.rglob("*")):
            raise ValueError("Browser audit stores cannot contain hard-linked source files.")
    return resolved


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--token", required=True)
    args = parser.parse_args()
    manifest = json.loads(args.manifest.read_text())
    protected = [
        PROJECT_ROOT / "settings_store", PROJECT_ROOT / "market_store",
        *[Path(value) for value in manifest.get("protected_roots", [])],
    ]
    protected = [path.resolve() for path in protected]
    server = manifest["server"]
    settings, market, compute = validate_roots([
        Path(server["settings_root"]), Path(server["market_root"]), Path(server["compute_root"]),
    ], protected)
    os.environ.update(
        WORTHWARD_SETTINGS_STORE_DIR=str(settings), WORTHWARD_MARKET_STORE_DIR=str(market),
        WORTHWARD_COMPUTE_ROOT=str(compute), WORTHWARD_REMOTE_MARKET_ACCESS="disabled",
        WORTHWARD_LONGBRIDGE_CLI_ACCESS="disabled", WORTHWARD_DEBUG="0",
    )
    attempts, connections = Counter(), Counter()
    violations, network = [], []

    def classify(value):
        if not isinstance(value, (str, bytes, os.PathLike)):
            return None
        raw = os.fsdecode(value)
        if raw == ":memory:":
            return None
        if raw.startswith("file:"):
            raw = unquote(urlparse(raw).path)
        path = Path(raw).resolve()
        if any(path_is_within(path, source) for source in protected):
            violations.append(str(path))
            raise PermissionError("A browser audit attempted to access a protected source store.")
        for label, root in (("settings_store", settings), ("market_store", market), ("compute", compute)):
            if path.is_relative_to(root):
                return f"{label}/{path.relative_to(root)}"
        return None

    def audit(event, arguments):
        if event in {"open", "sqlite3.connect"} and arguments:
            label = classify(arguments[0])
            if label:
                attempts[label] += 1
                if label.endswith(".bin") and "investment_evidence/" in label:
                    raise PermissionError("Ordinary browser accounting must not read opaque broker artifacts.")
        elif event == "socket.connect":
            network.append(str(arguments[1]) if len(arguments) > 1 else "unknown")
            raise PermissionError("Outbound connections are disabled for browser accounting replay.")

    sys.addaudithook(audit)
    original_connect = sqlite3.connect

    def tracked_connect(database, *values, **options):
        label = classify(database)
        connection = original_connect(database, *values, **options)
        if label:
            connections[label] += 1
        return connection

    sqlite3.connect = tracked_connect
    from app import create_app
    from flask import jsonify, request
    from werkzeug.serving import make_server

    app = create_app()

    @app.before_request
    def guard_request():
        if request.headers.get("X-Worthward-Browser-Audit") != args.token:
            return jsonify({"success": False, "error": "Audit session header required."}), 403
        if request.method not in {"GET", "HEAD"}:
            return jsonify({"success": False, "error": "Browser audit writes are disabled."}), 405
        return None

    @app.get("/__ledger_browser_audit_status")
    def audit_status():
        return jsonify({
            "attempted_data_opens": dict(attempts), "successful_sqlite_connections": dict(connections),
            "production_access_attempts": violations, "outbound_connection_attempts": network,
            "native_io_limit": "Python audit events and SQLite connections are observed; arbitrary native C file/network I/O is not an OS-level trace.",
        })

    http_server = make_server("127.0.0.1", 0, app, threaded=True)
    print(json.dumps({"ready": True, "base_url": f"http://127.0.0.1:{http_server.server_port}", "pid": os.getpid()}), flush=True)
    try:
        http_server.serve_forever()
    finally:
        http_server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
