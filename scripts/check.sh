#!/usr/bin/env bash

# Code version: v1.4.0

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/scripts/resolve_python.sh"
PYTHON_BIN="$(resolve_python_bin)"
COVERAGE_MINIMUM="${ANTIGRAVITY_COVERAGE_MINIMUM:-50}"

if [[ -z "$PYTHON_BIN" || ! -x "$PYTHON_BIN" ]]; then
	echo "Configured Python interpreter not found: $PYTHON_BIN" >&2
	exit 1
fi

for required_command in node npm; do
	if ! command -v "$required_command" >/dev/null 2>&1; then
		echo "Required command not found: $required_command" >&2
		exit 1
	fi
done

if [[ ! "$COVERAGE_MINIMUM" =~ ^[0-9]+$ ]] || (( COVERAGE_MINIMUM < 0 || COVERAGE_MINIMUM > 100 )); then
	echo "ANTIGRAVITY_COVERAGE_MINIMUM must be an integer from 0 to 100." >&2
	exit 1
fi

cd "$ROOT_DIR"

echo "Quality gate configuration: Python=$PYTHON_BIN, coverage minimum=${COVERAGE_MINIMUM}%"

echo "[1/5] Python static checks"
"$PYTHON_BIN" -m ruff check app strategies tests scripts

echo "[2/5] JavaScript syntax checks"
JS_FILE_COUNT=0
while IFS= read -r script_file; do
	JS_FILE_COUNT=$((JS_FILE_COUNT + 1))
	node --check "$script_file"
done < <(find app/web/static/assets/js tests -type f \( -name '*.js' -o -name '*.mjs' \) ! -path '*/vendor/*' | sort)
if (( JS_FILE_COUNT == 0 )); then
	echo "No first-party JavaScript files were found for syntax checks." >&2
	exit 1
fi

echo "[3/5] Python tests with coverage"
"$PYTHON_BIN" -m pytest -q \
	--cov=app \
	--cov=strategies \
	--cov-report=term-missing \
	--cov-report=json:coverage.json \
	--cov-fail-under="$COVERAGE_MINIMUM"

echo "[4/5] JavaScript unit tests with coverage"
npm run test:js

echo "[5/5] Browser end-to-end tests"
npm run test:e2e

echo "Quality gate passed."
