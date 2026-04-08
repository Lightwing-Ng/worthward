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
				const tickerInput = field.querySelector('[data-ticker-input]') || field.querySelector('input[name="ticker"]');
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
		const getPortfolioEntriesFromUrl = () => {
			const search = new URLSearchParams(window.location.search);
			const tickers = search.getAll("ticker");
			const weights = search.getAll("weight");
			return tickers
				.map((ticker, index) => {
					const normalizedTicker = String(ticker || "").trim().toUpperCase();
					if (!normalizedTicker) return null;
					return {
						index,
						ticker: normalizedTicker,
						weight: Number.parseInt(weights[index] || "0", 10) || 0,
					};
				})
				.filter(Boolean);
		};

		const angleToPoint = (degrees, center, radius) => {
			const radians = ((degrees - 90) * Math.PI) / 180;
			return {
				x: center + (Math.cos(radians) * radius),
				y: center + (Math.sin(radians) * radius),
			};
		};

		const ensureAnimatedDonutLayers = (donut) => {
			if (!(donut instanceof HTMLElement)) return [];
			donut.classList.add("is-animated");
			let fillLayerA = donut.querySelector(".portfolio-donut-fill-layer-a");
			let fillLayerB = donut.querySelector(".portfolio-donut-fill-layer-b");
			if (!(fillLayerA instanceof HTMLElement)) {
				fillLayerA = document.createElement("span");
				fillLayerA.className = "portfolio-donut-fill-layer portfolio-donut-fill-layer-a";
				donut.appendChild(fillLayerA);
			}
			if (!(fillLayerB instanceof HTMLElement)) {
				fillLayerB = document.createElement("span");
				fillLayerB.className = "portfolio-donut-fill-layer portfolio-donut-fill-layer-b";
				donut.appendChild(fillLayerB);
			}
			return [fillLayerA, fillLayerB];
		};

		const applyAnimatedDonutFill = (donut, fill) => {
			if (!(donut instanceof HTMLElement)) return;
			const [fillLayerA, fillLayerB] = ensureAnimatedDonutLayers(donut);
			if (!(fillLayerA instanceof HTMLElement) || !(fillLayerB instanceof HTMLElement)) {
				donut.style.setProperty("--portfolio-donut-fill", fill);
				return;
			}
			const activeLayerKey = donut.dataset.activeFillLayer === "b" ? "b" : "a";
			const nextLayerKey = activeLayerKey === "a" ? "b" : "a";
			const nextLayer = nextLayerKey === "a" ? fillLayerA : fillLayerB;
			nextLayer.style.background = fill;
			donut.dataset.activeFillLayer = nextLayerKey;
			donut.style.setProperty("--portfolio-donut-fill", fill);
		};

		const syncAnimatedDonutLogos = ({ logoLayer, logoItems, orbitCenter, logoOrbitRadius }) => {
			if (!(logoLayer instanceof HTMLElement)) return;
			const existingLogos = new Map(
				Array.from(logoLayer.querySelectorAll(".portfolio-donut-logo")).map((logo) => [logo.dataset.ticker || "", logo])
			);
			const nextTickers = new Set();
			logoItems.forEach((item) => {
				nextTickers.add(item.ticker);
				const point = angleToPoint(item.midAngle, orbitCenter, logoOrbitRadius);
				let logo = existingLogos.get(item.ticker);
				if (!(logo instanceof HTMLImageElement)) {
					logo = document.createElement("img");
					logo.className = "portfolio-donut-logo";
					logo.dataset.ticker = item.ticker;
					logo.alt = `${item.ticker} logo`;
					logo.src = item.logoUrl;
					logo.style.opacity = "0";
					logoLayer.appendChild(logo);
					window.requestAnimationFrame(() => {
						logo.style.opacity = "1";
					});
				} else if (logo.src !== item.logoUrl) {
					logo.src = item.logoUrl;
				}
				logo.style.left = `${point.x.toFixed(2)}px`;
				logo.style.top = `${point.y.toFixed(2)}px`;
				logo.classList.remove("is-exiting");
			});
			existingLogos.forEach((logo, ticker) => {
				if (nextTickers.has(ticker)) return;
				logo.classList.add("is-exiting");
				window.setTimeout(() => {
					if (logo.classList.contains("is-exiting")) logo.remove();
				}, 220);
			});
		};

		const renderDonut = ({ donut, orbit, logoLayer, entries }) => {
			if (!entries.length) {
				applyAnimatedDonutFill(donut, fallbackDonutFill);
				syncAnimatedDonutLogos({ logoLayer, logoItems: [], orbitCenter: 0, logoOrbitRadius: 0 });
				return;
			}

			const colors = buildGradientColors(entries.length);
			if (!colors.length) {
				applyAnimatedDonutFill(donut, fallbackDonutFill);
				syncAnimatedDonutLogos({ logoLayer, logoItems: [], orbitCenter: 0, logoOrbitRadius: 0 });
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

			applyAnimatedDonutFill(donut, `conic-gradient(${stops.join(", ")})`);
			syncAnimatedDonutLogos({ logoLayer, logoItems, orbitCenter, logoOrbitRadius });
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

		let lastResolvedEntries = [];
		const resolvePreviewEntries = (entries) => {
			if (Array.isArray(entries) && entries.length) {
				lastResolvedEntries = entries;
				return entries;
			}
			const domEntries = getPortfolioEntriesFromDom();
			if (domEntries.length) {
				lastResolvedEntries = domEntries;
				return domEntries;
			}
			const urlEntries = getPortfolioEntriesFromUrl();
			if (urlEntries.length) {
				lastResolvedEntries = urlEntries;
				return urlEntries;
			}
			return Array.isArray(entries) ? entries : lastResolvedEntries;
		};

		const renderPortfolioPreview = (entries = getPortfolioEntriesFromDom()) => {
			const resolvedEntries = resolvePreviewEntries(entries);
			renderDonut({ donut: startDonut, orbit: startOrbit, logoLayer: startLogoLayer, entries: resolvedEntries });
			renderDonut({ donut: endDonut, orbit: endOrbit, logoLayer: endLogoLayer, entries: buildEndingEntries(resolvedEntries) });
		};

		if (window.__antigravityPortfolioPreviewHandler) {
			window.removeEventListener("antigravity:portfolio-preview", window.__antigravityPortfolioPreviewHandler);
		}
		window.__antigravityPortfolioPreviewHandler = (event) => {
			renderPortfolioPreview(resolvePreviewEntries(event.detail?.entries));
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

		if (window.__antigravityPortfolioGeometrySync) {
			const { observer, resizeHandler, cancelFrame } = window.__antigravityPortfolioGeometrySync;
			observer?.disconnect?.();
			window.removeEventListener("resize", resizeHandler);
			cancelFrame?.();
		}
		let geometryFrame = 0;
		const scheduleGeometryRender = () => {
			if (geometryFrame) window.cancelAnimationFrame(geometryFrame);
			geometryFrame = window.requestAnimationFrame(() => {
				geometryFrame = 0;
				renderPortfolioPreview();
			});
		};
		const handleGeometryResize = () => {
			scheduleGeometryRender();
		};
		const geometryObserver = typeof window.ResizeObserver === "function"
			? new ResizeObserver(() => {
				scheduleGeometryRender();
			})
			: null;
		[startDonut, startOrbit, endDonut, endOrbit].forEach((element) => {
			geometryObserver?.observe(element);
		});
		window.addEventListener("resize", handleGeometryResize, { passive: true });
		window.__antigravityPortfolioGeometrySync = {
			observer: geometryObserver,
			resizeHandler: handleGeometryResize,
			cancelFrame: () => {
				if (!geometryFrame) return;
				window.cancelAnimationFrame(geometryFrame);
				geometryFrame = 0;
			},
		};

		renderPortfolioPreview();
	};

	bootstrap.initPortfolioWorkspace = initPortfolioWorkspace;
	initPortfolioWorkspace();
})();
