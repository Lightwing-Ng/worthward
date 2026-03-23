/* Code version: v3.31.8 */
(() => {
	const state = window.ANTIGRAVITY_APP;
	if (!state) return;
	const bootstrap = window.ANTIGRAVITY_BOOTSTRAP = window.ANTIGRAVITY_BOOTSTRAP || {};

	const { defaults, labels, endpoints, constraints, theme } = state;
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
	const TRADE_DETAIL_MEMORY_KEY = "antigravity:trade-detail-tab";
	const hasInitialResult = isBacktestView
		? Boolean(state.backtestResult)
		: Boolean(state.chart?.series?.length);
	let autoSubmitTimer = null;
	let dockFrame = 0;
	let isSubmittingWithOverlay = false;
	let compareOverlayTimer = null;
	let activeWorkspaceHydration = null;
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
			about: { masks: [] },
			strategies: { masks: [] },
			"email-smtp": { masks: [] },
			network: {
				masks: [
					'[data-workspace-mask="settings-status-icon"]',
					'[data-workspace-mask="settings-status-text"]',
				],
				hydrate: () => hydrateNetworkStatuses(),
			},
			"local-market-store": {
				masks: [
					'[data-workspace-mask="local-store-date"]',
				],
				hydrate: () => hydrateLocalStoreRanges(),
			},
		},
	};

	const getProgressiveManifest = (view, section = null) => {
		if (view === "settings") {
			return progressiveViewRegistry.settings[section || "about"] || { masks: [] };
		}
		return progressiveViewRegistry[view] || { masks: [] };
	};

	const getProgressiveMaskSelectors = (view, section = null) => getProgressiveManifest(view, section).masks || [];

	const fetchJsonCached = async (cacheKey, url, { ttlMs = 30000 } = {}) => {
		const cached = progressiveResourceCache.get(cacheKey);
		const now = Date.now();
		if (cached && (now - cached.cachedAt) < ttlMs) return cached.value;
		const response = await fetch(url, { credentials: "same-origin" });
		if (!response.ok) throw new Error(`JSON fetch failed: ${response.status}`);
		const value = await response.json();
		progressiveResourceCache.set(cacheKey, { cachedAt: now, value });
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
		bootstrap.backtestRefreshTransition = {
			capturedAt: performance.now(),
			labels: [...chartState.dates],
			close: Array.isArray(chartState.close) ? [...chartState.close] : [],
			equity: Array.isArray(chartState.equity) ? [...chartState.equity] : [],
			initialCapital: Number(state.backtestResult.summary?.initial_capital || 0),
		};
	};

	const appShell = $(".app-shell");
	const sidebarToggle = $("#sidebar_toggle");
	const appSidebar = $("#app_sidebar");
	let isSidebarOpen = true;
	let isSidebarAnimating = false;

	const animateDock = () => {
		scheduleDockPosition();
		if (isSidebarAnimating) {
			requestAnimationFrame(animateDock);
		}
	};

	if (sidebarToggle && appSidebar && appShell) {
		appShell.classList.add("is-sidebar-open");
		appSidebar.setAttribute("aria-hidden", "false");
		if ("inert" in appSidebar) appSidebar.inert = false;
		sidebarToggle.addEventListener("click", () => {
			isSidebarOpen = !isSidebarOpen;
			sidebarToggle.setAttribute("aria-hidden", "false");
			sidebarToggle.setAttribute("aria-expanded", String(isSidebarOpen));
			appShell.classList.toggle("is-sidebar-open", isSidebarOpen);
			appShell.classList.toggle("is-sidebar-collapsed", !isSidebarOpen);
			appSidebar.hidden = false;
			appSidebar.style.display = "";
			appSidebar.setAttribute("aria-hidden", String(!isSidebarOpen));
			if ("inert" in appSidebar) appSidebar.inert = !isSidebarOpen;
			
			isSidebarAnimating = true;
			animateDock();
			setTimeout(() => { isSidebarAnimating = false; scheduleDockPosition(); }, 650);
		});
	}

	const timingLayoutRow = $("#timing_layout_row");
	const timingShell = $("#timing_shell");
	const timingListShell = $("#timing_list_shell");
	const timingListToggle = $("#timing_list_toggle");
	const timingToggleIcon = timingListToggle ? timingListToggle.querySelector(".icon-timing-toggle") : null;
	const timingSuggestionsPanel = $("#timing_suggestions_panel");
	if (timingListShell && timingListToggle && timingSuggestionsPanel) {
		let isTimingListOpen = true;
		timingSuggestionsPanel.setAttribute("aria-hidden", "false");
		if ("inert" in timingSuggestionsPanel) timingSuggestionsPanel.inert = false;
		const syncTimingListState = () => {
			timingListToggle.setAttribute("aria-expanded", String(isTimingListOpen));
			timingListShell.classList.toggle("is-open", isTimingListOpen);
			timingListShell.classList.toggle("is-collapsed", !isTimingListOpen);
			timingShell?.classList.toggle("is-list-collapsed", !isTimingListOpen);
			timingLayoutRow?.classList.toggle("is-list-collapsed", !isTimingListOpen);
			timingSuggestionsPanel.setAttribute("aria-hidden", String(!isTimingListOpen));
			if ("inert" in timingSuggestionsPanel) timingSuggestionsPanel.inert = !isTimingListOpen;
			if (timingToggleIcon) {
				timingToggleIcon.classList.toggle("icon-timing-toggle-right", isTimingListOpen);
				timingToggleIcon.classList.toggle("icon-timing-toggle-left", !isTimingListOpen);
			}
		};
		syncTimingListState();
		timingListToggle.addEventListener("click", () => {
			isTimingListOpen = !isTimingListOpen;
			syncTimingListState();
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

	const attachBrokerSettingsHandlers = () => {
		const brokerSelect = $("#selected_broker");
		if (!brokerSelect) return;
		brokerSelect.addEventListener("change", () => {
			const selected = brokerSelect.value;
			$$("[data-broker-fields]").forEach((el) => {
				el.hidden = el.dataset.brokerFields !== selected;
			});
		});
	};

	const attachStyleTokenResizer = () => {
		const shell = document.querySelector("[data-style-token-shell]");
		const handle = shell?.querySelector("[data-style-token-resizer]");
		if (!shell || !handle || handle.dataset.bound === "1") return;
		handle.dataset.bound = "1";
		const minWidth = 220;
		const clampWidth = (desiredWidth) => {
			const rect = shell.getBoundingClientRect();
			if (!rect.width) return null;
			const computed = getComputedStyle(shell);
			const columnGap = Number.parseFloat(computed.getPropertyValue("--style-token-column-gap")) || 24;
			const maxWidth = Math.max(minWidth, rect.width - columnGap - 280);
			return Math.min(Math.max(desiredWidth, minWidth), maxWidth);
		};
		const syncWidth = (clientX) => {
			const rect = shell.getBoundingClientRect();
			if (!rect.width) return;
			const computed = getComputedStyle(shell);
			const columnGap = Number.parseFloat(computed.getPropertyValue("--style-token-column-gap")) || 24;
			const nextWidth = clampWidth(clientX - rect.left - (columnGap / 2));
			if (!Number.isFinite(nextWidth)) return;
			shell.style.setProperty("--style-token-demo-width-current", `${nextWidth}px`);
		};
		const syncWidthToViewport = () => {
			const computed = getComputedStyle(shell);
			const currentWidth = Number.parseFloat(computed.getPropertyValue("--style-token-demo-width-current"))
				|| Number.parseFloat(computed.getPropertyValue("--style-token-demo-width"))
				|| minWidth;
			const nextWidth = clampWidth(currentWidth);
			if (!Number.isFinite(nextWidth)) return;
			shell.style.setProperty("--style-token-demo-width-current", `${nextWidth}px`);
		};
		const stopResize = () => {
			shell.classList.remove("is-resizing");
			window.removeEventListener("pointermove", onPointerMove);
			window.removeEventListener("pointerup", stopResize);
			window.removeEventListener("pointercancel", stopResize);
		};
		const onPointerMove = (event) => {
			syncWidth(event.clientX);
		};
		handle.addEventListener("pointerdown", (event) => {
			event.preventDefault();
			shell.classList.add("is-resizing");
			syncWidth(event.clientX);
			window.addEventListener("pointermove", onPointerMove);
			window.addEventListener("pointerup", stopResize);
			window.addEventListener("pointercancel", stopResize);
		});
		const syncHandleY = () => {
			const rect = shell.getBoundingClientRect();
			const visibleTop = Math.max(0, rect.top);
			const visibleBottom = Math.min(window.innerHeight, rect.bottom);
			const visibleCenterY = visibleTop + (visibleBottom - visibleTop) / 2;
			let targetY = visibleCenterY - rect.top;
			targetY = Math.max(16, targetY);
			shell.style.setProperty("--style-token-resizer-y", `${targetY}px`);
		};
		window.addEventListener("scroll", syncHandleY, { passive: true });
		window.addEventListener("resize", () => {
			syncWidthToViewport();
			syncHandleY();
		}, { passive: true });
		syncWidthToViewport();
		syncHandleY();
	};

	const attachStyleTokenControls = () => {
		const shell = document.querySelector("[data-style-token-shell]");
		if (!shell) return;
		let activeControl = null;
		const setActiveControl = (nextControl) => {
			if (activeControl instanceof HTMLElement && activeControl !== nextControl) {
				activeControl.classList.remove("is-editing");
			}
			activeControl = nextControl instanceof HTMLElement ? nextControl : null;
			if (activeControl instanceof HTMLElement) {
				activeControl.classList.add("is-editing");
			}
		};
		const controlsByToken = new Map();
		shell.querySelectorAll("[data-style-token-control]").forEach((control) => {
			if (!(control instanceof HTMLElement)) return;
			const tokenName = control.dataset.styleTokenName || "";
			if (!tokenName) return;
			if (!controlsByToken.has(tokenName)) controlsByToken.set(tokenName, []);
			controlsByToken.get(tokenName).push(control);
		});
		shell.querySelectorAll("[data-style-token-control]").forEach((control) => {
			if (!(control instanceof HTMLElement) || control.dataset.bound === "1") return;
			control.dataset.bound = "1";
			const tokenName = control.dataset.styleTokenName || "";
			const unit = control.dataset.styleTokenUnit || "";
			const minValue = Number.parseInt(control.dataset.styleTokenMin || "0", 10);
			const valueInput = control.querySelector(".style-token-value-input");
			const applyValue = (nextValue) => {
				if (!tokenName || !Number.isFinite(nextValue)) return;
				const safeValue = Math.max(Number.isFinite(minValue) ? minValue : 0, nextValue);
				shell.style.setProperty(tokenName, `${safeValue}${unit}`);
				(controlsByToken.get(tokenName) || []).forEach((peerControl) => {
					peerControl.dataset.styleTokenValue = String(safeValue);
					const peerValueText = peerControl.querySelector("[data-style-token-value-text]");
					if (peerValueText instanceof HTMLInputElement) {
						peerValueText.value = `${safeValue}${unit}`;
					} else if (peerValueText) {
						peerValueText.textContent = `${safeValue}${unit}`;
					}
				});
			};
			if (valueInput instanceof HTMLElement) {
				valueInput.addEventListener("click", () => {
					setActiveControl(control);
				});
				valueInput.addEventListener("focus", () => {
					setActiveControl(control);
				});
			}
			control.querySelectorAll("[data-style-token-stepper]").forEach((button) => {
				button.addEventListener("click", () => {
					setActiveControl(control);
					const direction = button.getAttribute("data-style-token-stepper") === "down" ? -1 : 1;
					const currentValue = Number.parseInt(control.dataset.styleTokenValue || "0", 10);
					applyValue(currentValue + direction);
				});
			});
		});
		document.addEventListener("pointerdown", (event) => {
			if (!(event.target instanceof Node)) return;
			if (activeControl instanceof HTMLElement && !activeControl.contains(event.target)) {
				activeControl.classList.remove("is-editing");
				activeControl = null;
			}
		});
	};

	const attachStyleTokenReferences = () => {
		const shell = document.querySelector("[data-style-token-shell]");
		if (!shell) return;
		const pulseTargetCard = (targetId) => {
			if (!targetId) return;
			const targetCard = shell.querySelector(`[data-style-token-card="${targetId}"]`);
			if (!(targetCard instanceof HTMLElement)) return;
			targetCard.classList.remove("is-linked-highlight");
			void targetCard.offsetWidth;
			targetCard.classList.add("is-linked-highlight");
			window.setTimeout(() => {
				targetCard.classList.remove("is-linked-highlight");
			}, 700);
		};
		shell.querySelectorAll("[data-style-token-reference]").forEach((reference) => {
			if (!(reference instanceof HTMLElement) || reference.dataset.bound === "1") return;
			reference.dataset.bound = "1";
			const targetId = reference.dataset.styleTokenReference || "";
			reference.addEventListener("pointerenter", () => {
				pulseTargetCard(targetId);
			});
			reference.addEventListener("focus", () => {
				pulseTargetCard(targetId);
			});
			reference.addEventListener("click", (event) => {
				event.preventDefault();
				pulseTargetCard(targetId);
			});
		});
	};

	const attachStyleTokenModeSwitches = () => {
		const shell = document.querySelector("[data-style-token-shell]");
		if (!shell) return;
		shell.querySelectorAll(".style-token-demo .range-mode-shell").forEach((switchShell) => {
			if (!(switchShell instanceof HTMLElement) || switchShell.dataset.bound === "1") return;
			switchShell.dataset.bound = "1";
			const syncActiveValue = () => {
				const checkedInput = switchShell.querySelector('input[type="radio"]:checked');
				const nextValue = checkedInput instanceof HTMLInputElement ? checkedInput.value : "period";
				switchShell.setAttribute("data-active", nextValue === "exact" ? "exact" : "period");
			};
			switchShell.querySelectorAll('input[type="radio"]').forEach((input) => {
				input.addEventListener("change", syncActiveValue);
			});
			syncActiveValue();
		});
	};

	const attachStyleTokenDemoInteractions = () => {
		const shell = document.querySelector("[data-style-token-shell]");
		if (!shell) return;
		shell.addEventListener("click", (event) => {
			if (!(event.target instanceof Node)) return;
			const dismissButton = event.target.closest(".dismiss-button");
			if (dismissButton) {
				const container = dismissButton.closest(".style-token-modal-demo");
				if (container) {
					container.style.display = "none";
					setTimeout(() => {
						container.style.display = "";
					}, 800);
				}
				return;
			}
			const actionButton = event.target.closest(".settings-action-package-form button");
			if (actionButton) {
				const controlContainer = document.querySelector('[data-style-token-name="--settings-action-button-background"]');
				if (controlContainer) {
					controlContainer.scrollIntoView({ behavior: "smooth", block: "center" });
					const input = controlContainer.querySelector('input');
					if (input) {
						setTimeout(() => input.focus(), 400);
					}
				}
				return;
			}
			const pageButton = event.target.closest(".local-store-page-button");
			if (pageButton && !pageButton.classList.contains("local-store-page-nav") && !pageButton.classList.contains("local-store-page-placeholder")) {
				const container = pageButton.closest(".local-store-pagination");
				if (container) {
					const buttons = Array.from(container.querySelectorAll(".local-store-page-button:not(.local-store-page-nav):not(.local-store-page-placeholder)"));
					const index = buttons.indexOf(pageButton);
					if (index !== -1) {
						buttons.forEach(b => b.classList.remove("is-active"));
						pageButton.classList.add("is-active");
						const indicator = container.querySelector(".local-store-pagination-indicator");
						if (indicator) {
							// Each side has 1 nav button, so index + 1 is the slot pos
							indicator.style.transform = `translate3d(calc(var(--local-store-pagination-slot-size) * ${index + 1}), 0, 0)`;
						}
					}
				}
				return;
			}
		});
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

	const initializeWorkspaceEnhancements = () => {
		attachNoticeHandlers();
		attachTradeDetailTabs();
		attachNetworkRefreshButton();
		attachStyleTokenResizer();
		attachStyleTokenControls();
		attachStyleTokenReferences();
		attachStyleTokenModeSwitches();
		attachStyleTokenDemoInteractions();
		attachBrokerSettingsHandlers();
		window.requestAnimationFrame(() => {
			window.ANTIGRAVITY_BOOTSTRAP?.initChartWorkspace?.();
			window.ANTIGRAVITY_BOOTSTRAP?.initPortfolioWorkspace?.();
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
				"Net return",
				"Final equity",
				"Max drawdown",
				"Win rate",
				"Closed trades",
				"Initial capital",
			];
			return `
				<div class="workspace-header">
					<article class="report-card trade-performance-card">
						<div class="report-heading-row"><p class="report-heading">${reportHeading}</p></div>
						<div class="trade-detail-tabs">
							<div class="range-mode-shell trade-detail-shell" data-active="metrics">
								<span class="segmented-control-option"><span>${labels.backtest_metrics_tab}</span></span>
								<span class="segmented-control-option"><span>${labels.backtest_transactions_tab}</span></span>
							</div>
							<div class="trade-detail-panel">
								<div class="trade-metrics-grid">
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
											${Array.from({ length: 4 }, (_, index) => `<tr><td class="trade-transactions-index">${index + 1}</td><td class="is-pending-value">0000</td><td class="is-pending-value">0000</td><td class="trade-transactions-number is-pending-value">0000</td><td class="trade-transactions-number is-pending-value">0000</td><td class="trade-transactions-number is-pending-value">0000</td><td class="trade-transactions-number is-pending-value">0000</td></tr>`).join("")}
										</tbody>
									</table>
								</div>
							</div>
						</div>
					</article>
				</div>
				<article class="chart-surface backtest-surface">
					<div class="chart-heading-row"><p class="chart-heading">${chartHeading}</p></div>
					<div class="trade-chart-stack">
						<div class="trade-chart-panel is-pending-value" data-workspace-mask="trade-chart"></div>
						<div class="trade-chart-panel trade-chart-panel-equity is-pending-value" data-workspace-mask="trade-chart"></div>
					</div>
				</article>
			`;
		}
		if (state.currentView === "portfolio") {
			return `
				<div class="workspace-header">
					<article class="report-card">
						<div class="report-heading-row"><p class="report-heading">${reportHeading}</p></div>
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
				</div>
				<div class="chart-surface">
					<div class="chart-heading-row"><p class="chart-heading">${chartHeading}</p></div>
					<div class="chart-wrap is-pending-value" data-workspace-mask="chart-area"></div>
				</div>
			`;
		}
		const itemCount = Math.max(currentValues.length, MIN_TICKERS);
		return `
			<div class="workspace-header">
				<article class="report-card">
					<div class="report-heading-row"><p class="report-heading">${reportHeading}</p></div>
					<div class="performance-grid" style="grid-template-columns: repeat(${itemCount}, minmax(0, 1fr));">
						${Array.from({ length: itemCount }, (_, index) => `<section class="performance-item is-pending-card"><div class="performance-accent"></div><div class="report-symbol-row"><p class="report-symbol">${currentValues[index] || "..."}</p></div><p class="report-company is-pending-value" data-workspace-mask="company-name">Loading</p><p class="report-value"><span class="is-pending-value" data-workspace-mask="compare-return">0000</span></p></section>`).join("")}
					</div>
				</article>
			</div>
			<div class="chart-surface"><div class="chart-heading-row"><p class="chart-heading">${chartHeading}</p></div><div class="chart-wrap is-pending-value" data-workspace-mask="chart-area"></div></div>
		`;
	};

	const replaceDomRegion = (currentRegion, nextRegion) => {
		if (!currentRegion || !nextRegion) return;
		currentRegion.replaceChildren(...Array.from(nextRegion.childNodes).map((node) => node.cloneNode(true)));
	};

	const applyComparePendingState = () => {
		const workspacePanel = document.getElementById("workspace_panel");
		if (!workspacePanel) return;
		delete workspacePanel.dataset.workspacePending;
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

	const collectKnownTickerLogoMap = () => {
		const logoMap = new Map();
		getTickerInputs().forEach((input) => {
			const ticker = sanitizeTicker(input.value || input.dataset.symbol || "");
			if (!ticker) return;
			const control = input.closest(".ticker-input-control");
			const image = control?.querySelector(".ticker-input-logo");
			const logoUrl = input.dataset.logoUrl || image?.getAttribute("src") || "";
			if (!logoUrl) return;
			logoMap.set(ticker, logoUrl);
		});
		(state.chart?.profiles || []).forEach((profile) => {
			const ticker = sanitizeTicker(profile?.ticker || "");
			const logoUrl = profile?.logo_url || "";
			if (!ticker || !logoUrl || logoMap.has(ticker)) return;
			logoMap.set(ticker, logoUrl);
		});
		return logoMap;
	};

	const mergeKnownTickerLogosIntoState = (nextState) => {
		if (!nextState || !["tickers", "portfolio"].includes(nextState.currentView)) return nextState;
		if (!Array.isArray(nextState.chart?.profiles) || !nextState.chart.profiles.length) return nextState;
		const logoMap = collectKnownTickerLogoMap();
		if (!logoMap.size) return nextState;
		nextState.chart.profiles = nextState.chart.profiles.map((profile) => {
			if (profile?.logo_url) return profile;
			const ticker = sanitizeTicker(profile?.ticker || "");
			const logoUrl = logoMap.get(ticker) || "";
			return logoUrl ? { ...profile, logo_url: logoUrl } : profile;
		});
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
			const currentSummaryRegion = document.getElementById("compare_summary_region");
			const nextSummaryRegion = doc.getElementById("compare_summary_region");
			const currentChartRegion = document.getElementById("compare_chart_region");
			const nextChartRegion = doc.getElementById("compare_chart_region");
			if (!currentChartRegion || !nextChartRegion || (Boolean(currentSummaryRegion) !== Boolean(nextSummaryRegion))) {
				workspacePanel.innerHTML = nextWorkspacePanel.innerHTML;
			} else {
				if (currentSummaryRegion && nextSummaryRegion) replaceDomRegion(currentSummaryRegion, nextSummaryRegion);
				replaceDomRegion(currentChartRegion, nextChartRegion);
				workspacePanel.querySelectorAll(".is-pending-value").forEach((node) => node.classList.remove("is-pending-value"));
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
		const nextState = mergeKnownTickerLogosIntoState(parseStateFromHtmlDocument(doc));
		if (nextState) {
			window.ANTIGRAVITY_APP = nextState;
			Object.assign(state, nextState);
		}
		document.title = doc.title || document.title;
		window.history.replaceState({}, "", nextUrl);
		initializeWorkspaceEnhancements();
		scheduleDockPosition();
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

	const rememberCurrentViewUrl = (url = window.location.pathname + window.location.search) => {
		if (!state.currentView) return;
		const memory = readViewMemory();
		memory[state.currentView] = url;
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
				const nextUrl = rememberedUrl || fallbackUrl;
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

	const validateTickerExistence = async (input, { preferFresh = false } = {}) => {
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
			const isKnown = payload.some((item) => String(item.symbol || "").toUpperCase() === value);
			if (input.dataset.validationTicker === value) {
				input.dataset.unknown = isKnown ? "" : "1";
				rememberValidatedTicker(input, value, isKnown);
				setTickerValidationPending(input, false);
				validateTickerInput(input);
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
		const results = await Promise.all(inputs.map((input) => validateTickerExistence(input, { preferFresh: false })));
		validateAllTickerInputs();
		return results.every((item, index) => {
			const input = inputs[index];
			if (!sanitizeTicker(input.value.trim())) return !input.required;
			return item && input.checkValidity() && input.dataset.unknown !== "1";
		});
	};

	const syncLocalStorePagination = (currentRegion, nextRegion) => {
		if (!(currentRegion instanceof HTMLElement) || !(nextRegion instanceof HTMLElement)) return;
		const currentPagination = currentRegion.querySelector("[data-local-store-pagination]");
		const nextPagination = nextRegion.querySelector("[data-local-store-pagination]");
		if (!(currentPagination instanceof HTMLElement) && !(nextPagination instanceof HTMLElement)) return;
		if (!(currentPagination instanceof HTMLElement) && nextPagination instanceof HTMLElement) {
			currentRegion.append(nextPagination.cloneNode(true));
			return;
		}
		if (currentPagination instanceof HTMLElement && !(nextPagination instanceof HTMLElement)) {
			currentPagination.remove();
			return;
		}
		if (!(currentPagination instanceof HTMLElement) || !(nextPagination instanceof HTMLElement)) return;
		currentPagination.setAttribute("aria-label", nextPagination.getAttribute("aria-label") || "Local market store pages");
		const indicator = currentPagination.querySelector(".local-store-pagination-indicator");
		Array.from(currentPagination.childNodes).forEach((node) => {
			if (node !== indicator) node.remove();
		});
		Array.from(nextPagination.childNodes).forEach((node) => {
			currentPagination.append(node.cloneNode(true));
		});
	};

	const syncLocalStoreRegion = (currentRegion, nextRegion) => {
		if (!(currentRegion instanceof HTMLElement) || !(nextRegion instanceof HTMLElement)) return;
		const currentSummary = currentRegion.querySelector(".settings-summary");
		const nextSummary = nextRegion.querySelector(".settings-summary");
		if (currentSummary instanceof HTMLElement && nextSummary instanceof HTMLElement) {
			currentSummary.replaceWith(nextSummary.cloneNode(true));
		}
		const currentTableWrap = currentRegion.querySelector(".local-store-table-wrap");
		const nextTableWrap = nextRegion.querySelector(".local-store-table-wrap");
		if (currentTableWrap instanceof HTMLElement && nextTableWrap instanceof HTMLElement) {
			currentTableWrap.replaceWith(nextTableWrap.cloneNode(true));
		}
		syncLocalStorePagination(currentRegion, nextRegion);
	};

	const replaceLocalStoreRegion = (nextRegion) => {
		const currentRegion = $("#local_store_region");
		if (!currentRegion || !nextRegion) return;
		const applyReplacement = () => {
			syncLocalStoreRegion(currentRegion, nextRegion);
		};
		if (canTransitionDom) {
			document.startViewTransition(applyReplacement);
			return;
		}
		applyReplacement();
	};

	const replaceSettingsWorkspaceRegion = (nextRegion) => {
		const currentRegion = $("#settings_workspace_region");
		if (!currentRegion || !nextRegion) return;
		const applyReplacement = () => {
			currentRegion.replaceWith(nextRegion);
		};
		if (canTransitionDom) {
			document.startViewTransition(applyReplacement);
			return;
		}
		applyReplacement();
	};

	const buildLocalStorePendingRegion = () => {
		const article = document.createElement("article");
		article.className = "chart-surface settings-surface";
		article.id = "settings_workspace_region";
		article.dataset.settingsWorkspaceRegion = "";
		article.dataset.settingsSection = "local-market-store";
		article.innerHTML = `
			<div class="chart-heading-row">
				<p class="chart-heading">${labels.local_market_store || "Local Market Store"}</p>
			</div>
			<div class="settings-body">
				<div class="local-store-layout" id="local_store_region" data-local-store-region>
					<section class="settings-callout-card settings-callout-card-primary local-store-maintain-card">
						<div class="settings-callout-copy">
							<span class="settings-nav-icon-shell settings-callout-icon-shell" aria-hidden="true"><span class="icon icon-store-maintain"></span></span>
							<div class="settings-callout-text">
								<p class="settings-service-name">${labels.local_store_maintain_title || "Maintain all data"}</p>
								<p class="settings-service-note">${labels.local_store_maintain_note || ""}</p>
							</div>
						</div>
						<span class="settings-inline-button settings-inline-button-primary is-pending" aria-hidden="true">${labels.local_store_maintain_button || "Maintain all data"}</span>
					</section>
					<p class="settings-summary">${labels.local_store_summary || ""}</p>
					<div class="settings-table-wrap local-store-table-wrap">
						<table class="settings-table local-store-table">
							<colgroup>
								<col class="local-store-col-symbol">
								<col class="local-store-col-name">
								<col class="local-store-col-range">
								<col class="local-store-col-update">
								<col class="local-store-col-delete">
							</colgroup>
							<thead>
								<tr>
									<th>${labels.local_store_symbol || "Ticker"}</th>
									<th>${labels.local_store_name || "Name"}</th>
									<th>${labels.local_store_range || "Range"}</th>
									<th>${labels.local_store_update || ""}</th>
									<th>${labels.local_store_delete || ""}</th>
								</tr>
							</thead>
							<tbody>
								${Array.from({ length: 6 }, (_, index) => `
									<tr data-local-store-ticker="pending-${index + 1}">
										<td>
											<span class="settings-symbol-cell">
												<span class="settings-table-logo settings-table-logo-placeholder" aria-hidden="true"></span>
												<span class="is-pending-value" data-workspace-mask="company-name">TICK</span>
											</span>
										</td>
										<td data-local-store-company class="is-pending-value" data-workspace-mask="company-name">Loading</td>
										<td class="local-store-range-cell">
											<span class="local-store-range-value">
												<span class="local-store-range-token is-pending-value" data-workspace-mask="local-store-date" data-local-store-range="start">0000/00/00</span>
												<span class="local-store-range-separator"> - </span>
												<span class="local-store-range-token is-pending-value" data-workspace-mask="local-store-date" data-local-store-range="end">0000/00/00</span>
											</span>
										</td>
										<td><span class="settings-action-button is-pending" aria-hidden="true"><span class="icon icon-store-refresh"></span></span></td>
										<td><span class="settings-action-button is-danger is-pending" aria-hidden="true"><span class="icon icon-store-delete"></span></span></td>
									</tr>
								`).join("")}
							</tbody>
						</table>
					</div>
				</div>
			</div>
		`;
		return article;
	};

	const setActiveSettingsNav = (targetSection) => {
		$$(".settings-nav-item").forEach((link) => {
			const isTarget = link.getAttribute("href")?.includes(`/settings/${targetSection}`);
			link.classList.toggle("is-active", Boolean(isTarget));
			if (isTarget) {
				link.setAttribute("aria-current", "page");
			} else {
				link.removeAttribute("aria-current");
			}
		});
	};

	const attachSettingsSectionNavigation = () => {
		document.addEventListener("click", async (event) => {
			const link = event.target.closest(".settings-nav-item");
			if (!link || state.currentView !== "settings") return;
			const nextUrl = link.href;
			if (!nextUrl) return;
			const parsed = new URL(nextUrl, window.location.origin);
			const targetSection = parsed.pathname.split("/")[2] || "about";
			if (targetSection === state.settingsSection && parsed.search === window.location.search) return;
			event.preventDefault();
			setActiveSettingsNav(targetSection);
			if (targetSection === "local-market-store") {
				replaceSettingsWorkspaceRegion(buildLocalStorePendingRegion());
			}
			try {
				const responseText = await fetch(nextUrl, {
					credentials: "same-origin",
					headers: { "X-Requested-With": "settings-prefetch" },
					cache: targetSection === "local-market-store" ? "no-store" : "force-cache",
				}).then(async (response) => {
					if (!response.ok) throw new Error(`Settings prefetch failed: ${response.status}`);
					return response.text();
				});
				const parser = new DOMParser();
				const nextDocument = parser.parseFromString(responseText, "text/html");
				const nextRegion = nextDocument.querySelector("#settings_workspace_region");
				if (!nextRegion) throw new Error("Settings workspace region missing.");
				replaceSettingsWorkspaceRegion(nextRegion);
				window.history.pushState({ settingsSection: targetSection }, "", nextUrl);
				state.settingsSection = targetSection;
				rememberCurrentViewUrl(nextUrl);
				document.querySelectorAll(".is-masked-during-switch").forEach((node) => {
					node.classList.remove("is-masked-during-switch");
				});
				const manifest = getProgressiveManifest("settings", targetSection);
				(manifest.masks || []).forEach((selector) => {
					document.querySelectorAll(selector).forEach((node) => {
						node.classList.add("is-masked-during-switch");
					});
				});
				if (typeof manifest.hydrate === "function") {
					void manifest.hydrate();
				}
			} catch (_error) {
				window.location.assign(nextUrl);
			}
		});

		window.addEventListener("popstate", async () => {
			if (state.currentView !== "settings") return;
			const section = window.location.pathname.split("/")[2] || "about";
			setActiveSettingsNav(section);
			state.settingsSection = section;
			try {
				const responseText = await fetch(window.location.pathname + window.location.search, {
					credentials: "same-origin",
					headers: { "X-Requested-With": "settings-popstate" },
					cache: "force-cache",
				}).then(async (response) => {
					if (!response.ok) throw new Error(`Settings popstate failed: ${response.status}`);
					return response.text();
				});
				const parser = new DOMParser();
				const nextDocument = parser.parseFromString(responseText, "text/html");
				const nextRegion = nextDocument.querySelector("#settings_workspace_region");
				if (nextRegion) replaceSettingsWorkspaceRegion(nextRegion);
				const manifest = getProgressiveManifest("settings", section);
				if (typeof manifest.hydrate === "function") {
					void manifest.hydrate();
				}
			} catch (_error) {
				window.location.assign(window.location.pathname + window.location.search);
			}
		});
	};

	const hydrateLocalStoreRanges = async () => {
		if (state.currentView !== "settings" || state.settingsSection !== "local-market-store") return;
		const region = $("#local_store_region");
		if (!region) return;
		const rows = Array.from(region.querySelectorAll("[data-local-store-ticker]"));
		if (!rows.length) return;
		const hasPendingDateToken = rows.some((row) => row.querySelector('[data-workspace-mask="local-store-date"].is-pending-value'));
		if (!hasPendingDateToken) return;
		const page = new URLSearchParams(window.location.search).get("page") || "1";
		try {
			const payload = await fetchJsonCached(
				`local-store:${page}`,
				`${endpoints.localStorePageData}?page=${encodeURIComponent(page)}`,
				{ ttlMs: 0 },
			);
			(payload.rows || []).forEach((item) => {
				const row = region.querySelector(`[data-local-store-ticker="${CSS.escape(item.ticker || "")}"]`);
				if (!row) return;
				const startNode = row.querySelector('[data-local-store-range="start"]');
				const endNode = row.querySelector('[data-local-store-range="end"]');
				const companyNode = row.querySelector("[data-local-store-company]");
				if (companyNode && !companyNode.textContent.trim() && item.company_name) {
					companyNode.textContent = item.company_name;
				}
				if (startNode) {
					startNode.textContent = item.range_start || "";
					startNode.classList.toggle("is-pending-value", !item.range_start);
				}
				if (endNode) {
					endNode.textContent = item.range_end || "";
					endNode.classList.toggle("is-pending-value", !item.range_end);
				}
			});
		} catch (_error) {
		}
	};

	const setNetworkStatusesPending = () => {
		document.querySelectorAll("[data-settings-service-row]").forEach((row) => {
			const statusNode = row.querySelector("[data-settings-service-status]");
			const noteNode = row.querySelector("[data-settings-service-note]");
			const iconNode = row.querySelector("[data-settings-service-icon]");
			const stateNode = row.querySelector(".settings-service-state");
			if (statusNode) statusNode.textContent = "Checking...";
			if (iconNode) {
				iconNode.classList.remove("is-visible");
				iconNode.classList.add("is-pending-status");
			}
			if (stateNode) stateNode.classList.add("is-muted");
			if (noteNode instanceof HTMLElement) {
				const pendingNote = noteNode.dataset.pendingNote || "";
				if (pendingNote) noteNode.textContent = pendingNote;
			}
		});
	};

	const hydrateNetworkStatuses = async ({ force = false } = {}) => {
		if (state.currentView !== "settings" || state.settingsSection !== "network") return;
		try {
			if (force) progressiveResourceCache.delete("settings-network-status");
			const payload = await fetchJsonCached(
				"settings-network-status",
				force ? `${endpoints.settingsNetworkStatus}?refresh=1` : endpoints.settingsNetworkStatus,
				{ ttlMs: force ? 0 : 45000 },
			);
			(payload.rows || []).forEach((item) => {
				const row = document.querySelector(`[data-settings-service-row][data-service-key="${CSS.escape(item.key || "")}"]`);
				if (!row) return;
				const statusNode = row.querySelector("[data-settings-service-status]");
				const noteNode = row.querySelector("[data-settings-service-note]");
				const iconNode = row.querySelector("[data-settings-service-icon]");
				const stateNode = row.querySelector(".settings-service-state");
				if (statusNode) statusNode.textContent = item.status || "";
				if (noteNode) noteNode.textContent = item.note || "";
				if (stateNode) stateNode.classList.toggle("is-muted", !item.is_available);
				if (iconNode) {
					iconNode.classList.remove("is-pending-status");
					iconNode.classList.toggle("is-visible", Boolean(item.is_available));
				}
			});
		} catch (_error) {
		}
	};

	const attachNetworkRefreshButton = () => {
		const button = document.querySelector("[data-network-refresh-button]");
		if (!(button instanceof HTMLButtonElement) || button.dataset.bound === "1") return;
		button.dataset.bound = "1";
		button.addEventListener("click", async () => {
			setNetworkStatusesPending();
			button.disabled = true;
			button.classList.add("is-pending");
			button.setAttribute("aria-busy", "true");
			try {
				await hydrateNetworkStatuses({ force: true });
			} finally {
				button.disabled = false;
				button.classList.remove("is-pending");
				button.removeAttribute("aria-busy");
			}
		});
	};

	const fetchLocalStorePage = async (url, { pushHistory = true } = {}) => {
		const response = await fetch(url, {
			headers: {
				"X-Requested-With": "fetch",
			},
			credentials: "same-origin",
			cache: "no-store",
		});
		if (!response.ok) throw new Error(`Local store page fetch failed: ${response.status}`);
		const html = await response.text();
		const parser = new DOMParser();
		const nextDocument = parser.parseFromString(html, "text/html");
		const nextRegion = nextDocument.querySelector("#local_store_region");
		if (!nextRegion) throw new Error("Local store region missing from response.");
		replaceLocalStoreRegion(nextRegion);
		if (pushHistory) window.history.pushState({ localStore: true }, "", url);
		rememberCurrentViewUrl(url);
		void hydrateLocalStoreRanges();
		const targetPage = new URL(url, window.location.origin).searchParams.get("page") || "1";
		syncLocalStorePaginationActivePage(targetPage);
	};

	let localStorePaginationRequest = null;
	const ensureLocalStorePaginationIndicator = (pagination) => {
		if (!(pagination instanceof HTMLElement)) return null;
		let indicator = pagination.querySelector(".local-store-pagination-indicator");
		if (!(indicator instanceof HTMLElement)) {
			indicator = document.createElement("span");
			indicator.className = "local-store-pagination-indicator";
			indicator.setAttribute("aria-hidden", "true");
			pagination.prepend(indicator);
		}
		return indicator;
	};
	const positionLocalStorePaginationIndicator = (pagination, target, { immediate = false } = {}) => {
		if (!(pagination instanceof HTMLElement) || !(target instanceof HTMLElement)) return;
		const indicator = ensureLocalStorePaginationIndicator(pagination);
		if (!(indicator instanceof HTMLElement)) return;
		const navRect = pagination.getBoundingClientRect();
		const targetRect = target.getBoundingClientRect();
		const x = targetRect.left - navRect.left;
		const y = targetRect.top - navRect.top;
		if (immediate) indicator.style.transition = "none";
		indicator.style.width = `${targetRect.width}px`;
		indicator.style.height = `${targetRect.height}px`;
		indicator.style.transform = `translate3d(${x}px, ${y}px, 0)`;
		pagination.classList.add("is-animated");
		if (immediate) {
			void indicator.offsetWidth;
			indicator.style.removeProperty("transition");
		}
	};
	const initLocalStorePaginationPhysics = () => {
		const pagination = document.querySelector("[data-local-store-pagination]");
		if (!(pagination instanceof HTMLElement)) return;
		const active = pagination.querySelector(".local-store-page-button.is-active");
		if (!(active instanceof HTMLElement)) return;
		pagination.classList.remove("is-animating");
		pagination.classList.add("is-animated");
		positionLocalStorePaginationIndicator(pagination, active, { immediate: true });
		pagination.querySelectorAll(".local-store-page-button[data-pagination-target]").forEach((button) => {
			if (button instanceof HTMLElement) button.dataset.paginationCurrent = button.classList.contains("is-active") ? "1" : "0";
		});
	};
	const syncLocalStorePaginationActivePage = (pageValue) => {
		const pagination = document.querySelector("[data-local-store-pagination]");
		if (!(pagination instanceof HTMLElement)) return;
		const page = String(pageValue || "1");
		const buttons = Array.from(pagination.querySelectorAll(".local-store-page-button"));
		const target = buttons.find((button) => {
			if (!(button instanceof HTMLElement)) return false;
			if (button.classList.contains("local-store-page-nav") || button.classList.contains("local-store-page-placeholder")) return false;
			return button.textContent?.trim() === page;
		});
		if (!(target instanceof HTMLElement)) {
			window.requestAnimationFrame(() => initLocalStorePaginationPhysics());
			return;
		}
		buttons.forEach((button) => {
			if (!(button instanceof HTMLElement)) return;
			const isTarget = button === target;
			button.classList.toggle("is-active", isTarget);
			button.dataset.paginationCurrent = isTarget ? "1" : "0";
		});
		pagination.classList.remove("is-animating");
		pagination.classList.add("is-animated");
		window.requestAnimationFrame(() => {
			positionLocalStorePaginationIndicator(pagination, target, { immediate: true });
		});
	};
	const animateLocalStorePaginationTo = (link) => new Promise((resolve) => {
		const pagination = link.closest("[data-local-store-pagination]");
		if (!(pagination instanceof HTMLElement) || !(link instanceof HTMLElement)) {
			resolve();
			return;
		}
		const current = pagination.querySelector(".local-store-page-button.is-active") || pagination.querySelector(".local-store-page-button[data-pagination-current='1']");
		if (!(current instanceof HTMLElement)) {
			positionLocalStorePaginationIndicator(pagination, link, { immediate: true });
			resolve();
			return;
		}
		pagination.classList.add("is-animated", "is-animating");
		current.dataset.paginationCurrent = "0";
		link.dataset.paginationCurrent = "1";
		positionLocalStorePaginationIndicator(pagination, current, { immediate: true });
		window.setTimeout(() => {
			positionLocalStorePaginationIndicator(pagination, link);
		}, 72);
		window.setTimeout(() => {
			pagination.classList.remove("is-animating");
			resolve();
		}, 430);
	});

	const attachLocalStorePagination = () => {
		initLocalStorePaginationPhysics();
		document.addEventListener("click", (event) => {
			const link = event.target.closest(".local-store-pagination a");
			if (!link) return;
			if (!window.location.pathname.startsWith("/settings/local-market-store")) return;
			const targetUrl = link.href;
			if (!targetUrl) return;
			event.preventDefault();
			if (localStorePaginationRequest) return;
			localStorePaginationRequest = (async () => {
				try {
					await animateLocalStorePaginationTo(link);
					await fetchLocalStorePage(targetUrl);
				} catch {
					window.location.assign(targetUrl);
				} finally {
					localStorePaginationRequest = null;
				}
			})();
		});

		window.addEventListener("popstate", () => {
			if (!window.location.pathname.startsWith("/settings/local-market-store")) return;
			fetchLocalStorePage(window.location.pathname + window.location.search, { pushHistory: false }).catch(() => {
			});
		});
	};

	const syncTickerClearButton = (input) => {
		const clearButton = input?.parentElement?.querySelector(".ticker-clear");
		if (!clearButton || !input) return;
		clearButton.classList.toggle("is-visible", Boolean(input.value.trim()));
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
		if (logo) {
			if (logoUrl) {
				logo.src = logoUrl;
				logo.alt = `${tickerValue} logo`;
				logo.hidden = false;
			} else {
				logo.removeAttribute("src");
				logo.alt = "";
				logo.hidden = true;
			}
		}
		if (placeholder) placeholder.hidden = Boolean(logoUrl);
		if (suggestion) {
			input.dataset.logoUrl = suggestion.logo_url || "";
			input.dataset.symbol = suggestion.symbol || "";
		}
		if (!hasTickerLikeValue) {
			input.dataset.logoUrl = "";
			input.dataset.symbol = "";
		}
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
		getWeightFields().forEach(({ tickerInput, number, slider }) => {
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
		return Array.from({ length: count }, (_item, index) => base + (index < remainder ? 1 : 0));
	};

	const getFilledWeightEntries = () => getWeightFields()
		.map((item, index) => ({ ...item, index, ticker: sanitizeTicker(item.tickerInput.value.trim()) }))
		.filter((item) => item.ticker);

	const syncPortfolioWeightPair = (entry, value) => {
		const normalized = Math.min(100, Math.max(0, Number.parseInt(String(value || 0), 10) || 0));
		entry.number.value = String(normalized);
		entry.slider.value = String(normalized);
	};

	const resolvePassivePortfolioEntry = (changedIndex, filledEntries) => {
		const candidates = filledEntries.filter((entry) => entry.index !== changedIndex);
		if (!candidates.length) return null;
		return candidates.reduce((oldestEntry, entry) => {
			const oldestStamp = getPortfolioWeightTouchStamp(oldestEntry.index);
			const entryStamp = getPortfolioWeightTouchStamp(entry.index);
			if (entryStamp < oldestStamp) return entry;
			if (entryStamp === oldestStamp && entry.index > oldestEntry.index) return entry;
			return oldestEntry;
		});
	};

	const computeActiveWeightBounds = (changedIndex, filledEntries) => {
		const passiveEntry = resolvePassivePortfolioEntry(changedIndex, filledEntries);
		if (!passiveEntry) {
			return { min: 100, max: 100, passiveEntry: null };
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
				`${passiveEntry.ticker} was the oldest editable weight available, so ${activeEntry.ticker} was limited to keep the total at 100%.`,
			);
		}
		markPortfolioWeightTouched(changedIndex);
		syncPortfolioWeightBounds();
	};

	const rebalancePortfolioWeightsAfterRemoval = (removedWeight = 0) => {
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
		const passiveEntry = filledEntries.reduce((oldestEntry, entry) => {
			const oldestStamp = getPortfolioWeightTouchStamp(oldestEntry.index);
			const entryStamp = getPortfolioWeightTouchStamp(entry.index);
			if (entryStamp < oldestStamp) return entry;
			if (entryStamp === oldestStamp && entry.index > oldestEntry.index) return entry;
			return oldestEntry;
		});
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
			const { tickerInput, number } = entry;
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

	const attachPortfolioWeightHandlers = () => {
		if (!isPortfolioView) return;
		getWeightFields().forEach(({ field, number, slider, tickerInput, index }) => {
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
				if (ticker && !getPortfolioWeightTouchStamp(index)) {
					markPortfolioWeightTouched(index);
				}
				if (!ticker) {
					dropPortfolioWeightTouch(index);
				}
				if (getFilledWeightEntries().length && getFilledWeightEntries().every((entry) => (Number.parseInt(entry.number.value, 10) || 0) === 0)) {
					const defaults = buildDefaultWeights(getFilledWeightEntries().length);
					getFilledWeightEntries().forEach((entry, entryIndex) => syncPortfolioWeightPair(entry, defaults[entryIndex] || 0));
				}
				syncPortfolioWeightBounds();
				dispatchPortfolioPreviewUpdate();
				validatePortfolioWeightInputs();
				tickerInput.dataset.lastTicker = ticker;
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
			input.focus({ preventScroll: true });
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
		input.scrollIntoView({ block: "nearest", inline: "nearest" });
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
				if (index === activeIndex) button.scrollIntoView({ block: "nearest" });
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
			restoreRetainedPortfolioWeight(input);
			syncTickerInputDecoration(input, item);
			validateAllTickerInputs();
			closePanel();
			input.focus();
			syncDateConstraints();
			if (isBacktestView) syncBacktestIntervals();
			scheduleAutoSubmit(120);
		};

		const renderItems = (items) => {
			const panel = getPanel();
			if (!panel) return;
			if (!items.length) {
				closePanel();
				return;
			}
			if (!input.value.trim()) {
				setUnknown(false);
				return;
			}
			setUnknown(false);
			const groups = [
				{ key: "recent", title: "Recent" },
				{ key: "remote", title: "Matches" },
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
			if (!isBacktestView) clearWorkspaceChartTransitionRequest();
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
				const response = await fetch(`${endpoints.symbolSearch}?q=${encodeURIComponent(rawQuery)}`, { signal: controller.signal });
				if (!response.ok) return closePanel();
				const payload = await response.json();
				if (!payload.length) {
					setUnknown(true);
					closePanel();
					return;
				}
				const exactMatch = payload.some((item) => String(item.symbol || "").toUpperCase() === query);
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
			void validateTickerExistence(input, { preferFresh: true });
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
			if (!isBacktestView) clearWorkspaceChartTransitionRequest();
			validateAllTickerInputs();
			void validateTickerExistence(input, { preferFresh: true });
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
				syncDateConstraints();
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
				if (!isBacktestView) clearWorkspaceChartTransitionRequest();
				const field = button.closest(".ticker-field");
				const removedWeight = isPortfolioView
					? Number.parseInt(field?.querySelector(".portfolio-weight-input")?.value || "0", 10) || 0
					: 0;
				field?.remove();
				reindexTickerFields();
				if (isPortfolioView) {
					rebalancePortfolioWeightsAfterRemoval(removedWeight);
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
							<img class="ticker-input-logo" alt="">
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
	const displayDateFormatter = new Intl.DateTimeFormat("en-GB", {
		day: "numeric",
		month: "short",
		year: "numeric",
		timeZone: "UTC",
	});
	const monthDateFormatter = new Intl.DateTimeFormat("en-GB", {
		month: "long",
		year: "numeric",
		timeZone: "UTC",
	});

	const parseIsoDate = (rawValue) => {
		const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(rawValue || ""));
		if (!match) return null;
		return new Date(Date.UTC(Number.parseInt(match[1], 10), Number.parseInt(match[2], 10) - 1, Number.parseInt(match[3], 10)));
	};

	const formatIsoDate = (date) => {
		const year = date.getUTCFullYear();
		const month = String(date.getUTCMonth() + 1).padStart(2, "0");
		const day = String(date.getUTCDate()).padStart(2, "0");
		return `${year}-${month}-${day}`;
	};

	const formatDisplayDate = (rawValue) => {
		const date = parseIsoDate(rawValue);
		if (!date) return "Select date";
		return displayDateFormatter.format(date);
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
	const PERIOD_MONTH_SPANS = {
		"1mo": 1,
		"3mo": 3,
		"6mo": 6,
		"1y": 12,
		"2y": 24,
		"5y": 60,
		"10y": 120,
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
			.filter((value) => value && value !== "max" && PERIOD_MONTH_SPANS[value]);
		if (!nonMaxOptions.length) return periodSelect.value || null;

		const candidates = nonMaxOptions.map((value) => {
			const months = PERIOD_MONTH_SPANS[value];
			const candidateStart = shiftMonthsUtc(maxDate, -months);
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

		return candidates[0]?.value || periodSelect.value || null;
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
			rangeShell.style.setProperty("--range-shift", rangeMode === "exact" ? "100%" : "0%");
		}
		const isPeriodMode = rangeMode === "period";
		if (periodPanel) {
			periodPanel.hidden = !isPeriodMode;
			periodPanel.setAttribute("aria-hidden", String(!isPeriodMode));
			periodPanel.style.display = isPeriodMode ? "" : "none";
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

	const syncDatePickerView = (picker) => {
		picker.triggerValue.textContent = formatDisplayDate(picker.input.value);
		const selectedDate = parseIsoDate(picker.input.value);
		const minDate = parseIsoDate(picker.input.min);
		const maxDate = parseIsoDate(picker.input.max);
		const today = startOfMonthUtc(new Date());
		const anchorDate = clampDateToBounds(selectedDate || minDate || maxDate || today, minDate, maxDate);
		if (!picker.visibleMonth || picker.forceSyncMonth) {
			picker.visibleMonth = startOfMonthUtc(anchorDate);
			picker.forceSyncMonth = false;
		}
		picker.monthLabel.textContent = monthDateFormatter.format(picker.visibleMonth);
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
			const isTradingDay = !validTradingDateSet || validTradingDateSet.has(isoValue);
			const button = document.createElement("button");
			button.type = "button";
			button.className = "date-picker-day";
			if (!isCurrentMonth) button.classList.add("is-muted");
			if (isBeforeMin || isAfterMax || !isTradingDay) button.classList.add("is-disabled");
			if (selectedDate && isSameUtcDay(cellDate, selectedDate)) button.classList.add("is-selected");
			if (isSameUtcDay(cellDate, new Date())) button.classList.add("is-today");
			button.textContent = String(cellDate.getUTCDate());
			button.dataset.value = isoValue;
			button.disabled = Boolean(isBeforeMin || isAfterMax || !isTradingDay);
			button.addEventListener("click", () => {
				picker.input.value = isoValue;
				picker.forceSyncMonth = true;
				syncDatePickerView(picker);
				closeAllDatePickers();
				picker.input.dispatchEvent(new Event("change", { bubbles: true }));
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
			const monthLabel = wrapper.querySelector("[data-date-month]");
			const grid = wrapper.querySelector("[data-date-grid]");
			if (!input || !trigger || !triggerValue || !popover || !monthLabel || !grid) return;
			const picker = {
				wrapper,
				input,
				trigger,
				triggerValue,
				popover,
				monthLabel,
				grid,
				visibleMonth: null,
				forceSyncMonth: true,
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
			trigger.addEventListener("click", () => {
				const willOpen = popover.hidden;
				closeAllDatePickers();
				if (!willOpen) return;
				picker.forceSyncMonth = true;
				syncDatePickerView(picker);
				popover.hidden = false;
				trigger.setAttribute("aria-expanded", "true");
				positionDatePickerPopover(picker);
			});
			input.addEventListener("change", () => {
				picker.forceSyncMonth = true;
				syncDatePickerView(picker);
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
			const intervalSelect = $("#backtest_interval");
			const strategySelect = $("#trade_strategy");
			const capitalValue = parseTradeCapitalValue(tradeCapitalInput?.value);
			if (intervalSelect?.value) params.set("interval", intervalSelect.value);
			if (strategySelect?.value) params.set("strategy", strategySelect.value);
			if (Number.isFinite(capitalValue)) params.set("capital", String(capitalValue));
			collectStrategyParamEntries().forEach(([key, value]) => {
				if (key) params.set(key, value);
			});
		}

		const queryString = params.toString();
		return queryString ? `${window.location.pathname}?${queryString}` : window.location.pathname;
	};

	const syncBacktestIntervals = async () => {
		if (!isBacktestView) return;
		const tickerInput = getTickerInputs()[0];
		if (!tickerInput) return;
		const ticker = sanitizeTicker(tickerInput.value.trim());
		if (!ticker) return;

		try {
			const params = new URLSearchParams({ ticker });
			const response = await fetch(`${endpoints.marketStorePresence}?${params.toString()}`, { credentials: "same-origin" });
			if (!response.ok) return;
			const payload = await response.json();
			const has1m = payload.has1m && payload.has1m[ticker];
			
			const intervalSelect = document.getElementById("backtest_interval");
			if (intervalSelect) {
				const currentInterval = intervalSelect.value;
				const options = ["1d"];
				if (has1m) options.push("1m");
				
				// Keep current value if possible
				intervalSelect.innerHTML = "";
				// Order: 1d, 1m (if exists) or reverse? Let's use 1d, 1m.
				options.forEach(opt => {
					const el = document.createElement("option");
					el.value = opt;
					el.textContent = opt;
					if (opt === currentInterval) el.selected = true;
					intervalSelect.appendChild(el);
				});

				const nextInterval = intervalSelect.value;
				if (currentInterval === "1m" && !has1m) {
					intervalSelect.value = "1d";
					intervalSelect.dispatchEvent(new Event("change"));
				} else if (currentInterval !== nextInterval) {
					intervalSelect.dispatchEvent(new Event("change"));
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
		const params = new URLSearchParams({ view: state.currentView });
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
			refreshDatePickers();
		} catch (_error) {
		}
	};

	getTickerInputs().forEach((input) => setupAutocomplete(input));
	initializeDatePickers();
	initializeWorkspaceEnhancements();
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
	syncDateConstraints();
	scheduleDockPosition();

	$("#add_ticker")?.addEventListener("click", () => {
		if (!isBacktestView) clearWorkspaceChartTransitionRequest();
		addTickerField();
	});
	rangeModeInputs.forEach((input) => input.addEventListener("change", () => {
		const nextRangeMode = input.value;
		const previousRangeMode = lastRangeMode;
		if (previousRangeMode !== nextRangeMode) {
			if (nextRangeMode === "exact") {
				syncExactInputsToRenderedRange();
			} else if (nextRangeMode === "period") {
				const matchedPeriod = chooseRelativePeriodForExactRange();
				if (matchedPeriod && periodSelect) periodSelect.value = matchedPeriod;
			}
		}
		updateRangePanels();
		syncDateConstraints();
		lastRangeMode = nextRangeMode;
		if (!isBacktestView) requestWorkspaceChartTransition("range-mode");
		scheduleAutoSubmit();
	}));
	[exactStartInput, exactEndInput, includeDividendsInput].forEach((input) => {
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
		if (!isBacktestView) requestWorkspaceChartTransition("period");
		scheduleAutoSubmit();
	});
	$("#backtest_interval")?.addEventListener("change", (event) => {
		const interval = event.target.value;
		const periodSelect = document.getElementById("period");
		if (periodSelect) {
			const currentPeriod = periodSelect.value;
			const options1d = [
				{ value: "1mo", label: "1 month" },
				{ value: "3mo", label: "3 months" },
				{ value: "6mo", label: "6 months" },
				{ value: "1y", label: "1 year" },
				{ value: "2y", label: "2 years" },
				{ value: "3y", label: "3 years" },
				{ value: "5y", label: "5 years" },
				{ value: "10y", label: "10 years" },
				{ value: "max", label: "Max" }
			];
			const options1m = [
				{ value: "1w", label: "1 week" },
				{ value: "2w", label: "2 weeks" },
				{ value: "1mo", label: "1 month" },
				{ value: "3mo", label: "3 months" },
				{ value: "6mo", label: "6 months" },
				{ value: "1y", label: "1 year" }
			];
			
			const newOptions = interval === "1m" ? options1m : options1d;
			periodSelect.innerHTML = "";
			newOptions.forEach(opt => {
				const el = document.createElement("option");
				el.value = opt.value;
				el.textContent = opt.label;
				if (opt.value === currentPeriod) el.selected = true;
				periodSelect.appendChild(el);
			});

			if (interval === "1m") {
				const allowed = ["1w", "1mo", "3mo", "6mo", "1y"];
				if (!allowed.includes(periodSelect.value)) {
					periodSelect.value = "1w";
				}
			} else {
				const allowed = ["1mo", "3mo", "6mo", "1y", "2y", "3y", "5y", "10y", "max"];
				if (!allowed.includes(periodSelect.value)) {
					periodSelect.value = "1y";
				}
			}
		}
		// Force full reload for interval change to refresh sidebar period options
		isSubmittingWithOverlay = true;
		scheduleAutoSubmit(20);
	});

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
		const sidebar = document.querySelector(".sidebar");
		if (!(sidebar instanceof HTMLElement)) return;
		const panelRect = tradeStrategyField.getBoundingClientRect();
		const sidebarRect = sidebar.getBoundingClientRect();
		const dock = document.querySelector(".sidebar-dock");
		const rootStyles = getComputedStyle(document.documentElement);
		const pageEdgePad = Number.parseFloat(rootStyles.getPropertyValue("--page-edge-pad")) || 10;
		const panelStyles = getComputedStyle(tradeStrategyPanel);
		const lowerBoundary = dock instanceof HTMLElement
			? Math.min(sidebarRect.bottom, dock.getBoundingClientRect().top) - pageEdgePad
			: sidebarRect.bottom - pageEdgePad;
		const availableHeight = Math.max(160, lowerBoundary - panelRect.bottom);
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
		const shouldOpen = isOpen && !tradeStrategyTuneButton.hidden;
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
			panelGrid.addEventListener("scroll", setStrategyPanelScrollingState, { passive: true });
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
		tradeStrategyTuneButton.hidden = !hasFields;
		tradeStrategyTuneButton.classList.toggle("is-hidden", !hasFields);
		if (!hasFields) setTradeStrategyPanelOpen(false);
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

	if (tradeStrategyTuneButton instanceof HTMLButtonElement) {
		tradeStrategyTuneButton.addEventListener("click", () => {
			setTradeStrategyPanelOpen(tradeStrategyPanel instanceof HTMLElement ? tradeStrategyPanel.hidden : false);
		});
	}

	if (tradeStrategySelect instanceof HTMLSelectElement) {
		const releaseStrategyPress = () => tradeStrategySelect.classList.remove("is-pressing");
		tradeStrategySelect.addEventListener("pointerdown", () => {
			tradeStrategySelect.classList.add("is-pressing");
		});
		tradeStrategySelect.addEventListener("pointerup", releaseStrategyPress);
		tradeStrategySelect.addEventListener("pointercancel", releaseStrategyPress);
		tradeStrategySelect.addEventListener("blur", releaseStrategyPress);
		tradeStrategySelect.addEventListener("change", async () => {
			pulseStrategySwitch();
			await refreshTradeStrategyFields(tradeStrategySelect.value);
			if (!form) return;
			window.setTimeout(() => form.requestSubmit(), 72);
		});
	}

	window.addEventListener("resize", positionTradeStrategyPanel);
	document.addEventListener("scroll", positionTradeStrategyPanel, true);

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
			let missingLocalTickers = [];
			try {
				missingLocalTickers = await fetchMissingLocalMarketTickers(values);
			} catch (error) {
				console.warn("Market Store Presence Error:", error);
			}
			isSubmittingWithOverlay = true;
			setFormBusyState(true);
			const nextUrl = buildCleanWorkspaceUrl();
			rememberCurrentViewUrl(nextUrl);
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
				captureBacktestRefreshTransition();
			} else if (pendingWorkspaceChartTransition?.view === state.currentView) {
				captureLineChartRefreshTransition();
			} else {
				delete bootstrap.chartWorkspaceRefreshTransition;
			}
			clearWorkspaceChartTransitionRequest();
			applyPendingWorkspaceMarkup();
			try {
				const hydrated = await hydrateWorkspaceFromUrl(nextUrl);
				if (hydrated === false) return;
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
			} else if (sectionInput?.value === "clear-caches") {
				showWorkspaceModal({
					title: "Clearing local caches",
					copy: "We are removing privacy-sensitive usage records and non-local caches. Please keep this page open while this finishes.",
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
	attachLocalStorePagination();
	attachSettingsSectionNavigation();
	void hydrateNetworkStatuses();
	void hydrateLocalStoreRanges();

	window.addEventListener("resize", scheduleDockPosition);
	window.addEventListener("orientationchange", scheduleDockPosition);
	window.addEventListener("pageshow", scheduleDockPosition);
})();
