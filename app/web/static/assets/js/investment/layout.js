/**
 * Investment split-layout and resizer helpers.
 *
 * Code version: v1.0.0
 */

export const INVESTMENT_LAYOUT_MODULE_VERSION = 'v1.0.0';

export function resolveInvestmentTrackRange({
    availableHeight,
    baselineMinimum,
    desiredOverviewMinimum,
    desiredHistoryMinimum,
}) {
    const safeAvailableHeight = Math.max(0, Number(availableHeight) || 0);
    const safeBaseline = Math.min(
        Math.max(0, Number(baselineMinimum) || 0),
        safeAvailableHeight / 2,
    );
    const safeOverviewMinimum = Math.max(safeBaseline, Number(desiredOverviewMinimum) || 0);
    const safeHistoryMinimum = Math.max(safeBaseline, Number(desiredHistoryMinimum) || 0);
    const desiredExtraHeight = (
        (safeOverviewMinimum - safeBaseline)
        + (safeHistoryMinimum - safeBaseline)
    );
    const availableExtraHeight = Math.max(0, safeAvailableHeight - (safeBaseline * 2));
    const minimumScale = desiredExtraHeight > 0
        ? Math.min(1, availableExtraHeight / desiredExtraHeight)
        : 1;
    const minimum = safeBaseline + ((safeOverviewMinimum - safeBaseline) * minimumScale);
    const historyMinimum = safeBaseline + ((safeHistoryMinimum - safeBaseline) * minimumScale);
    return {
        minimum,
        maximum: Math.max(minimum, safeAvailableHeight - historyMinimum),
        historyMinimum,
    };
}

export function resolveInvestmentOverviewHeight(availableHeight, overviewRatio, range) {
    const requestedHeight = (Number(availableHeight) || 0) * (Number(overviewRatio) || 0);
    return Math.min(Math.max(requestedHeight, range.minimum), range.maximum);
}

export function bindInvestmentSectionResizer({
    workspaceHeader,
    reportCard,
    historySurface,
    sectionResizer,
    minVisibleRows = 2,
    getChartInstance = () => null,
    windowRef = globalThis.window,
    documentRef = globalThis.document,
    HTMLElementClass = globalThis.HTMLElement,
} = {}) {
    const isElement = (value) => (
        typeof HTMLElementClass === 'function' && value instanceof HTMLElementClass
    );
    if (
        !isElement(workspaceHeader)
        || !isElement(reportCard)
        || !isElement(historySurface)
        || !isElement(sectionResizer)
        || typeof windowRef?.ANTIGRAVITY_RESIZER?.bind !== 'function'
    ) return () => {};

    let overviewRatio = Number.NaN;
    let resizeFrame = 0;
    let chartResizeFrame = 0;
    let overviewChromeHeight = 0;
    const summaryCard = workspaceHeader.querySelector(':scope > .workspace-summary-card');
    const readPixelProperty = (element, propertyName, fallback = 0) => {
        if (!isElement(element)) return fallback;
        const value = Number.parseFloat(windowRef.getComputedStyle(element).getPropertyValue(propertyName));
        return Number.isFinite(value) ? value : fallback;
    };
    const getBaselineMinimumHeight = () => {
        const value = readPixelProperty(workspaceHeader, '--investment-section-min-height', 132);
        return Number.isFinite(value) ? value : 132;
    };
    const getOverviewMinimumHeight = (baselineMinimum) => {
        const stage = reportCard.querySelector('.investment-equity-chart-stage');
        if (!isElement(stage)) return baselineMinimum;
        const reportHeight = reportCard.getBoundingClientRect().height;
        const stageHeight = stage.getBoundingClientRect().height;
        if (reportHeight > 0 && stageHeight > 0 && reportHeight >= stageHeight) {
            overviewChromeHeight = Math.max(overviewChromeHeight, reportHeight - stageHeight);
        }
        const stageMinimum = readPixelProperty(
            stage,
            'min-height',
            readPixelProperty(workspaceHeader, '--investment-equity-stage-min-height', 180),
        );
        return Math.max(baselineMinimum, overviewChromeHeight + stageMinimum);
    };
    const getHistoryMinimumHeight = (baselineMinimum) => {
        const primaryTableShell = historySurface.querySelector('#history_table_wrap');
        const stockDetailsTableShell = historySurface.querySelector(
            '#investment_stock_details_table_host:not([hidden]) .investment-stock-details-table-shell',
        );
        const isVisibleTableShell = (tableShell) => (
            isElement(tableShell)
            && tableShell.getClientRects().length > 0
            && windowRef.getComputedStyle(tableShell).display !== 'none'
        );
        const tableShells = [primaryTableShell, stockDetailsTableShell].filter(isVisibleTableShell);
        const fallbackRowHeight = readPixelProperty(
            workspaceHeader,
            '--investment-history-row-min-height',
            40,
        );
        const surfaceStyles = windowRef.getComputedStyle(historySurface);
        const visibleFlowChildren = Array.from(historySurface.children).filter((child) => {
            if (!isElement(child) || child.getClientRects().length === 0) return false;
            const styles = windowRef.getComputedStyle(child);
            return styles.display !== 'none'
                && styles.visibility !== 'hidden'
                && styles.position !== 'absolute';
        });
        const tableFlowChildren = new Set(tableShells.map((tableShell) => (
            visibleFlowChildren.find((child) => child === tableShell || child.contains(tableShell))
        )).filter(Boolean));
        const chromeHeight = visibleFlowChildren.reduce((total, child) => {
            if (tableFlowChildren.has(child)) return total;
            const styles = windowRef.getComputedStyle(child);
            return total
                + child.getBoundingClientRect().height
                + (Number.parseFloat(styles.marginTop) || 0)
                + (Number.parseFloat(styles.marginBottom) || 0);
        }, (
            (Number.parseFloat(surfaceStyles.paddingTop) || 0)
            + (Number.parseFloat(surfaceStyles.paddingBottom) || 0)
            + ((Number.parseFloat(surfaceStyles.rowGap) || 0) * Math.max(0, visibleFlowChildren.length - 1))
        ));
        const tableMinimumHeight = tableShells.reduce((total, tableShell) => {
            const headerTable = tableShell?.querySelector('[data-table-header]');
            const rows = tableShell?.matches('.investment-stock-details-table-shell')
                ? Array.from(tableShell.querySelectorAll('tbody > tr:not([data-table-empty-row])')).slice(0, minVisibleRows)
                : Array.from(tableShell?.querySelectorAll('#investment_history > tr:not([data-table-empty-row])') || [])
                    .slice(0, minVisibleRows);
            const visibleRowsHeight = rows.reduce(
                (rowTotal, row) => rowTotal + Math.max(row.getBoundingClientRect().height, fallbackRowHeight),
                fallbackRowHeight * (minVisibleRows - rows.length),
            );
            const headerHeight = isElement(headerTable)
                ? headerTable.getBoundingClientRect().height
                : readPixelProperty(tableShell, '--scrollable-data-table-header-height', 28);
            return total + Math.max(0, headerHeight) + visibleRowsHeight + 1;
        }, 0);
        return Math.max(baselineMinimum, chromeHeight + tableMinimumHeight);
    };
    const getAvailableTrackHeight = () => {
        const styles = windowRef.getComputedStyle(workspaceHeader);
        const rowGap = Number.parseFloat(styles.rowGap) || 0;
        const paddingTop = Number.parseFloat(styles.paddingTop) || 0;
        const paddingBottom = Number.parseFloat(styles.paddingBottom) || 0;
        const summaryHeight = isElement(summaryCard) ? summaryCard.getBoundingClientRect().height : 0;
        const resizerHeight = sectionResizer.getBoundingClientRect().height;
        const availableHeight = (
            workspaceHeader.clientHeight
            - paddingTop
            - paddingBottom
            - summaryHeight
            - resizerHeight
            - (rowGap * 3)
        );
        if (availableHeight > 0) return availableHeight;
        return reportCard.getBoundingClientRect().height + historySurface.getBoundingClientRect().height;
    };
    const getRange = () => {
        const availableHeight = getAvailableTrackHeight();
        const baselineMinimum = Math.min(getBaselineMinimumHeight(), availableHeight / 2);
        const range = resolveInvestmentTrackRange({
            availableHeight,
            baselineMinimum,
            desiredOverviewMinimum: getOverviewMinimumHeight(baselineMinimum),
            desiredHistoryMinimum: getHistoryMinimumHeight(baselineMinimum),
        });
        workspaceHeader.style.setProperty('--investment-overview-min-height', `${range.minimum}px`);
        workspaceHeader.style.setProperty('--investment-history-min-height', `${range.historyMinimum}px`);
        return {minimum: range.minimum, maximum: range.maximum};
    };
    const getValue = () => reportCard.getBoundingClientRect().height;
    const scheduleOverviewChartResize = () => {
        if (chartResizeFrame) return;
        chartResizeFrame = windowRef.requestAnimationFrame(() => {
            chartResizeFrame = 0;
            const chartInstance = getChartInstance();
            if (chartInstance?.canvas?.isConnected) chartInstance.resize();
        });
    };
    const setValue = (height) => {
        const availableHeight = getAvailableTrackHeight();
        if (!(availableHeight > 0)) return;
        overviewRatio = height / availableHeight;
        workspaceHeader.style.setProperty('--investment-overview-track', `${height}px`);
        scheduleOverviewChartResize();
        sectionResizer.setAttribute('aria-valuetext', `Overview ${Math.round(overviewRatio * 100)} percent`);
    };
    const valueFromPointer = (clientY) => {
        const reportRect = reportCard.getBoundingClientRect();
        const handleRect = sectionResizer.getBoundingClientRect();
        const rowGap = Number.parseFloat(windowRef.getComputedStyle(workspaceHeader).rowGap) || 0;
        return clientY - reportRect.top - rowGap - (handleRect.height / 2);
    };
    const reflowRatio = () => {
        resizeFrame = 0;
        const availableHeight = getAvailableTrackHeight();
        const range = getRange();
        const defaultOverviewShare = Math.min(0.8, Math.max(
            0.2,
            Number.parseFloat(
                windowRef.getComputedStyle(workspaceHeader).getPropertyValue('--investment-default-overview-share'),
            ) || 0.44,
        ));
        if (!Number.isFinite(overviewRatio)) overviewRatio = defaultOverviewShare;
        const nextHeight = resolveInvestmentOverviewHeight(availableHeight, overviewRatio, range);
        if (Math.abs(nextHeight - getValue()) < 0.5) return;
        workspaceHeader.style.setProperty('--investment-overview-track', `${nextHeight}px`);
        scheduleOverviewChartResize();
    };
    const scheduleRatioReflow = () => {
        if (resizeFrame) return;
        resizeFrame = windowRef.requestAnimationFrame(reflowRatio);
    };
    const unbind = windowRef.ANTIGRAVITY_RESIZER.bind(sectionResizer, {
        axis: 'block',
        root: workspaceHeader,
        getRange,
        getValue,
        setValue,
        valueFromPointer,
        step: 16,
        largeStep: 48,
        onEnd: () => windowRef.dispatchEvent(new Event('resize')),
    });
    const ResizeObserverClass = windowRef.ResizeObserver || globalThis.ResizeObserver;
    const MutationObserverClass = windowRef.MutationObserver || globalThis.MutationObserver;
    const observer = typeof ResizeObserverClass === 'function'
        ? new ResizeObserverClass(scheduleRatioReflow)
        : null;
    observer?.observe(workspaceHeader);
    observer?.observe(reportCard);
    observer?.observe(historySurface);
    const mutationObserver = typeof MutationObserverClass === 'function'
        ? new MutationObserverClass(scheduleRatioReflow)
        : null;
    mutationObserver?.observe(reportCard, {childList: true, subtree: true});
    mutationObserver?.observe(historySurface, {childList: true, subtree: true});
    scheduleRatioReflow();
    windowRef.addEventListener('resize', scheduleRatioReflow, {passive: true});
    const cleanup = () => {
        unbind();
        observer?.disconnect();
        mutationObserver?.disconnect();
        windowRef.removeEventListener('resize', scheduleRatioReflow);
        if (resizeFrame) windowRef.cancelAnimationFrame(resizeFrame);
        if (chartResizeFrame) windowRef.cancelAnimationFrame(chartResizeFrame);
    };
    windowRef.addEventListener('pagehide', cleanup, {once: true});
    return cleanup;
}
