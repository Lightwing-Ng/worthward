/* Code version: v0.3.8-p6 */
(() => {
    const state = window.ANTIGRAVITY_APP;
    if (!state) return;
    const bootstrap = window.ANTIGRAVITY_BOOTSTRAP = window.ANTIGRAVITY_BOOTSTRAP || {};

    const {defaults, labels, endpoints, constraints, theme} = state;
    const MONTH_ABBREVIATIONS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const MONTH_LABELS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const MONTH_TOKEN_TO_INDEX = MONTH_ABBREVIATIONS.reduce((accumulator, label, index) => {
        accumulator[label.toLowerCase()] = index;
        accumulator[MONTH_LABELS[index].toLowerCase()] = index;
        return accumulator;
    }, {});
    const THEME_MODE_STORAGE_KEY = "antigravity:theme-mode";
    const isPortfolioView = state.currentView === "portfolio";
    const isBacktestView = state.currentView === "backtest";
    const MIN_TICKERS = constraints?.minTickers || 2;
    const MAX_TICKERS = constraints?.maxTickers || 5;
    const minimumRequiredTickers = isBacktestView ? 1 : MIN_TICKERS;
    const tickerPattern = /^[A-Z0-9][A-Z0-9.-]{0,14}$/;
    const sanitizeTicker = (value) => value.toUpperCase().replace(/[^A-Z0-9.-]/g, "").slice(0, 15);
    const $ = (selector) => document.querySelector(selector);
    const $$ = (selector) => Array.from(document.querySelectorAll(selector));
    const UNKNOWN_MESSAGE = "Unknown or unsupported ticker.";
    const VIEW_MEMORY_KEY = "antigravity:view-memory";
    const TRANSIENT_VIEW_QUERY_KEYS = new Set(["notice", "error", "broker_test_status", "broker_test_message", "broker_test_checked_at"]);
    const SIDEBAR_MEMORY_KEY = "antigravity:sidebar-open";
    const TRADE_DETAIL_MEMORY_KEY = "antigravity:trade-detail-tab";
    const STRATEGY_MEMORY_KEY = "antigravity:recent-strategies";
    let hasInitialResult = isBacktestView
        ? Boolean(state.backtestResult)
        : Boolean(state.chart?.series?.length);
    let autoSubmitTimer = null;
    let dockFrame = 0;
    let mobilePagePaddingFrame = 0;
    let mobilePagePaddingShouldPreserveBottom = false;
    let mobilePagePaddingObserver = null;
    let mobilePagePaddingScrollBound = false;
    let mobilePagePaddingScrollTarget = null;
    let isSubmittingWithOverlay = false;
    let compareOverlayTimer = null;
    let activeWorkspaceHydration = null;
    let activeWorkspaceSummaryMorphCleanup = null;
    let scheduleWorkspaceSummaryMorphSync = null;
    let workspaceHydrationToken = 0;
    let pendingWorkspaceChartTransition = null;
    const datePickerState = [];
    let validTradingDateSet = null;
    const portfolioWeightState = {
        clock: 0,
        touchedAtByIndex: {},
    };
    const tickerValidationCache = new Map();
    const workspaceModalOverlay = $("#workspace_modal_overlay");
    const workspaceModalOverlayClose = $("#workspace_modal_overlay_close");
    const workspaceModalOverlayTitle = workspaceModalOverlay?.querySelector(".workspace-modal-title");
    const workspaceModalOverlayCopy = workspaceModalOverlay?.querySelector(".workspace-modal-copy");
    const workspaceModalOverlayIcon = $("#workspace_modal_overlay_icon");
    const canTransitionDom = typeof document.startViewTransition === "function";
    const dockPrefetchCache = new Map();
    const progressiveResourceCache = new Map();
    const progressiveViewRegistry = {
        tickers: {
            masks: [
                '[data-workspace-mask="compare-return"]',
                '[data-workspace-mask="chart-area"]',
            ],
        },
        portfolio: {
            masks: [
                '[data-workspace-mask="portfolio-total-return"]',
                '[data-workspace-mask="portfolio-donut-start"]',
                '[data-workspace-mask="portfolio-donut-end"]',
                '[data-workspace-mask="chart-area"]',
            ],
        },
        "backtest": {
            masks: [
                '[data-workspace-mask="trade-metric"]',
                '[data-workspace-mask="trade-price-chart"]',
                '[data-workspace-mask="trade-equity-chart"]',
            ],
        },
        settings: {
            about: {masks: []},
            strategies: {masks: []},
            "email-smtp": {masks: []},
            network: {
                masks: [
                    '[data-workspace-mask="settings-status-icon"]',
                    '[data-workspace-mask="settings-status-text"]',
                ],
                hydrate: () => bootstrap.hydrateSettingsNetworkStatuses?.(),
            },
            "local-market-store": {
                masks: [
                    '[data-workspace-mask="local-store-date"]',
                ],
                hydrate: () => bootstrap.hydrateSettingsLocalStoreRanges?.(),
            },
        },
    };

    const getProgressiveManifest = (view, section = null) => {
        if (view === "settings") {
            return progressiveViewRegistry.settings[section || "about"] || {masks: []};
        }
        return progressiveViewRegistry[view] || {masks: []};
    };

    const getProgressiveMaskSelectors = (view, section = null) => getProgressiveManifest(view, section).masks || [];

    const fetchJsonCached = async (cacheKey, url, {ttlMs = 30000} = {}) => {
        const cached = progressiveResourceCache.get(cacheKey);
        const now = Date.now();
        if (cached && (now - cached.cachedAt) < ttlMs) return cached.value;
        const response = await fetch(url, {credentials: "same-origin"});
        if (!response.ok) throw new Error(`JSON fetch failed: ${response.status}`);
        const value = await response.json();
        progressiveResourceCache.set(cacheKey, {cachedAt: now, value});
        return value;
    };

    const requestWorkspaceChartTransition = (reason) => {
        pendingWorkspaceChartTransition = {
            view: state.currentView,
            reason,
            requestedAt: performance.now(),
        };
    };

    const clearWorkspaceChartTransitionRequest = () => {
        pendingWorkspaceChartTransition = null;
    };

    const captureLineChartRefreshTransition = () => {
        if (!Array.isArray(state.chart?.series) || !state.chart.series.length) {
            delete bootstrap.chartWorkspaceRefreshTransition;
            return;
        }
        bootstrap.chartWorkspaceRefreshTransition = {
            view: state.currentView,
            capturedAt: performance.now(),
            labels: [...(state.chart.series[0]?.dates || [])],
            series: state.chart.series.map((item) => ({
                ticker: item.ticker,
                dates: [...(item.dates || [])],
                values: [...(item.normalized_returns || [])],
            })),
        };
    };

    const captureBacktestRefreshTransition = () => {
        if (!isBacktestView || !state.backtestResult?.chart) return;
        const chartState = state.backtestResult.chart;
        if (!Array.isArray(chartState.dates) || !chartState.dates.length) {
            delete bootstrap.backtestRefreshTransition;
            return;
        }
        const initialCapital = Number(state.backtestResult.summary?.initial_capital || 0);
        const closeSeries = Array.isArray(chartState.close) ? [...chartState.close] : [];
        const openingPrice = Number(closeSeries[0] || 0);
        const allInShares = openingPrice > 0 ? Math.floor(initialCapital / openingPrice) : 0;
        const allInCash = initialCapital - (allInShares * openingPrice);
        bootstrap.backtestRefreshTransition = {
            capturedAt: performance.now(),
            rawLabels: Array.isArray(chartState.raw_dates) && chartState.raw_dates.length
                ? [...chartState.raw_dates]
                : [...chartState.dates],
            close: closeSeries,
            equity: Array.isArray(chartState.equity) ? [...chartState.equity] : [],
            allIn: closeSeries.map((value) => Number((allInCash + (allInShares * Number(value || 0))).toFixed(4))),
            initialCapital,
        };
    };

    const didPortfolioRequestChangeXAxis = (currentParams, nextParams) => {
        const xAxisKeys = ["period", "range", "from", "exact_start", "to", "exact_end"];
        for (const key of xAxisKeys) {
            const current = (currentParams.get(key) || "").toString().trim();
            const next = (nextParams.get(key) || "").toString().trim();
            if (current !== next) return true;
        }
        return false;
    };

    const appShell = $(".app-shell");
    const sidebarToggle = $("#sidebar_toggle");
    const appSidebar = $("#app_sidebar");
    const sidebarBackdrop = $("#sidebar_backdrop");
    const mobileSidebarMedia = window.matchMedia("(max-width: 767px)");
    let isSidebarOpen = true;
    let isSidebarAnimating = false;

    const readSidebarMemory = () => {
        try {
            const storedValue = window.sessionStorage.getItem(SIDEBAR_MEMORY_KEY);
            if (storedValue === "true") return true;
            if (storedValue === "false") return false;
        } catch (_error) {
        }
        return true;
    };

    const writeSidebarMemory = (value) => {
        try {
            window.sessionStorage.setItem(SIDEBAR_MEMORY_KEY, String(Boolean(value)));
        } catch (_error) {
        }
    };

    const applySidebarState = (nextIsOpen, shell = appShell, sidebar = appSidebar, toggle = sidebarToggle, backdrop = sidebarBackdrop) => {
        if (!(shell && sidebar && toggle)) return;
        isSidebarOpen = Boolean(nextIsOpen);
        document.documentElement.classList.toggle("sidebar-memory-collapsed", !isSidebarOpen);
        toggle.setAttribute("aria-hidden", "false");
        toggle.setAttribute("aria-expanded", String(isSidebarOpen));
        shell.classList.toggle("is-sidebar-open", isSidebarOpen);
        shell.classList.toggle("is-sidebar-collapsed", !isSidebarOpen);
        sidebar.hidden = false;
        sidebar.style.display = "";
        sidebar.setAttribute("aria-hidden", String(!isSidebarOpen));
        if ("inert" in sidebar) sidebar.inert = !isSidebarOpen;
        if (backdrop) {
            const shouldShowBackdrop = mobileSidebarMedia.matches && isSidebarOpen;
            backdrop.hidden = !shouldShowBackdrop;
            backdrop.setAttribute("aria-hidden", String(!shouldShowBackdrop));
            if ("inert" in backdrop) backdrop.inert = !shouldShowBackdrop;
            backdrop.tabIndex = shouldShowBackdrop ? 0 : -1;
        }
        scheduleWorkspaceSummaryMorphSync?.();
    };

    const animateDock = () => {
        scheduleDockPosition();
        if (isSidebarAnimating) {
            requestAnimationFrame(animateDock);
        }
    };

    if (sidebarToggle && appSidebar && appShell) {
        applySidebarState(readSidebarMemory());
        sidebarToggle.addEventListener("click", () => {
            applySidebarState(!isSidebarOpen);
            writeSidebarMemory(isSidebarOpen);
            isSidebarAnimating = true;
            animateDock();
            setTimeout(() => {
                isSidebarAnimating = false;
                scheduleDockPosition();
            }, 650);
        });
    }

    if (sidebarBackdrop) {
        sidebarBackdrop.addEventListener("click", () => {
            if (!mobileSidebarMedia.matches || !isSidebarOpen) return;
            applySidebarState(false);
            writeSidebarMemory(false);
            isSidebarAnimating = true;
            animateDock();
            setTimeout(() => {
                isSidebarAnimating = false;
                scheduleDockPosition();
            }, 650);
        });
    }

    if (typeof mobileSidebarMedia.addEventListener === "function") {
        mobileSidebarMedia.addEventListener("change", () => {
            applySidebarState(isSidebarOpen);
            scheduleMobilePageBottomPaddingSync();
        });
    } else if (typeof mobileSidebarMedia.addListener === "function") {
        mobileSidebarMedia.addListener(() => {
            applySidebarState(isSidebarOpen);
            scheduleMobilePageBottomPaddingSync();
        });
    }

    const getTickerFields = () => $$(".ticker-field");
    const getTickerInputs = () => getTickerFields().map((field) => field.querySelector("[data-ticker-input]")).filter(Boolean);
    const getFilledTickers = () => getTickerInputs().map((input) => sanitizeTicker(input.value.trim())).filter(Boolean);
    const getWeightFields = () => getTickerFields().map((field, index) => ({
        index,
        field,
        number: field.querySelector('.portfolio-weight-input'),
        slider: field.querySelector('.portfolio-weight-slider'),
        tickerInput: field.querySelector("[data-ticker-input]"),
        tooltip: field.querySelector('.portfolio-weight-tooltip'),
    })).filter((item) => item.number && item.slider && item.tickerInput);

    const attachNoticeHandlers = () => {
        $$("[data-dismissible-notice]").forEach((noticeElement) => {
            const closeButton = noticeElement.querySelector(".notice-close");
            if (!closeButton || closeButton.dataset.bound === "1") return;
            closeButton.dataset.bound = "1";
            closeButton.addEventListener("click", () => {
                noticeElement.hidden = true;
            });
        });
    };

    const areBacktestChartsReady = () => {
        const priceCanvas = document.getElementById("tradePriceChart");
        const equityCanvas = document.getElementById("tradeEquityChart");
        return Boolean(
            priceCanvas?.dataset.tradeChartReady === "1"
            && equityCanvas?.dataset.tradeChartReady === "1"
        );
    };

    const syncBacktestExportButtonVisibility = () => {
        if (state.currentView !== "backtest") return;
        const exportButton = document.getElementById("export_transactions_button");
        if (!exportButton) return;
        exportButton.hidden = !areBacktestChartsReady();
    };

    const attachTradeDetailTabs = () => {
        const shell = $("[data-trade-detail-shell]");
        if (!shell) return;
        const panels = $$("[data-trade-detail-panel]");
        try {
            const storedValue = window.sessionStorage.getItem(TRADE_DETAIL_MEMORY_KEY);
            const storedInput = storedValue ? shell.querySelector(`input[name="trade_detail_tab"][value="${storedValue}"]`) : null;
            if (storedInput) storedInput.checked = true;
        } catch (_error) {
        }
        const syncPanels = () => {
            const active = shell.querySelector('input[name="trade_detail_tab"]:checked')?.value || "metrics";
            shell.dataset.active = active;
            try {
                window.sessionStorage.setItem(TRADE_DETAIL_MEMORY_KEY, active);
            } catch (_error) {
            }
            panels.forEach((panel) => {
                panel.hidden = panel.dataset.tradeDetailPanel !== active;
            });
            syncBacktestExportButtonVisibility();
        };
        shell.querySelectorAll('input[name="trade_detail_tab"]').forEach((input) => {
            if (input.dataset.bound === "1") return;
            input.dataset.bound = "1";
            input.addEventListener("change", syncPanels);
        });
        syncPanels();
    };

    const setFormBusyState = (isBusy) => {
        if (!form) return;
        form.setAttribute("aria-busy", String(isBusy));
    };

    const fetchMissingLocalMarketTickers = async (tickers) => {
        if (!Array.isArray(tickers) || !tickers.length || !endpoints.marketStorePresence) return [];
        const params = new URLSearchParams();
        tickers.forEach((ticker) => {
            if (ticker) params.append("ticker", ticker);
        });
        const response = await fetch(`${endpoints.marketStorePresence}?${params.toString()}`, {
            credentials: "same-origin",
        });
        if (!response.ok) throw new Error(`Market store presence fetch failed: ${response.status}`);
        const payload = await response.json();
        return Array.isArray(payload?.missingHistory) ? payload.missingHistory : [];
    };

    const attachExportButtonHandler = () => {
        if (state.currentView !== "backtest") return;
        const button = document.getElementById("export_transactions_button");
        if (!button || button.dataset.bound === "1") return;
        button.dataset.bound = "1";
        if (button.dataset.tradeChartReadyBound !== "1") {
            button.dataset.tradeChartReadyBound = "1";
            window.addEventListener("antigravity:backtest-charts-ready", syncBacktestExportButtonVisibility);
        }
        button.addEventListener("click", () => {
            const exportUrl = "/api/export-transactions" + window.location.search;
            window.location.assign(exportUrl);
        });
        syncBacktestExportButtonVisibility();
    };

    const attachWorkspaceSummaryMorph = () => {
        if (typeof activeWorkspaceSummaryMorphCleanup === "function") {
            activeWorkspaceSummaryMorphCleanup();
            activeWorkspaceSummaryMorphCleanup = null;
        }
        const summaryShells = Array.from(document.querySelectorAll(".workspace-mobile-summary-shell[data-mobile-summary-fixed]"));
        const sidebar = document.getElementById("app_sidebar");
        if (!summaryShells.length || !(sidebar instanceof HTMLElement)) return;
        const mobileMedia = window.matchMedia("(max-width: 767px)");
        let frameId = 0;
        let resizeObserver = null;
        const summaryCards = summaryShells
            .map((shell) => shell.querySelector(":scope > .workspace-summary-card"))
            .filter((card) => card instanceof HTMLElement);
        if (!summaryCards.length) return;

        const clearMorph = () => {
            summaryCards.forEach((card) => {
                card.style.removeProperty("--workspace-summary-morph-translate-x");
                card.style.removeProperty("--workspace-summary-morph-translate-y");
                card.style.removeProperty("--workspace-summary-morph-scale-x");
                card.style.removeProperty("--workspace-summary-morph-scale-y");
            });
        };

        const syncMorph = () => {
            frameId = 0;
            if (!mobileMedia.matches) {
                clearMorph();
                return;
            }
            const sidebarRect = sidebar.getBoundingClientRect();
            const sidebarStyles = window.getComputedStyle(sidebar);
            const targetLeft = Number.parseFloat(sidebarStyles.left || "") || sidebarRect.left;
            const targetTop = Number.parseFloat(sidebarStyles.top || "") || sidebarRect.top;
            const targetBottom = Number.parseFloat(sidebarStyles.bottom || "") || 0;
            const targetWidth = sidebarRect.width > 0 ? sidebarRect.width : Math.max(1, window.innerWidth - (targetLeft * 2));
            const targetHeight = Math.max(1, window.innerHeight - targetTop - targetBottom);
            summaryCards.forEach((card) => {
                const summaryRect = card.getBoundingClientRect();
                if (!(summaryRect.width > 0) || !(summaryRect.height > 0)) {
                    card.style.removeProperty("--workspace-summary-morph-translate-x");
                    card.style.removeProperty("--workspace-summary-morph-translate-y");
                    card.style.removeProperty("--workspace-summary-morph-scale-x");
                    card.style.removeProperty("--workspace-summary-morph-scale-y");
                    return;
                }
                card.style.setProperty("--workspace-summary-morph-translate-x", `${targetLeft - summaryRect.left}px`);
                card.style.setProperty("--workspace-summary-morph-translate-y", `${targetTop - summaryRect.top}px`);
                card.style.setProperty("--workspace-summary-morph-scale-x", `${targetWidth / summaryRect.width}`);
                card.style.setProperty("--workspace-summary-morph-scale-y", `${targetHeight / summaryRect.height}`);
            });
        };

        const scheduleMorphSync = () => {
            if (frameId) return;
            frameId = window.requestAnimationFrame(syncMorph);
        };
        scheduleWorkspaceSummaryMorphSync = scheduleMorphSync;

        scheduleMorphSync();
        window.addEventListener("resize", scheduleMorphSync);
        if (window.visualViewport) window.visualViewport.addEventListener("resize", scheduleMorphSync);
        if (typeof mobileMedia.addEventListener === "function") {
            mobileMedia.addEventListener("change", scheduleMorphSync);
        } else if (typeof mobileMedia.addListener === "function") {
            mobileMedia.addListener(scheduleMorphSync);
        }
        if (typeof ResizeObserver === "function") {
            resizeObserver = new ResizeObserver(scheduleMorphSync);
            summaryCards.forEach((card) => resizeObserver.observe(card));
            resizeObserver.observe(sidebar);
        }

        activeWorkspaceSummaryMorphCleanup = () => {
            if (frameId) window.cancelAnimationFrame(frameId);
            window.removeEventListener("resize", scheduleMorphSync);
            if (window.visualViewport) window.visualViewport.removeEventListener("resize", scheduleMorphSync);
            if (typeof mobileMedia.removeEventListener === "function") {
                mobileMedia.removeEventListener("change", scheduleMorphSync);
            } else if (typeof mobileMedia.removeListener === "function") {
                mobileMedia.removeListener(scheduleMorphSync);
            }
            resizeObserver?.disconnect();
            clearMorph();
            scheduleWorkspaceSummaryMorphSync = null;
        };
    };

    const initializeWorkspaceEnhancements = () => {
        initMobilePageBottomPadding();
        attachNoticeHandlers();
        attachTradeDetailTabs();
        attachExportButtonHandler();
        attachWorkspaceSummaryMorph();
        bootstrap.initSettingsWorkspace?.({
            state,
            endpoints,
            labels,
            canTransitionDom,
            rememberCurrentViewUrl,
            getProgressiveManifest,
            fetchJsonCached,
            progressiveResourceCache,
        });
        window.requestAnimationFrame(() => {
            window.ANTIGRAVITY_BOOTSTRAP?.initChartWorkspace?.();
            window.ANTIGRAVITY_BOOTSTRAP?.initPortfolioWorkspace?.();
            window.ANTIGRAVITY_BOOTSTRAP?.initBacktestWorkspace?.();
            window.ANTIGRAVITY_BOOTSTRAP?.initMoreWorkspace?.();
            if (state.currentView === "portfolio") {
                dispatchPortfolioPreviewUpdate();
            }
        });
    };

    const buildPendingWorkspaceMarkup = () => {
        const currentValues = getFilledTickers();
        const reportHeading = $(".workspace .report-heading")?.textContent?.trim() || labels.backtest_metrics || "Loading";
        const chartHeading = $(".workspace .chart-heading")?.textContent?.trim() || "Loading";
        if (state.currentView === "backtest") {
            const tradeMetricLabels = [
                "Initial capital",
                "Final equity",
                "Net return",
                "Total trades",
                "Win rate",
                "Alpha vs B&H",
                "Realized long P&L",
                "Realized short P&L",
                "Realized long loss",
                "Max drawdown",
            ];
            return `
				<section class="workspace-header workspace-mobile-summary-shell" data-mobile-summary-fixed>
					
        			<article class="report-card workspace-article-card workspace-summary-card">
						<div class="report-heading-row"><p class="report-heading">${reportHeading}</p></div>
					</article>
					
					
					<article class="report-card workspace-content-card trade-performance-card backtest-trade-performance-card">
							<div class="trade-detail-tabs">
								<div class="trade-detail-toolbar">
									<div class="range-mode-shell segmented-control--compact trade-detail-shell" data-active="metrics">
										<span class="segmented-control-option"><span>${labels.backtest_metrics_tab}</span></span>
										<span class="segmented-control-option"><span>${labels.backtest_transactions_tab}</span></span>
									</div>
								</div>
								<div class="trade-detail-panel">
									<div class="trade-metrics-grid trade-view-panel-grid trade-metrics-panel-grid" id="backtest_metrics_panel">
										${tradeMetricLabels.map((label) => `<div class="trade-metric-card"><span class="trade-metric-label">${label}</span><span class="trade-metric-value is-pending-value" data-workspace-mask="trade-metric">0000</span></div>`).join("")}
									</div>
								</div>
								<div class="trade-detail-panel" hidden>
									<div class="trade-transactions-wrap">
										<table class="settings-table trade-transactions-table">
											<thead>
												<tr><th>No.</th><th>Date</th><th>Side</th><th class="trade-transactions-number">Price</th><th class="trade-transactions-number">Shares</th><th class="trade-transactions-number">P&amp;L</th><th class="trade-transactions-number">Equity</th></tr>
											</thead>
											<tbody>
												${Array.from({length: 4}, (_, index) => `<tr><td class="trade-transactions-index">${index + 1}</td><td class="is-pending-value">0000</td><td class="is-pending-value">0000</td><td class="trade-transactions-number is-pending-value">0000</td><td class="trade-transactions-number is-pending-value">0000</td><td class="trade-transactions-number is-pending-value">0000</td><td class="trade-transactions-number is-pending-value">0000</td></tr>`).join("")}
											</tbody>
										</table>
									</div>
								</div>
							</div>
						</article>
					<article class="chart-surface backtest-surface">
							<div class="chart-heading-row"><p class="chart-heading">${chartHeading}</p></div>
							<div class="trade-chart-stack">
								<div class="trade-chart-panel is-pending-value" data-workspace-mask="trade-chart"></div>
								<div class="trade-chart-panel trade-chart-panel-equity is-pending-value" data-workspace-mask="trade-chart"></div>
							</div>
					</article>
				</section>
			`;
        }
        if (state.currentView === "portfolio") {
            return `
				<section class="workspace-header workspace-mobile-summary-shell" data-mobile-summary-fixed>
					<article class="report-card workspace-article-card workspace-summary-card">
						<div class="report-heading-row"><p class="report-heading">${reportHeading}</p></div>
					</article>
					<article class="report-card workspace-content-card portfolio-summary-content-card">
							<div class="portfolio-summary">
								<div class="portfolio-donut-block">
									<div class="portfolio-donut-orbit is-pending-value" data-workspace-mask="portfolio-donut-start"><div class="portfolio-donut" aria-hidden="true"></div></div>
									<span class="portfolio-donut-arrow icon icon-portfolio-donut-flow" aria-hidden="true"></span>
									<div class="portfolio-donut-orbit is-pending-value" data-workspace-mask="portfolio-donut-end"><div class="portfolio-donut" aria-hidden="true"></div></div>
								</div>
								<div class="portfolio-summary-main">
									<p class="portfolio-total-label">${labels.portfolio_total_return}</p>
									<p class="portfolio-total-value is-pending-value" data-workspace-mask="portfolio-total-return">0000</p>
								</div>
							</div>
						</article>
					<article class="chart-surface">
							<div class="chart-heading-row"><p class="chart-heading">${chartHeading}</p></div>
							<div class="chart-wrap is-pending-value" data-workspace-mask="chart-area"></div>
					</article>
				</section>
			`;
        }
        return bootstrap.buildComparePendingWorkspaceMarkup?.({
            currentValues,
            reportHeading,
            chartHeading,
            minimumRequiredTickers: MIN_TICKERS,
        }) || "";
    };

    const removeTickerFromComparePreview = (ticker) => {
        if (state.currentView !== "tickers") return;
        bootstrap.removeTickerFromComparePreview?.({
            ticker,
            state,
            sanitizeTicker,
            minimumRequiredTickers,
        });
    };

    const replaceDomRegion = (currentRegion, nextRegion) => {
        if (!currentRegion || !nextRegion) return;
        currentRegion.replaceChildren(...Array.from(nextRegion.childNodes).map((node) => node.cloneNode(true)));
    };

    const applyComparePendingState = () => {
        bootstrap.applyComparePendingState?.();
    };

    const applyPortfolioPendingState = () => {
        const workspacePanel = document.getElementById("workspace_panel");
        if (!workspacePanel) return;
        delete workspacePanel.dataset.workspacePending;
    };

    const applyBacktestPendingState = () => {
        const workspacePanel = document.getElementById("workspace_panel");
        if (!workspacePanel) return;
        const metricNodes = Array.from(workspacePanel.querySelectorAll('[data-workspace-mask="trade-metric"]'));
        if (!metricNodes.length) return;
        metricNodes.forEach((node) => {
            node.classList.add("is-pending-value");
        });
        workspacePanel.dataset.workspacePending = "1";
    };

    const applyPendingWorkspaceMarkup = () => {
        if (state.currentView === "tickers") {
            applyComparePendingState();
            return;
        }
        if (state.currentView === "portfolio") {
            applyPortfolioPendingState();
            return;
        }
        if (state.currentView === "backtest") {
            applyBacktestPendingState();
            return;
        }
        const workspacePanel = document.getElementById("workspace_panel");
        if (!workspacePanel) return;
        workspacePanel.innerHTML = buildPendingWorkspaceMarkup();
        workspacePanel.dataset.workspacePending = "1";
    };

    const parseStateFromHtmlDocument = (doc) => {
        const stateNode = doc.getElementById("antigravity_state");
        if (!stateNode?.textContent) return null;
        try {
            return JSON.parse(stateNode.textContent);
        } catch (_error) {
            return null;
        }
    };

    const collectKnownTickerProfileMap = () => {
        const profileMap = new Map();
        getTickerInputs().forEach((input) => {
            const ticker = sanitizeTicker(input.value || input.dataset.symbol || "");
            if (!ticker) return;
            const control = input.closest(".ticker-input-control");
            const image = control?.querySelector(".ticker-input-logo");
            const logoUrl = input.dataset.logoUrl || image?.getAttribute("src") || "";
            const companyName = input.dataset.companyName || ticker;
            profileMap.set(ticker, {
                ticker,
                company_name: companyName,
                logo_url: logoUrl,
            });
        });
        (state.chart?.profiles || []).forEach((profile) => {
            const ticker = sanitizeTicker(profile?.ticker || "");
            if (!ticker) return;
            const currentProfile = profileMap.get(ticker) || {
                ticker,
                company_name: ticker,
                logo_url: "",
            };
            profileMap.set(ticker, {
                ...currentProfile,
                company_name: currentProfile.company_name || profile?.company_name || ticker,
                logo_url: currentProfile.logo_url || profile?.logo_url || "",
            });
        });
        return profileMap;
    };

    const mergeKnownTickerProfilesIntoState = (nextState) => {
        if (!nextState || !["tickers", "portfolio"].includes(nextState.currentView)) return nextState;
        if (!nextState.chart) return nextState;
        const profileMap = collectKnownTickerProfileMap();
        if (!profileMap.size) return nextState;
        const existingProfiles = Array.isArray(nextState.chart.profiles) ? nextState.chart.profiles : [];
        const mergedProfiles = existingProfiles.map((profile) => {
            const ticker = sanitizeTicker(profile?.ticker || "");
            if (!ticker) return profile;
            const knownProfile = profileMap.get(ticker);
            if (!knownProfile) return profile;
            return {
                ...profile,
                company_name: profile?.company_name || knownProfile.company_name || ticker,
                logo_url: profile?.logo_url || knownProfile.logo_url || "",
            };
        });
        const mergedTickerSet = new Set(
            mergedProfiles
                .map((profile) => sanitizeTicker(profile?.ticker || ""))
                .filter(Boolean),
        );
        (Array.isArray(nextState.chart.series) ? nextState.chart.series : []).forEach((seriesItem) => {
            const ticker = sanitizeTicker(seriesItem?.ticker || "");
            if (!ticker || mergedTickerSet.has(ticker)) return;
            const knownProfile = profileMap.get(ticker);
            if (!knownProfile) return;
            mergedProfiles.push({
                ticker,
                company_name: knownProfile.company_name || ticker,
                logo_url: knownProfile.logo_url || "",
            });
            mergedTickerSet.add(ticker);
        });
        nextState.chart.profiles = mergedProfiles;
        return nextState;
    };

    const abortActiveWorkspaceHydration = () => {
        if (!activeWorkspaceHydration) return;
        activeWorkspaceHydration.abort();
        activeWorkspaceHydration = null;
    };

    const hydrateWorkspaceFromUrl = async (nextUrl) => {
        abortActiveWorkspaceHydration();
        const token = ++workspaceHydrationToken;
        const controller = new AbortController();
        activeWorkspaceHydration = controller;
        const response = await fetch(nextUrl, {
            headers: {
                "X-Requested-With": "workspace-hydrate",
            },
            credentials: "same-origin",
            signal: controller.signal,
        });
        if (!response.ok) throw new Error(`Workspace refresh failed: ${response.status}`);
        const html = await response.text();
        if (controller.signal.aborted || token !== workspaceHydrationToken) return false;
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, "text/html");
        const nextWorkspacePanel = doc.getElementById("workspace_panel");
        const workspacePanel = document.getElementById("workspace_panel");
        if (!nextWorkspacePanel || !workspacePanel) throw new Error("Workspace panel missing from response.");
        if (state.currentView === "tickers") {
            const hydratedCompareWorkspace = bootstrap.hydrateCompareWorkspace?.({
                doc,
                replaceDomRegion,
            });
            if (!hydratedCompareWorkspace) {
                workspacePanel.innerHTML = nextWorkspacePanel.innerHTML;
            }
        } else if (state.currentView === "portfolio") {
            const currentSummaryRegion = document.getElementById("portfolio_summary_region");
            const nextSummaryRegion = doc.getElementById("portfolio_summary_region");
            const currentChartRegion = document.getElementById("portfolio_chart_region");
            const nextChartRegion = doc.getElementById("portfolio_chart_region");
            if (!currentSummaryRegion || !nextSummaryRegion || !currentChartRegion || !nextChartRegion) {
                workspacePanel.innerHTML = nextWorkspacePanel.innerHTML;
            } else {
                replaceDomRegion(currentSummaryRegion, nextSummaryRegion);
                replaceDomRegion(currentChartRegion, nextChartRegion);
                workspacePanel.querySelectorAll(".is-pending-value").forEach((node) => node.classList.remove("is-pending-value"));
            }
        } else {
            workspacePanel.innerHTML = nextWorkspacePanel.innerHTML;
        }
        delete workspacePanel.dataset.workspacePending;
        const nextState = mergeKnownTickerProfilesIntoState(parseStateFromHtmlDocument(doc));
        if (nextState) {
            window.ANTIGRAVITY_APP = nextState;
            Object.assign(state, nextState);
        }
        document.title = doc.title || document.title;
        window.history.replaceState({}, "", nextUrl);
        initializeWorkspaceEnhancements();
        scheduleDockPosition();
        scheduleMobilePageBottomPaddingSync();
        if (activeWorkspaceHydration === controller) activeWorkspaceHydration = null;
        return true;
    };

    const readViewMemory = () => {
        try {
            const raw = window.sessionStorage.getItem(VIEW_MEMORY_KEY);
            if (!raw) return {};
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === "object" ? parsed : {};
        } catch (_error) {
            return {};
        }
    };

    const writeViewMemory = (nextMemory) => {
        try {
            window.sessionStorage.setItem(VIEW_MEMORY_KEY, JSON.stringify(nextMemory));
        } catch (_error) {
        }
    };

    const sanitizeRememberedUrl = (url) => {
        try {
            const parsed = new URL(url, window.location.origin);
            TRANSIENT_VIEW_QUERY_KEYS.forEach((key) => {
                parsed.searchParams.delete(key);
            });
            const normalizedSearch = parsed.searchParams.toString();
            return `${parsed.pathname}${normalizedSearch ? `?${normalizedSearch}` : ""}${parsed.hash || ""}`;
        } catch (_error) {
            return url;
        }
    };

    const rememberCurrentViewUrl = (url = window.location.pathname + window.location.search) => {
        if (!state.currentView) return;
        const memory = readViewMemory();
        memory[state.currentView] = sanitizeRememberedUrl(url);
        writeViewMemory(memory);
    };

    const attachDockMemory = () => {
        const viewByDockIndex = ["tickers", "portfolio", "backtest", "more", "settings"];
        const dockLinks = $$(".sidebar-dock-item");
        const setDockPreviewTarget = (targetView) => {
            dockLinks.forEach((link, index) => {
                const isTarget = viewByDockIndex[index] === targetView;
                link.classList.toggle("is-active", isTarget);
                if (isTarget) {
                    link.setAttribute("aria-current", "page");
                } else {
                    link.removeAttribute("aria-current");
                }
            });
        };
        const prefetchDockDestination = async (url) => {
            if (!url) return null;
            if (dockPrefetchCache.has(url)) return dockPrefetchCache.get(url);
            const fetchPromise = fetch(url, {
                credentials: "same-origin",
                headers: {
                    "X-Requested-With": "dock-prefetch",
                },
                cache: "force-cache",
            }).then(async (response) => {
                if (!response.ok) throw new Error(`Dock prefetch failed: ${response.status}`);
                return response.text();
            });
            dockPrefetchCache.set(url, fetchPromise);
            return fetchPromise;
        };
        const resolveSettingsSectionFromUrl = (url) => {
            try {
                const parsedUrl = new URL(url, window.location.origin);
                const pathMatch = parsedUrl.pathname.match(/^\/settings\/([^/?#]+)/);
                return pathMatch?.[1] || "about";
            } catch (_error) {
                return "about";
            }
        };
        const resolveViewFromUrl = (url) => {
            try {
                const parsedUrl = new URL(url, window.location.origin);
                const path = parsedUrl.pathname.toLowerCase();
                if (path === "/compare" || path.startsWith("/compare/")) return "tickers";
                if (path === "/portfolio" || path.startsWith("/portfolio/")) return "portfolio";
                if (path === "/backtest" || path.startsWith("/backtest/")) return "backtest";
                if (path === "/more" || path.startsWith("/more/") || path === "/invest" || path === "/investment") return "more";
                if (path === "/settings" || path.startsWith("/settings/")) return "settings";
                return null;
            } catch (_error) {
                return null;
            }
        };
        $$(".sidebar-dock-item").forEach((link, index) => {
            const targetView = viewByDockIndex[index];
            if (!targetView || link.dataset.boundDockMemory === "1") return;
            link.dataset.boundDockMemory = "1";
            link.addEventListener("click", async (event) => {
                rememberCurrentViewUrl();
                const memory = readViewMemory();
                const rememberedUrl = memory[targetView];
                const fallbackUrl = link.getAttribute("href") || "";
                event.preventDefault();
                const rememberedView = rememberedUrl ? resolveViewFromUrl(rememberedUrl) : null;
                const nextUrl = rememberedView === targetView ? rememberedUrl : fallbackUrl;
                if (!nextUrl) return;
                if (targetView === state.currentView && nextUrl === (window.location.pathname + window.location.search)) {
                    return;
                }
                setDockPreviewTarget(targetView);
                document.body.classList.add("is-workspace-switching");
                try {
                    const responseText = await prefetchDockDestination(nextUrl);
                    const parser = new DOMParser();
                    const newDoc = parser.parseFromString(responseText, "text/html");
                    const newAppShell = newDoc.querySelector(".app-shell");
                    if (newAppShell) {
                        const nextSidebar = newAppShell.querySelector("#app_sidebar");
                        const nextToggle = newAppShell.querySelector("#sidebar_toggle");
                        applySidebarState(readSidebarMemory(), newAppShell, nextSidebar, nextToggle);
                        document.querySelector(".app-shell").replaceWith(newAppShell);
                        const targetSettingsSection = targetView === "settings"
                            ? resolveSettingsSectionFromUrl(nextUrl)
                            : null;
                        const nextSelectors = getProgressiveMaskSelectors(targetView, targetSettingsSection);
                        document.querySelectorAll(".is-masked-during-switch").forEach((node) => {
                            node.classList.remove("is-masked-during-switch");
                        });
                        nextSelectors.forEach((selector) => {
                            document.querySelectorAll(selector).forEach((node) => {
                                node.classList.add("is-masked-during-switch");
                            });
                        });
                    }
                } catch (_error) {
                }
                window.requestAnimationFrame(() => {
                    window.location.assign(nextUrl);
                });
            });
        });
    };

    const isTickerValidationPending = () => getTickerInputs().some((input) => input.dataset.validationPending === "1");

    const setTickerValidationPending = (input, isPending) => {
        if (!input) return;
        input.dataset.validationPending = isPending ? "1" : "";
        input.classList.toggle("is-pending", isPending);
    };

    const rememberValidatedTicker = (input, ticker, isKnown) => {
        if (!input) return;
        input.dataset.validatedTicker = ticker || "";
        input.dataset.validatedKnown = isKnown ? "1" : "0";
        if (ticker) tickerValidationCache.set(ticker, isKnown);
    };

    const seedTickerValidationState = () => {
        if (!hasInitialResult) return;
        getTickerInputs().forEach((input) => {
            if (!(input instanceof HTMLInputElement)) return;
            const value = sanitizeTicker(input.value.trim());
            if (!value || !tickerPattern.test(value) || input.dataset.unknown === "1") return;
            rememberValidatedTicker(input, value, true);
            setTickerValidationPending(input, false);
            validateTickerInput(input);
        });
    };

    const validateTickerExistence = async (input, {preferFresh = false} = {}) => {
        if (!input) return false;
        const value = sanitizeTicker(input.value.trim());
        input.value = value;
        validateTickerInput(input);
        if (!value) {
            input.dataset.unknown = "";
            rememberValidatedTicker(input, "", false);
            setTickerValidationPending(input, false);
            validateTickerInput(input);
            return false;
        }
        if (!tickerPattern.test(value)) {
            input.dataset.unknown = "";
            rememberValidatedTicker(input, "", false);
            setTickerValidationPending(input, false);
            validateTickerInput(input);
            return false;
        }
        const counts = new Map();
        getFilledTickers().forEach((ticker) => counts.set(ticker, (counts.get(ticker) || 0) + 1));
        if ((counts.get(value) || 0) > 1) {
            input.dataset.unknown = "";
            rememberValidatedTicker(input, "", false);
            setTickerValidationPending(input, false);
            validateTickerInput(input);
            return false;
        }

        if (!preferFresh && input.dataset.validatedTicker === value) {
            const known = input.dataset.validatedKnown !== "0";
            input.dataset.unknown = known ? "" : "1";
            setTickerValidationPending(input, false);
            validateTickerInput(input);
            return known;
        }

        if (!preferFresh && tickerValidationCache.has(value)) {
            const isKnown = Boolean(tickerValidationCache.get(value));
            input.dataset.unknown = isKnown ? "" : "1";
            rememberValidatedTicker(input, value, isKnown);
            setTickerValidationPending(input, false);
            validateTickerInput(input);
            return isKnown;
        }

        setTickerValidationPending(input, true);
        input.dataset.validationTicker = value;
        try {
            const response = await fetch(`${endpoints.symbolSearch}?q=${encodeURIComponent(value)}&limit=5`);
            if (!response.ok) throw new Error(`Ticker lookup failed: ${response.status}`);
            const payload = await response.json();
            const isKnown = Boolean(payload.find((item) => String(item.symbol || "").toUpperCase() === value));
            if (input.dataset.validationTicker === value) {
                input.dataset.unknown = isKnown ? "" : "1";
                if (isKnown) {
                    applyExactTickerMatch(input, payload, value);
                } else {
                    rememberValidatedTicker(input, value, false);
                    setTickerValidationPending(input, false);
                    validateTickerInput(input);
                }
            }
            return isKnown;
        } catch (_error) {
            if (input.dataset.validationTicker === value) {
                rememberValidatedTicker(input, value, input.dataset.unknown !== "1");
                setTickerValidationPending(input, false);
                validateTickerInput(input);
            }
            return input.dataset.unknown !== "1";
        }
    };

    const ensureTickerValidityBeforeSubmit = async () => {
        const inputs = getTickerInputs();
        const results = await Promise.all(inputs.map((input) => validateTickerExistence(input, {preferFresh: false})));
        validateAllTickerInputs();
        return results.every((item, index) => {
            const input = inputs[index];
            if (!sanitizeTicker(input.value.trim())) return !input.required;
            return item && input.checkValidity() && input.dataset.unknown !== "1";
        });
    };

    const syncTickerClearButton = (input) => {
        const clearButton = input?.parentElement?.querySelector(".ticker-clear");
        if (!clearButton || !input) return;
        clearButton.classList.toggle("is-visible", Boolean(input.value.trim()));
    };

    const setTickerLogoVisibility = (logo, placeholder, isLoaded) => {
        if (logo instanceof HTMLImageElement) {
            logo.hidden = !isLoaded;
            logo.dataset.loaded = isLoaded ? "1" : "0";
        }
        if (placeholder) placeholder.hidden = isLoaded;
    };

    const syncTickerLogoAsset = (logo, placeholder, logoUrl, altText = "") => {
        if (!(logo instanceof HTMLImageElement)) {
            if (placeholder) placeholder.hidden = Boolean(logoUrl);
            return;
        }
        const normalizedUrl = String(logoUrl || "").trim();
        logo.onload = null;
        logo.onerror = null;
        if (!normalizedUrl) {
            delete logo.dataset.requestedSrc;
            logo.removeAttribute("src");
            logo.alt = "";
            setTickerLogoVisibility(logo, placeholder, false);
            return;
        }
        logo.dataset.requestedSrc = normalizedUrl;
        logo.alt = altText;
        setTickerLogoVisibility(logo, placeholder, false);
        const finalize = (isLoaded) => {
            if (logo.dataset.requestedSrc !== normalizedUrl) return;
            if (!isLoaded) {
                logo.removeAttribute("src");
                setTickerLogoVisibility(logo, placeholder, false);
                return;
            }
            setTickerLogoVisibility(logo, placeholder, true);
        };
        logo.onload = () => finalize(true);
        logo.onerror = () => finalize(false);
        if (logo.getAttribute("src") !== normalizedUrl) {
            logo.src = normalizedUrl;
        }
        if (logo.complete) {
            finalize(Boolean(logo.naturalWidth && logo.naturalHeight));
        }
    };

    const syncTickerInputDecoration = (input, suggestion = null) => {
        const control = input?.closest(".ticker-input-control");
        if (!control || !input) return;
        const logo = control.querySelector(".ticker-input-logo");
        const placeholder = control.querySelector(".ticker-logo-placeholder");
        const value = input.value.trim();
        const hasTickerLikeValue = Boolean(value);
        const tickerValue = suggestion?.symbol || input.dataset.symbol || value.toUpperCase();
        const profileLogoUrl = state.chart?.profiles?.find((item) => item.ticker === tickerValue)?.logo_url || "";
        const logoUrl = suggestion?.logo_url || input.dataset.logoUrl || profileLogoUrl || "";
        control.classList.toggle("has-value", hasTickerLikeValue);
        control.classList.toggle("has-logo", Boolean(logoUrl));
        syncTickerLogoAsset(logo, placeholder, logoUrl, logoUrl ? `${tickerValue} logo` : "");
        if (suggestion) {
            input.dataset.logoUrl = suggestion.logo_url || "";
            input.dataset.symbol = suggestion.symbol || "";
            input.dataset.companyName = suggestion.name || suggestion.symbol || "";
        }
        if (!hasTickerLikeValue) {
            input.dataset.logoUrl = "";
            input.dataset.symbol = "";
            input.dataset.companyName = "";
        }
    };

    const applyExactTickerMatch = (input, items, ticker) => {
        if (!input || !Array.isArray(items) || !ticker) return null;
        const exactItem = items.find((item) => String(item?.symbol || "").toUpperCase() === ticker) || null;
        if (!exactItem) return null;
        input.dataset.unknown = "";
        rememberValidatedTicker(input, ticker, true);
        setTickerValidationPending(input, false);
        syncTickerInputDecoration(input, exactItem);
        validateTickerInput(input);
        return exactItem;
    };

    const hidePortfolioWeightTooltips = () => {
        getWeightFields().forEach((entry) => {
            if (!entry.tooltip) return;
            entry.tooltip.hidden = true;
            entry.tooltip.textContent = "";
        });
    };

    const showPortfolioWeightTooltip = (entry, message) => {
        if (!entry?.tooltip) return;
        entry.tooltip.textContent = message;
        entry.tooltip.hidden = false;
        window.setTimeout(() => {
            if (entry.tooltip) entry.tooltip.hidden = true;
        }, 2400);
    };

    const nextPortfolioTouchStamp = () => {
        portfolioWeightState.clock += 1;
        return portfolioWeightState.clock;
    };

    const markPortfolioWeightTouched = (index) => {
        portfolioWeightState.touchedAtByIndex[index] = nextPortfolioTouchStamp();
    };

    const dropPortfolioWeightTouch = (index) => {
        delete portfolioWeightState.touchedAtByIndex[index];
    };

    const getPortfolioWeightTouchStamp = (index) => portfolioWeightState.touchedAtByIndex[index] || 0;

    const reindexPortfolioWeightState = () => {
        const nextTouchedAtByIndex = {};
        getTickerFields().forEach((field, offset) => {
            const previousIndex = Number.parseInt(field.dataset.index || String(offset + 1), 10) - 1;
            const nextIndex = offset;
            const previousStamp = portfolioWeightState.touchedAtByIndex[previousIndex];
            if (previousStamp) nextTouchedAtByIndex[nextIndex] = previousStamp;
        });
        portfolioWeightState.touchedAtByIndex = nextTouchedAtByIndex;
    };

    const ensurePortfolioWeightTouches = () => {
        if (!isPortfolioView) return;
        const filledEntries = getFilledWeightEntries();
        if (filledEntries.length && Object.keys(portfolioWeightState.touchedAtByIndex).length === 0) {
            filledEntries.forEach((entry, order) => {
                portfolioWeightState.clock += 1;
                portfolioWeightState.touchedAtByIndex[entry.index] = order === filledEntries.length - 1 ? 1 : portfolioWeightState.clock + 1;
            });
        }
        filledEntries.forEach((entry) => {
            if (!getPortfolioWeightTouchStamp(entry.index)) {
                markPortfolioWeightTouched(entry.index);
            }
        });
        const activeIndexes = new Set(filledEntries.map((entry) => entry.index));
        Object.keys(portfolioWeightState.touchedAtByIndex).forEach((key) => {
            const index = Number.parseInt(key, 10);
            if (!activeIndexes.has(index)) dropPortfolioWeightTouch(index);
        });
    };

    const updateAddButtonState = () => {
        const wrapper = $("#ticker_add_wrapper");
        if (!wrapper) return;
        wrapper.hidden = getTickerFields().length >= MAX_TICKERS;
    };

    const reindexTickerFields = () => {
        reindexPortfolioWeightState();
        getTickerFields().forEach((field, offset) => {
            const index = offset + 1;
            field.dataset.index = String(index);
            const label = field.querySelector("label");
            const input = field.querySelector("[data-ticker-input]");
            const suggestions = field.querySelector(".suggestions");
            if (label) {
                label.setAttribute("for", `ticker_${index}`);
                label.textContent = isBacktestView ? labels.backtest_ticker : `Ticker ${index}`;
            }
            if (input) {
                input.id = `ticker_${index}`;
                input.name = "ticker";
                input.required = index <= minimumRequiredTickers;
                input.placeholder = "";
                syncTickerClearButton(input);
                syncTickerInputDecoration(input);
            }
            const weightInput = field.querySelector(".portfolio-weight-input");
            const weightSlider = field.querySelector(".portfolio-weight-slider");
            if (weightInput && weightSlider) {
                weightInput.id = `weight_${index}`;
                weightInput.name = "weight";
                weightSlider.dataset.index = String(index);
            }
            if (suggestions) suggestions.id = `ticker_${index}_suggestions`;
            const removeButton = field.querySelector(".ticker-remove");
            if (removeButton) {
                removeButton.classList.toggle("is-placeholder", index <= minimumRequiredTickers);
                removeButton.tabIndex = index <= minimumRequiredTickers ? -1 : 0;
                removeButton.setAttribute("aria-hidden", index <= minimumRequiredTickers ? "true" : "false");
            }
        });
        updateAddButtonState();
    };

    const syncPortfolioWeightDisabledState = () => {
        if (!isPortfolioView) return;
        getWeightFields().forEach(({tickerInput, number, slider}) => {
            const isFilled = Boolean(sanitizeTicker(tickerInput.value.trim()));
            number.disabled = !isFilled;
            slider.disabled = !isFilled;
            if (!isFilled) {
                number.value = "0";
                slider.value = "0";
            }
        });
    };

    const buildDefaultWeights = (count) => {
        if (count <= 0) return [];
        const base = Math.floor(100 / count);
        const remainder = 100 % count;
        return Array.from({length: count}, (_item, index) => base + (index < remainder ? 1 : 0));
    };

    const getFilledWeightEntries = () => getWeightFields()
        .map((item, index) => ({...item, index, ticker: sanitizeTicker(item.tickerInput.value.trim())}))
        .filter((item) => item.ticker);

    const syncPortfolioWeightPair = (entry, value) => {
        const normalized = Math.min(100, Math.max(0, Number.parseInt(String(value || 0), 10) || 0));
        entry.number.value = String(normalized);
        entry.slider.value = String(normalized);
    };

    const resolveOrderedPortfolioPeer = (referenceIndex, filledEntries, {preferPrevious = true} = {}) => {
        const previousCandidates = filledEntries.filter((entry) => entry.index < referenceIndex);
        const nextCandidates = filledEntries.filter((entry) => entry.index > referenceIndex);
        if (preferPrevious && previousCandidates.length) {
            return previousCandidates[previousCandidates.length - 1];
        }
        if (!preferPrevious && nextCandidates.length) {
            return nextCandidates[0];
        }
        return preferPrevious
            ? (nextCandidates[0] || null)
            : (previousCandidates[previousCandidates.length - 1] || null);
    };

    const resolvePassivePortfolioEntry = (changedIndex, filledEntries) => (
        resolveOrderedPortfolioPeer(changedIndex, filledEntries, {preferPrevious: true})
    );

    const computeActiveWeightBounds = (changedIndex, filledEntries) => {
        const passiveEntry = resolvePassivePortfolioEntry(changedIndex, filledEntries);
        if (!passiveEntry) {
            return {min: 100, max: 100, passiveEntry: null};
        }
        const fixedOtherTotal = filledEntries
            .filter((entry) => entry.index !== changedIndex && entry.index !== passiveEntry.index)
            .reduce((sum, entry) => sum + (Number.parseInt(entry.number.value, 10) || 0), 0);
        return {
            min: Math.max(0, 100 - fixedOtherTotal - 100),
            max: Math.min(100, 100 - fixedOtherTotal),
            passiveEntry,
        };
    };

    const syncPortfolioWeightBounds = () => {
        if (!isPortfolioView) return;
        ensurePortfolioWeightTouches();
        const filledEntries = getFilledWeightEntries();
        const filledIndexSet = new Set(filledEntries.map((entry) => entry.index));
        getWeightFields().forEach((entry) => {
            if (!filledIndexSet.has(entry.index)) {
                entry.number.min = "0";
                entry.number.max = "100";
                entry.slider.min = "0";
                entry.slider.max = "100";
                return;
            }
            const bounds = computeActiveWeightBounds(entry.index, filledEntries);
            entry.number.min = String(bounds.min);
            entry.number.max = String(bounds.max);
            entry.slider.min = String(bounds.min);
            entry.slider.max = String(bounds.max);
        });
    };

    const rebalancePortfolioWeights = (changedIndex) => {
        if (!isPortfolioView) return;
        ensurePortfolioWeightTouches();
        const filledEntries = getFilledWeightEntries();
        if (!filledEntries.length) return;
        const activeEntry = filledEntries.find((entry) => entry.index === changedIndex);
        if (!activeEntry) return;
        hidePortfolioWeightTooltips();
        const bounds = computeActiveWeightBounds(changedIndex, filledEntries);
        const passiveEntry = bounds.passiveEntry;
        if (!passiveEntry) {
            syncPortfolioWeightPair(activeEntry, 100);
            markPortfolioWeightTouched(changedIndex);
            syncPortfolioWeightBounds();
            return;
        }
        const desiredActive = Number.parseInt(activeEntry.number.value, 10) || 0;
        let nextActive = desiredActive;
        let shouldWarn = false;
        if (desiredActive > bounds.max) {
            nextActive = bounds.max;
            shouldWarn = true;
        }
        if (desiredActive < bounds.min) {
            nextActive = bounds.min;
            shouldWarn = true;
        }
        const fixedOtherTotal = filledEntries
            .filter((entry) => entry.index !== changedIndex && entry.index !== passiveEntry.index)
            .reduce((sum, entry) => sum + (Number.parseInt(entry.number.value, 10) || 0), 0);
        const nextPassive = Math.max(0, Math.min(100, 100 - fixedOtherTotal - nextActive));
        syncPortfolioWeightPair(activeEntry, nextActive);
        syncPortfolioWeightPair(passiveEntry, nextPassive);
        if (shouldWarn) {
            showPortfolioWeightTooltip(
                activeEntry,
                `${passiveEntry.ticker} stayed paired by ticker order, so ${activeEntry.ticker} was limited to keep the total at 100%.`,
            );
        }
        markPortfolioWeightTouched(changedIndex);
        syncPortfolioWeightBounds();
    };

    const rebalancePortfolioWeightsAfterRemoval = (removedWeight = 0, removedIndex = -1) => {
        if (!isPortfolioView) return;
        ensurePortfolioWeightTouches();
        const filledEntries = getFilledWeightEntries();
        if (!filledEntries.length) return;
        if (filledEntries.length === 1) {
            syncPortfolioWeightPair(filledEntries[0], 100);
            markPortfolioWeightTouched(filledEntries[0].index);
            syncPortfolioWeightBounds();
            return;
        }
        const currentTotal = filledEntries.reduce((sum, entry) => sum + (Number.parseInt(entry.number.value, 10) || 0), 0);
        const deficit = Math.max(0, 100 - currentTotal);
        const targetAdjustment = deficit || Math.max(0, Number.parseInt(String(removedWeight || 0), 10) || 0);
        if (targetAdjustment <= 0) {
            syncPortfolioWeightBounds();
            return;
        }
        const passiveEntry = filledEntries[Math.max(0, Math.min(removedIndex - 1, filledEntries.length - 1))] || filledEntries[0];
        const nextValue = (Number.parseInt(passiveEntry.number.value, 10) || 0) + targetAdjustment;
        syncPortfolioWeightPair(passiveEntry, Math.min(100, nextValue));
        markPortfolioWeightTouched(passiveEntry.index);
        syncPortfolioWeightBounds();
    };

    const dispatchPortfolioPreviewUpdate = () => {
        if (!isPortfolioView) return;
        window.dispatchEvent(new CustomEvent("antigravity:portfolio-preview", {
            detail: {
                entries: getFilledWeightEntries().map((entry) => ({
                    index: entry.index,
                    ticker: entry.ticker,
                    weight: Number.parseInt(entry.number.value, 10) || 0,
                })),
            },
        }));
    };

    const validatePortfolioWeightInputs = () => {
        if (!isPortfolioView) return true;
        let isValid = true;
        getWeightFields().forEach((entry) => {
            const {tickerInput, number} = entry;
            const ticker = sanitizeTicker(tickerInput.value.trim());
            const weight = Number.parseInt(number.value, 10) || 0;
            if (ticker && weight <= 0) {
                number.classList.add("is-invalid");
                if (!entry.tooltip?.textContent) {
                    showPortfolioWeightTooltip(entry, "Each selected ticker must have a weight above 0%.");
                }
                isValid = false;
                return;
            }
            number.classList.remove("is-invalid");
        });
        return isValid;
    };

    const restoreRetainedPortfolioWeight = (tickerInput) => {
        if (!isPortfolioView || !tickerInput) return;
        const field = tickerInput.closest(".ticker-field");
        const number = field?.querySelector(".portfolio-weight-input");
        const slider = field?.querySelector(".portfolio-weight-slider");
        const retainedWeight = Number.parseInt(tickerInput.dataset.retainedWeight || "", 10);
        if (!number || !slider) return;
        if (!sanitizeTicker(tickerInput.value.trim())) return;
        if (!Number.isFinite(retainedWeight) || retainedWeight <= 0) return;
        if ((Number.parseInt(number.value, 10) || 0) > 0) return;
        number.value = String(retainedWeight);
        slider.value = String(retainedWeight);
        delete tickerInput.dataset.retainedWeight;
    };

    const handlePortfolioTickerValueChange = (tickerInput) => {
        if (!isPortfolioView || !tickerInput) return;
        const field = tickerInput.closest(".ticker-field");
        const number = field?.querySelector(".portfolio-weight-input");
        const slider = field?.querySelector(".portfolio-weight-slider");
        const entry = getWeightFields().find((item) => item.tickerInput === tickerInput);
        if (!number || !slider || !entry) return;

        const previousTicker = tickerInput.dataset.lastTicker || "";
        const ticker = sanitizeTicker(tickerInput.value.trim());
        if (!ticker && previousTicker) {
            const currentWeight = Number.parseInt(number.value, 10) || 0;
            if (currentWeight > 0) {
                tickerInput.dataset.retainedWeight = String(currentWeight);
            }
        }
        if (ticker && !previousTicker) {
            restoreRetainedPortfolioWeight(tickerInput);
        }

        syncPortfolioWeightDisabledState();
        if (ticker && !getPortfolioWeightTouchStamp(entry.index)) {
            markPortfolioWeightTouched(entry.index);
        }
        if (!ticker) {
            dropPortfolioWeightTouch(entry.index);
        }

        const filledEntries = getFilledWeightEntries();
        if (filledEntries.length && filledEntries.every((item) => (Number.parseInt(item.number.value, 10) || 0) === 0)) {
            const defaults = buildDefaultWeights(filledEntries.length);
            filledEntries.forEach((item, itemIndex) => syncPortfolioWeightPair(item, defaults[itemIndex] || 0));
        }

        syncPortfolioWeightBounds();
        dispatchPortfolioPreviewUpdate();
        validatePortfolioWeightInputs();
        tickerInput.dataset.lastTicker = ticker;
    };

    const attachPortfolioWeightHandlers = () => {
        if (!isPortfolioView) return;
        getWeightFields().forEach(({field, number, slider, tickerInput, index}) => {
            if (number.dataset.bound === "1") return;
            number.dataset.bound = "1";
            if (tickerInput) tickerInput.dataset.lastTicker = sanitizeTicker(tickerInput.value.trim());
            const syncAndRefresh = (source) => {
                const value = Math.min(100, Math.max(0, Number.parseInt(String(source.value || 0), 10) || 0));
                number.value = String(value);
                slider.value = String(value);
                rebalancePortfolioWeights(index);
                dispatchPortfolioPreviewUpdate();
                validatePortfolioWeightInputs();
                requestWorkspaceChartTransition("portfolio-weight");
                scheduleAutoSubmit(180);
            };
            const openSlider = () => field.querySelector(".portfolio-weight-field")?.classList.add("is-open");
            const closeSlider = () => window.setTimeout(() => {
                if (field.matches(":focus-within")) return;
                field.querySelector(".portfolio-weight-field")?.classList.remove("is-open");
            }, 80);
            number.addEventListener("focus", openSlider);
            number.addEventListener("click", openSlider);
            slider.addEventListener("focus", openSlider);
            field.addEventListener("focusout", closeSlider);
            number.addEventListener("input", () => syncAndRefresh(number));
            slider.addEventListener("input", () => syncAndRefresh(slider));
            tickerInput?.addEventListener("input", () => {
                handlePortfolioTickerValueChange(tickerInput);
            });
        });
    };

    const validateTickerInput = (input) => {
        const rawValue = input.value.trim();
        const value = sanitizeTicker(rawValue);
        input.value = value;
        const duplicateTooltip = input.parentElement.querySelector(".field-tooltip-duplicate");
        const unknownTooltip = input.parentElement.querySelector(".field-tooltip-invalid");
        const counts = new Map();
        getFilledTickers().forEach((ticker) => counts.set(ticker, (counts.get(ticker) || 0) + 1));
        const isDuplicate = value && (counts.get(value) || 0) > 1;
        const isMalformed = Boolean(value) && !tickerPattern.test(value);
        const isUnknown = input.dataset.unknown === "1";

        const shouldFlag = isDuplicate || isMalformed || isUnknown;
        input.classList.toggle("is-invalid", shouldFlag);
        syncTickerClearButton(input);
        syncTickerInputDecoration(input);
        if (duplicateTooltip) duplicateTooltip.hidden = !isDuplicate;
        if (unknownTooltip) unknownTooltip.hidden = !isUnknown;
        if (isMalformed) {
            input.setCustomValidity("Enter a valid ticker symbol.");
        } else if (isDuplicate) {
            input.setCustomValidity("Ticker symbol must be unique.");
        } else if (isUnknown) {
            input.setCustomValidity(UNKNOWN_MESSAGE);
        } else if (input.required && !value) {
            input.setCustomValidity("Enter a ticker symbol.");
        } else {
            input.setCustomValidity("");
        }
        if (!input.validationMessage) hideTickerValidationTooltip(input);
        return value;
    };

    const validateAllTickerInputs = () => {
        getTickerInputs().forEach((input) => validateTickerInput(input));
    };

    const readTickerControlWidthRatio = (element) => {
        if (!(element instanceof HTMLElement)) return 1;
        const rawValue = getComputedStyle(element).getPropertyValue("--ticker-control-width").trim();
        if (rawValue.endsWith("%")) {
            const ratio = Number.parseFloat(rawValue);
            return Number.isFinite(ratio) ? ratio / 100 : 1;
        }
        const ratio = Number.parseFloat(rawValue);
        return Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
    };

    const readTickerValidationArrowRise = (element) => {
        if (!(element instanceof HTMLElement)) return 0;
        const rawValue = getComputedStyle(element).getPropertyValue("--ticker-validation-arrow-rise").trim();
        const rise = Number.parseFloat(rawValue);
        return Number.isFinite(rise) ? rise : 0;
    };

    const positionTickerValidationTooltip = (input) => {
        if (!(input instanceof HTMLElement)) return;
        const tooltipId = input.dataset.validationTooltipId;
        if (!tooltipId) return;
        const tooltip = document.getElementById(tooltipId);
        if (!(tooltip instanceof HTMLElement) || tooltip.hidden) return;
        const host = input.closest(".ticker-input-main");
        if (!(host instanceof HTMLElement)) return;
        const hostRect = host.getBoundingClientRect();
        const controls = input.closest(".compare-controls, .portfolio-controls, .trade-controls, .ticker-form-controls, .ticker-controls");
        const widthRatio = readTickerControlWidthRatio(controls || host);
        const arrowRise = readTickerValidationArrowRise(controls || host);
        tooltip.style.left = `${hostRect.left + (hostRect.width * widthRatio / 2)}px`;
        tooltip.style.top = `${hostRect.top + (hostRect.height / 2) + (arrowRise / 2)}px`;
    };

    const syncVisibleTickerValidationTooltips = () => {
        getTickerInputs().forEach((input) => positionTickerValidationTooltip(input));
    };

    const ensureTickerValidationTooltip = (input) => {
        if (!(input instanceof HTMLElement)) return null;
        if (!input.id) input.id = `ticker_validation_${Math.random().toString(36).slice(2, 10)}`;
        let tooltipId = input.dataset.validationTooltipId;
        if (!tooltipId) {
            tooltipId = `${input.id}_validation_tooltip`;
            input.dataset.validationTooltipId = tooltipId;
        }
        let tooltip = document.getElementById(tooltipId);
        if (tooltip instanceof HTMLElement) return tooltip;
        tooltip = document.createElement("div");
        tooltip.id = tooltipId;
        tooltip.dataset.validationFor = input.id;
        tooltip.className = "field-tooltip field-tooltip-validation liquid-glass-surface";
        const icon = document.createElement("span");
        icon.className = "field-tooltip-validation-icon";
        icon.setAttribute("aria-hidden", "true");
        const copy = document.createElement("span");
        copy.className = "field-tooltip-validation-copy";
        tooltip.append(icon, copy);
        tooltip.hidden = true;
        document.body.appendChild(tooltip);
        return tooltip;
    };

    const hideTickerValidationTooltip = (input) => {
        const tooltip = ensureTickerValidationTooltip(input);
        if (!(tooltip instanceof HTMLElement)) return;
        tooltip.hidden = true;
        const copy = tooltip.querySelector(".field-tooltip-validation-copy");
        if (copy instanceof HTMLElement) copy.textContent = "";
    };

    const showTickerValidationTooltip = (input, message = input.validationMessage) => {
        if (!message) return;
        getTickerInputs().forEach((tickerInput) => {
            if (tickerInput !== input) hideTickerValidationTooltip(tickerInput);
        });
        if (document.activeElement !== input) {
            input.focus({preventScroll: true});
        }
        const tooltip = ensureTickerValidationTooltip(input);
        if (!(tooltip instanceof HTMLElement)) return;
        const copy = tooltip.querySelector(".field-tooltip-validation-copy");
        if (copy instanceof HTMLElement) {
            copy.textContent = message;
        } else {
            tooltip.textContent = message;
        }
        tooltip.hidden = false;
        positionTickerValidationTooltip(input);
        input.scrollIntoView({block: "nearest", inline: "nearest"});
    };

    window.addEventListener("resize", syncVisibleTickerValidationTooltips);
    document.addEventListener("scroll", syncVisibleTickerValidationTooltips, true);

    const setupAutocomplete = (input) => {
        if (!input || input.dataset.autocompleteReady === "1") return;
        input.dataset.autocompleteReady = "1";
        let controller = null;
        let activeIndex = -1;

        const getPanel = () => document.getElementById(`${input.id}_suggestions`);
        const getButtons = () => Array.from(getPanel()?.querySelectorAll(".suggestion-item") || []);
        const setUnknown = (flag) => {
            input.dataset.unknown = flag ? "1" : "";
            if (flag && input.value.trim()) tickerValidationCache.set(sanitizeTicker(input.value.trim()), false);
            validateTickerInput(input);
        };
        const syncActiveSuggestion = () => {
            getButtons().forEach((button, index) => {
                button.classList.toggle("is-active", index === activeIndex);
                if (index === activeIndex) button.scrollIntoView({block: "nearest"});
            });
        };
        const closePanel = () => {
            const panel = getPanel();
            if (!panel) return;
            panel.innerHTML = "";
            panel.classList.remove("is-open");
            activeIndex = -1;
        };
        const showRecentItems = async () => {
            try {
                const response = await fetch(`${endpoints.symbolSearch}?limit=5`);
                if (!response.ok) return closePanel();
                const payload = await response.json();
                if (!payload.length) return closePanel();
                renderItems(payload);
            } catch (_error) {
                closePanel();
            }
        };
        const applySuggestion = (item) => {
            const selectedSymbol = sanitizeTicker(item.symbol || "");
            input.value = selectedSymbol;
            input.dataset.unknown = "";
            input.dataset.validationTicker = selectedSymbol;
            tickerValidationCache.set(selectedSymbol, true);
            setTickerValidationPending(input, false);
            input.setCustomValidity("");
            syncTickerInputDecoration(input, item);
            validateAllTickerInputs();
            handlePortfolioTickerValueChange(input);
            closePanel();
            input.focus();
            syncDateConstraints();
            if (isBacktestView) syncBacktestIntervals();
            if (isPortfolioView) requestWorkspaceChartTransition("ticker-change");
            scheduleAutoSubmit(120);
        };

        const renderItems = (items) => {
            const panel = getPanel();
            if (!panel) return;
            if (!items.length) {
                closePanel();
                return;
            }
            setUnknown(false);
            const groups = [
                {key: "recent", title: "Recent"},
                {key: "local", title: "Local"},
                {key: "remote", title: "Matches"},
            ].filter((group) => items.some((item) => item.source === group.key));
            panel.innerHTML = groups.map((group) => {
                const entries = items.filter((item) => item.source === group.key);
                return `
					<div class="suggestion-group">
						<div class="suggestion-group-label">${group.title}</div>
						${entries.map((item) => `
							<button type="button" class="suggestion-item" data-symbol="${item.symbol}" data-logo-url="${item.logo_url || ""}" data-name="${item.name}">
								<span class="suggestion-row">
									<span class="suggestion-logo-slot">
										<span class="suggestion-logo-placeholder"></span>
										${item.logo_url ? `<img class="suggestion-logo" src="${item.logo_url}" alt="${item.symbol} logo">` : ""}
									</span>
									<span class="suggestion-copy">
										<span class="suggestion-symbol">${item.symbol}</span>
										<span class="suggestion-name">${item.name}</span>
									</span>
								</span>
							</button>
						`).join("")}
					</div>
				`;
            }).join("");
            panel.classList.add("is-open");
            activeIndex = -1;
            panel.querySelectorAll(".suggestion-item").forEach((button) => {
                button.addEventListener("mouseenter", () => {
                    activeIndex = getButtons().indexOf(button);
                    syncActiveSuggestion();
                });
                button.addEventListener("click", () => {
                    applySuggestion({
                        symbol: button.dataset.symbol || "",
                        logo_url: button.dataset.logoUrl || "",
                        name: button.dataset.name || button.dataset.symbol || "",
                    });
                });
            });
        };

        input.addEventListener("input", async () => {
            if (isPortfolioView) requestWorkspaceChartTransition("ticker-edit");
            else if (!isBacktestView) clearWorkspaceChartTransitionRequest();
            hideTickerValidationTooltip(input);
            input.dataset.logoUrl = "";
            input.dataset.symbol = "";
            syncTickerInputDecoration(input);
            const rawQuery = input.value.trim();
            const query = validateTickerInput(input);
            if (!rawQuery) {
                setUnknown(false);
                await showRecentItems();
                return;
            }
            if (controller) controller.abort();
            controller = new AbortController();
            try {
                const response = await fetch(`${endpoints.symbolSearch}?q=${encodeURIComponent(rawQuery)}`, {signal: controller.signal});
                if (!response.ok) return closePanel();
                const payload = await response.json();
                if (!payload.length) {
                    setUnknown(true);
                    closePanel();
                    return;
                }
                const exactMatch = Boolean(applyExactTickerMatch(input, payload, query));
                if (query) tickerValidationCache.set(query, exactMatch);
                input.dataset.unknown = exactMatch ? "" : input.dataset.unknown;
                validateTickerInput(input);
                renderItems(payload);
            } catch (error) {
                if (error.name !== "AbortError") closePanel();
            }
        });
        input.addEventListener("focus", async () => {
            hideTickerValidationTooltip(input);
            if (input.value.trim()) return;
            setUnknown(false);
            await showRecentItems();
        });
        input.addEventListener("click", async () => {
            hideTickerValidationTooltip(input);
            if (input.value.trim()) return;
            if (getPanel()?.classList.contains("is-open")) return;
            setUnknown(false);
            await showRecentItems();
        });
        input.addEventListener("blur", () => {
            window.setTimeout(closePanel, 120);
            void validateTickerExistence(input, {preferFresh: true});
        });
        input.addEventListener("keydown", (event) => {
            const buttons = getButtons();
            if (!buttons.length) return;
            if (event.key === "ArrowDown") {
                event.preventDefault();
                activeIndex = Math.min(activeIndex + 1, buttons.length - 1);
                syncActiveSuggestion();
                return;
            }
            if (event.key === "ArrowUp") {
                event.preventDefault();
                activeIndex = Math.max(activeIndex - 1, 0);
                syncActiveSuggestion();
                return;
            }
            if (event.key === "Enter" && activeIndex >= 0) {
                event.preventDefault();
                buttons[activeIndex]?.click();
                return;
            }
            if (event.key === "Escape") {
                closePanel();
            }
        });
        input.addEventListener("change", () => {
            if (isPortfolioView) requestWorkspaceChartTransition("ticker-change");
            else if (!isBacktestView) clearWorkspaceChartTransitionRequest();
            validateAllTickerInputs();
            void validateTickerExistence(input, {preferFresh: true});
            syncDateConstraints();
            if (isBacktestView) syncBacktestIntervals();
            scheduleAutoSubmit();
        });
    };

    const attachTickerClearHandlers = () => {
        $$(".ticker-clear").forEach((button) => {
            if (button.dataset.bound === "1") return;
            button.dataset.bound = "1";
            button.addEventListener("mousedown", (event) => {
                event.preventDefault();
            });
            button.addEventListener("click", () => {
                const input = button.parentElement?.querySelector("[data-ticker-input]");
                if (!input) return;
                input.value = "";
                input.dataset.unknown = "";
                input.dataset.logoUrl = "";
                input.dataset.symbol = "";
                syncTickerInputDecoration(input);
                validateAllTickerInputs();
                handlePortfolioTickerValueChange(input);
                syncDateConstraints();
                if (isPortfolioView) requestWorkspaceChartTransition("ticker-clear");
                scheduleAutoSubmit(120);
                input.focus();
            });
        });
    };

    const positionSidebarDock = () => {
        const sidebar = $(".sidebar");
        const dock = $(".sidebar-dock");
        if (!sidebar || !dock) return;
        if (window.matchMedia("(max-width: 767px)").matches) {
            dock.style.left = "";
            return;
        }
        const rect = sidebar.getBoundingClientRect();
        dock.style.left = `${Math.round(rect.left + rect.width / 2)}px`;
    };

    const scheduleDockPosition = () => {
        if (dockFrame) window.cancelAnimationFrame(dockFrame);
        dockFrame = window.requestAnimationFrame(positionSidebarDock);
    };

    const readElementCssPx = (element, propertyName, fallback = 0) => {
        if (!(element instanceof HTMLElement)) return fallback;
        const rawValue = getComputedStyle(element).getPropertyValue(propertyName).trim();
        const px = Number.parseFloat(rawValue);
        return Number.isFinite(px) ? px : fallback;
    };

    const isVerticallyScrollable = (element) => {
        if (!(element instanceof HTMLElement)) return false;
        if (element.hidden || element.getClientRects().length === 0) return false;
        const styles = getComputedStyle(element);
        if (!["auto", "scroll", "overlay"].includes(styles.overflowY)) return false;
        return element.clientHeight > 0 && element.scrollHeight > (element.clientHeight + 1);
    };

    const isMobilePageScrollHostCandidate = (candidate, page) => {
        if (!(candidate instanceof HTMLElement) || candidate === page) return false;
        if (!page.contains(candidate) || !isVerticallyScrollable(candidate)) return false;
        return candidate.clientHeight >= (page.clientHeight * 0.45) && candidate.clientWidth >= (page.clientWidth * 0.6);
    };

    const getMobilePageBottomPaddingScrollHost = (page) => {
        if (!(page instanceof HTMLElement)) return null;
        if (isMobilePageScrollHostCandidate(mobilePagePaddingScrollTarget, page)) return mobilePagePaddingScrollTarget;
        const workspacePanel = $("#workspace_panel");
        if (!(workspacePanel instanceof HTMLElement)) return page;
        const candidates = Array.from(workspacePanel.querySelectorAll(".workspace-header > .chart-surface, .settings-surface, .settings-workspace-header, .timing-surface"));
        let bestCandidate = null;
        let bestHeight = 0;
        for (const candidate of candidates) {
            if (!isMobilePageScrollHostCandidate(candidate, page)) continue;
            if (candidate.clientHeight <= bestHeight) continue;
            bestCandidate = candidate;
            bestHeight = candidate.clientHeight;
        }
        mobilePagePaddingScrollTarget = bestCandidate;
        return bestCandidate || page;
    };

    const syncMobilePageBottomPadMetrics = (page) => {
        if (!(page instanceof HTMLElement)) return {scrollBottomPad: 0, endBottomPad: 0};
        const scrollBottomPad = readElementCssPx(page, "--page-mobile-scroll-bottom-pad-base", readElementCssPx(page, "--page-edge-pad", 10));
        let endBottomPad = readElementCssPx(page, "--page-mobile-end-bottom-pad-base", scrollBottomPad);
        const dock = $(".sidebar-dock");
        if (dock instanceof HTMLElement) {
            const pageRect = page.getBoundingClientRect();
            const dockRect = dock.getBoundingClientRect();
            if (pageRect.height > 0 && dockRect.height > 0) {
                const dockClearance = Math.max(0, pageRect.bottom - dockRect.top);
                endBottomPad = Math.max(scrollBottomPad, Math.ceil(scrollBottomPad + dockClearance));
            }
        }
        page.style.setProperty("--page-mobile-scroll-bottom-pad", `${scrollBottomPad}px`);
        page.style.setProperty("--page-mobile-end-bottom-pad", `${endBottomPad}px`);
        return {scrollBottomPad, endBottomPad};
    };

    const syncMobilePageBottomPadding = ({preserveBottom = false} = {}) => {
        const page = $(".page");
        if (!(page instanceof HTMLElement)) return;
        if (!mobileSidebarMedia.matches) {
            delete page.dataset.mobileScrollEdge;
            page.style.removeProperty("--page-mobile-scroll-bottom-pad");
            page.style.removeProperty("--page-mobile-end-bottom-pad");
            mobilePagePaddingScrollTarget = null;
            return;
        }

        const {scrollBottomPad, endBottomPad} = syncMobilePageBottomPadMetrics(page);
        const scrollHost = getMobilePageBottomPaddingScrollHost(page) || page;
        const isBottomState = page.dataset.mobileScrollEdge === "bottom";
        const activeBottomPad = scrollHost === page && isBottomState ? endBottomPad : scrollBottomPad;
        const contentHeight = scrollHost === page
            ? Math.max(0, scrollHost.scrollHeight - activeBottomPad)
            : scrollHost.scrollHeight;
        const baseBottomScrollTop = scrollHost === page
            ? Math.max(0, contentHeight + scrollBottomPad - scrollHost.clientHeight)
            : Math.max(0, scrollHost.scrollHeight - scrollHost.clientHeight);
        const bottomThreshold = Math.max(2, Math.round(scrollBottomPad));
        const shouldUseEndBottomPad = scrollHost === page
            ? contentHeight <= scrollHost.clientHeight || scrollHost.scrollTop >= (baseBottomScrollTop - bottomThreshold)
            : scrollHost.scrollTop >= (baseBottomScrollTop - bottomThreshold);

        if (scrollHost === page && shouldUseEndBottomPad) page.dataset.mobileScrollEdge = "bottom";
        else delete page.dataset.mobileScrollEdge;

        if (preserveBottom && scrollHost === page && shouldUseEndBottomPad && !isBottomState) {
            window.requestAnimationFrame(() => {
                const targetScrollTop = Math.max(0, contentHeight + endBottomPad - scrollHost.clientHeight);
                if (page.scrollTop < targetScrollTop) page.scrollTop = targetScrollTop;
            });
        }
    };

    const scheduleMobilePageBottomPaddingSync = ({preserveBottom = false} = {}) => {
        if (preserveBottom) mobilePagePaddingShouldPreserveBottom = true;
        if (mobilePagePaddingFrame) return;
        mobilePagePaddingFrame = window.requestAnimationFrame(() => {
            mobilePagePaddingFrame = 0;
            const shouldPreserveBottom = mobilePagePaddingShouldPreserveBottom;
            mobilePagePaddingShouldPreserveBottom = false;
            syncMobilePageBottomPadding({preserveBottom: shouldPreserveBottom});
        });
    };

    const initMobilePageBottomPadding = () => {
        const page = $(".page");
        if (!(page instanceof HTMLElement)) return;
        if (page.dataset.mobileBottomPaddingBound !== "1") {
            page.dataset.mobileBottomPaddingBound = "1";
            page.addEventListener("scroll", () => scheduleMobilePageBottomPaddingSync({preserveBottom: true}), {passive: true});
        }
        if (!mobilePagePaddingScrollBound) {
            mobilePagePaddingScrollBound = true;
            document.addEventListener("scroll", (event) => {
                const pageElement = $(".page");
                if (!(pageElement instanceof HTMLElement)) return;
                const target = event.target;
                if (!(target instanceof HTMLElement)) return;
                if (target !== pageElement && !pageElement.contains(target)) return;
                if (target === pageElement) mobilePagePaddingScrollTarget = null;
                else if (isMobilePageScrollHostCandidate(target, pageElement)) mobilePagePaddingScrollTarget = target;
                scheduleMobilePageBottomPaddingSync({preserveBottom: target === pageElement});
            }, {capture: true, passive: true});
        }
        if (mobilePagePaddingObserver) mobilePagePaddingObserver.disconnect();
        mobilePagePaddingObserver = null;
        if (typeof ResizeObserver === "function") {
            mobilePagePaddingObserver = new ResizeObserver(() => scheduleMobilePageBottomPaddingSync());
            mobilePagePaddingObserver.observe(page);
            const workspacePanel = $("#workspace_panel");
            if (workspacePanel instanceof HTMLElement) mobilePagePaddingObserver.observe(workspacePanel);
        }
        scheduleMobilePageBottomPaddingSync();
    };

    const readThemeModePreference = () => {
        try {
            const stored = window.localStorage.getItem(THEME_MODE_STORAGE_KEY);
            return stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
        } catch (_error) {
            return "system";
        }
    };

    const writeThemeModePreference = (mode) => {
        try {
            window.localStorage.setItem(THEME_MODE_STORAGE_KEY, mode);
        } catch (_error) {
        }
    };

    const applyThemeModePreference = (mode) => {
        const normalizedMode = mode === "light" || mode === "dark" || mode === "system" ? mode : "system";
        const previousMode = document.documentElement.dataset.themeMode;

        if (previousMode && previousMode !== normalizedMode) {
            document.documentElement.classList.add("is-theme-transitioning");
            window.setTimeout(() => document.documentElement.classList.remove("is-theme-transitioning"), 400);
        }

        document.documentElement.dataset.themeMode = normalizedMode;
        if (normalizedMode === "system") {
            document.documentElement.removeAttribute("data-theme-override");
        } else {
            document.documentElement.setAttribute("data-theme-override", normalizedMode);
        }
        window.dispatchEvent(new CustomEvent("antigravity:theme-mode-change", {
            detail: {mode: normalizedMode},
        }));
    };

    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
        if (document.documentElement.dataset.themeMode === "system") {
            window.dispatchEvent(new CustomEvent("antigravity:theme-mode-change", {
                detail: {mode: "system"},
            }));
        }
    });

    const initThemeModeControls = () => {
        const currentMode = readThemeModePreference();
        applyThemeModePreference(currentMode);
        const formElement = document.querySelector("[data-theme-mode-form]");
        if (!(formElement instanceof HTMLFormElement)) return;
        const options = Array.from(formElement.querySelectorAll("[data-theme-mode-option]"));
        options.forEach((option) => {
            if (!(option instanceof HTMLInputElement)) return;
            option.checked = option.value === currentMode;
            if (option.dataset.boundThemeMode === "1") return;
            option.dataset.boundThemeMode = "1";
            option.addEventListener("change", () => {
                if (!option.checked) return;
                writeThemeModePreference(option.value);
                applyThemeModePreference(option.value);
            });
        });
    };

    bootstrap.initThemeModeControls = initThemeModeControls;

    const showWorkspaceModal = (options = {}) => {
        if (!workspaceModalOverlay) return;
        if (workspaceModalOverlayTitle && options.title) workspaceModalOverlayTitle.textContent = options.title;
        if (workspaceModalOverlayCopy && options.copy) workspaceModalOverlayCopy.textContent = options.copy;
        if (workspaceModalOverlayIcon && options.iconClass) {
            workspaceModalOverlayIcon.className = `icon ${options.iconClass} workspace-modal-icon`;
        }
        workspaceModalOverlay.hidden = false;
    };

    const showCompareOverlay = () => {
        showWorkspaceModal({
            title: isBacktestView ? "Running your backtest" : "Preparing your chart",
            copy: isBacktestView
                ? "Please wait while the app prepares the selected daily data and runs the backtest."
                : "Please wait while the app checks local data and prepares the chart. This may take a little longer for a new ticker.",
            iconClass: "icon-overlay-processing",
        });
    };

    const hideWorkspaceModal = () => {
        if (!workspaceModalOverlay) return;
        if (compareOverlayTimer) {
            window.clearTimeout(compareOverlayTimer);
            compareOverlayTimer = null;
        }
        workspaceModalOverlay.hidden = true;
    };

    const scheduleCompareOverlay = () => {
        if (compareOverlayTimer) window.clearTimeout(compareOverlayTimer);
        compareOverlayTimer = window.setTimeout(() => {
            showCompareOverlay();
        }, 180);
    };

    const attachRemoveHandlers = () => {
        $$(".ticker-remove").forEach((button) => {
            if (button.dataset.bound === "1") return;
            button.dataset.bound = "1";
            button.addEventListener("click", () => {
                const field = button.closest(".ticker-field");
                const removedTicker = sanitizeTicker(field?.querySelector("[data-ticker-input]")?.value || "");
                const removedIndex = Number.parseInt(field?.dataset.index || "0", 10) - 1;
                if (isPortfolioView) requestWorkspaceChartTransition("ticker-remove");
                else if (!isBacktestView) clearWorkspaceChartTransitionRequest();
                const removedWeight = isPortfolioView
                    ? Number.parseInt(field?.querySelector(".portfolio-weight-input")?.value || "0", 10) || 0
                    : 0;
                field?.remove();
                reindexTickerFields();
                removeTickerFromComparePreview(removedTicker);
                if (isPortfolioView) {
                    rebalancePortfolioWeightsAfterRemoval(removedWeight, removedIndex);
                    ensurePortfolioWeightTouches();
                    syncPortfolioWeightBounds();
                    syncPortfolioWeightDisabledState();
                    validatePortfolioWeightInputs();
                    dispatchPortfolioPreviewUpdate();
                }
                validateAllTickerInputs();
                syncDateConstraints();
                scheduleAutoSubmit(120);
            });
        });
    };

    const addTickerField = (value = "") => {
        const container = $("#ticker_fields");
        if (!container || getTickerFields().length >= MAX_TICKERS) return;
        const index = getTickerFields().length + 1;
        const field = document.createElement("div");
        field.className = "field ticker-field";
        field.dataset.index = String(index);
        field.innerHTML = `
			<div class="ticker-input-row">
				<div class="ticker-input-main">
					<label for="ticker_${index}">Ticker ${index}</label>
					<div class="ticker-input-control">
						<span class="ticker-leading-slot" aria-hidden="true">
							<span class="ticker-logo-placeholder"></span>
							<img class="ticker-input-logo" alt="" hidden>
						</span>
						<input id="ticker_${index}" name="ticker" data-ticker-input value="${value}" placeholder="e.g. NVDA" autocomplete="off" autocapitalize="characters" spellcheck="false" inputmode="latin" title="Use a valid ticker such as MSFT, GOOGL, NVDA, AMZN, MU, AMD, or META.">
						<button type="button" class="ticker-clear" aria-label="Clear ticker"><span class="icon icon-remove-muted" aria-hidden="true"></span></button>
					</div>
					<div class="field-tooltip field-tooltip-duplicate" hidden>This ticker is already used. Choose a different one.</div>
					<div class="field-tooltip field-tooltip-invalid" hidden>Unknown or unsupported ticker.</div>
					<div class="suggestions" id="ticker_${index}_suggestions"></div>
				</div>
				${isPortfolioView ? `
				<div class="portfolio-weight-field">
					<div class="portfolio-weight-row">
						<input id="weight_${index}" name="weight" class="portfolio-weight-input" type="number" min="0" max="100" step="1" value="0" placeholder="${labels.portfolio_weight}" aria-label="${labels.portfolio_weight}">
						<span class="portfolio-weight-unit">%</span>
					</div>
					<div class="portfolio-weight-slider-shell" aria-hidden="true">
						<input class="portfolio-weight-slider" type="range" min="0" max="100" step="1" value="0" aria-label="${labels.portfolio_weight}">
					</div>
					<div class="portfolio-weight-tooltip field-tooltip" hidden></div>
				</div>` : ""}
				<button type="button" class="ticker-remove" aria-label="Remove ticker"><span class="icon icon-remove-muted" aria-hidden="true"></span></button>
			</div>
		`;
        container.appendChild(field);
        reindexTickerFields();
        if (isPortfolioView) {
            markPortfolioWeightTouched(index - 1);
        }
        attachRemoveHandlers();
        attachTickerClearHandlers();
        attachPortfolioWeightHandlers();
        const input = field.querySelector("[data-ticker-input]");
        setupAutocomplete(input);
        validateAllTickerInputs();
        syncPortfolioWeightDisabledState();
        dispatchPortfolioPreviewUpdate();
        input?.focus();
    };

    const compactTickerInputs = () => {
        const values = getFilledTickers();
        const portfolioEntries = isPortfolioView
            ? getWeightFields()
                .map((item) => ({
                    ticker: sanitizeTicker(item.tickerInput.value.trim()),
                    weight: Number.parseInt(item.number.value, 10) || 0,
                }))
                .filter((item) => item.ticker)
            : [];
        const container = $("#ticker_fields");
        if (!container) return values;
        while (getTickerFields().length > Math.max(minimumRequiredTickers, values.length)) {
            getTickerFields()[getTickerFields().length - 1].remove();
        }
        getTickerInputs().forEach((input, index) => {
            input.value = values[index] || "";
        });
        if (isPortfolioView) {
            getWeightFields().forEach((entry, index) => {
                syncPortfolioWeightPair(entry, portfolioEntries[index]?.weight || 0);
            });
        }
        while (getTickerFields().length < Math.max(minimumRequiredTickers, values.length)) {
            addTickerField(values[getTickerFields().length] || "");
        }
        reindexTickerFields();
        syncPortfolioWeightDisabledState();
        syncPortfolioWeightBounds();
        validateAllTickerInputs();
        return values;
    };

    const form = $("form.controls");
    const periodPanel = $("#period_panel");
    const exactPanel = $("#exact_panel");
    const periodSelect = $("#period");
    const rangeModeInputs = $$("input[name='range']");
    const exactStartInput = $("#exact_start");
    const exactEndInput = $("#exact_end");
    const includeDividendsInput = $("#include_dividends");
    const tradeCapitalField = $(".trade-capital-field");
    const tradeCapitalInput = $("#trade_initial_capital");
    const tradeCapitalSlider = $("#trade_initial_capital_slider");
    const sharedSelectFields = Array.from(document.querySelectorAll("[data-shared-select-field]"));

    const getSharedSelectParts = (field) => {
        if (!(field instanceof HTMLElement)) return null;
        const select = field.querySelector("select");
        const trigger = field.querySelector("[data-shared-select-trigger]");
        const triggerLabel = field.querySelector("[data-shared-select-trigger-label]");
        const dropdown = field.querySelector("[data-shared-select-dropdown]");
        if (!(select instanceof HTMLSelectElement) || !(trigger instanceof HTMLButtonElement) || !(triggerLabel instanceof HTMLElement) || !(dropdown instanceof HTMLElement)) {
            return null;
        }
        return {
            field,
            select,
            trigger,
            triggerLabel,
            dropdown,
        };
    };

    const syncNativeSelectSelection = (select, selectedValue) => {
        if (!(select instanceof HTMLSelectElement)) return;
        const normalizedValue = String(selectedValue || "");
        Array.from(select.options).forEach((option) => {
            const isSelected = Boolean(normalizedValue) && option.value === normalizedValue;
            option.defaultSelected = isSelected;
            option.selected = isSelected;
            if (isSelected) {
                option.setAttribute("selected", "selected");
            } else {
                option.removeAttribute("selected");
            }
        });
        select.value = normalizedValue;
    };

    const SIDEBAR_OVERLAY_GAP_PX = 4;
    const getSidebarOverlayMetrics = (anchorRect, minimumHeight = 120) => {
        if (!(anchorRect instanceof DOMRect)) return null;
        const sidebar = document.querySelector(".sidebar");
        if (!(sidebar instanceof HTMLElement)) return null;
        const sidebarRect = sidebar.getBoundingClientRect();
        const dock = document.querySelector(".sidebar-dock");
        const rootStyles = getComputedStyle(document.documentElement);
        const pageEdgePad = Number.parseFloat(rootStyles.getPropertyValue("--page-edge-pad")) || 10;
        const lowerBoundary = dock instanceof HTMLElement
            ? Math.min(sidebarRect.bottom, dock.getBoundingClientRect().top) - pageEdgePad
            : sidebarRect.bottom - pageEdgePad;
        const availableHeight = Math.max(minimumHeight, lowerBoundary - anchorRect.bottom - SIDEBAR_OVERLAY_GAP_PX);
        return {availableHeight};
    };

    const resetSidebarDropdownPosition = (dropdown) => {
        if (!(dropdown instanceof HTMLElement)) return;
        dropdown.style.left = "";
        dropdown.style.top = "";
        dropdown.style.right = "";
        dropdown.style.width = "";
        dropdown.style.maxHeight = "";
    };

    const positionSidebarDropdownFromTrigger = (trigger, dropdown, container) => {
        if (!(trigger instanceof HTMLElement) || !(dropdown instanceof HTMLElement) || !(container instanceof HTMLElement)) return;
        const triggerRect = trigger.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        const overlayMetrics = getSidebarOverlayMetrics(triggerRect);
        const left = Math.max(0, triggerRect.left - containerRect.left);
        const top = Math.max(0, triggerRect.bottom - containerRect.top + SIDEBAR_OVERLAY_GAP_PX);
        const availableWidth = Math.max(0, containerRect.width - left);
        const width = availableWidth > 0 ? availableWidth : triggerRect.width;
        dropdown.style.left = `${Math.round(left)}px`;
        dropdown.style.top = `${Math.round(top)}px`;
        dropdown.style.right = "auto";
        dropdown.style.width = `${Math.round(width)}px`;
        dropdown.style.maxHeight = overlayMetrics ? `${Math.round(overlayMetrics.availableHeight)}px` : "";
    };

    const positionSharedSelectDropdown = (field) => {
        const parts = getSharedSelectParts(field);
        if (!parts || parts.dropdown.hidden) return;
        const container = parts.dropdown.parentElement;
        positionSidebarDropdownFromTrigger(parts.trigger, parts.dropdown, container instanceof HTMLElement ? container : parts.field);
    };

    const setSharedSelectDropdownOpen = (field, isOpen) => {
        const parts = getSharedSelectParts(field);
        if (!parts) return;
        parts.dropdown.hidden = !isOpen;
        parts.trigger.setAttribute("aria-expanded", isOpen ? "true" : "false");
        parts.field.classList.toggle("is-open", isOpen);
        if (isOpen) {
            positionSharedSelectDropdown(field);
        } else {
            resetSidebarDropdownPosition(parts.dropdown);
        }
    };

    const closeSharedSelectDropdowns = (exceptField = null) => {
        sharedSelectFields.forEach((field) => {
            if (exceptField && field === exceptField) return;
            setSharedSelectDropdownOpen(field, false);
        });
    };

    const syncSharedSelectTriggerLabel = (field) => {
        const parts = getSharedSelectParts(field);
        if (!parts) return;
        const selectedOption = Array.from(parts.select.options).find((option) => option.value === parts.select.value);
        parts.triggerLabel.textContent = selectedOption?.textContent?.trim() || "";
    };

    const renderSharedSelectDropdown = (field) => {
        const parts = getSharedSelectParts(field);
        if (!parts) return;
        const currentSelection = String(parts.select.value || "");
        parts.dropdown.innerHTML = "";
        Array.from(parts.select.options).forEach((option) => {
            const optionButton = document.createElement("button");
            optionButton.type = "button";
            optionButton.className = "trade-strategy-dropdown-option";
            optionButton.dataset.value = option.value;
            optionButton.setAttribute("role", "option");
            optionButton.setAttribute("aria-selected", option.value === currentSelection ? "true" : "false");
            if (option.value === currentSelection) {
                optionButton.classList.add("is-selected", "is-active");
            }

            const checkElement = document.createElement("span");
            checkElement.className = "trade-strategy-dropdown-check";
            checkElement.setAttribute("aria-hidden", "true");

            const copyElement = document.createElement("span");
            copyElement.className = "trade-strategy-dropdown-copy";

            const titleElement = document.createElement("span");
            titleElement.className = "trade-strategy-dropdown-title";
            titleElement.textContent = option.textContent || option.value;

            copyElement.appendChild(titleElement);

            const descriptionText = option.dataset.description?.trim() || "";
            if (descriptionText) {
                const descriptionElement = document.createElement("span");
                descriptionElement.className = "trade-strategy-dropdown-desc";
                descriptionElement.textContent = descriptionText;
                copyElement.appendChild(descriptionElement);
            }

            optionButton.appendChild(checkElement);
            optionButton.appendChild(copyElement);
            optionButton.addEventListener("click", () => {
                if (parts.select.value === option.value) {
                    setSharedSelectDropdownOpen(field, false);
                    return;
                }
                syncNativeSelectSelection(parts.select, option.value);
                syncSharedSelectTriggerLabel(field);
                renderSharedSelectDropdown(field);
                setSharedSelectDropdownOpen(field, false);
                parts.select.dispatchEvent(new Event("change", {bubbles: true}));
            });
            parts.dropdown.appendChild(optionButton);
        });
    };

    const refreshSharedSelectField = (field) => {
        syncSharedSelectTriggerLabel(field);
        renderSharedSelectDropdown(field);
    };

    const initializeSharedSelectField = (field) => {
        const parts = getSharedSelectParts(field);
        if (!parts || parts.field.dataset.sharedSelectBound === "1") return;
        parts.field.dataset.sharedSelectBound = "1";
        refreshSharedSelectField(field);
        parts.trigger.addEventListener("click", () => {
            const shouldOpen = parts.dropdown.hidden;
            closeSharedSelectDropdowns(field);
            setTradeStrategyDropdownOpen(false);
            setTradeStrategyPanelOpen(false);
            renderSharedSelectDropdown(field);
            setSharedSelectDropdownOpen(field, shouldOpen);
        });
        parts.select.addEventListener("change", () => {
            syncNativeSelectSelection(parts.select, parts.select.value);
            refreshSharedSelectField(field);
        });
    };

    const getBacktestIntervalShell = () => document.querySelector("[data-backtest-interval-shell]");
    const getBacktestIntervalInputs = () => Array.from(document.querySelectorAll("[data-backtest-interval-input]"))
        .filter((input) => input instanceof HTMLInputElement);
    const getSelectedBacktestInterval = () => {
        const selectedInput = getBacktestIntervalInputs().find((input) => input.checked && !input.disabled);
        return selectedInput?.value || "1d";
    };
    const syncBacktestIntervalSegmentedControl = () => {
        const shell = getBacktestIntervalShell();
        if (!(shell instanceof HTMLElement)) return;
        const options = Array.from(shell.querySelectorAll(".segmented-control-option"))
            .filter((option) => option instanceof HTMLElement)
            .filter((option) => {
                const input = option.querySelector("input");
                return input instanceof HTMLInputElement && !option.hidden && !input.disabled;
            });
        const activeIndex = Math.max(0, options.findIndex((option) => {
            const input = option.querySelector("input");
            return input instanceof HTMLInputElement && input.checked;
        }));
        shell.dataset.active = getSelectedBacktestInterval();
        shell.dataset.optionCount = String(Math.max(options.length, 1));
        shell.style.setProperty("--segmented-option-count", String(Math.max(options.length, 1)));
        shell.style.setProperty("--segmented-active-index", String(activeIndex));
    };
    const setBacktestIntervalAvailability = (has1m) => {
        getBacktestIntervalInputs().forEach((input) => {
            const option = input.closest(".segmented-control-option");
            if (!(option instanceof HTMLElement)) return;
            const isSupported = input.value !== "1m" || has1m;
            input.disabled = !isSupported;
            option.hidden = !isSupported;
        });
        syncBacktestIntervalSegmentedControl();
    };
    const setBacktestIntervalValue = (value) => {
        const nextInput = getBacktestIntervalInputs().find((input) => input.value === value && !input.disabled);
        if (!(nextInput instanceof HTMLInputElement)) return false;
        if (!nextInput.checked) {
            nextInput.checked = true;
        }
        syncBacktestIntervalSegmentedControl();
        return true;
    };
    const buildUtcDate = (yearValue, monthIndexValue, dayValue) => {
        const year = Number.parseInt(yearValue, 10);
        const monthIndex = Number.parseInt(monthIndexValue, 10);
        const day = Number.parseInt(dayValue, 10);
        if (![year, monthIndex, day].every(Number.isInteger)) return null;
        const candidate = new Date(Date.UTC(year, monthIndex, day));
        if (
            candidate.getUTCFullYear() !== year
            || candidate.getUTCMonth() !== monthIndex
            || candidate.getUTCDate() !== day
        ) {
            return null;
        }
        return candidate;
    };
    const parseIsoDate = (rawValue) => {
        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(rawValue || ""));
        if (!match) return null;
        return buildUtcDate(match[1], Number.parseInt(match[2], 10) - 1, match[3]);
    };

    const formatIsoDate = (date) => {
        const year = date.getUTCFullYear();
        const month = String(date.getUTCMonth() + 1).padStart(2, "0");
        const day = String(date.getUTCDate()).padStart(2, "0");
        return `${year}-${month}-${day}`;
    };

    const padTwo = (value) => String(value).padStart(2, "0");
    const readFullDateFormat = () => String(window.ANTIGRAVITY_APP?.dateDisplay?.full || "d_mmm_yyyy");
    const readShortDateFormat = () => String(window.ANTIGRAVITY_APP?.dateDisplay?.short || "yyyy_mm_dd");
    const buildFullDateLayout = (dateParts) => {
        if (!dateParts) return {tokens: [], wrapAfterIndex: 1};
        const year = Number(dateParts.year);
        const monthIndex = Number(dateParts.monthIndex);
        const day = Number(dateParts.day);
        const monthLabel = MONTH_ABBREVIATIONS[Math.max(0, Math.min(11, monthIndex))] || "";
        const fullFormat = readFullDateFormat();
        const paddedDay = padTwo(day);
        if (fullFormat === "dd_mmm_yyyy") {
            return {tokens: [paddedDay, monthLabel, `${year}`], wrapAfterIndex: 1};
        }
        if (fullFormat === "yyyy_mmm_d") {
            return {tokens: [`${year}`, monthLabel, `${day}`], wrapAfterIndex: 0};
        }
        if (fullFormat === "yyyy_mmm_dd") {
            return {tokens: [`${year}`, monthLabel, paddedDay], wrapAfterIndex: 0};
        }
        return {tokens: [`${day}`, monthLabel, `${year}`], wrapAfterIndex: 1};
    };
    const formatFullDateParts = (dateParts, {includeTime = false, includeSeconds = false} = {}) => {
        if (!dateParts) return "";
        const {tokens} = buildFullDateLayout(dateParts);
        const baseDate = tokens.join(" ");
        if (!includeTime) return baseDate;
        const hasHours = Number.isInteger(dateParts.hours);
        const hasMinutes = Number.isInteger(dateParts.minutes);
        if (!hasHours || !hasMinutes) return baseDate;
        const timeText = includeSeconds && Number.isInteger(dateParts.seconds)
            ? `${padTwo(dateParts.hours)}:${padTwo(dateParts.minutes)}:${padTwo(dateParts.seconds)}`
            : `${padTwo(dateParts.hours)}:${padTwo(dateParts.minutes)}`;
        return `${baseDate} ${timeText}`;
    };
    const formatShortDateParts = (dateParts) => {
        if (!dateParts) return "";
        const year = Number(dateParts.year);
        const month = Number(dateParts.monthIndex) + 1;
        const day = Number(dateParts.day);
        if (readShortDateFormat() === "dd_mm_yyyy") {
            return `${padTwo(day)}/${padTwo(month)}/${year}`;
        }
        return `${year}/${padTwo(month)}/${padTwo(day)}`;
    };
    const formatFullDateLines = (dateParts, {allowWrap = true} = {}) => {
        if (!dateParts) return ["", ""];
        if (!allowWrap) return [formatFullDateParts(dateParts), ""];
        const {tokens, wrapAfterIndex} = buildFullDateLayout(dateParts);
        const hasHours = Number.isInteger(dateParts.hours);
        const hasMinutes = Number.isInteger(dateParts.minutes);
        const firstLine = tokens.slice(0, wrapAfterIndex + 1).join(" ");
        const secondLineTokens = tokens.slice(wrapAfterIndex + 1);
        const secondLineBase = secondLineTokens.join(" ");
        if (!hasHours || !hasMinutes) return [firstLine, secondLineBase];
        const timeText = `${padTwo(dateParts.hours)}:${padTwo(dateParts.minutes)}`;
        return [firstLine, secondLineBase ? `${secondLineBase} ${timeText}` : timeText];
    };
    const formatPickerMonthLabel = (date) => {
        if (!(date instanceof Date)) return "";
        const monthLabel = MONTH_LABELS[date.getUTCMonth()] || "";
        const year = date.getUTCFullYear();
        return readFullDateFormat().startsWith("yyyy_") ? `${year} ${monthLabel}` : `${monthLabel} ${year}`;
    };
    const getDateEntryExample = () => formatFullDateParts({year: 2025, monthIndex: 5, day: 5});
    const getDateEntryHint = () => `${getDateEntryExample()} or 2025-06-05`;
    const getShortDatePlaceholder = () => readShortDateFormat() === "dd_mm_yyyy" ? "00/00/0000" : "0000/00/00";
    const formatDisplayDate = (rawValue) => {
        const date = parseIsoDate(rawValue);
        if (!date) return "Select date";
        return formatFullDateParts({
            year: date.getUTCFullYear(),
            monthIndex: date.getUTCMonth(),
            day: date.getUTCDate(),
        });
    };
    const parseMonthToken = (rawValue) => {
        const normalized = String(rawValue || "").trim().toLowerCase().replace(/\.$/, "");
        if (!normalized) return null;
        return Number.isInteger(MONTH_TOKEN_TO_INDEX[normalized]) ? MONTH_TOKEN_TO_INDEX[normalized] : null;
    };
    const parseManualDateInput = (rawValue) => {
        const normalized = String(rawValue || "").trim().replace(/,/g, " ");
        if (!normalized) return null;
        const isoMatch = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(normalized);
        if (isoMatch) {
            return buildUtcDate(isoMatch[1], Number.parseInt(isoMatch[2], 10) - 1, isoMatch[3]);
        }
        const shortMatch = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(normalized);
        if (shortMatch && readShortDateFormat() === "dd_mm_yyyy") {
            return buildUtcDate(shortMatch[3], Number.parseInt(shortMatch[2], 10) - 1, shortMatch[1]);
        }
        const tokenized = normalized.split(/\s+/);
        if (tokenized.length !== 3) return null;
        const monthIndex = parseMonthToken(tokenized[1]);
        if (!Number.isInteger(monthIndex)) return null;
        if (/^\d{4}$/.test(tokenized[0])) {
            return buildUtcDate(tokenized[0], monthIndex, tokenized[2]);
        }
        if (/^\d{4}$/.test(tokenized[2])) {
            return buildUtcDate(tokenized[2], monthIndex, tokenized[0]);
        }
        return null;
    };
    bootstrap.dateDisplay = {
        formatFullDateParts,
        formatShortDateParts,
        formatFullDateLines,
        formatPickerMonthLabel,
        getShortDatePlaceholder,
    };

    const startOfMonthUtc = (date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
    const addMonthsUtc = (date, offset) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset, 1));
    const isSameUtcDay = (left, right) => (
        left.getUTCFullYear() === right.getUTCFullYear()
        && left.getUTCMonth() === right.getUTCMonth()
        && left.getUTCDate() === right.getUTCDate()
    );
    const clampDateToBounds = (date, minDate, maxDate) => {
        if (minDate && date < minDate) return minDate;
        if (maxDate && date > maxDate) return maxDate;
        return date;
    };
    const MS_PER_DAY = 24 * 60 * 60 * 1000;
    const PERIOD_DAY_SPANS = {
        "1d": 1,
        "3d": 3,
        "1w": 7,
        "2w": 14,
    };
    const PERIOD_MONTH_SPANS = {
        "1mo": 1,
        "3mo": 3,
        "6mo": 6,
        "1y": 12,
        "2y": 24,
        "3y": 36,
        "5y": 60,
        "10y": 120,
    };
    const PERIOD_LABELS = {
        "1d": "1 day",
        "3d": "3 days",
        "1w": "1 week",
        "2w": "2 weeks",
        "1mo": "1 month",
        "3mo": "3 months",
        "6mo": "6 months",
        "1y": "1 year",
        "2y": "2 years",
        "3y": "3 years",
        "5y": "5 years",
        "10y": "10 years",
        "max": "Max",
    };

    const shiftMonthsUtc = (date, months) => {
        const year = date.getUTCFullYear();
        const month = date.getUTCMonth();
        const day = date.getUTCDate();
        const targetMonthStart = new Date(Date.UTC(year, month + months, 1));
        const targetYear = targetMonthStart.getUTCFullYear();
        const targetMonth = targetMonthStart.getUTCMonth();
        const targetMonthEnd = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
        return new Date(Date.UTC(targetYear, targetMonth, Math.min(day, targetMonthEnd)));
    };

    const diffDaysUtc = (start, end) => Math.max(0, Math.round((end.getTime() - start.getTime()) / MS_PER_DAY));

    const getRenderedChartDateRange = () => {
        if (isBacktestView) {
            const dates = state.backtestResult?.chart?.dates;
            if (Array.isArray(dates) && dates.length) {
                return {
                    start: String(dates[0]),
                    end: String(dates[dates.length - 1]),
                };
            }
        }
        const firstSeriesDates = state.chart?.series?.[0]?.dates;
        if (Array.isArray(firstSeriesDates) && firstSeriesDates.length) {
            return {
                start: String(firstSeriesDates[0]),
                end: String(firstSeriesDates[firstSeriesDates.length - 1]),
            };
        }
        if (exactStartInput?.value && exactEndInput?.value) {
            return {
                start: exactStartInput.value,
                end: exactEndInput.value,
            };
        }
        return null;
    };

    const syncExactInputsToRenderedRange = () => {
        if (!exactStartInput || !exactEndInput) return false;
        const range = getRenderedChartDateRange();
        if (!range?.start || !range?.end) return false;
        exactStartInput.value = range.start;
        exactEndInput.value = range.end;
        refreshDatePickers();
        return true;
    };

    const chooseRelativePeriodForExactRange = () => {
        if (!periodSelect || !exactStartInput?.value || !exactEndInput?.value) return null;
        const exactStartDate = parseIsoDate(exactStartInput.value);
        const exactEndDate = parseIsoDate(exactEndInput.value);
        const maxDate = parseIsoDate(exactEndInput.max || exactEndInput.value);
        const minDate = parseIsoDate(exactStartInput.min || exactStartInput.value);
        if (!exactStartDate || !exactEndDate || !maxDate) return null;

        const exactDurationDays = diffDaysUtc(exactStartDate, exactEndDate);
        const availableDurationDays = minDate ? diffDaysUtc(minDate, maxDate) : exactDurationDays;
        const nonMaxOptions = Array.from(periodSelect.options)
            .map((option) => option.value)
            .filter((value) => value && value !== "max" && (PERIOD_MONTH_SPANS[value] || PERIOD_DAY_SPANS[value]));

        const intervalSelect = document.getElementById("backtest_interval");
        const currentInterval = intervalSelect ? intervalSelect.value : "1d";
        const fallbackOption = currentInterval === "1m" ? "1w" : "1y";

        if (!nonMaxOptions.length) {
            const fallbackEl = periodSelect.querySelector(`option[value="${fallbackOption}"]`);
            return fallbackEl ? fallbackOption : (periodSelect.value || null);
        }

        const candidates = nonMaxOptions.map((value) => {
            let candidateStart;
            if (PERIOD_MONTH_SPANS[value]) {
                const months = PERIOD_MONTH_SPANS[value];
                candidateStart = shiftMonthsUtc(maxDate, -months);
            } else {
                const days = PERIOD_DAY_SPANS[value];
                candidateStart = new Date(maxDate.getTime() - days * MS_PER_DAY);
            }
            const candidateDurationDays = diffDaysUtc(candidateStart, maxDate);
            const coversExactEnd = exactEndDate >= candidateStart && exactEndDate <= maxDate;
            return {
                value,
                candidateDurationDays,
                durationGap: Math.abs(candidateDurationDays - exactDurationDays),
                coveragePenalty: coversExactEnd ? 0 : 1,
            };
        });

        candidates.sort((left, right) => (
            left.durationGap - right.durationGap
            || left.coveragePenalty - right.coveragePenalty
            || left.candidateDurationDays - right.candidateDurationDays
        ));

        const longestCandidateDays = Math.max(...candidates.map((item) => item.candidateDurationDays));
        if (periodSelect.querySelector('option[value="max"]')) {
            const closeToEarliestBound = minDate && diffDaysUtc(minDate, exactStartDate) <= 3;
            if (exactDurationDays > longestCandidateDays || closeToEarliestBound || exactDurationDays >= availableDurationDays - 3) {
                return "max";
            }
        }

        return candidates[0]?.value || fallbackOption;
    };

    let lastRangeMode = $("input[name='range']:checked")?.value || defaults.range_mode;

    const clampTradeCapital = (value) => Math.min(1000000, Math.max(1, value || 1));
    const parseTradeCapitalValue = (rawValue) => {
        const normalized = String(rawValue || "").replace(/,/g, "").trim();
        const parsed = Number.parseFloat(normalized);
        return Number.isFinite(parsed) ? clampTradeCapital(parsed) : 10000;
    };
    const formatTradeCapitalValue = (value) => new Intl.NumberFormat("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(clampTradeCapital(value));

    const updateRangePanels = () => {
        const rangeMode = $("input[name='range']:checked")?.value || defaults.range_mode;
        const rangeShell = $(".range-mode-shell");
        if (rangeShell) {
            rangeShell.dataset.active = rangeMode;
        }
        const isPeriodMode = rangeMode === "period";
        if (periodPanel) {
            periodPanel.hidden = !isPeriodMode;
            periodPanel.setAttribute("aria-hidden", String(!isPeriodMode));
            periodPanel.style.display = isPeriodMode ? "" : "none";
        }
        if (!isPeriodMode) {
            closeSharedSelectDropdowns(periodPanel?.querySelector("[data-shared-select-field]"));
            setSharedSelectDropdownOpen(periodPanel?.querySelector("[data-shared-select-field]"), false);
        }
        if (exactPanel) {
            exactPanel.hidden = isPeriodMode;
            exactPanel.setAttribute("aria-hidden", String(isPeriodMode));
            exactPanel.style.display = isPeriodMode ? "none" : "";
        }
        if (isPeriodMode) closeAllDatePickers();
    };

    const canAutoSubmit = () => {
        if (!form) return false;
        if (!hasInitialResult && !isBacktestView) return false;
        const values = getFilledTickers();
        if (values.length < minimumRequiredTickers) return false;
        if (new Set(values).size !== values.length) return false;
        if (isPortfolioView) {
            const totalWeight = getFilledWeightEntries().reduce((sum, entry) => sum + (Number.parseInt(entry.number.value, 10) || 0), 0);
            if (totalWeight !== 100) return false;
        }
        validateAllTickerInputs();
        if (isTickerValidationPending()) return false;
        if (getTickerInputs().some((input) => !input.checkValidity() || input.dataset.unknown === "1")) return false;
        const rangeMode = $("input[name='range']:checked")?.value || defaults.range_mode;
        if (rangeModeInputs.length && rangeMode === "exact" && (!exactStartInput?.value || !exactEndInput?.value)) return false;
        return true;
    };

    const scheduleAutoSubmit = (delay = 240) => {
        if (!canAutoSubmit()) return;
        if (autoSubmitTimer) window.clearTimeout(autoSubmitTimer);
        autoSubmitTimer = window.setTimeout(() => {
            if (!canAutoSubmit() || isSubmittingWithOverlay) return;
            form.requestSubmit();
        }, delay);
    };

    const closeAllDatePickers = () => {
        datePickerState.forEach((picker) => {
            picker.popover.hidden = true;
            picker.trigger.setAttribute("aria-expanded", "false");
        });
        syncDatePickerPeerHighlight();
    };

    const isInsideDatePicker = (picker, target) => (
        Boolean(target)
        && (picker.wrapper.contains(target) || picker.popover.contains(target))
    );

    const isInsideAnyDatePicker = (target) => (
        datePickerState.some((picker) => isInsideDatePicker(picker, target))
    );

    const positionDatePickerPopover = (picker) => {
        const triggerRect = picker.trigger.getBoundingClientRect();
        const popoverWidth = Math.min(320, window.innerWidth - 48);
        const leftBoundary = 12;
        const rightBoundary = window.innerWidth - 12;
        const maxLeft = Math.max(leftBoundary, rightBoundary - popoverWidth);
        const preferredTop = triggerRect.bottom + 8;
        const top = Math.min(preferredTop, window.innerHeight - 24);
        const left = Math.min(Math.max(triggerRect.left, leftBoundary), maxLeft);
        picker.popover.style.top = `${Math.round(top)}px`;
        picker.popover.style.left = `${Math.round(left)}px`;
    };

    const getDatePickerPeer = (picker) => {
        if (!picker?.role) return null;
        const peerRole = picker.role === "start" ? "end" : picker.role === "end" ? "start" : "";
        if (!peerRole) return null;
        return datePickerState.find((candidate) => candidate.role === peerRole) || null;
    };

    const syncDatePickerPeerHighlight = () => {
        datePickerState.forEach((picker) => {
            picker.wrapper.classList.remove("is-peer-highlight");
        });
        const activePicker = datePickerState.find((picker) => !picker.popover.hidden);
        const peerPicker = activePicker ? getDatePickerPeer(activePicker) : null;
        if (peerPicker) {
            peerPicker.wrapper.classList.add("is-peer-highlight");
        }
    };

    const normalizeDatePickerDraft = (rawValue) => String(rawValue || "")
        .replace(/\u00a0/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    const getDatePickerComparableIsoValue = (picker) => {
        if (!picker) return "";
        const rawDraft = normalizeDatePickerDraft(picker.draftText);
        if (!rawDraft) return String(picker.input?.value || "");
        const parsedDate = parseManualDateInput(rawDraft);
        return parsedDate ? formatIsoDate(parsedDate) : String(picker.input?.value || "");
    };

    const getDatePickerWorkingState = (picker) => {
        const rawDraft = normalizeDatePickerDraft(picker.draftText);
        if (rawDraft) {
            const parsedDate = parseManualDateInput(rawDraft);
            if (!parsedDate) {
                return {
                    displayText: rawDraft,
                    previewDate: null,
                    previewIsoValue: "",
                    validationMessage: `Enter a valid date like ${getDateEntryHint()}.`,
                };
            }
            const previewIsoValue = formatIsoDate(parsedDate);
            return {
                displayText: rawDraft,
                previewDate: parsedDate,
                previewIsoValue,
                validationMessage: getDatePickerValidationMessage(picker, previewIsoValue),
            };
        }
        const committedIsoValue = String(picker.input.value || "");
        return {
            displayText: committedIsoValue ? formatDisplayDate(committedIsoValue) : "",
            previewDate: parseIsoDate(committedIsoValue),
            previewIsoValue: committedIsoValue,
            validationMessage: String(picker.validationMessage || ""),
        };
    };

    const syncDatePickerEditorText = (picker, nextText, {force = false} = {}) => {
        if (!picker.triggerValue) return;
        const normalizedNextText = String(nextText || "");
        picker.triggerValue.dataset.empty = normalizedNextText ? "0" : "1";
        if (!force && document.activeElement === picker.triggerValue) return;
        if (picker.triggerValue.textContent !== normalizedNextText) {
            picker.triggerValue.textContent = normalizedNextText;
        }
    };

    const applyDatePickerValidationState = (picker, workingState = getDatePickerWorkingState(picker)) => {
        const message = String(workingState.validationMessage || "");
        syncDatePickerEditorText(picker, workingState.displayText, {force: Boolean(picker.forceDisplaySync)});
        picker.forceDisplaySync = false;
        picker.trigger.classList.toggle("is-invalid", Boolean(message));
        picker.triggerValue.classList.toggle("is-invalid", Boolean(message));
        picker.triggerValue.setAttribute("aria-invalid", message ? "true" : "false");
        if (picker.feedback) picker.feedback.textContent = message;
    };

    const getDatePickerValidationMessage = (picker, isoValue) => {
        if (!isoValue) return "Enter a date.";
        const selectedDate = parseIsoDate(isoValue);
        if (!selectedDate) return `Enter a valid date like ${getDateEntryHint()}.`;
        const minDate = parseIsoDate(picker.input.min);
        const maxDate = parseIsoDate(picker.input.max);
        if (minDate && selectedDate < minDate) {
            return `Choose a date on or after ${formatDisplayDate(picker.input.min)}.`;
        }
        if (maxDate && selectedDate > maxDate) {
            return `Choose a date on or before ${formatDisplayDate(picker.input.max)}.`;
        }
        const peerPicker = getDatePickerPeer(picker);
        const peerDate = parseIsoDate(getDatePickerComparableIsoValue(peerPicker));
        if (picker.role === "start" && peerDate && selectedDate > peerDate) {
            return `${labels.start} must be on or before ${labels.to}.`;
        }
        if (picker.role === "end" && peerDate && selectedDate < peerDate) {
            return `${labels.to} must be on or after ${labels.start}.`;
        }
        if (validTradingDateSet && !validTradingDateSet.has(isoValue)) {
            return "Choose a shared trading day for the selected tickers.";
        }
        return "";
    };

    const updateDatePickerValue = (picker, isoValue, {emitChange = false, closePopover = false} = {}) => {
        picker.draftText = "";
        picker.validationMessage = "";
        picker.input.value = isoValue;
        picker.forceSyncMonth = true;
        picker.forceDisplaySync = true;
        refreshDatePickers();
        if (closePopover) closeAllDatePickers();
        if (emitChange) picker.input.dispatchEvent(new Event("change", {bubbles: true}));
    };

    const commitDatePickerTextInput = (picker, {emitChange = false, closePopover = false} = {}) => {
        const rawValue = normalizeDatePickerDraft(picker.triggerValue.textContent);
        if (!rawValue) {
            picker.draftText = "";
            picker.validationMessage = "Enter a date.";
            picker.input.value = "";
            picker.forceSyncMonth = true;
            picker.forceDisplaySync = true;
            refreshDatePickers();
            if (emitChange) picker.input.dispatchEvent(new Event("change", {bubbles: true}));
            return;
        }
        const parsedDate = parseManualDateInput(rawValue);
        if (!parsedDate) {
            picker.draftText = rawValue;
            picker.validationMessage = "";
            picker.input.value = "";
            picker.forceSyncMonth = true;
            refreshDatePickers();
            if (emitChange) picker.input.dispatchEvent(new Event("change", {bubbles: true}));
            return;
        }
        const isoValue = formatIsoDate(parsedDate);
        const validationMessage = getDatePickerValidationMessage(picker, isoValue);
        if (validationMessage) {
            picker.draftText = rawValue;
            picker.validationMessage = "";
            picker.input.value = "";
            picker.forceSyncMonth = true;
            refreshDatePickers();
            if (emitChange) picker.input.dispatchEvent(new Event("change", {bubbles: true}));
            return;
        }
        updateDatePickerValue(picker, isoValue, {emitChange, closePopover});
    };

    const syncDatePickerView = (picker) => {
        const workingState = getDatePickerWorkingState(picker);
        applyDatePickerValidationState(picker, workingState);
        const selectedDate = workingState.previewDate;
        const minDate = parseIsoDate(picker.input.min);
        const maxDate = parseIsoDate(picker.input.max);
        const peerPicker = getDatePickerPeer(picker);
        const peerDate = parseIsoDate(getDatePickerComparableIsoValue(peerPicker));
        const today = startOfMonthUtc(new Date());
        const anchorDate = selectedDate || clampDateToBounds(parseIsoDate(picker.input.value) || minDate || maxDate || today, minDate, maxDate);
        const hasPreviewValidationMessage = Boolean(workingState.validationMessage && selectedDate);
        if (!picker.visibleMonth || picker.forceSyncMonth) {
            picker.visibleMonth = startOfMonthUtc(anchorDate);
            picker.forceSyncMonth = false;
        }
        picker.monthLabel.textContent = formatPickerMonthLabel(picker.visibleMonth);
        picker.grid.innerHTML = "";

        const firstDay = startOfMonthUtc(picker.visibleMonth);
        const monthStartOffset = firstDay.getUTCDay();
        const gridStart = new Date(Date.UTC(firstDay.getUTCFullYear(), firstDay.getUTCMonth(), 1 - monthStartOffset));
        for (let offset = 0; offset < 42; offset += 1) {
            const cellDate = new Date(Date.UTC(gridStart.getUTCFullYear(), gridStart.getUTCMonth(), gridStart.getUTCDate() + offset));
            const isoValue = formatIsoDate(cellDate);
            const isCurrentMonth = cellDate.getUTCMonth() === picker.visibleMonth.getUTCMonth();
            const isBeforeMin = minDate && cellDate < minDate;
            const isAfterMax = maxDate && cellDate > maxDate;
            const violatesPeerRange = (
                (picker.role === "start" && peerDate && cellDate > peerDate)
                || (picker.role === "end" && peerDate && cellDate < peerDate)
            );
            const isTradingDay = !validTradingDateSet || validTradingDateSet.has(isoValue);
            const isPeerBoundary = peerDate && isSameUtcDay(cellDate, peerDate);
            const button = document.createElement("button");
            button.type = "button";
            button.className = "date-picker-day";
            if (!isCurrentMonth) button.classList.add("is-muted");
            if (isBeforeMin || isAfterMax || !isTradingDay || violatesPeerRange) button.classList.add("is-disabled");
            if (selectedDate && isSameUtcDay(cellDate, selectedDate)) {
                button.classList.add(hasPreviewValidationMessage ? "is-preview-invalid" : "is-selected");
            }
            if (isPeerBoundary) button.classList.add("is-peer-boundary");
            if (isSameUtcDay(cellDate, new Date())) button.classList.add("is-today");
            button.textContent = String(cellDate.getUTCDate());
            button.dataset.value = isoValue;
            button.disabled = Boolean(isBeforeMin || isAfterMax || !isTradingDay || violatesPeerRange);
            button.addEventListener("click", () => {
                updateDatePickerValue(picker, isoValue, {emitChange: true, closePopover: true});
            });
            picker.grid.appendChild(button);
        }
    };

    const initializeDatePickers = () => {
        $$("[data-date-picker]").forEach((wrapper) => {
            if (wrapper.dataset.bound === "1") return;
            const input = wrapper.querySelector('input[type="hidden"]');
            const trigger = wrapper.querySelector("[data-date-trigger]");
            const triggerValue = wrapper.querySelector("[data-date-trigger-value]");
            const popover = wrapper.querySelector("[data-date-popover]");
            const feedback = wrapper.querySelector("[data-date-feedback]");
            const monthLabel = wrapper.querySelector("[data-date-month]");
            const grid = wrapper.querySelector("[data-date-grid]");
            if (!input || !trigger || !triggerValue || !popover || !feedback || !monthLabel || !grid) return;
            const picker = {
                wrapper,
                input,
                trigger,
                triggerValue,
                popover,
                feedback,
                monthLabel,
                grid,
                role: wrapper.dataset.dateRole || "",
                visibleMonth: null,
                forceSyncMonth: true,
                forceDisplaySync: true,
                draftText: "",
                validationMessage: "",
            };
            wrapper.dataset.bound = "1";
            // Ensure popover is not clipped by sidebar or parents with overflow/transform.
            // NOTE: nav buttons are inside the popover, so bind nav listeners BEFORE moving the popover.
            popover.querySelectorAll("[data-date-nav]").forEach((button) => {
                button.addEventListener("click", (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    picker.forceSyncMonth = false;
                    picker.visibleMonth = addMonthsUtc(
                        picker.visibleMonth || startOfMonthUtc(new Date()),
                        Number.parseInt(button.dataset.dateNav || "0", 10),
                    );
                    syncDatePickerView(picker);
                    positionDatePickerPopover(picker);
                });
            });
            if (popover.parentElement !== document.body) {
                document.body.appendChild(popover);
            }
            datePickerState.push(picker);
            syncDatePickerView(picker);
            const openDatePicker = ({focusEditor = false} = {}) => {
                if (popover.hidden) {
                    closeAllDatePickers();
                }
                picker.forceSyncMonth = true;
                syncDatePickerView(picker);
                popover.hidden = false;
                trigger.setAttribute("aria-expanded", "true");
                syncDatePickerPeerHighlight();
                positionDatePickerPopover(picker);
                if (focusEditor) picker.triggerValue.focus();
            };
            trigger.addEventListener("click", () => {
                openDatePicker();
            });
            triggerValue.addEventListener("focus", () => {
                openDatePicker();
            });
            triggerValue.addEventListener("input", () => {
                picker.draftText = normalizeDatePickerDraft(triggerValue.textContent);
                picker.validationMessage = "";
                triggerValue.dataset.empty = picker.draftText ? "0" : "1";
                picker.forceSyncMonth = true;
                refreshDatePickers();
            });
            triggerValue.addEventListener("blur", (event) => {
                if (isInsideDatePicker(picker, event.relatedTarget)) return;
                commitDatePickerTextInput(picker, {emitChange: true});
            });
            triggerValue.addEventListener("keydown", (event) => {
                if (event.key === "Enter") {
                    event.preventDefault();
                    commitDatePickerTextInput(picker, {emitChange: true, closePopover: true});
                }
                if (event.key === "Escape") {
                    event.preventDefault();
                    picker.draftText = "";
                    picker.validationMessage = "";
                    picker.forceDisplaySync = true;
                    syncDatePickerView(picker);
                    closeAllDatePickers();
                    triggerValue.blur();
                }
            });
            input.addEventListener("change", () => {
                picker.forceSyncMonth = true;
                picker.forceDisplaySync = true;
                picker.draftText = "";
                picker.validationMessage = "";
                syncDatePickerView(picker);
                syncDatePickerPeerHighlight();
            });
        });
        document.addEventListener("pointerdown", (event) => {
            if (isInsideAnyDatePicker(event.target)) return;
            closeAllDatePickers();
        });
        window.addEventListener("resize", () => {
            datePickerState.forEach((picker) => {
                if (!picker.popover.hidden) positionDatePickerPopover(picker);
            });
        });
    };

    const refreshDatePickers = () => {
        datePickerState.forEach((picker) => syncDatePickerView(picker));
        syncDatePickerPeerHighlight();
    };

    const buildCleanWorkspaceUrl = () => {
        const params = new URLSearchParams();
        const tickers = getFilledTickers();
        tickers.forEach((ticker) => params.append("ticker", ticker));

        const rangeMode = $("input[name='range']:checked")?.value || defaults.range_mode;
        if (rangeMode === "exact") {
            params.set("range", "exact");
            if (exactStartInput?.value) params.set("from", exactStartInput.value);
            if (exactEndInput?.value) params.set("to", exactEndInput.value);
        } else {
            const periodValue = $("#period")?.value || defaults.period;
            if (periodValue) params.set("period", periodValue);
        }

        if (includeDividendsInput?.checked) params.set("dividends", "1");

        if (isPortfolioView) {
            getFilledWeightEntries().forEach((entry) => {
                params.append("weight", String(Number.parseInt(entry.number.value, 10) || 0));
            });
        }

        if (isBacktestView) {
            const strategySelect = $("#trade_strategy");
            const capitalValue = parseTradeCapitalValue(tradeCapitalInput?.value);
            const intervalValue = getSelectedBacktestInterval();
            if (intervalValue) params.set("interval", intervalValue);
            if (strategySelect?.value) params.set("strategy", strategySelect.value);
            if (Number.isFinite(capitalValue)) params.set("capital", String(capitalValue));
            collectStrategyParamEntries().forEach(([key, value]) => {
                if (key) params.set(key, value);
            });
        }

        const queryString = params.toString();
        return queryString ? `${window.location.pathname}?${queryString}` : window.location.pathname;
    };

    const buildPeriodOptionDefs = (periodValues) => (
        Array.from(periodValues || []).map((value) => ({
            value,
            label: PERIOD_LABELS[value] || value,
        }))
    );

    const replacePeriodOptions = (periodValues, preferredFallback = null) => {
        const periodSelect = document.getElementById("period");
        if (!periodSelect) return;
        const currentPeriod = periodSelect.value;
        const nextOptions = buildPeriodOptionDefs(periodValues);
        if (!nextOptions.length) return;
        periodSelect.innerHTML = "";
        nextOptions.forEach((option) => {
            const el = document.createElement("option");
            el.value = option.value;
            el.textContent = option.label;
            if (option.value === currentPeriod) el.selected = true;
            periodSelect.appendChild(el);
        });
        const allowed = nextOptions.map((option) => option.value);
        if (!allowed.includes(periodSelect.value)) {
            periodSelect.value = preferredFallback && allowed.includes(preferredFallback)
                ? preferredFallback
                : allowed[allowed.length - 1];
        }
        refreshSharedSelectField(periodPanel?.querySelector("[data-shared-select-field]"));
    };

    const syncBacktestIntervals = async () => {
        if (!isBacktestView) return;
        const tickerInput = getTickerInputs()[0];
        if (!tickerInput) return;
        const ticker = sanitizeTicker(tickerInput.value.trim());
        if (!ticker) return;

        try {
            const params = new URLSearchParams({ticker});
            const response = await fetch(`${endpoints.marketStorePresence}?${params.toString()}`, {credentials: "same-origin"});
            if (!response.ok) return;
            const payload = await response.json();
            const has1m = payload.has1m && payload.has1m[ticker];
            const tickerPeriodOptions = payload.periodOptions?.[ticker] || {};
            if (tickerPeriodOptions && Object.keys(tickerPeriodOptions).length) {
                state.backtestPeriodOptions = tickerPeriodOptions;
            }

            const intervalInputs = getBacktestIntervalInputs();
            if (intervalInputs.length) {
                const currentInterval = getSelectedBacktestInterval();
                setBacktestIntervalAvailability(Boolean(has1m));
                const nextInterval = currentInterval === "1m" && !has1m ? "1d" : currentInterval;
                setBacktestIntervalValue(nextInterval);

                if (currentInterval === "1m" && !has1m) {
                    replacePeriodOptions(
                        tickerPeriodOptions["1d"] || state.backtestPeriodOptions?.["1d"] || ["1d"],
                        "1d",
                    );
                    const nextInput = getBacktestIntervalInputs().find((input) => input.value === "1d");
                    nextInput?.dispatchEvent(new Event("change", {bubbles: true}));
                } else if (currentInterval !== nextInterval) {
                    const nextInput = getBacktestIntervalInputs().find((input) => input.value === nextInterval);
                    nextInput?.dispatchEvent(new Event("change", {bubbles: true}));
                } else {
                    replacePeriodOptions(
                        tickerPeriodOptions[nextInterval] || state.backtestPeriodOptions?.[nextInterval] || ["1d"],
                        nextInterval === "1m" ? "1d" : "max",
                    );
                }
            }
        } catch (_error) {
        }
    };

    const syncDateConstraints = async () => {
        if (!exactStartInput || !exactEndInput) return;
        const rangeMode = $("input[name='range']:checked")?.value || defaults.range_mode;
        if (rangeMode !== "exact") {
            validTradingDateSet = null;
            return;
        }
        const tickers = getFilledTickers();
        if (tickers.length < minimumRequiredTickers || new Set(tickers).size !== tickers.length) return;
        const params = new URLSearchParams({view: state.currentView});
        if (includeDividendsInput?.checked) params.set("dividends", "1");
        if (exactStartInput.value) params.set("from", exactStartInput.value);
        if (exactEndInput.value) params.set("to", exactEndInput.value);
        tickers.forEach((ticker) => params.append("ticker", ticker));
        try {
            const response = await fetch(`${endpoints.dateConstraints}?${params.toString()}`);
            if (!response.ok) return;
            const payload = await response.json();
            validTradingDateSet = payload.trading_dates?.length ? new Set(payload.trading_dates) : null;
            const tradingDateSet = new Set(payload.trading_dates || []);
            exactStartInput.min = payload.min_date || "";
            exactStartInput.max = payload.max_date || "";
            exactEndInput.min = payload.min_date || "";
            exactEndInput.max = payload.max_date || "";
            if (payload.adjusted_start) exactStartInput.value = payload.adjusted_start;
            if (payload.adjusted_end) exactEndInput.value = payload.adjusted_end;
            const enforceTradingDate = (input, fallbackValue) => {
                if (!input.value || tradingDateSet.has(input.value)) return false;
                input.value = fallbackValue || "";
                return true;
            };
            enforceTradingDate(exactStartInput, payload.adjusted_start);
            enforceTradingDate(exactEndInput, payload.adjusted_end);
            datePickerState.forEach((picker) => {
                picker.invalidDraft = "";
                picker.validationMessage = "";
            });
            refreshDatePickers();
        } catch (_error) {
        }
    };

    getTickerInputs().forEach((input) => setupAutocomplete(input));
    initializeDatePickers();
    initializeWorkspaceEnhancements();
    initThemeModeControls();
    rememberCurrentViewUrl();
    attachDockMemory();
    attachRemoveHandlers();
    attachTickerClearHandlers();
    attachPortfolioWeightHandlers();
    reindexTickerFields();
    validateAllTickerInputs();
    syncPortfolioWeightDisabledState();
    ensurePortfolioWeightTouches();
    syncPortfolioWeightBounds();
    dispatchPortfolioPreviewUpdate();
    validatePortfolioWeightInputs();
    updateRangePanels();
    syncBacktestIntervalSegmentedControl();
    syncDateConstraints();
    scheduleDockPosition();

    $("#add_ticker")?.addEventListener("click", () => {
        if (!isBacktestView) clearWorkspaceChartTransitionRequest();
        addTickerField();
    });
    rangeModeInputs.forEach((input) => input.addEventListener("change", () => {
        const nextRangeMode = input.value;
        const previousRangeMode = lastRangeMode;
        let shouldAutoSubmit = true;
        if (previousRangeMode !== nextRangeMode) {
            if (nextRangeMode === "exact") {
                const synced = syncExactInputsToRenderedRange();
                if (synced && hasInitialResult) {
                    shouldAutoSubmit = false;
                }
            } else if (nextRangeMode === "period") {
                const matchedPeriod = chooseRelativePeriodForExactRange();
                if (matchedPeriod && periodSelect) {
                    periodSelect.value = matchedPeriod;
                    refreshSharedSelectField(periodPanel?.querySelector("[data-shared-select-field]"));
                }
            }
        }
        updateRangePanels();
        syncDateConstraints();
        lastRangeMode = nextRangeMode;
        if (!isBacktestView && shouldAutoSubmit) requestWorkspaceChartTransition("range-mode");
        if (shouldAutoSubmit) {
            scheduleAutoSubmit();
        }
    }));
    [exactStartInput, exactEndInput].forEach((input) => {
        if (!input) return;
        input.addEventListener("change", () => {
            syncDateConstraints();
            if (!isBacktestView) requestWorkspaceChartTransition("range-controls");
            scheduleAutoSubmit();
        });
    });
    if (includeDividendsInput && form) {
        includeDividendsInput.addEventListener("change", () => {
            if (!isBacktestView) requestWorkspaceChartTransition("dividends");
            scheduleAutoSubmit(80);
        });
    }
    $("#period")?.addEventListener("change", () => {
        refreshSharedSelectField(periodPanel?.querySelector("[data-shared-select-field]"));
        if (!isBacktestView) requestWorkspaceChartTransition("period");
        scheduleAutoSubmit();
    });
    getBacktestIntervalInputs().forEach((input) => input.addEventListener("change", (event) => {
        if (!(event.target instanceof HTMLInputElement) || !event.target.checked) return;
        const interval = event.target.value;
        syncBacktestIntervalSegmentedControl();
        const nextPeriods = state.backtestPeriodOptions?.[interval] || (interval === "1m" ? ["1d"] : ["1d"]);
        replacePeriodOptions(nextPeriods, interval === "1m" ? "1d" : "max");
        // Force full reload for interval change to refresh sidebar period options
        scheduleAutoSubmit(20);
    }));

    if (isBacktestView && tradeCapitalField && tradeCapitalInput && tradeCapitalSlider) {
        const scheduleTradeAutoSubmit = () => {
            scheduleAutoSubmit(180);
        };
        const openTradeCapitalSlider = () => tradeCapitalField.classList.add("is-open");
        const closeTradeCapitalSlider = () => window.setTimeout(() => {
            if (tradeCapitalField.matches(":focus-within")) return;
            tradeCapitalField.classList.remove("is-open");
            tradeCapitalInput.value = formatTradeCapitalValue(parseTradeCapitalValue(tradeCapitalInput.value));
            scheduleTradeAutoSubmit();
        }, 80);
        const syncTradeCapitalControls = (value) => {
            const normalized = clampTradeCapital(value);
            tradeCapitalInput.value = String(normalized);
            tradeCapitalSlider.value = String(Math.round(normalized));
        };
        tradeCapitalInput.addEventListener("focus", () => {
            tradeCapitalInput.value = String(parseTradeCapitalValue(tradeCapitalInput.value));
            openTradeCapitalSlider();
        });
        tradeCapitalInput.addEventListener("click", openTradeCapitalSlider);
        tradeCapitalInput.addEventListener("input", () => {
            syncTradeCapitalControls(parseTradeCapitalValue(tradeCapitalInput.value));
            scheduleTradeAutoSubmit();
        });
        tradeCapitalInput.addEventListener("blur", () => {
            tradeCapitalInput.value = formatTradeCapitalValue(parseTradeCapitalValue(tradeCapitalInput.value));
            scheduleTradeAutoSubmit();
        });
        tradeCapitalSlider.addEventListener("focus", openTradeCapitalSlider);
        tradeCapitalSlider.addEventListener("input", () => {
            const value = clampTradeCapital(Number.parseFloat(tradeCapitalSlider.value) || 0);
            tradeCapitalInput.value = formatTradeCapitalValue(value);
            scheduleTradeAutoSubmit();
        });
        tradeCapitalField.addEventListener("focusout", closeTradeCapitalSlider);
        tradeCapitalInput.value = formatTradeCapitalValue(parseTradeCapitalValue(tradeCapitalInput.value));
        tradeCapitalSlider.value = String(Math.round(parseTradeCapitalValue(tradeCapitalInput.value)));
    }

    const tradeStrategyField = document.querySelector("[data-trade-strategy-field]");
    const tradeStrategySelect = $("#trade_strategy");
    const tradeStrategyTrigger = document.querySelector("[data-trade-strategy-trigger]");
    const tradeStrategyTriggerLabel = document.querySelector("[data-trade-strategy-trigger-label]");
    const tradeStrategyDropdown = document.querySelector("[data-trade-strategy-dropdown]");
    const tradeStrategyTuneButton = document.querySelector("[data-trade-strategy-tune-button]");
    const tradeStrategyPanel = document.querySelector("[data-trade-strategy-panel]");
    let strategySwitchAnimationTimer = null;
    let strategyFieldsRequestToken = 0;
    let strategyScrollbarIdleTimer = 0;

    const scheduleStrategyParamSubmit = (delay = 160) => {
        if (!hasInitialResult) return;
        scheduleAutoSubmit(delay);
    };

    const collectStrategyParamEntries = () => {
        if (!(tradeStrategyField instanceof HTMLElement)) return [];
        const controls = Array.from(tradeStrategyField.querySelectorAll("[data-strategy-param-input][name]"));
        return controls.flatMap((control) => {
            if (!(control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement)) {
                return [];
            }
            const key = control.name?.trim();
            if (!key) return [];
            const value = control.value ?? "";
            return value === "" ? [] : [[key, value]];
        });
    };

    const positionTradeStrategyPanel = () => {
        if (!(tradeStrategyPanel instanceof HTMLElement) || tradeStrategyPanel.hidden) return;
        if (!(tradeStrategyField instanceof HTMLElement)) return;
        const panelStyles = getComputedStyle(tradeStrategyPanel);
        const panelAnchor = tradeStrategyField.querySelector(".trade-strategy-row");
        const anchorRect = panelAnchor instanceof HTMLElement ? panelAnchor.getBoundingClientRect() : tradeStrategyField.getBoundingClientRect();
        const overlayMetrics = getSidebarOverlayMetrics(anchorRect, 160);
        const availableHeight = overlayMetrics ? overlayMetrics.availableHeight : 160;
        const panelGrid = tradeStrategyPanel.querySelector("[data-trade-strategy-params-grid]");
        if (panelGrid instanceof HTMLElement) {
            const verticalChrome = (Number.parseFloat(panelStyles.paddingTop) || 0)
                + (Number.parseFloat(panelStyles.paddingBottom) || 0);
            const gridMaxHeight = Math.max(96, availableHeight - verticalChrome);
            panelGrid.style.maxHeight = `${Math.round(gridMaxHeight)}px`;
            const contentHeight = Math.ceil(panelGrid.scrollHeight);
            const needsScroll = contentHeight > Math.round(gridMaxHeight);
            panelGrid.classList.toggle("is-scrollable", needsScroll);
            if (!needsScroll) {
                panelGrid.classList.remove("is-scrolling");
                if (strategyScrollbarIdleTimer) {
                    window.clearTimeout(strategyScrollbarIdleTimer);
                    strategyScrollbarIdleTimer = 0;
                }
            }
            const desiredPanelHeight = Math.min(availableHeight, contentHeight + verticalChrome);
            tradeStrategyPanel.style.height = `${Math.round(desiredPanelHeight)}px`;
            tradeStrategyPanel.style.maxHeight = `${Math.round(availableHeight)}px`;
            return;
        }
        tradeStrategyPanel.style.height = "";
        tradeStrategyPanel.style.maxHeight = `${Math.round(availableHeight)}px`;
    };

    const setStrategyPanelScrollingState = () => {
        if (!(tradeStrategyPanel instanceof HTMLElement)) return;
        const grid = tradeStrategyPanel.querySelector("[data-trade-strategy-params-grid]");
        if (!(grid instanceof HTMLElement)) return;
        if (!grid.classList.contains("is-scrollable")) return;
        grid.classList.add("is-scrolling");
        const idleMs = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--strategy-param-scrollbar-idle-ms")) || 720;
        if (strategyScrollbarIdleTimer) window.clearTimeout(strategyScrollbarIdleTimer);
        strategyScrollbarIdleTimer = window.setTimeout(() => {
            grid.classList.remove("is-scrolling");
        }, idleMs);
    };

    const setTradeStrategyPanelOpen = (isOpen) => {
        if (!(tradeStrategyPanel instanceof HTMLElement) || !(tradeStrategyTuneButton instanceof HTMLButtonElement)) return;
        const shouldOpen = isOpen && !tradeStrategyTuneButton.classList.contains("is-hidden");
        tradeStrategyPanel.hidden = !shouldOpen;
        tradeStrategyTuneButton.classList.toggle("is-active", shouldOpen);
        tradeStrategyTuneButton.setAttribute("aria-pressed", shouldOpen ? "true" : "false");
        if (tradeStrategySelect instanceof HTMLSelectElement) {
            tradeStrategySelect.disabled = shouldOpen;
        }
        if (tradeStrategyField instanceof HTMLElement) {
            tradeStrategyField.classList.toggle("is-open", shouldOpen);
        }
        if (shouldOpen) {
            positionTradeStrategyPanel();
        } else {
            tradeStrategyPanel.style.maxHeight = "";
            tradeStrategyPanel.style.height = "";
            const panelGrid = tradeStrategyPanel.querySelector("[data-trade-strategy-params-grid]");
            if (panelGrid instanceof HTMLElement) {
                panelGrid.style.maxHeight = "";
                panelGrid.classList.remove("is-scrollable", "is-scrolling");
            }
        }
    };

    const initStrategyParamControls = (root = document) => {
        const panelGrid = root.querySelector?.("[data-trade-strategy-params-grid]");
        if (panelGrid instanceof HTMLElement && panelGrid.dataset.strategyScrollBound !== "1") {
            panelGrid.dataset.strategyScrollBound = "1";
            panelGrid.classList.remove("is-scrolling");
            panelGrid.addEventListener("scroll", setStrategyPanelScrollingState, {passive: true});
        }
        const fields = Array.from(root.querySelectorAll("[data-strategy-param-key]"));
        fields.forEach((field) => {
            if (!(field instanceof HTMLElement) || field.dataset.strategyParamBound === "1") return;
            field.dataset.strategyParamBound = "1";

            const textInput = field.querySelector("[data-strategy-param-input='text']");
            if (textInput instanceof HTMLInputElement) {
                textInput.addEventListener("input", () => scheduleStrategyParamSubmit());
                textInput.addEventListener("change", () => scheduleStrategyParamSubmit(80));
            }

            const numberInput = field.querySelector("[data-strategy-param-input='number']");
            if (numberInput instanceof HTMLInputElement) {
                const isIntegerField = field.dataset.strategyParamKind === "integer";
                const normalizeStandaloneNumber = (value) => {
                    const parsed = Number.parseFloat(String(value));
                    if (!Number.isFinite(parsed)) return Number.parseFloat(numberInput.min || "0") || 0;
                    const min = Number.parseFloat(numberInput.min || "");
                    const max = Number.parseFloat(numberInput.max || "");
                    let normalized = parsed;
                    if (Number.isFinite(min)) normalized = Math.max(min, normalized);
                    if (Number.isFinite(max)) normalized = Math.min(max, normalized);
                    if (isIntegerField) normalized = Math.round(normalized);
                    return normalized;
                };
                const stepValue = () => {
                    if (isIntegerField) return 1;
                    const parsed = Number.parseFloat(numberInput.step || "0.1");
                    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0.1;
                };
                const formatStandaloneNumber = (value) => {
                    if (isIntegerField) {
                        return String(Math.round(value));
                    }
                    const stepText = String(numberInput.step || "");
                    const decimals = stepText.includes(".") ? stepText.split(".")[1].length : 0;
                    return decimals > 0 ? value.toFixed(decimals) : String(value);
                };
                const syncStandaloneNumber = (value) => {
                    const normalized = normalizeStandaloneNumber(value);
                    numberInput.value = formatStandaloneNumber(normalized);
                    return normalized;
                };
                field.querySelectorAll("[data-strategy-stepper]").forEach((button) => {
                    if (!(button instanceof HTMLButtonElement)) return;
                    button.addEventListener("click", () => {
                        const delta = button.dataset.strategyStepper === "down" ? -stepValue() : stepValue();
                        const currentValue = Number.parseFloat(numberInput.value || "0") || 0;
                        syncStandaloneNumber(currentValue + delta);
                        scheduleStrategyParamSubmit(80);
                    });
                });
                numberInput.addEventListener("focus", () => field.classList.add("is-open"));
                numberInput.addEventListener("click", () => field.classList.add("is-open"));
                numberInput.addEventListener("input", () => scheduleStrategyParamSubmit());
                numberInput.addEventListener("change", () => {
                    syncStandaloneNumber(numberInput.value);
                    scheduleStrategyParamSubmit(80);
                });
                field.addEventListener("focusout", () => window.setTimeout(() => {
                    if (field.matches(":focus-within")) return;
                    field.classList.remove("is-open");
                    syncStandaloneNumber(numberInput.value);
                }, 80));
                syncStandaloneNumber(numberInput.value);
            }

            const booleanInput = field.querySelector("[data-strategy-param-input='boolean']");
            const booleanSwitch = field.querySelector("[data-strategy-param-switch]");
            if (booleanInput instanceof HTMLInputElement && booleanSwitch instanceof HTMLInputElement) {
                const syncBooleanValue = () => {
                    const onValue = booleanInput.dataset.switchOnValue || "1";
                    const offValue = booleanInput.dataset.switchOffValue || "0";
                    booleanInput.value = booleanSwitch.checked ? onValue : offValue;
                };
                booleanSwitch.addEventListener("change", () => {
                    syncBooleanValue();
                    scheduleStrategyParamSubmit(80);
                });
                syncBooleanValue();
            }

            const selectInput = field.querySelector("[data-strategy-param-input='select']");
            if (selectInput instanceof HTMLSelectElement) {
                selectInput.addEventListener("change", () => scheduleStrategyParamSubmit(80));
            }
        });
    };

    const syncTradeStrategyTuningAvailability = () => {
        if (!(tradeStrategyTuneButton instanceof HTMLButtonElement) || !(tradeStrategyPanel instanceof HTMLElement)) return;
        const hasFields = Boolean(tradeStrategyPanel.querySelector("[data-strategy-param-key]"));
        tradeStrategyTuneButton.classList.toggle("is-hidden", !hasFields);
        tradeStrategyTuneButton.disabled = !hasFields;
        tradeStrategyTuneButton.setAttribute("aria-hidden", hasFields ? "false" : "true");
        tradeStrategyTuneButton.tabIndex = hasFields ? 0 : -1;
        if (!hasFields) setTradeStrategyPanelOpen(false);
    };

    const setTradeStrategyDropdownOpen = (isOpen) => {
        if (!(tradeStrategyDropdown instanceof HTMLElement) || !(tradeStrategyTrigger instanceof HTMLButtonElement)) return;
        tradeStrategyDropdown.hidden = !isOpen;
        tradeStrategyTrigger.setAttribute("aria-expanded", isOpen ? "true" : "false");
        if (tradeStrategyField instanceof HTMLElement) {
            tradeStrategyField.classList.toggle("is-open", isOpen || (!(tradeStrategyPanel instanceof HTMLElement) ? false : !tradeStrategyPanel.hidden));
        }
        if (isOpen) {
            positionTradeStrategyDropdown();
        } else {
            resetSidebarDropdownPosition(tradeStrategyDropdown);
        }
    };

    const syncTradeStrategyTriggerLabel = () => {
        if (!(tradeStrategySelect instanceof HTMLSelectElement) || !(tradeStrategyTriggerLabel instanceof HTMLElement)) return;
        const selectedOption = Array.from(tradeStrategySelect.options).find((option) => option.value === tradeStrategySelect.value);
        tradeStrategyTriggerLabel.textContent = selectedOption?.textContent?.trim() || "";
    };

    const positionTradeStrategyDropdown = () => {
        if (!(tradeStrategyDropdown instanceof HTMLElement) || tradeStrategyDropdown.hidden) return;
        const container = tradeStrategyDropdown.parentElement;
        positionSidebarDropdownFromTrigger(
            tradeStrategyTrigger,
            tradeStrategyDropdown,
            container instanceof HTMLElement ? container : tradeStrategyField,
        );
    };

    const renderTradeStrategyDropdown = () => {
        if (!(tradeStrategySelect instanceof HTMLSelectElement) || !(tradeStrategyDropdown instanceof HTMLElement)) return;
        const currentSelection = String(tradeStrategySelect.value || "");
        const groups = Array.from(tradeStrategySelect.querySelectorAll("optgroup"));
        tradeStrategyDropdown.innerHTML = "";
        groups.forEach((group) => {
            const groupElement = document.createElement("section");
            groupElement.className = "trade-strategy-dropdown-group";

            const labelElement = document.createElement("p");
            labelElement.className = "trade-strategy-dropdown-label";
            labelElement.textContent = group.label || "";
            groupElement.appendChild(labelElement);

            Array.from(group.querySelectorAll("option")).forEach((option) => {
                const optionButton = document.createElement("button");
                optionButton.type = "button";
                optionButton.className = "trade-strategy-dropdown-option";
                optionButton.dataset.value = option.value;
                optionButton.setAttribute("role", "option");
                optionButton.setAttribute("aria-selected", option.value === currentSelection ? "true" : "false");
                if (option.value === currentSelection) {
                    optionButton.classList.add("is-selected", "is-active");
                }

                const checkElement = document.createElement("span");
                checkElement.className = "trade-strategy-dropdown-check";
                checkElement.setAttribute("aria-hidden", "true");

                const textElement = document.createElement("span");
                textElement.className = "trade-strategy-dropdown-text";
                textElement.textContent = option.textContent || option.value;

                optionButton.appendChild(checkElement);
                optionButton.appendChild(textElement);
                optionButton.addEventListener("click", () => {
                    if (!(tradeStrategySelect instanceof HTMLSelectElement)) return;
                    if (tradeStrategySelect.value === option.value) {
                        setTradeStrategyDropdownOpen(false);
                        return;
                    }
                    tradeStrategySelect.value = option.value;
                    syncStrategyOptionSelection(tradeStrategySelect, option.value);
                    syncTradeStrategyTriggerLabel();
                    renderTradeStrategyDropdown();
                    setTradeStrategyDropdownOpen(false);
                    tradeStrategySelect.dispatchEvent(new Event("change", {bubbles: true}));
                });
                groupElement.appendChild(optionButton);
            });

            tradeStrategyDropdown.appendChild(groupElement);
        });
    };

    const pulseStrategySwitch = () => {
        if (!(tradeStrategySelect instanceof HTMLSelectElement)) return;
        tradeStrategySelect.classList.remove("is-switching");
        if (tradeStrategyPanel instanceof HTMLElement) {
            tradeStrategyPanel.classList.remove("is-switching");
        }
        void tradeStrategySelect.offsetWidth;
        tradeStrategySelect.classList.add("is-switching");
        if (tradeStrategyPanel instanceof HTMLElement && !tradeStrategyPanel.hidden) {
            tradeStrategyPanel.classList.add("is-switching");
        }
        if (strategySwitchAnimationTimer) window.clearTimeout(strategySwitchAnimationTimer);
        strategySwitchAnimationTimer = window.setTimeout(() => {
            tradeStrategySelect.classList.remove("is-switching", "is-pressing");
            if (tradeStrategyPanel instanceof HTMLElement) {
                tradeStrategyPanel.classList.remove("is-switching");
            }
        }, 380);
    };

    const refreshTradeStrategyFields = async (strategyId) => {
        if (!(tradeStrategyPanel instanceof HTMLElement) || !endpoints.strategyFields || !strategyId) return;
        const requestToken = ++strategyFieldsRequestToken;
        try {
            const response = await fetch(`${endpoints.strategyFields}?strategy=${encodeURIComponent(strategyId)}`, {
                credentials: "same-origin",
            });
            if (!response.ok) return;
            const payload = await response.json();
            if (requestToken !== strategyFieldsRequestToken) return;
            tradeStrategyPanel.innerHTML = payload.html || "";
            initStrategyParamControls(tradeStrategyPanel);
            syncTradeStrategyTuningAvailability();
            if (!payload.is_tunable) {
                setTradeStrategyPanelOpen(false);
            } else if (!tradeStrategyPanel.hidden) {
                positionTradeStrategyPanel();
            }
        } catch (_error) {
        }
    };

    seedTickerValidationState();
    initStrategyParamControls(tradeStrategyField || document);
    syncTradeStrategyTuningAvailability();
    sharedSelectFields.forEach((field) => initializeSharedSelectField(field));

    if (tradeStrategyTuneButton instanceof HTMLButtonElement) {
        tradeStrategyTuneButton.addEventListener("click", () => {
            setTradeStrategyDropdownOpen(false);
            setTradeStrategyPanelOpen(tradeStrategyPanel instanceof HTMLElement ? tradeStrategyPanel.hidden : false);
        });
    }

    if (tradeStrategyTrigger instanceof HTMLButtonElement) {
        tradeStrategyTrigger.addEventListener("click", () => {
            const shouldOpen = tradeStrategyDropdown instanceof HTMLElement ? tradeStrategyDropdown.hidden : false;
            closeSharedSelectDropdowns();
            setTradeStrategyPanelOpen(false);
            renderTradeStrategyDropdown();
            setTradeStrategyDropdownOpen(shouldOpen);
        });
    }

    if (tradeStrategySelect instanceof HTMLSelectElement) {
        tradeStrategySelect.addEventListener("change", async () => {
            syncStrategyOptionSelection(tradeStrategySelect, tradeStrategySelect.value);
            syncTradeStrategyTriggerLabel();
            renderTradeStrategyDropdown();
            pulseStrategySwitch();
            await refreshTradeStrategyFields(tradeStrategySelect.value);
            if (!form) return;
            window.setTimeout(() => form.requestSubmit(), 72);
        });
    }

    window.addEventListener("resize", () => {
        sharedSelectFields.forEach((field) => positionSharedSelectDropdown(field));
        positionTradeStrategyDropdown();
        positionTradeStrategyPanel();
    });
    document.addEventListener("scroll", () => {
        sharedSelectFields.forEach((field) => positionSharedSelectDropdown(field));
        positionTradeStrategyDropdown();
        positionTradeStrategyPanel();
    }, true);
    document.addEventListener("click", (event) => {
        const clickedInsideStrategyField = tradeStrategyField instanceof HTMLElement && tradeStrategyField.contains(event.target);
        const clickedInsideSharedField = sharedSelectFields.some((field) => field.contains(event.target));
        if (!clickedInsideStrategyField) {
            setTradeStrategyDropdownOpen(false);
        }
        if (!clickedInsideSharedField) {
            closeSharedSelectDropdowns();
        }
    });

    if (form) {
        form.noValidate = true;
        form.addEventListener("submit", async (event) => {
            if (isSubmittingWithOverlay) return;
            event.preventDefault();
            const values = getFilledTickers();
            validateAllTickerInputs();
            if (values.length < minimumRequiredTickers) {
                const firstInput = getTickerInputs()[0];
                if (firstInput) showTickerValidationTooltip(firstInput);
                return;
            }
            if (new Set(values).size !== values.length) {
                const invalidInput = getTickerInputs().find((input) => input.validationMessage);
                if (invalidInput) showTickerValidationTooltip(invalidInput);
                return;
            }
            const areTickersValid = await ensureTickerValidityBeforeSubmit();
            if (!areTickersValid) {
                const invalidInput = getTickerInputs().find((input) => !input.checkValidity() || input.dataset.unknown === "1");
                if (invalidInput) showTickerValidationTooltip(invalidInput);
                return;
            }
            if (isPortfolioView) {
                const areWeightsValid = validatePortfolioWeightInputs();
                if (!areWeightsValid) {
                    return;
                }
                const totalWeight = getFilledWeightEntries().reduce((sum, entry) => sum + (Number.parseInt(entry.number.value, 10) || 0), 0);
                if (totalWeight !== 100) {
                    return;
                }
            }
            if (autoSubmitTimer) {
                window.clearTimeout(autoSubmitTimer);
                autoSubmitTimer = null;
            }
            const nextUrl = buildCleanWorkspaceUrl();
            const currentUrlObj = new URL(window.location.href);
            const nextUrlObj = new URL(nextUrl, window.location.origin);
            currentUrlObj.searchParams.sort();
            nextUrlObj.searchParams.sort();
            if (hasInitialResult && currentUrlObj.pathname === nextUrlObj.pathname && currentUrlObj.searchParams.toString() === nextUrlObj.searchParams.toString()) {
                return;
            }
            let missingLocalTickers = [];
            try {
                missingLocalTickers = await fetchMissingLocalMarketTickers(values);
            } catch (error) {
                console.warn("Market Store Presence Error:", error);
            }
            isSubmittingWithOverlay = true;
            setFormBusyState(true);
            rememberCurrentViewUrl(nextUrl);

            const strategySelect = document.getElementById("trade_strategy");
            if (strategySelect) {
                const strategyId = strategySelect.value;
                if (strategyId && strategyId !== "buy-and-hold") {
                    let recent = JSON.parse(localStorage.getItem(STRATEGY_MEMORY_KEY) || "[]");
                    recent = [strategyId, ...recent.filter((id) => id !== strategyId)].slice(0, 3);
                    localStorage.setItem(STRATEGY_MEMORY_KEY, JSON.stringify(recent));
                    refreshStrategyDropdownUI();
                }
            }
            if (missingLocalTickers.length) {
                showWorkspaceModal({
                    title: "Fetching remote market data",
                    copy: `Fetching remote market data for ${missingLocalTickers.join(", ")} and saving it to Local Market Store. Results will appear as soon as loading finishes.`,
                    iconClass: "icon-overlay-local-cache",
                });
            }
            if (state.currentView === "backtest") {
                showWorkspaceModal({
                    title: "Running Backtest",
                    copy: "Calculating strategy signals and performance metrics. This may take a moment depending on the data resolution and strategy complexity.",
                    iconClass: "icon-hourglass"
                });
                // Only capture refresh transition if date range (x-axis) hasn't changed:
                // - If ticker/period/interval/exact dates change: full rebuild from scratch (original behavior)
                // - If only strategy parameters / dividends / capital change: animate y-values keeping same x-axis with smooth transition
                function doesRequestChangedXAxis(currentParams, nextParams) {
                    const xAxisKeys = ["ticker", "period", "interval", "from", "exact_start", "to", "exact_end"];
                    for (const key of xAxisKeys) {
                        const current = (currentParams.get(key) || "").toString().trim();
                        const next = (nextParams.get(key) || "").toString().trim();
                        if (current !== next) return true;
                    }
                    return false;
                }

                const currentParams = new URLSearchParams(currentUrlObj.search);
                const nextParams = new URLSearchParams(nextUrlObj.search);
                const xAxisChanged = doesRequestChangedXAxis(currentParams, nextParams);
                if (!xAxisChanged) {
                    captureBacktestRefreshTransition();
                } else {
                    delete bootstrap.backtestRefreshTransition;
                }
            } else if (pendingWorkspaceChartTransition?.view === state.currentView) {
                // Same logic: only capture line chart transition if x-axis hasn't changed
                const currentParams = new URLSearchParams(currentUrlObj.search);
                const nextParams = new URLSearchParams(nextUrlObj.search);
                const didRequestChangeXAxis = state.currentView === "portfolio"
                    ? didPortfolioRequestChangeXAxis
                    : bootstrap.didCompareRequestChangeXAxis;
                const xAxisChanged = didRequestChangeXAxis?.(currentParams, nextParams) ?? true;
                if (!xAxisChanged) {
                    captureLineChartRefreshTransition();
                } else {
                    delete bootstrap.chartWorkspaceRefreshTransition;
                }
            } else {
                delete bootstrap.chartWorkspaceRefreshTransition;
            }
            clearWorkspaceChartTransitionRequest();
            applyPendingWorkspaceMarkup();
            try {
                const hydrated = await hydrateWorkspaceFromUrl(nextUrl);
                if (hydrated === false) return;
                hasInitialResult = true;
            } catch (error) {
                console.error("Hydration Error: ", error);
                if (error?.name === "AbortError") return;
                window.requestAnimationFrame(() => {
                    window.location.assign(nextUrl);
                });
                return;
            } finally {
                hideWorkspaceModal();
                isSubmittingWithOverlay = false;
                setFormBusyState(false);
            }
        });
    }

    document.addEventListener("submit", (event) => {
        const formElement = event.target.closest(".settings-action-form");
        if (formElement) {
            const actionInput = formElement.querySelector('input[name="action"]');
            const submitButton = formElement.querySelector("button[type='submit']");
            submitButton?.classList.add("is-pending");
            if (actionInput?.value === "refresh") {
                showWorkspaceModal({
                    title: "Saving daily market data to local cache",
                    copy: "We are checking this ticker for missing daily history and saving any new data on this device. Please keep this page open while the download finishes.",
                    iconClass: "icon-overlay-local-cache",
                });
            } else if (actionInput?.value === "refresh-1m") {
                showWorkspaceModal({
                    title: "Saving 1-minute market data to local cache",
                    copy: "We are refreshing the latest 6 months of trading days for this ticker and saving the result on this device. Please keep this page open while the download finishes.",
                    iconClass: "icon-overlay-local-cache",
                });
            }
            return;
        }
        const calloutForm = event.target.closest(".settings-callout-form");
        if (calloutForm) {
            const actionInput = calloutForm.querySelector('input[name="action"]');
            const sectionInput = calloutForm.querySelector('input[name="section"]');
            const submitButton = calloutForm.querySelector("button[type='submit']");
            submitButton?.classList.add("is-pending");
            submitButton?.setAttribute("aria-busy", "true");
            if (actionInput?.value === "maintain") {
                showWorkspaceModal({
                    title: "Maintaining all local market data",
                    copy: "We are checking every cached ticker for missing daily history and saving any new data on this device. Please keep this page open while the download finishes.",
                    iconClass: "icon-overlay-local-cache",
                });
            } else if (actionInput?.value === "investment-transactions") {
                showWorkspaceModal({
                    title: "Clearing local broker transaction record",
                    copy: "We are removing the imported local broker transaction history stored on this device. Please keep this page open while this finishes.",
                    iconClass: "icon-settings-clear-cache",
                });
            } else if (sectionInput?.value === "clear-caches") {
                showWorkspaceModal({
                    title: "Clearing local market data caches",
                    copy: "We are removing non-local market caches while keeping Local Market Store protected entries and ticker usage records. Please keep this page open while this finishes.",
                    iconClass: "icon-settings-clear-cache",
                });
            }
            return;
        }
        const smtpForm = event.target.closest(".settings-stack-form");
        if (!smtpForm) return;
        const submitter = event.submitter;
        submitter?.classList.add("is-pending");
        submitter?.setAttribute("aria-busy", "true");
    });
    workspaceModalOverlayClose?.addEventListener("click", hideWorkspaceModal);
    window.addEventListener("pageshow", hideWorkspaceModal);
    window.addEventListener("pageshow", () => {
        document.body.classList.remove("is-workspace-switching");
        document.querySelectorAll(".is-masked-during-switch").forEach((node) => {
            node.classList.remove("is-masked-during-switch");
        });
    });
    void bootstrap.hydrateSettingsNetworkStatuses?.();
    void bootstrap.hydrateSettingsLocalStoreRanges?.();

    const syncStrategyOptionSelection = (select, selectedValue) => {
        if (!(select instanceof HTMLSelectElement)) return;
        const normalizedValue = String(selectedValue || "");
        const matchingOptions = Array.from(select.options).filter((option) => option.value === normalizedValue);
        Array.from(select.options).forEach((option) => {
            const isSelected = Boolean(normalizedValue) && option.value === normalizedValue;
            option.defaultSelected = isSelected;
            option.selected = false;
            if (isSelected) {
                option.setAttribute("selected", "selected");
            } else {
                option.removeAttribute("selected");
            }
        });
        if (!matchingOptions.length) return;
        matchingOptions.forEach((option) => {
            option.defaultSelected = true;
            option.setAttribute("selected", "selected");
        });
        const allGroupMatch = matchingOptions.find((option) => option.parentElement?.dataset?.strategyGroup === "all");
        (allGroupMatch || matchingOptions[0]).selected = true;
        select.value = normalizedValue;
    };

    const refreshStrategyDropdownUI = () => {
        const select = document.getElementById("trade_strategy");
        if (!select) return;
        let recentIds = [];
        try {
            recentIds = JSON.parse(localStorage.getItem(STRATEGY_MEMORY_KEY) || "[]");
        } catch (_e) {
            return;
        }
        const recentGroup = select.querySelector('optgroup[data-strategy-group="recent"]');
        if (!recentGroup) return;

        const currentSelection = select.value;
        recentGroup.innerHTML = "";
        recentIds.forEach((id) => {
            if (id === "buy-and-hold") return;
            // Find reference option in any other group
            const reference = select.querySelector(`optgroup:not([data-strategy-group="recent"]) option[value="${id}"]`);
            if (reference) {
                const clone = reference.cloneNode(true);
                recentGroup.appendChild(clone);
            }
        });

        recentGroup.hidden = recentGroup.children.length === 0;
        // Restore selection because DOM change might reset it, then mirror
        // the selected marker onto every duplicate option in Recent and All.
        syncStrategyOptionSelection(select, currentSelection);
        syncTradeStrategyTriggerLabel();
        renderTradeStrategyDropdown();
    };

    window.addEventListener("resize", scheduleDockPosition);
    window.addEventListener("orientationchange", scheduleDockPosition);
    window.addEventListener("pageshow", scheduleDockPosition);
    window.addEventListener("resize", scheduleMobilePageBottomPaddingSync);
    window.addEventListener("orientationchange", scheduleMobilePageBottomPaddingSync);
    window.addEventListener("pageshow", scheduleMobilePageBottomPaddingSync);

    initializeWorkspaceEnhancements();
    syncTradeStrategyTriggerLabel();
    renderTradeStrategyDropdown();
    refreshStrategyDropdownUI();
})();
