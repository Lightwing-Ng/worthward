/**
 * Stock-details state and transaction-history filters.
 *
 * Code version: v1.1.0
 * - Added: Shared modals explicitly select fixed loading or measured progress
 *   and restore the indicator when the modal is reused.
 * - Fixed: Revealing the share actions re-aligns them to the global anchor.
 * - Fixed: Workbook validation refreshes the browser write session first.
 * - Added: Extracted from the Investment workspace composition root.
 */

export function createInvestmentStockHistoryFilterRuntime(runtime) {
function bindInvestmentEquityRangeControls(chartPoints = []) {
        runtime.clearInvestmentEquityRangeControlBindings();
        const rangeControl = runtime.getInvestmentEquityRangeControl();
        if (!rangeControl) return;

        const checkedInput = rangeControl.querySelector(`input[value="${CSS.escape(runtime.normalizeInvestmentEquityRange(runtime.state.selectedInvestmentEquityRange))}"]`);
        if (checkedInput instanceof HTMLInputElement) {
            checkedInput.checked = true;
        }
        rangeControl.dataset.active = runtime.normalizeInvestmentEquityRange(runtime.state.selectedInvestmentEquityRange);

        const abortController = new AbortController();
        runtime.state.investmentEquityRangeControlAbortController = abortController;
        const { signal } = abortController;
        rangeControl.addEventListener('change', (event) => {
            const nextInput = event.target;
            if (!(nextInput instanceof HTMLInputElement) || nextInput.name !== 'investment_equity_range') return;
            const nextRange = runtime.normalizeInvestmentEquityRange(nextInput.value);
            runtime.state.selectedInvestmentEquityRange = nextRange;
            runtime.rememberInvestmentPageState({ equityRange: nextRange });
            syncInvestmentUrl({historyMode: 'replace'});
            rangeControl.dataset.active = nextRange;
            const nextIndex = Math.max(0, runtime.INVESTMENT_EQUITY_RANGE_OPTIONS.findIndex((option) => option.value === nextRange));
            rangeControl.style.setProperty('--segmented-active-index', String(nextIndex));
            runtime.updateInvestmentEquityRangePill();
            const nextChartPoints = runtime.getInvestmentEquityChartInputPoints(chartPoints);
            runtime.updateInvestmentEquityChartDisplay(nextChartPoints);
        }, { signal });
        window.addEventListener('resize', runtime.updateInvestmentEquityRangePill, { signal });
        if (window.ResizeObserver) {
            const resizeObserver = new ResizeObserver(() => {
                runtime.updateInvestmentEquityRangePill();
            });
            resizeObserver.observe(rangeControl);
            const rangeShell = rangeControl.closest('.investment-stock-details-range-shell');
            if (rangeShell instanceof HTMLElement) resizeObserver.observe(rangeShell);
            runtime.state.investmentEquityRangeControlResizeObserver = resizeObserver;
        }
        runtime.scheduleInvestmentEquityRangePillUpdate();
    }

function lockInvestmentSurfaceHeight() {
        if (!runtime.investmentViewSurface) return;
        const currentHeight = runtime.investmentViewSurface.getBoundingClientRect().height;
        const cappedHeight = getInvestmentSurfaceCappedHeight(currentHeight);
        runtime.investmentViewSurface.style.height = `${cappedHeight}px`;
        runtime.investmentViewSurface.style.overflow = 'clip';
    }

function getInvestmentSurfaceMaxHeight() {
        if (!runtime.investmentViewSurface) return null;
        const reportCard = runtime.investmentViewSurface.closest('.investment-report-card');
        if (!(reportCard instanceof HTMLElement)) return null;
        const reportCardRect = reportCard.getBoundingClientRect();
        if (!Number.isFinite(reportCardRect.height) || reportCardRect.height <= 0) return null;
        const styles = window.getComputedStyle(reportCard);
        const paddingTop = parseFloat(styles.paddingTop) || 0;
        const paddingBottom = parseFloat(styles.paddingBottom) || 0;
        return Math.max(0, reportCardRect.height - paddingTop - paddingBottom);
    }

function getInvestmentSurfaceCappedHeight(height) {
        const numericHeight = Number(height) || 0;
        const maxHeight = getInvestmentSurfaceMaxHeight();
        if (!Number.isFinite(maxHeight) || maxHeight <= 0) {
            return Math.max(0, numericHeight);
        }
        return Math.max(0, Math.min(numericHeight, maxHeight));
    }

function cleanupInvestmentSurfaceHeight() {
        if (!runtime.investmentViewSurface) return;
        runtime.investmentViewSurface.style.height = '';
        runtime.investmentViewSurface.style.overflow = '';
        if (runtime.state.investmentSurfaceCleanupTimer) {
            window.clearTimeout(runtime.state.investmentSurfaceCleanupTimer);
            runtime.state.investmentSurfaceCleanupTimer = null;
        }
        runtime.syncInvestmentShareActionsPosition();
    }

function animateInvestmentSurfaceHeight() {
        if (!runtime.investmentViewSurface || !runtime.investmentViewSurfaceBody) return;
        if (!runtime.investmentViewSurface.style.height) {
            lockInvestmentSurfaceHeight();
        }
        void runtime.investmentViewSurface.offsetHeight;
        const targetHeight = getInvestmentSurfaceCappedHeight(runtime.investmentViewSurface.scrollHeight);
        runtime.investmentViewSurface.style.height = `${targetHeight}px`;
        if (runtime.state.investmentSurfaceCleanupTimer) {
            window.clearTimeout(runtime.state.investmentSurfaceCleanupTimer);
        }
        runtime.state.investmentSurfaceCleanupTimer = window.setTimeout(() => {
            cleanupInvestmentSurfaceHeight();
        }, 460);
    }

function getInvestmentLocationTicker() {
        const search = new URLSearchParams(window.location.search || '');
        return normalizeInvestmentTicker(search.get('ticker') || '');
    }

function getInvestmentUrlStateForCurrentView({view = runtime.state.activeInvestmentView || 'chart', ticker = runtime.state.selectedInvestmentStockTicker} = {}) {
        const normalizedView = runtime.normalizeInvestmentView(view);
        const availableBrokerCodes = runtime.getAvailableInvestmentBrokerCodes();
        const selectedBrokerCodes = runtime.getInvestmentBrokerFilterSelectedCodes({view: normalizedView});
        const allBrokersSelected = runtime.isInvestmentBrokerFilterAllSelected(selectedBrokerCodes, availableBrokerCodes);
        return {
            view: normalizedView,
            ticker: normalizeInvestmentTicker(ticker || ''),
            overviewRange: runtime.normalizeInvestmentEquityRange(runtime.state.selectedInvestmentEquityRange),
            stockDetailsRange: runtime.normalizeInvestmentStockDetailsRange(runtime.state.selectedInvestmentStockDetailsRange),
            metricsBroker: runtime.getInvestmentBrokerSummarySelectedCode(),
            brokerSelection: {
                all: allBrokersSelected,
                codes: allBrokersSelected ? [] : Array.from(selectedBrokerCodes),
            },
            typeFilter: window.WORTHWARD_INVESTMENT_FILTERS?.normalizeSideFilter(runtime.state.investmentSideFilter) || 'all',
            currencyFilter: runtime.state.investmentCurrencyFilter,
            descriptionFilter: runtime.state.investmentDescriptionBindingFilter,
            dateFilter: runtime.state.investmentStockDetailsDateFilter,
            page: runtime.state.investmentHistoryCurrentPage,
        };
    }

function getInvestmentCurrentUrl() {
        return `${window.location.pathname}${window.location.search}${window.location.hash}`;
    }

function syncInvestmentUrl({historyMode = 'replace', view = runtime.state.activeInvestmentView, ticker = runtime.state.selectedInvestmentStockTicker} = {}) {
        if (runtime.state.investmentUrlStateApplying) return;
        const nextUrl = runtime.buildInvestmentUrl(
            window.location.href,
            getInvestmentUrlStateForCurrentView({view, ticker}),
        );
        if (getInvestmentCurrentUrl() === nextUrl) return;
        const historyState = {investment: true, view: runtime.normalizeInvestmentView(view)};
        if (historyMode === 'push') {
            window.history.pushState(historyState, '', nextUrl);
        } else {
            window.history.replaceState(historyState, '', nextUrl);
        }
    }

function buildInvestmentViewUrl(nextView, ticker = '') {
        return runtime.buildInvestmentUrl(
            window.location.href,
            getInvestmentUrlStateForCurrentView({
                view: nextView,
                ticker: normalizeInvestmentTicker(ticker || runtime.state.selectedInvestmentStockTicker || ''),
            }),
        );
    }

function buildInvestmentStockDetailsHref(ticker = '') {
        return buildInvestmentViewUrl('stock_details', ticker);
    }

function syncInvestmentViewHash(nextView, ticker = '') {
        syncInvestmentUrl({
            view: nextView,
            ticker: ticker || runtime.state.selectedInvestmentStockTicker,
            historyMode: 'replace',
        });
    }

function syncInvestmentStockDetailsTableVisibility() {
        if (!(runtime.investmentStockDetailsTableHost instanceof HTMLElement)) return;
        const hasContent = Boolean(
            runtime.investmentStockDetailsTableHost.querySelector('.investment-stock-details-table-shell')
            || runtime.investmentStockDetailsTableHost.textContent.trim()
        );
        const isVisible = runtime.state.activeInvestmentView === 'stock_details' && hasContent;
        runtime.investmentStockDetailsTableHost.hidden = !isVisible;
        if (runtime.historyTable instanceof HTMLElement) {
            runtime.historyTable.hidden = runtime.state.activeInvestmentView === 'stock_details';
        }
        runtime.investmentHistorySurface?.classList.toggle('is-stock-details-table-visible', isVisible);
        if (isVisible) {
            runtime.attachStockDetailsTableAlignmentSync(runtime.investmentStockDetailsTableHost);
            runtime.mountInvestmentHistoryPagination();
            return;
        }
        runtime.teardownStockDetailsTableAlignmentSync();
        if (runtime.state.activeInvestmentView !== 'stock_details') {
            runtime.mountInvestmentHistoryPagination();
        }
    }

function scheduleInvestmentStockDetailsVisibleLayoutSync() {
        if (runtime.state.investmentStockDetailsVisibleLayoutTimer) {
            window.clearTimeout(runtime.state.investmentStockDetailsVisibleLayoutTimer);
            runtime.state.investmentStockDetailsVisibleLayoutTimer = 0;
        }
        if (runtime.state.activeInvestmentView !== 'stock_details') return;
        window.requestAnimationFrame(() => {
            if (runtime.state.activeInvestmentView !== 'stock_details') return;
            // Re-measure the segmented pill after the panel becomes visible.
            runtime.scheduleInvestmentStockDetailsRangePillUpdate();
            refreshPortfolioDonutOrbits(runtime.investmentStockDetailsPanel);
            const chartCanvas = runtime.state.investmentStockDetailsPriceChartInstance?.canvas;
            chartCanvas?._scheduleLayoutSync?.();
        });
        runtime.state.investmentStockDetailsVisibleLayoutTimer = window.setTimeout(() => {
            runtime.state.investmentStockDetailsVisibleLayoutTimer = 0;
            if (runtime.state.activeInvestmentView !== 'stock_details') return;
            runtime.scheduleInvestmentStockDetailsRangePillUpdate();
            refreshPortfolioDonutOrbits(runtime.investmentStockDetailsPanel);
            const chartCanvas = runtime.state.investmentStockDetailsPriceChartInstance?.canvas;
            chartCanvas?._scheduleLayoutSync?.();
        }, runtime.INVESTMENT_SURFACE_LAYOUT_SETTLE_MS);
    }

function waitForInvestmentStableElementBox(element, {
        minimumWidth = 120,
        minimumHeight = 120,
        stableFramesRequired = 3,
        timeoutMs = runtime.INVESTMENT_SURFACE_LAYOUT_SETTLE_MS + 260,
    } = {}) {
        if (!(element instanceof HTMLElement)) return Promise.resolve(false);
        const isElementReady = () => {
            if (!element.isConnected) return false;
            if (element.closest('[hidden]')) return false;
            const rect = element.getBoundingClientRect();
            return rect.width >= minimumWidth && rect.height >= minimumHeight;
        };
        if (isElementReady()) {
            return new Promise((resolve) => {
                let stableFrames = 0;
                let lastWidth = Number.NaN;
                let lastHeight = Number.NaN;
                const startedAt = performance.now();
                const step = () => {
                    if (!element.isConnected) {
                        resolve(false);
                        return;
                    }
                    const rect = element.getBoundingClientRect();
                    const width = Math.round(rect.width * 100) / 100;
                    const height = Math.round(rect.height * 100) / 100;
                    const isReady = width >= minimumWidth && height >= minimumHeight;
                    const isStable = isReady
                        && Math.abs(width - lastWidth) < 0.5
                        && Math.abs(height - lastHeight) < 0.5;
                    stableFrames = isStable ? (stableFrames + 1) : 0;
                    lastWidth = width;
                    lastHeight = height;
                    if (stableFrames >= stableFramesRequired) {
                        resolve(true);
                        return;
                    }
                    if ((performance.now() - startedAt) >= timeoutMs) {
                        resolve(isReady);
                        return;
                    }
                    window.requestAnimationFrame(step);
                };
                window.requestAnimationFrame(step);
            });
        }
        return new Promise((resolve) => {
            const startedAt = performance.now();
            const step = () => {
                if (!element.isConnected) {
                    resolve(false);
                    return;
                }
                if (isElementReady()) {
                    waitForInvestmentStableElementBox(element, {
                        minimumWidth,
                        minimumHeight,
                        stableFramesRequired,
                        timeoutMs: Math.max(120, timeoutMs - (performance.now() - startedAt)),
                    }).then(resolve);
                    return;
                }
                if ((performance.now() - startedAt) >= timeoutMs) {
                    resolve(false);
                    return;
                }
                window.requestAnimationFrame(step);
            };
            window.requestAnimationFrame(step);
        });
    }

function setInvestmentView(nextView, { syncHash = true } = {}) {
        if (!nextView) {
            return;
        }

        const normalizedNextView = runtime.normalizeInvestmentView(nextView);

        if (normalizedNextView === 'stock_details') {
            runtime.ensureSelectedInvestmentStockTicker();
        }

        if (normalizedNextView === runtime.state.activeInvestmentView) {
            if (normalizedNextView === 'metrics') {
                runtime.ensureInvestmentMetricsBrokerScope();
            }
            runtime.rememberInvestmentPageState({ view: normalizedNextView });
            if (normalizedNextView === 'stock_details') {
                refreshPortfolioDonutOrbits(runtime.investmentStockDetailsPanel);
            }
            return;
        }

        const previousInvestmentView = runtime.state.activeInvestmentView;
        const isMetricsHistoryScopeChanging = previousInvestmentView === 'metrics'
            || normalizedNextView === 'metrics';

        lockInvestmentSurfaceHeight();

        if (runtime.segmentedControl) {
            const activeIndex = Math.max(runtime.INVESTMENT_VIEW_ORDER.indexOf(normalizedNextView), 0);
            const nextRadio = runtime.segmentedControl.querySelector(`input[type="radio"][value="${CSS.escape(normalizedNextView)}"]`);
            if (nextRadio instanceof HTMLInputElement) {
                nextRadio.checked = true;
            }
            runtime.segmentedControl.dataset.active = normalizedNextView;
            runtime.segmentedControl.style.setProperty('--segmented-option-count', String(runtime.INVESTMENT_VIEW_ORDER.length));
            runtime.segmentedControl.style.setProperty('--segmented-active-index', String(activeIndex));
            runtime.scheduleInvestmentSegmentedPillUpdate();
        }
        if (runtime.investmentViewSurface) {
            runtime.investmentViewSurface.dataset.activeView = normalizedNextView;
        }
        runtime.investmentPanels.forEach((panel) => {
            panel.hidden = panel.dataset.investmentViewPanel !== normalizedNextView;
        });
        runtime.state.activeInvestmentView = normalizedNextView;
        if (normalizedNextView === 'metrics') {
            runtime.ensureInvestmentMetricsBrokerScope();
        }
        syncInvestmentStockDetailsTableVisibility();
        if (syncHash) {
            syncInvestmentUrl({historyMode: 'push', view: normalizedNextView});
        }
        if (
            normalizedNextView === 'stock_details'
            && runtime.investmentStockDetailsTableHost?.querySelector('.investment-stock-details-table-shell')
        ) {
            runtime.refreshInvestmentStockDetailsTableRows({refreshHeaders: false});
        } else if (
            previousInvestmentView === 'stock_details'
            && normalizedNextView !== 'stock_details'
            && !isMetricsHistoryScopeChanging
            && runtime.state.investmentProcessedTransactionsCache.length
        ) {
            runtime.renderInvestmentHistoryTableRows(
                runtime.state.investmentProcessedTransactionsCache,
                runtime.state.investmentChartPointsCache,
                {resetPage: false, scrollToTop: false},
            );
        }
        if (
            !runtime.state.investmentUrlStateApplying
            && isMetricsHistoryScopeChanging
            && runtime.state.investmentProcessedTransactionsCache.length
        ) {
            runtime.syncAllInvestmentBrokerFilterUi();
            runtime.renderInvestmentHistoryTableRows(
                runtime.state.investmentProcessedTransactionsCache,
                runtime.state.investmentChartPointsCache,
                {resetPage: false, scrollToTop: false},
            );
        }
        runtime.rememberInvestmentPageState({ view: normalizedNextView });
        animateInvestmentSurfaceHeight();
        if (normalizedNextView === 'stock_details') {
            scheduleInvestmentStockDetailsVisibleLayoutSync();
        }
    }

function initInvestmentViewTabs() {
        if (!runtime.segmentedControl) return;
        const radios = runtime.segmentedControl.querySelectorAll('input[type="radio"]');
        radios.forEach((radio) => {
            radio.addEventListener('change', () => {
                if (radio.checked) {
                    setInvestmentView(radio.value);
                }
            });
        });
        const checkedRadio = runtime.segmentedControl.querySelector('input[type="radio"]:checked');
        const initialUrlState = runtime.parseInvestmentUrlState(window.location.href, {
            tickerNormalizer: normalizeInvestmentTicker,
        });
        const rememberedView = runtime.restoreRememberedInvestmentPageState();
        const restoredLocationFromMemory = initialUrlState.hasExplicitState
            ? false
            : runtime.restoreRememberedInvestmentLocation();
        runtime.state.activeInvestmentView = '';
        if (initialUrlState.hasExplicitState) {
            runtime.applyInvestmentUrlStateFromLocation({render: false});
        } else {
            runtime.syncInvestmentViewFromLocationHash(
                restoredLocationFromMemory ? 'stock_details' : (rememberedView || checkedRadio?.value || 'chart'),
            );
        }
        if (!initialUrlState.hasExplicitState) {
            syncInvestmentUrl({historyMode: 'replace'});
        }
        runtime.rememberInvestmentPageState({ view: runtime.state.activeInvestmentView || rememberedView || checkedRadio?.value || 'chart' });
        runtime.scheduleInvestmentSegmentedPillUpdate();
        runtime.scheduleIbkrImportSegmentedPillUpdate();
        cleanupInvestmentSurfaceHeight();

        if (document.fonts?.ready && typeof document.fonts.ready.then === 'function') {
            document.fonts.ready.then(() => {
                runtime.scheduleInvestmentSegmentedPillUpdate();
                runtime.scheduleIbkrImportSegmentedPillUpdate();
            }).catch(() => {});
        }

        window.addEventListener('resize', () => {
            runtime.scheduleInvestmentSegmentedPillUpdate();
            runtime.scheduleIbkrImportSegmentedPillUpdate();
        });

        if (window.ResizeObserver) {
            const segmentedResizeObserver = new ResizeObserver(() => {
                runtime.scheduleInvestmentSegmentedPillUpdate();
            });
            segmentedResizeObserver.observe(runtime.segmentedControl);
            radios.forEach((radio) => {
                const optionLabel = radio.nextElementSibling;
                if (optionLabel instanceof HTMLElement) {
                    segmentedResizeObserver.observe(optionLabel);
                }
            });
        }

        if (window.ResizeObserver && runtime.investmentImportIbkrMode instanceof HTMLElement) {
            const ibkrResizeObserver = new ResizeObserver(() => {
                runtime.scheduleIbkrImportSegmentedPillUpdate();
            });
            ibkrResizeObserver.observe(runtime.investmentImportIbkrMode);
            const ibkrRadios = runtime.investmentImportIbkrMode.querySelectorAll('input[type="radio"]');
            ibkrRadios.forEach((radio) => {
                const optionLabel = radio.nextElementSibling;
                if (optionLabel instanceof HTMLElement) {
                    ibkrResizeObserver.observe(optionLabel);
                }
            });
        }

        window.addEventListener('hashchange', () => {
            if (runtime.state.investmentUrlStateReady) {
                runtime.applyInvestmentUrlStateFromLocation({render: true});
                return;
            }
            runtime.syncInvestmentViewFromLocationHash(runtime.state.activeInvestmentView || 'chart');
        });
        window.addEventListener('popstate', () => {
            runtime.applyInvestmentUrlStateFromLocation({render: runtime.state.investmentUrlStateReady});
        });
    }

function interpolateHexColor(startHex, endHex, t) {
        const normalizedT = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0));
        const parseHex = (hex) => {
            const normalized = String(hex || '').replace('#', '');
            if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return { r: 0, g: 0, b: 0 };
            return {
                r: Number.parseInt(normalized.slice(0, 2), 16),
                g: Number.parseInt(normalized.slice(2, 4), 16),
                b: Number.parseInt(normalized.slice(4, 6), 16),
            };
        };
        const start = parseHex(startHex);
        const end = parseHex(endHex);
        const mix = (left, right) => Math.round(left + ((right - left) * normalizedT));
        const toHex = (value) => value.toString(16).padStart(2, '0');
        return `#${toHex(mix(start.r, end.r))}${toHex(mix(start.g, end.g))}${toHex(mix(start.b, end.b))}`;
    }

function buildInvestmentDummyPalette(count) {
        const resolvedTheme = runtime.resolveInvestmentTheme();
        if (!Number.isFinite(count) || count <= 0) return [];
        if (count === 1) return [resolvedTheme.accentPrimary];
        return Array.from({ length: count }, (_, index) => {
            const ratio = index / (count - 1);
            return interpolateHexColor(resolvedTheme.accentPrimary, resolvedTheme.accentSecondary, ratio);
        });
    }

function ensureAnimatedDonutLayers(donutElement) {
        if (!(donutElement instanceof HTMLElement)) return [];
        donutElement.classList.add('is-animated');
        let fillLayerA = donutElement.querySelector('.portfolio-donut-fill-layer-a');
        let fillLayerB = donutElement.querySelector('.portfolio-donut-fill-layer-b');
        if (!(fillLayerA instanceof HTMLElement)) {
            fillLayerA = document.createElement('span');
            fillLayerA.className = 'portfolio-donut-fill-layer portfolio-donut-fill-layer-a';
            donutElement.appendChild(fillLayerA);
        }
        if (!(fillLayerB instanceof HTMLElement)) {
            fillLayerB = document.createElement('span');
            fillLayerB.className = 'portfolio-donut-fill-layer portfolio-donut-fill-layer-b';
            donutElement.appendChild(fillLayerB);
        }
        return [fillLayerA, fillLayerB];
    }

function applyAnimatedDonutFill(donutElement, fillValue) {
        if (!(donutElement instanceof HTMLElement)) return;
        const [fillLayerA, fillLayerB] = ensureAnimatedDonutLayers(donutElement);
        if (!(fillLayerA instanceof HTMLElement) || !(fillLayerB instanceof HTMLElement)) {
            donutElement.style.setProperty('--portfolio-donut-fill', fillValue);
            return;
        }
        const activeLayerKey = donutElement.dataset.activeFillLayer === 'b' ? 'b' : 'a';
        const nextLayerKey = activeLayerKey === 'a' ? 'b' : 'a';
        const nextLayer = nextLayerKey === 'a' ? fillLayerA : fillLayerB;
        nextLayer.style.background = fillValue;
        donutElement.dataset.activeFillLayer = nextLayerKey;
        donutElement.style.setProperty('--portfolio-donut-fill', fillValue);
    }

function syncAnimatedDonutLogos(logoLayer, logoItems) {
        if (!(logoLayer instanceof HTMLElement)) return;
        const existingLogos = new Map(
            Array.from(logoLayer.querySelectorAll('.portfolio-donut-logo')).map((logo) => [logo.dataset.ticker || '', logo])
        );
        const nextTickers = new Set();
        logoItems.forEach((item) => {
            nextTickers.add(item.ticker);
            let logo = existingLogos.get(item.ticker);
            if (!(logo instanceof HTMLImageElement)) {
                logo = document.createElement('img');
                logo.className = 'portfolio-donut-logo';
                logo.dataset.ticker = item.ticker;
                logo.alt = `${item.ticker} logo`;
                logo.src = item.logoUrl;
                logo.dataset.styleTokenDonutAngle = item.midAngle.toFixed(2);
                logo.style.opacity = '0';
                logoLayer.appendChild(logo);
                const reveal = () => {
                    logo.style.opacity = '1';
                    return false;
                };
                if (window.WorthwardMotion?.scheduler?.frame) {
                    window.WorthwardMotion.scheduler.frame(logo, reveal);
                } else {
                    window.requestAnimationFrame(reveal);
                }
            } else {
                if (logo.src !== item.logoUrl) logo.src = item.logoUrl;
                logo.dataset.styleTokenDonutAngle = item.midAngle.toFixed(2);
            }
            if (item.className) {
                logo.classList.add(...String(item.className).split(/\s+/).filter(Boolean));
            }
            logo.classList.remove('is-exiting');
        });
        existingLogos.forEach((logo, ticker) => {
            if (nextTickers.has(ticker)) return;
            logo.classList.add('is-exiting');
            window.setTimeout(() => {
                if (logo.classList.contains('is-exiting')) logo.remove();
            }, 220);
        });
    }

function normalizeInvestmentLogoUrlList(logoUrl) {
        const values = Array.isArray(logoUrl) ? logoUrl : [logoUrl];
        return Array.from(new Set(values
            .map((value) => String(value || '').trim())
            .filter(Boolean)));
    }

function resolveInvestmentLogoUrl(profile, ticker) {
        const moneyMarketFundLogoUrl = runtime.getMoneyMarketFundLogoUrl(ticker);
        if (moneyMarketFundLogoUrl) return moneyMarketFundLogoUrl;
        return String(profile?.logo_url || '').trim();
    }

function resolveInvestmentLogoUrls(profile, ticker) {
        const moneyMarketFundLogoUrl = runtime.getMoneyMarketFundLogoUrl(ticker);
        if (moneyMarketFundLogoUrl) return [moneyMarketFundLogoUrl];
        return normalizeInvestmentLogoUrlList(String(profile?.logo_url || '').trim());
    }

function setInvestmentTickerLogoVisibility(logo, placeholder, isLoaded) {
        if (logo instanceof HTMLImageElement) {
            logo.hidden = !isLoaded;
            logo.dataset.loaded = isLoaded ? '1' : '0';
        }
        if (placeholder instanceof HTMLElement) {
            placeholder.hidden = isLoaded;
        }
    }

function syncInvestmentTickerLogoAsset(logo, placeholder, logoUrl, altText = '') {
        const normalizedUrls = normalizeInvestmentLogoUrlList(logoUrl);
        if (!(logo instanceof HTMLImageElement)) {
            if (placeholder instanceof HTMLElement) {
                placeholder.hidden = normalizedUrls.length > 0;
            }
            return;
        }
        logo.onload = null;
        logo.onerror = null;
        if (!normalizedUrls.length) {
            delete logo.dataset.requestedSrc;
            logo.removeAttribute('src');
            logo.alt = '';
            setInvestmentTickerLogoVisibility(logo, placeholder, false);
            return;
        }
        logo.alt = altText;
        logo.loading = 'eager';
        const tryLoadAtIndex = (index) => {
            const nextUrl = normalizedUrls[index];
            if (!nextUrl) {
                delete logo.dataset.requestedSrc;
                logo.removeAttribute('src');
                setInvestmentTickerLogoVisibility(logo, placeholder, false);
                return;
            }
            logo.dataset.requestedSrc = nextUrl;
            setInvestmentTickerLogoVisibility(logo, placeholder, false);
            const finalize = (isLoaded) => {
                if (logo.dataset.requestedSrc !== nextUrl) return;
                if (!isLoaded) {
                    tryLoadAtIndex(index + 1);
                    return;
                }
                setInvestmentTickerLogoVisibility(logo, placeholder, true);
            };
            logo.onload = () => finalize(true);
            logo.onerror = () => finalize(false);
            if (logo.getAttribute('src') !== nextUrl) {
                logo.src = nextUrl;
            }
            if (logo.complete) {
                finalize(Boolean(logo.naturalWidth && logo.naturalHeight));
            }
        };
        tryLoadAtIndex(0);
    }

function getActiveInvestmentInteractionPoint() {
        if (Array.isArray(runtime.state.investmentChartPointsCache) && runtime.state.investmentChartPointsCache.length) {
            if (runtime.state.activeChartTooltipPointRecord && typeof runtime.state.activeChartTooltipPointRecord === 'object') {
                return runtime.state.activeChartTooltipPointRecord;
            }
            if (Number.isFinite(runtime.state.activeChartTooltipPointIndex) && runtime.state.activeChartTooltipPointIndex >= 0) {
                return runtime.state.investmentChartPointsCache[runtime.state.activeChartTooltipPointIndex] || null;
            }
            if (Number.isFinite(runtime.state.activeHoldingsHoverLedgerNo) && runtime.state.activeHoldingsHoverLedgerNo > 0) {
                const hoverIndex = runtime.state.investmentChartPointIndexByLedgerNo.get(runtime.state.activeHoldingsHoverLedgerNo);
                if (Number.isFinite(hoverIndex) && hoverIndex >= 0) {
                    return runtime.state.investmentChartPointsCache[hoverIndex] || null;
                }
            }
            return runtime.state.investmentLatestChartPoint || runtime.state.investmentChartPointsCache[runtime.state.investmentChartPointsCache.length - 1] || null;
        }
        return null;
    }

function renderInvestmentDummyPortfolioDonut(pointRecord, tickerProfiles) {
        const resolvedTheme = runtime.resolveInvestmentTheme();
        if (!(runtime.investmentDummyChart instanceof HTMLElement) || !(runtime.investmentDummyLogoLayer instanceof HTMLElement) || !(runtime.investmentDummyDonut instanceof HTMLElement)) return;
        if (runtime.state.investmentAggregateSecurityTransferState.blocked) {
            runtime.investmentDummyChart.hidden = true;
            runtime.investmentDummyChart.setAttribute('aria-hidden', 'true');
            syncAnimatedDonutLogos(runtime.investmentDummyLogoLayer, []);
            return;
        }
        runtime.investmentDummyChart.hidden = false;
        runtime.investmentDummyChart.removeAttribute('aria-hidden');
        const holdingsMarketValues = pointRecord?.aggregate_holdings_market_values || pointRecord?.holdings_market_values || {};
        const cashEquivalentSet = runtime.getCashEquivalentTickerSet();
        const allHoldings = Object.entries(holdingsMarketValues)
            .map(([ticker, value]) => ({ ticker: normalizeInvestmentTicker(ticker), marketValue: Number(value) || 0 }))
            .filter((entry) => entry.ticker && entry.marketValue > 1e-9)
            .sort((left, right) => right.marketValue - left.marketValue);
        const nonCashComponents = allHoldings.filter((entry) => !cashEquivalentSet.has(entry.ticker));
        const holdingsTotalValue = allHoldings.reduce((sum, entry) => sum + entry.marketValue, 0);
        const cashValue = Math.max(0, Number(pointRecord?.aggregate_display_cash ?? pointRecord?.aggregate_running_cash ?? pointRecord?.running_cash) || 0);
        const fallbackTotal = holdingsTotalValue + cashValue;
        const denominator = Math.max(Number(pointRecord?.aggregate_total_equity ?? pointRecord?.total_equity) || 0, fallbackTotal, 0);
        if (denominator <= 1e-9) {
            syncAnimatedDonutLogos(runtime.investmentDummyLogoLayer, []);
            applyAnimatedDonutFill(runtime.investmentDummyDonut, 'conic-gradient(var(--theme-accent-positive) 0deg 360deg)');
            refreshInvestmentDummyDonut();
            return;
        }

        const palette = buildInvestmentDummyPalette(nonCashComponents.length);
        const logoItems = [];
        const fillFragments = [];
        const gapDegrees = 1.2;
        let angle = 0;
        let gradientIndex = 0;

        allHoldings.forEach((entry) => {
            const marketValue = entry.marketValue;
            if (marketValue <= 1e-9) return;
            const sweep = (marketValue / denominator) * 360;
            if (sweep <= 1e-9) return;
            const segmentStart = angle;
            const segmentEnd = Math.min(segmentStart + sweep, 360);
            if ((segmentEnd - segmentStart) > 1e-9) {
                const ticker = entry.ticker;
                const isCashEquivalent = cashEquivalentSet.has(ticker);
                const segmentColor = isCashEquivalent
                    ? 'var(--theme-accent-positive)'
                    : (palette[gradientIndex] || resolvedTheme.accentPrimary);
                fillFragments.push(`${segmentColor} ${segmentStart}deg ${segmentEnd}deg`);
                const midAngle = segmentStart + ((segmentEnd - segmentStart) / 2);
                const profile = runtime.resolveInvestmentTickerProfile(tickerProfiles, ticker);
                const logoUrl = resolveInvestmentLogoUrl(profile, ticker);
                if (logoUrl) {
                    const tokenLogoClass = runtime.getMoneyMarketFundTokenLogoClass(ticker);
                    logoItems.push({
                        ticker,
                        logoUrl,
                        midAngle,
                        className: tokenLogoClass,
                        renderAsToken: Boolean(tokenLogoClass),
                    });
                }
                if (!isCashEquivalent) {
                    gradientIndex += 1;
                }
            }
            const hasRemaining = segmentEnd < 360;
            const gapEnd = hasRemaining ? Math.min(segmentEnd + gapDegrees, 360) : segmentEnd;
            if ((gapEnd - segmentEnd) > 1e-9) {
                fillFragments.push(`transparent ${segmentEnd}deg ${gapEnd}deg`);
            }
            angle = gapEnd;
        });

        const cashStart = Math.min(Math.max(angle, 0), 360);
        if ((360 - cashStart) > 1e-9) {
            fillFragments.push(`var(--theme-accent-positive) ${cashStart}deg 360deg`);
        }

        const renderSignature = `${fillFragments.join('|')}::${logoItems.map((item) => (
            `${item.ticker}@${item.logoUrl}@${item.className || ''}@${item.midAngle.toFixed(4)}`
        )).join('|')}`;
        if (renderSignature === runtime.state.investmentDummyDonutRenderSignature) return;
        runtime.state.investmentDummyDonutRenderSignature = renderSignature;

        runtime.syncInvestmentDonutOrbitLogos(runtime.investmentDummyLogoLayer, logoItems);
        applyAnimatedDonutFill(runtime.investmentDummyDonut, `conic-gradient(${fillFragments.join(', ')})`);
        refreshInvestmentDummyDonut();
    }

function scheduleInvestmentDummyDonutSync() {
        if (runtime.state.investmentDummyDonutSyncFrame) return;
        runtime.state.investmentDummyDonutSyncFrame = window.requestAnimationFrame(() => {
            runtime.state.investmentDummyDonutSyncFrame = 0;
            syncInvestmentDummyDonutFromInteraction();
        });
    }

function scheduleInvestmentStockDetailsDonutSync() {
        if (runtime.state.activeInvestmentView !== 'stock_details') return;
        if (runtime.state.investmentStockDetailsDonutSyncFrame) return;
        runtime.state.investmentStockDetailsDonutSyncFrame = window.requestAnimationFrame(() => {
            runtime.state.investmentStockDetailsDonutSyncFrame = 0;
            syncInvestmentStockDetailsDonutFromInteraction();
        });
    }

function syncInvestmentDummyDonutFromInteraction() {
        if (!Array.isArray(runtime.state.investmentChartPointsCache) || !runtime.state.investmentChartPointsCache.length) return;
        const pointRecord = getActiveInvestmentInteractionPoint();
        if (!pointRecord) return;
        renderInvestmentDummyPortfolioDonut(pointRecord, runtime.state.investmentDummyTickerProfiles);
    }

function buildStockDetailsDonutSegments(pointRecord, tickerSummary, activeTicker) {
        const holdingsMarketValues = pointRecord?.aggregate_holdings_market_values || pointRecord?.holdings_market_values || {};
        const currentTicker = normalizeInvestmentTicker(activeTicker || tickerSummary?.ticker);
        const currentTickerValue = Math.max(0, Number(holdingsMarketValues?.[currentTicker]) || 0);
        const cashValue = Math.max(0, Number(pointRecord?.aggregate_display_cash ?? pointRecord?.aggregate_running_cash ?? pointRecord?.running_cash) || 0);
        const holdingsTotal = Object.values(holdingsMarketValues)
            .reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0);
        const fallbackTotal = holdingsTotal + cashValue;
        const denominator = Math.max(Number(pointRecord?.aggregate_total_equity ?? pointRecord?.total_equity) || 0, fallbackTotal, 0);
        if (denominator <= 1e-9) {
            return {
                denominator: 0,
                currentTickerValue: 0,
                cashValue: 0,
                remainderValue: 0,
            };
        }

        const clampedTickerValue = Math.min(currentTickerValue, denominator);
        const availableAfterTicker = Math.max(0, denominator - clampedTickerValue);
        const clampedCashValue = Math.min(cashValue, availableAfterTicker);
        const remainderValue = Math.max(0, denominator - clampedTickerValue - clampedCashValue);
        return {
            denominator,
            currentTickerValue: clampedTickerValue,
            cashValue: clampedCashValue,
            remainderValue,
        };
    }

function buildStockDetailsDonutState(pointRecord, tickerSummary, profile) {
        const activeTicker = normalizeInvestmentTicker(tickerSummary?.ticker || '');
        const logoUrl = resolveInvestmentLogoUrl(profile, activeTicker || 'stock');
        const segments = buildStockDetailsDonutSegments(pointRecord, tickerSummary, activeTicker);
        const tickerSweep = segments.denominator > 1e-9
            ? (segments.currentTickerValue / segments.denominator) * 360
            : 0;
        return {
            denominator: segments.denominator,
            tickerSweep: Math.max(0, Math.min(360, tickerSweep)),
            cashSweep: segments.denominator > 1e-9
                ? Math.max(0, Math.min(360, (segments.cashValue / segments.denominator) * 360))
                : 0,
            remainderSweep: segments.denominator > 1e-9
                ? Math.max(0, Math.min(360, (segments.remainderValue / segments.denominator) * 360))
                : 360,
            ticker: activeTicker,
            logoUrl,
        };
    }

function normalizeStockDetailsDonutState(state, fallbackTicker = '') {
        const ticker = normalizeInvestmentTicker(state?.ticker || fallbackTicker || '');
        const tickerSweep = Math.max(0, Math.min(360, Number(state?.tickerSweep) || 0));
        const cashSweep = Math.max(0, Math.min(360 - tickerSweep, Number(state?.cashSweep) || 0));
        const remainderSweep = Math.max(0, 360 - tickerSweep - cashSweep);
        return {
            ticker,
            logoUrl: String(state?.logoUrl || '').trim(),
            tickerSweep,
            cashSweep,
            remainderSweep,
        };
    }

function buildStockDetailsDonutFill(state) {
        const normalizedState = normalizeStockDetailsDonutState(state);
        const fragments = [];
        let angle = 0;

        if (normalizedState.tickerSweep > 1e-9) {
            const end = angle + normalizedState.tickerSweep;
            fragments.push(`var(--theme-accent-primary) ${angle}deg ${end}deg`);
            angle = end;
        }
        if (normalizedState.cashSweep > 1e-9) {
            const end = angle + normalizedState.cashSweep;
            fragments.push(`var(--theme-accent-positive) ${angle}deg ${end}deg`);
            angle = end;
        }
        const grayStart = Math.min(Math.max(angle, 0), 360);
        fragments.push(`${runtime.STOCK_DETAILS_DONUT_GRAY_FILL} ${grayStart}deg 360deg`);
        return `conic-gradient(${fragments.join(', ')})`;
    }

function getStockDetailsLogoAngle(state) {
        const normalizedState = normalizeStockDetailsDonutState(state);
        if (normalizedState.tickerSweep <= 1e-9) return 0;
        return normalizedState.tickerSweep / 2;
    }

function applyStockDetailsDonutState(renderState, {refreshOrbit = true} = {}) {
        if (!(runtime.investmentStockDetailsPanel instanceof HTMLElement)) return;
        const donutElement = runtime.investmentStockDetailsPanel.querySelector('.investment-stock-details-donut');
        const logoLayer = runtime.investmentStockDetailsPanel.querySelector('.investment-stock-details-donut-logo-layer');
        if (!(donutElement instanceof HTMLElement) || !(logoLayer instanceof HTMLElement)) return;
        const normalizedState = normalizeStockDetailsDonutState(renderState);
        const logoAngle = getStockDetailsLogoAngle(normalizedState);
        syncAnimatedDonutLogos(logoLayer, normalizedState.logoUrl ? [{
            ticker: normalizedState.ticker || 'stock',
            logoUrl: normalizedState.logoUrl,
            midAngle: logoAngle,
            className: 'investment-stock-details-donut-logo',
        }] : []);
        applyAnimatedDonutFill(donutElement, buildStockDetailsDonutFill(normalizedState));
        if (refreshOrbit) refreshPortfolioDonutOrbits(runtime.investmentStockDetailsPanel);
    }

function animateStockDetailsDonutTo(nextState) {
        const fallbackTicker = normalizeInvestmentTicker(nextState?.ticker || runtime.state.stockDetailsDonutAnimatedState?.ticker || '');
        const targetState = normalizeStockDetailsDonutState(nextState, fallbackTicker);
        const startState = normalizeStockDetailsDonutState(runtime.state.stockDetailsDonutAnimatedState || targetState, fallbackTicker);
        const isSameTarget = startState.ticker === targetState.ticker
            && startState.logoUrl === targetState.logoUrl
            && Math.abs(startState.tickerSweep - targetState.tickerSweep) < 1e-6
            && Math.abs(startState.cashSweep - targetState.cashSweep) < 1e-6;
        if (isSameTarget) {
            runtime.state.stockDetailsDonutAnimatedState = targetState;
            applyStockDetailsDonutState(targetState);
            return;
        }

        runtime.state.stockDetailsDonutAnimationCancel?.();
        const duration = window.WorthwardMotion?.durations?.emphasized ?? 420;
        const finish = () => {
            runtime.state.stockDetailsDonutAnimatedState = targetState;
            applyStockDetailsDonutState(targetState);
            runtime.state.stockDetailsDonutAnimationCancel = null;
        };
        const update = (eased) => {
            const frameState = normalizeStockDetailsDonutState({
                ticker: targetState.ticker,
                logoUrl: targetState.logoUrl,
                tickerSweep: startState.tickerSweep + ((targetState.tickerSweep - startState.tickerSweep) * eased),
                cashSweep: startState.cashSweep + ((targetState.cashSweep - startState.cashSweep) * eased),
            }, fallbackTicker);
            runtime.state.stockDetailsDonutAnimatedState = frameState;
            applyStockDetailsDonutState(frameState, {refreshOrbit: false});
        };
        if (window.WorthwardMotion?.scheduler?.animate) {
            runtime.state.stockDetailsDonutAnimationCancel = window.WorthwardMotion.scheduler.animate({
                key: 'investment-stock-details-donut',
                duration,
                ease: runtime.easeOutCubic,
                update,
                complete: finish,
            });
            return;
        }
        const startedAt = performance.now();
        let frameId = 0;
        const step = (now) => {
            const progress = Math.min(1, (now - startedAt) / duration);
            update(runtime.easeOutCubic(progress));
            if (progress < 1) {
                frameId = window.requestAnimationFrame(step);
                return;
            }
            finish();
        };
        frameId = window.requestAnimationFrame(step);
        runtime.state.stockDetailsDonutAnimationCancel = () => window.cancelAnimationFrame(frameId);
    }

function renderInvestmentStockDetailsDonut(pointRecord, tickerSummary, profile) {
        if (!(runtime.investmentStockDetailsPanel instanceof HTMLElement)) return;
        animateStockDetailsDonutTo(buildStockDetailsDonutState(pointRecord, tickerSummary, profile));
    }

function syncInvestmentStockDetailsDonutFromInteraction() {
        if (!(runtime.investmentStockDetailsPanel instanceof HTMLElement)) return;
        const activeTicker = runtime.ensureSelectedInvestmentStockTicker();
        if (!activeTicker) return;
        const tickerSummary = runtime.state.investmentTickerSummariesCache.find((summary) => normalizeInvestmentTicker(summary?.ticker) === activeTicker) || runtime.createPositionState(activeTicker);
        const profile = runtime.resolveInvestmentTickerProfile(
            window.WORTHWARD_INVESTMENT_DATA?.ticker_profiles || {},
            activeTicker,
        );
        const pointRecord = runtime.state.activeStockDetailsHoverPointRecord
            || getActiveInvestmentInteractionPoint()
            || runtime.state.investmentLatestChartPoint
            || null;
        renderInvestmentStockDetailsDonut(pointRecord, tickerSummary, profile);
    }

function refreshPortfolioDonutOrbits(rootElement) {
        if (!(rootElement instanceof HTMLElement)) return;
        rootElement.querySelectorAll('.style-token-portfolio-donut-orbit').forEach((orbitElement) => {
            if (!(orbitElement instanceof HTMLElement)) return;
            const orbitMetrics = runtime.getPortfolioDonutOrbitMetrics(orbitElement);
            if (!orbitMetrics) return;
            const orbitLogoLayer = orbitElement.querySelector('.portfolio-donut-logo-layer');
            const orbitLayerState = orbitLogoLayer instanceof HTMLElement
                ? runtime.getInvestmentDonutOrbitAnimationState(orbitLogoLayer)
                : null;
            if (orbitLayerState) {
                orbitLayerState.orbitMetrics = orbitMetrics;
            }
            orbitElement.querySelectorAll('.portfolio-donut-logo[data-style-token-donut-angle]').forEach((logoElement) => {
                if (!(logoElement instanceof HTMLImageElement)) return;
                if (logoElement.classList.contains('is-orbit-animated')) {
                    const layerState = runtime.getInvestmentDonutOrbitAnimationState(logoElement.parentElement);
                    const stateEntry = layerState?.logos?.get(logoElement.dataset.ticker || '');
                    if (stateEntry) {
                        runtime.renderInvestmentDonutOrbitLogoPosition(
                            logoElement,
                            stateEntry.currentAngle,
                            orbitMetrics,
                            stateEntry.currentRadiusScale,
                            stateEntry.currentOpacity
                        );
                        return;
                    }
                }
                const angle = Number.parseFloat(logoElement.dataset.styleTokenDonutAngle || '');
                if (!Number.isFinite(angle)) return;
                runtime.renderInvestmentDonutOrbitLogoPosition(logoElement, angle, orbitMetrics, 1, Number.parseFloat(logoElement.style.opacity || '1'));
            });
        });
    }

function refreshInvestmentDummyDonut() {
        refreshPortfolioDonutOrbits(runtime.investmentDummyChart);
    }

function initInvestmentDummyDonut() {
        if (!(runtime.investmentDummyChart instanceof HTMLElement)) return;
        refreshInvestmentDummyDonut();
        refreshPortfolioDonutOrbits(runtime.investmentStockDetailsPanel);
        if (window.ResizeObserver) {
            const donutResizeObserver = new ResizeObserver(() => {
                refreshInvestmentDummyDonut();
                refreshPortfolioDonutOrbits(runtime.investmentStockDetailsPanel);
            });
            donutResizeObserver.observe(runtime.investmentDummyChart);
            const orbit = runtime.investmentDummyChart.querySelector('.style-token-portfolio-donut-orbit');
            if (orbit instanceof HTMLElement) {
                donutResizeObserver.observe(orbit);
            }
            if (runtime.investmentStockDetailsPanel instanceof HTMLElement) {
                donutResizeObserver.observe(runtime.investmentStockDetailsPanel);
            }
        } else {
            window.addEventListener('resize', () => {
                refreshInvestmentDummyDonut();
                refreshPortfolioDonutOrbits(runtime.investmentStockDetailsPanel);
            }, {passive: true});
        }
    }

function countInvestmentPendingInternalTransferBindings(processedTransactions = runtime.state.investmentProcessedTransactionsCache) {
        const transactions = Array.isArray(processedTransactions) ? processedTransactions : [];
        return transactions.filter((txn) => (
            Boolean(txn?.manual_internal_transfer_needs_binding)
            && Number(txn?.manual_internal_transfer_candidate_count || 0) > 0
        )).length;
    }

function clearStaleTransferReviewFeedback(processedTransactions = runtime.state.investmentProcessedTransactionsCache) {
        const feedbackText = String(runtime.importFeedbackMessage?.textContent || '').trim();
        if (!feedbackText.includes('Transfer review')) return;
        if (countInvestmentPendingInternalTransferBindings(processedTransactions) === 0) {
            clearImportFeedback();
        }
    }

function setImportFeedback(message, variant = 'success', { allowHtml = false } = {}) {
        if (!runtime.importFeedback) return;
        const resolvedVariant = ['error', 'warning', 'success', 'loading'].includes(variant) ? variant : 'success';
        const isError = resolvedVariant === 'error';
        const isWarning = resolvedVariant === 'warning';
        const isLoading = resolvedVariant === 'loading';
        const resolvedMessage = String(message || '').trim()
            || (isError ? 'Import failed.' : (isWarning ? 'Investment data loaded with warnings.' : 'Import complete.'));
        if (isLoading) {
            runtime.importFeedback.hidden = true;
            if (runtime.importFeedbackMessage) runtime.importFeedbackMessage.textContent = '';
            showInvestmentImportProgressModal(resolvedMessage);
            return;
        }
        hideInvestmentLoadingModal({ resetContent: true });
        runtime.importFeedback.hidden = true;
        runtime.importFeedback.style.animation = 'none';
        void runtime.importFeedback.offsetWidth;
        runtime.importFeedback.style.animation = '';
        runtime.importFeedback.removeAttribute('hidden');
        if (runtime.importFeedbackMessage) {
            if (allowHtml) {
                runtime.importFeedbackMessage.innerHTML = resolvedMessage;
            } else {
                const feedbackTitle = isLoading
                    ? 'Import in progress'
                    : isError
                        ? 'Import issue'
                        : isWarning
                            ? 'Import warning'
                            : 'Investment update';
                runtime.importFeedbackMessage.innerHTML = `
                    <p class="notice-floating-banner-heading">${feedbackTitle}</p>
                    <p class="notice-floating-banner-copy">${runtime.escapeHtml(resolvedMessage)}</p>
                `.trim();
            }
        } else {
            runtime.importFeedback.textContent = message;
        }
        if (runtime.importFeedbackIcon) {
            runtime.importFeedbackIcon.classList.toggle('notice-floating-banner-icon-error', isError || isWarning);
            runtime.importFeedbackIcon.classList.toggle('notice-floating-banner-icon-success', !isError && !isWarning && !isLoading);
            runtime.importFeedbackIcon.classList.toggle('icon-modal-dialog-banner-default', isError || isWarning || isLoading);
            runtime.importFeedbackIcon.classList.toggle('suggestion-loading-spinner', isLoading);
        }
    }

function clearImportFeedback() {
        if (!runtime.importFeedback) return;
        runtime.importFeedback.setAttribute('hidden', '');
        if (runtime.importFeedbackMessage) {
            runtime.importFeedbackMessage.textContent = '';
        } else {
            runtime.importFeedback.textContent = '';
        }
        if (runtime.importFeedbackIcon) {
            runtime.importFeedbackIcon.classList.remove('notice-floating-banner-icon-error');
            runtime.importFeedbackIcon.classList.remove('notice-floating-banner-icon-success');
            runtime.importFeedbackIcon.classList.remove('suggestion-loading-spinner');
            runtime.importFeedbackIcon.classList.add('icon-modal-dialog-banner-default');
        }
    }

function showInvestmentWorkspaceModal({
        title = runtime.WORKSPACE_MODAL_DEFAULT_TITLE,
        copy = runtime.WORKSPACE_MODAL_DEFAULT_COPY,
        iconClass = runtime.WORKSPACE_MODAL_DEFAULT_ICON_CLASS.replace(/^icon\s+/, ''),
        lockClose = false,
        determinate = false,
        progress = 0,
    } = {}) {
        if (!runtime.workspaceModalOverlay) return;
        const owner = Symbol('investment-workspace-modal');
        runtime.state.investmentLoadingModalOwner = owner;
        if (runtime.workspaceModalOverlayTitle) {
            runtime.workspaceModalOverlayTitle.textContent = title;
        }
        if (runtime.workspaceModalOverlayCopy) {
            runtime.workspaceModalOverlayCopy.textContent = copy;
        }
        if (runtime.workspaceModalOverlayIcon) {
            const normalizedIconClass = String(iconClass || '').trim().replace(/^icon\s+/, '');
            runtime.workspaceModalOverlayIcon.className = normalizedIconClass
                ? `icon ${normalizedIconClass} workspace-modal-icon`
                : runtime.WORKSPACE_MODAL_DEFAULT_ICON_CLASS;
            window.WORTHWARD_LOADING_INDICATOR?.setProgress(runtime.workspaceModalOverlayIcon, {
                determinate,
                value: progress,
                label: title,
            });
        }
        if (runtime.workspaceModalOverlayClose) {
            runtime.workspaceModalOverlayClose.hidden = lockClose;
            runtime.workspaceModalOverlayClose.disabled = lockClose;
            runtime.workspaceModalOverlayClose.setAttribute('aria-hidden', lockClose ? 'true' : 'false');
        }
        runtime.workspaceModalOverlay.hidden = false;
        return owner;
    }

function showInvestmentLoadingModal({determinate = false} = {}) {
        return showInvestmentWorkspaceModal({
            title: runtime.INVESTMENT_LOADING_MODAL_TITLE,
            copy: runtime.INVESTMENT_LOADING_MODAL_COPY,
            iconClass: runtime.INVESTMENT_LOADING_MODAL_ICON_CLASS,
            lockClose: true,
            determinate,
            progress: 0,
        });
    }

function updateInvestmentLoadingProgress({completed, total, label, owner = null}) {
        if (!runtime.workspaceModalOverlay || runtime.workspaceModalOverlay.hidden) return;
        if (runtime.state.investmentPageDisposed) return;
        if (owner && runtime.state.investmentLoadingModalOwner !== owner) return;
        if (
            !Number.isInteger(completed) || !Number.isInteger(total)
            || total <= 0 || completed < 0 || completed > total
        ) return;
        const copy = `${completed} of ${total} loading steps complete. ${label}`;
        if (runtime.workspaceModalOverlayCopy) {
            runtime.workspaceModalOverlayCopy.textContent = copy;
        }
        window.WORTHWARD_LOADING_INDICATOR?.setProgress(runtime.workspaceModalOverlayIcon, {
            determinate: true,
            value: completed / total * 100,
            label: `${runtime.INVESTMENT_LOADING_MODAL_TITLE}. ${copy}`,
        });
        runtime.workspaceModalOverlayIcon?.setAttribute('aria-valuetext', copy);
    }

function showInvestmentImportProgressModal(copy = 'We are parsing and merging the imported broker activity. Please keep this tab open until the import finishes.') {
        showInvestmentWorkspaceModal({
            title: 'Import in progress',
            copy: String(copy || '').trim() || 'We are importing broker activity. Please keep this tab open until the import finishes.',
            iconClass: 'suggestion-loading-spinner',
            lockClose: true,
        });
    }

function showInvestmentTransferBindingModal() {
        showInvestmentWorkspaceModal({
            title: runtime.INVESTMENT_TRANSFER_BINDING_MODAL_TITLE,
            copy: runtime.INVESTMENT_TRANSFER_BINDING_MODAL_COPY,
            iconClass: 'suggestion-loading-spinner',
            lockClose: true,
        });
    }

function hideInvestmentLoadingModal({ resetContent = false, owner = null } = {}) {
        if (!runtime.workspaceModalOverlay) return;
        if (owner && runtime.state.investmentLoadingModalOwner !== owner) return;
        runtime.state.investmentLoadingModalOwner = null;
        runtime.workspaceModalOverlay.hidden = true;
        window.WORTHWARD_LOADING_INDICATOR?.setProgress(runtime.workspaceModalOverlayIcon, {
            determinate: false,
        });
        if (runtime.workspaceModalOverlayClose) {
            runtime.workspaceModalOverlayClose.hidden = false;
            runtime.workspaceModalOverlayClose.disabled = false;
            runtime.workspaceModalOverlayClose.setAttribute('aria-hidden', 'false');
        }
        if (!resetContent) return;
        if (runtime.workspaceModalOverlayTitle && runtime.WORKSPACE_MODAL_DEFAULT_TITLE) {
            runtime.workspaceModalOverlayTitle.textContent = runtime.WORKSPACE_MODAL_DEFAULT_TITLE;
        }
        if (runtime.workspaceModalOverlayCopy && runtime.WORKSPACE_MODAL_DEFAULT_COPY) {
            runtime.workspaceModalOverlayCopy.textContent = runtime.WORKSPACE_MODAL_DEFAULT_COPY;
        }
        if (runtime.workspaceModalOverlayIcon && runtime.WORKSPACE_MODAL_DEFAULT_ICON_CLASS) {
            runtime.workspaceModalOverlayIcon.className = runtime.WORKSPACE_MODAL_DEFAULT_ICON_CLASS;
        }
    }

function isLikelyCsvFile(file) {
        return Boolean(file && /\.csv$/i.test(file.name || ''));
    }

function isLikelyTransactionHistoryFile(file) {
        if (!isLikelyCsvFile(file)) return false;
        const upperName = String(file.name || '').toUpperCase();
        return upperName.includes('TRANSACTIONS');
    }

function isLikelyPositionsFile(file) {
        if (!isLikelyCsvFile(file)) return false;
        const upperName = String(file.name || '').toUpperCase();
        return !upperName.includes('TRANSACTIONS');
    }

function isLikelyGainskeeperFile(file) {
        if (!(file instanceof File)) return false;
        const lowerName = String(file.name || '').trim().toLowerCase();
        return lowerName.endsWith('.gkx') || lowerName.endsWith('.ofx');
    }

function isLikelyPdfFile(file) {
        if (!(file instanceof File)) return false;
        const lowerName = String(file.name || '').trim().toLowerCase();
        const mimeType = String(file.type || '').trim().toLowerCase();
        return lowerName.endsWith('.pdf') || mimeType === 'application/pdf';
    }

function isLikelyBocHkStatementPdf(file) {
        if (!(file instanceof File)) return false;
        const lowerName = String(file.name || '').trim().toLowerCase();
        return lowerName.endsWith('.pdf') && file.size > 0;
    }

function isLikelyFutuStatementPdf(file) {
        if (!isLikelyPdfFile(file)) return false;
        const fileName = String(file.name || '').trim();
        if (!fileName) return false;
        if (/\d{10,}-\d+-\d{6}-/.test(fileName)) return true;
        if (/statement|月結單|结单/i.test(fileName)) return true;
        return file.size > 1024;
    }

function isLikelyLongbridgeSgFundDetailsFile(file) {
        if (!(file instanceof File)) return false;
        const lowerName = String(file.name || '').trim().toLowerCase();
        const mimeType = String(file.type || '').trim().toLowerCase();
        return lowerName.endsWith('.txt') || mimeType === 'text/plain';
    }

function isLikelyLongbridgeSgHistoryOrdersFile(file) {
        if (!(file instanceof File)) return false;
        const lowerName = String(file.name || '').trim().toLowerCase();
        const mimeType = String(file.type || '').trim().toLowerCase();
        return (
            lowerName.endsWith('.xlsx')
            || mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        );
    }

function getImportFileSignature(file) {
        if (!(file instanceof File)) return '';
        return [
            String(file.name || '').trim(),
            String(file.size || 0),
            String(file.lastModified || 0),
        ].join(':');
    }

function isLikelyXlsxFile(file) {
        if (!(file instanceof File)) return false;
        const lowerName = String(file.name || '').trim().toLowerCase();
        const mimeType = String(file.type || '').trim().toLowerCase();
        return (
            lowerName.endsWith('.xlsx')
            || mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        );
    }

async function validateZirconHkWorkbook() {
        const file = runtime.zirconHkTransactionsXlsxInput?.files?.[0];
        runtime.state.zirconHkWorkbookValidationAbortController?.abort();
        runtime.state.zirconHkWorkbookValidationAbortController = null;
        runtime.state.zirconHkWorkbookValidation = {
            signature: getImportFileSignature(file),
            valid: false,
            transactionCount: 0,
        };
        setImportStatusIcon(runtime.zirconHkTransactionsXlsxStatus, false);
        runtime.syncImportValidationState();
        if (!file) return;
        if (!isLikelyXlsxFile(file)) {
            setImportFeedback('Please upload the completed manual investment workbook as an .xlsx file.', 'error');
            return;
        }

        const signature = getImportFileSignature(file);
        const abortController = new AbortController();
        runtime.state.zirconHkWorkbookValidationAbortController = abortController;
        const formData = new FormData();
        formData.append('zircon_hk_transactions_xlsx', file);
        setImportFeedback('Validating the manual investment workbook…', 'loading');
        try {
            if (!(await runtime.ensureInvestmentImportSession())) {
                throw new Error(runtime.describeInvestmentImportSessionFailure());
            }
            const response = await fetch(
                '/api/investment/imports/zircon-hk/validate',
                runtime.buildInvestmentRequestOptions({
                    method: 'POST',
                    body: formData,
                    signal: abortController.signal,
                }),
            );
            const result = await response.json();
            if (signature !== getImportFileSignature(
                runtime.zirconHkTransactionsXlsxInput?.files?.[0]
            )) {
                return;
            }
            if (!response.ok || !result.success) {
                runtime.state.zirconHkWorkbookValidation = {
                    signature,
                    valid: false,
                    transactionCount: 0,
                };
                setImportFeedback(
                    result.error || 'The manual investment workbook did not pass validation.',
                    'error',
                );
                return;
            }
            const transactionCount = Number(result.transaction_count || 0);
            runtime.state.zirconHkWorkbookValidation = {
                signature,
                valid: transactionCount > 0,
                transactionCount,
            };
            setImportStatusIcon(
                runtime.zirconHkTransactionsXlsxStatus,
                transactionCount > 0,
                result.message || 'Workbook validated.',
            );
            setImportFeedback(result.message || 'Manual investment workbook validated.', 'success');
        } catch (error) {
            if (error?.name === 'AbortError') return;
            runtime.state.zirconHkWorkbookValidation = {
                signature,
                valid: false,
                transactionCount: 0,
            };
            setImportFeedback(`Unable to validate the manual investment workbook: ${error.message}`, 'error');
        } finally {
            if (runtime.state.zirconHkWorkbookValidationAbortController === abortController) {
                runtime.state.zirconHkWorkbookValidationAbortController = null;
            }
            runtime.syncImportValidationState();
        }
    }

function getSelectedFutuStatementPdfFiles() {
        if (!(runtime.futuhkStatementPdfsInput instanceof HTMLInputElement)) return [];
        return Array.from(runtime.futuhkStatementPdfsInput.files || []).filter((file) => file instanceof File);
    }

function getSelectedStatementPdfFiles(input) {
        if (!(input instanceof HTMLInputElement)) return [];
        return Array.from(input.files || []).filter((file) => file instanceof File);
    }

function setImportStatusIcon(icon, visible, title = '') {
        if (!icon) return;
        icon.classList.toggle('is-visible', Boolean(visible));
        if (visible && title) {
            icon.setAttribute('title', title);
        } else {
            icon.removeAttribute('title');
        }
    }

function setInvestmentExportButtonVisibility(isVisible) {
        runtime.state.investmentHasExportableTransactions = Boolean(isVisible);
        const shouldShowShareActions = runtime.state.investmentHasExportableTransactions && runtime.state.investmentChartReady;
        if (runtime.investmentShareActions) {
            runtime.investmentShareActions.hidden = !shouldShowShareActions;
            if (shouldShowShareActions) {
                runtime.syncInvestmentShareActionsPosition();
            }
        }
        if (!runtime.exportTransactionsButton) return;
        runtime.exportTransactionsButton.hidden = !shouldShowShareActions;
    }

function setInvestmentChartReady(isReady, canvas = null) {
        runtime.state.investmentChartReady = Boolean(isReady);
        if (canvas instanceof HTMLCanvasElement) {
            canvas.dataset.investmentChartReady = runtime.state.investmentChartReady ? '1' : '0';
        }
        setInvestmentExportButtonVisibility(runtime.state.investmentHasExportableTransactions);
    }

function normalizeInvestmentTicker(ticker) {
        return String(ticker || '').trim().toUpperCase();
    }

function isLongbridgeHkCashEquivalentSyntheticTicker(ticker) {
        return normalizeInvestmentTicker(ticker).startsWith(`${runtime.LONGBRIDGE_HK_CASH_EQUIVALENT_SYNTHETIC_PREFIX}.`);
    }

function isFranklinMoneyMarketTicker(ticker) {
        return normalizeInvestmentTicker(ticker) === '005276756';
    }

function isDollarTokenMoneyMarketTicker(ticker) {
        return (
            isMoneyMarketFundTicker(ticker)
            && runtime.getTickerQuoteCurrency(ticker) === 'USD'
        );
    }

function isMoneyMarketFundTicker(ticker) {
        const normalizedTicker = normalizeInvestmentTicker(ticker);
        if (!normalizedTicker) return false;
        if (isLongbridgeHkCashEquivalentSyntheticTicker(normalizedTicker)) {
            return true;
        }
        return runtime.getMoneyMarketTickerSet().has(normalizedTicker);
    }

    return {
        bindInvestmentEquityRangeControls,
        lockInvestmentSurfaceHeight,
        getInvestmentSurfaceMaxHeight,
        getInvestmentSurfaceCappedHeight,
        cleanupInvestmentSurfaceHeight,
        animateInvestmentSurfaceHeight,
        getInvestmentLocationTicker,
        getInvestmentUrlStateForCurrentView,
        getInvestmentCurrentUrl,
        syncInvestmentUrl,
        buildInvestmentViewUrl,
        buildInvestmentStockDetailsHref,
        syncInvestmentViewHash,
        syncInvestmentStockDetailsTableVisibility,
        scheduleInvestmentStockDetailsVisibleLayoutSync,
        waitForInvestmentStableElementBox,
        setInvestmentView,
        initInvestmentViewTabs,
        interpolateHexColor,
        buildInvestmentDummyPalette,
        ensureAnimatedDonutLayers,
        applyAnimatedDonutFill,
        syncAnimatedDonutLogos,
        normalizeInvestmentLogoUrlList,
        resolveInvestmentLogoUrl,
        resolveInvestmentLogoUrls,
        setInvestmentTickerLogoVisibility,
        syncInvestmentTickerLogoAsset,
        getActiveInvestmentInteractionPoint,
        renderInvestmentDummyPortfolioDonut,
        scheduleInvestmentDummyDonutSync,
        scheduleInvestmentStockDetailsDonutSync,
        syncInvestmentDummyDonutFromInteraction,
        buildStockDetailsDonutSegments,
        buildStockDetailsDonutState,
        normalizeStockDetailsDonutState,
        buildStockDetailsDonutFill,
        getStockDetailsLogoAngle,
        applyStockDetailsDonutState,
        animateStockDetailsDonutTo,
        renderInvestmentStockDetailsDonut,
        syncInvestmentStockDetailsDonutFromInteraction,
        refreshPortfolioDonutOrbits,
        refreshInvestmentDummyDonut,
        initInvestmentDummyDonut,
        countInvestmentPendingInternalTransferBindings,
        clearStaleTransferReviewFeedback,
        setImportFeedback,
        clearImportFeedback,
        showInvestmentWorkspaceModal,
        showInvestmentLoadingModal,
        updateInvestmentLoadingProgress,
        showInvestmentImportProgressModal,
        showInvestmentTransferBindingModal,
        hideInvestmentLoadingModal,
        isLikelyCsvFile,
        isLikelyTransactionHistoryFile,
        isLikelyPositionsFile,
        isLikelyGainskeeperFile,
        isLikelyPdfFile,
        isLikelyBocHkStatementPdf,
        isLikelyFutuStatementPdf,
        isLikelyLongbridgeSgFundDetailsFile,
        isLikelyLongbridgeSgHistoryOrdersFile,
        getImportFileSignature,
        isLikelyXlsxFile,
        validateZirconHkWorkbook,
        getSelectedFutuStatementPdfFiles,
        getSelectedStatementPdfFiles,
        setImportStatusIcon,
        setInvestmentExportButtonVisibility,
        setInvestmentChartReady,
        normalizeInvestmentTicker,
        isLongbridgeHkCashEquivalentSyntheticTicker,
        isFranklinMoneyMarketTicker,
        isDollarTokenMoneyMarketTicker,
        isMoneyMarketFundTicker,
    };
}
