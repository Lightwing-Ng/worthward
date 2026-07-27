#!/usr/bin/env bash

# Code version: v1.2.0

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/scripts/resolve_python.sh"
PYTHON_BIN="$(resolve_python_bin)"
RUNTIME_ROOT="$ROOT_DIR/test-results/runtime-store"
APP_PID=""

cleanup() {
	if [[ -n "$APP_PID" ]] && kill -0 "$APP_PID" 2>/dev/null; then
		kill "$APP_PID" 2>/dev/null || true
		wait "$APP_PID" 2>/dev/null || true
	fi
	case "$RUNTIME_ROOT" in
		"$ROOT_DIR"/test-results/runtime-store)
			if [[ -d "$RUNTIME_ROOT" ]]; then
				find "$RUNTIME_ROOT" -depth -delete
			fi
			;;
		*) echo "Refusing to remove unexpected E2E runtime path: $RUNTIME_ROOT" >&2 ;;
	esac
}

trap cleanup EXIT INT TERM

if [[ -z "$PYTHON_BIN" || ! -x "$PYTHON_BIN" ]]; then
	echo "Configured Python interpreter not found: $PYTHON_BIN" >&2
	exit 1
fi

if [[ -d "$RUNTIME_ROOT" ]]; then
	find "$RUNTIME_ROOT" -depth -delete
fi
mkdir -p "$RUNTIME_ROOT"
mkdir -p "$RUNTIME_ROOT/market_store"
cp -R "$ROOT_DIR/market_store/logos" "$RUNTIME_ROOT/market_store/logos"
mkdir -p "$RUNTIME_ROOT/settings_store"

export ANTIGRAVITY_MARKET_STORE_DIR="$RUNTIME_ROOT/market_store"
export ANTIGRAVITY_SETTINGS_STORE_DIR="$RUNTIME_ROOT/settings_store"
export ANTIGRAVITY_REMOTE_MARKET_ACCESS="disabled"
export ANTIGRAVITY_PORT="8699"

PYTHONPATH="$ROOT_DIR" "$PYTHON_BIN" "$ROOT_DIR/scripts/seed_e2e_market_store.py" "$ANTIGRAVITY_MARKET_STORE_DIR"

"$PYTHON_BIN" "$ROOT_DIR/main.py" &
APP_PID="$!"
wait "$APP_PID"
