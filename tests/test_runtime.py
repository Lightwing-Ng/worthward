"""Tests for supported Python runtime validation. Code version: v0.1.0."""

from __future__ import annotations

import unittest

from app.core.runtime import require_supported_python


class RuntimeVersionTests(unittest.TestCase):
    def test_accepts_python_314_patch_releases(self) -> None:
        require_supported_python((3, 14, 3))

    def test_accepts_python_313_patch_releases(self) -> None:
        require_supported_python((3, 13, 12))

    def test_rejects_unsupported_python_versions_with_detected_version(self) -> None:
        with self.assertRaisesRegex(
            RuntimeError,
            r"Worthward requires Python 3\.13 or 3\.14\. Detected Python 3\.12\.9\.",
        ):
            require_supported_python((3, 12, 9))


if __name__ == "__main__":
    unittest.main()
