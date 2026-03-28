#!/usr/bin/env bash

# Code version: v1.0.0

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEFAULT_PYTHON="/Library/Frameworks/Python.framework/Versions/3.13/bin/python3"
PYTHON_BIN="${ANTIGRAVITY_PYTHON:-$DEFAULT_PYTHON}"

if [[ ! -x "$PYTHON_BIN" ]]; then
	echo "Configured Python interpreter not found: $PYTHON_BIN" >&2
	echo "Set ANTIGRAVITY_PYTHON to a valid Python 3.13 executable and rerun." >&2
	exit 1
fi

"$PYTHON_BIN" - <<'PY'
import sys

if sys.version_info[:2] != (3, 13):
    raise SystemExit(
        f"Expected Python 3.13, but got {sys.version_info.major}.{sys.version_info.minor}."
    )
PY

echo "Using host Python: $PYTHON_BIN"
"$PYTHON_BIN" -m pip install --upgrade pip
"$PYTHON_BIN" -m pip install -r "$ROOT_DIR/requirements.txt" pytest

echo
echo "Host Python is ready."
echo "Run tests with: $ROOT_DIR/scripts/test.sh"
echo "Run the app with: $ROOT_DIR/scripts/run_app.sh"
