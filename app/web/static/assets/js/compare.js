/* Code version: v1.0.0 */
(() => {
	const bootstrap = window.ANTIGRAVITY_BOOTSTRAP = window.ANTIGRAVITY_BOOTSTRAP || {};

	bootstrap.buildComparePendingWorkspaceMarkup = ({
		currentValues = [],
		reportHeading = "Loading",
		chartHeading = "Loading",
		minimumRequiredTickers = 2,
	} = {}) => {
		const itemCount = Math.max(currentValues.length, minimumRequiredTickers);
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
				const symbol = sanitizeTicker(item.querySelector(".report-symbol")?.textContent || "");
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
		delete workspacePanel.dataset.workspacePending;
	};

	bootstrap.hydrateCompareWorkspace = ({ doc, replaceDomRegion } = {}) => {
		const workspacePanel = document.getElementById("workspace_panel");
		const nextWorkspacePanel = doc?.getElementById("workspace_panel");
		if (!workspacePanel || !nextWorkspacePanel || typeof replaceDomRegion !== "function") return false;

		const currentSummaryRegion = document.getElementById("compare_summary_region");
		const nextSummaryRegion = doc.getElementById("compare_summary_region");
		const currentChartRegion = document.getElementById("compare_chart_region");
		const nextChartRegion = doc.getElementById("compare_chart_region");
		if (!currentChartRegion || !nextChartRegion || (Boolean(currentSummaryRegion) !== Boolean(nextSummaryRegion))) {
			workspacePanel.innerHTML = nextWorkspacePanel.innerHTML;
			return true;
		}

		if (currentSummaryRegion && nextSummaryRegion) replaceDomRegion(currentSummaryRegion, nextSummaryRegion);
		replaceDomRegion(currentChartRegion, nextChartRegion);
		workspacePanel.querySelectorAll(".is-pending-value").forEach((node) => node.classList.remove("is-pending-value"));
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
})();
