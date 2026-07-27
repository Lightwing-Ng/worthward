#!/usr/bin/env bash

# Code version: v0.4.0

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/scripts/resolve_python.sh"
PYTHON_BIN="$(resolve_python_bin)"

if [[ -z "$PYTHON_BIN" || ! -x "$PYTHON_BIN" ]]; then
	echo "Configured Python interpreter not found: $PYTHON_BIN" >&2
	echo "Install Python 3.13 or 3.14, run $ROOT_DIR/scripts/setup_python.sh, or set ANTIGRAVITY_PYTHON." >&2
	exit 1
fi

exec "$PYTHON_BIN" "$ROOT_DIR/main.py"
