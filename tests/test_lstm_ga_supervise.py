"""Owned compute-process deadline tests. Code version: v1.0.0."""

import json
import signal
from unittest.mock import Mock, patch

from scripts import lstm_ga_supervise as supervisor


def test_supervisor_terminates_only_new_group_at_hard_deadline(tmp_path):
    process = Mock(pid=999_991, returncode=-9)
    process.poll.side_effect = [None, None]
    metadata = tmp_path / "supervisor.json"
    with (
        patch.object(supervisor.subprocess, "Popen", return_value=process) as launch,
        patch.object(supervisor.time, "monotonic", side_effect=[0, 1, 61, 61]),
        patch.object(supervisor.time, "sleep"),
        patch.object(supervisor.Path, "exists", return_value=False),
        patch.object(supervisor.os, "killpg") as kill,
    ):
        assert supervisor.supervise(["owned-compute"], metadata, 61) == -9
    assert launch.call_args.kwargs["start_new_session"] is True
    assert kill.call_args_list[0].args == (999_991, signal.SIGTERM)
    assert kill.call_args_list[1].args == (999_991, signal.SIGKILL)
    record = json.loads(metadata.read_text())
    assert record["status"] == "hard_stopped"
    assert record["kill_at_seconds"] == 61


def test_supervisor_preserves_successful_early_exit(tmp_path):
    process = Mock(pid=999_992, returncode=0)
    process.poll.return_value = 0
    metadata = tmp_path / "supervisor.json"
    with (
        patch.object(supervisor.subprocess, "Popen", return_value=process),
        patch.object(supervisor.Path, "exists", return_value=False),
        patch.object(supervisor.os, "killpg"),
    ):
        assert supervisor.supervise(["owned-compute"], metadata, 36_000) == 0
    record = json.loads(metadata.read_text())
    assert record["status"] == "exited" and record["returncode"] == 0
