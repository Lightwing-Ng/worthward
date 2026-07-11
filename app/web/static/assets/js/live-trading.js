/**
 * Live trading frontend.
 *
 * Code version: v1.10.0
 * - Secured: Longbridge balances, positions, and order submissions now require the page-only live trading access token.
 * - Changed: Live trading price chart x-axis date labels now use weight 400 while preserving the existing font and size.
 */

document.addEventListener("DOMContentLoaded", () => {
    const state = window.ANTIGRAVITY_APP || {};
    const endpoints = state.endpoints || {};
    const orderEndpoint = endpoints.liveTradingOrder || "/api/live-trading/orders";
    const positionsEndpoint = endpoints.liveTradingPositions || "/api/live-trading/positions";
    const intradayEndpoint = endpoints.investmentIntraday || "/api/investment/intraday";
    const symbolSearchEndpoint = endpoints.symbolSearch || "/api/symbol-search";
    const form = document.getElementById("live_trading_form");
    const submitButton = document.getElementById("live_trading_submit_button");
    const swipeSubmit = document.getElementById("live_trading_swipe_submit");
    const swipeSubmitLabel = document.getElementById("live_trading_swipe_label");
    const swipeSubmitThumb = document.getElementById("live_trading_swipe_thumb");
    const sideControl = document.getElementById("live_trading_side_control");
    const rangeControl = document.getElementById("live_trading_range_control");
    const sidebar = document.getElementById("app_sidebar");
    const tradingGrid = document.querySelector(".live-trading-grid");
    const topRowSurfaces = Array.from(document.querySelectorAll(".live-trading-grid > .live-trading-surface:nth-child(-n+2)"));
    const feedback = document.getElementById("live_trading_feedback");
    const feedbackMessage = document.getElementById("live_trading_feedback_message");
    const feedbackIcon = document.getElementById("live_trading_feedback_icon");
    const barsMeta = document.getElementById("live_trading_bars_meta");
    const barsShell = document.getElementById("live_trading_bars_shell");
    const barsCanvas = document.getElementById("live_trading_bars_canvas");
    const barsEmpty = document.getElementById("live_trading_bars_empty");
    const priceInput = document.getElementById("live_trading_price");
    const quantityInput = document.getElementById("live_trading_quantity");
    const accessTokenInput = document.getElementById("live_trading_access_token");
    const liveTradingShell = document.getElementById("live_trading_shell");
    const liveTradingLayoutRow = document.getElementById("live_trading_layout_row");
    const positionsListShell = document.getElementById("live_trading_list_shell");
    const positionsListToggle = document.getElementById("live_trading_list_toggle");
    const positionsToggleIcon = positionsListToggle?.querySelector(".icon-timing-toggle") || null;
    const positionsPanel = document.getElementById("live_trading_suggestions_panel");
    const positionsMeta = document.getElementById("live_trading_positions_meta");
    const balanceGrid = document.getElementById("live_trading_balance_grid");
    const positionList = document.getElementById("live_trading_position_list");
    const barsTimeZone = "America/New_York";
    const UNKNOWN_MESSAGE = "Unknown or unsupported ticker.";
    const PRICE_PLACEHOLDER_AWAITING_TICKER = "Awaiting valid ticker price";
    const PRICE_PLACEHOLDER_READY = "Enter limit price";
    const tickerPattern = /^[A-Z0-9][A-Z0-9.-]{0,14}$/;
    const tickerValidationCache = new Map();
    const intradayRequestTimeoutMs = 12000;
    const intradayCache = new Map();
    const intradayInflight = new Map();
    const sessionOrderMarkers = [];
    let barsRefreshTimer = 0;
    let barsResizeTimer = 0;
    let barsResizeFrame = 0;
    let barsRequestSerial = 0;
    let activeBarsChart = null;
    let activeChartSignature = "";
    let swipePointerId = null;
    let swipeStartX = 0;
    let swipeStartProgress = 0;
    let swipeProgress = 0;
    let swipePending = false;
    let pendingOrderContext = null;
    let isPositionsPanelOpen = false;
    let positionsRequestSerial = 0;

    if (!form) {
        return;
    }

    const getTickerInput = () => form?.querySelector("[data-ticker-input]") || document.getElementById("live_trading_ticker");
    const getTickerInputs = () => {
        const tickerInput = getTickerInput();
        return tickerInput ? [tickerInput] : [];
    };
    const getSelectedBroker = () => {
        const brokerSelect = form?.querySelector('select[name="broker"]');
        if (brokerSelect instanceof HTMLSelectElement) {
            return String(brokerSelect.value || "longbridge").trim().toLowerCase() === "ibkr" ? "ibkr" : "longbridge";
        }
        const brokerInput = form?.querySelector('input[name="broker"]:checked');
        return String(brokerInput?.value || "longbridge").trim().toLowerCase() === "ibkr" ? "ibkr" : "longbridge";
    };
    const getQuantityInput = () => quantityInput || form?.querySelector('input[name="quantity"]');
    const getLiveTradingAccessToken = () => (
        accessTokenInput instanceof HTMLInputElement ? accessTokenInput.value.trim() : ""
    );
    const buildLiveTradingAuthHeaders = () => ({
        "X-Antigravity-Live-Trading-Token": getLiveTradingAccessToken(),
    });
    const normalizeTicker = (value) => String(value || "").trim().toUpperCase();
    const sanitizeTicker = (value) => normalizeTicker(value).replace(/[^A-Z0-9.-]/g, "").slice(0, 15);
    const normalizePositiveNumber = (value) => {
        const normalized = String(value || "").replace(/,/g, "").trim();
        const numeric = Number(normalized);
        if (!normalized || !Number.isFinite(numeric) || numeric <= 0) {
            return null;
        }
        return {
            text: normalized,
            value: numeric,
        };
    };
    const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
    })[char] || char);
    const numberFormatterCache = new Map();
    const getNumberFormatter = (minimumFractionDigits, maximumFractionDigits) => {
        const formatterKey = `${minimumFractionDigits}:${maximumFractionDigits}`;
        if (!numberFormatterCache.has(formatterKey)) {
            numberFormatterCache.set(formatterKey, new Intl.NumberFormat("en-US", {
                minimumFractionDigits,
                maximumFractionDigits,
            }));
        }
        return numberFormatterCache.get(formatterKey);
    };
    const toFiniteNumber = (value) => {
        const numeric = Number(String(value ?? "").replace(/,/g, "").trim());
        return Number.isFinite(numeric) ? numeric : null;
    };
    const formatNumericValue = (value, { minimumFractionDigits = 0, maximumFractionDigits = 2 } = {}) => {
        const numeric = toFiniteNumber(value);
        if (numeric === null) {
            const fallback = String(value ?? "").trim();
            return fallback || "--";
        }
        return getNumberFormatter(minimumFractionDigits, maximumFractionDigits).format(numeric);
    };
    const sumNumericValues = (values) => values.reduce((total, value) => {
        const numeric = toFiniteNumber(value);
        return total + (numeric ?? 0);
    }, 0);
    const formatMoneyValue = (value, currency, { minimumFractionDigits = 2, maximumFractionDigits = 2 } = {}) => {
        const formattedValue = formatNumericValue(value, { minimumFractionDigits, maximumFractionDigits });
        const normalizedCurrency = String(currency || "").trim();
        return normalizedCurrency ? `${formattedValue} ${normalizedCurrency}` : formattedValue;
    };
    const formatRiskLevelLabel = (value) => ({
        0: "Safe",
        1: "Medium risk",
        2: "Warning",
        3: "Danger",
    }[Number(value)] || "Unknown");
    const buildPanelEmptyMarkup = (message) => `<div class="live-trading-panel-empty">${escapeHtml(message)}</div>`;
    const resolvePositionInputTicker = (position) => {
        const symbol = normalizeTicker(position?.symbol);
        if (symbol.endsWith(".US")) {
            return symbol.slice(0, -3);
        }
        return symbol;
    };
    const buildMarketStoreLogoUrl = (ticker) => {
        const normalizedTicker = normalizeTicker(ticker);
        return normalizedTicker ? `/market-store/logos/${encodeURIComponent(normalizedTicker)}.png` : "";
    };
    const normalizeLogoUrlList = (logoUrl) => {
        const values = Array.isArray(logoUrl) ? logoUrl : [logoUrl];
        return Array.from(new Set(values
            .map((value) => String(value || "").trim())
            .filter(Boolean)));
    };
    const readThemeToken = (computed, tokenName, fallback = "") => {
        const value = computed.getPropertyValue(tokenName).trim();
        return value || fallback;
    };
    const readThemeTokens = () => {
        const computed = getComputedStyle(document.body);
        return {
            text: readThemeToken(computed, "--theme-text", "#111827"),
            muted: readThemeToken(computed, "--theme-muted", "#6b7280"),
            border: readThemeToken(computed, "--theme-border", "#d1d5db"),
            accentPrimary: readThemeToken(computed, "--theme-accent-primary", "#2563eb"),
            accentPositive: readThemeToken(computed, "--theme-accent-positive", "#16a34a"),
            accentNegative: readThemeToken(computed, "--theme-accent-secondary", "#dc2626"),
        };
    };
    const setTickerValidationPending = (input, isPending) => {
        if (!(input instanceof HTMLInputElement)) {
            return;
        }
        input.dataset.validationPending = isPending ? "1" : "";
        input.classList.toggle("is-pending", isPending);
    };
    const rememberValidatedTicker = (input, ticker, isKnown) => {
        if (!(input instanceof HTMLInputElement)) {
            return;
        }
        input.dataset.validatedTicker = ticker || "";
        input.dataset.validatedKnown = isKnown ? "1" : "0";
        if (ticker) {
            tickerValidationCache.set(ticker, Boolean(isKnown));
        }
    };
    const syncTickerClearButton = (input) => {
        const clearButton = input?.parentElement?.querySelector(".ticker-clear");
        if (!(clearButton instanceof HTMLButtonElement) || !(input instanceof HTMLInputElement)) {
            return;
        }
        clearButton.classList.toggle("is-visible", Boolean(input.value.trim()));
    };
    const setTickerLogoVisibility = (logo, placeholder, isLoaded) => {
        if (logo instanceof HTMLImageElement) {
            logo.hidden = !isLoaded;
            logo.dataset.loaded = isLoaded ? "1" : "0";
        }
        if (placeholder instanceof HTMLElement) {
            placeholder.hidden = isLoaded;
        }
    };
    const syncTickerLogoAsset = (logo, placeholder, logoUrl, altText = "") => {
        const normalizedUrls = normalizeLogoUrlList(logoUrl);
        if (!(logo instanceof HTMLImageElement)) {
            if (placeholder instanceof HTMLElement) {
                placeholder.hidden = normalizedUrls.length > 0;
            }
            return;
        }
        logo.onload = null;
        logo.onerror = null;
        if (!normalizedUrls.length) {
            delete logo.dataset.requestedSrc;
            logo.removeAttribute("src");
            logo.alt = "";
            setTickerLogoVisibility(logo, placeholder, false);
            return;
        }
        logo.alt = altText;
        logo.loading = "eager";
        const tryLoadAtIndex = (index) => {
            const nextUrl = normalizedUrls[index];
            if (!nextUrl) {
                delete logo.dataset.requestedSrc;
                logo.removeAttribute("src");
                setTickerLogoVisibility(logo, placeholder, false);
                return;
            }
            logo.dataset.requestedSrc = nextUrl;
            setTickerLogoVisibility(logo, placeholder, false);
            const finalize = (isLoaded) => {
                if (logo.dataset.requestedSrc !== nextUrl) {
                    return;
                }
                if (!isLoaded) {
                    tryLoadAtIndex(index + 1);
                    return;
                }
                setTickerLogoVisibility(logo, placeholder, true);
            };
            logo.onload = () => finalize(true);
            logo.onerror = () => finalize(false);
            if (logo.getAttribute("src") !== nextUrl) {
                logo.src = nextUrl;
            }
            if (logo.complete) {
                finalize(Boolean(logo.naturalWidth && logo.naturalHeight));
                return;
            }
        };
        tryLoadAtIndex(0);
    };
    const syncTickerInputDecoration = (input, suggestion = null) => {
        const control = input?.closest(".ticker-input-control");
        if (!(control instanceof HTMLElement) || !(input instanceof HTMLInputElement)) {
            return;
        }
        const logo = control.querySelector(".ticker-input-logo");
        const placeholder = control.querySelector(".ticker-logo-placeholder");
        const value = input.value.trim();
        const hasTickerLikeValue = Boolean(value);
        const tickerValue = suggestion?.symbol || input.dataset.symbol || value.toUpperCase();
        const logoUrl = suggestion?.logo_url || input.dataset.logoUrl || "";
        control.classList.toggle("has-value", hasTickerLikeValue);
        control.classList.toggle("has-logo", Boolean(logoUrl));
        syncTickerLogoAsset(
            logo instanceof HTMLImageElement ? logo : null,
            placeholder instanceof HTMLElement ? placeholder : null,
            logoUrl,
            logoUrl ? `${tickerValue} logo` : "",
        );
        if (suggestion) {
            input.dataset.logoUrl = suggestion.logo_url || "";
            input.dataset.symbol = suggestion.symbol || "";
            input.dataset.companyName = suggestion.name || suggestion.symbol || "";
        }
        if (!hasTickerLikeValue) {
            input.dataset.logoUrl = "";
            input.dataset.symbol = "";
            input.dataset.companyName = "";
        }
    };
    const ensureTickerValidationTooltip = (input) => {
        if (!(input instanceof HTMLInputElement)) {
            return null;
        }
        if (!input.id) {
            input.id = `live_trading_ticker_${Math.random().toString(36).slice(2, 10)}`;
        }
        let tooltipId = input.dataset.validationTooltipId;
        if (!tooltipId) {
            tooltipId = `${input.id}_validation_tooltip`;
            input.dataset.validationTooltipId = tooltipId;
        }
        let tooltip = document.getElementById(tooltipId);
        if (tooltip instanceof HTMLElement) {
            return tooltip;
        }
        tooltip = document.createElement("div");
        tooltip.id = tooltipId;
        tooltip.dataset.validationFor = input.id;
        tooltip.className = "field-tooltip field-tooltip-validation liquid-glass-surface";
        const icon = document.createElement("span");
        icon.className = "field-tooltip-validation-icon";
        icon.setAttribute("aria-hidden", "true");
        const copy = document.createElement("span");
        copy.className = "field-tooltip-validation-copy";
        tooltip.append(icon, copy);
        tooltip.hidden = true;
        document.body.appendChild(tooltip);
        return tooltip;
    };
    const positionTickerValidationTooltip = (input) => {
        if (!(input instanceof HTMLInputElement)) {
            return;
        }
        const tooltipId = input.dataset.validationTooltipId;
        if (!tooltipId) {
            return;
        }
        const tooltip = document.getElementById(tooltipId);
        const host = input.closest(".ticker-input-main");
        if (!(tooltip instanceof HTMLElement) || tooltip.hidden || !(host instanceof HTMLElement)) {
            return;
        }
        const hostRect = host.getBoundingClientRect();
        tooltip.style.left = `${hostRect.left + (hostRect.width / 2)}px`;
        tooltip.style.top = `${hostRect.top + (hostRect.height / 2)}px`;
    };
    const hideTickerValidationTooltip = (input) => {
        const tooltip = ensureTickerValidationTooltip(input);
        if (!(tooltip instanceof HTMLElement)) {
            return;
        }
        tooltip.hidden = true;
        const copy = tooltip.querySelector(".field-tooltip-validation-copy");
        if (copy instanceof HTMLElement) {
            copy.textContent = "";
        }
    };
    const showTickerValidationTooltip = (input, message = input?.validationMessage || "") => {
        if (!(input instanceof HTMLInputElement) || !message) {
            return;
        }
        getTickerInputs().forEach((tickerInput) => {
            if (tickerInput !== input) {
                hideTickerValidationTooltip(tickerInput);
            }
        });
        if (document.activeElement !== input) {
            input.focus({ preventScroll: true });
        }
        const tooltip = ensureTickerValidationTooltip(input);
        if (!(tooltip instanceof HTMLElement)) {
            return;
        }
        const copy = tooltip.querySelector(".field-tooltip-validation-copy");
        if (copy instanceof HTMLElement) {
            copy.textContent = message;
        } else {
            tooltip.textContent = message;
        }
        tooltip.hidden = false;
        positionTickerValidationTooltip(input);
        input.scrollIntoView({ block: "nearest", inline: "nearest" });
    };
    const syncVisibleTickerValidationTooltips = () => {
        getTickerInputs().forEach((input) => positionTickerValidationTooltip(input));
    };
    const syncPriceInputPlaceholder = (tickerInput, normalizedTicker = sanitizeTicker(tickerInput?.value || "")) => {
        if (!(priceInput instanceof HTMLInputElement)) {
            return;
        }
        const isMalformed = Boolean(normalizedTicker) && !tickerPattern.test(normalizedTicker);
        const isUnknown = tickerInput?.dataset?.unknown === "1";
        const isValidationPending = tickerInput?.dataset?.validationPending === "1";
        const isValidatedKnown = tickerInput?.dataset?.validatedKnown !== "0";
        const validatedTicker = normalizeTicker(tickerInput?.dataset?.validatedTicker || tickerInput?.dataset?.symbol);
        const hasValidTicker = Boolean(normalizedTicker)
            && !isMalformed
            && !isUnknown
            && !isValidationPending
            && isValidatedKnown
            && validatedTicker === normalizedTicker;
        priceInput.placeholder = hasValidTicker ? PRICE_PLACEHOLDER_READY : PRICE_PLACEHOLDER_AWAITING_TICKER;
    };
    const validateTickerInput = (input) => {
        if (!(input instanceof HTMLInputElement)) {
            return "";
        }
        const value = sanitizeTicker(input.value.trim());
        const invalidTooltip = input.closest(".ticker-input-main")?.querySelector(".field-tooltip-invalid");
        const isMalformed = Boolean(value) && !tickerPattern.test(value);
        const isUnknown = input.dataset.unknown === "1";
        input.value = value;
        input.classList.toggle("is-invalid", isMalformed || isUnknown);
        syncTickerClearButton(input);
        syncTickerInputDecoration(input);
        if (invalidTooltip instanceof HTMLElement) {
            invalidTooltip.hidden = !isUnknown;
        }
        if (isMalformed) {
            input.setCustomValidity("Enter a valid ticker symbol.");
        } else if (isUnknown) {
            input.setCustomValidity(UNKNOWN_MESSAGE);
        } else if (input.required && !value) {
            input.setCustomValidity("Enter a ticker symbol.");
        } else {
            input.setCustomValidity("");
        }
        syncPriceInputPlaceholder(input, value);
        syncSwipeSubmitAvailability();
        if (!input.validationMessage) {
            hideTickerValidationTooltip(input);
        }
        return value;
    };
    const applyExactTickerMatch = (input, items, ticker) => {
        if (!(input instanceof HTMLInputElement) || !Array.isArray(items) || !ticker) {
            return null;
        }
        const exactItem = items.find((item) => String(item?.symbol || "").toUpperCase() === ticker) || null;
        if (!exactItem) {
            return null;
        }
        input.dataset.unknown = "";
        rememberValidatedTicker(input, ticker, true);
        setTickerValidationPending(input, false);
        syncTickerInputDecoration(input, exactItem);
        validateTickerInput(input);
        return exactItem;
    };
    const validateTickerExistence = async (input, { preferFresh = false } = {}) => {
        if (!(input instanceof HTMLInputElement)) {
            return false;
        }
        const value = sanitizeTicker(input.value.trim());
        input.value = value;
        validateTickerInput(input);
        if (!value) {
            input.dataset.unknown = "";
            rememberValidatedTicker(input, "", false);
            setTickerValidationPending(input, false);
            validateTickerInput(input);
            clearAutoFilledPrice();
            return false;
        }
        if (!tickerPattern.test(value)) {
            input.dataset.unknown = "";
            rememberValidatedTicker(input, "", false);
            setTickerValidationPending(input, false);
            validateTickerInput(input);
            return false;
        }
        if (!preferFresh && input.dataset.validatedTicker === value) {
            const isKnown = input.dataset.validatedKnown !== "0";
            input.dataset.unknown = isKnown ? "" : "1";
            setTickerValidationPending(input, false);
            validateTickerInput(input);
            if (isKnown) {
                void syncSuggestedPriceForTicker(value);
            }
            return isKnown;
        }
        if (!preferFresh && tickerValidationCache.has(value)) {
            const isKnown = Boolean(tickerValidationCache.get(value));
            input.dataset.unknown = isKnown ? "" : "1";
            rememberValidatedTicker(input, value, isKnown);
            setTickerValidationPending(input, false);
            validateTickerInput(input);
            if (isKnown) {
                void syncSuggestedPriceForTicker(value);
            }
            return isKnown;
        }
        setTickerValidationPending(input, true);
        input.dataset.validationTicker = value;
        try {
            const response = await fetch(`${symbolSearchEndpoint}?q=${encodeURIComponent(value)}&limit=5`, {
                credentials: "same-origin",
            });
            if (!response.ok) {
                throw new Error(`Ticker lookup failed: ${response.status}`);
            }
            const payload = await response.json();
            const isKnown = Boolean(payload.find((item) => String(item?.symbol || "").toUpperCase() === value));
            if (input.dataset.validationTicker === value) {
                input.dataset.unknown = isKnown ? "" : "1";
                if (isKnown) {
                    applyExactTickerMatch(input, payload, value);
                    void syncSuggestedPriceForTicker(value, { force: true });
                } else {
                    rememberValidatedTicker(input, value, false);
                    setTickerValidationPending(input, false);
                    validateTickerInput(input);
                }
            }
            return isKnown;
        } catch (_error) {
            if (input.dataset.validationTicker === value) {
                rememberValidatedTicker(input, value, input.dataset.unknown !== "1");
                setTickerValidationPending(input, false);
                validateTickerInput(input);
            }
            return input.dataset.unknown !== "1";
        }
    };
    const priceFormatter = new Intl.NumberFormat("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 4,
    });
    const formatPriceInputValue = (value) => {
        const numericValue = Number(value);
        if (!Number.isFinite(numericValue) || numericValue <= 0) {
            return "";
        }
        return priceFormatter.format(numericValue);
    };
    const getLatestClosePriceFromPayload = (payload) => {
        const rows = Array.isArray(payload?.rows) ? payload.rows : [];
        for (let index = rows.length - 1; index >= 0; index -= 1) {
            const close = Number(rows[index]?.close);
            if (Number.isFinite(close) && close > 0) {
                return close;
            }
        }
        return null;
    };
    const getLatestSessionOrderPrice = (ticker) => {
        const normalizedTicker = normalizeTicker(ticker);
        if (!normalizedTicker) {
            return null;
        }
        for (let index = sessionOrderMarkers.length - 1; index >= 0; index -= 1) {
            const marker = sessionOrderMarkers[index];
            if (normalizeTicker(marker?.ticker) !== normalizedTicker) {
                continue;
            }
            const price = Number(marker?.price);
            if (Number.isFinite(price) && price > 0) {
                return price;
            }
        }
        return null;
    };
    const resolveSuggestedLiveTradingPrice = (ticker, payload = null) => {
        const normalizedTicker = normalizeTicker(ticker);
        if (!normalizedTicker) {
            return null;
        }
        if (normalizeTicker(pendingOrderContext?.ticker) === normalizedTicker) {
            const pendingPrice = Number(pendingOrderContext?.price);
            if (Number.isFinite(pendingPrice) && pendingPrice > 0) {
                return pendingPrice;
            }
        }
        const latestSessionOrderPrice = getLatestSessionOrderPrice(normalizedTicker);
        if (Number.isFinite(latestSessionOrderPrice) && latestSessionOrderPrice > 0) {
            return latestSessionOrderPrice;
        }
        return getLatestClosePriceFromPayload(payload);
    };
    const shouldApplySuggestedPrice = (input, ticker, { force = false } = {}) => {
        if (!(input instanceof HTMLInputElement)) {
            return false;
        }
        if (force) {
            return true;
        }
        const normalizedTicker = normalizeTicker(ticker);
        const currentValue = String(input.value || "").trim();
        const autoFilledTicker = normalizeTicker(input.dataset.autoFilledTicker || "");
        const autoFilledValue = String(input.dataset.autoFilledValue || "").trim();
        if (!currentValue) {
            return true;
        }
        if (normalizedTicker && normalizedTicker !== autoFilledTicker) {
            return true;
        }
        return Boolean(autoFilledValue) && currentValue === autoFilledValue;
    };
    const applySuggestedPrice = (input, ticker, value, { force = false } = {}) => {
        if (!(input instanceof HTMLInputElement)) {
            return false;
        }
        const formattedValue = formatPriceInputValue(value);
        if (!formattedValue || !shouldApplySuggestedPrice(input, ticker, { force })) {
            return false;
        }
        input.value = formattedValue;
        input.dataset.autoFilledTicker = normalizeTicker(ticker);
        input.dataset.autoFilledValue = formattedValue;
        syncSwipeSubmitAvailability();
        return true;
    };
    const clearAutoFilledPrice = ({ force = false } = {}) => {
        if (!(priceInput instanceof HTMLInputElement)) {
            return;
        }
        const currentValue = String(priceInput.value || "").trim();
        const autoFilledValue = String(priceInput.dataset.autoFilledValue || "").trim();
        if (force || !currentValue || (autoFilledValue && currentValue === autoFilledValue)) {
            priceInput.value = "";
        }
        priceInput.dataset.autoFilledTicker = "";
        priceInput.dataset.autoFilledValue = "";
        syncSwipeSubmitAvailability();
    };
    const syncSuggestedPriceForTicker = async (ticker, { force = false } = {}) => {
        if (!(priceInput instanceof HTMLInputElement)) {
            return false;
        }
        const normalizedTicker = normalizeTicker(ticker);
        if (!normalizedTicker) {
            clearAutoFilledPrice();
            return false;
        }
        if (!shouldApplySuggestedPrice(priceInput, normalizedTicker, { force })) {
            return false;
        }
        const cacheKey = `${normalizedTicker}::${getSelectedRange()}`;
        let payload = intradayCache.get(cacheKey) || null;
        if (!payload) {
            try {
                payload = await loadIntradayBars(normalizedTicker);
            } catch (_error) {
                payload = null;
            }
        }
        const suggestedPrice = resolveSuggestedLiveTradingPrice(normalizedTicker, payload);
        if (!Number.isFinite(suggestedPrice) || suggestedPrice <= 0) {
            return false;
        }
        return applySuggestedPrice(priceInput, normalizedTicker, suggestedPrice, { force });
    };
    const clearStaleAutoFilledPriceForTickerInput = (ticker) => {
        if (!(priceInput instanceof HTMLInputElement)) {
            return;
        }
        const normalizedTicker = normalizeTicker(ticker);
        const autoFilledTicker = normalizeTicker(priceInput.dataset.autoFilledTicker || "");
        if (!autoFilledTicker || !normalizedTicker || normalizedTicker === autoFilledTicker) {
            return;
        }
        clearAutoFilledPrice();
    };
    const getSelectedRange = () => {
        const rangeInput = document.querySelector('input[name="live_trading_range"]:checked');
        return String(rangeInput?.value || "current-day").trim().toLowerCase() === "3d" ? "3d" : "current-day";
    };
    const formatRangeLabel = (value) => (value === "3d" ? "3D" : "Current day");
    const getSelectedSide = () => {
        const sideInput = form?.querySelector('input[name="side"]:checked');
        return String(sideInput?.value || "buy").trim().toLowerCase() === "sell" ? "sell" : "buy";
    };
    const syncSegmentedControl = (control) => {
        if (!(control instanceof HTMLElement)) {
            return;
        }
        const sharedSync = window.ANTIGRAVITY_BOOTSTRAP?.syncSegmentedControlSelection;
        if (typeof sharedSync === "function") {
            sharedSync(control);
            return;
        }
        const options = Array.from(control.querySelectorAll(".segmented-control-option"))
            .filter((option) => option instanceof HTMLElement)
            .filter((option) => {
                const input = option.querySelector('input[type="radio"]');
                return input instanceof HTMLInputElement && !option.hidden && !input.disabled;
            });
        const activeIndex = Math.max(0, options.findIndex((option) => {
            const input = option.querySelector('input[type="radio"]');
            return input instanceof HTMLInputElement && input.checked;
        }));
        const activeInput = options[activeIndex]?.querySelector('input[type="radio"]');
        if (activeInput instanceof HTMLInputElement) {
            control.dataset.active = activeInput.value;
        }
        control.dataset.optionCount = String(Math.max(options.length, 1));
        control.style.setProperty("--segmented-option-count", String(Math.max(options.length, 1)));
        control.style.setProperty("--segmented-active-index", String(activeIndex));
    };
    const syncSideSegmentedControl = () => syncSegmentedControl(sideControl);
    const syncRangeSegmentedControl = () => syncSegmentedControl(rangeControl);
    const bindSegmentedControlSync = (control, syncFn) => {
        if (!(control instanceof HTMLElement) || typeof syncFn !== "function" || control.dataset.segmentedSyncBound === "1") {
            return;
        }
        control.dataset.segmentedSyncBound = "1";
        const syncOnNextFrame = () => {
            window.requestAnimationFrame(() => {
                syncFn();
            });
        };
        control.addEventListener("click", syncOnNextFrame);
        control.addEventListener("change", syncOnNextFrame);
        syncOnNextFrame();
    };
    const getSwipeBounds = () => {
        if (!(swipeSubmit instanceof HTMLElement && swipeSubmitThumb instanceof HTMLElement)) {
            return { max: 0 };
        }
        const style = getComputedStyle(swipeSubmit);
        const inset = Number.parseFloat(style.getPropertyValue("--live-trading-swipe-inset")) || 6;
        const max = Math.max(0, swipeSubmit.clientWidth - (inset * 2) - swipeSubmitThumb.offsetWidth);
        return { max };
    };
    const setSwipeProgress = (nextProgress) => {
        const { max } = getSwipeBounds();
        swipeProgress = Math.min(Math.max(0, nextProgress), max);
        if (swipeSubmit) {
            swipeSubmit.style.setProperty("--live-trading-swipe-progress", `${swipeProgress}px`);
        }
    };
    const resetSwipeSubmit = () => {
        if (swipeSubmit) {
            swipeSubmit.dataset.state = swipePending ? "pending" : "idle";
        }
        setSwipeProgress(0);
    };
    function getLiveOrderFormState() {
        const broker = getSelectedBroker();
        const tickerInput = getTickerInput();
        const validatedTicker = resolveValidatedTicker();
        const price = normalizePositiveNumber(priceInput?.value);
        const quantity = normalizePositiveNumber(getQuantityInput()?.value);
        if (swipePending) {
            return { ready: false, reason: "pending" };
        }
        if (!getLiveTradingAccessToken()) {
            return { ready: false, reason: "access-token" };
        }
        if (broker !== "longbridge") {
            return { ready: false, reason: "broker" };
        }
        if (!(tickerInput instanceof HTMLInputElement) || !validatedTicker) {
            return { ready: false, reason: "ticker" };
        }
        if (!price) {
            return { ready: false, reason: "price" };
        }
        if (!quantity) {
            return { ready: false, reason: "quantity" };
        }
        return { ready: true, reason: "ready" };
    }
    function syncSwipeSubmitAvailability() {
        const formState = getLiveOrderFormState();
        if (swipeSubmit) {
            swipeSubmit.dataset.enabled = formState.ready ? "1" : "0";
            swipeSubmit.setAttribute("aria-disabled", String(!formState.ready));
        }
        if (swipeSubmitThumb instanceof HTMLButtonElement) {
            swipeSubmitThumb.disabled = !formState.ready;
        }
    }
    const syncSwipeSubmitTheme = () => {
        const side = getSelectedSide();
        const formState = getLiveOrderFormState();
        if (swipeSubmit) {
            swipeSubmit.dataset.side = side;
            swipeSubmit.setAttribute(
                "aria-label",
                formState.ready
                    ? `Slide to submit a ${side} order`
                    : "Complete access token, ticker, price, and quantity to enable live order submission",
            );
        }
        if (swipeSubmitLabel) {
            swipeSubmitLabel.textContent = swipePending
                ? `Submitting ${side} order...`
                : formState.ready
                    ? `Slide to ${side}`
                    : formState.reason === "access-token"
                        ? "Enter live trading access token"
                    : getSelectedBroker() === "longbridge"
                        ? "Complete ticker, price, and quantity"
                        : "Switch broker to Longbridge";
        }
    };
    const resizeActiveBarsChart = () => {
        if (activeBarsChart && typeof activeBarsChart.resize === "function") {
            activeBarsChart.resize();
        }
    };
    const scheduleBarsChartResize = ({ settleDelay = 0 } = {}) => {
        if (barsResizeFrame) {
            window.cancelAnimationFrame(barsResizeFrame);
        }
        barsResizeFrame = window.requestAnimationFrame(() => {
            barsResizeFrame = 0;
            window.requestAnimationFrame(() => {
                resizeActiveBarsChart();
            });
        });
        if (barsResizeTimer) {
            window.clearTimeout(barsResizeTimer);
            barsResizeTimer = 0;
        }
        if (settleDelay > 0) {
            barsResizeTimer = window.setTimeout(() => {
                barsResizeTimer = 0;
                resizeActiveBarsChart();
            }, settleDelay);
        }
    };
    const resetTopRowAlignedHeight = () => {
        if (liveTradingLayoutRow instanceof HTMLElement) {
            liveTradingLayoutRow.style.setProperty("--live-trading-aligned-height", "auto");
        }
        if (tradingGrid instanceof HTMLElement) {
            tradingGrid.style.setProperty("--live-trading-top-row-height", "auto");
        }
    };
    const syncTopRowSurfaceHeight = () => {
        if (!(liveTradingLayoutRow instanceof HTMLElement && tradingGrid instanceof HTMLElement) || topRowSurfaces.length < 2) {
            return;
        }
        if (!(sidebar instanceof HTMLElement) || window.matchMedia("(max-width: 767px)").matches) {
            resetTopRowAlignedHeight();
            scheduleBarsChartResize({ settleDelay: 80 });
            return;
        }
        const sidebarRect = sidebar.getBoundingClientRect();
        const layoutRect = liveTradingLayoutRow.getBoundingClientRect();
        const alignedHeight = Math.floor(sidebarRect.bottom - layoutRect.top);
        if (alignedHeight > 360) {
            liveTradingLayoutRow.style.setProperty("--live-trading-aligned-height", `${alignedHeight}px`);
            tradingGrid.style.setProperty("--live-trading-top-row-height", `${alignedHeight}px`);
            scheduleBarsChartResize({ settleDelay: 80 });
            return;
        }
        resetTopRowAlignedHeight();
        scheduleBarsChartResize({ settleDelay: 80 });
    };
    const syncPositionsPanelState = () => {
        if (!(positionsListShell instanceof HTMLElement && positionsListToggle instanceof HTMLButtonElement && positionsPanel instanceof HTMLElement)) {
            return;
        }
        positionsListToggle.setAttribute("aria-expanded", String(isPositionsPanelOpen));
        positionsListShell.classList.toggle("is-open", isPositionsPanelOpen);
        positionsListShell.classList.toggle("is-collapsed", !isPositionsPanelOpen);
        liveTradingShell?.classList.toggle("is-list-collapsed", !isPositionsPanelOpen);
        liveTradingLayoutRow?.classList.toggle("is-list-collapsed", !isPositionsPanelOpen);
        positionsPanel.setAttribute("aria-hidden", String(!isPositionsPanelOpen));
        if ("inert" in positionsPanel) {
            positionsPanel.inert = !isPositionsPanelOpen;
        }
        if (positionsToggleIcon) {
            positionsToggleIcon.classList.toggle("icon-timing-toggle-right", isPositionsPanelOpen);
            positionsToggleIcon.classList.toggle("icon-timing-toggle-left", !isPositionsPanelOpen);
        }
        syncTopRowSurfaceHeight();
        scheduleBarsChartResize({ settleDelay: 640 });
    };
    const renderAccountBalances = (balances) => {
        if (!(balanceGrid instanceof HTMLElement)) {
            return;
        }
        if (!Array.isArray(balances) || !balances.length) {
            balanceGrid.innerHTML = buildPanelEmptyMarkup("No Longbridge account balances are available.");
            return;
        }
        balanceGrid.innerHTML = balances.map((item) => {
            const cashInfos = Array.isArray(item?.cash_infos) ? item.cash_infos : [];
            const availableCash = sumNumericValues(cashInfos.map((cashItem) => cashItem?.available_cash));
            const withdrawCash = sumNumericValues(cashInfos.map((cashItem) => cashItem?.withdraw_cash));
            const frozenCash = sumNumericValues(cashInfos.map((cashItem) => cashItem?.frozen_cash));
            const riskLabel = formatRiskLevelLabel(item?.risk_level);
            const currency = String(item?.currency || "").trim();
            return `
                <section class="live-trading-balance-card">
                    <div class="live-trading-balance-card-header">
                        <span class="live-trading-balance-currency">${escapeHtml(currency || "Account")}</span>
                        <span class="live-trading-balance-risk">${escapeHtml(riskLabel)}</span>
                    </div>
                    <div class="live-trading-balance-row">
                        <span class="live-trading-position-meta-label">Net assets</span>
                        <strong class="live-trading-balance-value">${escapeHtml(formatMoneyValue(item?.net_assets, currency))}</strong>
                    </div>
                    <div class="live-trading-balance-row">
                        <span class="live-trading-position-meta-label">Buying power</span>
                        <strong class="live-trading-balance-value">${escapeHtml(formatMoneyValue(item?.buy_power, currency))}</strong>
                    </div>
                    <div class="live-trading-balance-row">
                        <span class="live-trading-position-meta-label">Available cash</span>
                        <strong class="live-trading-balance-value">${escapeHtml(formatMoneyValue(availableCash, currency))}</strong>
                    </div>
                    <div class="live-trading-balance-row">
                        <span class="live-trading-position-meta-label">Withdrawable</span>
                        <strong class="live-trading-balance-value">${escapeHtml(formatMoneyValue(withdrawCash, currency))}</strong>
                    </div>
                    <div class="live-trading-balance-row">
                        <span class="live-trading-position-meta-label">Frozen cash</span>
                        <strong class="live-trading-balance-value">${escapeHtml(formatMoneyValue(frozenCash, currency))}</strong>
                    </div>
                </section>
            `;
        }).join("");
    };
    const renderPositions = (positions) => {
        if (!(positionList instanceof HTMLElement)) {
            return;
        }
        if (!Array.isArray(positions) || !positions.length) {
            positionList.innerHTML = buildPanelEmptyMarkup("No open Longbridge stock positions are available.");
            return;
        }
        positionList.innerHTML = positions.map((item) => {
            const rawTicker = normalizeTicker(item?.symbol);
            const displayTicker = resolvePositionInputTicker(item) || "--";
            const companyName = item?.symbol_name || displayTicker || item?.symbol || "--";
            const logoUrls = [
                buildMarketStoreLogoUrl(rawTicker),
                rawTicker !== displayTicker ? buildMarketStoreLogoUrl(displayTicker) : "",
            ].filter(Boolean);
            return `
                <button type="button"
                        class="suggestion-item timing-suggestion-item ticker-identity-item live-trading-position-item"
                        data-ticker-input-value="${escapeHtml(displayTicker)}"
                        data-logo-url="${escapeHtml(JSON.stringify(logoUrls))}"
                        data-display-ticker="${escapeHtml(displayTicker)}">
                    <div class="ticker-identity-row">
                        <img class="ticker-identity-logo" alt="" hidden loading="lazy" decoding="async">
                        <span class="ticker-identity-logo ticker-identity-logo-placeholder" aria-hidden="true"></span>
                        <span class="ticker-identity-copy">
                            <span class="suggestion-symbol ticker-identity-symbol">${escapeHtml(displayTicker)}</span>
                            <span class="suggestion-name ticker-identity-name" title="${escapeHtml(companyName)}">${escapeHtml(companyName)}</span>
                        </span>
                    </div>
                    <span class="live-trading-position-meta">
                        <span class="live-trading-position-meta-row">
                            <span class="live-trading-position-meta-label">Position</span>
                            <span class="live-trading-position-meta-value">${escapeHtml(formatNumericValue(item?.quantity, { minimumFractionDigits: 0, maximumFractionDigits: 4 }))}</span>
                        </span>
                    </span>
                </button>
            `;
        }).join("");
        positionList.querySelectorAll(".live-trading-position-item").forEach((button) => {
            if (!(button instanceof HTMLElement)) {
                return;
            }
            const logo = button.querySelector("img.ticker-identity-logo");
            const placeholder = button.querySelector(".ticker-identity-logo-placeholder");
            const logoUrl = (() => {
                try {
                    return JSON.parse(button.dataset.logoUrl || "[]");
                } catch {
                    return button.dataset.logoUrl || "";
                }
            })();
            const displayTicker = button.dataset.displayTicker || "";
            syncTickerLogoAsset(
                logo instanceof HTMLImageElement ? logo : null,
                placeholder instanceof HTMLElement ? placeholder : null,
                logoUrl,
                logoUrl ? `${displayTicker} logo` : "",
            );
        });
    };
    const loadPortfolioSnapshot = async () => {
        if (!(balanceGrid instanceof HTMLElement && positionList instanceof HTMLElement)) {
            return;
        }
        if (!getLiveTradingAccessToken()) {
            if (positionsMeta) {
                positionsMeta.textContent = "Live trading access token required";
            }
            balanceGrid.innerHTML = buildPanelEmptyMarkup("Enter the live trading access token to load account balances.");
            positionList.innerHTML = buildPanelEmptyMarkup("Positions remain locked until access is authenticated.");
            return;
        }
        const requestId = ++positionsRequestSerial;
        if (positionsMeta) {
            positionsMeta.textContent = "Loading Longbridge balances and positions...";
        }
        balanceGrid.innerHTML = buildPanelEmptyMarkup("Loading account balances...");
        positionList.innerHTML = buildPanelEmptyMarkup("Loading current positions...");
        try {
            const response = await fetch(positionsEndpoint, {
                credentials: "same-origin",
                cache: "no-store",
                headers: {
                    "Cache-Control": "no-cache",
                    ...buildLiveTradingAuthHeaders(),
                },
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || payload?.success === false) {
                throw new Error(payload?.error || `Unable to load Longbridge holdings: ${response.status}`);
            }
            if (requestId !== positionsRequestSerial) {
                return;
            }
            const accountBalances = Array.isArray(payload?.account_balances) ? payload.account_balances : [];
            const positions = Array.isArray(payload?.positions) ? payload.positions : [];
            renderAccountBalances(accountBalances);
            renderPositions(positions);
            if (positionsMeta) {
                const balanceLabel = `${accountBalances.length} balance${accountBalances.length === 1 ? "" : "s"}`;
                const positionLabel = `${positions.length} position${positions.length === 1 ? "" : "s"}`;
                positionsMeta.textContent = `Longbridge · ${balanceLabel} · ${positionLabel}`;
            }
        } catch (error) {
            if (requestId !== positionsRequestSerial) {
                return;
            }
            const message = error instanceof Error ? error.message : "Unable to load Longbridge holdings.";
            if (positionsMeta) {
                positionsMeta.textContent = "Longbridge holdings unavailable";
            }
            balanceGrid.innerHTML = buildPanelEmptyMarkup(message);
            positionList.innerHTML = buildPanelEmptyMarkup("Retry after Longbridge account access becomes available.");
        }
    };

    const destroyBarsChart = () => {
        if (activeBarsChart && typeof activeBarsChart.destroy === "function") {
            activeBarsChart.destroy();
        }
        activeBarsChart = null;
        activeChartSignature = "";
    };

    const setBarsEmptyState = (metaText, message, preserveChart = false) => {
        if (barsMeta) {
            barsMeta.textContent = metaText;
        }
        if (barsEmpty) {
            barsEmpty.textContent = message;
            barsEmpty.hidden = false;
        }
        if (barsShell) {
            barsShell.dataset.state = "empty";
        }
        if (!preserveChart) {
            destroyBarsChart();
        }
    };

    const setBarsReadyState = (metaText) => {
        if (barsMeta) {
            barsMeta.textContent = metaText;
        }
        if (barsEmpty) {
            barsEmpty.hidden = true;
        }
        if (barsShell) {
            barsShell.dataset.state = "ready";
        }
    };

    const getIdleBarsMeta = () => (
        `Uses Longbridge-preferred 1-minute candles in ${barsTimeZone} for ${formatRangeLabel(getSelectedRange())} and overlays submitted Buy and Sell markers.`
    );

    const parseBarLabel = (value) => {
        const match = String(value || "").trim().match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/);
        if (!match) {
            return null;
        }
        const [, year, month, day, hour, minute] = match;
        return {
            year: Number(year),
            month: Number(month),
            day: Number(day),
            hour: Number(hour),
            minute: Number(minute),
        };
    };
    const formatBarSessionKey = (value) => {
        const parsed = parseBarLabel(value);
        if (!parsed) {
            return "";
        }
        return `${String(parsed.year).padStart(4, "0")}-${String(parsed.month).padStart(2, "0")}-${String(parsed.day).padStart(2, "0")}`;
    };
    const formatBarSessionLabel = (value) => {
        const sessionKey = formatBarSessionKey(value);
        if (!sessionKey) {
            return "";
        }
        const [year, month, day] = sessionKey.split("-");
        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        return `${Number(day)} ${monthNames[Math.max(0, Number(month) - 1)] || ""} ${year}`.trim();
    };
    const extractLatestTradingSessionRows = (rows) => {
        if (!Array.isArray(rows) || !rows.length) {
            return [];
        }
        let latestSessionKey = "";
        for (let index = rows.length - 1; index >= 0; index -= 1) {
            latestSessionKey = formatBarSessionKey(rows[index]?.date);
            if (latestSessionKey) {
                break;
            }
        }
        if (!latestSessionKey) {
            return [];
        }
        return rows.filter((row) => formatBarSessionKey(row?.date) === latestSessionKey);
    };
    const extractRecentTradingSessionRows = (rows, sessionCount) => {
        if (!Array.isArray(rows) || !rows.length) {
            return [];
        }
        const safeSessionCount = Math.max(1, Number(sessionCount) || 1);
        const recentSessionKeys = [];
        for (let index = rows.length - 1; index >= 0; index -= 1) {
            const sessionKey = formatBarSessionKey(rows[index]?.date);
            if (!sessionKey || recentSessionKeys.includes(sessionKey)) {
                continue;
            }
            recentSessionKeys.unshift(sessionKey);
            if (recentSessionKeys.length >= safeSessionCount) {
                break;
            }
        }
        if (!recentSessionKeys.length) {
            return [];
        }
        const sessionKeySet = new Set(recentSessionKeys);
        return rows.filter((row) => sessionKeySet.has(formatBarSessionKey(row?.date)));
    };
    const normalizeRowsForRange = (rows, range) => {
        const normalizedRange = String(range || "current-day").trim().toLowerCase() === "3d" ? "3d" : "current-day";
        if (normalizedRange === "3d") {
            return extractRecentTradingSessionRows(rows, 3);
        }
        return extractLatestTradingSessionRows(rows);
    };

    const formatAxisLabel = (value) => {
        const parsed = parseBarLabel(value);
        if (!parsed) {
            return ["", ""];
        }
        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        return [
            `${parsed.day} ${monthNames[Math.max(0, parsed.month - 1)] || ""}`,
            `${String(parsed.hour).padStart(2, "0")}:${String(parsed.minute).padStart(2, "0")}`,
        ];
    };

    const formatTooltipLabel = (value) => {
        const parsed = parseBarLabel(value);
        if (!parsed) {
            return String(value || "");
        }
        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        return `${parsed.day} ${monthNames[Math.max(0, parsed.month - 1)] || ""} ${parsed.year} ${String(parsed.hour).padStart(2, "0")}:${String(parsed.minute).padStart(2, "0")} ${barsTimeZone}`;
    };
    const toMinuteKeyInChartTimeZone = (date) => {
        const parts = new Intl.DateTimeFormat("en-US", {
            timeZone: barsTimeZone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
        }).formatToParts(date).reduce((accumulator, part) => {
            if (part.type !== "literal") {
                accumulator[part.type] = part.value;
            }
            return accumulator;
        }, {});
        return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
    };

    const resolveValidatedTicker = () => {
        const tickerInput = getTickerInput();
        const rawTicker = normalizeTicker(tickerInput?.value);
        const validatedTicker = normalizeTicker(tickerInput?.dataset.validatedTicker || tickerInput?.dataset.symbol);
        const isKnown = tickerInput?.dataset.validatedKnown === "1";
        const isPending = tickerInput?.dataset.validationPending === "1";
        const isUnknown = tickerInput?.dataset.unknown === "1";
        if (!rawTicker || isPending || isUnknown || !isKnown) {
            return "";
        }
        if (validatedTicker && validatedTicker === rawTicker) {
            return validatedTicker;
        }
        return "";
    };
    const clearTickerInput = () => {
        const tickerInput = getTickerInput();
        if (!(tickerInput instanceof HTMLInputElement)) {
            return;
        }
        tickerInput.value = "";
        tickerInput.dataset.unknown = "";
        tickerInput.dataset.logoUrl = "";
        tickerInput.dataset.symbol = "";
        tickerInput.dataset.companyName = "";
        rememberValidatedTicker(tickerInput, "", false);
        setTickerValidationPending(tickerInput, false);
        syncTickerInputDecoration(tickerInput);
        validateTickerInput(tickerInput);
        clearAutoFilledPrice();
        hideTickerValidationTooltip(tickerInput);
        destroyBarsChart();
        scheduleIntradayBarsRefresh();
        tickerInput.focus();
    };
    const setupStandaloneTickerAutocomplete = (input) => {
        if (!(input instanceof HTMLInputElement) || input.dataset.autocompleteReady === "1") {
            return;
        }
        input.dataset.autocompleteReady = "1";
        let controller = null;
        let activeIndex = -1;

        const getPanel = () => document.getElementById(`${input.id}_suggestions`);
        const getButtons = () => Array.from(getPanel()?.querySelectorAll(".suggestion-item") || []);
        const setUnknown = (flag) => {
            input.dataset.unknown = flag ? "1" : "";
            if (flag && input.value.trim()) {
                tickerValidationCache.set(sanitizeTicker(input.value.trim()), false);
            }
            validateTickerInput(input);
        };
        const syncActiveSuggestion = () => {
            getButtons().forEach((button, index) => {
                button.classList.toggle("is-active", index === activeIndex);
                if (index === activeIndex) {
                    button.scrollIntoView({ block: "nearest" });
                }
            });
        };
        const closePanel = () => {
            const panel = getPanel();
            if (!(panel instanceof HTMLElement)) {
                return;
            }
            panel.innerHTML = "";
            panel.classList.remove("is-open");
            activeIndex = -1;
        };
        const renderItems = (items) => {
            const panel = getPanel();
            if (!(panel instanceof HTMLElement)) {
                return;
            }
            if (!items.length) {
                closePanel();
                return;
            }
            setUnknown(false);
            const groups = [
                { key: "recent", title: "Recent" },
                { key: "local", title: "Local" },
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
                    const suggestion = {
                        symbol: button.dataset.symbol || "",
                        logo_url: button.dataset.logoUrl || "",
                        name: button.dataset.name || button.dataset.symbol || "",
                    };
                    const selectedSymbol = sanitizeTicker(suggestion.symbol || "");
                    input.value = selectedSymbol;
                    input.dataset.unknown = "";
                    input.dataset.validationTicker = selectedSymbol;
                    tickerValidationCache.set(selectedSymbol, true);
                    setTickerValidationPending(input, false);
                    rememberValidatedTicker(input, selectedSymbol, true);
                    input.setCustomValidity("");
                    syncTickerInputDecoration(input, suggestion);
                    validateTickerInput(input);
                    closePanel();
                    scheduleIntradayBarsRefresh(80);
                    input.focus();
                });
            });
        };
        const showRecentItems = async () => {
            try {
                const response = await fetch(`${symbolSearchEndpoint}?limit=5`, {
                    credentials: "same-origin",
                });
                if (!response.ok) {
                    closePanel();
                    return;
                }
                const payload = await response.json();
                if (!payload.length) {
                    closePanel();
                    return;
                }
                renderItems(payload);
            } catch (_error) {
                closePanel();
            }
        };

        input.addEventListener("input", async () => {
            hideTickerValidationTooltip(input);
            input.dataset.logoUrl = "";
            input.dataset.symbol = "";
            input.dataset.companyName = "";
            syncTickerInputDecoration(input);
            const rawQuery = input.value.trim();
            const query = validateTickerInput(input);
            if (!rawQuery) {
                setUnknown(false);
                await showRecentItems();
                return;
            }
            if (controller) {
                controller.abort();
            }
            controller = new AbortController();
            try {
                const response = await fetch(`${symbolSearchEndpoint}?q=${encodeURIComponent(rawQuery)}`, {
                    credentials: "same-origin",
                    signal: controller.signal,
                });
                if (!response.ok) {
                    closePanel();
                    return;
                }
                const payload = await response.json();
                if (!payload.length) {
                    setUnknown(true);
                    closePanel();
                    return;
                }
                const exactMatch = Boolean(applyExactTickerMatch(input, payload, query));
                if (query) {
                    tickerValidationCache.set(query, exactMatch);
                }
                input.dataset.unknown = exactMatch ? "" : input.dataset.unknown;
                validateTickerInput(input);
                renderItems(payload);
            } catch (error) {
                if (error?.name !== "AbortError") {
                    closePanel();
                }
            }
        });
        input.addEventListener("focus", async () => {
            hideTickerValidationTooltip(input);
            if (input.value.trim()) {
                return;
            }
            setUnknown(false);
            await showRecentItems();
        });
        input.addEventListener("click", async () => {
            hideTickerValidationTooltip(input);
            if (input.value.trim()) {
                return;
            }
            if (getPanel()?.classList.contains("is-open")) {
                return;
            }
            setUnknown(false);
            await showRecentItems();
        });
        input.addEventListener("blur", () => {
            window.setTimeout(closePanel, 120);
            void validateTickerExistence(input, { preferFresh: true });
        });
        input.addEventListener("keydown", (event) => {
            const buttons = getButtons();
            if (!buttons.length) {
                return;
            }
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
            validateTickerInput(input);
            void validateTickerExistence(input, { preferFresh: true });
        });
    };

    const fetchIntradayBarsPayload = async (ticker, range) => {
        const normalizedTicker = normalizeTicker(ticker);
        const normalizedRange = String(range || "current-day").trim().toLowerCase() === "3d" ? "3d" : "current-day";
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), intradayRequestTimeoutMs);
        let response;
        try {
            response = await fetch(
                `${intradayEndpoint}?ticker=${encodeURIComponent(normalizedTicker)}&range=${encodeURIComponent(normalizedRange)}&ensure_store=1`,
                {
                    credentials: "same-origin",
                    cache: "no-store",
                    headers: {
                        "Cache-Control": "no-cache",
                    },
                    signal: controller.signal,
                },
            );
        } catch (error) {
            if (error?.name === "AbortError") {
                throw new Error(`Timed out while loading 1-minute candlesticks for ${normalizedTicker}.`);
            }
            throw error;
        } finally {
            window.clearTimeout(timeoutId);
        }
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload?.success === false) {
            throw new Error(payload?.error || `Unable to load intraday bars for ${normalizedTicker}.`);
        }
        return payload;
    };
    const loadIntradayBars = async (ticker) => {
        const normalizedTicker = normalizeTicker(ticker);
        const selectedRange = getSelectedRange();
        const cacheKey = `${normalizedTicker}::${selectedRange}`;
        if (!normalizedTicker) {
            return { rows: [], count: 0, source: "local", interval: "1m", refreshed: false, range: selectedRange };
        }
        if (intradayCache.has(cacheKey)) {
            return intradayCache.get(cacheKey);
        }
        if (intradayInflight.has(cacheKey)) {
            return intradayInflight.get(cacheKey);
        }
        const requestPromise = (async () => {
            let payload = await fetchIntradayBarsPayload(normalizedTicker, selectedRange);
            let rows = normalizeRowsForRange(Array.isArray(payload?.rows) ? payload.rows : [], selectedRange);
            let usedPreviousSession = false;
            let previousSessionLabel = "";
            if (selectedRange === "current-day" && !rows.length) {
                const fallbackPayload = await fetchIntradayBarsPayload(normalizedTicker, "3d");
                const fallbackRows = normalizeRowsForRange(Array.isArray(fallbackPayload?.rows) ? fallbackPayload.rows : [], "current-day");
                if (fallbackRows.length) {
                    payload = fallbackPayload;
                    rows = fallbackRows;
                    usedPreviousSession = true;
                    previousSessionLabel = formatBarSessionLabel(fallbackRows[fallbackRows.length - 1]?.date);
                }
            }
            const result = {
                rows,
                count: rows.length,
                source: String(payload?.source || "local"),
                interval: String(payload?.interval || "1m"),
                refreshed: Boolean(payload?.refreshed),
                range: selectedRange,
                usedPreviousSession,
                previousSessionLabel,
            };
            intradayCache.set(cacheKey, result);
            return result;
        })();
        intradayInflight.set(cacheKey, requestPromise);
        try {
            return await requestPromise;
        } finally {
            intradayInflight.delete(cacheKey);
        }
    };
    const findMarkerIndex = (labels, minuteKey) => {
        if (!Array.isArray(labels) || !labels.length || !minuteKey) {
            return -1;
        }
        const exactIndex = labels.indexOf(minuteKey);
        if (exactIndex >= 0) {
            return exactIndex;
        }
        for (let index = labels.length - 1; index >= 0; index -= 1) {
            if (String(labels[index] || "") <= minuteKey) {
                return index;
            }
        }
        return labels.length - 1;
    };
    const buildMarkerDatasets = (ticker, labels) => {
        const normalizedTicker = normalizeTicker(ticker);
        const buyData = Array(labels.length).fill(null);
        const sellData = Array(labels.length).fill(null);
        const buySummaries = Array.from({ length: labels.length }, () => []);
        const sellSummaries = Array.from({ length: labels.length }, () => []);
        const visibleMarkers = sessionOrderMarkers
            .filter((marker) => normalizeTicker(marker.ticker) === normalizedTicker);
        visibleMarkers.forEach((marker) => {
            const index = findMarkerIndex(labels, marker.minuteKey);
            if (index < 0) {
                return;
            }
            if (marker.side === "sell") {
                sellData[index] = marker.price;
                sellSummaries[index].push(`Sell ${marker.quantity} @ ${priceFormatter.format(marker.price)}`);
                return;
            }
            buyData[index] = marker.price;
            buySummaries[index].push(`Buy ${marker.quantity} @ ${priceFormatter.format(marker.price)}`);
        });
        return {
            buyData,
            sellData,
            buySummaries,
            sellSummaries,
        };
    };

    const renderIntradayChart = (ticker, payload) => {
        if (!(barsCanvas instanceof HTMLCanvasElement) || !window.Chart) {
            setBarsEmptyState(
                `${ticker} · chart unavailable`,
                "Chart.js is unavailable, so the candlestick chart cannot render.",
            );
            return;
        }
        const rows = Array.isArray(payload?.rows) ? payload.rows : [];
        const labels = rows.map((row) => String(row?.date || ""));
        const openValues = rows.map((row) => Number(row?.open));
        const highValues = rows.map((row) => Number(row?.high));
        const lowValues = rows.map((row) => Number(row?.low));
        const closeValues = rows.map((row) => Number(row?.close));
        const finiteLows = lowValues.filter(Number.isFinite);
        const finiteHighs = highValues.filter(Number.isFinite);
        if (!rows.length || !finiteLows.length || !finiteHighs.length) {
            setBarsEmptyState(
                `${ticker} · 0 bars · ${payload?.interval || "1m"} · ${barsTimeZone}`,
                "No 1-minute candlesticks are available for this ticker.",
            );
            return;
        }

        destroyBarsChart();
        const theme = readThemeTokens();
        const yMin = Math.min(...finiteLows);
        const yMax = Math.max(...finiteHighs);
        const yPadding = Math.max((yMax - yMin) * 0.03, yMax * 0.0025, 0.01);
        const maxTicksLimit = Math.min(7, Math.max(4, Math.round(labels.length / 120)));
        const sourceLabel = payload?.source === "longbridge"
            ? "Longbridge"
            : payload?.source === "local"
                ? "local cache"
                : String(payload?.source || "fallback");
        const sessionSuffix = payload?.usedPreviousSession
            ? ` · previous session${payload?.previousSessionLabel ? ` ${payload.previousSessionLabel}` : ""}`
            : "";
        const markerState = buildMarkerDatasets(ticker, labels);

        setBarsReadyState(
            `${ticker} · ${formatRangeLabel(payload?.range || getSelectedRange())}${sessionSuffix} · ${rows.length} bars · ${payload?.interval || "1m"} · ${barsTimeZone} · ${sourceLabel}`,
        );

        const buildTickIndexSet = (count, plotWidth) => {
            if (count <= 0) return new Set();
            if (count === 1) return new Set([0]);
            const maxTickCount = plotWidth >= 768 ? 4 : 3;
            if (maxTickCount === 3 || count < 4) {
                return new Set([0, Math.round((count - 1) / 2), count - 1]);
            }
            return new Set([
                0,
                Math.round((count - 1) / 3),
                Math.round(((count - 1) * 2) / 3),
                count - 1,
            ]);
        };
        const candlestickPlugin = {
            id: "liveTradingCandlestickPlugin",
            afterDatasetsDraw(chartInstance) {
                const { ctx, chartArea, scales } = chartInstance;
                const meta = chartInstance.getDatasetMeta(0);
                const xScale = scales?.x;
                const yScale = scales?.y;
                if (!meta || !meta.data.length || !xScale || !yScale || !chartArea) {
                    return;
                }
                const columnWidth = (chartArea.right - chartArea.left) / Math.max(labels.length, 1);
                const candleWidth = Math.min(20, Math.max(1.5, columnWidth * 0.72));
                ctx.save();
                meta.data.forEach((point, index) => {
                    const open = openValues[index];
                    const high = highValues[index];
                    const low = lowValues[index];
                    const close = closeValues[index];
                    if (![open, high, low, close].every(Number.isFinite)) {
                        return;
                    }
                    const x = Number(point?.x);
                    if (!Number.isFinite(x)) {
                        return;
                    }
                    const openY = yScale.getPixelForValue(open);
                    const highY = yScale.getPixelForValue(high);
                    const lowY = yScale.getPixelForValue(low);
                    const closeY = yScale.getPixelForValue(close);
                    const color = theme.accentPrimary;
                    ctx.strokeStyle = color;
                    ctx.fillStyle = color;
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    ctx.moveTo(x, highY);
                    ctx.lineTo(x, lowY);
                    ctx.stroke();
                    const bodyTop = Math.min(openY, closeY);
                    const bodyBottom = Math.max(openY, closeY);
                    const bodyHeight = Math.max(1, bodyBottom - bodyTop);
                    ctx.fillRect(x - (candleWidth / 2), bodyTop, candleWidth, bodyHeight);
                });
                ctx.restore();
            },
        };
        const hoverGuidePlugin = {
            id: "liveTradingHoverGuidePlugin",
            afterDatasetsDraw(chartInstance) {
                const { ctx, chartArea, tooltip } = chartInstance;
                if (!chartArea || !tooltip || tooltip.opacity === 0) return;
                const x = tooltip.caretX;
                if (!Number.isFinite(x) || x < chartArea.left || x > chartArea.right) return;
                ctx.save();
                ctx.strokeStyle = theme.muted;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(x, chartArea.top);
                ctx.lineTo(x, chartArea.bottom);
                ctx.stroke();
                ctx.restore();
            },
        };
        const xAxisLabelPlugin = {
            id: "liveTradingXAxisLabelPlugin",
            afterDraw(chartInstance) {
                const { ctx, chartArea, scales } = chartInstance;
                const xScale = scales?.x;
                if (!chartArea || !xScale || !labels.length) return;
                const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
                const tickIndexes = Array.from(buildTickIndexSet(labels.length, viewportWidth)).sort((left, right) => left - right);
                const baselineY = chartArea.bottom;
                const lineHeight = 10;
                ctx.save();
                ctx.fillStyle = theme.muted;
                ctx.font = '400 12px "GDS Transport", "Helvetica Neue", Arial, sans-serif';
                ctx.textBaseline = "top";
                tickIndexes.forEach((index, tickIndex) => {
                    const [firstLine, secondLine] = formatAxisLabel(labels[index]);
                    const x = xScale.getPixelForValue(index);
                    if (!Number.isFinite(x)) return;
                    if (tickIndex === 0) ctx.textAlign = "left";
                    else if (tickIndex === tickIndexes.length - 1) ctx.textAlign = "right";
                    else ctx.textAlign = "center";
                    ctx.fillText(firstLine, x, baselineY);
                    ctx.fillText(secondLine, x, baselineY + lineHeight);
                });
                ctx.restore();
            },
        };

        activeBarsChart = new window.Chart(barsCanvas, {
            type: "line",
            data: {
                labels,
                datasets: [
                    {
                        label: `${ticker} close`,
                        data: closeValues,
                        borderColor: "transparent",
                        borderWidth: 0,
                        pointRadius: 0,
                        tension: 0,
                    },
                    {
                        type: "line",
                        label: `${ticker} buy markers`,
                        data: markerState.buyData,
                        borderColor: "transparent",
                        backgroundColor: theme.accentPositive,
                        pointBackgroundColor: theme.accentPositive,
                        pointBorderColor: "#ffffff",
                        pointBorderWidth: 1.5,
                        pointRadius: 6,
                        pointHoverRadius: 7,
                        pointStyle: "triangle",
                        rotation: 0,
                        showLine: false,
                        spanGaps: true,
                        markerSide: "buy",
                        orderSummaries: markerState.buySummaries,
                    },
                    {
                        type: "line",
                        label: `${ticker} sell markers`,
                        data: markerState.sellData,
                        borderColor: "transparent",
                        backgroundColor: theme.accentNegative,
                        pointBackgroundColor: theme.accentNegative,
                        pointBorderColor: "#ffffff",
                        pointBorderWidth: 1.5,
                        pointRadius: 6,
                        pointHoverRadius: 7,
                        pointStyle: "triangle",
                        rotation: 180,
                        showLine: false,
                        spanGaps: true,
                        markerSide: "sell",
                        orderSummaries: markerState.sellSummaries,
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: false,
                interaction: {
                    mode: "index",
                    intersect: false,
                },
                layout: {
                    padding: {
                        top: 24,
                        right: 12,
                        bottom: 24,
                        left: 12,
                    },
                },
                plugins: {
                    legend: {
                        display: false,
                    },
                    tooltip: {
                        callbacks: {
                            title(items) {
                                const index = items?.[0]?.dataIndex ?? -1;
                                return formatTooltipLabel(labels[index]);
                            },
                            label(context) {
                                const index = context?.dataIndex ?? -1;
                                const dataset = context?.dataset || {};
                                if (dataset.markerSide) {
                                    const orderSummaries = Array.isArray(dataset.orderSummaries?.[index])
                                        ? dataset.orderSummaries[index]
                                        : [];
                                    return orderSummaries.length
                                        ? orderSummaries
                                        : [`${String(dataset.markerSide || "").toUpperCase()} marker`];
                                }
                                const open = openValues[index];
                                const high = highValues[index];
                                const low = lowValues[index];
                                const close = closeValues[index];
                                return [
                                    `Open ${priceFormatter.format(open)}`,
                                    `High ${priceFormatter.format(high)}`,
                                    `Low ${priceFormatter.format(low)}`,
                                    `Close ${priceFormatter.format(close)}`,
                                ];
                            },
                        },
                    },
                },
                scales: {
                    x: {
                        grid: {
                            display: false,
                            drawBorder: false,
                        },
                        border: {
                            display: false,
                        },
                        ticks: {
                            display: false,
                        },
                    },
                    y: {
                        min: yMin - yPadding,
                        max: yMax + yPadding,
                        grid: {
                            display: false,
                            drawTicks: false,
                        },
                        border: {
                            display: false,
                        },
                        ticks: {
                            color: theme.muted,
                            padding: 0,
                            callback(value, index, ticks) {
                                if (index === 0 || index === ticks.length - 1) return "";
                                return priceFormatter.format(Number(value));
                            },
                        },
                    },
                },
            },
            plugins: [candlestickPlugin, hoverGuidePlugin, xAxisLabelPlugin],
        });
        activeChartSignature = `${ticker}::${payload?.range || getSelectedRange()}`;
    };

    const refreshIntradayBars = async () => {
        const tickerInput = getTickerInput();
        if (!(tickerInput && barsEmpty)) {
            return;
        }
        const rawTicker = normalizeTicker(tickerInput.value);
        const selectedRange = getSelectedRange();
        const cacheKey = `${rawTicker}::${selectedRange}`;
        const requestId = ++barsRequestSerial;
        if (!rawTicker) {
            setBarsEmptyState(
                getIdleBarsMeta(),
                `Select a valid ticker to load ${formatRangeLabel(selectedRange)} 1-minute candlesticks.`,
            );
            return;
        }
        if (tickerInput.dataset.validationPending === "1") {
            setBarsEmptyState(
                `${rawTicker} · waiting for validation`,
                "Finish ticker validation to load Longbridge candlesticks.",
                true,
            );
            return;
        }
        const ticker = resolveValidatedTicker();
        if (!ticker) {
            setBarsEmptyState(
                `${rawTicker} · invalid ticker`,
                "Select a valid ticker suggestion before loading Longbridge candlesticks.",
                true,
            );
            return;
        }
        if (`${ticker}::${selectedRange}` === activeChartSignature && activeBarsChart && intradayCache.has(cacheKey)) {
            const cachedPayload = intradayCache.get(cacheKey);
            const sessionSuffix = cachedPayload?.usedPreviousSession
                ? ` · previous session${cachedPayload?.previousSessionLabel ? ` ${cachedPayload.previousSessionLabel}` : ""}`
                : "";
            setBarsReadyState(
                `${ticker} · ${formatRangeLabel(selectedRange)}${sessionSuffix} · ${cachedPayload?.count || 0} bars · 1m · ${barsTimeZone} · cached`,
            );
            void syncSuggestedPriceForTicker(ticker);
            return;
        }
        setBarsEmptyState(
            `Loading ${ticker} ${formatRangeLabel(selectedRange)} 1-minute candlesticks from Longbridge...`,
            "Loading Longbridge candlesticks...",
            true,
        );
        try {
            const payload = await loadIntradayBars(ticker);
            if (requestId !== barsRequestSerial) {
                return;
            }
            renderIntradayChart(ticker, payload);
            void syncSuggestedPriceForTicker(ticker);
        } catch (error) {
            if (requestId !== barsRequestSerial) {
                return;
            }
            setBarsEmptyState(
                `${ticker} · candlestick load failed`,
                error instanceof Error ? error.message : "Unable to load candlesticks.",
            );
        }
    };

    const scheduleIntradayBarsRefresh = (delay = 0) => {
        if (barsRefreshTimer) {
            window.clearTimeout(barsRefreshTimer);
        }
        barsRefreshTimer = window.setTimeout(() => {
            barsRefreshTimer = 0;
            void refreshIntradayBars();
        }, delay);
    };

    const setFeedback = (message, variant = "success") => {
        if (!(feedback && feedbackMessage && feedbackIcon)) {
            return;
        }
        const normalizedVariant = String(variant || "success").trim().toLowerCase();
        feedback.hidden = false;
        feedbackMessage.textContent = message;
        feedback.dataset.feedbackVariant = normalizedVariant;
        feedbackIcon.className = "icon workspace-modal-icon notice-floating-banner-icon investment-import-feedback-banner-icon";
        if (normalizedVariant === "error") {
            feedbackIcon.classList.add("icon-modal-dialog-banner-default");
            feedback.classList.add("error");
            feedback.classList.remove("notice");
            return;
        }
        feedback.classList.add("notice");
        feedback.classList.remove("error");
        feedbackIcon.classList.add("icon-modal-dialog-banner-default");
    };

    const clearFeedback = () => {
        if (!feedback) {
            return;
        }
        feedback.hidden = true;
        feedback.classList.remove("error");
        feedback.classList.add("notice");
    };

    const syncButtonState = (isPending) => {
        if (!submitButton) {
            return;
        }
        const defaultLabel = submitButton.dataset.defaultLabel || "Submit order";
        const pendingLabel = submitButton.dataset.pendingLabel || "Submitting";
        submitButton.disabled = Boolean(isPending);
        submitButton.textContent = isPending ? pendingLabel : defaultLabel;
        swipePending = Boolean(isPending);
        syncSwipeSubmitAvailability();
        syncSwipeSubmitTheme();
        resetSwipeSubmit();
    };

    const bindTickerInputEvents = () => {
        const tickerInput = getTickerInput();
        if (!tickerInput || tickerInput.dataset.liveTradingBound === "1") {
            return;
        }
        tickerInput.dataset.liveTradingBound = "1";
        tickerInput.addEventListener("input", () => {
            const tickerValue = validateTickerInput(tickerInput);
            clearStaleAutoFilledPriceForTickerInput(tickerValue);
            scheduleIntradayBarsRefresh(320);
        });
        tickerInput.addEventListener("change", () => {
            intradayCache.delete(`${normalizeTicker(tickerInput.value)}::current-day`);
            intradayCache.delete(`${normalizeTicker(tickerInput.value)}::3d`);
            syncSwipeSubmitAvailability();
            scheduleIntradayBarsRefresh();
        });
        tickerInput.addEventListener("blur", () => {
            syncSwipeSubmitAvailability();
            scheduleIntradayBarsRefresh(120);
        });
    };
    bindTickerInputEvents();
    if (positionsListToggle instanceof HTMLButtonElement && positionsListToggle.dataset.bound !== "1") {
        positionsListToggle.dataset.bound = "1";
        positionsListToggle.addEventListener("click", () => {
            isPositionsPanelOpen = !isPositionsPanelOpen;
            syncPositionsPanelState();
        });
    }
    if (positionList instanceof HTMLElement && positionList.dataset.bound !== "1") {
        positionList.dataset.bound = "1";
        positionList.addEventListener("click", (event) => {
            const trigger = event.target instanceof Element
                ? event.target.closest("[data-ticker-input-value]")
                : null;
            if (!(trigger instanceof HTMLElement)) {
                return;
            }
            const nextTicker = sanitizeTicker(trigger.dataset.tickerInputValue || "");
            const tickerInput = getTickerInput();
            if (!(tickerInput instanceof HTMLInputElement) || !nextTicker) {
                return;
            }
            tickerInput.value = nextTicker;
            tickerInput.dataset.unknown = "";
            tickerInput.dataset.logoUrl = "";
            tickerInput.dataset.symbol = "";
            tickerInput.dataset.companyName = "";
            rememberValidatedTicker(tickerInput, "", false);
            setTickerValidationPending(tickerInput, false);
            validateTickerInput(tickerInput);
            hideTickerValidationTooltip(tickerInput);
            tickerInput.focus();
            void validateTickerExistence(tickerInput, { preferFresh: true });
            scheduleIntradayBarsRefresh(80);
        });
    }
    form.addEventListener("change", (event) => {
        const target = event.target;
        if (target instanceof HTMLInputElement && target.name === "side") {
            syncSideSegmentedControl();
            syncSwipeSubmitTheme();
            return;
        }
        if ((target instanceof HTMLInputElement || target instanceof HTMLSelectElement) && target.name === "broker") {
            clearFeedback();
            syncSwipeSubmitAvailability();
            syncSwipeSubmitTheme();
            return;
        }
        if (target instanceof HTMLInputElement && target.name === "live_trading_range") {
            syncRangeSegmentedControl();
            scheduleIntradayBarsRefresh();
            void syncSuggestedPriceForTicker(resolveValidatedTicker());
        }
    });

    window.addEventListener("antigravity:theme-mode-change", () => {
        if (activeChartSignature && intradayCache.has(activeChartSignature)) {
            const [ticker] = activeChartSignature.split("::");
            renderIntradayChart(ticker, intradayCache.get(activeChartSignature));
        }
    });

    const submitLiveOrder = async () => {
        clearFeedback();
        const formData = new FormData(form);
        const ticker = String(formData.get("ticker") || "").trim().toUpperCase();
        const broker = getSelectedBroker();
        const side = String(formData.get("side") || "").trim().toLowerCase();
        const price = normalizePositiveNumber(formData.get("price"));
        const quantity = normalizePositiveNumber(formData.get("quantity"));
        const remark = String(formData.get("remark") || "").trim();
        const tickerInput = getTickerInput();

        if (broker !== "longbridge") {
            setFeedback("IBKR live order routing is not available yet. Switch the broker back to Longbridge.", "error");
            return;
        }

        if (!(tickerInput instanceof HTMLInputElement)) {
            setFeedback("Ticker input is unavailable.", "error");
            return;
        }
        validateTickerInput(tickerInput);
        if (!ticker) {
            showTickerValidationTooltip(tickerInput, tickerInput.validationMessage || "Enter a ticker symbol.");
            setFeedback("Ticker is required.", "error");
            return;
        }
        if (!resolveValidatedTicker()) {
            showTickerValidationTooltip(tickerInput, tickerInput.validationMessage || UNKNOWN_MESSAGE);
            setFeedback("Select a valid ticker suggestion before submitting the order.", "error");
            return;
        }
        if (!price) {
            setFeedback("Price must be greater than 0.", "error");
            return;
        }
        if (!quantity) {
            setFeedback("Quantity must be greater than 0.", "error");
            return;
        }

        syncButtonState(true);
        pendingOrderContext = {
            ticker,
            price: price.value,
        };
        try {
            const response = await fetch(orderEndpoint, {
                method: "POST",
                credentials: "same-origin",
                cache: "no-store",
                headers: {
                    "Content-Type": "application/json",
                    "Cache-Control": "no-cache",
                    ...buildLiveTradingAuthHeaders(),
                },
                body: JSON.stringify({
                    ticker,
                    side,
                    price: price.text,
                    quantity: quantity.text,
                    remark,
                }),
            });
            const result = await response.json();
            if (!response.ok || result.success === false) {
                throw new Error(result.error || `Failed to submit live order: ${response.status}`);
            }
            sessionOrderMarkers.push({
                ticker: resolveValidatedTicker() || ticker,
                side,
                price: price.value,
                quantity: quantity.text,
                minuteKey: toMinuteKeyInChartTimeZone(new Date()),
            });
            setFeedback(result.message || "Live order submitted.", "success");
            void loadPortfolioSnapshot();
            if (activeChartSignature && activeChartSignature.startsWith(`${resolveValidatedTicker() || ticker}::`) && intradayCache.has(activeChartSignature)) {
                renderIntradayChart(resolveValidatedTicker() || ticker, intradayCache.get(activeChartSignature));
            } else {
                scheduleIntradayBarsRefresh();
            }
        } catch (error) {
            setFeedback(error instanceof Error ? error.message : "Failed to submit live order.", "error");
        } finally {
            pendingOrderContext = null;
            syncButtonState(false);
        }
    };

    const tickerInput = getTickerInput();
    if (tickerInput instanceof HTMLInputElement) {
        setupStandaloneTickerAutocomplete(tickerInput);
        validateTickerInput(tickerInput);
    }
    if (priceInput instanceof HTMLInputElement && priceInput.dataset.liveTradingBound !== "1") {
        priceInput.dataset.liveTradingBound = "1";
        priceInput.addEventListener("input", () => {
            const currentValue = String(priceInput.value || "").trim();
            if (currentValue !== String(priceInput.dataset.autoFilledValue || "").trim()) {
                priceInput.dataset.autoFilledTicker = normalizeTicker(resolveValidatedTicker());
            }
            syncSwipeSubmitAvailability();
        });
    }
    if (quantityInput instanceof HTMLInputElement && quantityInput.dataset.liveTradingBound !== "1") {
        quantityInput.dataset.liveTradingBound = "1";
        quantityInput.addEventListener("input", () => {
            syncSwipeSubmitAvailability();
        });
    }
    if (accessTokenInput instanceof HTMLInputElement && accessTokenInput.dataset.liveTradingBound !== "1") {
        accessTokenInput.dataset.liveTradingBound = "1";
        accessTokenInput.addEventListener("input", () => {
            syncSwipeSubmitAvailability();
            syncSwipeSubmitTheme();
        });
        accessTokenInput.addEventListener("change", () => {
            void loadPortfolioSnapshot();
        });
    }
    const clearButton = form.querySelector(".ticker-clear");
    if (clearButton instanceof HTMLButtonElement && clearButton.dataset.liveTradingBound !== "1") {
        clearButton.dataset.liveTradingBound = "1";
        clearButton.addEventListener("mousedown", (event) => {
            event.preventDefault();
        });
        clearButton.addEventListener("click", () => {
            clearTickerInput();
        });
    }
    window.addEventListener("resize", syncVisibleTickerValidationTooltips);
    document.addEventListener("scroll", syncVisibleTickerValidationTooltips, true);

    if (swipeSubmit && swipeSubmitThumb) {
        const swipeThreshold = 0.86;
        const finishSwipeGesture = async () => {
            if (swipePending) {
                resetSwipeSubmit();
                return;
            }
            const { max } = getSwipeBounds();
            const completion = max > 0 ? (swipeProgress / max) : 0;
            if (completion < swipeThreshold) {
                resetSwipeSubmit();
                return;
            }
            setSwipeProgress(max);
            await submitLiveOrder();
            if (!swipePending) {
                resetSwipeSubmit();
            }
        };
        const handlePointerMove = (event) => {
            if (swipePending || swipePointerId !== event.pointerId) {
                return;
            }
            const deltaX = event.clientX - swipeStartX;
            setSwipeProgress(swipeStartProgress + deltaX);
        };
        const stopSwipeTracking = async (event) => {
            if (swipePointerId !== event.pointerId) {
                return;
            }
            swipeSubmitThumb.releasePointerCapture?.(event.pointerId);
            swipePointerId = null;
            if (swipeSubmit && !swipePending) {
                swipeSubmit.dataset.state = "idle";
            }
            await finishSwipeGesture();
        };
        swipeSubmitThumb.addEventListener("pointerdown", (event) => {
            if (swipePending || !getLiveOrderFormState().ready) {
                return;
            }
            swipePointerId = event.pointerId;
            swipeStartX = event.clientX;
            swipeStartProgress = swipeProgress;
            swipeSubmit.dataset.state = "dragging";
            swipeSubmitThumb.setPointerCapture?.(event.pointerId);
            event.preventDefault();
        });
        swipeSubmitThumb.addEventListener("pointermove", handlePointerMove);
        swipeSubmitThumb.addEventListener("pointerup", (event) => {
            void stopSwipeTracking(event);
        });
        swipeSubmitThumb.addEventListener("pointercancel", () => {
            swipePointerId = null;
            resetSwipeSubmit();
        });
        window.addEventListener("resize", () => {
            syncTopRowSurfaceHeight();
            scheduleBarsChartResize({ settleDelay: 120 });
            if (!swipePending) {
                resetSwipeSubmit();
            }
        });
    }

    if (typeof ResizeObserver === "function") {
        const topRowLayoutObserver = new ResizeObserver(() => {
            syncTopRowSurfaceHeight();
        });
        if (sidebar instanceof HTMLElement) {
            topRowLayoutObserver.observe(sidebar);
        }
        for (const surface of topRowSurfaces) {
            if (surface instanceof HTMLElement) {
                topRowLayoutObserver.observe(surface);
            }
        }
        if (liveTradingLayoutRow instanceof HTMLElement) {
            topRowLayoutObserver.observe(liveTradingLayoutRow);
        }
        if (barsShell instanceof HTMLElement) {
            const barsShellObserver = new ResizeObserver(() => {
                scheduleBarsChartResize({ settleDelay: 120 });
            });
            barsShellObserver.observe(barsShell);
        }
    }

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        setFeedback("Slide right to submit the live order.", "error");
    });

    syncSideSegmentedControl();
    syncRangeSegmentedControl();
    bindSegmentedControlSync(sideControl, syncSideSegmentedControl);
    bindSegmentedControlSync(rangeControl, syncRangeSegmentedControl);
    syncSwipeSubmitAvailability();
    syncSwipeSubmitTheme();
    resetSwipeSubmit();
    syncPositionsPanelState();
    syncTopRowSurfaceHeight();
    window.requestAnimationFrame(() => {
        syncTopRowSurfaceHeight();
        scheduleBarsChartResize({ settleDelay: 120 });
    });
    setBarsEmptyState(
        getIdleBarsMeta(),
        `Select a valid ticker to load ${formatRangeLabel(getSelectedRange())} 1-minute candlesticks.`,
    );
    void loadPortfolioSnapshot();
    scheduleIntradayBarsRefresh();
});
