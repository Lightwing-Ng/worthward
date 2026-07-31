/**
 * Standard scrollable table alignment controller.
 *
 * Code version: v1.0.1
 */
(function bootstrapStandardTableController(globalScope) {
    "use strict";

    const HEADER_HEIGHT_PROPERTY = "--scrollable-data-table-header-height";
    const SCROLLBAR_WIDTH_PROPERTY = "--scrollable-data-table-scrollbar-width";
    const BORDER_COMPENSATION_PROPERTY = "--scrollable-data-table-overlay-border-compensation";

    const getCellSpan = (cell) => Math.max(1, Number(cell?.colSpan) || 1);

    const selectMeasurementRowDescriptor = (rows = [], expectedColumnCount = 0) => {
        const candidates = rows.filter((row) => (
            !row.empty
            && !row.summary
            && row.cellSpans.length > 0
            && row.cellSpans.every((span) => span === 1)
        ));
        if (expectedColumnCount > 0) {
            return candidates.find((row) => row.cellSpans.length === expectedColumnCount) || null;
        }
        return candidates.reduce((best, row) => (
            !best || row.cellSpans.length > best.cellSpans.length ? row : best
        ), null);
    };

    const getMeasurementRow = (table, expectedColumnCount = 0) => {
        if (!(table instanceof HTMLTableElement)) return null;
        const rows = Array.from(table.rows);
        const descriptors = rows.map((row) => ({
            row,
            empty: row.matches("[data-table-empty-row]"),
            summary: row.matches("[data-table-summary-row]"),
            cellSpans: Array.from(row.cells).map(getCellSpan),
        }));
        return selectMeasurementRowDescriptor(descriptors, expectedColumnCount)?.row || null;
    };

    const getHeaderTable = (shell) => (
        Array.from(shell.children).find((child) => (
            child instanceof HTMLTableElement
            && child.matches("[data-table-header], table[aria-hidden='true']")
        )) || null
    );

    const getScrollContainer = (shell) => (
        Array.from(shell.children).find((child) => (
            child instanceof HTMLElement
            && child.matches("[data-table-scroll], .scrollable-data-table-scroll")
        )) || null
    );

    const getBodyTable = (scrollContainer) => (
        scrollContainer?.querySelector("table[data-table-body], table:not([data-table-header])") || null
    );

    const ensureVisualOverlay = (shell) => {
        let overlay = Array.from(shell.children).find((child) => (
            child instanceof HTMLElement
            && child.matches("[data-table-visual-overlay]")
        ));
        if (!(overlay instanceof HTMLElement)) {
            overlay = document.createElement("div");
            overlay.className = "scrollable-data-table-visual-overlay";
            overlay.dataset.tableVisualOverlay = "";
            overlay.setAttribute("aria-hidden", "true");
            shell.prepend(overlay);
        }
        return overlay;
    };

    const roundUpToDevicePixel = (value) => {
        const scale = globalScope.devicePixelRatio || 1;
        return Math.ceil(value * scale) / scale;
    };

    const syncColumnWidths = (headerTable, bodyTable, trailingTrackWidth) => {
        if (!(headerTable instanceof HTMLTableElement) || !(bodyTable instanceof HTMLTableElement)) return false;
        const expectedColumnCount = Math.max(
            0,
            ...Array.from(headerTable.rows).map((row) => Array.from(row.cells).reduce(
                (total, cell) => total + getCellSpan(cell),
                0,
            )),
        );
        const bodyRow = getMeasurementRow(bodyTable, expectedColumnCount);
        if (!bodyRow) return false;
        const columnWidths = Array.from(bodyRow.cells).map((cell) => cell.getBoundingClientRect().width);
        if (columnWidths.length !== expectedColumnCount) return false;
        columnWidths[columnWidths.length - 1] = Math.max(
            1,
            columnWidths[columnWidths.length - 1] + trailingTrackWidth,
        );
        const headerColumns = Array.from(headerTable.querySelectorAll(":scope > colgroup > col"));
        const hasMatchingColumnGroup = headerColumns.length === columnWidths.length;
        if (hasMatchingColumnGroup) {
            headerColumns.forEach((column, index) => {
                column.style.width = `${columnWidths[index]}px`;
            });
        }
        Array.from(headerTable.rows).forEach((row) => {
            Array.from(row.cells).forEach((cell, index) => {
                if (getCellSpan(cell) !== 1 || index >= columnWidths.length) return;
                const bodyStyle = globalScope.getComputedStyle(bodyRow.cells[index]);
                const bodyEndPadding = Number.parseFloat(bodyStyle.paddingInlineEnd) || 0;
                cell.style.paddingInlineStart = bodyStyle.paddingInlineStart;
                cell.style.paddingInlineEnd = `${bodyEndPadding + (
                    index === columnWidths.length - 1 ? trailingTrackWidth : 0
                )}px`;
                if (hasMatchingColumnGroup) {
                    cell.style.removeProperty("width");
                } else {
                    cell.style.width = `${columnWidths[index]}px`;
                }
            });
        });
        return true;
    };

    const attach = (shell, { scrollbarProperty = "" } = {}) => {
        if (!(shell instanceof HTMLElement)) return () => {};
        let frameId = 0;
        let resizeObserver = null;
        const visualOverlay = ensureVisualOverlay(shell);

        const sync = () => {
            frameId = 0;
            const headerTable = getHeaderTable(shell);
            const scrollContainer = getScrollContainer(shell);
            const bodyTable = getBodyTable(scrollContainer);
            if (!(headerTable instanceof HTMLTableElement)
                || !(scrollContainer instanceof HTMLElement)
                || !(bodyTable instanceof HTMLTableElement)) return;
            const scrollbarWidth = Math.max(0, scrollContainer.offsetWidth - scrollContainer.clientWidth);
            const bodyRow = getMeasurementRow(bodyTable, Math.max(
                0,
                ...Array.from(headerTable.rows).map((row) => row.cells.length),
            ));
            const lastCell = bodyRow?.cells[bodyRow.cells.length - 1] || null;
            const trailingTrackWidth = lastCell
                ? Math.max(0, shell.getBoundingClientRect().right - lastCell.getBoundingClientRect().right)
                : scrollbarWidth;
            shell.style.setProperty(SCROLLBAR_WIDTH_PROPERTY, `${trailingTrackWidth}px`);
            shell.style.setProperty(BORDER_COMPENSATION_PROPERTY, `${trailingTrackWidth > 0 ? 1 : 0}px`);
            if (scrollbarProperty) shell.style.setProperty(scrollbarProperty, `${scrollbarWidth}px`);
            syncColumnWidths(headerTable, bodyTable, trailingTrackWidth);
            const headerHeight = headerTable.getBoundingClientRect().height;
            if (headerHeight > 0) {
                shell.style.setProperty(HEADER_HEIGHT_PROPERTY, `${roundUpToDevicePixel(headerHeight)}px`);
            }
        };

        const schedule = () => {
            if (frameId) globalScope.cancelAnimationFrame(frameId);
            frameId = globalScope.requestAnimationFrame(sync);
        };

        schedule();
        globalScope.addEventListener("resize", schedule);
        if (typeof ResizeObserver === "function") {
            resizeObserver = new ResizeObserver(schedule);
            [shell, getHeaderTable(shell), getScrollContainer(shell), getBodyTable(getScrollContainer(shell))]
                .filter((node) => node instanceof HTMLElement)
                .forEach((node) => resizeObserver.observe(node));
        }

        return () => {
            if (frameId) globalScope.cancelAnimationFrame(frameId);
            globalScope.removeEventListener("resize", schedule);
            resizeObserver?.disconnect();
            visualOverlay.remove();
            shell.style.removeProperty(HEADER_HEIGHT_PROPERTY);
            shell.style.removeProperty(SCROLLBAR_WIDTH_PROPERTY);
            shell.style.removeProperty(BORDER_COMPENSATION_PROPERTY);
            if (scrollbarProperty) shell.style.removeProperty(scrollbarProperty);
        };
    };

    const attachAll = (root = document) => {
        const cleanups = new Map();
        let mutationObserver = null;
        const reconcile = () => {
            const currentShells = new Set(root.querySelectorAll(".scrollable-data-table-shell"));
            currentShells.forEach((shell) => {
                if (!cleanups.has(shell)) cleanups.set(shell, attach(shell));
            });
            Array.from(cleanups.entries()).forEach(([shell, cleanup]) => {
                if (currentShells.has(shell) && shell.isConnected) return;
                cleanup();
                cleanups.delete(shell);
            });
        };
        reconcile();
        if (typeof MutationObserver === "function") {
            mutationObserver = new MutationObserver(reconcile);
            mutationObserver.observe(root, { childList: true, subtree: true });
        }
        return () => {
            mutationObserver?.disconnect();
            cleanups.forEach((cleanup) => cleanup());
            cleanups.clear();
        };
    };

    const api = Object.freeze({
        attach,
        attachAll,
        getMeasurementRow,
        selectMeasurementRowDescriptor,
        syncColumnWidths,
    });
    globalScope.ANTIGRAVITY_TABLES = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
}(typeof window !== "undefined" ? window : globalThis));
