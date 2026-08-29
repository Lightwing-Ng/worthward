#!/usr/bin/env bash

# Code version: v1.3.0

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LINES_MINIMUM="${ANTIGRAVITY_JS_COVERAGE_LINES_MINIMUM:-40}"
BRANCHES_MINIMUM="${ANTIGRAVITY_JS_COVERAGE_BRANCHES_MINIMUM:-60}"
FUNCTIONS_MINIMUM="${ANTIGRAVITY_JS_COVERAGE_FUNCTIONS_MINIMUM:-65}"

for threshold in "$LINES_MINIMUM" "$BRANCHES_MINIMUM" "$FUNCTIONS_MINIMUM"; do
	if [[ ! "$threshold" =~ ^[0-9]+([.][0-9]+)?$ ]]; then
		echo "JavaScript coverage thresholds must be numeric percentages." >&2
		exit 1
	fi
done

cd "$ROOT_DIR"

echo "JavaScript coverage minimums: lines=${LINES_MINIMUM}%, branches=${BRANCHES_MINIMUM}%, functions=${FUNCTIONS_MINIMUM}%"

node --experimental-test-coverage --test \
	--test-coverage-lines="$LINES_MINIMUM" \
	--test-coverage-branches="$BRANCHES_MINIMUM" \
	--test-coverage-functions="$FUNCTIONS_MINIMUM" \
	--test-coverage-include='app/web/static/assets/js/agent-optimization.js' \
	--test-coverage-include='app/web/static/assets/js/backtest/probability-grid.js' \
	--test-coverage-include='app/web/static/assets/js/chart-axis-utils.js' \
	--test-coverage-include='app/web/static/assets/js/chip-distribution.js' \
	--test-coverage-include='app/web/static/assets/js/investment-filter-utils.js' \
	--test-coverage-include='app/web/static/assets/js/numeric-display.js' \
	--test-coverage-include='app/web/static/assets/js/table-controller.js' \
	--test-coverage-include='app/web/static/assets/js/settings/url-state.js' \
	--test-coverage-include='app/web/static/assets/js/workspace/url-state.js' \
	--test-coverage-include='app/web/static/assets/js/investment/*.js' \
	tests/test_agent_optimization.mjs \
	tests/test_backtest_probability_grid.mjs \
	tests/test_chart_axis_utils.mjs \
	tests/test_chip_distribution.mjs \
	tests/test_export_image_config.mjs \
	tests/test_investment_data_utils.mjs \
	tests/test_investment_import_feedback.mjs \
	tests/test_investment_layout.mjs \
	tests/test_investment_pagination.mjs \
	tests/test_investment_realtime.mjs \
	tests/test_motion_core.mjs \
	tests/test_investment_stock_details.mjs \
	tests/test_investment_transaction_filters.mjs \
	tests/test_investment_transaction_table.mjs \
	tests/test_investment_url_state.mjs \
	tests/test_numeric_display.mjs \
	tests/test_settings_url_state.mjs \
	tests/test_table_filter_contracts.mjs \
	tests/test_workspace_url_state.mjs
