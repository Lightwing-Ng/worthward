#!/usr/bin/env bash

# Code version: v0.3.0

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEFAULT_PYTHON="/Library/Frameworks/Python.framework/Versions/3.13/bin/python3"
PYTHON_BIN="${ANTIGRAVITY_PYTHON:-$DEFAULT_PYTHON}"

if [[ ! -x "$PYTHON_BIN" ]]; then
	echo "Configured Python interpreter not found: $PYTHON_BIN" >&2
	echo "Run $ROOT_DIR/scripts/setup_python.sh first or set ANTIGRAVITY_PYTHON." >&2
	exit 1
fi

exec "$PYTHON_BIN" "$ROOT_DIR/main.py"
