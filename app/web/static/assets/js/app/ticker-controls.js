/* Code version: v1.0.0 */
(() => {
    const create = (context) => {
        const {
            $,
            $$,
            THEME_MODE_STORAGE_KEY,
            UNKNOWN_MESSAGE,
            abortActiveWorkspaceHydration,
            bootstrap,
            clearWorkspaceChartTransitionRequest,
            defaults,
            endpoints,
            escapeSuggestionText,
            form,
            getFilledTickers,
            getLanguageState,
            getMinimumRequiredTickers,
            getPortfolioAllocationMode,
            getTickerFields,
            getTickerInputs,
            getWeightFields,
            isBacktestView,
            isDcaView,
            isMarketCapComparison,
            isPortfolioShareMode,
            isPortfolioView,
            labels,
            mobileSidebarMedia,
            normalizeComparisonMetric,
            preferenceStorage,
            rememberCurrentViewUrl,
            removeTickerFromComparePreview,
            reportFetchAbortDebug,
            requestWorkspaceChartTransition,
            runtimeState,
            sanitizeTicker,
            setFormBusyState,
            state,
            theme,
            tickerPattern,
            tickersExplicitlyEquivalent,
            translateUi,
            workspaceModalOverlay,
            workspaceModalOverlayCopy,
            workspaceModalOverlayIcon,
            workspaceModalOverlayTitle,
        } = context;
        const scheduleAutoSubmit = (...args) => context.scheduleAutoSubmit(...args);
        const syncBacktestIntervals = (...args) => context.syncBacktestIntervals(...args);
        const syncDateConstraints = (...args) => context.syncDateConstraints(...args);
        const syncOneDayExtendedHoursSwitch = (...args) => context.syncOneDayExtendedHoursSwitch(...args);
        let dockFrame = null;
        let mobilePagePaddingFrame = 0;
        let mobilePagePaddingShouldPreserveBottom = false;
        let mobilePagePaddingObserver = null;
        let mobilePagePaddingScrollBound = false;
        let mobilePagePaddingScrollTarget = null;
        let compareOverlayTimer = null;
        const portfolioWeightState = {clock: 0, touchedAtByIndex: {}};
        const tickerValidationCache = new Map();

        const isTickerValidationPending = () => getTickerInputs().some((input) => input.dataset.validationPending === "1");

        const setTickerValidationPending = (input, isPending) => {
            if (!input) return;
            input.dataset.validationPending = isPending ? "1" : "";
            input.classList.toggle("is-pending", isPending);
        };
        const syncTickerIdentityState = (input, nextTicker = sanitizeTicker(input?.value?.trim?.() || "")) => {
            if (!input) return "";
            const currentTicker = sanitizeTicker(nextTicker);
            const selectedTicker = sanitizeTicker(input.dataset.symbol || "");
            const validatedTicker = sanitizeTicker(input.dataset.validatedTicker || "");
            const pendingTicker = sanitizeTicker(input.dataset.validationTicker || "");
            if (!currentTicker || (selectedTicker && selectedTicker !== currentTicker)) {
                input.dataset.logoUrl = "";
                input.dataset.symbol = "";
                input.dataset.companyName = "";
            }
            if (!currentTicker || (validatedTicker && validatedTicker !== currentTicker)) {
                input.dataset.validatedTicker = "";
                input.dataset.validatedKnown = "";
            }
            if (!currentTicker || (pendingTicker && pendingTicker !== currentTicker)) {
                input.dataset.validationTicker = "";
            }
            if (!currentTicker) {
                input.dataset.unknown = "";
                setTickerValidationPending(input, false);
            }
            return currentTicker;
        };

        const rememberValidatedTicker = (input, ticker, isKnown) => {
            if (!input) return;
            input.dataset.validatedTicker = ticker || "";
            input.dataset.validatedKnown = isKnown ? "1" : "0";
            if (ticker) tickerValidationCache.set(ticker, isKnown);
        };

        const seedTickerValidationState = () => {
            if (!runtimeState.hasInitialResult) return;
            getTickerInputs().forEach((input) => {
                if (!(input instanceof HTMLInputElement)) return;
                const value = sanitizeTicker(input.value.trim());
                if (!value || !tickerPattern.test(value) || input.dataset.unknown === "1") return;
                rememberValidatedTicker(input, value, true);
                setTickerValidationPending(input, false);
                validateTickerInput(input);
            });
        };

        const validateTickerExistence = async (input, {preferFresh = false} = {}) => {
            if (!input) return false;
            const value = syncTickerIdentityState(input, sanitizeTicker(input.value.trim()));
            input.value = value;
            validateTickerInput(input);
            if (!value) {
                input.dataset.unknown = "";
                rememberValidatedTicker(input, "", false);
                setTickerValidationPending(input, false);
                validateTickerInput(input);
                return false;
            }
            if (!tickerPattern.test(value)) {
                input.dataset.unknown = "";
                rememberValidatedTicker(input, "", false);
                setTickerValidationPending(input, false);
                validateTickerInput(input);
                return false;
            }
            const counts = new Map();
            getFilledTickers().forEach((ticker) => counts.set(ticker, (counts.get(ticker) || 0) + 1));
            if ((counts.get(value) || 0) > 1) {
                input.dataset.unknown = "";
                rememberValidatedTicker(input, "", false);
                setTickerValidationPending(input, false);
                validateTickerInput(input);
                return false;
            }

            if (!preferFresh && input.dataset.validatedTicker === value) {
                const known = input.dataset.validatedKnown !== "0";
                input.dataset.unknown = known ? "" : "1";
                setTickerValidationPending(input, false);
                validateTickerInput(input);
                return known;
            }

            if (!preferFresh && tickerValidationCache.has(value)) {
                const isKnown = Boolean(tickerValidationCache.get(value));
                input.dataset.unknown = isKnown ? "" : "1";
                rememberValidatedTicker(input, value, isKnown);
                setTickerValidationPending(input, false);
                validateTickerInput(input);
                return isKnown;
            }

            setTickerValidationPending(input, true);
            input.dataset.validationTicker = value;
            try {
                const response = await fetch(`${endpoints.symbolSearch}?q=${encodeURIComponent(value)}&limit=5`);
                if (!response.ok) throw new Error(`Ticker lookup failed: ${response.status}`);
                const payload = await response.json();
                const isKnown = Boolean(payload.find((item) => tickersExplicitlyEquivalent(item?.symbol || "", value)));
                if (input.dataset.validationTicker === value) {
                    input.dataset.unknown = isKnown ? "" : "1";
                    if (isKnown) {
                        applyExactTickerMatch(input, payload, value);
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

        const ensureTickerValidityBeforeSubmit = async () => {
            const inputs = getTickerInputs();
            const results = await Promise.all(inputs.map((input) => validateTickerExistence(input, {preferFresh: false})));
            validateAllTickerInputs();
            return results.every((item, index) => {
                const input = inputs[index];
                if (!sanitizeTicker(input.value.trim())) return !input.required;
                return item && input.checkValidity() && input.dataset.unknown !== "1";
            });
        };

        const syncTickerClearButton = (input) => {
            const clearButton = input?.parentElement?.querySelector(".ticker-clear");
            if (!clearButton || !input) return;
            clearButton.classList.toggle("is-visible", Boolean(input.value.trim()));
        };
        const buildMarketStoreLogoUrls = (ticker) => {
            const normalizedTicker = sanitizeTicker(ticker);
            if (!normalizedTicker) return [];
            const encodedTicker = encodeURIComponent(normalizedTicker);
            return [
                `/market-store/logos/${encodedTicker}.png`,
                `/market-store/logos/${encodedTicker}.svg`,
            ];
        };
        const normalizeLogoUrlList = (logoUrl) => {
            const values = Array.isArray(logoUrl) ? logoUrl : [logoUrl];
            return Array.from(new Set(values
                .map((value) => String(value || "").trim())
                .filter(Boolean)));
        };

        const setTickerLogoVisibility = (logo, placeholder, isLoaded) => {
            if (logo instanceof HTMLImageElement) {
                logo.hidden = !isLoaded;
                logo.dataset.loaded = isLoaded ? "1" : "0";
            }
            if (placeholder) placeholder.hidden = isLoaded;
        };

        const syncTickerLogoAsset = (logo, placeholder, logoUrl, altText = "") => {
            const normalizedUrls = normalizeLogoUrlList(logoUrl);
            if (!(logo instanceof HTMLImageElement)) {
                if (placeholder) placeholder.hidden = normalizedUrls.length > 0;
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
                    if (logo.dataset.requestedSrc !== nextUrl) return;
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
                }
            };
            tryLoadAtIndex(0);
        };

        const syncTickerInputDecoration = (input, suggestion = null) => {
            const control = input?.closest(".ticker-input-control");
            if (!control || !input) return;
            const logo = control.querySelector(".ticker-input-logo");
            const placeholder = control.querySelector(".ticker-logo-placeholder");
            const value = input.value.trim();
            const hasTickerLikeValue = Boolean(value);
            const selectedTicker = sanitizeTicker(input.dataset.symbol || "");
            const validatedTicker = sanitizeTicker(input.dataset.validatedTicker || "");
            const suggestedTicker = sanitizeTicker(suggestion?.symbol || "");
            const tickerValue = suggestedTicker || sanitizeTicker(value) || selectedTicker;
    		if (placeholder) {
    			placeholder.textContent = tickerValue ? tickerValue.slice(0, 2) : "";
    			placeholder.dataset.ticker = tickerValue;
    		}
            const profileLogoUrl = state.chart?.profiles?.find((item) => item.ticker === tickerValue)?.logo_url || "";
            const storedLogoUrl = selectedTicker && selectedTicker === tickerValue ? (input.dataset.logoUrl || "") : "";
            const existingLogoUrl = logo instanceof HTMLImageElement
                ? (sanitizeTicker((logo.alt || "").replace(/\s+logo$/i, "")) === tickerValue
                    ? (logo.dataset.requestedSrc || logo.getAttribute("src") || "")
                    : "")
                : "";
            const hasConfirmedTicker = Boolean(
                (suggestedTicker && suggestedTicker === tickerValue)
                || (selectedTicker && selectedTicker === tickerValue)
                || (validatedTicker && validatedTicker === tickerValue)
                || existingLogoUrl
                || profileLogoUrl
            );
            const fallbackLogoUrls = hasConfirmedTicker ? buildMarketStoreLogoUrls(tickerValue) : [];
            const logoUrls = normalizeLogoUrlList([
                suggestion?.logo_url,
                storedLogoUrl,
                profileLogoUrl,
                existingLogoUrl,
    			...fallbackLogoUrls,
            ]);
            control.classList.toggle("has-value", hasTickerLikeValue);
            control.classList.toggle("has-logo", logoUrls.length > 0);
            syncTickerLogoAsset(logo, placeholder, logoUrls, logoUrls.length ? `${tickerValue} logo` : "");
            if (suggestion) {
                input.dataset.logoUrl = suggestion.logo_url || profileLogoUrl || fallbackLogoUrls[0] || "";
                input.dataset.symbol = suggestion.symbol || tickerValue;
                input.dataset.companyName = suggestion.name || suggestion.symbol || "";
            } else if (hasTickerLikeValue && selectedTicker && selectedTicker === tickerValue && !input.dataset.logoUrl && logoUrls.length) {
                input.dataset.logoUrl = logoUrls[0];
            }
            if (!hasTickerLikeValue) {
                input.dataset.logoUrl = "";
                input.dataset.symbol = "";
                input.dataset.companyName = "";
            }
        };

        const applyExactTickerMatch = (input, items, ticker) => {
            if (!input || !Array.isArray(items) || !ticker) return null;
            const exactItem = items.find((item) => tickersExplicitlyEquivalent(item?.symbol || "", ticker)) || null;
            if (!exactItem) return null;
            const exactSymbol = sanitizeTicker(exactItem.symbol || ticker);
            if (exactSymbol) input.value = exactSymbol;
            input.dataset.unknown = "";
            rememberValidatedTicker(input, exactSymbol || ticker, true);
            setTickerValidationPending(input, false);
            syncTickerInputDecoration(input, exactItem);
            validateTickerInput(input);
            return exactItem;
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
            wrapper.hidden = getTickerFields().length >= runtimeState.maxTickers;
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
                    label.textContent = isBacktestView && getMinimumRequiredTickers() > 1
                        ? `${labels.backtest_ticker} ${index}`
                        : (isBacktestView || isDcaView) ? labels.backtest_ticker : `Ticker ${index}`;
                }
                if (input) {
                    input.id = `ticker_${index}`;
                    input.name = "ticker";
                    input.required = index <= getMinimumRequiredTickers();
                    input.placeholder = "";
                    syncTickerClearButton(input);
                    syncTickerInputDecoration(input);
                }
                const weightInput = field.querySelector(".portfolio-weight-input");
                const weightSlider = field.querySelector(".portfolio-weight-slider");
                const shareInput = field.querySelector(".portfolio-share-input");
                if (weightInput && weightSlider) {
                    weightInput.id = `weight_${index}`;
                    weightInput.name = "weight";
                    weightSlider.dataset.index = String(index);
                }
                if (shareInput) {
                    shareInput.id = `shares_${index}`;
                    shareInput.name = "shares";
                }
                if (suggestions) suggestions.id = `ticker_${index}_suggestions`;
                const removeButton = field.querySelector(".ticker-remove");
                if (removeButton) {
                    removeButton.classList.toggle("is-placeholder", index <= getMinimumRequiredTickers());
                    removeButton.tabIndex = index <= getMinimumRequiredTickers() ? -1 : 0;
                    removeButton.setAttribute("aria-hidden", index <= getMinimumRequiredTickers() ? "true" : "false");
                }
            });
            updateAddButtonState();
        };

        const tickerOrderIdentity = (value) => {
            const ticker = sanitizeTicker(value || "");
            return ["SKHY", "SKHYV"].includes(ticker) ? "SKHY" : ticker;
        };

        const animateTickerFieldOrder = (fields, previousTopByField) => {
            fields.forEach((field) => {
                const previousTop = previousTopByField.get(field);
                const nextTop = field.getBoundingClientRect().top;
                const deltaY = Number(previousTop) - nextTop;
                if (!Number.isFinite(deltaY) || Math.abs(deltaY) < 0.5) return;
                field.getAnimations?.().forEach((animation) => {
                    if (animation.id === "ticker-field-order") animation.cancel();
                });
                const animation = window.WorthwardMotion?.animate?.(
                    field,
                    [
                        {
                            transform: `translate3d(0, ${deltaY}px, 0) scale(0.985)`,
                            filter: "drop-shadow(0 14px 22px rgba(15, 23, 42, 0.12))",
                        },
                        {
                            transform: "translate3d(0, 0, 0) scale(1)",
                            filter: "drop-shadow(0 0 0 rgba(15, 23, 42, 0))",
                        },
                    ],
                    {
                        id: "ticker-field-order",
                        duration: window.WorthwardMotion?.durations?.emphasized ?? 420,
                        easing: window.WorthwardMotion?.easingTokens?.emphasized,
                    },
                );
                if (!animation) return;
                field.dataset.orderMotion = "y-z";
                animation.finished.catch(() => {}).finally(() => {
                    if (field.dataset.orderMotion === "y-z") delete field.dataset.orderMotion;
                });
            });
        };

        bootstrap.reorderTickerFieldsByTicker = (tickerOrder = []) => {
            if (state.currentView !== "prices") return [];
            const container = document.getElementById("ticker_fields");
            if (!(container instanceof HTMLElement)) return [];
            const fields = getTickerFields();
            const previousTopByField = new Map(
                fields.map((field) => [field, field.getBoundingClientRect().top]),
            );
            const fieldQueues = new Map();
            fields.forEach((field) => {
                const input = field.querySelector("[data-ticker-input]");
                const identity = tickerOrderIdentity(input?.value || "");
                if (!identity) return;
                const queue = fieldQueues.get(identity) || [];
                queue.push(field);
                fieldQueues.set(identity, queue);
            });
            const orderedFields = [];
            tickerOrder.forEach((ticker) => {
                const queue = fieldQueues.get(tickerOrderIdentity(ticker));
                const field = queue?.shift();
                if (field && !orderedFields.includes(field)) orderedFields.push(field);
            });
            fields.forEach((field) => {
                if (!orderedFields.includes(field)) orderedFields.push(field);
            });
            orderedFields.forEach((field) => container.appendChild(field));
            reindexTickerFields();
            animateTickerFieldOrder(orderedFields, previousTopByField);

            const orderedTickers = getFilledTickers();
            const nextUrl = new URL(window.location.href);
            nextUrl.searchParams.delete("ticker");
            orderedTickers.forEach((ticker) => nextUrl.searchParams.append("ticker", ticker));
            const relativeUrl = `${nextUrl.pathname}?${nextUrl.searchParams.toString()}${nextUrl.hash}`;
            window.history.replaceState(window.history.state, "", relativeUrl);
            rememberCurrentViewUrl(relativeUrl);
            window.dispatchEvent(new CustomEvent("worthward:ticker-order-change", {
                detail: {tickers: orderedTickers},
            }));
            return orderedTickers;
        };

        const syncPortfolioWeightDisabledState = () => {
            if (!isPortfolioView) return;
            getWeightFields().forEach(({field, tickerInput, number, slider, shares}) => {
                const isFilled = Boolean(sanitizeTicker(tickerInput.value.trim()));
                number.disabled = !isFilled;
                slider.disabled = !isFilled;
                if (shares) shares.disabled = !isFilled;
                field.querySelectorAll(".portfolio-share-stepper-button").forEach((button) => {
                    button.disabled = !isFilled;
                });
                if (!isFilled) {
                    number.value = "0";
                    slider.value = "0";
                    if (shares) shares.value = "0";
                }
            });
        };

        const buildDefaultWeights = (count) => {
            if (count <= 0) return [];
            const base = Math.floor(100 / count);
            const remainder = 100 % count;
            return Array.from({length: count}, (_item, index) => base + (index < remainder ? 1 : 0));
        };

        const getFilledWeightEntries = () => getWeightFields()
            .map((item, index) => ({...item, index, ticker: sanitizeTicker(item.tickerInput.value.trim())}))
            .filter((item) => item.ticker);

        const syncPortfolioWeightPair = (entry, value) => {
            const normalized = Math.min(100, Math.max(0, Number.parseInt(String(value || 0), 10) || 0));
            entry.number.value = String(normalized);
            entry.slider.value = String(normalized);
        };

        const syncPortfolioShareInput = (entry, value) => {
            if (!entry?.shares) return;
            const normalized = Math.max(0, Number.parseInt(String(value || 0), 10) || 0);
            entry.shares.value = String(normalized);
        };

        const resolveOrderedPortfolioPeer = (referenceIndex, filledEntries, {preferPrevious = true} = {}) => {
            const previousCandidates = filledEntries.filter((entry) => entry.index < referenceIndex);
            const nextCandidates = filledEntries.filter((entry) => entry.index > referenceIndex);
            if (preferPrevious && previousCandidates.length) {
                return previousCandidates[previousCandidates.length - 1];
            }
            if (!preferPrevious && nextCandidates.length) {
                return nextCandidates[0];
            }
            return preferPrevious
                ? (nextCandidates[0] || null)
                : (previousCandidates[previousCandidates.length - 1] || null);
        };

        const resolvePassivePortfolioEntry = (changedIndex, filledEntries) => (
            resolveOrderedPortfolioPeer(changedIndex, filledEntries, {preferPrevious: true})
        );

        const computeActiveWeightBounds = (changedIndex, filledEntries) => {
            const passiveEntry = resolvePassivePortfolioEntry(changedIndex, filledEntries);
            if (!passiveEntry) {
                return {min: 100, max: 100, passiveEntry: null};
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
                    `${passiveEntry.ticker} stayed paired by ticker order, so ${activeEntry.ticker} was limited to keep the total at 100%.`,
                );
            }
            markPortfolioWeightTouched(changedIndex);
            syncPortfolioWeightBounds();
        };

        const rebalancePortfolioWeightsAfterRemoval = (removedWeight = 0, removedIndex = -1) => {
            if (!isPortfolioView) return;
            ensurePortfolioWeightTouches();
            const filledEntries = getFilledWeightEntries();
            if (!filledEntries.length) return;
            if (filledEntries.length === 1) {
                syncPortfolioWeightPair(filledEntries[0], 100);
                markPortfolioWeightTouched(filledEntries[0].index);
                syncPortfolioWeightBounds();
                return;
            }
            const currentTotal = filledEntries.reduce((sum, entry) => sum + (Number.parseInt(entry.number.value, 10) || 0), 0);
            const deficit = Math.max(0, 100 - currentTotal);
            const targetAdjustment = deficit || Math.max(0, Number.parseInt(String(removedWeight || 0), 10) || 0);
            if (targetAdjustment <= 0) {
                syncPortfolioWeightBounds();
                return;
            }
            const passiveEntry = filledEntries[Math.max(0, Math.min(removedIndex - 1, filledEntries.length - 1))] || filledEntries[0];
            const nextValue = (Number.parseInt(passiveEntry.number.value, 10) || 0) + targetAdjustment;
            syncPortfolioWeightPair(passiveEntry, Math.min(100, nextValue));
            markPortfolioWeightTouched(passiveEntry.index);
            syncPortfolioWeightBounds();
        };

        const dispatchPortfolioPreviewUpdate = () => {
            if (!isPortfolioView) return;
            window.dispatchEvent(new CustomEvent("worthward:portfolio-preview", {
                detail: {
                    allocation: getPortfolioAllocationMode(),
                    entries: getFilledWeightEntries().map((entry) => ({
                        index: entry.index,
                        ticker: entry.ticker,
                        weight: Number.parseInt(entry.number.value, 10) || 0,
                        shares: Number.parseInt(entry.shares?.value || "0", 10) || 0,
                    })),
                },
            }));
        };

        const validatePortfolioWeightInputs = () => {
            if (!isPortfolioView) return true;
            let isValid = true;
            const shareMode = isPortfolioShareMode();
            getWeightFields().forEach((entry) => {
                const {tickerInput, number, shares} = entry;
                const ticker = sanitizeTicker(tickerInput.value.trim());
                if (shareMode) {
                    const shareCount = Number.parseInt(shares?.value || "0", 10) || 0;
                    if (ticker && shareCount <= 0) {
                        shares?.classList.add("is-invalid");
                        if (!entry.tooltip?.textContent) {
                            showPortfolioWeightTooltip(entry, "Each selected ticker must have at least 1 share.");
                        }
                        isValid = false;
                        return;
                    }
                    shares?.classList.remove("is-invalid");
                    number.classList.remove("is-invalid");
                    return;
                }
                const weight = Number.parseInt(number.value, 10) || 0;
                if (ticker && weight <= 0) {
                    number.classList.add("is-invalid");
                    if (!entry.tooltip?.textContent) {
                        showPortfolioWeightTooltip(entry, "Each selected ticker must have a weight above 0%.");
                    }
                    isValid = false;
                    return;
                }
                number.classList.remove("is-invalid");
                shares?.classList.remove("is-invalid");
            });
            return isValid;
        };

        const restoreRetainedPortfolioWeight = (tickerInput) => {
            if (!isPortfolioView || !tickerInput) return;
            const field = tickerInput.closest(".ticker-field");
            const number = field?.querySelector(".portfolio-weight-input");
            const slider = field?.querySelector(".portfolio-weight-slider");
            const retainedWeight = Number.parseInt(tickerInput.dataset.retainedWeight || "", 10);
            if (!number || !slider) return;
            if (!sanitizeTicker(tickerInput.value.trim())) return;
            if (!Number.isFinite(retainedWeight) || retainedWeight <= 0) return;
            if ((Number.parseInt(number.value, 10) || 0) > 0) return;
            number.value = String(retainedWeight);
            slider.value = String(retainedWeight);
            delete tickerInput.dataset.retainedWeight;
        };

        const handlePortfolioTickerValueChange = (tickerInput) => {
            if (!isPortfolioView || !tickerInput) return;
            const field = tickerInput.closest(".ticker-field");
            const number = field?.querySelector(".portfolio-weight-input");
            const slider = field?.querySelector(".portfolio-weight-slider");
            const entry = getWeightFields().find((item) => item.tickerInput === tickerInput);
            if (!number || !slider || !entry) return;

            const previousTicker = tickerInput.dataset.lastTicker || "";
            const ticker = sanitizeTicker(tickerInput.value.trim());
            if (!ticker && previousTicker) {
                const currentWeight = Number.parseInt(number.value, 10) || 0;
                if (currentWeight > 0) {
                    tickerInput.dataset.retainedWeight = String(currentWeight);
                }
            }
            if (ticker && !previousTicker) {
                restoreRetainedPortfolioWeight(tickerInput);
            }

            syncPortfolioWeightDisabledState();
            if (ticker && !getPortfolioWeightTouchStamp(entry.index)) {
                markPortfolioWeightTouched(entry.index);
            }
            if (!ticker) {
                dropPortfolioWeightTouch(entry.index);
            }

            const filledEntries = getFilledWeightEntries();
            if (filledEntries.length && filledEntries.every((item) => (Number.parseInt(item.number.value, 10) || 0) === 0)) {
                const defaults = buildDefaultWeights(filledEntries.length);
                filledEntries.forEach((item, itemIndex) => syncPortfolioWeightPair(item, defaults[itemIndex] || 0));
            }

            syncPortfolioWeightBounds();
            dispatchPortfolioPreviewUpdate();
            validatePortfolioWeightInputs();
            tickerInput.dataset.lastTicker = ticker;
        };

        const attachPortfolioWeightHandlers = () => {
            if (!isPortfolioView) return;
            getWeightFields().forEach(({field, number, slider, shares, tickerInput, index}) => {
                if (number.dataset.bound === "1") return;
                number.dataset.bound = "1";
                if (shares) shares.dataset.bound = "1";
                if (tickerInput) tickerInput.dataset.lastTicker = sanitizeTicker(tickerInput.value.trim());
                const syncAndRefresh = (source) => {
                    const value = Math.min(100, Math.max(0, Number.parseInt(String(source.value || 0), 10) || 0));
                    number.value = String(value);
                    slider.value = String(value);
                    rebalancePortfolioWeights(index);
                    dispatchPortfolioPreviewUpdate();
                    validatePortfolioWeightInputs();
                    requestWorkspaceChartTransition("portfolio-weight");
                    scheduleAutoSubmit(180);
                };
                const syncSharesAndRefresh = (source) => {
                    const value = Math.max(0, Number.parseInt(String(source.value || 0), 10) || 0);
                    if (shares) shares.value = String(value);
                    dispatchPortfolioPreviewUpdate();
                    validatePortfolioWeightInputs();
                    requestWorkspaceChartTransition("portfolio-shares");
                    if (isPortfolioShareMode()) scheduleAutoSubmit(180);
                };
                const openSlider = () => {
                    if (isPortfolioShareMode()) return;
                    field.querySelector(".portfolio-weight-field")?.classList.add("is-open");
                };
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
                shares?.addEventListener("input", () => syncSharesAndRefresh(shares));
                field.querySelectorAll(".portfolio-share-stepper-button").forEach((button) => {
                    if (button.dataset.bound === "1") return;
                    button.dataset.bound = "1";
                    button.addEventListener("click", () => {
                        if (!shares || shares.disabled) return;
                        const step = Number.parseInt(button.dataset.shareStep || "0", 10) || 0;
                        syncPortfolioShareInput({shares}, (Number.parseInt(shares.value || "0", 10) || 0) + step);
                        syncSharesAndRefresh(shares);
                    });
                });
                tickerInput?.addEventListener("input", () => {
                    handlePortfolioTickerValueChange(tickerInput);
                });
            });
        };

        const validateTickerInput = (input) => {
            const rawValue = input.value.trim();
            const value = syncTickerIdentityState(input, sanitizeTicker(rawValue));
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
            if (!input.validationMessage) hideTickerValidationTooltip(input);
            return value;
        };

        const validateAllTickerInputs = () => {
            getTickerInputs().forEach((input) => validateTickerInput(input));
        };

        const readTickerControlWidthRatio = (element) => {
            if (!(element instanceof HTMLElement)) return 1;
            const rawValue = getComputedStyle(element).getPropertyValue("--ticker-control-width").trim();
            if (rawValue.endsWith("%")) {
                const ratio = Number.parseFloat(rawValue);
                return Number.isFinite(ratio) ? ratio / 100 : 1;
            }
            const ratio = Number.parseFloat(rawValue);
            return Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
        };

        const readTickerValidationArrowRise = (element) => {
            if (!(element instanceof HTMLElement)) return 0;
            const rawValue = getComputedStyle(element).getPropertyValue("--ticker-validation-arrow-rise").trim();
            const rise = Number.parseFloat(rawValue);
            return Number.isFinite(rise) ? rise : 0;
        };

        const positionTickerValidationTooltip = (input) => {
            if (!(input instanceof HTMLElement)) return;
            const tooltipId = input.dataset.validationTooltipId;
            if (!tooltipId) return;
            const tooltip = document.getElementById(tooltipId);
            if (!(tooltip instanceof HTMLElement) || tooltip.hidden) return;
            const host = input.closest(".ticker-input-main");
            if (!(host instanceof HTMLElement)) return;
            const hostRect = host.getBoundingClientRect();
            const controls = input.closest(".compare-controls, .portfolio-controls, .trade-controls, .ticker-form-controls, .ticker-controls");
            const widthRatio = readTickerControlWidthRatio(controls || host);
            const arrowRise = readTickerValidationArrowRise(controls || host);
            tooltip.style.left = `${hostRect.left + (hostRect.width * widthRatio / 2)}px`;
            tooltip.style.top = `${hostRect.top + (hostRect.height / 2) + (arrowRise / 2)}px`;
        };

        const syncVisibleTickerValidationTooltips = () => {
            getTickerInputs().forEach((input) => positionTickerValidationTooltip(input));
        };

        const ensureTickerValidationTooltip = (input) => {
            if (!(input instanceof HTMLElement)) return null;
            if (!input.id) input.id = `ticker_validation_${Math.random().toString(36).slice(2, 10)}`;
            let tooltipId = input.dataset.validationTooltipId;
            if (!tooltipId) {
                tooltipId = `${input.id}_validation_tooltip`;
                input.dataset.validationTooltipId = tooltipId;
            }
            let tooltip = document.getElementById(tooltipId);
            if (tooltip instanceof HTMLElement) return tooltip;
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

        const hideTickerValidationTooltip = (input) => {
            const tooltip = ensureTickerValidationTooltip(input);
            if (!(tooltip instanceof HTMLElement)) return;
            tooltip.hidden = true;
            const copy = tooltip.querySelector(".field-tooltip-validation-copy");
            if (copy instanceof HTMLElement) copy.textContent = "";
        };

        const showTickerValidationTooltip = (input, message = input.validationMessage) => {
            if (!message) return;
            getTickerInputs().forEach((tickerInput) => {
                if (tickerInput !== input) hideTickerValidationTooltip(tickerInput);
            });
            if (document.activeElement !== input) {
                input.focus({preventScroll: true});
            }
            const tooltip = ensureTickerValidationTooltip(input);
            if (!(tooltip instanceof HTMLElement)) return;
            const copy = tooltip.querySelector(".field-tooltip-validation-copy");
            if (copy instanceof HTMLElement) {
                copy.textContent = message;
            } else {
                tooltip.textContent = message;
            }
            tooltip.hidden = false;
            positionTickerValidationTooltip(input);
            input.scrollIntoView({block: "nearest", inline: "nearest"});
        };

        window.addEventListener("resize", syncVisibleTickerValidationTooltips);
        document.addEventListener("scroll", syncVisibleTickerValidationTooltips, true);

        const closeTickerSuggestionPanels = ({exceptInput = null} = {}) => {
            document.querySelectorAll(".suggestions.is-open").forEach((panel) => {
                const ownerInputId = String(panel.id || "").replace(/_suggestions$/, "");
                const ownerInput = ownerInputId ? document.getElementById(ownerInputId) : null;
                if (exceptInput && ownerInput === exceptInput) return;
                panel.innerHTML = "";
                panel.classList.remove("is-open");
            });
        };

        const resolveTickerSuggestionInputForTarget = (target) => {
            if (!(target instanceof Element)) return null;
            const input = target.closest("[data-ticker-input]");
            if (input instanceof HTMLInputElement) return input;
            const panel = target.closest(".suggestions");
            if (!(panel instanceof HTMLElement)) return null;
            const ownerInputId = String(panel.id || "").replace(/_suggestions$/, "");
            const ownerInput = ownerInputId ? document.getElementById(ownerInputId) : null;
            return ownerInput instanceof HTMLInputElement ? ownerInput : null;
        };

        const bindTickerSuggestionDismissal = () => {
            if (document.body.dataset.tickerSuggestionDismissalBound === "1") return;
            document.body.dataset.tickerSuggestionDismissalBound = "1";
            document.addEventListener("pointerdown", (event) => {
                closeTickerSuggestionPanels({
                    exceptInput: resolveTickerSuggestionInputForTarget(event.target),
                });
            }, true);
            document.addEventListener("focusin", (event) => {
                closeTickerSuggestionPanels({
                    exceptInput: resolveTickerSuggestionInputForTarget(event.target),
                });
            }, true);
            document.addEventListener("keydown", (event) => {
                if (event.key === "Escape") closeTickerSuggestionPanels();
            }, true);
        };

        const setupAutocomplete = (input) => {
            if (!input || input.dataset.autocompleteReady === "1") return;
            bindTickerSuggestionDismissal();
            input.dataset.autocompleteReady = "1";
            let autocompleteRequestSequence = 0;
            let autocompleteTimer = 0;
            let activeIndex = -1;

            const getPanel = () => document.getElementById(`${input.id}_suggestions`);
            const getButtons = () => Array.from(getPanel()?.querySelectorAll(".suggestion-item") || []);
            const showLoadingPanel = (ticker) => {
                const panel = getPanel();
                const symbol = sanitizeTicker(ticker || "");
                if (!panel || !symbol) return;
                const status = document.createElement("div");
                status.className = "suggestion-loading";
                status.setAttribute("role", "status");
                status.setAttribute("aria-live", "polite");
                const spinner = document.createElement("span");
                spinner.className = "suggestion-loading-spinner";
                spinner.setAttribute("aria-hidden", "true");
                const copy = document.createElement("span");
                copy.textContent = `Fetching ${symbol}\u2026`;
                status.append(spinner, copy);
                panel.replaceChildren(status);
                panel.classList.add("is-open");
                activeIndex = -1;
            };
            const querySuggestions = async (rawValue, {limit = 5, preserveUnknown = false} = {}) => {
                const queryValue = sanitizeTicker(String(rawValue || "").trim());
                if (!queryValue) {
                    if (!preserveUnknown) setUnknown(false);
                    await showRecentItems();
                    return;
                }
                const requestId = ++autocompleteRequestSequence;
                showLoadingPanel(queryValue);
                try {
                    const response = await fetch(`${endpoints.symbolSearch}?q=${encodeURIComponent(queryValue)}&limit=${limit}`);
                    if (!response.ok) return closePanel();
                    const payload = await response.json();
                    if (
                        requestId !== autocompleteRequestSequence
                        || input.dataset.composing === "1"
                        || sanitizeTicker(input.value.trim()) !== queryValue
                    ) return;
                    if (!Array.isArray(payload) || !payload.length) {
                        if (!preserveUnknown) setUnknown(true);
                        closePanel();
                        return;
                    }
                    if (!preserveUnknown) {
                        const exactMatch = Boolean(applyExactTickerMatch(input, payload, queryValue));
                        tickerValidationCache.set(queryValue, exactMatch);
                        input.dataset.unknown = exactMatch ? "" : input.dataset.unknown;
                        validateTickerInput(input);
                    }
                    renderItems(payload);
                } catch (_error) {
                    closePanel();
                }
            };
            const setUnknown = (flag) => {
                input.dataset.unknown = flag ? "1" : "";
                if (flag && input.value.trim()) tickerValidationCache.set(sanitizeTicker(input.value.trim()), false);
                validateTickerInput(input);
            };
            const syncActiveSuggestion = () => {
                getButtons().forEach((button, index) => {
                    button.classList.toggle("is-active", index === activeIndex);
                    if (index === activeIndex) button.scrollIntoView({block: "nearest"});
                });
            };
            const closePanel = () => {
                const panel = getPanel();
                if (!panel) return;
                panel.innerHTML = "";
                panel.classList.remove("is-open");
                activeIndex = -1;
            };
            const requestTickerCalculation = (reason = "ticker-change") => {
                if (!(isBacktestView || isDcaView)) requestWorkspaceChartTransition(reason);
            };
            const syncCommittedTickerSelection = (reason = "ticker-change") => {
                validateAllTickerInputs();
                handlePortfolioTickerValueChange(input);
                closePanel();
                syncOneDayExtendedHoursSwitch();
                syncDateConstraints();
                if (isBacktestView) syncBacktestIntervals();
                requestTickerCalculation(reason);
            };
            const finalizeTickerLoad = (reason = "ticker-change", delay = 120) => {
                syncCommittedTickerSelection(reason);
                scheduleAutoSubmit(delay);
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
            const applySuggestion = (item, {autoLoad = false} = {}) => {
                const selectedSymbol = sanitizeTicker(item.symbol || "");
                input.value = selectedSymbol;
                input.dataset.unknown = "";
                input.dataset.validationTicker = selectedSymbol;
                tickerValidationCache.set(selectedSymbol, true);
                setTickerValidationPending(input, false);
                input.setCustomValidity("");
                syncTickerInputDecoration(input, item);
                input.focus();
                if (autoLoad) {
                    finalizeTickerLoad("ticker-change", 72);
                    return;
                }
                syncCommittedTickerSelection("ticker-change");
            };

            const renderItems = (items) => {
                const panel = getPanel();
                if (!panel) return;
                if (!items.length) {
                    closePanel();
                    return;
                }
                setUnknown(false);
                const groups = [
                    {key: "recent", title: "Recent"},
                    {key: "local", title: "Local"},
                    {key: "remote", title: "Matches"},
                ].filter((group) => items.some((item) => item.source === group.key));
                panel.innerHTML = groups.map((group) => {
                    const entries = items.filter((item) => item.source === group.key).map((item) => ({
                        symbol: escapeSuggestionText(item.symbol),
                        name: escapeSuggestionText(item.name),
                        logo_url: escapeSuggestionText(item.logo_url),
                    }));
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
                    button.addEventListener("pointerdown", (event) => {
                        event.preventDefault();
                    });
                    button.addEventListener("click", () => {
                        applySuggestion({
                            symbol: button.dataset.symbol || "",
                            logo_url: button.dataset.logoUrl || "",
                            name: button.dataset.name || button.dataset.symbol || "",
                        }, {autoLoad: true});
                    });
                });
            };

            const handleTickerInput = async () => {
                if (isPortfolioView) requestWorkspaceChartTransition("ticker-edit");
                else if (!(isBacktestView || isDcaView)) clearWorkspaceChartTransitionRequest();
                hideTickerValidationTooltip(input);
                syncTickerIdentityState(input, sanitizeTicker(input.value.trim()));
                syncTickerInputDecoration(input);
                syncOneDayExtendedHoursSwitch();
                const rawQuery = input.value.trim();
                const query = validateTickerInput(input);
                if (!rawQuery) {
                    autocompleteRequestSequence += 1;
                    if (autocompleteTimer) {
                        window.clearTimeout(autocompleteTimer);
                        autocompleteTimer = 0;
                    }
                    setUnknown(false);
                    await showRecentItems();
                    return;
                }
                if (autocompleteTimer) {
                    window.clearTimeout(autocompleteTimer);
                    autocompleteTimer = 0;
                }
                const requestId = ++autocompleteRequestSequence;
                if (query && tickerPattern.test(query)) showLoadingPanel(query);
                autocompleteTimer = window.setTimeout(async () => {
                    autocompleteTimer = 0;
                    try {
                        reportFetchAbortDebug("A", "app.js:setupAutocomplete", "starting symbol search request", {
                            rawQuery,
                            query,
                            inputId: input.id || "",
                            requestId,
                        });
                        const response = await fetch(`${endpoints.symbolSearch}?q=${encodeURIComponent(rawQuery)}`);
                        reportFetchAbortDebug("A", "app.js:setupAutocomplete", "symbol search response received", {
                            rawQuery,
                            query,
                            inputId: input.id || "",
                            status: response.status,
                            requestId,
                        });
                        if (requestId !== autocompleteRequestSequence || sanitizeTicker(input.value.trim()) !== query) return;
                        if (!response.ok) return closePanel();
                        const payload = await response.json();
                        if (requestId !== autocompleteRequestSequence || sanitizeTicker(input.value.trim()) !== query) return;
                        if (!payload.length) {
                            setUnknown(true);
                            closePanel();
                            return;
                        }
                        const exactMatch = Boolean(applyExactTickerMatch(input, payload, query));
                        if (query) tickerValidationCache.set(query, exactMatch);
                        input.dataset.unknown = exactMatch ? "" : input.dataset.unknown;
                        validateTickerInput(input);
                        renderItems(payload);
                    } catch (error) {
                        reportFetchAbortDebug("A", "app.js:setupAutocomplete", "symbol search request failed", {
                            rawQuery,
                            query,
                            inputId: input.id || "",
                            requestId,
                            errorName: error?.name || "",
                            errorMessage: error?.message || "",
                        });
                        if (requestId === autocompleteRequestSequence) closePanel();
                    }
                }, 50);
            };
            input.addEventListener("compositionstart", () => {
                input.dataset.composing = "1";
                autocompleteRequestSequence += 1;
                closePanel();
                if (autocompleteTimer) {
                    window.clearTimeout(autocompleteTimer);
                    autocompleteTimer = 0;
                }
            });
            input.addEventListener("compositionend", () => {
                delete input.dataset.composing;
                input.dataset.skipComposedInput = "1";
                void handleTickerInput();
                window.queueMicrotask(() => {
                    delete input.dataset.skipComposedInput;
                });
            });
            input.addEventListener("input", (event) => {
                if (event.isComposing || input.dataset.composing === "1") return;
                if (input.dataset.skipComposedInput === "1") {
                    delete input.dataset.skipComposedInput;
                    return;
                }
                void handleTickerInput();
            });
            input.addEventListener("focus", async () => {
                hideTickerValidationTooltip(input);
                if (input.value.trim()) {
                    input.select();
                    await querySuggestions(input.value.trim(), {preserveUnknown: true});
                    return;
                }
                setUnknown(false);
                await showRecentItems();
            });
            input.addEventListener("click", async () => {
                hideTickerValidationTooltip(input);
                if (getPanel()?.classList.contains("is-open")) return;
                if (input.value.trim()) {
                    input.select();
                    await querySuggestions(input.value.trim(), {preserveUnknown: true});
                    return;
                }
                setUnknown(false);
                await showRecentItems();
            });
            input.addEventListener("blur", () => {
                window.setTimeout(closePanel, 120);
                if (input.dataset.composing === "1") return;
                void validateTickerExistence(input, {preferFresh: true}).then((isKnown) => {
                    if (isKnown) finalizeTickerLoad("ticker-change");
                });
            });
            input.addEventListener("keydown", (event) => {
                if (event.isComposing || input.dataset.composing === "1" || event.keyCode === 229) return;
                const buttons = getButtons();
                if (event.key === "ArrowDown") {
                    if (!buttons.length) return;
                    event.preventDefault();
                    activeIndex = Math.min(activeIndex + 1, buttons.length - 1);
                    syncActiveSuggestion();
                    return;
                }
                if (event.key === "ArrowUp") {
                    if (!buttons.length) return;
                    event.preventDefault();
                    activeIndex = Math.max(activeIndex - 1, 0);
                    syncActiveSuggestion();
                    return;
                }
                if (event.key === "Enter" && activeIndex >= 0) {
                    event.preventDefault();
                    const activeButton = buttons[activeIndex];
                    applySuggestion({
                        symbol: activeButton?.dataset.symbol || "",
                        logo_url: activeButton?.dataset.logoUrl || "",
                        name: activeButton?.dataset.name || activeButton?.dataset.symbol || "",
                    }, {autoLoad: true});
                    return;
                }
                if (event.key === "Enter") {
                    event.preventDefault();
                    finalizeTickerLoad("ticker-change", 72);
                    input.blur();
                    return;
                }
                if (event.key === "Escape") {
                    closePanel();
                }
            });
            input.addEventListener("change", () => {
                closePanel();
                void validateTickerExistence(input, {preferFresh: true});
                finalizeTickerLoad("ticker-change");
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
                    syncTickerIdentityState(input, "");
                    syncTickerInputDecoration(input);
                    validateAllTickerInputs();
                    handlePortfolioTickerValueChange(input);
                    syncDateConstraints();
                    if (isPortfolioView) requestWorkspaceChartTransition("ticker-clear");
                    scheduleAutoSubmit(120);
                    input.focus();
                });
            });
        };

        const readSidebarDockPosition = () => {
            const sidebar = $(".sidebar");
            const dock = $(".sidebar-dock");
            if (!sidebar || !dock || mobileSidebarMedia.matches) return {dock, left: ""};
            const rect = sidebar.getBoundingClientRect();
            return {dock, left: `${Math.round(rect.left + rect.width / 2)}px`};
        };

        const positionSidebarDock = ({dock, left} = {}) => {
            if (!(dock instanceof HTMLElement)) return;
            dock.style.left = left || "";
        };

        const scheduleDockPosition = () => {
            dockFrame?.();
            if (window.WorthwardMotion?.scheduler?.readWrite) {
                dockFrame = window.WorthwardMotion.scheduler.readWrite(
                    "sidebar-dock-position",
                    readSidebarDockPosition,
                    positionSidebarDock,
                );
                return;
            }
            let frameId = 0;
            frameId = window.requestAnimationFrame(() => {
                dockFrame = null;
                positionSidebarDock(readSidebarDockPosition());
            });
            dockFrame = () => window.cancelAnimationFrame(frameId);
        };

        const readElementCssPx = (element, propertyName, fallback = 0) => {
            if (!(element instanceof HTMLElement)) return fallback;
            const rawValue = getComputedStyle(element).getPropertyValue(propertyName).trim();
            const px = Number.parseFloat(rawValue);
            return Number.isFinite(px) ? px : fallback;
        };

        const isVerticallyScrollable = (element) => {
            if (!(element instanceof HTMLElement)) return false;
            if (element.hidden || element.getClientRects().length === 0) return false;
            const styles = getComputedStyle(element);
            if (!["auto", "scroll", "overlay"].includes(styles.overflowY)) return false;
            return element.clientHeight > 0 && element.scrollHeight > (element.clientHeight + 1);
        };

        const isMobilePageScrollHostCandidate = (candidate, page) => {
            if (!(candidate instanceof HTMLElement) || candidate === page) return false;
            if (!page.contains(candidate) || !isVerticallyScrollable(candidate)) return false;
            return candidate.clientHeight >= (page.clientHeight * 0.45) && candidate.clientWidth >= (page.clientWidth * 0.6);
        };

        const getMobilePageBottomPaddingScrollHost = (page) => {
            if (!(page instanceof HTMLElement)) return null;
            if (isMobilePageScrollHostCandidate(mobilePagePaddingScrollTarget, page)) return mobilePagePaddingScrollTarget;
            const workspacePanel = $("#workspace_panel");
            if (!(workspacePanel instanceof HTMLElement)) return page;
            const candidates = Array.from(workspacePanel.querySelectorAll(".workspace-header > .chart-surface, .settings-surface, .settings-workspace-header, .timing-surface"));
            let bestCandidate = null;
            let bestHeight = 0;
            for (const candidate of candidates) {
                if (!isMobilePageScrollHostCandidate(candidate, page)) continue;
                if (candidate.clientHeight <= bestHeight) continue;
                bestCandidate = candidate;
                bestHeight = candidate.clientHeight;
            }
            mobilePagePaddingScrollTarget = bestCandidate;
            return bestCandidate || page;
        };

        const syncMobilePageBottomPadMetrics = (page) => {
            if (!(page instanceof HTMLElement)) return {scrollBottomPad: 0, endBottomPad: 0};
            const scrollBottomPad = readElementCssPx(page, "--page-mobile-scroll-bottom-pad-base", readElementCssPx(page, "--page-edge-pad", 10));
            const endBottomPad = scrollBottomPad;
            page.style.setProperty("--page-mobile-scroll-bottom-pad", `${scrollBottomPad}px`);
            page.style.setProperty("--page-mobile-end-bottom-pad", `${endBottomPad}px`);
            return {scrollBottomPad, endBottomPad};
        };

        const syncMobilePageBottomPadding = ({preserveBottom = false} = {}) => {
            const page = $(".page");
            if (!(page instanceof HTMLElement)) return;
            if (!mobileSidebarMedia.matches) {
                delete page.dataset.mobileScrollEdge;
                page.style.removeProperty("--page-mobile-scroll-bottom-pad");
                page.style.removeProperty("--page-mobile-end-bottom-pad");
                mobilePagePaddingScrollTarget = null;
                return;
            }

            const {scrollBottomPad, endBottomPad} = syncMobilePageBottomPadMetrics(page);
            const scrollHost = getMobilePageBottomPaddingScrollHost(page) || page;
            const isBottomState = page.dataset.mobileScrollEdge === "bottom";
            const activeBottomPad = scrollHost === page && isBottomState ? endBottomPad : scrollBottomPad;
            const contentHeight = scrollHost === page
                ? Math.max(0, scrollHost.scrollHeight - activeBottomPad)
                : scrollHost.scrollHeight;
            const baseBottomScrollTop = scrollHost === page
                ? Math.max(0, contentHeight + scrollBottomPad - scrollHost.clientHeight)
                : Math.max(0, scrollHost.scrollHeight - scrollHost.clientHeight);
            const bottomThreshold = Math.max(2, Math.round(scrollBottomPad));
            const shouldUseEndBottomPad = scrollHost === page
                ? contentHeight <= scrollHost.clientHeight || scrollHost.scrollTop >= (baseBottomScrollTop - bottomThreshold)
                : scrollHost.scrollTop >= (baseBottomScrollTop - bottomThreshold);

            if (scrollHost === page && shouldUseEndBottomPad) page.dataset.mobileScrollEdge = "bottom";
            else delete page.dataset.mobileScrollEdge;

            if (preserveBottom && scrollHost === page && shouldUseEndBottomPad && !isBottomState) {
                window.requestAnimationFrame(() => {
                    const targetScrollTop = Math.max(0, contentHeight + endBottomPad - scrollHost.clientHeight);
                    if (page.scrollTop < targetScrollTop) page.scrollTop = targetScrollTop;
                });
            }
        };

        const scheduleMobilePageBottomPaddingSync = ({preserveBottom = false} = {}) => {
            if (preserveBottom) mobilePagePaddingShouldPreserveBottom = true;
            if (mobilePagePaddingFrame) return;
            mobilePagePaddingFrame = window.requestAnimationFrame(() => {
                mobilePagePaddingFrame = 0;
                const shouldPreserveBottom = mobilePagePaddingShouldPreserveBottom;
                mobilePagePaddingShouldPreserveBottom = false;
                syncMobilePageBottomPadding({preserveBottom: shouldPreserveBottom});
            });
        };

        const initMobilePageBottomPadding = () => {
            const page = $(".page");
            if (!(page instanceof HTMLElement)) return;
            if (page.dataset.mobileBottomPaddingBound !== "1") {
                page.dataset.mobileBottomPaddingBound = "1";
                page.addEventListener("scroll", () => scheduleMobilePageBottomPaddingSync({preserveBottom: true}), {passive: true});
            }
            if (!mobilePagePaddingScrollBound) {
                mobilePagePaddingScrollBound = true;
                document.addEventListener("scroll", (event) => {
                    const pageElement = $(".page");
                    if (!(pageElement instanceof HTMLElement)) return;
                    const target = event.target;
                    if (!(target instanceof HTMLElement)) return;
                    if (target !== pageElement && !pageElement.contains(target)) return;
                    if (target === pageElement) mobilePagePaddingScrollTarget = null;
                    else if (isMobilePageScrollHostCandidate(target, pageElement)) mobilePagePaddingScrollTarget = target;
                    scheduleMobilePageBottomPaddingSync({preserveBottom: target === pageElement});
                }, {capture: true, passive: true});
            }
            if (mobilePagePaddingObserver) mobilePagePaddingObserver.disconnect();
            mobilePagePaddingObserver = null;
            if (typeof ResizeObserver === "function") {
                mobilePagePaddingObserver = new ResizeObserver(() => scheduleMobilePageBottomPaddingSync());
                mobilePagePaddingObserver.observe(page);
                const workspacePanel = $("#workspace_panel");
                if (workspacePanel instanceof HTMLElement) mobilePagePaddingObserver.observe(workspacePanel);
            }
            scheduleMobilePageBottomPaddingSync();
        };

        const readThemeModePreference = () => {
            try {
                const stored = preferenceStorage.local.getItem(THEME_MODE_STORAGE_KEY)
                    ?? (state.currentView === "beta" ? preferenceStorage.local.getItem("worthward:theme-mode") : null);
                return stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
            } catch (_error) {
                return "system";
            }
        };

        const writeThemeModePreference = (mode) => {
            try {
                preferenceStorage.local.setItem(THEME_MODE_STORAGE_KEY, mode);
            } catch (_error) {
            }
        };

        const applyThemeModePreference = (mode) => {
            const normalizedMode = mode === "light" || mode === "dark" || mode === "system" ? mode : "system";
            const previousMode = document.documentElement.dataset.themeMode;

            if (previousMode && previousMode !== normalizedMode) {
                document.documentElement.classList.add("is-theme-transitioning");
                window.setTimeout(() => document.documentElement.classList.remove("is-theme-transitioning"), 400);
            }

            document.documentElement.dataset.themeMode = normalizedMode;
            if (normalizedMode === "system") {
                document.documentElement.removeAttribute("data-theme-override");
            } else {
                document.documentElement.setAttribute("data-theme-override", normalizedMode);
            }
            window.dispatchEvent(new CustomEvent("worthward:theme-mode-change", {
                detail: {mode: normalizedMode},
            }));
        };

        const getEffectiveThemeMode = (mode = document.documentElement.dataset.themeMode) => {
            if (mode === "light" || mode === "dark") return mode;
            return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
        };

        const syncThemeModeForm = (mode) => {
            const formElement = document.querySelector("[data-theme-mode-form]");
            if (!(formElement instanceof HTMLFormElement)) return;
            const normalizedMode = mode === "light" || mode === "dark" || mode === "system" ? mode : "system";
            Array.from(formElement.querySelectorAll("[data-theme-mode-option]")).forEach((option) => {
                if (option instanceof HTMLInputElement) option.checked = option.value === normalizedMode;
            });
        };

        const syncGlobalThemeToggle = () => {
            const toggle = document.getElementById("global_theme_toggle");
            if (!(toggle instanceof HTMLButtonElement)) return;
            const effectiveMode = getEffectiveThemeMode();
            const nextMode = effectiveMode === "dark" ? "light" : "dark";
            const label = nextMode === "dark" ? translateUi("Switch to Dark mode") : translateUi("Switch to Light mode");
            toggle.dataset.effectiveTheme = effectiveMode;
            toggle.setAttribute("aria-label", label);
            toggle.setAttribute("title", label);
            toggle.setAttribute("aria-pressed", String(effectiveMode === "dark"));
        };

        window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
            if (document.documentElement.dataset.themeMode === "system") {
                window.dispatchEvent(new CustomEvent("worthward:theme-mode-change", {
                    detail: {mode: "system"},
                }));
            }
        });

        const initThemeModeControls = () => {
            const currentMode = readThemeModePreference();
            applyThemeModePreference(currentMode);
            syncGlobalThemeToggle();
            const formElement = document.querySelector("[data-theme-mode-form]");
            if (!(formElement instanceof HTMLFormElement)) return;
            const options = Array.from(formElement.querySelectorAll("[data-theme-mode-option]"));
            options.forEach((option) => {
                if (!(option instanceof HTMLInputElement)) return;
                option.checked = option.value === currentMode;
                if (option.dataset.boundThemeMode === "1") return;
                option.dataset.boundThemeMode = "1";
                option.addEventListener("change", () => {
                    if (!option.checked) return;
                    writeThemeModePreference(option.value);
                    applyThemeModePreference(option.value);
                    syncGlobalThemeToggle();
                });
            });
        };

        bootstrap.initThemeModeControls = initThemeModeControls;

        const initGlobalAppearanceControls = () => {
            const themeToggle = document.getElementById("global_theme_toggle");
            if (themeToggle instanceof HTMLButtonElement && themeToggle.dataset.boundThemeToggle !== "1") {
                themeToggle.dataset.boundThemeToggle = "1";
                themeToggle.addEventListener("click", () => {
                    const nextMode = getEffectiveThemeMode() === "dark" ? "light" : "dark";
                    writeThemeModePreference(nextMode);
                    applyThemeModePreference(nextMode);
                    syncThemeModeForm(nextMode);
                    syncGlobalThemeToggle();
                });
            }
            syncGlobalThemeToggle();
            window.addEventListener("worthward:theme-mode-change", () => {
                syncThemeModeForm(document.documentElement.dataset.themeMode);
                syncGlobalThemeToggle();
            });
        };

        const initGlobalLanguageControls = () => {
            const toggle = document.getElementById("global_language_toggle");
            if (!(toggle instanceof HTMLButtonElement)) return;
            const languageState = getLanguageState();
            const languageLabel = languageState.labels?.[languageState.code] || translateUi("Language");
            toggle.setAttribute("aria-label", `${translateUi("Language")}: ${languageLabel}`);
            toggle.setAttribute("title", `${translateUi("Language")}: ${languageLabel}`);
            if (toggle.dataset.boundLanguageToggle === "1") return;
            toggle.dataset.boundLanguageToggle = "1";
            toggle.addEventListener("click", async () => {
                toggle.disabled = true;
                try {
                    const response = await fetch("/api/settings/language/cycle", {
                        method: "POST",
                        headers: {"Content-Type": "application/json", "X-CSRF-Token": state.security?.investmentCsrfToken || ""},
                        body: JSON.stringify({current: getLanguageState().code || "en"}),
                    });
                    const payload = await response.json().catch(() => null);
                    if (payload?.success) {
                        if (window.WORTHWARD_APP?.language) {
                            window.WORTHWARD_APP.language.code = payload.language;
                            window.WORTHWARD_APP.language.htmlLang = payload.htmlLang;
                        }
                        if (payload.dateDisplay && window.WORTHWARD_APP?.dateDisplay) {
                            window.WORTHWARD_APP.dateDisplay = payload.dateDisplay;
                        }
                        window.location.reload();
                        return;
                    }
                } catch (_error) {
                }
                toggle.disabled = false;
            });
        };

        const showWorkspaceModal = (options = {}) => {
            if (!workspaceModalOverlay) return;
            if (workspaceModalOverlayTitle && options.title) workspaceModalOverlayTitle.textContent = options.title;
            if (workspaceModalOverlayCopy && options.copy) workspaceModalOverlayCopy.textContent = options.copy;
            if (workspaceModalOverlayIcon) {
                workspaceModalOverlayIcon.className = "suggestion-loading-spinner workspace-modal-icon";
            }
            workspaceModalOverlay.hidden = false;
        };

        const showImmediateRangeLoadingDialog = () => {
            if (state.currentView === "prices" && isMarketCapComparison()) {
                showWorkspaceModal({
                    title: translateUi("Calculating market-cap history"),
                    copy: translateUi("Combining historical prices with point-in-time shares for the selected range. Longer ranges may take a moment."),
                    loadingSpinner: true,
                });
                return;
            }
            if (state.currentView === "prices") {
                showWorkspaceModal({
                    title: translateUi("Updating price history"),
                    copy: translateUi("Loading the selected New York market-time range while keeping the current chart context visible."),
                    loadingSpinner: true,
                });
                return;
            }
        };

        const showCompareOverlay = () => {
            showWorkspaceModal({
                title: isBacktestView ? "Running your backtest" : "Preparing your chart",
                copy: isBacktestView
                    ? "Please wait while the app prepares the selected daily data and runs the backtest."
                    : "Please wait while the app checks local data and prepares the chart. This may take a little longer for a new ticker.",
                loadingSpinner: true,
            });
        };

        const hideWorkspaceModal = () => {
            if (!workspaceModalOverlay) return;
            if (compareOverlayTimer) {
                window.clearTimeout(compareOverlayTimer);
                compareOverlayTimer = null;
            }
            workspaceModalOverlay.hidden = true;
        };

        const cancelActiveWorkspaceSubmission = () => {
            if (!runtimeState.isSubmittingWithOverlay) return false;
            runtimeState.workspaceSubmitToken += 1;
            abortActiveWorkspaceHydration();
            runtimeState.isSubmittingWithOverlay = false;
            setFormBusyState(false);
            hideWorkspaceModal();
            return true;
        };

        const scheduleCompareOverlay = () => {
            if (compareOverlayTimer) window.clearTimeout(compareOverlayTimer);
            compareOverlayTimer = window.setTimeout(() => {
                showCompareOverlay();
            }, 180);
        };

        const didCompareRequestChangeRange = (currentParams, nextParams) => {
            const rangeKeys = ["period", "range", "date", "trading_date", "exact_trading_date", "from", "exact_start", "to", "exact_end", "extended-hours", "extended_hours", "include_extended_hours", "overnight", "include_overnight"];
            for (const key of rangeKeys) {
                const current = (currentParams.get(key) || "").toString().trim();
                const next = (nextParams.get(key) || "").toString().trim();
                if (current !== next) return true;
            }
            return false;
        };

        const didCompareRequestChangeMetric = (currentParams, nextParams) => (
            normalizeComparisonMetric(currentParams.get("metric"))
            !== normalizeComparisonMetric(nextParams.get("metric"))
        );

        const attachRemoveHandlers = () => {
            $$(".ticker-remove").forEach((button) => {
                if (button.dataset.bound === "1") return;
                button.dataset.bound = "1";
                button.addEventListener("click", () => {
                    const field = button.closest(".ticker-field");
                    const removedTicker = sanitizeTicker(field?.querySelector("[data-ticker-input]")?.value || "");
                    const removedIndex = Number.parseInt(field?.dataset.index || "0", 10) - 1;
                    if (isPortfolioView) requestWorkspaceChartTransition("ticker-remove");
                    else if (!(isBacktestView || isDcaView)) clearWorkspaceChartTransitionRequest();
                    const removedWeight = isPortfolioView
                        ? Number.parseInt(field?.querySelector(".portfolio-weight-input")?.value || "0", 10) || 0
                        : 0;
                    field?.remove();
                    reindexTickerFields();
                    removeTickerFromComparePreview(removedTicker);
                    if (isPortfolioView) {
                        rebalancePortfolioWeightsAfterRemoval(removedWeight, removedIndex);
                        ensurePortfolioWeightTouches();
                        syncPortfolioWeightBounds();
                        syncPortfolioWeightDisabledState();
                        validatePortfolioWeightInputs();
                        dispatchPortfolioPreviewUpdate();
                    }
                    validateAllTickerInputs();
                    syncDateConstraints();
                    scheduleAutoSubmit(120);
                });
            });
        };

        const addTickerField = (value = "", {focus = true} = {}) => {
            const container = $("#ticker_fields");
            if (!container || getTickerFields().length >= runtimeState.maxTickers) return;
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
    							<img class="ticker-input-logo" alt="" hidden>
    						</span>
    						<input id="ticker_${index}" name="ticker" data-ticker-input class="text-input-control" value="${value}" placeholder="e.g. NVDA" autocomplete="off" autocapitalize="characters" spellcheck="false" inputmode="latin" title="Use a valid ticker such as MSFT, GOOGL, NVDA, AMZN, MU, AMD, or META.">
    						<button type="button" class="ticker-clear" aria-label="Clear ticker"><span class="icon icon-remove-muted" aria-hidden="true"></span></button>
    					</div>
    					<div class="field-tooltip field-tooltip-duplicate" hidden>This ticker is already used. Choose a different one.</div>
    					<div class="field-tooltip field-tooltip-invalid" hidden>Unknown or unsupported ticker.</div>
    					<div class="suggestions" id="ticker_${index}_suggestions"></div>
    				</div>
    				${isPortfolioView ? `
    				<div class="portfolio-weight-field">
    					<div class="portfolio-weight-row">
    						<input id="weight_${index}" name="weight" class="portfolio-weight-input" type="number" inputmode="numeric" min="0" max="100" step="1" value="0" placeholder="${labels.portfolio_weight}" aria-label="${labels.portfolio_weight}">
    						<span class="portfolio-weight-unit">%</span>
    						<div class="portfolio-share-stepper" role="group" aria-label="Shares">
    							<button type="button" class="portfolio-share-stepper-button" data-share-step="-1" aria-label="Decrease shares">-</button>
    							<input id="shares_${index}" name="shares" class="portfolio-share-input" type="number" inputmode="numeric" min="0" step="1" value="0" placeholder="0" aria-label="Shares">
    							<button type="button" class="portfolio-share-stepper-button" data-share-step="1" aria-label="Increase shares">+</button>
    						</div>
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
            if (focus) input?.focus();
        };

        // Bind this control before the optional workspace enhancements so a
        // recoverable enhancement failure does not disable ticker entry.
        $("#add_ticker")?.addEventListener("click", () => {
            if (!(isBacktestView || isDcaView)) clearWorkspaceChartTransitionRequest();
            addTickerField();
        });

        const compactTickerInputs = () => {
            const values = getFilledTickers();
            const portfolioEntries = isPortfolioView
                ? getWeightFields()
                    .map((item) => ({
                        ticker: sanitizeTicker(item.tickerInput.value.trim()),
                        weight: Number.parseInt(item.number.value, 10) || 0,
                        shares: Number.parseInt(item.shares?.value || "0", 10) || 0,
                    }))
                    .filter((item) => item.ticker)
                : [];
            const container = $("#ticker_fields");
            if (!container) return values;
            while (getTickerFields().length > Math.max(getMinimumRequiredTickers(), values.length)) {
                getTickerFields()[getTickerFields().length - 1].remove();
            }
            getTickerInputs().forEach((input, index) => {
                input.value = values[index] || "";
            });
            if (isPortfolioView) {
                getWeightFields().forEach((entry, index) => {
                    syncPortfolioWeightPair(entry, portfolioEntries[index]?.weight || 0);
                    syncPortfolioShareInput(entry, portfolioEntries[index]?.shares || 0);
                });
            }
            while (getTickerFields().length < Math.max(getMinimumRequiredTickers(), values.length)) {
                addTickerField(values[getTickerFields().length] || "");
            }
            reindexTickerFields();
            syncPortfolioWeightDisabledState();
            syncPortfolioWeightBounds();
            validateAllTickerInputs();
            return values;
        };


        return Object.freeze({
            addTickerField,
            attachPortfolioWeightHandlers,
            attachRemoveHandlers,
            attachTickerClearHandlers,
            cancelActiveWorkspaceSubmission,
            didCompareRequestChangeMetric,
            didCompareRequestChangeRange,
            dispatchPortfolioPreviewUpdate,
            ensurePortfolioWeightTouches,
            ensureTickerValidityBeforeSubmit,
            getFilledWeightEntries,
            hidePortfolioWeightTooltips,
            hideWorkspaceModal,
            initGlobalAppearanceControls,
            initGlobalLanguageControls,
            initMobilePageBottomPadding,
            initThemeModeControls,
            isTickerValidationPending,
            reindexTickerFields,
            scheduleDockPosition,
            scheduleMobilePageBottomPaddingSync,
            seedTickerValidationState,
            setTickerValidationPending,
            setupAutocomplete,
            showImmediateRangeLoadingDialog,
            showTickerValidationTooltip,
            showWorkspaceModal,
            syncPortfolioWeightBounds,
            syncPortfolioWeightDisabledState,
            syncTickerInputDecoration,
            updateAddButtonState,
            validateAllTickerInputs,
            validatePortfolioWeightInputs,
        });
    };

    window.WORTHWARD_APP_TICKER_CONTROLS = Object.freeze({create});
})();
