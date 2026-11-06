"""Keep ablation comparisons precise and source mutations inside disposable cases.

Code version: v1.2.0
"""

from __future__ import annotations

from copy import deepcopy
import json
from pathlib import Path
import sqlite3
import stat
from types import SimpleNamespace
import zlib

import pytest

from scripts import audit_investment_storage_ablation as audit


@pytest.mark.parametrize("report_flag", ["--report", "--browser-report"])
@pytest.mark.parametrize("protected_name", ["settings_store", "market_store"])
@pytest.mark.parametrize("case_alias", [False, True])
def test_cli_rejects_production_report_paths_even_with_isolated_sources(
    tmp_path, monkeypatch, report_flag, protected_name, case_alias,
):
    arguments = [
        "audit", "--settings-root", str(tmp_path / "settings_store"),
        "--market-root", str(tmp_path / "market_store"),
        "--report", str(tmp_path / "safe-report.json"),
    ]
    destination = audit.PROJECT_ROOT / (protected_name.upper() if case_alias else protected_name) / "never-write-ablation-report.json"
    if report_flag == "--report":
        arguments[-1] = str(destination)
    else:
        arguments.extend([report_flag, str(destination)])
    monkeypatch.setattr(audit.sys, "argv", arguments)

    def reject_inventory(_root):
        raise AssertionError("Unsafe output paths must be rejected before source reads.")

    monkeypatch.setattr(audit, "snapshot_files", reject_inventory)
    with pytest.raises(SystemExit) as failure:
        audit.main()
    assert failure.value.code == 2
    assert not destination.exists()


def test_cli_protects_an_explicit_original_archive_before_any_source_reads(tmp_path, monkeypatch):
    archive = tmp_path / "immutable-broker-originals"
    monkeypatch.setattr(audit.sys, "argv", [
        "audit", "--protected-root", str(archive),
        "--report", str(archive / "never-write.json"),
    ])
    monkeypatch.setattr(audit, "snapshot_files", lambda _root: pytest.fail("Unsafe report must fail before inventory."))
    with pytest.raises(SystemExit) as failure:
        audit.main()
    assert failure.value.code == 2
    assert not archive.exists()


def test_summary_leaf_fingerprints_expose_fields_but_not_account_or_amount_values():
    leaves = audit.leaf_fingerprints({"private-account": {"realized_pnl": 123.45}})
    assert len(leaves) == 1
    record = next(iter(leaves.values()))
    assert record["field"] == "realized_pnl"
    assert record["value_type"] == "float"
    assert "private-account" not in str(leaves)
    assert "123.45" not in str(leaves)
    assert leaves != audit.leaf_fingerprints({"private-account": {"realized_pnl": 123.46}})


def test_stable_fingerprint_keeps_financial_dates_types_precision_and_unknown_fields(tmp_path):
    payload = {
        "investment_cache": {"status": "hit"}, "investment_store_version": "123",
        "realtime_quotes": [{"dynamic": True}],
        "transactions": [{"date": "2026-11-05", "amount_raw": "0001.230000", "id": "same"}],
        "broker_summaries": {"broker": {"as_of": "2026-10-01", "updated_at": "original"}},
        "section_freshness": {"target_trading_day": "2026-11-05", "coverage": "partial"},
        "unknown": [None, False, 0, "0", [], {}], "diagnostic_path": str(tmp_path / "cache.sqlite3"),
    }
    before = deepcopy(payload)
    stable = audit.stable_payload(payload, tmp_path)
    assert payload == before
    assert stable["transactions"] == payload["transactions"]
    assert stable["broker_summaries"] == payload["broker_summaries"]
    assert stable["unknown"] == payload["unknown"]
    assert stable["section_freshness"] == {"coverage": "partial"}
    assert stable["diagnostic_path"] == "<isolated-runtime>/cache.sqlite3"
    assert not (audit.VOLATILE_TOP_LEVEL & stable.keys())
    changed = deepcopy(stable)
    changed["transactions"][0]["amount_raw"] = "1.23"
    assert audit.digest(stable) != audit.digest(changed)
    changed = deepcopy(stable)
    changed["broker_summaries"]["broker"]["as_of"] = "2026-11-01"
    assert audit.digest(stable) != audit.digest(changed)


def test_snapshot_and_copy_do_not_read_opaque_artifacts_or_copy_cloud_flags(tmp_path, monkeypatch):
    source, target = tmp_path / "settings_store", tmp_path / "isolated/settings_store"
    source.mkdir()
    data = source / "investment.sqlite3"
    data.write_bytes(b"exact isolated source bytes")
    evidence = source / "investment_evidence/proof.bin"
    evidence.parent.mkdir()
    evidence.write_bytes(b"opaque source evidence")
    (source / "old.lock").touch()
    (source / ".DS_Store").write_bytes(b"native Finder metadata")
    original_sha = audit.file_sha

    def reject_artifact_reads(path):
        assert Path(path) != evidence
        return original_sha(path)

    monkeypatch.setattr(audit, "file_sha", reject_artifact_reads)
    inventory = audit.snapshot_files(source)
    assert set(inventory) == {"investment.sqlite3", "investment_evidence/proof.bin"}
    assert "sha256" not in inventory["investment_evidence/proof.bin"]
    audit.copy_audit_source(source, target, inventory)
    assert (target / "investment.sqlite3").read_bytes() == data.read_bytes()
    placeholder = target / "investment_evidence/proof.bin"
    assert placeholder.stat().st_size == evidence.stat().st_size
    assert placeholder.read_bytes() == b"\x00" * evidence.stat().st_size
    assert (target / "investment.sqlite3").stat().st_mtime_ns == data.stat().st_mtime_ns


def test_legacy_ablation_removes_only_the_disposable_case_sources(tmp_path):
    original = tmp_path / "original"
    original.mkdir()
    (original / "old.bak").write_bytes(b"keep source")
    case = tmp_path / "case"
    case.mkdir()
    (case / "old.bak").write_bytes(b"case backup")
    (case / "investment.parquet").write_bytes(b"case legacy")
    (case / "investment.sqlite3").write_bytes(b"case canonical")
    (case / "archives").mkdir()
    (case / "archives/original.json").write_text("{}")
    assert audit.remove_legacy_copies(case) == 3
    assert (case / "investment.sqlite3").read_bytes() == b"case canonical"
    assert (original / "old.bak").read_bytes() == b"keep source"


def test_worker_refuses_source_ancestors_descendants_and_symlink_escapes(tmp_path):
    source = tmp_path / "production/settings_store"
    source.mkdir(parents=True)
    for case in (source, source.parent, source / "dangerous-case"):
        with pytest.raises(ValueError, match="isolated"):
            audit.validate_worker_case(case, [source])
    with pytest.raises(ValueError, match="isolated"):
        audit.validate_worker_case(source.with_name("SETTINGS_STORE") / "dangerous-case", [source])
    case = tmp_path / "safe-case"
    case.mkdir()
    (case / "settings_store").symlink_to(source, target_is_directory=True)
    with pytest.raises(ValueError, match="escape"):
        audit.validate_worker_case(case, [source])
    (case / "settings_store").unlink()
    (case / "settings_store").mkdir()
    (case / "settings_store/investment.sqlite3").symlink_to(source / "investment.sqlite3")
    with pytest.raises(ValueError, match="symbolic"):
        audit.validate_worker_case(case, [source])


def test_worker_rejects_hard_link_to_a_protected_original_before_preparation(tmp_path):
    source = tmp_path / "original/settings_store"
    source.mkdir(parents=True)
    original = source / "investment.sqlite3"
    original.write_bytes(b"protected exact original")
    case = tmp_path / "case"
    (case / "settings_store").mkdir(parents=True)
    (case / "settings_store/investment.sqlite3").hardlink_to(original)
    with pytest.raises(ValueError, match="hard links"):
        audit.validate_worker_case(case, [source])
    assert original.read_bytes() == b"protected exact original"


def test_browser_timeout_terminates_its_dedicated_process_group(monkeypatch):
    signals = []

    class HungBrowser:
        pid = 123456789

        def __init__(self):
            self.calls = 0

        def communicate(self, *, timeout=None):
            self.calls += 1
            if self.calls == 1:
                raise audit.subprocess.TimeoutExpired("isolated browser", timeout)
            return "", ""

    def launch(_command, **options):
        assert options["start_new_session"] is True
        return HungBrowser()

    monkeypatch.setattr(audit.subprocess, "Popen", launch)
    monkeypatch.setattr(audit.os, "killpg", lambda pid, sig: signals.append((pid, sig)))
    with pytest.raises(audit.subprocess.TimeoutExpired):
        audit.run_browser_process(["node", "isolated.js"], {}, timeout=1)
    assert signals == [(123456789, audit.signal.SIGTERM)]


def test_file_sha_handles_cloud_short_reads_without_claiming_corruption(tmp_path, monkeypatch):
    source = tmp_path / "input.sqlite3"
    source.write_bytes(b"exact")
    original = Path.open
    calls = 0

    class NotReady:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def read(self, _size):
            return b""

    def delayed_open(path, *args, **kwargs):
        nonlocal calls
        calls += 1
        return NotReady() if calls == 1 else original(path, *args, **kwargs)

    monkeypatch.setattr(Path, "open", delayed_open)
    monkeypatch.setattr(audit, "sleep", lambda _seconds: None)
    assert audit.file_sha(source) == audit.hashlib.sha256(b"exact").hexdigest()
    assert calls == 2


def test_private_json_checkpoint_is_atomic_and_refuses_external_changes(tmp_path):
    path = tmp_path / "evidence.json"
    first = {"api_complete": True, "complete": False, "unknown": [None, False, "0001.2300"]}
    digest = audit.write_json_checkpoint(path, first)
    assert json.loads(path.read_text()) == first
    assert stat.S_IMODE(path.stat().st_mode) == 0o600
    assert path.stat().st_nlink == 1
    with pytest.raises(FileExistsError):
        audit.write_json_checkpoint(path, {"overwrite": True})
    second = {**first, "complete": True}
    audit.write_json_checkpoint(path, second, expected_sha256=digest)
    assert json.loads(path.read_text()) == second
    with pytest.raises(RuntimeError, match="changed outside"):
        audit.write_json_checkpoint(path, first, expected_sha256=digest)
    assert json.loads(path.read_text()) == second
    assert not list(tmp_path.glob(".*.tmp"))


def test_failed_report_checkpoint_retains_previously_committed_evidence(tmp_path, monkeypatch):
    path = tmp_path / "evidence.json"
    digest = audit.write_json_checkpoint(path, {"api_complete": True})
    original = path.read_bytes()

    def fail_sync(_descriptor):
        raise OSError("Isolated ENOSPC before checkpoint publication")

    monkeypatch.setattr(audit.os, "fsync", fail_sync)
    with pytest.raises(OSError, match="ENOSPC"):
        audit.write_json_checkpoint(path, {"complete": True}, expected_sha256=digest)
    assert path.read_bytes() == original
    assert not list(tmp_path.glob(".*.tmp"))


def test_compressed_browser_input_roundtrip_preserves_complete_raw_bytes(tmp_path):
    source = tmp_path / "browser-payload.json"
    raw = b'{"success":true,"transactions":[],"typed":[1.0,null,false,"0001.2300"],"spaces":"  exact  "}\n'
    source.write_bytes(raw)
    database = tmp_path / "browser-inputs.sqlite3"
    result = audit.store_browser_payload(database, "full_cold", source)
    assert not source.exists()
    assert result["input_sha256"] == audit.hashlib.sha256(raw).hexdigest()
    assert result["input_bytes"] == len(raw)
    assert stat.S_IMODE(database.stat().st_mode) == 0o600
    with sqlite3.connect(database) as connection:
        assert connection.execute("PRAGMA application_id").fetchone()[0] == audit.PAYLOAD_APPLICATION_ID
        assert connection.execute("PRAGMA user_version").fetchone()[0] == 1
        saved = connection.execute("SELECT raw_sha256,raw_bytes,codec,payload FROM payloads").fetchone()
    assert saved[:3] == (result["input_sha256"], len(raw), "zlib")
    assert zlib.decompress(saved[3]) == raw
    source.write_bytes(b'{"different":true}')
    with pytest.raises(ValueError, match="different input bytes"):
        audit.store_browser_payload(database, "full_cold", source)
    assert source.read_bytes() == b'{"different":true}'


def test_browser_transport_failure_never_consumes_unverified_json(tmp_path):
    source = tmp_path / "browser-payload.json"
    raw = b'{"success":true,"transactions":[]}'
    source.write_bytes(raw)
    database = tmp_path / "inputs.sqlite3"
    audit.store_browser_payload(database, "one", source)
    source.write_bytes(raw)
    with sqlite3.connect(database) as connection:
        connection.execute("UPDATE payloads SET payload=?", (b"damaged compressed bytes",))
    with pytest.raises(zlib.error):
        audit.store_browser_payload(database, "one", source)
    assert source.read_bytes() == raw


def test_browser_transport_checks_free_space_before_publication_or_consumption(tmp_path, monkeypatch):
    source = tmp_path / "browser-payload.json"
    source.write_text('{"success":true}')

    def full_disk(*_args):
        raise RuntimeError("Insufficient free space")

    monkeypatch.setattr(audit, "require_free_space", full_disk)
    with pytest.raises(RuntimeError, match="free space"):
        audit.store_browser_payload(tmp_path / "inputs.sqlite3", "one", source)
    assert source.exists()
    assert not (tmp_path / "inputs.sqlite3").exists()


@pytest.mark.parametrize("flags,attributes", [
    (32, []), (1073741824, []), (32768, []),
    (0, ["com.apple.decmpfs"]), (0, ["com.apple.fileprovider.placeholder"]),
    (0, ["com.apple.provenance"]),
])
def test_clone_rejects_source_flags_and_xattrs_before_loading_native_library(tmp_path, monkeypatch, flags, attributes):
    source, target = tmp_path / "original", tmp_path / "clone"
    source.write_bytes(b"exact source bytes")
    original_stat = Path.stat
    monkeypatch.setattr(audit.sys, "platform", "darwin")
    monkeypatch.setattr(Path, "stat", lambda selected, *args, **kwargs: SimpleNamespace(st_flags=flags)
                        if selected == source else original_stat(selected, *args, **kwargs))
    monkeypatch.setattr(audit.os, "listxattr", lambda selected: attributes if selected == source else [], raising=False)
    monkeypatch.setattr(audit.ctypes, "CDLL", lambda *_args, **_kwargs: pytest.fail("Unsafe source must not reach clonefile."))
    assert audit._clone_file(source, target) is False
    assert not target.exists()
    assert source.read_bytes() == b"exact source bytes"


@pytest.mark.parametrize("case_alias", [False, True])
def test_browser_workspace_rejects_protected_directories_before_inventory(tmp_path, monkeypatch, case_alias):
    protected = tmp_path / "protected/settings_store"
    destination = protected.with_name("SETTINGS_STORE") / "case" if case_alias else protected / "case"
    monkeypatch.setattr(audit.sys, "argv", [
        "audit", "--settings-root", str(protected), "--market-root", str(tmp_path / "market_store"),
        "--report", str(tmp_path / "api.json"), "--browser-report", str(tmp_path / "browser.json"),
        "--browser-workspace", str(destination),
    ])
    monkeypatch.setattr(audit, "snapshot_files", lambda _root: pytest.fail("Reject before source inventory."))
    with pytest.raises(SystemExit) as error:
        audit.main()
    assert error.value.code == 2
    assert not destination.exists()


def test_browser_workspace_never_reuses_or_deletes_existing_artifacts(tmp_path, monkeypatch):
    workspace = tmp_path / "keep-existing"
    workspace.mkdir()
    sentinel = workspace / "saved-checkpoint"
    sentinel.write_bytes(b"preserve complete evidence")
    monkeypatch.setattr(audit.sys, "argv", [
        "audit", "--report", str(tmp_path / "api.json"),
        "--browser-report", str(tmp_path / "browser.json"), "--browser-workspace", str(workspace),
    ])
    monkeypatch.setattr(audit, "snapshot_files", lambda _root: pytest.fail("Reject before source inventory."))
    with pytest.raises(SystemExit) as error:
        audit.main()
    assert error.value.code == 2
    assert sentinel.read_bytes() == b"preserve complete evidence"


@pytest.mark.parametrize("explicit_workspace", [False, True])
def test_api_report_and_compressed_inputs_survive_browser_failure(tmp_path, monkeypatch, explicit_workspace):
    settings, market = tmp_path / "settings_store", tmp_path / "market_store"
    for root in (settings, market):
        root.mkdir()
        (root / "unchanged.txt").write_text("unchanged source")
    report = tmp_path / "api.json"
    browser_report = tmp_path / "browser.json"
    workspace = tmp_path / "durable-workspace" if explicit_workspace else tmp_path / "browser.json.workspace"
    arguments = [
        "audit", "--settings-root", str(settings), "--market-root", str(market),
        "--report", str(report), "--browser-report", str(browser_report), "--scenario", "sqlite_without_cache",
    ]
    if explicit_workspace:
        arguments.extend(["--browser-workspace", str(workspace)])
    monkeypatch.setattr(audit.sys, "argv", arguments)

    def worker(command, **_options):
        assert _options["env"]["PYTHONDONTWRITEBYTECODE"] == "1"
        case = Path(command[command.index("--worker") + 1])
        scenario = command[command.index("--scenario") + 1]
        (case / "browser-payload.json").write_text('{"success":true,"transactions":[]}', encoding="utf-8")
        measured = {
            "scenario": scenario, "status": 200, "success": True, "transactions": 0,
            "stable_payload_sha256": "same", "economic_transactions_sha256": "same",
            "complete_transactions_sha256": "same", "api_target_trading_day": "2026-11-05",
            "section_sha256": {}, "broker_summary_leaves": {}, "core_inputs_unchanged": True,
            "successful_shadow_reads": [], "production_access_attempts": [], "immutable_artifact_reads": [],
        }
        return audit.subprocess.CompletedProcess(command, 0, stdout=json.dumps(measured), stderr="")

    def fail_browser(_command, _environment, *, timeout):
        committed = json.loads(report.read_text())
        assert committed["api_complete"] is True
        assert committed["complete"] is False
        assert all(committed["acceptance"].values())
        manifest = json.loads((workspace / "browser-manifest.json").read_text())
        assert manifest["version"] == "1.1.0"
        assert manifest["force_render"] == audit.FORCE_RENDER_SCENARIOS
        assert manifest["deduplicate_exact_inputs"] is True
        assert manifest["checkpoint_path"] == str(workspace / "browser-captures.sqlite3")
        assert len(manifest["scenarios"]) == 3
        assert all("payload_database" in item and "payload_path" not in item for item in manifest["scenarios"])
        assert not list(workspace.glob("*/browser-payload.json"))
        with sqlite3.connect(workspace / "browser-inputs.sqlite3") as connection:
            assert connection.execute("SELECT count(*) FROM payloads").fetchone()[0] == 3
        raise RuntimeError("Isolated browser failure")

    monkeypatch.setattr(audit.subprocess, "run", worker)
    monkeypatch.setattr(audit, "run_browser_process", fail_browser)
    with pytest.raises(RuntimeError, match="Isolated browser failure"):
        audit.main()
    saved = json.loads(report.read_text())
    assert saved["api_complete"] is True
    assert saved["complete"] is False
    assert saved["browser_replay"]["status"] == "failed"
    assert workspace.is_dir()
    assert stat.S_IMODE(workspace.stat().st_mode) == 0o700
    assert (workspace / "browser-inputs.sqlite3").is_file()
    assert (settings / "unchanged.txt").read_text() == "unchanged source"
    assert (market / "unchanged.txt").read_text() == "unchanged source"
