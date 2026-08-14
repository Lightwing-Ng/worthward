#!/usr/bin/env bash

# Code version: v1.0.0

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_ROOT="$ROOT_DIR/test-results/runtime-store"

cd "$ROOT_DIR"
# Use a test-only PIN when the caller has not supplied one. Production config
# intentionally does not contain a PIN or any other live-trading secret.
export ANTIGRAVITY_LIVE_TRADING_PIN="${ANTIGRAVITY_LIVE_TRADING_PIN:-123456}"
npx playwright test "$@"
TEST_STATUS="$?"

if [[ -d "$RUNTIME_ROOT" ]]; then
	find "$RUNTIME_ROOT" -depth -delete
fi

exit "$TEST_STATUS"
