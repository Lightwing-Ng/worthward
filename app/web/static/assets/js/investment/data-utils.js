/**
 * Investment transaction and valuation helpers.
 *
 * Code version: v1.47.0
 * - Added: Broker-scoped authoritative P&L calibration so Longbridge HK and SG can coexist without overwriting each other's ticker results.
 * - Added: Authoritative broker performance snapshots can calibrate selected Holdings P&L rows without changing the transaction cash ledger.
 * - Fixed: Broker P&L-excluded correction rows retain their cash impact without inflating per-symbol realized P&L.
 * - Fixed: Longbridge HK money-market placements and redemptions display their actual transfer amount while ledger equity uses only the importer-provided interest delta.
 * - Fixed: IBKR forex trade component rows now display the acquired quote currency and a compact conversion description derived from the pair rate.
 * - Fixed: Cash equivalent ticker settings now preserve an explicitly empty configured list instead of falling back to money-market defaults.
 * - Added: KOL reward rows are classified as realized income instead of ordinary deposits for funding and P&L metrics.
 * - Fixed: Broker-imported buy/sell rows now keep authoritative share counts during holdings replay instead of rescaling quantities to match split-adjusted chart closes.
 * - Fixed: Zero-price grant rows now inherit same-day rendered split factors from sibling trades, preventing stale proxy histories from leaving phantom SPYM/SPLG shares.
 * - Fixed: Split-factor replay now ignores SPY lineage proxy prices and rejects downscaling factors so SPLG grants cannot collapse into phantom SPYM short positions after git pull.
 * - Added: Exported module version metadata so browser-side cache drift can be diagnosed without manually inspecting loaded source files.
 * - Fixed: Exported lineage profile lookup helpers so investment entry code can resolve canonical successors such as SPYM without ReferenceErrors.
 * - Fixed: Transaction descriptions now render canonical investment tickers so MSFT.US displays as MSFT and SPLG.US displays as SPYM.
 * - Fixed: Holdings and stock-details aggregation now canonicalizes market-store tickers so MSFT.US rolls into MSFT and legacy SPLG.US rolls into SPYM without mutating the imported ledger.
 * - Fixed: Broker statements without intraday timestamps now replay same-time funding rows before trades and withdrawals so cash/equity does not dip negative from row order alone.
 * - Fixed: Investment ticker lineage now prefers current successor/base market stores before stale legacy `.US` caches, including SPLG to SPYM.
 * - Changed: HSBC same-day history now sorts funding cash rows ahead of trade executions, while executions still follow ascending reference codes and can reuse hidden settlement rows only as internal cash-after calibration
 * - Added: Stock details range filtering now supports a 1Y window plus an Auto lifecycle mode that keeps all buy and sell dates visible while trimming unrelated post-exit history
 * - Added: Equity range filtering now supports a 1Y window for the main portfolio overview chart
 */

export function createInvestmentDataUtils({
    noCommissionTransactionTypes,
    investmentCommonSplitFactors,
    parseInvestmentDateParts,
    formatInvestmentShortDateParts,
    normalizeInvestmentTicker,
    normalizeInvestmentStockDetailsRange,
    normalizeInvestmentEquityRange,
}) {
    const INVESTMENT_BASE_CURRENCY = 'USD';
    const INVESTMENT_MARKET_CURRENCY_BY_SUFFIX = {
        US: 'USD',
        HK: 'HKD',
        SH: 'CNY',
        SZ: 'CNY',
        SG: 'SGD',
    };

    function getNormalizedTransactionType(txn) {
        return String(txn?.type || '').replace(/\s+/g, '_').toLowerCase();
    }

    function getTransactionQuantity(txn) {
        const quantity = txn.quantity ?? txn.quantity_abs ?? txn.normalized?.position_quantity;
        return quantity === undefined || quantity === null ? null : Number(quantity);
    }

    function getTransactionAmount(txn) {
        if (txn.normalized?.net_amount !== undefined && txn.normalized?.net_amount !== null) {
            return Number(txn.normalized.net_amount);
        }
        if (txn.amount !== undefined && txn.amount !== null) {
            return Number(txn.amount);
        }
        if (txn.cash !== undefined && txn.cash !== null) {
            return Number(txn.cash);
        }
        return 0;
    }

    function getTransactionCommission(txn) {
        const commission = txn?.normalized?.commission ?? txn?.commission ?? 0;
        const numericCommission = Number(commission);
        const manualTransferCommission = Number(txn?.manual_internal_transfer_commission_amount ?? 0);
        return (Number.isFinite(numericCommission) ? numericCommission : 0)
            + (Number.isFinite(manualTransferCommission) ? manualTransferCommission : 0);
    }

    function getTransactionCashSortAmount(txn) {
        const amount = getTransactionAmount(txn);
        const numericAmount = Number(amount);
        if (Number.isFinite(numericAmount) && Math.abs(numericAmount) > 1e-9) {
            return numericAmount;
        }
        const normalizedAmount = txn?.normalized?.cash_flow_amount
            ?? txn?.normalized?.accounting_adjustment_amount
            ?? txn?.net_amount_raw
            ?? txn?.gross_amount_raw;
        const numericNormalizedAmount = Number(normalizedAmount);
        return Number.isFinite(numericNormalizedAmount) ? numericNormalizedAmount : 0;
    }

    function getSameTimeCashSafetySortCategory(txn) {
        const normalizedType = getNormalizedTransactionType(txn);
        const cashAmount = getTransactionCashSortAmount(txn);
        if (cashAmount > 1e-9) return 0;
        if (['deposit', 'kol_reward', 'sell', 'dividend', 'credit_interest', 'payment_in_lieu'].includes(normalizedType)) return 0;
        if (['buy', 'dividend_reinvestment', 'grant'].includes(normalizedType)) return 1;
        if (cashAmount < -1e-9) return 2;
        if (['withdrawal', 'foreign_tax_withholding', 'debit_interest'].includes(normalizedType)) return 2;
        return 1;
    }

    function getInvestmentStartingCash() {
        const rawValue = window.ANTIGRAVITY_INVESTMENT_DATA?.starting_cash;
        if (rawValue === undefined || rawValue === null || rawValue === '') {
            return 0;
        }
        const numericValue = Number(rawValue);
        return Number.isFinite(numericValue) ? numericValue : 0;
    }

    function getInvestmentEndingCash() {
        const rawValue = window.ANTIGRAVITY_INVESTMENT_DATA?.ending_cash;
        if (rawValue === undefined || rawValue === null || rawValue === '') {
            return null;
        }
        const numericValue = Number(rawValue);
        return Number.isFinite(numericValue) ? numericValue : null;
    }

    function getInvestmentBrokerEndingCash(brokerCode) {
        const normalizedBroker = String(brokerCode || '').trim().toLowerCase();
        if (!normalizedBroker) return null;
        const summaries = window.ANTIGRAVITY_INVESTMENT_DATA?.broker_summaries;
        if (!summaries || typeof summaries !== 'object') return null;
        const summary = summaries[normalizedBroker];
        if (!summary || typeof summary !== 'object') return null;
        const rawValue = summary.ending_cash ?? summary.ending_cash_raw;
        if (rawValue === undefined || rawValue === null || rawValue === '') {
            return null;
        }
        const numericValue = Number(rawValue);
        return Number.isFinite(numericValue) ? numericValue : null;
    }

    function normalizeCurrencyCode(value) {
        return String(value || '').trim().toUpperCase();
    }

    function getInvestmentBaseCurrency() {
        return INVESTMENT_BASE_CURRENCY;
    }

    function isKolRewardTransaction(txn) {
        const normalizedType = getNormalizedTransactionType(txn);
        if (normalizedType === 'kol_reward') return true;
        if (normalizedType !== 'deposit') return false;
        const rawFlow = String(txn?.source?.transaction_type_raw || '').trim().toLowerCase();
        if (rawFlow === 'kol') return true;
        return /kol\s+rewards?/i.test(String(txn?.description || '').trim());
    }

    function sumKolRewardRealizedIncomeInBaseCurrency(
        transactions,
        fxTimeline,
        baseCurrency = INVESTMENT_BASE_CURRENCY,
    ) {
        return (Array.isArray(transactions) ? transactions : []).reduce((total, txn) => {
            if (!isKolRewardTransaction(txn)) return total;
            const amount = getTransactionAmount(txn);
            const currency = formatTransactionCurrency(txn) || baseCurrency;
            const ledgerDate = normalizeLedgerDate(txn?.date);
            return total + convertAmountToBaseCurrency(
                amount,
                currency,
                ledgerDate,
                fxTimeline,
                baseCurrency,
            );
        }, 0);
    }

    function getTickerQuoteCurrency(ticker) {
        const normalizedTicker = normalizeInvestmentTicker(ticker);
        if (!normalizedTicker) return INVESTMENT_BASE_CURRENCY;
        if (isForexPairTicker(normalizedTicker)) {
            const [baseCurrency] = normalizedTicker.split('.');
            return normalizeCurrencyCode(baseCurrency) || INVESTMENT_BASE_CURRENCY;
        }
        const suffix = normalizedTicker.includes('.')
            ? normalizedTicker.split('.').pop()
            : '';
        return INVESTMENT_MARKET_CURRENCY_BY_SUFFIX[normalizeCurrencyCode(suffix)] || INVESTMENT_BASE_CURRENCY;
    }

    function createCashLedger(startingCash = 0, baseCurrency = INVESTMENT_BASE_CURRENCY) {
        const normalizedBaseCurrency = normalizeCurrencyCode(baseCurrency) || INVESTMENT_BASE_CURRENCY;
        const balances = {};
        const numericStartingCash = Number(startingCash);
        if (Number.isFinite(numericStartingCash) && Math.abs(numericStartingCash) > 1e-9) {
            balances[normalizedBaseCurrency] = numericStartingCash;
        }
        return balances;
    }

    function cloneCashLedgerBalances(balances) {
        return Object.entries(balances || {}).reduce((snapshot, [currency, value]) => {
            const normalizedCurrency = normalizeCurrencyCode(currency);
            const numericValue = Number(value);
            if (!normalizedCurrency || !Number.isFinite(numericValue) || Math.abs(numericValue) < 1e-9) {
                return snapshot;
            }
            snapshot[normalizedCurrency] = numericValue;
            return snapshot;
        }, {});
    }

    function addCashLedgerDelta(balances, currency, amount, baseCurrency = INVESTMENT_BASE_CURRENCY) {
        const numericAmount = Number(amount);
        if (!Number.isFinite(numericAmount) || Math.abs(numericAmount) < 1e-9) return;
        const normalizedCurrency = normalizeCurrencyCode(currency) || normalizeCurrencyCode(baseCurrency) || INVESTMENT_BASE_CURRENCY;
        balances[normalizedCurrency] = (Number(balances[normalizedCurrency]) || 0) + numericAmount;
        if (Math.abs(balances[normalizedCurrency]) < 1e-9) {
            delete balances[normalizedCurrency];
        }
    }

    function isCurrencyConversionCashFlow(txn) {
        const normalizedType = getNormalizedTransactionType(txn);
        if (!['deposit', 'withdrawal'].includes(normalizedType)) return false;
        return /^Currency Conversion \((Credit|Debit)\)$/i.test(String(txn?.description || '').trim());
    }

    function isForexConversionTimelineRow(txn) {
        if (isCurrencyConversionCashFlow(txn)) return true;
        const normalizedType = getNormalizedTransactionType(txn);
        if (normalizedType !== 'forex_trade_component') return false;
        const description = String(txn?.description || '').trim();
        if (/^FX FROM /i.test(description)) return true;
        return /^Currency Conversion \((Credit|Debit)\)$/i.test(
            String(txn?.source?.transaction_type_raw || '').trim(),
        );
    }

    function getForexConversionTimelineGroupKey(txn, ledgerDate) {
        const broker = String(txn?.broker || '').trim().toLowerCase();
        const account = String(txn?.account || '').trim();
        const description = normalizeTransactionDescriptionWhitespace(txn?.description || '');
        if (description) {
            return `${broker}|${account}|${ledgerDate}|${description.toUpperCase()}`;
        }
        const flowName = String(txn?.source?.transaction_type_raw || '').trim().toUpperCase();
        const datetimeKey = String(txn?.datetime || txn?.date || '').trim();
        return `${broker}|${account}|${ledgerDate}|${datetimeKey}|${flowName}`;
    }

    function recordFxRateForDate(dateRates, currency, date, rate) {
        const normalizedCurrency = normalizeCurrencyCode(currency);
        const normalizedDate = normalizeLedgerDate(date);
        const numericRate = Number(rate);
        if (!normalizedCurrency || !normalizedDate || !Number.isFinite(numericRate) || numericRate <= 0) return;
        if (!dateRates[normalizedCurrency]) {
            dateRates[normalizedCurrency] = {};
        }
        dateRates[normalizedCurrency][normalizedDate] = numericRate;
    }

    function getTodayLedgerDate() {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    function recordForexTradeFxRates(transactions, dateRates, baseCurrency = INVESTMENT_BASE_CURRENCY) {
        const normalizedBaseCurrency = normalizeCurrencyCode(baseCurrency) || INVESTMENT_BASE_CURRENCY;
        (Array.isArray(transactions) ? transactions : []).forEach((txn) => {
            const normalizedType = getNormalizedTransactionType(txn);
            if (!['forex_trade', 'forex_trade_component'].includes(normalizedType)) return;
            const forexPair = String(txn?.ticker || '').trim().toUpperCase();
            const [pairBase, pairQuote] = forexPair.split('.');
            if (pairBase !== normalizedBaseCurrency || !pairQuote) return;
            const rate = getTransactionPrice(txn);
            const ledgerDate = normalizeLedgerDate(txn?.date);
            if (!ledgerDate || !Number.isFinite(rate) || rate <= 0) return;
            recordFxRateForDate(dateRates, pairQuote, ledgerDate, rate);
        });
    }

    function buildInvestmentFxRateTimeline(transactions, baseCurrency = INVESTMENT_BASE_CURRENCY) {
        const normalizedBaseCurrency = normalizeCurrencyCode(baseCurrency) || INVESTMENT_BASE_CURRENCY;
        const groupedRows = new Map();
        (Array.isArray(transactions) ? transactions : []).forEach((txn, index) => {
            if (!isForexConversionTimelineRow(txn)) return;
            const ledgerDate = normalizeLedgerDate(txn?.date);
            if (!ledgerDate) return;
            const groupKey = getForexConversionTimelineGroupKey(txn, ledgerDate);
            if (!groupedRows.has(groupKey)) {
                groupedRows.set(groupKey, []);
            }
            groupedRows.get(groupKey).push({
                txn,
                index,
                amount: getTransactionAmount(txn),
                currency: normalizeCurrencyCode(formatTransactionCurrency(txn)),
                ledgerDate,
            });
        });

        const dateRates = {};
        groupedRows.forEach((entries) => {
            const baseEntries = entries.filter((entry) => (
                entry.currency === normalizedBaseCurrency
                && Number.isFinite(entry.amount)
                && Math.abs(entry.amount) > 1e-9
            ));
            if (!baseEntries.length) return;

            entries.forEach((entry) => {
                if (entry.currency === normalizedBaseCurrency) return;
                if (!Number.isFinite(entry.amount) || Math.abs(entry.amount) <= 1e-9) return;

                const matchedBaseEntry = baseEntries.find((baseEntry) => (
                    Math.sign(baseEntry.amount) !== Math.sign(entry.amount)
                ));
                if (!matchedBaseEntry) return;

                const inferredRate = Math.abs(entry.amount) / Math.abs(matchedBaseEntry.amount);
                recordFxRateForDate(dateRates, entry.currency, entry.ledgerDate, inferredRate);
            });
        });
        recordForexTradeFxRates(transactions, dateRates, normalizedBaseCurrency);

        const timeline = {
            baseCurrency: normalizedBaseCurrency,
            ratesByCurrency: {
                [normalizedBaseCurrency]: {
                    dates: [],
                    values: {},
                },
            },
        };

        Object.entries(dateRates).forEach(([currency, dateMap]) => {
            const dates = Object.keys(dateMap).sort();
            timeline.ratesByCurrency[currency] = {
                dates,
                values: { ...dateMap },
            };
        });
        return timeline;
    }

    function getFxRateForDate(fxTimeline, currency, targetDate) {
        const normalizedCurrency = normalizeCurrencyCode(currency);
        const baseCurrency = normalizeCurrencyCode(fxTimeline?.baseCurrency) || INVESTMENT_BASE_CURRENCY;
        if (!normalizedCurrency || normalizedCurrency === baseCurrency) return 1;
        const normalizedDate = normalizeLedgerDate(targetDate);
        const entry = fxTimeline?.ratesByCurrency?.[normalizedCurrency];
        if (!normalizedDate || !entry) return null;
        const dates = Array.isArray(entry.dates) ? entry.dates : [];
        for (let index = dates.length - 1; index >= 0; index -= 1) {
            if (dates[index] <= normalizedDate) {
                const rate = Number(entry.values?.[dates[index]]);
                return Number.isFinite(rate) && rate > 0 ? rate : null;
            }
        }
        for (let index = 0; index < dates.length; index += 1) {
            if (dates[index] >= normalizedDate) {
                const rate = Number(entry.values?.[dates[index]]);
                return Number.isFinite(rate) && rate > 0 ? rate : null;
            }
        }
        return null;
    }

    function getLatestFxRateForCurrency(fxTimeline, currency) {
        const normalizedCurrency = normalizeCurrencyCode(currency);
        const baseCurrency = normalizeCurrencyCode(fxTimeline?.baseCurrency) || INVESTMENT_BASE_CURRENCY;
        if (!normalizedCurrency || normalizedCurrency === baseCurrency) return 1;
        const entry = fxTimeline?.ratesByCurrency?.[normalizedCurrency];
        const dates = Array.isArray(entry?.dates) ? entry.dates : [];
        if (!dates.length) return null;
        const latestDate = dates[dates.length - 1];
        const rate = Number(entry?.values?.[latestDate]);
        return Number.isFinite(rate) && rate > 0 ? rate : null;
    }

    function convertAmountToBaseCurrencyAtLatestRate(amount, currency, fxTimeline, baseCurrency = INVESTMENT_BASE_CURRENCY) {
        const numericAmount = Number(amount);
        if (!Number.isFinite(numericAmount) || Math.abs(numericAmount) < 1e-9) return 0;
        const normalizedCurrency = normalizeCurrencyCode(currency) || normalizeCurrencyCode(baseCurrency) || INVESTMENT_BASE_CURRENCY;
        const normalizedBaseCurrency = normalizeCurrencyCode(baseCurrency) || INVESTMENT_BASE_CURRENCY;
        if (normalizedCurrency === normalizedBaseCurrency) {
            return numericAmount;
        }
        const todayRate = getFxRateForDate(fxTimeline, normalizedCurrency, getTodayLedgerDate());
        if (Number.isFinite(todayRate) && todayRate > 0) {
            return numericAmount / todayRate;
        }
        const latestRate = getLatestFxRateForCurrency(fxTimeline, normalizedCurrency);
        if (Number.isFinite(latestRate) && latestRate > 0) {
            return numericAmount / latestRate;
        }
        return numericAmount;
    }

    function convertAmountToBaseCurrency(amount, currency, targetDate, fxTimeline, baseCurrency = INVESTMENT_BASE_CURRENCY) {
        const numericAmount = Number(amount);
        if (!Number.isFinite(numericAmount) || Math.abs(numericAmount) < 1e-9) return 0;
        const normalizedCurrency = normalizeCurrencyCode(currency) || normalizeCurrencyCode(baseCurrency) || INVESTMENT_BASE_CURRENCY;
        const normalizedBaseCurrency = normalizeCurrencyCode(baseCurrency) || INVESTMENT_BASE_CURRENCY;
        if (normalizedCurrency === normalizedBaseCurrency) {
            return numericAmount;
        }
        const rate = getFxRateForDate(fxTimeline, normalizedCurrency, targetDate);
        if (Number.isFinite(rate) && rate > 0) {
            return numericAmount / rate;
        }
        return numericAmount;
    }

    function sumCashLedgerInBaseCurrency(balances, targetDate, fxTimeline, baseCurrency = INVESTMENT_BASE_CURRENCY) {
        return Object.entries(balances || {}).reduce((total, [currency, value]) => (
            total + convertAmountToBaseCurrency(value, currency, targetDate, fxTimeline, baseCurrency)
        ), 0);
    }

    function getTransactionPrice(txn) {
        if (txn.normalized?.unit_price !== undefined && txn.normalized?.unit_price !== null) {
            return Number(txn.normalized.unit_price);
        }
        if (txn.price !== undefined && txn.price !== null) {
            return Number(txn.price);
        }
        return null;
    }

    function getTransactionEconomicAmount(txn) {
        if (txn?.normalized?.cash_equivalent_transfer === true) {
            const transferAmount = Number(
                txn?.normalized?.display_amount
                ?? txn?.gross_amount_raw
                ?? txn?.source?.cash_equivalent_transfer_amount_raw
                ?? 0
            );
            return Number.isFinite(transferAmount) ? transferAmount : 0;
        }
        const amount = getTransactionAmount(txn);
        if (Math.abs(amount) > 1e-9) return amount;

        const normalizedType = getNormalizedTransactionType(txn);
        const quantity = getTransactionQuantity(txn);
        const price = getTransactionPrice(txn);
        if (quantity === null || price === null || Number.isNaN(quantity) || Number.isNaN(price)) {
            return amount;
        }

        if (['buy', 'sell', 'grant'].includes(normalizedType)) {
            return quantity * price;
        }

        return amount;
    }

    function formatTransactionDateDisplay(txn) {
        const hsbcTradeDateDisplay = String(txn?.source?.captured_order_date_display || '').trim();
        if (hsbcTradeDateDisplay && String(txn?.broker || '').trim().toLowerCase() === 'hsbc') {
            const match = hsbcTradeDateDisplay.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})/);
            if (match) {
                const monthMap = {
                    Jan: '01',
                    Feb: '02',
                    Mar: '03',
                    Apr: '04',
                    May: '05',
                    Jun: '06',
                    Jul: '07',
                    Aug: '08',
                    Sep: '09',
                    Oct: '10',
                    Nov: '11',
                    Dec: '12',
                };
                const day = String(match[1]).padStart(2, '0');
                const month = monthMap[String(match[2]).slice(0, 1).toUpperCase() + String(match[2]).slice(1, 3).toLowerCase()] || '';
                if (month) {
                    return `${day}/${month}/${match[3]}`;
                }
            }
            return hsbcTradeDateDisplay.replace(/\s+U\.S\.\s+ET$/i, '').trim();
        }
        const rawDate = String(txn?.date || '').trim();
        const dateParts = parseInvestmentDateParts(rawDate);
        if (!dateParts) return rawDate;
        const baseDate = formatInvestmentShortDateParts(dateParts);
        if (!rawDate.includes(' ') || rawDate.endsWith('20:00:00')) {
            return baseDate;
        }
        const timeText = rawDate.split(' ')[1] || '';
        return timeText ? `${baseDate} ${timeText}` : baseDate;
    }

    function formatAmountWithCurrency(value, currency, { showUsdSymbol = true } = {}) {
        if (value === undefined || value === null || Number.isNaN(Number(value))) return '--';
        const numericValue = Number(value);
        const sign = numericValue < 0 ? '-' : '';
        const absDisplay = formatAmount(Math.abs(numericValue));
        const normalizedCurrency = String(currency || '').trim().toUpperCase();
        if (normalizedCurrency === 'USD') {
            return showUsdSymbol ? `${sign}$${absDisplay}` : `${sign}${absDisplay}`;
        }
        if (normalizedCurrency) {
            return `${sign}${normalizedCurrency} ${absDisplay}`;
        }
        return `${sign}${absDisplay}`;
    }

    function formatTransactionCommissionDisplay(txn, { includeCurrency = false } = {}) {
        const normalizedType = getNormalizedTransactionType(txn);
        const commission = getTransactionCommission(txn);
        const feeRowNumbers = Array.isArray(txn?.source?.cash_flow_fee_row_numbers)
            ? txn.source.cash_flow_fee_row_numbers.filter((value) => Number.isFinite(Number(value)))
            : [];
        if ((!commission || Math.abs(commission) < 1e-9) && noCommissionTransactionTypes.has(normalizedType)) {
            return '-';
        }
        if ((!commission || Math.abs(commission) < 1e-9) && ['buy', 'sell'].includes(normalizedType) && !feeRowNumbers.length) {
            return '-';
        }
        const absoluteCommission = Math.abs(commission);
        if (!includeCurrency) {
            return formatAmount(absoluteCommission);
        }
        return formatAmountWithCurrency(absoluteCommission, formatTransactionCurrency(txn));
    }

    function formatTransactionCurrency(txn) {
        const normalizedType = getNormalizedTransactionType(txn);
        if (normalizedType === 'forex_trade_component') {
            const forexPair = String(txn?.ticker || '').trim();
            const [, quoteCurrency] = forexPair.split('.');
            if (quoteCurrency) return quoteCurrency;
            const explicitCurrency = String(txn?.currency || '').trim();
            if (explicitCurrency) return explicitCurrency;
            return '';
        }

        const explicitCurrency = String(txn?.currency || '').trim();
        if (explicitCurrency) return explicitCurrency;

        const ticker = String(txn?.ticker || '').trim();
        if (ticker) return getTickerQuoteCurrency(ticker);

        return '';
    }

    function formatForexTradeComponentDescription(txn) {
        const forexPair = String(txn?.ticker || '').trim();
        const [baseCurrency, quoteCurrency] = forexPair.split('.');
        const quantity = getTransactionQuantity(txn);
        const rate = getTransactionPrice(txn);

        if (!baseCurrency || !quoteCurrency || !Number.isFinite(quantity) || !Number.isFinite(rate)) {
            return txn.description || '--';
        }

        const acquiredQuantity = quantity * rate;
        const quantityText = Number.isInteger(acquiredQuantity)
            ? `${acquiredQuantity}`
            : formatAmount(acquiredQuantity);
        const rateText = String(txn.price_raw ?? txn.normalized?.unit_price ?? rate);
        return `Bought ${quantityText} ${quoteCurrency} @ ${baseCurrency}.${quoteCurrency} ${rateText}`;
    }

    function normalizeTransactionDescriptionWhitespace(value) {
        return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function getTransactionDescriptionText(txn, fallback = '--', { normalizeWhitespace = false } = {}) {
        const rawDescription = normalizeWhitespace
            ? normalizeTransactionDescriptionWhitespace(txn?.description)
            : String(txn?.description || '').trim();
        return rawDescription || fallback;
    }

    function getHsbcReferenceCodeSummary(txn) {
        const rawCodes = [
            String(txn?.source?.statement_order_id || txn?.source?.order_id || '').trim(),
            String(txn?.source?.cash_settlement_reference || '').replace(/\s+/g, ' ').trim(),
        ].filter(Boolean);
        if (!rawCodes.length) return '';
        return Array.from(new Set(rawCodes)).join(', ');
    }

    function getHsbcOrderSequenceNumber(txn) {
        const rawReference = String(txn?.source?.statement_order_id || txn?.source?.order_id || '').trim().toUpperCase();
        const match = rawReference.match(/^[PS]-(\d+)$/);
        return match ? Number(match[1]) : Number.NaN;
    }

    function getHsbcSortCategory(txn) {
        const fileKind = String(txn?.source?.file_kind || '').trim().toLowerCase();
        const normalizedType = getNormalizedTransactionType(txn);
        if (fileKind === 'hsbc_usd_account_text') {
            if (['deposit', 'credit_interest'].includes(normalizedType)) return 0;
            if (['withdrawal', 'debit_interest'].includes(normalizedType)) return 2;
            return 3;
        }
        if (fileKind === 'hsbc_order_status_text' || fileKind === 'hsbc_order_status_capture') {
            return 1;
        }
        return 9;
    }

    function formatTransactionDescription(txn) {
        let description;
        let qty = txn.quantity ?? txn.quantity_abs ?? txn.normalized?.display_quantity;
        const price = txn.normalized?.unit_price ?? txn.price;
        const normalizedTypeDesc = getNormalizedTransactionType(txn);
        const brokerCode = String(txn?.broker || txn?.source?.broker || '').trim().toLowerCase();

        if (normalizedTypeDesc === 'forex_trade_component') {
            return formatForexTradeComponentDescription(txn);
        }

        if (txn.ticker && qty) {
            const displayTicker = getInvestmentCanonicalTicker(txn.ticker) || txn.ticker;
            const cleanQty = Number.isInteger(Number(qty)) ? String(parseInt(qty, 10)) : qty;
            if (price && ['buy', 'sell', 'grant'].includes(normalizedTypeDesc)) {
                const cleanPrice = Number(price).toFixed(2);
                description = `${displayTicker} @ ${cleanPrice} × ${cleanQty}`;
            } else {
                description = `${displayTicker}@${cleanQty}`;
            }
        } else if (brokerCode === 'hsbc' && ['deposit', 'withdrawal'].includes(normalizedTypeDesc)) {
            description = getTransactionDescriptionText(
                txn,
                normalizedTypeDesc === 'deposit' ? '* Equivalent' : '--',
                { normalizeWhitespace: true }
            );
        } else if (normalizedTypeDesc === 'deposit') {
            description = '* Equivalent';
        } else if (normalizedTypeDesc === 'withdrawal') {
            description = '';
        } else {
            description = getTransactionDescriptionText(txn);
        }

        if (brokerCode === 'hsbc' && ['buy', 'sell'].includes(normalizedTypeDesc)) {
            const referenceSummary = getHsbcReferenceCodeSummary(txn);
            if (referenceSummary) {
                return `${description} · ${referenceSummary}`;
            }
        }

        return description;
    }

    function formatHoldingsMoney(value, { dashWhenZero = false } = {}) {
        if (value === null || value === undefined || Number.isNaN(value)) return '-';
        if (dashWhenZero && Math.abs(value) < 1e-9) return '-';
        return new Intl.NumberFormat('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        }).format(value);
    }

    function formatSignedHoldingsMoney(value) {
        if (value === null || value === undefined || Number.isNaN(Number(value))) return '-';
        const numericValue = Number(value);
        if (Math.abs(numericValue) < 1e-9) return formatHoldingsMoney(0);
        return `${numericValue > 0 ? '+' : '-'}${formatHoldingsMoney(Math.abs(numericValue))}`;
    }

    function formatHoldingsPercent(value) {
        if (value === null || value === undefined || Number.isNaN(value)) return '-';
        return `${new Intl.NumberFormat('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        }).format(value)}%`;
    }

    function formatHoldingsUsd(value, { dashWhenNull = false } = {}) {
        if (value === null || value === undefined || Number.isNaN(value)) {
            return dashWhenNull ? '-' : '$0.00';
        }
        const sign = value < 0 ? '-' : '';
        return `${sign}$${formatHoldingsMoney(Math.abs(value))}`;
    }

    function formatHoldingsPosition(quantity) {
        if (quantity === null || quantity === undefined || Number.isNaN(quantity) || Math.abs(quantity) < 1e-9) {
            return '-';
        }
        const hasFraction = Math.abs(quantity - Math.round(quantity)) > 1e-9;
        return new Intl.NumberFormat('en-US', {
            minimumFractionDigits: hasFraction ? 2 : 0,
            maximumFractionDigits: hasFraction ? 4 : 0,
        }).format(quantity);
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function shouldTrackHoldingTicker(txn) {
        const ticker = String(txn?.ticker || '').trim();
        if (!ticker) return false;
        const normalizedType = getNormalizedTransactionType(txn);
        if (['forex_trade', 'forex_trade_component', 'fx_translation_pnl'].includes(normalizedType)) return false;
        return !isForexPairTicker(ticker);
    }

    function isForexPairTicker(ticker) {
        return /^[A-Z]{3}\.[A-Z]{3}$/i.test(String(ticker || '').trim());
    }

    function isFlatPosition(value) {
        return !Number.isFinite(value) || Math.abs(value) < 1e-9;
    }

    function createPositionState(ticker) {
        return {
            ticker,
            shares: 0,
            totalCost: 0,
            realizedPnl: 0,
            lastCloseDate: null,
        };
    }

    function compareInvestmentTransactions(leftTxn, rightTxn, leftIndex = 0, rightIndex = 0) {
        const leftDatetime = String(leftTxn?.datetime || leftTxn?.date || '');
        const rightDatetime = String(rightTxn?.datetime || rightTxn?.date || '');
        if (leftDatetime !== rightDatetime) {
            return leftDatetime.localeCompare(rightDatetime);
        }
        const leftDate = String(leftTxn?.date || '');
        const rightDate = String(rightTxn?.date || '');
        if (leftDate !== rightDate) {
            return leftDate.localeCompare(rightDate);
        }
        const leftBroker = String(leftTxn?.broker || leftTxn?.source?.broker || '').trim().toLowerCase();
        const rightBroker = String(rightTxn?.broker || rightTxn?.source?.broker || '').trim().toLowerCase();
        if (leftBroker === 'hsbc' && rightBroker === 'hsbc') {
            const leftCategory = getHsbcSortCategory(leftTxn);
            const rightCategory = getHsbcSortCategory(rightTxn);
            if (leftCategory !== rightCategory) {
                return leftCategory - rightCategory;
            }
            const leftSequence = getHsbcOrderSequenceNumber(leftTxn);
            const rightSequence = getHsbcOrderSequenceNumber(rightTxn);
            if (Number.isFinite(leftSequence) && Number.isFinite(rightSequence) && leftSequence !== rightSequence) {
                return leftSequence - rightSequence;
            }
        }
        const leftCashCategory = getSameTimeCashSafetySortCategory(leftTxn);
        const rightCashCategory = getSameTimeCashSafetySortCategory(rightTxn);
        if (leftCashCategory !== rightCashCategory) {
            return leftCashCategory - rightCashCategory;
        }
        const leftCashAmount = getTransactionCashSortAmount(leftTxn);
        const rightCashAmount = getTransactionCashSortAmount(rightTxn);
        if (leftCashCategory === 0 && leftCashAmount !== rightCashAmount) {
            return rightCashAmount - leftCashAmount;
        }
        if (leftCashCategory === 2 && leftCashAmount !== rightCashAmount) {
            return rightCashAmount - leftCashAmount;
        }
        const leftRow = Number(leftTxn?.source?.row_number ?? leftIndex);
        const rightRow = Number(rightTxn?.source?.row_number ?? rightIndex);
        return leftRow - rightRow;
    }

    function getAuthoritativePositionSnapshot() {
        if (window.ANTIGRAVITY_INVESTMENT_DATA?.summary?.position_snapshot_authoritative !== true) {
            return null;
        }
        const rawSnapshot = window.ANTIGRAVITY_INVESTMENT_DATA?.position_snapshot;
        if (!rawSnapshot || typeof rawSnapshot !== 'object') {
            return {};
        }
        const normalizedSnapshot = {};
        Object.entries(rawSnapshot).forEach(([ticker, snapshot]) => {
            const normalizedTicker = normalizeInvestmentTicker(ticker);
            if (!normalizedTicker || !snapshot || typeof snapshot !== 'object') return;
            const quantity = Number(snapshot.quantity);
            const costPrice = Number(snapshot.cost_price);
            const marketValue = Number(snapshot.market_value);
            const lastPrice = Number(snapshot.last_price);
            normalizedSnapshot[normalizedTicker] = {
                quantity: Number.isFinite(quantity) ? quantity : 0,
                costPrice: Number.isFinite(costPrice) ? costPrice : null,
                marketValue: Number.isFinite(marketValue) ? marketValue : null,
                lastPrice: Number.isFinite(lastPrice) ? lastPrice : null,
            };
        });
        return normalizedSnapshot;
    }

    function normalizeAuthoritativePerformanceSnapshot(rawSnapshot) {
        if (!rawSnapshot || typeof rawSnapshot !== 'object') {
            return {};
        }
        const normalizedSnapshot = {};
        Object.entries(rawSnapshot).forEach(([ticker, snapshot]) => {
            const normalizedTicker = getInvestmentCanonicalTicker(ticker);
            if (!normalizedTicker || !snapshot || typeof snapshot !== 'object') return;
            const realizedTotal = Number(snapshot.realized_total);
            if (!Number.isFinite(realizedTotal)) return;
            normalizedSnapshot[normalizedTicker] = {
                realizedTotal,
                currency: String(snapshot.currency || getTickerQuoteCurrency(normalizedTicker)).trim().toUpperCase(),
            };
        });
        return normalizedSnapshot;
    }

    function getAuthoritativePerformanceSnapshot() {
        if (window.ANTIGRAVITY_INVESTMENT_DATA?.summary?.performance_snapshot_authoritative !== true) {
            return null;
        }
        return normalizeAuthoritativePerformanceSnapshot(
            window.ANTIGRAVITY_INVESTMENT_DATA?.performance_snapshot,
        );
    }

    function getAuthoritativeBrokerPerformanceSnapshots() {
        const brokerSummaries = window.ANTIGRAVITY_INVESTMENT_DATA?.broker_summaries;
        if (!brokerSummaries || typeof brokerSummaries !== 'object') return {};
        const snapshots = {};
        Object.entries(brokerSummaries).forEach(([broker, summary]) => {
            if (!summary || typeof summary !== 'object') return;
            if (summary.performance_snapshot_authoritative !== true) return;
            const normalizedBroker = String(broker || summary.broker || '').trim().toLowerCase();
            if (!normalizedBroker) return;
            snapshots[normalizedBroker] = normalizeAuthoritativePerformanceSnapshot(
                summary.performance_snapshot,
            );
        });
        return snapshots;
    }

    function getTransactionEffectiveUnitPrice(txn, quantityOverride = null) {
        const quantity = quantityOverride ?? getTransactionQuantity(txn);
        if (quantity !== null && Number.isFinite(quantity) && quantity > 0) {
            if (txn?.normalized?.net_amount !== undefined && txn?.normalized?.net_amount !== null) {
                const normalizedAmount = Number(txn.normalized.net_amount);
                if (Number.isFinite(normalizedAmount) && Math.abs(normalizedAmount) > 1e-9) {
                    return Math.abs(normalizedAmount) / quantity;
                }
            }
            const normalizedType = getNormalizedTransactionType(txn);
            const economicAmount = getTransactionEconomicAmount(txn);
            const commission = Math.abs(getTransactionCommission(txn));
            if (Number.isFinite(economicAmount) && Math.abs(economicAmount) > 1e-9) {
                if (normalizedType === 'buy') {
                    return (Math.abs(economicAmount) + commission) / quantity;
                }
                if (normalizedType === 'sell') {
                    return Math.max(0, Math.abs(economicAmount) - commission) / quantity;
                }
                return Math.abs(economicAmount) / quantity;
            }
        }
        const price = getTransactionPrice(txn);
        return Number.isFinite(price) ? price : 0;
    }

    const INVESTMENT_LINEAGE_PROXY_TICKERS = new Set(['SPY', 'SPY.US']);

    function getInvestmentIdentityStoreAliasCandidates(ticker) {
        return getInvestmentTickerStoreAliasCandidates(ticker)
            .filter((candidate) => !INVESTMENT_LINEAGE_PROXY_TICKERS.has(candidate));
    }

    function getIndexedClosePriceForTransaction(txn, tickerPriceIndex) {
        const valuationDate = normalizeLedgerDate(txn?.date);
        if (!valuationDate || !tickerPriceIndex) return null;
        const candidates = [];
        const addCandidate = (value) => {
            const normalizedCandidate = normalizeInvestmentTicker(value);
            if (normalizedCandidate && !candidates.includes(normalizedCandidate)) {
                candidates.push(normalizedCandidate);
            }
        };
        addCandidate(txn?.ticker);
        addCandidate(getInvestmentCanonicalTicker(txn?.ticker));
        getInvestmentIdentityStoreAliasCandidates(txn?.ticker).forEach(addCandidate);
        for (let index = 0; index < candidates.length; index += 1) {
            const close = getIndexedClosePriceOnOrBefore(tickerPriceIndex[candidates[index]], valuationDate);
            if (Number.isFinite(close) && close > 0) {
                return close;
            }
        }
        return null;
    }

    function normalizeRenderedSplitFactor(factor) {
        if (!Number.isFinite(factor) || factor <= 0 || factor < 1) return 1;
        const roundedFactor = Math.round(factor);
        return Math.abs(factor - roundedFactor) < 0.08 && roundedFactor >= 2 ? roundedFactor : factor;
    }

    function getTransactionRenderedSplitFactor(txn, tickerPriceIndex) {
        if (!shouldTrackHoldingTicker(txn)) return 1;
        const normalizedType = getNormalizedTransactionType(txn);
        if (!['buy', 'sell', 'grant', 'dividend_reinvestment'].includes(normalizedType)) return 1;
        const rawPrice = getTransactionPrice(txn);
        if (!Number.isFinite(rawPrice) || rawPrice <= 0) return 1;
        const renderedClose = getIndexedClosePriceForTransaction(txn, tickerPriceIndex);
        const adjustedPrice = adjustTradePriceForRenderedSeries(rawPrice, renderedClose);
        if (!Number.isFinite(adjustedPrice) || adjustedPrice <= 0) return 1;
        return normalizeRenderedSplitFactor(rawPrice / adjustedPrice);
    }

    function getRenderedSplitFactorHintKey(txn) {
        const ticker = getInvestmentCanonicalTicker(txn?.ticker);
        const date = normalizeLedgerDate(txn?.date);
        return ticker && date ? `${ticker}|${date}` : '';
    }

    function buildRenderedSplitFactorHints(transactions, tickerPriceIndex) {
        const buckets = new Map();
        (Array.isArray(transactions) ? transactions : []).forEach((txn) => {
            if (!shouldTrackHoldingTicker(txn)) return;
            const normalizedType = getNormalizedTransactionType(txn);
            if (!['buy', 'sell', 'dividend_reinvestment'].includes(normalizedType)) return;
            const key = getRenderedSplitFactorHintKey(txn);
            if (!key) return;
            const factor = getTransactionRenderedSplitFactor(txn, tickerPriceIndex);
            if (!Number.isFinite(factor) || factor < 1 || Math.abs(factor - 1) < 1e-9) return;
            if (!buckets.has(key)) {
                buckets.set(key, []);
            }
            buckets.get(key).push(factor);
        });
        const hints = new Map();
        buckets.forEach((factors, key) => {
            const roundedCounts = new Map();
            factors.forEach((factor) => {
                const roundedKey = factor.toFixed(8);
                roundedCounts.set(roundedKey, (Number(roundedCounts.get(roundedKey)) || 0) + 1);
            });
            const [bestFactor] = Array.from(roundedCounts.entries())
                .sort((left, right) => right[1] - left[1] || Number(left[0]) - Number(right[0]))[0] || [];
            const numericFactor = Number(bestFactor);
            if (Number.isFinite(numericFactor) && numericFactor >= 1) {
                hints.set(key, numericFactor);
            }
        });
        return hints;
    }

    function hasAuthoritativeImportedPositionQuantity(txn) {
        const normalizedType = getNormalizedTransactionType(txn);
        if (!['buy', 'sell', 'dividend_reinvestment'].includes(normalizedType)) return false;
        if (
            txn?.normalized?.position_quantity !== undefined
            && txn?.normalized?.position_quantity !== null
            && String(txn.normalized.position_quantity).trim() !== ''
        ) {
            return true;
        }
        if (txn?.quantity_abs !== undefined && txn?.quantity_abs !== null && String(txn.quantity_abs).trim() !== '') {
            return true;
        }
        if (txn?.quantity_raw !== undefined && txn?.quantity_raw !== null && String(txn.quantity_raw).trim() !== '') {
            return true;
        }
        return false;
    }

    function getTransactionValuationQuantity(txn, tickerPriceIndex, renderedSplitFactorHints = null) {
        const quantity = getTransactionQuantity(txn);
        if (!Number.isFinite(quantity)) return quantity;
        const normalizedType = getNormalizedTransactionType(txn);
        if (hasAuthoritativeImportedPositionQuantity(txn)) {
            return quantity;
        }
        let factor = getTransactionRenderedSplitFactor(txn, tickerPriceIndex);
        if (
            normalizedType === 'grant'
            && (!Number.isFinite(factor) || Math.abs(factor - 1) < 1e-9)
            && renderedSplitFactorHints instanceof Map
        ) {
            const hintedFactor = renderedSplitFactorHints.get(getRenderedSplitFactorHintKey(txn));
            if (Number.isFinite(hintedFactor) && hintedFactor >= 1) {
                factor = hintedFactor;
            }
        }
        return quantity * (Number.isFinite(factor) && factor > 0 ? factor : 1);
    }

    function resetPositionState(state) {
        state.shares = 0;
        state.totalCost = 0;
    }

    function openPositionLots(state, side, quantity, unitPrice) {
        if (!Number.isFinite(quantity) || quantity <= 0) return;
        const signedQuantity = side === 'short' ? -quantity : quantity;
        state.shares += signedQuantity;
        state.totalCost += unitPrice * quantity;
    }

    function closePositionLots(state, quantity, unitPrice) {
        if (!Number.isFinite(quantity) || quantity <= 0 || isFlatPosition(state.shares)) return 0;

        const averagePrice = state.totalCost / Math.abs(state.shares);
        const isLongPosition = state.shares > 0;
        let realizedDelta = 0;

        if (isLongPosition) {
            realizedDelta = (unitPrice - averagePrice) * quantity;
            state.shares -= quantity;
        } else {
            realizedDelta = (averagePrice - unitPrice) * quantity;
            state.shares += quantity;
        }

        state.realizedPnl += realizedDelta;
        state.totalCost -= averagePrice * quantity;

        if (isFlatPosition(state.shares) || isFlatPosition(state.totalCost)) {
            resetPositionState(state);
        }
        return realizedDelta;
    }

    function applyDirectionalTrade(state, side, quantity, unitPrice) {
        if (!Number.isFinite(quantity) || quantity <= 0) return 0;

        if (isFlatPosition(state.shares)) {
            openPositionLots(state, side, quantity, unitPrice);
            return 0;
        }

        const currentSide = state.shares > 0 ? 'long' : 'short';
        if (currentSide === side) {
            openPositionLots(state, side, quantity, unitPrice);
            return 0;
        }

        const closingQuantity = Math.min(Math.abs(state.shares), quantity);
        const realizedDelta = closePositionLots(state, closingQuantity, unitPrice);

        const openingQuantity = quantity - closingQuantity;
        if (openingQuantity > 1e-9) {
            resetPositionState(state);
            openPositionLots(state, side, openingQuantity, unitPrice);
        }
        return realizedDelta;
    }

    function getMoneyMarketTickerSet() {
        const configuredTickers = window.ANTIGRAVITY_INVESTMENT_DATA?.money_market_tickers || [];
        return new Set(
            configuredTickers
                .map((ticker) => String(ticker || '').trim().toUpperCase())
                .filter(Boolean)
        );
    }

    function getCashEquivalentTickerSet() {
        let configuredTickers = window.ANTIGRAVITY_INVESTMENT_DATA?.cash_equivalent_tickers;
        if (!Array.isArray(configuredTickers)) {
            configuredTickers = window.ANTIGRAVITY_INVESTMENT_DATA?.money_market_tickers || [];
        }
        return new Set(
            (configuredTickers || [])
                .map((ticker) => String(ticker || '').trim().toUpperCase())
                .filter(Boolean)
        );
    }

    function getLatestDashboardEquity(processedTransactions, chartPoints = []) {
        const latestChartPoint = Array.isArray(chartPoints) && chartPoints.length
            ? chartPoints[chartPoints.length - 1]
            : null;
        const latestValuationEquity = Number(latestChartPoint?.aggregate_total_equity ?? latestChartPoint?.total_equity);
        if (Number.isFinite(latestValuationEquity)) {
            return latestValuationEquity;
        }

        const latestRecord = Array.isArray(processedTransactions) && processedTransactions.length
            ? processedTransactions[processedTransactions.length - 1]
            : null;
        const totalEquity = Number(latestRecord?.aggregate_total_equity ?? latestRecord?.total_equity);
        return Number.isFinite(totalEquity) ? totalEquity : 0;
    }

    function normalizeLedgerDate(value) {
        const match = String(value || '').match(/^(\d{4}-\d{2}-\d{2})/);
        return match ? match[1] : '';
    }

    function parseInvestmentChartDate(value) {
        const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!match) return null;
        const year = Number(match[1]);
        const monthIndex = Number(match[2]) - 1;
        const day = Number(match[3]);
        if (!Number.isInteger(year) || !Number.isInteger(monthIndex) || !Number.isInteger(day)) return null;
        return new Date(Date.UTC(year, monthIndex, day));
    }

    function shiftLedgerDate(value, dayOffset) {
        const parsedDate = parseInvestmentChartDate(value);
        if (!(parsedDate instanceof Date) || Number.isNaN(parsedDate.getTime())) return '';
        const shiftedDate = new Date(parsedDate.getTime());
        shiftedDate.setUTCDate(shiftedDate.getUTCDate() + Number(dayOffset || 0));
        const year = shiftedDate.getUTCFullYear();
        const month = String(shiftedDate.getUTCMonth() + 1).padStart(2, '0');
        const day = String(shiftedDate.getUTCDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    function getInvestmentStockDetailsRangeLabels(labels, range = 'max', options = {}) {
        const orderedLabels = Array.isArray(labels)
            ? labels.map((value) => normalizeLedgerDate(value)).filter(Boolean)
            : [];
        if (!orderedLabels.length) return [];
        const normalizedRange = normalizeInvestmentStockDetailsRange(range);
        if (normalizedRange === 'max') return orderedLabels;

        const latestDate = parseInvestmentChartDate(orderedLabels[orderedLabels.length - 1]);
        if (!(latestDate instanceof Date) || Number.isNaN(latestDate.getTime())) {
            return orderedLabels;
        }

        if (normalizedRange === '3d') {
            return orderedLabels.slice(-Math.min(3, orderedLabels.length));
        }

        let startDate = null;
        let endDate = latestDate;
        if (normalizedRange === '1w') {
            startDate = new Date(latestDate.getTime());
            startDate.setUTCDate(startDate.getUTCDate() - 6);
        } else if (normalizedRange === '3m') {
            startDate = new Date(latestDate.getTime());
            startDate.setUTCMonth(startDate.getUTCMonth() - 3);
        } else if (normalizedRange === 'ytd') {
            startDate = new Date(Date.UTC(latestDate.getUTCFullYear(), 0, 1));
        } else if (normalizedRange === '1y') {
            startDate = new Date(latestDate.getTime());
            startDate.setUTCFullYear(startDate.getUTCFullYear() - 1);
        } else if (normalizedRange === 'auto') {
            const tradeDates = Array.isArray(options?.tradeDates)
                ? options.tradeDates.map((value) => normalizeLedgerDate(value)).filter(Boolean)
                : [];
            if (!tradeDates.length) return orderedLabels;
            const firstTradeDate = parseInvestmentChartDate(tradeDates[0]);
            const lastTradeDate = parseInvestmentChartDate(tradeDates[tradeDates.length - 1]);
            if (
                !(firstTradeDate instanceof Date)
                || Number.isNaN(firstTradeDate.getTime())
                || !(lastTradeDate instanceof Date)
                || Number.isNaN(lastTradeDate.getTime())
            ) {
                return orderedLabels;
            }
            startDate = new Date(firstTradeDate.getTime());
            startDate.setUTCDate(startDate.getUTCDate() - 7);
            if (options?.isOpenPosition === false) {
                endDate = new Date(lastTradeDate.getTime());
                endDate.setUTCDate(endDate.getUTCDate() + 7);
                if (endDate > latestDate) {
                    endDate = latestDate;
                }
            }
        }

        if (!(startDate instanceof Date) || Number.isNaN(startDate.getTime())) {
            return orderedLabels;
        }

        const filteredLabels = orderedLabels.filter((label) => {
            const currentDate = parseInvestmentChartDate(label);
            return (
                currentDate instanceof Date
                && !Number.isNaN(currentDate.getTime())
                && currentDate >= startDate
                && currentDate <= endDate
            );
        });
        return filteredLabels.length ? filteredLabels : orderedLabels;
    }

    function getInvestmentEquityRangeLabels(labels, range = 'max') {
        const orderedLabels = Array.isArray(labels)
            ? labels.map((value) => normalizeLedgerDate(value)).filter(Boolean)
            : [];
        if (!orderedLabels.length) return [];
        const normalizedRange = normalizeInvestmentEquityRange(range);
        if (normalizedRange === 'max') return orderedLabels;

        const latestDate = parseInvestmentChartDate(orderedLabels[orderedLabels.length - 1]);
        if (!(latestDate instanceof Date) || Number.isNaN(latestDate.getTime())) {
            return orderedLabels;
        }

        let startDate = null;
        if (normalizedRange === '1w') {
            startDate = new Date(latestDate.getTime());
            startDate.setUTCDate(startDate.getUTCDate() - 6);
        } else if (normalizedRange === '1m') {
            startDate = new Date(latestDate.getTime());
            startDate.setUTCMonth(startDate.getUTCMonth() - 1);
        } else if (normalizedRange === '3m') {
            startDate = new Date(latestDate.getTime());
            startDate.setUTCMonth(startDate.getUTCMonth() - 3);
        } else if (normalizedRange === 'ytd') {
            startDate = new Date(Date.UTC(latestDate.getUTCFullYear(), 0, 1));
        } else if (normalizedRange === '1y') {
            startDate = new Date(latestDate.getTime());
            startDate.setUTCFullYear(startDate.getUTCFullYear() - 1);
        }

        if (!(startDate instanceof Date) || Number.isNaN(startDate.getTime())) {
            return orderedLabels;
        }

        const filteredLabels = orderedLabels.filter((label) => {
            const currentDate = parseInvestmentChartDate(label);
            return currentDate instanceof Date && !Number.isNaN(currentDate.getTime()) && currentDate >= startDate;
        });
        return filteredLabels.length ? filteredLabels : orderedLabels;
    }

    function buildTickerPriceIndex(tickerClosePrices) {
        const priceIndex = {};
        Object.entries(tickerClosePrices || {}).forEach(([ticker, dateMap]) => {
            const dates = Object.keys(dateMap || {}).sort();
            priceIndex[ticker] = {
                dates,
                closes: { ...(dateMap || {}) },
            };
        });
        return priceIndex;
    }

    function normalizePriceHistoryPayload(priceHistoryByTicker) {
        const rawMaps = {};
        Object.entries(priceHistoryByTicker || {}).forEach(([ticker, rows]) => {
            const normalizedTicker = normalizeInvestmentTicker(ticker);
            if (!normalizedTicker || !Array.isArray(rows)) return;
            rawMaps[normalizedTicker] = rawMaps[normalizedTicker] || {};
            rows.forEach((row) => {
                const date = normalizeLedgerDate(row?.date);
                const close = Number(row?.close);
                if (!date || !Number.isFinite(close)) return;
                rawMaps[normalizedTicker][date] = close;
            });
        });
        const normalized = {};
        Object.entries(rawMaps).forEach(([ticker, dateMap]) => {
            normalized[ticker] = { ...(normalized[ticker] || {}), ...dateMap };
        });
        Object.entries(rawMaps).forEach(([ticker, dateMap]) => {
            if (INVESTMENT_LINEAGE_PROXY_TICKERS.has(ticker)) return;
            const canonicalTicker = getInvestmentCanonicalTicker(ticker);
            if (!canonicalTicker || canonicalTicker === ticker) return;
            normalized[canonicalTicker] = normalized[canonicalTicker] || {};
            Object.entries(dateMap || {}).forEach(([date, close]) => {
                if (normalized[canonicalTicker][date] === undefined) {
                    normalized[canonicalTicker][date] = close;
                }
            });
        });
        return normalized;
    }

    function getIndexedClosePriceOnOrBefore(priceEntry, targetDate) {
        if (!priceEntry || !targetDate) return null;
        const dates = Array.isArray(priceEntry.dates) ? priceEntry.dates : [];
        for (let index = dates.length - 1; index >= 0; index -= 1) {
            if (dates[index] <= targetDate) {
                return Number(priceEntry.closes?.[dates[index]]);
            }
        }
        return null;
    }

    const INVESTMENT_TICKER_LINEAGE_FALLBACK = {
        'SPLG.US': ['SPYM', 'SPYM.US', 'SPLG', 'SPY', 'SPY.US'],
        SPLG: ['SPYM', 'SPYM.US', 'SPY', 'SPY.US'],
    };

    function getInvestmentTickerLineageMap() {
        const payloadLineage = window.ANTIGRAVITY_INVESTMENT_DATA?.ticker_lineage;
        if (payloadLineage && typeof payloadLineage === 'object' && !Array.isArray(payloadLineage)) {
            return payloadLineage;
        }
        return INVESTMENT_TICKER_LINEAGE_FALLBACK;
    }

    function getInvestmentTickerStoreAliasCandidates(ticker) {
        const normalizedTicker = normalizeInvestmentTicker(ticker);
        if (!normalizedTicker) return [];
        const candidates = [];
        const addCandidate = (value) => {
            const normalizedAlias = normalizeInvestmentTicker(value);
            if (normalizedAlias && !candidates.includes(normalizedAlias)) {
                candidates.push(normalizedAlias);
            }
        };
        const lineageMap = getInvestmentTickerLineageMap();
        (lineageMap[normalizedTicker] || []).forEach((alias) => {
            addCandidate(alias);
        });
        if (normalizedTicker.endsWith('.US')) {
            addCandidate(normalizedTicker.slice(0, -3).trim());
        }
        if (normalizedTicker.endsWith('.HK')) {
            const [symbol, suffix] = normalizedTicker.split('.');
            const strippedSymbol = String(symbol || '').replace(/^0+(?=\d)/, '');
            if (strippedSymbol && strippedSymbol !== symbol) {
                addCandidate(`${strippedSymbol}.${suffix}`);
            }
        }
        addCandidate(normalizedTicker);
        if (
            !normalizedTicker.endsWith('.US')
            && !normalizedTicker.endsWith('.HK')
            && /^[A-Z0-9]+$/.test(normalizedTicker)
        ) {
            addCandidate(`${normalizedTicker}.US`);
        }
        return candidates;
    }

    function getInvestmentCanonicalTicker(ticker) {
        const candidates = getInvestmentTickerStoreAliasCandidates(ticker);
        return candidates[0] || normalizeInvestmentTicker(ticker);
    }

    function getInvestmentLegacyLineageTickers(ticker) {
        const normalizedTicker = normalizeInvestmentTicker(ticker);
        if (!normalizedTicker) return [];
        const lineageMap = getInvestmentTickerLineageMap();
        const proxyTickers = new Set(['SPY', 'SPY.US']);
        const legacyTickers = [];
        Object.entries(lineageMap).forEach(([legacyTicker, successors]) => {
            const identitySuccessors = (Array.isArray(successors) ? successors : [])
                .map((entry) => normalizeInvestmentTicker(entry))
                .filter((entry) => entry && !proxyTickers.has(entry));
            if (identitySuccessors.includes(normalizedTicker)) {
                const normalizedLegacyTicker = normalizeInvestmentTicker(legacyTicker);
                if (normalizedLegacyTicker && !legacyTickers.includes(normalizedLegacyTicker)) {
                    legacyTickers.push(normalizedLegacyTicker);
                }
            }
        });
        return legacyTickers;
    }

    function getInvestmentTickerProfileLookupCandidates(ticker) {
        const legacyLineageTickers = getInvestmentLegacyLineageTickers(ticker);
        const storeAliasCandidates = getInvestmentTickerStoreAliasCandidates(ticker);
        const candidates = [];
        const addCandidate = (value) => {
            const normalizedCandidate = normalizeInvestmentTicker(value);
            if (normalizedCandidate && !candidates.includes(normalizedCandidate)) {
                candidates.push(normalizedCandidate);
            }
        };
        legacyLineageTickers.forEach(addCandidate);
        storeAliasCandidates.forEach(addCandidate);
        return candidates;
    }

    function buildValuationStatus({
        backendFailures = [],
        fallbackTickers = [],
        missingTickers = [],
        openTickers = [],
    } = {}) {
        const normalizedBackendFailures = Array.isArray(backendFailures) ? backendFailures : [];
        const openTickerSet = new Set(
            (Array.isArray(openTickers) ? openTickers : [])
                .map((ticker) => normalizeInvestmentTicker(ticker))
                .filter(Boolean),
        );
        const isOpenTicker = (ticker) => openTickerSet.has(normalizeInvestmentTicker(ticker));
        const formatDisplayTicker = (ticker) => {
            const normalizedTicker = normalizeInvestmentTicker(ticker);
            return normalizedTicker.endsWith('.US') ? normalizedTicker.slice(0, -3) : normalizedTicker;
        };
        const normalizedFallbackTickers = Array.from(new Set((Array.isArray(fallbackTickers) ? fallbackTickers : [])
            .map((ticker) => normalizeInvestmentTicker(ticker))
            .filter((ticker) => !isForexPairTicker(ticker))
            .filter(Boolean)
            .filter((ticker) => isOpenTicker(ticker))));
        const normalizedMissingTickers = Array.from(new Set((Array.isArray(missingTickers) ? missingTickers : [])
            .map((ticker) => normalizeInvestmentTicker(ticker))
            .filter((ticker) => !isForexPairTicker(ticker))
            .filter(Boolean)
            .filter((ticker) => isOpenTicker(ticker))));
        const filteredBackendFailures = normalizedBackendFailures.filter((entry) => {
            const ticker = normalizeInvestmentTicker(entry?.ticker || '');
            if (ticker && isForexPairTicker(ticker)) return false;
            if (ticker && !isOpenTicker(ticker)) return false;
            return true;
        });
        const hasBackendFailures = filteredBackendFailures.length > 0;
        const isDegraded = hasBackendFailures || normalizedFallbackTickers.length > 0 || normalizedMissingTickers.length > 0;
        if (!isDegraded) {
            return {
                isDegraded: false,
                message: '',
                backendFailures: filteredBackendFailures,
                fallbackTickers: normalizedFallbackTickers,
                missingTickers: normalizedMissingTickers,
            };
        }

        const messageParts = [];
        if (normalizedMissingTickers.length) {
            messageParts.push(`Valuation is incomplete for ${normalizedMissingTickers.map((ticker) => formatDisplayTicker(ticker)).join(', ')} because no usable local close history was found.`);
        }
        if (normalizedFallbackTickers.length) {
            messageParts.push(`Using the latest ledger price fallback for ${normalizedFallbackTickers.map((ticker) => formatDisplayTicker(ticker)).join(', ')} until local market history is refreshed.`);
        }
        if (hasBackendFailures) {
            messageParts.push(filteredBackendFailures.map((entry) => {
                const message = String(entry?.message || '');
                const ticker = normalizeInvestmentTicker(entry?.ticker || '');
                return ticker ? message.replaceAll(ticker, formatDisplayTicker(ticker)) : message;
            }).filter(Boolean).join(' '));
        }

        return {
            isDegraded: true,
            message: messageParts.filter(Boolean).join(' '),
            backendFailures: filteredBackendFailures,
            fallbackTickers: normalizedFallbackTickers,
            missingTickers: normalizedMissingTickers,
        };
    }

    function adjustTradePriceForRenderedSeries(transactionPrice, renderedSeriesPrice) {
        const rawTradePrice = Number(transactionPrice);
        const referencePrice = Number(renderedSeriesPrice);
        if (!Number.isFinite(rawTradePrice)) return null;
        if (!Number.isFinite(referencePrice) || referencePrice <= 0 || rawTradePrice <= 0) {
            return rawTradePrice;
        }
        const rawRatio = rawTradePrice / referencePrice;
        if (!Number.isFinite(rawRatio) || rawRatio <= 0) return rawTradePrice;
        const closeEnoughDistance = Math.log(1.35);
        const rawDistance = Math.abs(Math.log(rawRatio));
        if (rawDistance <= closeEnoughDistance) return rawTradePrice;

        const splitFactorCandidates = Array.from(new Set([
            ...investmentCommonSplitFactors,
            ...investmentCommonSplitFactors
                .filter((factor) => Number.isFinite(factor) && factor > 0 && factor !== 1)
                .map((factor) => 1 / factor),
        ])).sort((left, right) => left - right);

        let bestFactor = 1;
        let bestDistance = Number.POSITIVE_INFINITY;
        splitFactorCandidates.forEach((factor) => {
            if (!Number.isFinite(factor) || factor <= 0) return;
            const ratioDistance = Math.abs(Math.log(rawRatio / factor));
            if (ratioDistance < bestDistance) {
                bestDistance = ratioDistance;
                bestFactor = factor;
            }
        });

        const materiallyDifferentFactor = Math.abs(Math.log(bestFactor)) >= Math.log(1.5);
        const confidentlyMatchedFactor = bestDistance <= Math.log(1.12);
        const meaningfullyImproved = bestDistance + 0.08 < rawDistance;
        if (!materiallyDifferentFactor || !confidentlyMatchedFactor || !meaningfullyImproved) {
            return rawTradePrice;
        }

        const adjustedPrice = rawTradePrice / bestFactor;
        const adjustedRatio = adjustedPrice / referencePrice;
        if (!Number.isFinite(adjustedPrice) || adjustedPrice <= 0 || !Number.isFinite(adjustedRatio) || adjustedRatio <= 0) {
            return rawTradePrice;
        }
        return Math.abs(Math.log(adjustedRatio)) <= closeEnoughDistance ? adjustedPrice : rawTradePrice;
    }

    function calculateSnapshotMarketValue(
        snapshot,
        valuationDate,
        tickerPriceIndex,
        moneyMarketTickers,
        fxTimeline = null,
        baseCurrency = INVESTMENT_BASE_CURRENCY,
    ) {
        if (!snapshot || !valuationDate) return { marketValue: 0, holdingsMarketValues: {} };
        let marketValue = 0;
        const holdingsMarketValues = {};

        Object.entries(snapshot.holdings || {}).forEach(([ticker, quantity]) => {
            const numericQuantity = Number(quantity);
            if (!Number.isFinite(numericQuantity) || Math.abs(numericQuantity) < 1e-9) return;

            let closePrice = getIndexedClosePriceOnOrBefore(tickerPriceIndex?.[ticker], valuationDate);
            const normalizedTicker = String(ticker).trim().toUpperCase();
            const isMoneyMarketTicker = moneyMarketTickers.has(normalizedTicker);

            if (isMoneyMarketTicker) {
                const anchoredPrice = snapshot.money_market_anchors?.[ticker] ?? snapshot.money_market_anchors?.[normalizedTicker];
                closePrice = anchoredPrice ?? closePrice;
            }

            if ((!Number.isFinite(closePrice) || closePrice === 0) && String(snapshot.ticker || '').trim().toUpperCase() === normalizedTicker) {
                const fallbackPrice = Number(snapshot.price);
                if (Number.isFinite(fallbackPrice) && fallbackPrice > 0) {
                    closePrice = fallbackPrice;
                }
            }

            const safeClosePrice = Number.isFinite(closePrice) ? closePrice : 0;
            const holdingMarketValue = numericQuantity * safeClosePrice;
            const quoteCurrency = getTickerQuoteCurrency(ticker);
            const holdingMarketValueBase = convertAmountToBaseCurrency(
                holdingMarketValue,
                quoteCurrency,
                valuationDate,
                fxTimeline,
                baseCurrency,
            );
            marketValue += holdingMarketValueBase;
            if (Math.abs(holdingMarketValueBase) > 1e-9) {
                holdingsMarketValues[ticker] = holdingMarketValueBase;
            }
        });

        return { marketValue, holdingsMarketValues };
    }

    function buildDailyEquityChartPoints(processedTransactions, tickerClosePrices, moneyMarketTickers) {
        if (!Array.isArray(processedTransactions) || !processedTransactions.length) {
            return [];
        }

        const firstLedgerDate = normalizeLedgerDate(processedTransactions[0]?.date);
        if (!firstLedgerDate) return [];

        const tickerPriceIndex = buildTickerPriceIndex(tickerClosePrices);
        const baseCurrency = getInvestmentBaseCurrency();
        const fxTimeline = buildInvestmentFxRateTimeline(processedTransactions, baseCurrency);
        const tradingDateSet = new Set();
        Object.values(tickerPriceIndex).forEach((entry) => {
            (entry?.dates || []).forEach((date) => {
                if (date >= firstLedgerDate) {
                    tradingDateSet.add(date);
                }
            });
        });

        const ledgerDateMap = new Map();
        processedTransactions.forEach((txn) => {
            const ledgerDate = normalizeLedgerDate(txn?.date);
            if (!ledgerDate) return;
            if (!ledgerDateMap.has(ledgerDate)) {
                ledgerDateMap.set(ledgerDate, {
                    snapshot: txn,
                    ledgerNos: [],
                    cashInAmountBase: 0,
                    cashOutAmountBase: 0,
                    netTransferAmount: 0,
                    netTransferAmountsInBase: 0,
                });
            }
            const entry = ledgerDateMap.get(ledgerDate);
            entry.snapshot = txn;
            entry.ledgerNos.push(Number(txn.ledger_no || 0));
            const normalizedType = getNormalizedTransactionType(txn);
            const transactionAmount = Math.abs(Number(getTransactionAmount(txn)));
            const transactionCurrency = normalizeCurrencyCode(formatTransactionCurrency(txn)) || baseCurrency;
            const transactionAmountBase = convertAmountToBaseCurrency(
                transactionAmount,
                transactionCurrency,
                ledgerDate,
                fxTimeline,
                baseCurrency,
            );
            if (!Number.isFinite(transactionAmount) || transactionAmount <= 1e-9) return;
            if (txn?.manual_internal_transfer_external_flow_excluded === true) return;
            if (normalizedType === 'deposit') {
                entry.cashInAmountBase += transactionAmountBase;
                entry.netTransferAmount += transactionAmount;
                entry.netTransferAmountsInBase += transactionAmountBase;
            } else if (normalizedType === 'withdrawal') {
                entry.cashOutAmountBase += transactionAmountBase;
                entry.netTransferAmount -= transactionAmount;
                entry.netTransferAmountsInBase -= transactionAmountBase;
            }
        });

        const candidateDates = Array.from(new Set([
            ...Array.from(tradingDateSet),
            ...Array.from(ledgerDateMap.keys()),
        ])).sort();

        const points = [];
        let processedCursor = 0;
        let activeSnapshot = null;
        let cumulativeNetTransferAmount = 0;
        let previousTradingPointIndex = -1;
        const anchorDate = shiftLedgerDate(firstLedgerDate, -1);
        const startingCash = getInvestmentStartingCash();

        if (anchorDate) {
            points.push({
                date: anchorDate,
                running_cash: startingCash,
                aggregate_running_cash: startingCash,
                market_value: 0,
                aggregate_market_value: 0,
                holdings_market_values: {},
                aggregate_holdings_market_values: {},
                total_equity: startingCash,
                aggregate_total_equity: startingCash,
                anchor_ledger_date: '',
                anchor_ledger_nos: [],
                cash_in_amount: 0,
                cash_out_amount: 0,
                net_transfer_amount: 0,
                cumulative_net_transfer_amount: 0,
                is_trading_day: false,
                previous_trading_point_index: -1,
            });
        }

        candidateDates.forEach((date) => {
            while (processedCursor < processedTransactions.length) {
                const nextSnapshot = processedTransactions[processedCursor];
                const nextLedgerDate = normalizeLedgerDate(nextSnapshot?.date);
                if (!nextLedgerDate || nextLedgerDate > date) break;
                activeSnapshot = nextSnapshot;
                processedCursor += 1;
            }

            if (!activeSnapshot) return;

            const aggregateSnapshot = {
                ...activeSnapshot,
                holdings: activeSnapshot?.aggregate_holdings || activeSnapshot?.holdings || {},
                money_market_anchors: activeSnapshot?.aggregate_money_market_anchors || activeSnapshot?.money_market_anchors || {},
            };
            const valuation = calculateSnapshotMarketValue(
                aggregateSnapshot,
                date,
                tickerPriceIndex,
                moneyMarketTickers,
                fxTimeline,
                baseCurrency,
            );
            const aggregateRunningCash = Number(activeSnapshot?.aggregate_running_cash ?? activeSnapshot?.running_cash) || 0;
            const aggregateMarketValue = valuation.marketValue;
            const aggregateTotalEquity = aggregateRunningCash + aggregateMarketValue;
            const ledgerEntry = ledgerDateMap.get(date);
            const anchorLedgerNos = Array.isArray(ledgerEntry?.ledgerNos)
                ? ledgerEntry.ledgerNos.filter((ledgerNo) => Number.isFinite(ledgerNo) && ledgerNo > 0)
                : [];
            const cashInAmount = Number(ledgerEntry?.cashInAmountBase) || 0;
            const cashOutAmount = Number(ledgerEntry?.cashOutAmountBase) || 0;
            const netTransferAmount = (Number(ledgerEntry?.netTransferAmountsInBase) || 0);
            const isTradingDay = tradingDateSet.has(date);
            cumulativeNetTransferAmount += netTransferAmount;

            points.push({
                date,
                running_cash: aggregateRunningCash,
                aggregate_running_cash: aggregateRunningCash,
                market_value: aggregateMarketValue,
                aggregate_market_value: aggregateMarketValue,
                holdings_market_values: valuation.holdingsMarketValues,
                aggregate_holdings_market_values: valuation.holdingsMarketValues,
                total_equity: aggregateTotalEquity,
                aggregate_total_equity: aggregateTotalEquity,
                anchor_ledger_date: anchorLedgerNos.length ? date : '',
                anchor_ledger_nos: anchorLedgerNos,
                cash_in_amount: cashInAmount,
                cash_out_amount: cashOutAmount,
                net_transfer_amount: netTransferAmount,
                cumulative_net_transfer_amount: cumulativeNetTransferAmount,
                is_trading_day: isTradingDay,
                previous_trading_point_index: previousTradingPointIndex,
            });
            if (isTradingDay) {
                previousTradingPointIndex = points.length - 1;
            }
        });

        return points;
    }

    function buildTickerSummaries(transactions, latestPrices, totalEquity, tickerClosePrices = {}) {
        const tickerMap = new Map();
        const brokerTickerMap = new Map();
        const orderedTransactions = [...transactions].sort((left, right) => compareInvestmentTransactions(left, right));
        const tickerPriceIndex = buildTickerPriceIndex(tickerClosePrices);
        const renderedSplitFactorHints = buildRenderedSplitFactorHints(orderedTransactions, tickerPriceIndex);
        const baseCurrency = getInvestmentBaseCurrency();
        const fxTimeline = buildInvestmentFxRateTimeline(orderedTransactions, baseCurrency);
        const authoritativePositionSnapshot = getAuthoritativePositionSnapshot();
        const authoritativePerformanceSnapshot = getAuthoritativePerformanceSnapshot();
        const authoritativeBrokerPerformanceSnapshots = getAuthoritativeBrokerPerformanceSnapshots();
        const useAuthoritativePositionSnapshot = authoritativePositionSnapshot !== null;
        const canonicalAuthoritativePositionSnapshot = {};
        if (useAuthoritativePositionSnapshot) {
            Object.entries(authoritativePositionSnapshot).forEach(([ticker, snapshot]) => {
                const canonicalTicker = getInvestmentCanonicalTicker(ticker);
                if (!canonicalTicker) return;
                const quantity = Number(snapshot?.quantity) || 0;
                const costPrice = Number(snapshot?.costPrice);
                const marketValue = Number(snapshot?.marketValue);
                const lastPrice = Number(snapshot?.lastPrice);
                const previous = canonicalAuthoritativePositionSnapshot[canonicalTicker];
                if (!previous) {
                    canonicalAuthoritativePositionSnapshot[canonicalTicker] = {
                        ...snapshot,
                        quantity,
                    };
                    return;
                }
                const previousQuantity = Number(previous.quantity) || 0;
                const nextQuantity = previousQuantity + quantity;
                const previousCostTotal = Math.abs(previousQuantity) * (Number(previous.costPrice) || 0);
                const nextCostTotal = Math.abs(quantity) * (Number.isFinite(costPrice) ? costPrice : 0);
                previous.quantity = nextQuantity;
                previous.costPrice = Math.abs(nextQuantity) > 1e-9
                    ? (previousCostTotal + nextCostTotal) / Math.abs(nextQuantity)
                    : (Number.isFinite(costPrice) ? costPrice : previous.costPrice);
                if (Number.isFinite(marketValue)) {
                    previous.marketValue = (Number(previous.marketValue) || 0) + marketValue;
                }
                if (Number.isFinite(lastPrice) && lastPrice > 0) {
                    previous.lastPrice = lastPrice;
                }
            });
        }

        function applyTickerTransaction(summary, txn, normalizedType, quantity, amount, ledgerDate) {
            if (normalizedType === 'buy' && quantity !== null && !Number.isNaN(quantity)) {
                applyDirectionalTrade(summary, 'long', quantity, getTransactionEffectiveUnitPrice(txn, quantity));
                if (isFlatPosition(summary.shares)) summary.lastCloseDate = ledgerDate;
                return;
            }
            if (normalizedType === 'grant' && quantity !== null && !Number.isNaN(quantity)) {
                summary.shares += quantity;
                if (isFlatPosition(summary.shares)) summary.lastCloseDate = ledgerDate;
                return;
            }
            // Dividend reinvestment is funded by a separate dividend cash flow.
            if (normalizedType === 'dividend_reinvestment' && quantity !== null && !Number.isNaN(quantity)) {
                summary.shares += quantity;
                if (isFlatPosition(summary.shares)) summary.lastCloseDate = ledgerDate;
                return;
            }
            if (normalizedType === 'sell' && quantity !== null && !Number.isNaN(quantity)) {
                applyDirectionalTrade(summary, 'short', quantity, getTransactionEffectiveUnitPrice(txn, quantity));
                if (isFlatPosition(summary.shares)) summary.lastCloseDate = ledgerDate;
                return;
            }
            if (
                ['dividend', 'foreign_tax_withholding', 'payment_in_lieu', 'adjustment'].includes(normalizedType)
                && txn?.source?.excluded_from_broker_pnl !== true
            ) {
                summary.realizedPnl += amount;
            }
        }

        orderedTransactions.forEach((txn) => {
            if (!shouldTrackHoldingTicker(txn)) return;
            const ticker = getInvestmentCanonicalTicker(txn.ticker);
            if (!ticker) return;
            const normalizedType = getNormalizedTransactionType(txn);
            const quantity = getTransactionValuationQuantity(txn, tickerPriceIndex, renderedSplitFactorHints);
            const amount = getTransactionAmount(txn);

            if (!tickerMap.has(ticker)) {
                tickerMap.set(ticker, createPositionState(ticker));
            }
            const summary = tickerMap.get(ticker);
            const ledgerDate = normalizeLedgerDate(txn?.date);
            applyTickerTransaction(summary, txn, normalizedType, quantity, amount, ledgerDate);

            const broker = String(txn?.broker || txn?.source?.broker || '').trim().toLowerCase();
            if (broker) {
                const brokerTickerKey = `${broker}|${ticker}`;
                if (!brokerTickerMap.has(brokerTickerKey)) {
                    brokerTickerMap.set(brokerTickerKey, createPositionState(ticker));
                }
                applyTickerTransaction(
                    brokerTickerMap.get(brokerTickerKey),
                    txn,
                    normalizedType,
                    quantity,
                    amount,
                    ledgerDate,
                );
            }
        });

        if (useAuthoritativePositionSnapshot) {
            Object.keys(canonicalAuthoritativePositionSnapshot).forEach((ticker) => {
                if (!tickerMap.has(ticker)) {
                    tickerMap.set(ticker, createPositionState(ticker));
                }
            });
        }

        return Array.from(tickerMap.values()).map((summary) => {
            const snapshotEntry = useAuthoritativePositionSnapshot
                ? canonicalAuthoritativePositionSnapshot[summary.ticker] ?? null
                : null;
            const shares = useAuthoritativePositionSnapshot
                ? Number(snapshotEntry?.quantity) || 0
                : summary.shares;
            const totalCost = useAuthoritativePositionSnapshot && snapshotEntry
                ? Math.abs(shares) * (Number(snapshotEntry.costPrice) || 0)
                : summary.totalCost;
            const hasOpenPosition = !isFlatPosition(shares);
            const averagePrice = hasOpenPosition
                ? (snapshotEntry && Number.isFinite(snapshotEntry.costPrice)
                    ? snapshotEntry.costPrice
                    : (totalCost / Math.abs(shares)))
                : null;
            const marketValueFromSnapshot = snapshotEntry && Number.isFinite(snapshotEntry.marketValue)
                ? snapshotEntry.marketValue
                : null;
            const snapshotLastPrice = snapshotEntry && Number.isFinite(snapshotEntry.lastPrice)
                ? snapshotEntry.lastPrice
                : null;
            const computedLastPrice = latestPrices[summary.ticker] ?? null;
            const lastPrice = snapshotLastPrice !== null
                ? snapshotLastPrice
                : (computedLastPrice !== null
                    ? computedLastPrice
                    : (marketValueFromSnapshot !== null && Math.abs(shares) > 1e-9
                        ? marketValueFromSnapshot / shares
                        : null));
            const quoteCurrency = getTickerQuoteCurrency(summary.ticker);
            const lastLedgerDate = normalizeLedgerDate(orderedTransactions[orderedTransactions.length - 1]?.date || '');
            const performanceEntry = authoritativePerformanceSnapshot?.[summary.ticker] ?? null;
            let realizedPnlLocal = Number(summary.realizedPnl) || 0;
            let realizedPnl = convertAmountToBaseCurrencyAtLatestRate(
                realizedPnlLocal,
                quoteCurrency,
                fxTimeline,
                baseCurrency,
            );
            if (performanceEntry && Number.isFinite(performanceEntry.realizedTotal)) {
                realizedPnlLocal = performanceEntry.realizedTotal;
                realizedPnl = convertAmountToBaseCurrencyAtLatestRate(
                    performanceEntry.realizedTotal,
                    performanceEntry.currency,
                    fxTimeline,
                    baseCurrency,
                );
            } else {
                Object.entries(authoritativeBrokerPerformanceSnapshots).forEach(([broker, snapshot]) => {
                    const brokerPerformanceEntry = snapshot?.[summary.ticker] ?? null;
                    if (!brokerPerformanceEntry || !Number.isFinite(brokerPerformanceEntry.realizedTotal)) return;
                    const brokerSummary = brokerTickerMap.get(`${broker}|${summary.ticker}`);
                    const brokerRealizedPnlLocal = Number(brokerSummary?.realizedPnl) || 0;
                    const brokerRealizedPnl = convertAmountToBaseCurrencyAtLatestRate(
                        brokerRealizedPnlLocal,
                        quoteCurrency,
                        fxTimeline,
                        baseCurrency,
                    );
                    const calibratedBrokerRealizedPnl = convertAmountToBaseCurrencyAtLatestRate(
                        brokerPerformanceEntry.realizedTotal,
                        brokerPerformanceEntry.currency,
                        fxTimeline,
                        baseCurrency,
                    );
                    realizedPnl += calibratedBrokerRealizedPnl - brokerRealizedPnl;
                    if (brokerPerformanceEntry.currency === quoteCurrency) {
                        realizedPnlLocal += brokerPerformanceEntry.realizedTotal - brokerRealizedPnlLocal;
                    }
                });
            }
            const marketValueLocal = hasOpenPosition
                ? (marketValueFromSnapshot !== null
                    ? marketValueFromSnapshot
                    : (lastPrice !== null ? shares * lastPrice : 0))
                : 0;
            const marketValue = convertAmountToBaseCurrency(
                marketValueLocal,
                quoteCurrency,
                lastLedgerDate,
                fxTimeline,
                baseCurrency,
            );
            const unrealizedPnlLocal = hasOpenPosition && lastPrice !== null && averagePrice !== null
                ? (shares > 0
                    ? (lastPrice - averagePrice) * shares
                    : (averagePrice - lastPrice) * Math.abs(shares))
                : null;
            const unrealizedPnl = unrealizedPnlLocal === null
                ? null
                : convertAmountToBaseCurrency(
                    unrealizedPnlLocal,
                    quoteCurrency,
                    lastLedgerDate,
                    fxTimeline,
                    baseCurrency,
                );
            const positionWeight = Number.isFinite(totalEquity) && Math.abs(totalEquity) > 1e-9 && hasOpenPosition
                ? (marketValue / totalEquity) * 100
                : 0;

            return {
                ...summary,
                shares,
                totalCost,
                averagePrice,
                lastPrice,
                marketValue,
                realizedPnl,
                realizedPnlLocal,
                quoteCurrency,
                unrealizedPnl,
                positionWeight,
                hasOpenPosition,
            };
        }).sort((left, right) => {
            if (left.hasOpenPosition !== right.hasOpenPosition) {
                return left.hasOpenPosition ? -1 : 1;
            }
            if (left.hasOpenPosition && right.hasOpenPosition) {
                return Math.abs(right.marketValue) - Math.abs(left.marketValue);
            }
            // Closed positions: sort by close time descending (most recent 清仓 first),
            // matching the requested top-to-bottom order (newest exit at top).
            const leftDate = left.lastCloseDate || '';
            const rightDate = right.lastCloseDate || '';
            if (leftDate !== rightDate) {
                return rightDate.localeCompare(leftDate);
            }
            return left.ticker.localeCompare(right.ticker);
        });
    }

    function formatAmount(value) {
        return new Intl.NumberFormat('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        }).format(value);
    }

    return {
        adjustTradePriceForRenderedSeries,
        applyDirectionalTrade,
        buildDailyEquityChartPoints,
        buildInvestmentFxRateTimeline,
        buildRenderedSplitFactorHints,
        buildTickerPriceIndex,
        buildTickerSummaries,
        buildValuationStatus,
        getInvestmentCanonicalTicker,
        getInvestmentLegacyLineageTickers,
        getInvestmentTickerProfileLookupCandidates,
        getInvestmentTickerStoreAliasCandidates,
        cloneCashLedgerBalances,
        convertAmountToBaseCurrency,
        convertAmountToBaseCurrencyAtLatestRate,
        createCashLedger,
        compareInvestmentTransactions,
        calculateSnapshotMarketValue,
        closePositionLots,
        createPositionState,
        escapeHtml,
        formatAmountWithCurrency,
        formatForexTradeComponentDescription,
        formatHoldingsMoney,
        formatHoldingsPercent,
        formatHoldingsPosition,
        formatHoldingsUsd,
        formatSignedHoldingsMoney,
        formatTransactionCommissionDisplay,
        formatTransactionCurrency,
        formatTransactionDateDisplay,
        formatTransactionDescription,
        getIndexedClosePriceOnOrBefore,
        getInvestmentEquityRangeLabels,
        getInvestmentBrokerEndingCash,
        getInvestmentEndingCash,
        getAuthoritativePerformanceSnapshot,
        getAuthoritativeBrokerPerformanceSnapshots,
        getInvestmentStartingCash,
        getInvestmentStockDetailsRangeLabels,
        getLatestDashboardEquity,
        getAuthoritativePositionSnapshot,
        getFxRateForDate,
        getLatestFxRateForCurrency,
        getInvestmentBaseCurrency,
        getTodayLedgerDate,
        getMoneyMarketTickerSet,
        getCashEquivalentTickerSet,
        getNormalizedTransactionType,
        getTransactionAmount,
        getTransactionCommission,
        getTransactionEconomicAmount,
        getTransactionEffectiveUnitPrice,
        getTransactionRenderedSplitFactor,
        getTransactionValuationQuantity,
        getTransactionPrice,
        getTransactionQuantity,
        isFlatPosition,
        isForexPairTicker,
        getTickerQuoteCurrency,
        normalizeLedgerDate,
        normalizePriceHistoryPayload,
        parseInvestmentChartDate,
        resetPositionState,
        shiftLedgerDate,
        shouldTrackHoldingTicker,
        sumCashLedgerInBaseCurrency,
        sumKolRewardRealizedIncomeInBaseCurrency,
        isKolRewardTransaction,
        addCashLedgerDelta,
    };
}

export const INVESTMENT_DATA_UTILS_MODULE_VERSION = 'v1.47.0';
