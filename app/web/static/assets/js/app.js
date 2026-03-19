/* Code version: v3.25.0 */
(() => {
	const state = window.ANTIGRAVITY_APP;
	if (!state) return;

	const { defaults, labels, endpoints, constraints, theme } = state;
	const isPortfolioView = state.currentView === "portfolio";
	const isTradeMessagesView = state.currentView === "trade-messages";
	const MIN_TICKERS = constraints?.minTickers || 2;
	const MAX_TICKERS = constraints?.maxTickers || 5;
	const minimumRequiredTickers = isTradeMessagesView ? 1 : MIN_TICKERS;
	const tickerPattern = /^[A-Z0-9][A-Z0-9.-]{0,14}$/;
	const sanitizeTicker = (value) => value.toUpperCase().replace(/[^A-Z0-9.-]/g, "").slice(0, 15);
	const $ = (selector) => document.querySelector(selector);
	const $$ = (selector) => Array.from(document.querySelectorAll(selector));
	const UNKNOWN_MESSAGE = "Unknown or unsupported ticker.";
	const VIEW_MEMORY_KEY = "antigravity:view-memory";
	const TRADE_DETAIL_MEMORY_KEY = "antigravity:trade-detail-tab";
	const hasInitialResult = isTradeMessagesView
		? Boolean(state.tradeBacktest)
		: Boolean(state.chart?.series?.length);
	let autoSubmitTimer = null;
	let dockFrame = 0;
	let isSubmittingWithOverlay = false;
	let compareOverlayTimer = null;
	let activeWorkspaceHydration = null;
	let workspaceHydrationToken = 0;
	const datePickerState = [];
	let validTradingDateSet = null;
	const portfolioWeightState = {
		clock: 0,
		touchedAtByIndex: {},
	};
	const tickerValidationCache = new Map();
	const settingsActionOverlay = $("#settings_action_overlay");
	const settingsActionOverlayClose = $("#settings_action_overlay_close");
	const settingsActionOverlayTitle = settingsActionOverlay?.querySelector(".settings-action-title");
	const settingsActionOverlayCopy = settingsActionOverlay?.querySelector(".settings-action-copy");
	const settingsActionOverlayIcon = $("#settings_action_overlay_icon");
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
		"trade-messages": {
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
			sidebarToggle.setAttribute("aria-hidden", "false"); // keep toggle visible to SR
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

	const setFormBusyState = (isBusy) => {
		if (!form) return;
		form.setAttribute("aria-busy", String(isBusy));
	};

	const initializeWorkspaceEnhancements = () => {
		attachNoticeHandlers();
		attachTradeDetailTabs();
		window.requestAnimationFrame(() => {
			window.ANTIGRAVITY_BOOTSTRAP?.initChartWorkspace?.();
			window.ANTIGRAVITY_BOOTSTRAP?.initPortfolioWorkspace?.();
			window.ANTIGRAVITY_BOOTSTRAP?.initTradeMessagesWorkspace?.();
			if (state.currentView === "portfolio") {
				dispatchPortfolioPreviewUpdate();
			}
		});
	};

	const buildPendingWorkspaceMarkup = () => {
		const currentValues = getFilledTickers();
		const reportHeading = $(".workspace .report-heading")?.textContent?.trim() || labels.trade_messages_metrics || "Loading";
		const chartHeading = $(".workspace .chart-heading")?.textContent?.trim() || "Loading";
		if (state.currentView === "trade-messages") {
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
								<span class="segmented-control-option"><span>${labels.trade_messages_metrics_tab}</span></span>
								<span class="segmented-control-option"><span>${labels.trade_messages_transactions_tab}</span></span>
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
				<article class="chart-surface trade-messages-surface">
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

	const applyTradeMessagesPendingState = () => {
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
		if (state.currentView === "trade-messages") {
			applyTradeMessagesPendingState();
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
		const nextState = parseStateFromHtmlDocument(doc);
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
		const viewByDockIndex = ["tickers", "portfolio", "trade-messages", "more", "settings"];
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

	const validateTickerExistence = async (input, { preferFresh = false } = {}) => {
		if (!input) return false;
		const value = sanitizeTicker(input.value.trim());
		input.value = value;
		validateTickerInput(input);
		if (!value) {
			input.dataset.unknown = "";
			setTickerValidationPending(input, false);
			validateTickerInput(input);
			return false;
		}
		if (!tickerPattern.test(value)) {
			input.dataset.unknown = "";
			setTickerValidationPending(input, false);
			validateTickerInput(input);
			return false;
		}
		const counts = new Map();
		getFilledTickers().forEach((ticker) => counts.set(ticker, (counts.get(ticker) || 0) + 1));
		if ((counts.get(value) || 0) > 1) {
			input.dataset.unknown = "";
			setTickerValidationPending(input, false);
			validateTickerInput(input);
			return false;
		}

		if (!preferFresh && tickerValidationCache.has(value)) {
			input.dataset.unknown = tickerValidationCache.get(value) ? "" : "1";
			setTickerValidationPending(input, false);
			validateTickerInput(input);
			return tickerValidationCache.get(value);
		}

		setTickerValidationPending(input, true);
		input.dataset.validationTicker = value;
		try {
			const response = await fetch(`${endpoints.symbolSearch}?q=${encodeURIComponent(value)}&limit=5`);
			if (!response.ok) throw new Error(`Ticker lookup failed: ${response.status}`);
			const payload = await response.json();
			const isKnown = payload.some((item) => String(item.symbol || "").toUpperCase() === value);
			tickerValidationCache.set(value, isKnown);
			if (input.dataset.validationTicker === value) {
				input.dataset.unknown = isKnown ? "" : "1";
				setTickerValidationPending(input, false);
				validateTickerInput(input);
			}
			return isKnown;
		} catch (_error) {
			if (input.dataset.validationTicker === value) {
				setTickerValidationPending(input, false);
				validateTickerInput(input);
			}
			return input.dataset.unknown !== "1";
		}
	};

	const ensureTickerValidityBeforeSubmit = async () => {
		const inputs = getTickerInputs();
		const results = await Promise.all(inputs.map((input) => validateTickerExistence(input, { preferFresh: true })));
		validateAllTickerInputs();
		return results.every((item, index) => {
			const input = inputs[index];
			if (!sanitizeTicker(input.value.trim())) return !input.required;
			return item && input.checkValidity() && input.dataset.unknown !== "1";
		});
	};

	const replaceLocalStoreRegion = (nextRegion) => {
		const currentRegion = $("#local_store_region");
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

	const hydrateNetworkStatuses = async () => {
		if (state.currentView !== "settings" || state.settingsSection !== "network") return;
		try {
			const payload = await fetchJsonCached(
				"settings-network-status",
				endpoints.settingsNetworkStatus,
				{ ttlMs: 45000 },
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
		initLocalStorePaginationPhysics();
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
		const active = pagination.querySelector(".settings-page-button.is-active");
		if (!(active instanceof HTMLElement)) return;
		positionLocalStorePaginationIndicator(pagination, active, { immediate: true });
		pagination.querySelectorAll(".settings-page-button[data-pagination-target]").forEach((button) => {
			if (button instanceof HTMLElement) button.dataset.paginationCurrent = button.classList.contains("is-active") ? "1" : "0";
		});
	};
	const animateLocalStorePaginationTo = (link) => new Promise((resolve) => {
		const pagination = link.closest("[data-local-store-pagination]");
		if (!(pagination instanceof HTMLElement) || !(link instanceof HTMLElement)) {
			resolve();
			return;
		}
		const current = pagination.querySelector(".settings-page-button.is-active") || pagination.querySelector(".settings-page-button[data-pagination-current='1']");
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
				label.textContent = isTradeMessagesView ? labels.trade_messages_ticker : `Ticker ${index}`;
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
		return value;
	};

	const validateAllTickerInputs = () => {
		getTickerInputs().forEach((input) => validateTickerInput(input));
	};

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
			if (input.value.trim()) return;
			setUnknown(false);
			await showRecentItems();
		});
		input.addEventListener("click", async () => {
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
			validateAllTickerInputs();
			void validateTickerExistence(input, { preferFresh: true });
			syncDateConstraints();
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

	const showSettingsActionOverlay = (options = {}) => {
		if (!settingsActionOverlay) return;
		if (settingsActionOverlayTitle && options.title) settingsActionOverlayTitle.textContent = options.title;
		if (settingsActionOverlayCopy && options.copy) settingsActionOverlayCopy.textContent = options.copy;
		if (settingsActionOverlayIcon && options.iconClass) {
			settingsActionOverlayIcon.className = `icon ${options.iconClass} settings-action-icon`;
		}
		settingsActionOverlay.hidden = false;
	};

	const showCompareOverlay = () => {
		showSettingsActionOverlay({
			title: isTradeMessagesView ? "Running your backtest" : "Preparing your chart",
			copy: isTradeMessagesView
				? "Please wait while the app prepares the selected daily data and runs the backtest."
				: "Please wait while the app checks local data and prepares the chart. This may take a little longer for a new ticker.",
			iconClass: "icon-overlay-processing",
		});
	};

	const hideSettingsActionOverlay = () => {
		if (!settingsActionOverlay) return;
		if (compareOverlayTimer) {
			window.clearTimeout(compareOverlayTimer);
			compareOverlayTimer = null;
		}
		settingsActionOverlay.hidden = true;
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
		if (!hasInitialResult || !form) return false;
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

		if (isTradeMessagesView) {
			const strategySelect = $("#trade_strategy");
			const capitalValue = parseTradeCapitalValue(tradeCapitalInput?.value);
			if (strategySelect?.value) params.set("strategy", strategySelect.value);
			if (Number.isFinite(capitalValue)) params.set("capital", String(capitalValue));
			// Dynamic strategy parameters removed — always use defaults, no need to collect
		}

		const queryString = params.toString();
		return queryString ? `${window.location.pathname}?${queryString}` : window.location.pathname;
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

	$("#add_ticker")?.addEventListener("click", () => addTickerField());
	rangeModeInputs.forEach((input) => input.addEventListener("change", () => {
		updateRangePanels();
		syncDateConstraints();
		scheduleAutoSubmit();
	}));
	[exactStartInput, exactEndInput, includeDividendsInput].forEach((input) => {
		if (!input) return;
		input.addEventListener("change", () => {
			syncDateConstraints();
			scheduleAutoSubmit();
		});
	});
	if (includeDividendsInput && form) {
		includeDividendsInput.addEventListener("change", () => {
			scheduleAutoSubmit(80);
		});
	}
	$("#period")?.addEventListener("change", () => {
		scheduleAutoSubmit();
	});

	if (isTradeMessagesView && tradeCapitalField && tradeCapitalInput && tradeCapitalSlider) {
		const scheduleTradeAutoSubmit = () => {
			if (!hasInitialResult) return;
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

	const strategyParamFields = Array.from(document.querySelectorAll("[data-strategy-param-key]"));
	const scheduleStrategyParamSubmit = (delay = 160) => {
		if (!hasInitialResult) return;
		scheduleAutoSubmit(delay);
	};
	strategyParamFields.forEach((field) => {
		if (!(field instanceof HTMLElement)) return;
		const textInput = field.querySelector("[data-strategy-param-input='text']");
		const clearButton = field.querySelector("[data-strategy-param-clear]");
		if (textInput instanceof HTMLInputElement && clearButton instanceof HTMLButtonElement) {
			const suggestions = field.querySelector("[data-strategy-param-suggestions]");
			const emptyState = field.querySelector("[data-strategy-param-empty]");
			const suggestionButtons = Array.from(field.querySelectorAll("[data-strategy-param-suggestion-value]"));
			const escapeHtml = (value) => String(value)
				.replaceAll("&", "&amp;")
				.replaceAll("<", "&lt;")
				.replaceAll(">", "&gt;")
				.replaceAll('"', "&quot;")
				.replaceAll("'", "&#39;");
			const highlightMatch = (value, query) => {
				const text = String(value ?? "");
				const needle = String(query ?? "").trim();
				if (!needle) return escapeHtml(text);
				const lowerText = text.toLowerCase();
				const lowerNeedle = needle.toLowerCase();
				const index = lowerText.indexOf(lowerNeedle);
				if (index === -1) return escapeHtml(text);
				const before = escapeHtml(text.slice(0, index));
				const match = escapeHtml(text.slice(index, index + needle.length));
				const after = escapeHtml(text.slice(index + needle.length));
				return `${before}<mark class="strategy-param-suggestion-mark">${match}</mark>${after}`;
			};
			let activeSuggestionIndex = -1;
			const visibleButtons = () => suggestionButtons.filter((button) => !button.hidden);
			const syncClearVisibility = () => {
				const hasValue = textInput.value.trim().length > 0;
				clearButton.classList.toggle("is-visible", hasValue);
				clearButton.tabIndex = hasValue ? 0 : -1;
			};
			const syncActiveSuggestion = () => {
				const visible = visibleButtons();
				suggestionButtons.forEach((button, index) => {
					button.classList.toggle("is-active", visible[index] === button && index === activeSuggestionIndex);
				});
				const active = visible[activeSuggestionIndex];
				if (active instanceof HTMLElement) active.scrollIntoView({ block: "nearest" });
			};
			const setActiveSuggestion = (index) => {
				const visible = visibleButtons();
				if (!visible.length) {
					activeSuggestionIndex = -1;
					suggestionButtons.forEach((button) => button.classList.remove("is-active"));
					return;
				}
				activeSuggestionIndex = Math.max(0, Math.min(index, visible.length - 1));
				suggestionButtons.forEach((button) => button.classList.toggle("is-active", button === visible[activeSuggestionIndex]));
				visible[activeSuggestionIndex]?.scrollIntoView({ block: "nearest" });
			};
			const applySuggestion = (button) => {
				if (!(button instanceof HTMLButtonElement)) return;
				const value = button.dataset.strategyParamSuggestionValue || "";
				textInput.value = value;
				syncClearVisibility();
				filterSuggestions();
				closeSuggestions();
				textInput.focus();
				scheduleStrategyParamSubmit(80);
			};
			const filterSuggestions = () => {
				const query = textInput.value.trim().toLowerCase();
				let visibleCount = 0;
				suggestionButtons.forEach((button) => {
					if (!(button instanceof HTMLButtonElement)) return;
					const rawValue = button.dataset.strategyParamSuggestionValue || "";
					const label = button.querySelector("[data-strategy-param-suggestion-symbol]");
					const matches = !query || rawValue.toLowerCase().startsWith(query) || rawValue.toLowerCase().includes(query);
					button.hidden = !matches;
					button.setAttribute("aria-hidden", matches ? "false" : "true");
					if (label instanceof HTMLElement) {
						label.innerHTML = highlightMatch(rawValue, query);
					}
					if (matches) visibleCount += 1;
				});
				if (emptyState instanceof HTMLElement) emptyState.hidden = visibleCount > 0;
				const visible = visibleButtons();
				if (!visible.length) {
					activeSuggestionIndex = -1;
					suggestionButtons.forEach((button) => button.classList.remove("is-active"));
					return;
				}
				if (activeSuggestionIndex < 0 || activeSuggestionIndex >= visible.length) {
					activeSuggestionIndex = 0;
				}
				setActiveSuggestion(activeSuggestionIndex);
			};
			const openSuggestions = () => {
				if (!(suggestions instanceof HTMLElement)) return;
				filterSuggestions();
				suggestions.classList.add("is-open");
			};
			const closeSuggestions = () => {
				if (!(suggestions instanceof HTMLElement)) return;
				suggestions.classList.remove("is-open");
				activeSuggestionIndex = -1;
				suggestionButtons.forEach((button) => button.classList.remove("is-active"));
			};
			textInput.addEventListener("focus", openSuggestions);
			textInput.addEventListener("click", openSuggestions);
			textInput.addEventListener("input", () => {
				syncClearVisibility();
				openSuggestions();
				scheduleStrategyParamSubmit();
			});
			textInput.addEventListener("change", () => {
				syncClearVisibility();
				filterSuggestions();
				scheduleStrategyParamSubmit(80);
			});
			textInput.addEventListener("keydown", (event) => {
				const visible = visibleButtons();
				if (event.key === "ArrowDown") {
					event.preventDefault();
					openSuggestions();
					setActiveSuggestion((activeSuggestionIndex < 0 ? -1 : activeSuggestionIndex) + 1);
					return;
				}
				if (event.key === "ArrowUp") {
					event.preventDefault();
					openSuggestions();
					setActiveSuggestion((activeSuggestionIndex < 0 ? visible.length : activeSuggestionIndex) - 1);
					return;
				}
				if (event.key === "Enter" && visible.length && activeSuggestionIndex >= 0 && suggestions instanceof HTMLElement && suggestions.classList.contains("is-open")) {
					event.preventDefault();
					applySuggestion(visible[activeSuggestionIndex]);
					return;
				}
				if (event.key === "Escape") {
					closeSuggestions();
				}
			});
			clearButton.addEventListener("click", () => {
				textInput.value = "";
				syncClearVisibility();
				openSuggestions();
				textInput.focus();
				scheduleStrategyParamSubmit(80);
			});
			suggestionButtons.forEach((button) => {
				if (!(button instanceof HTMLButtonElement)) return;
				button.addEventListener("mouseenter", () => {
					const visible = visibleButtons();
					const index = visible.indexOf(button);
					if (index >= 0) setActiveSuggestion(index);
				});
				button.addEventListener("click", () => applySuggestion(button));
			});
			field.addEventListener("focusout", () => window.setTimeout(() => {
				if (field.matches(":focus-within")) return;
				closeSuggestions();
			}, 100));
			syncClearVisibility();
			filterSuggestions();
		}

		const numberInput = field.querySelector("[data-strategy-param-input='number']");
		const numberSlider = field.querySelector("[data-strategy-param-slider]");
		if (numberInput instanceof HTMLInputElement && numberSlider instanceof HTMLInputElement) {
			const normalizeNumberValue = (value) => {
				const parsed = Number.parseFloat(String(value));
				if (!Number.isFinite(parsed)) return Number.parseFloat(numberInput.min || numberSlider.min || "0") || 0;
				const min = Number.parseFloat(numberInput.min || numberSlider.min || "");
				const max = Number.parseFloat(numberInput.max || numberSlider.max || "");
				let normalized = parsed;
				if (Number.isFinite(min)) normalized = Math.max(min, normalized);
				if (Number.isFinite(max)) normalized = Math.min(max, normalized);
				return normalized;
			};
			const syncNumberPair = (value, fromSlider = false) => {
				const normalized = normalizeNumberValue(value);
				numberInput.value = numberInput.step && numberInput.step !== "1" ? String(normalized) : String(Math.round(normalized));
				numberSlider.value = String(normalized);
				if (fromSlider) scheduleStrategyParamSubmit();
			};
			numberInput.addEventListener("focus", () => field.classList.add("is-open"));
			numberInput.addEventListener("click", () => field.classList.add("is-open"));
			numberInput.addEventListener("input", () => {
				syncNumberPair(numberInput.value);
				scheduleStrategyParamSubmit();
			});
			numberInput.addEventListener("change", () => {
				syncNumberPair(numberInput.value);
				scheduleStrategyParamSubmit(80);
			});
			numberSlider.addEventListener("focus", () => field.classList.add("is-open"));
			numberSlider.addEventListener("input", () => {
				syncNumberPair(numberSlider.value, true);
			});
			field.addEventListener("focusout", () => window.setTimeout(() => {
				if (field.matches(":focus-within")) return;
				field.classList.remove("is-open");
				syncNumberPair(numberInput.value);
			}, 80));
			syncNumberPair(numberInput.value);
		}

		const selectInput = field.querySelector("[data-strategy-param-input='select']");
		if (selectInput instanceof HTMLSelectElement) {
			selectInput.addEventListener("change", () => scheduleStrategyParamSubmit(80));
		}
	});

	const tradeStrategySelect = $("#trade_strategy");
	const tradeStrategyParamsField = document.querySelector(".trade-strategy-params-field");
	let strategySwitchAnimationTimer = null;
	const pulseStrategySwitch = () => {
		if (!(tradeStrategySelect instanceof HTMLSelectElement)) return;
		tradeStrategySelect.classList.remove("is-switching");
		if (tradeStrategyParamsField instanceof HTMLElement) {
			tradeStrategyParamsField.classList.remove("is-switching");
		}
		void tradeStrategySelect.offsetWidth;
		tradeStrategySelect.classList.add("is-switching");
		if (tradeStrategyParamsField instanceof HTMLElement) {
			tradeStrategyParamsField.classList.add("is-switching");
		}
		if (strategySwitchAnimationTimer) window.clearTimeout(strategySwitchAnimationTimer);
		strategySwitchAnimationTimer = window.setTimeout(() => {
			tradeStrategySelect.classList.remove("is-switching", "is-pressing");
			if (tradeStrategyParamsField instanceof HTMLElement) {
				tradeStrategyParamsField.classList.remove("is-switching");
			}
		}, 380);
	};
	if (tradeStrategySelect instanceof HTMLSelectElement) {
		const releaseStrategyPress = () => tradeStrategySelect.classList.remove("is-pressing");
		tradeStrategySelect.addEventListener("pointerdown", () => {
			tradeStrategySelect.classList.add("is-pressing");
		});
		tradeStrategySelect.addEventListener("pointerup", releaseStrategyPress);
		tradeStrategySelect.addEventListener("pointercancel", releaseStrategyPress);
		tradeStrategySelect.addEventListener("blur", releaseStrategyPress);
		tradeStrategySelect.addEventListener("change", () => {
			if (!form) return;
			if (!hasInitialResult) return;
			pulseStrategySwitch();
			window.setTimeout(() => form.requestSubmit(), 72);
		});
	}

	if (form) {
		form.addEventListener("submit", async (event) => {
			if (isSubmittingWithOverlay) return;
			event.preventDefault();
			const values = getFilledTickers();
			validateAllTickerInputs();
			if (values.length < minimumRequiredTickers) {
				getTickerInputs()[0]?.reportValidity();
				return;
			}
			if (new Set(values).size !== values.length) {
				getTickerInputs().find((input) => input.validationMessage)?.reportValidity();
				return;
			}
			const areTickersValid = await ensureTickerValidityBeforeSubmit();
			if (!areTickersValid) {
				getTickerInputs().find((input) => !input.checkValidity() || input.dataset.unknown === "1")?.reportValidity();
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
			isSubmittingWithOverlay = true;
			setFormBusyState(true);
			const nextUrl = buildCleanWorkspaceUrl();
			rememberCurrentViewUrl(nextUrl);
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
				showSettingsActionOverlay({
					title: "Saving daily market data to local cache",
					copy: "We are checking this ticker for missing daily history and saving any new data on this device. Please keep this page open while the download finishes.",
					iconClass: "icon-overlay-local-cache",
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
	settingsActionOverlayClose?.addEventListener("click", hideSettingsActionOverlay);
	window.addEventListener("pageshow", hideSettingsActionOverlay);
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
