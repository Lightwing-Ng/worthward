/**
 * HSBC history evidence normalization and immutable-identity helpers.
 *
 * Code version: v1.0.3
 * - Fixed: Evidence dates require the producer's exact ISO day and monetary
 *   strings must retain a safely representable decimal coefficient.
 * - Fixed: Direct cash requires canonical raw amount and balance fields;
 *   legacy display aliases can no longer authorize a cash boundary alone.
 * - Fixed: Direct cash and structured settlement evidence now enforce the
 *   exact importer file-kind, authority, scope, type/sign, raw-decimal, and
 *   source-sequence contract before any cash boundary can be trusted.
 * - Fixed: Direct cash rows require an explicit account, native currency,
 *   amount, immutable source digest, and integral source ordering before they
 *   can be treated as consistent bank-balance evidence.
 * - Fixed: Cash evidence accepts only canonical HSBC currencies, account
 *   types, and file-kind currency domains.
 */

export function createHsbcHistoryEvidenceUtils(runtime, context) {
    const normalizeBrokerCode = (value) => (
        typeof runtime.normalizeInvestmentBroker === 'function'
            ? runtime.normalizeInvestmentBroker(value)
            : String(value || '').trim().toLowerCase()
    );
    const getBrokerCode = (txn) => (
        typeof runtime.getTransactionBrokerCode === 'function'
            ? runtime.getTransactionBrokerCode(txn)
            : (txn?.broker || txn?.source?.broker || '')
    );
    const getNormalizedType = (txn) => (
        typeof runtime.getNormalizedTransactionType === 'function'
            ? runtime.getNormalizedTransactionType(txn)
            : String(txn?.type || '').trim().replace(/\s+/g, '_').toLowerCase()
    );
    const parseHsbcPositiveSequenceNumber = (value) => {
        if (typeof value === 'number') {
            return Number.isSafeInteger(value) && value > 0 ? value : null;
        }
        if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value.trim())) {
            return null;
        }
        const parsed = Number(value.trim());
        return Number.isSafeInteger(parsed) ? parsed : null;
    };

    const normalizeHsbcEvidenceDate = (value) => {
        if (typeof value !== 'string' || value !== value.trim()) return '';
        const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!match) return '';
        const year = Number(match[1]);
        const month = Number(match[2]);
        const day = Number(match[3]);
        const parsed = new Date(Date.UTC(year, month - 1, day));
        return parsed.getUTCFullYear() === year
            && parsed.getUTCMonth() === month - 1
            && parsed.getUTCDate() === day
            ? value
            : '';
    };

    function normalizeHsbcCashScopeToken(value) {
        return String(value || '').trim().toUpperCase().replace(/\s+/g, ' ');
    }

    function normalizeHsbcCashCurrency(value) {
        return normalizeHsbcCashScopeToken(value)
            .replace(/^(?:CNY|RMB)$/, 'CNH');
    }

    function isSupportedHsbcCashCurrency(value) {
        return ['USD', 'HKD', 'CNH'].includes(normalizeHsbcCashCurrency(value));
    }

    function isKnownHsbcCashFileKind(value) {
        return [
            'hsbc_usd_account_text',
            'hsbc_usd_savings_csv',
            'hsbc_multi_currency_cash_account_text',
            'hsbc_statement_cash',
        ].includes(String(value || '').trim().toLowerCase());
    }

    function isHsbcCashFileKindCurrencyCompatible(sourceFileKind, currency) {
        const normalizedCurrency = normalizeHsbcCashCurrency(currency);
        if (
            !isKnownHsbcCashFileKind(sourceFileKind)
            || !isSupportedHsbcCashCurrency(normalizedCurrency)
        ) return false;
        return ![
            'hsbc_usd_account_text',
            'hsbc_usd_savings_csv',
        ].includes(String(sourceFileKind || '').trim().toLowerCase())
            || normalizedCurrency === 'USD';
    }

    function isHsbcCashFileKindAccountCompatible(
        sourceFileKind,
        currency,
        accountType,
    ) {
        const normalizedFileKind = String(sourceFileKind || '').trim().toLowerCase();
        const normalizedCurrency = normalizeHsbcCashCurrency(currency);
        const normalizedAccountType = normalizeHsbcCashAccountType(
            accountType,
            normalizedCurrency,
        );
        if (!isHsbcCashFileKindCurrencyCompatible(
            normalizedFileKind,
            normalizedCurrency,
        )) return false;
        return ![
            'hsbc_usd_account_text',
            'hsbc_usd_savings_csv',
        ].includes(normalizedFileKind) || normalizedAccountType === 'SAVINGS';
    }

    function normalizeHsbcCashAccountType(accountType, currency) {
        const normalizedCurrency = normalizeHsbcCashCurrency(currency);
        let normalizedType = normalizeHsbcCashScopeToken(accountType);
        const leadingCurrency = normalizedType.match(
            /^(USD|HKD|CNH|CNY|RMB)\s+/,
        );
        if (leadingCurrency) {
            const explicitCurrency = leadingCurrency[1]
                .replace(/^(?:CNY|RMB)$/, 'CNH');
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
        return isSupportedHsbcCashCurrency(normalizedCurrency)
            && ['CURRENT', 'SAVINGS'].includes(normalizedType)
            ? normalizedType
            : '';
    }

    function parseFiniteNonBlankHsbcNumber(value) {
        if (value === undefined || value === null || String(value).trim() === '') {
            return null;
        }
        if (
            typeof value !== 'number'
            && (
                typeof value !== 'string'
                || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim())
            )
        ) return null;
        const numericValue = typeof value === 'number' ? value : Number(value.trim());
        return Number.isFinite(numericValue) ? numericValue : null;
    }

    function normalizeHsbcDecimalText(value) {
        if (
            value === undefined
            || value === null
            || typeof value === 'boolean'
        ) return '';
        const text = String(value).trim();
        const match = text.match(/^([+-]?)(\d*)(?:\.(\d*))?$/);
        if (!match || (!match[2] && !match[3])) return '';
        const integer = (match[2] || '0').replace(/^0+(?=\d)/, '') || '0';
        const fraction = String(match[3] || '').replace(/0+$/, '');
        const magnitude = fraction ? `${integer}.${fraction}` : integer;
        const isZero = /^0(?:\.0*)?$/.test(magnitude);
        const normalized = `${match[1] === '-' && !isZero ? '-' : ''}${magnitude}`;
        const coefficientText = `${integer}${fraction}`.replace(/^0+/, '') || '0';
        try {
            if (BigInt(coefficientText) > BigInt(Number.MAX_SAFE_INTEGER)) return '';
        } catch (_error) {
            return '';
        }
        return Number.isFinite(Number(normalized)) ? normalized : '';
    }

    function hasExactHsbcDecimalAliases(values) {
        const present = values.filter((value) => (
            value !== undefined
            && value !== null
            && String(value).trim() !== ''
        ));
        if (!present.length) return false;
        const normalized = present.map(normalizeHsbcDecimalText);
        return normalized.every((value) => value && value === normalized[0]);
    }

    function inferHsbcCashAccountType(accountType, sourceFileKind, currency) {
        const normalizedAccountType = normalizeHsbcCashAccountType(
            accountType,
            currency,
        );
        if (normalizedAccountType) return normalizedAccountType;
        const normalizedFileKind = String(sourceFileKind || '').trim().toLowerCase();
        const normalizedCurrency = normalizeHsbcCashCurrency(currency);
        if (
            normalizedCurrency === 'USD'
            && ['hsbc_usd_account_text', 'hsbc_usd_savings_csv'].includes(
                normalizedFileKind,
            )
        ) {
            return 'SAVINGS';
        }
        return '';
    }

    function isHsbcCashEvidenceTransaction(txn) {
        const source = txn?.source && typeof txn.source === 'object' ? txn.source : {};
        const sourceFileKind = String(source.file_kind || '').trim().toLowerCase();
        return (
            normalizeBrokerCode(getBrokerCode(txn)) === 'hsbc'
            && !['buy', 'sell'].includes(getNormalizedType(txn))
            && isKnownHsbcCashFileKind(sourceFileKind)
        );
    }

    function getHsbcCashScopeDescriptor(txn, evidence = {}) {
        const source = txn?.source && typeof txn.source === 'object' ? txn.source : {};
        const brokerCode = normalizeBrokerCode(
            txn?.broker || source.broker || getBrokerCode(txn),
        );
        const sourceFileKind = String(
            evidence?.sourceFileKind
            || evidence?.source_file_kind
            || source.file_kind
            || '',
        ).trim().toLowerCase();
        const currency = normalizeHsbcCashCurrency(
            evidence?.currency
            || runtime.formatTransactionCurrency(txn)
            || source.statement_currency_raw
            || context.baseCurrency,
        );
        const account = String(
            evidence?.accountNumber
            || evidence?.account_number
            || txn?.account
            || source.account
            || source.account_number
            || '',
        ).trim();
        const accountType = inferHsbcCashAccountType(
            evidence?.accountType
            || evidence?.account_type
            || txn?.account_type
            || source.account_type,
            sourceFileKind,
            currency,
        );
        const normalizedAccount = normalizeHsbcCashScopeToken(account);
        const cashScopeKey = (
            brokerCode === 'hsbc'
            && normalizedAccount
            && accountType
            && currency
            && isHsbcCashFileKindAccountCompatible(
                sourceFileKind,
                currency,
                accountType,
            )
        ) ? ['HSBC', normalizedAccount, accountType, currency].join('|') : '';
        const sourceSequenceSha256 = String(
            evidence?.sourceSequenceSha256
            || evidence?.source_sequence_sha256
            || source.source_sequence_sha256
            || source.source_file_sha256
            || source.statement_pdf_source_sha256
            || '',
        ).trim().toLowerCase();
        const rowNumber = parseHsbcPositiveSequenceNumber(
            evidence?.rowNumber
            ?? evidence?.row_number
            ?? source.row_number,
        );
        const ledgerSequence = parseHsbcPositiveSequenceNumber(
            evidence?.ledgerSequence
            ?? evidence?.ledger_sequence
            ?? source.ledger_sequence
            ?? source.row_number,
        );
        const sourceSequenceDirection = Number(
            evidence?.sourceSequenceDirection
            ?? evidence?.source_sequence_direction,
        ) || (
            sourceFileKind === 'hsbc_usd_savings_csv'
            && String(
                evidence?.ledgerSequenceOrder
                || evidence?.ledger_sequence_order
                || source.ledger_sequence_order
                || '',
            ).trim().toLowerCase() !== 'chronological'
                ? -1
                : 1
        );
        return {
            account,
            accountType,
            accountScopeKey: `${brokerCode}|${account}`,
            brokerCode,
            cashScopeKey,
            currency,
            ledgerSequence,
            rowNumber,
            sourceFileKind,
            sourceSequenceDirection,
            sourceSequenceSha256,
        };
    }

    function getHsbcCashEvidenceState(txn) {
        const source = txn?.source && typeof txn.source === 'object' ? txn.source : {};
        const descriptor = getHsbcCashScopeDescriptor(txn);
        const presentValues = (values) => values.filter((value) => (
            value !== undefined
            && value !== null
            && String(value).trim() !== ''
        ));
        const hasConsistentTextValues = (values, normalize) => {
            const normalized = presentValues(values).map(normalize);
            return normalized.every((value) => value && value === normalized[0]);
        };
        const resolveConsistentNumber = (values, fallbackValues = []) => {
            const primaryValues = presentValues(values);
            const secondaryValues = presentValues(fallbackValues);
            const candidates = [...primaryValues, ...secondaryValues];
            if (!candidates.length) return {consistent: true, value: null};
            const parsed = candidates.map(parseFiniteNonBlankHsbcNumber);
            return {
                consistent: parsed.every((value) => (
                    value !== null && Math.abs(value - parsed[0]) <= 1e-6
                )),
                value: parsed[0],
            };
        };
        const normalizeCurrency = normalizeHsbcCashCurrency;
        const currencyCandidates = presentValues([
            txn?.currency,
            txn?.normalized?.currency,
            source.currency,
            source.statement_currency_raw,
        ]);
        const accountTypeCandidates = presentValues([
            txn?.account_type,
            source.account_type,
        ]).map((value) => normalizeHsbcCashAccountType(
            value,
            descriptor.currency,
        ));
        const shaCandidates = presentValues([
            source.source_sequence_sha256,
            source.source_file_sha256,
            source.statement_pdf_source_sha256,
        ]).map((value) => String(value).trim().toLowerCase());
        const statementRowRaw = source.statement_pdf_source_row_number;
        const hasStatementRowAlias = statementRowRaw !== undefined
            && statementRowRaw !== null
            && String(statementRowRaw).trim() !== '';
        const statementRowNumber = hasStatementRowAlias
            ? parseHsbcPositiveSequenceNumber(statementRowRaw)
            : null;
        const sequenceOrder = String(
            source.ledger_sequence_order || '',
        ).trim().toLowerCase();
        const sourceSequenceDirectionRaw = source.source_sequence_direction;
        const hasSourceSequenceDirection = sourceSequenceDirectionRaw !== undefined
            && sourceSequenceDirectionRaw !== null
            && String(sourceSequenceDirectionRaw).trim() !== '';
        const amount = resolveConsistentNumber([
            txn?.normalized?.net_amount,
            txn?.net_amount_raw,
        ]);
        const amountAliases = presentValues([
            txn?.normalized?.net_amount,
            txn?.net_amount_raw,
            txn?.amount,
            txn?.cash,
        ]);
        const balance = resolveConsistentNumber([
            source.balance_after_raw,
            source.balance_after,
        ]);
        const balanceAliases = presentValues([
            source.balance_after_raw,
            source.balance_after,
        ]);
        const hasCanonicalAmount = (
            typeof txn?.net_amount_raw === 'string'
            && typeof txn?.normalized?.net_amount === 'string'
        );
        const hasCanonicalBalance = typeof source.balance_after_raw === 'string';
        const normalizedType = getNormalizedType(txn);
        const positiveCashTypes = new Set([
            'credit_interest',
            'deposit',
            'dividend',
            'kol_reward',
        ]);
        const negativeCashTypes = new Set([
            'debit_interest',
            'withdrawal',
        ]);
        const typeAndSignAreValid = (
            (positiveCashTypes.has(normalizedType) && amount.value > 0)
            || (negativeCashTypes.has(normalizedType) && amount.value < 0)
            || (
                normalizedType === 'forex_trade_component'
                && amount.value !== 0
            )
        );
        const expectedAuthoritativeFlag = [
            'hsbc_usd_account_text',
            'hsbc_usd_savings_csv',
        ].includes(descriptor.sourceFileKind);
        const hasDirectSequenceIdentity = (
            parseHsbcPositiveSequenceNumber(source.row_number) !== null
            && parseHsbcPositiveSequenceNumber(source.ledger_sequence) !== null
            && !hasSourceSequenceDirection
            && (
                descriptor.sourceFileKind === 'hsbc_usd_savings_csv'
                    ? sequenceOrder === 'chronological'
                    : (
                        sequenceOrder === ''
                        && descriptor.rowNumber === descriptor.ledgerSequence
                    )
            )
        );
        return {
            amount: amount.value,
            balance: balance.value,
            descriptor,
            isConsistent: (
                isHsbcCashEvidenceTransaction(txn)
                && Boolean(descriptor.cashScopeKey)
                && String(source.cash_balance_scope || '').trim().toLowerCase() === 'account'
                && source.cash_balance_authoritative === expectedAuthoritativeFlag
                && descriptor.rowNumber !== null
                && descriptor.ledgerSequence !== null
                && hasDirectSequenceIdentity
                && /^[0-9a-f]{64}$/.test(descriptor.sourceSequenceSha256)
                && hasConsistentTextValues(
                    [txn?.broker, source.broker],
                    normalizeBrokerCode,
                )
                && hasConsistentTextValues(
                    [txn?.account, source.account, source.account_number],
                    normalizeHsbcCashScopeToken,
                )
                && currencyCandidates.length > 0
                && hasConsistentTextValues(
                    currencyCandidates,
                    normalizeCurrency,
                )
                && accountTypeCandidates.length > 0
                && accountTypeCandidates.every((value) => (
                    value && value === accountTypeCandidates[0]
                ))
                && isHsbcCashFileKindAccountCompatible(
                    descriptor.sourceFileKind,
                    descriptor.currency,
                    descriptor.accountType,
                )
                && shaCandidates.length > 0
                && shaCandidates.every((value) => (
                    /^[0-9a-f]{64}$/.test(value) && value === shaCandidates[0]
                ))
                && (!hasStatementRowAlias || (
                    statementRowNumber !== null
                    && statementRowNumber === descriptor.rowNumber
                ))
                && Boolean(normalizeHsbcEvidenceDate(txn?.date))
                && amount.value !== null
                && Math.abs(amount.value) > 1e-9
                && amount.consistent
                && hasCanonicalAmount
                && hasExactHsbcDecimalAliases(amountAliases)
                && typeAndSignAreValid
                && balance.value !== null
                && balance.consistent
                && hasCanonicalBalance
                && hasExactHsbcDecimalAliases(balanceAliases)
            ),
        };
    }

    function getHsbcDirectCashPhysicalEvidenceIdentity(txn) {
        if (!isHsbcCashEvidenceTransaction(txn)) return '';
        const source = txn?.source && typeof txn.source === 'object' ? txn.source : {};
        return getHsbcStructuredPostingPhysicalEvidenceIdentity(source);
    }

    function getHsbcStructuredPostingPhysicalEvidenceIdentity(posting) {
        if (!posting || typeof posting !== 'object') return '';
        const shaAliases = [
            posting.source_sequence_sha256,
            posting.source_file_sha256,
            posting.statement_pdf_source_sha256,
        ].filter((value) => (
            value !== undefined
            && value !== null
            && String(value).trim() !== ''
        )).map((value) => String(value).trim().toLowerCase());
        if (
            !shaAliases.length
            || shaAliases.some((value) => (
                !/^[0-9a-f]{64}$/.test(value) || value !== shaAliases[0]
            ))
        ) return '';
        const rowNumber = parseHsbcPositiveSequenceNumber(posting.row_number);
        const statementRowRaw = posting.statement_pdf_source_row_number;
        const hasStatementRowAlias = statementRowRaw !== undefined
            && statementRowRaw !== null
            && String(statementRowRaw).trim() !== '';
        const statementRowNumber = hasStatementRowAlias
            ? parseHsbcPositiveSequenceNumber(statementRowRaw)
            : null;
        if (
            rowNumber === null
            || (hasStatementRowAlias && statementRowNumber !== rowNumber)
        ) return '';
        return JSON.stringify([shaAliases[0], rowNumber]);
    }

    function hasConsistentHsbcStructuredSettlementAliases(txn, postings) {
        const source = txn?.source && typeof txn.source === 'object' ? txn.source : {};
        const presentValues = (values) => values.filter((value) => (
            value !== undefined
            && value !== null
            && String(value).trim() !== ''
        ));
        const hasConsistentTextValues = (values, normalize) => {
            const normalized = presentValues(values).map(normalize);
            return normalized.every((value) => value && value === normalized[0]);
        };
        const normalizeCurrency = normalizeHsbcCashCurrency;
        const transactionCurrency = normalizeCurrency(txn?.currency);
        const transactionAccountTypes = presentValues([
            txn?.account_type,
            source.account_type,
        ]).map((value) => normalizeHsbcCashAccountType(
            value,
            transactionCurrency,
        ));
        const transactionNetAmountAliases = presentValues([
            txn?.normalized?.net_amount,
            txn?.net_amount_raw,
        ]);
        const normalizeOrderReference = (value) => {
            const match = String(value || '')
                .trim().toUpperCase().match(/^([PS])[- ]?(\d+)$/);
            return match ? `${match[1]}-${match[2]}` : '';
        };
        if (
            normalizeBrokerCode(getBrokerCode(txn)) !== 'hsbc'
            || !isSupportedHsbcCashCurrency(transactionCurrency)
            || !hasConsistentTextValues(
                [txn?.broker, source.broker],
                normalizeBrokerCode,
            )
            || !hasConsistentTextValues(
                [txn?.account, source.account, source.account_number],
                normalizeHsbcCashScopeToken,
            )
            || !hasConsistentTextValues(
                [
                    txn?.currency,
                    txn?.normalized?.currency,
                    source.currency,
                    source.statement_currency_raw,
                ],
                normalizeCurrency,
            )
            || transactionAccountTypes.some((value) => !value)
            || transactionAccountTypes.some((value) => (
                value !== transactionAccountTypes[0]
            ))
            || !hasConsistentTextValues(
                [source.statement_order_id, source.order_id],
                normalizeOrderReference,
            )
            || !transactionNetAmountAliases.length
            || !hasExactHsbcDecimalAliases(transactionNetAmountAliases)
        ) return false;
        return postings.every((posting) => {
            const postingCurrency = normalizeCurrency(posting?.currency);
            const postingSourceFileKind = String(
                posting?.source_file_kind || '',
            ).trim().toLowerCase();
            const postingAccountType = normalizeHsbcCashAccountType(
                posting?.account_type,
                postingCurrency,
            );
            const shaValues = presentValues([
                posting?.source_sequence_sha256,
                posting?.source_file_sha256,
                posting?.statement_pdf_source_sha256,
            ]).map((value) => String(value).trim().toLowerCase());
            const postingAmountAliases = presentValues([
                posting?.amount_raw,
                posting?.amount,
            ]);
            const hasCanonicalAmount = Object.prototype.hasOwnProperty.call(
                posting,
                'amount_raw',
            ) && normalizeHsbcDecimalText(posting?.amount_raw);
            const hasCanonicalBalance = Object.prototype.hasOwnProperty.call(
                posting,
                'balance_after_raw',
            );
            const balanceAliases = presentValues([
                posting?.balance_after_raw,
                posting?.balance_after,
            ]);
            const postingRowNumber = parseHsbcPositiveSequenceNumber(
                posting?.row_number,
            );
            const postingLedgerSequence = parseHsbcPositiveSequenceNumber(
                posting?.ledger_sequence,
            );
            const postingSequenceOrder = String(
                posting?.ledger_sequence_order || '',
            ).trim().toLowerCase();
            const postingSequenceDirection = posting?.source_sequence_direction;
            const hasPostingSequenceDirection = postingSequenceDirection !== undefined
                && postingSequenceDirection !== null
                && String(postingSequenceDirection).trim() !== '';
            const hasProducerSequenceIdentity = (
                postingRowNumber !== null
                && postingLedgerSequence !== null
                && !hasPostingSequenceDirection
                && (
                    postingSourceFileKind === 'hsbc_usd_savings_csv'
                        ? postingSequenceOrder === 'chronological'
                        : (
                            postingSequenceOrder === ''
                            && postingRowNumber === postingLedgerSequence
                        )
                )
            );
            return (
                isSupportedHsbcCashCurrency(postingCurrency)
                && isKnownHsbcCashFileKind(postingSourceFileKind)
                && isHsbcCashFileKindCurrencyCompatible(
                    postingSourceFileKind,
                    postingCurrency,
                )
                && isHsbcCashFileKindAccountCompatible(
                    postingSourceFileKind,
                    postingCurrency,
                    postingAccountType,
                )
                && postingAccountType
                && hasProducerSequenceIdentity
                && (
                    !transactionAccountTypes.length
                    || postingAccountType === transactionAccountTypes[0]
                )
                && shaValues.length > 0
                && shaValues.every((value) => (
                    /^[0-9a-f]{64}$/.test(value) && value === shaValues[0]
                ))
                && postingAmountAliases.length > 0
                && hasCanonicalAmount
                && hasExactHsbcDecimalAliases(postingAmountAliases)
                && hasCanonicalBalance
                && (
                    !balanceAliases.length
                    || hasExactHsbcDecimalAliases(balanceAliases)
                )
            );
        });
    }

    return {
        getHsbcCashEvidenceState,
        getHsbcCashScopeDescriptor,
        getHsbcDirectCashPhysicalEvidenceIdentity,
        getHsbcStructuredPostingPhysicalEvidenceIdentity,
        hasConsistentHsbcStructuredSettlementAliases,
        isHsbcCashFileKindAccountCompatible,
        isHsbcCashFileKindCurrencyCompatible,
        isHsbcCashEvidenceTransaction,
        isKnownHsbcCashFileKind,
        isSupportedHsbcCashCurrency,
        normalizeHsbcCashAccountType,
        normalizeHsbcCashCurrency,
        normalizeHsbcCashScopeToken,
        normalizeHsbcDecimalText,
        normalizeHsbcEvidenceDate,
        parseFiniteNonBlankHsbcNumber,
        parseHsbcPositiveSequenceNumber,
    };
}
