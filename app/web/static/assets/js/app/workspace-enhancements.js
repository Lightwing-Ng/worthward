/* Code version: v1.0.0 */
(() => {
    const create = (context) => {
        const {
            $,
            $$,
            TRADE_DETAIL_MEMORY_KEY,
            bootstrap,
            canTransitionDom,
            clearOptimisticNavigationSkeleton,
            endpoints,
            fetchJsonCached,
            form,
            getProgressiveManifest,
            isPortfolioView,
            labels,
            localMarketPresencePendingRequest,
            localMarketPresenceRequestCache,
            preferenceStorage,
            progressiveResourceCache,
            renderOptimisticNavigationSkeleton,
            responsive,
            sanitizeTicker,
            setInlineStyleIfChanged,
            state,
            workspaceEnhancementState,
            workspaceUrlState,
        } = context;
        const buildCleanWorkspaceUrl = (...args) => context.buildCleanWorkspaceUrl(...args);
        const dispatchPortfolioPreviewUpdate = (...args) => context.dispatchPortfolioPreviewUpdate(...args);
        const initMobilePageBottomPadding = (...args) => context.initMobilePageBottomPadding(...args);
        const rememberCurrentViewUrl = (...args) => context.rememberCurrentViewUrl(...args);
        let activeWorkspaceSummaryMorphCleanup = null;
        let activeWorkspaceModeLayoutCleanup = null;
        let activeScrollableTableHeaderCleanup = null;

        const getTickerFields = () => $$(".ticker-field");
        const getTickerInputs = () => getTickerFields().map((field) => field.querySelector("[data-ticker-input]")).filter(Boolean);
        const getFilledTickers = () => getTickerInputs().map((input) => sanitizeTicker(input.value.trim())).filter(Boolean);
        const nonUsMarketSuffixes = new Set([
            "AS", "AX", "BA", "BE", "BK", "BO", "BR", "CA", "CN", "CO", "DE", "DU", "F", "HA",
            "HE", "HK", "HM", "IR", "IS", "JK", "JP", "KL", "KQ", "KS", "L", "MC", "MI",
            "MX", "NE", "NS", "NZ", "OL", "PA", "QA", "SA", "SE", "SG", "SH", "SI", "SR",
            "SS", "ST", "SW", "SZ", "T", "TA", "TO", "TWO", "TW", "V", "VI",
        ]);
        const isUsTicker = (ticker) => {
            const normalizedTicker = sanitizeTicker(ticker);
            if (!normalizedTicker.includes(".")) return true;
            const suffix = normalizedTicker.split(".").pop() || "";
            return suffix === "US" || !nonUsMarketSuffixes.has(suffix);
        };
        const areAllFilledTickersUs = () => {
            const tickers = getFilledTickers();
            return tickers.length > 0 && tickers.every(isUsTicker);
        };
        const getWeightFields = () => getTickerFields().map((field, index) => ({
            index,
            field,
            number: field.querySelector('.portfolio-weight-input'),
            slider: field.querySelector('.portfolio-weight-slider'),
            shares: field.querySelector('.portfolio-share-input'),
            tickerInput: field.querySelector("[data-ticker-input]"),
            tooltip: field.querySelector('.portfolio-weight-tooltip'),
        })).filter((item) => item.number && item.slider && item.tickerInput);
        const getPortfolioAllocationInputs = () => Array.from(document.querySelectorAll("[data-portfolio-allocation-input]"))
            .filter((input) => input instanceof HTMLInputElement);
        const getPortfolioAllocationMode = () => {
            const checked = getPortfolioAllocationInputs().find((input) => input.checked);
            return checked?.value === "shares" ? "shares" : "weight";
        };
        const isPortfolioShareMode = () => isPortfolioView && getPortfolioAllocationMode() === "shares";

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

        const attachTradeDetailTabs = () => {
            const shell = $("[data-trade-detail-shell]");
            if (!shell) return;
            const panels = $$("[data-trade-detail-panel]");
            const urlState = workspaceUrlState?.parseWorkspaceUrlState?.(window.location.href);
            try {
                const storedValue = preferenceStorage.session.getItem(TRADE_DETAIL_MEMORY_KEY);
                const requestedValue = urlState?.tab === "transactions"
                    || (urlState?.tab === "metrics" && window.location.search.includes("tab="))
                    ? urlState.tab
                    : storedValue;
                const storedInput = requestedValue ? shell.querySelector(`input[name="trade_detail_tab"][value="${requestedValue}"]`) : null;
                if (storedInput) storedInput.checked = true;
            } catch (_error) {
            }
            const syncPanels = ({syncUrl = false} = {}) => {
                const active = shell.querySelector('input[name="trade_detail_tab"]:checked')?.value || "metrics";
                shell.dataset.active = active;
                try {
                    preferenceStorage.session.setItem(TRADE_DETAIL_MEMORY_KEY, active);
                } catch (_error) {
                }
                panels.forEach((panel) => {
                    panel.hidden = panel.dataset.tradeDetailPanel !== active;
                });
                if (syncUrl && typeof buildCleanWorkspaceUrl === "function") {
                    const nextUrl = buildCleanWorkspaceUrl();
                    const currentUrl = `${window.location.pathname}${window.location.search}`;
                    if (nextUrl !== currentUrl) {
                        window.history.pushState({}, "", nextUrl);
                        rememberCurrentViewUrl(nextUrl);
                    }
                }
            };
            shell.querySelectorAll('input[name="trade_detail_tab"]').forEach((input) => {
                if (input.dataset.bound === "1") return;
                input.dataset.bound = "1";
                input.addEventListener("change", () => syncPanels({syncUrl: true}));
            });
            syncPanels();
        };

        const setFormBusyState = (isBusy) => {
            if (!form) return;
            form.setAttribute("aria-busy", String(isBusy));
        };

        const fetchMissingLocalMarketTickers = async (tickers) => {
            if (!Array.isArray(tickers) || !tickers.length || !endpoints.marketStorePresence) return [];
            const canonicalTickers = tickers
                .map((ticker) => String(ticker || "").trim().toUpperCase())
                .filter(Boolean)
                .filter((ticker, index, list) => list.indexOf(ticker) === index)
                .sort();
            if (!canonicalTickers.length) return [];
            const tickerKey = canonicalTickers.join("|");
            const now = Date.now();
            const cached = localMarketPresenceRequestCache.get(tickerKey);
            if (cached && cached.expiresAt > now) {
                return [...cached.value];
            }
            if (localMarketPresencePendingRequest.has(tickerKey)) {
                return localMarketPresencePendingRequest.get(tickerKey);
            }
            const params = new URLSearchParams();
            canonicalTickers.forEach((ticker) => {
                if (ticker) params.append("ticker", ticker);
            });
            const request = (async () => {
                const response = await fetch(`${endpoints.marketStorePresence}?${params.toString()}`, {
                    credentials: "same-origin",
                });
                if (!response.ok) throw new Error(`Market store presence fetch failed: ${response.status}`);
                const payload = await response.json();
                const missingHistory = Array.isArray(payload?.missingHistory) ? payload.missingHistory : [];
                localMarketPresenceRequestCache.set(tickerKey, {
                    value: [...missingHistory],
                    expiresAt: Date.now() + 4000,
                });
                return [...missingHistory];
            })();
            localMarketPresencePendingRequest.set(tickerKey, request);
            try {
                return await request;
            } finally {
                localMarketPresencePendingRequest.delete(tickerKey);
            }
        };

        const attachWorkspaceSummaryMorph = () => {
            if (typeof activeWorkspaceSummaryMorphCleanup === "function") {
                activeWorkspaceSummaryMorphCleanup();
                activeWorkspaceSummaryMorphCleanup = null;
            }
            const summaryShells = Array.from(document.querySelectorAll(".workspace-mobile-summary-shell[data-mobile-summary-fixed]"));
            const sidebar = document.getElementById("app_sidebar");
            if (!summaryShells.length || !(sidebar instanceof HTMLElement)) return;
            const mobileMedia = responsive.media("contentStackMax");
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
            workspaceEnhancementState.scheduleSummaryMorphSync = scheduleMorphSync;

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
                workspaceEnhancementState.scheduleSummaryMorphSync = null;
            };
        };

        const attachWorkspaceModeLayout = () => {
            if (typeof activeWorkspaceModeLayoutCleanup === "function") {
                activeWorkspaceModeLayoutCleanup();
                activeWorkspaceModeLayoutCleanup = null;
            }
            const sidebar = document.getElementById("app_sidebar");
            const layout = document.querySelector(".workspace-mode-layout");
            const resultsStack = document.querySelector(".workspace-mode-results-stack");
            if (!(sidebar instanceof HTMLElement) || !(layout instanceof HTMLElement) || !(resultsStack instanceof HTMLElement)) {
                return;
            }
            const stackedWorkspaceMedia = responsive.media("contentStackMax");
            let frameId = 0;
            let resizeObserver = null;
            const resetLayoutHeight = () => {
                setInlineStyleIfChanged(layout, "--workspace-mode-aligned-height", "auto");
            };
            const syncLayoutHeight = () => {
                if (stackedWorkspaceMedia.matches) {
                    resetLayoutHeight();
                    return;
                }
                const sidebarRect = sidebar.getBoundingClientRect();
                const layoutRect = layout.getBoundingClientRect();
                const alignedHeight = Math.floor(sidebarRect.bottom - layoutRect.top);
                if (alignedHeight > 360) {
                    setInlineStyleIfChanged(layout, "--workspace-mode-aligned-height", `${alignedHeight}px`);
                    return;
                }
                resetLayoutHeight();
            };
            const scheduleLayoutSync = () => {
                if (frameId) window.cancelAnimationFrame(frameId);
                frameId = window.requestAnimationFrame(() => {
                    frameId = 0;
                    syncLayoutHeight();
                });
            };
            scheduleLayoutSync();
            window.addEventListener("resize", scheduleLayoutSync);
            window.addEventListener("orientationchange", scheduleLayoutSync);
            window.addEventListener("pageshow", scheduleLayoutSync);
            if (window.visualViewport) {
                window.visualViewport.addEventListener("resize", scheduleLayoutSync);
            }
            if (typeof stackedWorkspaceMedia.addEventListener === "function") {
                stackedWorkspaceMedia.addEventListener("change", scheduleLayoutSync);
            } else if (typeof stackedWorkspaceMedia.addListener === "function") {
                stackedWorkspaceMedia.addListener(scheduleLayoutSync);
            }
            if (typeof ResizeObserver === "function") {
                resizeObserver = new ResizeObserver(scheduleLayoutSync);
                resizeObserver.observe(sidebar);
                resizeObserver.observe(layout);
                resizeObserver.observe(resultsStack);
            }
            activeWorkspaceModeLayoutCleanup = () => {
                if (frameId) window.cancelAnimationFrame(frameId);
                window.removeEventListener("resize", scheduleLayoutSync);
                window.removeEventListener("orientationchange", scheduleLayoutSync);
                window.removeEventListener("pageshow", scheduleLayoutSync);
                if (window.visualViewport) {
                    window.visualViewport.removeEventListener("resize", scheduleLayoutSync);
                }
                if (typeof stackedWorkspaceMedia.removeEventListener === "function") {
                    stackedWorkspaceMedia.removeEventListener("change", scheduleLayoutSync);
                } else if (typeof stackedWorkspaceMedia.removeListener === "function") {
                    stackedWorkspaceMedia.removeListener(scheduleLayoutSync);
                }
                resizeObserver?.disconnect();
                resetLayoutHeight();
            };
        };

        const attachScrollableDataTableHeaderMeasurements = () => {
            if (typeof activeScrollableTableHeaderCleanup === "function") {
                activeScrollableTableHeaderCleanup();
                activeScrollableTableHeaderCleanup = null;
            }
            if (window.WORTHWARD_TABLES?.attachAll) {
                activeScrollableTableHeaderCleanup = window.WORTHWARD_TABLES.attachAll(
                    document.getElementById("workspace_panel") || document,
                );
                return;
            }
            const headerHeightProperty = "--scrollable-data-table-header-height";
            const scrollbarWidthProperty = "--scrollable-data-table-scrollbar-width";
            const overlayBorderCompensationProperty = "--scrollable-data-table-overlay-border-compensation";
            let frameId = 0;
            let resizeObserver = null;
            let mutationObserver = null;
            const observedShells = new Set();
            const observedHeaders = new Set();
            const observedScrollContainers = new Set();
            const observedBodyTables = new Set();

            const getOverlayHeader = (shell) => (
                Array.from(shell.children).find((child) => (
                    child instanceof HTMLTableElement
                    && child.matches('table[aria-hidden="true"]')
                )) || null
            );
            const getCurrentShells = () => (
                Array.from(new Set($$(".scrollable-data-table-shell")))
                    .filter((shell) => shell instanceof HTMLElement)
            );
            const getScrollContainer = (shell) => (
                Array.from(shell.children).find((child) => (
                    child instanceof HTMLElement
                    && child.classList.contains("scrollable-data-table-scroll")
                )) || shell.querySelector(".scrollable-data-table-scroll")
            );
            const getBodyTable = (scrollContainer) => (
                scrollContainer?.querySelector("table:not([aria-hidden='true'])") || null
            );
            const observeShell = (shell) => {
                if (!resizeObserver || observedShells.has(shell)) return;
                resizeObserver.observe(shell);
                observedShells.add(shell);
            };
            const observeHeader = (overlayHeader) => {
                if (!resizeObserver || observedHeaders.has(overlayHeader)) return;
                resizeObserver.observe(overlayHeader);
                observedHeaders.add(overlayHeader);
            };
            const observeScrollContainer = (scrollContainer) => {
                if (!resizeObserver || observedScrollContainers.has(scrollContainer)) return;
                resizeObserver.observe(scrollContainer);
                observedScrollContainers.add(scrollContainer);
            };
            const observeBodyTable = (bodyTable) => {
                if (!resizeObserver || observedBodyTables.has(bodyTable)) return;
                resizeObserver.observe(bodyTable);
                observedBodyTables.add(bodyTable);
            };
            const roundUpToDevicePixel = (value) => {
                const scale = window.devicePixelRatio || 1;
                return Math.ceil(value * scale) / scale;
            };
            const getBodyColumnMetrics = (bodyTable) => {
                if (!(bodyTable instanceof HTMLTableElement)) return null;
                const row = Array.from(bodyTable.rows).find((candidate) => candidate.cells.length);
                if (!row) return null;
                const cells = Array.from(row.cells);
                const widths = cells.map((cell) => cell.getBoundingClientRect().width);
                const lastCell = cells[widths.length - 1] || null;
                return {
                    lastCellRight: lastCell?.getBoundingClientRect().right || 0,
                    widths,
                };
            };
            const syncOverlayColumnWidths = (overlayHeader, bodyTable, trailingTrackWidth) => {
                if (!(overlayHeader instanceof HTMLTableElement) || !(bodyTable instanceof HTMLTableElement)) return;
                const bodyColumnMetrics = getBodyColumnMetrics(bodyTable);
                const columnWidths = bodyColumnMetrics?.widths || [];
                if (!columnWidths.length) return;
                Array.from(overlayHeader.children).forEach((child) => {
                    if (child instanceof HTMLElement && child.tagName === "COLGROUP") {
                        child.remove();
                    }
                });
                const lastIndex = columnWidths.length - 1;
                columnWidths[lastIndex] = Math.max(1, columnWidths[lastIndex] + trailingTrackWidth);
                Array.from(overlayHeader.rows).forEach((row) => {
                    Array.from(row.cells).forEach((cell, index) => {
                        if (index >= columnWidths.length) return;
                        cell.style.width = `${columnWidths[index] || 1}px`;
                    });
                });
            };
            const syncShell = (shell) => {
                observeShell(shell);
                const overlayHeader = getOverlayHeader(shell);
                if (!(overlayHeader instanceof HTMLElement)) {
                    shell.style.removeProperty(headerHeightProperty);
                    shell.style.removeProperty(scrollbarWidthProperty);
                    shell.style.removeProperty(overlayBorderCompensationProperty);
                    return;
                }
                observeHeader(overlayHeader);
                const scrollContainer = getScrollContainer(shell);
                const bodyTable = getBodyTable(scrollContainer);
                if (scrollContainer instanceof HTMLElement) {
                    observeScrollContainer(scrollContainer);
                    const scrollbarWidth = Math.max(0, scrollContainer.offsetWidth - scrollContainer.clientWidth);
                    let trailingTrackWidth = scrollbarWidth;
                    if (bodyTable instanceof HTMLTableElement) {
                        const bodyColumnMetrics = getBodyColumnMetrics(bodyTable);
                        if (bodyColumnMetrics && bodyColumnMetrics.lastCellRight > 0) {
                            trailingTrackWidth = Math.max(
                                0,
                                shell.getBoundingClientRect().right - bodyColumnMetrics.lastCellRight
                            );
                        }
                    }
                    shell.style.setProperty(scrollbarWidthProperty, `${trailingTrackWidth}px`);
                    shell.style.setProperty(
                        overlayBorderCompensationProperty,
                        `${trailingTrackWidth > 0 ? 1 : 0}px`
                    );
                    if (bodyTable instanceof HTMLTableElement) {
                        observeBodyTable(bodyTable);
                        syncOverlayColumnWidths(overlayHeader, bodyTable, trailingTrackWidth);
                    }
                }
                const headerHeight = overlayHeader.getBoundingClientRect().height;
                if (headerHeight > 0) {
                    shell.style.setProperty(headerHeightProperty, `${roundUpToDevicePixel(headerHeight)}px`);
                }
            };
            const syncAll = () => {
                getCurrentShells().forEach(syncShell);
            };
            const scheduleSync = () => {
                if (frameId) window.cancelAnimationFrame(frameId);
                frameId = window.requestAnimationFrame(() => {
                    frameId = 0;
                    syncAll();
                });
            };

            syncAll();
            window.addEventListener("resize", scheduleSync);
            window.addEventListener("orientationchange", scheduleSync);
            window.addEventListener("pageshow", scheduleSync);
            if (window.visualViewport) {
                window.visualViewport.addEventListener("resize", scheduleSync);
            }
            if (typeof ResizeObserver === "function") {
                resizeObserver = new ResizeObserver(scheduleSync);
                syncAll();
            }
            if (typeof MutationObserver === "function") {
                mutationObserver = new MutationObserver(scheduleSync);
                const mutationRoot = document.getElementById("workspace_panel") || document.body;
                mutationObserver.observe(mutationRoot, {
                    attributes: true,
                    attributeFilter: ["hidden", "class", "style", "aria-hidden"],
                    childList: true,
                    subtree: true,
                    characterData: true,
                });
            }
            activeScrollableTableHeaderCleanup = () => {
                if (frameId) window.cancelAnimationFrame(frameId);
                window.removeEventListener("resize", scheduleSync);
                window.removeEventListener("orientationchange", scheduleSync);
                window.removeEventListener("pageshow", scheduleSync);
                if (window.visualViewport) {
                    window.visualViewport.removeEventListener("resize", scheduleSync);
                }
                resizeObserver?.disconnect();
                mutationObserver?.disconnect();
                observedShells.forEach((shell) => {
                    shell.style.removeProperty(headerHeightProperty);
                    shell.style.removeProperty(scrollbarWidthProperty);
                    shell.style.removeProperty(overlayBorderCompensationProperty);
                });
                observedShells.clear();
                observedHeaders.clear();
                observedScrollContainers.clear();
                observedBodyTables.clear();
            };
        };

        const initializeSettingsWorkspace = () => {
            bootstrap.initSettingsWorkspace?.({
                state,
                endpoints,
                labels,
                canTransitionDom,
                rememberCurrentViewUrl,
                getProgressiveManifest,
                renderOptimisticNavigationSkeleton,
                clearOptimisticNavigationSkeleton,
                fetchJsonCached,
                progressiveResourceCache,
            });
        };

        window.addEventListener("worthward:settings-bootstrap-ready", initializeSettingsWorkspace);

        const initializeWorkspaceEnhancements = () => {
            initMobilePageBottomPadding();
            attachNoticeHandlers();
            attachTradeDetailTabs();
            bootstrap.initWorkspaceShareDrawer?.();
            attachWorkspaceSummaryMorph();
            attachWorkspaceModeLayout();
            attachScrollableDataTableHeaderMeasurements();
            initializeSettingsWorkspace();
            window.requestAnimationFrame(() => {
                window.WORTHWARD_BOOTSTRAP?.initChartWorkspace?.();
                window.WORTHWARD_BOOTSTRAP?.initPriceCompareWorkspace?.();
                window.WORTHWARD_BOOTSTRAP?.initPortfolioWorkspace?.();
                window.WORTHWARD_BOOTSTRAP?.initDcaWorkspace?.();
                window.WORTHWARD_BOOTSTRAP?.initBacktestWorkspace?.();
                window.WORTHWARD_BOOTSTRAP?.initBacktestLayout?.();
                if (state.currentView === "portfolio") {
                    dispatchPortfolioPreviewUpdate();
                }
            });
        };


        return Object.freeze({
            activeScrollableTableHeaderCleanup,
            activeWorkspaceModeLayoutCleanup,
            activeWorkspaceSummaryMorphCleanup,
            areAllFilledTickersUs,
            attachNoticeHandlers,
            attachScrollableDataTableHeaderMeasurements,
            attachTradeDetailTabs,
            attachWorkspaceModeLayout,
            attachWorkspaceSummaryMorph,
            fetchMissingLocalMarketTickers,
            getFilledTickers,
            getPortfolioAllocationInputs,
            getPortfolioAllocationMode,
            getTickerFields,
            getTickerInputs,
            getWeightFields,
            initializeSettingsWorkspace,
            initializeWorkspaceEnhancements,
            isPortfolioShareMode,
            isUsTicker,
            nonUsMarketSuffixes,
            setFormBusyState,
        });
    };

    window.WORTHWARD_APP_WORKSPACE_ENHANCEMENTS = Object.freeze({create});
})();
