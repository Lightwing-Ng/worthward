/* Code version: v0.74.8 */
(async () => {
    const state = window.WORTHWARD_APP;
    if (!state) return;
    const appScriptUrl = document.currentScript?.src || window.location.href;
    const escapeSuggestionText = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[character]);
    // A long-running server can still render the pre-migration cached template.
    if (!window.SHARED_SELECT) {
        await import(new URL("select-controller.js?v=select-controller-v1.0.1", appScriptUrl).href);
    }
    const preferenceStorage = window.WORTHWARD_STORAGE || {
        local: window.localStorage,
        session: window.sessionStorage,
    };
    const normalizeComparisonMetric = (value) => (
        String(value || "").trim().toLowerCase() === "market-cap" ? "market-cap" : "price"
    );
    const isMarketCapComparison = () => (
        state.currentView === "prices" && normalizeComparisonMetric(state.comparisonMetric) === "market-cap"
    );
    const responsive = window.WORTHWARD_RESPONSIVE;
    const bootstrap = window.WORTHWARD_BOOTSTRAP = window.WORTHWARD_BOOTSTRAP || {};
    const fetchAbortDebugConfig = state.debug?.fetchAbort || null;
    const reportFetchAbortDebug = (hypothesisId, location, msg, data = {}, runId = "post-fix") => {
        // #region debug-point A:frontend-fetch-abort
        if (!fetchAbortDebugConfig?.url) return;
        fetch(fetchAbortDebugConfig.url, {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({
                sessionId: fetchAbortDebugConfig.sessionId || "frontend-fetch-aborts",
                runId,
                hypothesisId,
                location,
                msg: `[DEBUG] ${msg}`,
                data,
                ts: Date.now(),
            }),
        }).catch(() => {});
        // #endregion
    };

    const {defaults, labels, endpoints, constraints, theme} = state;
    const workspaceUrlState = window.WORTHWARD_WORKSPACE_URL_STATE || null;
    const MONTH_ABBREVIATIONS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const MONTH_LABELS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const MONTH_TOKEN_TO_INDEX = MONTH_ABBREVIATIONS.reduce((accumulator, label, index) => {
        accumulator[label.toLowerCase()] = index;
        accumulator[MONTH_LABELS[index].toLowerCase()] = index;
        return accumulator;
    }, {});
    const THEME_MODE_STORAGE_KEY = state.currentView === "beta" ? "worthward:beta:v1:theme-mode" : "worthward:theme-mode";
    const isPortfolioView = state.currentView === "portfolio";
    const isBacktestView = state.currentView === "backtest";
    const isDcaView = state.currentView === "dca";
    const isDcaStrategy = isBacktestView && state.selectedStrategyId === "dca";
    const MIN_TICKERS = constraints?.minTickers || 2;
    const PRICE_COMPARISON_MAX_TICKERS = 5;
    const minimumRequiredTickers = (isBacktestView || isDcaView) ? 1 : MIN_TICKERS;
    const getMinimumRequiredTickers = () => {
        if (!isBacktestView) return minimumRequiredTickers;
        const configured = Number.parseInt(
            document.querySelector("form.controls")?.dataset.strategyRequiredTickers || "",
            10,
        );
        return Number.isFinite(configured) ? Math.max(1, configured) : minimumRequiredTickers;
    };
    const getLanguageState = () => window.WORTHWARD_APP?.language || {};
    const translateUi = (value) => {
        const languageState = getLanguageState();
        const languageCode = String(languageState.code || "en");
        if (languageCode === "en") return value;
        const row = Array.isArray(languageState.translations)
            ? languageState.translations.find((candidate) => candidate?.en === value)
            : null;
        return row?.[languageCode] || value;
    };
    const tickerPattern = /^[A-Z0-9][A-Z0-9.-]{0,14}$/;
    const sanitizeTicker = (value) => value.toUpperCase().replace(/[^A-Z0-9.-]/g, "").slice(0, 15);
    const tickerMatchKeys = (value) => {
        const ticker = sanitizeTicker(value || "");
        if (!ticker) return new Set();
        const keys = new Set([ticker]);
        const [symbolHead, suffix = ""] = ticker.split(".", 2);
        const numericHead = /^\d+$/.test(symbolHead) ? (symbolHead.replace(/^0+/, "") || "0") : "";
        if (numericHead) {
            keys.add(numericHead);
            if (suffix) keys.add(`${numericHead}.${suffix}`);
            if (suffix === "HK") keys.add(`${numericHead.padStart(4, "0")}.HK`);
            if (suffix === "KS") keys.add(`${numericHead.padStart(6, "0")}.KS`);
        }
        return keys;
    };
    const tickersEquivalent = (left, right) => {
        const leftTicker = sanitizeTicker(left || "");
        const rightTicker = sanitizeTicker(right || "");
        if (!leftTicker || !rightTicker) return false;
        if (leftTicker === rightTicker) return true;
        const [leftHead, leftSuffix = ""] = leftTicker.split(".", 2);
        const [rightHead, rightSuffix = ""] = rightTicker.split(".", 2);
        const normalizedLeftHead = /^\d+$/.test(leftHead) ? (leftHead.replace(/^0+/, "") || "0") : leftHead;
        const normalizedRightHead = /^\d+$/.test(rightHead) ? (rightHead.replace(/^0+/, "") || "0") : rightHead;
        if (leftSuffix && rightSuffix) {
            const shanghaiAliases = new Set(["SH", "SS"]);
            return normalizedLeftHead === normalizedRightHead
                && shanghaiAliases.has(leftSuffix)
                && shanghaiAliases.has(rightSuffix);
        }
        const leftKeys = tickerMatchKeys(left);
        const rightKeys = tickerMatchKeys(right);
        for (const key of leftKeys) {
            if (rightKeys.has(key)) return true;
        }
        return false;
    };
    const tickersExplicitlyEquivalent = (candidate, query) => {
        const normalizedCandidate = sanitizeTicker(candidate || "");
        const normalizedQuery = sanitizeTicker(query || "");
        if (!normalizedCandidate || !normalizedQuery) return false;
        if (normalizedCandidate === normalizedQuery) return true;
        if (/^\d+$/.test(normalizedQuery)) return false;
        return tickersEquivalent(normalizedCandidate, normalizedQuery);
    };
    const $ = (selector) => document.querySelector(selector);
    const $$ = (selector) => Array.from(document.querySelectorAll(selector));
    const setInlineStyleIfChanged = (element, propertyName, value) => {
        if (!(element instanceof HTMLElement)) return false;
        if (element.style.getPropertyValue(propertyName) === value) return false;
        element.style.setProperty(propertyName, value);
        return true;
    };
    const WORKSPACE_VIEWS = new Set(["tickers", "prices", "portfolio", "dca", "backtest"]);
    const UNKNOWN_MESSAGE = "Unknown or unsupported ticker.";
    const VIEW_MEMORY_KEY = "worthward:view-memory";
    const TRANSIENT_VIEW_QUERY_KEYS = new Set(["notice", "error", "broker_test_status", "broker_test_message", "broker_test_checked_at"]);
    const SIDEBAR_MEMORY_KEY = state.currentView === "beta" ? "worthward:beta:v1:sidebar-open" : "worthward:sidebar-open";
    const TRADE_DETAIL_MEMORY_KEY = "worthward:trade-detail-tab";
    const STRATEGY_MEMORY_KEY = "worthward:recent-strategies";
    const BACKTEST_STRATEGY_PARAMS_MEMORY_KEY = "worthward:backtest-strategy-params:v1";
    const runtimeState = {
        maxTickers: constraints?.maxTickers || PRICE_COMPARISON_MAX_TICKERS,
        hasInitialResult: isBacktestView
            ? Boolean(isDcaStrategy ? state.dcaResult : state.backtestResult)
            : isDcaView
                ? Boolean(state.dcaResult)
                : Boolean(state.chart?.series?.length),
        autoSubmitTimer: null,
        isSubmittingWithOverlay: false,
        workspaceSubmitToken: 0,
        pendingWorkspaceChartTransition: null,
    };
    const workspaceEnhancementState = {scheduleSummaryMorphSync: null};
    const rangeInteractionState = {
        lastRangeMode: $("input[name='range']:checked")?.value || defaults.range_mode,
        hasDerivedExactDateRange: false,
    };
    const appContext = {};
    const workspaceModalOverlay = $("#workspace_modal_overlay");
    const workspaceModalOverlayClose = $("#workspace_modal_overlay_close");
    const workspaceModalOverlayTitle = workspaceModalOverlay?.querySelector(".workspace-modal-title");
    const workspaceModalOverlayCopy = workspaceModalOverlay?.querySelector(".workspace-modal-copy");
    const workspaceModalOverlayIcon = $("#workspace_modal_overlay_icon");
    const canTransitionDom = typeof document.startViewTransition === "function";
    const progressiveResourceCache = new Map();
    const localMarketPresenceRequestCache = new Map();
    const localMarketPresencePendingRequest = new Map();
    const progressiveViewRegistry = {
        tickers: {
            masks: [
                '[data-workspace-mask="compare-summary"]',
                '[data-workspace-mask="chart-area"]',
            ],
        },
        prices: {
            masks: [
                '[data-workspace-mask="page-heading"]',
                '[data-workspace-mask="result-heading"]',
                '[data-workspace-mask="result-date-range"]',
                '[data-workspace-mask="price-subplots"]',
                '[data-workspace-mask="chart-area"]',
            ],
        },
        portfolio: {
            masks: [
                '[data-workspace-mask="result-date-range"]',
                '[data-workspace-mask="portfolio-total-return"]',
                '[data-workspace-mask="portfolio-donut-start"]',
                '[data-workspace-mask="portfolio-donut-end"]',
                '[data-workspace-mask="chart-area"]',
            ],
        },
        dca: {
            masks: [
                '[data-workspace-mask="trade-price-chart"]',
                '[data-workspace-mask="trade-equity-chart"]',
                '[data-workspace-mask="trade-metric"]',
            ],
        },
        "backtest": {
            masks: [
                '[data-workspace-mask="trade-price-chart"]',
                '[data-workspace-mask="trade-equity-chart"]',
                '[data-workspace-mask="trade-metric"]',
                '[data-workspace-mask="backtest-probability-detail-plot"]',
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
        runtimeState.pendingWorkspaceChartTransition = {
            view: state.currentView,
            reason,
            requestedAt: performance.now(),
        };
    };

    const clearWorkspaceChartTransitionRequest = () => {
        runtimeState.pendingWorkspaceChartTransition = null;
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
                values: [...(isMarketCapComparison() ? (item.market_caps || []) : (item.normalized_returns || []))],
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
        const chartAxis = window.WORTHWARD_CHART_AXIS || {};
        const closeSeries = Array.isArray(chartState.close) ? [...chartState.close] : [];
        const openSeries = Array.isArray(chartState.open) ? [...chartState.open] : [];
        const allInSeries = Array.isArray(chartState.all_in_equity) && chartState.all_in_equity.length
            ? chartState.all_in_equity.map((value) => Number(value || 0))
            : typeof chartAxis.buildAllInEquitySeries === "function"
                ? chartAxis.buildAllInEquitySeries(openSeries, closeSeries, initialCapital)
                : [];
        const allInLeveragedSeries = Array.isArray(chartState.all_in_leveraged_equity)
            ? chartState.all_in_leveraged_equity.map((value) => Number(value || 0))
            : [];
        bootstrap.backtestRefreshTransition = {
            capturedAt: performance.now(),
            rawLabels: Array.isArray(chartState.raw_dates) && chartState.raw_dates.length
                ? [...chartState.raw_dates]
                : [...chartState.dates],
            close: closeSeries,
            equity: Array.isArray(chartState.equity) ? [...chartState.equity] : [],
            allIn: allInSeries,
            allInLeveraged: allInLeveragedSeries,
            initialCapital,
        };
    };

    const didPortfolioRequestChangeXAxis = (currentParams, nextParams) => {
        const currentTickers = Array.from(currentParams.getAll("ticker")).sort().join(",");
        const nextTickers = Array.from(nextParams.getAll("ticker")).sort().join(",");
        if (currentTickers !== nextTickers) return true;

        const xAxisKeys = ["period", "range", "date", "trading_date", "exact_trading_date", "from", "exact_start", "to", "exact_end", "return", "extended-hours", "extended_hours", "include_extended_hours", "overnight", "include_overnight", "price_only", "price_return_only", "dividends", "include_dividends"];
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
    const mobileSidebarMedia = responsive.media("sidebarOverlayMax");
    const reducedMotionMedia = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sidebarGelAnimationNames = new Set([
        "workspace-sidebar-gel-open",
        "workspace-sidebar-gel-close",
    ]);
    const sidebarGelCandidateSelector = [
        ".workspace-mobile-summary-shell[data-mobile-summary-fixed] > :not(.workspace-summary-card)",
        ".settings-workspace-header > :not(.settings-summary-card)",
    ].join(", ");
    const sidebarGelTargetSelector = "[data-sidebar-gel-content]";
    let isSidebarOpen = true;
    let sidebarGelMotionResetTimer = 0;
    let sidebarGelMotionEndHandler = null;

    const readSidebarMemory = () => {
        try {
            const storedValue = preferenceStorage.session.getItem(SIDEBAR_MEMORY_KEY)
                ?? (state.currentView === "beta" ? preferenceStorage.session.getItem("worthward:sidebar-open") : null);
            if (storedValue === "true") return true;
            if (storedValue === "false") return false;
        } catch (_error) {
        }
        return !mobileSidebarMedia.matches;
    };

    const writeSidebarMemory = (value) => {
        try {
            preferenceStorage.session.setItem(SIDEBAR_MEMORY_KEY, String(Boolean(value)));
        } catch (_error) {
        }
    };

    const clearSidebarGelMotion = (shell = appShell) => {
        if (sidebarGelMotionResetTimer) {
            window.clearTimeout(sidebarGelMotionResetTimer);
            sidebarGelMotionResetTimer = 0;
        }
        if (shell && sidebarGelMotionEndHandler) {
            shell.removeEventListener("animationend", sidebarGelMotionEndHandler);
        }
        sidebarGelMotionEndHandler = null;
        shell?.classList.remove("is-sidebar-animating", "is-sidebar-opening", "is-sidebar-closing");
    };

    const syncSidebarGelTargets = (shell = appShell) => {
        if (!shell) return [];
        const targets = Array.from(shell.querySelectorAll(sidebarGelCandidateSelector));
        targets.forEach((target) => target.setAttribute("data-sidebar-gel-content", ""));
        return targets;
    };

    const setSidebarGelMotionState = (direction, shell = appShell) => {
        clearSidebarGelMotion(shell);
        const motion = window.WorthwardMotion;
        const targets = syncSidebarGelTargets(shell);
        if (
            !shell
            || !direction
            || mobileSidebarMedia.matches
            || reducedMotionMedia.matches
            || motion?.isReducedMotion?.()
            || !targets.length
            || !shell.querySelector(sidebarGelTargetSelector)
        ) {
            return;
        }

        // Flush the cleared animation state before applying the new direction so
        // rapid reversals cannot inherit stale classes or completion handlers.
        void shell.offsetWidth;
        shell.classList.add(
            "is-sidebar-animating",
            direction === "opening" ? "is-sidebar-opening" : "is-sidebar-closing",
        );
        sidebarGelMotionEndHandler = (event) => {
            if (!sidebarGelAnimationNames.has(event.animationName)) return;
            clearSidebarGelMotion(shell);
        };
        shell.addEventListener("animationend", sidebarGelMotionEndHandler);
        const fallbackDuration = Number(motion?.durations?.spatial) || 560;
        sidebarGelMotionResetTimer = window.setTimeout(
            () => clearSidebarGelMotion(shell),
            fallbackDuration + 120,
        );
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
        workspaceEnhancementState.scheduleSummaryMorphSync?.();
    };

    let sidebarFlipCancel = null;
    const applySidebarStateWithMotion = (nextIsOpen) => {
        const commitSidebarState = () => {
            applySidebarState(nextIsOpen);
            setSidebarGelMotionState(nextIsOpen ? "opening" : "closing");
        };
        // During expansion the sidebar occupies the final layout slot immediately;
        // keeping the title in that slot prevents it from crossing the glass panel.
        if (nextIsOpen) {
            sidebarFlipCancel?.();
            sidebarFlipCancel = null;
            commitSidebarState();
            return;
        }
        const targets = $$(".workspace-summary-card .report-heading, .workspace-mode-title-card .report-heading, .settings-summary-card .report-heading")
            .filter((element) => element.getClientRects().length > 0);
        const motion = window.WorthwardMotion;
        if (!motion?.flip || !targets.length) {
            commitSidebarState();
            return;
        }
        sidebarFlipCancel?.();
        sidebarFlipCancel = motion.flip(targets, commitSidebarState, {
            duration: motion.durations.spatial,
            easing: motion.easingTokens?.emphasized,
        });
    };

    if (sidebarToggle && appSidebar && appShell) {
        syncSidebarGelTargets();
        applySidebarState(readSidebarMemory());
        sidebarToggle.addEventListener("click", () => {
            applySidebarStateWithMotion(!isSidebarOpen);
            writeSidebarMemory(isSidebarOpen);
            appContext.scheduleDockPosition();
        });
    }

    if (sidebarBackdrop) {
        sidebarBackdrop.addEventListener("click", () => {
            if (!mobileSidebarMedia.matches || !isSidebarOpen) return;
            applySidebarStateWithMotion(false);
            writeSidebarMemory(false);
            appContext.scheduleDockPosition();
        });
    }

    if (typeof mobileSidebarMedia.addEventListener === "function") {
        mobileSidebarMedia.addEventListener("change", () => {
            clearSidebarGelMotion();
            applySidebarState(isSidebarOpen);
            appContext.scheduleMobilePageBottomPaddingSync();
        });
    } else if (typeof mobileSidebarMedia.addListener === "function") {
        mobileSidebarMedia.addListener(() => {
            clearSidebarGelMotion();
            applySidebarState(isSidebarOpen);
            appContext.scheduleMobilePageBottomPaddingSync();
        });
    }

    if (typeof reducedMotionMedia.addEventListener === "function") {
        reducedMotionMedia.addEventListener("change", () => clearSidebarGelMotion());
    } else if (typeof reducedMotionMedia.addListener === "function") {
        reducedMotionMedia.addListener(() => clearSidebarGelMotion());
    }

    const bindWorkspaceControlsOverlay = () => {
        const shell = $("[data-workspace-controls-shell]");
        const panel = $("[data-workspace-controls-panel]");
        const toggle = $("[data-workspace-controls-toggle]");
        const backdrop = $("[data-workspace-controls-backdrop]");
        if (
            !(shell instanceof HTMLElement)
            || !(panel instanceof HTMLElement)
            || !(toggle instanceof HTMLButtonElement)
            || !(backdrop instanceof HTMLButtonElement)
        ) {
            return;
        }

        const overlayMedia = responsive.media("sidebarOverlayMax");
        const storageKey = String(shell.dataset.workspaceControlsStorageKey || "").trim();
        let isOpen = false;

        const isGlobalSidebarOpen = () => (
            sidebarToggle instanceof HTMLButtonElement
            && sidebarToggle.getAttribute("aria-expanded") === "true"
        );
        const readRememberedState = () => {
            if (!storageKey) return false;
            try {
                return preferenceStorage.session.getItem(storageKey) === "true";
            } catch (_error) {
                return false;
            }
        };
        const rememberState = (value) => {
            if (!storageKey) return;
            try {
                preferenceStorage.session.setItem(storageKey, String(Boolean(value)));
            } catch (_error) {
            }
        };
        const applyState = (requestedOpen, {remember = false, returnFocus = false} = {}) => {
            const isOverlay = overlayMedia.matches;
            const isToggleAvailable = isOverlay && !isGlobalSidebarOpen();
            isOpen = isToggleAvailable && Boolean(requestedOpen);
            shell.classList.toggle("is-controls-overlay-open", isOpen);
            toggle.hidden = !isToggleAvailable;
            toggle.setAttribute("aria-hidden", String(!isToggleAvailable));
            toggle.setAttribute("aria-expanded", String(isOpen));
            panel.setAttribute("aria-hidden", String(isOverlay && !isOpen));
            if ("inert" in panel) panel.inert = isOverlay && !isOpen;
            backdrop.hidden = !isOpen;
            backdrop.setAttribute("aria-hidden", String(!isOpen));
            backdrop.tabIndex = isOpen ? 0 : -1;
            if ("inert" in backdrop) backdrop.inert = !isOpen;
            if (remember && isOverlay) rememberState(isOpen);
            if (returnFocus && isToggleAvailable) toggle.focus({preventScroll: true});
        };
        const onToggle = () => applyState(!isOpen, {remember: true});
        const onBackdrop = () => applyState(false, {remember: true, returnFocus: true});
        const onGlobalSidebarStateChange = () => {
            if (isGlobalSidebarOpen()) applyState(false, {remember: isOpen});
            else applyState(false);
        };
        const onKeydown = (event) => {
            if (event.key !== "Escape" || !isOpen) return;
            event.preventDefault();
            applyState(false, {remember: true, returnFocus: true});
        };
        const onMediaChange = () => applyState(overlayMedia.matches && readRememberedState());

        toggle.addEventListener("click", onToggle);
        backdrop.addEventListener("click", onBackdrop);
        const globalSidebarObserver = sidebarToggle instanceof HTMLButtonElement
            ? new MutationObserver(onGlobalSidebarStateChange)
            : null;
        globalSidebarObserver?.observe(sidebarToggle, {
            attributes: true,
            attributeFilter: ["aria-expanded"],
        });
        document.addEventListener("keydown", onKeydown);
        if (typeof overlayMedia.addEventListener === "function") {
            overlayMedia.addEventListener("change", onMediaChange);
        } else if (typeof overlayMedia.addListener === "function") {
            overlayMedia.addListener(onMediaChange);
        }
        applyState(overlayMedia.matches && readRememberedState());
    };
    bindWorkspaceControlsOverlay();


    const form = $("form.controls");
    const comparisonMetricInputs = $$("[data-comparison-metric-input]");
    const getComparisonMetric = () => {
        const selectedInput = comparisonMetricInputs.find((input) => input.checked);
        return normalizeComparisonMetric(selectedInput?.value || state.comparisonMetric);
    };
    const clearComparisonMetricValidation = () => {
        document.querySelectorAll("[data-comparison-metric-validation]").forEach((node) => {
            node.hidden = true;
            node.textContent = "";
        });
    };
    const showComparisonMetricValidation = (message) => {
        const field = document.querySelector("[data-comparison-metric-field]");
        if (!(field instanceof HTMLElement) || !message) return;
        let feedback = field.querySelector("[data-comparison-metric-validation]");
        if (!(feedback instanceof HTMLElement)) {
            feedback = document.createElement("p");
            feedback.className = "comparison-metric-validation";
            feedback.dataset.comparisonMetricValidation = "";
            feedback.setAttribute("role", "alert");
            field.appendChild(feedback);
        }
        feedback.textContent = message;
        feedback.hidden = false;
    };
    const periodPanel = $("#period_panel");
    const exactPanel = $("#exact_panel");
    const periodSelect = $("#period");
    const rangeModeInputs = $$("input[name='range']");
    const exactStartInput = $("#exact_start");
    const exactEndInput = $("#exact_end");
    const exactTradingDateInput = $("#exact_trading_date");
    const exactRangeDateGrid = $("[data-exact-range-date-grid]");
    const exactSingleDateGrid = $("[data-exact-single-date-grid]");
    const extendedHoursInput = $("#include_extended_hours");
    const extendedHoursField = $("[data-one-day-extended-hours-field]");
    const overnightInput = $("#include_overnight_hours");
    const overnightField = $("[data-one-day-overnight-field]");
    const chipsInput = $("#show_chips");
    const priceOnlyInput = $("#price_only");
    const priceOnlyField = $("[data-price-only-field]");
    const includeDividendsInput = $("#include_dividends");
    const dividendReinvestField = $("[data-dividend-reinvest-field]");
    const stopLossInput = $("#stop_loss");
    const showTradeDetailsInput = $("#show_trade_details");
    const tradeCapitalField = $(".trade-capital-field");
    const tradeCapitalInput = $("#trade_initial_capital");
    const tradeCapitalSlider = $("#trade_initial_capital_slider");

    const appModuleSpecs = Object.freeze([
        ["WORTHWARD_APP_CHART_EXPORT", "app/chart-export.js", "app-chart-export-v1.1.1"],
        ["WORTHWARD_APP_NAVIGATION", "app/navigation.js", "app-navigation-v1.3.1"],
        ["WORTHWARD_APP_WORKSPACE_ENHANCEMENTS", "app/workspace-enhancements.js", "app-workspace-enhancements-v1.0.0"],
        ["WORTHWARD_APP_WORKSPACE_HYDRATION", "app/workspace-hydration.js", "app-workspace-hydration-v1.4.0"],
        ["WORTHWARD_APP_TICKER_CONTROLS", "app/ticker-controls.js", "app-ticker-controls-v1.0.3"],
        ["WORTHWARD_APP_SELECT_CONTROLS", "app/select-controls.js", "app-select-controls-v1.0.2"],
        ["WORTHWARD_APP_DATE_CONTROLS", "app/date-controls.js", "app-date-controls-v1.1.0"],
        ["WORTHWARD_APP_RANGE_CONTROLS", "app/range-controls.js", "app-range-controls-v1.0.1"],
        ["WORTHWARD_APP_STRATEGY_CONTROLS", "app/strategy-controls.js", "app-strategy-controls-v1.1.0"],
    ]);
    for (const [namespace, relativePath, cacheKey] of appModuleSpecs) {
        if (typeof window[namespace]?.create === "function") continue;
        await import(new URL(`${relativePath}?v=${cacheKey}`, appScriptUrl).href);
    }

    Object.assign(appContext, {
        $,
        $$,
        BACKTEST_STRATEGY_PARAMS_MEMORY_KEY,
        MIN_TICKERS,
        MONTH_ABBREVIATIONS,
        MONTH_LABELS,
        MONTH_TOKEN_TO_INDEX,
        PRICE_COMPARISON_MAX_TICKERS,
        SIDEBAR_MEMORY_KEY,
        STRATEGY_MEMORY_KEY,
        THEME_MODE_STORAGE_KEY,
        TRADE_DETAIL_MEMORY_KEY,
        TRANSIENT_VIEW_QUERY_KEYS,
        UNKNOWN_MESSAGE,
        VIEW_MEMORY_KEY,
        WORKSPACE_VIEWS,
        appShell,
        appSidebar,
        applySidebarState,
        applySidebarStateWithMotion,
        bootstrap,
        canTransitionDom,
        captureBacktestRefreshTransition,
        captureLineChartRefreshTransition,
        chipsInput,
        clearComparisonMetricValidation,
        clearSidebarGelMotion,
        clearWorkspaceChartTransitionRequest,
        comparisonMetricInputs,
        constraints,
        defaults,
        didPortfolioRequestChangeXAxis,
        dividendReinvestField,
        endpoints,
        escapeSuggestionText,
        exactEndInput,
        exactPanel,
        exactRangeDateGrid,
        exactSingleDateGrid,
        exactStartInput,
        exactTradingDateInput,
        extendedHoursField,
        extendedHoursInput,
        fetchAbortDebugConfig,
        fetchJsonCached,
        form,
        getComparisonMetric,
        getLanguageState,
        getMinimumRequiredTickers,
        includeDividendsInput,
        isBacktestView,
        isDcaStrategy,
        isDcaView,
        isMarketCapComparison,
        isPortfolioView,
        isSidebarOpen,
        labels,
        localMarketPresencePendingRequest,
        localMarketPresenceRequestCache,
        minimumRequiredTickers,
        mobileSidebarMedia,
        normalizeComparisonMetric,
        overnightField,
        overnightInput,
        periodPanel,
        periodSelect,
        preferenceStorage,
        priceOnlyField,
        priceOnlyInput,
        progressiveResourceCache,
        progressiveViewRegistry,
        rangeInteractionState,
        rangeModeInputs,
        readSidebarMemory,
        reducedMotionMedia,
        reportFetchAbortDebug,
        requestWorkspaceChartTransition,
        responsive,
        runtimeState,
        sanitizeTicker,
        setInlineStyleIfChanged,
        setSidebarGelMotionState,
        showComparisonMetricValidation,
        showTradeDetailsInput,
        sidebarBackdrop,
        sidebarFlipCancel,
        sidebarGelAnimationNames,
        sidebarGelCandidateSelector,
        sidebarGelMotionEndHandler,
        sidebarGelMotionResetTimer,
        sidebarGelTargetSelector,
        sidebarToggle,
        state,
        stopLossInput,
        syncSidebarGelTargets,
        theme,
        tickerMatchKeys,
        tickerPattern,
        tickersEquivalent,
        tickersExplicitlyEquivalent,
        tradeCapitalField,
        tradeCapitalInput,
        tradeCapitalSlider,
        translateUi,
        workspaceEnhancementState,
        workspaceModalOverlay,
        workspaceModalOverlayClose,
        workspaceModalOverlayCopy,
        workspaceModalOverlayIcon,
        workspaceModalOverlayTitle,
        workspaceUrlState,
        writeSidebarMemory,
    });

    const installAppModule = (namespace) => {
        const moduleFactory = window[namespace];
        if (typeof moduleFactory?.create !== "function") {
            throw new Error(`Missing Worthward app module: ${namespace}`);
        }
        const moduleApi = moduleFactory.create(appContext);
        if (!moduleApi || typeof moduleApi !== "object") {
            throw new Error(`Invalid Worthward app module: ${namespace}`);
        }
        Object.assign(appContext, moduleApi);
    };

    appModuleSpecs.forEach(([namespace]) => installAppModule(namespace));
})();
