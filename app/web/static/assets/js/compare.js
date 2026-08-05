/* Code version: v0.5.1 */
(() => {
	const bootstrap = window.ANTIGRAVITY_BOOTSTRAP = window.ANTIGRAVITY_BOOTSTRAP || {};
	const appState = () => window.ANTIGRAVITY_APP || {};
	const share = () => bootstrap.workspaceShare || {};
	const COMPARE_LIVE_REFRESH_MS = 45000;
	const COMPARE_LIVE_INITIAL_DELAY_MS = 1500;
	let compareLiveRefreshTimer = 0;
	let compareLiveRequestSerial = 0;

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
						${Array.from({ length: itemCount }, (_, index) => `<section class="performance-item is-pending-card" data-ticker="${currentValues[index] || "..."}"><div class="ticker-identity-row"><span class="ticker-identity-copy"><span class="suggestion-symbol ticker-identity-symbol">${currentValues[index] || "..."}</span><span class="suggestion-name ticker-identity-name is-pending-value" data-workspace-mask="company-name" title="Loading">Loading</span></span></div><div class="performance-metrics"><p class="report-value performance-metric-row performance-metric-row-total"><span class="compare-percent-value is-pending-value" data-workspace-mask="compare-return">0000</span></p><p class="report-value performance-metric-row performance-metric-row-dividend"><span class="compare-percent-value compare-percent-value-secondary is-pending-value" data-workspace-mask="compare-ttm-dividend-yield">0000</span></p></div></section>`).join("")}
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

		const xAxisKeys = ["period", "range", "date", "trading_date", "exact_trading_date", "from", "exact_start", "to", "exact_end", "return", "extended-hours", "extended_hours", "include_extended_hours", "overnight", "include_overnight", "price_only", "price_return_only", "dividends", "include_dividends"];
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
			title: "Return comparison",
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

	const normalizeTicker = (value) => String(value || "").trim().toUpperCase();
	const nonUsMarketSuffixPattern = /\.(AS|AX|BA|BE|BK|BO|BR|CA|CN|CO|DE|DU|F|HA|HE|HK|HM|IR|IS|JK|JP|KL|KQ|KS|L|MC|MI|MX|NE|NS|NZ|OL|PA|QA|SA|SE|SG|SH|SI|SR|SS|ST|SW|SZ|T|TA|TO|TWO|TW|V|VI)$/i;
	const areAllCompareTickersUs = (tickers) => tickers.length > 0
		&& tickers.every((ticker) => !nonUsMarketSuffixPattern.test(normalizeTicker(ticker)));

	const getComparePeriod = () => {
		const workspaceState = window.ANTIGRAVITY_WORKSPACE_URL_STATE?.parseWorkspaceUrlState?.(window.location.href);
		if (workspaceState?.period) return workspaceState.period;
		const params = new URLSearchParams(window.location.search);
		return (params.get("period") || "").trim().toLowerCase();
	};

	const getCompareRangeMode = () => {
		const workspaceState = window.ANTIGRAVITY_WORKSPACE_URL_STATE?.parseWorkspaceUrlState?.(window.location.href);
		if (workspaceState?.rangeMode) return workspaceState.rangeMode;
		const params = new URLSearchParams(window.location.search);
		return (params.get("range") || params.get("range_mode") || "").trim().toLowerCase();
	};

	const formatLocalIsoDate = (date = new Date()) => {
		const year = date.getFullYear();
		const month = String(date.getMonth() + 1).padStart(2, "0");
		const day = String(date.getDate()).padStart(2, "0");
		return `${year}-${month}-${day}`;
	};

	const isExactOneDayComparePage = () => {
		const state = appState();
		if (state.currentView !== "tickers") return false;
		const params = new URLSearchParams(window.location.search);
		return getCompareRangeMode() === "exact"
			&& getComparePeriod() === "1d"
			&& Boolean(window.ANTIGRAVITY_WORKSPACE_URL_STATE?.parseWorkspaceUrlState?.(window.location.href)?.date
				|| params.get("trading_date") || params.get("exact_trading_date") || params.get("from") || params.get("exact_start"));
	};

	const isRelativeMultiDayLiveComparePage = () => {
		const state = appState();
		if (state.currentView !== "tickers") return false;
		const period = getComparePeriod();
		return getCompareRangeMode() !== "exact" && (period === "1d" || period === "3d" || period === "1w");
	};

	const getCompareSelectedDate = () => {
		const workspaceState = window.ANTIGRAVITY_WORKSPACE_URL_STATE?.parseWorkspaceUrlState?.(window.location.href);
		if (workspaceState?.date) return workspaceState.date;
		const params = new URLSearchParams(window.location.search);
		return params.get("trading_date")
			|| params.get("exact_trading_date")
			|| params.get("from")
			|| params.get("exact_start")
			|| "";
	};

	const getCompareAxisDate = () => {
		return appState().chart?.tradingDate
			|| getCompareSelectedDate()
			|| "";
	};

	const shouldRefreshCompareLiveChart = () => {
		if (isExactOneDayComparePage()) return getCompareSelectedDate() === formatLocalIsoDate();
		return isRelativeMultiDayLiveComparePage();
	};

	const buildCompareLiveParams = () => {
		const state = appState();
		const tickers = (state.chart?.series || [])
			.map((item) => normalizeTicker(item?.ticker))
			.filter(Boolean);
		const currentParams = new URLSearchParams(window.location.search);
		const params = new URLSearchParams();
		tickers.forEach((ticker) => params.append("ticker", ticker));
		if (tickers.length < 2) return null;
		if (isRelativeMultiDayLiveComparePage()) {
			params.set("period", getComparePeriod());
			params.set("live_date", formatLocalIsoDate());
		} else {
			const axisDate = getCompareAxisDate();
			const liveDate = getCompareSelectedDate();
			if (!axisDate || !liveDate) return null;
			params.set("axis_date", axisDate);
			params.set("live_date", liveDate);
		}
		params.set("refresh", "1");
		if (
			areAllCompareTickersUs(tickers)
			&& getComparePeriod() === "1d"
			&& (currentParams.get("extended-hours") === "1" || currentParams.get("extended_hours") === "1" || currentParams.get("include_extended_hours") === "1")
		) {
			params.set("extended_hours", "1");
		}
		if (currentParams.get("overnight") === "1" || currentParams.get("include_overnight") === "1") {
			params.set("overnight", "1");
		}
		return params;
	};

	const formatCompareLivePercent = (value) => {
		if (value === null || value === undefined || value === "") return "—";
		const numeric = Number(value);
		if (!Number.isFinite(numeric)) return "—";
		return `${numeric.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
	};

	const renderComparePercentValue = (valueNode, value) => {
		if (!(valueNode instanceof HTMLElement)) return;
		valueNode.textContent = "";
		const display = formatCompareLivePercent(value);
		if (display === "—") {
			const empty = document.createElement("span");
			empty.className = "compare-percent-empty";
			empty.textContent = "—";
			valueNode.appendChild(empty);
			return;
		}
		const match = display.match(/^(.+)(\.)(\d{2})(%)$/);
		if (!match) {
			valueNode.textContent = display;
			return;
		}
		[
			["compare-percent-major", match[1]],
			["compare-percent-dot", match[2]],
			["compare-percent-minor", match[3]],
			["compare-percent-suffix", match[4]],
		].forEach(([className, text]) => {
			const part = document.createElement("span");
			part.className = className;
			part.textContent = text;
			valueNode.appendChild(part);
		});
	};

	const appendCompareWinnerBadge = (targetNode, className = "winner-badge") => {
		if (!(targetNode instanceof HTMLElement)) return;
		const badge = document.createElement("span");
		badge.className = className;
		badge.setAttribute("role", "img");
		badge.setAttribute("aria-label", appState().labels?.winner_alt || "Winner");
		targetNode.insertAdjacentElement("afterend", badge);
	};

	const sanitizeCompareDisplayRange = (value) => String(value || "")
		.replace(/\s*[·•]\s*axis\s+\d{1,2}\s+[A-Z][a-z]{2}\s+\d{4}/g, "")
		.trim();

	const removeCompareAxisNotice = () => {
		document.querySelectorAll(".notice-floating-banner-global").forEach((node) => {
			const text = node.textContent || "";
			if (/Live comparison for \d{1,2} [A-Z][a-z]{2} \d{4} uses the complete \d{1,2} [A-Z][a-z]{2} \d{4} cross-market axis\./.test(text)) {
				node.remove();
			}
		});
	};

	const syncCompareLiveSummary = (payload) => {
		const items = Array.isArray(payload?.performanceItems) ? payload.performanceItems : [];
		items.forEach((item) => {
			const ticker = normalizeTicker(item?.ticker);
			if (!ticker) return;
			const card = document.querySelector(`#compare_summary_region .performance-item[data-ticker="${CSS.escape(ticker)}"]`);
			const valueNode = card?.querySelector?.('[data-workspace-mask="compare-return"]');
			const dividendYieldNode = card?.querySelector?.('[data-workspace-mask="compare-ttm-dividend-yield"]');
			if (!(card instanceof HTMLElement) || !(valueNode instanceof HTMLElement)) return;
			renderComparePercentValue(valueNode, item.ending_return);
			if (item.color) valueNode.style.color = item.color;
			card.querySelectorAll(".winner-badge").forEach((node) => node.remove());
			if (item.is_winner) {
				appendCompareWinnerBadge(valueNode, "winner-badge winner-badge-total-return");
			}
			if (dividendYieldNode instanceof HTMLElement) {
				renderComparePercentValue(dividendYieldNode, item.ttm_dividend_yield);
				if (item.is_dividend_yield_winner) {
					appendCompareWinnerBadge(dividendYieldNode, "winner-badge winner-badge-dividend-yield");
				}
			}
		});
		const rangeNode = document.getElementById("compare_summary_date_range");
		if (rangeNode instanceof HTMLElement && payload?.displayRange) {
			rangeNode.textContent = sanitizeCompareDisplayRange(payload.displayRange);
		}
		removeCompareAxisNotice();
	};

	const applyCompareLivePayload = (payload) => {
		const liveSeries = Array.isArray(payload?.series) ? payload.series : [];
		if (!liveSeries.length) return false;
		const state = appState();
		const currentTickers = (state.chart?.series || []).map((item) => normalizeTicker(item?.ticker)).join(",");
		const liveTickers = liveSeries.map((item) => normalizeTicker(item?.ticker)).join(",");
		if (!currentTickers || currentTickers !== liveTickers) return false;
		if (isRelativeMultiDayLiveComparePage()) {
			if (payload.period && payload.period !== getComparePeriod()) return false;
		} else {
			if (payload.liveDate && payload.liveDate !== getCompareSelectedDate()) return false;
			if (payload.axisDate && payload.axisDate !== getCompareAxisDate()) return false;
		}
		state.chart.series = liveSeries;
		state.chart.tradingDate = payload.axisDate || state.chart.tradingDate;
		state.chart.liveComparison = {
			active: payload.liveSessionActive === true,
			axisDate: payload.axisDate || "",
			liveDate: payload.liveDate || "",
			fetchedAt: payload.fetchedAt || "",
			sources: payload.sources || {},
		};
		syncCompareLiveSummary(payload);
		bootstrap.initChartWorkspace?.();
		return true;
	};

	const refreshCompareLiveChart = async () => {
		if (!shouldRefreshCompareLiveChart()) return;
		const endpoint = appState().endpoints?.compareLive;
		const params = buildCompareLiveParams();
		if (!endpoint || !params) return;
		if (document.hidden) {
			scheduleCompareLiveRefresh(COMPARE_LIVE_REFRESH_MS);
			return;
		}
		const requestSerial = ++compareLiveRequestSerial;
		try {
			const response = await fetch(`${endpoint}?${params.toString()}`, {
				credentials: "same-origin",
				cache: "no-store",
				headers: { "Cache-Control": "no-cache" },
			});
			const payload = await response.json().catch(() => ({}));
			if (requestSerial !== compareLiveRequestSerial) return;
			if (!response.ok || payload?.success === false) {
				throw new Error(payload?.error || "Unable to refresh live comparison.");
			}
			applyCompareLivePayload(payload);
		} catch (error) {
			console.warn(error instanceof Error ? error.message : "Unable to refresh live comparison.");
		} finally {
			if (requestSerial === compareLiveRequestSerial) {
				scheduleCompareLiveRefresh(COMPARE_LIVE_REFRESH_MS);
			}
		}
	};

	const scheduleCompareLiveRefresh = (delay = COMPARE_LIVE_INITIAL_DELAY_MS) => {
		if (!shouldRefreshCompareLiveChart()) return;
		if (compareLiveRefreshTimer) window.clearTimeout(compareLiveRefreshTimer);
		compareLiveRefreshTimer = window.setTimeout(() => {
			compareLiveRefreshTimer = 0;
			void refreshCompareLiveChart();
		}, delay);
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
	removeCompareAxisNotice();
	scheduleCompareLiveRefresh();
	document.addEventListener("visibilitychange", () => {
		if (!document.hidden) scheduleCompareLiveRefresh(500);
	});
})();
