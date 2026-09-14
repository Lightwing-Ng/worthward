/**
 * Range controls and internal-transfer matching.
 *
 * Code version: v1.0.0
 * - Added: Extracted from the Investment workspace composition root.
 */

export function createInvestmentRangeTransferRuntime(runtime) {
function collectSegmentedTextNodes(element) {
        const nodes = [];
        const visit = (node) => {
            if (!node) return;
            if (node.nodeType === Node.TEXT_NODE) {
                if (String(node.textContent || '').trim()) nodes.push(node);
                return;
            }
            Array.from(node.childNodes || []).forEach(visit);
        };
        visit(element);
        return nodes;
    }

function measureSegmentedInlineContentRect(element, renderSafetyPx = runtime.SEGMENTED_TEXT_RENDER_SAFETY_PX) {
        if (!(element instanceof HTMLElement)) return null;
        const textNodes = collectSegmentedTextNodes(element);
        const rects = [];
        textNodes.forEach((textNode) => {
            const range = document.createRange();
            range.selectNodeContents(textNode);
            rects.push(...Array.from(range.getClientRects()));
            if (typeof range.detach === 'function') {
                range.detach();
            }
        });
        let left = Infinity;
        let right = -Infinity;
        rects.forEach((rect) => {
            if (rect.width <= 0) return;
            left = Math.min(left, rect.left);
            right = Math.max(right, rect.right);
        });
        if (Number.isFinite(left) && Number.isFinite(right) && right > left) {
            return {
                centerX: (left + right) / 2,
                width: Math.ceil((right - left) + renderSafetyPx),
            };
        }
        const fallbackRect = element.getBoundingClientRect();
        if (fallbackRect.width <= 0) return null;
        return {
            centerX: fallbackRect.left + (fallbackRect.width / 2),
            width: Math.ceil(fallbackRect.width + renderSafetyPx),
        };
    }

function measureInvestmentSegmentedPillGeometry(control, activeLabel, {
        labelSelector = '',
        horizontalInset = null,
        centerOnActiveContent = false,
        alignEdgeCaps = false,
    } = {}) {
        if (!(control instanceof HTMLElement) || !(activeLabel instanceof HTMLElement)) return null;
        const activeOption = activeLabel.closest('.segmented-control-option');
        const options = Array.from(control.querySelectorAll('.segmented-control-option')).filter((option) => option instanceof HTMLElement);
        if (!(activeOption instanceof HTMLElement) || !options.length) return null;
        const controlStyles = window.getComputedStyle(control);
        const renderSafetyPx = Math.max(
            0,
            Math.round(
                Number.parseFloat(controlStyles.getPropertyValue('--segmented-text-render-safety-px'))
                || runtime.SEGMENTED_TEXT_RENDER_SAFETY_PX,
            ),
        );
        const resolvedHorizontalInset = Math.max(
            0,
            Math.round(
                Number.parseFloat(horizontalInset)
                || Math.max(
                    Number.parseFloat(window.getComputedStyle(activeLabel).paddingLeft) || 0,
                    Number.parseFloat(window.getComputedStyle(activeLabel).paddingRight) || 0,
                )
                || Number.parseFloat(controlStyles.getPropertyValue('--mode-switch-label-pad-inline'))
                || 0,
            ),
        );
        const columnGap = Math.max(
            0,
            Math.round(
                Number.parseFloat(controlStyles.columnGap)
                || Number.parseFloat(controlStyles.getPropertyValue('gap'))
                || Number.parseFloat(controlStyles.getPropertyValue('--mode-switch-gap'))
                || 0,
            ),
        );
        const controlPaddingInline = Math.max(
            0,
            Math.round(
                (Number.parseFloat(controlStyles.paddingLeft) || 0)
                + (Number.parseFloat(controlStyles.paddingRight) || 0),
            ),
        );
        const measureOptionContentWidth = (optionLabel) => {
            const measureTarget = labelSelector
                ? (optionLabel.querySelector(labelSelector) || optionLabel)
                : optionLabel;
            return runtime.measureSegmentedInlineContentWidth(
                measureTarget instanceof HTMLElement ? measureTarget : optionLabel,
                renderSafetyPx,
            );
        };
        const maxContentWidth = options.reduce((currentMax, option) => {
            const optionLabel = option.querySelector('input + span');
            if (!(optionLabel instanceof HTMLElement)) return currentMax;
            return Math.max(currentMax, measureOptionContentWidth(optionLabel));
        }, 0);
        let optionWidth = Math.max(1, Math.ceil(maxContentWidth + (resolvedHorizontalInset * 2)));
        const optionCount = options.length;
        const activeIndex = Math.max(0, options.indexOf(activeOption));
        const overflowFrame = control.dataset.segmentedOverflowMode === 'peek'
            ? control.closest('[data-segmented-overflow-frame]')
            : null;
        const usesSharedOverflowFrame = overflowFrame instanceof HTMLElement;
        let totalControlWidth = 0;
        let visibleControlWidth = 0;
        let renderedControlRect = control.getBoundingClientRect();
        let renderedControlWidth = renderedControlRect.width;
        let shouldOverflow = false;
        if (usesSharedOverflowFrame) {
            window.WORTHWARD_SEGMENTED_CONTROLS?.sync?.(control, {
                activeIndex,
                options,
            });
            renderedControlRect = control.getBoundingClientRect();
            renderedControlWidth = renderedControlRect.width;
            optionWidth = Math.max(1, activeOption.getBoundingClientRect().width);
            totalControlWidth = Math.max(renderedControlWidth, control.scrollWidth);
            visibleControlWidth = overflowFrame.clientWidth;
            shouldOverflow = overflowFrame.scrollWidth > overflowFrame.clientWidth + 1;
            control.dataset.segmentedOverflow = shouldOverflow ? '1' : '0';
        } else {
            const naturalControlWidth = controlPaddingInline
                + (optionWidth * optionCount)
                + (columnGap * Math.max(0, optionCount - 1));
            control.dataset.segmentedOverflow = '0';
            control.style.setProperty('--segmented-option-width', `${optionWidth}px`);
            control.style.setProperty('--segmented-option-count', String(optionCount));
            control.style.gridTemplateColumns = `repeat(${optionCount}, ${optionWidth}px)`;
            control.style.width = `${naturalControlWidth}px`;
            const constrainedControlWidth = control.getBoundingClientRect().width || naturalControlWidth;
            visibleControlWidth = Math.min(naturalControlWidth, constrainedControlWidth);
            const fittedOptionWidth = Math.floor(
                (
                    visibleControlWidth
                    - controlPaddingInline
                    - (columnGap * Math.max(0, optionCount - 1))
                ) / optionCount,
            );
            const minimumReadableOptionWidth = Math.ceil(
                maxContentWidth + (Math.min(resolvedHorizontalInset, 8) * 2),
            );
            if (fittedOptionWidth >= minimumReadableOptionWidth) {
                optionWidth = Math.min(optionWidth, fittedOptionWidth);
            }
            totalControlWidth = controlPaddingInline
                + (optionWidth * optionCount)
                + (columnGap * Math.max(0, optionCount - 1));
            const requestedControlWidth = Math.min(totalControlWidth, visibleControlWidth);
            control.style.setProperty('--segmented-option-width', `${optionWidth}px`);
            control.style.gridTemplateColumns = `repeat(${optionCount}, ${optionWidth}px)`;
            control.style.width = `${requestedControlWidth}px`;
            renderedControlRect = control.getBoundingClientRect();
            renderedControlWidth = renderedControlRect.width;
            shouldOverflow = control.scrollWidth > control.clientWidth + 3;
            control.dataset.segmentedOverflow = shouldOverflow ? '1' : '0';
        }
        const activeMeasureTarget = labelSelector
            ? (activeLabel.querySelector(labelSelector) || activeLabel)
            : activeLabel;
        const activeContentRect = measureSegmentedInlineContentRect(
            activeMeasureTarget instanceof HTMLElement ? activeMeasureTarget : activeLabel,
            renderSafetyPx,
        );
        const activeContentWidth = activeContentRect?.width || measureOptionContentWidth(activeLabel);
        const activePillWidth = centerOnActiveContent
            ? Math.min(optionWidth, Math.max(1, Math.ceil(activeContentWidth + (resolvedHorizontalInset * 2))))
            : optionWidth;
        const activeOptionRect = activeOption.getBoundingClientRect();
        const activeContentCenter = (
            centerOnActiveContent
            && activeContentRect
            && activeOptionRect.width > 0
        )
            ? activeContentRect.centerX - renderedControlRect.left + control.scrollLeft
            : activeOptionRect.left - renderedControlRect.left + control.scrollLeft + (activeOptionRect.width / 2);
        const thumbInlineInset = Math.max(
            0,
            Number.parseFloat(controlStyles.getPropertyValue('--mode-switch-thumb-inset'))
            || Number.parseFloat(controlStyles.paddingLeft)
            || 0,
        );
        let constrainedPillWidth = activePillWidth;
        let activePillLeft = activeContentCenter - (constrainedPillWidth / 2) - thumbInlineInset;
        if (centerOnActiveContent && alignEdgeCaps) {
            const thumbBlockInset = Math.max(
                0,
                Number.parseFloat(controlStyles.getPropertyValue('--mode-switch-thumb-inset'))
                || Number.parseFloat(controlStyles.paddingTop)
                || 0,
            );
            const railCapRadius = renderedControlRect.height / 2;
            const thumbCapRadius = Math.max(0, (renderedControlRect.height - (thumbBlockInset * 2)) / 2);
            if (activeIndex === 0) {
                const desiredPhysicalLeft = railCapRadius - thumbCapRadius;
                constrainedPillWidth = Math.max(1, (activeContentCenter - desiredPhysicalLeft) * 2);
                activePillLeft = desiredPhysicalLeft - thumbInlineInset;
            } else if (activeIndex === optionCount - 1) {
                const controlExtent = shouldOverflow ? control.scrollWidth : renderedControlWidth;
                const desiredPhysicalRight = controlExtent - railCapRadius + thumbCapRadius;
                constrainedPillWidth = Math.max(1, (desiredPhysicalRight - activeContentCenter) * 2);
                activePillLeft = activeContentCenter - (constrainedPillWidth / 2) - thumbInlineInset;
            }
        }
        return {
            left: activePillLeft,
            width: constrainedPillWidth,
            contentLeft: activePillLeft + thumbInlineInset,
            contentRight: activePillLeft + thumbInlineInset + constrainedPillWidth,
            totalWidth: totalControlWidth,
            visibleWidth: renderedControlWidth,
        };
    }

function keepSegmentedActiveOptionVisible(control, pillGeometry) {
        if (!(control instanceof HTMLElement) || !pillGeometry) return;
        const activeOption = control.querySelector('input[type="radio"]:checked')?.closest('.segmented-control-option');
        if (
            activeOption instanceof HTMLElement
            && control.closest('[data-segmented-overflow-frame]') instanceof HTMLElement
            && window.WORTHWARD_SEGMENTED_CONTROLS?.keepOptionVisible
        ) {
            window.WORTHWARD_SEGMENTED_CONTROLS.keepOptionVisible(control, activeOption);
            return;
        }
        const maxScrollLeft = Math.max(0, control.scrollWidth - control.clientWidth);
        if (maxScrollLeft <= 0) {
            control.scrollLeft = 0;
            return;
        }
        const leftSafety = Math.max(0, Math.round(Number.parseFloat(getComputedStyle(control).paddingLeft) || 0));
        const rightSafety = Math.max(
            leftSafety,
            Math.round(Number.parseFloat(getComputedStyle(control).paddingRight) || 0),
        );
        const activeLeft = pillGeometry.contentLeft ?? pillGeometry.left;
        const activeRight = pillGeometry.contentRight ?? (pillGeometry.left + pillGeometry.width);
        let nextScrollLeft = control.scrollLeft;
        if (activeLeft < control.scrollLeft + leftSafety) {
            nextScrollLeft = activeLeft - leftSafety;
        } else if (activeRight > control.scrollLeft + control.clientWidth - rightSafety) {
            nextScrollLeft = activeRight - control.clientWidth + rightSafety;
        }
        control.scrollLeft = Math.min(maxScrollLeft, Math.max(0, nextScrollLeft));
    }

function syncInvestmentShareActionsPosition() {
        if (!(runtime.investmentShareActions instanceof HTMLElement) || !(runtime.segmentedControl instanceof HTMLElement)) {
            return;
        }
        const segmentedRect = runtime.segmentedControl.getBoundingClientRect();
        if (!segmentedRect.height) return;
        const centerY = segmentedRect.top + (segmentedRect.height / 2);
        runtime.investmentShareActions.style.setProperty('--investment-share-actions-top', `${centerY}px`);
        runtime.investmentShareActions.style.top = `${centerY}px`;
    }

function updateInvestmentSegmentedPill() {
        if (!runtime.segmentedControl) return;
        const activeLabel = runtime.segmentedControl.querySelector('input[type="radio"]:checked + span');
        if (!activeLabel) {
            runtime.segmentedControl.classList.remove('is-pill-ready');
            syncInvestmentShareActionsPosition();
            return;
        }

        const pillGeometry = measureInvestmentSegmentedPillGeometry(runtime.segmentedControl, activeLabel, {
            centerOnActiveContent: true,
            alignEdgeCaps: true,
        });
        if (!pillGeometry) {
            runtime.segmentedControl.classList.remove('is-pill-ready');
            syncInvestmentShareActionsPosition();
            return;
        }

        runtime.segmentedControl.style.setProperty('--segmented-pill-left', `${pillGeometry.left}px`);
        runtime.segmentedControl.style.setProperty('--segmented-pill-width', `${pillGeometry.width}px`);
        keepSegmentedActiveOptionVisible(runtime.segmentedControl, pillGeometry);
        runtime.segmentedControl.classList.add('is-pill-ready');
        syncInvestmentShareActionsPosition();
    }

function scheduleInvestmentSegmentedPillUpdate() {
        if (!runtime.segmentedControl) return;
        runtime.segmentedControl.classList.remove('is-pill-ready');
        runtime.clearInvestmentSegmentedMeasureRaf();
        runtime.clearInvestmentSegmentedMeasureTimer();
        runtime.state.investmentSegmentedMeasureRaf = window.requestAnimationFrame(() => {
            runtime.state.investmentSegmentedMeasureRaf = window.requestAnimationFrame(() => {
                runtime.state.investmentSegmentedMeasureRaf = 0;
                updateInvestmentSegmentedPill();
                runtime.state.investmentSegmentedMeasureTimer = window.setTimeout(() => {
                    runtime.state.investmentSegmentedMeasureTimer = 0;
                    updateInvestmentSegmentedPill();
                }, 520);
            });
        });
    }

function updateIbkrImportSegmentedPill() {
        if (!(runtime.investmentImportIbkrMode instanceof HTMLElement)) return;
        const controlRect = runtime.investmentImportIbkrMode.getBoundingClientRect();
        if (controlRect.width <= 0 || controlRect.height <= 0) return;
        const activeLabel = runtime.investmentImportIbkrMode.querySelector('input[type="radio"]:checked + span');
        if (!activeLabel) {
            runtime.investmentImportIbkrMode.classList.remove('is-pill-ready');
            return;
        }
        const pillGeometry = measureInvestmentSegmentedPillGeometry(runtime.investmentImportIbkrMode, activeLabel);
        if (!pillGeometry) {
            runtime.investmentImportIbkrMode.classList.remove('is-pill-ready');
            return;
        }
        runtime.investmentImportIbkrMode.style.setProperty('--segmented-pill-left', `${pillGeometry.left}px`);
        runtime.investmentImportIbkrMode.style.setProperty('--segmented-pill-width', `${pillGeometry.width}px`);
        keepSegmentedActiveOptionVisible(runtime.investmentImportIbkrMode, pillGeometry);
        runtime.investmentImportIbkrMode.classList.add('is-pill-ready');
    }

function scheduleIbkrImportSegmentedPillUpdate() {
        if (!(runtime.investmentImportIbkrMode instanceof HTMLElement)) return;
        if (runtime.state.investmentIbkrModeMeasureRaf) {
            window.cancelAnimationFrame(runtime.state.investmentIbkrModeMeasureRaf);
            runtime.state.investmentIbkrModeMeasureRaf = 0;
        }
        runtime.state.investmentIbkrModeMeasureRaf = window.requestAnimationFrame(() => {
            runtime.state.investmentIbkrModeMeasureRaf = window.requestAnimationFrame(() => {
                runtime.state.investmentIbkrModeMeasureRaf = 0;
                updateIbkrImportSegmentedPill();
            });
        });
    }

function updateHsbcImportSegmentedPill() {
        if (!(runtime.investmentImportHsbcMode instanceof HTMLElement)) return;
        const activeLabel = runtime.investmentImportHsbcMode.querySelector('input[type="radio"]:checked + span');
        if (!activeLabel) {
            runtime.investmentImportHsbcMode.classList.remove('is-pill-ready');
            return;
        }
        const pillGeometry = measureInvestmentSegmentedPillGeometry(runtime.investmentImportHsbcMode, activeLabel);
        if (!pillGeometry) {
            runtime.investmentImportHsbcMode.classList.remove('is-pill-ready');
            return;
        }
        runtime.investmentImportHsbcMode.style.setProperty('--segmented-pill-left', `${pillGeometry.left}px`);
        runtime.investmentImportHsbcMode.style.setProperty('--segmented-pill-width', `${pillGeometry.width}px`);
        keepSegmentedActiveOptionVisible(runtime.investmentImportHsbcMode, pillGeometry);
        runtime.investmentImportHsbcMode.classList.add('is-pill-ready');
    }

function scheduleHsbcImportSegmentedPillUpdate() {
        if (!(runtime.investmentImportHsbcMode instanceof HTMLElement)) return;
        runtime.investmentImportHsbcMode.classList.remove('is-pill-ready');
        if (runtime.state.investmentHsbcModeMeasureRaf) {
            window.cancelAnimationFrame(runtime.state.investmentHsbcModeMeasureRaf);
            runtime.state.investmentHsbcModeMeasureRaf = 0;
        }
        runtime.state.investmentHsbcModeMeasureRaf = window.requestAnimationFrame(() => {
            runtime.state.investmentHsbcModeMeasureRaf = window.requestAnimationFrame(() => {
                runtime.state.investmentHsbcModeMeasureRaf = 0;
                updateHsbcImportSegmentedPill();
            });
        });
    }

function getInvestmentStockDetailsRangeControl() {
        const control = runtime.investmentStockDetailsPanel?.querySelector('[data-investment-stock-details-range-segmented]');
        return control instanceof HTMLElement ? control : null;
    }

function getInvestmentEquityRangeControl() {
        const chartContainer = document.getElementById('investment_equity_chart');
        const control = chartContainer?.querySelector('[data-investment-equity-range-segmented]');
        return control instanceof HTMLElement ? control : null;
    }

function isInvestmentStockDetailsIntradayRange(range) {
        return runtime.isInvestmentStockDetailsIntradayRangeCore(
            range,
            runtime.INVESTMENT_STOCK_DETAILS_RANGE_OPTIONS,
        );
    }

function buildInvestmentIntradayDayFallbackIndex(labels = []) {
        return runtime.buildInvestmentIntradayDayFallbackIndexCore(labels, runtime.normalizeLedgerDate);
    }

function buildInvestmentIntradayDayBoundaries(labels = []) {
        return runtime.buildInvestmentIntradayDayBoundariesCore(labels, runtime.normalizeLedgerDate);
    }

function getInvestmentTradeSessionType(value) {
        return runtime.getInvestmentTradeSessionTypeCore(value, runtime.parseInvestmentDateParts);
    }

async function loadInvestmentStockDetailsIntradayRows(ticker, range) {
        const normalizedTicker = runtime.normalizeInvestmentTicker(ticker);
        const normalizedRange = normalizeInvestmentStockDetailsRange(range);
        if (!normalizedTicker || !isInvestmentStockDetailsIntradayRange(normalizedRange)) return [];
        const cacheKey = `${normalizedTicker}:${normalizedRange}`;
        if (runtime.investmentStockDetailsIntradayCache.has(cacheKey)) {
            return runtime.investmentStockDetailsIntradayCache.get(cacheKey) || [];
        }
        if (runtime.investmentStockDetailsIntradayInflight.has(cacheKey)) {
            return runtime.investmentStockDetailsIntradayInflight.get(cacheKey);
        }
        const requestPromise = (async () => {
            const response = await fetch(
                `/api/investment/intraday?ticker=${encodeURIComponent(normalizedTicker)}&range=${encodeURIComponent(normalizedRange)}&ensure_store=1`,
                runtime.buildInvestmentRequestOptions(),
            );
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || payload?.success === false) {
                throw new Error(payload?.error || `Unable to load 1-minute market data for ${normalizedTicker}.`);
            }
            const rows = runtime.normalizeInvestmentStockDetailsIntradayRows(payload?.rows);
            runtime.investmentStockDetailsIntradayCache.set(cacheKey, rows);
            return rows;
        })();
        runtime.investmentStockDetailsIntradayInflight.set(cacheKey, requestPromise);
        try {
            return await requestPromise;
        } finally {
            runtime.investmentStockDetailsIntradayInflight.delete(cacheKey);
        }
    }

async function loadInvestmentOverviewIntradayRows(ticker, dayKeys = [], range = runtime.state.selectedInvestmentEquityRange) {
        const normalizedTicker = runtime.normalizeInvestmentTicker(ticker);
        const normalizedRange = runtime.isInvestmentOverviewIntradayEquityRange(range)
            ? normalizeInvestmentEquityRange(range)
            : '1w';
        if (!normalizedTicker) return [];
        const requestedDayKeys = (Array.isArray(dayKeys) ? dayKeys : [])
            .map((dayKey) => runtime.normalizeLedgerDate(dayKey))
            .filter(Boolean);
        const requestedDays = requestedDayKeys.join(',');
        const cacheKey = `${normalizedTicker}:${normalizedRange}:${requestedDays}`;
        if (runtime.investmentOverviewIntradayCache.has(cacheKey)) {
            return runtime.investmentOverviewIntradayCache.get(cacheKey) || [];
        }
        if (runtime.investmentOverviewIntradayInflight.has(cacheKey)) {
            return runtime.investmentOverviewIntradayInflight.get(cacheKey);
        }
        const requestPromise = (async () => {
            const abortController = new AbortController();
            const timeoutId = window.setTimeout(
                () => abortController.abort(),
                runtime.INVESTMENT_OVERVIEW_INTRADAY_REQUEST_TIMEOUT_MS,
            );
            const dayQuery = requestedDays ? `&days=${encodeURIComponent(requestedDays)}` : '';
            let response = null;
            try {
                response = await fetch(
                    `/api/investment/intraday?ticker=${encodeURIComponent(normalizedTicker)}&range=${encodeURIComponent(normalizedRange)}&ensure_store=1${dayQuery}`,
                    runtime.buildInvestmentRequestOptions({ signal: abortController.signal }),
                );
            } finally {
                window.clearTimeout(timeoutId);
            }
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || payload?.success === false) {
                throw new Error(payload?.error || `Unable to load 1-minute market data for ${normalizedTicker}.`);
            }
            const rows = runtime.normalizeInvestmentStockDetailsIntradayRows(payload?.rows);
            runtime.investmentOverviewIntradayCache.set(cacheKey, rows);
            return rows;
        })();
        runtime.investmentOverviewIntradayInflight.set(cacheKey, requestPromise);
        try {
            return await requestPromise;
        } finally {
            runtime.investmentOverviewIntradayInflight.delete(cacheKey);
        }
    }

function buildInvestmentOverviewIntradayMinuteMap(rows = [], requiredDateKey = '') {
        const minuteMap = new Map();
        (Array.isArray(rows) ? rows : []).forEach((row) => {
            const minuteKey = runtime.normalizeInvestmentIntradayMinuteKey(row?.date);
            if (!minuteKey) return;
            if (requiredDateKey && runtime.normalizeLedgerDate(minuteKey) !== requiredDateKey) return;
            if (getInvestmentTradeSessionType(minuteKey) !== 'intraday') return;
            const open = Number(row?.open);
            const high = Number(row?.high);
            const low = Number(row?.low);
            const close = Number(row?.close);
            if (![open, high, low, close].every((value) => Number.isFinite(value) && value > 0)) return;
            minuteMap.set(minuteKey, { open, high, low, close });
        });
        return minuteMap;
    }

function getInvestmentSnapshotFixedHoldingValue(snapshot, ticker, quantity, valuationDate, fxTimeline, baseCurrency, tickerPriceIndex = null) {
        const normalizedTicker = runtime.normalizeInvestmentTicker(ticker);
        const numericQuantity = Number(quantity);
        if (!normalizedTicker || !Number.isFinite(numericQuantity) || Math.abs(numericQuantity) < 1e-9) return 0;
        const moneyMarketTickers = runtime.getMoneyMarketTickerSet();
        let price = null;
        if (moneyMarketTickers.has(normalizedTicker)) {
            price = Number(
                snapshot?.aggregate_money_market_anchors?.[normalizedTicker]
                ?? snapshot?.money_market_anchors?.[normalizedTicker],
            );
        }
        if (!Number.isFinite(price) || price <= 0) {
            price = runtime.getIndexedClosePriceOnOrBefore(tickerPriceIndex?.[normalizedTicker], valuationDate);
        }
        if (!Number.isFinite(price) || price <= 0) return 0;
        return runtime.convertAmountToBaseCurrency(
            numericQuantity * price,
            runtime.getTickerQuoteCurrency(normalizedTicker),
            valuationDate,
            fxTimeline,
            baseCurrency,
        );
    }

function getInvestmentOverviewLatestOneWeekMinuteKeys(minuteKeys = []) {
        const orderedMinuteKeys = [...new Set(Array.isArray(minuteKeys) ? minuteKeys : [])].filter(Boolean).sort();
        const latestMinuteKey = orderedMinuteKeys[orderedMinuteKeys.length - 1] || '';
        const latestDate = parseInvestmentIntradayTimestamp(latestMinuteKey);
        if (!(latestDate instanceof Date) || Number.isNaN(latestDate.getTime())) {
            return orderedMinuteKeys;
        }
        const startDate = new Date(latestDate.getTime());
        startDate.setDate(startDate.getDate() - 6);
        return orderedMinuteKeys.filter((minuteKey) => {
            const minuteDate = parseInvestmentIntradayTimestamp(minuteKey);
            return minuteDate instanceof Date && !Number.isNaN(minuteDate.getTime()) && minuteDate >= startDate;
        });
    }

function aggregateInvestmentOverviewCandlesForDisplay(candles = [], maxVisibleCandles = 220) {
        const normalizedCandles = (Array.isArray(candles) ? candles : [])
            .filter((bar) => (
                bar?.date
                && [bar.open, bar.high, bar.low, bar.close].every((value) => Number.isFinite(Number(value)))
            ));
        const safeMaxVisibleCandles = Math.max(40, Math.floor(Number(maxVisibleCandles) || 220));
        if (normalizedCandles.length <= safeMaxVisibleCandles) return normalizedCandles;
        const dayGroups = normalizedCandles.reduce((groups, bar) => {
            const dayKey = runtime.normalizeLedgerDate(bar.date) || 'unknown';
            if (!groups.has(dayKey)) groups.set(dayKey, []);
            groups.get(dayKey).push(bar);
            return groups;
        }, new Map());
        const maxCandlesPerDay = Math.max(12, Math.floor(safeMaxVisibleCandles / Math.max(dayGroups.size, 1)));
        const displayCandles = [];
        Array.from(dayGroups.keys()).sort().forEach((dayKey) => {
            const dayCandles = dayGroups.get(dayKey) || [];
            const bucketSize = Math.max(1, Math.ceil(dayCandles.length / maxCandlesPerDay));
            for (let start = 0; start < dayCandles.length; start += bucketSize) {
                const bucket = dayCandles.slice(start, start + bucketSize);
                if (!bucket.length) continue;
                const open = Number(bucket[0].open);
                const close = Number(bucket[bucket.length - 1].close);
                const high = Math.max(...bucket.map((bar) => Number(bar.high)).filter(Number.isFinite));
                const low = Math.min(...bucket.map((bar) => Number(bar.low)).filter(Number.isFinite));
                if (![open, high, low, close].every(Number.isFinite)) continue;
                displayCandles.push({
                    date: bucket[bucket.length - 1].date,
                    open: runtime.roundInvestmentChartCurrencyValue(open),
                    high: runtime.roundInvestmentChartCurrencyValue(high),
                    low: runtime.roundInvestmentChartCurrencyValue(low),
                    close: runtime.roundInvestmentChartCurrencyValue(close),
                });
            }
        });
        return displayCandles;
    }

function buildInvestmentOverviewTradingDayKeys(range = runtime.state.selectedInvestmentEquityRange) {
        const normalizedRange = normalizeInvestmentEquityRange(range);
        const requiredDayCount = runtime.getInvestmentOverviewIntradayDayCount(normalizedRange);
        if (!requiredDayCount) return [];
        const safePayload = runtime.getSafeInvestmentMarketSessionState();
        const tradingDays = Array.isArray(safePayload?.trading_days) ? safePayload.trading_days : [];
        if (!tradingDays.length) {
            void runtime.refreshInvestmentMarketSessionState({ dayCount: requiredDayCount, force: true });
            return [];
        }
        const normalizedTradingDays = [...tradingDays]
            .map((dayKey) => runtime.normalizeLedgerDate(dayKey))
            .filter(Boolean);
        if (normalizedTradingDays.length < requiredDayCount) {
            void runtime.refreshInvestmentMarketSessionState({ dayCount: requiredDayCount, force: true });
            return [];
        }
        return normalizedTradingDays.slice(-requiredDayCount);
    }

function buildInvestmentOverviewRegularSessionMinuteKeys(dayKey) {
        const keys = [];
        if (!runtime.normalizeLedgerDate(dayKey)) return keys;
        for (let minuteOffset = 0; minuteOffset < 390; minuteOffset += 1) {
            const totalMinutes = (9 * 60) + 30 + minuteOffset;
            const hours = String(Math.floor(totalMinutes / 60)).padStart(2, '0');
            const minutes = String(totalMinutes % 60).padStart(2, '0');
            keys.push(`${dayKey} ${hours}:${minutes}`);
        }
        return keys;
    }

function getInvestmentOverviewNewYorkMinutePartsFromUtc(dateParts) {
        if (!dateParts || dateParts.hours === null || dateParts.minutes === null) return null;
        const instant = new Date(Date.UTC(
            dateParts.year,
            dateParts.monthIndex,
            dateParts.day,
            dateParts.hours,
            dateParts.minutes,
            dateParts.seconds || 0,
        ));
        if (Number.isNaN(instant.getTime())) return null;
        const fields = Object.fromEntries(
            new Intl.DateTimeFormat('en-CA', {
                timeZone: 'America/New_York',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                hourCycle: 'h23',
            }).formatToParts(instant)
                .filter((part) => part.type !== 'literal')
                .map((part) => [part.type, part.value]),
        );
        const year = Number(fields.year);
        const month = Number(fields.month);
        const day = Number(fields.day);
        const hours = Number(fields.hour);
        const minutes = Number(fields.minute);
        if (![year, month, day, hours, minutes].every(Number.isFinite)) return null;
        return {year, monthIndex: month - 1, day, hours, minutes};
    }

function getInvestmentOverviewSnapshotEffectiveMinuteKey(snapshot, dayKey) {
        const normalizedDayKey = runtime.normalizeLedgerDate(dayKey);
        if (!normalizedDayKey || !snapshot || runtime.isInvestmentTransactionDateOnly(snapshot)) return '';
        const rawDatetime = String(snapshot?.datetime || '').trim();
        const parsedDatetime = runtime.parseInvestmentDateParts(rawDatetime);
        if (!parsedDatetime || parsedDatetime.hours === null || parsedDatetime.minutes === null) return '';

        // `20:00:00` is the project's date-only ledger convention. It orders
        // rows but is never broker evidence of an intraday execution.
        if (
            parsedDatetime.hours === 20
            && parsedDatetime.minutes === 0
            && (!parsedDatetime.seconds || parsedDatetime.seconds === 0)
        ) {
            return '';
        }

        const fileKind = String(snapshot?.source?.file_kind || '').trim().toLowerCase();
        const minuteParts = fileKind.startsWith('longbridge_history_')
            ? getInvestmentOverviewNewYorkMinutePartsFromUtc(parsedDatetime)
            : parsedDatetime;
        if (!minuteParts) return '';
        const executionDayKey = `${minuteParts.year}-${String(minuteParts.monthIndex + 1).padStart(2, '0')}-${String(minuteParts.day).padStart(2, '0')}`;
        if (executionDayKey !== normalizedDayKey) return '';

        const executionMinute = (minuteParts.hours * 60) + minuteParts.minutes;
        const regularSessionOpenMinute = (9 * 60) + 30;
        const finalVisibleMinute = (15 * 60) + 59;
        // A one-minute OHLC close is only observable after its minute has
        // completed. Apply a fill to the following visible minute; a fill in
        // the final bar rolls into the next trading-day opening state.
        if (executionMinute < regularSessionOpenMinute || executionMinute >= finalVisibleMinute) return '';
        const effectiveMinute = executionMinute + 1;
        const hours = String(Math.floor(effectiveMinute / 60)).padStart(2, '0');
        const minutes = String(effectiveMinute % 60).padStart(2, '0');
        return `${normalizedDayKey} ${hours}:${minutes}`;
    }

function getInvestmentOverviewIntradaySnapshotsForTradingDay(dayKey) {
        const normalizedDayKey = runtime.normalizeLedgerDate(dayKey);
        if (!normalizedDayKey || !Array.isArray(runtime.state.investmentReplaySnapshotsCache)) return [];
        return runtime.state.investmentReplaySnapshotsCache
            .map((snapshot, index) => ({
                snapshot,
                index,
                effectiveMinuteKey: getInvestmentOverviewSnapshotEffectiveMinuteKey(snapshot, normalizedDayKey),
            }))
            .filter((entry) => entry.effectiveMinuteKey)
            .sort((left, right) => {
                if (left.effectiveMinuteKey !== right.effectiveMinuteKey) {
                    return left.effectiveMinuteKey.localeCompare(right.effectiveMinuteKey);
                }
                const leftOrder = Number(left.snapshot?.replay_snapshot_order);
                const rightOrder = Number(right.snapshot?.replay_snapshot_order);
                if (Number.isFinite(leftOrder) && Number.isFinite(rightOrder) && leftOrder !== rightOrder) {
                    return leftOrder - rightOrder;
                }
                return left.index - right.index;
            });
    }

function getInvestmentOverviewEffectiveSnapshotForTradingDay(dayKey) {
        const normalizedDayKey = runtime.normalizeLedgerDate(dayKey);
        if (!normalizedDayKey || !Array.isArray(runtime.state.investmentReplaySnapshotsCache)) return null;
        let effectiveSnapshot = null;
        runtime.state.investmentReplaySnapshotsCache.forEach((snapshot) => {
            const snapshotDate = runtime.normalizeLedgerDate(snapshot?.date);
            if (snapshotDate && snapshotDate < normalizedDayKey) {
                effectiveSnapshot = snapshot;
            }
        });
        return effectiveSnapshot;
    }

function buildInvestmentOverviewActiveTickerSetForSnapshots(snapshots = []) {
        const moneyMarketTickers = runtime.getMoneyMarketTickerSet();
        return Array.from((Array.isArray(snapshots) ? snapshots : []).reduce((tickerSet, snapshot) => {
            const holdings = snapshot?.aggregate_holdings || snapshot?.holdings || {};
            Object.entries(holdings).forEach(([ticker, quantity]) => {
                const normalizedTicker = runtime.normalizeInvestmentTicker(ticker);
                const numericQuantity = Number(quantity);
                if (
                    normalizedTicker
                    && !runtime.isForexPairTicker(normalizedTicker)
                    && !moneyMarketTickers.has(normalizedTicker)
                    && Number.isFinite(numericQuantity)
                    && Math.abs(numericQuantity) > 1e-9
                ) {
                    tickerSet.add(normalizedTicker);
                }
            });
            return tickerSet;
        }, new Set()));
    }

async function buildInvestmentOverviewIntradayLinePoints() {
        const normalizedRange = normalizeInvestmentEquityRange(runtime.state.selectedInvestmentEquityRange);
        if (!runtime.isInvestmentOverviewHighPrecisionEquityRange(normalizedRange)) return [];
        const requiredDayCount = runtime.getInvestmentOverviewIntradayDayCount(normalizedRange);
        const dayKeys = buildInvestmentOverviewTradingDayKeys(normalizedRange);
        if (!dayKeys.length || dayKeys.length < requiredDayCount) return [];
        const effectiveSnapshotsByDay = new Map(
            dayKeys.map((dayKey) => [dayKey, getInvestmentOverviewEffectiveSnapshotForTradingDay(dayKey)]),
        );
        const intradaySnapshotsByDay = new Map(
            dayKeys.map((dayKey) => [dayKey, getInvestmentOverviewIntradaySnapshotsForTradingDay(dayKey)]),
        );
        const activeTickers = buildInvestmentOverviewActiveTickerSetForSnapshots(
            [
                ...Array.from(effectiveSnapshotsByDay.values()).filter(Boolean),
                ...Array.from(intradaySnapshotsByDay.values()).flatMap((entries) => (
                    entries.map((entry) => entry.snapshot)
                )),
            ],
        );
        if (!activeTickers.length) return [];

        const tickerResults = await Promise.allSettled(activeTickers.map(async (ticker) => ({
            ticker,
            rows: await loadInvestmentOverviewIntradayRows(ticker, dayKeys),
        })));
        const tickerRows = tickerResults
            .filter((result) => result.status === 'fulfilled')
            .map((result) => result.value);
        tickerResults
            .filter((result) => result.status === 'rejected')
            .forEach((result) => console.warn(result.reason));
        const minuteMapByTicker = new Map(tickerRows.map(({ ticker, rows }) => {
            const closeMap = new Map();
            buildInvestmentOverviewIntradayMinuteMap(rows).forEach((bar, minuteKey) => {
                const close = Number(bar?.close);
                if (Number.isFinite(close) && close > 0) closeMap.set(minuteKey, close);
            });
            return [ticker, closeMap];
        }));
        const intradayTickersByDay = new Map();
        minuteMapByTicker.forEach((minuteMap, ticker) => {
            minuteMap.forEach((_close, minuteKey) => {
                const dayKey = runtime.normalizeLedgerDate(minuteKey);
                if (!dayKey) return;
                if (!intradayTickersByDay.has(dayKey)) intradayTickersByDay.set(dayKey, new Set());
                intradayTickersByDay.get(dayKey).add(ticker);
            });
        });
        const tickerPriceIndex = runtime.buildTickerPriceIndex(runtime.state.investmentTickerClosePricesCache);
        const baseCurrency = runtime.getInvestmentBaseCurrency();
        const fxTimeline = runtime.buildInvestmentFxRateTimeline(runtime.state.investmentProcessedTransactionsCache, baseCurrency);
        const getSessionFallbackPrice = (snapshot, ticker, valuationDate, {hasIntradayRowsForDay = false} = {}) => {
            const normalizedTicker = runtime.normalizeInvestmentTicker(ticker);
            const moneyMarketTickers = runtime.getMoneyMarketTickerSet();
            if (moneyMarketTickers.has(normalizedTicker)) {
                const anchoredPrice = Number(
                    snapshot?.aggregate_money_market_anchors?.[normalizedTicker]
                    ?? snapshot?.money_market_anchors?.[normalizedTicker],
                );
                if (Number.isFinite(anchoredPrice) && anchoredPrice > 0) return anchoredPrice;
            }
            // A daily close is only a fallback for a ticker with no one-minute
            // observations on this trading day. Otherwise, using it before
            // the first observed minute would leak a later price backward.
            if (hasIntradayRowsForDay) return null;
            const dailyClose = runtime.getIndexedClosePriceOnOrBefore(
                tickerPriceIndex?.[normalizedTicker],
                valuationDate,
            );
            if (Number.isFinite(dailyClose) && dailyClose > 0) return dailyClose;
            return null;
        };

        return dayKeys.flatMap((dayKey) => {
            const minuteKeys = buildInvestmentOverviewRegularSessionMinuteKeys(dayKey);
            const intradaySnapshots = intradaySnapshotsByDay.get(dayKey) || [];
            let activeSnapshot = effectiveSnapshotsByDay.get(dayKey);
            if (!activeSnapshot && intradaySnapshots.length) {
                const startingCash = Number(runtime.getInvestmentStartingCash()) || 0;
                activeSnapshot = {
                    aggregate_holdings: {},
                    aggregate_money_market_anchors: {},
                    aggregate_running_cash: startingCash,
                    aggregate_display_cash: startingCash,
                };
            }
            if (!activeSnapshot) {
                return minuteKeys.map((minuteKey) => ({
                    date: minuteKey,
                    equity: null,
                    point: null,
                }));
            }

            const sessionCloseByTicker = new Map();
            const intradayTickers = intradayTickersByDay.get(dayKey) || new Set();
            let intradaySnapshotCursor = 0;
            return minuteKeys.map((minuteKey) => {
                activeTickers.forEach((ticker) => {
                    const minuteClose = minuteMapByTicker.get(ticker)?.get(minuteKey);
                    if (Number.isFinite(minuteClose) && minuteClose > 0) {
                        sessionCloseByTicker.set(ticker, minuteClose);
                    }
                });
                while (
                    intradaySnapshotCursor < intradaySnapshots.length
                    && intradaySnapshots[intradaySnapshotCursor].effectiveMinuteKey <= minuteKey
                ) {
                    activeSnapshot = intradaySnapshots[intradaySnapshotCursor].snapshot;
                    intradaySnapshotCursor += 1;
                }

                const holdings = activeSnapshot?.aggregate_holdings || activeSnapshot?.holdings || {};
                const aggregateRunningCash = Number(
                    activeSnapshot?.aggregate_running_cash ?? activeSnapshot?.running_cash,
                ) || 0;
                const aggregateBridgeAdjustment = Number(activeSnapshot?.aggregate_bridge_adjustment) || 0;
                const historyDisplayCash = Number(activeSnapshot?.aggregate_history_display_cash);
                const rawAggregateDisplayCash = Number(activeSnapshot?.aggregate_display_cash);
                const fallbackAggregateDisplayCash = Number.isFinite(rawAggregateDisplayCash)
                    ? rawAggregateDisplayCash
                    : aggregateRunningCash + (Number(activeSnapshot?.aggregate_pending_settlement_cash) || 0);
                const aggregateDisplayCash = Number.isFinite(historyDisplayCash)
                    ? historyDisplayCash
                    : fallbackAggregateDisplayCash + aggregateBridgeAdjustment;
                let aggregateMarketValue = 0;
                const holdingsMarketValues = {};
                const holdingsQuotePrices = {};
                let valuationComplete = true;
                Object.entries(holdings).forEach(([ticker, quantity]) => {
                    const normalizedTicker = runtime.normalizeInvestmentTicker(ticker);
                    const numericQuantity = Number(quantity);
                    if (!normalizedTicker || runtime.isForexPairTicker(normalizedTicker) || !Number.isFinite(numericQuantity) || Math.abs(numericQuantity) < 1e-9) return;
                    const close = sessionCloseByTicker.get(normalizedTicker)
                        ?? getSessionFallbackPrice(activeSnapshot, normalizedTicker, dayKey, {
                            hasIntradayRowsForDay: intradayTickers.has(normalizedTicker),
                        });
                    if (!Number.isFinite(close) || close <= 0) {
                        valuationComplete = false;
                        return;
                    }
                    const marketValue = runtime.convertAmountToBaseCurrency(
                        numericQuantity * close,
                        runtime.getTickerQuoteCurrency(normalizedTicker),
                        dayKey,
                        fxTimeline,
                        baseCurrency,
                    );
                    aggregateMarketValue += marketValue;
                    if (Math.abs(marketValue) > 1e-9) {
                        holdingsMarketValues[normalizedTicker] = marketValue;
                    }
                    holdingsQuotePrices[normalizedTicker] = close;
                });
                const aggregateTotalEquity = valuationComplete
                    ? aggregateDisplayCash + aggregateMarketValue
                    : null;
                const point = {
                    date: minuteKey,
                    running_cash: aggregateRunningCash,
                    aggregate_running_cash: aggregateRunningCash,
                    aggregate_display_cash: aggregateDisplayCash,
                    market_value: valuationComplete ? aggregateMarketValue : null,
                    aggregate_market_value: valuationComplete ? aggregateMarketValue : null,
                    holdings_market_values: holdingsMarketValues,
                    aggregate_holdings_market_values: holdingsMarketValues,
                    holdings_quote_prices: holdingsQuotePrices,
                    aggregate_holdings_quote_prices: holdingsQuotePrices,
                    total_equity: aggregateTotalEquity,
                    aggregate_total_equity: aggregateTotalEquity,
                    valuation_complete: valuationComplete,
                    anchor_ledger_date: '',
                    anchor_ledger_nos: [],
                    cash_in_amount: 0,
                    cash_out_amount: 0,
                    net_transfer_amount: 0,
                    cumulative_net_transfer_amount: Number(activeSnapshot?.cumulative_net_transfer_amount) || 0,
                    is_trading_day: true,
                    is_intraday_equity: true,
                };
                return {
                    date: minuteKey,
                    equity: Number.isFinite(aggregateTotalEquity)
                        ? runtime.roundInvestmentChartCurrencyValue(aggregateTotalEquity)
                        : null,
                    point,
                };
            });
        });
    }

function buildInvestmentOverviewEmptyIntradayLinePoints() {
        const normalizedRange = normalizeInvestmentEquityRange(runtime.state.selectedInvestmentEquityRange);
        if (!runtime.isInvestmentOverviewHighPrecisionEquityRange(normalizedRange)) return [];
        const requiredDayCount = runtime.getInvestmentOverviewIntradayDayCount(normalizedRange);
        const dayKeys = buildInvestmentOverviewTradingDayKeys(normalizedRange);
        if (!dayKeys.length || dayKeys.length < requiredDayCount) return [];
        return dayKeys.flatMap((dayKey) => (
            buildInvestmentOverviewRegularSessionMinuteKeys(dayKey).map((minuteKey) => ({
                date: minuteKey,
                equity: null,
                point: null,
            }))
        ));
    }

function getInvestmentOverviewIntradayLineCacheKey(dayKeys = buildInvestmentOverviewTradingDayKeys()) {
        return (Array.isArray(dayKeys) ? dayKeys : [])
            .map((dayKey) => runtime.normalizeLedgerDate(dayKey))
            .filter(Boolean)
            .join(',');
    }

function getInvestmentOverviewIntradayLineQuality(linePoints = []) {
        const finiteEntries = (Array.isArray(linePoints) ? linePoints : [])
            .map((entry) => ({
                date: String(entry?.date || ''),
                equity: entry?.equity,
            }))
            .filter((entry) => (
                entry.date
                && entry.equity !== null
                && entry.equity !== undefined
                && Number.isFinite(Number(entry.equity))
            ))
            .map((entry) => ({...entry, equity: Number(entry.equity)}));
        if (!finiteEntries.length) {
            return {
                finiteCount: 0,
                finiteDayCount: 0,
                distinctCount: 0,
                valueRange: 0,
                isHealthy: false,
            };
        }
        const values = finiteEntries.map((entry) => entry.equity);
        const minValue = Math.min(...values);
        const maxValue = Math.max(...values);
        const distinctCount = new Set(values.map((value) => value.toFixed(2))).size;
        const finiteDayCount = new Set(finiteEntries.map((entry) => runtime.normalizeLedgerDate(entry.date)).filter(Boolean)).size;
        const valueRange = maxValue - minValue;
        return {
            finiteCount: finiteEntries.length,
            finiteDayCount,
            distinctCount,
            valueRange,
            // Sparse but auditable sessions can legitimately carry one close
            // for most of the day. Coverage, not price volatility, decides
            // whether a historical minute-close line is usable.
            isHealthy: finiteEntries.length >= 390 && finiteDayCount >= 2,
        };
    }

function shouldUseInvestmentOverviewIntradayLinePoints(nextLinePoints = [], cachedLinePoints = []) {
        const nextQuality = getInvestmentOverviewIntradayLineQuality(nextLinePoints);
        const cachedQuality = getInvestmentOverviewIntradayLineQuality(cachedLinePoints);
        if (!cachedQuality.isHealthy) return nextQuality.isHealthy;
        if (!nextQuality.isHealthy) return false;
        if (nextQuality.finiteDayCount < cachedQuality.finiteDayCount) return false;
        return true;
    }

function getCachedInvestmentOverviewIntradayLinePoints() {
        const cacheKey = getInvestmentOverviewIntradayLineCacheKey();
        if (
            runtime.state.investmentOverviewIntradayLinePointsCache.key === cacheKey
            && getInvestmentOverviewIntradayLineQuality(runtime.state.investmentOverviewIntradayLinePointsCache.points).isHealthy
        ) {
            return runtime.state.investmentOverviewIntradayLinePointsCache.points;
        }
        return [];
    }

function getInvestmentOverviewRealtimeMinuteKey() {
        if (!runtime.isInvestmentOverviewIntradayEquityRange()) return '';
        const sessionState = runtime.getSafeInvestmentMarketSessionState();
        if (
            !sessionState?.is_realtime_allowed
            || !runtime.shouldShowInvestmentRealtimePulse(sessionState.session)
        ) {
            return '';
        }
        const sessionDate = runtime.normalizeLedgerDate(sessionState.session_date);
        if (!sessionDate) return '';

        let clockParts = runtime.getInvestmentNewYorkClockParts();
        const asOf = String(sessionState.as_of || '').trim();
        if (asOf) {
            const asOfDate = new Date(asOf);
            if (!Number.isNaN(asOfDate.getTime())) {
                clockParts = runtime.getInvestmentNewYorkClockParts(asOfDate);
            }
        }
        if (
            clockParts.dateKey !== sessionDate
            || !Number.isFinite(clockParts.hour)
            || !Number.isFinite(clockParts.minute)
        ) {
            return '';
        }
        const totalMinutes = (clockParts.hour * 60) + clockParts.minute;
        if (sessionState.session === 'intraday') {
            const regularOpenMinute = (9 * 60) + 30;
            const finalVisibleMinute = (16 * 60) - 1;
            if (totalMinutes < regularOpenMinute || totalMinutes > finalVisibleMinute) return '';
        }
        const hours = String(Math.floor(totalMinutes / 60)).padStart(2, '0');
        const minutes = String(totalMinutes % 60).padStart(2, '0');
        return `${sessionDate} ${hours}:${minutes}`;
    }

function rememberInvestmentOverviewRealtimeLinePoint(realtimePoint) {
        const minuteKey = getInvestmentOverviewRealtimeMinuteKey();
        const totalEquity = runtime.getOptionalInvestmentNumber(
            realtimePoint?.aggregate_total_equity ?? realtimePoint?.total_equity,
        );
        if (!minuteKey || totalEquity === null || realtimePoint?.is_realtime !== true) return false;
        const sessionDate = runtime.normalizeLedgerDate(minuteKey);
        Array.from(runtime.investmentOverviewRealtimeLinePointsByMinute.keys()).forEach((key) => {
            if (runtime.normalizeLedgerDate(key) !== sessionDate) {
                runtime.investmentOverviewRealtimeLinePointsByMinute.delete(key);
                return;
            }
            if (key === minuteKey) return;
            const previousEntry = runtime.investmentOverviewRealtimeLinePointsByMinute.get(key);
            if (previousEntry?.point?.is_realtime === true) {
                runtime.investmentOverviewRealtimeLinePointsByMinute.set(key, {
                    ...previousEntry,
                    point: {
                        ...previousEntry.point,
                        is_realtime: false,
                    },
                });
            }
        });
        runtime.investmentOverviewRealtimeLinePointsByMinute.set(minuteKey, {
            date: minuteKey,
            equity: runtime.roundInvestmentChartCurrencyValue(totalEquity),
            point: {
                ...realtimePoint,
                date: minuteKey,
                realtime_timestamp: minuteKey,
                is_intraday_equity: true,
                is_realtime: true,
            },
        });
        return true;
    }

function mergeInvestmentOverviewRealtimeLinePoints(linePoints = []) {
        const sourcePoints = Array.isArray(linePoints) ? linePoints : [];
        const currentMinuteKey = getInvestmentOverviewRealtimeMinuteKey();
        if (!currentMinuteKey) return sourcePoints;
        const currentSessionDate = runtime.normalizeLedgerDate(currentMinuteKey);
        const mergedPoints = sourcePoints.map((entry) => {
            const entryDate = String(entry?.date || '');
            if (runtime.normalizeLedgerDate(entryDate) !== currentSessionDate) return entry;
            const realtimeEntry = runtime.investmentOverviewRealtimeLinePointsByMinute.get(entryDate);
            if (realtimeEntry) return realtimeEntry;
            if (entryDate > currentMinuteKey) {
                return {
                    date: entryDate,
                    equity: null,
                    point: null,
                };
            }
            return entry;
        });
        const realtimeEntry = runtime.investmentOverviewRealtimeLinePointsByMinute.get(currentMinuteKey);
        if (realtimeEntry && !mergedPoints.some((entry) => String(entry?.date || '') === currentMinuteKey)) {
            mergedPoints.push(realtimeEntry);
        }
        return mergedPoints;
    }

function resolveInvestmentEquityRealtimeMarkerTarget(runtimeState) {
        const visibleChartPoints = Array.isArray(runtimeState?.visibleChartPoints)
            ? runtimeState.visibleChartPoints
            : [];
        let realtimeIndex = -1;
        visibleChartPoints.forEach((point, index) => {
            if (point?.is_realtime === true) realtimeIndex = index;
        });
        if (realtimeIndex < 0) return null;
        return {
            index: realtimeIndex,
            session: visibleChartPoints[realtimeIndex]?.realtime_session,
            source: visibleChartPoints[realtimeIndex]?.realtime_source,
        };
    }

function cacheInvestmentOverviewIntradayLinePoints(linePoints = []) {
        const quality = getInvestmentOverviewIntradayLineQuality(linePoints);
        if (!quality.isHealthy) return;
        runtime.state.investmentOverviewIntradayLinePointsCache = {
            key: getInvestmentOverviewIntradayLineCacheKey(),
            points: linePoints,
            quality,
        };
    }

function getInvestmentEquitySegmentBorderColor(context, fallbackColor = "#0055cc") {
        const rawLabels = context?.chart?.data?.rawLabels;
        const p0Index = Number(context?.p0DataIndex);
        const p1Index = Number(context?.p1DataIndex);
        if (
            runtime.state.investmentEquityChartRuntimeState?.overviewIntradayLinePoints?.length
            && Array.isArray(rawLabels)
            && Number.isInteger(p0Index)
            && Number.isInteger(p1Index)
        ) {
            const p0DayKey = runtime.normalizeLedgerDate(rawLabels[p0Index]);
            const p1DayKey = runtime.normalizeLedgerDate(rawLabels[p1Index]);
            if (p0DayKey && p1DayKey && p0DayKey !== p1DayKey) {
                return 'rgba(0, 85, 204, 0)';
            }
        }
        return fallbackColor;
    }

async function buildInvestmentOverviewIntradayCandles() {
        if (!runtime.isInvestmentOverviewIntradayEquityRange()) return [];
        const latestSnapshot = Array.isArray(runtime.state.investmentProcessedTransactionsCache) && runtime.state.investmentProcessedTransactionsCache.length
            ? runtime.state.investmentProcessedTransactionsCache[runtime.state.investmentProcessedTransactionsCache.length - 1]
            : null;
        if (!latestSnapshot) return [];
        const openTickers = Array.from(new Set(runtime.getInvestmentRealtimeOpenTickers())).filter(Boolean);
        if (!openTickers.length) return [];

        let tickerRows = [];
        try {
            tickerRows = await Promise.all(openTickers.map(async (ticker) => ({
                ticker,
                rows: await loadInvestmentOverviewIntradayRows(ticker),
            })));
        } catch (error) {
            console.warn(error);
            return [];
        }
        const minuteMaps = tickerRows.map(({ ticker, rows }) => ({
            ticker,
            minuteMap: buildInvestmentOverviewIntradayMinuteMap(rows),
        }));
        const minuteKeys = getInvestmentOverviewLatestOneWeekMinuteKeys(
            minuteMaps.flatMap((entry) => [...entry.minuteMap.keys()]),
        );
        if (minuteKeys.length < 30) return [];

        const holdings = latestSnapshot?.aggregate_holdings || latestSnapshot?.holdings || {};
        const baseCurrency = runtime.getInvestmentBaseCurrency();
        const fxTimeline = runtime.buildInvestmentFxRateTimeline(runtime.state.investmentProcessedTransactionsCache, baseCurrency);
        const tickerPriceIndex = runtime.buildTickerPriceIndex(runtime.state.investmentTickerClosePricesCache);
        const aggregateRunningCash = Number(latestSnapshot?.aggregate_running_cash ?? latestSnapshot?.running_cash) || 0;
        const rawAggregateDisplayCash = Number(latestSnapshot?.aggregate_display_cash);
        const aggregateDisplayCash = Number.isFinite(rawAggregateDisplayCash)
            ? rawAggregateDisplayCash
            : aggregateRunningCash + (Number(latestSnapshot?.aggregate_pending_settlement_cash) || 0);
        const intradayTickerSet = new Set(openTickers);
        const holdingQuantityByTicker = new Map(
            Object.entries(holdings)
                .map(([ticker, quantity]) => [runtime.normalizeInvestmentTicker(ticker), Number(quantity)])
                .filter(([ticker, quantity]) => ticker && Number.isFinite(quantity)),
        );
        const fixedHoldingValue = Object.entries(holdings).reduce((sum, [ticker, quantity]) => {
            const normalizedTicker = runtime.normalizeInvestmentTicker(ticker);
            if (!normalizedTicker || intradayTickerSet.has(normalizedTicker)) return sum;
            return sum + getInvestmentSnapshotFixedHoldingValue(
                latestSnapshot,
                normalizedTicker,
                quantity,
                runtime.normalizeLedgerDate(minuteKeys[minuteKeys.length - 1]),
                fxTimeline,
                baseCurrency,
                tickerPriceIndex,
            );
        }, 0);
        const minuteMapByTicker = new Map(minuteMaps.map((entry) => [entry.ticker, entry.minuteMap]));
        const fallbackValueCache = new Map();
        const getCachedFallbackValue = (ticker, quantity, valuationDate) => {
            const cacheKey = `${ticker}:${valuationDate}`;
            if (fallbackValueCache.has(cacheKey)) return fallbackValueCache.get(cacheKey);
            const fallbackValue = getInvestmentSnapshotFixedHoldingValue(
                latestSnapshot,
                ticker,
                quantity,
                valuationDate,
                fxTimeline,
                baseCurrency,
                tickerPriceIndex,
            );
            fallbackValueCache.set(cacheKey, fallbackValue);
            return fallbackValue;
        };

        return minuteKeys.map((minuteKey) => {
            const valuationDate = runtime.normalizeLedgerDate(minuteKey) || runtime.normalizeLedgerDate(minuteKeys[minuteKeys.length - 1]);
            const totals = { open: aggregateDisplayCash + fixedHoldingValue, high: aggregateDisplayCash + fixedHoldingValue, low: aggregateDisplayCash + fixedHoldingValue, close: aggregateDisplayCash + fixedHoldingValue };
            openTickers.forEach((ticker) => {
                const quantity = Number(holdingQuantityByTicker.get(ticker));
                if (!Number.isFinite(quantity) || Math.abs(quantity) < 1e-9) return;
                const bar = minuteMapByTicker.get(ticker)?.get(minuteKey);
                if (!bar) {
                    const fallbackValue = getCachedFallbackValue(ticker, quantity, valuationDate);
                    totals.open += fallbackValue;
                    totals.high += fallbackValue;
                    totals.low += fallbackValue;
                    totals.close += fallbackValue;
                    return;
                }
                const highPrice = quantity >= 0 ? bar.high : bar.low;
                const lowPrice = quantity >= 0 ? bar.low : bar.high;
                const quoteCurrency = runtime.getTickerQuoteCurrency(ticker);
                totals.open += runtime.convertAmountToBaseCurrency(quantity * bar.open, quoteCurrency, valuationDate, fxTimeline, baseCurrency);
                totals.high += runtime.convertAmountToBaseCurrency(quantity * highPrice, quoteCurrency, valuationDate, fxTimeline, baseCurrency);
                totals.low += runtime.convertAmountToBaseCurrency(quantity * lowPrice, quoteCurrency, valuationDate, fxTimeline, baseCurrency);
                totals.close += runtime.convertAmountToBaseCurrency(quantity * bar.close, quoteCurrency, valuationDate, fxTimeline, baseCurrency);
            });
            return {
                date: minuteKey,
                open: runtime.roundInvestmentChartCurrencyValue(totals.open),
                high: runtime.roundInvestmentChartCurrencyValue(totals.high),
                low: runtime.roundInvestmentChartCurrencyValue(totals.low),
                close: runtime.roundInvestmentChartCurrencyValue(totals.close),
            };
        }).filter((bar) => [bar.open, bar.high, bar.low, bar.close].every(Number.isFinite));
    }

function normalizeInvestmentStockDetailsRange(range) {
        return runtime.normalizeInvestmentRange(range, runtime.INVESTMENT_STOCK_DETAILS_RANGE_OPTIONS);
    }

function normalizeInvestmentEquityRange(range) {
        return runtime.normalizeInvestmentRange(range, runtime.INVESTMENT_EQUITY_RANGE_OPTIONS);
    }

function getInvestmentHistoryHeadingElement() {
        const heading = document.querySelector('#investment_history_surface .investment-history-heading-row .chart-heading');
        return heading instanceof HTMLElement ? heading : null;
    }

function getInvestmentEquityActiveRangeLabel() {
        const rangeControl = getInvestmentEquityRangeControl();
        const activeLabel = rangeControl?.querySelector('input[type="radio"]:checked + span');
        return activeLabel instanceof HTMLElement ? activeLabel.textContent.trim() : '';
    }

function syncInvestmentHistoryHeading() {
        const heading = getInvestmentHistoryHeadingElement();
        if (!heading) return;
        const nextHeading = String(heading.dataset.baseHeading || heading.textContent || '')
            .replace(/\s*·\s*.+$/, '')
            .trim() || 'Transaction history';
        heading.dataset.baseHeading = nextHeading;
        heading.dataset.activeRangeLabel = getInvestmentEquityActiveRangeLabel();
        heading.textContent = nextHeading;
    }

function clearInvestmentStockDetailsRangeControlBindings() {
        if (runtime.state.investmentStockDetailsRangeMeasureRaf) {
            window.cancelAnimationFrame(runtime.state.investmentStockDetailsRangeMeasureRaf);
            runtime.state.investmentStockDetailsRangeMeasureRaf = 0;
        }
        if (runtime.state.investmentStockDetailsRangeControlAbortController) {
            runtime.state.investmentStockDetailsRangeControlAbortController.abort();
            runtime.state.investmentStockDetailsRangeControlAbortController = null;
        }
        if (runtime.state.investmentStockDetailsRangeControlResizeObserver) {
            runtime.state.investmentStockDetailsRangeControlResizeObserver.disconnect();
            runtime.state.investmentStockDetailsRangeControlResizeObserver = null;
        }
    }

function clearInvestmentEquityRangeControlBindings() {
        if (runtime.state.investmentEquityRangeMeasureRaf) {
            window.cancelAnimationFrame(runtime.state.investmentEquityRangeMeasureRaf);
            runtime.state.investmentEquityRangeMeasureRaf = 0;
        }
        if (runtime.state.investmentEquityRangeControlAbortController) {
            runtime.state.investmentEquityRangeControlAbortController.abort();
            runtime.state.investmentEquityRangeControlAbortController = null;
        }
        if (runtime.state.investmentEquityRangeControlResizeObserver) {
            runtime.state.investmentEquityRangeControlResizeObserver.disconnect();
            runtime.state.investmentEquityRangeControlResizeObserver = null;
        }
    }

function updateInvestmentStockDetailsRangePill() {
        const rangeControl = getInvestmentStockDetailsRangeControl();
        if (!rangeControl) return;
        const activeLabel = rangeControl.querySelector('input[type="radio"]:checked + span');
        if (!activeLabel) {
            rangeControl.classList.remove('is-pill-ready');
            return;
        }

        const pillGeometry = measureInvestmentSegmentedPillGeometry(rangeControl, activeLabel);
        if (!pillGeometry) {
            rangeControl.classList.remove('is-pill-ready');
            return;
        }

        rangeControl.style.setProperty('--segmented-pill-left', `${pillGeometry.left}px`);
        rangeControl.style.setProperty('--segmented-pill-width', `${pillGeometry.width}px`);
        keepSegmentedActiveOptionVisible(rangeControl, pillGeometry);
        rangeControl.classList.add('is-pill-ready');
    }

function scheduleInvestmentStockDetailsRangePillUpdate() {
        const rangeControl = getInvestmentStockDetailsRangeControl();
        if (!rangeControl) return;
        rangeControl.classList.remove('is-pill-ready');
        if (runtime.state.investmentStockDetailsRangeMeasureRaf) {
            window.cancelAnimationFrame(runtime.state.investmentStockDetailsRangeMeasureRaf);
            runtime.state.investmentStockDetailsRangeMeasureRaf = 0;
        }
        runtime.state.investmentStockDetailsRangeMeasureRaf = window.requestAnimationFrame(() => {
            runtime.state.investmentStockDetailsRangeMeasureRaf = window.requestAnimationFrame(() => {
                runtime.state.investmentStockDetailsRangeMeasureRaf = 0;
                updateInvestmentStockDetailsRangePill();
            });
        });
    }

function updateInvestmentEquityRangePill() {
        const rangeControl = getInvestmentEquityRangeControl();
        if (!rangeControl) return;
        const activeLabel = rangeControl.querySelector('input[type="radio"]:checked + span');
        if (!activeLabel) {
            rangeControl.classList.remove('is-pill-ready');
            return;
        }

        const pillGeometry = measureInvestmentSegmentedPillGeometry(rangeControl, activeLabel);
        if (!pillGeometry) {
            rangeControl.classList.remove('is-pill-ready');
            return;
        }

        rangeControl.style.setProperty('--segmented-pill-left', `${pillGeometry.left}px`);
        rangeControl.style.setProperty('--segmented-pill-width', `${pillGeometry.width}px`);
        keepSegmentedActiveOptionVisible(rangeControl, pillGeometry);
        rangeControl.classList.add('is-pill-ready');
    }

function scheduleInvestmentEquityRangePillUpdate() {
        const rangeControl = getInvestmentEquityRangeControl();
        if (!rangeControl) return;
        rangeControl.classList.remove('is-pill-ready');
        if (runtime.state.investmentEquityRangeMeasureRaf) {
            window.cancelAnimationFrame(runtime.state.investmentEquityRangeMeasureRaf);
            runtime.state.investmentEquityRangeMeasureRaf = 0;
        }
        runtime.state.investmentEquityRangeMeasureRaf = window.requestAnimationFrame(() => {
            runtime.state.investmentEquityRangeMeasureRaf = window.requestAnimationFrame(() => {
                runtime.state.investmentEquityRangeMeasureRaf = 0;
                updateInvestmentEquityRangePill();
            });
        });
    }

function renderInvestmentRangeControl({
        inputName = 'investment_stock_details_range',
        inputIdPrefix = 'investment_stock_details_range',
        shellClassName = 'investment-stock-details-range-shell',
        controlClassName = runtime.INVESTMENT_RANGE_SEGMENTED_CONTROL_CLASS,
        dataAttributeName = 'data-investment-stock-details-range-segmented',
        activeRange = 'max',
        options = runtime.INVESTMENT_STOCK_DETAILS_RANGE_OPTIONS,
    } = {}) {
        const activeIndex = Math.max(0, options.findIndex((option) => option.value === activeRange));
        return `
            <div class="${runtime.escapeHtml(shellClassName)}">
                <div class="segmented-control ${runtime.escapeHtml(controlClassName)}"
                     ${dataAttributeName}
                     data-segmented-pill="measured"
                     data-active="${runtime.escapeHtml(activeRange)}"
                     data-option-count="${options.length}"
                     style="--segmented-active-index: ${activeIndex}; --segmented-pill-left: 0px; --segmented-pill-width: 0px;">
                    ${options.map((option) => `
                        <label class="segmented-control-option" for="${runtime.escapeHtml(inputIdPrefix)}_${option.value}">
                            <input id="${runtime.escapeHtml(inputIdPrefix)}_${option.value}"
                                   name="${runtime.escapeHtml(inputName)}"
                                   type="radio"
                                   value="${option.value}"
                                   ${option.value === activeRange ? 'checked' : ''}>
                            <span>${option.label}</span>
                        </label>
                    `).join('')}
                </div>
            </div>
        `;
    }

function renderInvestmentStockDetailsRangeControl() {
        return renderInvestmentRangeControl({
            inputName: 'investment_stock_details_range',
            inputIdPrefix: 'investment_stock_details_range',
            shellClassName: 'investment-stock-details-range-shell',
            dataAttributeName: 'data-investment-stock-details-range-segmented',
            activeRange: normalizeInvestmentStockDetailsRange(runtime.state.selectedInvestmentStockDetailsRange),
            options: runtime.INVESTMENT_STOCK_DETAILS_RANGE_OPTIONS,
        });
    }

function renderInvestmentEquityRangeControl() {
        return renderInvestmentRangeControl({
            inputName: 'investment_equity_range',
            inputIdPrefix: 'investment_equity_range',
            shellClassName: 'investment-stock-details-range-shell',
            dataAttributeName: 'data-investment-equity-range-segmented',
            activeRange: normalizeInvestmentEquityRange(runtime.state.selectedInvestmentEquityRange),
            options: runtime.INVESTMENT_EQUITY_RANGE_OPTIONS,
        });
    }

function bindInvestmentStockDetailsRangeControls(ticker, detailRows = []) {
        clearInvestmentStockDetailsRangeControlBindings();
        const rangeControl = getInvestmentStockDetailsRangeControl();
        if (!rangeControl) return;

        const checkedInput = rangeControl.querySelector(`input[value="${CSS.escape(normalizeInvestmentStockDetailsRange(runtime.state.selectedInvestmentStockDetailsRange))}"]`);
        if (checkedInput instanceof HTMLInputElement) {
            checkedInput.checked = true;
        }
        rangeControl.dataset.active = normalizeInvestmentStockDetailsRange(runtime.state.selectedInvestmentStockDetailsRange);

        const abortController = new AbortController();
        runtime.state.investmentStockDetailsRangeControlAbortController = abortController;
        const { signal } = abortController;
        rangeControl.addEventListener('change', (event) => {
            const nextInput = event.target;
            if (!(nextInput instanceof HTMLInputElement) || nextInput.name !== 'investment_stock_details_range') return;
            const nextRange = normalizeInvestmentStockDetailsRange(nextInput.value);
            runtime.state.selectedInvestmentStockDetailsRange = nextRange;
            runtime.rememberInvestmentPageState({ range: nextRange });
            runtime.syncInvestmentUrl({historyMode: 'replace'});
            rangeControl.dataset.active = nextRange;
            const nextIndex = Math.max(0, runtime.INVESTMENT_STOCK_DETAILS_RANGE_OPTIONS.findIndex((option) => option.value === nextRange));
            rangeControl.style.setProperty('--segmented-active-index', String(nextIndex));
            scheduleInvestmentStockDetailsRangePillUpdate();
            runtime.renderInvestmentStockDetailsPriceChart(ticker, detailRows);
        }, { signal });
        window.addEventListener('resize', scheduleInvestmentStockDetailsRangePillUpdate, { signal });
        if (window.ResizeObserver) {
            const resizeObserver = new ResizeObserver(() => {
                scheduleInvestmentStockDetailsRangePillUpdate();
            });
            resizeObserver.observe(rangeControl);
            const rangeShell = rangeControl.closest('.investment-stock-details-range-shell');
            if (rangeShell instanceof HTMLElement) resizeObserver.observe(rangeShell);
            runtime.state.investmentStockDetailsRangeControlResizeObserver = resizeObserver;
        }
        scheduleInvestmentStockDetailsRangePillUpdate();
    }

    return {
        collectSegmentedTextNodes,
        measureSegmentedInlineContentRect,
        measureInvestmentSegmentedPillGeometry,
        keepSegmentedActiveOptionVisible,
        syncInvestmentShareActionsPosition,
        updateInvestmentSegmentedPill,
        scheduleInvestmentSegmentedPillUpdate,
        updateIbkrImportSegmentedPill,
        scheduleIbkrImportSegmentedPillUpdate,
        updateHsbcImportSegmentedPill,
        scheduleHsbcImportSegmentedPillUpdate,
        getInvestmentStockDetailsRangeControl,
        getInvestmentEquityRangeControl,
        isInvestmentStockDetailsIntradayRange,
        buildInvestmentIntradayDayFallbackIndex,
        buildInvestmentIntradayDayBoundaries,
        getInvestmentTradeSessionType,
        loadInvestmentStockDetailsIntradayRows,
        loadInvestmentOverviewIntradayRows,
        buildInvestmentOverviewIntradayMinuteMap,
        getInvestmentSnapshotFixedHoldingValue,
        getInvestmentOverviewLatestOneWeekMinuteKeys,
        aggregateInvestmentOverviewCandlesForDisplay,
        buildInvestmentOverviewTradingDayKeys,
        buildInvestmentOverviewRegularSessionMinuteKeys,
        getInvestmentOverviewNewYorkMinutePartsFromUtc,
        getInvestmentOverviewSnapshotEffectiveMinuteKey,
        getInvestmentOverviewIntradaySnapshotsForTradingDay,
        getInvestmentOverviewEffectiveSnapshotForTradingDay,
        buildInvestmentOverviewActiveTickerSetForSnapshots,
        buildInvestmentOverviewIntradayLinePoints,
        buildInvestmentOverviewEmptyIntradayLinePoints,
        getInvestmentOverviewIntradayLineCacheKey,
        getInvestmentOverviewIntradayLineQuality,
        shouldUseInvestmentOverviewIntradayLinePoints,
        getCachedInvestmentOverviewIntradayLinePoints,
        getInvestmentOverviewRealtimeMinuteKey,
        rememberInvestmentOverviewRealtimeLinePoint,
        mergeInvestmentOverviewRealtimeLinePoints,
        resolveInvestmentEquityRealtimeMarkerTarget,
        cacheInvestmentOverviewIntradayLinePoints,
        getInvestmentEquitySegmentBorderColor,
        buildInvestmentOverviewIntradayCandles,
        normalizeInvestmentStockDetailsRange,
        normalizeInvestmentEquityRange,
        getInvestmentHistoryHeadingElement,
        getInvestmentEquityActiveRangeLabel,
        syncInvestmentHistoryHeading,
        clearInvestmentStockDetailsRangeControlBindings,
        clearInvestmentEquityRangeControlBindings,
        updateInvestmentStockDetailsRangePill,
        scheduleInvestmentStockDetailsRangePillUpdate,
        updateInvestmentEquityRangePill,
        scheduleInvestmentEquityRangePillUpdate,
        renderInvestmentRangeControl,
        renderInvestmentStockDetailsRangeControl,
        renderInvestmentEquityRangeControl,
        bindInvestmentStockDetailsRangeControls,
    };
}

