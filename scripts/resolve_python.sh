#!/usr/bin/env bash

# Code version: v0.2.0

resolve_python_bin() {
	local configured_python="${WORTHWARD_PYTHON:-${ANTIGRAVITY_PYTHON:-}}"
	if [[ -n "$configured_python" ]]; then
		printf '%s\n' "$configured_python"
		return 0
	fi

	local candidate
	for candidate in \
		"$(command -v python3 2>/dev/null || true)" \
		"$(command -v python 2>/dev/null || true)"; do
		if [[ -x "$candidate" ]] && "$candidate" -c \
			'import sys; raise SystemExit(sys.version_info[:2] < (3, 13))' \
			>/dev/null 2>&1; then
			printf '%s\n' "$candidate"
			return 0
		fi
	done
}
