/* Code version: v3.9.2 */
(() => {
	const state = window.ANTIGRAVITY_APP;
	if (!state) return;

	const { defaults, labels, endpoints, constraints, theme } = state;
	const isPortfolioView = state.currentView === "portfolio";
	const MIN_TICKERS = constraints?.minTickers || 2;
	const MAX_TICKERS = constraints?.maxTickers || 5;
	const tickerPattern = /^[A-Z0-9][A-Z0-9.-]{0,14}$/;
	const sanitizeTicker = (value) => value.toUpperCase().replace(/[^A-Z0-9.-]/g, "").slice(0, 15);
	const $ = (selector) => document.querySelector(selector);
	const $$ = (selector) => Array.from(document.querySelectorAll(selector));
	const UNKNOWN_MESSAGE = "Unknown or unsupported ticker.";
	const hasInitialResult = Boolean(state.chart?.series?.length);
	let autoSubmitTimer = null;
	let dockFrame = 0;
	const portfolioWeightState = {
		clock: 0,
		touchedAtByIndex: {},
	};
	const settingsActionOverlay = $("#settings_action_overlay");
	const settingsActionOverlayClose = $("#settings_action_overlay_close");
	const settingsActionOverlayTitle = settingsActionOverlay?.querySelector(".settings-action-title");
	const settingsActionOverlayCopy = settingsActionOverlay?.querySelector(".settings-action-copy");
	const settingsActionOverlayIcon = $("#settings_action_overlay_icon");

	const getTickerFields = () => $$(".ticker-field");
	const getTickerInputs = () => getTickerFields().map((field) => field.querySelector('input[name^="ticker_"]')).filter(Boolean);
	const getFilledTickers = () => getTickerInputs().map((input) => sanitizeTicker(input.value.trim())).filter(Boolean);
	const getWeightFields = () => getTickerFields().map((field, index) => ({
		index,
		field,
		number: field.querySelector('.portfolio-weight-input'),
		slider: field.querySelector('.portfolio-weight-slider'),
		tickerInput: field.querySelector('input[name^="ticker_"]'),
		tooltip: field.querySelector('.portfolio-weight-tooltip'),
	})).filter((item) => item.number && item.slider && item.tickerInput);

	const syncTickerClearButton = (input) => {
		const clearButton = input?.parentElement?.querySelector(".ticker-clear");
		if (!clearButton || !input) return;
		clearButton.classList.toggle("is-visible", Boolean(input.value.trim()));
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
		getFilledWeightEntries().forEach((entry) => {
			if (!getPortfolioWeightTouchStamp(entry.index)) {
				markPortfolioWeightTouched(entry.index);
			}
		});
		const activeIndexes = new Set(getFilledWeightEntries().map((entry) => entry.index));
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
			const input = field.querySelector('input[name^="ticker_"]');
			const suggestions = field.querySelector(".suggestions");
			if (label) {
				label.setAttribute("for", `ticker_${index}`);
				label.textContent = `Ticker ${index}`;
			}
			if (input) {
				input.id = `ticker_${index}`;
				input.name = `ticker_${index}`;
				input.required = index <= MIN_TICKERS;
				input.placeholder = "";
				syncTickerClearButton(input);
			}
			const weightInput = field.querySelector(".portfolio-weight-input");
			const weightSlider = field.querySelector(".portfolio-weight-slider");
			if (weightInput && weightSlider) {
				weightInput.id = `weight_${index}`;
				weightInput.name = `weight_${index}`;
				weightSlider.dataset.index = String(index);
			}
			if (suggestions) suggestions.id = `ticker_${index}_suggestions`;
			const removeButton = field.querySelector(".ticker-remove");
			if (removeButton) {
				removeButton.classList.toggle("is-placeholder", index <= MIN_TICKERS);
				removeButton.tabIndex = index <= MIN_TICKERS ? -1 : 0;
				removeButton.setAttribute("aria-hidden", index <= MIN_TICKERS ? "true" : "false");
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

	const buildGradientColors = (count) => {
		if (count <= 1) return [theme.accent_primary || "#0055cc"];
		const hexToRgb = (value) => {
			const raw = value.replace("#", "");
			return [Number.parseInt(raw.slice(0, 2), 16), Number.parseInt(raw.slice(2, 4), 16), Number.parseInt(raw.slice(4, 6), 16)];
		};
		const rgbToHex = ([r, g, b]) => `#${[r, g, b].map((item) => item.toString(16).padStart(2, "0")).join("")}`;
		const start = hexToRgb(theme.accent_primary || "#0055cc");
		const end = hexToRgb(theme.accent_secondary || "#ff2f92");
		return Array.from({ length: count }, (_item, index) => {
			const ratio = index / (count - 1);
			return rgbToHex(start.map((channel, channelIndex) => Math.round(channel + ((end[channelIndex] - channel) * ratio))));
		});
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
				`${passiveEntry.ticker} is currently the oldest untouched weight, so ${activeEntry.ticker} was limited to keep the total at 100%.`,
			);
		}
		markPortfolioWeightTouched(changedIndex);
		syncPortfolioWeightBounds();
	};

	const updatePortfolioPreview = () => {
		if (!isPortfolioView) return;
		const donut = $("#portfolio_donut");
		const logoLayer = $("#portfolio_donut_logo_layer");
		if (!donut) return;
		const filledEntries = getFilledWeightEntries();
		if (!filledEntries.length) {
			donut.style.background = "rgba(148, 163, 184, 0.16)";
			if (logoLayer) logoLayer.innerHTML = "";
			return;
		}
		const colors = buildGradientColors(filledEntries.length);
		const stops = [];
		let angle = 0;
		const gapDegrees = 1.2;
		const donutSize = donut.clientWidth || 120;
		const logoSize = Number.parseFloat(getComputedStyle(donut).getPropertyValue("--portfolio-donut-logo-size")) || 20;
		const logoGap = Number.parseFloat(getComputedStyle(donut).getPropertyValue("--portfolio-donut-logo-gap")) || 10;
		const logoPadding = Math.max(6, logoGap);
		const outerRadius = donutSize / 2;
		const logoOrbitRadius = outerRadius + (logoSize / 2) + logoGap;
		const logoItems = [];
		filledEntries.forEach((entry, index) => {
			const value = Number.parseInt(entry.number.value, 10) || 0;
			const sweep = (value / 100) * 360;
			const segmentEnd = angle + sweep;
			const coloredEnd = Math.max(angle, segmentEnd - gapDegrees);
			stops.push(`${colors[index]} ${angle}deg ${coloredEnd}deg`);
			if (coloredEnd < segmentEnd) {
				stops.push(`transparent ${coloredEnd}deg ${segmentEnd}deg`);
			}
			const logoUrl = state.portfolio?.items?.find((item) => item.ticker === entry.ticker)?.logo_url || "";
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
		donut.style.background = `conic-gradient(${stops.join(", ")})`;
		if (!logoLayer) return;
		if (!logoItems.length) {
			logoLayer.innerHTML = "";
			return;
		}

		const angleToPoint = (degrees) => {
			const radians = ((degrees - 90) * Math.PI) / 180;
			return {
				x: Math.cos(radians) * logoOrbitRadius,
				y: Math.sin(radians) * logoOrbitRadius,
			};
		};
		const chordDistance = (leftAngle, rightAngle) => {
			const deltaRadians = (Math.abs(rightAngle - leftAngle) * Math.PI) / 180;
			return 2 * logoOrbitRadius * Math.sin(deltaRadians / 2);
		};
		const minimumCenterDistance = logoSize + logoPadding;
		const minimumAngularGap = (2 * Math.asin(Math.min(1, minimumCenterDistance / (2 * logoOrbitRadius))) * 180) / Math.PI;
		const placedItems = logoItems
			.map((item, index) => ({ ...item, index, placedAngle: item.midAngle }))
			.sort((left, right) => left.midAngle - right.midAngle);
		for (let pass = 0; pass < placedItems.length * 3; pass += 1) {
			let changed = false;
			for (let index = 0; index < placedItems.length - 1; index += 1) {
				const current = placedItems[index];
				const next = placedItems[index + 1];
				const currentDistance = chordDistance(current.placedAngle, next.placedAngle);
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
		logoLayer.innerHTML = placedItems.map((item) => {
			const point = angleToPoint(item.placedAngle);
			return `<img class="portfolio-donut-logo" src="${item.logoUrl}" alt="${item.ticker} logo" style="transform: translate(calc(-50% + ${point.x.toFixed(2)}px), calc(-50% + ${point.y.toFixed(2)}px));">`;
		}).join("");
	};

	const attachPortfolioWeightHandlers = () => {
		if (!isPortfolioView) return;
		getWeightFields().forEach(({ field, number, slider, tickerInput, index }) => {
			if (number.dataset.bound === "1") return;
			number.dataset.bound = "1";
			const syncAndRefresh = (source) => {
				const value = Math.min(100, Math.max(0, Number.parseInt(String(source.value || 0), 10) || 0));
				number.value = String(value);
				slider.value = String(value);
				rebalancePortfolioWeights(index);
				updatePortfolioPreview();
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
				const ticker = sanitizeTicker(tickerInput.value.trim());
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
				updatePortfolioPreview();
			});
		});
	};

	const validateTickerInput = (input) => {
		const value = sanitizeTicker(input.value.trim());
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
							<button type="button" class="suggestion-item" data-symbol="${item.symbol}">
								<span class="suggestion-row">
									${item.logo_url ? `<img class="suggestion-logo" src="${item.logo_url}" alt="${item.symbol} logo">` : ""}
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
					input.value = button.dataset.symbol;
					validateAllTickerInputs();
					closePanel();
					input.focus();
					syncDateConstraints();
				});
			});
		};

		input.addEventListener("input", async () => {
			const query = validateTickerInput(input);
			if (!query) {
				setUnknown(false);
				await showRecentItems();
				return;
			}
			if (controller) controller.abort();
			controller = new AbortController();
			try {
				const response = await fetch(`${endpoints.symbolSearch}?q=${encodeURIComponent(query)}`, { signal: controller.signal });
				if (!response.ok) return closePanel();
				const payload = await response.json();
				if (!payload.length) {
					setUnknown(true);
					closePanel();
					return;
				}
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
		input.addEventListener("blur", () => window.setTimeout(closePanel, 120));
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
				const input = button.parentElement?.querySelector('input[name^="ticker_"]');
				if (!input) return;
				input.value = "";
				input.dataset.unknown = "";
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
		if (window.matchMedia("(max-width: 820px)").matches) {
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
			title: "Preparing your chart",
			copy: "Please wait while the app checks local data and prepares the chart. This may take a little longer for a new ticker.",
			iconClass: "icon-overlay-processing",
		});
	};

	const hideSettingsActionOverlay = () => {
		if (!settingsActionOverlay) return;
		settingsActionOverlay.hidden = true;
	};

	const attachRemoveHandlers = () => {
		$$(".ticker-remove").forEach((button) => {
			if (button.dataset.bound === "1") return;
			button.dataset.bound = "1";
			button.addEventListener("click", () => {
				button.closest(".ticker-field")?.remove();
				reindexTickerFields();
				if (isPortfolioView) {
					ensurePortfolioWeightTouches();
					syncPortfolioWeightBounds();
					updatePortfolioPreview();
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
						<input id="ticker_${index}" name="ticker_${index}" value="${value}" placeholder="e.g. NVDA" autocomplete="off" autocapitalize="characters" spellcheck="false" inputmode="latin" pattern="[A-Za-z0-9.-]{1,15}" title="Use a valid ticker such as MSFT, GOOGL, NVDA, AMZN, MU, AMD, or META.">
						<button type="button" class="ticker-clear" aria-label="Clear ticker"><span class="icon icon-remove-muted" aria-hidden="true"></span></button>
					</div>
					<div class="field-tooltip field-tooltip-duplicate" hidden>This ticker is already used. Choose a different one.</div>
					<div class="field-tooltip field-tooltip-invalid" hidden>Unknown or unsupported ticker.</div>
					<div class="suggestions" id="ticker_${index}_suggestions"></div>
				</div>
				${isPortfolioView ? `
				<div class="portfolio-weight-field">
					<div class="portfolio-weight-row">
						<input id="weight_${index}" name="weight_${index}" class="portfolio-weight-input" type="number" min="0" max="100" step="1" value="0" placeholder="${labels.portfolio_weight}" aria-label="${labels.portfolio_weight}">
						<span class="portfolio-weight-unit">%</span>
					</div>
					<input class="portfolio-weight-slider" type="range" min="0" max="100" step="1" value="0" aria-label="${labels.portfolio_weight}">
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
		const input = field.querySelector('input[name^="ticker_"]');
		setupAutocomplete(input);
		validateAllTickerInputs();
		syncPortfolioWeightDisabledState();
		updatePortfolioPreview();
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
		while (getTickerFields().length > Math.max(MIN_TICKERS, values.length)) {
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
		while (getTickerFields().length < Math.max(MIN_TICKERS, values.length)) {
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
	const rangeModeInputs = $$("input[name='range_mode']");
	const exactStartInput = $("#exact_start");
	const exactEndInput = $("#exact_end");
	const includeDividendsInput = $("#include_dividends");
	const dateAdjustTooltip = $("#date_adjust_tooltip");

	const updateRangePanels = () => {
		const rangeMode = $("input[name='range_mode']:checked")?.value || defaults.range_mode;
		const rangeShell = $(".range-mode-shell");
		if (rangeShell) {
			rangeShell.dataset.active = rangeMode;
			rangeShell.style.setProperty("--range-shift", rangeMode === "exact" ? "100%" : "0%");
		}
		if (periodPanel) periodPanel.hidden = rangeMode !== "period";
		if (exactPanel) exactPanel.hidden = rangeMode !== "exact";
	};

	const canAutoSubmit = () => {
		if (!hasInitialResult || !form) return false;
		const values = compactTickerInputs();
		if (values.length < MIN_TICKERS) return false;
		if (new Set(values).size !== values.length) return false;
		if (isPortfolioView) {
			const totalWeight = getFilledWeightEntries().reduce((sum, entry) => sum + (Number.parseInt(entry.number.value, 10) || 0), 0);
			if (totalWeight !== 100) return false;
		}
		validateAllTickerInputs();
		if (getTickerInputs().some((input) => !input.checkValidity() || input.dataset.unknown === "1")) return false;
		const rangeMode = $("input[name='range_mode']:checked")?.value || defaults.range_mode;
		if (rangeMode === "exact" && (!exactStartInput?.value || !exactEndInput?.value)) return false;
		return true;
	};

	const scheduleAutoSubmit = (delay = 240) => {
		if (!canAutoSubmit()) return;
		if (autoSubmitTimer) window.clearTimeout(autoSubmitTimer);
		autoSubmitTimer = window.setTimeout(() => {
			if (!canAutoSubmit()) return;
			showCompareOverlay();
			form.requestSubmit();
		}, delay);
	};

	const setDateTooltip = (message) => {
		if (!dateAdjustTooltip) return;
		dateAdjustTooltip.hidden = !message;
		dateAdjustTooltip.textContent = message || "";
	};

	const syncDateConstraints = async () => {
		if (!exactStartInput || !exactEndInput || !includeDividendsInput) return;
		const tickers = getFilledTickers();
		if (tickers.length < MIN_TICKERS || new Set(tickers).size !== tickers.length) return;
		const params = new URLSearchParams({
			include_dividends: includeDividendsInput.checked ? "1" : "0",
			exact_start: exactStartInput.value,
			exact_end: exactEndInput.value,
		});
		tickers.forEach((ticker, index) => params.append(`ticker_${index + 1}`, ticker));
		try {
			const response = await fetch(`${endpoints.dateConstraints}?${params.toString()}`);
			if (!response.ok) return;
			const payload = await response.json();
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
			const adjustedStart = enforceTradingDate(exactStartInput, payload.adjusted_start);
			const adjustedEnd = enforceTradingDate(exactEndInput, payload.adjusted_end);
			setDateTooltip(payload.message || (adjustedStart || adjustedEnd ? labels.date_adjusted_fallback : ""));
		} catch (_error) {
		}
	};

	getTickerInputs().forEach((input) => setupAutocomplete(input));
	attachRemoveHandlers();
	attachTickerClearHandlers();
	attachPortfolioWeightHandlers();
	reindexTickerFields();
	validateAllTickerInputs();
	syncPortfolioWeightDisabledState();
	ensurePortfolioWeightTouches();
	syncPortfolioWeightBounds();
	updatePortfolioPreview();
	updateRangePanels();
	syncDateConstraints();
	scheduleDockPosition();

	$("#add_ticker")?.addEventListener("click", () => addTickerField());
	rangeModeInputs.forEach((input) => input.addEventListener("change", () => {
		const rangeShell = $(".range-mode-shell");
		if (rangeShell) {
			rangeShell.classList.add("is-animating");
			window.setTimeout(() => rangeShell.classList.remove("is-animating"), 220);
		}
		updateRangePanels();
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
			compactTickerInputs();
			scheduleAutoSubmit(80);
		});
	}
	$("#period")?.addEventListener("change", () => {
		compactTickerInputs();
		scheduleAutoSubmit();
	});

	if (form) {
		form.addEventListener("submit", (event) => {
			const values = compactTickerInputs();
			validateAllTickerInputs();
			if (values.length < MIN_TICKERS) {
				event.preventDefault();
				getTickerInputs()[0]?.reportValidity();
				return;
			}
			if (new Set(values).size !== values.length) {
				event.preventDefault();
				getTickerInputs().find((input) => input.validationMessage)?.reportValidity();
				return;
			}
			if (isPortfolioView) {
				const totalWeight = getFilledWeightEntries().reduce((sum, entry) => sum + (Number.parseInt(entry.number.value, 10) || 0), 0);
				if (totalWeight !== 100) {
					event.preventDefault();
					return;
				}
			}
			showCompareOverlay();
		});
	}

	$$(".settings-action-form").forEach((formElement) => {
		formElement.addEventListener("submit", () => {
			const actionInput = formElement.querySelector('input[name="action"]');
			if (actionInput?.value === "refresh") {
				showSettingsActionOverlay({
					title: "Updating local market data",
					copy: "We are checking what is missing and refreshing the local market store. This can take a moment.",
					iconClass: "icon-overlay-processing",
				});
			}
		});
	});
	$(".settings-nav-network")?.addEventListener("click", () => {
		showSettingsActionOverlay({
			title: "Checking network status",
			copy: "We are checking whether market data and logo services are available from this device.",
			iconClass: "icon-overlay-network",
		});
	});
	settingsActionOverlayClose?.addEventListener("click", hideSettingsActionOverlay);

	window.addEventListener("resize", scheduleDockPosition);
	window.addEventListener("orientationchange", scheduleDockPosition);
	window.addEventListener("pageshow", scheduleDockPosition);
})();
