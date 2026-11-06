"""Exercise the migration CLI without publishing benchmark data to live stores.

Code version: v1.0.0
"""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import sys

import pytest

from app.infrastructure import investment_sqlite, storage
from tests.python.infrastructure import test_investment_sqlite as sqlite_support

protected_store_guard = sqlite_support.protected_store_guard
PROJECT_ROOT = Path(__file__).resolve().parents[3]
SCRIPT = PROJECT_ROOT / "scripts/migrate_investment_sqlite.py"


@pytest.fixture
def migration_paths(tmp_path):
    source = tmp_path / "source-store/investment.parquet"
    target = tmp_path / "target-store/investment.sqlite3"
    report = tmp_path / "reports/migration.json"
    source.parent.mkdir()
    payload = sqlite_support._payload()
    storage.save_investment_store_payload(payload, source)
    return source, target, report, payload


def _run_cli(tmp_path, source, target, *arguments):
    environment = dict(os.environ)
    supplied_settings = tmp_path / "supplied-settings-must-remain-absent"
    supplied_market = tmp_path / "supplied-market-must-remain-absent"
    environment["WORTHWARD_SETTINGS_STORE_DIR"] = str(supplied_settings)
    environment["WORTHWARD_MARKET_STORE_DIR"] = str(supplied_market)
    result = subprocess.run(
        [
            sys.executable,
            "-B",
            str(SCRIPT),
            "--source",
            str(source),
            "--target",
            str(target),
            "--benchmark-runs",
            "1",
            *map(str, arguments),
        ],
        cwd=tmp_path,
        env=environment,
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    assert not supplied_settings.exists()
    assert not supplied_market.exists()
    return result


@pytest.mark.parametrize("apply", [False, True])
def test_cli_preview_and_apply_preserve_source_and_keep_benchmark_mutations_isolated(
    tmp_path, migration_paths, apply
):
    source, target, report_path, payload = migration_paths
    original_bytes = source.read_bytes()
    arguments = ["--report", str(report_path)]
    if apply:
        arguments.append("--apply")
    result = _run_cli(tmp_path, source, target, *arguments)
    assert result.returncode == 0, result.stderr
    stdout_report = json.loads(result.stdout)
    report = json.loads(report_path.read_text(encoding="utf-8"))
    assert report == stdout_report
    assert report["applied"] is apply
    assert report["source_unchanged"] is True
    assert report["source_sha256"] == hashlib.sha256(original_bytes).hexdigest()
    assert report["validation"]["payload_sha256"] == investment_sqlite.payload_sha256(payload)
    assert report["validation"]["integrity_check"] == "ok"
    assert report["benchmark"]["runs"] == 1
    for backend in ("parquet", "sqlite"):
        timings = report["benchmark"]["timings"][backend]
        assert set(timings) == {
            "full_read",
            "snapshot_metadata",
            "snapshot_one_transaction",
            "atomic_metadata",
            "atomic_one_transaction",
        }
        assert all(len(workload["samples_ms"]) == 1 for workload in timings.values())
    assert source.read_bytes() == original_bytes
    assert target.exists() is apply
    if apply:
        assert sqlite_support._json(investment_sqlite.load_payload(target)) == sqlite_support._json(payload)
        assert report["publication"]["payload_sha256"] == report["validation"]["payload_sha256"]
        assert report["storage"]["published_sqlite"]["bytes"] == target.stat().st_size
    if os.name == "posix":
        assert stat.S_IMODE(report_path.stat().st_mode) == 0o600


@pytest.mark.parametrize("location", ["source", "target", "source_symlink"])
def test_cli_rejects_report_inside_protected_source_or_target_before_apply(
    tmp_path, migration_paths, location
):
    source, target, _report_path, _payload = migration_paths
    original_bytes = source.read_bytes()
    if location == "source":
        report_path = source.parent / "report.json"
    elif location == "target":
        report_path = target.parent / "report.json"
    else:
        alias = tmp_path / "source-alias"
        alias.symlink_to(source.parent, target_is_directory=True)
        report_path = alias / "report.json"
    result = _run_cli(tmp_path, source, target, "--apply", "--report", report_path)
    assert result.returncode == 2
    assert "report must be outside" in result.stderr
    assert source.read_bytes() == original_bytes
    assert not target.exists()
    assert not report_path.exists()


def test_cli_refuses_to_replace_existing_report_before_apply(tmp_path, migration_paths):
    source, target, report_path, _payload = migration_paths
    original_source = source.read_bytes()
    report_path.parent.mkdir()
    original_report = b"Retain the previous private migration evidence.\n"
    report_path.write_bytes(original_report)
    result = _run_cli(tmp_path, source, target, "--apply", "--report", report_path)
    assert result.returncode == 2
    assert "report already exists" in result.stderr
    assert report_path.read_bytes() == original_report
    assert source.read_bytes() == original_source
    assert not target.exists()
