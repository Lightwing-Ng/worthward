/* Code version: v1.3.0 */
(() => {
    const create = (context) => {
        const {
            $,
            $$,
            WORKSPACE_VIEWS,
            bootstrap,
            form,
            labels,
            progressiveViewRegistry,
            state,
            translateUi,
        } = context;
        const scheduleDockPosition = (...args) => context.scheduleDockPosition(...args);
        const scheduleMobilePageBottomPaddingSync = (...args) => context.scheduleMobilePageBottomPaddingSync(...args);
        let optimisticNavigationFrame = 0;
        let optimisticNavigationSnapshot = null;

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

        const resolveTradeSectionFromUrl = (url) => {
            try {
                const parsedUrl = new URL(url, window.location.origin);
                const pathMatch = parsedUrl.pathname.match(/^\/(?:trade|more)\/([^/?#]+)/);
                if (pathMatch?.[1] === "live-trading") return "live-trading";
                return "investment";
            } catch (_error) {
                return "investment";
            }
        };

        const SETTINGS_NAVIGATION_PROFILES = Object.freeze({
            about: {title: translateUi("About"), layout: "reading"},
            backtest: {title: translateUi("Backtest"), layout: "options"},
            "broker-access": {title: translateUi("Broker access"), layout: "broker"},
            "cash-equivalents": {title: translateUi("Cash equivalents"), layout: "actions"},
            "clear-caches": {title: translateUi("Clear caches"), layout: "actions"},
            "email-smtp": {title: translateUi("Email (SMTP)"), layout: "form"},
            "export-image": {title: translateUi("Export images"), layout: "tokens"},
            "font-tokens": {title: translateUi("Font tokens"), layout: "tokens"},
            "color-tokens": {title: translateUi("Color tokens"), layout: "tokens"},
            general: {title: translateUi("General"), layout: "options"},
            "local-market-store": {title: translateUi("Local market store"), layout: "table"},
            "material-tokens": {title: translateUi("Material tokens"), layout: "tokens"},
            network: {title: translateUi("Network self-check"), layout: "actions"},
            strategies: {title: translateUi("Strategies"), layout: "actions"},
            "style-tokens": {title: translateUi("Style tokens"), layout: "tokens"},
        });
        const SETTINGS_NAVIGATION_ORDER = Object.freeze(Object.keys(SETTINGS_NAVIGATION_PROFILES));
        const TRADE_NAVIGATION_PROFILES = Object.freeze({
            investment: {title: "Investment"},
            "live-trading": {title: "Live trading"},
        });
        const WORKSPACE_NAVIGATION_PROFILES = Object.freeze({
            tickers: {
                title: labels.dock_tickers || "Return comparison",
                pageTitle: labels.dock_tickers || "Return comparison",
                resultTitle: labels.performance_summary || "Performance summary",
                chartTitle: labels.chart_summary || "Stock return comparison",
            },
            prices: {
                title: labels.dock_ticker_comparison || "Ticker comparison",
                pageTitle: labels.dock_prices || "Price performance",
                resultTitle: translateUi("Price history"),
                chartTitle: translateUi("Price history"),
                isMarketCap: false,
            },
            portfolio: {
                title: labels.dock_portfolio || "Compute your portfolio",
                pageTitle: translateUi("Portfolio"),
                resultTitle: labels.portfolio_summary || "Portfolio summary",
                chartTitle: labels.portfolio_chart || "Portfolio return chart",
            },
            dca: {
                title: labels.dock_dca || "Dollar-cost averaging",
                pageTitle: labels.dock_backtest || "Backtest",
                resultTitle: labels.dca_metrics || "Performance",
                chartTitle: labels.dca_chart || "Recurring buys and total return curve",
            },
            backtest: {
                title: labels.dock_backtest || "Backtest",
                pageTitle: labels.dock_backtest || "Backtest",
                resultTitle: labels.backtest_metrics || "Performance",
                chartTitle: labels.backtest_chart || "Price and strategy analysis",
            },
        });

        const resolveWorkspaceNavigationProfile = (targetView, targetUrl = "") => {
            const profile = WORKSPACE_NAVIGATION_PROFILES[targetView] || WORKSPACE_NAVIGATION_PROFILES.backtest;
            try {
                const parsedUrl = new URL(targetUrl || window.location.href, window.location.origin);
                if (targetView === "prices") {
                    const isMarketCap = parsedUrl.pathname === "/workspaces/market-caps"
                        || parsedUrl.pathname.startsWith("/workspaces/market-caps/")
                        || parsedUrl.searchParams.get("metric") === "market-cap";
                    if (!isMarketCap) return profile;
                    const pageTitle = labels.dock_market_caps || "Market cap comparison";
                    return {
                        ...profile,
                        pageTitle,
                        resultTitle: translateUi("Market cap history"),
                        chartTitle: translateUi("Market cap history"),
                        isMarketCap: true,
                    };
                }
                if (targetView !== "backtest" && targetView !== "dca") return profile;
                const strategyId = targetView === "dca"
                    ? "dca"
                    : (parsedUrl.searchParams.get("strategy") || state.selectedStrategyId || "");
                const isDca = strategyId === "dca";
                const priceFieldStrategyIds = new Set(
                    Array.isArray(state.priceFieldStrategyIds)
                        ? state.priceFieldStrategyIds.map((value) => String(value))
                        : ["bayesian-price-field", "lstm-price-field"],
                );
                return {
                    ...(isDca ? WORKSPACE_NAVIGATION_PROFILES.dca : WORKSPACE_NAVIGATION_PROFILES.backtest),
                    historySegmentCount: !isDca && priceFieldStrategyIds.has(strategyId) ? 3 : 2,
                    metricCount: isDca ? 9 : 10,
                };
            } catch (_error) {
                return profile;
            }
        };

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
            let items = Object.entries(WORKSPACE_NAVIGATION_PROFILES)
                .filter(([key]) => key !== "dca")
                .map(([key, profile]) => ({
                    key,
                    label: profile.title,
                }));
            let activeKey = targetView === "dca" ? "backtest" : targetView;
            if (targetView === "settings") {
                title = labels.settings_title || "Settings";
                items = SETTINGS_NAVIGATION_ORDER.map((key) => ({key, label: SETTINGS_NAVIGATION_PROFILES[key].title}));
                activeKey = SETTINGS_NAVIGATION_PROFILES[targetSection] ? targetSection : "about";
            } else if (targetView === "trade") {
                title = labels.dock_trade || "Trade";
                items = Object.entries(TRADE_NAVIGATION_PROFILES).map(([key, profile]) => ({key, label: profile.title}));
                activeKey = TRADE_NAVIGATION_PROFILES[targetSection] ? targetSection : "investment";
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

        const buildWorkspaceNavigationTitleCard = (title) => `
            <header class="report-card workspace-article-card workspace-summary-card workspace-mode-title-card navigation-skeleton-title-card"
                    data-layout-role="title-rail"
                    data-navigation-skeleton-region="page-title">
                <div class="report-heading-row" data-layout-role="title-heading">
                    <h2 class="report-heading">${escapeSkeletonText(title)}</h2>
                </div>
            </header>
        `;

        const buildWorkspaceNavigationResultTitle = (title) => `
            <header class="report-card workspace-article-card workspace-summary-card navigation-skeleton-title-card"
                    data-layout-role="result-title-rail"
                    data-navigation-skeleton-region="result-title">
                <div class="report-heading-row" data-layout-role="result-heading">
                    <h2 class="report-heading">${escapeSkeletonText(title)}</h2>
                </div>
            </header>
        `;

        const buildWorkspaceNavigationControls = (targetView) => {
            const fieldCount = targetView === "backtest" || targetView === "dca" ? 10 : 8;
            const elementName = targetView === "tickers" || targetView === "prices" ? "aside" : "article";
            const backtestAttributes = targetView === "backtest" || targetView === "dca"
                ? ' id="backtest_parameter_panel" data-backtest-parameter-panel'
                : "";
            return `
                <${elementName} class="chart-surface workspace-mode-controls-surface navigation-skeleton-card navigation-skeleton-controls"
                                data-navigation-skeleton-region="controls"${backtestAttributes}>
                    <div class="navigation-skeleton-form">
                        ${Array.from({length: fieldCount}, (_, index) => `
                            <div class="navigation-skeleton-field">
                                ${navigationSkeletonLine(index % 3 === 0 ? "48%" : "34%")}
                                ${navigationSkeletonLine("100%", "navigation-skeleton-control")}
                            </div>
                        `).join("")}
                    </div>
                </${elementName}>
            `;
        };

        const buildWorkspaceNavigationChart = (profile, className = "") => `
            <article class="chart-surface navigation-skeleton-card navigation-skeleton-chart${className ? ` ${className}` : ""}"
                     data-navigation-skeleton-region="chart">
                <div class="chart-heading-row"><p class="chart-heading">${escapeSkeletonText(profile.chartTitle)}</p></div>
                ${navigationSkeletonLines(["100%"])}
            </article>
        `;

        const buildWorkspaceNavigationSummary = (targetView) => {
            if (targetView === "portfolio") {
                return `
                    <article class="report-card workspace-content-card portfolio-summary-content-card navigation-skeleton-card navigation-skeleton-portfolio"
                             data-layout-role="result-container"
                             data-navigation-skeleton-region="summary">
                        <span class="navigation-skeleton-orbit"></span>
                        <span class="navigation-skeleton-orbit"></span>
                        ${navigationSkeletonLines(["46%", "62%"]) }
                    </article>
                `;
            }
            return `
                <article class="report-card workspace-content-card compare-summary-content-card navigation-skeleton-card"
                         data-layout-role="result-container"
                         data-navigation-skeleton-region="summary">
                    <div class="performance-grid navigation-skeleton-summary-grid">
                        ${Array.from({length: 2}, (_, index) => `<div class="navigation-skeleton-metric">${navigationSkeletonLines([index ? "56%" : "72%", "42%"])}</div>`).join("")}
                    </div>
                </article>
            `;
        };

        const buildBacktestNavigationResults = (profile) => {
            const metricCount = profile.metricCount || 10;
            const historySegmentCount = profile.historySegmentCount || 2;
            return `
                ${buildWorkspaceNavigationResultTitle(profile.resultTitle)}
                <article class="report-card workspace-content-card trade-performance-card investment-report-card backtest-trade-performance-card navigation-skeleton-card"
                         data-layout-role="result-container"
                         data-navigation-skeleton-region="overview">
                    <article class="chart-surface backtest-surface navigation-skeleton-chart">
                        <div class="chart-heading-row"><p class="chart-heading">${escapeSkeletonText(profile.chartTitle)}</p></div>
                        ${navigationSkeletonLines(["100%"]) }
                    </article>
                </article>
                <div class="backtest-section-resizer-slot" data-backtest-section-resizer-slot data-navigation-skeleton-region="resizer">
                    <span class="surface-resizer surface-resizer--block backtest-section-resizer"></span>
                </div>
                <article class="chart-surface investment-history-surface backtest-history-surface navigation-skeleton-card"
                         data-navigation-skeleton-region="history">
                    <div class="navigation-skeleton-segments">
                        ${Array.from({length: historySegmentCount}, () => navigationSkeletonLine("100%")).join("")}
                    </div>
                    <div class="trade-metrics-grid trade-view-panel-grid trade-metrics-panel-grid navigation-skeleton-metrics-grid">
                        ${Array.from({length: metricCount}, () => `<div class="navigation-skeleton-metric">${navigationSkeletonLines(["68%", "42%"])}</div>`).join("")}
                    </div>
                </article>
            `;
        };

        const buildWorkspaceNavigationSkeleton = (targetView, targetUrl = "") => {
            const profile = resolveWorkspaceNavigationProfile(targetView, targetUrl);
            const isBacktest = targetView === "backtest" || targetView === "dca";
            const shellClasses = [
                "workspace-mode-shell",
                targetView === "prices" ? "price-compare-workspace" : "",
                profile.isMarketCap ? "market-cap-compare-workspace" : "",
                targetView === "portfolio" ? "portfolio-workspace" : "",
                isBacktest ? "backtest-workspace-shell" : "",
                "navigation-skeleton-page",
            ].filter(Boolean).join(" ");
            let resultsMarkup = "";
            if (targetView === "tickers") {
                resultsMarkup = `
                    ${buildWorkspaceNavigationResultTitle(profile.resultTitle)}
                    ${buildWorkspaceNavigationSummary(targetView)}
                    ${buildWorkspaceNavigationChart(profile)}
                `;
            } else if (targetView === "prices") {
                resultsMarkup = `
                    ${buildWorkspaceNavigationResultTitle(profile.resultTitle)}
                    ${buildWorkspaceNavigationChart(profile, "price-subplots-surface")}
                `;
            } else if (targetView === "portfolio") {
                resultsMarkup = `
                    ${buildWorkspaceNavigationResultTitle(profile.resultTitle)}
                    ${buildWorkspaceNavigationChart(profile)}
                    ${buildWorkspaceNavigationSummary(targetView)}
                `;
            } else {
                resultsMarkup = buildBacktestNavigationResults(profile);
            }
            return `
                <section class="${shellClasses}"
                         data-navigation-skeleton-view="${escapeSkeletonText(targetView)}"${isBacktest ? " data-backtest-workspace-shell" : ""}>
                    ${buildWorkspaceNavigationTitleCard(profile.pageTitle)}
                    <div class="workspace-mode-layout">
                        ${buildWorkspaceNavigationControls(targetView)}
                        <section class="workspace-mode-main${isBacktest ? " backtest-workspace-main" : ""}">
                            <article class="workspace-header workspace-mobile-summary-shell workspace-mode-results-stack${isBacktest ? " backtest-results-stack investment-workspace-header" : ""}"
                                     data-mobile-summary-fixed>
                                ${resultsMarkup}
                            </article>
                        </section>
                    </div>
                </section>
            `;
        };

        const buildTradeNavigationSkeleton = (targetSection) => {
            const section = TRADE_NAVIGATION_PROFILES[targetSection] ? targetSection : "investment";
            const title = TRADE_NAVIGATION_PROFILES[section].title;
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
                    <div class="settings-content-scrollport" data-layout-role="content-scrollport">
                        ${buildSettingsNavigationContent(profile.layout)}
                    </div>
                </section>
            `;
        };

        const renderOptimisticNavigationSkeleton = ({view, section = null, targetUrl = ""} = {}) => {
            const targetView = view || state.currentView;
            const workspacePanel = document.getElementById("workspace_panel");
            const sidebar = document.getElementById("app_sidebar");
            if (!(workspacePanel instanceof HTMLElement) || !(sidebar instanceof HTMLElement)) return false;
            let normalizedSection = section;
            let workspaceMarkup = "";
            if (targetView === "settings") {
                normalizedSection = SETTINGS_NAVIGATION_PROFILES[section] ? section : "about";
                workspaceMarkup = buildSettingsNavigationSkeleton(normalizedSection);
            } else if (targetView === "trade") {
                normalizedSection = TRADE_NAVIGATION_PROFILES[section] ? section : "investment";
                workspaceMarkup = buildTradeNavigationSkeleton(normalizedSection);
            } else if (WORKSPACE_VIEWS.has(targetView)) {
                workspaceMarkup = buildWorkspaceNavigationSkeleton(targetView, targetUrl);
            } else {
                return false;
            }
            if (targetView !== state.currentView || sidebar.querySelector(".navigation-skeleton-sidebar-nav")) {
                sidebar.innerHTML = buildNavigationSidebar(targetView, normalizedSection);
            }
            const loadingTitle = targetView === "settings"
                ? SETTINGS_NAVIGATION_PROFILES[normalizedSection].title
                : targetView === "trade"
                    ? TRADE_NAVIGATION_PROFILES[normalizedSection].title
                    : resolveWorkspaceNavigationProfile(targetView, targetUrl).pageTitle;
            workspacePanel.innerHTML = `
                <div class="navigation-skeleton-status sr-only" role="status" aria-live="polite">Loading ${escapeSkeletonText(loadingTitle)}</div>
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
        const clearNavigationBacktestToggle = () => {
            document.querySelectorAll("[data-navigation-skeleton-backtest-toggle]").forEach((node) => node.remove());
        };
        const syncNavigationBacktestToggle = (targetView) => {
            clearNavigationBacktestToggle();
            const existingToggle = document.querySelector("[data-backtest-parameter-toggle]");
            if (existingToggle instanceof HTMLButtonElement) {
                existingToggle.hidden = true;
                existingToggle.setAttribute("aria-hidden", "true");
            }
            if (targetView !== "backtest" && targetView !== "dca") return;
            const globalSidebarToggle = document.getElementById("sidebar_toggle");
            if (globalSidebarToggle?.getAttribute("aria-expanded") === "true") return;
            const appShell = document.querySelector(".app-shell");
            if (!(appShell instanceof HTMLElement)) return;
            const toggle = document.createElement("span");
            toggle.className = "sidebar-icon-button sidebar-secondary-button backtest-parameter-toggle navigation-skeleton-backtest-toggle";
            toggle.dataset.navigationSkeletonBacktestToggle = "";
            toggle.setAttribute("aria-hidden", "true");
            toggle.innerHTML = '<span class="icon icon-backtest-parameters" aria-hidden="true"></span>';
            appShell.before(toggle);
        };
        const captureOptimisticNavigationSnapshot = () => {
            if (optimisticNavigationSnapshot) return;
            const sidebar = document.getElementById("app_sidebar");
            const workspacePanel = document.getElementById("workspace_panel");
            const dock = document.querySelector(".sidebar-dock");
            const backtestToggle = document.querySelector("[data-backtest-parameter-toggle]");
            if (!(sidebar instanceof HTMLElement) || !(workspacePanel instanceof HTMLElement)) return;
            optimisticNavigationSnapshot = {
                sidebarNodes: Array.from(sidebar.childNodes),
                workspaceNodes: Array.from(workspacePanel.childNodes),
                dockState: Array.from(dock?.querySelectorAll(".sidebar-dock-item") || []).map((item) => ({
                    className: item.className,
                    ariaCurrent: item.getAttribute("aria-current"),
                })),
                backtestToggleState: backtestToggle instanceof HTMLButtonElement ? {
                    node: backtestToggle,
                    hidden: backtestToggle.hidden,
                    ariaHidden: backtestToggle.getAttribute("aria-hidden"),
                    ariaExpanded: backtestToggle.getAttribute("aria-expanded"),
                } : null,
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
            clearNavigationBacktestToggle();
            const backtestToggleState = optimisticNavigationSnapshot.backtestToggleState;
            if (backtestToggleState?.node instanceof HTMLButtonElement) {
                backtestToggleState.node.hidden = backtestToggleState.hidden;
                if (backtestToggleState.ariaHidden === null) {
                    backtestToggleState.node.removeAttribute("aria-hidden");
                } else {
                    backtestToggleState.node.setAttribute("aria-hidden", backtestToggleState.ariaHidden);
                }
                if (backtestToggleState.ariaExpanded === null) {
                    backtestToggleState.node.removeAttribute("aria-expanded");
                } else {
                    backtestToggleState.node.setAttribute("aria-expanded", backtestToggleState.ariaExpanded);
                }
            }
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
                if (path === "/workspaces/market-caps" || path.startsWith("/workspaces/market-caps/")) return "prices";
                if (path === "/workspaces/prices" || path.startsWith("/workspaces/prices/")) return "prices";
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
                ) return parsedUrl.searchParams.get("strategy") === "dca" ? "dca" : "backtest";
                if (path === "/trade" || path.startsWith("/trade/") || path === "/more" || path.startsWith("/more/") || path === "/invest" || path === "/investment") return "trade";
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
            $$(".sidebar-dock-item").forEach((link) => {
                const group = link.dataset.dockGroup || resolveDockGroupFromView(resolveViewFromUrl(link.href));
                const isTarget = group === targetDockGroup;
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
                : targetView === "trade"
                    ? resolveTradeSectionFromUrl(nextUrl)
                    : null;
            const dockGroup = targetDockGroup || resolveDockGroupFromView(targetView);
            captureOptimisticNavigationSnapshot();
            const runtimeState = context.runtimeState;
            if (runtimeState) {
                if (runtimeState.autoSubmitTimer) {
                    window.clearTimeout(runtimeState.autoSubmitTimer);
                    runtimeState.autoSubmitTimer = null;
                }
                runtimeState.workspaceSubmitToken += 1;
                runtimeState.isSubmittingWithOverlay = false;
            }
            context.abortActiveWorkspaceHydration?.();
            context.clearWorkspacePendingState?.();
            context.clearWorkspaceChartTransitionRequest?.();
            context.setFormBusyState?.(false);
            context.hideWorkspaceModal?.();
            document.body.classList.add("is-workspace-switching", "is-page-navigating");
            document.documentElement.dataset.navigationTarget = targetView || "page";
            document.documentElement.setAttribute("aria-busy", "true");
            syncDockPreviewTarget(dockGroup);
            syncLocalPreviewTarget(link);
            syncNavigationBacktestToggle(targetView);
            renderOptimisticNavigationSkeleton({view: targetView, section: targetSection, targetUrl: nextUrl});
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


        return Object.freeze({
            SETTINGS_NAVIGATION_ORDER,
            SETTINGS_NAVIGATION_PROFILES,
            TRADE_NAVIGATION_PROFILES,
            WORKSPACE_NAVIGATION_PROFILES,
            beginOptimisticPageNavigation,
            buildNavigationSidebar,
            buildNavigationTitleCard,
            buildSettingsNavigationContent,
            buildSettingsNavigationSkeleton,
            buildTradeNavigationSkeleton,
            buildWorkspaceNavigationChart,
            buildWorkspaceNavigationControls,
            buildWorkspaceNavigationResultTitle,
            buildWorkspaceNavigationSummary,
            buildWorkspaceNavigationTitleCard,
            buildWorkspaceNavigationSkeleton,
            captureOptimisticNavigationSnapshot,
            clearOptimisticNavigationSkeleton,
            clearNavigationBacktestToggle,
            escapeSkeletonText,
            getProgressiveManifest,
            navigationSkeletonLine,
            navigationSkeletonLines,
            normalizeNavigationUrl,
            optimisticNavigationFrame,
            optimisticNavigationSnapshot,
            renderOptimisticNavigationSkeleton,
            resolveDockGroupFromView,
            resolveSettingsSectionFromUrl,
            resolveTradeSectionFromUrl,
            resolveViewFromUrl,
            resolveWorkspaceNavigationProfile,
            restoreOptimisticNavigationSnapshot,
            syncDockPreviewTarget,
            syncNavigationBacktestToggle,
            syncLocalPreviewTarget,
        });
    };

    window.WORTHWARD_APP_NAVIGATION = Object.freeze({create});
})();
