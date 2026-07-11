#!/usr/bin/env bash

# Code version: v1.0.0

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEFAULT_PYTHON="/Library/Frameworks/Python.framework/Versions/3.13/bin/python3"
PYTHON_BIN="${ANTIGRAVITY_PYTHON:-$DEFAULT_PYTHON}"

if [[ ! -x "$PYTHON_BIN" ]]; then
	echo "Configured Python interpreter not found: $PYTHON_BIN" >&2
	exit 1
fi

cd "$ROOT_DIR"

echo "[1/5] Python static checks"
"$PYTHON_BIN" -m ruff check --select E9,F63,F7,F82 app strategies tests scripts

echo "[2/5] JavaScript syntax checks"
while IFS= read -r script_file; do
	node --check "$script_file"
done < <(find app/web/static/assets/js tests -type f \( -name '*.js' -o -name '*.mjs' \) ! -path '*/vendor/*' | sort)

echo "[3/5] Python tests with coverage"
"$PYTHON_BIN" -m pytest -q \
	--cov=app \
	--cov=strategies \
	--cov-report=term-missing \
	--cov-report=json:coverage.json \
	--cov-fail-under=0

echo "[4/5] JavaScript unit tests"
npm run test:js

echo "[5/5] Browser end-to-end tests"
npm run test:e2e
