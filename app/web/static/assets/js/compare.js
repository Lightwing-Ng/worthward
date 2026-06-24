/* Code version: v0.4.0 */
(() => {
	const bootstrap = window.ANTIGRAVITY_BOOTSTRAP = window.ANTIGRAVITY_BOOTSTRAP || {};
	const appState = () => window.ANTIGRAVITY_APP || {};
	const share = () => bootstrap.workspaceShare || {};

	bootstrap.buildComparePendingWorkspaceMarkup = ({
		currentValues = [],
		reportHeading = "Loading",
		chartHeading = "Loading",
		minimumRequiredTickers = 2,
	} = {}) => {
		const itemCount = Math.max(currentValues.length, minimumRequiredTickers);
		return `
			<section class="workspace-header workspace-mobile-summary-shell" data-mobile-summary-fixed>
				
				<article class="report-card workspace-article-card workspace-summary-card">
					<div class="report-heading-row"><p class="report-heading">${reportHeading}</p></div>
				</article>
				
				
				<article class="report-card workspace-content-card compare-summary-content-card">
					<div id="compare_summary_panel">
						<p id="compare_summary_date_range" class="compare-summary-date-range is-pending-value">Loading range...</p>
						<div id="compare_summary_region" class="performance-grid" style="grid-template-columns: repeat(${itemCount}, minmax(0, 1fr));">
						${Array.from({ length: itemCount }, (_, index) => `<section class="performance-item is-pending-card" data-ticker="${currentValues[index] || "..."}"><div class="ticker-identity-row"><span class="ticker-identity-copy"><span class="suggestion-symbol ticker-identity-symbol">${currentValues[index] || "..."}</span><span class="suggestion-name ticker-identity-name is-pending-value" data-workspace-mask="company-name" title="Loading">Loading</span></span></div><p class="report-value"><span class="is-pending-value" data-workspace-mask="compare-return">0000</span></p></section>`).join("")}
						</div>
					</div>
				</article>
				<article class="chart-surface"><div class="chart-heading-row"><p class="chart-heading">${chartHeading}</p></div><div class="chart-wrap is-pending-value" data-workspace-mask="chart-area"></div></article>
			</section>
		`;
	};

	bootstrap.removeTickerFromComparePreview = ({
		ticker,
		state,
		sanitizeTicker,
		minimumRequiredTickers = 2,
	} = {}) => {
		const normalizedTicker = typeof sanitizeTicker === "function"
			? sanitizeTicker(ticker || "")
			: String(ticker || "").trim().toUpperCase();
		if (!normalizedTicker) return;
		if (!Array.isArray(state?.chart?.series) || !state.chart.series.length) return;

		const nextSeries = state.chart.series.filter((item) => sanitizeTicker(item?.ticker || "") !== normalizedTicker);
		const nextProfiles = Array.isArray(state.chart?.profiles)
			? state.chart.profiles.filter((item) => sanitizeTicker(item?.ticker || "") !== normalizedTicker)
			: [];
		if (nextSeries.length === state.chart.series.length) return;

		state.chart.series = nextSeries;
		state.chart.profiles = nextProfiles;

		const summaryRegion = document.getElementById("compare_summary_region");
		if (summaryRegion) {
			Array.from(summaryRegion.querySelectorAll(".performance-item")).forEach((item) => {
				const symbol = sanitizeTicker(item.dataset.ticker || item.querySelector(".ticker-identity-symbol")?.textContent || "");
				if (symbol === normalizedTicker) item.remove();
			});
			const remainingCards = summaryRegion.querySelectorAll(".performance-item").length;
			if (remainingCards > 0) {
				summaryRegion.style.gridTemplateColumns = `repeat(${remainingCards}, minmax(0, 1fr))`;
			}
		}

		if (nextSeries.length >= minimumRequiredTickers) {
			window.requestAnimationFrame(() => {
				window.ANTIGRAVITY_BOOTSTRAP?.initChartWorkspace?.();
			});
		}
	};

	bootstrap.applyComparePendingState = () => {
		const workspacePanel = document.getElementById("workspace_panel");
		if (!workspacePanel) return;
		workspacePanel.querySelectorAll(".is-pending-value").forEach((node) => node.classList.remove("is-pending-value"));
		workspacePanel.querySelectorAll(".is-pending-card").forEach((node) => node.classList.remove("is-pending-card"));
		delete workspacePanel.dataset.workspacePending;
	};

	bootstrap.hydrateCompareWorkspace = ({ doc, replaceDomRegion } = {}) => {
		const workspacePanel = document.getElementById("workspace_panel");
		const nextWorkspacePanel = doc?.getElementById("workspace_panel");
		if (!workspacePanel || !nextWorkspacePanel || typeof replaceDomRegion !== "function") return false;

		const currentSummaryPanel = document.getElementById("compare_summary_panel");
		const nextSummaryPanel = doc.getElementById("compare_summary_panel");
		const currentChartRegion = document.getElementById("compare_chart_region");
		const nextChartRegion = doc.getElementById("compare_chart_region");
		if (!currentChartRegion || !nextChartRegion || (Boolean(currentSummaryPanel) !== Boolean(nextSummaryPanel))) {
			workspacePanel.innerHTML = nextWorkspacePanel.innerHTML;
			return true;
		}

		if (currentSummaryPanel && nextSummaryPanel) replaceDomRegion(currentSummaryPanel, nextSummaryPanel);
		replaceDomRegion(currentChartRegion, nextChartRegion);
		workspacePanel.querySelectorAll(".is-pending-value").forEach((node) => node.classList.remove("is-pending-value"));
		workspacePanel.querySelectorAll(".is-pending-card").forEach((node) => node.classList.remove("is-pending-card"));
		return true;
	};

	bootstrap.didCompareRequestChangeXAxis = (currentParams, nextParams) => {
		const currentTickers = Array.from(currentParams.getAll("ticker")).sort().join(",");
		const nextTickers = Array.from(nextParams.getAll("ticker")).sort().join(",");
		if (currentTickers !== nextTickers) return true;

		const xAxisKeys = ["period", "range", "from", "exact_start", "to", "exact_end"];
		for (const key of xAxisKeys) {
			const current = (currentParams.get(key) || "").toString().trim();
			const next = (nextParams.get(key) || "").toString().trim();
			if (current !== next) return true;
		}
		return false;
	};

	const buildCompareShareHeadingSection = () => {
		const summaryCard = document.querySelector(".compare-summary-content-card");
		const headingCard = summaryCard?.previousElementSibling;
		if (!(headingCard instanceof HTMLElement)) return null;
		const section = share().createSection?.("investment-community-share-section--compact investment-community-share-section--padded");
		if (!(section instanceof HTMLElement)) return null;
		const clone = share().sanitizeClone?.(headingCard.cloneNode(true));
		if (clone instanceof HTMLElement) {
			clone.classList.add("compare-share-heading-card");
			section.appendChild(clone);
		}
		return section;
	};

	const buildCompareShareSummarySection = () => {
		const summaryCard = document.querySelector(".compare-summary-content-card");
		if (!(summaryCard instanceof HTMLElement)) return null;
		const section = share().createSection?.("investment-community-share-section--compact investment-community-share-section--padded");
		if (!(section instanceof HTMLElement)) return null;
		const clone = share().sanitizeClone?.(summaryCard.cloneNode(true));
		if (clone instanceof HTMLElement) {
			clone.classList.add("compare-share-summary-card");
			const summaryRegion = clone.querySelector("#compare_summary_region, .performance-grid");
			if (summaryRegion instanceof HTMLElement) {
				summaryRegion.style.removeProperty("grid-template-columns");
			}
			clone.querySelectorAll(".winner-badge").forEach((badge) => {
				if (!(badge instanceof HTMLElement)) return;
				const winnerIcon = document.createElement("img");
				winnerIcon.className = badge.className;
				winnerIcon.src = "/static/images/checkmark.circle.fill.green.svg";
				winnerIcon.alt = badge.getAttribute("aria-label") || "";
				winnerIcon.setAttribute("role", badge.getAttribute("role") || "img");
				badge.replaceWith(winnerIcon);
			});
			section.appendChild(clone);
		}
		return section;
	};

	const buildCompareCommunityShareCard = async () => {
		const chartCanvas = document.getElementById("returnsChart");
		if (!(chartCanvas instanceof HTMLCanvasElement) || chartCanvas.dataset.chartMounted !== "1") {
			throw new Error("Compare chart is not ready for screenshot export.");
		}
		const headingSection = buildCompareShareHeadingSection();
		const summarySection = buildCompareShareSummarySection();
		const chartSection = await share().createChartSection?.(chartCanvas);
		if (!(headingSection instanceof HTMLElement) || !(summarySection instanceof HTMLElement) || !(chartSection instanceof HTMLElement)) {
			throw new Error("Compare summary content is not ready for screenshot export.");
		}

		const frame = share().createTemplateFrame?.({
			shareView: "compare",
			title: "Compare stocks",
		});
		if (!frame?.host || !frame?.card || !frame?.body) {
			throw new Error("Compare share template is unavailable.");
		}
		frame.body.appendChild(headingSection);
		frame.body.appendChild(summarySection);
		frame.body.appendChild(chartSection);
		frame.card.appendChild(await share().createFooter?.());
		return frame.host;
	};

	const buildCompareShareFilename = () => {
		const tickers = (appState().chart?.series || [])
			.map((item) => String(item?.ticker || "").trim().toLowerCase())
			.filter(Boolean)
			.join("-") || "comparison";
		return share().buildFilename?.("compare", tickers) || `compare-${tickers}.png`;
	};

	bootstrap.registerWorkspaceShareProvider?.("tickers", {
		isReady: () => {
			const chartCanvas = document.getElementById("returnsChart");
			const hasSeries = Array.isArray(appState().chart?.series) && appState().chart.series.length > 0;
			return hasSeries && chartCanvas?.dataset.chartMounted === "1";
		},
		buildCard: buildCompareCommunityShareCard,
		buildFilename: buildCompareShareFilename,
		modalLabels: {
			failedTitle: "Screenshot export failed",
		},
	});
})();