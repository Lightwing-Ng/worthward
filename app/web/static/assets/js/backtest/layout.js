/**
 * Backtest split-layout binding.
 *
 * Code version: v0.1.0
 */

import {bindInvestmentSectionResizer} from '../investment/layout.js?v=investment-layout-v1.1.0';

const workspaceHeader = document.querySelector(
    '.backtest-results-stack.investment-workspace-header',
);
const reportCard = workspaceHeader?.querySelector(
    ':scope > .backtest-trade-performance-card',
);
const historySurface = workspaceHeader?.querySelector('#backtest_history_surface');
const sectionResizer = document.getElementById('backtest_section_resizer');

const getBacktestCharts = () => (
    ['tradePriceChart', 'tradeEquityChart']
        .map((id) => {
            const canvas = document.getElementById(id);
            return canvas ? window.Chart?.getChart?.(canvas) : null;
        })
        .filter(Boolean)
);

bindInvestmentSectionResizer({
    workspaceHeader,
    reportCard,
    historySurface,
    sectionResizer,
    historyTableSelector: '#backtest_history_table_wrap',
    getChartInstances: getBacktestCharts,
});
