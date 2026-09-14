/**
 * Binding controls, pagination, and transaction selection.
 *
 * Code version: v1.0.0
 * - Added: Extracted from the Investment workspace composition root.
 */

export function createInvestmentBindingPaginationRuntime(runtime) {
function getMoneyMarketFundLogoUrl(ticker) {
        if (!runtime.isMoneyMarketFundTicker(ticker)) return '';
        return runtime.isDollarTokenMoneyMarketTicker(ticker)
            ? '/market-store/logos/dollarsign.ring.svg'
            : '/market-store/logos/money-market-fund.ring.svg';
    }

function getMoneyMarketFundTokenLogoClass(ticker) {
        if (!runtime.isMoneyMarketFundTicker(ticker)) return '';
        return runtime.isDollarTokenMoneyMarketTicker(ticker)
            ? 'investment-cash-equivalent-token-logo'
            : 'investment-money-market-fund-token-logo';
    }

function getCashEquivalentFundDisplayName(ticker) {
        const normalizedTicker = runtime.normalizeInvestmentTicker(ticker);
        if (runtime.isFranklinMoneyMarketTicker(normalizedTicker)) {
            return 'Franklin Templeton U.S. Dollar Short-Term Money Market Fund';
        }
        if (!runtime.isLongbridgeHkCashEquivalentSyntheticTicker(normalizedTicker)) {
            const knownName = getInvestmentKnownTickerCompanyNames()[normalizedTicker];
            if (knownName) return knownName;
            if (runtime.isMoneyMarketFundTicker(normalizedTicker)) return 'Money Market Fund';
            return '';
        }
        const parts = normalizedTicker.split('.');
        const fundId = parts[1] || '';
        const currency = parts[2] || '';
        const fundNames = {
            PING_AN_MONEY_MARKET_USD: 'Ping An Money Market Fund',
            PING_AN_MONEY_MARKET_HKD: 'Ping An Money Market Fund',
            GAOTENG_MONEY_MARKET_USD: 'GaoTeng WeValue USD Money Market Fund',
            GAOTENG_MONEY_MARKET_HKD: 'GaoTeng WeInvest Money Market Fund',
        };
        const baseName = fundNames[fundId] || 'Money Market Fund';
        return currency ? `${baseName} (${currency})` : baseName;
    }

function getCashEquivalentTickerLabel(ticker) {
        const normalizedTicker = runtime.normalizeInvestmentTicker(ticker);
        if (!runtime.isLongbridgeHkCashEquivalentSyntheticTicker(normalizedTicker)) return '';
        const parts = normalizedTicker.split('.');
        const fundId = parts[1] || '';
        const currency = parts[2] || '';
        const labels = {
            PING_AN_MONEY_MARKET_USD: 'Ping An MMF',
            PING_AN_MONEY_MARKET_HKD: 'Ping An MMF',
            GAOTENG_MONEY_MARKET_USD: 'GaoTeng MMF',
            GAOTENG_MONEY_MARKET_HKD: 'GaoTeng MMF',
        };
        const label = labels[fundId] || 'MMF';
        return currency ? `${label} ${currency}` : label;
    }

function formatInvestmentTickerForDisplay(ticker) {
        const normalizedTicker = runtime.normalizeInvestmentTicker(ticker);
        const cashEquivalentLabel = getCashEquivalentTickerLabel(normalizedTicker);
        if (cashEquivalentLabel) {
            return cashEquivalentLabel;
        }
        if (normalizedTicker.endsWith('.US')) {
            return normalizedTicker.slice(0, -3);
        }
        if (normalizedTicker.endsWith('.HK')) {
            const [symbol, suffix] = normalizedTicker.split('.');
            const strippedSymbol = String(symbol || '').replace(/^0+(?=\d)/, '');
            return strippedSymbol ? `${strippedSymbol}.${suffix}` : normalizedTicker;
        }
        return normalizedTicker;
    }

function getInvestmentKnownTickerCompanyNames() {
        const payloadNames = window.WORTHWARD_INVESTMENT_DATA?.known_ticker_company_names;
        return payloadNames && typeof payloadNames === 'object' && !Array.isArray(payloadNames)
            ? payloadNames
            : {};
    }

function isInvestmentTickerFallbackCompanyName(companyName, ticker) {
        const normalizedTicker = runtime.normalizeInvestmentTicker(ticker);
        const displayTicker = formatInvestmentTickerForDisplay(ticker);
        const normalizedName = String(companyName || '').trim().toUpperCase();
        if (!normalizedName) return true;
        const fallbackNames = new Set([normalizedTicker, displayTicker]);
        if (normalizedTicker.endsWith('.US')) {
            fallbackNames.add(normalizedTicker.slice(0, -3));
        } else if (!normalizedTicker.includes('.')) {
            fallbackNames.add(`${normalizedTicker}.US`);
        }
        return fallbackNames.has(normalizedName);
    }

function resolveKnownInvestmentTickerCompanyName(ticker) {
        const knownNames = getInvestmentKnownTickerCompanyNames();
        const candidates = runtime.getInvestmentTickerProfileLookupCandidates(ticker);
        const normalizedTicker = runtime.normalizeInvestmentTicker(ticker);
        if (normalizedTicker && !candidates.includes(normalizedTicker)) {
            candidates.unshift(normalizedTicker);
        }
        for (const candidate of candidates) {
            const knownName = String(knownNames[candidate] || '').trim();
            if (knownName && !isInvestmentTickerFallbackCompanyName(knownName, ticker)) {
                return knownName;
            }
        }
        return '';
    }

function resolveInvestmentTickerProfile(tickerProfiles, ticker) {
        const profiles = tickerProfiles && typeof tickerProfiles === 'object' ? tickerProfiles : {};
        const candidates = runtime.getInvestmentTickerProfileLookupCandidates(ticker);
        const normalizedTicker = runtime.normalizeInvestmentTicker(ticker);
        if (normalizedTicker && !candidates.includes(normalizedTicker)) {
            candidates.push(normalizedTicker);
        }
        let fallbackProfile = null;
        for (const candidate of candidates) {
            const profile = profiles[candidate];
            if (!profile || typeof profile !== 'object') continue;
            if (!fallbackProfile) fallbackProfile = profile;
            const companyName = String(profile.company_name || '').trim();
            if (!companyName) continue;
            if (!isInvestmentTickerFallbackCompanyName(companyName, candidate)) {
                return profile;
            }
        }
        const knownCompanyName = resolveKnownInvestmentTickerCompanyName(ticker);
        if (knownCompanyName) {
            return {
                ...(fallbackProfile || {}),
                ticker: normalizedTicker || String(ticker || '').trim().toUpperCase(),
                company_name: knownCompanyName,
            };
        }
        return fallbackProfile || {};
    }

function resolveInvestmentTickerCompanyName(tickerProfiles, ticker) {
        const cashEquivalentName = getCashEquivalentFundDisplayName(ticker);
        if (cashEquivalentName) {
            return cashEquivalentName;
        }
        const profile = resolveInvestmentTickerProfile(tickerProfiles, ticker);
        const companyName = String(profile.company_name || '').trim();
        if (companyName && !isInvestmentTickerFallbackCompanyName(companyName, ticker)) {
            return companyName;
        }
        return '';
    }

function renderInvestmentTickerIdentityNameHtml(companyName) {
        const normalizedName = String(companyName || '').trim();
        if (!normalizedName) return '';
        return `<span class="suggestion-name ticker-identity-name" title="${runtime.escapeHtml(normalizedName)}">${runtime.escapeHtml(normalizedName)}</span>`;
    }

function getInvestmentBrokerMeta(broker) {
        const normalizedBroker = runtime.normalizeInvestmentBroker(broker);
        if (runtime.INVESTMENT_BROKER_META[normalizedBroker]) {
            return runtime.INVESTMENT_BROKER_META[normalizedBroker];
        }
        const fallbackLabel = normalizedBroker ? normalizedBroker.toUpperCase() : 'Broker';
        return {
            code: normalizedBroker || 'unknown',
            label: fallbackLabel,
            logoUrl: '',
            logoAlt: `${fallbackLabel} logo`,
        };
    }

function sortInvestmentBrokerFilterCodes(brokerCodes = []) {
        const labels = Object.fromEntries(
            Object.entries(runtime.INVESTMENT_BROKER_META).map(([brokerCode, metadata]) => [brokerCode, metadata.label]),
        );
        return runtime.sortInvestmentBrokerFilterCodesCore(brokerCodes, {
            labels,
        });
    }

function rebuildInvestmentBrokerFilterTransactionIndex(processedTransactions = runtime.state.investmentProcessedTransactionsCache) {
        const source = Array.isArray(processedTransactions) ? processedTransactions : [];
        const payloadBrokerCodes = Array.isArray(window.WORTHWARD_INVESTMENT_DATA?.brokers)
            ? window.WORTHWARD_INVESTMENT_DATA.brokers.map((broker) => runtime.normalizeInvestmentBroker(broker)).filter(Boolean)
            : [];
        const labels = Object.fromEntries(
            Object.entries(runtime.INVESTMENT_BROKER_META).map(([brokerCode, metadata]) => [brokerCode, metadata.label]),
        );
        runtime.state.investmentBrokerFilterTransactionIndex = runtime.buildInvestmentBrokerFilterIndex(source, {
            isHidden: runtime.isInvestmentHistoryDisplayHidden,
            getBrokerCode: runtime.getTransactionBrokerCode,
            normalizeDate: runtime.normalizeLedgerDate,
            payloadBrokers: payloadBrokerCodes,
            labels,
        });
    }

function ensureInvestmentBrokerFilterTransactionIndex(processedTransactions = runtime.state.investmentProcessedTransactionsCache) {
        const source = Array.isArray(processedTransactions) ? processedTransactions : [];
        if (runtime.state.investmentBrokerFilterTransactionIndex.source !== source) {
            rebuildInvestmentBrokerFilterTransactionIndex(source);
        }
        return runtime.state.investmentBrokerFilterTransactionIndex;
    }

function computeAvailableInvestmentBrokerCodes() {
        return ensureInvestmentBrokerFilterTransactionIndex().availableCodes;
    }

function refreshInvestmentAvailableBrokerCodes() {
        rebuildInvestmentBrokerFilterTransactionIndex();
        const codes = computeAvailableInvestmentBrokerCodes();
        runtime.state.investmentAvailableBrokerCodesCache = codes;
        runtime.state.investmentAvailableBrokerCodesSet = new Set(codes);
    }

function getAvailableInvestmentBrokerCodes() {
        if (runtime.state.investmentAvailableBrokerCodesCache.length === 0 && runtime.state.investmentProcessedTransactionsCache.length > 0) {
            refreshInvestmentAvailableBrokerCodes();
        }
        return runtime.state.investmentAvailableBrokerCodesCache;
    }

function getInvestmentBrokerFilterSelectedCodes({view = runtime.state.activeInvestmentView} = {}) {
        const normalizedView = runtime.normalizeInvestmentView(view);
        const sourceBrokerCodes = normalizedView === 'metrics'
            ? (() => {
                const selectedBrokerCode = getInvestmentBrokerSummarySelectedCode();
                return selectedBrokerCode === 'all'
                    ? getAvailableInvestmentBrokerCodes()
                    : [selectedBrokerCode];
            })()
            : Array.from(runtime.state.investmentBrokerFilterSelectedCodes);
        return new Set(
            sourceBrokerCodes
                .map((brokerCode) => runtime.normalizeInvestmentBroker(brokerCode))
                .filter((brokerCode) => runtime.state.investmentAvailableBrokerCodesSet.has(brokerCode)),
        );
    }

function matchesInvestmentBrokerFilter(txn) {
        const availableBrokerCodes = getAvailableInvestmentBrokerCodes();
        if (!availableBrokerCodes.length) return true;
        const selectedBrokerCodes = getInvestmentBrokerFilterSelectedCodes();
        if (runtime.isInvestmentBrokerFilterAllSelected(selectedBrokerCodes, availableBrokerCodes)) {
            return true;
        }
        if (!selectedBrokerCodes.size) {
            return false;
        }
        return selectedBrokerCodes.has(runtime.normalizeInvestmentBroker(runtime.getTransactionBrokerCode(txn)));
    }

function initializeInvestmentBrokerFilterSelection() {
        runtime.state.investmentBrokerFilterSelectedCodes = new Set(getAvailableInvestmentBrokerCodes());
    }

function getInvestmentBrokerSummarySelectedCode() {
        const availableBrokerCodes = getAvailableInvestmentBrokerCodes();
        if (!availableBrokerCodes.length) {
            const pendingBrokerCode = runtime.normalizeInvestmentBroker(runtime.state.investmentBrokerSummarySelectedCode);
            return pendingBrokerCode && pendingBrokerCode !== 'all'
                ? pendingBrokerCode
                : 'all';
        }

        if (!runtime.state.investmentBrokerSummarySelectionInitialized) {
            const pendingBrokerCode = String(runtime.state.investmentBrokerSummarySelectedCode || 'all').trim().toLowerCase();
            runtime.state.investmentBrokerSummarySelectedCode = pendingBrokerCode === 'all'
                ? 'all'
                : availableBrokerCodes.includes(runtime.normalizeInvestmentBroker(pendingBrokerCode))
                    ? runtime.normalizeInvestmentBroker(pendingBrokerCode)
                    : 'all';
            runtime.state.investmentBrokerSummarySelectionInitialized = true;
            return runtime.state.investmentBrokerSummarySelectedCode;
        }

        const normalizedCurrentCode = runtime.normalizeInvestmentBroker(runtime.state.investmentBrokerSummarySelectedCode);
        if (normalizedCurrentCode === 'all') {
            runtime.state.investmentBrokerSummarySelectedCode = 'all';
            return 'all';
        }
        if (availableBrokerCodes.includes(normalizedCurrentCode)) {
            runtime.state.investmentBrokerSummarySelectedCode = normalizedCurrentCode;
            return normalizedCurrentCode;
        }

        runtime.state.investmentBrokerSummarySelectedCode = 'all';
        return 'all';
    }

function isInvestmentBrokerSummaryFilterField(field) {
        return field instanceof HTMLElement && field.dataset.investmentBrokerFilterMode === 'single';
    }

function isInvestmentMetricsHistoryBrokerFilterField(field) {
        return field instanceof HTMLElement
            && runtime.state.activeInvestmentView === 'metrics'
            && field.dataset.filterId === 'investment_history_broker_filter';
    }

function renderInvestmentBrokerFilterHeaderInnerMarkup(
        filterId = 'investment_history_broker_filter',
        { singleSelect = false } = {},
    ) {
        const modeAttribute = singleSelect ? ' data-investment-broker-filter-mode="single"' : '';
        const summaryTriggerClass = singleSelect ? ' investment-broker-summary-trigger' : '';
        const summaryLabelAttributes = singleSelect ? '' : ' hidden aria-hidden="true"';
        const initialTitle = singleSelect ? 'All' : 'All brokers';
        const initialAriaLabel = singleSelect ? 'Brokers selector: All' : 'Broker filter: All brokers';
        return `
            <div class="field investment-broker-filter-field backtest-shared-select-field"
                 data-investment-broker-filter
                 ${modeAttribute}
                 data-filter-id="${runtime.escapeHtml(filterId)}">
                <div class="trade-strategy-row backtest-shared-select-row investment-broker-filter-row live-trading-broker-row">
                    <div class="trade-strategy-combobox backtest-shared-select-combobox">
                        <button type="button"
                                class="trade-strategy-select form-select trade-strategy-trigger backtest-shared-select-trigger live-trading-broker-trigger investment-broker-filter-trigger${summaryTriggerClass}"
                                data-investment-broker-filter-trigger
                                aria-haspopup="listbox"
                                aria-expanded="false"
                                aria-controls="${runtime.escapeHtml(filterId)}_dropdown"
                                title="${initialTitle}"
                                aria-label="${initialAriaLabel}">
                            <span class="ticker-leading-slot live-trading-broker-trigger-slot investment-broker-filter-trigger-slot" aria-hidden="true">
                                <span class="ticker-logo-placeholder"
                                      data-investment-broker-filter-placeholder></span>
                                <img class="ticker-input-logo live-trading-broker-trigger-logo investment-broker-filter-trigger-logo"
                                     data-investment-broker-filter-logo
                                     alt=""
                                     hidden>
                            </span>
                            <span class="trade-strategy-trigger-label live-trading-broker-trigger-label investment-broker-filter-trigger-label"
                                  data-investment-broker-filter-label
                                  ${summaryLabelAttributes}></span>
                        </button>
                    </div>
                    <div id="${runtime.escapeHtml(filterId)}_dropdown"
                         class="trade-strategy-dropdown backtest-shared-select-dropdown live-trading-broker-dropdown investment-broker-filter-dropdown"
                         data-investment-broker-filter-dropdown
                         role="listbox"
                         aria-label="${singleSelect ? 'Brokers' : 'Broker'}"
                         hidden></div>
                </div>
            </div>
        `;
    }

function getInvestmentBrokerFilterScopeId(th) {
        if (!(th instanceof HTMLElement)) return 'investment_history_broker_filter';
        return th.closest('.investment-stock-details-table-shell')
            ? 'investment_stock_details_broker_filter'
            : 'investment_history_broker_filter';
    }

function getInvestmentBrokerFilterViewForField(field) {
        if (field instanceof HTMLElement && field.closest('.investment-stock-details-table-shell')) {
            return 'stock_details';
        }
        return runtime.state.activeInvestmentView || 'chart';
    }

function syncInvestmentBrokerFilterTrigger(field) {
        if (!(field instanceof HTMLElement)) return;
        const trigger = field.querySelector('[data-investment-broker-filter-trigger]');
        const triggerLogo = field.querySelector('[data-investment-broker-filter-logo]');
        const triggerPlaceholder = field.querySelector('[data-investment-broker-filter-placeholder]');
        if (!(trigger instanceof HTMLButtonElement)) return;

        if (triggerLogo instanceof HTMLImageElement) {
            triggerLogo.onload = null;
            triggerLogo.onerror = null;
            triggerLogo.hidden = true;
            triggerLogo.alt = '';
            triggerLogo.removeAttribute('src');
            delete triggerLogo.dataset.investmentBrokerFilterLogoUrl;
        }
        if (triggerPlaceholder instanceof HTMLElement) {
            triggerPlaceholder.hidden = true;
        }
        field.classList.remove('has-selected-broker-logo');

        const availableBrokerCodes = getAvailableInvestmentBrokerCodes();
        const triggerLabel = field.querySelector('[data-investment-broker-filter-label]');
        if (isInvestmentBrokerSummaryFilterField(field)) {
            const selectedCode = getInvestmentBrokerSummarySelectedCode();
            const selectedBrokerMeta = selectedCode === 'all'
                ? null
                : getInvestmentBrokerMeta(selectedCode);
            const selectedBrokerLogoUrl = String(selectedBrokerMeta?.logoUrl || '').trim();
            const selectedLabel = selectedCode === 'all'
                ? 'All'
                : selectedBrokerMeta.label;
            field.classList.toggle('has-selected-broker-logo', Boolean(selectedBrokerLogoUrl));
            if (triggerLabel instanceof HTMLElement) {
                triggerLabel.textContent = selectedLabel;
                triggerLabel.hidden = false;
                triggerLabel.setAttribute('aria-hidden', 'false');
            }
            if (triggerLogo instanceof HTMLImageElement && selectedBrokerLogoUrl) {
                triggerLogo.dataset.investmentBrokerFilterLogoUrl = selectedBrokerLogoUrl;
                triggerLogo.onload = () => {
                    if (triggerLogo.dataset.investmentBrokerFilterLogoUrl !== selectedBrokerLogoUrl) return;
                    triggerLogo.hidden = false;
                    if (triggerPlaceholder instanceof HTMLElement) {
                        triggerPlaceholder.hidden = true;
                    }
                };
                triggerLogo.onerror = () => {
                    if (triggerLogo.dataset.investmentBrokerFilterLogoUrl !== selectedBrokerLogoUrl) return;
                    triggerLogo.hidden = true;
                    triggerLogo.removeAttribute('src');
                    if (triggerPlaceholder instanceof HTMLElement) {
                        triggerPlaceholder.hidden = false;
                    }
                };
                if (triggerPlaceholder instanceof HTMLElement) {
                    triggerPlaceholder.hidden = false;
                }
                triggerLogo.src = selectedBrokerLogoUrl;
                if (triggerLogo.complete && triggerLogo.naturalWidth > 0 && triggerLogo.naturalHeight > 0) {
                    triggerLogo.hidden = false;
                    if (triggerPlaceholder instanceof HTMLElement) {
                        triggerPlaceholder.hidden = true;
                    }
                }
            }
            trigger.disabled = !availableBrokerCodes.length;
            trigger.title = `Brokers: ${selectedLabel}`;
            trigger.setAttribute('aria-label', `Brokers selector: ${selectedLabel}`);
            return;
        }

        trigger.disabled = false;
        if (triggerLabel instanceof HTMLElement) {
            triggerLabel.textContent = '';
            triggerLabel.hidden = true;
            triggerLabel.setAttribute('aria-hidden', 'true');
        }
        const selectedBrokerCodes = getInvestmentBrokerFilterSelectedCodes({
            view: getInvestmentBrokerFilterViewForField(field),
        });
        const selectedBrokerList = availableBrokerCodes.filter((brokerCode) => selectedBrokerCodes.has(brokerCode));
        const allSelected = runtime.isInvestmentBrokerFilterAllSelected(selectedBrokerCodes, availableBrokerCodes);

        let triggerTitle = 'All brokers';
        if (!allSelected) {
            if (!selectedBrokerList.length) {
                triggerTitle = 'No brokers selected';
            } else if (selectedBrokerList.length === 1) {
                triggerTitle = getInvestmentBrokerMeta(selectedBrokerList[0]).label;
            } else {
                triggerTitle = `${selectedBrokerList.length} brokers selected`;
            }
        }

        trigger.title = triggerTitle;
        trigger.setAttribute('aria-label', `Broker filter: ${triggerTitle}`);
    }

function estimateInvestmentFilterDropdownWidth(labels = []) {
        const longestLabelLength = labels.reduce((maxLength, label) => (
            Math.max(maxLength, Array.from(String(label || '')).length)
        ), 0);
        return Math.max(180, Math.min(360, 74 + (longestLabelLength * 8)));
    }

function estimateInvestmentBrokerFilterDropdownWidth(availableBrokerCodes = getAvailableInvestmentBrokerCodes()) {
        return estimateInvestmentFilterDropdownWidth([
            'All',
            ...availableBrokerCodes.map((brokerCode) => getInvestmentBrokerMeta(brokerCode).label),
        ]);
    }

function getInvestmentBrokerFilterDropdown(field) {
        if (!(field instanceof HTMLElement)) return null;
        const nestedDropdown = field.querySelector('[data-investment-broker-filter-dropdown]');
        if (nestedDropdown instanceof HTMLElement) return nestedDropdown;
        const filterId = String(field.dataset.filterId || '').trim();
        if (!filterId) return null;
        const portalledDropdown = document.querySelector(
            `[data-investment-broker-filter-dropdown][data-investment-broker-filter-owner="${CSS.escape(filterId)}"]`
        );
        return portalledDropdown instanceof HTMLElement ? portalledDropdown : null;
    }

function portalInvestmentBrokerFilterDropdown(field, dropdown) {
        if (!(field instanceof HTMLElement) || !(dropdown instanceof HTMLElement)) return;
        const filterId = String(field.dataset.filterId || '').trim();
        if (filterId) {
            dropdown.dataset.investmentBrokerFilterOwner = filterId;
        }
        if (dropdown.parentElement !== document.body) {
            document.body.appendChild(dropdown);
        }
    }

function restoreInvestmentBrokerFilterDropdown(field, dropdown) {
        if (!(field instanceof HTMLElement) || !(dropdown instanceof HTMLElement)) return;
        const row = field.querySelector('.investment-broker-filter-row');
        if (row instanceof HTMLElement && dropdown.parentElement !== row) {
            row.appendChild(dropdown);
        }
        delete dropdown.dataset.investmentBrokerFilterOwner;
    }

function positionInvestmentBrokerFilterDropdown(field) {
        if (!(field instanceof HTMLElement)) return;
        const trigger = field.querySelector('[data-investment-broker-filter-trigger]');
        const dropdown = getInvestmentBrokerFilterDropdown(field);
        if (!(trigger instanceof HTMLElement)
            || !(dropdown instanceof HTMLElement)
            || dropdown.hidden) {
            return;
        }
        const triggerRect = trigger.getBoundingClientRect();
        const viewportPadding = 16;
        const viewportHeight = window.visualViewport?.height || window.innerHeight || 600;
        const spaceBelow = viewportHeight - triggerRect.bottom - viewportPadding;
        // Allow scrolling within a comfortable max; ensures even on short viewports or near-bottom triggers
        // the list remains fully operable via internal scroll (matching the pattern used for import broker dropdown).
        const maxH = Math.max(120, Math.min(380, spaceBelow));

        const contentWidth = Math.max(
            Math.ceil(triggerRect.width),
            estimateInvestmentBrokerFilterDropdownWidth(),
        );
        const viewportMaxWidth = Math.max(140, window.innerWidth - triggerRect.left - viewportPadding);
        const finalWidth = Math.min(contentWidth, viewportMaxWidth);

        // Use fixed positioning so the dropdown escapes sticky table headers and any
        // scrollable table shells (e.g. .scrollable-data-table-scroll with overflow:auto).
        // This guarantees the full broker list is never clipped/truncated and is always scrollable.
        dropdown.style.position = 'fixed';
        dropdown.style.left = `${Math.round(triggerRect.left)}px`;
        dropdown.style.top = `${Math.round(triggerRect.bottom + 4)}px`;
        dropdown.style.right = 'auto';
        dropdown.style.bottom = 'auto';
        dropdown.style.width = `${finalWidth}px`;
        dropdown.style.maxWidth = `${viewportMaxWidth}px`;
        dropdown.style.maxHeight = `${Math.round(maxH)}px`;
        dropdown.style.zIndex = '10002';
        dropdown.style.overflowY = 'auto';
        dropdown.style.overscrollBehavior = 'contain';
    }

function scheduleInvestmentBrokerFilterDropdownPosition() {
        if (runtime.state.investmentBrokerFilterPositionRaf) return;
        runtime.state.investmentBrokerFilterPositionRaf = window.requestAnimationFrame(() => {
            runtime.state.investmentBrokerFilterPositionRaf = 0;
            document.querySelectorAll('[data-investment-broker-filter].is-open').forEach((field) => {
                positionInvestmentBrokerFilterDropdown(field);
            });
        });
    }

function setInvestmentBrokerFilterDropdownOpen(field, isOpen) {
        if (!(field instanceof HTMLElement)) return;
        const trigger = field.querySelector('[data-investment-broker-filter-trigger]');
        const dropdown = getInvestmentBrokerFilterDropdown(field);
        if (!(trigger instanceof HTMLButtonElement) || !(dropdown instanceof HTMLElement)) return;
        trigger.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        field.classList.toggle('is-open', isOpen);
        if (isOpen) {
            portalInvestmentBrokerFilterDropdown(field, dropdown);
            dropdown.hidden = false;
            positionInvestmentBrokerFilterDropdown(field);
        } else {
            dropdown.hidden = true;
            dropdown.style.position = '';
            dropdown.style.left = '';
            dropdown.style.top = '';
            dropdown.style.right = '';
            dropdown.style.bottom = '';
            dropdown.style.width = '';
            dropdown.style.maxWidth = '';
            dropdown.style.maxHeight = '';
            dropdown.style.zIndex = '';
            dropdown.style.overflowY = '';
            dropdown.style.overscrollBehavior = '';
            restoreInvestmentBrokerFilterDropdown(field, dropdown);
        }
    }

function closeInvestmentBrokerFilterDropdowns(exceptField = null) {
        document.querySelectorAll('[data-investment-broker-filter]').forEach((field) => {
            if (!(field instanceof HTMLElement)) return;
            if (exceptField && field === exceptField) return;
            setInvestmentBrokerFilterDropdownOpen(field, false);
        });
    }

function createInvestmentBrokerFilterOptionButton({
        value,
        label,
        iconUrl = '',
        iconAlt = '',
        logoOnly = false,
        isSelected = false,
        isActive = isSelected,
        onClick,
    }) {
        const optionButton = document.createElement('button');
        optionButton.type = 'button';
        optionButton.className = 'trade-strategy-dropdown-option';
        if (logoOnly) {
            optionButton.classList.add('is-broker-logo-only');
        }
        optionButton.dataset.value = value;
        optionButton.setAttribute('role', 'option');
        optionButton.setAttribute('aria-selected', isSelected ? 'true' : 'false');
        optionButton.setAttribute('aria-label', label);
        optionButton.classList.toggle('is-selected', isSelected);
        optionButton.classList.toggle('is-active', isActive);

        const checkElement = document.createElement('span');
        checkElement.className = 'trade-strategy-dropdown-check';
        checkElement.setAttribute('aria-hidden', 'true');
        optionButton.appendChild(checkElement);

        if (iconUrl) {
            optionButton.classList.add('is-with-icon');
            const mediaSlot = document.createElement('span');
            mediaSlot.className = 'trade-strategy-dropdown-media-slot';
            mediaSlot.setAttribute('aria-hidden', 'true');

            const mediaPlaceholder = document.createElement('span');
            mediaPlaceholder.className = 'trade-strategy-dropdown-media-placeholder';

            const mediaElement = document.createElement('img');
            mediaElement.className = 'trade-strategy-dropdown-media';
            mediaElement.alt = iconAlt || `${label} logo`;
            mediaElement.loading = 'eager';
            mediaElement.decoding = 'async';
            mediaElement.hidden = true;
            mediaElement.addEventListener('load', () => {
                mediaElement.hidden = false;
                mediaPlaceholder.hidden = true;
            });
            mediaElement.addEventListener('error', () => {
                mediaElement.hidden = true;
                mediaElement.removeAttribute('src');
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

        if (!logoOnly || !iconUrl) {
            const copyElement = document.createElement('span');
            copyElement.className = 'trade-strategy-dropdown-copy';
            const titleElement = document.createElement('span');
            titleElement.className = 'trade-strategy-dropdown-title';
            titleElement.textContent = label;
            copyElement.appendChild(titleElement);
            optionButton.appendChild(copyElement);
        }

        optionButton.addEventListener('click', (event) => {
            event.stopPropagation();
            onClick?.();
        });
        return optionButton;
    }

function applyInvestmentBrokerSummarySelection(nextBrokerCode, field = null) {
        const availableBrokerCodes = getAvailableInvestmentBrokerCodes();
        const requestedBrokerCode = String(nextBrokerCode || '').trim().toLowerCase();
        const isAll = requestedBrokerCode === '__all__' || requestedBrokerCode === 'all';
        const normalizedBrokerCode = runtime.normalizeInvestmentBroker(nextBrokerCode);
        if (!isAll && !availableBrokerCodes.includes(normalizedBrokerCode)) return;
        runtime.state.investmentBrokerSummarySelectedCode = isAll ? 'all' : normalizedBrokerCode;
        runtime.state.investmentBrokerSummarySelectionInitialized = true;
        if (field instanceof HTMLElement) {
            setInvestmentBrokerFilterDropdownOpen(field, false);
        }
        runtime.rememberInvestmentPageState({metricsBroker: runtime.state.investmentBrokerSummarySelectedCode});
        if (runtime.state.activeInvestmentView === 'metrics') {
            runtime.applyInvestmentBrokerFilterChange();
            return;
        }
        runtime.syncInvestmentUrl({historyMode: 'replace'});
        syncAllInvestmentBrokerFilterUi();
    }

function renderInvestmentBrokerFilterDropdown(field) {
        if (!(field instanceof HTMLElement)) return;
        const dropdown = getInvestmentBrokerFilterDropdown(field);
        if (!(dropdown instanceof HTMLElement)) return;

        const availableBrokerCodes = getAvailableInvestmentBrokerCodes();
        const brokerFilterView = getInvestmentBrokerFilterViewForField(field);
        const selectedBrokerCodes = getInvestmentBrokerFilterSelectedCodes({view: brokerFilterView});
        if (isInvestmentBrokerSummaryFilterField(field)) {
            const selectedCode = getInvestmentBrokerSummarySelectedCode();
            dropdown.innerHTML = '';
            const fragment = document.createDocumentFragment();
            fragment.appendChild(createInvestmentBrokerFilterOptionButton({
                value: '__all__',
                label: 'All',
                isSelected: selectedCode === 'all',
                isActive: selectedCode === 'all',
                onClick: () => applyInvestmentBrokerSummarySelection('__all__', field),
            }));
            availableBrokerCodes.forEach((brokerCode) => {
                const brokerMeta = getInvestmentBrokerMeta(brokerCode);
                fragment.appendChild(createInvestmentBrokerFilterOptionButton({
                    value: brokerCode,
                    label: brokerMeta.label,
                    iconUrl: brokerMeta.logoUrl,
                    iconAlt: brokerMeta.logoAlt,
                    logoOnly: false,
                    isSelected: selectedCode === brokerCode,
                    isActive: selectedCode === brokerCode,
                    onClick: () => applyInvestmentBrokerSummarySelection(brokerCode, field),
                }));
            });
            dropdown.appendChild(fragment);
            return;
        }

        const allSelected = runtime.isInvestmentBrokerFilterAllSelected(selectedBrokerCodes, availableBrokerCodes);
        const singleSelect = isInvestmentMetricsHistoryBrokerFilterField(field);
        dropdown.innerHTML = '';
        const fragment = document.createDocumentFragment();
        fragment.appendChild(createInvestmentBrokerFilterOptionButton({
            value: '__all__',
            label: 'All',
            isSelected: allSelected,
            isActive: allSelected,
            onClick: () => {
                if (singleSelect) {
                    applyInvestmentBrokerSummarySelection('__all__', field);
                    return;
                }
                runtime.state.investmentBrokerFilterSelectedCodes = new Set(availableBrokerCodes);
                runtime.applyInvestmentBrokerFilterChange();
            },
        }));

        availableBrokerCodes.forEach((brokerCode) => {
            const brokerMeta = getInvestmentBrokerMeta(brokerCode);
            // Always show the broker name text (e.g. "Longbridge (SG)", "CMB Wing Lung Bank")
            // alongside the logo so every option is clearly labeled regardless of logo uniqueness.
            fragment.appendChild(createInvestmentBrokerFilterOptionButton({
                value: brokerCode,
                label: brokerMeta.label,
                iconUrl: brokerMeta.logoUrl,
                iconAlt: brokerMeta.logoAlt,
                logoOnly: false,
                isSelected: singleSelect
                    ? !allSelected && selectedBrokerCodes.has(brokerCode)
                    : allSelected || selectedBrokerCodes.has(brokerCode),
                isActive: !allSelected && selectedBrokerCodes.has(brokerCode),
                onClick: () => {
                    if (singleSelect) {
                        applyInvestmentBrokerSummarySelection(brokerCode, field);
                        return;
                    }
                    const nextSelection = new Set(getInvestmentBrokerFilterSelectedCodes({view: brokerFilterView}));
                    if (allSelected) {
                        nextSelection.delete(brokerCode);
                    } else if (nextSelection.has(brokerCode)) {
                        nextSelection.delete(brokerCode);
                    } else {
                        nextSelection.add(brokerCode);
                    }
                    runtime.state.investmentBrokerFilterSelectedCodes = nextSelection;
                    runtime.applyInvestmentBrokerFilterChange();
                },
            }));
        });
        dropdown.appendChild(fragment);
    }

function syncInvestmentBrokerFilterField(field) {
        if (!(field instanceof HTMLElement)) return;
        syncInvestmentBrokerFilterTrigger(field);
        if (!field.classList.contains('is-open')) return;
        renderInvestmentBrokerFilterDropdown(field);
        positionInvestmentBrokerFilterDropdown(field);
    }

function syncAllInvestmentBrokerFilterUi() {
        document.querySelectorAll('[data-investment-broker-filter]').forEach((field) => {
            syncInvestmentBrokerFilterField(field);
        });
    }

function bindInvestmentBrokerFilterField(field) {
        if (!(field instanceof HTMLElement) || field.dataset.investmentBrokerFilterBound === '1') return;
        field.dataset.investmentBrokerFilterBound = '1';
        const trigger = field.querySelector('[data-investment-broker-filter-trigger]');
        if (!(trigger instanceof HTMLButtonElement)) return;

        trigger.addEventListener('click', (event) => {
            event.stopPropagation();
            const shouldOpen = getInvestmentBrokerFilterDropdown(field)?.hidden !== false;
            closeInvestmentBrokerFilterDropdowns(field);
            if (shouldOpen) {
                renderInvestmentBrokerFilterDropdown(field);
            }
            setInvestmentBrokerFilterDropdownOpen(field, shouldOpen);
        });

        syncInvestmentBrokerFilterField(field);
    }

function ensureInvestmentBrokerFilterDocumentListeners() {
        if (runtime.state.investmentBrokerFilterDocumentListenersBound) return;
        runtime.state.investmentBrokerFilterDocumentListenersBound = true;
        document.addEventListener('click', () => {
            closeInvestmentBrokerFilterDropdowns();
        });
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                closeInvestmentBrokerFilterDropdowns();
            }
        });
        window.addEventListener('resize', () => {
            scheduleInvestmentBrokerFilterDropdownPosition();
        });
        // Reposition on scroll (capture) so the fixed dropdown stays aligned with its trigger
        // when the page, table body, or sticky header context scrolls.
        document.addEventListener('scroll', () => {
            scheduleInvestmentBrokerFilterDropdownPosition();
        }, true);
    }

function mountInvestmentBrokerFilterHeaders(root = document) {
        ensureInvestmentBrokerFilterDocumentListeners();
        const scope = root instanceof Document ? root : root;
        const headers = scope.querySelectorAll ? scope.querySelectorAll('th[aria-label="Broker"]') : [];
        headers.forEach((th) => {
            if (!(th instanceof HTMLElement)) return;
            th.classList.add('investment-history-broker-filter-header');
            const filterId = getInvestmentBrokerFilterScopeId(th);
            if (!th.querySelector('[data-investment-broker-filter]')) {
                th.innerHTML = renderInvestmentBrokerFilterHeaderInnerMarkup(filterId);
            }
            bindInvestmentBrokerFilterField(th.querySelector('[data-investment-broker-filter]'));
        });
        syncAllInvestmentBrokerFilterUi();
    }

function mountInvestmentBrokerSummarySelector() {
        if (!(runtime.investmentBrokerSummarySelector instanceof HTMLElement)) return;
        ensureInvestmentBrokerFilterDocumentListeners();
        if (!runtime.investmentBrokerSummarySelector.querySelector('[data-investment-broker-filter]')) {
            runtime.investmentBrokerSummarySelector.innerHTML = renderInvestmentBrokerFilterHeaderInnerMarkup(
                'investment_broker_summary_filter',
                { singleSelect: true },
            );
        }
        const field = runtime.investmentBrokerSummarySelector.querySelector('[data-investment-broker-filter]');
        bindInvestmentBrokerFilterField(field);
        syncInvestmentBrokerFilterField(field);
    }

function ensureInvestmentMetricsBrokerScope() {
        mountInvestmentBrokerSummarySelector();
        getInvestmentBrokerSummarySelectedCode();
        syncInvestmentBrokerFilterField(
            runtime.investmentBrokerSummarySelector?.querySelector('[data-investment-broker-filter]'),
        );
        runtime.renderInvestmentMetricsPanel();
    }

function renderInvestmentSideFilterHeaderInnerMarkup(filterId = 'investment_history_side_filter') {
        const selectedLabel = runtime.state.investmentSideFilter === 'all'
            ? 'All'
            : runtime.state.investmentSideFilter === 'none' || !runtime.state.investmentSideFilter.length
                ? 'None'
                : runtime.state.investmentSideFilter.map(runtime.formatEventType).join(', ');
        return `
            <span class="scrollable-data-table-filter-default-label investment-side-filter-default-label" aria-hidden="true">Type</span>
            <div class="field scrollable-data-table-filter-field investment-side-filter-field backtest-shared-select-field"
                 data-investment-side-filter data-filter-id="${filterId}">
                <div class="trade-strategy-row backtest-shared-select-row investment-side-filter-row">
                    <button type="button"
                            class="trade-strategy-select form-select trade-strategy-trigger backtest-shared-select-trigger scrollable-data-table-filter-trigger investment-side-filter-trigger"
                            data-investment-side-filter-trigger
                            aria-haspopup="listbox" aria-expanded="false"
                            aria-label="Type filter: ${selectedLabel}">
                        <span class="trade-strategy-trigger-label" data-investment-side-filter-label>${selectedLabel}</span>
                        <span class="trade-strategy-trigger-chevron" aria-hidden="true"></span>
                    </button>
                    <div class="trade-strategy-dropdown backtest-shared-select-dropdown investment-side-filter-dropdown"
                         data-investment-side-filter-dropdown role="listbox" aria-label="Type filter" hidden></div>
                </div>
            </div>
        `;
    }

function closeInvestmentSideFilterDropdowns() {
        document.querySelectorAll('[data-investment-side-filter]').forEach((field) => {
            const trigger = field.querySelector('[data-investment-side-filter-trigger]');
            const dropdown = document.querySelector(
                `[data-investment-side-filter-dropdown][data-filter-owner="${CSS.escape(field.dataset.filterId || '')}"]`
            ) || field.querySelector('[data-investment-side-filter-dropdown]');
            trigger?.setAttribute('aria-expanded', 'false');
            field.classList.remove('is-open');
            if (dropdown instanceof HTMLElement) {
                dropdown.hidden = true;
                dropdown.removeAttribute('style');
                const row = field.querySelector('.investment-side-filter-row');
                if (row instanceof HTMLElement && dropdown.parentElement !== row) row.appendChild(dropdown);
                delete dropdown.dataset.filterOwner;
            }
        });
    }

function applyInvestmentSideFilter(nextFilter, { keepOpenFilterId = '' } = {}) {
        runtime.state.investmentSideFilter = window.WORTHWARD_INVESTMENT_FILTERS?.normalizeSideFilter(nextFilter) || 'all';
        runtime.syncInvestmentUrl({historyMode: 'replace'});
        closeInvestmentSideFilterDropdowns();
        mountInvestmentSideFilterHeaders();
        mountInvestmentCurrencyFilterHeaders();
        runtime.mountInvestmentDescriptionBindingFilterHeaders();
        runtime.renderInvestmentHistoryTableRows(
            runtime.state.investmentProcessedTransactionsCache,
            runtime.state.investmentChartPointsCache,
            { resetPage: true, scrollToTop: true },
        );
        if (runtime.state.activeInvestmentView === 'stock_details') runtime.refreshInvestmentStockDetailsTableRows();
        if (keepOpenFilterId) {
            const nextField = document.querySelector(
                `[data-investment-side-filter][data-filter-id="${CSS.escape(keepOpenFilterId)}"]`
            );
            if (nextField instanceof HTMLElement) openInvestmentSideFilterDropdown(nextField);
        }
    }

function openInvestmentSideFilterDropdown(field) {
        const trigger = field.querySelector('[data-investment-side-filter-trigger]');
        const dropdown = field.querySelector('[data-investment-side-filter-dropdown]');
        if (!(trigger instanceof HTMLElement) || !(dropdown instanceof HTMLElement)) return;
        const availableTypes = Array.from(new Set(
            runtime.state.investmentProcessedTransactionsCache
                .filter((txn) => !runtime.isInvestmentHistoryDisplayHidden(txn))
                .map((txn) => runtime.getNormalizedTransactionType(txn))
                .filter((value) => value && !['all', 'none'].includes(value)),
        )).sort((left, right) => {
            const preferredOrder = ['buy', 'sell'];
            const leftIndex = preferredOrder.indexOf(left);
            const rightIndex = preferredOrder.indexOf(right);
            if (leftIndex >= 0 || rightIndex >= 0) {
                if (leftIndex < 0) return 1;
                if (rightIndex < 0) return -1;
                return leftIndex - rightIndex;
            }
            return runtime.formatEventType(left).localeCompare(runtime.formatEventType(right), 'en', { sensitivity: 'base' });
        });
        const optionValues = ['all', ...availableTypes];
        const optionLabels = optionValues.map((value) => (
            value === 'all' ? 'All' : runtime.formatEventType(value)
        ));
        dropdown.innerHTML = optionValues.map((value) => {
            const label = value === 'all' ? 'All' : runtime.formatEventType(value);
            const selected = runtime.state.investmentSideFilter === 'all'
                || (Array.isArray(runtime.state.investmentSideFilter) && runtime.state.investmentSideFilter.includes(value));
            const active = value === 'all' && runtime.state.investmentSideFilter === 'all';
            return `<button type="button" class="trade-strategy-dropdown-option${selected ? ' is-selected' : ''}${active ? ' is-active' : ''}${value === 'all' ? ' investment-side-filter-all-option' : ''}"
                            data-investment-side-filter-option="${runtime.escapeHtml(value)}" role="option" aria-selected="${selected}">
                        <span class="trade-strategy-dropdown-check" aria-hidden="true"></span>
                        <span class="trade-strategy-dropdown-copy"><span class="trade-strategy-dropdown-title">${runtime.escapeHtml(label)}</span></span>
                    </button>`;
        }).join('');
        const rect = trigger.getBoundingClientRect();
        const viewportPadding = 16;
        const contentWidth = Math.max(
            Math.ceil(rect.width),
            estimateInvestmentFilterDropdownWidth(optionLabels),
        );
        const viewportMaxWidth = Math.max(140, window.innerWidth - rect.left - viewportPadding);
        const finalWidth = Math.min(contentWidth, viewportMaxWidth);
        dropdown.dataset.filterOwner = field.dataset.filterId || '';
        document.body.appendChild(dropdown);
        Object.assign(dropdown.style, {
            position: 'fixed',
            left: `${Math.round(rect.left)}px`,
            top: `${Math.round(rect.bottom + 4)}px`,
            width: `${finalWidth}px`,
            maxWidth: `${viewportMaxWidth}px`,
            zIndex: '10002',
        });
        dropdown.hidden = false;
        trigger.setAttribute('aria-expanded', 'true');
        field.classList.add('is-open');
        dropdown.querySelectorAll('[data-investment-side-filter-option]').forEach((option) => {
            option.addEventListener('click', (event) => {
                event.stopPropagation();
                const selectedValue = option.dataset.investmentSideFilterOption;
                let nextFilter;
                if (selectedValue === 'all') {
                    nextFilter = runtime.state.investmentSideFilter === 'all' ? 'none' : 'all';
                } else {
                    const selectedSides = Array.isArray(runtime.state.investmentSideFilter)
                        ? [...runtime.state.investmentSideFilter]
                        : [];
                    const selectedIndex = selectedSides.indexOf(selectedValue);
                    if (selectedIndex >= 0) {
                        if (selectedSides.length === 1) return;
                        selectedSides.splice(selectedIndex, 1);
                    } else {
                        selectedSides.push(selectedValue);
                    }
                    nextFilter = availableTypes.length > 0 && selectedSides.length === availableTypes.length
                        ? 'all'
                        : selectedSides;
                }
                applyInvestmentSideFilter(nextFilter, { keepOpenFilterId: field.dataset.filterId || '' });
            });
        });
    }

function bindInvestmentSideFilterField(field) {
        if (!(field instanceof HTMLElement) || field.dataset.investmentSideFilterBound === '1') return;
        field.dataset.investmentSideFilterBound = '1';
        const trigger = field.querySelector('[data-investment-side-filter-trigger]');
        trigger?.addEventListener('click', (event) => {
            event.stopPropagation();
            const wasOpen = field.classList.contains('is-open');
            closeInvestmentSideFilterDropdowns();
            if (!wasOpen) openInvestmentSideFilterDropdown(field);
        });
    }

function mountInvestmentSideFilterHeaders(root = document) {
        if (!runtime.state.investmentSideFilterDocumentListenersBound) {
            runtime.state.investmentSideFilterDocumentListenersBound = true;
            document.addEventListener('click', closeInvestmentSideFilterDropdowns);
            document.addEventListener('keydown', (event) => {
                if (event.key === 'Escape') closeInvestmentSideFilterDropdowns();
            });
        }
        const scope = root instanceof Document ? root : root;
        scope.querySelectorAll?.('th[aria-label="Side"]').forEach((th) => {
            if (!(th instanceof HTMLElement)) return;
            th.classList.add('scrollable-data-table-filter-header');
            th.classList.add('investment-history-side-filter-header');
            const filterId = th.closest('.investment-stock-details-table')
                ? 'investment_stock_details_side_filter'
                : 'investment_history_side_filter';
            th.innerHTML = renderInvestmentSideFilterHeaderInnerMarkup(filterId);
            bindInvestmentSideFilterField(th.querySelector('[data-investment-side-filter]'));
        });
    }

function getAvailableInvestmentCurrencyCodes(processedTransactions = runtime.state.investmentProcessedTransactionsCache) {
        return runtime.getAvailableInvestmentCurrencyCodesFromRows(processedTransactions, {
            isHidden: runtime.isInvestmentHistoryDisplayHidden,
            formatCurrency: runtime.formatTransactionCurrency,
        });
    }

function normalizeInvestmentCurrencyFilter(value) {
        return runtime.normalizeInvestmentCurrencyFilterValue(value, getAvailableInvestmentCurrencyCodes());
    }

function matchesInvestmentCurrencyFilter(txn) {
        return runtime.matchesInvestmentCurrencyFilterValue(
            txn,
            runtime.state.investmentCurrencyFilter,
            runtime.formatTransactionCurrency,
        );
    }

function renderInvestmentCurrencyFilterHeaderInnerMarkup(filterId = 'investment_history_currency_filter') {
        const selectedLabel = runtime.state.investmentCurrencyFilter === 'all' ? 'All' : runtime.state.investmentCurrencyFilter;
        return `
            <span class="scrollable-data-table-filter-default-label investment-currency-filter-default-label" aria-hidden="true">Currency</span>
            <div class="field scrollable-data-table-filter-field investment-currency-filter-field backtest-shared-select-field"
                 data-investment-currency-filter data-filter-id="${runtime.escapeHtml(filterId)}">
                <div class="trade-strategy-row backtest-shared-select-row investment-currency-filter-row">
                    <button type="button"
                            class="trade-strategy-select form-select trade-strategy-trigger backtest-shared-select-trigger scrollable-data-table-filter-trigger investment-currency-filter-trigger"
                            data-investment-currency-filter-trigger
                            aria-haspopup="listbox" aria-expanded="false"
                            aria-label="Currency filter: ${runtime.escapeHtml(selectedLabel)}">
                        <span class="trade-strategy-trigger-label" data-investment-currency-filter-label>${runtime.escapeHtml(selectedLabel)}</span>
                        <span class="trade-strategy-trigger-chevron" aria-hidden="true"></span>
                    </button>
                    <div class="trade-strategy-dropdown backtest-shared-select-dropdown investment-currency-filter-dropdown"
                         data-investment-currency-filter-dropdown role="listbox" aria-label="Currency filter" hidden></div>
                </div>
            </div>
        `;
    }

function closeInvestmentCurrencyFilterDropdowns() {
        document.querySelectorAll('[data-investment-currency-filter]').forEach((field) => {
            const trigger = field.querySelector('[data-investment-currency-filter-trigger]');
            const dropdown = document.querySelector(
                `[data-investment-currency-filter-dropdown][data-filter-owner="${CSS.escape(field.dataset.filterId || '')}"]`,
            ) || field.querySelector('[data-investment-currency-filter-dropdown]');
            trigger?.setAttribute('aria-expanded', 'false');
            field.classList.remove('is-open');
            if (dropdown instanceof HTMLElement) {
                dropdown.hidden = true;
                dropdown.removeAttribute('style');
                const row = field.querySelector('.investment-currency-filter-row');
                if (row instanceof HTMLElement && dropdown.parentElement !== row) row.appendChild(dropdown);
                delete dropdown.dataset.filterOwner;
            }
        });
    }

function applyInvestmentCurrencyFilter(nextFilter) {
        runtime.state.investmentCurrencyFilter = normalizeInvestmentCurrencyFilter(nextFilter);
        runtime.syncInvestmentUrl({historyMode: 'replace'});
        closeInvestmentCurrencyFilterDropdowns();
        runtime.renderInvestmentHistoryTableRows(
            runtime.state.investmentProcessedTransactionsCache,
            runtime.state.investmentChartPointsCache,
            { resetPage: true, scrollToTop: true },
        );
        if (runtime.state.activeInvestmentView === 'stock_details') runtime.refreshInvestmentStockDetailsTableRows();
        mountInvestmentCurrencyFilterHeaders();
    }

function openInvestmentCurrencyFilterDropdown(field) {
        const trigger = field.querySelector('[data-investment-currency-filter-trigger]');
        const dropdown = field.querySelector('[data-investment-currency-filter-dropdown]');
        if (!(trigger instanceof HTMLElement) || !(dropdown instanceof HTMLElement)) return;
        const availableCurrencies = getAvailableInvestmentCurrencyCodes();
        dropdown.innerHTML = ['all', ...availableCurrencies].map((value) => {
            const label = value === 'all' ? 'All' : value;
            const selected = value === runtime.state.investmentCurrencyFilter;
            return `<button type="button" class="trade-strategy-dropdown-option${selected ? ' is-selected is-active' : ''}"
                            data-investment-currency-filter-option="${runtime.escapeHtml(value)}" role="option" aria-selected="${selected}">
                        <span class="trade-strategy-dropdown-check" aria-hidden="true"></span>
                        <span class="trade-strategy-dropdown-copy"><span class="trade-strategy-dropdown-title">${runtime.escapeHtml(label)}</span></span>
                    </button>`;
        }).join('');
        const rect = trigger.getBoundingClientRect();
        dropdown.dataset.filterOwner = field.dataset.filterId || '';
        document.body.appendChild(dropdown);
        Object.assign(dropdown.style, {
            position: 'fixed',
            left: `${Math.round(rect.left)}px`,
            top: `${Math.round(rect.bottom + 4)}px`,
            width: `${Math.max(120, Math.round(rect.width))}px`,
            zIndex: '10002',
        });
        dropdown.hidden = false;
        trigger.setAttribute('aria-expanded', 'true');
        field.classList.add('is-open');
        dropdown.querySelectorAll('[data-investment-currency-filter-option]').forEach((option) => {
            option.addEventListener('click', (event) => {
                event.stopPropagation();
                applyInvestmentCurrencyFilter(option.dataset.investmentCurrencyFilterOption);
            });
        });
    }

function bindInvestmentCurrencyFilterField(field) {
        if (!(field instanceof HTMLElement) || field.dataset.investmentCurrencyFilterBound === '1') return;
        field.dataset.investmentCurrencyFilterBound = '1';
        const trigger = field.querySelector('[data-investment-currency-filter-trigger]');
        trigger?.addEventListener('click', (event) => {
            event.stopPropagation();
            const wasOpen = field.classList.contains('is-open');
            closeInvestmentCurrencyFilterDropdowns();
            if (!wasOpen) openInvestmentCurrencyFilterDropdown(field);
        });
    }

function mountInvestmentCurrencyFilterHeaders(root = document) {
        if (!runtime.state.investmentCurrencyFilterDocumentListenersBound) {
            runtime.state.investmentCurrencyFilterDocumentListenersBound = true;
            document.addEventListener('click', closeInvestmentCurrencyFilterDropdowns);
            document.addEventListener('keydown', (event) => {
                if (event.key === 'Escape') closeInvestmentCurrencyFilterDropdowns();
            });
        }
        root.querySelectorAll?.('th[aria-label="Currency"]').forEach((th) => {
            if (!(th instanceof HTMLElement)) return;
            th.classList.add('scrollable-data-table-filter-header');
            th.classList.add('investment-history-currency-filter-header');
            const filterId = th.closest('.investment-stock-details-table')
                ? 'investment_stock_details_currency_filter'
                : 'investment_history_currency_filter';
            th.innerHTML = renderInvestmentCurrencyFilterHeaderInnerMarkup(filterId);
            bindInvestmentCurrencyFilterField(th.querySelector('[data-investment-currency-filter]'));
        });
    }

function getInvestmentHistoryTransactionsForCurrentScope(
        processedTransactions = [],
        chartPoints = [],
        {includeDescriptionBindingFilter = true} = {},
    ) {
        return runtime.selectVisibleInvestmentHistoryTransactions({
            brokerFilteredRows: runtime.selectInvestmentDescriptionBindingRows(
                runtime.getInvestmentBrokerCurrencyFilteredRowsForVisibleHistory(processedTransactions),
                includeDescriptionBindingFilter ? runtime.state.investmentDescriptionBindingFilter : 'all',
            ),
            chartPoints,
            // Transaction history is an all-time ledger surface. Overview's range only
            // controls the Overview chart and must not change this table's scope.
            selectedRange: 'max',
            matchesSide: (transaction) => (
                window.WORTHWARD_INVESTMENT_FILTERS?.matchesSideFilter(
                    transaction,
                    runtime.state.investmentSideFilter,
                ) ?? true
            ),
            matchesCurrency: () => true,
            normalizeRange: runtime.normalizeInvestmentEquityRange,
            getRangeLabels: runtime.getInvestmentEquityRangeLabels,
        });
    }

function hasInvestmentDescriptionBindingFilterOptions(
        processedTransactions = runtime.state.investmentProcessedTransactionsCache,
    ) {
        return runtime.hasInvestmentUnboundTransactions(
            getInvestmentHistoryTransactionsForCurrentScope(
                processedTransactions,
                runtime.state.investmentChartPointsCache,
                {includeDescriptionBindingFilter: false},
            ),
        );
    }

function normalizeInvestmentDescriptionBindingFilter(value) {
        return runtime.normalizeInvestmentDescriptionBindingFilterValue(
            value,
            getInvestmentHistoryTransactionsForCurrentScope(
                runtime.state.investmentProcessedTransactionsCache,
                runtime.state.investmentChartPointsCache,
                {includeDescriptionBindingFilter: false},
            ),
        );
    }

function renderInvestmentDescriptionBindingFilterHeaderInnerMarkup(
        filterId = 'investment_history_description_filter',
    ) {
        const selectedLabel = runtime.state.investmentDescriptionBindingFilter === 'unbound' ? 'Unbound' : 'All';
        return `
            <span class="scrollable-data-table-filter-default-label investment-description-filter-default-label" aria-hidden="true">Description</span>
            <div class="field scrollable-data-table-filter-field investment-description-filter-field backtest-shared-select-field"
                 data-investment-description-filter data-filter-id="${runtime.escapeHtml(filterId)}">
                <div class="trade-strategy-row backtest-shared-select-row investment-description-filter-row">
                    <button type="button"
                            class="trade-strategy-select form-select trade-strategy-trigger backtest-shared-select-trigger scrollable-data-table-filter-trigger investment-description-filter-trigger"
                            data-investment-description-filter-trigger
                            aria-haspopup="listbox" aria-expanded="false"
                            aria-label="Description filter: ${runtime.escapeHtml(selectedLabel)}">
                        <span class="trade-strategy-trigger-label" data-investment-description-filter-label>${runtime.escapeHtml(selectedLabel)}</span>
                        <span class="trade-strategy-trigger-chevron" aria-hidden="true"></span>
                    </button>
                    <div class="trade-strategy-dropdown backtest-shared-select-dropdown investment-description-filter-dropdown"
                         data-investment-description-filter-dropdown role="listbox" aria-label="Description filter" hidden></div>
                </div>
            </div>
            <span class="investment-description-binding-alert"
                  data-investment-description-binding-alert
                  tabindex="0"
                  role="img"
                  aria-label="Unbound internal transfer. Choose the matching transfer counterpart in the Description cell.">
                <span class="investment-description-binding-alert-dot" aria-hidden="true"></span>
            </span>
        `;
    }

function closeInvestmentDescriptionBindingFilterDropdowns() {
        document.querySelectorAll('[data-investment-description-filter]').forEach((field) => {
            if (!(field instanceof HTMLElement)) return;
            const trigger = field.querySelector('[data-investment-description-filter-trigger]');
            const dropdown = document.querySelector(
                `[data-investment-description-filter-dropdown][data-filter-owner="${CSS.escape(field.dataset.filterId || '')}"]`,
            ) || field.querySelector('[data-investment-description-filter-dropdown]');
            trigger?.setAttribute('aria-expanded', 'false');
            field.classList.remove('is-open');
            if (dropdown instanceof HTMLElement) {
                dropdown.hidden = true;
                dropdown.removeAttribute('style');
                const row = field.querySelector('.investment-description-filter-row');
                if (row instanceof HTMLElement && dropdown.parentElement !== row) row.appendChild(dropdown);
                delete dropdown.dataset.filterOwner;
            }
        });
    }

    return {
        getMoneyMarketFundLogoUrl,
        getMoneyMarketFundTokenLogoClass,
        getCashEquivalentFundDisplayName,
        getCashEquivalentTickerLabel,
        formatInvestmentTickerForDisplay,
        getInvestmentKnownTickerCompanyNames,
        isInvestmentTickerFallbackCompanyName,
        resolveKnownInvestmentTickerCompanyName,
        resolveInvestmentTickerProfile,
        resolveInvestmentTickerCompanyName,
        renderInvestmentTickerIdentityNameHtml,
        getInvestmentBrokerMeta,
        sortInvestmentBrokerFilterCodes,
        rebuildInvestmentBrokerFilterTransactionIndex,
        ensureInvestmentBrokerFilterTransactionIndex,
        computeAvailableInvestmentBrokerCodes,
        refreshInvestmentAvailableBrokerCodes,
        getAvailableInvestmentBrokerCodes,
        getInvestmentBrokerFilterSelectedCodes,
        matchesInvestmentBrokerFilter,
        initializeInvestmentBrokerFilterSelection,
        getInvestmentBrokerSummarySelectedCode,
        isInvestmentBrokerSummaryFilterField,
        isInvestmentMetricsHistoryBrokerFilterField,
        renderInvestmentBrokerFilterHeaderInnerMarkup,
        getInvestmentBrokerFilterScopeId,
        getInvestmentBrokerFilterViewForField,
        syncInvestmentBrokerFilterTrigger,
        estimateInvestmentFilterDropdownWidth,
        estimateInvestmentBrokerFilterDropdownWidth,
        getInvestmentBrokerFilterDropdown,
        portalInvestmentBrokerFilterDropdown,
        restoreInvestmentBrokerFilterDropdown,
        positionInvestmentBrokerFilterDropdown,
        scheduleInvestmentBrokerFilterDropdownPosition,
        setInvestmentBrokerFilterDropdownOpen,
        closeInvestmentBrokerFilterDropdowns,
        createInvestmentBrokerFilterOptionButton,
        applyInvestmentBrokerSummarySelection,
        renderInvestmentBrokerFilterDropdown,
        syncInvestmentBrokerFilterField,
        syncAllInvestmentBrokerFilterUi,
        bindInvestmentBrokerFilterField,
        ensureInvestmentBrokerFilterDocumentListeners,
        mountInvestmentBrokerFilterHeaders,
        mountInvestmentBrokerSummarySelector,
        ensureInvestmentMetricsBrokerScope,
        renderInvestmentSideFilterHeaderInnerMarkup,
        closeInvestmentSideFilterDropdowns,
        applyInvestmentSideFilter,
        openInvestmentSideFilterDropdown,
        bindInvestmentSideFilterField,
        mountInvestmentSideFilterHeaders,
        getAvailableInvestmentCurrencyCodes,
        normalizeInvestmentCurrencyFilter,
        matchesInvestmentCurrencyFilter,
        renderInvestmentCurrencyFilterHeaderInnerMarkup,
        closeInvestmentCurrencyFilterDropdowns,
        applyInvestmentCurrencyFilter,
        openInvestmentCurrencyFilterDropdown,
        bindInvestmentCurrencyFilterField,
        mountInvestmentCurrencyFilterHeaders,
        getInvestmentHistoryTransactionsForCurrentScope,
        hasInvestmentDescriptionBindingFilterOptions,
        normalizeInvestmentDescriptionBindingFilter,
        renderInvestmentDescriptionBindingFilterHeaderInnerMarkup,
        closeInvestmentDescriptionBindingFilterDropdowns,
    };
}

