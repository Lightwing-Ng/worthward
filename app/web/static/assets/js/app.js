/* Code version: v3.19.1 */
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
	const hasInitialResult = Boolean(state.chart?.series?.length);
	let autoSubmitTimer = null;
	let dockFrame = 0;
	let isSubmittingWithOverlay = false;
	let compareOverlayTimer = null;
	const datePickerState = [];
	let validTradingDateSet = null;
	const portfolioWeightState = {
		clock: 0,
		touchedAtByIndex: {},
	};
	const settingsActionOverlay = $("#settings_action_overlay");
	const settingsActionOverlayClose = $("#settings_action_overlay_close");
	const settingsActionOverlayTitle = settingsActionOverlay?.querySelector(".settings-action-title");
	const settingsActionOverlayCopy = settingsActionOverlay?.querySelector(".settings-action-copy");
	const settingsActionOverlayIcon = $("#settings_action_overlay_icon");

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
		const syncPanels = () => {
			const active = shell.querySelector('input[name="trade_detail_tab"]:checked')?.value || "metrics";
			shell.dataset.active = active === "transactions" ? "exact" : "period";
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
		const viewByDockIndex = ["tickers", "portfolio", "trade-messages", "settings"];
		$$(".sidebar-dock-item").forEach((link, index) => {
			const targetView = viewByDockIndex[index];
			if (!targetView || link.dataset.boundDockMemory === "1") return;
			link.dataset.boundDockMemory = "1";
			link.addEventListener("click", (event) => {
				rememberCurrentViewUrl();
				const memory = readViewMemory();
				const rememberedUrl = memory[targetView];
				if (!rememberedUrl) return;
				const fallbackUrl = link.getAttribute("href") || "";
				if (!fallbackUrl || rememberedUrl === fallbackUrl) return;
				event.preventDefault();
				window.location.assign(rememberedUrl);
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
				dispatchPortfolioPreviewUpdate();
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
				dispatchPortfolioPreviewUpdate();
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
			input.value = item.symbol;
			input.dataset.unknown = "";
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
				button.closest(".ticker-field")?.remove();
				reindexTickerFields();
				if (isPortfolioView) {
					ensurePortfolioWeightTouches();
					syncPortfolioWeightBounds();
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
	const displayDateFormatter = new Intl.DateTimeFormat("en-US", {
		day: "numeric",
		month: "short",
		year: "numeric",
		timeZone: "UTC",
	});
	const monthDateFormatter = new Intl.DateTimeFormat("en-US", {
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
		return `${date.getUTCDate()} ${date.toLocaleString("en-US", { month: "short", timeZone: "UTC" })} ${date.getUTCFullYear()}`;
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
		if (periodPanel) periodPanel.hidden = rangeMode !== "period";
		if (exactPanel) exactPanel.hidden = rangeMode !== "exact";
	};

	const canAutoSubmit = () => {
		if (!hasInitialResult || !form) return false;
		const values = compactTickerInputs();
		if (values.length < minimumRequiredTickers) return false;
		if (new Set(values).size !== values.length) return false;
		if (isPortfolioView) {
			const totalWeight = getFilledWeightEntries().reduce((sum, entry) => sum + (Number.parseInt(entry.number.value, 10) || 0), 0);
			if (totalWeight !== 100) return false;
		}
		validateAllTickerInputs();
		if (getTickerInputs().some((input) => !input.checkValidity() || input.dataset.unknown === "1")) return false;
		const rangeMode = $("input[name='range']:checked")?.value || defaults.range_mode;
		if (rangeModeInputs.length && rangeMode === "exact" && (!exactStartInput?.value || !exactEndInput?.value)) return false;
		return true;
	};

	const scheduleAutoSubmit = (delay = 240) => {
		if (!canAutoSubmit()) return;
		if (autoSubmitTimer) window.clearTimeout(autoSubmitTimer);
		autoSubmitTimer = window.setTimeout(() => {
			if (!canAutoSubmit()) return;
			form.requestSubmit();
		}, delay);
	};

	const closeAllDatePickers = () => {
		datePickerState.forEach((picker) => {
			picker.popover.hidden = true;
			picker.trigger.setAttribute("aria-expanded", "false");
		});
	};

	const positionDatePickerPopover = (picker) => {
		const sidebar = $(".sidebar");
		const triggerRect = picker.trigger.getBoundingClientRect();
		const sidebarRect = sidebar?.getBoundingClientRect();
		const popoverWidth = Math.min(320, window.innerWidth - 48);
		const leftBoundary = sidebarRect ? Math.max(12, sidebarRect.left + 12) : 12;
		const rightBoundary = sidebarRect ? Math.min(window.innerWidth - 12, sidebarRect.right - 12) : window.innerWidth - 12;
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
			wrapper.querySelectorAll("[data-date-nav]").forEach((button) => {
				button.addEventListener("click", () => {
					picker.visibleMonth = addMonthsUtc(picker.visibleMonth || startOfMonthUtc(new Date()), Number.parseInt(button.dataset.dateNav || "0", 10));
					syncDatePickerView(picker);
				});
			});
		});
		document.addEventListener("click", (event) => {
			if (event.target.closest("[data-date-picker]")) return;
			closeAllDatePickers();
		}, { passive: true });
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
		const tickers = compactTickerInputs();
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
	attachNoticeHandlers();
	attachTradeDetailTabs();
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
			compactTickerInputs();
			scheduleAutoSubmit(80);
		});
	}
	$("#period")?.addEventListener("change", () => {
		compactTickerInputs();
		scheduleAutoSubmit();
	});

	if (isTradeMessagesView && tradeCapitalField && tradeCapitalInput && tradeCapitalSlider) {
		const openTradeCapitalSlider = () => tradeCapitalField.classList.add("is-open");
		const closeTradeCapitalSlider = () => window.setTimeout(() => {
			if (tradeCapitalField.matches(":focus-within")) return;
			tradeCapitalField.classList.remove("is-open");
			tradeCapitalInput.value = formatTradeCapitalValue(parseTradeCapitalValue(tradeCapitalInput.value));
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
		});
		tradeCapitalInput.addEventListener("blur", () => {
			tradeCapitalInput.value = formatTradeCapitalValue(parseTradeCapitalValue(tradeCapitalInput.value));
		});
		tradeCapitalSlider.addEventListener("focus", openTradeCapitalSlider);
		tradeCapitalSlider.addEventListener("input", () => {
			const value = clampTradeCapital(Number.parseFloat(tradeCapitalSlider.value) || 0);
			tradeCapitalInput.value = formatTradeCapitalValue(value);
		});
		tradeCapitalField.addEventListener("focusout", closeTradeCapitalSlider);
		tradeCapitalInput.value = formatTradeCapitalValue(parseTradeCapitalValue(tradeCapitalInput.value));
		tradeCapitalSlider.value = String(Math.round(parseTradeCapitalValue(tradeCapitalInput.value)));
	}

	if (form) {
		form.addEventListener("submit", (event) => {
			if (isSubmittingWithOverlay) return;
			const values = compactTickerInputs();
			validateAllTickerInputs();
			if (values.length < minimumRequiredTickers) {
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
			event.preventDefault();
			scheduleCompareOverlay();
			isSubmittingWithOverlay = true;
			const nextUrl = buildCleanWorkspaceUrl();
			rememberCurrentViewUrl(nextUrl);
			window.requestAnimationFrame(() => {
				window.location.assign(nextUrl);
			});
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
	window.addEventListener("pageshow", hideSettingsActionOverlay);

	window.addEventListener("resize", scheduleDockPosition);
	window.addEventListener("orientationchange", scheduleDockPosition);
	window.addEventListener("pageshow", scheduleDockPosition);
})();
