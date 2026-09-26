#!/usr/bin/env bash

# Code version: v1.4.2

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LINES_MINIMUM="${WORTHWARD_JS_COVERAGE_LINES_MINIMUM:-${ANTIGRAVITY_JS_COVERAGE_LINES_MINIMUM:-40}}"
BRANCHES_MINIMUM="${WORTHWARD_JS_COVERAGE_BRANCHES_MINIMUM:-${ANTIGRAVITY_JS_COVERAGE_BRANCHES_MINIMUM:-60}}"
FUNCTIONS_MINIMUM="${WORTHWARD_JS_COVERAGE_FUNCTIONS_MINIMUM:-${ANTIGRAVITY_JS_COVERAGE_FUNCTIONS_MINIMUM:-65}}"

for threshold in "$LINES_MINIMUM" "$BRANCHES_MINIMUM" "$FUNCTIONS_MINIMUM"; do
	if [[ ! "$threshold" =~ ^[0-9]+([.][0-9]+)?$ ]]; then
		echo "JavaScript coverage thresholds must be numeric percentages." >&2
		exit 1
	fi
done

cd "$ROOT_DIR"
for threshold in "$LINES_MINIMUM" "$BRANCHES_MINIMUM" "$FUNCTIONS_MINIMUM"; do
    node -e 'if (Number(process.argv[1]) > 100) process.exit(1)' "$threshold" || {
        echo "JavaScript coverage thresholds must be between 0 and 100." >&2
        exit 1
    }
done

echo "JavaScript coverage minimums: lines=${LINES_MINIMUM}%, branches=${BRANCHES_MINIMUM}%, functions=${FUNCTIONS_MINIMUM}%"

JS_TEST_FILES=()
while IFS= read -r test_file; do
	JS_TEST_FILES+=("$test_file")
done < <(find tests/js -type f -name 'test_*.mjs' | LC_ALL=C sort)
if (( ${#JS_TEST_FILES[@]} == 0 )); then
	echo "No JavaScript unit test files were found under tests/js." >&2
	exit 1
fi

node --experimental-test-coverage --test \
	--test-coverage-lines="$LINES_MINIMUM" \
	--test-coverage-branches="$BRANCHES_MINIMUM" \
	--test-coverage-functions="$FUNCTIONS_MINIMUM" \
	--test-coverage-include='app/web/static/assets/js/agent-optimization.js' \
	--test-coverage-include='app/web/static/assets/js/backtest/probability-grid.js' \
	--test-coverage-include='app/web/static/assets/js/backtest/distributions.js' \
	--test-coverage-include='app/web/static/assets/js/chart-axis-utils.js' \
	--test-coverage-include='app/web/static/assets/js/chip-distribution.js' \
	--test-coverage-include='app/web/static/assets/js/investment-filter-utils.js' \
	--test-coverage-include='app/web/static/assets/js/numeric-display.js' \
	--test-coverage-include='app/web/static/assets/js/table-controller.js' \
	--test-coverage-include='app/web/static/assets/js/settings/url-state.js' \
	--test-coverage-include='app/web/static/assets/js/workspace/url-state.js' \
	--test-coverage-include='app/web/static/assets/js/investment/*.js' \
	"${JS_TEST_FILES[@]}"
