#!/usr/bin/env bash

# Code version: v0.1.0

resolve_python_bin() {
	if [[ -n "${ANTIGRAVITY_PYTHON:-}" ]]; then
		printf '%s\n' "$ANTIGRAVITY_PYTHON"
		return 0
	fi

	local candidate
	for candidate in \
		"/Library/Frameworks/Python.framework/Versions/3.13/bin/python3" \
		"$(command -v python3 2>/dev/null || true)" \
		"$(command -v python 2>/dev/null || true)"; do
		if [[ -x "$candidate" ]] && "$candidate" -c \
			'import sys; raise SystemExit(sys.version_info[:2] not in ((3, 13), (3, 14)))' \
			>/dev/null 2>&1; then
			printf '%s\n' "$candidate"
			return 0
		fi
	done
}
