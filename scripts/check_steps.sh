#!/usr/bin/env bash

# Code version: v1.7.0

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/scripts/resolve_python.sh"
PYTHON_BIN="$(resolve_python_bin)"
if [[ -z "$PYTHON_BIN" || ! -x "$PYTHON_BIN" ]]; then
    echo "Python 3.13 or newer not found; set WORTHWARD_PYTHON." >&2
    exit 1
fi

cd "$ROOT_DIR"
exec "$PYTHON_BIN" -m scripts.quality_checks --root "$ROOT_DIR" "$@"
