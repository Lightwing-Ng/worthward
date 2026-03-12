/* Code version: v3.3.1 */
(() => {
	const state = window.ANTIGRAVITY_APP;
	if (!state) return;

	const { defaults, labels, endpoints, constraints } = state;
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

	const getTickerFields = () => $$(".ticker-field");
	const getTickerInputs = () => getTickerFields().map((field) => field.querySelector('input[name^="ticker_"]')).filter(Boolean);
	const getFilledTickers = () => getTickerInputs().map((input) => sanitizeTicker(input.value.trim())).filter(Boolean);

	const updateAddButtonState = () => {
		const wrapper = $("#ticker_add_wrapper");
		if (!wrapper) return;
		wrapper.hidden = getTickerFields().length >= MAX_TICKERS;
	};

	const reindexTickerFields = () => {
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
			}
			if (suggestions) suggestions.id = `ticker_${index}_suggestions`;
			const removeButton = field.querySelector(".ticker-remove");
			if (removeButton) removeButton.hidden = index <= MIN_TICKERS;
		});
		updateAddButtonState();
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
				try {
					const response = await fetch(`${endpoints.symbolSearch}?limit=5`);
					if (!response.ok) return closePanel();
					renderItems(await response.json());
				} catch (_error) {
					closePanel();
				}
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
			try {
				const response = await fetch(`${endpoints.symbolSearch}?limit=5`);
				if (!response.ok) return closePanel();
				const payload = await response.json();
				if (!payload.length) {
					setUnknown(true);
					return;
				}
				renderItems(payload);
			} catch (_error) {
				closePanel();
			}
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

	const attachRemoveHandlers = () => {
		$$(".ticker-remove").forEach((button) => {
			if (button.dataset.bound === "1") return;
			button.dataset.bound = "1";
			button.addEventListener("click", () => {
				button.closest(".ticker-field")?.remove();
				reindexTickerFields();
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
					<input id="ticker_${index}" name="ticker_${index}" value="${value}" placeholder="e.g. NVDA" autocomplete="off" autocapitalize="characters" spellcheck="false" inputmode="latin" pattern="[A-Za-z0-9.-]{1,15}" title="Use a valid ticker such as MSFT, GOOGL, NVDA, AMZN, MU, AMD, or META.">
					<div class="field-tooltip field-tooltip-duplicate" hidden>This ticker is already used. Choose a different one.</div>
					<div class="field-tooltip field-tooltip-invalid" hidden>Unknown or unsupported ticker.</div>
					<div class="suggestions" id="ticker_${index}_suggestions"></div>
				</div>
				<button type="button" class="ticker-remove" aria-label="Remove ticker"><span class="icon icon-remove" aria-hidden="true"></span></button>
			</div>
		`;
		container.appendChild(field);
		reindexTickerFields();
		attachRemoveHandlers();
		const input = field.querySelector('input[name^="ticker_"]');
		setupAutocomplete(input);
		validateAllTickerInputs();
		input?.focus();
	};

	const compactTickerInputs = () => {
		const values = getFilledTickers();
		const container = $("#ticker_fields");
		if (!container) return values;
		while (getTickerFields().length > Math.max(MIN_TICKERS, values.length)) {
			getTickerFields()[getTickerFields().length - 1].remove();
		}
		getTickerInputs().forEach((input, index) => {
			input.value = values[index] || "";
		});
		while (getTickerFields().length < Math.max(MIN_TICKERS, values.length)) {
			addTickerField(values[getTickerFields().length] || "");
		}
		reindexTickerFields();
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
	reindexTickerFields();
	validateAllTickerInputs();
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
			}
		});
	}

	window.addEventListener("resize", scheduleDockPosition);
	window.addEventListener("orientationchange", scheduleDockPosition);
	window.addEventListener("pageshow", scheduleDockPosition);
})();
