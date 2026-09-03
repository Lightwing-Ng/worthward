#!/usr/bin/env bash

# Code version: v1.4.0

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/scripts/resolve_python.sh"
PYTHON_BIN="$(resolve_python_bin)"
RUNTIME_ROOT="$ROOT_DIR/test-results/runtime-store"
APP_PID=""
WORTHWARD_E2E_LOCK_TOKEN="${WORTHWARD_E2E_LOCK_TOKEN:-${ANTIGRAVITY_E2E_LOCK_TOKEN:-}}"

if [[ -z "$PYTHON_BIN" || ! -x "$PYTHON_BIN" ]]; then
	echo "Configured Python interpreter not found: $PYTHON_BIN" >&2
	exit 1
fi

if [[ -z "${WORTHWARD_E2E_LOCK_TOKEN:-}" ]]; then
	exec "$PYTHON_BIN" "$ROOT_DIR/scripts/e2e_lock.py" run \
		--root "$ROOT_DIR" -- "$ROOT_DIR/scripts/run_e2e_app.sh" "$@"
fi

if ! "$PYTHON_BIN" "$ROOT_DIR/scripts/e2e_lock.py" verify --root "$ROOT_DIR"; then
	exit 73
fi

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

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if [[ -d "$RUNTIME_ROOT" ]]; then
	find "$RUNTIME_ROOT" -depth -delete
fi
mkdir -p "$RUNTIME_ROOT"
mkdir -p "$RUNTIME_ROOT/market_store/logos"
TRACKED_LOGO_COUNT=0
while IFS= read -r -d '' logo_path; do
	if [[ ! -f "$ROOT_DIR/$logo_path" ]]; then
		continue
	fi
	logo_directory="${logo_path%/*}"
	mkdir -p "$RUNTIME_ROOT/$logo_directory"
	cp "$ROOT_DIR/$logo_path" "$RUNTIME_ROOT/$logo_path"
	TRACKED_LOGO_COUNT=$((TRACKED_LOGO_COUNT + 1))
done < <(git -C "$ROOT_DIR" ls-files -z -- market_store/logos)
if (( TRACKED_LOGO_COUNT == 0 )); then
	echo "No tracked E2E logo assets were found." >&2
	exit 1
fi
mkdir -p "$RUNTIME_ROOT/settings_store"

export WORTHWARD_MARKET_STORE_DIR="$RUNTIME_ROOT/market_store"
export WORTHWARD_SETTINGS_STORE_DIR="$RUNTIME_ROOT/settings_store"
export WORTHWARD_REMOTE_MARKET_ACCESS="disabled"
export WORTHWARD_PORT="8699"

PYTHONPATH="$ROOT_DIR" "$PYTHON_BIN" "$ROOT_DIR/scripts/seed_e2e_market_store.py" "$WORTHWARD_MARKET_STORE_DIR"

"$PYTHON_BIN" "$ROOT_DIR/main.py" &
APP_PID="$!"
wait "$APP_PID"
