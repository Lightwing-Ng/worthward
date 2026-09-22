/**
 * Core transaction, cash-ledger, and FX utilities.
 *
 * Code version: v1.2.2
 * - Changed: Loads exact-date and safe-decimal HSBC evidence validation.
 * - Fixed: HSBC balance boundaries reuse the complete importer evidence
 *   contract instead of trusting filename patterns and coercible balances.
 * - Fixed: Blank HSBC cash balances remain unavailable instead of becoming
 *   an authoritative zero balance.
 * - Changed: Current broker cash snapshots roll forward by ledger cash
 *   movements recorded after the snapshot boundary.
 */

import {
    createHsbcHistoryEvidenceUtils,
} from '../runtime/history-evidence.js?v=investment-history-evidence-v1.0.3';

export function createInvestmentCoreCashUtils(runtime) {
    const formatTransactionCurrency = (...args) => runtime.formatTransactionCurrency(...args);
    const getInvestmentCanonicalTicker = (...args) => runtime.getInvestmentCanonicalTicker(...args);
    const getTransactionPrice = (...args) => runtime.getTransactionPrice(...args);
    const isForexPairTicker = (...args) => runtime.isForexPairTicker(...args);
    const normalizeInvestmentTicker = (...args) => runtime.normalizeInvestmentTicker(...args);
    const normalizeLedgerDate = (...args) => runtime.normalizeLedgerDate(...args);
    const normalizeTransactionDescriptionWhitespace = (...args) => runtime.normalizeTransactionDescriptionWhitespace(...args);

    const {
        getHsbcCashEvidenceState,
        getHsbcStructuredPostingPhysicalEvidenceIdentity,
        hasConsistentHsbcStructuredSettlementAliases,
        normalizeHsbcDecimalText,
        normalizeHsbcEvidenceDate,
    } = createHsbcHistoryEvidenceUtils(runtime, {baseCurrency: 'USD'});

    const INVESTMENT_BASE_CURRENCY = 'USD';
    const USMART_HK_FRACTIONAL_SYNTHETIC_TICKER = 'USMART_HK_FRACTIONAL_SHARES';
    const LONGBRIDGE_HK_CASH_EQUIVALENT_SYNTHETIC_PREFIX = 'LONGBRIDGE_HK_CASH_EQUIVALENT';
    const INVESTMENT_MARKET_CURRENCY_BY_SUFFIX = {
        US: 'USD',
        HK: 'HKD',
        SH: 'CNY',
        SZ: 'CNY',
        SG: 'SGD',
    };
    const INVESTMENT_MONEY_MARKET_STANDARD_NAMES = Object.freeze({
        '005276756': 'Franklin Templeton U.S. Dollar Short-Term Money Market Fund',
        HK0000369196: 'Taikang Kaitai Overseas Short Tenor Bond Fund A USD Acc',
        HK0000478872: 'GaoTeng WeInvest Money Market A HKD Acc',
        HK0000584737: 'GaoTeng WeValue USD Money Mkt A USD Acc',
        HK0000584752: 'GaoTeng WeValue USD Money Mkt C USD Acc',
        HK0000720752: 'Ping An Money Market P USD Acc',
        HK0001039582: 'CMS USD Money Market Fund B Acc',
    });
    const INVESTMENT_MONEY_MARKET_FUND_IDENTITY = Object.freeze({
        GAOTENG_MONEY_MARKET_HKD: 'HK0000478872',
        GAOTENG_MONEY_MARKET_USD: 'HK0000584737',
        PING_AN_MONEY_MARKET_USD: 'HK0000720752',
    });
    const INVESTMENT_MONEY_MARKET_DESCRIPTION_ALIASES = Object.freeze({
        '005276756': [
            'FRANKLIN TEMPLETON OFFSHORE FUNDS FRANKLIN U.S. DOLLAR SHORT-TERM MONEY MARKET "A" (USD) INC',
            'LU0052767562',
            'L9025R513',
        ],
        HK0000478872: [
            'GAOTENG WEINVEST MONEY MARKET FUND',
            'MMF/GTMMF/100000',
        ],
        HK0000584737: [
            'GAOTENG WEVALUE USD MONEY MARKET FUND',
            'GAOTENG WEVALUE USD MONEY MKT A USD ACC',
            'MMF/GTMMF/100001',
        ],
        HK0000720752: [
            'PING AN MONEY MARKET FUND',
            'PING AN MONEY MARKET P USD ACC',
        ],
    });

    function getNormalizedTransactionType(txn) {
        return String(txn?.type || '').replace(/\s+/g, '_').toLowerCase();
    }

    const CASH_DEPOSIT_TYPES = new Set(['deposit', 'virtual_deposit']);
    const CASH_WITHDRAWAL_TYPES = new Set(['withdrawal', 'virtual_withdrawal', 'virtual_balance_reset']);

    function isCashDepositType(normalizedType) {
        return CASH_DEPOSIT_TYPES.has(normalizedType);
    }

    function isCashWithdrawalType(normalizedType) {
        return CASH_WITHDRAWAL_TYPES.has(normalizedType);
    }

    function getTransactionQuantity(txn) {
        const quantity = txn.quantity ?? txn.quantity_abs ?? txn.normalized?.position_quantity;
        return quantity === undefined || quantity === null ? null : Number(quantity);
    }

    function isTigerFundsInTransitTransfer(txn) {
        return (
            String(txn?.broker || '').trim().toLowerCase() === 'tigertrade'
            && String(txn?.source?.statement_section || '').trim() === 'Funds in Transit'
            && ['Fund Subscription', 'Fund Subscription Returned'].includes(
                String(txn?.description || '').trim(),
            )
        );
    }

    function isUsmartHkFractionalSharesTransaction(txn) {
        if (String(txn?.broker || '').trim().toLowerCase() !== 'usmart_hk') return false;
        if (String(txn?.ticker || '').trim()) return false;
        const rawItem = String(txn?.source?.statement_item_raw || '').trim();
        if (['買碎股', '买碎股', '賣碎股', '卖碎股'].includes(rawItem)) return true;
        return /^Fractional Shares (Purchase|Sale)/i.test(String(txn?.description || '').trim());
    }

    function isSyntheticCashEquivalentTicker(ticker) {
        const normalizedTicker = String(ticker || '').trim().toUpperCase();
        return (
            normalizedTicker === USMART_HK_FRACTIONAL_SYNTHETIC_TICKER
            || normalizedTicker.startsWith(`${LONGBRIDGE_HK_CASH_EQUIVALENT_SYNTHETIC_PREFIX}.`)
        );
    }

    function isLongbridgeHkCashEquivalentTransfer(txn) {
        return (
            String(txn?.broker || '').trim().toLowerCase() === 'longbridge_hk'
            && (
                txn?.normalized?.cash_equivalent_transfer === true
                || txn?.source?.cash_equivalent_transfer === true
            )
        );
    }

    function getLongbridgeHkCashEquivalentSyntheticTicker(txn) {
        if (!isLongbridgeHkCashEquivalentTransfer(txn)) return '';
        const fundId = String(
            txn?.normalized?.cash_equivalent_fund_id
            ?? txn?.source?.cash_equivalent_fund_id
            ?? 'longbridge_money_market'
        ).trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
        const currency = normalizeCurrencyCode(formatTransactionCurrency(txn)) || INVESTMENT_BASE_CURRENCY;
        return `${LONGBRIDGE_HK_CASH_EQUIVALENT_SYNTHETIC_PREFIX}.${fundId || 'LONG_BRIDGE_MONEY_MARKET'}.${currency}`;
    }

    function getLongbridgeHkCashEquivalentTransferAmount(txn) {
        const transferAmount = Number(
            txn?.normalized?.cash_equivalent_cash_delta
            ?? txn?.normalized?.display_amount
            ?? txn?.gross_amount_raw
            ?? txn?.source?.cash_equivalent_transfer_amount_raw
            ?? txn?.normalized?.cash_flow_amount
            ?? txn?.normalized?.net_amount
            ?? 0
        );
        return Number.isFinite(transferAmount) ? transferAmount : 0;
    }

    function getTransactionAmount(txn) {
        if (isTigerFundsInTransitTransfer(txn)) {
            return 0;
        }
        if (isLongbridgeHkCashEquivalentTransfer(txn)) {
            return getLongbridgeHkCashEquivalentTransferAmount(txn);
        }
        if (txn?.normalized?.cash_equivalent_transfer === true) {
            const equityDelta = Number(
                txn?.normalized?.cash_equivalent_equity_delta
                ?? txn?.normalized?.net_amount
                ?? 0
            );
            return Number.isFinite(equityDelta) ? equityDelta : 0;
        }
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

    function getInvestmentInternalTransferAggregateBridgeAmount(
        amount,
        txn,
        fxTimeline = null,
        baseCurrency = INVESTMENT_BASE_CURRENCY,
    ) {
        const numericAmount = Number(amount);
        if (!Number.isFinite(numericAmount) || Math.abs(numericAmount) < 1e-9) return 0;
        const normalizedBaseCurrency = normalizeCurrencyCode(baseCurrency) || INVESTMENT_BASE_CURRENCY;
        const currency = normalizeCurrencyCode(formatTransactionCurrency(txn)) || normalizedBaseCurrency;
        return convertAmountToBaseCurrency(
            numericAmount,
            currency,
            normalizeLedgerDate(txn?.date),
            fxTimeline,
            normalizedBaseCurrency,
        );
    }

    function getInvestmentInternalTransferAggregateBridgeDelta(
        txn,
        fxTimeline = null,
        baseCurrency = INVESTMENT_BASE_CURRENCY,
    ) {
        if (txn?.internal_transfer_external_flow_excluded !== true) return 0;
        const cashDelta = getTransactionAmount(txn);
        const bridgeAmount = getInvestmentInternalTransferAggregateBridgeAmount(
            cashDelta,
            txn,
            fxTimeline,
            baseCurrency,
        );
        return Number.isFinite(bridgeAmount) ? -bridgeAmount : 0;
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
        if (['kol_reward', 'sell', 'dividend', 'credit_interest', 'payment_in_lieu'].includes(normalizedType)
            || isCashDepositType(normalizedType)) return 0;
        if (['buy', 'dividend_reinvestment', 'grant'].includes(normalizedType)) return 1;
        if (cashAmount < -1e-9) return 2;
        if (['foreign_tax_withholding', 'debit_interest'].includes(normalizedType)
            || isCashWithdrawalType(normalizedType)) return 2;
        return 1;
    }

    function getInvestmentStartingCash() {
        const rawValue = window.WORTHWARD_INVESTMENT_DATA?.starting_cash;
        if (rawValue === undefined || rawValue === null || rawValue === '') {
            return 0;
        }
        const numericValue = Number(rawValue);
        return Number.isFinite(numericValue) ? numericValue : 0;
    }

    function getInvestmentStartingCashBalances() {
        const rawBalances = window.WORTHWARD_INVESTMENT_DATA?.starting_cash_by_currency;
        if (rawBalances && typeof rawBalances === 'object' && !Array.isArray(rawBalances)) {
            const normalizedBalances = cloneCashLedgerBalances(rawBalances);
            if (Object.keys(normalizedBalances).length) return normalizedBalances;
        }
        const brokerSummaries = window.WORTHWARD_INVESTMENT_DATA?.broker_summaries;
        const aggregateBrokerBalances = {};
        let hasBrokerStartingBalances = false;
        if (brokerSummaries && typeof brokerSummaries === 'object') {
            Object.keys(brokerSummaries).forEach((brokerCode) => {
                const brokerBalances = getInvestmentBrokerStartingCashBalances(brokerCode);
                Object.entries(brokerBalances).forEach(([currency, value]) => {
                    const numericValue = Number(value);
                    if (!Number.isFinite(numericValue) || Math.abs(numericValue) < 1e-9) return;
                    hasBrokerStartingBalances = true;
                    aggregateBrokerBalances[currency] = (
                        Number(aggregateBrokerBalances[currency]) || 0
                    ) + numericValue;
                });
            });
        }
        if (hasBrokerStartingBalances) return aggregateBrokerBalances;
        return createCashLedger(getInvestmentStartingCash(), getInvestmentBaseCurrency());
    }

    function getInvestmentBrokerStartingCash(brokerCode) {
        const normalizedBroker = String(brokerCode || '').trim().toLowerCase();
        if (!normalizedBroker) return 0;
        const summary = window.WORTHWARD_INVESTMENT_DATA?.broker_summaries?.[normalizedBroker];
        if (!summary || typeof summary !== 'object') return 0;
        const rawValue = summary.starting_cash
            ?? summary.starting_cash_raw
            ?? summary.starting_cash_base_currency;
        const numericValue = Number(rawValue);
        return Number.isFinite(numericValue) ? numericValue : 0;
    }

    function getInvestmentBrokerStartingCashBalances(brokerCode) {
        const normalizedBroker = String(brokerCode || '').trim().toLowerCase();
        if (!normalizedBroker) return {};
        const summary = window.WORTHWARD_INVESTMENT_DATA?.broker_summaries?.[normalizedBroker];
        if (!summary || typeof summary !== 'object') return {};
        const rawBalances = summary.starting_cash_by_currency;
        if (rawBalances && typeof rawBalances === 'object' && !Array.isArray(rawBalances)) {
            const normalizedBalances = cloneCashLedgerBalances(rawBalances);
            if (Object.keys(normalizedBalances).length) return normalizedBalances;
        }
        const rawValue = summary.starting_cash
            ?? summary.starting_cash_raw
            ?? summary.starting_cash_base_currency;
        if (rawValue === undefined || rawValue === null || String(rawValue).trim() === '') return {};
        const numericValue = Number(rawValue);
        if (!Number.isFinite(numericValue)) return {};
        return createCashLedger(numericValue, getInvestmentBaseCurrency());
    }

    function getInvestmentEndingCash() {
        const rawValue = window.WORTHWARD_INVESTMENT_DATA?.ending_cash;
        if (rawValue === undefined || rawValue === null || rawValue === '') {
            return null;
        }
        const numericValue = Number(rawValue);
        return Number.isFinite(numericValue) ? numericValue : null;
    }

    function getInvestmentEndingCashBalances() {
        const rawBalances = window.WORTHWARD_INVESTMENT_DATA?.ending_cash_by_currency;
        if (rawBalances && typeof rawBalances === 'object' && !Array.isArray(rawBalances)) {
            const normalizedBalances = cloneCashLedgerBalances(rawBalances);
            if (Object.keys(normalizedBalances).length) return normalizedBalances;
        }
        const endingCash = getInvestmentEndingCash();
        return endingCash === null
            ? null
            : createCashLedger(endingCash, getInvestmentBaseCurrency());
    }

    function getInvestmentEndingCashInBaseCurrency() {
        const rawValue = window.WORTHWARD_INVESTMENT_DATA?.ending_cash_base_currency;
        if (rawValue !== undefined && rawValue !== null && rawValue !== '') {
            const numericValue = Number(rawValue);
            if (Number.isFinite(numericValue)) return numericValue;
        }
        return getInvestmentEndingCash();
    }

    function getInvestmentEndingCashInBaseCurrencyAsOf() {
        const data = window.WORTHWARD_INVESTMENT_DATA || {};
        const summary = data.summary && typeof data.summary === 'object' ? data.summary : {};
        return normalizeLedgerDate(
            data.ending_cash_base_currency_as_of
            ?? summary.ending_cash_base_currency_as_of
            ?? summary.position_snapshot_as_of,
        );
    }

    function getInvestmentBrokerEndingCash(brokerCode) {
        const normalizedBroker = String(brokerCode || '').trim().toLowerCase();
        if (!normalizedBroker) return null;
        const summaries = window.WORTHWARD_INVESTMENT_DATA?.broker_summaries;
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

    function getInvestmentBrokerEndingCashBalances(brokerCode) {
        const normalizedBroker = String(brokerCode || '').trim().toLowerCase();
        if (!normalizedBroker) return null;
        const summaries = window.WORTHWARD_INVESTMENT_DATA?.broker_summaries;
        if (!summaries || typeof summaries !== 'object') return null;
        const summary = summaries[normalizedBroker];
        if (!summary || typeof summary !== 'object') return null;
        const rawBalances = summary.ending_cash_by_currency;
        if (rawBalances && typeof rawBalances === 'object' && !Array.isArray(rawBalances)) {
            const normalizedBalances = cloneCashLedgerBalances(rawBalances);
            if (Object.keys(normalizedBalances).length) return normalizedBalances;
        }
        const endingCash = getInvestmentBrokerEndingCash(normalizedBroker);
        return endingCash === null
            ? null
            : createCashLedger(endingCash, getInvestmentBaseCurrency());
    }

    function getInvestmentBrokerEndingCashInBaseCurrency(brokerCode) {
        const normalizedBroker = String(brokerCode || '').trim().toLowerCase();
        if (!normalizedBroker) return null;
        const summaries = window.WORTHWARD_INVESTMENT_DATA?.broker_summaries;
        const summary = summaries?.[normalizedBroker];
        const rawValue = summary?.ending_cash_base_currency;
        if (rawValue !== undefined && rawValue !== null && rawValue !== '') {
            const numericValue = Number(rawValue);
            if (Number.isFinite(numericValue)) return numericValue;
        }
        return getInvestmentBrokerEndingCash(normalizedBroker);
    }

    function getInvestmentBrokerCurrentPendingSettlementCash(brokerCode) {
        const normalizedBroker = String(brokerCode || '').trim().toLowerCase();
        if (normalizedBroker !== 'hsbc') return 0;
        const summary = window.WORTHWARD_INVESTMENT_DATA?.broker_summaries?.[normalizedBroker];
        const pendingCash = Number(summary?.hsbc_pending_settlement_cash);
        if (Number.isFinite(pendingCash)) return pendingCash;
        const estimate = Number(summary?.hsbc_broker_cash_estimate);
        const baseCash = getInvestmentBrokerEndingCashInBaseCurrency(normalizedBroker);
        return Number.isFinite(estimate) && baseCash !== null
            ? estimate - baseCash
            : 0;
    }

    function getInvestmentBrokerCurrentDisplayCash(brokerCode) {
        const normalizedBroker = String(brokerCode || '').trim().toLowerCase();
        if (!normalizedBroker) return null;
        const summary = window.WORTHWARD_INVESTMENT_DATA?.broker_summaries?.[normalizedBroker];
        if (!summary || typeof summary !== 'object' || summary.cash_snapshot_authoritative === false) {
            return null;
        }
        if (normalizedBroker === 'hsbc') {
            const estimate = Number(summary.hsbc_broker_cash_estimate);
            if (Number.isFinite(estimate)) return estimate;
            const baseCash = getInvestmentBrokerEndingCashInBaseCurrency(normalizedBroker);
            if (baseCash === null) return null;
            return baseCash + getInvestmentBrokerCurrentPendingSettlementCash(normalizedBroker);
        }
        const baseCash = getInvestmentBrokerEndingCashInBaseCurrency(normalizedBroker);
        return baseCash === null ? null : baseCash;
    }

    function buildInvestmentPostSnapshotCashDelta(projectedBalances, authoritativeBalances) {
        // Rows after a dated snapshot carry projected balances equal to the
        // snapshot plus the ledger movement since the boundary, so the
        // difference is the post-snapshot cash movement per currency.
        const projected = cloneCashLedgerBalances(projectedBalances || {});
        const authoritative = cloneCashLedgerBalances(authoritativeBalances || {});
        const delta = {};
        Object.entries(authoritative).forEach(([currency, value]) => {
            const change = (Number(projected[currency]) || 0) - (Number(value) || 0);
            if (Number.isFinite(change) && Math.abs(change) > 1e-9) delta[currency] = change;
        });
        return delta;
    }

    function getInvestmentBrokerCurrentCashSnapshot(
        brokerCode,
        targetDate = '',
        fxTimeline = null,
        {postSnapshotCashDelta = null} = {},
    ) {
        const normalizedBroker = String(brokerCode || '').trim().toLowerCase();
        if (!normalizedBroker) return null;
        const summary = window.WORTHWARD_INVESTMENT_DATA?.broker_summaries?.[normalizedBroker];
        if (!summary || typeof summary !== 'object' || summary.cash_snapshot_authoritative === false) {
            return null;
        }
        const baseCurrency = getInvestmentBaseCurrency();
        const baseCash = getInvestmentBrokerEndingCashInBaseCurrency(normalizedBroker);
        const endingBalances = getInvestmentBrokerEndingCashBalances(normalizedBroker);
        const runningBalances = endingBalances && Object.keys(endingBalances).length
            ? {...endingBalances}
            : {};
        if (baseCash !== null) {
            runningBalances[baseCurrency] = baseCash;
        }
        if (!Object.keys(runningBalances).length) return null;
        if (postSnapshotCashDelta && typeof postSnapshotCashDelta === 'object') {
            // The summary is a dated boundary; later ledger movements such as
            // a withdrawal imported after the snapshot still change cash.
            Object.entries(postSnapshotCashDelta).forEach(([currency, change]) => {
                const normalizedCurrency = normalizeCurrencyCode(currency);
                const numericChange = Number(change);
                if (!normalizedCurrency || !Number.isFinite(numericChange)) return;
                const nextValue = (Number(runningBalances[normalizedCurrency]) || 0) + numericChange;
                if (Math.abs(nextValue) < 1e-9) delete runningBalances[normalizedCurrency];
                else runningBalances[normalizedCurrency] = nextValue;
            });
        }
        const resolvedFxTimeline = fxTimeline || buildInvestmentFxRateTimeline(
            window.WORTHWARD_INVESTMENT_DATA?.transactions || [],
            baseCurrency,
        );
        const resolvedDate = normalizeLedgerDate(targetDate) || getTodayLedgerDate();
        const runningCash = sumCashLedgerInBaseCurrency(
            runningBalances,
            resolvedDate,
            resolvedFxTimeline,
            baseCurrency,
        );
        const pendingSettlementCash = getInvestmentBrokerCurrentPendingSettlementCash(
            normalizedBroker,
        );
        const pendingOrderCount = Number(summary.hsbc_pending_settlement_order_count) || 0;
        return {
            brokerCode: normalizedBroker,
            runningBalances,
            runningCash,
            pendingSettlementCash,
            displayCash: runningCash + pendingSettlementCash,
            // FX conversion is deterministic display arithmetic, not an
            // unsettled-cash warning. Mark only an HSBC snapshot that still
            // has pending settlement evidence.
            isApproximate: normalizedBroker === 'hsbc' && (
                pendingOrderCount > 0
                || Math.abs(pendingSettlementCash) > 1e-9
            ),
        };
    }

    function getInvestmentBrokerEndingCashAsOf(brokerCode) {
        const normalizedBroker = String(brokerCode || '').trim().toLowerCase();
        if (!normalizedBroker) return '';
        const summaries = window.WORTHWARD_INVESTMENT_DATA?.broker_summaries;
        const summary = summaries?.[normalizedBroker];
        if (!summary || typeof summary !== 'object') return '';
        const explicitDate = normalizeLedgerDate(
            summary.ending_cash_replay_as_of
            ?? summary.ending_cash_base_currency_as_of
            ?? summary.ending_cash_as_of
            ?? summary.cash_snapshot_as_of,
        );
        if (explicitDate) return explicitDate;
        const positionSnapshotDate = normalizeLedgerDate(summary.position_snapshot_as_of);
        if (positionSnapshotDate) return positionSnapshotDate;
        const statementDate = normalizeLedgerDate(summary.statement_date_max);
        if (statementDate) return statementDate;
        const transactionDate = normalizeLedgerDate(summary.transaction_date_max);
        if (transactionDate) return transactionDate;
        const postDates = summary.hsbc_cash_component_post_dates;
        if (postDates && typeof postDates === 'object') {
            return Object.values(postDates).map(normalizeLedgerDate).filter(Boolean).sort().pop() || '';
        }
        return '';
    }

    function getInvestmentBrokerEndingCashAsOfDateTime(brokerCode) {
        const normalizedBroker = String(brokerCode || '').trim().toLowerCase();
        if (!normalizedBroker) return '';
        const summaries = window.WORTHWARD_INVESTMENT_DATA?.broker_summaries;
        const summary = summaries?.[normalizedBroker];
        if (!summary || typeof summary !== 'object') return '';
        const rawValue = String(
            summary.ending_cash_replay_as_of_datetime
            ?? summary.ending_cash_as_of_datetime
            ?? '',
        ).trim().replace('T', ' ');
        const match = rawValue.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})/);
        return match ? `${match[1]} ${match[2]}` : '';
    }

    function getInvestmentPositionSnapshotAsOf() {
        const data = window.WORTHWARD_INVESTMENT_DATA || {};
        const summary = data.summary && typeof data.summary === 'object' ? data.summary : {};
        const explicitDate = normalizeLedgerDate(
            data.position_snapshot_as_of
            ?? summary.position_snapshot_as_of,
        );
        if (explicitDate) return explicitDate;
        const rawSnapshot = data.position_snapshot;
        if (!rawSnapshot || typeof rawSnapshot !== 'object' || Array.isArray(rawSnapshot)) {
            return '';
        }
        return Object.values(rawSnapshot)
            .map((entry) => normalizeLedgerDate(entry?.as_of ?? entry?.asOf))
            .filter(Boolean)
            .sort()
            .pop() || '';
    }

    function getInvestmentBrokerPositionSnapshotAsOf(brokerCode) {
        const normalizedBroker = String(brokerCode || '').trim().toLowerCase();
        if (!normalizedBroker) return '';
        const summary = window.WORTHWARD_INVESTMENT_DATA?.broker_summaries?.[normalizedBroker];
        if (!summary || typeof summary !== 'object') return '';
        const explicitDate = normalizeLedgerDate(summary.position_snapshot_as_of);
        if (explicitDate) return explicitDate;
        const rawSnapshot = summary.position_snapshot;
        if (!rawSnapshot || typeof rawSnapshot !== 'object' || Array.isArray(rawSnapshot)) {
            return '';
        }
        return Object.values(rawSnapshot)
            .map((entry) => normalizeLedgerDate(entry?.as_of ?? entry?.asOf))
            .filter(Boolean)
            .sort()
            .pop() || '';
    }

    function buildDatedCashSnapshotProjection(
        rows,
        {
            asOf = '',
            asOfDateTime = '',
            authoritativeBaseCash = null,
            authoritativeBalances = null,
            baseCurrency = INVESTMENT_BASE_CURRENCY,
            getRowDate = (row) => row?.date,
            getRowDateTime = (row) => row?.datetime,
            getRunningCash = (row) => row?.broker_running_cash,
            getBalances = (row) => row?.broker_cash_by_currency,
            getBoundaryCurrencies = () => [],
        } = {},
    ) {
        const orderedRows = Array.isArray(rows) ? rows : [];
        const snapshotDate = normalizeLedgerDate(asOf);
        const normalizedSnapshotDateTime = String(asOfDateTime || '')
            .trim()
            .replace('T', ' ')
            .match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})/);
        const snapshotDateTime = normalizedSnapshotDateTime
            ? `${normalizedSnapshotDateTime[1]} ${normalizedSnapshotDateTime[2]}`
            : '';
        const useDateTimeBoundary = Boolean(snapshotDateTime);
        if (!orderedRows.length || (!snapshotDate && !snapshotDateTime)) {
            return {applied: false, boundaryIndex: -1, projections: []};
        }
        const rowKeys = orderedRows.map((row) => {
            if (!useDateTimeBoundary) return normalizeLedgerDate(getRowDate(row));
            const rawDateTime = String(getRowDateTime(row) ?? '').trim().replace('T', ' ');
            const dateTimeMatch = rawDateTime.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})/);
            if (dateTimeMatch) return `${dateTimeMatch[1]} ${dateTimeMatch[2]}`;
            const rowDate = normalizeLedgerDate(getRowDate(row));
            return rowDate ? `${rowDate} 00:00:00` : '';
        });
        const snapshotKey = useDateTimeBoundary
            ? snapshotDateTime
            : snapshotDate;
        const latestKey = rowKeys.filter(Boolean).sort().pop() || '';
        if (!latestKey || latestKey < snapshotKey) {
            return {applied: false, boundaryIndex: -1, projections: []};
        }

        let boundaryIndex = -1;
        let hasExactBoundary = false;
        rowKeys.forEach((rowKey, index) => {
            if (!rowKey || rowKey > snapshotKey) return;
            if (rowKey === snapshotKey) hasExactBoundary = true;
            boundaryIndex = index;
        });
        if (boundaryIndex < 0) {
            return {applied: false, boundaryIndex: -1, projections: []};
        }

        const rawBoundaryCash = Number(getRunningCash(orderedRows[boundaryIndex]));
        const numericAuthoritativeCash = Number(authoritativeBaseCash);
        let baseAdjustment = (
            Number.isFinite(rawBoundaryCash)
            && Number.isFinite(numericAuthoritativeCash)
        )
            ? numericAuthoritativeCash - rawBoundaryCash
            : null;
        const rawBoundaryBalances = cloneCashLedgerBalances(
            getBalances(orderedRows[boundaryIndex]) || {},
        );
        const normalizedAuthoritativeBalances = (
            authoritativeBalances
            && typeof authoritativeBalances === 'object'
            && !Array.isArray(authoritativeBalances)
        )
            ? cloneCashLedgerBalances(authoritativeBalances)
            : {};
        const balanceAdjustments = {};
        Object.entries(normalizedAuthoritativeBalances).forEach(([currency, value]) => {
            const normalizedCurrency = normalizeCurrencyCode(currency);
            const numericValue = Number(value);
            const rawValue = Number(rawBoundaryBalances[normalizedCurrency] ?? 0);
            if (!normalizedCurrency || !Number.isFinite(numericValue) || !Number.isFinite(rawValue)) return;
            balanceAdjustments[normalizedCurrency] = numericValue - rawValue;
        });
        if (baseAdjustment === null && !Object.keys(balanceAdjustments).length) {
            return {applied: false, boundaryIndex, projections: []};
        }

        const normalizedBaseCurrency = normalizeCurrencyCode(baseCurrency) || INVESTMENT_BASE_CURRENCY;
        const applyFromIndex = hasExactBoundary ? boundaryIndex : boundaryIndex + 1;
        const projections = [];
        for (let index = applyFromIndex; index < orderedRows.length; index += 1) {
            const row = orderedRows[index];
            const rowKey = rowKeys[index];
            if (!rowKey || rowKey < snapshotKey) continue;
            if (index > boundaryIndex && rowKey > snapshotKey) {
                const boundaryCurrencies = new Set(
                    (Array.isArray(getBoundaryCurrencies(row)) ? getBoundaryCurrencies(row) : [])
                        .map(normalizeCurrencyCode)
                        .filter(Boolean),
                );
                if (boundaryCurrencies.has(normalizedBaseCurrency)) {
                    baseAdjustment = 0;
                    Object.keys(balanceAdjustments).forEach((currency) => {
                        delete balanceAdjustments[currency];
                    });
                } else {
                    boundaryCurrencies.forEach((currency) => {
                        delete balanceAdjustments[currency];
                    });
                }
            }

            const rawCash = Number(getRunningCash(row));
            const projectedCash = Number.isFinite(rawCash) && baseAdjustment !== null
                ? rawCash + baseAdjustment
                : rawCash;
            const projectedBalances = cloneCashLedgerBalances(getBalances(row) || {});
            Object.entries(balanceAdjustments).forEach(([currency, adjustment]) => {
                const nextValue = (Number(projectedBalances[currency]) || 0) + Number(adjustment);
                if (Math.abs(nextValue) < 1e-9) delete projectedBalances[currency];
                else projectedBalances[currency] = nextValue;
            });
            projections.push({
                index,
                runningCash: projectedCash,
                balances: projectedBalances,
                afterSnapshot: rowKey > snapshotKey,
            });
        }
        return {
            applied: projections.length > 0,
            boundaryIndex,
            projections,
        };
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
        const canonicalTicker = getInvestmentCanonicalTicker(normalizedTicker);
        const configuredMoneyMarketCurrency = normalizeCurrencyCode(
            globalThis.window?.WORTHWARD_INVESTMENT_DATA?.money_market_quote_currencies?.[canonicalTicker]
            ?? globalThis.window?.WORTHWARD_INVESTMENT_DATA?.money_market_quote_currencies?.[normalizedTicker],
        );
        if (configuredMoneyMarketCurrency) return configuredMoneyMarketCurrency;
        if (normalizedTicker.startsWith(`${LONGBRIDGE_HK_CASH_EQUIVALENT_SYNTHETIC_PREFIX}.`)) {
            const currency = normalizeCurrencyCode(normalizedTicker.split('.').pop());
            return currency || INVESTMENT_BASE_CURRENCY;
        }
        if (isSyntheticCashEquivalentTicker(normalizedTicker)) return INVESTMENT_BASE_CURRENCY;
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

    function createCashLedgerFromBalances(
        balances,
        fallbackCash = null,
        baseCurrency = INVESTMENT_BASE_CURRENCY,
    ) {
        if (balances && typeof balances === 'object' && !Array.isArray(balances)) {
            const normalizedBalances = cloneCashLedgerBalances(balances);
            if (Object.keys(normalizedBalances).length) return normalizedBalances;
        }
        return fallbackCash === null || fallbackCash === undefined
            ? {}
            : createCashLedger(fallbackCash, baseCurrency);
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

    function normalizeInvestmentCashScopeToken(value) {
        return String(value || '').trim().toUpperCase().replace(/\s+/g, ' ');
    }

    function normalizeHsbcCashAccountType(value, currency) {
        const normalizedCurrency = normalizeCurrencyCode(currency)
            .replace(/^(?:CNY|RMB)$/, 'CNH');
        let normalizedType = normalizeInvestmentCashScopeToken(value);
        const leadingCurrency = normalizedType.match(/^(USD|HKD|CNH|CNY|RMB)\s+/);
        if (leadingCurrency) {
            const explicitCurrency = leadingCurrency[1].replace(/^(?:CNY|RMB)$/, 'CNH');
            if (explicitCurrency !== normalizedCurrency) return '';
            normalizedType = normalizedType.slice(leadingCurrency[0].length);
        }
        const foreignSavings = normalizedType.match(
            /^FOREIGN CURRENCY SAVINGS(?:\s+(USD|HKD|CNH|CNY|RMB))?$/,
        );
        if (foreignSavings) {
            const explicitCurrency = String(foreignSavings[1] || '')
                .replace(/^(?:CNY|RMB)$/, 'CNH');
            if (explicitCurrency && explicitCurrency !== normalizedCurrency) return '';
            normalizedType = 'SAVINGS';
        }
        normalizedType = normalizedType.replace(/\b(?:CNY|RMB)\b/g, 'CNH');
        return normalizedCurrency && normalizedType ? normalizedType : '';
    }

    function getInvestmentCashBalanceScope(txn) {
        if (String(txn?.broker || '').trim().toLowerCase() !== 'hsbc') return '';
        const source = txn?.source && typeof txn.source === 'object' ? txn.source : {};
        const account = normalizeInvestmentCashScopeToken(
            txn?.account
            ?? source.account
            ?? source.account_number,
        );
        const currency = normalizeCurrencyCode(
            formatTransactionCurrency(txn) || source.statement_currency_raw,
        );
        const accountType = normalizeHsbcCashAccountType(
            txn?.account_type ?? source.account_type,
            currency,
        );
        if (!account || !accountType || !currency) return '';
        return ['HSBC', account, accountType, currency].join('|');
    }

    function getInvestmentCashBalanceBoundary(txn) {
        const evidence = getHsbcCashEvidenceState(txn);
        if (!evidence.isConsistent || evidence.balance === null) return null;
        return {
            scopeKey: evidence.descriptor.cashScopeKey,
            currency: evidence.descriptor.currency,
            balance: evidence.balance,
        };
    }

    function createInvestmentCashScopeLedger(startingBalances = {}) {
        return {
            unscopedBalances: cloneCashLedgerBalances(startingBalances),
            scopedBalances: {},
            scopedCurrencies: {},
        };
    }

    function addInvestmentCashScopeDelta(ledger, currency, amount) {
        if (!ledger || typeof ledger !== 'object') return;
        addCashLedgerDelta(
            ledger.unscopedBalances || (ledger.unscopedBalances = {}),
            currency,
            amount,
        );
    }

    function setInvestmentCashScopeBoundary(ledger, boundary) {
        if (!ledger || typeof ledger !== 'object') return false;
        const normalizedCurrency = normalizeCurrencyCode(boundary?.currency);
        const scopeKey = String(boundary?.scopeKey || '').trim();
        const numericBalance = Number(boundary?.balance);
        if (!normalizedCurrency || !scopeKey || !Number.isFinite(numericBalance)) return false;
        if (!ledger.unscopedBalances || typeof ledger.unscopedBalances !== 'object') {
            ledger.unscopedBalances = {};
        }
        if (!ledger.scopedBalances || typeof ledger.scopedBalances !== 'object') {
            ledger.scopedBalances = {};
        }
        if (!ledger.scopedCurrencies || typeof ledger.scopedCurrencies !== 'object') {
            ledger.scopedCurrencies = {};
        }
        // A statement balance is a complete boundary for its currency. Normal
        // replay deltas before it cannot be assigned to a verified subaccount,
        // so retaining them beside the boundary would double count cash.
        delete ledger.unscopedBalances[normalizedCurrency];
        ledger.scopedCurrencies[normalizedCurrency] = true;
        ledger.scopedBalances[scopeKey] = numericBalance;
        return true;
    }

    function setInvestmentCashScopeAggregateBalance(ledger, currency, amount) {
        if (!ledger || typeof ledger !== 'object') return;
        const normalizedCurrency = normalizeCurrencyCode(currency);
        const numericAmount = Number(amount);
        if (!normalizedCurrency || !Number.isFinite(numericAmount)) return;
        const scopedTotal = Object.entries(ledger.scopedBalances || {}).reduce(
            (total, [scopeKey, value]) => (
                scopeKey.endsWith(`|${normalizedCurrency}`)
                    ? total + (Number(value) || 0)
                    : total
            ),
            0,
        );
        addCashLedgerDelta(
            ledger.unscopedBalances || (ledger.unscopedBalances = {}),
            normalizedCurrency,
            numericAmount - scopedTotal - (Number(ledger.unscopedBalances?.[normalizedCurrency]) || 0),
        );
    }

    function getInvestmentCashScopeBalances(ledger) {
        const balances = cloneCashLedgerBalances(ledger?.unscopedBalances || {});
        Object.entries(ledger?.scopedBalances || {}).forEach(([scopeKey, value]) => {
            const currency = normalizeCurrencyCode(scopeKey.split('|').pop());
            const numericValue = Number(value);
            if (!currency || !Number.isFinite(numericValue)) return;
            addCashLedgerDelta(balances, currency, numericValue);
        });
        return balances;
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
        const currencies = ['CNY', 'CNH'].includes(normalizedCurrency)
            ? ['CNY', 'CNH']
            : [normalizedCurrency];
        currencies.forEach((currencyCode) => {
            if (!dateRates[currencyCode]) {
                dateRates[currencyCode] = {};
            }
            dateRates[currencyCode][normalizedDate] = numericRate;
        });
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
        const externalHistory = globalThis.window?.WORTHWARD_INVESTMENT_DATA?.fx_rate_history_by_currency;
        if (externalHistory && typeof externalHistory === 'object') {
            Object.entries(externalHistory).forEach(([currency, entry]) => {
                const normalizedCurrency = normalizeCurrencyCode(currency);
                if (!normalizedCurrency || normalizedCurrency === normalizedBaseCurrency) return;
                const values = entry?.values && typeof entry.values === 'object' ? entry.values : {};
                const dates = Array.isArray(entry?.dates) ? entry.dates : Object.keys(values);
                dates.forEach((date) => {
                    recordFxRateForDate(
                        dateRates,
                        normalizedCurrency,
                        date,
                        values[date],
                    );
                });
            });
        }
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
        (Array.isArray(transactions) ? transactions : []).forEach((txn) => {
            const currency = normalizeCurrencyCode(formatTransactionCurrency(txn));
            const ledgerDate = normalizeLedgerDate(txn?.date);
            const statementRate = Number(txn?.source?.statement_currency_to_base_rate_raw);
            if (currency && currency !== normalizedBaseCurrency && ledgerDate && Number.isFinite(statementRate) && statementRate > 0) {
                recordFxRateForDate(dateRates, currency, ledgerDate, statementRate);
            }
        });

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
        if (amount === null || amount === undefined || amount === '' || !Number.isFinite(numericAmount)) return NaN;
        if (numericAmount === 0) return 0;
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
        // NaN preserves unknown values through arithmetic; null would add as zero.
        return NaN;
    }

    function convertAmountToBaseCurrency(amount, currency, targetDate, fxTimeline, baseCurrency = INVESTMENT_BASE_CURRENCY) {
        const numericAmount = Number(amount);
        if (amount === null || amount === undefined || amount === '' || !Number.isFinite(numericAmount)) return NaN;
        if (numericAmount === 0) return 0;
        const normalizedCurrency = normalizeCurrencyCode(currency) || normalizeCurrencyCode(baseCurrency) || INVESTMENT_BASE_CURRENCY;
        const normalizedBaseCurrency = normalizeCurrencyCode(baseCurrency) || INVESTMENT_BASE_CURRENCY;
        if (normalizedCurrency === normalizedBaseCurrency) {
            return numericAmount;
        }
        const rate = getFxRateForDate(fxTimeline, normalizedCurrency, targetDate);
        if (Number.isFinite(rate) && rate > 0) {
            return numericAmount / rate;
        }
        // NaN preserves unknown values through arithmetic; null would add as zero.
        return NaN;
    }

    function sumCashLedgerInBaseCurrency(balances, targetDate, fxTimeline, baseCurrency = INVESTMENT_BASE_CURRENCY) {
        return Object.entries(balances || {}).reduce((total, [currency, value]) => (
            total + convertAmountToBaseCurrency(value, currency, targetDate, fxTimeline, baseCurrency)
        ), 0);
    }

    return {
        INVESTMENT_BASE_CURRENCY,
        USMART_HK_FRACTIONAL_SYNTHETIC_TICKER,
        LONGBRIDGE_HK_CASH_EQUIVALENT_SYNTHETIC_PREFIX,
        INVESTMENT_MARKET_CURRENCY_BY_SUFFIX,
        INVESTMENT_MONEY_MARKET_STANDARD_NAMES,
        INVESTMENT_MONEY_MARKET_FUND_IDENTITY,
        INVESTMENT_MONEY_MARKET_DESCRIPTION_ALIASES,
        CASH_DEPOSIT_TYPES,
        CASH_WITHDRAWAL_TYPES,
        getNormalizedTransactionType,
        isCashDepositType,
        isCashWithdrawalType,
        getTransactionQuantity,
        isTigerFundsInTransitTransfer,
        isUsmartHkFractionalSharesTransaction,
        isSyntheticCashEquivalentTicker,
        isLongbridgeHkCashEquivalentTransfer,
        getLongbridgeHkCashEquivalentSyntheticTicker,
        getLongbridgeHkCashEquivalentTransferAmount,
        getTransactionAmount,
        getInvestmentInternalTransferAggregateBridgeAmount,
        getInvestmentInternalTransferAggregateBridgeDelta,
        getTransactionCommission,
        getTransactionCashSortAmount,
        getSameTimeCashSafetySortCategory,
        getInvestmentStartingCash,
        getInvestmentStartingCashBalances,
        getInvestmentBrokerStartingCash,
        getInvestmentBrokerStartingCashBalances,
        getInvestmentEndingCash,
        getInvestmentEndingCashBalances,
        getInvestmentEndingCashInBaseCurrency,
        getInvestmentEndingCashInBaseCurrencyAsOf,
        getInvestmentBrokerEndingCash,
        getInvestmentBrokerEndingCashBalances,
        getInvestmentBrokerEndingCashInBaseCurrency,
        getInvestmentBrokerCurrentPendingSettlementCash,
        getInvestmentBrokerCurrentDisplayCash,
        getInvestmentBrokerCurrentCashSnapshot,
        buildInvestmentPostSnapshotCashDelta,
        getInvestmentBrokerEndingCashAsOf,
        getInvestmentBrokerEndingCashAsOfDateTime,
        getInvestmentPositionSnapshotAsOf,
        getInvestmentBrokerPositionSnapshotAsOf,
        buildDatedCashSnapshotProjection,
        normalizeCurrencyCode,
        getInvestmentBaseCurrency,
        isKolRewardTransaction,
        sumKolRewardRealizedIncomeInBaseCurrency,
        getTickerQuoteCurrency,
        createCashLedger,
        createCashLedgerFromBalances,
        cloneCashLedgerBalances,
        normalizeInvestmentCashScopeToken,
        getHsbcCashEvidenceState,
        getHsbcStructuredPostingPhysicalEvidenceIdentity,
        hasConsistentHsbcStructuredSettlementAliases,
        normalizeHsbcDecimalText,
        normalizeHsbcEvidenceDate,
        getInvestmentCashBalanceScope,
        getInvestmentCashBalanceBoundary,
        createInvestmentCashScopeLedger,
        addInvestmentCashScopeDelta,
        setInvestmentCashScopeBoundary,
        setInvestmentCashScopeAggregateBalance,
        getInvestmentCashScopeBalances,
        addCashLedgerDelta,
        isCurrencyConversionCashFlow,
        isForexConversionTimelineRow,
        getForexConversionTimelineGroupKey,
        recordFxRateForDate,
        getTodayLedgerDate,
        recordForexTradeFxRates,
        buildInvestmentFxRateTimeline,
        getFxRateForDate,
        getLatestFxRateForCurrency,
        convertAmountToBaseCurrencyAtLatestRate,
        convertAmountToBaseCurrency,
        sumCashLedgerInBaseCurrency,
    };
}
