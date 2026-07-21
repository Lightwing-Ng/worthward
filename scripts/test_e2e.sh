#!/usr/bin/env bash

# Code version: v1.0.0

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_ROOT="$ROOT_DIR/test-results/runtime-store"

cd "$ROOT_DIR"
npx playwright test "$@"
TEST_STATUS="$?"

if [[ -d "$RUNTIME_ROOT" ]]; then
	find "$RUNTIME_ROOT" -depth -delete
fi

exit "$TEST_STATUS"
