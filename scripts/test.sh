#!/usr/bin/env bash

# Code version: v0.5.1

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/scripts/resolve_python.sh"
PYTHON_BIN="$(resolve_python_bin)"

if [[ -z "$PYTHON_BIN" || ! -x "$PYTHON_BIN" ]]; then
	echo "Configured Python interpreter not found: $PYTHON_BIN" >&2
	echo "Install Python 3.13 or newer, run $ROOT_DIR/scripts/setup_python.sh, or set WORTHWARD_PYTHON." >&2
	exit 1
fi

cd "$ROOT_DIR"

exec "$PYTHON_BIN" -m pytest -q "$@"
