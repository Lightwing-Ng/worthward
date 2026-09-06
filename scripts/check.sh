#!/usr/bin/env bash

# Code version: v1.6.0

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/scripts/resolve_python.sh"
PYTHON_BIN="$(resolve_python_bin)"
if [[ -z "$PYTHON_BIN" || ! -x "$PYTHON_BIN" ]]; then
    echo "Python 3.13 or newer not found; set WORTHWARD_PYTHON." >&2
    exit 1
fi
export WORTHWARD_PYTHON="$PYTHON_BIN"
exec "$PYTHON_BIN" "$ROOT_DIR/scripts/quality_gate.py" --root "$ROOT_DIR"
