/**
 * Backtest split-layout binding.
 *
 * Code version: v0.1.3
 */

import {bindInvestmentSectionResizer} from '../investment/layout.js?v=investment-layout-v1.1.2';

const bootstrap = window.ANTIGRAVITY_BOOTSTRAP = window.ANTIGRAVITY_BOOTSTRAP || {};
let cleanupBacktestLayout = () => {};

export function initBacktestLayout() {
    cleanupBacktestLayout();

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

    cleanupBacktestLayout = bindInvestmentSectionResizer({
        workspaceHeader,
        reportCard,
        historySurface,
        sectionResizer,
        historyTableSelector: '#backtest_history_table_wrap',
        getChartInstances: getBacktestCharts,
    });
    return cleanupBacktestLayout;
}

bootstrap.initBacktestLayout = initBacktestLayout;
initBacktestLayout();
