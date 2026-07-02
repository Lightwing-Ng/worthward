/* Code version: v0.5.4 */
(() => {
    const state = window.ANTIGRAVITY_APP;
    if (!state) return;
    const bootstrap = window.ANTIGRAVITY_BOOTSTRAP = window.ANTIGRAVITY_BOOTSTRAP || {};
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
    const isDcaView = state.currentView === "dca";
    const MIN_TICKERS = constraints?.minTickers || 2;
    const MAX_TICKERS = constraints?.maxTickers || 5;
    const minimumRequiredTickers = (isBacktestView || isDcaView) ? 1 : MIN_TICKERS;
    const getLanguageState = () => window.ANTIGRAVITY_APP?.language || {};
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
    const $ = (selector) => document.querySelector(selector);
    const $$ = (selector) => Array.from(document.querySelectorAll(selector));
    const WORKSPACE_VIEWS = new Set(["tickers", "portfolio", "dca", "backtest"]);
    const UNKNOWN_MESSAGE = "Unknown or unsupported ticker.";
    const VIEW_MEMORY_KEY = "antigravity:view-memory";
    const TRANSIENT_VIEW_QUERY_KEYS = new Set(["notice", "error", "broker_test_status", "broker_test_message", "broker_test_checked_at"]);
    const SIDEBAR_MEMORY_KEY = "antigravity:sidebar-open";
    const TRADE_DETAIL_MEMORY_KEY = "antigravity:trade-detail-tab";
    const STRATEGY_MEMORY_KEY = "antigravity:recent-strategies";
    let hasInitialResult = isBacktestView
        ? Boolean(state.backtestResult)
        : isDcaView
            ? Boolean(state.dcaResult)
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
    let activeWorkspaceModeLayoutCleanup = null;
    let scheduleWorkspaceSummaryMorphSync = null;
    let workspaceHydrationToken = 0;
    let pendingWorkspaceChartTransition = null;
    let optimisticNavigationFrame = 0;
    let optimisticNavigationSnapshot = null;
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
        dca: {
            masks: [
                '[data-workspace-mask="trade-metric"]',
                '[data-workspace-mask="trade-price-chart"]',
                '[data-workspace-mask="trade-equity-chart"]',
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

    const resolveSettingsSectionFromUrl = (url) => {
        try {
            const parsedUrl = new URL(url, window.location.origin);
            const pathMatch = parsedUrl.pathname.match(/^\/settings\/([^/?#]+)/);
            return pathMatch?.[1] || "about";
        } catch (_error) {
            return "about";
        }
    };

    const resolveMoreSectionFromUrl = (url) => {
        try {
            const parsedUrl = new URL(url, window.location.origin);
            const pathMatch = parsedUrl.pathname.match(/^\/more\/([^/?#]+)/);
            if (pathMatch?.[1] === "live-trading") return "live-trading";
            return "investment";
        } catch (_error) {
            return "investment";
        }
    };

    const SETTINGS_NAVIGATION_PROFILES = Object.freeze({
        about: {title: "About", layout: "reading"},
        backtest: {title: "Backtest", layout: "options"},
        "broker-access": {title: "Broker access", layout: "broker"},
        "cash-equivalents": {title: labels.cash_equivalents || "Cash equivalents", layout: "actions"},
        "clear-caches": {title: "Clear caches", layout: "actions"},
        "email-smtp": {title: labels.email_smtp || "Email (SMTP)", layout: "form"},
        "export-image": {title: "Export image", layout: "tokens"},
        "font-tokens": {title: "Font tokens", layout: "tokens"},
        general: {title: "General", layout: "options"},
        "local-market-store": {title: labels.local_market_store || "Local market store", layout: "table"},
        "material-tokens": {title: "Material tokens", layout: "tokens"},
        network: {title: labels.network_self_check || "Network self-check", layout: "actions"},
        strategies: {title: labels.strategy_settings || "Strategy settings", layout: "actions"},
        "style-tokens": {title: "Style tokens", layout: "tokens"},
    });
    const SETTINGS_NAVIGATION_ORDER = Object.freeze(Object.keys(SETTINGS_NAVIGATION_PROFILES));
    const MORE_NAVIGATION_PROFILES = Object.freeze({
        investment: {title: "Investment"},
        "live-trading": {title: "Live trading"},
    });
    const WORKSPACE_NAVIGATION_PROFILES = Object.freeze({
        tickers: {title: labels.dock_tickers || "Compare stocks"},
        portfolio: {title: labels.dock_portfolio || "Compute your portfolio"},
        dca: {title: labels.dock_dca || "Dollar-cost averaging"},
        backtest: {title: labels.dock_backtest || "Backtest"},
    });

    const escapeSkeletonText = (value) => String(value || "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");

    const navigationSkeletonLine = (width = "100%", className = "") => `
        <span class="navigation-skeleton-line${className ? ` ${className}` : ""}"
              style="--navigation-skeleton-width: ${width};"></span>
    `;

    const navigationSkeletonLines = (widths) => `
        <div class="navigation-skeleton-copy">
            ${widths.map((width) => navigationSkeletonLine(width)).join("")}
        </div>
    `;

    const buildNavigationSidebar = (targetView, targetSection) => {
        let title = "Workspaces";
        let items = Object.entries(WORKSPACE_NAVIGATION_PROFILES).map(([key, profile]) => ({
            key,
            label: profile.title,
        }));
        let activeKey = targetView;
        if (targetView === "settings") {
            title = labels.settings_title || "Settings";
            items = SETTINGS_NAVIGATION_ORDER.map((key) => ({key, label: SETTINGS_NAVIGATION_PROFILES[key].title}));
            activeKey = SETTINGS_NAVIGATION_PROFILES[targetSection] ? targetSection : "about";
        } else if (targetView === "more") {
            title = labels.dock_more || "More";
            items = Object.entries(MORE_NAVIGATION_PROFILES).map(([key, profile]) => ({key, label: profile.title}));
            activeKey = MORE_NAVIGATION_PROFILES[targetSection] ? targetSection : "investment";
        }
        const activeIndex = Math.max(items.findIndex((item) => item.key === activeKey), 0);
        return `
            <section class="hero"><h1>${escapeSkeletonText(title)}</h1></section>
            <nav class="settings-nav navigation-skeleton-sidebar-nav"
                 style="--settings-active-index: ${activeIndex};"
                 aria-hidden="true">
                ${items.map((item) => `
                    <div class="settings-nav-item${item.key === activeKey ? " is-active" : ""}">
                        <span class="settings-nav-icon-shell navigation-skeleton-icon"></span>
                        <span class="settings-nav-label">${escapeSkeletonText(item.label)}</span>
                    </div>
                `).join("")}
            </nav>
        `;
    };

    const buildNavigationTitleCard = (title) => `
        <article class="report-card workspace-article-card workspace-summary-card navigation-skeleton-title-card">
            <div class="report-heading-row"><p class="report-heading">${escapeSkeletonText(title)}</p></div>
        </article>
    `;

    const buildWorkspaceNavigationSkeleton = (targetView) => {
        const profile = WORKSPACE_NAVIGATION_PROFILES[targetView] || WORKSPACE_NAVIGATION_PROFILES.backtest;
        if (targetView === "tickers") {
            return `
                <section class="workspace-header workspace-mobile-summary-shell navigation-skeleton-page">
                    ${buildNavigationTitleCard(profile.title)}
                    <article class="report-card workspace-content-card navigation-skeleton-card navigation-skeleton-summary-grid">
                        ${["72%", "56%", "68%"].map((width) => `<div class="navigation-skeleton-metric">${navigationSkeletonLines([width, "42%"])}</div>`).join("")}
                    </article>
                    <article class="chart-surface navigation-skeleton-card navigation-skeleton-chart">${navigationSkeletonLines(["30%"])}</article>
                </section>
            `;
        }
        if (targetView === "portfolio") {
            return `
                <section class="workspace-header workspace-mobile-summary-shell navigation-skeleton-page">
                    ${buildNavigationTitleCard(profile.title)}
                    <article class="report-card workspace-content-card navigation-skeleton-card navigation-skeleton-portfolio">
                        <span class="navigation-skeleton-orbit"></span>
                        <span class="navigation-skeleton-orbit"></span>
                        ${navigationSkeletonLines(["46%", "62%"]) }
                    </article>
                    <article class="chart-surface navigation-skeleton-card navigation-skeleton-chart">${navigationSkeletonLines(["34%"])}</article>
                </section>
            `;
        }
        const metricCount = targetView === "dca" ? 9 : 10;
        return `
            <section class="workspace-mode-shell navigation-skeleton-page">
                ${buildNavigationTitleCard(profile.title)}
                <div class="workspace-mode-layout navigation-skeleton-workspace-layout">
                    <article class="chart-surface workspace-mode-controls-surface navigation-skeleton-card navigation-skeleton-controls">
                        ${navigationSkeletonLines(["42%", "100%", "72%", "100%", "56%", "100%"]) }
                    </article>
                    <article class="workspace-mode-main navigation-skeleton-results">
                        <article class="report-card workspace-content-card navigation-skeleton-card navigation-skeleton-metrics-grid">
                            ${Array.from({length: metricCount}, () => `<div class="navigation-skeleton-metric">${navigationSkeletonLines(["68%", "42%"])}</div>`).join("")}
                        </article>
                        <article class="chart-surface navigation-skeleton-card navigation-skeleton-chart">${navigationSkeletonLines(["36%"])}</article>
                    </article>
                </div>
            </section>
        `;
    };

    const buildMoreNavigationSkeleton = (targetSection) => {
        const section = MORE_NAVIGATION_PROFILES[targetSection] ? targetSection : "investment";
        const title = MORE_NAVIGATION_PROFILES[section].title;
        if (section === "live-trading") {
            return `
                <section class="workspace-header investment-workspace-header workspace-mobile-summary-shell navigation-skeleton-page">
                    ${buildNavigationTitleCard(title)}
                    <article class="report-card workspace-content-card navigation-skeleton-card navigation-skeleton-live-trading">
                        ${navigationSkeletonLines(["26%", "58%", "34%", "100%", "42%", "100%"]) }
                        <div class="navigation-skeleton-action-row">${navigationSkeletonLine("38%")} ${navigationSkeletonLine("28%")}</div>
                    </article>
                </section>
            `;
        }
        return `
            <section class="workspace-header investment-workspace-header workspace-mobile-summary-shell navigation-skeleton-page">
                ${buildNavigationTitleCard(title)}
                <article class="report-card workspace-content-card navigation-skeleton-card navigation-skeleton-investment">
                    <div class="navigation-skeleton-segments">${Array.from({length: 4}, () => navigationSkeletonLine("100%")).join("")}</div>
                    <div class="navigation-skeleton-chart navigation-skeleton-chart-compact"></div>
                </article>
                <article class="chart-surface navigation-skeleton-card navigation-skeleton-table">
                    ${navigationSkeletonLines(["28%", "100%", "100%", "92%", "100%", "84%"]) }
                </article>
            </section>
        `;
    };

    const buildSettingsNavigationContent = (layout) => {
        if (layout === "broker") {
            return `
                <section class="settings-action-package navigation-skeleton-card navigation-skeleton-callout">
                    <span class="navigation-skeleton-icon navigation-skeleton-icon-large"></span>
                    ${navigationSkeletonLines(["92%", "76%"]) }
                </section>
                <section class="settings-stack-form settings-form-shell navigation-skeleton-form">
                    ${["Broker", "Authentication", "Credential", "Account"].map((label) => `
                        <div class="navigation-skeleton-field">
                            <span class="settings-form-label">${label}</span>
                            ${navigationSkeletonLine("100%", "navigation-skeleton-control")}
                        </div>
                    `).join("")}
                    <section class="settings-action-package navigation-skeleton-card navigation-skeleton-form-action">
                        ${navigationSkeletonLines(["78%", "58%"]) }
                        ${navigationSkeletonLine("34%", "navigation-skeleton-button")}
                    </section>
                </section>
            `;
        }
        if (layout === "table") {
            return `<section class="navigation-skeleton-card navigation-skeleton-table">${navigationSkeletonLines(["100%", "96%", "100%", "90%", "100%", "94%", "100%"])}</section>`;
        }
        if (layout === "tokens") {
            return `<section class="navigation-skeleton-token-grid">${Array.from({length: 8}, (_, index) => `<article class="navigation-skeleton-card navigation-skeleton-token">${navigationSkeletonLines([index % 2 ? "54%" : "68%", "88%", "44%"])}</article>`).join("")}</section>`;
        }
        if (layout === "options") {
            return `<section class="navigation-skeleton-option-stack">${Array.from({length: 5}, () => `<article class="navigation-skeleton-card navigation-skeleton-option">${navigationSkeletonLines(["38%", "86%", "64%"])}</article>`).join("")}</section>`;
        }
        if (layout === "actions") {
            return `<section class="navigation-skeleton-option-stack">${Array.from({length: 4}, () => `<article class="settings-action-package navigation-skeleton-card navigation-skeleton-action">${navigationSkeletonLines(["46%", "92%", "70%"])}</article>`).join("")}</section>`;
        }
        if (layout === "form") {
            return `<section class="settings-stack-form settings-form-shell navigation-skeleton-form">${Array.from({length: 5}, () => `<div class="navigation-skeleton-field">${navigationSkeletonLine("32%")} ${navigationSkeletonLine("100%", "navigation-skeleton-control")}</div>`).join("")}</section>`;
        }
        return `<article class="report-card workspace-content-card navigation-skeleton-card navigation-skeleton-reading">${navigationSkeletonLines(["38%", "96%", "88%", "92%", "74%", "86%"])}</article>`;
    };

    const buildSettingsNavigationSkeleton = (targetSection) => {
        const section = SETTINGS_NAVIGATION_PROFILES[targetSection] ? targetSection : "about";
        const profile = SETTINGS_NAVIGATION_PROFILES[section];
        return `
            <section class="workspace-header settings-workspace-header settings-shell-${section} navigation-skeleton-page"
                     id="settings_workspace_shell"
                     data-settings-workspace-region
                     data-settings-section="${section}">
                ${buildNavigationTitleCard(profile.title)}
                ${buildSettingsNavigationContent(profile.layout)}
            </section>
        `;
    };

    const renderOptimisticNavigationSkeleton = ({view, section = null} = {}) => {
        const targetView = view || state.currentView;
        const workspacePanel = document.getElementById("workspace_panel");
        const sidebar = document.getElementById("app_sidebar");
        if (!(workspacePanel instanceof HTMLElement) || !(sidebar instanceof HTMLElement)) return false;
        let normalizedSection = section;
        let workspaceMarkup = "";
        if (targetView === "settings") {
            normalizedSection = SETTINGS_NAVIGATION_PROFILES[section] ? section : "about";
            workspaceMarkup = buildSettingsNavigationSkeleton(normalizedSection);
        } else if (targetView === "more") {
            normalizedSection = MORE_NAVIGATION_PROFILES[section] ? section : "investment";
            workspaceMarkup = buildMoreNavigationSkeleton(normalizedSection);
        } else if (WORKSPACE_VIEWS.has(targetView)) {
            workspaceMarkup = buildWorkspaceNavigationSkeleton(targetView);
        } else {
            return false;
        }
        if (targetView !== state.currentView) {
            sidebar.innerHTML = buildNavigationSidebar(targetView, normalizedSection);
        }
        workspacePanel.innerHTML = `
            <div class="navigation-skeleton-status sr-only" role="status" aria-live="polite">Loading ${escapeSkeletonText(targetView === "settings" ? SETTINGS_NAVIGATION_PROFILES[normalizedSection].title : targetView === "more" ? MORE_NAVIGATION_PROFILES[normalizedSection].title : WORKSPACE_NAVIGATION_PROFILES[targetView].title)}</div>
            <div class="navigation-skeleton-root" data-navigation-skeleton aria-hidden="true">${workspaceMarkup}</div>
        `;
        workspacePanel.dataset.navigationSkeleton = "1";
        workspacePanel.setAttribute("aria-busy", "true");
        scheduleMobilePageBottomPaddingSync();
        return true;
    };
    const clearOptimisticNavigationSkeleton = () => {
        const workspacePanel = document.getElementById("workspace_panel");
        if (!(workspacePanel instanceof HTMLElement)) return;
        delete workspacePanel.dataset.navigationSkeleton;
        workspacePanel.removeAttribute("aria-busy");
    };
    const captureOptimisticNavigationSnapshot = () => {
        if (optimisticNavigationSnapshot) return;
        const sidebar = document.getElementById("app_sidebar");
        const workspacePanel = document.getElementById("workspace_panel");
        const dock = document.querySelector(".sidebar-dock");
        if (!(sidebar instanceof HTMLElement) || !(workspacePanel instanceof HTMLElement)) return;
        optimisticNavigationSnapshot = {
            sidebarNodes: Array.from(sidebar.childNodes),
            workspaceNodes: Array.from(workspacePanel.childNodes),
            dockState: Array.from(dock?.querySelectorAll(".sidebar-dock-item") || []).map((item) => ({
                className: item.className,
                ariaCurrent: item.getAttribute("aria-current"),
            })),
        };
    };
    const restoreOptimisticNavigationSnapshot = () => {
        if (!optimisticNavigationSnapshot) return false;
        const sidebar = document.getElementById("app_sidebar");
        const workspacePanel = document.getElementById("workspace_panel");
        const dock = document.querySelector(".sidebar-dock");
        if (!(sidebar instanceof HTMLElement) || !(workspacePanel instanceof HTMLElement)) return false;
        sidebar.replaceChildren(...optimisticNavigationSnapshot.sidebarNodes);
        workspacePanel.replaceChildren(...optimisticNavigationSnapshot.workspaceNodes);
        if (dock instanceof HTMLElement) {
            Array.from(dock.querySelectorAll(".sidebar-dock-item")).forEach((item, index) => {
                const itemState = optimisticNavigationSnapshot.dockState[index];
                if (!itemState) return;
                item.className = itemState.className;
                if (itemState.ariaCurrent) {
                    item.setAttribute("aria-current", itemState.ariaCurrent);
                } else {
                    item.removeAttribute("aria-current");
                }
            });
        }
        optimisticNavigationSnapshot = null;
        clearOptimisticNavigationSkeleton();
        scheduleDockPosition();
        scheduleMobilePageBottomPaddingSync();
        return true;
    };
    bootstrap.renderOptimisticNavigationSkeleton = renderOptimisticNavigationSkeleton;
    bootstrap.clearOptimisticNavigationSkeleton = clearOptimisticNavigationSkeleton;

    const resolveViewFromUrl = (url) => {
        try {
            const parsedUrl = new URL(url, window.location.origin);
            const path = parsedUrl.pathname.toLowerCase();
            if (
                path === "/compare"
                || path.startsWith("/compare/")
                || path === "/workspaces/compare"
                || path.startsWith("/workspaces/compare/")
            ) return "tickers";
            if (
                path === "/portfolio"
                || path.startsWith("/portfolio/")
                || path === "/workspaces/portfolio"
                || path.startsWith("/workspaces/portfolio/")
            ) return "portfolio";
            if (
                path === "/dca"
                || path.startsWith("/dca/")
                || path === "/workspaces/dca"
                || path.startsWith("/workspaces/dca/")
            ) return "dca";
            if (
                path === "/backtest"
                || path.startsWith("/backtest/")
                || path === "/workspaces/backtest"
                || path.startsWith("/workspaces/backtest/")
            ) return "backtest";
            if (path === "/more" || path.startsWith("/more/") || path === "/invest" || path === "/investment") return "more";
            if (path === "/settings" || path.startsWith("/settings/")) return "settings";
            return null;
        } catch (_error) {
            return null;
        }
    };

    const resolveDockGroupFromView = (view) => (WORKSPACE_VIEWS.has(view) ? "workspace" : view);

    const normalizeNavigationUrl = (url) => {
        try {
            const parsedUrl = new URL(url, window.location.origin);
            return `${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`;
        } catch (_error) {
            return String(url || "");
        }
    };

    const syncDockPreviewTarget = (targetDockGroup) => {
        if (!targetDockGroup) return;
        const dockGroupByIndex = ["workspace", "more", "settings"];
        $$(".sidebar-dock-item").forEach((link, index) => {
            const isTarget = dockGroupByIndex[index] === targetDockGroup;
            link.classList.toggle("is-active", isTarget);
            if (isTarget) {
                link.setAttribute("aria-current", "page");
            } else {
                link.removeAttribute("aria-current");
            }
        });
    };

    const syncLocalPreviewTarget = (link) => {
        if (!(link instanceof HTMLElement)) return;
        if (link.classList.contains("settings-nav-item")) {
            const nav = link.closest(".settings-nav, .settings-nav-list, .hero");
            const scope = nav || link.parentElement;
            const navItems = Array.from(scope?.querySelectorAll(".settings-nav-item") || []);
            let activeIndex = 0;
            navItems.forEach((item, index) => {
                const isTarget = item === link;
                item.classList.toggle("is-active", isTarget);
                if (isTarget) {
                    item.setAttribute("aria-current", "page");
                    activeIndex = index;
                } else {
                    item.removeAttribute("aria-current");
                }
            });
            if (scope instanceof HTMLElement) scope.style.setProperty("--settings-active-index", String(Math.max(0, activeIndex)));
            return;
        }
        if (link.classList.contains("local-store-page-button") && !link.classList.contains("local-store-page-nav")) {
            const pagination = link.closest(".local-store-pagination");
            pagination?.querySelectorAll(".local-store-page-button").forEach((item) => {
                item.classList.toggle("is-active", item === link);
            });
        }
    };

    const beginOptimisticPageNavigation = (nextUrl, {link = null, targetDockGroup = null} = {}) => {
        if (optimisticNavigationFrame) window.cancelAnimationFrame(optimisticNavigationFrame);
        const targetView = resolveViewFromUrl(nextUrl);
        const targetSection = targetView === "settings"
            ? resolveSettingsSectionFromUrl(nextUrl)
            : targetView === "more"
                ? resolveMoreSectionFromUrl(nextUrl)
                : null;
        const dockGroup = targetDockGroup || resolveDockGroupFromView(targetView);
        captureOptimisticNavigationSnapshot();
        document.body.classList.add("is-workspace-switching", "is-page-navigating");
        document.documentElement.dataset.navigationTarget = targetView || "page";
        document.documentElement.setAttribute("aria-busy", "true");
        syncDockPreviewTarget(dockGroup);
        syncLocalPreviewTarget(link);
        renderOptimisticNavigationSkeleton({view: targetView, section: targetSection});
        let navigationCommitted = false;
        const commitNavigation = () => {
            if (navigationCommitted) return;
            navigationCommitted = true;
            optimisticNavigationFrame = 0;
            window.location.assign(nextUrl);
        };
        const fallbackTimer = window.setTimeout(commitNavigation, 120);
        optimisticNavigationFrame = window.requestAnimationFrame(() => {
            window.setTimeout(() => {
                window.clearTimeout(fallbackTimer);
                commitNavigation();
            }, 0);
        });
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
        const currentTickers = Array.from(currentParams.getAll("ticker")).sort().join(",");
        const nextTickers = Array.from(nextParams.getAll("ticker")).sort().join(",");
        if (currentTickers !== nextTickers) return true;

        const xAxisKeys = ["period", "range", "from", "exact_start", "to", "exact_end", "dividends", "include_dividends"];
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
        const stackedWorkspaceMedia = window.matchMedia("(max-width: 767px)");
        let frameId = 0;
        let resizeObserver = null;
        const resetLayoutHeight = () => {
            layout.style.setProperty("--workspace-mode-aligned-height", "auto");
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
                layout.style.setProperty("--workspace-mode-aligned-height", `${alignedHeight}px`);
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

    const initializeWorkspaceEnhancements = () => {
        initMobilePageBottomPadding();
        attachNoticeHandlers();
        attachTradeDetailTabs();
        bootstrap.initWorkspaceShareDrawer?.();
        attachWorkspaceSummaryMorph();
        attachWorkspaceModeLayout();
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
        window.requestAnimationFrame(() => {
            window.ANTIGRAVITY_BOOTSTRAP?.initChartWorkspace?.();
            window.ANTIGRAVITY_BOOTSTRAP?.initPortfolioWorkspace?.();
            window.ANTIGRAVITY_BOOTSTRAP?.initDcaWorkspace?.();
            window.ANTIGRAVITY_BOOTSTRAP?.initBacktestWorkspace?.();
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
        if (state.currentView === "dca") {
            const dcaMetricLabels = [
                "Amount per period",
                "Total invested",
                "Final equity",
                "Net return",
                "Total buys",
                "Total shares",
                "Average cost",
                "If all in",
                "vs all in",
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
									<span class="segmented-control-option"><span>${labels.dca_metrics_tab}</span></span>
									<span class="segmented-control-option"><span>${labels.dca_transactions_tab}</span></span>
								</div>
							</div>
							<div class="trade-detail-panel">
								<div class="trade-metrics-grid trade-view-panel-grid trade-metrics-panel-grid" id="backtest_metrics_panel">
									${dcaMetricLabels.map((label) => `<div class="trade-metric-card"><span class="trade-metric-label">${label}</span><span class="trade-metric-value is-pending-value" data-workspace-mask="trade-metric">0000</span></div>`).join("")}
								</div>
							</div>
						</div>
					</article>
					<article class="chart-surface backtest-surface">
						<div class="chart-heading-row"><p class="chart-heading">${chartHeading}</p></div>
						<div class="trade-chart-stack">
							<div class="trade-chart-panel is-pending-value" data-workspace-mask="trade-price-chart"></div>
							<div class="trade-chart-panel trade-chart-panel-equity is-pending-value" data-workspace-mask="trade-equity-chart"></div>
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

    const hydrateWorkspaceModeMain = (workspacePanel, nextWorkspacePanel) => {
        const currentMain = workspacePanel.querySelector(".workspace-mode-main");
        const nextMain = nextWorkspacePanel.querySelector(".workspace-mode-main");
        if (!currentMain || !nextMain) {
            workspacePanel.querySelectorAll("canvas").forEach((canvas) => {
                window.Chart?.getChart?.(canvas)?.destroy();
            });
            workspacePanel.innerHTML = nextWorkspacePanel.innerHTML;
            return;
        }
        currentMain.querySelectorAll("canvas").forEach((canvas) => {
            window.Chart?.getChart?.(canvas)?.destroy();
        });
        currentMain.replaceWith(nextMain.cloneNode(true));
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
        if (state.currentView === "backtest" || state.currentView === "dca") {
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
        if (activeWorkspaceHydration) {
            reportFetchAbortDebug("B", "app.js:hydrateWorkspaceFromUrl", "aborting previous workspace hydration", {
                nextUrl,
                currentPath: window.location.pathname + window.location.search,
            });
        }
        abortActiveWorkspaceHydration();
        const token = ++workspaceHydrationToken;
        const controller = new AbortController();
        activeWorkspaceHydration = controller;
        reportFetchAbortDebug("B", "app.js:hydrateWorkspaceFromUrl", "starting workspace hydration", {
            nextUrl,
            token,
        });
        let response;
        try {
            response = await fetch(nextUrl, {
                headers: {
                    "X-Requested-With": "workspace-hydrate",
                },
                credentials: "same-origin",
                signal: controller.signal,
            });
        } catch (error) {
            reportFetchAbortDebug("B", "app.js:hydrateWorkspaceFromUrl", "workspace hydration fetch failed", {
                nextUrl,
                token,
                errorName: error?.name || "",
                errorMessage: error?.message || "",
                aborted: controller.signal.aborted,
            });
            throw error;
        }
        reportFetchAbortDebug("B", "app.js:hydrateWorkspaceFromUrl", "workspace hydration response received", {
            nextUrl,
            token,
            status: response.status,
            aborted: controller.signal.aborted,
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
        } else if (state.currentView === "backtest" || state.currentView === "dca") {
            hydrateWorkspaceModeMain(workspacePanel, nextWorkspacePanel);
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
        const sanitizedUrl = sanitizeRememberedUrl(url);
        memory[state.currentView] = sanitizedUrl;
        if (WORKSPACE_VIEWS.has(state.currentView)) {
            memory.workspace = sanitizedUrl;
        }
        writeViewMemory(memory);
    };

    const attachDockMemory = () => {
        const dockGroupByIndex = ["workspace", "more", "settings"];
        $$(".sidebar-dock-item").forEach((link, index) => {
            const targetDockGroup = dockGroupByIndex[index];
            if (!targetDockGroup || link.dataset.boundDockMemory === "1") return;
            link.dataset.boundDockMemory = "1";
            link.addEventListener("click", (event) => {
                rememberCurrentViewUrl();
                const memory = readViewMemory();
                const rememberedUrl = targetDockGroup === "workspace"
                    ? (memory.workspace || memory.backtest || memory.portfolio || memory.tickers)
                    : memory[targetDockGroup];
                const fallbackUrl = link.getAttribute("href") || "";
                event.preventDefault();
                const rememberedView = rememberedUrl ? resolveViewFromUrl(rememberedUrl) : null;
                const rememberedDockGroup = rememberedView ? resolveDockGroupFromView(rememberedView) : null;
                const nextUrl = rememberedDockGroup === targetDockGroup ? rememberedUrl : fallbackUrl;
                if (!nextUrl) return;
                const currentDockGroup = resolveDockGroupFromView(state.currentView);
                if (targetDockGroup === currentDockGroup && nextUrl === (window.location.pathname + window.location.search)) {
                    return;
                }
                beginOptimisticPageNavigation(nextUrl, {link, targetDockGroup});
            });
        });
    };

    const shouldHandleOptimisticLinkClick = (event, link) => {
        if (event.defaultPrevented || event.button !== 0) return false;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
        if (!(link instanceof HTMLAnchorElement)) return false;
        if (link.closest(".sidebar-dock")) return false;
        if (link.hasAttribute("download")) return false;
        const target = (link.getAttribute("target") || "").toLowerCase();
        if (target && target !== "_self") return false;
        const href = link.getAttribute("href");
        if (!href || href.startsWith("#")) return false;
        let url;
        try {
            url = new URL(href, window.location.href);
        } catch (_error) {
            return false;
        }
        if (url.origin !== window.location.origin) return false;
        if (!resolveViewFromUrl(url.href)) return false;
        const currentUrl = new URL(window.location.href);
        if (url.pathname === currentUrl.pathname && url.search === currentUrl.search && url.hash) return false;
        if (url.pathname === currentUrl.pathname && url.search === currentUrl.search) return false;
        return true;
    };

    const attachOptimisticInternalNavigation = () => {
        if (document.body.dataset.optimisticNavigationBound === "1") return;
        document.body.dataset.optimisticNavigationBound = "1";
        document.addEventListener("click", (event) => {
            const link = event.target?.closest?.("a[href]");
            if (!shouldHandleOptimisticLinkClick(event, link)) return;
            const nextUrl = link.getAttribute("href") || "";
            const normalizedNextUrl = normalizeNavigationUrl(nextUrl);
            if (!normalizedNextUrl) return;
            rememberCurrentViewUrl();
            event.preventDefault();
            beginOptimisticPageNavigation(normalizedNextUrl, {link});
        });
    };

    const isTickerValidationPending = () => getTickerInputs().some((input) => input.dataset.validationPending === "1");

    const setTickerValidationPending = (input, isPending) => {
        if (!input) return;
        input.dataset.validationPending = isPending ? "1" : "";
        input.classList.toggle("is-pending", isPending);
    };
    const syncTickerIdentityState = (input, nextTicker = sanitizeTicker(input?.value?.trim?.() || "")) => {
        if (!input) return "";
        const currentTicker = sanitizeTicker(nextTicker);
        const selectedTicker = sanitizeTicker(input.dataset.symbol || "");
        const validatedTicker = sanitizeTicker(input.dataset.validatedTicker || "");
        const pendingTicker = sanitizeTicker(input.dataset.validationTicker || "");
        if (!currentTicker || (selectedTicker && selectedTicker !== currentTicker)) {
            input.dataset.logoUrl = "";
            input.dataset.symbol = "";
            input.dataset.companyName = "";
        }
        if (!currentTicker || (validatedTicker && validatedTicker !== currentTicker)) {
            input.dataset.validatedTicker = "";
            input.dataset.validatedKnown = "";
        }
        if (!currentTicker || (pendingTicker && pendingTicker !== currentTicker)) {
            input.dataset.validationTicker = "";
        }
        if (!currentTicker) {
            input.dataset.unknown = "";
            setTickerValidationPending(input, false);
        }
        return currentTicker;
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
        const value = syncTickerIdentityState(input, sanitizeTicker(input.value.trim()));
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
    const buildMarketStoreLogoUrl = (ticker) => {
        const normalizedTicker = sanitizeTicker(ticker);
        return normalizedTicker ? `/market-store/logos/${encodeURIComponent(normalizedTicker)}.png` : "";
    };
    const normalizeLogoUrlList = (logoUrl) => {
        const values = Array.isArray(logoUrl) ? logoUrl : [logoUrl];
        return Array.from(new Set(values
            .map((value) => String(value || "").trim())
            .filter(Boolean)));
    };

    const setTickerLogoVisibility = (logo, placeholder, isLoaded) => {
        if (logo instanceof HTMLImageElement) {
            logo.hidden = !isLoaded;
            logo.dataset.loaded = isLoaded ? "1" : "0";
        }
        if (placeholder) placeholder.hidden = isLoaded;
    };

    const syncTickerLogoAsset = (logo, placeholder, logoUrl, altText = "") => {
        const normalizedUrls = normalizeLogoUrlList(logoUrl);
        if (!(logo instanceof HTMLImageElement)) {
            if (placeholder) placeholder.hidden = normalizedUrls.length > 0;
            return;
        }
        logo.onload = null;
        logo.onerror = null;
        if (!normalizedUrls.length) {
            delete logo.dataset.requestedSrc;
            logo.removeAttribute("src");
            logo.alt = "";
            setTickerLogoVisibility(logo, placeholder, false);
            return;
        }
        logo.alt = altText;
        logo.loading = "eager";
        const tryLoadAtIndex = (index) => {
            const nextUrl = normalizedUrls[index];
            if (!nextUrl) {
                delete logo.dataset.requestedSrc;
                logo.removeAttribute("src");
                setTickerLogoVisibility(logo, placeholder, false);
                return;
            }
            logo.dataset.requestedSrc = nextUrl;
            setTickerLogoVisibility(logo, placeholder, false);
            const finalize = (isLoaded) => {
                if (logo.dataset.requestedSrc !== nextUrl) return;
                if (!isLoaded) {
                    tryLoadAtIndex(index + 1);
                    return;
                }
                setTickerLogoVisibility(logo, placeholder, true);
            };
            logo.onload = () => finalize(true);
            logo.onerror = () => finalize(false);
            if (logo.getAttribute("src") !== nextUrl) {
                logo.src = nextUrl;
            }
            if (logo.complete) {
                finalize(Boolean(logo.naturalWidth && logo.naturalHeight));
            }
        };
        tryLoadAtIndex(0);
    };

    const syncTickerInputDecoration = (input, suggestion = null) => {
        const control = input?.closest(".ticker-input-control");
        if (!control || !input) return;
        const logo = control.querySelector(".ticker-input-logo");
        const placeholder = control.querySelector(".ticker-logo-placeholder");
        const value = input.value.trim();
        const hasTickerLikeValue = Boolean(value);
        const selectedTicker = sanitizeTicker(input.dataset.symbol || "");
        const validatedTicker = sanitizeTicker(input.dataset.validatedTicker || "");
        const suggestedTicker = sanitizeTicker(suggestion?.symbol || "");
        const tickerValue = suggestedTicker || sanitizeTicker(value) || selectedTicker;
        const profileLogoUrl = state.chart?.profiles?.find((item) => item.ticker === tickerValue)?.logo_url || "";
        const storedLogoUrl = selectedTicker && selectedTicker === tickerValue ? (input.dataset.logoUrl || "") : "";
        const existingLogoUrl = logo instanceof HTMLImageElement
            ? (sanitizeTicker((logo.alt || "").replace(/\s+logo$/i, "")) === tickerValue
                ? (logo.dataset.requestedSrc || logo.getAttribute("src") || "")
                : "")
            : "";
        const hasConfirmedTicker = Boolean(
            (suggestedTicker && suggestedTicker === tickerValue)
            || (selectedTicker && selectedTicker === tickerValue)
            || (validatedTicker && validatedTicker === tickerValue)
            || existingLogoUrl
            || profileLogoUrl
        );
        const fallbackLogoUrl = hasConfirmedTicker ? buildMarketStoreLogoUrl(tickerValue) : "";
        const logoUrls = normalizeLogoUrlList([
            suggestion?.logo_url,
            storedLogoUrl,
            profileLogoUrl,
            existingLogoUrl,
            fallbackLogoUrl,
        ]);
        control.classList.toggle("has-value", hasTickerLikeValue);
        control.classList.toggle("has-logo", logoUrls.length > 0);
        syncTickerLogoAsset(logo, placeholder, logoUrls, logoUrls.length ? `${tickerValue} logo` : "");
        if (suggestion) {
            input.dataset.logoUrl = suggestion.logo_url || profileLogoUrl || fallbackLogoUrl || "";
            input.dataset.symbol = suggestion.symbol || tickerValue;
            input.dataset.companyName = suggestion.name || suggestion.symbol || "";
        } else if (hasTickerLikeValue && selectedTicker && selectedTicker === tickerValue && !input.dataset.logoUrl && logoUrls.length) {
            input.dataset.logoUrl = logoUrls[0];
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
                label.textContent = (isBacktestView || isDcaView) ? labels.backtest_ticker : `Ticker ${index}`;
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
            const shareInput = field.querySelector(".portfolio-share-input");
            if (weightInput && weightSlider) {
                weightInput.id = `weight_${index}`;
                weightInput.name = "weight";
                weightSlider.dataset.index = String(index);
            }
            if (shareInput) {
                shareInput.id = `shares_${index}`;
                shareInput.name = "shares";
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
        getWeightFields().forEach(({field, tickerInput, number, slider, shares}) => {
            const isFilled = Boolean(sanitizeTicker(tickerInput.value.trim()));
            number.disabled = !isFilled;
            slider.disabled = !isFilled;
            if (shares) shares.disabled = !isFilled;
            field.querySelectorAll(".portfolio-share-stepper-button").forEach((button) => {
                button.disabled = !isFilled;
            });
            if (!isFilled) {
                number.value = "0";
                slider.value = "0";
                if (shares) shares.value = "0";
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

    const syncPortfolioShareInput = (entry, value) => {
        if (!entry?.shares) return;
        const normalized = Math.max(0, Number.parseInt(String(value || 0), 10) || 0);
        entry.shares.value = String(normalized);
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
        const shareMode = isPortfolioShareMode();
        getWeightFields().forEach((entry) => {
            const {tickerInput, number, shares} = entry;
            const ticker = sanitizeTicker(tickerInput.value.trim());
            if (shareMode) {
                const shareCount = Number.parseInt(shares?.value || "0", 10) || 0;
                if (ticker && shareCount <= 0) {
                    shares?.classList.add("is-invalid");
                    if (!entry.tooltip?.textContent) {
                        showPortfolioWeightTooltip(entry, "Each selected ticker must have at least 1 share.");
                    }
                    isValid = false;
                    return;
                }
                shares?.classList.remove("is-invalid");
                number.classList.remove("is-invalid");
                return;
            }
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
            shares?.classList.remove("is-invalid");
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
        getWeightFields().forEach(({field, number, slider, shares, tickerInput, index}) => {
            if (number.dataset.bound === "1") return;
            number.dataset.bound = "1";
            if (shares) shares.dataset.bound = "1";
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
            const syncSharesAndRefresh = (source) => {
                const value = Math.max(0, Number.parseInt(String(source.value || 0), 10) || 0);
                if (shares) shares.value = String(value);
                dispatchPortfolioPreviewUpdate();
                validatePortfolioWeightInputs();
                requestWorkspaceChartTransition("portfolio-shares");
                if (isPortfolioShareMode()) scheduleAutoSubmit(180);
            };
            const openSlider = () => {
                if (isPortfolioShareMode()) return;
                field.querySelector(".portfolio-weight-field")?.classList.add("is-open");
            };
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
            shares?.addEventListener("input", () => syncSharesAndRefresh(shares));
            field.querySelectorAll(".portfolio-share-stepper-button").forEach((button) => {
                if (button.dataset.bound === "1") return;
                button.dataset.bound = "1";
                button.addEventListener("click", () => {
                    if (!shares || shares.disabled) return;
                    const step = Number.parseInt(button.dataset.shareStep || "0", 10) || 0;
                    syncPortfolioShareInput({shares}, (Number.parseInt(shares.value || "0", 10) || 0) + step);
                    syncSharesAndRefresh(shares);
                });
            });
            tickerInput?.addEventListener("input", () => {
                handlePortfolioTickerValueChange(tickerInput);
            });
        });
    };

    const validateTickerInput = (input) => {
        const rawValue = input.value.trim();
        const value = syncTickerIdentityState(input, sanitizeTicker(rawValue));
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
        let autocompleteRequestSequence = 0;
        let autocompleteTimer = 0;
        let activeIndex = -1;

        const getPanel = () => document.getElementById(`${input.id}_suggestions`);
        const getButtons = () => Array.from(getPanel()?.querySelectorAll(".suggestion-item") || []);
        const querySuggestions = async (rawValue, {limit = 5, preserveUnknown = false} = {}) => {
            const queryValue = sanitizeTicker(String(rawValue || "").trim());
            if (!queryValue) {
                if (!preserveUnknown) setUnknown(false);
                await showRecentItems();
                return;
            }
            try {
                const response = await fetch(`${endpoints.symbolSearch}?q=${encodeURIComponent(queryValue)}&limit=${limit}`);
                if (!response.ok) return closePanel();
                const payload = await response.json();
                if (!Array.isArray(payload) || !payload.length) {
                    if (!preserveUnknown) setUnknown(true);
                    closePanel();
                    return;
                }
                if (!preserveUnknown) {
                    const exactMatch = Boolean(applyExactTickerMatch(input, payload, queryValue));
                    tickerValidationCache.set(queryValue, exactMatch);
                    input.dataset.unknown = exactMatch ? "" : input.dataset.unknown;
                    validateTickerInput(input);
                }
                renderItems(payload);
            } catch (_error) {
                closePanel();
            }
        };
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
            else if (!(isBacktestView || isDcaView)) clearWorkspaceChartTransitionRequest();
            hideTickerValidationTooltip(input);
            syncTickerIdentityState(input, sanitizeTicker(input.value.trim()));
            syncTickerInputDecoration(input);
            const rawQuery = input.value.trim();
            const query = validateTickerInput(input);
            if (!rawQuery) {
                autocompleteRequestSequence += 1;
                if (autocompleteTimer) {
                    window.clearTimeout(autocompleteTimer);
                    autocompleteTimer = 0;
                }
                setUnknown(false);
                await showRecentItems();
                return;
            }
            if (autocompleteTimer) {
                window.clearTimeout(autocompleteTimer);
                autocompleteTimer = 0;
            }
            const requestId = ++autocompleteRequestSequence;
            autocompleteTimer = window.setTimeout(async () => {
                autocompleteTimer = 0;
                try {
                    reportFetchAbortDebug("A", "app.js:setupAutocomplete", "starting symbol search request", {
                        rawQuery,
                        query,
                        inputId: input.id || "",
                        requestId,
                    });
                    const response = await fetch(`${endpoints.symbolSearch}?q=${encodeURIComponent(rawQuery)}`);
                    reportFetchAbortDebug("A", "app.js:setupAutocomplete", "symbol search response received", {
                        rawQuery,
                        query,
                        inputId: input.id || "",
                        status: response.status,
                        requestId,
                    });
                    if (requestId !== autocompleteRequestSequence || sanitizeTicker(input.value.trim()) !== query) return;
                    if (!response.ok) return closePanel();
                    const payload = await response.json();
                    if (requestId !== autocompleteRequestSequence || sanitizeTicker(input.value.trim()) !== query) return;
                    if (!payload.length) {
                        setUnknown(true);
                        closePanel();
                        return;
                    }
                    const exactMatch = Boolean(applyExactTickerMatch(input, payload, query));
                    if (query) tickerValidationCache.set(query, exactMatch);
                    input.dataset.unknown = exactMatch ? "" : input.dataset.unknown;
                    validateTickerInput(input);
                    if (exactMatch) {
                        handlePortfolioTickerValueChange(input);
                        syncDateConstraints();
                        if (isBacktestView) syncBacktestIntervals();
                        if (isPortfolioView) requestWorkspaceChartTransition("ticker-change");
                        scheduleAutoSubmit(120);
                    }
                    renderItems(payload);
                } catch (error) {
                    reportFetchAbortDebug("A", "app.js:setupAutocomplete", "symbol search request failed", {
                        rawQuery,
                        query,
                        inputId: input.id || "",
                        requestId,
                        errorName: error?.name || "",
                        errorMessage: error?.message || "",
                    });
                    if (requestId === autocompleteRequestSequence) closePanel();
                }
            }, 120);
        });
        input.addEventListener("focus", async () => {
            hideTickerValidationTooltip(input);
            if (input.value.trim()) {
                input.select();
                await querySuggestions(input.value.trim(), {preserveUnknown: true});
                return;
            }
            setUnknown(false);
            await showRecentItems();
        });
        input.addEventListener("click", async () => {
            hideTickerValidationTooltip(input);
            if (getPanel()?.classList.contains("is-open")) return;
            if (input.value.trim()) {
                input.select();
                await querySuggestions(input.value.trim(), {preserveUnknown: true});
                return;
            }
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
            else if (!(isBacktestView || isDcaView)) clearWorkspaceChartTransitionRequest();
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
                syncTickerIdentityState(input, "");
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

    const getEffectiveThemeMode = (mode = document.documentElement.dataset.themeMode) => {
        if (mode === "light" || mode === "dark") return mode;
        return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    };

    const syncThemeModeForm = (mode) => {
        const formElement = document.querySelector("[data-theme-mode-form]");
        if (!(formElement instanceof HTMLFormElement)) return;
        const normalizedMode = mode === "light" || mode === "dark" || mode === "system" ? mode : "system";
        Array.from(formElement.querySelectorAll("[data-theme-mode-option]")).forEach((option) => {
            if (option instanceof HTMLInputElement) option.checked = option.value === normalizedMode;
        });
    };

    const syncGlobalThemeToggle = () => {
        const toggle = document.getElementById("global_theme_toggle");
        if (!(toggle instanceof HTMLButtonElement)) return;
        const effectiveMode = getEffectiveThemeMode();
        const nextMode = effectiveMode === "dark" ? "light" : "dark";
        const label = nextMode === "dark" ? translateUi("Switch to Dark mode") : translateUi("Switch to Light mode");
        toggle.dataset.effectiveTheme = effectiveMode;
        toggle.setAttribute("aria-label", label);
        toggle.setAttribute("title", label);
        toggle.setAttribute("aria-pressed", String(effectiveMode === "dark"));
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
        syncGlobalThemeToggle();
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
                syncGlobalThemeToggle();
            });
        });
    };

    bootstrap.initThemeModeControls = initThemeModeControls;

    const initGlobalAppearanceControls = () => {
        const themeToggle = document.getElementById("global_theme_toggle");
        if (themeToggle instanceof HTMLButtonElement && themeToggle.dataset.boundThemeToggle !== "1") {
            themeToggle.dataset.boundThemeToggle = "1";
            themeToggle.addEventListener("click", () => {
                const nextMode = getEffectiveThemeMode() === "dark" ? "light" : "dark";
                writeThemeModePreference(nextMode);
                applyThemeModePreference(nextMode);
                syncThemeModeForm(nextMode);
                syncGlobalThemeToggle();
            });
        }
        syncGlobalThemeToggle();
        window.addEventListener("antigravity:theme-mode-change", () => {
            syncThemeModeForm(document.documentElement.dataset.themeMode);
            syncGlobalThemeToggle();
        });
    };

    const initGlobalLanguageControls = () => {
        const toggle = document.getElementById("global_language_toggle");
        if (!(toggle instanceof HTMLButtonElement)) return;
        const languageState = getLanguageState();
        const languageLabel = languageState.labels?.[languageState.code] || translateUi("Language");
        toggle.setAttribute("aria-label", `${translateUi("Language")}: ${languageLabel}`);
        toggle.setAttribute("title", `${translateUi("Language")}: ${languageLabel}`);
        if (toggle.dataset.boundLanguageToggle === "1") return;
        toggle.dataset.boundLanguageToggle = "1";
        toggle.addEventListener("click", async () => {
            toggle.disabled = true;
            try {
                const response = await fetch("/api/settings/language/cycle", {
                    method: "POST",
                    headers: {"Content-Type": "application/json"},
                    body: JSON.stringify({current: getLanguageState().code || "en"}),
                });
                const payload = await response.json().catch(() => null);
                if (payload?.success) {
                    if (window.ANTIGRAVITY_APP?.language) {
                        window.ANTIGRAVITY_APP.language.code = payload.language;
                        window.ANTIGRAVITY_APP.language.htmlLang = payload.htmlLang;
                    }
                    if (payload.dateDisplay && window.ANTIGRAVITY_APP?.dateDisplay) {
                        window.ANTIGRAVITY_APP.dateDisplay = payload.dateDisplay;
                    }
                    window.location.reload();
                    return;
                }
            } catch (_error) {
            }
            toggle.disabled = false;
        });
    };

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
                else if (!(isBacktestView || isDcaView)) clearWorkspaceChartTransitionRequest();
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
						<div class="portfolio-share-stepper" role="group" aria-label="Shares">
							<button type="button" class="portfolio-share-stepper-button" data-share-step="-1" aria-label="Decrease shares">-</button>
							<input id="shares_${index}" name="shares" class="portfolio-share-input" type="number" min="0" step="1" value="0" placeholder="0" aria-label="Shares">
							<button type="button" class="portfolio-share-stepper-button" data-share-step="1" aria-label="Increase shares">+</button>
						</div>
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
                    shares: Number.parseInt(item.shares?.value || "0", 10) || 0,
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
                syncPortfolioShareInput(entry, portfolioEntries[index]?.shares || 0);
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
    const getSharedSelectFields = () => Array.from(document.querySelectorAll("[data-shared-select-field]"))
        .filter((field) => field instanceof HTMLElement);

    const getSharedSelectParts = (field) => {
        if (!(field instanceof HTMLElement)) return null;
        const select = field.querySelector("select");
        const trigger = field.querySelector("[data-shared-select-trigger]");
        const triggerLabel = field.querySelector("[data-shared-select-trigger-label]");
        const dropdown = field.querySelector("[data-shared-select-dropdown]");
        if (!(select instanceof HTMLSelectElement) || !(trigger instanceof HTMLButtonElement) || !(triggerLabel instanceof HTMLElement) || !(dropdown instanceof HTMLElement)) {
            return null;
        }
        const triggerLogo = trigger.querySelector("[data-shared-select-trigger-logo]");
        const triggerPlaceholder = trigger.querySelector("[data-shared-select-trigger-placeholder]");
        return {
            field,
            select,
            trigger,
            triggerLabel,
            dropdown,
            triggerLogo: triggerLogo instanceof HTMLImageElement ? triggerLogo : null,
            triggerPlaceholder: triggerPlaceholder instanceof HTMLElement ? triggerPlaceholder : null,
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

    const syncSharedSelectTriggerMedia = (parts, selectedOption) => {
        if (!parts?.triggerLogo) return;
        const iconUrl = String(selectedOption?.dataset.iconUrl || "").trim();
        const iconAlt = String(selectedOption?.dataset.iconAlt || "").trim()
            || `${selectedOption?.textContent?.trim() || selectedOption?.value || "Selected"} logo`;
        if (!iconUrl) {
            parts.triggerLogo.hidden = true;
            parts.triggerLogo.alt = "";
            parts.triggerLogo.removeAttribute("src");
            if (parts.triggerPlaceholder) {
                parts.triggerPlaceholder.hidden = false;
            }
            return;
        }
        parts.triggerLogo.alt = iconAlt;
        parts.triggerLogo.hidden = false;
        if (parts.triggerLogo.getAttribute("src") !== iconUrl) {
            parts.triggerLogo.src = iconUrl;
        }
        if (parts.triggerPlaceholder) {
            parts.triggerPlaceholder.hidden = true;
        }
        parts.triggerLogo.onerror = () => {
            parts.triggerLogo.hidden = true;
            parts.triggerLogo.removeAttribute("src");
            if (parts.triggerPlaceholder) {
                parts.triggerPlaceholder.hidden = false;
            }
        };
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
        dropdown.style.position = "";
        dropdown.style.left = "";
        dropdown.style.top = "";
        dropdown.style.bottom = "";
        dropdown.style.right = "";
        dropdown.style.width = "";
        dropdown.style.minWidth = "";
        dropdown.style.maxWidth = "";
        dropdown.style.maxHeight = "";
        dropdown.style.zIndex = "";
        dropdown.style.overflowY = "";
        dropdown.style.maxWidth = "";
        dropdown.style.overscrollBehavior = "";
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
        const dropdown = parts.dropdown;
        const trigger = parts.trigger;
        const triggerRect = trigger.getBoundingClientRect();
        // If this shared select lives inside the constrained import form container,
        // open downward within the control row while the form temporarily allows overflow.
        const isInsideImportForm = !!trigger.closest('#transaction_form_container')
            || parts.field.classList.contains('investment-import-broker-field')
            || parts.field.dataset.sharedSelectKind === 'investment-import-broker';
        if (isInsideImportForm) {
            // Use fixed positioning to escape the height-constrained floating #transaction_form_container.
            // This ensures the full broker list (including Longbridge (SG) and Charles Schwab at the end)
            // is visible and scrollable/selectable even when the browser window or form panel is short.
            const container = trigger.closest('#transaction_form_container');
            let offsetLeft = 0;
            let offsetTop = 0;
            if (container) {
                const style = window.getComputedStyle(container);
                const hasTransform = style.transform !== 'none' || style.perspective !== 'none' || style.filter !== 'none';
                if (hasTransform) {
                    const containerRect = container.getBoundingClientRect();
                    offsetLeft = containerRect.left;
                    offsetTop = containerRect.top;
                }
            }

            const dropdownGap = 4;
            const viewportHeight = window.visualViewport?.height || window.innerHeight || 800;
            const spaceBelow = Math.max(140, viewportHeight - triggerRect.bottom - dropdownGap - 12);
            // Cap at a comfortable height but allow the list to be fully usable.
            const maxH = Math.min(380, spaceBelow);

            dropdown.style.position = 'fixed';
            dropdown.style.left = `${Math.round(triggerRect.left - offsetLeft)}px`;
            dropdown.style.top = `${Math.round(triggerRect.bottom - offsetTop + dropdownGap)}px`;
            dropdown.style.bottom = 'auto';
            dropdown.style.right = 'auto';
            dropdown.style.width = `${Math.round(triggerRect.width)}px`;
            dropdown.style.minWidth = `${Math.round(triggerRect.width)}px`;
            dropdown.style.maxWidth = 'min(420px, 92vw)';
            dropdown.style.maxHeight = `${Math.round(maxH)}px`;
            dropdown.style.zIndex = '10002';

            dropdown.style.overflowY = 'auto';
            dropdown.style.overscrollBehavior = 'contain';
            return;
        }
        const container = dropdown.parentElement;
        positionSidebarDropdownFromTrigger(trigger, dropdown, container instanceof HTMLElement ? container : field);
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
        getSharedSelectFields().forEach((field) => {
            if (exceptField && field === exceptField) return;
            setSharedSelectDropdownOpen(field, false);
        });
    };

    const syncSharedSelectTriggerLabel = (field) => {
        const parts = getSharedSelectParts(field);
        if (!parts) return;
        const selectedOption = Array.from(parts.select.options).find((option) => option.value === parts.select.value);
        const nextLabel = selectedOption?.textContent?.trim()
            || parts.triggerLabel.dataset.fallbackLabel
            || parts.trigger.getAttribute("title")
            || parts.trigger.textContent?.trim()
            || parts.select.options[0]?.textContent?.trim()
            || "";
        parts.triggerLabel.textContent = nextLabel;
        parts.triggerLabel.dataset.fallbackLabel = nextLabel;
        parts.trigger.title = nextLabel;
        const fieldLabel = field.closest(".field")?.querySelector("label")?.textContent?.trim() || "";
        if (fieldLabel) {
            parts.trigger.setAttribute("aria-label", `${fieldLabel}: ${nextLabel}`);
        }
        parts.trigger.dataset.empty = nextLabel ? "0" : "1";
        parts.field.classList.add("backtest-shared-select-field");
        syncSharedSelectTriggerMedia(parts, selectedOption);
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

            const iconUrl = String(option.dataset.iconUrl || "").trim();
            if (iconUrl) {
                optionButton.classList.add("is-with-icon");
            }

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
            if (iconUrl) {
                const mediaSlot = document.createElement("span");
                mediaSlot.className = "trade-strategy-dropdown-media-slot";
                mediaSlot.setAttribute("aria-hidden", "true");

                const mediaPlaceholder = document.createElement("span");
                mediaPlaceholder.className = "trade-strategy-dropdown-media-placeholder";

                const mediaElement = document.createElement("img");
                mediaElement.className = "trade-strategy-dropdown-media";
                mediaElement.alt = String(option.dataset.iconAlt || "").trim()
                    || `${option.textContent?.trim() || option.value} logo`;
                mediaElement.loading = "eager";
                mediaElement.decoding = "async";
                mediaElement.hidden = true;
                mediaElement.addEventListener("load", () => {
                    mediaElement.hidden = false;
                    mediaPlaceholder.hidden = true;
                });
                mediaElement.addEventListener("error", () => {
                    mediaElement.hidden = true;
                    mediaElement.removeAttribute("src");
                    mediaPlaceholder.hidden = false;
                });
                mediaElement.src = iconUrl;
                if (mediaElement.complete && mediaElement.naturalWidth > 0 && mediaElement.naturalHeight > 0) {
                    mediaElement.hidden = false;
                    mediaPlaceholder.hidden = true;
                }

                mediaSlot.appendChild(mediaPlaceholder);
                mediaSlot.appendChild(mediaElement);
                optionButton.appendChild(mediaSlot);
            }
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

                // Extra safety for the investment import broker dropdown (uses fixed positioning in constrained form).
                // Ensures the field groups (e.g. Schwab CSV using the reusable div) switch immediately.
                if (field.classList.contains('investment-import-broker-field') &&
                    typeof window.__forceSyncInvestmentImportMode === 'function') {
                    window.__forceSyncInvestmentImportMode();
                }
            });
            parts.dropdown.appendChild(optionButton);
        });
    };

    const BROKER_PINYIN_SORT_KEYS = {
        hsbc: "hsbc",
        ibkr: "ibkr",
        longbridge: "longbridge",
    };
    const brokerPinyinCollator = new Intl.Collator("zh-CN", {sensitivity: "base", numeric: true});

    const isBrokerSharedSelectKind = (field) => {
        if (!(field instanceof HTMLElement)) return false;
        const kind = String(field.dataset.sharedSelectKind || "").trim().toLowerCase();
        return kind === "settings-broker"
            || kind === "live-trading-broker"
            || kind === "investment-import-broker";
    };

    const getBrokerOptionSortKey = (option) => {
        if (!(option instanceof HTMLOptionElement)) return "";
        const explicitKey = String(option.dataset.pinyinSortKey || "").trim().toLowerCase();
        if (explicitKey) return explicitKey;
        const catalogKey = BROKER_PINYIN_SORT_KEYS[String(option.value || "").trim().toLowerCase()];
        if (catalogKey) return catalogKey;
        return String(option.textContent || option.value || "").trim().toLowerCase();
    };

    const compareBrokerOptionSortKeys = (leftKey, rightKey) => brokerPinyinCollator.compare(leftKey, rightKey);

    const sortBrokerSelectOptions = (select) => {
        if (!(select instanceof HTMLSelectElement)) return;
        const selectedValue = String(select.value || "");
        const options = Array.from(select.options);
        options.sort((left, right) => {
            const bySortKey = compareBrokerOptionSortKeys(
                getBrokerOptionSortKey(left),
                getBrokerOptionSortKey(right),
            );
            if (bySortKey !== 0) return bySortKey;
            return compareBrokerOptionSortKeys(
                String(left.value || "").trim().toLowerCase(),
                String(right.value || "").trim().toLowerCase(),
            );
        });
        const fragment = document.createDocumentFragment();
        options.forEach((option) => fragment.appendChild(option));
        select.replaceChildren(fragment);
        if (selectedValue && Array.from(select.options).some((option) => option.value === selectedValue)) {
            select.value = selectedValue;
        }
    };

    const refreshSharedSelectField = (field) => {
        syncSharedSelectTriggerLabel(field);
    };

    const initializeSharedSelectField = (field) => {
        const parts = getSharedSelectParts(field);
        if (parts && isBrokerSharedSelectKind(parts.field)) {
            sortBrokerSelectOptions(parts.select);
        }
        refreshSharedSelectField(field);
        if (!parts || parts.field.dataset.sharedSelectJsBound === "1") return;
        parts.field.dataset.sharedSelectJsBound = "1";
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
    const getDcaFrequencyShell = () => document.querySelector("[data-dca-frequency-shell]");
    const getDcaFrequencyInputs = () => Array.from(document.querySelectorAll("[data-dca-frequency-input]"))
        .filter((input) => input instanceof HTMLInputElement);
    const getSelectedDcaFrequency = () => {
        const selectedInput = getDcaFrequencyInputs().find((input) => input.checked && !input.disabled);
        return selectedInput?.value === "weekly" ? "weekly" : "monthly";
    };
    const getVisibleSegmentedOptions = (shell) => Array.from(shell.querySelectorAll(".segmented-control-option, .range-mode-option"))
        .filter((option) => option instanceof HTMLElement)
        .filter((option) => {
            const input = option.querySelector("input");
            return !option.hidden && (!(input instanceof HTMLInputElement) || !input.disabled);
        });
    const syncSegmentedControlLayout = (shell, {
        activeValue = "",
        activeIndex = -1,
        options = null,
    } = {}) => {
        if (!(shell instanceof HTMLElement)) return;
        const resolvedOptions = Array.isArray(options) ? options : getVisibleSegmentedOptions(shell);
        const optionCount = Math.max(resolvedOptions.length, 1);
        let resolvedActiveIndex = activeIndex;
        if (resolvedActiveIndex < 0) {
            resolvedActiveIndex = resolvedOptions.findIndex((option) => {
                const input = option.querySelector("input");
                return input instanceof HTMLInputElement && input.checked;
            });
        }
        resolvedActiveIndex = Math.max(0, Math.min(optionCount - 1, resolvedActiveIndex));
        if (activeValue) shell.dataset.active = activeValue;
        shell.dataset.optionCount = String(optionCount);
        shell.style.setProperty("--segmented-option-count", String(optionCount));
        shell.style.setProperty("--segmented-active-index", String(resolvedActiveIndex));
        const shouldOverflow = optionCount > 3 || shell.scrollWidth > shell.clientWidth + 1;
        shell.dataset.segmentedOverflow = shouldOverflow ? "1" : "0";
        if (shouldOverflow || shell.dataset.segmentedPill === "measured") {
            const activeOption = resolvedOptions[resolvedActiveIndex];
            if (activeOption instanceof HTMLElement) {
                const shellStyles = window.getComputedStyle(shell);
                const paddingLeft = Number.parseFloat(shellStyles.paddingLeft) || 0;
                shell.style.setProperty("--segmented-pill-left", `${Math.max(0, activeOption.offsetLeft - paddingLeft)}px`);
                shell.style.setProperty("--segmented-pill-width", `${Math.max(1, activeOption.offsetWidth)}px`);
                shell.classList.add("is-pill-ready");
            }
        } else if (shell.dataset.segmentedPill !== "measured") {
            shell.classList.remove("is-pill-ready");
            shell.style.removeProperty("--segmented-pill-left");
            shell.style.removeProperty("--segmented-pill-width");
        }
    };
    const syncAllSegmentedControlLayouts = () => {
        $$(".segmented-control, .range-mode-shell").forEach((shell) => {
            if (!(shell instanceof HTMLElement)) return;
            syncSegmentedControlLayout(shell, {activeValue: shell.dataset.active || ""});
        });
    };
    const syncRangeModeSegmentedControl = () => {
        const shell = $(".range-mode-shell");
        if (!(shell instanceof HTMLElement)) return;
        const options = getVisibleSegmentedOptions(shell);
        const activeInput = rangeModeInputs.find((input) => input.checked && !input.disabled);
        const activeValue = activeInput?.value || defaults.range_mode || "period";
        const activeIndex = Math.max(0, options.findIndex((option) => {
            const input = option.querySelector("input");
            return input instanceof HTMLInputElement && input.checked;
        }));
        syncSegmentedControlLayout(shell, {activeValue, activeIndex, options});
    };

    const syncPortfolioAllocationSegmentedControl = () => {
        if (!isPortfolioView) return;
        const shell = $(".portfolio-allocation-shell");
        if (!(shell instanceof HTMLElement)) return;
        const inputs = getPortfolioAllocationInputs();
        const activeValue = getPortfolioAllocationMode();
        const activeIndex = Math.max(0, inputs.findIndex((input) => input.checked));
        syncSegmentedControlLayout(shell, {activeValue, activeIndex});
        form?.dataset && (form.dataset.portfolioAllocation = activeValue);
        if (activeValue === "shares") {
            hidePortfolioWeightTooltips();
            document.querySelectorAll(".portfolio-weight-field.is-open").forEach((field) => {
                field.classList.remove("is-open");
            });
        }
        validatePortfolioWeightInputs();
        dispatchPortfolioPreviewUpdate();
    };

    const attachPortfolioAllocationHandlers = () => {
        if (!isPortfolioView) return;
        getPortfolioAllocationInputs().forEach((input) => {
            if (input.dataset.bound === "1") return;
            input.dataset.bound = "1";
            input.addEventListener("change", () => {
                syncPortfolioAllocationSegmentedControl();
                requestWorkspaceChartTransition("portfolio-allocation");
            });
        });
        syncPortfolioAllocationSegmentedControl();
    };
    const syncDcaFrequencySegmentedControl = () => {
        const shell = getDcaFrequencyShell();
        if (!(shell instanceof HTMLElement)) return;
        const options = getVisibleSegmentedOptions(shell);
        const activeIndex = Math.max(0, options.findIndex((option) => {
            const input = option.querySelector("input");
            return input instanceof HTMLInputElement && input.checked;
        }));
        syncSegmentedControlLayout(shell, {activeValue: getSelectedDcaFrequency(), activeIndex, options});
    };
    const updateDcaSchedulePanels = () => {
        const frequency = getSelectedDcaFrequency();
        const weeklyPanel = document.getElementById("dca_weekly_panel");
        const monthlyPanel = document.getElementById("dca_monthly_panel");
        if (weeklyPanel) {
            const isWeekly = frequency === "weekly";
            weeklyPanel.hidden = !isWeekly;
            weeklyPanel.setAttribute("aria-hidden", String(!isWeekly));
            weeklyPanel.style.display = isWeekly ? "" : "none";
            if (!isWeekly) {
                closeSharedSelectDropdowns(weeklyPanel.querySelector("[data-shared-select-field]"));
                setSharedSelectDropdownOpen(weeklyPanel.querySelector("[data-shared-select-field]"), false);
            }
        }
        if (monthlyPanel) {
            const isMonthly = frequency === "monthly";
            monthlyPanel.hidden = !isMonthly;
            monthlyPanel.setAttribute("aria-hidden", String(!isMonthly));
            monthlyPanel.style.display = isMonthly ? "" : "none";
            if (!isMonthly) {
                closeSharedSelectDropdowns(monthlyPanel.querySelector("[data-shared-select-field]"));
                setSharedSelectDropdownOpen(monthlyPanel.querySelector("[data-shared-select-field]"), false);
            }
        }
    };
    const getSelectedBacktestInterval = () => {
        const selectedInput = getBacktestIntervalInputs().find((input) => input.checked && !input.disabled);
        return selectedInput?.value || "1d";
    };
    const syncBacktestIntervalSegmentedControl = () => {
        const shell = getBacktestIntervalShell();
        if (!(shell instanceof HTMLElement)) return;
        const options = getVisibleSegmentedOptions(shell);
        const activeIndex = Math.max(0, options.findIndex((option) => {
            const input = option.querySelector("input");
            return input instanceof HTMLInputElement && input.checked;
        }));
        syncSegmentedControlLayout(shell, {activeValue: getSelectedBacktestInterval(), activeIndex, options});
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
        if (fullFormat === "yyyy_mm_dd_cjk") {
            return {tokens: [`${year}年${padTwo(monthIndex + 1)}月${paddedDay}日`], wrapAfterIndex: 0};
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
        if (isDcaView) {
            const dates = state.dcaResult?.chart?.dates;
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
    const formatEditableTradeCapitalValue = (value) => {
        const normalized = clampTradeCapital(value);
        if (Math.abs(normalized - Math.round(normalized)) < 0.000001) {
            return String(Math.round(normalized));
        }
        return normalized.toFixed(2).replace(/\.?0+$/, "");
    };
    const formatTradeCapitalTypingValue = (rawValue) => {
        const normalized = String(rawValue || "").replace(/,/g, "").replace(/[^\d.]/g, "");
        const hasDecimalPoint = normalized.includes(".");
        const wholeCandidate = (normalized.split(".")[0] || "").replace(/\D/g, "");
        const decimalCandidate = (normalized.split(".")[1] || "").replace(/\D/g, "").slice(0, 2);
        const numericSource = `${wholeCandidate || "0"}${hasDecimalPoint ? `.${decimalCandidate}` : ""}`;
        const numericValue = clampTradeCapital(Number.parseFloat(numericSource) || 0);
        const [wholePart] = formatTradeCapitalValue(numericValue).split(".");
        if (hasDecimalPoint) return `${wholePart}.${decimalCandidate}`;
        return wholePart;
    };
    const countTradeCapitalCharsBeforeCaret = (value, caretPosition) => (
        String(value || "").slice(0, Math.max(0, caretPosition || 0)).replace(/,/g, "").length
    );
    const resolveTradeCapitalCaretPosition = (value, significantChars) => {
        if (significantChars <= 0) return 0;
        let seenChars = 0;
        for (let index = 0; index < value.length; index += 1) {
            if (value[index] === ",") continue;
            seenChars += 1;
            if (seenChars >= significantChars) return index + 1;
        }
        return value.length;
    };

    const updateRangePanels = () => {
        const rangeMode = $("input[name='range']:checked")?.value || defaults.range_mode;
        syncRangeModeSegmentedControl();
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
        if (!hasInitialResult && !(isBacktestView || isDcaView)) return false;
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
            const allocationMode = getPortfolioAllocationMode();
            if (allocationMode === "shares") {
                params.set("allocation", "shares");
                getFilledWeightEntries().forEach((entry) => {
                    params.append("shares", String(Number.parseInt(entry.shares?.value || "0", 10) || 0));
                });
            } else {
                getFilledWeightEntries().forEach((entry) => {
                    params.append("weight", String(Number.parseInt(entry.number.value, 10) || 0));
                });
            }
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
        } else if (isDcaView) {
            const amountValue = parseTradeCapitalValue(tradeCapitalInput?.value);
            const frequencyValue = getSelectedDcaFrequency();
            const weekdayValue = document.getElementById("dca_weekday")?.value || "0";
            const monthDayValue = document.getElementById("dca_month_day")?.value || "15";
            if (Number.isFinite(amountValue)) params.set("amount", String(amountValue));
            params.set("frequency", frequencyValue);
            if (frequencyValue === "weekly") params.set("weekday", weekdayValue);
            if (frequencyValue === "monthly") params.set("month_day", monthDayValue);
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
    initGlobalAppearanceControls();
    initGlobalLanguageControls();
    rememberCurrentViewUrl();
    attachDockMemory();
    attachOptimisticInternalNavigation();
    attachRemoveHandlers();
    attachTickerClearHandlers();
    attachPortfolioAllocationHandlers();
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
    syncDcaFrequencySegmentedControl();
    syncAllSegmentedControlLayouts();
    updateDcaSchedulePanels();
    syncDateConstraints();
    scheduleDockPosition();
    window.addEventListener("resize", () => {
        window.requestAnimationFrame(syncAllSegmentedControlLayouts);
    });

    $("#add_ticker")?.addEventListener("click", () => {
        if (!(isBacktestView || isDcaView)) clearWorkspaceChartTransitionRequest();
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
        if (!(isBacktestView || isDcaView) && shouldAutoSubmit) requestWorkspaceChartTransition("range-mode");
        if (shouldAutoSubmit) {
            scheduleAutoSubmit();
        }
    }));
    [exactStartInput, exactEndInput].forEach((input) => {
        if (!input) return;
        input.addEventListener("change", () => {
            syncDateConstraints();
            if (!(isBacktestView || isDcaView)) requestWorkspaceChartTransition("range-controls");
            scheduleAutoSubmit();
        });
    });
    if (includeDividendsInput && form) {
        includeDividendsInput.addEventListener("change", () => {
            if (!(isBacktestView || isDcaView)) requestWorkspaceChartTransition("dividends");
            scheduleAutoSubmit(80);
        });
    }
    form?.addEventListener("change", (event) => {
        const target = event.target;
        if (target instanceof HTMLSelectElement && target.id === "period") {
            refreshSharedSelectField(periodPanel?.querySelector("[data-shared-select-field]"));
            if (!(isBacktestView || isDcaView)) requestWorkspaceChartTransition("period");
            scheduleAutoSubmit();
            return;
        }
        if (target instanceof HTMLSelectElement && (target.id === "dca_weekday" || target.id === "dca_month_day")) {
            scheduleAutoSubmit(20);
        }
    });
    getDcaFrequencyInputs().forEach((input) => input.addEventListener("change", (event) => {
        if (!(event.target instanceof HTMLInputElement) || !event.target.checked) return;
        syncDcaFrequencySegmentedControl();
        updateDcaSchedulePanels();
        scheduleAutoSubmit(20);
    }));
    getBacktestIntervalInputs().forEach((input) => input.addEventListener("change", (event) => {
        if (!(event.target instanceof HTMLInputElement) || !event.target.checked) return;
        const interval = event.target.value;
        syncBacktestIntervalSegmentedControl();
        const nextPeriods = state.backtestPeriodOptions?.[interval] || (interval === "1m" ? ["1d"] : ["1d"]);
        replacePeriodOptions(nextPeriods, interval === "1m" ? "1d" : "max");
        // Force full reload for interval change to refresh sidebar period options
        scheduleAutoSubmit(20);
    }));

    if ((isBacktestView || isDcaView) && tradeCapitalField && tradeCapitalInput && tradeCapitalSlider) {
        const scheduleTradeInputAutoSubmit = () => {
            scheduleAutoSubmit(720);
        };
        const scheduleTradeSliderAutoSubmit = () => {
            scheduleAutoSubmit(180);
        };
        const openTradeCapitalSlider = () => tradeCapitalField.classList.add("is-open");
        const closeTradeCapitalSlider = () => window.setTimeout(() => {
            if (tradeCapitalField.matches(":focus-within")) return;
            tradeCapitalField.classList.remove("is-open");
            tradeCapitalInput.value = formatTradeCapitalValue(parseTradeCapitalValue(tradeCapitalInput.value));
            scheduleTradeSliderAutoSubmit();
        }, 80);
        const syncTradeCapitalControls = (value, formattedValue = null) => {
            const normalized = clampTradeCapital(value);
            tradeCapitalField.dataset.lastValidAmount = String(normalized);
            tradeCapitalInput.value = formattedValue ?? formatTradeCapitalValue(normalized);
            tradeCapitalSlider.value = String(Math.round(normalized));
        };
        const sanitizeTradeCapitalDraft = (value) => String(value || "")
            .replace(/,/g, "")
            .replace(/[^\d.]/g, "");
        const normalizeTradeCapitalDraft = (draftValue) => {
            const sanitized = sanitizeTradeCapitalDraft(draftValue);
            if (!sanitized) return "";
            const [wholePartRaw, ...decimalParts] = sanitized.split(".");
            const wholePart = wholePartRaw.replace(/\D/g, "");
            const decimalPart = decimalParts.join("").replace(/\D/g, "").slice(0, 2);
            if (decimalParts.length) return `${wholePart}.${decimalPart}`;
            return wholePart;
        };
        const deriveTradeCapitalReplacementDraft = (rawValue) => {
            const currentDraft = normalizeTradeCapitalDraft(rawValue);
            const focusDraft = normalizeTradeCapitalDraft(tradeCapitalInput.dataset.focusDraft || "");
            if (!focusDraft || !currentDraft || currentDraft === focusDraft) return currentDraft;
            if (currentDraft.endsWith(focusDraft)) {
                return currentDraft.slice(0, -focusDraft.length) || currentDraft;
            }
            if (currentDraft.startsWith(focusDraft)) {
                return currentDraft.slice(focusDraft.length) || currentDraft;
            }
            return currentDraft;
        };
        const applyTradeCapitalDraft = (draftValue, significantChars) => {
            const nextDraft = normalizeTradeCapitalDraft(draftValue);
            if (!nextDraft) {
                tradeCapitalInput.value = "";
                return false;
            }
            const formattedValue = formatTradeCapitalTypingValue(nextDraft);
            const normalizedValue = parseTradeCapitalValue(formattedValue);
            syncTradeCapitalControls(normalizedValue, formattedValue);
            const nextCaret = resolveTradeCapitalCaretPosition(formattedValue, significantChars);
            tradeCapitalInput.setSelectionRange(nextCaret, nextCaret);
            return true;
        };
        const syncTradeCapitalControlsFromTyping = () => {
            const rawValue = tradeCapitalInput.value;
            if (!String(rawValue || "").replace(/,/g, "").trim()) {
                tradeCapitalInput.value = "";
                return false;
            }
            const significantChars = countTradeCapitalCharsBeforeCaret(rawValue, tradeCapitalInput.selectionStart);
            const formattedValue = formatTradeCapitalTypingValue(rawValue);
            const normalizedValue = parseTradeCapitalValue(formattedValue);
            syncTradeCapitalControls(normalizedValue, formattedValue);
            const nextCaret = resolveTradeCapitalCaretPosition(formattedValue, significantChars);
            tradeCapitalInput.setSelectionRange(nextCaret, nextCaret);
            return true;
        };
        const restoreTradeCapitalControls = () => {
            const fallbackValue = parseTradeCapitalValue(
                tradeCapitalField.dataset.lastValidAmount || tradeCapitalSlider.value || tradeCapitalInput.value
            );
            syncTradeCapitalControls(fallbackValue);
        };
        const selectTradeCapitalInputValue = () => {
            window.requestAnimationFrame(() => {
                const valueLength = tradeCapitalInput.value.length;
                tradeCapitalInput.setSelectionRange(0, valueLength);
            });
        };
        tradeCapitalInput.addEventListener("focus", () => {
            const normalized = parseTradeCapitalValue(tradeCapitalInput.value);
            tradeCapitalField.dataset.lastValidAmount = String(normalized);
            const focusDraft = formatEditableTradeCapitalValue(normalized);
            tradeCapitalInput.dataset.focusDraft = focusDraft;
            tradeCapitalInput.dataset.replaceOnNextTradeCapitalInput = "1";
            tradeCapitalInput.value = focusDraft;
            openTradeCapitalSlider();
            selectTradeCapitalInputValue();
        });
        tradeCapitalInput.addEventListener("click", () => {
            openTradeCapitalSlider();
            selectTradeCapitalInputValue();
        });
        tradeCapitalInput.addEventListener("mouseup", (event) => {
            if (tradeCapitalInput.dataset.replaceOnNextTradeCapitalInput !== "1") return;
            event.preventDefault();
            selectTradeCapitalInputValue();
        });
        tradeCapitalInput.addEventListener("beforeinput", (event) => {
            if (!(event instanceof InputEvent)) return;
            const supportedInputTypes = new Set([
                "insertText",
                "insertFromPaste",
                "deleteContentBackward",
                "deleteContentForward",
            ]);
            if (!supportedInputTypes.has(event.inputType)) return;
            event.preventDefault();
            const currentValue = tradeCapitalInput.value;
            const selectionStart = tradeCapitalInput.selectionStart ?? currentValue.length;
            const selectionEnd = tradeCapitalInput.selectionEnd ?? currentValue.length;
            const isReplacementInsert = tradeCapitalInput.dataset.replaceOnNextTradeCapitalInput === "1"
                && event.inputType.startsWith("insert");
            const currentDraft = isReplacementInsert ? "" : normalizeTradeCapitalDraft(currentValue);
            const startChars = countTradeCapitalCharsBeforeCaret(currentValue, selectionStart);
            const endChars = countTradeCapitalCharsBeforeCaret(currentValue, selectionEnd);
            let nextDraft = currentDraft;
            let nextCaretChars = isReplacementInsert ? 0 : startChars;
            if (event.inputType === "deleteContentBackward") {
                const deleteStart = startChars === endChars ? Math.max(0, startChars - 1) : startChars;
                nextDraft = `${currentDraft.slice(0, deleteStart)}${currentDraft.slice(endChars)}`;
                nextCaretChars = deleteStart;
            } else if (event.inputType === "deleteContentForward") {
                const deleteEnd = startChars === endChars ? endChars + 1 : endChars;
                nextDraft = `${currentDraft.slice(0, startChars)}${currentDraft.slice(deleteEnd)}`;
                nextCaretChars = startChars;
            } else {
                const insertedValue = normalizeTradeCapitalDraft(event.data || "");
                nextDraft = `${currentDraft.slice(0, startChars)}${insertedValue}${currentDraft.slice(endChars)}`;
                nextCaretChars = (isReplacementInsert ? 0 : startChars) + insertedValue.length;
            }
            delete tradeCapitalInput.dataset.replaceOnNextTradeCapitalInput;
            tradeCapitalInput.dataset.skipNextTradeCapitalInput = "1";
            if (!applyTradeCapitalDraft(nextDraft, nextCaretChars)) return;
            scheduleTradeInputAutoSubmit();
        });
        tradeCapitalInput.addEventListener("input", () => {
            if (tradeCapitalInput.dataset.skipNextTradeCapitalInput === "1") {
                delete tradeCapitalInput.dataset.skipNextTradeCapitalInput;
                return;
            }
            if (tradeCapitalInput.dataset.replaceOnNextTradeCapitalInput === "1") {
                const replacementDraft = deriveTradeCapitalReplacementDraft(tradeCapitalInput.value);
                delete tradeCapitalInput.dataset.replaceOnNextTradeCapitalInput;
                if (!applyTradeCapitalDraft(replacementDraft, replacementDraft.length)) return;
                scheduleTradeInputAutoSubmit();
                return;
            }
            if (!syncTradeCapitalControlsFromTyping()) return;
            scheduleTradeInputAutoSubmit();
        });
        tradeCapitalInput.addEventListener("blur", () => {
            delete tradeCapitalInput.dataset.focusDraft;
            delete tradeCapitalInput.dataset.replaceOnNextTradeCapitalInput;
            if (!tradeCapitalInput.value.trim()) restoreTradeCapitalControls();
            else syncTradeCapitalControls(parseTradeCapitalValue(tradeCapitalInput.value));
            scheduleTradeSliderAutoSubmit();
        });
        tradeCapitalSlider.addEventListener("focus", openTradeCapitalSlider);
        tradeCapitalSlider.addEventListener("input", () => {
            const value = clampTradeCapital(Number.parseFloat(tradeCapitalSlider.value) || 0);
            syncTradeCapitalControls(value);
            scheduleTradeSliderAutoSubmit();
        });
        tradeCapitalField.addEventListener("focusout", closeTradeCapitalSlider);
        syncTradeCapitalControls(parseTradeCapitalValue(tradeCapitalInput.value));
    }

    const getTradeStrategyRefs = () => {
        const field = document.querySelector("[data-trade-strategy-field]");
        const select = $("#trade_strategy");
        const trigger = document.querySelector("[data-trade-strategy-trigger]");
        const triggerLabel = document.querySelector("[data-trade-strategy-trigger-label]");
        const dropdown = document.querySelector("[data-trade-strategy-dropdown]");
        const tuneButton = document.querySelector("[data-trade-strategy-tune-button]");
        const panel = document.querySelector("[data-trade-strategy-panel]");
        return {
            field,
            select,
            trigger,
            triggerLabel,
            dropdown,
            tuneButton,
            panel,
        };
    };
    let strategySwitchAnimationTimer = null;
    let strategyFieldsRequestToken = 0;
    let strategyScrollbarIdleTimer = 0;

    const scheduleStrategyParamSubmit = (delay = 160) => {
        if (!hasInitialResult) return;
        scheduleAutoSubmit(delay);
    };

    const collectStrategyParamEntries = () => {
        const {field} = getTradeStrategyRefs();
        if (!(field instanceof HTMLElement)) return [];
        const controls = Array.from(field.querySelectorAll("[data-strategy-param-input][name]"));
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
        const {field, panel} = getTradeStrategyRefs();
        if (!(panel instanceof HTMLElement) || panel.hidden) return;
        if (!(field instanceof HTMLElement)) return;
        const panelStyles = getComputedStyle(panel);
        const panelAnchor = field.querySelector(".trade-strategy-row");
        const anchorRect = panelAnchor instanceof HTMLElement ? panelAnchor.getBoundingClientRect() : field.getBoundingClientRect();
        const overlayMetrics = getSidebarOverlayMetrics(anchorRect, 160);
        const availableHeight = overlayMetrics ? overlayMetrics.availableHeight : 160;
        const panelGrid = panel.querySelector("[data-trade-strategy-params-grid]");
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
            panel.style.height = `${Math.round(desiredPanelHeight)}px`;
            panel.style.maxHeight = `${Math.round(availableHeight)}px`;
            return;
        }
        panel.style.height = "";
        panel.style.maxHeight = `${Math.round(availableHeight)}px`;
    };

    const setStrategyPanelScrollingState = () => {
        const {panel} = getTradeStrategyRefs();
        if (!(panel instanceof HTMLElement)) return;
        const grid = panel.querySelector("[data-trade-strategy-params-grid]");
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
        const {field, select, tuneButton, panel} = getTradeStrategyRefs();
        if (!(panel instanceof HTMLElement) || !(tuneButton instanceof HTMLButtonElement)) return;
        const shouldOpen = isOpen && !tuneButton.classList.contains("is-hidden");
        panel.hidden = !shouldOpen;
        tuneButton.classList.toggle("is-active", shouldOpen);
        tuneButton.setAttribute("aria-pressed", shouldOpen ? "true" : "false");
        if (select instanceof HTMLSelectElement) {
            select.disabled = shouldOpen;
        }
        if (field instanceof HTMLElement) {
            field.classList.toggle("is-open", shouldOpen);
        }
        if (shouldOpen) {
            positionTradeStrategyPanel();
        } else {
            panel.style.maxHeight = "";
            panel.style.height = "";
            const panelGrid = panel.querySelector("[data-trade-strategy-params-grid]");
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
        const {tuneButton, panel} = getTradeStrategyRefs();
        if (!(tuneButton instanceof HTMLButtonElement) || !(panel instanceof HTMLElement)) return;
        const hasFields = Boolean(panel.querySelector("[data-strategy-param-key]"));
        tuneButton.classList.toggle("is-hidden", !hasFields);
        tuneButton.disabled = !hasFields;
        tuneButton.setAttribute("aria-hidden", hasFields ? "false" : "true");
        tuneButton.tabIndex = hasFields ? 0 : -1;
        if (!hasFields) setTradeStrategyPanelOpen(false);
    };

    const setTradeStrategyDropdownOpen = (isOpen) => {
        const {field, trigger, dropdown, panel} = getTradeStrategyRefs();
        if (!(dropdown instanceof HTMLElement) || !(trigger instanceof HTMLButtonElement)) return;
        dropdown.hidden = !isOpen;
        trigger.setAttribute("aria-expanded", isOpen ? "true" : "false");
        if (field instanceof HTMLElement) {
            field.classList.toggle("is-open", isOpen || (!(panel instanceof HTMLElement) ? false : !panel.hidden));
        }
        if (isOpen) {
            positionTradeStrategyDropdown();
        } else {
            resetSidebarDropdownPosition(dropdown);
        }
    };

    const syncTradeStrategyTriggerLabel = () => {
        const {field, select, trigger, triggerLabel} = getTradeStrategyRefs();
        if (!(select instanceof HTMLSelectElement) || !(trigger instanceof HTMLButtonElement) || !(triggerLabel instanceof HTMLElement)) return;
        const selectedOption = Array.from(select.options).find((option) => option.value === select.value);
        const nextLabel = selectedOption?.textContent?.trim()
            || triggerLabel.dataset.fallbackLabel
            || trigger.getAttribute("title")
            || select.options[0]?.textContent?.trim()
            || "";
        triggerLabel.textContent = nextLabel;
        triggerLabel.dataset.fallbackLabel = nextLabel;
        trigger.title = nextLabel;
        const fieldLabel = field?.querySelector("label")?.textContent?.trim() || "";
        if (fieldLabel) {
            trigger.setAttribute("aria-label", `${fieldLabel}: ${nextLabel}`);
        }
    };

    const positionTradeStrategyDropdown = () => {
        const {field, trigger, dropdown} = getTradeStrategyRefs();
        if (!(dropdown instanceof HTMLElement) || dropdown.hidden) return;
        const container = dropdown.parentElement;
        positionSidebarDropdownFromTrigger(
            trigger,
            dropdown,
            container instanceof HTMLElement ? container : field,
        );
    };

    const renderTradeStrategyDropdown = () => {
        const {select, dropdown} = getTradeStrategyRefs();
        if (!(select instanceof HTMLSelectElement) || !(dropdown instanceof HTMLElement)) return;
        const currentSelection = String(select.value || "");
        const groups = Array.from(select.querySelectorAll("optgroup"));
        dropdown.innerHTML = "";
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
                    const {select: currentSelect} = getTradeStrategyRefs();
                    if (!(currentSelect instanceof HTMLSelectElement)) return;
                    if (currentSelect.value === option.value) {
                        setTradeStrategyDropdownOpen(false);
                        return;
                    }
                    currentSelect.value = option.value;
                    syncStrategyOptionSelection(currentSelect, option.value);
                    syncTradeStrategyTriggerLabel();
                    renderTradeStrategyDropdown();
                    setTradeStrategyDropdownOpen(false);
                    currentSelect.dispatchEvent(new Event("change", {bubbles: true}));
                });
                groupElement.appendChild(optionButton);
            });

            dropdown.appendChild(groupElement);
        });
    };

    const pulseStrategySwitch = () => {
        const {select, panel} = getTradeStrategyRefs();
        if (!(select instanceof HTMLSelectElement)) return;
        select.classList.remove("is-switching");
        if (panel instanceof HTMLElement) {
            panel.classList.remove("is-switching");
        }
        void select.offsetWidth;
        select.classList.add("is-switching");
        if (panel instanceof HTMLElement && !panel.hidden) {
            panel.classList.add("is-switching");
        }
        if (strategySwitchAnimationTimer) window.clearTimeout(strategySwitchAnimationTimer);
        strategySwitchAnimationTimer = window.setTimeout(() => {
            const {select: currentSelect, panel: currentPanel} = getTradeStrategyRefs();
            currentSelect?.classList.remove("is-switching", "is-pressing");
            if (currentPanel instanceof HTMLElement) {
                currentPanel.classList.remove("is-switching");
            }
        }, 380);
    };

    const refreshTradeStrategyFields = async (strategyId) => {
        const {panel} = getTradeStrategyRefs();
        if (!(panel instanceof HTMLElement) || !endpoints.strategyFields || !strategyId) return;
        const requestToken = ++strategyFieldsRequestToken;
        try {
            const response = await fetch(`${endpoints.strategyFields}?strategy=${encodeURIComponent(strategyId)}`, {
                credentials: "same-origin",
            });
            if (!response.ok) return;
            const payload = await response.json();
            if (requestToken !== strategyFieldsRequestToken) return;
            panel.innerHTML = payload.html || "";
            initStrategyParamControls(panel);
            syncTradeStrategyTuningAvailability();
            if (!payload.is_tunable) {
                setTradeStrategyPanelOpen(false);
            } else if (!panel.hidden) {
                positionTradeStrategyPanel();
            }
        } catch (_error) {
        }
    };

    const initializeTradeStrategyField = () => {
        const refs = getTradeStrategyRefs();
        if (!(refs.field instanceof HTMLElement)) return;
        initStrategyParamControls(refs.field);
        syncTradeStrategyTuningAvailability();
        syncTradeStrategyTriggerLabel();
        renderTradeStrategyDropdown();
        if (refs.field.dataset.tradeStrategyBound === "1") return;
        refs.field.dataset.tradeStrategyBound = "1";
        if (refs.tuneButton instanceof HTMLButtonElement) {
            refs.tuneButton.addEventListener("click", () => {
                const {panel} = getTradeStrategyRefs();
                setTradeStrategyDropdownOpen(false);
                setTradeStrategyPanelOpen(panel instanceof HTMLElement ? panel.hidden : false);
            });
        }
        if (refs.trigger instanceof HTMLButtonElement) {
            refs.trigger.addEventListener("click", () => {
                const {dropdown} = getTradeStrategyRefs();
                const shouldOpen = dropdown instanceof HTMLElement ? dropdown.hidden : false;
                closeSharedSelectDropdowns();
                setTradeStrategyPanelOpen(false);
                renderTradeStrategyDropdown();
                setTradeStrategyDropdownOpen(shouldOpen);
            });
        }
        if (refs.select instanceof HTMLSelectElement) {
            refs.select.addEventListener("change", async () => {
                const {select} = getTradeStrategyRefs();
                if (!(select instanceof HTMLSelectElement)) return;
                syncStrategyOptionSelection(select, select.value);
                syncTradeStrategyTriggerLabel();
                renderTradeStrategyDropdown();
                pulseStrategySwitch();
                await refreshTradeStrategyFields(select.value);
                if (!form) return;
                window.setTimeout(() => form.requestSubmit(), 72);
            });
        }
    };

    const repairSidebarControlBindings = () => {
        getSharedSelectFields().forEach((field) => initializeSharedSelectField(field));
        initializeTradeStrategyField();
        syncBacktestIntervalSegmentedControl();
    };

    window.repairSidebarControlBindings = repairSidebarControlBindings;

    seedTickerValidationState();
    repairSidebarControlBindings();

    window.addEventListener("resize", () => {
        getSharedSelectFields().forEach((field) => positionSharedSelectDropdown(field));
        positionTradeStrategyDropdown();
        positionTradeStrategyPanel();
    });
    document.addEventListener("scroll", () => {
        getSharedSelectFields().forEach((field) => positionSharedSelectDropdown(field));
        positionTradeStrategyDropdown();
        positionTradeStrategyPanel();
    }, true);
    document.addEventListener("click", (event) => {
        const {field} = getTradeStrategyRefs();
        const clickedInsideStrategyField = field instanceof HTMLElement && field.contains(event.target);
        const clickedInsideSharedField = getSharedSelectFields().some((sharedField) => sharedField.contains(event.target));
        if (!clickedInsideStrategyField) {
            setTradeStrategyDropdownOpen(false);
        }
        if (!clickedInsideSharedField) {
            closeSharedSelectDropdowns();
        }
    });
    if (typeof MutationObserver === "function") {
        const sidebarControlObserver = new MutationObserver(() => {
            window.requestAnimationFrame(() => {
                repairSidebarControlBindings();
            });
        });
        sidebarControlObserver.observe(document.body, {
            childList: true,
            subtree: true,
        });
    }

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
                if (!isPortfolioShareMode()) {
                    const totalWeight = getFilledWeightEntries().reduce((sum, entry) => sum + (Number.parseInt(entry.number.value, 10) || 0), 0);
                    if (totalWeight !== 100) {
                        return;
                    }
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
            } else if (state.currentView === "dca") {
                showWorkspaceModal({
                    title: "Running DCA simulation",
                    copy: "Calculating recurring buy dates, cumulative shares, and the if-all-in comparison curve for the selected range.",
                    iconClass: "icon-hourglass",
                });
                delete bootstrap.chartWorkspaceRefreshTransition;
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
        restoreOptimisticNavigationSnapshot();
        document.body.classList.remove("is-workspace-switching", "is-page-navigating");
        document.documentElement.removeAttribute("data-navigation-target");
        document.documentElement.removeAttribute("aria-busy");
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
