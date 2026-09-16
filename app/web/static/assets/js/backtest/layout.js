/**
 * Backtest split-layout binding.
 *
 * Code version: v0.7.2
 */

import {bindInvestmentSectionResizer} from '../investment/layout.js?v=investment-layout-v1.5.1';

const bootstrap = window.WORTHWARD_BOOTSTRAP = window.WORTHWARD_BOOTSTRAP || {};
const PROBABILITY_STAGE_MINIMUM_PROPERTY = '--backtest-probability-stage-min-height';
const PROBABILITY_HISTORY_MINIMUM_PROPERTY = '--backtest-probability-history-min-height';
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
    const isProbabilityHistoryViewActive = () => (
        historySurface instanceof HTMLElement
        && historySurface.dataset.activeView === 'probability'
    );
    const setProbabilityHistoryMinimum = (height) => {
        if (!(historySurface instanceof HTMLElement)) return;
        const value = Number(height);
        if (!(value > 0)) {
            historySurface.style.removeProperty(PROBABILITY_HISTORY_MINIMUM_PROPERTY);
            return;
        }
        const nextValue = `${Math.ceil(value)}px`;
        if (historySurface.style.getPropertyValue(PROBABILITY_HISTORY_MINIMUM_PROPERTY) !== nextValue) {
            historySurface.style.setProperty(PROBABILITY_HISTORY_MINIMUM_PROPERTY, nextValue);
        }
    };
    const getProbabilityHistoryMinimumHeight = () => {
        if (!(historySurface instanceof HTMLElement)) return 0;
        const detailPanel = historySurface.querySelector(
            ':scope > .investment-view-surface-body > [data-backtest-probability-detail-panel]:not([hidden])',
        );
        if (!(detailPanel instanceof HTMLElement) || detailPanel.getClientRects().length === 0) {
            setProbabilityHistoryMinimum(0);
            return 0;
        }

        const detailStyles = window.getComputedStyle(detailPanel);
        if (detailStyles.display === 'none' || detailStyles.visibility === 'hidden') {
            setProbabilityHistoryMinimum(0);
            return 0;
        }
        const computedMinimum = Number.parseFloat(detailStyles.minHeight);
        const declaredMinimum = Number.parseFloat(
            detailStyles.getPropertyValue('--backtest-probability-detail-min-height'),
        );
        const detailMinimum = computedMinimum > 0 ? computedMinimum : declaredMinimum;
        if (!(detailMinimum > 0)) {
            setProbabilityHistoryMinimum(0);
            return 0;
        }

        const surfaceStyles = window.getComputedStyle(historySurface);
        const detailBody = detailPanel.parentElement;
        const bodyStyles = detailBody instanceof HTMLElement
            ? window.getComputedStyle(detailBody)
            : null;
        const segmentedFrame = historySurface.querySelector(
            ':scope > .backtest-history-view-segmented-wrap',
        );
        const readBlockPadding = (styles) => styles
            ? (Number.parseFloat(styles.paddingBlockStart) || 0)
                + (Number.parseFloat(styles.paddingBlockEnd) || 0)
            : 0;
        const readBlockMargin = (styles) => styles
            ? (Number.parseFloat(styles.marginBlockStart) || 0)
                + (Number.parseFloat(styles.marginBlockEnd) || 0)
            : 0;
        const surfaceGap = Number.parseFloat(surfaceStyles.rowGap) || 0;
        const segmentedHeight = segmentedFrame instanceof HTMLElement
            ? segmentedFrame.getBoundingClientRect().height
            : 0;
        const minimumHeight = readBlockPadding(surfaceStyles)
            + surfaceGap
            + segmentedHeight
            + readBlockPadding(bodyStyles)
            + detailMinimum
            + readBlockMargin(detailStyles);
        setProbabilityHistoryMinimum(minimumHeight);
        return minimumHeight;
    };

    const cleanupSectionResizer = bindInvestmentSectionResizer({
        workspaceHeader,
        reportCard,
        historySurface,
        sectionResizer,
        historyTableSelector: '#backtest_history_table_wrap',
        reservePrimaryHistoryMinimum: true,
        overviewStageSelector: '.trade-chart-stack',
        getChartInstances: getBacktestCharts,
        getOverviewStageMinimum: getProbabilityStageMinimum,
        getAdditionalHistoryMinimumHeight: getProbabilityHistoryMinimumHeight,
        preferOverviewMinimum: () => !isProbabilityHistoryViewActive(),
        preferHistoryMinimum: isProbabilityHistoryViewActive,
        overviewMinimumChangeEvent: PROBABILITY_STAGE_MINIMUM_CHANGE_EVENT,
        ignoreMutationSelector: '[data-backtest-probability-detail-panel]',
        observeHistorySurfaceResize: false,
        onChartsResized: () => bootstrap.backtestChartLayoutRefresh?.(),
    });
    cleanupBacktestLayout = () => {
        cleanupSectionResizer?.();
        setProbabilityHistoryMinimum(0);
    };
    return cleanupBacktestLayout;
}

bootstrap.initBacktestLayout = initBacktestLayout;
initBacktestLayout();
