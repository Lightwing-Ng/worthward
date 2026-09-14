/* Code version: v1.0.2 */
(() => {
    const create = (context) => {
        const {
            $,
            BACKTEST_STRATEGY_PARAMS_MEMORY_KEY,
            SIDEBAR_OVERLAY_GAP_PX,
            STRATEGY_MEMORY_KEY,
            WORKSPACE_VIEWS,
            addTickerField,
            applyPendingWorkspaceMarkup,
            bootstrap,
            buildCleanWorkspaceUrl,
            captureBacktestRefreshTransition,
            captureLineChartRefreshTransition,
            clearWorkspacePendingState,
            clearWorkspaceChartTransitionRequest,
            closeSharedSelectDropdowns,
            didCompareRequestChangeMetric,
            didCompareRequestChangeRange,
            didPortfolioRequestChangeXAxis,
            endpoints,
            ensureTickerValidityBeforeSubmit,
            fetchMissingLocalMarketTickers,
            form,
            getFilledTickers,
            getFilledWeightEntries,
            getMinimumRequiredTickers,
            getSharedSelectFields,
            getSharedSelectParts,
            getTickerFields,
            getTickerInputs,
            hideWorkspaceModal,
            hydrateWorkspaceFromUrl,
            initializeSharedSelectField,
            initializeWorkspaceEnhancements,
            isBacktestView,
            isPortfolioShareMode,
            isPortfolioView,
            labels,
            positionSharedSelectDropdown,
            preferenceStorage,
            refreshSharedSelectField,
            reindexTickerFields,
            rememberCurrentViewUrl,
            resetSidebarDropdownPosition,
            restoreOptimisticNavigationSnapshot,
            runtimeState,
            sanitizeTicker,
            scheduleAutoSubmit,
            scheduleDockPosition,
            scheduleMobilePageBottomPaddingSync,
            seedTickerValidationState,
            setFormBusyState,
            setSharedSelectDropdownOpen,
            setTickerValidationPending,
            showImmediateRangeLoadingDialog,
            showTickerValidationTooltip,
            showWorkspaceModal,
            state,
            syncBacktestIntervalSegmentedControl,
            syncBacktestIntervals,
            syncSharedSelectTriggerLabel,
            syncStrategyParamFieldVisibility,
            syncTickerInputDecoration,
            upgradeStandaloneSharedSelects,
            validateAllTickerInputs,
            validatePortfolioWeightInputs,
            workspaceModalOverlayClose,
            workspaceUrlState,
        } = context;

        const getTradeStrategyRefs = () => {
            const field = document.querySelector("[data-trade-strategy-field]");
            const select = $("#trade_strategy");
            const trigger = document.querySelector("[data-trade-strategy-trigger]");
            const triggerLabel = document.querySelector("[data-trade-strategy-trigger-label]");
            const dropdown = document.querySelector("[data-trade-strategy-dropdown]");
            const tuneButton = document.querySelector("[data-trade-strategy-tune-button]");
            const panel = document.querySelector("[data-trade-strategy-panel]");
            return {
                field,
                select,
                trigger,
                triggerLabel,
                dropdown,
                tuneButton,
                panel,
            };
        };
        let strategySwitchAnimationTimer = null;
        let strategyFieldsRequestToken = 0;
        let pendingBacktestStrategyNavigation = false;

        const readBacktestStrategyParamMemory = () => {
            try {
                const parsed = JSON.parse(preferenceStorage.local.getItem(BACKTEST_STRATEGY_PARAMS_MEMORY_KEY) || "{}");
                if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
                return Object.fromEntries(
                    Object.entries(parsed).flatMap(([strategyId, values]) => {
                        if (!strategyId || !values || typeof values !== "object" || Array.isArray(values)) {
                            return [];
                        }
                        const normalizedValues = Object.fromEntries(
                            Object.entries(values).flatMap(([key, value]) => {
                                const normalizedKey = String(key || "").trim();
                                const normalizedValue = String(value ?? "").trim();
                                return normalizedKey && normalizedValue
                                    ? [[normalizedKey, normalizedValue]]
                                    : [];
                            }),
                        );
                        return Object.keys(normalizedValues).length
                            ? [[strategyId, normalizedValues]]
                            : [];
                    }),
                );
            } catch (_error) {
                return {};
            }
        };

        const writeBacktestStrategyParamMemory = (memory) => {
            try {
                preferenceStorage.local.setItem(
                    BACKTEST_STRATEGY_PARAMS_MEMORY_KEY,
                    JSON.stringify(memory),
                );
            } catch (_error) {
            }
        };

        const normalizeStrategyNumberText = (value) => String(value ?? "")
            .replaceAll(",", "")
            .trim();

        const strategyNumericValuesMatch = (left, right) => {
            const leftNumber = Number(normalizeStrategyNumberText(left));
            const rightNumber = Number(normalizeStrategyNumberText(right));
            return Number.isFinite(leftNumber)
                && Number.isFinite(rightNumber)
                && leftNumber === rightNumber;
        };

        const resolveDerivedStrategyParamDefault = (control) => {
            if (!(control instanceof HTMLInputElement)) return null;
            if (control.dataset.strategyDerivedDefault !== "initial-cash-per-ten-shares") return null;
            const result = window.WORTHWARD_APP?.backtestResult;
            const summaryQuantity = Number(result?.summary?.grid_trade_quantity);
            if (Number.isFinite(summaryQuantity) && summaryQuantity >= 0) {
                return Math.floor(summaryQuantity);
            }
            const capitalInput = document.getElementById("trade_initial_capital");
            const initialCash = Number(
                result?.summary?.initial_cash
                ?? normalizeStrategyNumberText(capitalInput?.value),
            );
            const initialPrice = Number(result?.chart?.open?.[0] ?? result?.chart?.close?.[0]);
            if (!Number.isFinite(initialCash) || !Number.isFinite(initialPrice) || initialPrice <= 0) {
                return null;
            }
            return Math.max(0, Math.floor(initialCash / (initialPrice * 10)));
        };

        const applyDerivedStrategyParamDefault = (control) => {
            const derivedValue = resolveDerivedStrategyParamDefault(control);
            if (derivedValue === null) return;
            const currentValue = normalizeStrategyNumberText(control.value);
            const declaredDefault = normalizeStrategyNumberText(control.dataset.default);
            const hasExplicitValue = new URL(window.location.href).searchParams.has(control.name);
            if (
                (hasExplicitValue && currentValue !== declaredDefault)
                || (currentValue !== "" && currentValue !== declaredDefault)
            ) {
                return;
            }
            control.value = String(derivedValue);
            control.dataset.strategyParamDerivedValue = String(derivedValue);
        };

        const restoreBacktestStrategyParams = (
            root,
            strategyId,
            {respectExplicitUrl = true} = {},
        ) => {
            if (!isBacktestView || !(root instanceof HTMLElement)) return {restored: false, requiresSubmit: false};
            const normalizedStrategyId = String(strategyId || "").trim();
            if (!normalizedStrategyId) return {restored: false, requiresSubmit: false};
            const remembered = readBacktestStrategyParamMemory()[normalizedStrategyId];
            if (!remembered || typeof remembered !== "object") return {restored: false, requiresSubmit: false};
            const explicitParams = respectExplicitUrl
                ? new URL(window.location.href).searchParams
                : null;
            let restored = false;
            let requiresSubmit = false;
            Object.entries(remembered).forEach(([key, value]) => {
                const field = Array.from(root.querySelectorAll("[data-strategy-param-key]"))
                    .find((candidate) => candidate.dataset.strategyParamKey === key);
                const control = field?.querySelector("[data-strategy-param-input][name]");
                if (!(control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement)) {
                    return;
                }
                if (explicitParams?.has(control.name)) return;
                const normalizedValue = String(value || "").trim();
                if (!normalizedValue) return;
                if (
                    control.dataset.strategyParamEmptyDefault === "1"
                    && strategyNumericValuesMatch(normalizedValue, control.dataset.default)
                ) {
                    return;
                }
                let changed = false;
                if (control.dataset.strategyParamInput === "select") {
                    if (!Array.from(control.options).some((option) => option.value === normalizedValue)) return;
                    if (control.value !== normalizedValue) {
                        control.value = normalizedValue;
                        changed = true;
                    }
                    refreshSharedSelectField(field);
                } else if (control.dataset.strategyParamInput === "boolean") {
                    const switchInput = field.querySelector("[data-strategy-param-switch]");
                    const onValue = control.dataset.switchOnValue || "1";
                    const offValue = control.dataset.switchOffValue || "0";
                    const nextChecked = normalizedValue === onValue
                        ? true
                        : normalizedValue === offValue
                            ? false
                            : null;
                    if (nextChecked === null) return;
                    changed = control.value !== normalizedValue
                        || (switchInput instanceof HTMLInputElement && switchInput.checked !== nextChecked);
                    control.value = normalizedValue;
                    if (switchInput instanceof HTMLInputElement) switchInput.checked = nextChecked;
                } else if (control.value !== normalizedValue) {
                    control.value = normalizedValue;
                    changed = true;
                }
                if (!changed) return;
                restored = true;
                if (field.dataset.strategyParamApplyMode === "training") {
                    control.dataset.strategyParamDraft = "1";
                } else {
                    requiresSubmit = true;
                }
            });
            return {restored, requiresSubmit};
        };

        const rememberBacktestStrategyParams = (strategyId = "") => {
            if (!isBacktestView) return;
            const normalizedStrategyId = String(
                strategyId || document.getElementById("trade_strategy")?.value || state.selectedStrategyId || "",
            ).trim();
            if (!normalizedStrategyId) return;
            const entries = collectStrategyParamEntries({forMemory: true});
            if (!entries.length) return;
            const memory = readBacktestStrategyParamMemory();
            memory[normalizedStrategyId] = Object.fromEntries(entries);
            writeBacktestStrategyParamMemory(memory);
        };

        const scheduleStrategyParamSubmit = (delay = 160) => {
            rememberBacktestStrategyParams();
            if (!runtimeState.hasInitialResult) return;
            scheduleAutoSubmit(delay);
        };

        const collectStrategyParamEntries = ({forBacktest = false, forMemory = false} = {}) => {
            const {field} = getTradeStrategyRefs();
            if (!(field instanceof HTMLElement)) return [];
            const controls = Array.from(field.querySelectorAll("[data-strategy-param-input][name]"));
            return controls.flatMap((control) => {
                if (!(control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement)) {
                    return [];
                }
                const key = control.name?.trim();
                if (!key) return [];
                let value = forBacktest && control.dataset.strategyParamDraft === "1"
                    ? control.dataset.strategyParamActiveValue ?? control.value ?? ""
                    : control.value ?? "";
                if (control.dataset.strategyNumberFormat === "grouped-integer") {
                    value = normalizeStrategyNumberText(value);
                }
                if (
                    forMemory
                    && control.dataset.strategyParamDerivedValue !== undefined
                    && strategyNumericValuesMatch(value, control.dataset.strategyParamDerivedValue)
                ) {
                    value = control.dataset.default ?? value;
                }
                return value === "" ? [] : [[key, value]];
            });
        };

        const syncStrategyFactorGroupCount = (field) => {
            const group = field?.closest?.(".strategy-factor-group");
            const summary = group?.querySelector?.(":scope > summary");
            if (!(group instanceof HTMLDetailsElement) || !(summary instanceof HTMLElement)) return;
            const baseTitle = summary.dataset.strategyFactorBaseTitle
                || summary.textContent.trim().replace(/ \(\d+\)$/, "");
            summary.dataset.strategyFactorBaseTitle = baseTitle;
            const enabledCount = Array.from(group.querySelectorAll("[data-strategy-param-switch]"))
                .filter((control) => control instanceof HTMLInputElement && control.checked).length;
            summary.textContent = enabledCount ? `${baseTitle} (${enabledCount})` : baseTitle;
        };

        const stageOrSubmitStrategyParam = (field, delay = 160) => {
            if (!(field instanceof HTMLElement) || field.dataset.strategyParamApplyMode !== "training") {
                scheduleStrategyParamSubmit(delay);
                return;
            }
            const control = field.querySelector("[data-strategy-param-input][name]");
            if (control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement) {
                control.dataset.strategyParamDraft = "1";
            }
            syncStrategyFactorGroupCount(field);
            rememberBacktestStrategyParams();
        };

        const positionTradeStrategyPanel = () => {
            const {panel} = getTradeStrategyRefs();
            if (!(panel instanceof HTMLElement) || panel.hidden) return;
            panel.classList.remove("is-flipped");
            panel.style.top = "";
            panel.style.bottom = "";
            panel.style.transformOrigin = "";
            panel.style.height = "";
            panel.style.maxHeight = "";
            const panelGrid = panel.querySelector("[data-trade-strategy-params-grid]");
            if (panelGrid instanceof HTMLElement) {
                panelGrid.style.maxHeight = "";
                panelGrid.classList.remove("is-scrollable", "is-scrolling");
            }
        };

        const setTradeStrategyPanelOpen = (isOpen) => {
            const {field, tuneButton, panel} = getTradeStrategyRefs();
            if (!(panel instanceof HTMLElement) || !(tuneButton instanceof HTMLButtonElement)) return;
            const shouldOpen = isOpen && !tuneButton.classList.contains("is-hidden");
            panel.hidden = !shouldOpen;
            tuneButton.classList.toggle("is-active", shouldOpen);
            tuneButton.setAttribute("aria-pressed", shouldOpen ? "true" : "false");
            tuneButton.setAttribute("aria-expanded", shouldOpen ? "true" : "false");
            if (field instanceof HTMLElement) {
                field.classList.toggle("is-open", shouldOpen);
            }
            if (shouldOpen) {
                positionTradeStrategyPanel();
            } else {
                panel.style.maxHeight = "";
                panel.style.height = "";
                panel.style.top = "";
                panel.style.bottom = "";
                panel.style.transformOrigin = "";
                panel.classList.remove("is-flipped");
                const panelGrid = panel.querySelector("[data-trade-strategy-params-grid]");
                if (panelGrid instanceof HTMLElement) {
                    panelGrid.style.maxHeight = "";
                    panelGrid.classList.remove("is-scrollable", "is-scrolling");
                }
            }
        };

        const BACKTEST_COLLAPSE_AFTER_STRATEGY_CHANGE_KEY = "worthward:backtest-collapse-after-strategy-change:v1";

        const rememberBacktestCollapseForStrategyChange = (strategyId) => {
            const collapse = document.querySelector('[data-collapse="backtest"]');
            if (!(collapse instanceof HTMLDetailsElement)) return;
            const hasEnabledSwitch = Array.from(collapse.querySelectorAll('input[type="checkbox"]'))
                .some((input) => input instanceof HTMLInputElement && input.checked);
            if (hasEnabledSwitch) {
                preferenceStorage.session.removeItem(BACKTEST_COLLAPSE_AFTER_STRATEGY_CHANGE_KEY);
                return;
            }
            preferenceStorage.session.setItem(
                BACKTEST_COLLAPSE_AFTER_STRATEGY_CHANGE_KEY,
                String(strategyId || ""),
            );
        };

        const restoreBacktestCollapseAfterStrategyChange = () => {
            const requestedStrategyId = preferenceStorage.session.getItem(
                BACKTEST_COLLAPSE_AFTER_STRATEGY_CHANGE_KEY,
            );
            if (!requestedStrategyId) return;
            preferenceStorage.session.removeItem(BACKTEST_COLLAPSE_AFTER_STRATEGY_CHANGE_KEY);
            const selectedStrategyId = String(
                document.getElementById("trade_strategy")?.value || state.selectedStrategyId || "",
            );
            if (requestedStrategyId !== selectedStrategyId) return;
            const collapse = document.querySelector('[data-collapse="backtest"]');
            if (collapse instanceof HTMLDetailsElement) collapse.open = false;
        };

        const allocationLabelLayouts = new WeakMap();
        const separateAllocationHandles = (container, low, high) => {
            const track = container.querySelector('.strategy-allocation-track-shell');
            if (track) {
                const close = (high - low) * track.clientWidth / 100 < 14;
                track.classList.toggle('has-close-handles', close);
                track.title = close ? 'Nearby boundaries use separate rows; percentages are unchanged.' : '';
            }
        };
        let allocationLabelResizeFrame = null;
        window.addEventListener("resize", () => {
            if (allocationLabelResizeFrame !== null) {
                window.cancelAnimationFrame(allocationLabelResizeFrame);
            }
            allocationLabelResizeFrame = window.requestAnimationFrame(() => {
                allocationLabelResizeFrame = null;
                document.querySelectorAll("[data-strategy-allocation-range]").forEach((allocation) => {
                    allocationLabelLayouts.get(allocation)?.();
                });
            });
        });

        const readBacktestTickerName = (index) => {
            const tickerInputs = document.querySelectorAll("[data-backtest-ticker-fields] [data-ticker-input]");
            const fallback = index === 0 ? "Primary" : index === 1 ? "Leveraged" : "Asset";
            return String(tickerInputs[index]?.value || fallback).trim().toUpperCase();
        };

        const syncStrategyTickerLabels = (root = document) => {
            root.querySelectorAll?.("[data-strategy-param-ui-role^='ticker-label:']").forEach((field) => {
                if (!(field instanceof HTMLElement)) return;
                const [, rawIndex, ...suffixParts] = String(field.dataset.strategyParamUiRole || "").split(":");
                const tickerIndex = Number.parseInt(rawIndex, 10);
                const label = field.querySelector("[data-strategy-param-label-text]");
                if (!Number.isInteger(tickerIndex) || !(label instanceof HTMLElement) || !suffixParts.length) return;
                const suffix = suffixParts.join(" ").replaceAll("-", " ");
                label.textContent = `${readBacktestTickerName(tickerIndex)} ${suffix}`;
            });
        };

        const initStrategyParamControls = (root = document) => {
            const panelGrid = root.querySelector?.("[data-trade-strategy-params-grid]");
            if (panelGrid instanceof HTMLElement) {
                panelGrid.classList.remove("is-scrolling");
            }
            const fields = Array.from(root.querySelectorAll("[data-strategy-param-key]"));
            fields.forEach((field) => {
                if (!(field instanceof HTMLElement) || field.dataset.strategyParamBound === "1") return;
                field.dataset.strategyParamBound = "1";

                // Keep editable strategy values local until focus leaves the control.
                const textInput = field.querySelector("[data-strategy-param-input='text']");
                if (textInput instanceof HTMLInputElement) {
                    const markTextDraft = () => {
                        textInput.dataset.strategyParamDirty = "1";
                    };
                    const commitTextDraft = () => {
                        if (textInput.dataset.strategyParamDirty !== "1") return;
                        delete textInput.dataset.strategyParamDirty;
                        scheduleStrategyParamSubmit(80);
                    };
                    textInput.addEventListener("input", markTextDraft);
                    textInput.addEventListener("change", markTextDraft);
                    textInput.addEventListener("blur", commitTextDraft);
                }

                const numberInput = field.querySelector("[data-strategy-param-input='number']");
                if (numberInput instanceof HTMLInputElement) {
                    const isIntegerField = field.dataset.strategyParamKind === "integer";
                    const allowsEmptyDefault = numberInput.dataset.strategyParamEmptyDefault === "1";
                    const usesGroupedInteger = numberInput.dataset.strategyNumberFormat === "grouped-integer";
                    applyDerivedStrategyParamDefault(numberInput);
                    const normalizeStandaloneNumber = (value) => {
                        const normalizedText = normalizeStrategyNumberText(value);
                        if (allowsEmptyDefault && normalizedText === "") return null;
                        const parsed = Number.parseFloat(normalizedText);
                        if (!Number.isFinite(parsed)) return Number.parseFloat(numberInput.min || "0") || 0;
                        const min = Number.parseFloat(numberInput.min || "");
                        const max = Number.parseFloat(numberInput.max || "");
                        let normalized = parsed;
                        if (Number.isFinite(min)) normalized = Math.max(min, normalized);
                        if (Number.isFinite(max)) normalized = Math.min(max, normalized);
                        if (isIntegerField) normalized = Math.round(normalized);
                        return normalized;
                    };
                    const stepValue = () => {
                        if (isIntegerField) return 1;
                        const parsed = Number.parseFloat(numberInput.step || "0.1");
                        return Number.isFinite(parsed) && parsed > 0 ? parsed : 0.1;
                    };
                    const formatStandaloneNumber = (value) => {
                        if (value === null) return "";
                        if (isIntegerField) {
                            const integerValue = Math.round(value);
                            return usesGroupedInteger
                                ? integerValue.toLocaleString("en-US")
                                : String(integerValue);
                        }
                        const stepText = String(numberInput.step || "");
                        const decimals = stepText.includes(".") ? stepText.split(".")[1].length : 0;
                        return decimals > 0 ? value.toFixed(decimals) : String(value);
                    };
                    const syncStandaloneNumber = (value) => {
                        const normalized = normalizeStandaloneNumber(value);
                        numberInput.value = formatStandaloneNumber(normalized);
                        return normalized;
                    };
                    field.querySelectorAll("[data-strategy-stepper]").forEach((button) => {
                        if (!(button instanceof HTMLButtonElement)) return;
                        button.addEventListener("click", () => {
                            const delta = button.dataset.strategyStepper === "down" ? -stepValue() : stepValue();
                            const currentValue = Number.parseFloat(
                                normalizeStrategyNumberText(numberInput.value || "0"),
                            ) || 0;
                            delete numberInput.dataset.strategyParamDerivedValue;
                            syncStandaloneNumber(currentValue + delta);
                            stageOrSubmitStrategyParam(field, 80);
                        });
                    });
                    numberInput.addEventListener("focus", () => field.classList.add("is-open"));
                    numberInput.addEventListener("click", () => field.classList.add("is-open"));
                    numberInput.addEventListener("input", () => {
                        numberInput.dataset.strategyParamDirty = "1";
                        delete numberInput.dataset.strategyParamDerivedValue;
                    });
                    numberInput.addEventListener("change", () => {
                        numberInput.dataset.strategyParamDirty = "1";
                        delete numberInput.dataset.strategyParamDerivedValue;
                    });
                    numberInput.addEventListener("blur", () => {
                        const hasDraft = numberInput.dataset.strategyParamDirty === "1";
                        syncStandaloneNumber(numberInput.value);
                        delete numberInput.dataset.strategyParamDirty;
                        if (hasDraft) stageOrSubmitStrategyParam(field, 80);
                    });
                    field.addEventListener("focusout", () => window.setTimeout(() => {
                        if (field.matches(":focus-within")) return;
                        field.classList.remove("is-open");
                        syncStandaloneNumber(numberInput.value);
                    }, 80));
                    syncStandaloneNumber(numberInput.value);
                }

                const booleanInput = field.querySelector("[data-strategy-param-input='boolean']");
                const booleanSwitch = field.querySelector("[data-strategy-param-switch]");
                if (booleanInput instanceof HTMLInputElement && booleanSwitch instanceof HTMLInputElement) {
                    const syncBooleanValue = () => {
                        const onValue = booleanInput.dataset.switchOnValue || "1";
                        const offValue = booleanInput.dataset.switchOffValue || "0";
                        booleanInput.value = booleanSwitch.checked ? onValue : offValue;
                    };
                    booleanSwitch.addEventListener("change", () => {
                        syncBooleanValue();
                        stageOrSubmitStrategyParam(field, 80);
                    });
                    syncBooleanValue();
                }

                const selectInput = field.querySelector("[data-strategy-param-input='select']");
                if (selectInput instanceof HTMLSelectElement && !selectInput.closest("[data-shared-select-field]")) {
                    selectInput.addEventListener("change", () => stageOrSubmitStrategyParam(field, 80));
                }
            });
            root.querySelectorAll?.(".strategy-factor-group").forEach((group) => {
                syncStrategyFactorGroupCount(group.querySelector("[data-strategy-param-key]"));
            });
            syncStrategyParamFieldVisibility(root);
            syncStrategyTickerLabels(root);

            root.querySelectorAll('[data-strategy-allocation-limits]').forEach((limits) => {
                if (limits.dataset.bound === '1') return;
                limits.dataset.bound = '1';
                const read = (key) => limits.querySelector(`[name="${key}_pct"]`);
                const syncLimits = (source = '') => {
                    const values = Object.fromEntries(['primary_min', 'primary_max', 'leveraged_min', 'leveraged_max']
                        .map((key) => [key, Math.max(0, Math.min(100, Number(read(key).value) || 0))]));
                    values.leveraged_min = Math.min(values.leveraged_min, 100 - values.primary_min);
                    values.primary_max = Math.min(100 - values.leveraged_min, Math.max(values.primary_min, values.primary_max));
                    values.leveraged_max = Math.min(100 - values.primary_min, Math.max(values.leveraged_min, values.leveraged_max));
                    if (source.endsWith('_max')) {
                        const asset = source.split('_')[0];
                        values[`${asset}_min`] = Math.min(values[`${asset}_min`], Number(read(source).value));
                        values[source] = Math.min(Number(read(source).value), 100 - values[`${asset === 'primary' ? 'leveraged' : 'primary'}_min`]);
                    }
                    Object.entries(values).forEach(([key, value]) => { read(key).value = String(value); });
                    limits.querySelectorAll('[data-limit-range]').forEach((bar) => {
                        const asset = bar.dataset.limitRange;
                        const ticker = readBacktestTickerName(Number(bar.dataset.tickerIndex));
                        bar.querySelector('[data-limit-ticker]').textContent = ticker;
                        ['min', 'max'].forEach((boundary) => {
                            const value = values[`${asset}_${boundary}`];
                            bar.querySelector(`[data-limit-value="${boundary}"]`).textContent = `${Math.round(value)}%`;
                            read(`${asset}_${boundary}`).setAttribute('aria-label', `${ticker} ${boundary === 'min' ? 'minimum' : 'maximum'}`);
                        });
                        const labelNodes = [...bar.querySelectorAll('.strategy-limit-labels label')];
                        const width = bar.clientWidth;
                        const centers = labelNodes.map((label, index) => Math.max(label.offsetWidth / 2,
                            Math.min(width - label.offsetWidth / 2, width * values[`${asset}_${index ? 'max' : 'min'}`] / 100)));
                        const spacing = (labelNodes[0].offsetWidth + labelNodes[1].offsetWidth) / 2 + 8;
                        if (centers[1] - centers[0] < spacing) {
                            centers[1] = Math.min(width - labelNodes[1].offsetWidth / 2, centers[0] + spacing);
                            centers[0] = Math.max(labelNodes[0].offsetWidth / 2, centers[1] - spacing);
                        }
                        labelNodes.forEach((label, index) => {
                            const value = values[`${asset}_${index ? 'max' : 'min'}`];
                            label.style.left = `${centers[index]}px`;
                            label.classList.toggle('is-range-start', value === 0);
                            label.classList.toggle('is-range-end', value === 100);
                        });
                        separateAllocationHandles(bar, values[`${asset}_min`], values[`${asset}_max`]);
                    });
                };
                limits.querySelectorAll('input[type="range"]').forEach((input) => {
                    input.addEventListener('input', () => syncLimits(input.name.replace('_pct', '')));
                    input.addEventListener('change', () => scheduleStrategyParamSubmit(80));
                });
                document.querySelectorAll('[data-backtest-ticker-fields] [data-ticker-input]').forEach((input) => input.addEventListener('input', () => syncLimits()));
                new ResizeObserver(() => syncLimits()).observe(limits);
                syncLimits();
            });

            root.querySelectorAll?.("[data-strategy-allocation-range]").forEach((allocation) => {
                if (!(allocation instanceof HTMLElement) || allocation.dataset.allocationBound === "1") return;
                allocation.dataset.allocationBound = "1";
                const primaryRange = allocation.querySelector("[data-allocation-boundary='primary']");
                const investedRange = allocation.querySelector("[data-allocation-boundary='invested']");
                const primaryInput = allocation.querySelector("[name='initial_primary_pct']");
                const leveragedInput = allocation.querySelector("[name='initial_leveraged_pct']");
                if (!(primaryRange instanceof HTMLInputElement)
                    || !(investedRange instanceof HTMLInputElement)
                    || !(primaryInput instanceof HTMLInputElement)
                    || !(leveragedInput instanceof HTMLInputElement)) return;

                const formatCash = (value) => Math.max(0, value).toLocaleString("en-US", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                });
                const formatPercentage = (value) => `${value.toFixed(2)}%`;
                const readCapital = () => Number.parseFloat(
                    String(document.getElementById("trade_initial_capital")?.value || "0").replaceAll(",", ""),
                ) || 0;
                const initial = window.WORTHWARD_APP?.backtestResult?.initial_allocation || {};
                const primaryOpen = Number(initial.primary_open || 0);
                const leveragedOpen = Number(initial.leveraged_open || 0);
                const tickerInputs = Array.from(document.querySelectorAll("[data-backtest-ticker-fields] [data-ticker-input]"));
                const labels = allocation.querySelector("[data-allocation-labels]");
                const primaryLabel = allocation.querySelector("[data-allocation-primary-label]");
                const leveragedLabel = allocation.querySelector("[data-allocation-leveraged-label]");
                const cashLabel = allocation.querySelector("[data-allocation-cash-label]");

                const positionLabels = (primary, leveraged) => {
                    separateAllocationHandles(allocation, primary, primary + leveraged);
                    if (!(labels instanceof HTMLElement)
                        || !(primaryLabel instanceof HTMLElement)
                        || !(leveragedLabel instanceof HTMLElement)
                        || !(cashLabel instanceof HTMLElement)) return;
                    const nodes = [primaryLabel, leveragedLabel, cashLabel];
                    const width = labels.clientWidth;
                    if (!(width > 0)) return;
                    const gap = 6;
                    labels.classList.toggle(
                        "is-compressed",
                        nodes.reduce((sum, node) => sum + node.scrollWidth, 0) + (gap * 2) > width,
                    );
                    const halfWidths = nodes.map((node) => Math.min(node.offsetWidth, width) / 2);
                    const cash = Math.max(0, 100 - primary - leveraged);
                    const desired = [
                        primary / 2,
                        primary + (leveraged / 2),
                        primary + leveraged + (cash / 2),
                    ].map((percentage) => width * percentage / 100);
                    const centers = desired.map((center, index) => (
                        Math.max(halfWidths[index], Math.min(width - halfWidths[index], center))
                    ));
                    for (let index = 1; index < centers.length; index += 1) {
                        centers[index] = Math.max(
                            centers[index],
                            centers[index - 1] + halfWidths[index - 1] + gap + halfWidths[index],
                        );
                    }
                    centers[centers.length - 1] = Math.min(
                        centers[centers.length - 1],
                        width - halfWidths[halfWidths.length - 1],
                    );
                    for (let index = centers.length - 2; index >= 0; index -= 1) {
                        centers[index] = Math.min(
                            centers[index],
                            centers[index + 1] - halfWidths[index + 1] - gap - halfWidths[index],
                        );
                    }
                    if (centers[0] < halfWidths[0]) {
                        const shift = halfWidths[0] - centers[0];
                        centers.forEach((center, index) => {
                            centers[index] = center + shift;
                        });
                    }
                    nodes.forEach((node, index) => {
                        node.style.left = `${centers[index].toFixed(2)}px`;
                        node.dataset.allocationLabelPosition = (centers[index] / width * 100).toFixed(2);
                    });
                };

                const sync = (source = "") => {
                    let primary = Number.parseFloat(source === "primary" ? primaryRange.value : primaryInput.value) || 0;
                    let invested;
                    if (source === "primary") {
                        invested = Number.parseFloat(investedRange.value) || 0;
                        invested = Math.max(0, Math.min(100, invested));
                        primary = Math.max(0, Math.min(invested, primary));
                    } else if (source === "invested") {
                        primary = Math.max(0, Math.min(100, primary));
                        invested = Number.parseFloat(investedRange.value) || 0;
                        invested = Math.max(primary, Math.min(100, invested));
                    } else {
                        primary = Math.max(0, Math.min(100, primary));
                        invested = primary + (Number.parseFloat(leveragedInput.value) || 0);
                        invested = Math.max(primary, Math.min(100, invested));
                    }
                    const leveraged = invested - primary;
                    const cashPercentage = 100 - invested;
                    primaryRange.max = '100';
                    primaryRange.value = primary.toFixed(2);
                    investedRange.min = '0';
                    investedRange.value = invested.toFixed(2);
                    primaryInput.value = primary.toFixed(2);
                    leveragedInput.value = leveraged.toFixed(2);
                    allocation.style.setProperty("--allocation-primary", `${primary}%`);
                    allocation.style.setProperty("--allocation-leveraged", `${leveraged}%`);
                    allocation.style.setProperty("--allocation-cash", `${cashPercentage}%`);
                    const capital = readCapital();
                    const primaryShares = primaryOpen > 0 ? Math.floor(capital * primary / 100 / primaryOpen) : 0;
                    const leveragedShares = leveragedOpen > 0 ? Math.floor(capital * leveraged / 100 / leveragedOpen) : 0;
                    const cash = capital - (primaryShares * primaryOpen) - (leveragedShares * leveragedOpen);
                    allocation.dataset.allocationPrimaryShares = String(primaryShares);
                    allocation.dataset.allocationLeveragedShares = String(leveragedShares);
                    allocation.dataset.allocationCash = cash.toFixed(2);
                    allocation.querySelector("[data-allocation-primary-name]").textContent = readBacktestTickerName(0);
                    allocation.querySelector("[data-allocation-leveraged-name]").textContent = readBacktestTickerName(1);
                    allocation.querySelector("[data-allocation-primary-value]").textContent = formatPercentage(primary);
                    allocation.querySelector("[data-allocation-leveraged-value]").textContent = formatPercentage(leveraged);
                    allocation.querySelector("[data-allocation-cash-value]").textContent = formatCash(cash);
                    primaryRange.setAttribute("aria-label", `${readBacktestTickerName(0)} allocation boundary`);
                    investedRange.setAttribute("aria-label", `${readBacktestTickerName(1)} and Cash boundary`);
                    const allocationText = `${readBacktestTickerName(0)} ${formatPercentage(primary)}, ${readBacktestTickerName(1)} ${formatPercentage(leveraged)}, Cash ${formatPercentage(cashPercentage)}`;
                    primaryRange.setAttribute("aria-valuetext", allocationText);
                    investedRange.setAttribute("aria-valuetext", allocationText);
                    syncStrategyTickerLabels(allocation.closest("[data-trade-strategy-panel]") || root);
                    positionLabels(primary, leveraged);
                };
                primaryRange.addEventListener("input", () => sync("primary"));
                investedRange.addEventListener("input", () => sync("invested"));
                primaryRange.addEventListener("change", () => scheduleStrategyParamSubmit(80));
                investedRange.addEventListener("change", () => scheduleStrategyParamSubmit(80));
                tickerInputs.forEach((input) => input.addEventListener("input", () => sync()));
                document.getElementById("trade_initial_capital")?.addEventListener("input", () => sync());
                allocationLabelLayouts.set(allocation, () => positionLabels(
                    Number.parseFloat(primaryInput.value) || 0,
                    Number.parseFloat(leveragedInput.value) || 0,
                ));
                new ResizeObserver(() => allocationLabelLayouts.get(allocation)?.()).observe(allocation);
                sync();
            });
        };

        const syncTradeStrategyTuningAvailability = () => {
            const {field, select, tuneButton, panel} = getTradeStrategyRefs();
            if (!(field instanceof HTMLElement)
                || !(select instanceof HTMLSelectElement)
                || !(tuneButton instanceof HTMLButtonElement)
                || !(panel instanceof HTMLElement)) return;
            const hasFields = Boolean(panel.querySelector("[data-strategy-param-key]"));
            field.classList.remove("is-grid-trading-inline");
            panel.classList.remove("grid-trading-parameters-panel");

            tuneButton.classList.toggle("is-hidden", !hasFields);
            tuneButton.disabled = !hasFields;
            tuneButton.setAttribute("aria-hidden", hasFields ? "false" : "true");
            tuneButton.tabIndex = hasFields ? 0 : -1;
            if (!hasFields) {
                setTradeStrategyPanelOpen(false);
            }
        };

        const setTradeStrategyDropdownOpen = (isOpen) => {
            const {field, trigger, dropdown, panel} = getTradeStrategyRefs();
            if (!(dropdown instanceof HTMLElement) || !(trigger instanceof HTMLButtonElement)) return;
            const sharedParts = getSharedSelectParts(field);
            if (sharedParts) {
                setSharedSelectDropdownOpen(field, isOpen);
                if (field instanceof HTMLElement) {
                    field.classList.toggle("is-open", isOpen || (!(panel instanceof HTMLElement) ? false : !panel.hidden));
                }
                return;
            }
            dropdown.hidden = !isOpen;
            trigger.setAttribute("aria-expanded", isOpen ? "true" : "false");
            if (field instanceof HTMLElement) {
                field.classList.toggle("is-open", isOpen || (!(panel instanceof HTMLElement) ? false : !panel.hidden));
            }
            if (isOpen) {
                positionTradeStrategyDropdown();
            } else {
                trigger.removeAttribute("aria-activedescendant");
                resetSidebarDropdownPosition(dropdown);
            }
        };

        const syncTradeStrategyTriggerLabel = () => {
            const {field, select, trigger, triggerLabel} = getTradeStrategyRefs();
            if (!(select instanceof HTMLSelectElement) || !(trigger instanceof HTMLButtonElement) || !(triggerLabel instanceof HTMLElement)) return;
            if (getSharedSelectParts(field)) {
                syncSharedSelectTriggerLabel(field);
                return;
            }
            const selectedOption = Array.from(select.options).find((option) => option.value === select.value);
            const nextLabel = selectedOption?.textContent?.trim()
                || triggerLabel.dataset.fallbackLabel
                || trigger.getAttribute("title")
                || select.options[0]?.textContent?.trim()
                || "";
            triggerLabel.textContent = nextLabel;
            triggerLabel.dataset.fallbackLabel = nextLabel;
            trigger.title = nextLabel;
            const fieldLabel = field?.querySelector("label")?.textContent?.trim() || "";
            if (fieldLabel) {
                trigger.setAttribute("aria-label", `${fieldLabel}: ${nextLabel}`);
            }
        };

        const positionTradeStrategyDropdown = () => {
            const {field, trigger, dropdown} = getTradeStrategyRefs();
            if (!(dropdown instanceof HTMLElement) || dropdown.hidden || !(trigger instanceof HTMLElement)) return;
            if (getSharedSelectParts(field)) {
                positionSharedSelectDropdown(field);
                return;
            }
            const anchor = field?.querySelector(".trade-strategy-row");
            const anchorRect = anchor instanceof HTMLElement
                ? anchor.getBoundingClientRect()
                : trigger.getBoundingClientRect();
            const triggerRect = trigger.getBoundingClientRect();
            const viewportHeight = window.visualViewport?.height || window.innerHeight || 800;
            const availableHeight = Math.max(
                120,
                viewportHeight - triggerRect.bottom - SIDEBAR_OVERLAY_GAP_PX - 12,
            );
            dropdown.style.position = "fixed";
            dropdown.style.left = `${Math.round(anchorRect.left)}px`;
            dropdown.style.top = `${Math.round(triggerRect.bottom + SIDEBAR_OVERLAY_GAP_PX)}px`;
            dropdown.style.right = "auto";
            dropdown.style.bottom = "auto";
            dropdown.style.width = `${Math.round(anchorRect.width)}px`;
            dropdown.style.minWidth = `${Math.round(triggerRect.width)}px`;
            dropdown.style.maxWidth = "calc(100vw - 24px)";
            dropdown.style.maxHeight = `${Math.round(availableHeight)}px`;
            dropdown.style.zIndex = "10002";
            dropdown.style.overflowY = "auto";
            dropdown.style.overscrollBehavior = "contain";
        };

        const renderTradeStrategyDropdown = () => {
            const {select, dropdown} = getTradeStrategyRefs();
            if (!(select instanceof HTMLSelectElement) || !(dropdown instanceof HTMLElement)) return;
            const currentSelection = String(select.value || "");
            const groups = Array.from(select.querySelectorAll("optgroup"));
            let optionIndex = 0;
            dropdown.innerHTML = "";
            const lstmTraining = window.WORTHWARD_LSTM_TRAINING;
            if (typeof lstmTraining?.renderMenu === "function") {
                lstmTraining.renderMenu();
            }
            groups.forEach((group) => {
                const groupElement = document.createElement("section");
                groupElement.className = "trade-strategy-dropdown-group";

                const labelElement = document.createElement("p");
                labelElement.className = "trade-strategy-dropdown-label";
                labelElement.textContent = group.label || "";
                groupElement.appendChild(labelElement);

                Array.from(group.querySelectorAll("option")).forEach((option) => {
                    const optionButton = document.createElement("button");
                    optionButton.type = "button";
                    optionButton.disabled = option.disabled || group.disabled;
                    optionButton.className = "trade-strategy-dropdown-option";
                    optionButton.id = `${dropdown.id || "trade_strategy_dropdown"}_option_${optionIndex}`;
                    optionButton.tabIndex = -1;
                    optionIndex += 1;
                    optionButton.dataset.value = option.value;
                    optionButton.setAttribute("role", "option");
                    optionButton.setAttribute("aria-selected", option.value === currentSelection ? "true" : "false");
                    if (option.value === currentSelection) {
                        optionButton.classList.add("is-selected", "is-active");
                    }

                    const checkElement = document.createElement("span");
                    checkElement.className = "trade-strategy-dropdown-check";
                    checkElement.setAttribute("aria-hidden", "true");

                    const textElement = document.createElement("span");
                    textElement.className = "trade-strategy-dropdown-text";
                    textElement.textContent = option.textContent || option.value;

                    optionButton.appendChild(checkElement);
                    optionButton.appendChild(textElement);
                    optionButton.addEventListener("click", () => {
                        const {select: currentSelect} = getTradeStrategyRefs();
                        if (!(currentSelect instanceof HTMLSelectElement)) return;
                        if (currentSelect.value === option.value) {
                            setTradeStrategyDropdownOpen(false);
                            getTradeStrategyRefs().trigger?.focus({preventScroll: true});
                            return;
                        }
                        currentSelect.value = option.value;
                        syncStrategyOptionSelection(currentSelect, option.value);
                        syncTradeStrategyTriggerLabel();
                        renderTradeStrategyDropdown();
                        setTradeStrategyDropdownOpen(false);
                        getTradeStrategyRefs().trigger?.focus({preventScroll: true});
                        currentSelect.dispatchEvent(new Event("change", {bubbles: true}));
                    });
                    groupElement.appendChild(optionButton);
                });

                dropdown.appendChild(groupElement);
            });
        };

        const getTradeStrategyOptionButtons = () => {
            const {dropdown} = getTradeStrategyRefs();
            if (!(dropdown instanceof HTMLElement)) return [];
            return Array.from(dropdown.querySelectorAll('[role="option"]'))
                .filter((option) => option instanceof HTMLButtonElement);
        };

        const tradeStrategySelectController = window.SHARED_SELECT.createController({
            getTrigger: () => getTradeStrategyRefs().trigger,
            getMenu: () => getTradeStrategyRefs().dropdown,
            getOptions: getTradeStrategyOptionButtons,
            open: () => {
                closeSharedSelectDropdowns();
                setTradeStrategyPanelOpen(false);
                renderTradeStrategyDropdown();
                setTradeStrategyDropdownOpen(true);
            },
            close: () => setTradeStrategyDropdownOpen(false),
        });

        const handleTradeStrategyTriggerKeydown = (event) =>
            tradeStrategySelectController.triggerKeydown(event);

        const handleTradeStrategyDropdownKeydown = (event) =>
            tradeStrategySelectController.menuKeydown(event);

        const pulseStrategySwitch = () => {
            const {select, panel} = getTradeStrategyRefs();
            if (!(select instanceof HTMLSelectElement)) return;
            select.classList.remove("is-switching");
            if (panel instanceof HTMLElement) {
                panel.classList.remove("is-switching");
            }
            void select.offsetWidth;
            select.classList.add("is-switching");
            if (panel instanceof HTMLElement && !panel.hidden) {
                panel.classList.add("is-switching");
            }
            if (strategySwitchAnimationTimer) window.clearTimeout(strategySwitchAnimationTimer);
            strategySwitchAnimationTimer = window.setTimeout(() => {
                const {select: currentSelect, panel: currentPanel} = getTradeStrategyRefs();
                currentSelect?.classList.remove("is-switching", "is-pressing");
                if (currentPanel instanceof HTMLElement) {
                    currentPanel.classList.remove("is-switching");
                }
            }, 380);
        };

        const syncBacktestStrategyTickerContract = (payload = {}) => {
            if (!isBacktestView || !(form instanceof HTMLFormElement)) return;
            const configuredRequired = Number.parseInt(payload.required_tickers, 10);
            if (!Number.isFinite(configuredRequired)) return;
            const requiredTickers = Math.min(runtimeState.maxTickers, Math.max(1, configuredRequired));
            const defaultTickers = Array.isArray(payload.default_tickers)
                ? payload.default_tickers.map(sanitizeTicker).filter(Boolean).slice(0, requiredTickers)
                : [];
            const previousRequired = Number.parseInt(form.dataset.strategyRequiredTickers || "1", 10) || 1;
            const currentTickers = getFilledTickers();
            const shouldApplyStrategyDefaults = previousRequired === 1
                && currentTickers.length === 0;
            const nextTickers = shouldApplyStrategyDefaults
                ? defaultTickers.slice()
                : currentTickers.slice(0, requiredTickers);
            const usedTickers = new Set(nextTickers);
            for (const defaultTicker of defaultTickers) {
                if (nextTickers.length >= requiredTickers) break;
                if (usedTickers.has(defaultTicker)) continue;
                nextTickers.push(defaultTicker);
                usedTickers.add(defaultTicker);
            }

            form.dataset.strategyRequiredTickers = String(requiredTickers);
            state.strategyRequiredTickers = requiredTickers;
            state.strategyDefaultTickers = defaultTickers;
            state.strategySupports = payload.supports && typeof payload.supports === "object"
                ? payload.supports
                : {};

            while (getTickerFields().length > requiredTickers) {
                getTickerFields()[getTickerFields().length - 1].remove();
            }
            while (getTickerFields().length < requiredTickers) {
                addTickerField("", {focus: false});
            }
            getTickerInputs().forEach((input, index) => {
                const nextTicker = sanitizeTicker(nextTickers[index] || "");
                if (sanitizeTicker(input.value) === nextTicker) return;
                input.value = nextTicker;
                input.dataset.unknown = "";
                input.dataset.validatedTicker = "";
                input.dataset.symbol = "";
                input.dataset.logoUrl = "";
                input.dataset.companyName = "";
                setTickerValidationPending(input, false);
                syncTickerInputDecoration(input);
            });
            reindexTickerFields();
            validateAllTickerInputs();
        };

        const refreshTradeStrategyFields = async (strategyId) => {
            const {panel} = getTradeStrategyRefs();
            if (!(panel instanceof HTMLElement) || !endpoints.strategyFields || !strategyId) return;
            const requestToken = ++strategyFieldsRequestToken;
            try {
                const response = await fetch(`${endpoints.strategyFields}?strategy=${encodeURIComponent(strategyId)}`, {
                    credentials: "same-origin",
                });
                if (!response.ok) return;
                const payload = await response.json();
                if (requestToken !== strategyFieldsRequestToken) return;
                panel.innerHTML = payload.html || "";
                restoreBacktestStrategyParams(panel, strategyId, {respectExplicitUrl: false});
                panel.querySelectorAll("[data-shared-select-field]").forEach((field) => initializeSharedSelectField(field));
                syncBacktestStrategyTickerContract(payload);
                initStrategyParamControls(panel);
                window.WORTHWARD_LSTM_TRAINING?.renderMenu?.();
                syncTradeStrategyTuningAvailability();
                if (!payload.is_tunable) {
                    setTradeStrategyPanelOpen(false);
                } else {
                    setTradeStrategyPanelOpen(true);
                }
            } catch (_error) {
            }
        };

        const initializeTradeStrategyField = () => {
            const refs = getTradeStrategyRefs();
            if (!(refs.field instanceof HTMLElement)) return;
            if (refs.field.dataset.tradeStrategyBound === "1") return;
            const restoration = restoreBacktestStrategyParams(
                refs.field,
                refs.select?.value || state.selectedStrategyId,
            );
            initStrategyParamControls(refs.field);
            syncTradeStrategyTuningAvailability();
            if (refs.tuneButton instanceof HTMLButtonElement && !refs.tuneButton.disabled) {
                setTradeStrategyPanelOpen(true);
            }
            syncTradeStrategyTriggerLabel();
            renderTradeStrategyDropdown();
            if (restoration.requiresSubmit) scheduleStrategyParamSubmit(0);
            refs.field.dataset.tradeStrategyBound = "1";
            if (refs.tuneButton instanceof HTMLButtonElement) {
                refs.tuneButton.addEventListener("click", () => {
                    const {panel} = getTradeStrategyRefs();
                    setTradeStrategyDropdownOpen(false);
                    setTradeStrategyPanelOpen(panel instanceof HTMLElement ? panel.hidden : false);
                });
            }
            if (refs.trigger instanceof HTMLButtonElement) {
                refs.trigger.addEventListener("click", () => {
                    const {dropdown} = getTradeStrategyRefs();
                    const shouldOpen = dropdown instanceof HTMLElement ? dropdown.hidden : false;
                    closeSharedSelectDropdowns();
                    setTradeStrategyPanelOpen(false);
                    renderTradeStrategyDropdown();
                    setTradeStrategyDropdownOpen(shouldOpen);
                });
                refs.trigger.addEventListener("keydown", handleTradeStrategyTriggerKeydown);
            }
            if (refs.dropdown instanceof HTMLElement) {
                refs.dropdown.addEventListener("keydown", handleTradeStrategyDropdownKeydown);
            }
            if (refs.select instanceof HTMLSelectElement) {
                refs.select.addEventListener("change", async () => {
                    const {select} = getTradeStrategyRefs();
                    if (!(select instanceof HTMLSelectElement)) return;
                    rememberBacktestCollapseForStrategyChange(select.value);
                    rememberBacktestStrategyParams(state.selectedStrategyId);
                    syncStrategyOptionSelection(select, select.value);
                    syncTradeStrategyTriggerLabel();
                    renderTradeStrategyDropdown();
                    pulseStrategySwitch();
                    await refreshTradeStrategyFields(select.value);
                    await syncBacktestIntervals();
                    if (!form) return;
                    pendingBacktestStrategyNavigation = isBacktestView;
                    window.setTimeout(() => form.requestSubmit(), 72);
                });
            }
        };

        const repairSidebarControlBindings = () => {
            upgradeStandaloneSharedSelects();
            getSharedSelectFields()
                .filter((field) => String(field.dataset.sharedSelectKind || "").trim().toLowerCase() !== "strategy")
                .forEach((field) => initializeSharedSelectField(field));
            initializeTradeStrategyField();
            syncBacktestIntervalSegmentedControl();
        };


        Object.assign(context, {
            collectStrategyParamEntries,
            setTradeStrategyDropdownOpen,
            setTradeStrategyPanelOpen,
            stageOrSubmitStrategyParam,
            strategyNumericValuesMatch,
        });

        window.repairSidebarControlBindings = repairSidebarControlBindings;

        seedTickerValidationState();
        repairSidebarControlBindings();
        restoreBacktestCollapseAfterStrategyChange();

        window.addEventListener("resize", () => {
            getSharedSelectFields().forEach((field) => positionSharedSelectDropdown(field));
            positionTradeStrategyDropdown();
        });
        document.addEventListener("scroll", (event) => {
            // Scrolling a portalled menu must not remeasure and reposition the menu.
            // Reapplying its unconstrained measurement styles during the scroll event
            // resets scrollTop and makes the option list jump back to its start.
            const scrollTarget = event.target;
            if (scrollTarget instanceof Element && scrollTarget.closest("[data-shared-select-dropdown]")) {
                return;
            }
            getSharedSelectFields().forEach((field) => positionSharedSelectDropdown(field));
            positionTradeStrategyDropdown();
        }, true);
        document.addEventListener("click", (event) => {
            const {field} = getTradeStrategyRefs();
            const eventPath = typeof event.composedPath === "function" ? event.composedPath() : [];
            const clickedInsideStrategyField = field instanceof HTMLElement
                && (field.contains(event.target) || eventPath.includes(field));
            const strategyDropdown = getSharedSelectParts(field)?.dropdown;
            const clickedInsideStrategyDropdown = strategyDropdown instanceof HTMLElement
                && (strategyDropdown.contains(event.target) || eventPath.includes(strategyDropdown));
            const clickedInsideSharedField = getSharedSelectFields().some((sharedField) => {
                if (sharedField.contains(event.target) || eventPath.includes(sharedField)) return true;
                const dropdown = getSharedSelectParts(sharedField)?.dropdown;
                return dropdown instanceof HTMLElement
                    && (dropdown.contains(event.target) || eventPath.includes(dropdown));
            });
            if (!clickedInsideStrategyField && !clickedInsideStrategyDropdown) {
                setTradeStrategyDropdownOpen(false);
            }
            if (!clickedInsideSharedField) {
                closeSharedSelectDropdowns();
            }
        });
        document.addEventListener("keydown", (event) => {
            if (event.key !== "Escape") return;
            const {trigger, tuneButton, dropdown, panel} = getTradeStrategyRefs();
            const sharedField = getSharedSelectFields().find((field) => {
                if (field.contains(document.activeElement)) return true;
                const dropdown = getSharedSelectParts(field)?.dropdown;
                return dropdown instanceof HTMLElement && dropdown.contains(document.activeElement);
            });
            if (sharedField) {
                setSharedSelectDropdownOpen(sharedField, false);
                getSharedSelectParts(sharedField)?.trigger.focus({preventScroll: true});
            }
            if (dropdown instanceof HTMLElement && !dropdown.hidden) {
                setTradeStrategyDropdownOpen(false);
                trigger?.focus({preventScroll: true});
            }
            if (panel instanceof HTMLElement && !panel.hidden) {
                setTradeStrategyPanelOpen(false);
                tuneButton?.focus({preventScroll: true});
            }
        });
        if (typeof MutationObserver === "function") {
            const sidebarControlObserver = new MutationObserver(() => {
                window.requestAnimationFrame(() => {
                    repairSidebarControlBindings();
                });
            });
            sidebarControlObserver.observe(document.body, {
                childList: true,
                subtree: true,
            });
        }

        if (form) {
            form.noValidate = true;
            form.addEventListener("submit", async (event) => {
                event.preventDefault();
                if (runtimeState.isSubmittingWithOverlay) return;
                const submitToken = ++runtimeState.workspaceSubmitToken;
                const values = getFilledTickers();
                validateAllTickerInputs();
                if (values.length < getMinimumRequiredTickers()) {
                    const firstInput = getTickerInputs()[0];
                    if (firstInput) showTickerValidationTooltip(firstInput);
                    return;
                }
                if (new Set(values).size !== values.length) {
                    const invalidInput = getTickerInputs().find((input) => input.validationMessage);
                    if (invalidInput) showTickerValidationTooltip(invalidInput);
                    return;
                }
                const areTickersValid = await ensureTickerValidityBeforeSubmit();
                if (submitToken !== runtimeState.workspaceSubmitToken) return;
                if (!areTickersValid) {
                    const invalidInput = getTickerInputs().find((input) => !input.checkValidity() || input.dataset.unknown === "1");
                    if (invalidInput) showTickerValidationTooltip(invalidInput);
                    return;
                }
                if (isPortfolioView) {
                    const areWeightsValid = validatePortfolioWeightInputs();
                    if (!areWeightsValid) {
                        return;
                    }
                    if (!isPortfolioShareMode()) {
                        const totalWeight = getFilledWeightEntries().reduce((sum, entry) => sum + (Number.parseInt(entry.number.value, 10) || 0), 0);
                        if (totalWeight !== 100) {
                            return;
                        }
                    }
                }
                if (runtimeState.autoSubmitTimer) {
                    window.clearTimeout(runtimeState.autoSubmitTimer);
                    runtimeState.autoSubmitTimer = null;
                }
                bootstrap.workspaceTablePage = 1;
                const nextUrl = buildCleanWorkspaceUrl();
                const strategySelect = document.getElementById("trade_strategy");
                rememberBacktestStrategyParams(strategySelect?.value);
                const currentUrlObj = new URL(window.location.href);
                const nextUrlObj = new URL(nextUrl, window.location.origin);
                currentUrlObj.searchParams.sort();
                nextUrlObj.searchParams.sort();
                if (runtimeState.hasInitialResult && currentUrlObj.pathname === nextUrlObj.pathname && currentUrlObj.searchParams.toString() === nextUrlObj.searchParams.toString()) {
                    return;
                }
                const shouldReloadForStrategyChange = pendingBacktestStrategyNavigation;
                pendingBacktestStrategyNavigation = false;
                if (shouldReloadForStrategyChange) {
                    showWorkspaceModal({
                        title: "Preparing strategy",
                        copy: "Loading strategy inputs and calculating the first result. This may take a moment for data-intensive models.",
                        loadingSpinner: true,
                    });
                    rememberCurrentViewUrl(nextUrl);
                    window.requestAnimationFrame(() => {
                        if (
                            submitToken !== runtimeState.workspaceSubmitToken
                            || document.body.classList.contains("is-page-navigating")
                        ) return;
                        window.location.assign(nextUrl);
                    });
                    return;
                }
                let missingLocalTickers = [];
                try {
                    missingLocalTickers = await fetchMissingLocalMarketTickers(values);
                } catch (error) {
                    console.warn("Market Store Presence Error:", error);
                }
                if (submitToken !== runtimeState.workspaceSubmitToken) return;
                runtimeState.isSubmittingWithOverlay = true;
                setFormBusyState(true);
                rememberCurrentViewUrl(nextUrl);

                if (strategySelect) {
                    const strategyId = strategySelect.value;
                    if (strategyId && strategyId !== "buy-and-hold") {
                        let recent = JSON.parse(preferenceStorage.local.getItem(STRATEGY_MEMORY_KEY) || "[]");
                        recent = [strategyId, ...recent.filter((id) => id !== strategyId)].slice(0, 3);
                        preferenceStorage.local.setItem(STRATEGY_MEMORY_KEY, JSON.stringify(recent));
                        refreshStrategyDropdownUI();
                    }
                }
                if (missingLocalTickers.length) {
                    showWorkspaceModal({
                        title: "Fetching remote market data",
                        copy: `Fetching remote market data for ${missingLocalTickers.join(", ")} and saving it to Local Market Store. Results will appear as soon as loading finishes.`,
                        loadingSpinner: true,
                    });
                }
                const currentParams = new URLSearchParams(currentUrlObj.search);
                const nextParams = new URLSearchParams(nextUrlObj.search);
                if (state.currentView === "backtest" && state.selectedStrategyId !== "dca") {
                    showWorkspaceModal({
                        title: "Running Backtest",
                        copy: "Calculating strategy signals and performance metrics. This may take a moment depending on the data resolution and strategy complexity.",
                        loadingSpinner: true,
                    });
                    // Only capture refresh transition if date range (x-axis) hasn't changed:
                    // - If ticker/period/interval/exact dates change: full rebuild from scratch (original behavior)
                    // - If only strategy parameters / dividends / capital change: animate y-values keeping same x-axis with smooth transition
                    function doesRequestChangedXAxis(currentParams, nextParams) {
                        const xAxisKeys = ["ticker", "period", "range", "date", "interval", "from", "exact_start", "to", "exact_end"];
                        for (const key of xAxisKeys) {
                            const current = (currentParams.get(key) || "").toString().trim();
                            const next = (nextParams.get(key) || "").toString().trim();
                            if (current !== next) return true;
                        }
                        return false;
                    }

                    const xAxisChanged = doesRequestChangedXAxis(currentParams, nextParams);
                    if (!xAxisChanged) {
                        captureBacktestRefreshTransition();
                    } else {
                        delete bootstrap.backtestRefreshTransition;
                    }
                } else if (state.currentView === "dca" || (state.currentView === "backtest" && state.selectedStrategyId === "dca")) {
                    showWorkspaceModal({
                        title: "Running DCA simulation",
                        copy: "Calculating recurring buy dates, cumulative shares, and the if-all-in comparison curve for the selected range.",
                        loadingSpinner: true,
                    });
                    delete bootstrap.chartWorkspaceRefreshTransition;
                } else if (
                    state.currentView === "prices"
                    && !missingLocalTickers.length
                    && didCompareRequestChangeMetric(currentParams, nextParams)
                ) {
                    delete bootstrap.chartWorkspaceRefreshTransition;
                    showImmediateRangeLoadingDialog();
                } else if (
                    ["tickers", "prices"].includes(state.currentView)
                    && !missingLocalTickers.length
                    && runtimeState.pendingWorkspaceChartTransition?.view === state.currentView
                    && String(runtimeState.pendingWorkspaceChartTransition.reason || "").startsWith("ticker")
                ) {
                    showWorkspaceModal({
                        title: "Calculating comparison",
                        copy: "Rebuilding the return curve and performance summary for the selected tickers. You can close this dialog while loading continues.",
                        loadingSpinner: true,
                    });
                } else if (["tickers", "prices"].includes(state.currentView) && !missingLocalTickers.length && didCompareRequestChangeRange(currentParams, nextParams)) {
                    if (state.currentView === "prices") {
                        showImmediateRangeLoadingDialog();
                    } else {
                        showWorkspaceModal({
                            title: "Calculating comparison",
                            copy: "Rebuilding the return curve and performance summary for the selected range. You can close this dialog while loading continues.",
                            loadingSpinner: true,
                        });
                    }
                } else if (runtimeState.pendingWorkspaceChartTransition?.view === state.currentView) {
                    // Same logic: only capture line chart transition if x-axis hasn't changed
                    const didRequestChangeXAxis = state.currentView === "portfolio"
                        ? didPortfolioRequestChangeXAxis
                        : bootstrap.didCompareRequestChangeXAxis;
                    const xAxisChanged = didRequestChangeXAxis?.(currentParams, nextParams) ?? true;
                    if (!xAxisChanged) {
                        captureLineChartRefreshTransition();
                    } else {
                        delete bootstrap.chartWorkspaceRefreshTransition;
                    }
                } else {
                    delete bootstrap.chartWorkspaceRefreshTransition;
                }
                clearWorkspaceChartTransitionRequest();
                applyPendingWorkspaceMarkup();
                try {
                    const hydrated = await hydrateWorkspaceFromUrl(nextUrl);
                    if (submitToken !== runtimeState.workspaceSubmitToken) return;
                    if (hydrated === false) return;
                    runtimeState.hasInitialResult = true;
                } catch (error) {
                    if (error?.name !== "AbortError") {
                        console.error("Hydration Error: ", error);
                    }
                    if (error?.name === "AbortError") return;
                    window.requestAnimationFrame(() => {
                        if (
                            submitToken !== runtimeState.workspaceSubmitToken
                            || document.body.classList.contains("is-page-navigating")
                        ) return;
                        window.location.assign(nextUrl);
                    });
                    return;
                } finally {
                    if (submitToken === runtimeState.workspaceSubmitToken) {
                        hideWorkspaceModal();
                        runtimeState.isSubmittingWithOverlay = false;
                        setFormBusyState(false);
                    }
                }
            });
        }

        document.addEventListener("submit", (event) => {
            const formElement = event.target.closest(".settings-action-form");
            if (formElement) {
                const actionInput = formElement.querySelector('input[name="action"]');
                const submitButton = formElement.querySelector("button[type='submit']");
                submitButton?.classList.add("is-pending");
                if (actionInput?.value === "refresh") {
                    showWorkspaceModal({
                        title: "Saving daily market data to local cache",
                        copy: "We are checking this ticker for missing daily history and saving any new data on this device. Please keep this page open while the download finishes.",
                        loadingSpinner: true,
                    });
                } else if (actionInput?.value === "refresh-1m") {
                    showWorkspaceModal({
                        title: "Saving 1-minute market data to local cache",
                        copy: "We are refreshing the latest 6 months of trading days for this ticker and saving the result on this device. Please keep this page open while the download finishes.",
                        loadingSpinner: true,
                    });
                }
                return;
            }
            const calloutForm = event.target.closest(".settings-callout-form");
            if (calloutForm) {
                const actionInput = calloutForm.querySelector('input[name="action"]');
                const sectionInput = calloutForm.querySelector('input[name="section"]');
                const submitButton = calloutForm.querySelector("button[type='submit']");
                submitButton?.classList.add("is-pending");
                submitButton?.setAttribute("aria-busy", "true");
                if (actionInput?.value === "maintain") {
                    showWorkspaceModal({
                        title: "Maintaining all local market data",
                        copy: "We are checking every cached ticker for missing daily history and saving any new data on this device. Please keep this page open while the download finishes.",
                        loadingSpinner: true,
                    });
                } else if (actionInput?.value === "investment-transactions") {
                    showWorkspaceModal({
                        title: "Clearing local broker transaction record",
                        copy: "We are removing the imported local broker transaction history stored on this device. Please keep this page open while this finishes.",
                        loadingSpinner: true,
                    });
                } else if (sectionInput?.value === "clear-caches") {
                    showWorkspaceModal({
                        title: "Clearing local market data caches",
                        copy: "We are removing non-local market caches while keeping Local Market Store protected entries and ticker usage records. Please keep this page open while this finishes.",
                        loadingSpinner: true,
                    });
                }
                return;
            }
            const smtpForm = event.target.closest(".settings-stack-form");
            if (!smtpForm) return;
            const submitter = event.submitter;
            submitter?.classList.add("is-pending");
            submitter?.setAttribute("aria-busy", "true");
        });
        workspaceModalOverlayClose?.addEventListener("click", hideWorkspaceModal);
        window.addEventListener("pageshow", hideWorkspaceModal);
        window.addEventListener("pageshow", () => {
            restoreOptimisticNavigationSnapshot();
            clearWorkspacePendingState();
            document.body.classList.remove("is-workspace-switching", "is-page-navigating");
            document.documentElement.removeAttribute("data-navigation-target");
            document.documentElement.removeAttribute("aria-busy");
            document.querySelectorAll(".is-masked-during-switch").forEach((node) => {
                node.classList.remove("is-masked-during-switch");
            });
        });
        void bootstrap.hydrateSettingsNetworkStatuses?.();
        void bootstrap.hydrateSettingsLocalStoreRanges?.();

        const syncStrategyOptionSelection = (select, selectedValue) => {
            if (!(select instanceof HTMLSelectElement)) return;
            const normalizedValue = String(selectedValue || "");
            const matchingOptions = Array.from(select.options).filter((option) => option.value === normalizedValue);
            Array.from(select.options).forEach((option) => {
                const isSelected = Boolean(normalizedValue) && option.value === normalizedValue;
                option.defaultSelected = isSelected;
                option.selected = false;
                if (isSelected) {
                    option.setAttribute("selected", "selected");
                } else {
                    option.removeAttribute("selected");
                }
            });
            if (!matchingOptions.length) return;
            matchingOptions.forEach((option) => {
                option.defaultSelected = true;
                option.setAttribute("selected", "selected");
            });
            const allGroupMatch = matchingOptions.find((option) => option.parentElement?.dataset?.strategyGroup === "all");
            (allGroupMatch || matchingOptions[0]).selected = true;
            select.value = normalizedValue;
        };

        const refreshStrategyDropdownUI = () => {
            const select = document.getElementById("trade_strategy");
            if (!select) return;
            let persistedRecentIds = [];
            try {
                persistedRecentIds = JSON.parse(preferenceStorage.local.getItem(STRATEGY_MEMORY_KEY) || "[]");
            } catch (_e) {
                return;
            }
            const recentGroup = select.querySelector('optgroup[data-strategy-group="recent"]');
            if (!recentGroup) return;

            const currentSelection = select.value;
            const optionById = new Map(
                Array.from(select.options).map((option) => [option.value, option]),
            );
            const serverRecentIds = Array.from(recentGroup.querySelectorAll(":scope > option"))
                .map((option) => option.value);
            const recentIds = [...new Set([...serverRecentIds, ...persistedRecentIds])]
                .map((id) => String(id || "").trim())
                .filter(Boolean)
                .slice(0, 3);
            recentGroup.innerHTML = "";
            recentIds.forEach((id) => {
                if (id === "buy-and-hold") return;
                const reference = optionById.get(id);
                if (reference) {
                    const clone = reference.cloneNode(true);
                    recentGroup.appendChild(clone);
                }
            });

            recentGroup.hidden = recentGroup.children.length === 0;
            // Restore selection because rebuilding the Recent group can reset it.
            syncStrategyOptionSelection(select, currentSelection);
            syncTradeStrategyTriggerLabel();
            renderTradeStrategyDropdown();
        };

        window.addEventListener("resize", scheduleDockPosition);
        window.addEventListener("orientationchange", scheduleDockPosition);
        window.addEventListener("pageshow", scheduleDockPosition);
        window.addEventListener("resize", scheduleMobilePageBottomPaddingSync);
        window.addEventListener("orientationchange", scheduleMobilePageBottomPaddingSync);
        window.addEventListener("pageshow", scheduleMobilePageBottomPaddingSync);

        if (WORKSPACE_VIEWS.has(state.currentView) && typeof workspaceUrlState?.buildWorkspaceUrl === "function") {
            const canonicalWorkspaceUrl = buildCleanWorkspaceUrl();
            const currentWorkspaceUrl = `${window.location.pathname}${window.location.search}`;
            if (canonicalWorkspaceUrl !== currentWorkspaceUrl) {
                window.history.replaceState(window.history.state, "", canonicalWorkspaceUrl);
                rememberCurrentViewUrl(canonicalWorkspaceUrl);
            }
        }
        initializeWorkspaceEnhancements();
        syncTradeStrategyTriggerLabel();
        renderTradeStrategyDropdown();
        refreshStrategyDropdownUI();

        return Object.freeze({
            BACKTEST_COLLAPSE_AFTER_STRATEGY_CHANGE_KEY,
            allocationLabelLayouts,
            allocationLabelResizeFrame,
            applyDerivedStrategyParamDefault,
            collectStrategyParamEntries,
            getTradeStrategyOptionButtons,
            getTradeStrategyRefs,
            handleTradeStrategyDropdownKeydown,
            handleTradeStrategyTriggerKeydown,
            initStrategyParamControls,
            initializeTradeStrategyField,
            normalizeStrategyNumberText,
            pendingBacktestStrategyNavigation,
            positionTradeStrategyDropdown,
            positionTradeStrategyPanel,
            pulseStrategySwitch,
            readBacktestStrategyParamMemory,
            readBacktestTickerName,
            refreshStrategyDropdownUI,
            refreshTradeStrategyFields,
            rememberBacktestCollapseForStrategyChange,
            rememberBacktestStrategyParams,
            renderTradeStrategyDropdown,
            repairSidebarControlBindings,
            resolveDerivedStrategyParamDefault,
            restoreBacktestCollapseAfterStrategyChange,
            restoreBacktestStrategyParams,
            scheduleStrategyParamSubmit,
            separateAllocationHandles,
            setTradeStrategyDropdownOpen,
            setTradeStrategyPanelOpen,
            stageOrSubmitStrategyParam,
            strategyFieldsRequestToken,
            strategyNumericValuesMatch,
            strategySwitchAnimationTimer,
            syncBacktestStrategyTickerContract,
            syncStrategyFactorGroupCount,
            syncStrategyOptionSelection,
            syncStrategyTickerLabels,
            syncTradeStrategyTriggerLabel,
            syncTradeStrategyTuningAvailability,
            tradeStrategySelectController,
            writeBacktestStrategyParamMemory,
        });
    };

    window.WORTHWARD_APP_STRATEGY_CONTROLS = Object.freeze({create});
})();
