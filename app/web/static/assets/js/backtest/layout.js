/**
 * Backtest split-layout binding.
 *
 * Code version: v0.3.3
 */

import {bindInvestmentSectionResizer} from '../investment/layout.js?v=investment-layout-v1.3.4';

const bootstrap = window.WORTHWARD_BOOTSTRAP = window.WORTHWARD_BOOTSTRAP || {};
const PROBABILITY_STAGE_MINIMUM_PROPERTY = '--backtest-probability-stage-min-height';
const PROBABILITY_STAGE_MINIMUM_CHANGE_EVENT = 'worthward:backtest-probability-stage-minimum-change';
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
    const getProbabilityStageMinimum = () => {
        if (!(workspaceHeader instanceof HTMLElement)) return 0;
        const value = Number.parseFloat(
            window.getComputedStyle(workspaceHeader)
                .getPropertyValue(PROBABILITY_STAGE_MINIMUM_PROPERTY),
        );
        return Number.isFinite(value) ? Math.max(0, value) : 0;
    };

    cleanupBacktestLayout = bindInvestmentSectionResizer({
        workspaceHeader,
        reportCard,
        historySurface,
        sectionResizer,
        historyTableSelector: '#backtest_history_table_wrap',
        reservePrimaryHistoryMinimum: true,
        overviewStageSelector: '.trade-chart-stack',
        getChartInstances: getBacktestCharts,
        getOverviewStageMinimum: getProbabilityStageMinimum,
        overviewMinimumChangeEvent: PROBABILITY_STAGE_MINIMUM_CHANGE_EVENT,
        ignoreMutationSelector: '[data-backtest-probability-detail-panel]',
        observeHistorySurfaceResize: false,
        onChartsResized: () => bootstrap.backtestChartLayoutRefresh?.(),
    });
    return cleanupBacktestLayout;
}

bootstrap.initBacktestLayout = initBacktestLayout;
initBacktestLayout();
