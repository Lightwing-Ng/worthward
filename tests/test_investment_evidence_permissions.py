"""
Tests for owner-only immutable investment source-evidence permissions.

Code version: v0.1.0
"""

from __future__ import annotations

import base64
import hashlib
import os
from pathlib import Path
import stat
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from app.infrastructure.storage import (
    INVESTMENT_EVIDENCE_DIRECTORY_MODE,
    INVESTMENT_EVIDENCE_FILE_MODE,
    investment_evidence_dir_for,
    materialize_investment_source_artifacts,
)


@unittest.skipUnless(os.name == "posix", "POSIX permission checks are unavailable on this platform.")
class InvestmentEvidencePermissionsTests(unittest.TestCase):
    @staticmethod
    def _source_payload(source_bytes: bytes) -> tuple[dict[str, object], str]:
        source_sha256 = hashlib.sha256(source_bytes).hexdigest()
        return ({
            "source_artifacts": [{
                "source_kind": "unit_test_csv",
                "sha256": source_sha256,
                "byte_count": len(source_bytes),
                "content_encoding": "base64",
                "content_base64": base64.b64encode(source_bytes).decode("ascii"),
            }],
        }, source_sha256)

    def test_materialization_creates_owner_only_evidence_directory_and_file(self) -> None:
        source_bytes = b"Date,Action,Amount\r\n2026-08-03,Deposit,0.41\r\n"
        payload, source_sha256 = self._source_payload(source_bytes)

        with TemporaryDirectory() as temporary_directory:
            ledger_path = Path(temporary_directory) / "investment.parquet"
            materialize_investment_source_artifacts(payload, ledger_path)

            evidence_dir = investment_evidence_dir_for(ledger_path)
            evidence_path = evidence_dir / f"{source_sha256}.bin"
            self.assertEqual(
                stat.S_IMODE(evidence_dir.stat().st_mode),
                INVESTMENT_EVIDENCE_DIRECTORY_MODE,
            )
            self.assertEqual(
                stat.S_IMODE(evidence_path.stat().st_mode),
                INVESTMENT_EVIDENCE_FILE_MODE,
            )

    def test_materialization_stages_source_bytes_in_owner_only_temp_file(self) -> None:
        source_bytes = b"Date,Action,Amount\r\n2026-08-03,Deposit,0.41\r\n"
        payload, _ = self._source_payload(source_bytes)
        observed_modes: list[int] = []
        original_write_bytes = Path.write_bytes

        def assert_temp_file_mode(path: Path, payload_bytes: bytes) -> int:
            if ".tmp.bin" in path.name:
                observed_modes.append(stat.S_IMODE(path.stat().st_mode))
            return original_write_bytes(path, payload_bytes)

        with TemporaryDirectory() as temporary_directory:
            ledger_path = Path(temporary_directory) / "investment.parquet"
            with patch.object(Path, "write_bytes", new=assert_temp_file_mode):
                materialize_investment_source_artifacts(payload, ledger_path)

        self.assertEqual(observed_modes, [INVESTMENT_EVIDENCE_FILE_MODE])

    def test_materialization_hardens_reused_evidence_permissions(self) -> None:
        source_bytes = b"Date,Action,Amount\r\n2026-08-03,Deposit,0.41\r\n"
        payload, source_sha256 = self._source_payload(source_bytes)

        with TemporaryDirectory() as temporary_directory:
            ledger_path = Path(temporary_directory) / "investment.parquet"
            evidence_dir = investment_evidence_dir_for(ledger_path)
            evidence_dir.mkdir(mode=0o755)
            evidence_path = evidence_dir / f"{source_sha256}.bin"
            evidence_path.write_bytes(source_bytes)
            evidence_path.chmod(0o644)

            materialize_investment_source_artifacts(payload, ledger_path)

            self.assertEqual(
                stat.S_IMODE(evidence_dir.stat().st_mode),
                INVESTMENT_EVIDENCE_DIRECTORY_MODE,
            )
            self.assertEqual(
                stat.S_IMODE(evidence_path.stat().st_mode),
                INVESTMENT_EVIDENCE_FILE_MODE,
            )
