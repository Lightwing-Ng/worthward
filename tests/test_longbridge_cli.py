"""Focused safety tests for Longbridge CLI path resolution.

Code version: v1.0.0
"""

from __future__ import annotations

from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from app.core.broker_settings import BrokerSettings
from app.infrastructure import longbridge_cli


class LongbridgeCliPathResolutionTests(unittest.TestCase):
    @staticmethod
    def _write_executable(directory: Path, name: str = "longbridge") -> Path:
        executable = directory / name
        executable.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
        executable.chmod(0o700)
        return executable

    def test_explicit_absolute_executable_is_resolved_to_its_canonical_path(self) -> None:
        with TemporaryDirectory() as temp_dir:
            target = self._write_executable(Path(temp_dir))

            resolved_path = longbridge_cli.resolve_longbridge_cli_path(
                BrokerSettings(longbridge_cli_path=str(target))
            )

        self.assertEqual(resolved_path, str(target.resolve()))

    def test_explicit_symlink_to_valid_longbridge_executable_is_accepted(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            target = self._write_executable(root)
            symlink = root / "longbridge-cli-link"
            symlink.symlink_to(target)

            resolved_path = longbridge_cli.resolve_longbridge_cli_path(
                BrokerSettings(longbridge_cli_path=str(symlink))
            )

        self.assertEqual(resolved_path, str(target.resolve()))

    def test_explicit_path_rejects_unsafe_or_invalid_targets(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            non_executable = root / "longbridge"
            non_executable.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
            wrong_basename = self._write_executable(root, "other-cli")
            wrong_basename_symlink = root / "longbridge-link"
            wrong_basename_symlink.symlink_to(wrong_basename)

            invalid_paths = {
                "contains_nul": f"{root / 'longbridge'}\x00suffix",
                "relative": "./longbridge",
                "directory": str(root),
                "not_executable": str(non_executable),
                "wrong_basename": str(wrong_basename),
                "symlink_to_wrong_basename": str(wrong_basename_symlink),
            }
            for label, invalid_path in invalid_paths.items():
                with self.subTest(label=label):
                    with self.assertRaisesRegex(
                        FileNotFoundError,
                        r"Longbridge CLI was not found at .*Update the CLI path in Settings > Broker Access\.",
                    ):
                        longbridge_cli.resolve_longbridge_cli_path(
                            BrokerSettings(longbridge_cli_path=invalid_path)
                        )

    def test_discovery_normalizes_valid_symlink_result(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            target = self._write_executable(root)
            symlink = root / "discovered-longbridge"
            symlink.symlink_to(target)

            with patch.object(longbridge_cli.shutil, "which", return_value=str(symlink)):
                resolved_path = longbridge_cli.resolve_longbridge_cli_path(BrokerSettings())

        self.assertEqual(resolved_path, str(target.resolve()))

    def test_discovery_skips_invalid_result_and_normalizes_fixed_candidate(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            invalid_discovery = self._write_executable(root, "other-cli")
            target = self._write_executable(root)
            candidate_symlink = root / "fixed-candidate"
            candidate_symlink.symlink_to(target)

            with (
                patch.object(longbridge_cli.shutil, "which", return_value=str(invalid_discovery)),
                patch.object(
                    longbridge_cli,
                    "DEFAULT_LONGBRIDGE_CLI_CANDIDATES",
                    ("longbridge", str(candidate_symlink)),
                ),
            ):
                resolved_path = longbridge_cli.resolve_longbridge_cli_path(BrokerSettings())

        self.assertEqual(resolved_path, str(target.resolve()))


class LongbridgeCliErrorRedactionTests(unittest.TestCase):
    def setUp(self) -> None:
        self._previous_browser_oauth_process = longbridge_cli._BROWSER_OAUTH_PROCESS
        longbridge_cli._BROWSER_OAUTH_PROCESS = None

    def tearDown(self) -> None:
        longbridge_cli._BROWSER_OAUTH_PROCESS = self._previous_browser_oauth_process

    def test_browser_oauth_start_redacts_unexpected_failure_from_ui_message(self) -> None:
        diagnostic = "CLI diagnostic includes /private/path and a token"
        with (
            patch.object(longbridge_cli, "resolve_longbridge_cli_path", side_effect=RuntimeError(diagnostic)),
            patch.object(longbridge_cli.LOGGER, "exception") as log_exception,
        ):
            success, message = longbridge_cli.start_longbridge_cli_browser_oauth(BrokerSettings())

        self.assertFalse(success)
        self.assertEqual(
            message,
            "Could not start Longbridge browser authorization. Check the CLI path and try again.",
        )
        self.assertNotIn(diagnostic, message)
        log_exception.assert_called_once_with("Could not start Longbridge browser authorization.")

    def test_connection_auth_status_failure_redacts_unexpected_diagnostic(self) -> None:
        diagnostic = "CLI diagnostic includes /private/path and a token"
        with (
            patch.object(longbridge_cli, "get_longbridge_cli_auth_status", side_effect=RuntimeError(diagnostic)),
            patch.object(longbridge_cli.LOGGER, "exception") as log_exception,
        ):
            success, message = longbridge_cli.test_longbridge_cli_connection(BrokerSettings())

        self.assertFalse(success)
        self.assertEqual(
            message,
            "Longbridge CLI auth status failed. Check the CLI path and OAuth session, then try again.",
        )
        self.assertNotIn(diagnostic, message)
        log_exception.assert_called_once_with("Longbridge CLI auth status check failed.")

    def test_connection_quote_failure_redacts_unexpected_diagnostic(self) -> None:
        diagnostic = "CLI diagnostic includes /private/path and a token"
        with (
            patch.object(
                longbridge_cli,
                "get_longbridge_cli_auth_status",
                return_value={"token": {"status": "valid"}},
            ),
            patch.object(longbridge_cli, "run_longbridge_cli_json", side_effect=RuntimeError(diagnostic)),
            patch.object(longbridge_cli.LOGGER, "exception") as log_exception,
        ):
            success, message = longbridge_cli.test_longbridge_cli_connection(BrokerSettings())

        self.assertFalse(success)
        self.assertEqual(
            message,
            "Longbridge CLI quote test failed. Check the CLI path and OAuth session, then try again.",
        )
        self.assertNotIn(diagnostic, message)
        log_exception.assert_called_once_with("Longbridge CLI quote test failed.")


if __name__ == "__main__":
    unittest.main()
