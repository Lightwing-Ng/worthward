/**
 * Transaction presentation, lot-scope, and replay-order utilities.
 *
 * Code version: v1.0.0
 * - Added: Extracted from the Investment data-utilities composition root.
 */

export function createInvestmentTransactionPresentationUtils(runtime) {
    const INVESTMENT_MONEY_MARKET_DESCRIPTION_ALIASES = runtime.INVESTMENT_MONEY_MARKET_DESCRIPTION_ALIASES;
    const INVESTMENT_MONEY_MARKET_FUND_IDENTITY = runtime.INVESTMENT_MONEY_MARKET_FUND_IDENTITY;
    const INVESTMENT_MONEY_MARKET_STANDARD_NAMES = runtime.INVESTMENT_MONEY_MARKET_STANDARD_NAMES;
    const INVESTMENT_REPLAY_ORDER_SYMBOL = runtime.INVESTMENT_REPLAY_ORDER_SYMBOL;
    const noCommissionTransactionTypes = runtime.noCommissionTransactionTypes;
    const formatAmount = (...args) => runtime.formatAmount(...args);
    const formatInvestmentShortDateParts = (...args) => runtime.formatInvestmentShortDateParts(...args);
    const getCashEquivalentTickerSet = (...args) => runtime.getCashEquivalentTickerSet(...args);
    const getInvestmentCanonicalTicker = (...args) => runtime.getInvestmentCanonicalTicker(...args);
    const getLongbridgeHkCashEquivalentSyntheticTicker = (...args) => runtime.getLongbridgeHkCashEquivalentSyntheticTicker(...args);
    const getMoneyMarketTickerSet = (...args) => runtime.getMoneyMarketTickerSet(...args);
    const getNormalizedTransactionType = (...args) => runtime.getNormalizedTransactionType(...args);
    const getSameTimeCashSafetySortCategory = (...args) => runtime.getSameTimeCashSafetySortCategory(...args);
    const getTickerQuoteCurrency = (...args) => runtime.getTickerQuoteCurrency(...args);
    const getTransactionAmount = (...args) => runtime.getTransactionAmount(...args);
    const getTransactionCashSortAmount = (...args) => runtime.getTransactionCashSortAmount(...args);
    const getTransactionCommission = (...args) => runtime.getTransactionCommission(...args);
    const getTransactionQuantity = (...args) => runtime.getTransactionQuantity(...args);
    const isCashDepositType = (...args) => runtime.isCashDepositType(...args);
    const isCashWithdrawalType = (...args) => runtime.isCashWithdrawalType(...args);
    const isHsbcSettlementActuallyPending = (...args) => runtime.isHsbcSettlementActuallyPending(...args);
    const isKolRewardTransaction = (...args) => runtime.isKolRewardTransaction(...args);
    const isLongbridgeHkCashEquivalentTransfer = (...args) => runtime.isLongbridgeHkCashEquivalentTransfer(...args);
    const isTigerFundsInTransitTransfer = (...args) => runtime.isTigerFundsInTransitTransfer(...args);
    const normalizeLedgerDateTime = (...args) => runtime.normalizeLedgerDateTime(...args);
    const parseInvestmentDateParts = (...args) => runtime.parseInvestmentDateParts(...args);

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
        if (
            isLongbridgeHkCashEquivalentTransfer(txn)
            || txn?.normalized?.cash_equivalent_transfer === true
            || isTigerFundsInTransitTransfer(txn)
        ) {
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
        const rate = Number(txn?.price_raw ?? getTransactionPrice(txn));

        if (
            !baseCurrency
            || !quoteCurrency
            || !Number.isFinite(quantity)
            || !Number.isFinite(rate)
            || rate <= 0
        ) {
            return normalizeTransactionDescriptionPresentation(txn.description || '--');
        }

        const sourceAction = String(txn?.source?.forex_action || '').trim().toLowerCase();
        const signedQuantity = Number(txn?.quantity_raw ?? quantity);
        const isBaseSale = sourceAction === 'sell_base' || (!sourceAction && signedQuantity < 0);
        const baseQuantity = Math.abs(Number(
            txn?.source?.base_quantity_raw ?? signedQuantity,
        ));
        const quoteAmount = Math.abs(Number(
            txn?.source?.quote_amount_raw ?? (baseQuantity * rate),
        ));
        if (!Number.isFinite(baseQuantity) || !Number.isFinite(quoteAmount)) {
            return normalizeTransactionDescriptionPresentation(txn.description || '--');
        }
        const baseQuantityText = formatAmount(baseQuantity);
        const quoteAmountText = formatAmount(quoteAmount);
        const rateText = String(txn.price_raw ?? txn.normalized?.unit_price ?? rate);
        const verb = isBaseSale ? 'Sold' : 'Bought';
        const connector = isBaseSale ? 'for' : 'with';
        return `${verb} ${baseQuantityText} ${baseCurrency} ${connector} ${quoteAmountText} ${quoteCurrency} @ ${baseCurrency}.${quoteCurrency} ${rateText}`;
    }

    function normalizeTransactionDescriptionWhitespace(value) {
        return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function normalizeKolRewardDescription(value) {
        const source = normalizeTransactionDescriptionWhitespace(value);
        const details = source
            .replace(/\bKOL\s+Rewards?\b/gi, '')
            .replace(/^\s*(?:·|•|\||:|–|—|-)+\s*|\s*(?:·|•|\||:|–|—|-)+\s*$/g, '')
            .replace(/\s+/g, ' ')
            .trim();
        return details ? `KOL Rewards · ${details}` : 'KOL Rewards';
    }

    function normalizeLongbridgeUsDividendDescription(value) {
        let description = String(value || '');
        description = description.replace(
            /^([A-Za-z][A-Za-z0-9]*)\.US(?=\s+Cash\s+dividend\b)/i,
            '$1',
        );
        description = description.replace(/\s+,/g, ',');
        return description.replace(/,\s*Held\s*:\s*/i, ', Held: ');
    }

    function normalizeTransactionDescriptionPresentation(value) {
        let description = normalizeTransactionDescriptionWhitespace(value);
        description = description.replace(/\s*[·•]\s*/g, ' · ');
        description = description.replace(/\s+(?:-|–|—|\|)\s+/g, ' · ');
        description = description.replace(/\bEDDA\b/gi, 'eDDA');
        description = description.replace(
            /\b([A-Za-z][A-Za-z0-9._-]{0,15})\s*\(\s*([A-Za-z]{2}[A-Za-z0-9]{8,})\s*\)/g,
            (_match, ticker, identifier) => `${String(ticker).toUpperCase()} (${String(identifier).toUpperCase()})`,
        );
        [
            [/\bCash\s+Dividend\b/gi, 'Cash dividend'],
            [/\bDividend\s+Tax\b/gi, 'Dividend tax'],
            [/\bOrdinary\s+Dividend\b/gi, 'Ordinary dividend'],
            [/\bPer\s+Share\b/gi, 'per share'],
            [/\bUS\s+Tax\b/gi, 'US tax'],
        ].forEach(([pattern, replacement]) => {
            description = description.replace(pattern, replacement);
        });
        description = normalizeLongbridgeUsDividendDescription(description);
        return description.replace(
            /\bFX\s+FROM\s+([A-Z]{3})\s+TO\s+([A-Z]{3})\b/gi,
            (_match, soldCurrency, acquiredCurrency) => (
                `FX from ${String(soldCurrency).toUpperCase()} to ${String(acquiredCurrency).toUpperCase()}`
            ),
        );
    }

    function normalizeInvestmentDistributionDescriptionIdentity(txn, description) {
        const normalizedType = getNormalizedTransactionType(txn);
        if (!['dividend', 'foreign_tax_withholding'].includes(normalizedType)) {
            return description;
        }

        const canonicalTicker = String(getInvestmentCanonicalTicker(txn?.ticker) || txn?.ticker || '')
            .trim()
            .toUpperCase();
        if (!canonicalTicker) return description;

        const normalizedDescription = String(description || '').trim();
        const escapedTicker = canonicalTicker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (new RegExp(`^${escapedTicker}(?:\\s|·|$)`, 'i').test(normalizedDescription)) {
            return normalizedDescription;
        }

        const replacedDescription = normalizedDescription.replace(
            /^.*?(?=\s+(?:Cash\s+dividend|Dividend\s+tax)\b)/i,
            canonicalTicker,
        );
        if (replacedDescription !== normalizedDescription) return replacedDescription;
        return normalizedDescription ? `${canonicalTicker} · ${normalizedDescription}` : canonicalTicker;
    }

    function getTransactionDescriptionText(txn, fallback = '--', { normalizeWhitespace = false } = {}) {
        const rawDescription = normalizeWhitespace
            ? normalizeTransactionDescriptionWhitespace(txn?.description)
            : String(txn?.description || '').trim();
        return rawDescription || fallback;
    }

    function hasExplicitTransactionCurrency(txn) {
        return /^[A-Z]{3}$/.test(String(txn?.currency || '').trim().toUpperCase());
    }

    function getCashTransactionDescription(txn, normalizedType) {
        const rawDescription = getTransactionDescriptionText(txn, '', { normalizeWhitespace: true });
        if (rawDescription && !/^\*\s*Equivalent$/i.test(rawDescription)) {
            return normalizeTransactionDescriptionPresentation(rawDescription);
        }

        const currency = String(formatTransactionCurrency(txn) || '').trim().toUpperCase();
        if (hasExplicitTransactionCurrency(txn) && currency) {
            const action = isCashWithdrawalType(normalizedType) ? 'Withdrawal' : 'Deposit';
            return `${action} · ${currency}`;
        }

        return isCashDepositType(normalizedType) ? '* Equivalent' : '--';
    }

    function escapeInvestmentDescriptionRegExp(value) {
        return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function getInvestmentMoneyMarketFundIdTicker(fundId) {
        const normalizedFundId = String(fundId || '')
            .trim()
            .toUpperCase()
            .replace(/[^A-Z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '');
        return INVESTMENT_MONEY_MARKET_FUND_IDENTITY[normalizedFundId] || '';
    }

    function getInvestmentMoneyMarketDisplayName(ticker) {
        const canonicalTicker = String(getInvestmentCanonicalTicker(ticker) || ticker || '')
            .trim()
            .toUpperCase();
        if (!canonicalTicker) return '';
        const payloadNames = globalThis.window?.WORTHWARD_INVESTMENT_DATA?.known_ticker_company_names;
        const payloadName = payloadNames && typeof payloadNames === 'object' && !Array.isArray(payloadNames)
            ? String(payloadNames[canonicalTicker] || '').trim()
            : '';
        return payloadName || INVESTMENT_MONEY_MARKET_STANDARD_NAMES[canonicalTicker] || '';
    }

    function getInvestmentMoneyMarketDescriptionAliases(ticker) {
        const canonicalTicker = String(getInvestmentCanonicalTicker(ticker) || ticker || '')
            .trim()
            .toUpperCase();
        const aliases = [
            canonicalTicker,
            `${canonicalTicker}.HK`,
            `${canonicalTicker}.USD`,
            getInvestmentMoneyMarketDisplayName(canonicalTicker),
            ...(INVESTMENT_MONEY_MARKET_DESCRIPTION_ALIASES[canonicalTicker] || []),
        ];
        return Array.from(new Set(aliases.map((value) => String(value || '').trim()).filter(Boolean)))
            .sort((left, right) => right.length - left.length);
    }

    function canonicalizeInvestmentMoneyMarketTicker(candidate) {
        const fundTicker = getInvestmentMoneyMarketFundIdTicker(candidate);
        const normalizedCandidate = String(fundTicker || candidate || '').trim().toUpperCase();
        if (!normalizedCandidate) return '';
        const canonicalTicker = String(getInvestmentCanonicalTicker(normalizedCandidate) || normalizedCandidate)
            .trim()
            .toUpperCase();
        const candidates = [
            canonicalTicker,
            canonicalTicker.replace(/\.(USD|HKD)$/i, ''),
            normalizedCandidate.replace(/\.(USD|HKD)$/i, ''),
        ];
        const configuredTickers = getMoneyMarketTickerSet();
        return candidates.find((value) => configuredTickers.has(value)) || '';
    }

    function resolveInvestmentMoneyMarketTransactionIdentity(txn) {
        const candidateValues = [
            txn?.ticker,
            isLongbridgeHkCashEquivalentTransfer(txn)
                ? getLongbridgeHkCashEquivalentSyntheticTicker(txn)
                : '',
            txn?.normalized?.cash_equivalent_fund_id,
            txn?.source?.cash_equivalent_fund_id,
        ];
        for (const candidate of candidateValues) {
            const canonicalTicker = canonicalizeInvestmentMoneyMarketTicker(candidate);
            if (!canonicalTicker) continue;
            const displayName = getInvestmentMoneyMarketDisplayName(canonicalTicker);
            if (displayName) return {ticker: canonicalTicker, name: displayName};
        }

        const rawDescription = normalizeTransactionDescriptionWhitespace(txn?.description).toUpperCase();
        if (!rawDescription) return null;
        const configuredTickers = Array.from(getMoneyMarketTickerSet())
            .sort((left, right) => right.length - left.length);
        for (const ticker of configuredTickers) {
            const tickerPattern = new RegExp(
                `\\b${escapeInvestmentDescriptionRegExp(ticker)}(?:\\.(?:HK|HKD|USD|US))?\\b`,
                'i',
            );
            if (tickerPattern.test(rawDescription)) {
                const displayName = getInvestmentMoneyMarketDisplayName(ticker);
                if (displayName) return {ticker, name: displayName};
            }
            const aliases = getInvestmentMoneyMarketDescriptionAliases(ticker)
                .filter((alias) => alias !== ticker && !alias.endsWith('.HK') && !alias.endsWith('.USD'));
            if (aliases.some((alias) => rawDescription.includes(alias.toUpperCase()))) {
                const displayName = getInvestmentMoneyMarketDisplayName(ticker);
                if (displayName) return {ticker, name: displayName};
            }
        }
        return null;
    }

    function resolveInvestmentCashEquivalentSecurityIdentity(txn) {
        const canonicalTicker = String(getInvestmentCanonicalTicker(txn?.ticker) || txn?.ticker || '')
            .trim()
            .toUpperCase();
        if (!canonicalTicker || !getCashEquivalentTickerSet().has(canonicalTicker)) return null;
        const displayName = getInvestmentMoneyMarketDisplayName(canonicalTicker);
        return displayName ? {ticker: canonicalTicker, name: displayName} : null;
    }

    function getInvestmentMoneyMarketActionLabel(txn) {
        const rawAction = String(
            txn?.normalized?.cash_equivalent_action
            ?? txn?.source?.cash_equivalent_action
            ?? '',
        ).trim().toLowerCase();
        if (['placement', 'subscription', 'buy'].includes(rawAction)) return 'Subscription';
        if (['redemption', 'withdrawal', 'sell'].includes(rawAction)) return 'Redemption';
        const normalizedType = getNormalizedTransactionType(txn);
        if (normalizedType === 'dividend_reinvestment') return 'Dividend reinvestment';
        if (normalizedType === 'dividend') return 'Dividend';
        return '';
    }

    function getInvestmentMoneyMarketQuantityLabel(txn) {
        const rawQuantity = txn?.quantity_abs
            ?? txn?.normalized?.display_quantity
            ?? txn?.quantity;
        if (rawQuantity === undefined || rawQuantity === null || rawQuantity === '') return '';
        const numericQuantity = Number(rawQuantity);
        if (Number.isFinite(numericQuantity)) {
            return Number.isInteger(numericQuantity)
                ? String(Math.trunc(numericQuantity))
                : String(rawQuantity).trim();
        }
        return String(rawQuantity).trim();
    }

    function getInvestmentMoneyMarketTransactionDetails(txn, identity) {
        const normalizedType = getNormalizedTransactionType(txn);
        if (normalizedType === 'dividend_reinvestment') {
            const quantityLabel = getInvestmentMoneyMarketQuantityLabel(txn);
            return quantityLabel
                ? `Dividend reinvestment × ${quantityLabel}`
                : 'Dividend reinvestment';
        }

        let details = normalizeTransactionDescriptionWhitespace(txn?.description);
        if (details) {
            getInvestmentMoneyMarketDescriptionAliases(identity.ticker).forEach((alias) => {
                details = details.replace(
                    new RegExp(escapeInvestmentDescriptionRegExp(alias), 'ig'),
                    ' ',
                );
            });
            details = details.replace(/MMF\/GTMMF\/\d+/ig, ' ');
            details = details.replace(/\(Withdrawal\)/ig, 'Redemption');
            details = details.replace(/\bFund\s+(Subscription|Redemption)\s*#?/ig, '$1');
            details = details.replace(/\bSubscription\s+of\s+of\b/ig, 'Subscription');
            details = details.replace(/\bRedemption\s+of\s+of\b/ig, 'Redemption');
            details = details.replace(/\(\s*\)/g, ' ');
            details = details.replace(/\s+/g, ' ').trim();
            details = details.replace(/^[#·|:/,\-]+|[#·|:/,\-]+$/g, '').trim();
        }

        const actionLabel = getInvestmentMoneyMarketActionLabel(txn);
        if (!details) return actionLabel;
        const includesAction = /\b(subscription|redemption|dividend)\b/i.test(details);
        return actionLabel && !includesAction ? `${actionLabel} · ${details}` : details;
    }

    function formatInvestmentMoneyMarketTransactionDescription(txn, identity, currentDescription) {
        if (!identity) return currentDescription;
        const normalizedType = getNormalizedTransactionType(txn);
        if (['buy', 'sell', 'grant'].includes(normalizedType)) return currentDescription;
        let details = getInvestmentMoneyMarketTransactionDetails(txn, identity);
        if (!details && currentDescription) {
            const tickerPattern = new RegExp(`^${escapeInvestmentDescriptionRegExp(identity.ticker)}\\s*`, 'i');
            details = String(currentDescription).replace(tickerPattern, '').trim();
        }
        const identityLabel = `${identity.ticker} · ${identity.name}`;
        return details ? `${identityLabel} · ${details}` : identityLabel;
    }

    function normalizeHsbcOrderReference(value) {
        const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
        if (!normalized) return '';

        const settlementReferenceMatch = normalized.match(
            /\bREF\s+([PS])(\d+)001\s+SEC\b/i,
        );
        if (settlementReferenceMatch) {
            return `${settlementReferenceMatch[1].toUpperCase()}-${settlementReferenceMatch[2]}`;
        }

        const compactReferenceMatch = normalized.match(/^([PS])[-\s]?(\d+)001$/i);
        if (compactReferenceMatch) {
            return `${compactReferenceMatch[1].toUpperCase()}-${compactReferenceMatch[2]}`;
        }

        const orderReferenceMatch = normalized.match(/^([PS])[-\s]?([A-Z0-9-]+)$/i);
        if (orderReferenceMatch) {
            return `${orderReferenceMatch[1].toUpperCase()}-${orderReferenceMatch[2].toUpperCase()}`;
        }

        return '';
    }

    function getHsbcOrderReferenceLabel(txn) {
        const source = txn?.source && typeof txn.source === 'object' ? txn.source : {};
        const candidates = [
            source.statement_order_id,
            source.order_id,
            source.cash_settlement_reference,
            txn?.description,
        ];
        let reference = '';
        for (const candidate of candidates) {
            reference = normalizeHsbcOrderReference(candidate);
            if (reference) break;
        }
        if (!reference) return '';

        return isHsbcSettlementActuallyPending(source) ? `${reference}*` : reference;
    }

    function getHsbcOrderExecutionSequence(txn) {
        const source = txn?.source && typeof txn.source === 'object' ? txn.source : {};
        const sourceRank = Number(source.order_status_source_row_number ?? source.row_number);
        if (!Number.isFinite(sourceRank) || sourceRank <= 0) return Number.NaN;
        const pageOrder = String(source.order_status_page_order || 'newest_first').trim().toLowerCase();
        return pageOrder === 'oldest_first' ? sourceRank : -sourceRank;
    }

    function getSchwabDateOnlyTradeSequence(txn) {
        const broker = String(txn?.broker || txn?.source?.broker || '').trim().toLowerCase();
        const normalizedType = getNormalizedTransactionType(txn);
        if (broker !== 'schwab' || !['buy', 'sell'].includes(normalizedType)) return null;
        const source = txn?.source && typeof txn.source === 'object' ? txn.source : {};
        if (
            source.source_has_intraday_timestamp === true
            || String(source.datetime_precision || '').trim().toLowerCase() === 'second'
        ) {
            return null;
        }

        const explicitSequence = Number(source.same_day_execution_sequence);
        if (Number.isFinite(explicitSequence)) return explicitSequence;

        const sourceRow = Number(source.row_number);
        if (!Number.isFinite(sourceRow) || sourceRow <= 0) return null;
        const sourceRowOrder = String(source.source_row_order || '').trim().toLowerCase();
        if (sourceRowOrder === 'newest_first') return -sourceRow;
        if (sourceRowOrder === 'oldest_first') return sourceRow;
        return null;
    }

    function getHsbcSortCategory(txn) {
        const fileKind = String(txn?.source?.file_kind || '').trim().toLowerCase();
        const normalizedType = getNormalizedTransactionType(txn);
        if (['hsbc_usd_account_text', 'hsbc_multi_currency_cash_account_text', 'hsbc_statement_cash'].includes(fileKind)) {
            if (isCashDepositType(normalizedType) || normalizedType === 'credit_interest') return 0;
            if (isCashWithdrawalType(normalizedType) || normalizedType === 'debit_interest') return 2;
            return 3;
        }
        if (fileKind === 'hsbc_order_status_text' || fileKind === 'hsbc_order_status_capture') {
            return 1;
        }
        return 9;
    }

    function formatTransactionDescription(txn) {
        let description;
        const price = txn.normalized?.unit_price ?? txn.price;
        const normalizedTypeDesc = getNormalizedTransactionType(txn);
        let qty = normalizedTypeDesc === 'adjustment'
            ? (txn.quantity_raw ?? txn.normalized?.position_quantity ?? txn.quantity_abs)
            : (txn.quantity ?? txn.quantity_abs ?? txn.normalized?.display_quantity);
        const brokerCode = String(txn?.broker || txn?.source?.broker || '').trim().toLowerCase();

        if (normalizedTypeDesc === 'forex_trade_component') {
            return formatForexTradeComponentDescription(txn);
        }

        if (txn.ticker && qty) {
            const displayTicker = getInvestmentCanonicalTicker(txn.ticker) || txn.ticker;
            const cleanQty = Number.isInteger(Number(qty)) ? String(parseInt(qty, 10)) : qty;
            if (price && ['buy', 'sell'].includes(normalizedTypeDesc)) {
                const cleanPrice = Number(price).toFixed(2);
                description = `${displayTicker} @ ${cleanPrice} × ${cleanQty}`;
            } else {
                description = `${displayTicker} × ${cleanQty}`;
            }
        } else if (isCashDepositType(normalizedTypeDesc) || isCashWithdrawalType(normalizedTypeDesc)) {
            description = getCashTransactionDescription(txn, normalizedTypeDesc);
        } else {
            description = getTransactionDescriptionText(txn);
        }

        const moneyMarketIdentity = resolveInvestmentMoneyMarketTransactionIdentity(txn);
        let cashEquivalentSecurityIdentity = null;
        if (moneyMarketIdentity) {
            description = formatInvestmentMoneyMarketTransactionDescription(
                txn,
                moneyMarketIdentity,
                description,
            );
        } else {
            cashEquivalentSecurityIdentity = resolveInvestmentCashEquivalentSecurityIdentity(txn);
            if (cashEquivalentSecurityIdentity) {
                description = formatInvestmentMoneyMarketTransactionDescription(
                    txn,
                    cashEquivalentSecurityIdentity,
                    description,
                );
            }
        }

        if (!moneyMarketIdentity && !cashEquivalentSecurityIdentity) {
            description = normalizeInvestmentDistributionDescriptionIdentity(txn, description);
        }

        if (isKolRewardTransaction(txn)) {
            description = normalizeKolRewardDescription(description);
        }

        if (brokerCode === 'hsbc' && ['buy', 'sell'].includes(normalizedTypeDesc)) {
            const referenceLabel = getHsbcOrderReferenceLabel(txn);
            if (referenceLabel) {
                return normalizeTransactionDescriptionPresentation(`${description} · ${referenceLabel}`);
            }
        }

        return normalizeTransactionDescriptionPresentation(description);
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
            nonPerformanceRealizedPnl: 0,
            nonPerformanceRealizedPnlByDate: {},
            realizedPnlByDate: {},
            lastCloseDate: null,
            lastTradeDate: null,
            buyCount: 0,
            buyQuantity: 0,
            sellCount: 0,
            sellQuantity: 0,
            brokerRealizedSellCount: 0,
            realizedPnlStatus: 'complete',
            hasPartialTaxLotHistory: false,
            costBasisStatus: 'known',
            costBasisMethod: null,
            lotMatchingMethod: null,
            lots: [],
            nextLotSequence: 0,
            lotScope: null,
        };
    }

    function normalizeInvestmentLotScopeAccount(broker, accountId) {
        const normalizedAccount = String(accountId || '').trim();
        if (String(broker || '').trim().toLowerCase() === 'ibkr') {
            const suffixMatch = normalizedAccount.toUpperCase().match(/^U(?:\*+|\d+)(\d{5})$/);
            if (suffixMatch) return `ibkr:u-suffix:${suffixMatch[1]}`;
        }
        return normalizedAccount.toLowerCase() || 'missing-account';
    }

    function getTransactionLotScope(txn, tickerOverride = '') {
        const broker = String(txn?.broker || txn?.source?.broker || '').trim().toLowerCase() || 'missing-broker';
        const institution = String(
            txn?.institution || txn?.source?.institution || broker,
        ).trim().toLowerCase() || broker;
        const accountId = String(
            txn?.account_id
            ?? txn?.account
            ?? txn?.source?.account_id
            ?? txn?.source?.account
            ?? '',
        ).trim();
        const accountType = String(
            txn?.account_type ?? txn?.source?.account_type ?? '',
        ).trim().toLowerCase() || 'missing-account-type';
        const ticker = getInvestmentCanonicalTicker(tickerOverride || txn?.ticker) || 'missing-ticker';
        const currency = String(formatTransactionCurrency(txn) || getTickerQuoteCurrency(ticker)).trim().toUpperCase()
            || 'MISSING-CURRENCY';
        const securityId = String(
            txn?.security_id
            ?? txn?.source?.security_id
            ?? txn?.source?.unique_id
            ?? txn?.source?.cusip
            ?? txn?.source?.isin
            ?? '',
        ).trim().toUpperCase() || 'MISSING-SECURITY-ID';
        return {
            broker,
            institution,
            accountId,
            accountToken: normalizeInvestmentLotScopeAccount(broker, accountId),
            accountType,
            ticker,
            currency,
            securityId,
        };
    }

    function getTransactionLotScopeKey(txn, tickerOverride = '') {
        const scope = getTransactionLotScope(txn, tickerOverride);
        return [
            scope.broker,
            scope.institution,
            scope.accountToken,
            scope.accountType,
            scope.ticker,
            scope.currency,
            scope.securityId,
        ].join('|');
    }

    function getTransactionBrokerRealizedPnl(txn) {
        const rawValue = (
            txn?.broker_realized_pnl_raw
            ?? txn?.broker_realized_pnl
            ?? txn?.normalized?.broker_realized_pnl
            ?? txn?.source?.broker_realized_pnl
        );
        if (rawValue === undefined || rawValue === null || String(rawValue).trim() === '') return null;
        const numericValue = Number(rawValue);
        return Number.isFinite(numericValue) ? numericValue : null;
    }

    function hasPartialTaxLotHistorySource(txn) {
        return new Set([
            'hsbc_order_status_text',
            'hsbc_order_status_capture',
            'ibkr_web_trade_notification',
        ]).has(String(txn?.source?.file_kind || '').trim().toLowerCase());
    }

    function getHsbcUsdSavingsCsvLedgerSequence(txn) {
        const source = txn?.source && typeof txn.source === 'object' ? txn.source : {};
        if (String(source.file_kind || '').trim().toLowerCase() !== 'hsbc_usd_savings_csv') {
            return null;
        }
        const sequence = Number(source.ledger_sequence ?? source.row_number);
        return Number.isFinite(sequence) ? sequence : null;
    }

    function getInvestmentReplayIdentity(txn) {
        const source = txn?.source && typeof txn.source === 'object' ? txn.source : {};
        return JSON.stringify([
            String(txn?.broker || source.broker || '').trim().toLowerCase(),
            String(
                txn?.account_id
                ?? txn?.account
                ?? source.account_id
                ?? source.account
                ?? source.account_number
                ?? '',
            ).trim(),
            String(txn?.date || '').trim(),
            String(txn?.datetime || '').trim(),
            String(getNormalizedTransactionType(txn) || '').trim(),
            String(getInvestmentCanonicalTicker(txn?.ticker) || '').trim(),
            String(formatTransactionCurrency(txn) || '').trim().toUpperCase(),
            String(txn?.quantity_raw ?? txn?.quantity ?? source.quantity_raw ?? '').trim(),
            String(txn?.price_raw ?? txn?.price ?? source.price_raw ?? '').trim(),
            String(txn?.net_amount_raw ?? txn?.amount ?? txn?.cash ?? '').trim(),
            String(source.order_id ?? source.execution_id ?? source.message_id ?? source.row_number ?? '').trim(),
            String(txn?.ledger_no ?? source.ledger_no ?? '').trim(),
        ]);
    }

    function compareInvestmentTransactions(leftTxn, rightTxn, leftIndex = 0, rightIndex = 0) {
        const leftReplayOrder = Number(leftTxn?.[INVESTMENT_REPLAY_ORDER_SYMBOL]);
        const rightReplayOrder = Number(rightTxn?.[INVESTMENT_REPLAY_ORDER_SYMBOL]);
        if (
            Number.isInteger(leftReplayOrder)
            && Number.isInteger(rightReplayOrder)
            && leftReplayOrder !== rightReplayOrder
        ) {
            return leftReplayOrder - rightReplayOrder;
        }
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
        const leftSavingsSequence = getHsbcUsdSavingsCsvLedgerSequence(leftTxn);
        const rightSavingsSequence = getHsbcUsdSavingsCsvLedgerSequence(rightTxn);
        if (
            leftSavingsSequence !== null
            && rightSavingsSequence !== null
            && leftSavingsSequence !== rightSavingsSequence
        ) {
            // HSBC's downloaded USD Savings CSV is newest-first. Larger source
            // rows therefore belong earlier in the chronological replay.
            return rightSavingsSequence - leftSavingsSequence;
        }
        const leftBroker = String(leftTxn?.broker || leftTxn?.source?.broker || '').trim().toLowerCase();
        const rightBroker = String(rightTxn?.broker || rightTxn?.source?.broker || '').trim().toLowerCase();
        if (leftBroker === 'hsbc' && rightBroker === 'hsbc') {
            const leftCategory = getHsbcSortCategory(leftTxn);
            const rightCategory = getHsbcSortCategory(rightTxn);
            if (leftCategory !== rightCategory) {
                return leftCategory - rightCategory;
            }
            const leftSequence = getHsbcOrderExecutionSequence(leftTxn);
            const rightSequence = getHsbcOrderExecutionSequence(rightTxn);
            if (Number.isFinite(leftSequence) && Number.isFinite(rightSequence) && leftSequence !== rightSequence) {
                return leftSequence - rightSequence;
            }
        }
        if (leftBroker === 'schwab' && rightBroker === 'schwab') {
            const leftAccount = String(
                leftTxn?.account_id
                ?? leftTxn?.account
                ?? leftTxn?.source?.account_id
                ?? leftTxn?.source?.account
                ?? leftTxn?.source?.account_number
                ?? '',
            ).trim();
            const rightAccount = String(
                rightTxn?.account_id
                ?? rightTxn?.account
                ?? rightTxn?.source?.account_id
                ?? rightTxn?.source?.account
                ?? rightTxn?.source?.account_number
                ?? '',
            ).trim();
            const leftSequence = getSchwabDateOnlyTradeSequence(leftTxn);
            const rightSequence = getSchwabDateOnlyTradeSequence(rightTxn);
            if (
                leftAccount
                && leftAccount === rightAccount
                && Number.isFinite(leftSequence)
                && Number.isFinite(rightSequence)
                && leftSequence !== rightSequence
            ) {
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
        const leftRow = Number(leftTxn?.source?.row_number);
        const rightRow = Number(rightTxn?.source?.row_number);
        if (Number.isFinite(leftRow) && Number.isFinite(rightRow) && leftRow !== rightRow) {
            return leftRow - rightRow;
        }
        const leftIdentity = getInvestmentReplayIdentity(leftTxn);
        const rightIdentity = getInvestmentReplayIdentity(rightTxn);
        if (leftIdentity !== rightIdentity) return leftIdentity.localeCompare(rightIdentity);
        return leftIndex - rightIndex;
    }

    function compareInvestmentTransactionsForReplay(leftTxn, rightTxn, leftIndex = 0, rightIndex = 0) {
        const leftReplayOrder = Number(leftTxn?.[INVESTMENT_REPLAY_ORDER_SYMBOL]);
        const rightReplayOrder = Number(rightTxn?.[INVESTMENT_REPLAY_ORDER_SYMBOL]);
        if (
            Number.isInteger(leftReplayOrder)
            && Number.isInteger(rightReplayOrder)
            && leftReplayOrder !== rightReplayOrder
        ) {
            return leftReplayOrder - rightReplayOrder;
        }
        const leftDate = String(leftTxn?.date || '').slice(0, 10);
        const rightDate = String(rightTxn?.date || '').slice(0, 10);
        if (leftDate !== rightDate) {
            return leftDate.localeCompare(rightDate);
        }
        const leftDatetime = String(leftTxn?.datetime || leftTxn?.date || '');
        const rightDatetime = String(rightTxn?.datetime || rightTxn?.date || '');
        if (leftDatetime !== rightDatetime) {
            return leftDatetime.localeCompare(rightDatetime);
        }
        return compareInvestmentTransactions(leftTxn, rightTxn, leftIndex, rightIndex);
    }

    function compareInvestmentReplaySnapshots(leftSnapshot, rightSnapshot, leftIndex = 0, rightIndex = 0) {
        const leftDate = String(leftSnapshot?.date || '').slice(0, 10);
        const rightDate = String(rightSnapshot?.date || '').slice(0, 10);
        if (leftDate !== rightDate) return leftDate.localeCompare(rightDate);
        const leftOrder = Number(leftSnapshot?.replay_snapshot_order);
        const rightOrder = Number(rightSnapshot?.replay_snapshot_order);
        if (Number.isFinite(leftOrder) && Number.isFinite(rightOrder) && leftOrder !== rightOrder) {
            return leftOrder - rightOrder;
        }
        return compareInvestmentTransactionsForReplay(leftSnapshot, rightSnapshot, leftIndex, rightIndex);
    }

    function getInvestmentTaxLotOrderDatetime(txn) {
        const source = txn?.source && typeof txn.source === 'object' ? txn.source : {};
        const candidates = [
            source.history_order_datetime,
            source.execution_datetime,
            source.trade_datetime,
            source.email_datetime,
            txn?.datetime,
            source.source_datetime_raw,
            txn?.date,
        ];
        for (const candidate of candidates) {
            const normalized = normalizeLedgerDateTime(candidate, '');
            if (normalized) return normalized;
        }
        return '';
    }

    function compareInvestmentTaxLotTransactions(leftTxn, rightTxn, leftIndex = 0, rightIndex = 0) {
        const leftReplayOrder = Number(leftTxn?.[INVESTMENT_REPLAY_ORDER_SYMBOL]);
        const rightReplayOrder = Number(rightTxn?.[INVESTMENT_REPLAY_ORDER_SYMBOL]);
        if (
            Number.isInteger(leftReplayOrder)
            && Number.isInteger(rightReplayOrder)
            && leftReplayOrder !== rightReplayOrder
        ) {
            return leftReplayOrder - rightReplayOrder;
        }
        const leftDatetime = getInvestmentTaxLotOrderDatetime(leftTxn);
        const rightDatetime = getInvestmentTaxLotOrderDatetime(rightTxn);
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
            const leftSequence = getHsbcOrderExecutionSequence(leftTxn);
            const rightSequence = getHsbcOrderExecutionSequence(rightTxn);
            if (Number.isFinite(leftSequence) && Number.isFinite(rightSequence) && leftSequence !== rightSequence) {
                return leftSequence - rightSequence;
            }
        }
        if (leftBroker === 'schwab' && rightBroker === 'schwab') {
            const leftAccount = String(
                leftTxn?.account_id
                ?? leftTxn?.account
                ?? leftTxn?.source?.account_id
                ?? leftTxn?.source?.account
                ?? leftTxn?.source?.account_number
                ?? '',
            ).trim();
            const rightAccount = String(
                rightTxn?.account_id
                ?? rightTxn?.account
                ?? rightTxn?.source?.account_id
                ?? rightTxn?.source?.account
                ?? rightTxn?.source?.account_number
                ?? '',
            ).trim();
            const leftSequence = getSchwabDateOnlyTradeSequence(leftTxn);
            const rightSequence = getSchwabDateOnlyTradeSequence(rightTxn);
            if (
                leftAccount
                && leftAccount === rightAccount
                && Number.isFinite(leftSequence)
                && Number.isFinite(rightSequence)
                && leftSequence !== rightSequence
            ) {
                return leftSequence - rightSequence;
            }
        }
        const leftRow = Number(leftTxn?.source?.row_number ?? leftIndex);
        const rightRow = Number(rightTxn?.source?.row_number ?? rightIndex);
        if (Number.isFinite(leftRow) && Number.isFinite(rightRow) && leftRow !== rightRow) {
            return leftRow - rightRow;
        }
        return leftIndex - rightIndex;
    }

    return {
        getTransactionPrice,
        getTransactionEconomicAmount,
        formatTransactionDateDisplay,
        formatAmountWithCurrency,
        formatTransactionCommissionDisplay,
        formatTransactionCurrency,
        formatForexTradeComponentDescription,
        normalizeTransactionDescriptionWhitespace,
        normalizeKolRewardDescription,
        normalizeLongbridgeUsDividendDescription,
        normalizeTransactionDescriptionPresentation,
        normalizeInvestmentDistributionDescriptionIdentity,
        getTransactionDescriptionText,
        hasExplicitTransactionCurrency,
        getCashTransactionDescription,
        escapeInvestmentDescriptionRegExp,
        getInvestmentMoneyMarketFundIdTicker,
        getInvestmentMoneyMarketDisplayName,
        getInvestmentMoneyMarketDescriptionAliases,
        canonicalizeInvestmentMoneyMarketTicker,
        resolveInvestmentMoneyMarketTransactionIdentity,
        resolveInvestmentCashEquivalentSecurityIdentity,
        getInvestmentMoneyMarketActionLabel,
        getInvestmentMoneyMarketQuantityLabel,
        getInvestmentMoneyMarketTransactionDetails,
        formatInvestmentMoneyMarketTransactionDescription,
        normalizeHsbcOrderReference,
        getHsbcOrderReferenceLabel,
        getHsbcOrderExecutionSequence,
        getSchwabDateOnlyTradeSequence,
        getHsbcSortCategory,
        formatTransactionDescription,
        formatHoldingsMoney,
        formatSignedHoldingsMoney,
        formatHoldingsPercent,
        formatHoldingsUsd,
        formatHoldingsPosition,
        escapeHtml,
        shouldTrackHoldingTicker,
        isForexPairTicker,
        isFlatPosition,
        createPositionState,
        normalizeInvestmentLotScopeAccount,
        getTransactionLotScope,
        getTransactionLotScopeKey,
        getTransactionBrokerRealizedPnl,
        hasPartialTaxLotHistorySource,
        getHsbcUsdSavingsCsvLedgerSequence,
        getInvestmentReplayIdentity,
        compareInvestmentTransactions,
        compareInvestmentTransactionsForReplay,
        compareInvestmentReplaySnapshots,
        getInvestmentTaxLotOrderDatetime,
        compareInvestmentTaxLotTransactions,
    };
}
