/**
 * Workspace navigation, segmented controls, and responsive layout.
 *
 * Code version: v1.2.0
 * - Changed: A Schwab security receipt offers only matching imported source
 *   transfer-out legs instead of every non-Schwab account in the ledger.
 */

export function createInvestmentWorkspaceControlsRuntime(runtime) {
function getInvestmentCanonicalSummaryRealizedPnl(summary, fallback = null) {
        const reconciliation = summary?.realizedPnlReconciliation;
        if (
            reconciliation
            && Object.prototype.hasOwnProperty.call(reconciliation, 'realizedPnl')
        ) {
            return reconciliation.realizedPnl;
        }
        return fallback === null ? summary?.realizedPnl : fallback;
    }

function getInvestmentCanonicalSummaryRealizedPnlLocal(summary, fallback = null) {
        const reconciliation = summary?.realizedPnlReconciliation;
        if (
            reconciliation
            && Object.prototype.hasOwnProperty.call(reconciliation, 'realizedPnlLocal')
        ) {
            return reconciliation.realizedPnlLocal;
        }
        return fallback === null ? summary?.realizedPnlLocal : fallback;
    }

function hasInvestmentPnlUnavailable(tickerSummaries = []) {
        return (Array.isArray(tickerSummaries) ? tickerSummaries : []).some(
            (summary) => summary?.pnlUnavailable === true,
        );
    }

function isInvestmentAggregatePnlUnavailable(tickerSummaries = []) {
        return runtime.getInvestmentAggregatePnlCoverage(tickerSummaries).status !== 'complete';
    }

function getInvestmentSecurityTransferReceiptSourceOptions(receiptTxn) {
        // Offer only imported source transfer-out legs that already satisfy the
        // in-kind pair constraints (other broker, same date, ticker, quantity).
        // Unrelated accounts, buys, or positions are never offered as a source.
        const receiptKey = String(
            receiptTxn?.security_transfer_receipt_key || receiptTxn?.manual_internal_transfer_key || ''
        ).trim();
        if (!receiptKey) return [];
        const optionsByReceiptKey = runtime.state.investmentSecurityTransferReceiptSourceOptionsByKey;
        return optionsByReceiptKey instanceof Map ? (optionsByReceiptKey.get(receiptKey) || []) : [];
    }

async function rememberInvestmentSecurityTransferAttribution(
        receiptKey,
        sourceBroker,
        sourceAccount,
    ) {
        const normalizedReceiptKey = String(receiptKey || '').trim();
        if (!normalizedReceiptKey) throw new Error('A Schwab transfer receipt key is required.');
        const response = await fetch('/api/investment/security-transfer-attribution', {
            ...runtime.buildInvestmentRequestOptions({
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    receipt_key: normalizedReceiptKey,
                    source_broker: String(sourceBroker || '').trim(),
                    source_account: String(sourceAccount || '').trim(),
                }),
            }),
        });
        let payload = null;
        try {
            payload = await response.json();
        } catch (_error) {
        }
        if (!response.ok || payload?.success !== true) {
            throw new Error(
                String(payload?.error || 'The Schwab transfer attribution could not be saved.').trim()
            );
        }
        if (window.WORTHWARD_INVESTMENT_DATA && payload?.summary) {
            window.WORTHWARD_INVESTMENT_DATA.summary = payload.summary;
        }
        if (
            window.WORTHWARD_INVESTMENT_DATA
            && Object.prototype.hasOwnProperty.call(payload || {}, 'manual_security_transfer_attributions')
        ) {
            window.WORTHWARD_INVESTMENT_DATA.manual_security_transfer_attributions = (
                payload.manual_security_transfer_attributions
            );
        }
        return payload || {success: true};
    }

function getInvestmentTransactionSourceIdentity(txn) {
        const source = txn?.source && typeof txn.source === 'object' ? txn.source : {};
        const firstSourceValue = (fieldNames) => {
            for (const fieldName of fieldNames) {
                const value = String(source?.[fieldName] ?? '').trim();
                if (value) return value;
            }
            return '';
        };
        return [
            String(source?.file_kind || '').trim(),
            String(source?.source_filename || '').trim(),
            String(source?.source_file_sha256 || '').trim(),
            firstSourceValue(['row_number', 'source_row', 'ledger_sequence']),
            firstSourceValue(['reference_id', 'order_reference', 'transaction_id']),
            String(txn?.description || '').replace(/\s+/g, ' ').trim(),
        ];
    }

function buildInvestmentTransactionBaseBindingKey(txn) {
        if (!txn || typeof txn !== 'object') return '';
        const source = txn?.source && typeof txn.source === 'object' ? txn.source : {};
        const amountValue = (
            txn?.net_amount_raw
            ?? txn?.gross_amount_raw
            ?? txn?.normalized?.net_amount
            ?? txn?.normalized?.gross_amount
            ?? txn?.amount
            ?? ''
        );
        const numericAmount = Number(String(amountValue).replace(/,/g, ''));
        const amountText = Number.isFinite(numericAmount)
            ? numericAmount.toFixed(8).replace(/\.?0+$/, '')
            : String(amountValue || '').trim();
        const brokerCode = runtime.normalizeInvestmentBroker(runtime.getTransactionBrokerCode(txn));
        const accountText = String(txn?.account || source?.account || source?.account_number || '').trim();
        const accountMatch = brokerCode === 'ibkr'
            ? accountText.toUpperCase().match(/^U(?:\*+|\d+)(\d{5})$/)
            : null;
        const accountIdentity = accountMatch ? `ibkr:u-suffix:${accountMatch[1]}` : accountText;
        const normalizedType = runtime.getNormalizedTransactionType(txn);
        const explicitCurrency = String(runtime.formatTransactionCurrency(txn) || '').trim().toUpperCase();
        const currencyIdentity = (
            brokerCode === 'ibkr'
            && ['deposit', 'withdrawal'].includes(normalizedType)
            && ['', 'USD'].includes(explicitCurrency)
        ) ? 'USD_OR_MISSING' : explicitCurrency;
        if (!brokerCode || !txn?.date || !normalizedType || !amountText) return '';
        if (['transfer_in', 'transfer_out'].includes(normalizedType)) {
            const ticker = runtime.getInvestmentCanonicalTicker(txn?.ticker);
            const quantity = Number(runtime.getTransactionQuantity(txn));
            const quantityText = Number.isFinite(quantity)
                ? Math.abs(quantity).toFixed(8).replace(/\.?0+$/, '')
                : '';
            if (!ticker || !quantityText) return '';
            return `v2:${JSON.stringify([
                brokerCode,
                accountIdentity,
                String(txn?.date || '').trim(),
                normalizedType,
                ticker,
                quantityText,
                currencyIdentity,
            ])}`;
        }
        return `v2:${JSON.stringify([
            brokerCode,
            accountIdentity,
            String(txn?.date || '').trim(),
            normalizedType,
            currencyIdentity,
            amountText,
        ])}`;
    }

function buildInvestmentTransactionBindingKey(txn, duplicateBaseKeys = null) {
        const baseKey = buildInvestmentTransactionBaseBindingKey(txn);
        if (!(duplicateBaseKeys instanceof Set) || !duplicateBaseKeys.has(baseKey)) return baseKey;
        const identity = getInvestmentTransactionSourceIdentity(txn);
        if (!identity.some(Boolean)) return '';
        return `v3:${JSON.stringify([baseKey, identity])}`;
    }

function parseInvestmentLedgerDateUtc(value) {
        const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!match) return null;
        const year = Number(match[1]);
        const monthIndex = Number(match[2]) - 1;
        const day = Number(match[3]);
        if (!Number.isInteger(year) || !Number.isInteger(monthIndex) || !Number.isInteger(day)) return null;
        return new Date(Date.UTC(year, monthIndex, day));
    }

function getInvestmentLedgerDateDistanceDays(leftDate, rightDate) {
        const left = parseInvestmentLedgerDateUtc(leftDate);
        const right = parseInvestmentLedgerDateUtc(rightDate);
        if (!(left instanceof Date) || !(right instanceof Date) || Number.isNaN(left.getTime()) || Number.isNaN(right.getTime())) {
            return Number.POSITIVE_INFINITY;
        }
        return Math.round(Math.abs(right.getTime() - left.getTime()) / 86400000);
    }

function getInvestmentInternalTransferEffectiveDate(txn) {
        const bookedDate = parseInvestmentLedgerDateUtc(runtime.normalizeLedgerDate(txn?.date));
        if (!(bookedDate instanceof Date) || Number.isNaN(bookedDate.getTime())) {
            return {effectiveDate: null, hasExplicitEventDate: false};
        }
        const source = txn?.source && typeof txn.source === 'object' ? txn.source : {};
        const evidenceTexts = Array.from(new Set([
            txn?.description,
            source?.reference_id,
            source?.memo_raw,
        ].map((value) => String(value || '').replace(/\s+/g, ' ').trim()).filter(Boolean)));
        const datePattern = /(?<![A-Z0-9])(\d{1,2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d{2}|\d{4})?(?![A-Z0-9])/gi;
        const dayMilliseconds = 86400000;
        for (const evidenceText of evidenceTexts) {
            for (const match of evidenceText.matchAll(datePattern)) {
                const day = Number(match[1]);
                const monthIndex = runtime.INVESTMENT_INTERNAL_TRANSFER_MONTHS[String(match[2] || '').toUpperCase()];
                const yearText = String(match[3] || '').trim();
                let year = yearText
                    ? (yearText.length === 2 ? 2000 + Number(yearText) : Number(yearText))
                    : bookedDate.getUTCFullYear();
                if (!Number.isInteger(day) || !Number.isInteger(monthIndex) || !Number.isInteger(year)) continue;
                let evidenceDate = new Date(Date.UTC(year, monthIndex, day));
                if (
                    evidenceDate.getUTCFullYear() !== year
                    || evidenceDate.getUTCMonth() !== monthIndex
                    || evidenceDate.getUTCDate() !== day
                ) continue;
                if (!yearText) {
                    const distanceFromBooked = evidenceDate.getTime() - bookedDate.getTime();
                    if (distanceFromBooked > 31 * dayMilliseconds) {
                        evidenceDate = new Date(Date.UTC(year - 1, monthIndex, day));
                    } else if (distanceFromBooked < -180 * dayMilliseconds) {
                        evidenceDate = new Date(Date.UTC(year + 1, monthIndex, day));
                    }
                }
                return {effectiveDate: evidenceDate, hasExplicitEventDate: true};
            }
        }
        return {effectiveDate: bookedDate, hasExplicitEventDate: false};
    }

function isInvestmentInternalTransferChronologicallyValid(sourceTxn, targetTxn) {
        const direction = getInvestmentInternalTransferDirection(sourceTxn);
        if (!direction || direction === 'security_broker_to_broker') return true;
        const sourceDate = parseInvestmentLedgerDateUtc(runtime.normalizeLedgerDate(sourceTxn?.date));
        const targetDateEvidence = getInvestmentInternalTransferEffectiveDate(targetTxn);
        const targetEffectiveDate = targetDateEvidence?.effectiveDate;
        if (!(sourceDate instanceof Date) || Number.isNaN(sourceDate.getTime())) return false;
        if (!(targetEffectiveDate instanceof Date) || Number.isNaN(targetEffectiveDate.getTime())) return false;
        const postingLagDays = targetDateEvidence.hasExplicitEventDate
            ? 0
            : runtime.INVESTMENT_INTERNAL_TRANSFER_UNDATED_POSTING_LAG_DAYS;
        return targetEffectiveDate.getTime() <= sourceDate.getTime() + (postingLagDays * 86400000);
    }

function getInvestmentInternalTransferLinkWindowDays(sourceTxn, targetTxn) {
        const direction = getInvestmentInternalTransferDirection(sourceTxn);
        if (direction === 'security_broker_to_broker') return 0;
        const isCashTransfer = direction && direction !== 'security_broker_to_broker';
        const brokerCodes = [sourceTxn, targetTxn]
            .map((txn) => runtime.normalizeInvestmentBroker(runtime.getTransactionBrokerCode(txn)))
            .filter(Boolean);
        if (isCashTransfer && brokerCodes.includes('longbridge_hk')) {
            return runtime.INVESTMENT_LONGBRIDGE_HK_CASH_TRANSFER_LINK_WINDOW_DAYS;
        }
        return runtime.INVESTMENT_INTERNAL_TRANSFER_LINK_WINDOW_DAYS;
    }

function getInvestmentInternalTransferDirection(txn) {
        const brokerCode = runtime.normalizeInvestmentBroker(runtime.getTransactionBrokerCode(txn));
        const normalizedType = runtime.getNormalizedTransactionType(txn);
        if (normalizedType === 'transfer_out' && String(txn?.ticker || '').trim()) {
            return 'security_broker_to_broker';
        }
        if (normalizedType === 'deposit') {
            const sourceAmount = Number(runtime.getTransactionAmount(txn));
            if (!Number.isFinite(sourceAmount) || sourceAmount <= 1e-9) return '';
            if (runtime.INVESTMENT_INTERNAL_TRANSFER_BANK_BROKERS.has(brokerCode)) {
                return 'bank_deposit_to_counterparty';
            }
            return 'hsbc_to_broker';
        }
        return '';
    }

function isInvestmentIbkrBaseCurrencyEquivalentCash(txn) {
        const source = txn?.source && typeof txn.source === 'object' ? txn.source : {};
        const brokerCode = runtime.normalizeInvestmentBroker(runtime.getTransactionBrokerCode(txn));
        const normalizedType = runtime.getNormalizedTransactionType(txn);
        const currency = String(runtime.formatTransactionCurrency(txn) || '').trim().toUpperCase();
        return (
            brokerCode === 'ibkr'
            && normalizedType === 'deposit'
            && !currency
            && String(source?.file_kind || '').trim() === 'transactions'
            && Math.abs(Number(runtime.getTransactionAmount(txn)) || 0) > 1e-9
        );
    }

function getInvestmentInternalTransferEffectiveCurrency(txn) {
        const explicitCurrency = String(runtime.formatTransactionCurrency(txn) || '').trim().toUpperCase();
        if (explicitCurrency) return explicitCurrency;
        return isInvestmentIbkrBaseCurrencyEquivalentCash(txn) ? runtime.getInvestmentBaseCurrency() : '';
    }

function isInvestmentInternalTransferFxPair(sourceTxn, targetTxn) {
        if (!isInvestmentIbkrBaseCurrencyEquivalentCash(sourceTxn)) return false;
        if (runtime.normalizeInvestmentBroker(runtime.getTransactionBrokerCode(targetTxn)) === runtime.normalizeInvestmentBroker(runtime.getTransactionBrokerCode(sourceTxn))) {
            return false;
        }
        if (runtime.getNormalizedTransactionType(targetTxn) !== 'withdrawal') return false;
        if (!runtime.INVESTMENT_INTERNAL_TRANSFER_BANK_BROKERS.has(runtime.normalizeInvestmentBroker(runtime.getTransactionBrokerCode(targetTxn)))) {
            return false;
        }
        const targetCurrency = String(runtime.formatTransactionCurrency(targetTxn) || '').trim().toUpperCase();
        return ['CNH', 'CNY', 'RMB'].includes(targetCurrency);
    }

function getInvestmentInternalTransferFxDate(txn) {
        const effectiveDate = getInvestmentInternalTransferEffectiveDate(txn)?.effectiveDate;
        return effectiveDate instanceof Date && !Number.isNaN(effectiveDate.getTime())
            ? effectiveDate.toISOString().slice(0, 10)
            : runtime.normalizeLedgerDate(txn?.date);
    }

function getInvestmentInternalTransferComparableAmount(txn, fxTimeline) {
        const amount = Math.abs(Number(runtime.getTransactionAmount(txn)) || 0);
        if (!(amount > 1e-9)) return null;
        const currency = getInvestmentInternalTransferEffectiveCurrency(txn);
        if (!currency) return null;
        const baseCurrency = runtime.getInvestmentBaseCurrency();
        if (currency === baseCurrency) return amount;
        const rate = runtime.getFxRateForDate(
            fxTimeline,
            currency,
            getInvestmentInternalTransferFxDate(txn),
        );
        if (!Number.isFinite(Number(rate)) || Number(rate) <= 0) return null;
        return amount / Number(rate);
    }

function getInvestmentInternalTransferFxRate(txn, fxTimeline) {
        const currency = getInvestmentInternalTransferEffectiveCurrency(txn);
        if (!currency || currency === runtime.getInvestmentBaseCurrency()) return null;
        const rate = runtime.getFxRateForDate(
            fxTimeline,
            currency,
            getInvestmentInternalTransferFxDate(txn),
        );
        return Number.isFinite(Number(rate)) && Number(rate) > 0 ? Number(rate) : null;
    }

function isInvestmentInternalTransferAmountMatch(sourceTxn, targetTxn, fxTimeline) {
        const sourceCurrency = getInvestmentInternalTransferEffectiveCurrency(sourceTxn);
        const targetCurrency = getInvestmentInternalTransferEffectiveCurrency(targetTxn);
        if (!sourceCurrency || !targetCurrency) return false;
        if (sourceCurrency === targetCurrency) {
            const sourceAmount = Math.abs(Number(runtime.getTransactionAmount(sourceTxn)) || 0);
            const targetAmount = Math.abs(Number(runtime.getTransactionAmount(targetTxn)) || 0);
            return Math.abs(targetAmount - sourceAmount) <= Math.max(0.01, sourceAmount * 0.02);
        }
        if (!isInvestmentInternalTransferFxPair(sourceTxn, targetTxn)) return false;
        const sourceComparableAmount = getInvestmentInternalTransferComparableAmount(sourceTxn, fxTimeline);
        const targetComparableAmount = getInvestmentInternalTransferComparableAmount(targetTxn, fxTimeline);
        if (!Number.isFinite(sourceComparableAmount) || !Number.isFinite(targetComparableAmount)) return false;
        return Math.abs(targetComparableAmount - sourceComparableAmount) <= Math.max(
            0.01,
            Math.max(sourceComparableAmount, targetComparableAmount) * 0.02,
        );
    }

function getInvestmentInternalTransferKind(txn) {
        return getInvestmentInternalTransferDirection(txn) === 'security_broker_to_broker'
            ? 'security'
            : (getInvestmentInternalTransferDirection(txn) ? 'cash' : '');
    }

function isInvestmentInternalTransferSourceCandidate(txn) {
        if (!getInvestmentInternalTransferDirection(txn)) return false;
        if (getInvestmentInternalTransferKind(txn) === 'security') {
            return Math.abs(Number(runtime.getTransactionQuantity(txn)) || 0) > 1e-9;
        }
        if (String(txn?.ticker || '').trim()) return false;
        return Math.abs(Number(runtime.getTransactionAmount(txn)) || 0) > 1e-9;
    }

function isInvestmentInternalTransferTargetCandidateForDirection(sourceTxn, targetTxn, direction) {
        const brokerCode = runtime.normalizeInvestmentBroker(runtime.getTransactionBrokerCode(targetTxn));
        if (direction === 'security_broker_to_broker') {
            return (
                brokerCode !== runtime.normalizeInvestmentBroker(runtime.getTransactionBrokerCode(sourceTxn))
                && runtime.getNormalizedTransactionType(targetTxn) === 'transfer_in'
                && runtime.getInvestmentCanonicalTicker(targetTxn?.ticker)
                    === runtime.getInvestmentCanonicalTicker(sourceTxn?.ticker)
                && Math.abs(Number(runtime.getTransactionQuantity(targetTxn)) || 0) > 1e-9
            );
        }
        if (brokerCode === runtime.normalizeInvestmentBroker(runtime.getTransactionBrokerCode(sourceTxn))) return false;
        if (direction === 'hsbc_to_broker' && !runtime.INVESTMENT_INTERNAL_TRANSFER_BANK_BROKERS.has(brokerCode)) return false;
        if (runtime.getNormalizedTransactionType(targetTxn) !== 'withdrawal') return false;
        if (String(targetTxn?.ticker || '').trim()) return false;
        return Math.abs(Number(runtime.getTransactionAmount(targetTxn)) || 0) > 1e-9;
    }

function getInvestmentInternalTransferPairAmount(sourceTxn, targetTxn) {
        const sourceAmount = Math.abs(Number(runtime.getTransactionAmount(sourceTxn)) || 0);
        const targetAmount = Math.abs(Number(runtime.getTransactionAmount(targetTxn)) || 0);
        return Math.min(sourceAmount, targetAmount);
    }

function getInvestmentInternalTransferFeeAmount(sourceTxn, targetTxn) {
        const direction = getInvestmentInternalTransferDirection(sourceTxn);
        if (!direction || direction === 'security_broker_to_broker') return 0;
        if (
            getInvestmentInternalTransferEffectiveCurrency(sourceTxn)
            !== getInvestmentInternalTransferEffectiveCurrency(targetTxn)
        ) return 0;
        const sourceAmount = Math.abs(Number(runtime.getTransactionAmount(sourceTxn)) || 0);
        const targetAmount = Math.abs(Number(runtime.getTransactionAmount(targetTxn)) || 0);
        const targetOutflowDifference = targetAmount - sourceAmount;
        return targetOutflowDifference > 0.005 ? targetOutflowDifference : 0;
    }

function getInvestmentInternalTransferCommissionTxn(sourceTxn, targetTxn) {
        const direction = getInvestmentInternalTransferDirection(sourceTxn);
        if (direction === 'bank_deposit_to_counterparty' || direction === 'hsbc_to_broker') return targetTxn;
        return null;
    }

function formatInvestmentTransferAccountCompact(txn) {
        const source = txn?.source && typeof txn.source === 'object' ? txn.source : {};
        const accountText = String(
            source?.account_number_short
            || source?.account_number
            || txn?.account
            || source?.account
            || ''
        ).trim();
        if (!accountText) return '';
        const normalized = accountText.replace(/\s+/g, '');
        const accountCompact = normalized.includes('-')
            ? (normalized.split('-').pop() || normalized)
            : (normalized.length > 4 ? normalized.slice(-4) : normalized);
        const accountType = source?.file_kind === 'boc_hk_statement_pdf'
            ? String(source?.account_type || '').replace(/\s+/g, ' ').trim()
            : '';
        return accountType && accountCompact
            ? `${accountType} ${accountCompact}`
            : accountCompact;
    }

function formatInvestmentInternalTransferOptionLabel(txn, metadata = {}) {
        const brokerLabel = runtime.getInvestmentBrokerMeta(runtime.getTransactionBrokerCode(txn)).label;
        const accountCompact = formatInvestmentTransferAccountCompact(txn);
        const dateLabel = runtime.formatTransactionDateDisplay(txn);
        const descriptionLabel = String(runtime.formatTransactionDescription(txn) || '').replace(/\s+/g, ' ').trim() || '--';
        const transferKind = String(metadata?.transferKind || '').trim();
        const amountLabel = transferKind === 'security'
            ? `${runtime.formatHoldingsPosition(Math.abs(Number(runtime.getTransactionQuantity(txn)) || 0))} ${runtime.formatInvestmentTickerForDisplay(txn?.ticker)}`
            : runtime.formatAmountWithCurrency(runtime.getTransactionAmount(txn), runtime.formatTransactionCurrency(txn), { showUsdSymbol: false });
        const fxRate = Number(metadata?.fxRate);
        const comparableAmount = Number(metadata?.comparableAmount);
        const fxLabel = (
            Number.isFinite(fxRate)
            && fxRate > 0
            && Number.isFinite(comparableAmount)
            && comparableAmount > 0
        )
            ? `≈ USD ${runtime.formatAmount(comparableAmount)} @ ${fxRate.toFixed(4)}`
            : '';
        const feeAmount = Number(metadata?.feeAmount) || 0;
        const feeLabel = feeAmount > 0.005
            ? `includes ${formatInvestmentInternalTransferFeeAmount(feeAmount, runtime.formatTransactionCurrency(txn) || 'USD')} transfer fee`
            : '';
        return [
            accountCompact ? `${brokerLabel} ${accountCompact}` : brokerLabel,
            dateLabel,
            descriptionLabel,
            amountLabel,
            fxLabel,
            feeLabel,
        ].filter(Boolean).join(' · ');
    }

function formatInvestmentInternalTransferFeeAmount(feeAmount, currency) {
        const normalizedCurrency = String(currency || '').trim().toUpperCase() || 'USD';
        const amountText = runtime.formatAmount(Number(feeAmount) || 0);
        return normalizedCurrency === 'USD'
            ? `USD ${amountText}`
            : `${normalizedCurrency} ${amountText}`;
    }

function formatInvestmentInternalTransferFeeNote(feeAmount, currency) {
        const numericFeeAmount = Number(feeAmount);
        if (!Number.isFinite(numericFeeAmount) || numericFeeAmount <= 0.005) return '';
        return `Transfer difference ${formatInvestmentInternalTransferFeeAmount(numericFeeAmount, currency || 'USD')} is recorded as a transfer fee.`;
    }

function getInvestmentInternalTransferReferenceText(txn) {
        const source = txn?.source && typeof txn.source === 'object' ? txn.source : {};
        return String(
            source?.reference_id
            || txn?.description
            || source?.row_number
            || ''
        ).replace(/\s+/g, ' ').trim();
    }

function getInvestmentResolvedTransferDescription(txn) {
        const sourceKey = String(txn?.manual_internal_transfer_source_key || txn?.manual_internal_transfer_key || '').trim();
        if (!sourceKey) return '';
        const binding = runtime.state.investmentInternalTransferResolvedBindingsBySourceKey.get(sourceKey);
        if (!binding?.targetTxn) return '';
        if (getInvestmentInternalTransferDirection(binding.sourceTxn) === 'bank_deposit_to_counterparty') {
            const sourceReferenceText = getInvestmentInternalTransferReferenceText(binding.sourceTxn);
            return sourceReferenceText || '';
        }
        const referenceText = getInvestmentInternalTransferReferenceText(binding.targetTxn);
        return referenceText || '';
    }

function formatInvestmentHistoryCurrencyDisplay(txn) {
        const explicitCurrency = String(runtime.formatTransactionCurrency(txn) || '').trim().toUpperCase();
        if (explicitCurrency) return explicitCurrency;
        if (txn?.manual_internal_transfer_role === 'source' && txn?.manual_internal_transfer_selected_target_key) {
            return String(txn?.manual_internal_transfer_currency || 'USD').trim().toUpperCase() || 'USD';
        }
        return '';
    }

function buildInvestmentInternalTransferContext(processedTransactions = []) {
        const sourceOptionsByKey = new Map();
        const resolvedBindingsBySourceKey = new Map();
        const targetByKey = new Map();
        const ambiguousTargetKeys = new Set();
        const claimedTargetKeys = new Set();
        const ignoredSourceKeys = runtime.readInvestmentInternalTransferIgnoredSourceKeys();
        const sourceTransactions = [];
        const targetTransactions = [];
        const storedBindings = runtime.readInvestmentInternalTransferBindings();
        // Keep persisted target ownership even when the owning broker is hidden
        // or its imported source identity is awaiting migration.
        const persistedTargetOwners = new Map();
        Object.entries(storedBindings).forEach(([sourceKey, targetKey]) => {
            if (!persistedTargetOwners.has(targetKey)) persistedTargetOwners.set(targetKey, sourceKey);
        });
        const baseKeyCounts = new Map();
        processedTransactions.forEach((txn) => {
            const baseKey = buildInvestmentTransactionBaseBindingKey(txn);
            if (!baseKey) return;
            baseKeyCounts.set(baseKey, (baseKeyCounts.get(baseKey) || 0) + 1);
        });
        const duplicateBaseKeys = new Set(
            [...baseKeyCounts.entries()]
                .filter(([, count]) => count > 1)
                .map(([key]) => key),
        );
        const bindingFxTimeline = runtime.buildInvestmentFxRateTimeline(
            processedTransactions,
            runtime.getInvestmentBaseCurrency(),
        );

        processedTransactions.forEach((txn) => {
            const transactionKey = buildInvestmentTransactionBindingKey(txn, duplicateBaseKeys);
            txn.manual_internal_transfer_key = transactionKey;
            if (!transactionKey) return;
            if (isInvestmentInternalTransferSourceCandidate(txn)) {
                sourceTransactions.push(txn);
            }
            const normalizedType = runtime.getNormalizedTransactionType(txn);
            if (
                (normalizedType === 'withdrawal' && Math.abs(Number(runtime.getTransactionAmount(txn)) || 0) > 1e-9)
                || (normalizedType === 'transfer_in' && Math.abs(Number(runtime.getTransactionQuantity(txn)) || 0) > 1e-9)
            ) {
                targetTransactions.push(txn);
                if (ambiguousTargetKeys.has(transactionKey)) return;
                if (targetByKey.has(transactionKey)) {
                    targetByKey.delete(transactionKey);
                    ambiguousTargetKeys.add(transactionKey);
                } else {
                    targetByKey.set(transactionKey, txn);
                }
            }
        });

        sourceTransactions.forEach((sourceTxn) => {
            const sourceKey = String(sourceTxn?.manual_internal_transfer_key || '').trim();
            if (!sourceKey) return;
            if (ambiguousTargetKeys.has(sourceKey)) return;
            const direction = getInvestmentInternalTransferDirection(sourceTxn);
            if (!direction) return;
            // A persisted binding is stronger evidence than an old ignore
            // marker.  Imports can regenerate a stable source key after a
            // candidate was previously dismissed; do not discard the user's
            // later explicit binding before validating it.
            const selectedTargetKey = String(storedBindings[sourceKey] || '').trim();
            if (ignoredSourceKeys.has(sourceKey) && !selectedTargetKey) {
                sourceOptionsByKey.set(sourceKey, []);
                return;
            }
            const transferKind = getInvestmentInternalTransferKind(sourceTxn);
            const sourceAmount = Math.abs(Number(runtime.getTransactionAmount(sourceTxn)) || 0);
            const sourceQuantity = Math.abs(Number(runtime.getTransactionQuantity(sourceTxn)) || 0);
            const sourceDate = runtime.normalizeLedgerDate(sourceTxn?.date);
            const quantityTolerance = Math.max(0.000001, sourceQuantity * 0.000001);
            const selectedTargetCandidate = selectedTargetKey ? targetByKey.get(selectedTargetKey) || null : null;
            const selectedTargetLinkWindowDays = selectedTargetCandidate
                ? getInvestmentInternalTransferLinkWindowDays(sourceTxn, selectedTargetCandidate)
                : runtime.INVESTMENT_INTERNAL_TRANSFER_LINK_WINDOW_DAYS;
            const selectedTarget = (
                selectedTargetCandidate
                && !claimedTargetKeys.has(selectedTargetKey)
                && isInvestmentInternalTransferTargetCandidateForDirection(
                    sourceTxn,
                    selectedTargetCandidate,
                    direction,
                )
                && isInvestmentInternalTransferChronologicallyValid(sourceTxn, selectedTargetCandidate)
                && getInvestmentLedgerDateDistanceDays(
                    sourceDate,
                    runtime.normalizeLedgerDate(selectedTargetCandidate?.date),
                ) <= selectedTargetLinkWindowDays
                && (
                    transferKind === 'security'
                        ? Math.abs(
                            Math.abs(Number(runtime.getTransactionQuantity(selectedTargetCandidate)) || 0)
                            - sourceQuantity,
                        ) <= quantityTolerance
                        : isInvestmentInternalTransferAmountMatch(
                            sourceTxn,
                            selectedTargetCandidate,
                            bindingFxTimeline,
                        )
                )
            )
                ? selectedTargetCandidate
                : null;
            const options = targetTransactions
                .filter((targetTxn) => {
                    const targetKey = String(targetTxn?.manual_internal_transfer_key || '').trim();
                    if (!targetKey) return false;
                    if (ambiguousTargetKeys.has(targetKey)) return false;
                    if (claimedTargetKeys.has(targetKey)) return false;
                    if (persistedTargetOwners.has(targetKey)
                        && persistedTargetOwners.get(targetKey) !== sourceKey) return false;
                    if (!isInvestmentInternalTransferTargetCandidateForDirection(sourceTxn, targetTxn, direction)) return false;
                    if (!isInvestmentInternalTransferChronologicallyValid(sourceTxn, targetTxn)) return false;
                    const targetDate = runtime.normalizeLedgerDate(targetTxn?.date);
                    const dayDistance = getInvestmentLedgerDateDistanceDays(sourceDate, targetDate);
                    const linkWindowDays = getInvestmentInternalTransferLinkWindowDays(sourceTxn, targetTxn);
                    if (!Number.isFinite(dayDistance) || dayDistance > linkWindowDays) return false;
                    if (transferKind === 'security') {
                        const targetQuantity = Math.abs(Number(runtime.getTransactionQuantity(targetTxn)) || 0);
                        return Math.abs(targetQuantity - sourceQuantity) <= quantityTolerance;
                    }
                    return isInvestmentInternalTransferAmountMatch(
                        sourceTxn,
                        targetTxn,
                        bindingFxTimeline,
                    );
                })
                .map((targetTxn) => {
                    const feeAmount = getInvestmentInternalTransferFeeAmount(sourceTxn, targetTxn);
                    const isFxPair = isInvestmentInternalTransferFxPair(sourceTxn, targetTxn);
                    const comparableAmount = isFxPair
                        ? getInvestmentInternalTransferComparableAmount(targetTxn, bindingFxTimeline)
                        : null;
                    const fxRate = isFxPair
                        ? getInvestmentInternalTransferFxRate(targetTxn, bindingFxTimeline)
                        : null;
                    const sourceComparableAmount = isFxPair
                        ? getInvestmentInternalTransferComparableAmount(sourceTxn, bindingFxTimeline)
                        : null;
                    return {
                        key: String(targetTxn?.manual_internal_transfer_key || '').trim(),
                        label: formatInvestmentInternalTransferOptionLabel(targetTxn, {
                            feeAmount,
                            transferKind,
                            comparableAmount,
                            fxRate,
                        }),
                        targetTxn,
                        dayDistance: getInvestmentLedgerDateDistanceDays(sourceDate, runtime.normalizeLedgerDate(targetTxn?.date)),
                        amountDiff: transferKind === 'security'
                            ? Math.abs((Math.abs(Number(runtime.getTransactionQuantity(targetTxn)) || 0)) - sourceQuantity)
                            : (isFxPair
                                ? Math.abs(Number(comparableAmount) - Number(sourceComparableAmount))
                                : Math.abs((Math.abs(Number(runtime.getTransactionAmount(targetTxn)) || 0)) - sourceAmount)),
                        transferKind,
                        feeAmount,
                        comparableAmount,
                        fxRate,
                        feeNote: formatInvestmentInternalTransferFeeNote(
                            feeAmount,
                            runtime.formatTransactionCurrency(sourceTxn) || runtime.formatTransactionCurrency(targetTxn) || 'USD'
                        ),
                    };
                })
                .sort((left, right) => (
                    left.amountDiff - right.amountDiff
                    || left.dayDistance - right.dayDistance
                    || left.feeAmount - right.feeAmount
                    || String(left.targetTxn?.date || '').localeCompare(String(right.targetTxn?.date || ''))
                    || (Number(left.targetTxn?.ledger_no) || 0) - (Number(right.targetTxn?.ledger_no) || 0)
                ));

            if (selectedTarget && !options.some((option) => option.key === selectedTargetKey)) {
                const feeAmount = getInvestmentInternalTransferFeeAmount(sourceTxn, selectedTarget);
                const isFxPair = isInvestmentInternalTransferFxPair(sourceTxn, selectedTarget);
                const comparableAmount = isFxPair
                    ? getInvestmentInternalTransferComparableAmount(selectedTarget, bindingFxTimeline)
                    : null;
                const fxRate = isFxPair
                    ? getInvestmentInternalTransferFxRate(selectedTarget, bindingFxTimeline)
                    : null;
                const sourceComparableAmount = isFxPair
                    ? getInvestmentInternalTransferComparableAmount(sourceTxn, bindingFxTimeline)
                    : null;
                options.unshift({
                    key: selectedTargetKey,
                    label: formatInvestmentInternalTransferOptionLabel(selectedTarget, {
                        feeAmount,
                        transferKind,
                        comparableAmount,
                        fxRate,
                    }),
                    targetTxn: selectedTarget,
                    dayDistance: getInvestmentLedgerDateDistanceDays(sourceDate, runtime.normalizeLedgerDate(selectedTarget?.date)),
                    amountDiff: transferKind === 'security'
                        ? Math.abs((Math.abs(Number(runtime.getTransactionQuantity(selectedTarget)) || 0)) - sourceQuantity)
                        : (isFxPair
                            ? Math.abs(Number(comparableAmount) - Number(sourceComparableAmount))
                            : Math.abs((Math.abs(Number(runtime.getTransactionAmount(selectedTarget)) || 0)) - sourceAmount)),
                    transferKind,
                    feeAmount,
                    comparableAmount,
                    fxRate,
                    feeNote: formatInvestmentInternalTransferFeeNote(
                        feeAmount,
                        runtime.formatTransactionCurrency(sourceTxn) || runtime.formatTransactionCurrency(selectedTarget) || 'USD'
                    ),
                });
            }

            // Security transfers are evidence-sensitive: even an exact same-day
            // quantity match must be confirmed by the user and persisted by the server.
            const resolvedTarget = selectedTarget;
            const resolvedTargetKey = selectedTargetKey;

            sourceOptionsByKey.set(sourceKey, options);
            if (resolvedTarget) {
                const feeAmount = getInvestmentInternalTransferFeeAmount(sourceTxn, resolvedTarget);
                resolvedBindingsBySourceKey.set(sourceKey, {
                    sourceKey,
                    targetKey: resolvedTargetKey,
                    sourceTxn,
                    targetTxn: resolvedTarget,
                    kind: transferKind,
                    quantity: transferKind === 'security' ? sourceQuantity : 0,
                    autoMatched: false,
                    amount: getInvestmentInternalTransferPairAmount(sourceTxn, resolvedTarget),
                    sourceAmount: Math.abs(Number(runtime.getTransactionAmount(sourceTxn)) || 0),
                    targetAmount: Math.abs(Number(runtime.getTransactionAmount(resolvedTarget)) || 0),
                    feeAmount,
                    commissionTxn: getInvestmentInternalTransferCommissionTxn(sourceTxn, resolvedTarget),
                    feeNote: formatInvestmentInternalTransferFeeNote(
                        feeAmount,
                        runtime.formatTransactionCurrency(sourceTxn) || runtime.formatTransactionCurrency(resolvedTarget) || 'USD'
                    ),
                });
                claimedTargetKeys.add(resolvedTargetKey);
                sourceOptionsByKey.forEach((priorOptions, priorSourceKey) => {
                    if (priorSourceKey === sourceKey) return;
                    const remainingOptions = priorOptions.filter(
                        (option) => option.key !== resolvedTargetKey,
                    );
                    if (remainingOptions.length !== priorOptions.length) {
                        sourceOptionsByKey.set(priorSourceKey, remainingOptions);
                    }
                });
            }
        });

        const receiptSourceOptionsByKey = new Map();
        const sourceTxnByKey = new Map(
            sourceTransactions.map((sourceTxn) => [
                String(sourceTxn?.manual_internal_transfer_key || '').trim(),
                sourceTxn,
            ]),
        );
        sourceOptionsByKey.forEach((options, sourceKey) => {
            const sourceTxn = sourceTxnByKey.get(sourceKey);
            if (!sourceTxn || resolvedBindingsBySourceKey.has(sourceKey)) return;
            if (getInvestmentInternalTransferKind(sourceTxn) !== 'security') return;
            options.forEach((option) => {
                const receiptKey = String(option?.key || '').trim();
                if (!receiptKey || claimedTargetKeys.has(receiptKey)) return;
                const receiptOptions = receiptSourceOptionsByKey.get(receiptKey) || [];
                receiptOptions.push({
                    key: sourceKey,
                    label: formatInvestmentInternalTransferOptionLabel(sourceTxn, {
                        transferKind: 'security',
                    }),
                    sourceTxn,
                });
                receiptSourceOptionsByKey.set(receiptKey, receiptOptions);
            });
        });

        return {
            sourceOptionsByKey,
            resolvedBindingsBySourceKey,
            receiptSourceOptionsByKey,
            ignoredSourceKeys,
        };
    }

function reorderInvestmentTransactionsForBoundTransfers(
        orderedTransactions = [],
        transferContext = {},
    ) {
        const transactions = Array.isArray(orderedTransactions) ? orderedTransactions : [];
        const resolvedBindings = transferContext?.resolvedBindingsBySourceKey;
        if (transactions.length < 2 || !(resolvedBindings instanceof Map) || !resolvedBindings.size) {
            return transactions;
        }

        const originalIndex = new Map(transactions.map((txn, index) => [txn, index]));
        const predecessors = new Map();
        resolvedBindings.forEach((binding) => {
            const sourceTxn = binding?.sourceTxn;
            const targetTxn = binding?.targetTxn;
            if (!sourceTxn || !targetTxn) {
                return;
            }

            const sourceType = runtime.getNormalizedTransactionType(sourceTxn);
            const targetType = runtime.getNormalizedTransactionType(targetTxn);
            const transferDirection = getInvestmentInternalTransferDirection(sourceTxn);
            const sourceLedgerDate = runtime.normalizeLedgerDate(sourceTxn?.date);
            const targetLedgerDate = runtime.normalizeLedgerDate(targetTxn?.date);
            // Booking date is the accounting axis.  A confirmed transfer may
            // refine chronology only within one ledger date; moving a leg
            // across dates would mutate the state used to value earlier days.
            if (!sourceLedgerDate || !targetLedgerDate || sourceLedgerDate !== targetLedgerDate) {
                return;
            }
            let predecessorTxn = null;
            let successorTxn = null;
            if (
                transferDirection === 'security_broker_to_broker'
                && sourceType === 'transfer_out'
                && targetType === 'transfer_in'
            ) {
                predecessorTxn = sourceTxn;
                successorTxn = targetTxn;
            } else if (
                transferDirection !== 'security_broker_to_broker'
                && sourceType === 'deposit'
                && targetType === 'withdrawal'
            ) {
                const sourceFileKind = String(sourceTxn?.source?.file_kind || '').trim().toLowerCase();
                const hasAuthoritativeCashSnapshot = (
                    sourceTxn?.source?.cash_balance_authoritative === true
                    || sourceFileKind === 'hsbc_usd_savings_csv'
                    || sourceFileKind === 'hsbc_usd_account_text'
                );
                if (
                    hasAuthoritativeCashSnapshot
                    && sourceLedgerDate
                    && sourceLedgerDate === targetLedgerDate
                ) {
                    // A same-day authoritative cash snapshot already contains
                    // the account's posted balance. Do not move its receipt
                    // behind trades, or the snapshot will overwrite those
                    // same-day debits in the historical replay.
                    return;
                }
                // The source map is deposit-first for ordinary cash
                // transfers, but the natural ledger sequence is
                // withdrawal/outflow before deposit.
                predecessorTxn = targetTxn;
                successorTxn = sourceTxn;
            } else {
                return;
            }

            if (
                !Number.isInteger(originalIndex.get(predecessorTxn))
                || !Number.isInteger(originalIndex.get(successorTxn))
            ) {
                return;
            }
            // A confirmed binding is an explicit ordering constraint. Keep it
            // even when the imported source row number sorts after its receipt.
            predecessors.set(successorTxn, predecessorTxn);
        });
        if (!predecessors.size) return transactions;

        const indegree = new Map();
        const successors = new Map();
        predecessors.forEach((sourceTxn, targetTxn) => {
            if (sourceTxn === targetTxn) return;
            indegree.set(targetTxn, (indegree.get(targetTxn) || 0) + 1);
            const targetList = successors.get(sourceTxn) || [];
            targetList.push(targetTxn);
            successors.set(sourceTxn, targetList);
        });

        const ready = transactions.filter((txn) => (indegree.get(txn) || 0) === 0);
        const reordered = [];
        const emitted = new Set();
        while (ready.length) {
            ready.sort((left, right) => originalIndex.get(left) - originalIndex.get(right));
            const txn = ready.shift();
            if (emitted.has(txn)) continue;
            emitted.add(txn);
            reordered.push(txn);
            (successors.get(txn) || []).forEach((successor) => {
                const nextIndegree = (indegree.get(successor) || 0) - 1;
                indegree.set(successor, nextIndegree);
                if (nextIndegree === 0) ready.push(successor);
            });
        }

        // A malformed binding graph must never suppress transactions from the ledger.
        return reordered.length === transactions.length ? reordered : transactions;
    }

function applyAuthoritativeBrokerEndingCashBalances(processedTransactions = []) {
        const transactions = Array.isArray(processedTransactions) ? processedTransactions : [];
        if (!transactions.length) return;

        const brokerCodes = Array.from(new Set(
            transactions
                .map((txn) => runtime.normalizeInvestmentBroker(runtime.getTransactionBrokerCode(txn)))
                .filter(Boolean)
        ));
        const authoritativeCashEligibleBrokers = new Set();

        brokerCodes.forEach((brokerCode) => {
            const authoritativeEndingCash = runtime.getInvestmentBrokerEndingCash(brokerCode);
            const authoritativeEndingCashBalances = runtime.getInvestmentBrokerEndingCashBalances(brokerCode);
            if (authoritativeEndingCash === null && authoritativeEndingCashBalances === null) return;
            const endingCashAsOf = runtime.getInvestmentBrokerEndingCashAsOf(brokerCode);
            const endingCashAsOfDateTime = runtime.getInvestmentBrokerEndingCashAsOfDateTime(brokerCode);
            if (!endingCashAsOf) return;
            const brokerSummary = window.WORTHWARD_INVESTMENT_DATA?.broker_summaries?.[brokerCode];
            if (brokerSummary?.cash_snapshot_authoritative === false) return;
            const hasAuthoritativeBalances = authoritativeEndingCashBalances !== null;
            const brokerRows = transactions.filter(
                (txn) => runtime.normalizeInvestmentBroker(runtime.getTransactionBrokerCode(txn)) === brokerCode
            );
            const lastBrokerTxn = brokerRows[brokerRows.length - 1];
            if (!lastBrokerTxn) return;
            const lastBrokerLedgerDate = runtime.normalizeLedgerDate(lastBrokerTxn?.date);
            if (endingCashAsOf && lastBrokerLedgerDate && lastBrokerLedgerDate < endingCashAsOf) {
                // The imported ending balance belongs to a later statement
                // boundary.  Do not pin it onto an older historical row.
                return;
            }
            const hasForeignCurrencyBalances = hasAuthoritativeBalances && Object.keys(
                authoritativeEndingCashBalances || {},
            ).some((currency) => String(currency || '').trim().toUpperCase() !== runtime.getInvestmentBaseCurrency());
            const brokerFxTimeline = hasForeignCurrencyBalances
                ? runtime.buildInvestmentFxRateTimeline(
                    Array.isArray(runtime.state.investmentRawTransactionsCache) && runtime.state.investmentRawTransactionsCache.length
                        ? runtime.state.investmentRawTransactionsCache
                        : transactions,
                    runtime.getInvestmentBaseCurrency(),
                )
                : null;
            const convertedHsbcEndingCash = brokerCode === 'hsbc' && hasForeignCurrencyBalances
                ? runtime.sumCashLedgerInBaseCurrency(
                    authoritativeEndingCashBalances,
                    endingCashAsOf,
                    brokerFxTimeline,
                    runtime.getInvestmentBaseCurrency(),
                )
                : null;
            // Prefer an explicitly supplied base-currency cash snapshot.  A
            // broker summary may also preserve foreign-currency balances for
            // display; converting and adding those balances would double
            // count them when the summary already provides the authoritative
            // USD boundary.
            const authoritativeBaseCashSnapshot = runtime.getInvestmentBrokerEndingCashInBaseCurrency(brokerCode);
            const authoritativeEndingCashInBaseCurrency = Number.isFinite(Number(authoritativeBaseCashSnapshot))
                ? Number(authoritativeBaseCashSnapshot)
                : convertedHsbcEndingCash;
            const endingCashCandidate = authoritativeEndingCashInBaseCurrency
                ?? authoritativeEndingCash
                ?? authoritativeEndingCashBalances?.[runtime.getInvestmentBaseCurrency()];
            const numericEndingCash = Number(endingCashCandidate);
            const projection = runtime.buildDatedCashSnapshotProjection(brokerRows, {
                asOf: endingCashAsOf,
                asOfDateTime: endingCashAsOfDateTime,
                authoritativeBaseCash: Number.isFinite(numericEndingCash) ? numericEndingCash : null,
                authoritativeBalances: hasAuthoritativeBalances
                    ? authoritativeEndingCashBalances
                    : null,
                baseCurrency: runtime.getInvestmentBaseCurrency(),
                getRowDateTime: (txn) => txn?.datetime,
                getBoundaryCurrencies: (txn) => {
                    const boundary = runtime.getInvestmentCashBalanceBoundary(txn);
                    return boundary?.currency ? [boundary.currency] : [];
                },
            });
            if (!projection.applied) return;
            authoritativeCashEligibleBrokers.add(brokerCode);
            projection.projections.forEach(({index, runningCash, balances, afterSnapshot}) => {
                const txn = brokerRows[index];
                if (!txn) return;
                txn.broker_post_snapshot_cash_delta = afterSnapshot
                    ? runtime.buildInvestmentPostSnapshotCashDelta(
                        balances,
                        hasAuthoritativeBalances
                            ? authoritativeEndingCashBalances
                            : runtime.createCashLedger(numericEndingCash, runtime.getInvestmentBaseCurrency()),
                    )
                    : null;
                if (runtime.shouldPreserveSequentialBrokerBuyHistory(txn)) return;
                if (Number.isFinite(runningCash)) txn.broker_running_cash = runningCash;
                txn.broker_cash_by_currency = {...balances};
                const brokerMarketValue = runtime.getOptionalInvestmentNumber(txn.broker_market_value);
                const brokerPendingSettlementCash = Number(txn.broker_pending_settlement_cash) || 0;
                txn.broker_display_cash = Number(txn.broker_running_cash) + brokerPendingSettlementCash;
                txn.broker_total_equity = Number.isFinite(brokerMarketValue)
                    ? txn.broker_display_cash + brokerMarketValue
                    : null;
                txn.broker_cash_balance_source = 'dated_authoritative_cash_snapshot_projection';
            });
        });

        const isSingleBroker = brokerCodes.length <= 1;
        const hasAuthoritativeAggregateCash = brokerCodes.some((brokerCode) => (
            authoritativeCashEligibleBrokers.has(brokerCode)
            && (
                runtime.getInvestmentBrokerEndingCash(brokerCode) !== null
                || runtime.getInvestmentBrokerEndingCashBalances(brokerCode) !== null
                || runtime.getInvestmentBrokerEndingCashInBaseCurrency(brokerCode) !== null
            )
        ));
        const latestProcessed = transactions[transactions.length - 1];
        if (!latestProcessed) return;
        const finalAggregateBalances = {};
        let finalAggregateCash = 0;
        brokerCodes.forEach((brokerCode) => {
            const normBroker = runtime.normalizeInvestmentBroker(brokerCode);
            const lastBrokerTxn = [...transactions].reverse().find(
                (txn) => runtime.normalizeInvestmentBroker(runtime.getTransactionBrokerCode(txn)) === normBroker
            );
            const brokerBalances = lastBrokerTxn?.broker_cash_by_currency ?? {};
            Object.entries(brokerBalances).forEach(([currency, value]) => {
                const numericValue = Number(value);
                if (!Number.isFinite(numericValue) || Math.abs(numericValue) < 1e-9) return;
                finalAggregateBalances[currency] = (Number(finalAggregateBalances[currency]) || 0) + numericValue;
            });
            finalAggregateCash += Number(lastBrokerTxn?.broker_running_cash);
        });
        const allBrokerStartingBoundariesPresent = brokerCodes.every((brokerCode) => (
            Object.keys(runtime.getInvestmentBrokerStartingCashBalances(brokerCode) || {}).length > 0
        ));
        // A mixed portfolio with no broker-level starting boundary cannot be
        // rebuilt by summing zero-initialized broker ledgers. Preserve the
        // aggregate replay (or its explicit authoritative ending boundary)
        // until each broker has an auditable starting balance.
        if (
            hasAuthoritativeAggregateCash
            || (!isSingleBroker && allBrokerStartingBoundariesPresent)
        ) {
            latestProcessed.running_cash = finalAggregateCash;
            latestProcessed.aggregate_running_cash = finalAggregateCash;
            latestProcessed.cash_by_currency = runtime.cloneCashLedgerBalances(finalAggregateBalances);
            latestProcessed.aggregate_cash_by_currency = latestProcessed.cash_by_currency;
            const marketVal = runtime.getOptionalInvestmentNumber(latestProcessed.market_value);
            const aggregatePendingSettlementCash = Number(latestProcessed.aggregate_pending_settlement_cash) || 0;
            latestProcessed.aggregate_display_cash = finalAggregateCash + aggregatePendingSettlementCash;
            latestProcessed.total_equity = Number.isFinite(marketVal)
                ? finalAggregateCash + marketVal + aggregatePendingSettlementCash
                : null;
            latestProcessed.aggregate_total_equity = latestProcessed.total_equity;
            if (
                isSingleBroker
                && brokerCodes.length === 1
                && !runtime.shouldPreserveSequentialBrokerBuyHistory(latestProcessed)
            ) {
                latestProcessed.broker_running_cash = finalAggregateCash;
                latestProcessed.broker_display_cash = latestProcessed.aggregate_display_cash;
                latestProcessed.broker_cash_by_currency = { ...latestProcessed.aggregate_cash_by_currency };
                latestProcessed.broker_total_equity = latestProcessed.aggregate_total_equity;
            }
        }
    }

function applyInvestmentInternalTransferBindings(processedTransactions = []) {
        const transactions = Array.isArray(processedTransactions) ? processedTransactions : [];
        const context = buildInvestmentInternalTransferContext(transactions);
        runtime.state.investmentInternalTransferSourceOptionsByKey = context.sourceOptionsByKey;
        runtime.state.investmentInternalTransferResolvedBindingsBySourceKey = context.resolvedBindingsBySourceKey;
        runtime.state.investmentSecurityTransferReceiptSourceOptionsByKey = context.receiptSourceOptionsByKey;
        const aggregateBaseCurrency = runtime.getInvestmentBaseCurrency();
        const internalTransferFxTimeline = runtime.buildInvestmentFxRateTimeline(
            transactions,
            aggregateBaseCurrency,
        );
        const resolvedTransferTransactions = new Set();
        runtime.state.investmentInternalTransferResolvedBindingsBySourceKey.forEach((binding) => {
            if (binding?.sourceTxn) resolvedTransferTransactions.add(binding.sourceTxn);
            if (binding?.targetTxn) resolvedTransferTransactions.add(binding.targetTxn);
        });
        transactions.forEach((txn) => {
            const rawRunningCash = Number(txn?.aggregate_raw_running_cash ?? txn?.aggregate_running_cash ?? txn?.running_cash);
            const rawPendingSettlementCash = Number(txn?.aggregate_pending_settlement_cash) || 0;
            const rawDisplayCash = Number.isFinite(Number(txn?.aggregate_raw_display_cash ?? txn?.aggregate_display_cash))
                ? Number(txn?.aggregate_raw_display_cash ?? txn?.aggregate_display_cash)
                : rawRunningCash + rawPendingSettlementCash;
            const rawMarketValueValue = txn?.aggregate_raw_market_value !== undefined
                ? txn.aggregate_raw_market_value
                : (txn?.aggregate_market_value !== undefined ? txn.aggregate_market_value : txn?.market_value);
            const rawMarketValueCandidate = Number(rawMarketValueValue);
            const rawMarketValue = rawMarketValueValue !== null
                && rawMarketValueValue !== ''
                && Number.isFinite(rawMarketValueCandidate)
                ? rawMarketValueCandidate
                : null;
            txn.aggregate_raw_running_cash = rawRunningCash;
            txn.aggregate_raw_display_cash = rawDisplayCash;
            txn.aggregate_raw_market_value = rawMarketValue;
            txn.aggregate_raw_total_equity = Number.isFinite(rawMarketValue)
                ? rawDisplayCash + rawMarketValue
                : null;
            txn.aggregate_running_cash = rawRunningCash;
            txn.aggregate_display_cash = rawDisplayCash;
            txn.aggregate_market_value = rawMarketValue;
            txn.aggregate_total_equity = Number.isFinite(rawMarketValue)
                ? rawDisplayCash + rawMarketValue
                : null;
            txn.running_cash = txn.aggregate_running_cash;
            txn.market_value = txn.aggregate_market_value;
            txn.total_equity = txn.aggregate_total_equity;
            txn.aggregate_bridge_adjustment = 0;
            txn.manual_internal_transfer_external_flow_excluded = (
                txn?.internal_transfer_external_flow_excluded === true
            );
            txn.manual_internal_transfer_role = '';
            txn.manual_internal_transfer_pair_key = '';
            txn.manual_internal_transfer_pair_amount = 0;
            txn.manual_internal_transfer_pair_quantity = 0;
            txn.manual_internal_transfer_kind = '';
            txn.manual_internal_transfer_auto_matched = false;
            txn.manual_internal_transfer_source_key = '';
            txn.manual_internal_transfer_selected_target_key = '';
            txn.manual_internal_transfer_currency = '';
            txn.manual_internal_transfer_candidate_count = 0;
            txn.manual_internal_transfer_needs_binding = false;
            txn.manual_internal_transfer_ignored = false;
            txn.manual_internal_transfer_fee_amount = 0;
            txn.manual_internal_transfer_fee_note = '';
            txn.manual_internal_transfer_commission_amount = 0;
        });

        const bridgeDeltasByIndex = new Map();
        const addBridgeDelta = (index, amount) => {
            if (!Number.isInteger(index) || index < 0 || !Number.isFinite(amount) || Math.abs(amount) <= 1e-9) return;
            bridgeDeltasByIndex.set(index, (Number(bridgeDeltasByIndex.get(index)) || 0) + amount);
        };

        transactions.forEach((txn) => {
            const sourceKey = String(txn?.manual_internal_transfer_key || '').trim();
            const options = sourceKey ? (runtime.state.investmentInternalTransferSourceOptionsByKey.get(sourceKey) || []) : [];
            const resolvedBinding = sourceKey ? runtime.state.investmentInternalTransferResolvedBindingsBySourceKey.get(sourceKey) || null : null;
            const isIgnoredSource = Boolean(
                sourceKey
                && context.ignoredSourceKeys instanceof Set
                && context.ignoredSourceKeys.has(sourceKey),
            );
            if (!sourceKey || (!options.length && !isIgnoredSource)) return;
            txn.manual_internal_transfer_source_key = sourceKey;
            if (isIgnoredSource && !resolvedBinding) {
                txn.manual_internal_transfer_ignored = true;
                return;
            }
            txn.manual_internal_transfer_candidate_count = options.length;
            txn.manual_internal_transfer_selected_target_key = String(resolvedBinding?.targetKey || '').trim();
            txn.manual_internal_transfer_needs_binding = !resolvedBinding;
            txn.manual_internal_transfer_kind = String(resolvedBinding?.kind || options[0]?.transferKind || '').trim();
            txn.manual_internal_transfer_auto_matched = resolvedBinding?.autoMatched === true;
            const pendingFeeOption = options.find((option) => Number(option?.feeAmount) > 0.005) || null;
            txn.manual_internal_transfer_fee_amount = Number(resolvedBinding?.feeAmount ?? pendingFeeOption?.feeAmount ?? 0) || 0;
            txn.manual_internal_transfer_fee_note = String(resolvedBinding?.feeNote || pendingFeeOption?.feeNote || '').trim();
        });

        runtime.state.investmentInternalTransferResolvedBindingsBySourceKey.forEach((binding) => {
            const {
                sourceTxn,
                targetTxn,
                targetKey,
                kind,
                quantity,
                feeAmount,
                commissionTxn,
                feeNote,
            } = binding;
            const bindingAmount = Number(binding?.amount) || 0;
            const sourcePairAmount = Number(binding?.sourceAmount ?? bindingAmount) || 0;
            const targetPairAmount = Number(binding?.targetAmount ?? bindingAmount) || 0;
            const pairQuantity = Number(quantity) || 0;
            const isSecurityTransfer = kind === 'security';
            if (!isSecurityTransfer && (!(sourcePairAmount > 1e-9) || !(targetPairAmount > 1e-9))) return;
            sourceTxn.manual_internal_transfer_external_flow_excluded = true;
            sourceTxn.manual_internal_transfer_role = 'source';
            sourceTxn.manual_internal_transfer_pair_key = targetKey;
            sourceTxn.manual_internal_transfer_pair_amount = sourcePairAmount;
            sourceTxn.manual_internal_transfer_pair_quantity = pairQuantity;
            sourceTxn.manual_internal_transfer_kind = String(kind || 'cash');
            sourceTxn.manual_internal_transfer_auto_matched = binding.autoMatched === true;
            sourceTxn.manual_internal_transfer_currency = String(runtime.formatTransactionCurrency(targetTxn) || 'USD').trim().toUpperCase() || 'USD';
            targetTxn.manual_internal_transfer_external_flow_excluded = true;
            targetTxn.manual_internal_transfer_role = 'target';
            targetTxn.manual_internal_transfer_pair_key = String(sourceTxn?.manual_internal_transfer_key || '').trim();
            targetTxn.manual_internal_transfer_pair_amount = targetPairAmount;
            targetTxn.manual_internal_transfer_pair_quantity = pairQuantity;
            targetTxn.manual_internal_transfer_kind = String(kind || 'cash');
            targetTxn.manual_internal_transfer_auto_matched = binding.autoMatched === true;
            if (isSecurityTransfer) return;
            const numericFeeAmount = Number(feeAmount) || 0;
            if (numericFeeAmount > 0.005 && commissionTxn) {
                commissionTxn.manual_internal_transfer_fee_amount = numericFeeAmount;
                commissionTxn.manual_internal_transfer_fee_note = String(feeNote || '').trim();
                commissionTxn.manual_internal_transfer_commission_amount = -Math.abs(numericFeeAmount);
            }

            const sourceIndex = transactions.indexOf(sourceTxn);
            const targetIndex = transactions.indexOf(targetTxn);
            const sourceBridgeAmount = runtime.getInvestmentInternalTransferAggregateBridgeAmount(
                sourcePairAmount,
                sourceTxn,
                internalTransferFxTimeline,
                aggregateBaseCurrency,
            );
            // The source receipt is the canonical principal for the bridge.
            // Revaluing the target leg at its own FX/date (or including a
            // target-side transfer fee) would leave a residual adjustment
            // after posting and would make a pure internal transfer alter
            // aggregate equity.  Any amount above the source principal stays
            // in the ledger as the real transfer fee.
            const targetBridgeAmount = sourceBridgeAmount;
            if (sourceIndex >= 0 && targetIndex >= 0 && sourceIndex < targetIndex) {
                addBridgeDelta(sourceIndex, -sourceBridgeAmount);
                addBridgeDelta(targetIndex, targetBridgeAmount);
            } else if (sourceIndex >= 0 && targetIndex >= 0 && targetIndex < sourceIndex) {
                addBridgeDelta(targetIndex, targetBridgeAmount);
                addBridgeDelta(sourceIndex, -sourceBridgeAmount);
            }
        });

        transactions.forEach((txn, index) => {
            if (
                txn?.internal_transfer_external_flow_excluded !== true
                || resolvedTransferTransactions.has(txn)
            ) return;
            addBridgeDelta(
                index,
                runtime.getInvestmentInternalTransferAggregateBridgeDelta(
                    txn,
                    internalTransferFxTimeline,
                    aggregateBaseCurrency,
                ),
            );
        });

        let cumulativeBridgeAdjustment = 0;
        transactions.forEach((txn, index) => {
            cumulativeBridgeAdjustment += Number(bridgeDeltasByIndex.get(index)) || 0;
            const rawRunningCash = Number(txn?.aggregate_raw_running_cash);
            const rawDisplayCash = Number(txn?.aggregate_raw_display_cash) || rawRunningCash;
            const rawMarketValueValue = txn?.aggregate_raw_market_value;
            const rawMarketValueCandidate = Number(rawMarketValueValue);
            const rawMarketValue = rawMarketValueValue !== null
                && rawMarketValueValue !== ''
                && Number.isFinite(rawMarketValueCandidate)
                ? rawMarketValueCandidate
                : null;
            txn.aggregate_bridge_adjustment = cumulativeBridgeAdjustment;
            txn.aggregate_history_running_cash = rawRunningCash + cumulativeBridgeAdjustment;
            txn.aggregate_history_display_cash = rawDisplayCash + cumulativeBridgeAdjustment;
            txn.aggregate_history_total_equity = Number.isFinite(rawMarketValue)
                ? txn.aggregate_history_display_cash + rawMarketValue
                : null;
            // The aggregate cash fields are account balances, not external-flow
            // adjusted funding metrics. Keep them tied to the actual broker
            // ledgers so an internal-transfer bridge cannot make current Cash,
            // Cash equivalents, or Total equity lose money. Funding metrics
            // continue to consult the bridge metadata above and exclude these
            // rows from external cash-flow attribution.
            txn.aggregate_running_cash = rawRunningCash;
            txn.aggregate_display_cash = rawDisplayCash;
            txn.aggregate_market_value = rawMarketValue;
            txn.aggregate_total_equity = Number.isFinite(rawMarketValue)
                ? txn.aggregate_display_cash + rawMarketValue
                : null;
            txn.running_cash = txn.aggregate_running_cash;
            txn.market_value = txn.aggregate_market_value;
            txn.total_equity = txn.aggregate_total_equity;
        });
    }

function applyAuthoritativeCurrentAggregateCash(
        processedTransactions = [],
        fxTimeline = null,
        valuationDate = '',
    ) {
        const transactions = Array.isArray(processedTransactions) ? processedTransactions : [];
        const latestProcessed = transactions[transactions.length - 1];
        if (!latestProcessed) return;

        const configuredCashBrokerCodes = Array.isArray(
            window.WORTHWARD_INVESTMENT_DATA?.summary?.authoritative_current_cash_brokers,
        )
            ? Array.from(new Set(
                window.WORTHWARD_INVESTMENT_DATA.summary.authoritative_current_cash_brokers
                    .map((brokerCode) => runtime.normalizeInvestmentBroker(brokerCode))
                    .filter(Boolean),
            ))
            : [];
        const hasConfiguredCashScope = configuredCashBrokerCodes.length > 0;
        const brokerCodes = hasConfiguredCashScope
            ? configuredCashBrokerCodes
            : Array.from(new Set(
                transactions
                    .map((txn) => runtime.normalizeInvestmentBroker(runtime.getTransactionBrokerCode(txn)))
                    .filter(Boolean),
            ));
        const currentCashSnapshots = [];
        const unsupportedCashBrokers = [];
        brokerCodes.forEach((brokerCode) => {
            const brokerSummary = window.WORTHWARD_INVESTMENT_DATA?.broker_summaries?.[brokerCode];
            const latestBrokerTxn = [...transactions].reverse().find(
                (txn) => runtime.normalizeInvestmentBroker(runtime.getTransactionBrokerCode(txn)) === brokerCode,
            );
            const currentCashSnapshot = runtime.getInvestmentBrokerCurrentCashSnapshot(
                brokerCode,
                valuationDate,
                fxTimeline,
                {postSnapshotCashDelta: latestBrokerTxn?.broker_post_snapshot_cash_delta},
            );
            const currentCashAsOf = runtime.getInvestmentBrokerEndingCashAsOf(brokerCode);
            const hasCurrentCashBoundary = Boolean(
                brokerSummary
                && (
                    brokerSummary.cash_snapshot_authoritative === true
                    || currentCashAsOf
                    || brokerSummary.position_snapshot_as_of
                )
            );
            if (!hasCurrentCashBoundary || !currentCashSnapshot) {
                if (Math.abs(Number(latestBrokerTxn?.broker_running_cash) || 0) > 1e-9) {
                    unsupportedCashBrokers.push(brokerCode);
                }
                return;
            }
            currentCashSnapshots.push(currentCashSnapshot);
        });
        if (
            !currentCashSnapshots.length
            || (hasConfiguredCashScope && currentCashSnapshots.length !== brokerCodes.length)
            || (!hasConfiguredCashScope && unsupportedCashBrokers.length)
        ) return;

        const aggregateBalances = {};
        currentCashSnapshots.forEach((snapshot) => {
            Object.entries(snapshot.runningBalances || {}).forEach(([currency, value]) => {
                const numericValue = Number(value);
                if (!Number.isFinite(numericValue) || Math.abs(numericValue) < 1e-9) return;
                aggregateBalances[currency] = (Number(aggregateBalances[currency]) || 0) + numericValue;
            });
        });
        const aggregateRunningCash = runtime.sumCashLedgerInBaseCurrency(
            aggregateBalances,
            runtime.normalizeLedgerDate(valuationDate) || runtime.getTodayLedgerDate(),
            fxTimeline,
            runtime.getInvestmentBaseCurrency(),
        );
        const aggregatePendingSettlementCash = currentCashSnapshots.reduce(
            (sum, snapshot) => sum + snapshot.pendingSettlementCash,
            0,
        );
        const aggregateDisplayCash = aggregateRunningCash + aggregatePendingSettlementCash;
        const marketValue = runtime.getOptionalInvestmentNumber(latestProcessed.market_value);
        latestProcessed.running_cash = aggregateRunningCash;
        latestProcessed.aggregate_running_cash = aggregateRunningCash;
        latestProcessed.cash_by_currency = runtime.cloneCashLedgerBalances(aggregateBalances);
        latestProcessed.aggregate_cash_by_currency = runtime.cloneCashLedgerBalances(aggregateBalances);
        latestProcessed.aggregate_pending_settlement_cash = aggregatePendingSettlementCash;
        latestProcessed.aggregate_display_cash = aggregateDisplayCash;
        latestProcessed.authoritative_current_cash_snapshot = true;
        latestProcessed.aggregate_current_cash_source = 'authoritative_broker_cash_snapshots';
        latestProcessed.aggregate_current_cash_brokers = currentCashSnapshots.map(
            (snapshot) => snapshot.brokerCode,
        );
        latestProcessed.aggregate_current_cash_is_approximate = currentCashSnapshots.some(
            (snapshot) => snapshot.isApproximate === true,
        );
        latestProcessed.total_equity = Number.isFinite(marketValue)
            ? aggregateDisplayCash + marketValue
            : null;
        latestProcessed.aggregate_total_equity = latestProcessed.total_equity;
        currentCashSnapshots.forEach((snapshot) => {
            const latestBroker = [...transactions].reverse().find(
                (txn) => runtime.normalizeInvestmentBroker(runtime.getTransactionBrokerCode(txn)) === snapshot.brokerCode,
            );
            if (!latestBroker) return;
            if (runtime.shouldPreserveSequentialBrokerBuyHistory(latestBroker)) return;
            latestBroker.broker_running_cash = snapshot.runningCash;
            latestBroker.broker_cash_by_currency = {...snapshot.runningBalances};
            latestBroker.broker_pending_settlement_cash = snapshot.pendingSettlementCash;
            latestBroker.broker_display_cash = snapshot.displayCash;
            latestBroker.broker_current_cash_is_approximate = (
                snapshot.isApproximate === true
            );
            const brokerMarketValue = runtime.getOptionalInvestmentNumber(
                latestBroker.broker_market_value,
            );
            latestBroker.broker_total_equity = Number.isFinite(brokerMarketValue)
                ? snapshot.displayCash + brokerMarketValue
                : null;
            latestBroker.broker_cash_balance_source = (
                'authoritative_current_cash_snapshot'
            );
        });
    }

function getActionButtonLabels(button) {
        return {
            defaultLabel: String(button?.dataset?.defaultLabel || button?.textContent || '').trim() || 'Continue',
            pendingLabel: String(button?.dataset?.pendingLabel || '').trim() || 'Working',
        };
    }

function renderPendingActionLabel(pendingLabel) {
        return /ing$/i.test(pendingLabel) ? `${pendingLabel}...` : pendingLabel;
    }

function syncActionButtonState(button, { disabled = false, pending = false } = {}) {
        if (!button) return;
        const labels = getActionButtonLabels(button);
        const isDisabled = Boolean(disabled || pending);
        button.disabled = isDisabled;
        button.classList.toggle('is-pending', Boolean(pending));
        button.setAttribute('aria-disabled', String(isDisabled));
        if (pending) {
            button.setAttribute('aria-busy', 'true');
            button.textContent = renderPendingActionLabel(labels.pendingLabel);
            return;
        }
        button.removeAttribute('aria-busy');
        button.textContent = labels.defaultLabel;
    }

function clearInvestmentSegmentedMeasureRaf() {
        if (!runtime.state.investmentSegmentedMeasureRaf) return;
        window.cancelAnimationFrame(runtime.state.investmentSegmentedMeasureRaf);
        runtime.state.investmentSegmentedMeasureRaf = 0;
    }

function clearInvestmentSegmentedMeasureTimer() {
        if (!runtime.state.investmentSegmentedMeasureTimer) return;
        window.clearTimeout(runtime.state.investmentSegmentedMeasureTimer);
        runtime.state.investmentSegmentedMeasureTimer = 0;
    }

function measureSegmentedInlineContentWidth(element, renderSafetyPx = runtime.SEGMENTED_TEXT_RENDER_SAFETY_PX) {
        if (!(element instanceof HTMLElement)) return 0;
        const range = document.createRange();
        range.selectNodeContents(element);
        const rects = Array.from(range.getClientRects());
        let maxWidth = 0;
        rects.forEach((rect) => {
            maxWidth = Math.max(maxWidth, rect.width);
        });
        if (typeof range.detach === 'function') {
            range.detach();
        }
        if (maxWidth > 0) return Math.ceil(maxWidth + renderSafetyPx);
        return element.textContent
            ? Math.max(0, Math.ceil(element.getBoundingClientRect().width + renderSafetyPx))
            : 0;
    }

    return {
        getInvestmentCanonicalSummaryRealizedPnl,
        getInvestmentCanonicalSummaryRealizedPnlLocal,
        hasInvestmentPnlUnavailable,
        isInvestmentAggregatePnlUnavailable,
        getInvestmentSecurityTransferReceiptSourceOptions,
        rememberInvestmentSecurityTransferAttribution,
        getInvestmentTransactionSourceIdentity,
        buildInvestmentTransactionBaseBindingKey,
        buildInvestmentTransactionBindingKey,
        parseInvestmentLedgerDateUtc,
        getInvestmentLedgerDateDistanceDays,
        getInvestmentInternalTransferEffectiveDate,
        isInvestmentInternalTransferChronologicallyValid,
        getInvestmentInternalTransferLinkWindowDays,
        getInvestmentInternalTransferDirection,
        isInvestmentIbkrBaseCurrencyEquivalentCash,
        getInvestmentInternalTransferEffectiveCurrency,
        isInvestmentInternalTransferFxPair,
        getInvestmentInternalTransferFxDate,
        getInvestmentInternalTransferComparableAmount,
        getInvestmentInternalTransferFxRate,
        isInvestmentInternalTransferAmountMatch,
        getInvestmentInternalTransferKind,
        isInvestmentInternalTransferSourceCandidate,
        isInvestmentInternalTransferTargetCandidateForDirection,
        getInvestmentInternalTransferPairAmount,
        getInvestmentInternalTransferFeeAmount,
        getInvestmentInternalTransferCommissionTxn,
        formatInvestmentTransferAccountCompact,
        formatInvestmentInternalTransferOptionLabel,
        formatInvestmentInternalTransferFeeAmount,
        formatInvestmentInternalTransferFeeNote,
        getInvestmentInternalTransferReferenceText,
        getInvestmentResolvedTransferDescription,
        formatInvestmentHistoryCurrencyDisplay,
        buildInvestmentInternalTransferContext,
        reorderInvestmentTransactionsForBoundTransfers,
        applyAuthoritativeBrokerEndingCashBalances,
        applyInvestmentInternalTransferBindings,
        applyAuthoritativeCurrentAggregateCash,
        getActionButtonLabels,
        renderPendingActionLabel,
        syncActionButtonState,
        clearInvestmentSegmentedMeasureRaf,
        clearInvestmentSegmentedMeasureTimer,
        measureSegmentedInlineContentWidth,
    };
}

