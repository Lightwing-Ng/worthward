"""Behavioral checks for quality report ownership. Code version: v1.0.0."""

from __future__ import annotations

from pathlib import Path
import subprocess
import sys
import time

from scripts.quality_gate import run


def test_quality_lock_preserves_report_and_releases_after_failure(
    tmp_path: Path,
) -> None:
    report = tmp_path / "coverage.json"
    report.write_text("previous report")
    ready = tmp_path / "ready"
    release = tmp_path / "release"
    child_code = (
        "from pathlib import Path; import time; "
        f"Path({str(ready)!r}).touch(); "
        f"\nwhile not Path({str(release)!r}).exists(): time.sleep(0.01)\n"
    )
    owner_code = (
        "from scripts.quality_gate import run; from pathlib import Path; import sys; "
        f"sys.exit(run(Path({str(tmp_path)!r}), [sys.executable, '-c', {child_code!r}]))"
    )
    owner = subprocess.Popen([sys.executable, "-c", owner_code])
    try:
        deadline = time.monotonic() + 10
        while not ready.exists() and time.monotonic() < deadline:
            time.sleep(0.02)
        assert ready.exists()
        overwrite = [
            sys.executable,
            "-c",
            "from pathlib import Path; Path('coverage.json').write_text('overwritten')",
        ]
        assert run(tmp_path, overwrite) == 73
        assert report.read_text() == "previous report"
        independent_root = tmp_path / "other-checkout"
        independent_root.mkdir()
        assert run(independent_root, [sys.executable, "-c", "pass"]) == 0
    finally:
        release.touch()
        owner.wait(timeout=10)
    assert owner.returncode == 0
    assert run(tmp_path, [sys.executable, "-c", "raise SystemExit(7)"]) == 7
    assert run(tmp_path, [sys.executable, "-c", "pass"]) == 0
