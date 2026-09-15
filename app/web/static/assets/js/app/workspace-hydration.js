/* Code version: v1.2.1 */
(() => {
    const create = (context) => {
        const {
            $,
            $$,
            MIN_TICKERS,
            PRICE_COMPARISON_MAX_TICKERS,
            TRANSIENT_VIEW_QUERY_KEYS,
            VIEW_MEMORY_KEY,
            WORKSPACE_VIEWS,
            beginOptimisticPageNavigation,
            bootstrap,
            constraints,
            getProgressiveManifest,
            getFilledTickers,
            getTickerInputs,
            initializeWorkspaceEnhancements,
            labels,
            minimumRequiredTickers,
            normalizeComparisonMetric,
            normalizeNavigationUrl,
            preferenceStorage,
            reportFetchAbortDebug,
            resolveDockGroupFromView,
            resolveViewFromUrl,
            runtimeState,
            sanitizeTicker,
            showTradeDetailsInput,
            state,
            translateUi,
        } = context;
        const scheduleDockPosition = (...args) => context.scheduleDockPosition(...args);
        const scheduleMobilePageBottomPaddingSync = (...args) => context.scheduleMobilePageBottomPaddingSync(...args);
        const syncSegmentedControlLayout = (...args) => context.syncSegmentedControlLayout(...args);
        const updateAddButtonState = (...args) => context.updateAddButtonState(...args);
        let activeWorkspaceHydration = null;
        let workspaceHydrationToken = 0;
        let lastWorkspaceRangeNoticeFingerprint = "";
        let lastWorkspaceRangeNoticeTexts = new Set();

        const buildPendingWorkspaceMarkup = () => {
            const currentValues = getFilledTickers();
            const reportHeading = $(".workspace .report-heading")?.textContent?.trim() || labels.backtest_metrics || translateUi("Loading");
            const chartHeading = $(".workspace .chart-heading")?.textContent?.trim() || translateUi("Loading");
            if (state.currentView === "backtest") {
                const showBacktestTradeDetails = showTradeDetailsInput instanceof HTMLInputElement
                    ? showTradeDetailsInput.checked
                    : false;
                const priceFieldStrategyIds = Array.isArray(state.priceFieldStrategyIds)
                    && state.priceFieldStrategyIds.length
                    ? state.priceFieldStrategyIds
                    : (window.WORTHWARD_BACKTEST_PROBABILITY_GRID?.PRICE_FIELD_STRATEGY_IDS
                        || ["bayesian-price-field", "lstm-price-field"]);
                const showBacktestProbabilityField = priceFieldStrategyIds.includes(
                    state.selectedStrategyId,
                );
                const tradeMetricLabels = [
                    "Initial capital",
                    "Final equity",
                    "Net return",
                    "Total trades",
                    "Win rate",
                    "Beat B&H",
                    "Alpha vs B&H",
                    "Realized long P&L",
                    "Realized short P&L",
                    "Realized long loss",
                ];
                const pendingMetricCards = tradeMetricLabels.map((label) => (
                    `<div class="trade-metric-card"><span class="trade-metric-label">${label}</span><span class="trade-metric-value is-pending-value" data-workspace-mask="trade-metric">0000</span></div>`
                )).join("");
                const pendingTransactionRows = Array.from({length: 4}, (_, index) => `
                    <tr>
                        <td class="trade-transactions-index">${index + 1}</td>
                        <td class="is-pending-value">0000</td>
                        <td class="is-pending-value">0000</td>
                        <td class="trade-transactions-number is-pending-value">0000</td>
                        <td class="trade-transactions-number is-pending-value">0000</td>
                        <td class="trade-transactions-number is-pending-value">0000</td>
                        <td class="trade-transactions-number is-pending-value">0000</td>
                        <td class="trade-transactions-number is-pending-value">0000</td>
                        <td class="trade-transactions-number is-pending-value">0000</td>
                        <td class="trade-transactions-number is-pending-value">0000</td>
                    </tr>
                `).join("");
                return `
                    <section class="workspace-header workspace-mobile-summary-shell workspace-mode-results-stack backtest-results-stack investment-workspace-header" data-mobile-summary-fixed>
                        <article class="report-card workspace-article-card workspace-summary-card">
                            <div class="report-heading-row"><p class="report-heading">${reportHeading}</p></div>
                        </article>
                        <article class="report-card workspace-content-card trade-performance-card investment-report-card backtest-trade-performance-card">
                            <div class="investment-surface-stack investment-view-surface backtest-view-surface" id="backtest_view_surface" data-active-view="overview">
                                <div class="investment-view-surface-body backtest-view-surface-body" id="backtest_view_surface_body">
                                    <div id="backtest_overview_panel" data-backtest-view-panel="overview">
                                        <article class="chart-surface backtest-surface">
                                            <div class="chart-heading-row"><p class="chart-heading">${chartHeading}</p></div>
                                            <div class="trade-chart-stack${showBacktestTradeDetails ? "" : " is-trade-details-hidden"}"
                                                 data-backtest-trade-chart-stack
                                                 data-trade-details-visible="${showBacktestTradeDetails}">
                                                <div class="trade-chart-panel is-pending-value" data-workspace-mask="trade-chart"></div>
                                                <div class="trade-chart-panel trade-chart-panel-equity is-pending-value"
                                                     data-backtest-equity-panel
                                                     data-workspace-mask="trade-chart"${showBacktestTradeDetails ? "" : " hidden aria-hidden=\"true\""}></div>
                                            </div>
                                        </article>
                                    </div>
                                </div>
                            </div>
                        </article>
                        <div class="backtest-section-resizer-slot" data-backtest-section-resizer-slot>
                            <button type="button"
                                    class="surface-resizer surface-resizer--block surface-resizer--reveal investment-section-resizer backtest-section-resizer"
                                    id="backtest_section_resizer"
                                    data-backtest-section-resizer
                                    role="separator"
                                    aria-orientation="horizontal"
                                    aria-label="Resize backtest overview and transaction history"></button>
                            <div class="backtest-probability-scrollport"
                                 data-backtest-probability-scrollport
                                 role="region"
                                 aria-label="Pan chart to reveal the probability field"
                                 aria-hidden="true"
                                 tabindex="-1"
                                 hidden>
                                <span class="backtest-probability-scrollport-spacer"
                                      data-backtest-probability-scrollport-spacer
                                      aria-hidden="true"></span>
                            </div>
                        </div>
                    <article class="chart-surface investment-history-surface backtest-history-surface"
                             id="backtest_history_surface"
                             data-active-view="${showBacktestTradeDetails ? "transactions" : "metrics"}"
                             data-trade-details-visible="${showBacktestTradeDetails}">
                        <div class="investment-view-segmented-wrap backtest-history-view-segmented-wrap">
                            <div class="segmented-control-overflow-frame investment-view-segmented-frame backtest-history-view-segmented-frame"
                                 data-segmented-overflow-frame data-overflow-start="0" data-overflow-end="0">
                                <div class="segmented-control segmented-control--compact investment-view-segmented backtest-history-view-segmented"
                                     id="backtest_history_view_segmented" data-backtest-history-view-segmented data-active="${showBacktestTradeDetails ? "transactions" : "metrics"}" data-option-count="${showBacktestProbabilityField ? "3" : "2"}" data-segmented-pill="measured" data-segmented-overflow-mode="peek">
                                    <label class="segmented-control-option" for="backtest_history_metrics"><input id="backtest_history_metrics" name="backtest_history_view_tab" type="radio" value="metrics"${showBacktestTradeDetails ? "" : " checked"}><span>Metrics</span></label>
                                    ${showBacktestProbabilityField ? '<label class="segmented-control-option" for="backtest_history_probability"><input id="backtest_history_probability" name="backtest_history_view_tab" type="radio" value="probability"><span>Price field</span></label>' : ""}
                                    <label class="segmented-control-option" for="backtest_history_transactions" data-backtest-history-transactions-option${showBacktestTradeDetails ? "" : " aria-disabled=\"true\""}><input id="backtest_history_transactions" name="backtest_history_view_tab" type="radio" value="transactions" data-backtest-history-transactions${showBacktestTradeDetails ? " checked" : " disabled"}><span>Transactions</span></label>
                                </div>
                            </div>
                        </div>
                        <div class="investment-view-surface-body backtest-history-view-body" id="backtest_history_view_body">
                            <div id="backtest_history_metrics_panel" data-backtest-history-view-panel="metrics"${showBacktestTradeDetails ? " hidden" : ""}>
                                <div class="trade-metrics-grid trade-view-panel-grid trade-metrics-panel-grid" id="backtest_metrics_panel">${pendingMetricCards}</div>
                            </div>
                            ${showBacktestProbabilityField ? `
                            <section class="backtest-probability-detail-panel"
                                     id="backtest_probability_detail_panel"
                                     data-backtest-probability-detail-panel
                                     data-backtest-history-view-panel="probability"
                                     role="region"
                                     aria-labelledby="backtest_probability_detail_title"
                                     hidden
                                     aria-hidden="true">
                                <div class="backtest-probability-detail-heading">
                                    <p class="chart-heading" id="backtest_probability_detail_title">Price field detail</p>
                                    <div class="backtest-probability-detail-status-row">
                                        <p class="backtest-probability-detail-status" data-backtest-probability-detail-status aria-live="polite">
                                            Hover a price point to inspect its forecast field.
                                        </p>
                                    </div>
                                </div>
                                <div class="backtest-probability-detail-plot" data-backtest-probability-detail-plot>
                                    <div class="backtest-probability-detail-y-axis">
                                        <div class="backtest-probability-detail-y-axis-viewport" data-backtest-probability-detail-y-axis></div>
                                    </div>
                                    <div class="backtest-probability-detail-main">
                                        <div class="backtest-probability-detail-grid-viewport" data-backtest-probability-detail-grid-viewport>
                                            <div class="backtest-probability-detail-grid" data-backtest-probability-detail-grid role="img" aria-label="Future price probability field"></div>
                                            <span class="backtest-probability-detail-anchor" data-backtest-probability-detail-anchor aria-hidden="true"></span>
                                            <div class="backtest-probability-detail-side-summary" role="group" aria-label="Average probability mass per forecast horizon by price direction">
                                                <span class="backtest-probability-detail-side-summary-value is-up" data-backtest-probability-detail-up-summary></span>
                                                <span class="backtest-probability-detail-side-summary-value is-down" data-backtest-probability-detail-down-summary></span>
                                            </div>
                                        </div>
                                        <div class="backtest-probability-detail-x-axis" data-backtest-probability-detail-x-axis>
                                        </div>
                                    </div>
                                </div>
                            </section>
                            ` : ""}
                            <div id="backtest_history_transactions_panel" data-backtest-history-view-panel="transactions"${showBacktestTradeDetails ? "" : " hidden"}>
                        <div class="investment-stock-details-table-host scrollable-data-table-shell local-store-pagination-host investment-history-table-shell backtest-history-table-shell" id="backtest_history_table_wrap">
                            <table class="settings-table trade-transactions-table scrollable-data-table investment-history-table backtest-history-table" data-table-header aria-label="Transaction details columns">
                                <colgroup>
                                    <col style="width: var(--backtest-col-no-width);">
                                    <col style="width: var(--backtest-col-date-time-width);">
                                    <col style="width: var(--backtest-col-side-width);">
                                    <col style="width: var(--backtest-col-price-width);">
                                    <col style="width: var(--backtest-col-quantity-width);">
                                    <col style="width: var(--backtest-col-realized-pnl-width);">
                                    <col style="width: var(--backtest-col-unrealized-pnl-width);">
                                    <col style="width: var(--backtest-col-cash-width);">
                                    <col style="width: var(--backtest-col-market-value-width);">
                                    <col style="width: var(--backtest-col-equity-width);">
                                </colgroup>
                                <thead><tr><th>No.</th><th>Date time</th><th>Side</th><th>Price</th><th>Quantity</th><th>Realized P&amp;L</th><th>Unrealized P&amp;L</th><th>Cash</th><th>Market value</th><th>Equity</th></tr></thead>
                            </table>
                            <div class="trade-transactions-wrap scrollable-data-table-scroll investment-history-table-scroll" id="backtest_history_table_scroll" data-table-scroll>
                                <table id="tradeTransactionsTable" class="settings-table trade-transactions-table scrollable-data-table investment-history-table backtest-history-table" data-table-body>
                                    <colgroup>
                                        <col style="width: var(--backtest-col-no-width);">
                                        <col style="width: var(--backtest-col-date-time-width);">
                                        <col style="width: var(--backtest-col-side-width);">
                                        <col style="width: var(--backtest-col-price-width);">
                                        <col style="width: var(--backtest-col-quantity-width);">
                                        <col style="width: var(--backtest-col-realized-pnl-width);">
                                        <col style="width: var(--backtest-col-unrealized-pnl-width);">
                                        <col style="width: var(--backtest-col-cash-width);">
                                        <col style="width: var(--backtest-col-market-value-width);">
                                        <col style="width: var(--backtest-col-equity-width);">
                                    </colgroup>
                                    <tbody>${pendingTransactionRows}</tbody>
                                </table>
                            </div>
                        </div>
                            </div>
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

        const buildWorkspaceRangeNoticeFingerprint = (url = window.location.href) => {
            try {
                const targetUrl = new URL(url, window.location.origin);
                const params = new URLSearchParams(targetUrl.search);
                const tickers = params.getAll("ticker")
                    .map((ticker) => String(ticker || "").trim().toUpperCase())
                    .filter(Boolean)
                    .sort();
                const rangeKeys = [
                    "range",
                    "period",
                    "date",
                    "trading_date",
                    "exact_trading_date",
                    "from",
                    "to",
                    "exact_start",
                    "exact_end",
                    "return",
                    "extended-hours",
                    "extended_hours",
                    "include_extended_hours",
                    "overnight",
                    "include_overnight",
                    "price_only",
                    "price_return_only",
                    "dividends",
                    "include_dividends",
                ];
                return [
                    `tickers=${tickers.join(",")}`,
                    ...rangeKeys.map((key) => `${key}=${params.get(key) || ""}`),
                ].join("|");
            } catch {
                return "";
            }
        };

        const normalizeBannerText = (value) => String(value || "")
            .replace(/\s+/g, " ")
            .trim();

        const syncGlobalNoticeBanners = (doc, targetUrl) => {
            const pageRoot = document.querySelector(".page");
            if (!(pageRoot instanceof HTMLElement) || !doc) return;
            document.querySelectorAll(".notice-floating-banner-global").forEach((node) => node.remove());
            const nextBanners = Array.from(doc.querySelectorAll(".notice-floating-banner-global"));
            if (!nextBanners.length) return;
            const nextRangeFingerprint = buildWorkspaceRangeNoticeFingerprint(targetUrl);
            const isRepeatRange = Boolean(nextRangeFingerprint)
                && nextRangeFingerprint === lastWorkspaceRangeNoticeFingerprint;
            const comparisonStartPrefix = "Comparison starts from ";
            const nextRangeNoticeTexts = new Set();
            const bannersToRender = nextBanners.filter((banner) => {
                const text = normalizeBannerText(banner.textContent);
                if (!text || nextRangeNoticeTexts.has(text)) return false;
                nextRangeNoticeTexts.add(text);
                if (isRepeatRange && (lastWorkspaceRangeNoticeTexts.has(text) || text.includes(comparisonStartPrefix))) {
                    return false;
                }
                return true;
            });
            if (nextRangeFingerprint) {
                lastWorkspaceRangeNoticeFingerprint = nextRangeFingerprint;
                lastWorkspaceRangeNoticeTexts = nextRangeNoticeTexts;
            } else {
                lastWorkspaceRangeNoticeTexts = new Set();
            }
            if (!bannersToRender.length) {
                return;
            }
            const anchor = pageRoot.querySelector(".app-shell");
            bannersToRender.forEach((banner) => {
                const clonedBanner = banner.cloneNode(true);
                if (anchor) {
                    pageRoot.insertBefore(clonedBanner, anchor);
                } else {
                    pageRoot.prepend(clonedBanner);
                }
            });
        };

        const clearWorkspacePendingState = (workspacePanel = document.getElementById("workspace_panel")) => {
            if (!(workspacePanel instanceof HTMLElement)) return;
            workspacePanel.querySelectorAll(".is-masked-during-switch").forEach((node) => {
                node.classList.remove("is-masked-during-switch");
            });
            delete workspacePanel.dataset.workspacePending;
            const preserveNavigationBusy = document.body.classList.contains("is-page-navigating")
                && workspacePanel.dataset.navigationSkeleton === "1";
            if (!preserveNavigationBusy) {
                workspacePanel.removeAttribute("aria-busy");
                document.body.classList.remove("is-workspace-switching");
            }
        };

        const applyWorkspacePendingState = () => {
            if (document.body.classList.contains("is-page-navigating")) return;
            const workspacePanel = document.getElementById("workspace_panel");
            if (!(workspacePanel instanceof HTMLElement)) return;
            workspacePanel.querySelectorAll(".is-masked-during-switch").forEach((node) => {
                node.classList.remove("is-masked-during-switch");
            });
            const manifest = getProgressiveManifest?.(state.currentView) || {masks: []};
            (manifest.masks || []).forEach((selector) => {
                workspacePanel.querySelectorAll(selector).forEach((node) => {
                    node.classList.add("is-masked-during-switch");
                });
            });
            document.body.classList.add("is-workspace-switching");
            workspacePanel.dataset.workspacePending = "1";
            workspacePanel.setAttribute("aria-busy", "true");
        };

        const applyComparePendingState = () => applyWorkspacePendingState();

        const applyPortfolioPendingState = () => applyWorkspacePendingState();

        const applyBacktestPendingState = () => {
            bootstrap.setBacktestLoadState?.("loading");
            applyWorkspacePendingState();
        };

        bootstrap.applyWorkspacePendingState = applyWorkspacePendingState;
        bootstrap.clearWorkspacePendingState = clearWorkspacePendingState;
        bootstrap.applyComparePendingState = applyWorkspacePendingState;

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

        const hydratePriceComparisonWorkspace = (workspacePanel, nextWorkspacePanel) => {
            const currentShell = workspacePanel.querySelector(".price-compare-workspace");
            const nextShell = nextWorkspacePanel.querySelector(".price-compare-workspace");
            if (!(currentShell instanceof HTMLElement) || !(nextShell instanceof HTMLElement)) {
                hydrateWorkspaceModeMain(workspacePanel, nextWorkspacePanel);
                return;
            }

            currentShell.className = nextShell.className;
            currentShell.setAttribute(
                "aria-labelledby",
                nextShell.getAttribute("aria-labelledby") || "ticker_comparison_heading",
            );

            const currentTitleCard = currentShell.querySelector(".workspace-mode-title-card");
            const nextTitleCard = nextShell.querySelector(".workspace-mode-title-card");
            if (currentTitleCard && nextTitleCard) {
                replaceDomRegion(currentTitleCard, nextTitleCard);
            }

            const currentControls = currentShell.querySelector(".workspace-mode-controls-surface");
            const nextControls = nextShell.querySelector(".workspace-mode-controls-surface");
            if (currentControls && nextControls) {
                currentControls.setAttribute(
                    "aria-labelledby",
                    nextControls.getAttribute("aria-labelledby") || "ticker_comparison_heading",
                );
            }

            const nextMetricInput = nextShell.querySelector("[data-comparison-metric-input]:checked");
            const nextMetric = normalizeComparisonMetric(nextMetricInput?.value);
            const currentMetricShell = currentShell.querySelector("[data-comparison-metric-switch]");
            if (currentMetricShell instanceof HTMLElement) {
                const currentMetricInputs = Array.from(
                    currentMetricShell.querySelectorAll("[data-comparison-metric-input]"),
                );
                currentMetricInputs.forEach((input) => {
                    if (input instanceof HTMLInputElement) {
                        input.checked = normalizeComparisonMetric(input.value) === nextMetric;
                    }
                });
                syncSegmentedControlLayout(currentMetricShell, {
                    activeValue: nextMetric,
                    activeIndex: nextMetric === "market-cap" ? 1 : 0,
                });
            }

            const currentChipsField = currentShell.querySelector("[data-chips-field]");
            const nextChipsField = nextShell.querySelector("[data-chips-field]");
            if (currentChipsField instanceof HTMLElement && nextChipsField instanceof HTMLElement) {
                currentChipsField.hidden = nextChipsField.hidden;
                const currentChipsInput = currentChipsField.querySelector("[data-chips-input]");
                const nextChipsInput = nextChipsField.querySelector("[data-chips-input]");
                if (currentChipsInput instanceof HTMLInputElement && nextChipsInput instanceof HTMLInputElement) {
                    currentChipsInput.checked = nextChipsInput.checked;
                    currentChipsInput.disabled = nextChipsInput.disabled;
                }
            }

            hydrateWorkspaceModeMain(workspacePanel, nextWorkspacePanel);
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
            if (state.currentView === "prices") {
                applyWorkspacePendingState();
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
            const stateNode = doc.getElementById("worthward_state");
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
            if (!nextState || !["tickers", "prices", "portfolio"].includes(nextState.currentView)) return nextState;
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

        const isWorkspaceHydrationObsolete = (controller, token) => (
            controller.signal.aborted
            || token !== workspaceHydrationToken
            || document.body.classList.contains("is-page-navigating")
        );

        const hydrateWorkspaceFromUrl = async (nextUrl) => {
            if (document.body.classList.contains("is-page-navigating")) return false;
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
                if (isWorkspaceHydrationObsolete(controller, token)) return false;
                throw error;
            }
            reportFetchAbortDebug("B", "app.js:hydrateWorkspaceFromUrl", "workspace hydration response received", {
                nextUrl,
                token,
                status: response.status,
                aborted: controller.signal.aborted,
            });
            if (isWorkspaceHydrationObsolete(controller, token)) return false;
            if (!response.ok) throw new Error(`Workspace refresh failed: ${response.status}`);
            const html = await response.text();
            if (isWorkspaceHydrationObsolete(controller, token)) return false;
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, "text/html");
            const nextWorkspacePanel = doc.getElementById("workspace_panel");
            const workspacePanel = document.getElementById("workspace_panel");
            if (!nextWorkspacePanel || !workspacePanel) throw new Error("Workspace panel missing from response.");
            syncGlobalNoticeBanners(doc, nextUrl);
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
            } else if (state.currentView === "backtest") {
                hydrateWorkspaceModeMain(workspacePanel, nextWorkspacePanel);
            } else if (state.currentView === "prices") {
                hydratePriceComparisonWorkspace(workspacePanel, nextWorkspacePanel);
            } else if (state.currentView === "dca") {
                hydrateWorkspaceModeMain(workspacePanel, nextWorkspacePanel);
            } else {
                workspacePanel.innerHTML = nextWorkspacePanel.innerHTML;
            }
            clearWorkspacePendingState(workspacePanel);
            const nextState = mergeKnownTickerProfilesIntoState(parseStateFromHtmlDocument(doc));
            if (nextState) {
                window.WORTHWARD_APP = nextState;
                Object.assign(state, nextState);
                if (state.currentView === "prices") {
                    const nextMaxTickers = Number.parseInt(nextState.constraints?.maxTickers, 10);
                    runtimeState.maxTickers = Number.isFinite(nextMaxTickers)
                        ? Math.max(MIN_TICKERS, nextMaxTickers)
                        : PRICE_COMPARISON_MAX_TICKERS;
                    updateAddButtonState();
                }
            }
            document.title = doc.title || document.title;
            window.history.replaceState({}, "", nextUrl);
            bootstrap.syncCompareLiveRefresh?.();
            initializeWorkspaceEnhancements();
            scheduleDockPosition();
            scheduleMobilePageBottomPaddingSync();
            if (activeWorkspaceHydration === controller) activeWorkspaceHydration = null;
            return true;
        };

        const readViewMemory = () => {
            try {
                const raw = preferenceStorage.session.getItem(VIEW_MEMORY_KEY);
                if (!raw) return {};
                const parsed = JSON.parse(raw);
                return parsed && typeof parsed === "object" ? parsed : {};
            } catch (_error) {
                return {};
            }
        };

        const writeViewMemory = (nextMemory) => {
            try {
                preferenceStorage.session.setItem(VIEW_MEMORY_KEY, JSON.stringify(nextMemory));
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
            if (!state.currentView || state.currentView === "beta") return;
            const memory = readViewMemory();
            const sanitizedUrl = sanitizeRememberedUrl(url);
            memory[state.currentView] = sanitizedUrl;
            if (WORKSPACE_VIEWS.has(state.currentView)) {
                memory.workspace = sanitizedUrl;
            }
            writeViewMemory(memory);
        };

        const resolveWorkspaceModeMemoryUrl = (link, fallbackUrl) => {
            if (!(link instanceof HTMLAnchorElement) || !link.closest(".workspace-mode-nav")) {
                return fallbackUrl;
            }
            const targetView = resolveViewFromUrl(fallbackUrl);
            const comparisonViews = new Set(["tickers", "prices"]);
            if (!comparisonViews.has(state.currentView) || !comparisonViews.has(targetView)) {
                return fallbackUrl;
            }
            const rememberedUrl = readViewMemory()[targetView];
            if (rememberedUrl && resolveViewFromUrl(rememberedUrl) === targetView) {
                return rememberedUrl;
            }
            try {
                const target = new URL(fallbackUrl, window.location.origin);
                const current = new URL(window.location.href);
                target.search = current.search;
                target.hash = "";
                return sanitizeRememberedUrl(`${target.pathname}${target.search}`);
            } catch (_error) {
                return fallbackUrl;
            }
        };

        const attachDockMemory = () => {
            $$(".sidebar-dock-item").forEach((link) => {
                const targetDockGroup = link.dataset.dockGroup || resolveDockGroupFromView(resolveViewFromUrl(link.href));
                if (targetDockGroup === "beta") return;
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
            if (
                state.currentView === "settings"
                && link.matches(".settings-nav-item, [data-settings-section-link]")
            ) return false;
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
                const fallbackUrl = link.getAttribute("href") || "";
                rememberCurrentViewUrl();
                const nextUrl = resolveWorkspaceModeMemoryUrl(link, fallbackUrl);
                const normalizedNextUrl = normalizeNavigationUrl(nextUrl);
                if (!normalizedNextUrl) return;
                event.preventDefault();
                beginOptimisticPageNavigation(normalizedNextUrl, {link});
            });
        };


        return Object.freeze({
            abortActiveWorkspaceHydration,
            activeWorkspaceHydration,
            applyBacktestPendingState,
            applyComparePendingState,
            applyPendingWorkspaceMarkup,
            applyPortfolioPendingState,
            applyWorkspacePendingState,
            attachDockMemory,
            attachOptimisticInternalNavigation,
            buildPendingWorkspaceMarkup,
            buildWorkspaceRangeNoticeFingerprint,
            collectKnownTickerProfileMap,
            clearWorkspacePendingState,
            hydratePriceComparisonWorkspace,
            hydrateWorkspaceFromUrl,
            hydrateWorkspaceModeMain,
            isWorkspaceHydrationObsolete,
            lastWorkspaceRangeNoticeFingerprint,
            lastWorkspaceRangeNoticeTexts,
            mergeKnownTickerProfilesIntoState,
            normalizeBannerText,
            parseStateFromHtmlDocument,
            readViewMemory,
            rememberCurrentViewUrl,
            removeTickerFromComparePreview,
            replaceDomRegion,
            resolveWorkspaceModeMemoryUrl,
            sanitizeRememberedUrl,
            shouldHandleOptimisticLinkClick,
            syncGlobalNoticeBanners,
            workspaceHydrationToken,
            writeViewMemory,
        });
    };

    window.WORTHWARD_APP_WORKSPACE_HYDRATION = Object.freeze({create});
})();
