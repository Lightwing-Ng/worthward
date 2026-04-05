/* Code version: v0.3.0 */
(() => {
	const bootstrap = window.ANTIGRAVITY_BOOTSTRAP = window.ANTIGRAVITY_BOOTSTRAP || {};

	const initPortfolioWorkspace = () => {
		const state = window.ANTIGRAVITY_APP;
		if (!state || state.currentView !== "portfolio") return;

		const startDonut = document.getElementById("portfolio_donut_start");
		const startOrbit = document.getElementById("portfolio_donut_start_orbit");
		const startLogoLayer = document.getElementById("portfolio_donut_start_logo_layer");
		const endDonut = document.getElementById("portfolio_donut_end");
		const endOrbit = document.getElementById("portfolio_donut_end_orbit");
		const endLogoLayer = document.getElementById("portfolio_donut_end_logo_layer");
		if (!startDonut || !startOrbit || !startLogoLayer || !endDonut || !endOrbit || !endLogoLayer) return;
		if (startDonut.dataset.portfolioMounted === "1") return;
		startDonut.dataset.portfolioMounted = "1";

		const readThemeToken = (tokenName) => getComputedStyle(document.body).getPropertyValue(tokenName).trim();
		const fallbackDonutFill = "var(--theme-glass-border)";

		const buildGradientColors = (count) => {
			const accentPrimary = readThemeToken("--theme-accent-primary");
			const accentSecondary = readThemeToken("--theme-accent-secondary");
			if (!accentPrimary || !accentSecondary) return [];
			if (count <= 1) return [accentPrimary];
			const hexToRgb = (value) => {
				const normalized = value.trim();
				if (!/^#[0-9a-f]{6}$/i.test(normalized)) return null;
				const raw = normalized.slice(1);
				return [
					Number.parseInt(raw.slice(0, 2), 16),
					Number.parseInt(raw.slice(2, 4), 16),
					Number.parseInt(raw.slice(4, 6), 16),
				];
			};
			const rgbToHex = ([r, g, b]) => `#${[r, g, b].map((item) => item.toString(16).padStart(2, "0")).join("")}`;
			const start = hexToRgb(accentPrimary);
			const end = hexToRgb(accentSecondary);
			if (!start || !end) return [accentPrimary];
			return Array.from({ length: count }, (_item, index) => {
				const ratio = index / (count - 1);
				return rgbToHex(start.map((channel, channelIndex) => Math.round(channel + ((end[channelIndex] - channel) * ratio))));
			});
		};

		const getPortfolioItem = (ticker) => state.portfolio?.items?.find((item) => item.ticker === ticker) || null;
		const getPortfolioLogoUrl = (ticker) => getPortfolioItem(ticker)?.logo_url || "";
		const getPortfolioEntriesFromDom = () => Array.from(document.querySelectorAll(".ticker-field"))
			.map((field, index) => {
				const tickerInput = field.querySelector('input[name^="ticker_"]');
				const weightInput = field.querySelector(".portfolio-weight-input");
				const ticker = tickerInput?.value?.trim()?.toUpperCase() || "";
				if (!ticker || !weightInput) return null;
				return {
					index,
					ticker,
					weight: Number.parseInt(weightInput.value, 10) || 0,
				};
			})
			.filter(Boolean);

		const angleToPoint = (degrees, center, radius) => {
			const radians = ((degrees - 90) * Math.PI) / 180;
			return {
				x: center + (Math.cos(radians) * radius),
				y: center + (Math.sin(radians) * radius),
			};
		};

		const renderDonut = ({ donut, orbit, logoLayer, entries }) => {
			if (!entries.length) {
				donut.style.setProperty("--portfolio-donut-fill", fallbackDonutFill);
				logoLayer.innerHTML = "";
				return;
			}

			const colors = buildGradientColors(entries.length);
			if (!colors.length) {
				donut.style.setProperty("--portfolio-donut-fill", fallbackDonutFill);
				logoLayer.innerHTML = "";
				return;
			}
			const gapDegrees = 1.2;
			const donutSize = donut.clientWidth || 120;
			const logoSize = Number.parseFloat(getComputedStyle(donut).getPropertyValue("--portfolio-donut-logo-size")) || 20;
			const satelliteRadius = (logoSize * Math.SQRT2) / 2;
			const logoOrbitRadius = (donutSize / 2) + satelliteRadius;
			const orbitCenter = (orbit.clientWidth || donutSize) / 2;
			const stops = [];
			let angle = 0;
			const logoItems = [];

			entries.forEach((entry, index) => {
				const sweep = ((entry.weight || 0) / 100) * 360;
				const segmentEnd = angle + sweep;
				const coloredEnd = Math.max(angle, segmentEnd - gapDegrees);
				const coloredSweep = Math.max(0, coloredEnd - angle);
				stops.push(`${colors[index]} ${angle}deg ${coloredEnd}deg`);
				if (coloredEnd < segmentEnd) {
					stops.push(`transparent ${coloredEnd}deg ${segmentEnd}deg`);
				}
				const logoUrl = getPortfolioLogoUrl(entry.ticker);
				if (logoUrl && coloredSweep > 0) {
					logoItems.push({
						ticker: entry.ticker,
						logoUrl,
						midAngle: angle + (coloredSweep / 2),
					});
				}
				angle = segmentEnd;
			});

			donut.style.setProperty("--portfolio-donut-fill", `conic-gradient(${stops.join(", ")})`);

			logoLayer.innerHTML = logoItems.map((item) => {
				const point = angleToPoint(item.midAngle, orbitCenter, logoOrbitRadius);
				return `<img class="portfolio-donut-logo" src="${item.logoUrl}" alt="${item.ticker} logo" style="left:${point.x.toFixed(2)}px; top:${point.y.toFixed(2)}px;">`;
			}).join("");
		};

		const buildEndingEntries = (entries) => {
			const endingValues = entries.map((entry) => {
				const growthMultiple = getPortfolioItem(entry.ticker)?.growth_multiple || 1;
				return {
					...entry,
					endingValue: entry.weight * growthMultiple,
				};
			});
			const totalEndingValue = endingValues.reduce((sum, entry) => sum + entry.endingValue, 0);
			if (!totalEndingValue) return entries;
			return endingValues.map((entry) => ({
				...entry,
				weight: (entry.endingValue / totalEndingValue) * 100,
			}));
		};

		const renderPortfolioPreview = (entries = getPortfolioEntriesFromDom()) => {
			renderDonut({ donut: startDonut, orbit: startOrbit, logoLayer: startLogoLayer, entries });
			renderDonut({ donut: endDonut, orbit: endOrbit, logoLayer: endLogoLayer, entries: buildEndingEntries(entries) });
		};

		if (window.__antigravityPortfolioPreviewHandler) {
			window.removeEventListener("antigravity:portfolio-preview", window.__antigravityPortfolioPreviewHandler);
		}
		window.__antigravityPortfolioPreviewHandler = (event) => {
			renderPortfolioPreview(event.detail?.entries || []);
		};
		window.addEventListener("antigravity:portfolio-preview", window.__antigravityPortfolioPreviewHandler);

		if (window.__antigravityPortfolioThemeMedia && window.__antigravityPortfolioThemeHandler) {
			const { media, handler } = window.__antigravityPortfolioThemeMedia;
			if (typeof media.removeEventListener === "function") {
				media.removeEventListener("change", handler);
			} else if (typeof media.removeListener === "function") {
				media.removeListener(handler);
			}
		}
		const portfolioThemeMedia = window.matchMedia("(prefers-color-scheme: dark)");
		const handlePortfolioThemeChange = () => {
			window.requestAnimationFrame(() => {
				const activeAccent = readThemeToken("--theme-accent-primary");
				if (!activeAccent) return;
				renderPortfolioPreview();
			});
		};
		if (typeof portfolioThemeMedia.addEventListener === "function") {
			portfolioThemeMedia.addEventListener("change", handlePortfolioThemeChange);
		} else if (typeof portfolioThemeMedia.addListener === "function") {
			portfolioThemeMedia.addListener(handlePortfolioThemeChange);
		}
		window.__antigravityPortfolioThemeMedia = { media: portfolioThemeMedia, handler: handlePortfolioThemeChange };

		renderPortfolioPreview();
	};

	bootstrap.initPortfolioWorkspace = initPortfolioWorkspace;
	initPortfolioWorkspace();
})();
