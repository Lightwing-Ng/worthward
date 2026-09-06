/* Code version: v0.41.2 */
(() => {
	const bootstrap = window.WORTHWARD_BOOTSTRAP = window.WORTHWARD_BOOTSTRAP || {};
	const BACKTEST_HISTORY_VIEW_CHANGE_EVENT = "worthward:backtest-history-view-change";

	const getBacktestTradeDetailsInput = () => document.getElementById("show_trade_details");
	const isBacktestTradeDetailsEnabled = () => {
		const input = getBacktestTradeDetailsInput();
		return input instanceof HTMLInputElement && input.checked;
	};
	const persistBacktestTradeDetailsPreference = (enabled) => {
		const nextUrl = new URL(window.location.href);
		if (enabled) {
			nextUrl.searchParams.set("show_trade_details", "1");
		} else {
			nextUrl.searchParams.set("show_trade_details", "0");
			if (nextUrl.searchParams.get("tab") === "transactions") {
				nextUrl.searchParams.delete("tab");
			}
		}
		window.history.replaceState(
			window.history.state,
			"",
			`${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`,
		);
	};
	const applyBacktestTradeDetailsPreference = (enabled, {persist = false} = {}) => {
		const showTradeDetails = Boolean(enabled);
		const input = getBacktestTradeDetailsInput();
		if (input instanceof HTMLInputElement) input.checked = showTradeDetails;
		document.querySelectorAll("[data-backtest-trade-chart-stack]").forEach((stack) => {
			stack.classList.toggle("is-trade-details-hidden", !showTradeDetails);
			stack.dataset.tradeDetailsVisible = String(showTradeDetails);
		});
		document.querySelectorAll("[data-backtest-equity-panel]").forEach((panel) => {
			panel.hidden = !showTradeDetails;
			panel.setAttribute("aria-hidden", showTradeDetails ? "false" : "true");
		});
		const historySurface = document.getElementById("backtest_history_surface");
		if (historySurface instanceof HTMLElement) {
			historySurface.dataset.tradeDetailsVisible = String(showTradeDetails);
		}
		if (persist) persistBacktestTradeDetailsPreference(showTradeDetails);
		initBacktestHistoryTabs();
		window.dispatchEvent(new CustomEvent("worthward:backtest-trade-details-change", {
			detail: {enabled: showTradeDetails},
		}));
		return showTradeDetails;
	};
	const initBacktestTradeDetailsPreference = () => {
		const input = getBacktestTradeDetailsInput();
		bootstrap.backtestTradeDetails = {
			isEnabled: isBacktestTradeDetailsEnabled,
			apply: applyBacktestTradeDetailsPreference,
		};
		if (!(input instanceof HTMLInputElement)) return;
		if (input.dataset.backtestTradeDetailsBound !== "1") {
			input.dataset.backtestTradeDetailsBound = "1";
			input.addEventListener("change", () => {
				applyBacktestTradeDetailsPreference(input.checked, {persist: true});
			});
		}
		applyBacktestTradeDetailsPreference(input.checked);
	};

	const initBacktestHistoryTabs = () => {
		const segmentedControl = document.getElementById("backtest_history_view_segmented");
		const viewSurface = document.getElementById("backtest_history_surface");
		if (!segmentedControl || !viewSurface) return;
		const panels = Array.from(viewSurface.querySelectorAll("[data-backtest-history-view-panel]"));
		const syncPanels = () => {
			const previousActive = viewSurface.dataset.activeView;
			const showTradeDetails = isBacktestTradeDetailsEnabled();
			const metricsInput = segmentedControl.querySelector('input[name="backtest_history_view_tab"][value="metrics"]');
			const probabilityInput = segmentedControl.querySelector('input[name="backtest_history_view_tab"][value="probability"]');
			const transactionsInput = segmentedControl.querySelector("[data-backtest-history-transactions]");
			const transactionsOption = segmentedControl.querySelector(
				"[data-backtest-history-transactions-option]",
			);
			if (transactionsInput instanceof HTMLInputElement) {
				transactionsInput.disabled = !showTradeDetails;
				transactionsInput.checked = showTradeDetails ? transactionsInput.checked : false;
			}
			if (transactionsOption instanceof HTMLElement) {
				if (showTradeDetails) transactionsOption.removeAttribute("aria-disabled");
				else transactionsOption.setAttribute("aria-disabled", "true");
			}
			if (!showTradeDetails && metricsInput instanceof HTMLInputElement
				&& !(probabilityInput instanceof HTMLInputElement && probabilityInput.checked)) {
				metricsInput.checked = true;
			}
			const active = showTradeDetails
				? segmentedControl.querySelector('input[name="backtest_history_view_tab"]:checked')?.value || "transactions"
				: probabilityInput instanceof HTMLInputElement && probabilityInput.checked
					? "probability"
					: "metrics";
			segmentedControl.dataset.active = active;
			viewSurface.dataset.activeView = active;
			viewSurface.dataset.tradeDetailsVisible = String(showTradeDetails);
			window.WORTHWARD_SEGMENTED_CONTROLS?.sync?.(segmentedControl, {activeValue: active});
			panels.forEach((panel) => {
				panel.hidden = panel.dataset.backtestHistoryViewPanel !== active;
			});
			if (previousActive !== active) {
				window.dispatchEvent(new CustomEvent(BACKTEST_HISTORY_VIEW_CHANGE_EVENT, {
					detail: {active},
				}));
			}
		};
		if (segmentedControl.dataset.bound !== "1") {
			segmentedControl.dataset.bound = "1";
			segmentedControl.querySelectorAll('input[name="backtest_history_view_tab"]').forEach((input) => {
				input.addEventListener("change", syncPanels);
			});
		}
		syncPanels();
	};

	bootstrap.setBacktestLoadState = (status) => {
		if (window.WORTHWARD_APP?.currentView !== "backtest"
			|| window.WORTHWARD_APP?.selectedStrategyId === "dca") return;
		bootstrap.backtestLoadState = status;
		const surface = document.querySelector("#backtest_overview_panel > .backtest-surface");
		if (surface) {
			surface.setAttribute("aria-busy", String(status === "loading"));
			let feedback = surface.querySelector("[data-backtest-load-status]");
			if (!feedback) {
				feedback = document.createElement("div");
				feedback.dataset.backtestLoadStatus = "true";
				feedback.className = "backtest-load-status";
				feedback.setAttribute("role", "status");
				feedback.setAttribute("aria-live", "polite");
				surface.appendChild(feedback);
			}
			feedback.hidden = status === "ready";
			feedback.replaceChildren();
			if (status === "loading") {
				const spinner = document.createElement("span");
				spinner.className = "suggestion-loading-spinner";
				spinner.setAttribute("aria-hidden", "true");
				feedback.appendChild(spinner);
			}
			const label = document.createElement("span");
			label.textContent = status === "loading" ? "Loading backtest…" : "Backtest could not be loaded.";
			feedback.appendChild(label);
		}
		window.WORTHWARD_LSTM_TRAINING?.renderMenu?.();
	};

	const initBacktestWorkspace = () => {
		initBacktestTradeDetailsPreference();
		initBacktestHistoryTabs();
		if (document.getElementById("workspace_panel")?.dataset.workspacePending === "1") return;
		bootstrap.setBacktestLoadState("loading");
		bootstrap.backtestHoverController?.destroy?.();
		const controller = window.WORTHWARD_BACKTEST_CHART_CONTROLLER.createController({
			isBacktestTradeDetailsEnabled,
		});
		bootstrap.backtestHoverController = controller;
		try {
			controller.mount(window.WORTHWARD_APP);
			if (!window.Chart?.getChart?.(document.getElementById("tradePriceChart"))) {
				bootstrap.setBacktestLoadState("error");
			}
		} catch (error) {
			bootstrap.setBacktestLoadState("error");
			throw error;
		}
	};

	const share = () => bootstrap.workspaceShare || {};

	const buildBacktestShareFilename = () => {
		const ticker = String(window.WORTHWARD_APP?.backtestResult?.summary?.ticker || "").trim().toLowerCase() || "backtest";
		return share().buildFilename?.("backtest", ticker) || `backtest-${ticker}.png`;
	};

	bootstrap.registerWorkspaceShareProvider?.("backtest", {
		isReady: () => Boolean(window.WORTHWARD_APP?.backtestResult) && share().areTradeChartsReady?.(),
		buildCard: () => share().buildTradeCard?.({
			shareView: "backtest",
			title: document.querySelector(".workspace-mode-results-stack .workspace-summary-card .report-heading")?.textContent?.trim()
				|| "Backtest",
		}),
		buildFilename: buildBacktestShareFilename,
		onAnchorClick: () => {
			window.location.assign(`/api/export-transactions${window.location.search}`);
		},
	});

	bootstrap.initBacktestWorkspace = initBacktestWorkspace;
	initBacktestWorkspace();
})();
