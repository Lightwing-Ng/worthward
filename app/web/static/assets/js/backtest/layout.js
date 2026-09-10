/**
 * Backtest split-layout binding.
 *
 * Code version: v0.6.0
 */

import {bindInvestmentSectionResizer} from '../investment/layout.js?v=investment-layout-v1.4.0';

const bootstrap = window.WORTHWARD_BOOTSTRAP = window.WORTHWARD_BOOTSTRAP || {};
const PROBABILITY_STAGE_MINIMUM_PROPERTY = '--backtest-probability-stage-min-height';
const PROBABILITY_STAGE_MINIMUM_CHANGE_EVENT = 'worthward:backtest-probability-stage-minimum-change';
let cleanupBacktestLayout = () => {};

const bindBacktestParameterOverlay = () => {
    const shell = document.querySelector('[data-backtest-workspace-shell]');
    const panel = document.querySelector('[data-backtest-parameter-panel]');
    const toggle = document.querySelector('[data-backtest-parameter-toggle]');
    const backdrop = document.querySelector('[data-backtest-parameter-backdrop]');
    const globalSidebarToggle = document.getElementById('sidebar_toggle');
    const responsive = window.WORTHWARD_RESPONSIVE;
    if (
        !(shell instanceof HTMLElement)
        || !(panel instanceof HTMLElement)
        || !(toggle instanceof HTMLButtonElement)
        || !(backdrop instanceof HTMLButtonElement)
        || typeof responsive?.media !== 'function'
    ) {
        return () => {};
    }

    const overlayMedia = responsive.media('sidebarOverlayMax');
    const storage = window.WORTHWARD_STORAGE?.session || window.sessionStorage;
    const storageKey = 'worthward:backtest-parameters-open';
    let isOpen = false;

    const isGlobalSidebarOpen = () => (
        globalSidebarToggle instanceof HTMLButtonElement
        && globalSidebarToggle.getAttribute('aria-expanded') === 'true'
    );

    const readRememberedState = () => {
        try {
            return storage.getItem(storageKey) === 'true';
        } catch (_error) {
            return false;
        }
    };

    const rememberState = (value) => {
        try {
            storage.setItem(storageKey, String(Boolean(value)));
        } catch (_error) {
        }
    };

    const applyState = (requestedOpen, {remember = false, returnFocus = false} = {}) => {
        const isOverlay = overlayMedia.matches;
        const isToggleAvailable = isOverlay && !isGlobalSidebarOpen();
        isOpen = isToggleAvailable && Boolean(requestedOpen);
        shell.classList.toggle('is-parameter-overlay-open', isOpen);
        toggle.hidden = !isToggleAvailable;
        toggle.setAttribute('aria-hidden', String(!isToggleAvailable));
        toggle.setAttribute('aria-expanded', String(isOpen));
        panel.setAttribute('aria-hidden', String(isOverlay && !isOpen));
        if ('inert' in panel) panel.inert = isOverlay && !isOpen;
        backdrop.hidden = !isOpen;
        backdrop.setAttribute('aria-hidden', String(!isOpen));
        backdrop.tabIndex = isOpen ? 0 : -1;
        if ('inert' in backdrop) backdrop.inert = !isOpen;
        if (remember && isOverlay) rememberState(isOpen);
        if (returnFocus && isToggleAvailable) toggle.focus({preventScroll: true});
    };

    const onToggle = () => {
        const nextOpen = !isOpen;
        if (
            nextOpen
            && globalSidebarToggle instanceof HTMLButtonElement
            && globalSidebarToggle.getAttribute('aria-expanded') === 'true'
        ) {
            globalSidebarToggle.click();
        }
        applyState(nextOpen, {remember: true});
    };
    const onBackdrop = () => applyState(false, {remember: true, returnFocus: true});
    const onGlobalSidebarStateChange = () => {
        const wasOpen = isOpen;
        applyState(false, {remember: wasOpen});
    };
    const onKeydown = (event) => {
        if (event.key !== 'Escape' || !isOpen) return;
        event.preventDefault();
        applyState(false, {remember: true, returnFocus: true});
    };
    const onMediaChange = () => applyState(overlayMedia.matches && readRememberedState());

    toggle.addEventListener('click', onToggle);
    backdrop.addEventListener('click', onBackdrop);
    const globalSidebarObserver = globalSidebarToggle instanceof HTMLButtonElement
        ? new MutationObserver(onGlobalSidebarStateChange)
        : null;
    globalSidebarObserver?.observe(globalSidebarToggle, {
        attributes: true,
        attributeFilter: ['aria-expanded'],
    });
    document.addEventListener('keydown', onKeydown);
    if (typeof overlayMedia.addEventListener === 'function') {
        overlayMedia.addEventListener('change', onMediaChange);
    } else if (typeof overlayMedia.addListener === 'function') {
        overlayMedia.addListener(onMediaChange);
    }
    applyState(overlayMedia.matches && readRememberedState());

    return () => {
        toggle.removeEventListener('click', onToggle);
        backdrop.removeEventListener('click', onBackdrop);
        globalSidebarObserver?.disconnect();
        document.removeEventListener('keydown', onKeydown);
        if (typeof overlayMedia.removeEventListener === 'function') {
            overlayMedia.removeEventListener('change', onMediaChange);
        } else if (typeof overlayMedia.removeListener === 'function') {
            overlayMedia.removeListener(onMediaChange);
        }
        applyState(false);
    };
};

export function initBacktestLayout() {
    cleanupBacktestLayout();

    const cleanupParameterOverlay = bindBacktestParameterOverlay();

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
    const getProbabilityHistoryMinimumHeight = () => {
        if (!(historySurface instanceof HTMLElement)) return 0;
        const detailPanel = historySurface.querySelector(
            ':scope > .investment-view-surface-body > [data-backtest-probability-detail-panel]:not([hidden])',
        );
        if (!(detailPanel instanceof HTMLElement) || detailPanel.getClientRects().length === 0) return 0;

        const detailStyles = window.getComputedStyle(detailPanel);
        if (detailStyles.display === 'none' || detailStyles.visibility === 'hidden') return 0;
        const detailMinimum = Number.parseFloat(
            detailStyles.getPropertyValue('--backtest-probability-detail-min-height'),
        );
        if (!(detailMinimum > 0)) return 0;

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
        return readBlockPadding(surfaceStyles)
            + surfaceGap
            + segmentedHeight
            + readBlockPadding(bodyStyles)
            + detailMinimum
            + readBlockMargin(detailStyles);
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
        preferOverviewMinimum: true,
        overviewMinimumChangeEvent: PROBABILITY_STAGE_MINIMUM_CHANGE_EVENT,
        ignoreMutationSelector: '[data-backtest-probability-detail-panel]',
        observeHistorySurfaceResize: false,
        onChartsResized: () => bootstrap.backtestChartLayoutRefresh?.(),
    });
    cleanupBacktestLayout = () => {
        cleanupParameterOverlay();
        cleanupSectionResizer?.();
    };
    return cleanupBacktestLayout;
}

bootstrap.initBacktestLayout = initBacktestLayout;
initBacktestLayout();
