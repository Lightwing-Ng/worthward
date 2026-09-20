/* Code version: v1.1.0 */
(() => {
    const create = (context) => {
        const {
            $,
            $$,
            MONTH_ABBREVIATIONS,
            MONTH_LABELS,
            MONTH_TOKEN_TO_INDEX,
            attachDockMemory,
            attachOptimisticInternalNavigation,
            attachPortfolioAllocationHandlers,
            attachPortfolioWeightHandlers,
            attachRemoveHandlers,
            attachTickerClearHandlers,
            bootstrap,
            chipsInput,
            closeSharedSelectDropdowns,
            defaults,
            dispatchPortfolioPreviewUpdate,
            endpoints,
            ensurePortfolioWeightTouches,
            exactEndInput,
            exactPanel,
            exactStartInput,
            exactTradingDateInput,
            extendedHoursInput,
            form,
            getBacktestIntervalInputs,
            getComparisonMetric,
            getFilledTickers,
            getFilledWeightEntries,
            getMinimumRequiredTickers,
            getPortfolioAllocationMode,
            getSelectedBacktestInterval,
            getSelectedDcaFrequency,
            getTickerInputs,
            includeDividendsInput,
            initGlobalAppearanceControls,
            initGlobalLanguageControls,
            initThemeModeControls,
            initializeWorkspaceEnhancements,
            isBacktestView,
            isDcaView,
            isOneDayExactDateMode,
            isPortfolioView,
            isTickerValidationPending,
            labels,
            overnightInput,
            periodPanel,
            periodSelect,
            priceOnlyInput,
            rangeModeInputs,
            refreshSharedSelectField,
            reindexTickerFields,
            rememberCurrentViewUrl,
            requestWorkspaceChartTransition,
            runtimeState,
            sanitizeTicker,
            setBacktestIntervalAvailability,
            setBacktestIntervalValue,
            setSharedSelectDropdownOpen,
            setupAutocomplete,
            showTradeDetailsInput,
            state,
            stopLossInput,
            strategyDeclaresBacktestInterval,
            syncAllSegmentedControlLayouts,
            syncBacktestIntervalSegmentedControl,
            syncDcaFrequencySegmentedControl,
            syncDividendModeSwitches,
            syncExactDateModeControls,
            syncOneDayExtendedHoursSwitch,
            syncPortfolioWeightBounds,
            syncPortfolioWeightDisabledState,
            syncRangeModeSegmentedControl,
            tradeCapitalInput,
            validateAllTickerInputs,
            validatePortfolioWeightInputs,
            workspaceUrlState,
        } = context;
        const collectStrategyParamEntries = (...args) => context.collectStrategyParamEntries(...args);
        const strategyNumericValuesMatch = (...args) => context.strategyNumericValuesMatch(...args);
        const datePickerState = [];
        let datePickerDocumentListenersBound = false;
        let validTradingDateSet = null;
        let dateConstraintAvailability = {};
        let dateConstraintsRequestId = 0;
        let backtestIntervalRequestToken = 0;

        const buildUtcDate = (yearValue, monthIndexValue, dayValue) => {
            const year = Number.parseInt(yearValue, 10);
            const monthIndex = Number.parseInt(monthIndexValue, 10);
            const day = Number.parseInt(dayValue, 10);
            if (![year, monthIndex, day].every(Number.isInteger)) return null;
            const candidate = new Date(Date.UTC(year, monthIndex, day));
            if (
                candidate.getUTCFullYear() !== year
                || candidate.getUTCMonth() !== monthIndex
                || candidate.getUTCDate() !== day
            ) {
                return null;
            }
            return candidate;
        };
        const parseIsoDate = (rawValue) => {
            const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(rawValue || ""));
            if (!match) return null;
            return buildUtcDate(match[1], Number.parseInt(match[2], 10) - 1, match[3]);
        };

        const formatIsoDate = (date) => {
            const year = date.getUTCFullYear();
            const month = String(date.getUTCMonth() + 1).padStart(2, "0");
            const day = String(date.getUTCDate()).padStart(2, "0");
            return `${year}-${month}-${day}`;
        };

        const padTwo = (value) => String(value).padStart(2, "0");
        const readFullDateFormat = () => String(window.WORTHWARD_APP?.dateDisplay?.full || "d_mmm_yyyy");
        const readShortDateFormat = () => String(window.WORTHWARD_APP?.dateDisplay?.short || "yyyy_mm_dd");
        const buildFullDateLayout = (dateParts) => {
            if (!dateParts) return {tokens: [], wrapAfterIndex: 1};
            const year = Number(dateParts.year);
            const monthIndex = Number(dateParts.monthIndex);
            const day = Number(dateParts.day);
            const monthLabel = MONTH_ABBREVIATIONS[Math.max(0, Math.min(11, monthIndex))] || "";
            const fullFormat = readFullDateFormat();
            const paddedDay = padTwo(day);
            if (fullFormat === "dd_mmm_yyyy") {
                return {tokens: [paddedDay, monthLabel, `${year}`], wrapAfterIndex: 1};
            }
            if (fullFormat === "yyyy_mmm_d") {
                return {tokens: [`${year}`, monthLabel, `${day}`], wrapAfterIndex: 0};
            }
            if (fullFormat === "yyyy_mmm_dd") {
                return {tokens: [`${year}`, monthLabel, paddedDay], wrapAfterIndex: 0};
            }
            if (fullFormat === "yyyy_mm_dd_cjk") {
                return {tokens: [`${year}年${padTwo(monthIndex + 1)}月${paddedDay}日`], wrapAfterIndex: 0};
            }
            return {tokens: [`${day}`, monthLabel, `${year}`], wrapAfterIndex: 1};
        };
        const formatFullDateParts = (dateParts, {includeTime = false, includeSeconds = false} = {}) => {
            if (!dateParts) return "";
            const {tokens} = buildFullDateLayout(dateParts);
            const baseDate = tokens.join(" ");
            if (!includeTime) return baseDate;
            const hasHours = Number.isInteger(dateParts.hours);
            const hasMinutes = Number.isInteger(dateParts.minutes);
            if (!hasHours || !hasMinutes) return baseDate;
            const timeText = includeSeconds && Number.isInteger(dateParts.seconds)
                ? `${padTwo(dateParts.hours)}:${padTwo(dateParts.minutes)}:${padTwo(dateParts.seconds)}`
                : `${padTwo(dateParts.hours)}:${padTwo(dateParts.minutes)}`;
            return `${baseDate} ${timeText}`;
        };
        const formatShortDateParts = (dateParts) => {
            if (!dateParts) return "";
            const year = Number(dateParts.year);
            const month = Number(dateParts.monthIndex) + 1;
            const day = Number(dateParts.day);
            if (readShortDateFormat() === "dd_mm_yyyy") {
                return `${padTwo(day)}/${padTwo(month)}/${year}`;
            }
            return `${year}/${padTwo(month)}/${padTwo(day)}`;
        };
        const formatFullDateLines = (dateParts, {allowWrap = true} = {}) => {
            if (!dateParts) return ["", ""];
            if (!allowWrap) return [formatFullDateParts(dateParts), ""];
            const {tokens, wrapAfterIndex} = buildFullDateLayout(dateParts);
            const hasHours = Number.isInteger(dateParts.hours);
            const hasMinutes = Number.isInteger(dateParts.minutes);
            const firstLine = tokens.slice(0, wrapAfterIndex + 1).join(" ");
            const secondLineTokens = tokens.slice(wrapAfterIndex + 1);
            const secondLineBase = secondLineTokens.join(" ");
            if (!hasHours || !hasMinutes) return [firstLine, secondLineBase];
            const timeText = `${padTwo(dateParts.hours)}:${padTwo(dateParts.minutes)}`;
            return [firstLine, secondLineBase ? `${secondLineBase} ${timeText}` : timeText];
        };
        // `chart-axis-utils.js` owns the single timezone-offset implementation.
        const getTimezoneOffsetMinutes = (timezone, utcMs) => (
            (window.WORTHWARD_CHART_AXIS || {}).getTimezoneOffsetMinutes(timezone, utcMs)
        );
        const convertNewYorkWallTimeParts = (rawValue, timezone) => {
            const match = String(rawValue || "").match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
            if (!match || !match[4] || !timezone) return null;
            const wallTimeUtcMs = Date.UTC(
                Number(match[1]),
                Number(match[2]) - 1,
                Number(match[3]),
                Number(match[4]),
                Number(match[5]),
            );
            return (window.WORTHWARD_CHART_AXIS || {}).newYorkWallMsToMarketParts(wallTimeUtcMs, timezone);
        };
        const formatPickerMonthLabel = (date) => {
            if (!(date instanceof Date)) return "";
            const monthLabel = MONTH_LABELS[date.getUTCMonth()] || "";
            const year = date.getUTCFullYear();
            return readFullDateFormat().startsWith("yyyy_") ? `${year} ${monthLabel}` : `${monthLabel} ${year}`;
        };
        const getDateEntryExample = () => formatFullDateParts({year: 2025, monthIndex: 5, day: 5});
        const getDateEntryHint = () => getDateEntryExample();
        const getShortDatePlaceholder = () => readShortDateFormat() === "dd_mm_yyyy" ? "00/00/0000" : "0000/00/00";
        const formatDisplayDate = (rawValue) => {
            const date = parseIsoDate(rawValue);
            if (!date) return "Select date";
            return formatFullDateParts({
                year: date.getUTCFullYear(),
                monthIndex: date.getUTCMonth(),
                day: date.getUTCDate(),
            });
        };
        const parseDisplayDateTextToIso = (rawValue) => {
            const parsedDate = parseManualDateInput(String(rawValue || "").trim());
            return parsedDate ? formatIsoDate(parsedDate) : "";
        };
        const parseOneDayTradingDateTextToIso = (rawValue) => {
            const normalized = String(rawValue || "").trim();
            return parseDisplayDateTextToIso(normalized)
                || parseDisplayDateTextToIso(normalized.replace(/\s+[A-Za-z]{2,5}$/, ""));
        };
        const parseMonthToken = (rawValue) => {
            const normalized = String(rawValue || "").trim().toLowerCase().replace(/\.$/, "");
            if (!normalized) return null;
            return Number.isInteger(MONTH_TOKEN_TO_INDEX[normalized]) ? MONTH_TOKEN_TO_INDEX[normalized] : null;
        };
        const parseManualDateInput = (rawValue) => {
            const normalized = String(rawValue || "").trim().replace(/,/g, " ");
            if (!normalized) return null;
            const isoMatch = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(normalized);
            if (isoMatch) {
                return buildUtcDate(isoMatch[1], Number.parseInt(isoMatch[2], 10) - 1, isoMatch[3]);
            }
            const shortMatch = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(normalized);
            if (shortMatch && readShortDateFormat() === "dd_mm_yyyy") {
                return buildUtcDate(shortMatch[3], Number.parseInt(shortMatch[2], 10) - 1, shortMatch[1]);
            }
            const tokenized = normalized.split(/\s+/);
            if (tokenized.length !== 3) return null;
            const monthIndex = parseMonthToken(tokenized[1]);
            if (!Number.isInteger(monthIndex)) return null;
            if (/^\d{4}$/.test(tokenized[0])) {
                return buildUtcDate(tokenized[0], monthIndex, tokenized[2]);
            }
            if (/^\d{4}$/.test(tokenized[2])) {
                return buildUtcDate(tokenized[2], monthIndex, tokenized[0]);
            }
            return null;
        };
        bootstrap.dateDisplay = {
            formatFullDateParts,
            formatShortDateParts,
            formatFullDateLines,
            convertNewYorkWallTimeParts,
            formatPickerMonthLabel,
            getShortDatePlaceholder,
        };
        bootstrap.currencyDisplay = {
            minorUnits(currency) {
                return new Set(["JPY", "KRW"]).has(String(currency || "").toUpperCase()) ? 0 : 2;
            },
            format(value, currency, showCurrency = true) {
                const numeric = Number(value);
                if (!Number.isFinite(numeric)) return "";
                const fractionDigits = this.minorUnits(currency);
                const formatted = numeric.toLocaleString("en-US", {
                    minimumFractionDigits: fractionDigits,
                    maximumFractionDigits: fractionDigits,
                });
                return showCurrency ? `${currency} ${formatted}` : formatted;
            },
            formatAxis(value, currency, showCurrency = true) {
                const numeric = Number(value);
                if (!Number.isFinite(numeric)) return "";
                const fractionDigits = this.minorUnits(currency);
                const formatted = numeric.toLocaleString("en-US", {
                    minimumFractionDigits: 0,
                    maximumFractionDigits: fractionDigits,
                });
                return showCurrency ? `${currency} ${formatted}` : formatted;
            },
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
        const MS_PER_DAY = 24 * 60 * 60 * 1000;
        const PERIOD_DAY_SPANS = state.periodMetadata?.daySpans || {};
        const PERIOD_MONTH_SPANS = state.periodMetadata?.monthSpans || {};
        const PERIOD_LABELS = state.periodMetadata?.labels || {};

        const shiftMonthsUtc = (date, months) => {
            const year = date.getUTCFullYear();
            const month = date.getUTCMonth();
            const day = date.getUTCDate();
            const targetMonthStart = new Date(Date.UTC(year, month + months, 1));
            const targetYear = targetMonthStart.getUTCFullYear();
            const targetMonth = targetMonthStart.getUTCMonth();
            const targetMonthEnd = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
            return new Date(Date.UTC(targetYear, targetMonth, Math.min(day, targetMonthEnd)));
        };

        const diffDaysUtc = (start, end) => Math.max(0, Math.round((end.getTime() - start.getTime()) / MS_PER_DAY));

        const getRenderedChartDateRange = () => {
            if (["tickers", "prices"].includes(state.currentView) && periodSelect?.value === "1d") {
                const displayRangeDate = parseOneDayTradingDateTextToIso(
                    $("#compare_summary_date_range, .price-compare-range")?.textContent || "",
                );
                if (displayRangeDate) {
                    return {
                        start: displayRangeDate,
                        end: displayRangeDate,
                    };
                }
            }
            if (
                ["tickers", "prices"].includes(state.currentView)
                && (periodSelect?.value || defaults.period) === "1d"
                && state.chart?.tradingDate
            ) {
                const tradingDate = String(state.chart.tradingDate || "");
                if (parseIsoDate(tradingDate)) {
                    return {
                        start: tradingDate,
                        end: tradingDate,
                    };
                }
            }
            if (isBacktestView) {
                const dates = state.backtestResult?.chart?.dates;
                if (Array.isArray(dates) && dates.length) {
                    return {
                        start: String(dates[0]),
                        end: String(dates[dates.length - 1]),
                    };
                }
            }
            if (isDcaView) {
                const dates = state.dcaResult?.chart?.dates;
                if (Array.isArray(dates) && dates.length) {
                    return {
                        start: String(dates[0]),
                        end: String(dates[dates.length - 1]),
                    };
                }
            }
            const firstSeriesDates = state.chart?.series?.[0]?.dates;
            if (Array.isArray(firstSeriesDates) && firstSeriesDates.length) {
                return {
                    start: String(firstSeriesDates[0]),
                    end: String(firstSeriesDates[firstSeriesDates.length - 1]),
                };
            }
            if (exactStartInput?.value && exactEndInput?.value) {
                return {
                    start: exactStartInput.value,
                    end: exactEndInput.value,
                };
            }
            return null;
        };

        const syncExactInputsToRenderedRange = () => {
            if (!exactStartInput || !exactEndInput) return false;
            if (isOneDayExactDateMode() && exactTradingDateInput) {
                const range = getRenderedChartDateRange();
                const summaryTradingDate = parseOneDayTradingDateTextToIso(
                    $("#compare_summary_date_range, .price-compare-range")?.textContent || "",
                );
                const tradingDate = [
                    summaryTradingDate,
                    exactTradingDateInput.value,
                    exactEndInput.value,
                    exactStartInput.value,
                    range?.end,
                    range?.start,
                ].find((value) => parseIsoDate(String(value || "")));
                if (!tradingDate) return false;
                exactTradingDateInput.value = tradingDate;
                if (exactStartInput) exactStartInput.value = tradingDate;
                if (exactEndInput) exactEndInput.value = tradingDate;
                refreshDatePickers();
                return true;
            }
            const range = getRenderedChartDateRange();
            if (!range?.start || !range?.end) return false;
            exactStartInput.value = range.start;
            exactEndInput.value = range.end;
            refreshDatePickers();
            return true;
        };

        const chooseRelativePeriodForExactRange = () => {
            if (isOneDayExactDateMode()) return "1d";
            if (!periodSelect || !exactStartInput?.value || !exactEndInput?.value) return null;
            const exactStartDate = parseIsoDate(exactStartInput.value);
            const exactEndDate = parseIsoDate(exactEndInput.value);
            const maxDate = parseIsoDate(exactEndInput.max || exactEndInput.value);
            const minDate = parseIsoDate(exactStartInput.min || exactStartInput.value);
            if (!exactStartDate || !exactEndDate || !maxDate) return null;

            const exactDurationDays = diffDaysUtc(exactStartDate, exactEndDate);
            const availableDurationDays = minDate ? diffDaysUtc(minDate, maxDate) : exactDurationDays;
            const nonMaxOptions = Array.from(periodSelect.options)
                .map((option) => option.value)
                .filter((value) => value && value !== "max" && (PERIOD_MONTH_SPANS[value] || PERIOD_DAY_SPANS[value]));

            const intervalSelect = document.getElementById("backtest_interval");
            const currentInterval = intervalSelect ? intervalSelect.value : "1d";
            const fallbackOption = currentInterval === "1m" ? "1w" : "1y";

            if (!nonMaxOptions.length) {
                const fallbackEl = periodSelect.querySelector(`option[value="${fallbackOption}"]`);
                return fallbackEl ? fallbackOption : (periodSelect.value || null);
            }

            const candidates = nonMaxOptions.map((value) => {
                let candidateStart;
                if (PERIOD_MONTH_SPANS[value]) {
                    const months = PERIOD_MONTH_SPANS[value];
                    candidateStart = shiftMonthsUtc(maxDate, -months);
                } else {
                    const days = PERIOD_DAY_SPANS[value];
                    candidateStart = new Date(maxDate.getTime() - days * MS_PER_DAY);
                }
                const candidateDurationDays = diffDaysUtc(candidateStart, maxDate);
                const coversExactEnd = exactEndDate >= candidateStart && exactEndDate <= maxDate;
                return {
                    value,
                    candidateDurationDays,
                    durationGap: Math.abs(candidateDurationDays - exactDurationDays),
                    coveragePenalty: coversExactEnd ? 0 : 1,
                };
            });

            candidates.sort((left, right) => (
                left.durationGap - right.durationGap
                || left.coveragePenalty - right.coveragePenalty
                || left.candidateDurationDays - right.candidateDurationDays
            ));

            const longestCandidateDays = Math.max(...candidates.map((item) => item.candidateDurationDays));
            if (periodSelect.querySelector('option[value="max"]')) {
                const closeToEarliestBound = minDate && diffDaysUtc(minDate, exactStartDate) <= 3;
                if (exactDurationDays > longestCandidateDays || closeToEarliestBound || exactDurationDays >= availableDurationDays - 3) {
                    return "max";
                }
            }

            return candidates[0]?.value || fallbackOption;
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
        const formatEditableTradeCapitalValue = (value) => {
            const normalized = clampTradeCapital(value);
            if (Math.abs(normalized - Math.round(normalized)) < 0.000001) {
                return String(Math.round(normalized));
            }
            return normalized.toFixed(2).replace(/\.?0+$/, "");
        };
        const formatTradeCapitalTypingValue = (rawValue) => {
            const normalized = String(rawValue || "").replace(/,/g, "").replace(/[^\d.]/g, "");
            const hasDecimalPoint = normalized.includes(".");
            const wholeCandidate = (normalized.split(".")[0] || "").replace(/\D/g, "");
            const decimalCandidate = (normalized.split(".")[1] || "").replace(/\D/g, "").slice(0, 2);
            const numericSource = `${wholeCandidate || "0"}${hasDecimalPoint ? `.${decimalCandidate}` : ""}`;
            const numericValue = clampTradeCapital(Number.parseFloat(numericSource) || 0);
            const [wholePart] = formatTradeCapitalValue(numericValue).split(".");
            if (hasDecimalPoint) return `${wholePart}.${decimalCandidate}`;
            return wholePart;
        };
        const countTradeCapitalCharsBeforeCaret = (value, caretPosition) => (
            String(value || "").slice(0, Math.max(0, caretPosition || 0)).replace(/,/g, "").length
        );
        const resolveTradeCapitalCaretPosition = (value, significantChars) => {
            if (significantChars <= 0) return 0;
            let seenChars = 0;
            for (let index = 0; index < value.length; index += 1) {
                if (value[index] === ",") continue;
                seenChars += 1;
                if (seenChars >= significantChars) return index + 1;
            }
            return value.length;
        };

        const updateRangePanels = () => {
            const rangeMode = $("input[name='range']:checked")?.value || defaults.range_mode;
            syncRangeModeSegmentedControl();
            const isPeriodMode = rangeMode === "period";
            if (periodPanel) {
                periodPanel.hidden = !isPeriodMode;
                periodPanel.setAttribute("aria-hidden", String(!isPeriodMode));
                periodPanel.style.display = isPeriodMode ? "" : "none";
            }
            if (!isPeriodMode) {
                closeSharedSelectDropdowns(periodPanel?.querySelector("[data-shared-select-field]"));
                setSharedSelectDropdownOpen(periodPanel?.querySelector("[data-shared-select-field]"), false);
            }
            if (exactPanel) {
                exactPanel.hidden = isPeriodMode;
                exactPanel.setAttribute("aria-hidden", String(isPeriodMode));
                exactPanel.style.display = isPeriodMode ? "none" : "";
            }
            syncExactDateModeControls();
            if (isPeriodMode) closeAllDatePickers();
        };

        const canAutoSubmit = () => {
            if (!form) return false;
            const values = getFilledTickers();
            if (values.length < getMinimumRequiredTickers()) return false;
            if (new Set(values).size !== values.length) return false;
            if (isPortfolioView) {
                const totalWeight = getFilledWeightEntries().reduce((sum, entry) => sum + (Number.parseInt(entry.number.value, 10) || 0), 0);
                if (totalWeight !== 100) return false;
            }
            validateAllTickerInputs();
            if (isTickerValidationPending()) return false;
            if (getTickerInputs().some((input) => !input.checkValidity() || input.dataset.unknown === "1")) return false;
            const rangeMode = $("input[name='range']:checked")?.value || defaults.range_mode;
            if (rangeModeInputs.length && rangeMode === "exact") {
                if (isOneDayExactDateMode()) {
                    if (!exactTradingDateInput?.value) return false;
                } else if (!exactStartInput?.value || !exactEndInput?.value) {
                    return false;
                }
            }
            return true;
        };

        const scheduleAutoSubmit = (delay = 240) => {
            if (!canAutoSubmit()) return;
            if (runtimeState.autoSubmitTimer) window.clearTimeout(runtimeState.autoSubmitTimer);
            runtimeState.autoSubmitTimer = window.setTimeout(() => {
    			if (runtimeState.isSubmittingWithOverlay) {
    				scheduleAutoSubmit(80);
    				return;
    			}
    			if (!canAutoSubmit()) return;
                form.requestSubmit();
            }, delay);
        };

        function handlePeriodSelectionChange() {
            refreshSharedSelectField(periodPanel?.querySelector("[data-shared-select-field]"));
            syncExactDateModeControls();
            syncOneDayExtendedHoursSwitch();
            syncDividendModeSwitches();
            if (!(isBacktestView || isDcaView)) requestWorkspaceChartTransition("period");

            // Period is an explicit calculation request. Submit through the canonical
            // handler so cold ticker validation can resolve before navigation.
            if (form && !runtimeState.isSubmittingWithOverlay) {
                form.requestSubmit();
            }
        }

        const closeAllDatePickers = () => {
            datePickerState.forEach((picker) => {
                picker.popover.hidden = true;
                picker.trigger.setAttribute("aria-expanded", "false");
                picker.view = "days";
                picker.stablePosition = null;
            });
            syncDatePickerPeerHighlight();
        };

        const isInsideDatePicker = (picker, target) => (
            Boolean(target)
            && (picker.wrapper.contains(target) || picker.popover.contains(target))
        );

        const isInsideAnyDatePicker = (target) => (
            datePickerState.some((picker) => isInsideDatePicker(picker, target))
        );

        const positionDatePickerPopover = (picker) => {
            if (picker.stableFrame && picker.stablePosition) {
                picker.popover.style.top = `${picker.stablePosition.top}px`;
                picker.popover.style.left = `${picker.stablePosition.left}px`;
                return;
            }
            const triggerRect = picker.trigger.getBoundingClientRect();
            const visualViewport = window.visualViewport;
            const viewportLeft = visualViewport?.offsetLeft || 0;
            const viewportTop = visualViewport?.offsetTop || 0;
            const viewportWidth = visualViewport?.width || window.innerWidth;
            const viewportHeight = visualViewport?.height || window.innerHeight;
            const viewportPadding = 12;
            const popoverGap = 8;
            const popoverRect = picker.popover.getBoundingClientRect();
            const popoverWidth = Math.min(320, viewportWidth - (viewportPadding * 2));
            const popoverHeight = Math.min(
                picker.popover.offsetHeight || popoverRect.height,
                viewportHeight - (viewportPadding * 2),
            );
            const leftBoundary = viewportLeft + viewportPadding;
            const topBoundary = viewportTop + viewportPadding;
            const rightBoundary = viewportLeft + viewportWidth - viewportPadding;
            const bottomBoundary = viewportTop + viewportHeight - viewportPadding;
            const maxLeft = Math.max(leftBoundary, rightBoundary - popoverWidth);
            const maxTop = Math.max(topBoundary, bottomBoundary - popoverHeight);
            const spaceRight = rightBoundary - triggerRect.right - popoverGap;
            const spaceLeft = triggerRect.left - leftBoundary - popoverGap;
            const spaceBelow = bottomBoundary - triggerRect.bottom - popoverGap;
            const spaceAbove = triggerRect.top - topBoundary - popoverGap;
            let preferredTop = triggerRect.bottom + popoverGap;
            if (spaceBelow < popoverHeight && spaceAbove > spaceBelow) {
                preferredTop = triggerRect.top - popoverGap - popoverHeight;
            }
            const sidebarPicker = picker.wrapper.closest(".sidebar-form");
            const canOpenBeside = Boolean(sidebarPicker || picker.avoidSelector);
            const canOpenRight = canOpenBeside && spaceRight >= popoverWidth;
            const canOpenLeft = canOpenBeside && spaceLeft >= popoverWidth;
            let top = Math.min(
                Math.max(canOpenRight || canOpenLeft ? triggerRect.top : preferredTop, topBoundary),
                maxTop,
            );
            let preferredLeft = triggerRect.left;
            if (canOpenRight) {
                preferredLeft = triggerRect.right + popoverGap;
            } else if (canOpenLeft) {
                preferredLeft = triggerRect.left - popoverGap - popoverWidth;
            }
            const left = Math.min(Math.max(preferredLeft, leftBoundary), maxLeft);
            const avoidElements = picker.avoidSelector
                ? Array.from(document.querySelectorAll(picker.avoidSelector)).filter(
                    (element) => element instanceof HTMLElement,
                )
                : [];
            avoidElements.forEach((avoidElement) => {
                const avoidRect = avoidElement.getBoundingClientRect();
                const overlapsHorizontally = left < avoidRect.right
                    && (left + popoverWidth) > avoidRect.left;
                const overlapsVertically = top < avoidRect.bottom
                    && (top + popoverHeight) > avoidRect.top;
                if (overlapsHorizontally && overlapsVertically) {
                    const avoidAboveTop = Math.max(
                        topBoundary,
                        avoidRect.top - popoverGap - popoverHeight,
                    );
                    const avoidBelowTop = Math.min(maxTop, avoidRect.bottom + popoverGap);
                    const canAvoidAbove = (avoidAboveTop + popoverHeight) <= avoidRect.top;
                    const canAvoidBelow = avoidBelowTop >= avoidRect.bottom;
                    if (canAvoidAbove || canAvoidBelow) {
                        top = canAvoidAbove && (!canAvoidBelow || Math.abs(top - avoidAboveTop) <= Math.abs(top - avoidBelowTop))
                            ? avoidAboveTop
                            : avoidBelowTop;
                    }
                }
            });
            const roundedTop = Math.round(top);
            const roundedLeft = Math.round(left);
            picker.popover.style.top = `${roundedTop}px`;
            picker.popover.style.left = `${roundedLeft}px`;
            if (picker.stableFrame) {
                picker.stablePosition = {top: roundedTop, left: roundedLeft};
            }
        };

        const lockDatePickerPopoverFrame = (picker) => {
            if (!picker.stableFrame) return;
            picker.popover.style.height = "";
            const naturalHeight = picker.popover.offsetHeight;
            if (!Number.isFinite(naturalHeight) || naturalHeight <= 0) return;
            picker.popover.style.height = `${naturalHeight}px`;
        };

        const getDatePickerPeer = (picker) => {
            if (!picker?.role) return null;
            const peerRole = picker.role === "start" ? "end" : picker.role === "end" ? "start" : "";
            if (!peerRole) return null;
            return datePickerState.find((candidate) => (
                candidate.role === peerRole
                && candidate.group === picker.group
            )) || null;
        };

        const syncDatePickerPeerHighlight = () => {
            datePickerState.forEach((picker) => {
                picker.wrapper.classList.remove("is-peer-highlight");
            });
            const activePicker = datePickerState.find((picker) => !picker.popover.hidden);
            const peerPicker = activePicker ? getDatePickerPeer(activePicker) : null;
            if (peerPicker) {
                peerPicker.wrapper.classList.add("is-peer-highlight");
            }
        };

        const getDatePickerBounds = (picker) => ({
            minDate: parseIsoDate(picker.input.min),
            maxDate: parseIsoDate(picker.input.max),
        });

        const getDatePickerBoundMessage = (bound) => {
            const detail = dateConstraintAvailability?.[bound]?.message;
            if (detail) return detail;
            if (bound === "earliest") return "Choose a later shared trading date for the selected tickers.";
            return "Choose an earlier shared trading date for the selected tickers.";
        };

        const getDatePickerDateAvailability = (picker, candidateDate, peerDate = null) => {
            const {minDate, maxDate} = getDatePickerBounds(picker);
            const isoValue = formatIsoDate(candidateDate);
            if (minDate && candidateDate < minDate) {
                return {selectable: false, message: getDatePickerBoundMessage("earliest")};
            }
            if (maxDate && candidateDate > maxDate) {
                return {selectable: false, message: getDatePickerBoundMessage("latest")};
            }
            if (picker.role === "start" && peerDate && candidateDate > peerDate) {
                return {selectable: false, message: `${labels.start} must be on or before ${labels.to}.`};
            }
            if (picker.role === "end" && peerDate && candidateDate < peerDate) {
                return {selectable: false, message: `${labels.to} must be on or after ${labels.start}.`};
            }
            if (!picker.unconstrained && validTradingDateSet && !validTradingDateSet.has(isoValue)) {
                return {
                    selectable: false,
                    message: `${formatDisplayDate(isoValue)} is not a shared trading day for the selected tickers.`,
                };
            }
            return {selectable: true, message: ""};
        };

        const getDatePickerMonthAvailability = (picker, year, monthIndex, peerDate) => {
            const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
            let fallbackMessage = "";
            for (let day = 1; day <= lastDay; day += 1) {
                const availability = getDatePickerDateAvailability(
                    picker,
                    new Date(Date.UTC(year, monthIndex, day)),
                    peerDate,
                );
                if (availability.selectable) return availability;
                if (!fallbackMessage) fallbackMessage = availability.message;
            }
            return {selectable: false, message: fallbackMessage || "No shared trading days are available in this month."};
        };

        const showDatePickerFeedback = (picker, message) => {
            picker.interactionMessage = message;
            applyDatePickerValidationState(picker);
        };

        const clearDatePickerFeedback = (picker) => {
            picker.interactionMessage = "";
        };

        const normalizeDatePickerDraft = (rawValue) => String(rawValue || "")
            .replace(/\u00a0/g, " ")
            .replace(/\s+/g, " ")
            .trim();

        const getDatePickerComparableIsoValue = (picker) => {
            if (!picker) return "";
            const rawDraft = normalizeDatePickerDraft(picker.draftText);
            if (!rawDraft) return String(picker.input?.value || "");
            const parsedDate = parseManualDateInput(rawDraft);
            return parsedDate ? formatIsoDate(parsedDate) : String(picker.input?.value || "");
        };

        const getDatePickerWorkingState = (picker) => {
            const rawDraft = normalizeDatePickerDraft(picker.draftText);
            if (rawDraft) {
                const parsedDate = parseManualDateInput(rawDraft);
                if (!parsedDate) {
                    return {
                        displayText: rawDraft,
                        previewDate: null,
                        previewIsoValue: "",
                        validationMessage: String(picker.validationMessage || ""),
                    };
                }
                const previewIsoValue = formatIsoDate(parsedDate);
                return {
                    displayText: rawDraft,
                    previewDate: parsedDate,
                    previewIsoValue,
                    validationMessage: String(picker.validationMessage || ""),
                };
            }
            const selectedMonthMatch = String(picker.selectedMonthValue || "").match(/^(\d{4})-(\d{2})$/);
            if (selectedMonthMatch) {
                const selectedMonthDate = new Date(Date.UTC(
                    Number.parseInt(selectedMonthMatch[1], 10),
                    Number.parseInt(selectedMonthMatch[2], 10) - 1,
                    1,
                ));
                return {
                    displayText: formatPickerMonthLabel(selectedMonthDate),
                    previewDate: null,
                    previewIsoValue: "",
                    validationMessage: String(picker.validationMessage || ""),
                };
            }
            const committedIsoValue = String(picker.input.value || "");
            return {
                displayText: committedIsoValue ? formatDisplayDate(committedIsoValue) : "",
                previewDate: parseIsoDate(committedIsoValue),
                previewIsoValue: committedIsoValue,
                validationMessage: String(picker.validationMessage || ""),
            };
        };

        const syncDatePickerEditorText = (picker, nextText, {force = false} = {}) => {
            if (!picker.triggerValue) return;
            const normalizedNextText = String(nextText || "");
            picker.triggerValue.dataset.empty = normalizedNextText ? "0" : "1";
            if (!force && document.activeElement === picker.triggerValue) return;
            if (picker.triggerValue.textContent !== normalizedNextText) {
                picker.triggerValue.textContent = normalizedNextText;
            }
        };

        const getDatePickerDefaultFeedback = (picker, workingState) => {
            if (picker.guidance !== "single-day-or-month" || !picker.visibleMonth) {
                return String(picker.defaultFeedback || "");
            }
            const monthLabel = formatPickerMonthLabel(picker.visibleMonth);
            const selectedLabel = String(workingState?.displayText || "").trim();
            if (picker.view === "months") {
                if (picker.selectedMonthValue && selectedLabel) {
                    return `${selectedLabel} selected. Choose another calendar month.`;
                }
                return `Choose a calendar month in ${picker.visibleMonth.getUTCFullYear()}.`;
            }
            if (picker.input.value && selectedLabel) {
                return `${selectedLabel} selected. Choose another day, or select ${monthLabel} for a whole month.`;
            }
            return `Choose a day, or select ${monthLabel} for a whole month.`;
        };

        const applyDatePickerValidationState = (picker, workingState = getDatePickerWorkingState(picker)) => {
            const validationMessage = String(workingState.validationMessage || "");
            const message = validationMessage
                || String(picker.interactionMessage || "")
                || getDatePickerDefaultFeedback(picker, workingState);
            syncDatePickerEditorText(picker, workingState.displayText, {force: Boolean(picker.forceDisplaySync)});
            picker.forceDisplaySync = false;
            picker.trigger.classList.toggle("is-invalid", Boolean(validationMessage));
            picker.triggerValue.classList.toggle("is-invalid", Boolean(validationMessage));
            picker.triggerValue.setAttribute("aria-invalid", validationMessage ? "true" : "false");
            if (picker.feedback) picker.feedback.textContent = message;
        };

        const getDatePickerValidationMessage = (picker, isoValue) => {
            if (!isoValue) return "Enter a date.";
            const selectedDate = parseIsoDate(isoValue);
            if (!selectedDate) return `Enter a valid date like ${getDateEntryHint()}.`;
            const minDate = parseIsoDate(picker.input.min);
            const maxDate = parseIsoDate(picker.input.max);
            if (minDate && selectedDate < minDate) {
                return `Choose a date on or after ${formatDisplayDate(picker.input.min)}.`;
            }
            if (maxDate && selectedDate > maxDate) {
                return `Choose a date on or before ${formatDisplayDate(picker.input.max)}.`;
            }
            const peerPicker = getDatePickerPeer(picker);
            const peerDate = parseIsoDate(getDatePickerComparableIsoValue(peerPicker));
            if (picker.role === "start" && peerDate && selectedDate > peerDate) {
                return `${labels.start} must be on or before ${labels.to}.`;
            }
            if (picker.role === "end" && peerDate && selectedDate < peerDate) {
                return `${labels.to} must be on or after ${labels.start}.`;
            }
            if (!picker.unconstrained && validTradingDateSet && !validTradingDateSet.has(isoValue)) {
                return "Choose a shared trading day for the selected tickers.";
            }
            return "";
        };

        const updateDatePickerValue = (picker, isoValue, {emitChange = false, closePopover = false} = {}) => {
            const previousValue = String(picker.input.value || "");
            picker.selectedMonthValue = "";
            picker.draftText = "";
            picker.validationMessage = "";
            clearDatePickerFeedback(picker);
            picker.input.value = isoValue;
            picker.forceSyncMonth = true;
            picker.forceDisplaySync = true;
            refreshDatePickers();
            if (closePopover) closeAllDatePickers();
            if (emitChange && picker.input.value !== previousValue) {
                picker.input.dispatchEvent(new Event("change", {bubbles: true}));
            }
        };

        const commitDatePickerTextInput = (picker, {emitChange = false, closePopover = false} = {}) => {
            clearDatePickerFeedback(picker);
            const previousValue = String(picker.input.value || "");
            const rawValue = normalizeDatePickerDraft(picker.triggerValue.textContent);
            if (!rawValue) {
                picker.selectedMonthValue = "";
                picker.draftText = "";
                picker.validationMessage = "Enter a date.";
                picker.input.value = "";
                picker.forceSyncMonth = true;
                picker.forceDisplaySync = true;
                refreshDatePickers();
                if (emitChange && picker.input.value !== previousValue) {
                    picker.input.dispatchEvent(new Event("change", {bubbles: true}));
                }
                return;
            }
            const parsedDate = parseManualDateInput(rawValue);
            if (!parsedDate) {
                picker.draftText = rawValue;
                picker.validationMessage = `Enter a valid date like ${getDateEntryHint()}.`;
                picker.input.value = "";
                picker.forceSyncMonth = true;
                refreshDatePickers();
                if (emitChange && picker.input.value !== previousValue) {
                    picker.input.dispatchEvent(new Event("change", {bubbles: true}));
                }
                return;
            }
            const isoValue = formatIsoDate(parsedDate);
            const validationMessage = getDatePickerValidationMessage(picker, isoValue);
            if (validationMessage) {
                picker.draftText = rawValue;
                picker.validationMessage = "";
                showDatePickerFeedback(picker, validationMessage);
                picker.input.value = "";
                picker.forceSyncMonth = true;
                refreshDatePickers();
                if (emitChange && picker.input.value !== previousValue) {
                    picker.input.dispatchEvent(new Event("change", {bubbles: true}));
                }
                return;
            }
            updateDatePickerValue(picker, isoValue, {emitChange, closePopover});
        };

        const getDatePickerNavigationTarget = (picker, delta) => {
            if (picker.view === "months") {
                return new Date(Date.UTC(picker.visibleMonth.getUTCFullYear() + delta, 0, 1));
            }
            return addMonthsUtc(picker.visibleMonth, delta);
        };

        const getDatePickerNavigationAvailability = (picker, delta) => {
            const targetMonth = getDatePickerNavigationTarget(picker, delta);
            const peerPicker = getDatePickerPeer(picker);
            const peerDate = parseIsoDate(getDatePickerComparableIsoValue(peerPicker));
            if (picker.view === "months") {
                const {minDate, maxDate} = getDatePickerBounds(picker);
                const targetYear = targetMonth.getUTCFullYear();
                return {
                    selectable: !(minDate && targetYear < minDate.getUTCFullYear())
                        && !(maxDate && targetYear > maxDate.getUTCFullYear()),
                    message: minDate && targetYear < minDate.getUTCFullYear()
                        ? getDatePickerBoundMessage("earliest")
                        : maxDate && targetYear > maxDate.getUTCFullYear()
                            ? getDatePickerBoundMessage("latest")
                            : "",
                };
            }
            return getDatePickerMonthAvailability(
                picker,
                targetMonth.getUTCFullYear(),
                targetMonth.getUTCMonth(),
                peerDate,
            );
        };

        const syncDatePickerNavigationButtons = (picker) => {
            picker.navButtons.forEach((button) => {
                const direction = Number.parseInt(button.dataset.dateNav || "0", 10);
                const availability = getDatePickerNavigationAvailability(picker, direction);
                const periodLabel = picker.view === "months" ? "year" : "month";
                button.classList.toggle("is-disabled", !availability.selectable);
                button.dataset.selectable = availability.selectable ? "true" : "false";
                button.removeAttribute("aria-disabled");
                button.setAttribute(
                    "aria-label",
                    `${direction < 0 ? "Previous" : "Next"} ${periodLabel}${availability.selectable ? "" : ", unavailable; select to learn why"}`,
                );
            });
        };

        const renderDatePickerMonthGrid = (picker, selectedDate, peerDate) => {
            const year = picker.visibleMonth.getUTCFullYear();
            picker.monthGrid.innerHTML = "";
            for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
                const availability = getDatePickerMonthAvailability(picker, year, monthIndex, peerDate);
                const button = document.createElement("button");
                button.type = "button";
                button.className = "date-picker-month";
                const monthDate = new Date(Date.UTC(year, monthIndex, 1));
                const monthValue = `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
                if (
                    picker.selectedMonthValue === monthValue
                    || (selectedDate && selectedDate.getUTCFullYear() === year && selectedDate.getUTCMonth() === monthIndex)
                ) {
                    button.classList.add("is-selected");
                }
                if (isSameUtcDay(startOfMonthUtc(new Date()), monthDate)) button.classList.add("is-current");
                if (!availability.selectable) button.classList.add("is-disabled");
                button.textContent = MONTH_ABBREVIATIONS[monthIndex];
                button.dataset.monthValue = monthValue;
                button.dataset.selectable = availability.selectable ? "true" : "false";
                button.removeAttribute("aria-disabled");
                button.setAttribute("aria-label", `${MONTH_LABELS[monthIndex]} ${year}${availability.selectable ? "" : ", unavailable; select to learn why"}`);
                button.addEventListener("click", (event) => {
                    if (!availability.selectable) {
                        showDatePickerFeedback(picker, availability.message);
                        return;
                    }
                    clearDatePickerFeedback(picker);
                    if (picker.selectMonth) {
                        event.stopPropagation();
                        picker.selectedMonthValue = monthValue;
                        picker.input.value = "";
                        picker.draftText = "";
                        picker.validationMessage = "";
                        picker.forceDisplaySync = true;
                        syncDatePickerView(picker);
                        picker.input.dispatchEvent(new CustomEvent("worthward:date-picker-month-select", {
                            bubbles: true,
                            detail: {value: monthValue},
                        }));
                        positionDatePickerPopover(picker);
                        return;
                    }
                    picker.visibleMonth = monthDate;
                    picker.view = "days";
                    picker.forceSyncMonth = false;
                    syncDatePickerView(picker);
                    positionDatePickerPopover(picker);
                });
                picker.monthGrid.appendChild(button);
            }
        };

        const syncDatePickerView = (picker) => {
            const workingState = getDatePickerWorkingState(picker);
            const selectedDate = workingState.previewDate;
            const {minDate, maxDate} = getDatePickerBounds(picker);
            const peerPicker = getDatePickerPeer(picker);
            const peerDate = parseIsoDate(getDatePickerComparableIsoValue(peerPicker));
            const selectedMonthDate = parseIsoDate(`${picker.selectedMonthValue || ""}-01`);
            const today = startOfMonthUtc(new Date());
            const anchorDate = selectedDate
                || selectedMonthDate
                || clampDateToBounds(parseIsoDate(picker.input.value) || minDate || maxDate || today, minDate, maxDate);
            const hasPreviewValidationMessage = Boolean(workingState.validationMessage && selectedDate);
            if (!picker.visibleMonth || picker.forceSyncMonth) {
                picker.visibleMonth = startOfMonthUtc(anchorDate);
                picker.forceSyncMonth = false;
            }
            const monthView = picker.view === "months";
            applyDatePickerValidationState(picker, workingState);
            picker.monthLabel.textContent = monthView
                ? String(picker.visibleMonth.getUTCFullYear())
                : formatPickerMonthLabel(picker.visibleMonth);
            picker.title.setAttribute(
                "aria-label",
                monthView
                    ? `Return to ${formatPickerMonthLabel(picker.visibleMonth)}`
                    : `Choose month and year, currently ${formatPickerMonthLabel(picker.visibleMonth)}`,
            );
            picker.calendar.hidden = monthView;
            picker.monthGrid.hidden = !monthView;
            picker.popover.classList.toggle("is-month-view", monthView);
            syncDatePickerNavigationButtons(picker);
            if (monthView) {
                renderDatePickerMonthGrid(picker, selectedDate, peerDate);
                return;
            }

            picker.grid.innerHTML = "";
            const firstDay = startOfMonthUtc(picker.visibleMonth);
            const monthStartOffset = firstDay.getUTCDay();
            const gridStart = new Date(Date.UTC(firstDay.getUTCFullYear(), firstDay.getUTCMonth(), 1 - monthStartOffset));
            for (let offset = 0; offset < 42; offset += 1) {
                const cellDate = new Date(Date.UTC(gridStart.getUTCFullYear(), gridStart.getUTCMonth(), gridStart.getUTCDate() + offset));
                const isoValue = formatIsoDate(cellDate);
                const availability = getDatePickerDateAvailability(picker, cellDate, peerDate);
                const isCurrentMonth = cellDate.getUTCMonth() === picker.visibleMonth.getUTCMonth();
                const isPeerBoundary = peerDate && isSameUtcDay(cellDate, peerDate);
                const button = document.createElement("button");
                button.type = "button";
                button.className = "date-picker-day";
                if (!isCurrentMonth) button.classList.add("is-muted");
                if (!availability.selectable) button.classList.add("is-disabled");
                if (selectedDate && isSameUtcDay(cellDate, selectedDate)) {
                    button.classList.add(hasPreviewValidationMessage ? "is-preview-invalid" : "is-selected");
                }
                if (isPeerBoundary) button.classList.add("is-peer-boundary");
                if (isSameUtcDay(cellDate, new Date())) button.classList.add("is-today");
                button.textContent = String(cellDate.getUTCDate());
                button.dataset.value = isoValue;
                button.dataset.selectable = availability.selectable ? "true" : "false";
                button.removeAttribute("aria-disabled");
                button.setAttribute("aria-label", `${formatDisplayDate(isoValue)}${availability.selectable ? "" : ", unavailable; select to learn why"}`);
                button.addEventListener("click", (event) => {
                    if (!availability.selectable) {
                        showDatePickerFeedback(picker, availability.message);
                        return;
                    }
                    if (picker.keepOpenOnSelect) event.stopPropagation();
                    updateDatePickerValue(picker, isoValue, {
                        emitChange: true,
                        closePopover: !picker.keepOpenOnSelect,
                    });
                });
                picker.grid.appendChild(button);
            }
        };

        const getDatePickerWrappers = (root = document) => {
            if (root instanceof HTMLElement) {
                return [
                    ...(root.matches("[data-date-picker]") ? [root] : []),
                    ...root.querySelectorAll("[data-date-picker]"),
                ];
            }
            return Array.from(root?.querySelectorAll?.("[data-date-picker]") || []);
        };

        const disposeDatePickers = (root = document) => {
            for (let index = datePickerState.length - 1; index >= 0; index -= 1) {
                const picker = datePickerState[index];
                const belongsToRoot = root instanceof Document
                    || (root instanceof HTMLElement && root.contains(picker.wrapper));
                if (!belongsToRoot) continue;
                picker.popover.remove();
                delete picker.wrapper.dataset.bound;
                delete picker.wrapper._worthwardDatePicker;
                datePickerState.splice(index, 1);
            }
            syncDatePickerPeerHighlight();
        };

        const initializeDatePickers = (root = document) => {
            getDatePickerWrappers(root).forEach((wrapper) => {
                if (wrapper.dataset.bound === "1") return;
                const input = wrapper.querySelector('input[type="hidden"]');
                const trigger = wrapper.querySelector("[data-date-trigger]");
                const triggerValue = wrapper.querySelector("[data-date-trigger-value]");
                const popover = wrapper.querySelector("[data-date-popover]");
                const feedback = wrapper.querySelector("[data-date-feedback]");
                const title = wrapper.querySelector("[data-date-title]");
                const monthLabel = wrapper.querySelector("[data-date-month]");
                const grid = wrapper.querySelector("[data-date-grid]");
                const calendar = wrapper.querySelector("[data-date-calendar]");
                const monthGrid = wrapper.querySelector("[data-date-month-grid]");
                const navButtons = Array.from(popover.querySelectorAll("[data-date-nav]"));
                if (!input || !trigger || !triggerValue || !popover || !feedback || !title || !monthLabel || !grid || !calendar || !monthGrid) return;
                const picker = {
                    wrapper,
                    input,
                    trigger,
                    triggerValue,
                    popover,
                    feedback,
                    title,
                    monthLabel,
                    grid,
                    calendar,
                    monthGrid,
                    navButtons,
                    role: wrapper.dataset.dateRole || "",
                    group: wrapper.dataset.datePickerGroup || "workspace",
                    unconstrained: wrapper.dataset.datePickerUnconstrained === "true",
                    view: "days",
                    visibleMonth: null,
                    forceSyncMonth: true,
                    forceDisplaySync: true,
                    draftText: "",
                    validationMessage: "",
                    interactionMessage: "",
                    defaultFeedback: wrapper.dataset.datePickerDefaultFeedback || "",
                    guidance: wrapper.dataset.datePickerGuidance || "",
                    keepOpenOnSelect: wrapper.dataset.datePickerKeepOpenOnSelect === "true",
                    selectMonth: wrapper.dataset.datePickerSelectMonth === "true",
                    stableFrame: wrapper.dataset.datePickerStableFrame === "true",
                    stablePosition: null,
                    avoidSelector: wrapper.dataset.datePickerAvoidSelector || "",
                    selectedMonthValue: "",
                };
                wrapper.dataset.bound = "1";
                wrapper._worthwardDatePicker = picker;
                // Ensure popover is not clipped by sidebar or parents with overflow/transform.
                // NOTE: nav buttons are inside the popover, so bind nav listeners BEFORE moving the popover.
                navButtons.forEach((button) => {
                    button.addEventListener("click", (event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        const direction = Number.parseInt(button.dataset.dateNav || "0", 10);
                        const availability = getDatePickerNavigationAvailability(picker, direction);
                        if (!availability.selectable) {
                            showDatePickerFeedback(picker, availability.message);
                            return;
                        }
                        clearDatePickerFeedback(picker);
                        picker.forceSyncMonth = false;
                        picker.visibleMonth = getDatePickerNavigationTarget(picker, direction);
                        syncDatePickerView(picker);
                        positionDatePickerPopover(picker);
                    });
                });
                title.addEventListener("click", (event) => {
                    event.preventDefault();
                    picker.view = picker.view === "months" ? "days" : "months";
                    clearDatePickerFeedback(picker);
                    syncDatePickerView(picker);
                    positionDatePickerPopover(picker);
                });
                if (popover.parentElement !== document.body) {
                    document.body.appendChild(popover);
                }
                datePickerState.push(picker);
                syncDatePickerView(picker);
                const openDatePicker = ({focusEditor = false} = {}) => {
                    if (popover.hidden) {
                        closeAllDatePickers();
                    }
                    picker.view = "days";
                    clearDatePickerFeedback(picker);
                    picker.forceSyncMonth = true;
                    syncDatePickerView(picker);
                    popover.hidden = false;
                    trigger.setAttribute("aria-expanded", "true");
                    syncDatePickerPeerHighlight();
                    picker.stablePosition = null;
                    lockDatePickerPopoverFrame(picker);
                    positionDatePickerPopover(picker);
                    if (focusEditor) picker.triggerValue.focus();
                };
                trigger.addEventListener("click", () => {
                    openDatePicker();
                });
                triggerValue.addEventListener("focus", () => {
                    openDatePicker();
                });
                triggerValue.addEventListener("input", () => {
                    picker.draftText = normalizeDatePickerDraft(triggerValue.textContent);
                    picker.validationMessage = "";
                    const parsedDraft = parseManualDateInput(picker.draftText);
                    const draftMessage = parsedDraft
                        ? getDatePickerValidationMessage(picker, formatIsoDate(parsedDraft))
                        : "";
                    if (draftMessage) showDatePickerFeedback(picker, draftMessage);
                    else clearDatePickerFeedback(picker);
                    triggerValue.dataset.empty = picker.draftText ? "0" : "1";
                    picker.forceSyncMonth = true;
                    refreshDatePickers();
                });
                triggerValue.addEventListener("blur", (event) => {
                    if (isInsideDatePicker(picker, event.relatedTarget)) return;
                    commitDatePickerTextInput(picker, {emitChange: true});
                });
                triggerValue.addEventListener("keydown", (event) => {
                    if (event.key === "Enter") {
                        event.preventDefault();
                        commitDatePickerTextInput(picker, {
                            emitChange: true,
                            closePopover: !picker.keepOpenOnSelect,
                        });
                    }
                    if (event.key === "Escape") {
                        event.preventDefault();
                        if (picker.view === "months") {
                            picker.view = "days";
                            syncDatePickerView(picker);
                            positionDatePickerPopover(picker);
                            return;
                        }
                        picker.draftText = "";
                        picker.validationMessage = "";
                        picker.forceDisplaySync = true;
                        syncDatePickerView(picker);
                        closeAllDatePickers();
                        triggerValue.blur();
                    }
                });
                input.addEventListener("change", () => {
                    picker.selectedMonthValue = "";
                    picker.forceSyncMonth = true;
                    picker.forceDisplaySync = true;
                    picker.draftText = "";
                    picker.validationMessage = "";
                    clearDatePickerFeedback(picker);
                    syncDatePickerView(picker);
                    syncDatePickerPeerHighlight();
                });
            });
            if (!datePickerDocumentListenersBound) {
                datePickerDocumentListenersBound = true;
                document.addEventListener("pointerdown", (event) => {
                    if (isInsideAnyDatePicker(event.target)) return;
                    closeAllDatePickers();
                }, {capture: true});
                window.addEventListener("resize", () => {
                    datePickerState.forEach((picker) => {
                        if (picker.popover.hidden) return;
                        picker.stablePosition = null;
                        positionDatePickerPopover(picker);
                    });
                });
            }
        };

        const refreshDatePickers = () => {
            datePickerState.forEach((picker) => syncDatePickerView(picker));
            syncDatePickerPeerHighlight();
        };

        window.WORTHWARD_DATE_PICKERS = {
            closeAll: closeAllDatePickers,
            dispose: disposeDatePickers,
            initialize: initializeDatePickers,
            refresh: refreshDatePickers,
        };

        const buildCleanWorkspaceUrl = () => {
            const rangeMode = $("input[name='range']:checked")?.value || defaults.range_mode;
            if (typeof workspaceUrlState?.buildWorkspaceUrl !== "function") return window.location.pathname;

            const strategySelect = $("#trade_strategy");
            const strategyValue = strategySelect?.value
                || document.querySelector("input[name='strategy']")?.value
                || "";
            const strategyParamDefaults = {};
            $$('[data-strategy-param-key]').forEach((field) => {
                const key = field.dataset.strategyParamKey?.trim();
                const control = field.querySelector("[data-strategy-param-input]");
                if (key && control?.dataset.default !== undefined) {
                    if (control.dataset.strategyParamInput === "boolean") {
                        const defaultValue = control.dataset.default.trim().toLowerCase();
                        const isDefaultOn = ["1", "true", "on"].includes(defaultValue);
                        strategyParamDefaults[key] = isDefaultOn
                            ? control.dataset.switchOnValue
                            : control.dataset.switchOffValue;
                    } else {
                        const derivedValue = control.dataset.strategyParamDerivedValue;
                        strategyParamDefaults[key] = (
                            derivedValue !== undefined
                            && strategyNumericValuesMatch(control.value, derivedValue)
                        )
                            ? derivedValue
                            : control.dataset.default;
                    }
                }
            });
            const currentUrlState = workspaceUrlState.parseWorkspaceUrlState(window.location.href, {
                defaultPeriod: defaults.period || "1y",
            });
            const activePeriod = $("#period")?.value || defaults.period || "1y";
            const rangeState = {
                rangeMode,
                period: activePeriod,
                date: isOneDayExactDateMode() ? exactTradingDateInput?.value || "" : "",
                from: isOneDayExactDateMode() ? "" : exactStartInput?.value || "",
                to: isOneDayExactDateMode() ? "" : exactEndInput?.value || "",
            };
            const portfolioEntries = getFilledWeightEntries();
            const activeTab = $("[data-trade-detail-shell] input[name='trade_detail_tab']:checked")?.value || "metrics";
            const cleanUrl = workspaceUrlState.buildWorkspaceUrl(window.location.href, {
                ...rangeState,
                tickers: getFilledTickers(),
                comparisonMetric: state.currentView === "prices" ? getComparisonMetric() : "price",
                defaultTickers: state.currentView === "portfolio"
                    ? (defaults.portfolio_tickers || [])
                    : isBacktestView || isDcaView
                        ? isBacktestView
                            ? (Array.isArray(state.strategyDefaultTickers) && state.strategyDefaultTickers.length
                                ? state.strategyDefaultTickers
                                : [defaults.backtest_ticker || defaults.ticker_a || ""])
                            : [defaults.dca_ticker || defaults.ticker_a || ""]
                        : [defaults.ticker_a || "QQQ", defaults.ticker_b || "JEPQ"],
                returnMode: priceOnlyInput?.checked ? "price" : includeDividendsInput?.checked ? "dividends" : "total",
                extendedHours: Boolean(extendedHoursInput?.checked && !extendedHoursInput.disabled),
                overnight: Boolean(overnightInput?.checked && !overnightInput.disabled),
                showChips: Boolean(
                    state.currentView === "prices"
                    && getComparisonMetric() === "price"
                    && chipsInput?.checked
                    && !chipsInput.disabled,
                ),
                isPortfolio: isPortfolioView,
                allocation: isPortfolioView ? getPortfolioAllocationMode() : "weight",
                weights: portfolioEntries.map((entry) => Number.parseInt(entry.number.value, 10) || 0),
                shares: portfolioEntries.map((entry) => Number.parseInt(entry.shares?.value || "0", 10) || 0),
                defaultWeights: defaults.portfolio_weights || [],
                isBacktest: isBacktestView,
                strategy: strategyValue,
                defaultStrategy: defaults.backtest_strategy || "buy-and-hold",
                capital: isBacktestView ? parseTradeCapitalValue(tradeCapitalInput?.value) : "",
                defaultCapital: defaults.backtest_capital ?? 10000,
                interval: isBacktestView ? getSelectedBacktestInterval() : "",
                defaultInterval: defaults.backtest_interval || "1d",
                strategyParams: isBacktestView ? collectStrategyParamEntries({forBacktest: true}) : [],
                strategyParamDefaults,
                stopLossEnabled: isBacktestView ? Boolean(stopLossInput?.checked) : undefined,
                defaultStopLossEnabled: defaults.backtest_stop_loss ?? false,
                showTradeDetailsEnabled: isBacktestView ? Boolean(showTradeDetailsInput?.checked) : undefined,
                defaultShowTradeDetailsEnabled: defaults.backtest_show_trade_details ?? false,
                isDca: isDcaView,
                amount: isDcaView ? parseTradeCapitalValue(tradeCapitalInput?.value) : "",
                defaultAmount: defaults.dca_amount ?? 1000,
                frequency: isDcaView ? getSelectedDcaFrequency() : "",
                defaultFrequency: defaults.dca_frequency || "monthly",
                weekday: document.getElementById("dca_weekday")?.value || "0",
                defaultWeekday: defaults.dca_weekday ?? 0,
                monthDay: document.getElementById("dca_month_day")?.value || "15",
                defaultMonthDay: defaults.dca_month_day ?? 15,
                tab: activeTab,
                page: bootstrap.workspaceTablePage ?? currentUrlState.page,
            }, {
                defaultPeriod: defaults.period || "1y",
            });
            return window.WORTHWARD_LSTM_TRAINING?.preserveSelectionUrl?.(cleanUrl) || cleanUrl;
        };

        const buildPeriodOptionDefs = (periodValues) => (
            Array.from(periodValues || []).map((value) => ({
                value,
                label: PERIOD_LABELS[value] || value,
            }))
        );

        const replacePeriodOptions = (periodValues, preferredFallback = null) => {
            const periodSelect = document.getElementById("period");
            if (!periodSelect) return;
            const currentPeriod = periodSelect.value;
            const nextOptions = buildPeriodOptionDefs(periodValues);
            if (!nextOptions.length) return;
            periodSelect.innerHTML = "";
            nextOptions.forEach((option) => {
                const el = document.createElement("option");
                el.value = option.value;
                el.textContent = option.label;
                if (option.value === currentPeriod) el.selected = true;
                periodSelect.appendChild(el);
            });
            const allowed = nextOptions.map((option) => option.value);
            periodSelect.value = allowed.includes(currentPeriod)
                ? currentPeriod
                : preferredFallback && allowed.includes(preferredFallback)
                    ? preferredFallback
                    : allowed[allowed.length - 1];
            refreshSharedSelectField(periodPanel?.querySelector("[data-shared-select-field]"));
        };

        const getRequiredBacktestTickerSnapshot = (requiredTickerCount = getMinimumRequiredTickers()) => (
            getTickerInputs()
                .slice(0, requiredTickerCount)
                .map((input) => sanitizeTicker(input.value.trim()))
                .filter(Boolean)
        );

        const backtestTickerSnapshotsMatch = (left, right) => (
            left.length === right.length
            && left.every((ticker, index) => ticker === right[index])
        );

        const intersectBacktestPeriodOptions = (payload, tickerSnapshot) => {
            const periodOptions = payload?.periodOptions && typeof payload.periodOptions === "object"
                ? payload.periodOptions
                : {};
            const tickerOptions = tickerSnapshot.map((ticker) => periodOptions[ticker] || {});
            const shared = {};
            ["1d", "1m"].forEach((interval) => {
                const firstOptions = Array.isArray(tickerOptions[0]?.[interval])
                    ? tickerOptions[0][interval]
                    : [];
                shared[interval] = firstOptions.filter((period) => tickerOptions.every((options) => (
                    Array.isArray(options?.[interval]) && options[interval].includes(period)
                )));
            });
            return shared;
        };

        const canApplyBacktestIntervalResponse = (requestToken, requiredTickerCount, tickerSnapshot) => (
            requestToken === backtestIntervalRequestToken
            && requiredTickerCount === getMinimumRequiredTickers()
            && backtestTickerSnapshotsMatch(tickerSnapshot, getRequiredBacktestTickerSnapshot())
        );

        const syncBacktestIntervals = async () => {
            if (!isBacktestView) return;
            const requestToken = ++backtestIntervalRequestToken;
            const requiredTickerCount = getMinimumRequiredTickers();
            const tickerSnapshot = getRequiredBacktestTickerSnapshot(requiredTickerCount);
            if (tickerSnapshot.length < requiredTickerCount) {
                const currentInterval = getSelectedBacktestInterval();
                setBacktestIntervalAvailability(false);
                if (currentInterval === "1m") setBacktestIntervalValue("1d");
                return;
            }

            try {
                const params = new URLSearchParams();
                tickerSnapshot.forEach((ticker) => params.append("ticker", ticker));
                const response = await fetch(`${endpoints.marketStorePresence}?${params.toString()}`, {credentials: "same-origin"});
                if (!response.ok) return;
                const payload = await response.json();
                if (!canApplyBacktestIntervalResponse(requestToken, requiredTickerCount, tickerSnapshot)) return;

                const sharedPeriodOptions = intersectBacktestPeriodOptions(payload, tickerSnapshot);
                state.backtestPeriodOptions = {
                    ...(state.backtestPeriodOptions || {}),
                    ...(sharedPeriodOptions["1d"].length ? {"1d": sharedPeriodOptions["1d"]} : {}),
                    "1m": sharedPeriodOptions["1m"],
                };
                const hasAllRequiredTickers = tickerSnapshot.length === requiredTickerCount;
                const has1m = strategyDeclaresBacktestInterval("1m")
                    && hasAllRequiredTickers
                    && tickerSnapshot.every((ticker) => payload.has1m?.[ticker] === true)
                    && sharedPeriodOptions["1m"].length > 0;

                const intervalInputs = getBacktestIntervalInputs();
                if (intervalInputs.length) {
                    const currentInterval = getSelectedBacktestInterval();
                    setBacktestIntervalAvailability(has1m);
                    const nextInterval = currentInterval === "1m" && !has1m ? "1d" : currentInterval;
                    setBacktestIntervalValue(nextInterval);

                    if (currentInterval === "1m" && !has1m) {
                        replacePeriodOptions(
                            sharedPeriodOptions["1d"].length
                                ? sharedPeriodOptions["1d"]
                                : state.backtestPeriodOptions?.["1d"] || ["1d"],
                            "1d",
                        );
                        const nextInput = getBacktestIntervalInputs().find((input) => input.value === "1d");
                        nextInput?.dispatchEvent(new Event("change", {bubbles: true}));
                    } else if (currentInterval !== nextInterval) {
                        const nextInput = getBacktestIntervalInputs().find((input) => input.value === nextInterval);
                        nextInput?.dispatchEvent(new Event("change", {bubbles: true}));
                    } else {
                        replacePeriodOptions(
                            sharedPeriodOptions[nextInterval]?.length
                                ? sharedPeriodOptions[nextInterval]
                                : state.backtestPeriodOptions?.[nextInterval] || ["1d"],
                            nextInterval === "1m" ? null : "max",
                        );
                    }
                }
            } catch (_error) {
            }
        };

        const syncDateConstraints = async () => {
            if ((!exactStartInput || !exactEndInput) && !exactTradingDateInput) return;
            const requestId = ++dateConstraintsRequestId;
            const rangeMode = $("input[name='range']:checked")?.value || defaults.range_mode;
            if (rangeMode !== "exact") {
                validTradingDateSet = null;
                dateConstraintAvailability = {};
                return;
            }
            const tickers = getFilledTickers();
            if (tickers.length < getMinimumRequiredTickers() || new Set(tickers).size !== tickers.length) return;
            const params = new URLSearchParams({view: state.currentView});
            if (state.currentView === "prices" && getComparisonMetric() === "market-cap") {
                params.set("metric", "market-cap");
            }
            const activeRangeMode = $("input[name='range']:checked")?.value || defaults.range_mode;
            const activePeriod = periodSelect?.value || defaults.period;
            if (activeRangeMode) params.set("range", activeRangeMode);
            if (activePeriod) params.set("period", activePeriod);
            if (priceOnlyInput?.checked) {
                params.set("price_only", "1");
            } else if (includeDividendsInput?.checked) {
                params.set("dividends", "1");
            }
            if (isOneDayExactDateMode()) {
                if (exactTradingDateInput?.value) {
                    params.set("from", exactTradingDateInput.value);
                    params.set("to", exactTradingDateInput.value);
                }
            } else {
                if (exactStartInput?.value) params.set("from", exactStartInput.value);
                if (exactEndInput?.value) params.set("to", exactEndInput.value);
            }
            tickers.forEach((ticker) => params.append("ticker", ticker));
            try {
                const response = await fetch(`${endpoints.dateConstraints}?${params.toString()}`);
                if (requestId !== dateConstraintsRequestId) return;
                if (!response.ok) return;
                const payload = await response.json();
                if (requestId !== dateConstraintsRequestId) return;
                validTradingDateSet = payload.trading_dates?.length ? new Set(payload.trading_dates) : null;
                dateConstraintAvailability = payload.availability && typeof payload.availability === "object"
                    ? payload.availability
                    : {};
                const tradingDateSet = new Set(payload.trading_dates || []);
                if (exactStartInput) {
                    exactStartInput.min = payload.min_date || "";
                    exactStartInput.max = payload.max_date || "";
                }
                if (exactEndInput) {
                    exactEndInput.min = payload.min_date || "";
                    exactEndInput.max = payload.max_date || "";
                }
                if (exactTradingDateInput) {
                    exactTradingDateInput.min = payload.min_date || "";
                    exactTradingDateInput.max = payload.max_date || "";
                }
                if (isOneDayExactDateMode()) {
                    const adjustedTradingDate = payload.adjusted_start || payload.adjusted_end || payload.max_date || "";
                    const currentTradingDate = exactTradingDateInput?.value || "";
                    const shouldUseAdjustedTradingDate = adjustedTradingDate
                        && (!currentTradingDate || (tradingDateSet.size > 0 && !tradingDateSet.has(currentTradingDate)));
                    const resolvedTradingDate = shouldUseAdjustedTradingDate ? adjustedTradingDate : currentTradingDate;
                    if (resolvedTradingDate && exactTradingDateInput) exactTradingDateInput.value = resolvedTradingDate;
                    if (resolvedTradingDate && exactStartInput) exactStartInput.value = resolvedTradingDate;
                    if (resolvedTradingDate && exactEndInput) exactEndInput.value = resolvedTradingDate;
                } else {
                    if (payload.adjusted_start && exactStartInput) exactStartInput.value = payload.adjusted_start;
                    if (payload.adjusted_end && exactEndInput) exactEndInput.value = payload.adjusted_end;
                }
                const enforceTradingDate = (input, fallbackValue) => {
                    if (!input.value || tradingDateSet.has(input.value)) return false;
                    input.value = fallbackValue || "";
                    return true;
                };
                if (isOneDayExactDateMode()) {
                    enforceTradingDate(exactTradingDateInput, payload.adjusted_start || payload.adjusted_end || payload.max_date);
                } else {
                    enforceTradingDate(exactStartInput, payload.adjusted_start);
                    enforceTradingDate(exactEndInput, payload.adjusted_end);
                }
                datePickerState.forEach((picker) => {
                    picker.invalidDraft = "";
                    picker.validationMessage = "";
                });
                refreshDatePickers();
            } catch (_error) {
            }
        };

        getTickerInputs().forEach((input) => setupAutocomplete(input));
        initializeDatePickers();
        initializeWorkspaceEnhancements();
        initThemeModeControls();
        initGlobalAppearanceControls();
        initGlobalLanguageControls();
        rememberCurrentViewUrl();
        attachDockMemory();
        attachOptimisticInternalNavigation();
        attachRemoveHandlers();
        attachTickerClearHandlers();
        attachPortfolioAllocationHandlers();
        attachPortfolioWeightHandlers();
        reindexTickerFields();
        validateAllTickerInputs();
        syncPortfolioWeightDisabledState();
        ensurePortfolioWeightTouches();
        syncPortfolioWeightBounds();
        dispatchPortfolioPreviewUpdate();
        validatePortfolioWeightInputs();
        updateRangePanels();
        syncBacktestIntervalSegmentedControl();
        syncDcaFrequencySegmentedControl();
        syncAllSegmentedControlLayouts();

        return Object.freeze({
            MS_PER_DAY,
            PERIOD_DAY_SPANS,
            PERIOD_LABELS,
            PERIOD_MONTH_SPANS,
            addMonthsUtc,
            applyDatePickerValidationState,
            backtestIntervalRequestToken,
            backtestTickerSnapshotsMatch,
            buildCleanWorkspaceUrl,
            buildFullDateLayout,
            buildPeriodOptionDefs,
            buildUtcDate,
            canApplyBacktestIntervalResponse,
            canAutoSubmit,
            chooseRelativePeriodForExactRange,
            clampDateToBounds,
            clampTradeCapital,
            clearDatePickerFeedback,
            closeAllDatePickers,
            commitDatePickerTextInput,
            convertNewYorkWallTimeParts,
            countTradeCapitalCharsBeforeCaret,
            dateConstraintAvailability,
            dateConstraintsRequestId,
            datePickerDocumentListenersBound,
            datePickerState,
            diffDaysUtc,
            disposeDatePickers,
            formatDisplayDate,
            formatEditableTradeCapitalValue,
            formatFullDateLines,
            formatFullDateParts,
            formatIsoDate,
            formatPickerMonthLabel,
            formatShortDateParts,
            formatTradeCapitalTypingValue,
            formatTradeCapitalValue,
            getDateEntryExample,
            getDateEntryHint,
            getDatePickerBoundMessage,
            getDatePickerBounds,
            getDatePickerComparableIsoValue,
            getDatePickerDateAvailability,
            getDatePickerDefaultFeedback,
            getDatePickerMonthAvailability,
            getDatePickerNavigationAvailability,
            getDatePickerNavigationTarget,
            getDatePickerPeer,
            getDatePickerValidationMessage,
            getDatePickerWorkingState,
            getDatePickerWrappers,
            getRenderedChartDateRange,
            getRequiredBacktestTickerSnapshot,
            getShortDatePlaceholder,
            getTimezoneOffsetMinutes,
            handlePeriodSelectionChange,
            initializeDatePickers,
            intersectBacktestPeriodOptions,
            isInsideAnyDatePicker,
            isInsideDatePicker,
            isSameUtcDay,
            lockDatePickerPopoverFrame,
            normalizeDatePickerDraft,
            padTwo,
            parseDisplayDateTextToIso,
            parseIsoDate,
            parseManualDateInput,
            parseMonthToken,
            parseOneDayTradingDateTextToIso,
            parseTradeCapitalValue,
            positionDatePickerPopover,
            readFullDateFormat,
            readShortDateFormat,
            refreshDatePickers,
            renderDatePickerMonthGrid,
            replacePeriodOptions,
            resolveTradeCapitalCaretPosition,
            scheduleAutoSubmit,
            shiftMonthsUtc,
            showDatePickerFeedback,
            startOfMonthUtc,
            syncBacktestIntervals,
            syncDateConstraints,
            syncDatePickerEditorText,
            syncDatePickerNavigationButtons,
            syncDatePickerPeerHighlight,
            syncDatePickerView,
            syncExactInputsToRenderedRange,
            updateDatePickerValue,
            updateRangePanels,
            validTradingDateSet,
        });
    };

    window.WORTHWARD_APP_DATE_CONTROLS = Object.freeze({create});
})();
