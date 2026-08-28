#!/usr/bin/env bash

# Code version: v1.1.0

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/scripts/resolve_python.sh"
PYTHON_BIN="$(resolve_python_bin)"
RUNTIME_ROOT="$ROOT_DIR/test-results/runtime-store"

if [[ -z "$PYTHON_BIN" || ! -x "$PYTHON_BIN" ]]; then
	echo "Configured Python interpreter not found: $PYTHON_BIN" >&2
	exit 1
fi

if [[ -z "${ANTIGRAVITY_E2E_LOCK_TOKEN:-}" ]]; then
	exec "$PYTHON_BIN" "$ROOT_DIR/scripts/e2e_lock.py" run \
		--root "$ROOT_DIR" -- "$ROOT_DIR/scripts/test_e2e.sh" "$@"
fi

if ! "$PYTHON_BIN" "$ROOT_DIR/scripts/e2e_lock.py" verify --root "$ROOT_DIR"; then
	exit 73
fi

cleanup() {
	case "$RUNTIME_ROOT" in
		"$ROOT_DIR"/test-results/runtime-store)
			if [[ -d "$RUNTIME_ROOT" ]]; then
				find "$RUNTIME_ROOT" -depth -delete
			fi
			;;
		*) echo "Refusing to remove unexpected E2E runtime path: $RUNTIME_ROOT" >&2 ;;
	esac
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

cd "$ROOT_DIR"
# Use a test-only PIN when the caller has not supplied one. Production config
# intentionally does not contain a PIN or any other live-trading secret.
export ANTIGRAVITY_LIVE_TRADING_PIN="${ANTIGRAVITY_LIVE_TRADING_PIN:-123456}"
npx playwright test "$@"
TEST_STATUS="$?"

exit "$TEST_STATUS"
