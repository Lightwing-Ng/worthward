/* Code version: v1.0.0 */
(() => {
	const state = window.ANTIGRAVITY_APP;
	if (!state || state.currentView !== "portfolio") return;

	const donut = document.getElementById("portfolio_donut");
	const orbit = document.getElementById("portfolio_donut_orbit");
	const logoLayer = document.getElementById("portfolio_donut_logo_layer");
	if (!donut || !orbit || !logoLayer) return;

	const buildGradientColors = (count) => {
		if (count <= 1) return [state.theme?.accent_primary || "#0055cc"];
		const hexToRgb = (value) => {
			const raw = value.replace("#", "");
			return [
				Number.parseInt(raw.slice(0, 2), 16),
				Number.parseInt(raw.slice(2, 4), 16),
				Number.parseInt(raw.slice(4, 6), 16),
			];
		};
		const rgbToHex = ([r, g, b]) => `#${[r, g, b].map((item) => item.toString(16).padStart(2, "0")).join("")}`;
		const start = hexToRgb(state.theme?.accent_primary || "#0055cc");
		const end = hexToRgb(state.theme?.accent_secondary || "#ff2f92");
		return Array.from({ length: count }, (_item, index) => {
			const ratio = index / (count - 1);
			return rgbToHex(start.map((channel, channelIndex) => Math.round(channel + ((end[channelIndex] - channel) * ratio))));
		});
	};

	const getPortfolioLogoUrl = (ticker) => state.portfolio?.items?.find((item) => item.ticker === ticker)?.logo_url || "";

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

	const chordDistance = (leftAngle, rightAngle, radius) => {
		const deltaRadians = (Math.abs(rightAngle - leftAngle) * Math.PI) / 180;
		return 2 * radius * Math.sin(deltaRadians / 2);
	};

	const placeLogoItems = (logoItems, logoOrbitRadius, minimumCenterDistance) => {
		if (!logoItems.length) return [];
		const minimumAngularGap = (2 * Math.asin(Math.min(1, minimumCenterDistance / (2 * logoOrbitRadius))) * 180) / Math.PI;
		const placedItems = logoItems
			.map((item, index) => ({ ...item, index, placedAngle: item.midAngle }))
			.sort((left, right) => left.midAngle - right.midAngle);
		for (let pass = 0; pass < placedItems.length * 3; pass += 1) {
			let changed = false;
			for (let index = 0; index < placedItems.length - 1; index += 1) {
				const current = placedItems[index];
				const next = placedItems[index + 1];
				const currentDistance = chordDistance(current.placedAngle, next.placedAngle, logoOrbitRadius);
				if (currentDistance >= minimumCenterDistance) continue;
				const deficit = minimumAngularGap - Math.abs(next.placedAngle - current.placedAngle);
				if (deficit <= 0) continue;
				const currentPush = Math.max(0, current.sweep - minimumAngularGap) > 0 ? deficit / 2 : 0;
				const nextPush = Math.max(0, next.sweep - minimumAngularGap) > 0 ? deficit / 2 : 0;
				if (currentPush > 0) current.placedAngle -= currentPush;
				if (nextPush > 0) next.placedAngle += nextPush;
				if (currentPush === 0 && nextPush === 0) {
					current.placedAngle -= deficit / 2;
					next.placedAngle += deficit / 2;
				}
				changed = true;
			}
			if (!changed) break;
		}
		return placedItems;
	};

	const renderPortfolioPreview = (entries = getPortfolioEntriesFromDom()) => {
		if (!entries.length) {
			donut.style.setProperty("--portfolio-donut-fill", "rgba(148, 163, 184, 0.16)");
			logoLayer.innerHTML = "";
			return;
		}

		const colors = buildGradientColors(entries.length);
		const gapDegrees = 1.2;
		const donutSize = donut.clientWidth || 120;
		const logoSize = Number.parseFloat(getComputedStyle(donut).getPropertyValue("--portfolio-donut-logo-size")) || 20;
		const logoGap = Number.parseFloat(getComputedStyle(donut).getPropertyValue("--portfolio-donut-logo-gap")) || 10;
		const logoPadding = Math.max(6, logoGap);
		const logoOrbitRadius = (donutSize / 2) + (logoSize / 2) + logoGap;
		const orbitCenter = (orbit.clientWidth || donutSize) / 2;
		const stops = [];
		let angle = 0;
		const logoItems = [];

		entries.forEach((entry, index) => {
			const sweep = ((entry.weight || 0) / 100) * 360;
			const segmentEnd = angle + sweep;
			const coloredEnd = Math.max(angle, segmentEnd - gapDegrees);
			stops.push(`${colors[index]} ${angle}deg ${coloredEnd}deg`);
			if (coloredEnd < segmentEnd) {
				stops.push(`transparent ${coloredEnd}deg ${segmentEnd}deg`);
			}
			const logoUrl = getPortfolioLogoUrl(entry.ticker);
			if (logoUrl && sweep > 0) {
				logoItems.push({
					ticker: entry.ticker,
					logoUrl,
					midAngle: angle + (sweep / 2),
					sweep,
				});
			}
			angle = segmentEnd;
		});

		donut.style.setProperty("--portfolio-donut-fill", `conic-gradient(${stops.join(", ")})`);

		const placedItems = placeLogoItems(logoItems, logoOrbitRadius, logoSize + logoPadding);
		logoLayer.innerHTML = placedItems.map((item) => {
			const point = angleToPoint(item.placedAngle, orbitCenter, logoOrbitRadius);
			return `<img class="portfolio-donut-logo" src="${item.logoUrl}" alt="${item.ticker} logo" style="left:${point.x.toFixed(2)}px; top:${point.y.toFixed(2)}px;">`;
		}).join("");
	};

	window.addEventListener("antigravity:portfolio-preview", (event) => {
		renderPortfolioPreview(event.detail?.entries || []);
	});

	renderPortfolioPreview();
})();
