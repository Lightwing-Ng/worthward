#!/usr/bin/env bash

# Code version: v0.6.0

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/scripts/resolve_python.sh"
PYTHON_BIN="$(resolve_python_bin)"

if [[ -z "$PYTHON_BIN" || ! -x "$PYTHON_BIN" ]]; then
	echo "Configured Python interpreter not found: $PYTHON_BIN" >&2
	echo "Set WORTHWARD_PYTHON to a valid Python 3.13 or 3.14 executable and rerun." >&2
	exit 1
fi

"$PYTHON_BIN" - <<'PY'
import sys

if sys.version_info[:2] not in ((3, 13), (3, 14)):
    raise SystemExit(
        "Expected Python 3.13 or 3.14, but got "
        f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}."
    )
PY

echo "Using host Python: $PYTHON_BIN"
"$PYTHON_BIN" -m pip install --upgrade pip
"$PYTHON_BIN" -m pip install -r "$ROOT_DIR/requirements.txt"

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
	echo "Node.js/npm is required for JavaScript and browser tests." >&2
	exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [[ "$NODE_MAJOR" != "22" ]]; then
	echo "Expected Node.js 22 for the quality gate, but got $(node --version)." >&2
	exit 1
fi

(cd "$ROOT_DIR" && npm ci)
(cd "$ROOT_DIR" && npx playwright install chromium)

echo
echo "Host Python is ready."
echo "Run tests with: $ROOT_DIR/scripts/test.sh"
echo "Run the complete quality gate with: $ROOT_DIR/scripts/check.sh"
echo "Run the app with: $ROOT_DIR/scripts/run_app.sh"
