/* Code version: v1.0.0 */
(() => {
    const create = (context) => {
        const {
            $,
            $$,
            areAllFilledTickersUs,
            defaults,
            dispatchPortfolioPreviewUpdate,
            dividendReinvestField,
            exactEndInput,
            exactRangeDateGrid,
            exactSingleDateGrid,
            exactStartInput,
            exactTradingDateInput,
            extendedHoursField,
            extendedHoursInput,
            form,
            getFilledTickers,
            getPortfolioAllocationInputs,
            getPortfolioAllocationMode,
            getWeightFields,
            hidePortfolioWeightTooltips,
            includeDividendsInput,
            isPortfolioView,
            isUsTicker,
            overnightField,
            overnightInput,
            periodSelect,
            priceOnlyField,
            priceOnlyInput,
            rangeModeInputs,
            requestWorkspaceChartTransition,
            sanitizeTicker,
            state,
            validatePortfolioWeightInputs,
        } = context;
        const handlePeriodSelectionChange = (...args) => context.handlePeriodSelectionChange(...args);
        const scheduleAutoSubmit = (...args) => context.scheduleAutoSubmit(...args);
        const setTradeStrategyDropdownOpen = (...args) => context.setTradeStrategyDropdownOpen(...args);
        const setTradeStrategyPanelOpen = (...args) => context.setTradeStrategyPanelOpen(...args);
        const stageOrSubmitStrategyParam = (...args) => context.stageOrSubmitStrategyParam(...args);

        const getSharedSelectFields = () => Array.from(document.querySelectorAll("[data-shared-select-field]"))
            .filter((field) => field instanceof HTMLElement);
        let sharedSelectOwnerSequence = 0;
        const getSharedSelectOverlayHost = () => {
            let host = document.querySelector("[data-shared-select-overlay]");
            if (host instanceof HTMLElement) return host;
            if (!(document.body instanceof HTMLElement)) return null;
            host = document.createElement("div");
            host.className = "shared-select-overlay";
            host.dataset.sharedSelectOverlay = "";
            document.body.appendChild(host);
            return host;
        };
        const shouldPortalSharedSelectDropdown = (field) => (
            field instanceof HTMLElement
            && (
                Boolean(field.closest("[data-trade-strategy-panel]"))
                || String(field.dataset.sharedSelectKind || "").trim().toLowerCase() === "strategy"
                || String(field.dataset.sharedSelectKind || "").trim().toLowerCase() === "investment-import-broker"
                || String(field.dataset.sharedSelectKind || "").trim().toLowerCase() === "investment-transfer"
                || field.classList.contains("investment-import-broker-field")
            )
        );
        const getSharedSelectDropdown = (field) => {
            if (!(field instanceof HTMLElement)) return null;
            const nestedDropdown = field.querySelector("[data-shared-select-dropdown]");
            if (nestedDropdown instanceof HTMLElement) return nestedDropdown;
            const owner = String(field.dataset.sharedSelectOwner || "").trim();
            if (!owner) return null;
            return Array.from(document.querySelectorAll("[data-shared-select-dropdown]"))
                .find((dropdown) => dropdown instanceof HTMLElement && dropdown.dataset.sharedSelectOwner === owner)
                || null;
        };
        const portalSharedSelectDropdown = (field, dropdown) => {
            if (!shouldPortalSharedSelectDropdown(field) || !(dropdown instanceof HTMLElement)) return false;
            const host = getSharedSelectOverlayHost();
            if (!(host instanceof HTMLElement)) return false;
            const owner = String(field.dataset.sharedSelectOwner || "").trim()
                || `shared-select-${++sharedSelectOwnerSequence}`;
            field.dataset.sharedSelectOwner = owner;
            dropdown.dataset.sharedSelectOwner = owner;
            if (dropdown.parentElement !== host) host.appendChild(dropdown);
            return true;
        };
        const restoreSharedSelectDropdown = (field, dropdown) => {
            if (!shouldPortalSharedSelectDropdown(field)
                || (!field.closest("[data-trade-strategy-panel]")
                    && String(field.dataset.sharedSelectKind || "").trim().toLowerCase() !== "strategy"
                    && String(field.dataset.sharedSelectKind || "").trim().toLowerCase() !== "investment-transfer")
                || !(dropdown instanceof HTMLElement)) return;
            const host = dropdown.parentElement;
            if (!(host instanceof HTMLElement) || !host.matches("[data-shared-select-overlay]")) return;
            const kind = String(field.dataset.sharedSelectKind || "").trim().toLowerCase();
            const restoreParent = kind === "strategy"
                ? field.querySelector(":scope > .trade-strategy-row")
                : field;
            (restoreParent instanceof HTMLElement ? restoreParent : field).appendChild(dropdown);
            delete field.dataset.sharedSelectOwner;
            delete dropdown.dataset.sharedSelectOwner;
        };

        const isOneDayExactDateMode = () => (
            ["tickers", "prices"].includes(state.currentView)
            && (periodSelect?.value || defaults.period) === "1d"
        );

        const syncExactDateModeControls = () => {
            const rangeMode = $("input[name='range']:checked")?.value || defaults.range_mode;
            const useSingleDate = rangeMode === "exact" && isOneDayExactDateMode();
            if (exactRangeDateGrid instanceof HTMLElement) exactRangeDateGrid.hidden = useSingleDate;
            if (exactSingleDateGrid instanceof HTMLElement) exactSingleDateGrid.hidden = !useSingleDate;
            if (exactStartInput) exactStartInput.disabled = useSingleDate;
            if (exactEndInput) exactEndInput.disabled = useSingleDate;
            if (exactTradingDateInput) exactTradingDateInput.disabled = !useSingleDate;
        };

        const syncDividendModeSwitches = () => {
            if (!priceOnlyInput || !includeDividendsInput) return;
            const isPriceCompare = state.currentView === "prices";
            const isOneDayPeriod = ["tickers", "prices"].includes(state.currentView) && (periodSelect?.value || defaults.period) === "1d";
            if (priceOnlyField instanceof HTMLElement) {
                priceOnlyField.hidden = isOneDayPeriod || isPriceCompare;
            }
            priceOnlyInput.disabled = isOneDayPeriod || isPriceCompare;
            includeDividendsInput.disabled = isOneDayPeriod || isPriceCompare;
            if (isOneDayPeriod || isPriceCompare) {
                priceOnlyInput.checked = false;
                includeDividendsInput.checked = false;
                if (dividendReinvestField instanceof HTMLElement) {
                    dividendReinvestField.hidden = true;
                }
                return;
            }
            const isPriceOnly = priceOnlyInput.checked;
            if (isPriceOnly) includeDividendsInput.checked = false;
            if (dividendReinvestField instanceof HTMLElement) {
                dividendReinvestField.hidden = isPriceOnly;
            }
        };

        const syncOneDayOvernightSwitch = () => {
            if (!(overnightField instanceof HTMLElement) || !overnightInput) return;
            const isOneDayPeriod = ["tickers", "prices"].includes(state.currentView) && (periodSelect?.value || defaults.period) === "1d";
            const hasEligibleTicker = getFilledTickers().some(isUsTicker);
            const canUseOvernight = (
                overnightField.dataset.overnightSourceReady === "1"
                && isOneDayPeriod
                && hasEligibleTicker
            );
            overnightField.hidden = !canUseOvernight;
            overnightInput.disabled = !canUseOvernight;
            if (!canUseOvernight) overnightInput.checked = false;
        };

        const syncOneDayExtendedHoursSwitch = () => {
            if (!(extendedHoursField instanceof HTMLElement) || !extendedHoursInput) {
                syncOneDayOvernightSwitch();
                return;
            }
            const isOneDayPeriod = ["tickers", "prices"].includes(state.currentView) && (periodSelect?.value || defaults.period) === "1d";
            const canUseExtendedHours = isOneDayPeriod && areAllFilledTickersUs();
            extendedHoursField.hidden = !canUseExtendedHours;
            extendedHoursInput.disabled = !canUseExtendedHours;
            if (!canUseExtendedHours) extendedHoursInput.checked = false;
            syncOneDayOvernightSwitch();
        };

        const getSharedSelectParts = (field) => {
            if (!(field instanceof HTMLElement)) return null;
            const select = field.querySelector("select");
            const trigger = field.querySelector("[data-shared-select-trigger]");
            const triggerLabel = field.querySelector("[data-shared-select-trigger-label]");
            const controlledDropdownId = trigger?.getAttribute("aria-controls")?.trim() || "";
            const controlledDropdown = controlledDropdownId
                ? document.getElementById(controlledDropdownId)
                : null;
            const dropdown = controlledDropdown instanceof HTMLElement
                && controlledDropdown.matches("[data-shared-select-dropdown]")
                ? controlledDropdown
                : getSharedSelectDropdown(field);
            if (!(select instanceof HTMLSelectElement) || !(trigger instanceof HTMLButtonElement) || !(triggerLabel instanceof HTMLElement) || !(dropdown instanceof HTMLElement)) {
                return null;
            }
            const triggerLogo = trigger.querySelector("[data-shared-select-trigger-logo]");
            const triggerPlaceholder = trigger.querySelector("[data-shared-select-trigger-placeholder]");
            return {
                field,
                select,
                trigger,
                triggerLabel,
                dropdown,
                triggerLogo: triggerLogo instanceof HTMLImageElement ? triggerLogo : null,
                triggerPlaceholder: triggerPlaceholder instanceof HTMLElement ? triggerPlaceholder : null,
            };
        };

        const syncNativeSelectSelection = (select, selectedValue) => {
            if (!(select instanceof HTMLSelectElement)) return;
            const normalizedValue = String(selectedValue || "");
            Array.from(select.options).forEach((option) => {
                const isSelected = Boolean(normalizedValue) && option.value === normalizedValue;
                option.defaultSelected = isSelected;
                option.selected = isSelected;
                if (isSelected) {
                    option.setAttribute("selected", "selected");
                } else {
                    option.removeAttribute("selected");
                }
            });
            select.value = normalizedValue;
        };

        const syncSharedSelectTriggerMedia = (parts, selectedOption) => {
            if (!parts?.triggerLogo) return;
            const iconUrl = String(selectedOption?.dataset.iconUrl || "").trim();
            const iconAlt = String(selectedOption?.dataset.iconAlt || "").trim()
                || `${selectedOption?.textContent?.trim() || selectedOption?.value || "Selected"} logo`;
            if (!iconUrl) {
                if (!parts.triggerLogo.hidden) parts.triggerLogo.hidden = true;
                if (parts.triggerLogo.alt !== "") parts.triggerLogo.alt = "";
                if (parts.triggerLogo.hasAttribute("src")) parts.triggerLogo.removeAttribute("src");
                if (parts.triggerPlaceholder) {
                    if (parts.triggerPlaceholder.hidden) parts.triggerPlaceholder.hidden = false;
                }
                return;
            }
            if (parts.triggerLogo.alt !== iconAlt) parts.triggerLogo.alt = iconAlt;
            if (parts.triggerLogo.hidden) parts.triggerLogo.hidden = false;
            if (parts.triggerLogo.getAttribute("src") !== iconUrl) {
                parts.triggerLogo.src = iconUrl;
            }
            if (parts.triggerPlaceholder) {
                if (!parts.triggerPlaceholder.hidden) parts.triggerPlaceholder.hidden = true;
            }
            parts.triggerLogo.onerror = () => {
                parts.triggerLogo.hidden = true;
                parts.triggerLogo.removeAttribute("src");
                if (parts.triggerPlaceholder) {
                    parts.triggerPlaceholder.hidden = false;
                }
            };
        };

        const SIDEBAR_OVERLAY_GAP_PX = 4;
        const getSidebarOverlayMetrics = (anchorRect, minimumHeight = 120) => {
            if (!(anchorRect instanceof DOMRect)) return null;
            const sidebar = document.querySelector(".sidebar");
            if (!(sidebar instanceof HTMLElement)) return null;
            const sidebarRect = sidebar.getBoundingClientRect();
            const dock = document.querySelector(".sidebar-dock");
            const rootStyles = getComputedStyle(document.documentElement);
            const pageEdgePad = Number.parseFloat(rootStyles.getPropertyValue("--page-edge-pad")) || 10;
            const lowerBoundary = dock instanceof HTMLElement
                ? Math.min(sidebarRect.bottom, dock.getBoundingClientRect().top) - pageEdgePad
                : sidebarRect.bottom - pageEdgePad;
            const availableHeight = Math.max(minimumHeight, lowerBoundary - anchorRect.bottom - SIDEBAR_OVERLAY_GAP_PX);
            return {availableHeight};
        };

        const resetSidebarDropdownPosition = (dropdown) => {
            if (!(dropdown instanceof HTMLElement)) return;
            dropdown.style.position = "";
            dropdown.style.left = "";
            dropdown.style.top = "";
            dropdown.style.bottom = "";
            dropdown.style.right = "";
            dropdown.style.width = "";
            dropdown.style.minWidth = "";
            dropdown.style.maxWidth = "";
            dropdown.style.maxHeight = "";
            dropdown.style.height = "";
            dropdown.style.zIndex = "";
            dropdown.style.overflowY = "";
            dropdown.style.maxWidth = "";
            dropdown.style.overscrollBehavior = "";
        };

        const positionSidebarDropdownFromTrigger = (trigger, dropdown, container) => {
            if (!(trigger instanceof HTMLElement) || !(dropdown instanceof HTMLElement) || !(container instanceof HTMLElement)) return;
            const triggerRect = trigger.getBoundingClientRect();
            const containerRect = container.getBoundingClientRect();
            const overlayMetrics = getSidebarOverlayMetrics(triggerRect);
            const left = Math.max(0, triggerRect.left - containerRect.left);
            const top = Math.max(0, triggerRect.bottom - containerRect.top + SIDEBAR_OVERLAY_GAP_PX);
            const width = Math.max(0, triggerRect.width);
            dropdown.style.left = `${Math.round(left)}px`;
            dropdown.style.top = `${Math.round(top)}px`;
            dropdown.style.right = "auto";
            dropdown.style.width = `${width}px`;
            dropdown.style.maxHeight = overlayMetrics ? `${Math.round(overlayMetrics.availableHeight)}px` : "";
        };

        const positionSharedSelectDropdown = (field) => {
            const parts = getSharedSelectParts(field);
            if (!parts || parts.dropdown.hidden) return;
            const dropdown = parts.dropdown;
            const trigger = parts.trigger;
            const triggerRect = trigger.getBoundingClientRect();
            // Constrained menus must not inherit the form's transformed and clipped context.
            const isInsideImportForm = !!trigger.closest('#transaction_form_container')
                || parts.field.classList.contains('investment-import-broker-field')
                || parts.field.dataset.sharedSelectKind === 'investment-import-broker';
            const isInsideStrategyPanel = Boolean(trigger.closest("[data-trade-strategy-panel]"));
            const isTradeStrategyField = String(parts.field.dataset.sharedSelectKind || "").trim().toLowerCase() === "strategy";
            const isInvestmentTransfer = String(parts.field.dataset.sharedSelectKind || "").trim().toLowerCase() === "investment-transfer";
            if (isInsideImportForm || isInsideStrategyPanel || isTradeStrategyField || isInvestmentTransfer) {
                // Portal constrained menus above clipped form containers before positioning them.
                portalSharedSelectDropdown(field, dropdown);
                const dropdownGap = 4;
                const viewport = window.visualViewport;
                const viewportLeft = Number(viewport?.offsetLeft) || 0;
                const viewportTop = Number(viewport?.offsetTop) || 0;
                const viewportWidth = Number(viewport?.width) || window.innerWidth || 0;
                const viewportHeight = Number(viewport?.height) || window.innerHeight || 0;
                const viewportRight = viewportLeft + viewportWidth;
                const viewportBottom = viewportTop + viewportHeight;
                const viewportEdge = 12;
                const maxWidth = Math.max(0, Math.min(420, viewportWidth - (viewportEdge * 2)));
                const triggerWidth = Math.max(0, triggerRect.width);
                const availableWidth = Math.max(0, viewportRight - viewportEdge - Math.max(viewportLeft + viewportEdge, triggerRect.left));
                const menuWidth = Math.min(
                    maxWidth,
                    Math.max(triggerWidth, availableWidth),
                );

                dropdown.style.position = 'fixed';
                dropdown.style.left = `${Math.round(Math.min(
                    Math.max(viewportLeft + viewportEdge, triggerRect.left),
                    viewportRight - viewportEdge - menuWidth,
                ))}px`;
                dropdown.style.top = `${Math.round(triggerRect.bottom + dropdownGap)}px`;
                dropdown.style.bottom = 'auto';
                dropdown.style.right = 'auto';
                dropdown.style.width = 'max-content';
                dropdown.style.minWidth = `${Math.round(Math.min(triggerWidth, menuWidth))}px`;
                dropdown.style.maxWidth = `${Math.round(maxWidth)}px`;
                dropdown.style.maxHeight = 'none';
                dropdown.style.height = 'auto';

                const measuredWidth = isTradeStrategyField
                    ? triggerWidth
                    : Math.max(triggerWidth, dropdown.getBoundingClientRect().width);
                const boundedWidth = Math.min(maxWidth, measuredWidth);
                const boundedLeft = Math.min(
                    Math.max(viewportLeft + viewportEdge, triggerRect.left),
                    viewportRight - viewportEdge - boundedWidth,
                );
                dropdown.style.width = `${Math.round(boundedWidth)}px`;
                dropdown.style.left = `${Math.round(boundedLeft)}px`;

                const naturalHeight = Math.max(dropdown.scrollHeight, dropdown.getBoundingClientRect().height);
                const spaceBelow = Math.max(0, viewportBottom - viewportEdge - triggerRect.bottom - dropdownGap);
                const spaceAbove = Math.max(0, triggerRect.top - viewportTop - viewportEdge - dropdownGap);
                const opensAbove = naturalHeight > spaceBelow && spaceAbove > spaceBelow;
                const availableHeight = Math.max(0, Math.min(380, opensAbove ? spaceAbove : spaceBelow));
                const visibleHeight = Math.min(naturalHeight, availableHeight);
                const top = opensAbove
                    ? Math.max(viewportTop + viewportEdge, triggerRect.top - dropdownGap - visibleHeight)
                    : Math.min(viewportBottom - viewportEdge - visibleHeight, triggerRect.bottom + dropdownGap);

                dropdown.style.top = `${Math.round(top)}px`;
                dropdown.style.maxHeight = `${Math.round(availableHeight)}px`;
                dropdown.style.zIndex = '10002';

                dropdown.style.overflowY = 'auto';
                dropdown.style.overscrollBehavior = 'contain';
                return;
            }
            const container = dropdown.parentElement;
            positionSidebarDropdownFromTrigger(trigger, dropdown, container instanceof HTMLElement ? container : field);
        };

        const setSharedSelectDropdownOpen = (field, isOpen) => {
            const parts = getSharedSelectParts(field);
            if (!parts) return;
            parts.dropdown.hidden = !isOpen;
            parts.trigger.setAttribute("aria-expanded", isOpen ? "true" : "false");
            parts.field.classList.toggle("is-open", isOpen);
            if (isOpen) {
                positionSharedSelectDropdown(field);
            } else {
                parts.trigger.removeAttribute("aria-activedescendant");
                resetSidebarDropdownPosition(parts.dropdown);
                restoreSharedSelectDropdown(field, parts.dropdown);
            }
        };

        const closeSharedSelectDropdowns = (exceptField = null) => {
            getSharedSelectFields().forEach((field) => {
                if (exceptField && field === exceptField) return;
                setSharedSelectDropdownOpen(field, false);
            });
        };

        const syncSharedSelectTriggerLabel = (field) => {
            const parts = getSharedSelectParts(field);
            if (!parts) return;
            const selectedOption = Array.from(parts.select.options).find((option) => option.value === parts.select.value);
            const nextLabel = selectedOption?.textContent?.trim()
                || parts.triggerLabel.dataset.fallbackLabel
                || parts.trigger.getAttribute("title")
                || parts.trigger.textContent?.trim()
                || parts.select.options[0]?.textContent?.trim()
                || "";
            if (parts.triggerLabel.textContent !== nextLabel) parts.triggerLabel.textContent = nextLabel;
            if (parts.triggerLabel.dataset.fallbackLabel !== nextLabel) {
                parts.triggerLabel.dataset.fallbackLabel = nextLabel;
            }
            const configuredTitle = String(parts.trigger.dataset.sharedSelectTitle || "").trim();
            const nextTitle = configuredTitle || nextLabel;
            if (parts.trigger.title !== nextTitle) parts.trigger.title = nextTitle;
            const strategyParam = field.closest("[data-strategy-param-key]");
            const fieldLabel = strategyParam?.querySelector(":scope > .trade-strategy-param-label .trade-strategy-param-label-trigger > span:first-child")?.textContent?.trim()
                || field.closest(".field")?.querySelector(":scope > label")?.textContent?.trim()
                || "";
            if (fieldLabel) {
                const nextAriaLabel = `${fieldLabel}: ${nextLabel}`;
                if (parts.trigger.getAttribute("aria-label") !== nextAriaLabel) {
                    parts.trigger.setAttribute("aria-label", nextAriaLabel);
                }
            }
            const nextEmptyState = nextLabel ? "0" : "1";
            if (parts.trigger.dataset.empty !== nextEmptyState) {
                parts.trigger.dataset.empty = nextEmptyState;
            }
            parts.field.classList.add("backtest-shared-select-field");
            syncSharedSelectTriggerMedia(parts, selectedOption);
        };

        const renderSharedSelectDropdown = (field) => {
            const parts = getSharedSelectParts(field);
            if (!parts) return;
            const currentSelection = String(parts.select.value || "");
            parts.dropdown.innerHTML = "";
            Array.from(parts.select.options).forEach((option, optionIndex) => {
                const optionButton = document.createElement("button");
                optionButton.type = "button";
                optionButton.disabled = option.disabled || option.parentElement?.disabled === true;
                optionButton.className = "trade-strategy-dropdown-option";
                optionButton.id = `${parts.dropdown.id || parts.select.id || "shared_select"}_option_${optionIndex}`;
                optionButton.tabIndex = -1;
                optionButton.dataset.value = option.value;
                optionButton.setAttribute("role", "option");
                optionButton.setAttribute("aria-selected", option.value === currentSelection ? "true" : "false");
                if (option.value === currentSelection) {
                    optionButton.classList.add("is-selected", "is-active");
                }

                const checkElement = document.createElement("span");
                checkElement.className = "trade-strategy-dropdown-check";
                checkElement.setAttribute("aria-hidden", "true");

                const iconUrl = String(option.dataset.iconUrl || "").trim();
                if (iconUrl) {
                    optionButton.classList.add("is-with-icon");
                }

                const descriptionText = option.dataset.description?.trim() || "";
                const optionLabel = option.textContent || option.value;

                optionButton.appendChild(checkElement);
                if (iconUrl) {
                    const mediaSlot = document.createElement("span");
                    mediaSlot.className = "trade-strategy-dropdown-media-slot";
                    mediaSlot.setAttribute("aria-hidden", "true");

                    const mediaPlaceholder = document.createElement("span");
                    mediaPlaceholder.className = "trade-strategy-dropdown-media-placeholder";

                    const mediaElement = document.createElement("img");
                    mediaElement.className = "trade-strategy-dropdown-media";
                    mediaElement.alt = String(option.dataset.iconAlt || "").trim()
                        || `${option.textContent?.trim() || option.value} logo`;
                    mediaElement.loading = "eager";
                    mediaElement.decoding = "async";
                    mediaElement.hidden = true;
                    mediaElement.addEventListener("load", () => {
                        mediaElement.hidden = false;
                        mediaPlaceholder.hidden = true;
                    });
                    mediaElement.addEventListener("error", () => {
                        mediaElement.hidden = true;
                        mediaElement.removeAttribute("src");
                        mediaPlaceholder.hidden = false;
                    });
                    mediaElement.src = iconUrl;
                    if (mediaElement.complete && mediaElement.naturalWidth > 0 && mediaElement.naturalHeight > 0) {
                        mediaElement.hidden = false;
                        mediaPlaceholder.hidden = true;
                    }

                    mediaSlot.appendChild(mediaPlaceholder);
                    mediaSlot.appendChild(mediaElement);
                    optionButton.appendChild(mediaSlot);
                }

                if (descriptionText) {
                    const copyElement = document.createElement("span");
                    copyElement.className = "trade-strategy-dropdown-copy";

                    const titleElement = document.createElement("span");
                    titleElement.className = "trade-strategy-dropdown-title";
                    titleElement.textContent = optionLabel;
                    copyElement.appendChild(titleElement);

                    const descriptionElement = document.createElement("span");
                    descriptionElement.className = "trade-strategy-dropdown-desc";
                    descriptionElement.textContent = descriptionText;
                    copyElement.appendChild(descriptionElement);
                    optionButton.appendChild(copyElement);
                } else {
                    const textElement = document.createElement("span");
                    textElement.className = "trade-strategy-dropdown-text";
                    textElement.textContent = optionLabel;
                    optionButton.appendChild(textElement);
                }
                optionButton.addEventListener("click", () => {
                    if (parts.select.value === option.value) {
                        setSharedSelectDropdownOpen(field, false);
                        parts.trigger.focus({preventScroll: true});
                        return;
                    }
                    syncNativeSelectSelection(parts.select, option.value);
                    syncSharedSelectTriggerLabel(field);
                    renderSharedSelectDropdown(field);
                    setSharedSelectDropdownOpen(field, false);
                    parts.trigger.focus({preventScroll: true});
                    parts.select.dispatchEvent(new Event("change", {bubbles: true}));

                    // Extra safety for the investment import broker dropdown (uses fixed positioning in constrained form).
                    // Ensures the field groups (e.g. Schwab CSV using the reusable div) switch immediately.
                    if (field.classList.contains('investment-import-broker-field') &&
                        typeof window.__forceSyncInvestmentImportMode === 'function') {
                        window.__forceSyncInvestmentImportMode();
                    }
                });
                parts.dropdown.appendChild(optionButton);
            });
        };

        const getSharedSelectOptionButtons = (field) => {
            const parts = getSharedSelectParts(field);
            if (!parts) return [];
            return Array.from(parts.dropdown.querySelectorAll('[role="option"]'))
                .filter((option) => option instanceof HTMLButtonElement);
        };

        const sharedSelectControllers = new WeakMap();
        const getSharedSelectController = (field) => {
            if (!sharedSelectControllers.has(field)) {
                sharedSelectControllers.set(field, window.SHARED_SELECT.createController({
                    getTrigger: () => getSharedSelectParts(field)?.trigger,
                    getMenu: () => getSharedSelectParts(field)?.dropdown,
                    getOptions: () => getSharedSelectOptionButtons(field),
                    open: () => {
                        closeSharedSelectDropdowns(field);
                        setTradeStrategyDropdownOpen(false);
                        if (!field.closest("[data-trade-strategy-panel]")) setTradeStrategyPanelOpen(false);
                        renderSharedSelectDropdown(field);
                        setSharedSelectDropdownOpen(field, true);
                    },
                    close: () => setSharedSelectDropdownOpen(field, false),
                }));
            }
            return sharedSelectControllers.get(field);
        };

        const handleSharedSelectTriggerKeydown = (field, event) =>
            getSharedSelectController(field).triggerKeydown(event);

        const handleSharedSelectDropdownKeydown = (field, event) =>
            getSharedSelectController(field).menuKeydown(event);

        const brokerAlphabeticalCollator = new Intl.Collator("en-US", {sensitivity: "base", numeric: true});

        const isBrokerSharedSelectKind = (field) => {
            if (!(field instanceof HTMLElement)) return false;
            const kind = String(field.dataset.sharedSelectKind || "").trim().toLowerCase();
            return kind === "settings-broker"
                || kind === "live-trading-broker"
                || kind === "investment-import-broker";
        };

        const getBrokerOptionSortKey = (option) => {
            if (!(option instanceof HTMLOptionElement)) return "";
            const explicitKey = String(option.dataset.sortKey || "").trim().toLowerCase();
            if (explicitKey) return explicitKey;
            return String(option.textContent || option.value || "").trim().toLowerCase();
        };

        const compareBrokerOptionSortKeys = (leftKey, rightKey) => brokerAlphabeticalCollator.compare(leftKey, rightKey);

        const sortBrokerSelectOptions = (select) => {
            if (!(select instanceof HTMLSelectElement)) return;
            const selectedValue = String(select.value || "");
            const options = Array.from(select.options);
            options.sort((left, right) => {
                const bySortKey = compareBrokerOptionSortKeys(
                    getBrokerOptionSortKey(left),
                    getBrokerOptionSortKey(right),
                );
                if (bySortKey !== 0) return bySortKey;
                return compareBrokerOptionSortKeys(
                    String(left.value || "").trim().toLowerCase(),
                    String(right.value || "").trim().toLowerCase(),
                );
            });
            const fragment = document.createDocumentFragment();
            options.forEach((option) => fragment.appendChild(option));
            select.replaceChildren(fragment);
            if (selectedValue && Array.from(select.options).some((option) => option.value === selectedValue)) {
                select.value = selectedValue;
            }
        };

        const refreshSharedSelectField = (field) => {
            syncSharedSelectTriggerLabel(field);
        };

        const syncStrategyParamFieldVisibility = (root = document) => {
            const fields = Array.from(root.querySelectorAll?.("[data-strategy-param-key]") || [])
                .filter((field) => field instanceof HTMLElement);
            fields.forEach((field) => {
                const controllerKey = String(field.dataset.strategyParamVisibleWhenKey || "").trim();
                if (!controllerKey) return;
                const controllerField = fields.find(
                    (candidate) => candidate.dataset.strategyParamKey === controllerKey,
                );
                const controller = controllerField?.querySelector("[data-strategy-param-input]");
                const expectedValue = String(field.dataset.strategyParamVisibleWhenValue || "");
                const shouldShow = String(controller?.value ?? "") === expectedValue;
                if (!shouldShow) {
                    const sharedSelectField = field.querySelector("[data-shared-select-field]");
                    if (sharedSelectField instanceof HTMLElement) {
                        setSharedSelectDropdownOpen(sharedSelectField, false);
                    }
                }
                field.hidden = !shouldShow;
                if (shouldShow) {
                    field.removeAttribute("aria-hidden");
                } else {
                    field.setAttribute("aria-hidden", "true");
                }
            });
        };

        const initializeSharedSelectField = (field) => {
            const parts = getSharedSelectParts(field);
            if (parts && isBrokerSharedSelectKind(parts.field)) {
                sortBrokerSelectOptions(parts.select);
            }
            const shouldStartOpen = Boolean(parts)
                && (!parts.dropdown.hidden || parts.field.classList.contains("is-open"))
                && parts.trigger.getAttribute("aria-expanded") === "true";
            refreshSharedSelectField(field);
            if (!parts || parts.field.dataset.sharedSelectJsBound === "1") return;
            parts.field.dataset.sharedSelectJsBound = "1";
            parts.trigger.addEventListener("click", () => {
                const shouldOpen = parts.dropdown.hidden;
                closeSharedSelectDropdowns(field);
                setTradeStrategyDropdownOpen(false);
                if (!field.closest("[data-trade-strategy-panel]")) {
                    setTradeStrategyPanelOpen(false);
                }
                renderSharedSelectDropdown(field);
                setSharedSelectDropdownOpen(field, shouldOpen);
            });
            parts.trigger.addEventListener("keydown", (event) => {
                handleSharedSelectTriggerKeydown(field, event);
            });
            parts.dropdown.addEventListener("keydown", (event) => {
                handleSharedSelectDropdownKeydown(field, event);
            });
            parts.select.addEventListener("change", () => {
                syncNativeSelectSelection(parts.select, parts.select.value);
                refreshSharedSelectField(field);
                if (parts.field.dataset.sharedSelectKind === "strategy-param") {
                    const strategyPanel = parts.field.closest("[data-trade-strategy-panel]");
                    syncStrategyParamFieldVisibility(strategyPanel || document);
                    stageOrSubmitStrategyParam(parts.field.closest("[data-strategy-param-key]"), 80);
                }
            });
            if (parts.select.id === "period" && parts.select.dataset.periodChangeJsBound !== "1") {
                parts.select.dataset.periodChangeJsBound = "1";
                parts.select.addEventListener("change", handlePeriodSelectionChange);
            }
            if (shouldStartOpen) {
                renderSharedSelectDropdown(field);
                setSharedSelectDropdownOpen(field, true);
            }
        };

        const upgradeStandaloneSharedSelects = () => {
            const standaloneSelects = Array.from(document.querySelectorAll(
                "select.trade-strategy-select.form-select:not(.backtest-shared-select-native)"
            )).filter((select) => (
                select instanceof HTMLSelectElement
                && !select.closest("[data-shared-select-field]")
                && select.dataset.sharedSelectStandaloneReady !== "1"
            ));

            standaloneSelects.forEach((select) => {
                const host = select.parentElement;
                if (!(host instanceof HTMLElement)) return;

                const selectId = String(select.id || "").trim();
                const generatedId = selectId || `investment_transfer_select_${++sharedSelectOwnerSequence}`;
                const selectedOption = Array.from(select.options).find((option) => option.value === select.value);
                const selectedLabel = selectedOption?.textContent?.trim() || select.value || "";
                const field = document.createElement("div");
                field.className = "trade-strategy-row backtest-shared-select-row backtest-shared-select-field investment-transfer-link-shared-select-field";
                field.dataset.sharedSelectField = "";
                field.dataset.sharedSelectKind = "investment-transfer";

                const combobox = document.createElement("div");
                combobox.className = "trade-strategy-combobox backtest-shared-select-combobox";

                const trigger = document.createElement("button");
                trigger.type = "button";
                trigger.className = "trade-strategy-select form-select trade-strategy-trigger backtest-shared-select-trigger investment-transfer-link-select";
                trigger.dataset.sharedSelectTrigger = "";
                trigger.setAttribute("aria-haspopup", "listbox");
                trigger.setAttribute("aria-expanded", "false");
                trigger.setAttribute("aria-controls", `${generatedId}_dropdown`);
                trigger.setAttribute("aria-label", select.getAttribute("aria-label") || selectedLabel);
                trigger.title = selectedLabel;

                const triggerLabel = document.createElement("span");
                triggerLabel.className = "trade-strategy-trigger-label";
                triggerLabel.dataset.sharedSelectTriggerLabel = "";
                triggerLabel.dataset.fallbackLabel = selectedLabel;
                triggerLabel.textContent = selectedLabel;
                trigger.appendChild(triggerLabel);
                combobox.appendChild(trigger);

                const dropdown = document.createElement("div");
                dropdown.id = `${generatedId}_dropdown`;
                dropdown.className = "trade-strategy-dropdown backtest-shared-select-dropdown investment-transfer-link-dropdown";
                dropdown.dataset.sharedSelectDropdown = "";
                dropdown.setAttribute("role", "listbox");
                dropdown.setAttribute("aria-label", select.getAttribute("aria-label") || "Select an option");
                dropdown.hidden = true;

                select.classList.add("trade-strategy-native-select", "backtest-shared-select-native");
                select.hidden = false;
                select.setAttribute("aria-hidden", "true");
                select.tabIndex = -1;
                select.dataset.sharedSelectStandaloneReady = "1";

                host.replaceChild(field, select);
                field.appendChild(select);
                field.appendChild(combobox);
                field.appendChild(dropdown);
            });
        };

        const getBacktestIntervalShell = () => document.querySelector("[data-backtest-interval-shell]");
        const getBacktestIntervalInputs = () => Array.from(document.querySelectorAll("[data-backtest-interval-input]"))
            .filter((input) => input instanceof HTMLInputElement);
        const strategyDeclaresBacktestInterval = (interval) => {
            const input = getBacktestIntervalInputs().find((candidate) => candidate.value === interval);
            if (!(input instanceof HTMLInputElement)) return false;
            const declaredIntervals = Array.isArray(state.strategySupports?.execution_intervals)
                ? state.strategySupports.execution_intervals
                : [];
            return declaredIntervals.includes(interval);
        };
        const getDcaFrequencyShell = () => document.querySelector("[data-dca-frequency-shell]");
        const getDcaFrequencyInputs = () => Array.from(document.querySelectorAll("[data-dca-frequency-input]"))
            .filter((input) => input instanceof HTMLInputElement);
        const getSelectedDcaFrequency = () => {
            const selectedInput = getDcaFrequencyInputs().find((input) => input.checked && !input.disabled);
            return selectedInput?.value === "weekly" ? "weekly" : "monthly";
        };
        const getVisibleSegmentedOptions = (shell) => Array.from(shell.querySelectorAll(".segmented-control-option, .range-mode-option"))
            .filter((option) => option instanceof HTMLElement)
            .filter((option) => !option.hidden);
        const readSegmentedPixelValue = (styles, propertyName, fallback = 0) => {
            const parsedValue = Number.parseFloat(styles.getPropertyValue(propertyName));
            return Number.isFinite(parsedValue) ? parsedValue : fallback;
        };
        const getSegmentedOverflowFrame = (shell) => {
            if (!(shell instanceof HTMLElement) || shell.dataset.segmentedOverflowMode !== "peek") return null;
            const frame = shell.closest("[data-segmented-overflow-frame]");
            return frame instanceof HTMLElement ? frame : null;
        };
        const syncSegmentedOverflowState = (frame) => {
            if (!(frame instanceof HTMLElement)) return;
            const maxScrollLeft = Math.max(0, frame.scrollWidth - frame.clientWidth);
            const isOverflowing = maxScrollLeft > 1;
            frame.dataset.segmentedOverflow = isOverflowing ? "1" : "0";
            frame.dataset.overflowStart = isOverflowing && frame.scrollLeft > 1 ? "1" : "0";
            frame.dataset.overflowEnd = isOverflowing && frame.scrollLeft < maxScrollLeft - 1 ? "1" : "0";
        };
        const bindSegmentedOverflowFrame = (frame) => {
            if (!(frame instanceof HTMLElement) || frame.dataset.segmentedScrollBound === "1") return;
            frame.dataset.segmentedScrollBound = "1";
            let scrollFrame = 0;
            frame.addEventListener("scroll", () => {
                if (scrollFrame) window.cancelAnimationFrame(scrollFrame);
                scrollFrame = window.requestAnimationFrame(() => {
                    scrollFrame = 0;
                    syncSegmentedOverflowState(frame);
                });
            }, {passive: true});
        };
        const syncSegmentedOverflowLayout = (shell, options) => {
            const frame = getSegmentedOverflowFrame(shell);
            if (!(frame instanceof HTMLElement)) return null;
            bindSegmentedOverflowFrame(frame);
            const shellStyles = window.getComputedStyle(shell);
            const frameStyles = window.getComputedStyle(frame);
            const optionCount = Math.max(options.length, 1);
            const frameWidth = Math.max(1, Math.floor(frame.getBoundingClientRect().width));
            const paddingLeft = Number.parseFloat(shellStyles.paddingLeft) || 0;
            const paddingRight = Number.parseFloat(shellStyles.paddingRight) || 0;
            const columnGap = Number.parseFloat(shellStyles.columnGap)
                || readSegmentedPixelValue(shellStyles, "--mode-switch-gap", 0);
            const minimumOptionWidth = Math.max(
                1,
                readSegmentedPixelValue(frameStyles, "--segmented-overflow-option-min-width", 92),
            );
            const peekWidth = Math.max(
                0,
                Math.min(
                    frameWidth / 3,
                    readSegmentedPixelValue(frameStyles, "--segmented-overflow-peek-size", 36),
                ),
            );
            const minimumTrackWidth = paddingLeft
                + paddingRight
                + (minimumOptionWidth * optionCount)
                + (columnGap * Math.max(0, optionCount - 1));
            const shouldOverflow = minimumTrackWidth > frameWidth + 1;
            shell.dataset.segmentedOverflow = shouldOverflow ? "1" : "0";
            frame.dataset.segmentedOverflow = shouldOverflow ? "1" : "0";
            if (!shouldOverflow) {
                shell.style.removeProperty("--segmented-option-width");
                shell.style.removeProperty("--segmented-track-width");
                shell.style.removeProperty("--segmented-visible-count");
                frame.style.removeProperty("--segmented-visible-count");
                frame.dataset.segmentedVisibleCount = String(optionCount);
                shell.style.removeProperty("width");
                shell.style.removeProperty("grid-template-columns");
                frame.scrollLeft = 0;
                syncSegmentedOverflowState(frame);
                return {frame, overflow: false, visibleCount: optionCount};
            }

            const visibleCount = Math.max(
                1,
                Math.min(
                    optionCount - 1,
                    Math.floor((frameWidth - paddingLeft - peekWidth + columnGap) / (minimumOptionWidth + columnGap)),
                ),
            );
            const visibleOptionsWidth = Math.max(
                minimumOptionWidth * visibleCount,
                frameWidth - paddingLeft - peekWidth - (columnGap * visibleCount),
            );
            const optionWidth = Math.max(minimumOptionWidth, visibleOptionsWidth / visibleCount);
            const trackWidth = paddingLeft
                + paddingRight
                + (optionWidth * optionCount)
                + (columnGap * Math.max(0, optionCount - 1));
            shell.style.setProperty("--segmented-option-width", `${optionWidth}px`);
            shell.style.setProperty("--segmented-track-width", `${trackWidth}px`);
            shell.style.setProperty("--segmented-visible-count", String(visibleCount));
            frame.style.setProperty("--segmented-visible-count", String(visibleCount));
            frame.dataset.segmentedVisibleCount = String(visibleCount);
            window.requestAnimationFrame(() => syncSegmentedOverflowState(frame));
            return {frame, overflow: true, visibleCount};
        };
        const keepSegmentedOptionVisible = (shell, option) => {
            const frame = getSegmentedOverflowFrame(shell);
            if (!(frame instanceof HTMLElement) || !(option instanceof HTMLElement)) return;
            const maxScrollLeft = Math.max(0, frame.scrollWidth - frame.clientWidth);
            if (maxScrollLeft <= 1) {
                frame.scrollLeft = 0;
                syncSegmentedOverflowState(frame);
                return;
            }
            const options = getVisibleSegmentedOptions(shell);
            const optionIndex = options.indexOf(option);
            const frameStyles = window.getComputedStyle(frame);
            const fadeWidth = readSegmentedPixelValue(frameStyles, "--segmented-overflow-fade-size", 0);
            const peekWidth = readSegmentedPixelValue(frameStyles, "--segmented-overflow-peek-size", 0);
            const optionLeft = option.offsetLeft;
            const optionRight = optionLeft + option.offsetWidth;
            const leftSafety = optionIndex > 0 ? fadeWidth : 0;
            const rightSafety = optionIndex >= 0 && optionIndex < options.length - 1 ? peekWidth : 0;
            let nextScrollLeft = frame.scrollLeft;
            if (optionIndex === 0) {
                nextScrollLeft = 0;
            } else if (optionIndex === options.length - 1) {
                nextScrollLeft = maxScrollLeft;
            } else if (optionLeft < frame.scrollLeft + leftSafety) {
                nextScrollLeft = optionLeft - leftSafety;
            } else if (optionRight > frame.scrollLeft + frame.clientWidth - rightSafety) {
                nextScrollLeft = optionRight - frame.clientWidth + rightSafety;
            }
            frame.scrollLeft = Math.min(maxScrollLeft, Math.max(0, nextScrollLeft));
            window.requestAnimationFrame(() => syncSegmentedOverflowState(frame));
        };
        const syncSegmentedControlLayout = (shell, {
            activeValue = "",
            activeIndex = -1,
            options = null,
        } = {}) => {
            if (!(shell instanceof HTMLElement)) return;
            const resolvedOptions = Array.isArray(options) ? options : getVisibleSegmentedOptions(shell);
            const optionCount = Math.max(resolvedOptions.length, 1);
            let resolvedActiveIndex = activeIndex;
            if (resolvedActiveIndex < 0) {
                resolvedActiveIndex = resolvedOptions.findIndex((option) => {
                    const input = option.querySelector("input");
                    return (input instanceof HTMLInputElement && input.checked)
                        || option.getAttribute("aria-selected") === "true";
                });
            }
            resolvedActiveIndex = Math.max(0, Math.min(optionCount - 1, resolvedActiveIndex));
            if (activeValue) shell.dataset.active = activeValue;
            shell.dataset.optionCount = String(optionCount);
            shell.style.setProperty("--segmented-option-count", String(optionCount));
            shell.style.setProperty("--segmented-active-index", String(resolvedActiveIndex));
            const overflowLayout = syncSegmentedOverflowLayout(shell, resolvedOptions);
            let shouldOverflow = Boolean(overflowLayout?.overflow);
            if (!overflowLayout) {
                shell.dataset.segmentedOverflow = "0";
                shouldOverflow = shell.scrollWidth > shell.clientWidth + 1;
                shell.dataset.segmentedOverflow = shouldOverflow ? "1" : "0";
            }
            if (shouldOverflow || shell.dataset.segmentedPill === "measured") {
                const activeOption = resolvedOptions[resolvedActiveIndex];
                if (activeOption instanceof HTMLElement) {
                    const shellStyles = window.getComputedStyle(shell);
                    const thumbInset = Number.parseFloat(shellStyles.getPropertyValue("--mode-switch-thumb-inset"))
                        || Number.parseFloat(shellStyles.paddingLeft)
                        || 0;
                    shell.style.setProperty("--segmented-pill-left", `${Math.max(0, activeOption.offsetLeft - thumbInset)}px`);
                    shell.style.setProperty("--segmented-pill-width", `${Math.max(1, activeOption.offsetWidth)}px`);
                    shell.classList.add("is-pill-ready");
                    keepSegmentedOptionVisible(shell, activeOption);
                }
            } else if (shell.dataset.segmentedPill !== "measured") {
                shell.classList.remove("is-pill-ready");
                shell.style.removeProperty("--segmented-pill-left");
                shell.style.removeProperty("--segmented-pill-width");
            }
        };
        const syncAllSegmentedControlLayouts = () => {
            $$(".segmented-control, .range-mode-shell").forEach((shell) => {
                if (!(shell instanceof HTMLElement)) return;
                syncSegmentedControlLayout(shell, {activeValue: shell.dataset.active || ""});
            });
        };
        window.WORTHWARD_SEGMENTED_CONTROLS = Object.freeze({
            keepOptionVisible: keepSegmentedOptionVisible,
            sync: syncSegmentedControlLayout,
            syncOverflowState: syncSegmentedOverflowState,
        });
        const syncRangeModeSegmentedControl = () => {
            const shell = $(".range-mode-shell");
            if (!(shell instanceof HTMLElement)) return;
            const options = getVisibleSegmentedOptions(shell);
            const activeInput = rangeModeInputs.find((input) => input.checked && !input.disabled);
            const activeValue = activeInput?.value || defaults.range_mode || "period";
            const activeIndex = Math.max(0, options.findIndex((option) => {
                const input = option.querySelector("input");
                return input instanceof HTMLInputElement && input.checked;
            }));
            syncSegmentedControlLayout(shell, {activeValue, activeIndex, options});
        };

        const syncPortfolioAllocationSegmentedControl = () => {
            if (!isPortfolioView) return;
            const shell = $(".portfolio-allocation-shell");
            if (!(shell instanceof HTMLElement)) return;
            const inputs = getPortfolioAllocationInputs();
            const activeValue = getPortfolioAllocationMode();
            const activeIndex = Math.max(0, inputs.findIndex((input) => input.checked));
            syncSegmentedControlLayout(shell, {activeValue, activeIndex});
            form?.dataset && (form.dataset.portfolioAllocation = activeValue);
            if (activeValue === "shares") {
                hidePortfolioWeightTooltips();
                document.querySelectorAll(".portfolio-weight-field.is-open").forEach((field) => {
                    field.classList.remove("is-open");
                });
            }
            validatePortfolioWeightInputs();
            dispatchPortfolioPreviewUpdate();
        };

        const attachPortfolioAllocationHandlers = () => {
            if (!isPortfolioView) return;
            getPortfolioAllocationInputs().forEach((input) => {
                if (input.dataset.bound === "1") return;
                input.dataset.bound = "1";
                input.addEventListener("change", () => {
                    if (input.checked && input.value === "shares") {
                        getWeightFields().forEach(({tickerInput, shares}) => {
                            if (!shares || !sanitizeTicker(tickerInput?.value || "")) return;
                            const currentShares = Number.parseInt(shares.value || "0", 10) || 0;
                            if (currentShares <= 0) shares.value = "1";
                        });
                    }
                    syncPortfolioAllocationSegmentedControl();
                    requestWorkspaceChartTransition("portfolio-allocation");
                    scheduleAutoSubmit(80);
                });
            });
            syncPortfolioAllocationSegmentedControl();
        };
        const syncDcaFrequencySegmentedControl = () => {
            const shell = getDcaFrequencyShell();
            if (!(shell instanceof HTMLElement)) return;
            const options = getVisibleSegmentedOptions(shell);
            const activeIndex = Math.max(0, options.findIndex((option) => {
                const input = option.querySelector("input");
                return input instanceof HTMLInputElement && input.checked;
            }));
            syncSegmentedControlLayout(shell, {activeValue: getSelectedDcaFrequency(), activeIndex, options});
        };
        const updateDcaSchedulePanels = () => {
            const frequency = getSelectedDcaFrequency();
            const weeklyPanel = document.getElementById("dca_weekly_panel");
            const monthlyPanel = document.getElementById("dca_monthly_panel");
            if (weeklyPanel) {
                const isWeekly = frequency === "weekly";
                weeklyPanel.hidden = !isWeekly;
                weeklyPanel.setAttribute("aria-hidden", String(!isWeekly));
                weeklyPanel.style.display = isWeekly ? "" : "none";
                if (!isWeekly) {
                    closeSharedSelectDropdowns(weeklyPanel.querySelector("[data-shared-select-field]"));
                    setSharedSelectDropdownOpen(weeklyPanel.querySelector("[data-shared-select-field]"), false);
                }
            }
            if (monthlyPanel) {
                const isMonthly = frequency === "monthly";
                monthlyPanel.hidden = !isMonthly;
                monthlyPanel.setAttribute("aria-hidden", String(!isMonthly));
                monthlyPanel.style.display = isMonthly ? "" : "none";
                if (!isMonthly) {
                    closeSharedSelectDropdowns(monthlyPanel.querySelector("[data-shared-select-field]"));
                    setSharedSelectDropdownOpen(monthlyPanel.querySelector("[data-shared-select-field]"), false);
                }
            }
        };
        const getSelectedBacktestInterval = () => {
            const selectedInput = getBacktestIntervalInputs().find((input) => input.checked && !input.disabled);
            return selectedInput?.value || "1d";
        };
        const syncBacktestIntervalSegmentedControl = () => {
            const shell = getBacktestIntervalShell();
            if (!(shell instanceof HTMLElement)) return;
            const options = getVisibleSegmentedOptions(shell);
            const activeIndex = Math.max(0, options.findIndex((option) => {
                const input = option.querySelector("input");
                return input instanceof HTMLInputElement && input.checked;
            }));
            syncSegmentedControlLayout(shell, {activeValue: getSelectedBacktestInterval(), activeIndex, options});
        };
        const setBacktestIntervalAvailability = (has1m) => {
            getBacktestIntervalInputs().forEach((input) => {
                const option = input.closest(".segmented-control-option");
                if (!(option instanceof HTMLElement)) return;
                const isSupported = input.value !== "1m"
                    || (strategyDeclaresBacktestInterval("1m") && has1m);
                input.disabled = !isSupported;
                option.hidden = false;
            });
            syncBacktestIntervalSegmentedControl();
        };
        const setBacktestIntervalValue = (value) => {
            const nextInput = getBacktestIntervalInputs().find((input) => input.value === value && !input.disabled);
            if (!(nextInput instanceof HTMLInputElement)) return false;
            if (!nextInput.checked) {
                nextInput.checked = true;
            }
            syncBacktestIntervalSegmentedControl();
            return true;
        };

        return Object.freeze({
            SIDEBAR_OVERLAY_GAP_PX,
            attachPortfolioAllocationHandlers,
            bindSegmentedOverflowFrame,
            brokerAlphabeticalCollator,
            closeSharedSelectDropdowns,
            compareBrokerOptionSortKeys,
            getBacktestIntervalInputs,
            getBacktestIntervalShell,
            getBrokerOptionSortKey,
            getDcaFrequencyInputs,
            getDcaFrequencyShell,
            getSegmentedOverflowFrame,
            getSelectedBacktestInterval,
            getSelectedDcaFrequency,
            getSharedSelectController,
            getSharedSelectDropdown,
            getSharedSelectFields,
            getSharedSelectOptionButtons,
            getSharedSelectOverlayHost,
            getSharedSelectParts,
            getSidebarOverlayMetrics,
            getVisibleSegmentedOptions,
            handleSharedSelectDropdownKeydown,
            handleSharedSelectTriggerKeydown,
            initializeSharedSelectField,
            isBrokerSharedSelectKind,
            isOneDayExactDateMode,
            keepSegmentedOptionVisible,
            portalSharedSelectDropdown,
            positionSharedSelectDropdown,
            positionSidebarDropdownFromTrigger,
            readSegmentedPixelValue,
            refreshSharedSelectField,
            renderSharedSelectDropdown,
            resetSidebarDropdownPosition,
            restoreSharedSelectDropdown,
            setBacktestIntervalAvailability,
            setBacktestIntervalValue,
            setSharedSelectDropdownOpen,
            sharedSelectControllers,
            sharedSelectOwnerSequence,
            shouldPortalSharedSelectDropdown,
            sortBrokerSelectOptions,
            strategyDeclaresBacktestInterval,
            syncAllSegmentedControlLayouts,
            syncBacktestIntervalSegmentedControl,
            syncDcaFrequencySegmentedControl,
            syncDividendModeSwitches,
            syncExactDateModeControls,
            syncNativeSelectSelection,
            syncOneDayExtendedHoursSwitch,
            syncOneDayOvernightSwitch,
            syncPortfolioAllocationSegmentedControl,
            syncRangeModeSegmentedControl,
            syncSegmentedControlLayout,
            syncSegmentedOverflowLayout,
            syncSegmentedOverflowState,
            syncSharedSelectTriggerLabel,
            syncSharedSelectTriggerMedia,
            syncStrategyParamFieldVisibility,
            updateDcaSchedulePanels,
            upgradeStandaloneSharedSelects,
        });
    };

    window.WORTHWARD_APP_SELECT_CONTROLS = Object.freeze({create});
})();
