/* Code version: v1.0.1 */
(() => {
    const create = (context) => {
        const {
            $,
            $$,
            PRICE_COMPARISON_MAX_TICKERS,
            bootstrap,
            buildCleanWorkspaceUrl,
            canAutoSubmit,
            cancelActiveWorkspaceSubmission,
            chooseRelativePeriodForExactRange,
            clampTradeCapital,
            clearComparisonMetricValidation,
            clearWorkspaceChartTransitionRequest,
            comparisonMetricInputs,
            countTradeCapitalCharsBeforeCaret,
            exactEndInput,
            exactStartInput,
            exactTradingDateInput,
            extendedHoursInput,
            form,
            formatEditableTradeCapitalValue,
            formatTradeCapitalTypingValue,
            formatTradeCapitalValue,
            getBacktestIntervalInputs,
            getDcaFrequencyInputs,
            getFilledTickers,
            getTickerInputs,
            hideWorkspaceModal,
            includeDividendsInput,
            isBacktestView,
            isDcaView,
            isOneDayExactDateMode,
            normalizeComparisonMetric,
            overnightInput,
            parseTradeCapitalValue,
            periodPanel,
            periodSelect,
            priceOnlyInput,
            rangeInteractionState,
            rangeModeInputs,
            refreshSharedSelectField,
            replacePeriodOptions,
            requestWorkspaceChartTransition,
            resolveTradeCapitalCaretPosition,
            runtimeState,
            scheduleAutoSubmit,
            scheduleDockPosition,
            showComparisonMetricValidation,
            showImmediateRangeLoadingDialog,
            showTickerValidationTooltip,
            state,
            stopLossInput,
            syncAllSegmentedControlLayouts,
            syncBacktestIntervalSegmentedControl,
            syncDateConstraints,
            syncDcaFrequencySegmentedControl,
            syncDividendModeSwitches,
            syncExactInputsToRenderedRange,
            syncOneDayExtendedHoursSwitch,
            syncOneDayOvernightSwitch,
            syncSegmentedControlLayout,
            tradeCapitalField,
            tradeCapitalInput,
            tradeCapitalSlider,
            translateUi,
            updateDcaSchedulePanels,
            updateRangePanels,
            validateAllTickerInputs,
        } = context;

        let segmentedLayoutFrame = 0;
        const scheduleSegmentedControlLayoutSync = () => {
            if (segmentedLayoutFrame) window.cancelAnimationFrame(segmentedLayoutFrame);
            segmentedLayoutFrame = window.requestAnimationFrame(() => {
                segmentedLayoutFrame = 0;
                syncAllSegmentedControlLayouts();
            });
        };
        let segmentedFrameResizeObserver = null;
        const observeSegmentedOverflowFrames = () => {
            if (!segmentedFrameResizeObserver) return;
            $$('[data-segmented-overflow-frame]').forEach((frame) => {
                if (!(frame instanceof HTMLElement) || frame.dataset.segmentedResizeObserved === "1") return;
                frame.dataset.segmentedResizeObserved = "1";
                segmentedFrameResizeObserver.observe(frame);
            });
        };
        if (typeof ResizeObserver === "function") {
            segmentedFrameResizeObserver = new ResizeObserver(scheduleSegmentedControlLayoutSync);
            observeSegmentedOverflowFrames();
        }
        if (typeof MutationObserver === "function") {
            const segmentedControlMutationObserver = new MutationObserver(() => {
                observeSegmentedOverflowFrames();
                scheduleSegmentedControlLayoutSync();
            });
            segmentedControlMutationObserver.observe(document.body, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ["hidden", "disabled"],
            });
        }
        updateDcaSchedulePanels();
        syncDateConstraints();
        scheduleDockPosition();
        window.addEventListener("resize", () => {
            scheduleSegmentedControlLayoutSync();
        });

        const handleRangeModeChange = (input) => {
            const nextRangeMode = input.value;
            const previousRangeMode = rangeInteractionState.lastRangeMode;
            const hasExactDateSelection = !rangeInteractionState.hasDerivedExactDateRange && (isOneDayExactDateMode()
                ? Boolean(exactTradingDateInput?.value)
                : Boolean(exactStartInput?.value || exactEndInput?.value));
            let shouldAutoSubmit = true;
            if (previousRangeMode !== nextRangeMode) {
                if (nextRangeMode === "exact") {
                    const synced = syncExactInputsToRenderedRange();
                    rangeInteractionState.hasDerivedExactDateRange = synced;
                    if (synced && runtimeState.hasInitialResult) {
                        shouldAutoSubmit = false;
                    }
                } else if (nextRangeMode === "period") {
                    if (!hasExactDateSelection) {
                        shouldAutoSubmit = false;
                    } else {
                        const matchedPeriod = chooseRelativePeriodForExactRange();
                        if (matchedPeriod && periodSelect) {
                            periodSelect.value = matchedPeriod;
                            refreshSharedSelectField(periodPanel?.querySelector("[data-shared-select-field]"));
                        }
                    }
                }
            }
            updateRangePanels();
            syncDateConstraints();
            rangeInteractionState.lastRangeMode = nextRangeMode;
            if (!(isBacktestView || isDcaView) && shouldAutoSubmit) requestWorkspaceChartTransition("range-mode");
            if (shouldAutoSubmit) {
                scheduleAutoSubmit();
            }
        };
        rangeModeInputs.forEach((input) => {
            input.addEventListener("change", () => handleRangeModeChange(input));
        });
        comparisonMetricInputs.forEach((input) => {
            input.addEventListener("change", () => {
                if (!input.checked || state.currentView !== "prices") return;
                const nextMetric = normalizeComparisonMetric(input.value);
                const previousMetric = normalizeComparisonMetric(state.comparisonMetric);
                if (nextMetric === previousMetric) return;
                if (runtimeState.isSubmittingWithOverlay) cancelActiveWorkspaceSubmission();

                const restoreMetricSelection = () => {
                    comparisonMetricInputs.forEach((candidate) => {
                        candidate.checked = normalizeComparisonMetric(candidate.value) === previousMetric;
                    });
                    const metricShell = input.closest("[data-comparison-metric-switch]");
                    if (metricShell instanceof HTMLElement) {
                        syncSegmentedControlLayout(metricShell, {
                            activeValue: previousMetric,
                            activeIndex: previousMetric === "market-cap" ? 1 : 0,
                        });
                    }
                };

                if (nextMetric === "price" && getFilledTickers().length > PRICE_COMPARISON_MAX_TICKERS) {
                    restoreMetricSelection();
                    showComparisonMetricValidation(
                        translateUi("Price comparisons support up to 5 tickers. Remove an extra ticker before switching."),
                    );
                    return;
                }
                if (!canAutoSubmit()) {
                    restoreMetricSelection();
                    validateAllTickerInputs();
                    const invalidInput = getTickerInputs().find((candidate) => (
                        !candidate.checkValidity() || candidate.dataset.unknown === "1"
                    ));
                    if (invalidInput) showTickerValidationTooltip(invalidInput);
                    showComparisonMetricValidation(
                        invalidInput
                            ? translateUi("Resolve the highlighted ticker before switching metrics.")
                            : translateUi("Complete the required comparison fields before switching metrics."),
                    );
                    return;
                }
                clearComparisonMetricValidation();
                state.comparisonMetric = nextMetric;
                if (runtimeState.autoSubmitTimer) {
                    window.clearTimeout(runtimeState.autoSubmitTimer);
                    runtimeState.autoSubmitTimer = null;
                }

                const metricShell = input.closest("[data-comparison-metric-switch]");
                if (metricShell instanceof HTMLElement) {
                    syncSegmentedControlLayout(metricShell, {
                        activeValue: nextMetric,
                        activeIndex: nextMetric === "market-cap" ? 1 : 0,
                    });
                }

                const chipsField = document.querySelector("[data-chips-field]");
                const metricChipsInput = chipsField?.querySelector("[data-chips-input]");
                if (chipsField instanceof HTMLElement) {
                    const isPriceMetric = nextMetric === "price";
                    chipsField.hidden = !isPriceMetric;
                    if (metricChipsInput instanceof HTMLInputElement) {
                        metricChipsInput.disabled = !isPriceMetric;
                        if (!isPriceMetric) metricChipsInput.checked = false;
                    }
                }

                delete bootstrap.chartWorkspaceRefreshTransition;
                clearWorkspaceChartTransitionRequest();
                requestWorkspaceChartTransition("comparison-metric");
                showImmediateRangeLoadingDialog();

                const nextUrl = buildCleanWorkspaceUrl();
                const currentUrl = `${window.location.pathname}${window.location.search}`;
                if (nextUrl === currentUrl) {
                    hideWorkspaceModal();
                    return;
                }

                const requiresPriceLimitReload = (
                    nextMetric === "price"
                    && getFilledTickers().length > PRICE_COMPARISON_MAX_TICKERS
                );
                if (!form || requiresPriceLimitReload) {
                    window.requestAnimationFrame(() => {
                        if (document.body.classList.contains("is-page-navigating")) return;
                        window.location.assign(nextUrl);
                    });
                    return;
                }
                form.requestSubmit();
            });
        });
        [exactStartInput, exactEndInput, exactTradingDateInput].forEach((input) => {
            if (!input) return;
            input.addEventListener("change", () => {
                rangeInteractionState.hasDerivedExactDateRange = false;
                syncDateConstraints();
                if (!(isBacktestView || isDcaView)) requestWorkspaceChartTransition("range-controls");
                scheduleAutoSubmit();
            });
        });
        if (includeDividendsInput && form) {
            includeDividendsInput.addEventListener("change", () => {
                if (!(isBacktestView || isDcaView)) requestWorkspaceChartTransition("dividends");
                scheduleAutoSubmit(80);
            });
        }
        if (priceOnlyInput && form) {
            syncDividendModeSwitches();
            priceOnlyInput.addEventListener("change", () => {
                syncDividendModeSwitches();
                if (!(isBacktestView || isDcaView)) requestWorkspaceChartTransition("price-only");
                scheduleAutoSubmit(80);
            });
        }
        if (stopLossInput && form) {
            stopLossInput.addEventListener("change", () => {
                scheduleAutoSubmit(80);
            });
        }
        if (extendedHoursInput && form) {
            syncOneDayExtendedHoursSwitch();
            extendedHoursInput.addEventListener("change", () => {
                if (!(isBacktestView || isDcaView)) requestWorkspaceChartTransition("extended-hours");
                scheduleAutoSubmit(80);
            });
        }
        if (overnightInput && form) {
            syncOneDayOvernightSwitch();
            overnightInput.addEventListener("change", () => {
                if (!(isBacktestView || isDcaView)) requestWorkspaceChartTransition("overnight");
                scheduleAutoSubmit(80);
            });
        }
        form?.addEventListener("change", (event) => {
            const target = event.target;
            if (target instanceof HTMLSelectElement && target.id === "period") {
                // The Period select owns its change handler so custom dropdown events
                // remain reliable even when a sidebar control is repaired in place.
                return;
            }
            if (target instanceof HTMLSelectElement && (target.id === "dca_weekday" || target.id === "dca_month_day")) {
                scheduleAutoSubmit(20);
            }
        });
        getDcaFrequencyInputs().forEach((input) => input.addEventListener("change", (event) => {
            if (!(event.target instanceof HTMLInputElement) || !event.target.checked) return;
            syncDcaFrequencySegmentedControl();
            updateDcaSchedulePanels();
            scheduleAutoSubmit(20);
        }));
        getBacktestIntervalInputs().forEach((input) => input.addEventListener("change", (event) => {
            if (!(event.target instanceof HTMLInputElement) || !event.target.checked) return;
            const interval = event.target.value;
            syncBacktestIntervalSegmentedControl();
            const nextPeriods = state.backtestPeriodOptions?.[interval] || (interval === "1m" ? ["1d"] : ["1d"]);
            replacePeriodOptions(nextPeriods, interval === "1m" ? null : "max");
            // Force full reload for interval change to refresh sidebar period options
            scheduleAutoSubmit(20);
        }));

        if ((isBacktestView || isDcaView) && tradeCapitalField && tradeCapitalInput && tradeCapitalSlider) {
            const scheduleTradeInputAutoSubmit = () => {
                scheduleAutoSubmit(720);
            };
            const scheduleTradeSliderAutoSubmit = () => {
                scheduleAutoSubmit(180);
            };
            const openTradeCapitalSlider = () => tradeCapitalField.classList.add("is-open");
            const closeTradeCapitalSlider = () => window.setTimeout(() => {
                if (tradeCapitalField.matches(":focus-within")) return;
                tradeCapitalField.classList.remove("is-open");
                tradeCapitalInput.value = formatTradeCapitalValue(parseTradeCapitalValue(tradeCapitalInput.value));
                scheduleTradeSliderAutoSubmit();
            }, 80);
            const syncTradeCapitalControls = (value, formattedValue = null) => {
                const normalized = clampTradeCapital(value);
                tradeCapitalField.dataset.lastValidAmount = String(normalized);
                tradeCapitalInput.value = formattedValue ?? formatTradeCapitalValue(normalized);
                tradeCapitalSlider.value = String(Math.round(normalized));
            };
            const sanitizeTradeCapitalDraft = (value) => String(value || "")
                .replace(/,/g, "")
                .replace(/[^\d.]/g, "");
            const normalizeTradeCapitalDraft = (draftValue) => {
                const sanitized = sanitizeTradeCapitalDraft(draftValue);
                if (!sanitized) return "";
                const [wholePartRaw, ...decimalParts] = sanitized.split(".");
                const wholePart = wholePartRaw.replace(/\D/g, "");
                const decimalPart = decimalParts.join("").replace(/\D/g, "").slice(0, 2);
                if (decimalParts.length) return `${wholePart}.${decimalPart}`;
                return wholePart;
            };
            const deriveTradeCapitalReplacementDraft = (rawValue) => {
                const currentDraft = normalizeTradeCapitalDraft(rawValue);
                const focusDraft = normalizeTradeCapitalDraft(tradeCapitalInput.dataset.focusDraft || "");
                if (!focusDraft || !currentDraft || currentDraft === focusDraft) return currentDraft;
                if (currentDraft.endsWith(focusDraft)) {
                    return currentDraft.slice(0, -focusDraft.length) || currentDraft;
                }
                if (currentDraft.startsWith(focusDraft)) {
                    return currentDraft.slice(focusDraft.length) || currentDraft;
                }
                return currentDraft;
            };
            const applyTradeCapitalDraft = (draftValue, significantChars) => {
                const nextDraft = normalizeTradeCapitalDraft(draftValue);
                if (!nextDraft) {
                    tradeCapitalInput.value = "";
                    return false;
                }
                const formattedValue = formatTradeCapitalTypingValue(nextDraft);
                const normalizedValue = parseTradeCapitalValue(formattedValue);
                syncTradeCapitalControls(normalizedValue, formattedValue);
                const nextCaret = resolveTradeCapitalCaretPosition(formattedValue, significantChars);
                tradeCapitalInput.setSelectionRange(nextCaret, nextCaret);
                return true;
            };
            const syncTradeCapitalControlsFromTyping = () => {
                const rawValue = tradeCapitalInput.value;
                if (!String(rawValue || "").replace(/,/g, "").trim()) {
                    tradeCapitalInput.value = "";
                    return false;
                }
                const significantChars = countTradeCapitalCharsBeforeCaret(rawValue, tradeCapitalInput.selectionStart);
                const formattedValue = formatTradeCapitalTypingValue(rawValue);
                const normalizedValue = parseTradeCapitalValue(formattedValue);
                syncTradeCapitalControls(normalizedValue, formattedValue);
                const nextCaret = resolveTradeCapitalCaretPosition(formattedValue, significantChars);
                tradeCapitalInput.setSelectionRange(nextCaret, nextCaret);
                return true;
            };
            const restoreTradeCapitalControls = () => {
                const fallbackValue = parseTradeCapitalValue(
                    tradeCapitalField.dataset.lastValidAmount || tradeCapitalSlider.value || tradeCapitalInput.value
                );
                syncTradeCapitalControls(fallbackValue);
            };
            const selectTradeCapitalInputValue = () => {
                window.requestAnimationFrame(() => {
                    const valueLength = tradeCapitalInput.value.length;
                    tradeCapitalInput.setSelectionRange(0, valueLength);
                });
            };
            tradeCapitalInput.addEventListener("focus", () => {
                const normalized = parseTradeCapitalValue(tradeCapitalInput.value);
                tradeCapitalField.dataset.lastValidAmount = String(normalized);
                const focusDraft = formatEditableTradeCapitalValue(normalized);
                tradeCapitalInput.dataset.focusDraft = focusDraft;
                tradeCapitalInput.dataset.replaceOnNextTradeCapitalInput = "1";
                tradeCapitalInput.value = focusDraft;
                openTradeCapitalSlider();
                selectTradeCapitalInputValue();
            });
            tradeCapitalInput.addEventListener("click", () => {
                openTradeCapitalSlider();
                selectTradeCapitalInputValue();
            });
            tradeCapitalInput.addEventListener("mouseup", (event) => {
                if (tradeCapitalInput.dataset.replaceOnNextTradeCapitalInput !== "1") return;
                event.preventDefault();
                selectTradeCapitalInputValue();
            });
            tradeCapitalInput.addEventListener("beforeinput", (event) => {
                if (!(event instanceof InputEvent)) return;
                const supportedInputTypes = new Set([
                    "insertText",
                    "insertFromPaste",
                    "deleteContentBackward",
                    "deleteContentForward",
                ]);
                if (!supportedInputTypes.has(event.inputType)) return;
                event.preventDefault();
                const currentValue = tradeCapitalInput.value;
                const selectionStart = tradeCapitalInput.selectionStart ?? currentValue.length;
                const selectionEnd = tradeCapitalInput.selectionEnd ?? currentValue.length;
                const isReplacementInsert = tradeCapitalInput.dataset.replaceOnNextTradeCapitalInput === "1"
                    && event.inputType.startsWith("insert");
                const currentDraft = isReplacementInsert ? "" : normalizeTradeCapitalDraft(currentValue);
                const startChars = countTradeCapitalCharsBeforeCaret(currentValue, selectionStart);
                const endChars = countTradeCapitalCharsBeforeCaret(currentValue, selectionEnd);
                let nextDraft = currentDraft;
                let nextCaretChars = isReplacementInsert ? 0 : startChars;
                if (event.inputType === "deleteContentBackward") {
                    const deleteStart = startChars === endChars ? Math.max(0, startChars - 1) : startChars;
                    nextDraft = `${currentDraft.slice(0, deleteStart)}${currentDraft.slice(endChars)}`;
                    nextCaretChars = deleteStart;
                } else if (event.inputType === "deleteContentForward") {
                    const deleteEnd = startChars === endChars ? endChars + 1 : endChars;
                    nextDraft = `${currentDraft.slice(0, startChars)}${currentDraft.slice(deleteEnd)}`;
                    nextCaretChars = startChars;
                } else {
                    const insertedValue = normalizeTradeCapitalDraft(event.data || "");
                    nextDraft = `${currentDraft.slice(0, startChars)}${insertedValue}${currentDraft.slice(endChars)}`;
                    nextCaretChars = (isReplacementInsert ? 0 : startChars) + insertedValue.length;
                }
                delete tradeCapitalInput.dataset.replaceOnNextTradeCapitalInput;
                tradeCapitalInput.dataset.skipNextTradeCapitalInput = "1";
                if (!applyTradeCapitalDraft(nextDraft, nextCaretChars)) return;
                scheduleTradeInputAutoSubmit();
            });
            tradeCapitalInput.addEventListener("input", () => {
                if (tradeCapitalInput.dataset.skipNextTradeCapitalInput === "1") {
                    delete tradeCapitalInput.dataset.skipNextTradeCapitalInput;
                    return;
                }
                if (tradeCapitalInput.dataset.replaceOnNextTradeCapitalInput === "1") {
                    const replacementDraft = deriveTradeCapitalReplacementDraft(tradeCapitalInput.value);
                    delete tradeCapitalInput.dataset.replaceOnNextTradeCapitalInput;
                    if (!applyTradeCapitalDraft(replacementDraft, replacementDraft.length)) return;
                    scheduleTradeInputAutoSubmit();
                    return;
                }
                if (!syncTradeCapitalControlsFromTyping()) return;
                scheduleTradeInputAutoSubmit();
            });
            tradeCapitalInput.addEventListener("blur", () => {
                delete tradeCapitalInput.dataset.focusDraft;
                delete tradeCapitalInput.dataset.replaceOnNextTradeCapitalInput;
                if (!tradeCapitalInput.value.trim()) restoreTradeCapitalControls();
                else syncTradeCapitalControls(parseTradeCapitalValue(tradeCapitalInput.value));
                scheduleTradeSliderAutoSubmit();
            });
            tradeCapitalSlider.addEventListener("focus", openTradeCapitalSlider);
            tradeCapitalSlider.addEventListener("input", () => {
                const value = clampTradeCapital(Number.parseFloat(tradeCapitalSlider.value) || 0);
                syncTradeCapitalControls(value);
                scheduleTradeSliderAutoSubmit();
            });
            tradeCapitalField.addEventListener("focusout", closeTradeCapitalSlider);
            syncTradeCapitalControls(parseTradeCapitalValue(tradeCapitalInput.value));
        }


        return Object.freeze({
            handleRangeModeChange,
            observeSegmentedOverflowFrames,
            scheduleSegmentedControlLayoutSync,
            segmentedFrameResizeObserver,
            segmentedLayoutFrame,
        });
    };

    window.WORTHWARD_APP_RANGE_CONTROLS = Object.freeze({create});
})();
