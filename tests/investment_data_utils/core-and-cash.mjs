/* Code version: v1.3.2 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    INVESTMENT_DATA_UTILS_MODULE_VERSION,
    getInvestmentAggregatePnlCoverage,
    INVESTMENT_REPLAY_ORDER_SYMBOL,
    applyInvestmentVerifiedTaxLotCompatibilityFallbacks,
    classifyInvestmentUsRealtimeSession,
    filterAggregateOnlyOverlayTransactions,
    isCompleteHsbcStatementPdfBundle,
    isRealtimeQuotePulseProviderEligible,
    parseInvestmentOptionalNumber,
    resolveRealtimeQuoteSource,
    LIVE_INVESTMENT_API_FIXTURE,
    createUtils,
    buildDailyEquityChartPoints,
    buildDatedCashSnapshotProjection,
    buildTickerPriceIndex,
    buildInvestmentFxRateTimeline,
    computeInvestmentLiveHoldingsTotalEquity,
    buildHsbcCashSettlementBoundaryPlan,
    aggregateInvestmentScopedPositionStates,
    calculateSnapshotMarketValue,
    convertAmountToBaseCurrency,
    formatHoldingsMoney,
    formatTransactionDescription,
    formatTransactionCurrency,
    buildRenderedSplitFactorHints,
    buildTickerSummaries,
    compareInvestmentTaxLotTransactions,
    compareInvestmentTransactions,
    compareInvestmentTransactionsForReplay,
    sortInvestmentTransactionsForReplay,
    sortInvestmentTaxLotTransactions,
    buildValuationStatus,
    normalizePriceHistoryPayload,
    sumKolRewardRealizedIncomeInBaseCurrency,
    isKolRewardTransaction,
    addInvestmentCashScopeDelta,
    createCashLedgerFromBalances,
    createInvestmentCashScopeLedger,
    getInvestmentCashBalanceBoundary,
    getInvestmentCashBalanceScope,
    getInvestmentCashScopeBalances,
    getInvestmentBaseCurrency,
    getInvestmentCostBasisMethod,
    getInvestmentBrokerStartingCashBalances,
    getInvestmentBrokerEndingCashBalances,
    getInvestmentBrokerEndingCashInBaseCurrency,
    getInvestmentBrokerCurrentPendingSettlementCash,
    getInvestmentBrokerCurrentDisplayCash,
    getInvestmentBrokerCurrentCashSnapshot,
    buildInvestmentPostSnapshotCashDelta,
    getInvestmentBrokerEndingCashAsOf,
    getInvestmentBrokerEndingCashAsOfDateTime,
    getInvestmentBrokerPositionSnapshotAsOf,
    getInvestmentEndingCashBalances,
    getInvestmentEndingCashInBaseCurrency,
    getInvestmentStartingCashBalances,
    getAuthoritativePositionSnapshot,
    getAuthoritativePositionSnapshotForTransactions,
    projectAuthoritativePositionSnapshot,
    createPositionState,
    getTransactionAmount,
    getInvestmentInternalTransferAggregateBridgeAmount,
    getInvestmentInternalTransferAggregateBridgeDelta,
    getTransactionEconomicAmount,
    getTransactionEvidencedTradeCashAmount,
    getTransactionRenderedSplitFactor,
    getTransactionValuationQuantity,
    getLongbridgeHkCashEquivalentSyntheticTicker,
    getCashEquivalentTickerSet,
    getMoneyMarketTickerSet,
    isLongbridgeHkCashEquivalentTransfer,
    isUsmartHkFractionalSharesTransaction,
    USMART_HK_FRACTIONAL_SYNTHETIC_TICKER,
    setInvestmentCashScopeBoundary,
    makeImportedTrade,
    makeScopedDramTrade,
    setDramTestWindow,
} from './context.mjs';

const HSBC_SEQUENCE_SHA_A = 'a'.repeat(64);
const HSBC_SEQUENCE_SHA_B = 'b'.repeat(64);
const HSBC_SEQUENCE_SHA_C = 'c'.repeat(64);
const HSBC_SEQUENCE_SHA_D = 'd'.repeat(64);

test('optional Investment numbers preserve unavailable values instead of coercing zero', () => {
    for (const value of [null, undefined, '', '   ', Number.NaN, Number.POSITIVE_INFINITY]) {
        assert.equal(parseInvestmentOptionalNumber(value), null);
    }
    assert.equal(parseInvestmentOptionalNumber(0), 0);
    assert.equal(parseInvestmentOptionalNumber('0'), 0);
    assert.equal(parseInvestmentOptionalNumber('12.5'), 12.5);
});

test('stale backend payloads do not receive browser-synthesized attestations', () => {
    const payload = {
        broker_summaries: {
            hsbc: {
                account: '000-999999-999',
                tax_lot_history_verifications: {
                    GOOGL: {verified_through: '2026-07-31'},
                },
            },
        },
    };

    assert.deepEqual(applyInvestmentVerifiedTaxLotCompatibilityFallbacks(payload), []);
    const verifications = payload.broker_summaries.hsbc.tax_lot_history_verifications;
    assert.equal(verifications.GOOGL.verified_through, '2026-07-31');
    assert.equal(verifications.DRAM, undefined);
    assert.equal(verifications.EUV, undefined);
    assert.deepEqual(applyInvestmentVerifiedTaxLotCompatibilityFallbacks(payload), []);

    const unrelatedPayload = {
        broker_summaries: {hsbc: {account: 'different-account'}},
    };
    assert.deepEqual(applyInvestmentVerifiedTaxLotCompatibilityFallbacks(unrelatedPayload), []);
    assert.equal(
        unrelatedPayload.broker_summaries.hsbc.tax_lot_history_verifications,
        undefined,
    );
});

test('aggregate-only transfer filtering excludes only confirmed receipt keys without mutating evidence', () => {
    const transactions = [
        {manual_internal_transfer_key: 'source', type: 'buy'},
        {manual_internal_transfer_key: 'receipt', type: 'transfer_in'},
    ];
    const original = structuredClone(transactions);
    const filtered = filterAggregateOnlyOverlayTransactions(transactions, new Set(['receipt']));

    assert.deepEqual(filtered, [transactions[0]]);
    assert.deepEqual(transactions, original);
    assert.notEqual(filtered, transactions);
});

test('HSBC smart statement selector accepts full monthly PDFs and compatible pairs', () => {
    const composite = {name: 'composite.pdf', type: 'application/pdf'};
    const investment = {name: 'investment.pdf', type: 'application/pdf'};
    assert.equal(isCompleteHsbcStatementPdfBundle([composite]), true);
    assert.equal(isCompleteHsbcStatementPdfBundle([composite, investment]), true);
    assert.equal(isCompleteHsbcStatementPdfBundle([composite, investment, composite]), true);
    assert.equal(isCompleteHsbcStatementPdfBundle([]), false);
    assert.equal(isCompleteHsbcStatementPdfBundle([composite, {name: 'notes.txt', type: 'text/plain'}]), false);
});

test('realtime quote source preserves one provider and reports mixed provenance', () => {
    assert.equal(resolveRealtimeQuoteSource([{source: 'longbridge'}]), 'longbridge');
    assert.equal(resolveRealtimeQuoteSource([{source: 'Longbridge'}, {source: 'longbridge'}]), 'longbridge');
    assert.equal(resolveRealtimeQuoteSource([{source: 'longbridge'}, {source: 'yfinance'}]), 'mixed');
    assert.equal(resolveRealtimeQuoteSource([{}, null]), 'realtime');
});

test('extended-hours Investment pulses require Longbridge while regular-session fallback remains eligible', () => {
    assert.equal(isRealtimeQuotePulseProviderEligible({
        market: 'US', session: 'overnight', source: 'longbridge',
    }), true);
    assert.equal(isRealtimeQuotePulseProviderEligible({
        market: 'US', session: 'overnight', source: 'yfinance',
    }), false);
    assert.equal(isRealtimeQuotePulseProviderEligible({
        market: 'US', session: 'post', source: 'longbridge',
    }), true);
    assert.equal(isRealtimeQuotePulseProviderEligible({
        market: 'US', session: 'pre', source: 'yfinance',
    }), false);
    assert.equal(isRealtimeQuotePulseProviderEligible({
        market: 'US', session: 'intraday', source: 'yfinance',
    }), true);
    assert.equal(isRealtimeQuotePulseProviderEligible({
        market: 'HK', session: 'intraday', source: 'yfinance',
    }), true);
});

test('Investment realtime clock recognizes valid US overnight windows', () => {
    assert.equal(classifyInvestmentUsRealtimeSession({
        weekday: 'Mon', hour: 23, minute: 19,
    }), 'overnight');
    assert.equal(classifyInvestmentUsRealtimeSession({
        weekday: 'Tue', hour: 3, minute: 59,
    }), 'overnight');
    assert.equal(classifyInvestmentUsRealtimeSession({
        weekday: 'Sun', hour: 20, minute: 0,
    }), 'overnight');
    assert.equal(classifyInvestmentUsRealtimeSession({
        weekday: 'Fri', hour: 20, minute: 0,
    }), 'off');
    assert.equal(classifyInvestmentUsRealtimeSession({
        weekday: 'Sat', hour: 2, minute: 0,
    }), 'off');
});
test('current Holdings equity uses one cash snapshot plus open market values', () => {
    const totalEquity = computeInvestmentLiveHoldingsTotalEquity([
        {ticker: 'DRAM', hasOpenPosition: true, marketValue: 25793.9998626709},
        {ticker: 'QQQI', hasOpenPosition: true, marketValue: 18410.700302124023},
        {ticker: 'SGOV', hasOpenPosition: true, marketValue: 10156.559753417969},
        {ticker: 'EUV', hasOpenPosition: true, marketValue: 2013.7500286102295},
        {ticker: 'IBKR', hasOpenPosition: true, marketValue: 360.68186443481443},
        {ticker: 'CLOSED', hasOpenPosition: false, marketValue: 999999},
    ], 23565.66);
    assert.equal(totalEquity, 80301.35181125793);
    assert.equal(
        computeInvestmentLiveHoldingsTotalEquity([
            {ticker: 'DRAM', hasOpenPosition: true, marketValue: null},
        ], 23565.66),
        null,
    );
});

test('current broker cash converts foreign balances and applies pending once', () => {
    const previousWindow = globalThis.window;
    globalThis.window = {
        WORTHWARD_INVESTMENT_DATA: {
            broker_summaries: {
                hsbc: {
                    ending_cash_base_currency: '23412.54',
                    ending_cash_by_currency: {
                        HKD: '89.24',
                        USD: '23412.54',
                        CNH: '0.00',
                    },
                    hsbc_bank_available_cash: '23388.54',
                    hsbc_pending_settlement_cash_raw: '-24.600',
                    hsbc_pending_settlement_fee_adjustment: '0.000',
                    hsbc_pending_settlement_fee_unapplied: '0.000',
                    hsbc_pending_settlement_cash: '-24.600',
                    hsbc_pending_settlement_order_count: 1,
                    hsbc_broker_cash_estimate: '23387.940',
                    cash_snapshot_authoritative: true,
                    position_snapshot_as_of: '2026-08-19',
                },
                ibkr: {
                    ending_cash: '950.49',
                    cash_snapshot_authoritative: true,
                    ending_cash_as_of: '2026-08-19',
                },
                schwab: {
                    ending_cash: '0.41',
                    position_snapshot_as_of: '2026-08-13',
                },
            },
            fx_rate_history_by_currency: {
                HKD: {
                    dates: ['2026-08-19'],
                    values: {'2026-08-19': 7.842899799346924},
                },
            },
        },
    };
    try {
        assert.equal(getInvestmentBrokerCurrentPendingSettlementCash('hsbc'), -24.6);
        assert.equal(getInvestmentBrokerCurrentDisplayCash('hsbc'), 23387.94);
        assert.deepEqual(getInvestmentBrokerEndingCashBalances('hsbc'), {
            HKD: 89.24,
            USD: 23412.54,
        });
        const fxTimeline = buildInvestmentFxRateTimeline([], 'USD');
        const hsbcSnapshot = getInvestmentBrokerCurrentCashSnapshot(
            'hsbc',
            '2026-08-20',
            fxTimeline,
        );
        assert.ok(hsbcSnapshot);
        assert.ok(Math.abs(
            hsbcSnapshot.runningCash - (23412.54 + (89.24 / 7.842899799346924)),
        ) < 1e-9);
        assert.ok(Math.abs(
            hsbcSnapshot.displayCash - (23387.94 + (89.24 / 7.842899799346924)),
        ) < 1e-9);
        assert.equal(hsbcSnapshot.isApproximate, true);
        assert.equal(getInvestmentBrokerCurrentDisplayCash('ibkr'), 950.49);
        assert.equal(
            getInvestmentBrokerCurrentCashSnapshot('ibkr', '2026-08-20', fxTimeline)?.displayCash,
            950.49,
        );
        assert.equal(getInvestmentBrokerCurrentDisplayCash('schwab'), 0.41);
        assert.equal(getInvestmentBrokerCurrentDisplayCash('longbridge_hk'), null);
    } finally {
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
    }
});

test('settled HSBC FX conversion does not mark current cash provisional', () => {
    const previousWindow = globalThis.window;
    globalThis.window = {
        WORTHWARD_INVESTMENT_DATA: {
            broker_summaries: {
                hsbc: {
                    ending_cash_base_currency: '23387.94',
                    ending_cash_by_currency: {
                        HKD: '89.24',
                        USD: '23387.94',
                    },
                    hsbc_pending_settlement_cash: '0.000',
                    hsbc_pending_settlement_order_count: 0,
                    cash_snapshot_authoritative: true,
                },
            },
            fx_rate_history_by_currency: {
                HKD: {
                    dates: ['2026-08-19'],
                    values: {'2026-08-19': 7.842899799346924},
                },
            },
        },
    };
    try {
        const fxTimeline = buildInvestmentFxRateTimeline([], 'USD');
        const snapshot = getInvestmentBrokerCurrentCashSnapshot(
            'hsbc',
            '2026-08-20',
            fxTimeline,
        );
        assert.ok(snapshot);
        assert.ok(Math.abs(
            snapshot.displayCash - (23387.94 + (89.24 / 7.842899799346924)),
        ) < 1e-9);
        assert.equal(snapshot.pendingSettlementCash, 0);
        assert.equal(snapshot.isApproximate, false);
    } finally {
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
    }
});

test('replay comparator uses ledger booking date before execution timestamp', () => {
    const bookingDateRow = {
        date: '2023-05-11',
        datetime: '2023-05-10 00:50:40',
    };
    const laterSameDayRow = {
        date: '2023-05-10',
        datetime: '2023-05-10 00:53:48',
    };
    assert.ok(compareInvestmentTransactionsForReplay(bookingDateRow, laterSameDayRow) > 0);
    assert.ok(compareInvestmentTransactionsForReplay(laterSameDayRow, bookingDateRow) < 0);
});

test('HSBC USD Savings CSV rows use the importer chronological ledger sequence', () => {
    const olderSourceRow = {
        broker: 'hsbc',
        account: 'HSBC-TEST',
        account_type: 'USD Savings',
        date: '2026-06-24',
        datetime: '2026-06-24 20:00:00',
        type: 'deposit',
        currency: 'USD',
        net_amount_raw: '2200.88',
        normalized: {net_amount: '2200.88'},
        source: {
            account_type: 'USD Savings',
            balance_after_raw: '2200.88',
            cash_balance_authoritative: true,
            cash_balance_scope: 'account',
            file_kind: 'hsbc_usd_savings_csv',
            row_number: 90,
            ledger_sequence: 1,
            ledger_sequence_order: 'chronological',
            source_sequence_sha256: HSBC_SEQUENCE_SHA_A,
        },
    };
    const newerSourceRow = {
        ...olderSourceRow,
        net_amount_raw: '2948.41',
        normalized: {net_amount: '2948.41'},
        source: {
            ...olderSourceRow.source,
            balance_after_raw: '5149.29',
            file_kind: 'hsbc_usd_savings_csv',
            row_number: 89,
            ledger_sequence: 2,
            source_sequence_sha256: HSBC_SEQUENCE_SHA_A,
        },
    };
    assert.deepEqual(
        sortInvestmentTransactionsForReplay([newerSourceRow, olderSourceRow]),
        [olderSourceRow, newerSourceRow],
    );
});

test('pasted HSBC cash rows follow their chronological ledger sequence', () => {
    for (const fileKind of [
        'hsbc_usd_account_text',
        'hsbc_multi_currency_cash_account_text',
    ]) {
        const earlierPosting = {
            broker: 'hsbc',
            account: 'HSBC-TEST',
            account_type: fileKind === 'hsbc_usd_account_text'
                ? 'USD Savings'
                : 'HKD Savings',
            date: '2026-09-19',
            datetime: '2026-09-19 20:00:00',
            type: 'withdrawal',
            currency: fileKind === 'hsbc_usd_account_text' ? 'USD' : 'HKD',
            net_amount_raw: '-10',
            normalized: {net_amount: '-10'},
            source: {
                account_type: fileKind === 'hsbc_usd_account_text'
                    ? 'USD Savings'
                    : 'HKD Savings',
                balance_after_raw: '90',
                cash_balance_authoritative: fileKind === 'hsbc_usd_account_text',
                cash_balance_scope: 'account',
                file_kind: fileKind,
                row_number: 49,
                ledger_sequence: 49,
                source_sequence_sha256: HSBC_SEQUENCE_SHA_A,
            },
        };
        const laterPosting = {
            ...earlierPosting,
            type: 'deposit',
            net_amount_raw: '20',
            normalized: {net_amount: '20'},
            source: {
                ...earlierPosting.source,
                balance_after_raw: '110',
                file_kind: fileKind,
                row_number: 50,
                ledger_sequence: 50,
                source_sequence_sha256: HSBC_SEQUENCE_SHA_A,
            },
        };
        assert.deepEqual(
            sortInvestmentTransactionsForReplay([laterPosting, earlierPosting]),
            [earlierPosting, laterPosting],
        );
    }
});

test('HSBC cash sequence ordering never crosses cash-scope or source domains', () => {
    const makeCashRow = ({
        account = 'HSBC-TEST',
        accountType = 'USD Savings',
        currency = 'USD',
        fileKind = 'hsbc_usd_account_text',
        sequenceSha256 = HSBC_SEQUENCE_SHA_A,
        type,
        sequence,
        amount,
    }) => ({
        broker: 'hsbc',
        account,
        account_type: accountType,
        date: '2026-09-19',
        datetime: '2026-09-19 20:00:00',
        type,
        currency,
        net_amount_raw: String(amount),
        normalized: {net_amount: String(amount)},
        source: {
            account_type: accountType,
            balance_after_raw: '100',
            cash_balance_authoritative: [
                'hsbc_usd_account_text',
                'hsbc_usd_savings_csv',
            ].includes(fileKind),
            cash_balance_scope: 'account',
            file_kind: fileKind,
            ledger_sequence: sequence,
            row_number: sequence,
            source_sequence_sha256: sequenceSha256,
            ...(fileKind === 'hsbc_usd_savings_csv'
                ? {ledger_sequence_order: 'chronological'}
                : {}),
        },
    });
    const deposit = makeCashRow({type: 'deposit', sequence: 99, amount: 20});
    const withdrawal = makeCashRow({type: 'withdrawal', sequence: 1, amount: -10});
    assert.deepEqual(
        sortInvestmentTransactionsForReplay([deposit, withdrawal]),
        [withdrawal, deposit],
    );

    for (const isolatedWithdrawal of [
        {...withdrawal, account_type: 'Foreign Currency Savings USD'},
        {...withdrawal, currency: 'HKD'},
        {
            ...withdrawal,
            source: {...withdrawal.source, source_sequence_sha256: HSBC_SEQUENCE_SHA_B},
        },
        {...withdrawal, account: ''},
    ]) {
        const forward = compareInvestmentTransactionsForReplay(
            deposit,
            isolatedWithdrawal,
            7,
            2,
        );
        const reverse = compareInvestmentTransactionsForReplay(
            isolatedWithdrawal,
            deposit,
            2,
            7,
        );
        assert.equal(forward, 5);
        assert.equal(forward, -reverse);
    }

    const sameTypeSameAmount = {
        ...deposit,
        source: {...deposit.source, row_number: 1, ledger_sequence: 1},
    };
    for (const [left, incomparableDeposit] of [
        [
            deposit,
            {
                ...sameTypeSameAmount,
                source: {
                    ...sameTypeSameAmount.source,
                    source_sequence_sha256: HSBC_SEQUENCE_SHA_B,
                },
            },
        ],
        [deposit, {...sameTypeSameAmount, account_type: 'Foreign Currency Savings USD'}],
        [deposit, {...sameTypeSameAmount, currency: 'HKD'}],
        [deposit, {...sameTypeSameAmount, account: ''}],
        [deposit, {...sameTypeSameAmount, account_type: ''}],
        [deposit, {...sameTypeSameAmount, currency: ''}],
        [
            {...deposit, source: {...deposit.source, source_sequence_sha256: ''}},
            {
                ...sameTypeSameAmount,
                source: {...sameTypeSameAmount.source, source_sequence_sha256: ''},
            },
        ],
    ]) {
        const forward = compareInvestmentTransactionsForReplay(
            left,
            incomparableDeposit,
            7,
            2,
        );
        const reverse = compareInvestmentTransactionsForReplay(
            incomparableDeposit,
            left,
            2,
            7,
        );
        assert.notEqual(forward, 0);
        assert.equal(forward, -reverse);
    }

    const sequenceTwo = makeCashRow({
        type: 'deposit', sequence: 2, amount: 20,
    });
    const sequenceOne = makeCashRow({
        type: 'deposit', sequence: 1, amount: 20,
    });
    const foreignDomain = makeCashRow({
        accountType: 'USD Current',
        type: 'deposit',
        sequence: 1,
        amount: 20,
    });
    const sorted = sortInvestmentTransactionsForReplay([
        sequenceTwo,
        foreignDomain,
        sequenceOne,
    ]);
    assert.deepEqual(sorted, [sequenceOne, foreignDomain, sequenceTwo]);

    const aliasConflicts = [
        {
            ...sequenceTwo,
            source: {...sequenceTwo.source, source_file_sha256: HSBC_SEQUENCE_SHA_B},
        },
        {
            ...sequenceTwo,
            source: {...sequenceTwo.source, account_number: 'HSBC-OTHER'},
        },
        {
            ...sequenceTwo,
            source: {...sequenceTwo.source, statement_currency_raw: 'HKD'},
        },
        {...sequenceTwo, amount: '99', cash: '99'},
        {
            ...sequenceTwo,
            source: {...sequenceTwo.source, broker: 'ibkr'},
        },
        {
            ...sequenceTwo,
            source: {
                ...sequenceTwo.source,
                statement_pdf_source_row_number: 99,
            },
        },
        {...sequenceTwo, date: '2026-02-31'},
    ];
    aliasConflicts.forEach((conflictingRow) => {
        assert.deepEqual(
            sortInvestmentTransactionsForReplay([conflictingRow, sequenceOne]),
            [conflictingRow, sequenceOne],
        );
    });

    const firstCapture = makeCashRow({
        type: 'deposit', sequence: 1, amount: 20, sequenceSha256: HSBC_SEQUENCE_SHA_C,
    });
    const secondCapture = makeCashRow({
        type: 'deposit', sequence: 1, amount: 20, sequenceSha256: HSBC_SEQUENCE_SHA_D,
    });
    assert.deepEqual(
        sortInvestmentTransactionsForReplay([firstCapture, secondCapture]),
        [firstCapture, secondCapture],
    );
    assert.deepEqual(
        sortInvestmentTransactionsForReplay([secondCapture, firstCapture]),
        [secondCapture, firstCapture],
    );

    const sameTimeOrder = {
        broker: 'hsbc',
        account: 'HSBC-TEST',
        date: '2026-09-19',
        datetime: '2026-09-19 20:00:00',
        type: 'buy',
        ticker: 'QQQI',
        source: {file_kind: 'hsbc_order_status_text', row_number: 3},
    };
    assert.deepEqual(
        sortInvestmentTransactionsForReplay([sequenceTwo, sameTimeOrder, sequenceOne]),
        [sequenceOne, sameTimeOrder, sequenceTwo],
    );
    assert.deepEqual(
        sortInvestmentTransactionsForReplay([sameTimeOrder, sequenceTwo, sequenceOne]),
        [sameTimeOrder, sequenceOne, sequenceTwo],
    );

    const schwabSell = {
        broker: 'schwab', account: 'SCHWAB-TEST', date: '2026-09-19',
        datetime: '2026-09-19 20:00:00', type: 'sell', ticker: 'QQQI',
        source: {same_day_execution_sequence: 2},
    };
    const schwabBuy = {
        ...schwabSell,
        type: 'buy',
        source: {same_day_execution_sequence: 1},
    };
    assert.deepEqual(
        sortInvestmentTransactionsForReplay([sequenceOne, schwabSell, schwabBuy]),
        [sequenceOne, schwabBuy, schwabSell],
    );

    const ibkrBuy = {
        broker: 'ibkr', account: 'IBKR-TEST', date: '2026-09-19',
        datetime: '2026-09-19 20:00:00', type: 'buy', ticker: 'BOXX', source: {},
    };
    const permutations = [
        [schwabBuy, schwabSell, ibkrBuy],
        [schwabBuy, ibkrBuy, schwabSell],
        [schwabSell, schwabBuy, ibkrBuy],
        [schwabSell, ibkrBuy, schwabBuy],
        [ibkrBuy, schwabBuy, schwabSell],
        [ibkrBuy, schwabSell, schwabBuy],
    ];
    const canonicalNonCashOrder = sortInvestmentTransactionsForReplay(permutations[0]);
    permutations.forEach((permutation) => {
        const ordered = sortInvestmentTransactionsForReplay(permutation);
        assert.deepEqual(ordered, canonicalNonCashOrder);
        assert.ok(ordered.indexOf(schwabBuy) < ordered.indexOf(schwabSell));
    });
});

test('HSBC date-only orders retain source-page execution order after SEC settlement enrichment', () => {
    const purchase = {
        broker: 'hsbc',
        account: '000-999999-999',
        date: '2026-08-07',
        datetime: '2026-08-07 20:00:00',
        type: 'buy',
        ticker: 'DRAM',
        source: {
            file_kind: 'hsbc_order_status_text',
            row_number: 3,
            order_status_source_row_number: 3,
            order_status_page_order: 'newest_first',
            statement_order_id: 'P-900006',
            cash_settlement_source_row_number: 50,
        },
    };
    const sale = {
        ...purchase,
        type: 'sell',
        source: {
            file_kind: 'hsbc_order_status_text',
            row_number: 1,
            order_status_source_row_number: 1,
            order_status_page_order: 'newest_first',
            statement_order_id: 'S-900004',
        },
    };

    assert.deepEqual(
        sortInvestmentTransactionsForReplay([sale, purchase]),
        [purchase, sale],
    );
    assert.deepEqual(
        sortInvestmentTaxLotTransactions([sale, purchase]),
        [purchase, sale],
    );
});

test('Schwab date-only trades retain explicit same-day execution sequence', () => {
    const buy = {
        broker: 'schwab',
        account: 'Individual ...001',
        date: '2026-08-24',
        datetime: '2026-08-24 20:00:00',
        type: 'buy',
        ticker: 'EUV',
        normalized: {net_amount: '-23.45'},
        source: {
            file_kind: 'schwab_csv',
            datetime_precision: 'day',
            source_has_intraday_timestamp: false,
            source_row_order: 'newest_first',
            row_number: 3,
            same_day_execution_sequence: 1,
        },
    };
    const sell = {
        ...buy,
        type: 'sell',
        normalized: {net_amount: '23.755'},
        source: {
            ...buy.source,
            row_number: 2,
            same_day_execution_sequence: 2,
        },
    };

    assert.deepEqual(
        sortInvestmentTransactionsForReplay([sell, buy]),
        [buy, sell],
    );
    assert.deepEqual(
        sortInvestmentTaxLotTransactions([sell, buy]),
        [buy, sell],
    );
});

test('tax-lot order keeps a Schwab same-day pair ordered among other brokers at the same time', () => {
    const schwabBuy = {
        broker: 'schwab',
        account: 'Individual ...001',
        currency: 'USD',
        date: '2026-08-24',
        datetime: '2026-08-24 20:00:00',
        type: 'buy',
        ticker: 'EUV',
        source: {
            file_kind: 'schwab_csv',
            datetime_precision: 'day',
            source_has_intraday_timestamp: false,
            source_row_order: 'newest_first',
            row_number: 16,
            same_day_execution_sequence: 1,
        },
    };
    const schwabSell = {
        ...schwabBuy,
        type: 'sell',
        source: {...schwabBuy.source, row_number: 15, same_day_execution_sequence: 2},
    };
    const hsbcRows = [16, 15, 14, 9].map((rowNumber) => ({
        broker: 'hsbc',
        account: '000-000000-001',
        currency: 'USD',
        date: '2026-08-24',
        datetime: '2026-08-24 20:00:00',
        type: 'buy',
        ticker: 'DRAM',
        source: {file_kind: 'hsbc_order_status_text', row_number: rowNumber},
    }));
    // Mixing account-local sequences with cross-broker row numbers used to
    // make the comparator intransitive, so input order decided the result.
    [
        [...hsbcRows, schwabBuy, schwabSell],
        [schwabSell, ...hsbcRows, schwabBuy],
        [schwabSell, schwabBuy, ...hsbcRows].reverse(),
    ].forEach((rows) => {
        const ordered = sortInvestmentTaxLotTransactions(rows);
        assert.ok(ordered.indexOf(schwabBuy) < ordered.indexOf(schwabSell));
    });
});

test('tax-lot ordering keeps partial HSBC execution sequences transitive across every permutation', () => {
    const makeOrder = ({id, rowNumber, sequence = null, type = 'buy'}) => ({
        id,
        broker: 'hsbc',
        account: '000-999999-999',
        currency: 'USD',
        date: '2026-08-24',
        datetime: '2026-08-24 20:00:00',
        type,
        ticker: 'DRAM',
        source: {
            file_kind: sequence === null ? 'manual_transfer' : 'hsbc_order_status_text',
            row_number: rowNumber,
            ...(sequence === null ? {} : {
                order_status_source_row_number: sequence,
                order_status_page_order: 'oldest_first',
            }),
        },
    });
    const first = makeOrder({id: 'first', rowNumber: 3, sequence: 1});
    const unsequenced = makeOrder({id: 'unsequenced', rowNumber: 2, type: 'transfer_in'});
    const second = makeOrder({id: 'second', rowNumber: 1, sequence: 2, type: 'sell'});
    const permutations = [
        [first, unsequenced, second],
        [first, second, unsequenced],
        [unsequenced, first, second],
        [unsequenced, second, first],
        [second, first, unsequenced],
        [second, unsequenced, first],
    ];
    permutations.forEach((rows) => {
        assert.deepEqual(
            sortInvestmentTaxLotTransactions(rows).map((row) => row.id),
            ['first', 'unsequenced', 'second'],
        );
        assert.deepEqual(
            [...rows]
                .sort((left, right) => compareInvestmentTaxLotTransactions(left, right))
                .map((row) => row.id),
            ['first', 'second', 'unsequenced'],
        );
    });
});

test('tax-lot replay normalizes mixed source timestamp formats before sorting', () => {
    setDramTestWindow();
    const historicalBuy = makeScopedDramTrade({
        broker: 'ibkr', account: 'U00000001', type: 'buy', date: '2026-08-13',
        quantity: 5, price: 50,
    });
    historicalBuy.datetime = '2026-08-13 08:18:42';
    historicalBuy.source.source_datetime_raw = '20260813081842.000[-4:EDT]';

    const currentSell = makeScopedDramTrade({
        broker: 'ibkr', account: 'U00000001', type: 'sell', date: '2026-08-14',
        quantity: 5, price: 57.75,
    });
    currentSell.datetime = '2026-08-14 11:05:00';
    currentSell.source.source_datetime_raw = '2026-08-14, 11:05 PM';

    assert.ok(compareInvestmentTaxLotTransactions(historicalBuy, currentSell) < 0);
    const dram = buildTickerSummaries([currentSell, historicalBuy], {DRAM: 57.75}, 0, {})[0];
    assert.equal(dram.realizedPnlLocal, 38.75);
});

test('bound-transfer replay order outranks later timestamp and source-row fallbacks', () => {
    const transferOut = {
        date: '2026-08-03',
        datetime: '2026-08-03 20:20:00',
        type: 'transfer_out',
        ticker: 'DRAM',
        source: {row_number: 362},
    };
    const transferIn = {
        date: '2026-08-03',
        datetime: '2026-08-03 20:00:00',
        type: 'transfer_in',
        ticker: 'DRAM',
        source: {row_number: 2},
    };
    Object.defineProperty(transferOut, INVESTMENT_REPLAY_ORDER_SYMBOL, {
        value: 10,
    });
    Object.defineProperty(transferIn, INVESTMENT_REPLAY_ORDER_SYMBOL, {
        value: 11,
    });

    assert.ok(compareInvestmentTransactions(transferOut, transferIn) < 0);
    assert.ok(compareInvestmentTransactionsForReplay(transferOut, transferIn) < 0);
    assert.ok(compareInvestmentTaxLotTransactions(transferOut, transferIn) < 0);
});

test('future HSBC settlement cash becomes ordered non-transaction boundaries', () => {
    const boundaries = buildHsbcCashSettlementBoundaryPlan([
        {
            broker: 'hsbc',
            account: 'HSBC-TEST',
            date: '2026-06-22',
            type: 'buy',
            ticker: 'BOXX',
            currency: 'USD',
            net_amount_raw: '-900.00',
            commission_raw: '0',
            normalized: {commission: '0', net_amount: '-900.00'},
            source: {
                file_kind: 'hsbc_order_status_text',
                statement_order_id: 'P-1',
                cash_settlement_date: '2026-06-23',
                cash_settlement_amount_raw: '-900.00',
                cash_settlement_balance_after_raw: '10100.00',
                cash_settlement_postings: [{
                    date: '2026-06-23',
                    amount_raw: '-900.00',
                    balance_after_raw: '10100.00',
                    row_number: 42,
                    ledger_sequence: 42,
                    currency: 'USD',
                    account_number: 'HSBC-TEST',
                    account_type: 'USD Savings',
                    source_file_kind: 'hsbc_usd_account_text',
                    source_sequence_sha256: HSBC_SEQUENCE_SHA_A,
                    reference: 'REF P1001 SEC',
                    role: 'principal',
                }],
            },
        },
        {
            broker: 'hsbc',
            account: 'HSBC-TEST',
            date: '2026-06-22',
            type: 'buy',
            ticker: 'EUV',
            currency: 'USD',
            net_amount_raw: '-100.00',
            commission_raw: '0',
            normalized: {commission: '0', net_amount: '-100.00'},
            source: {
                file_kind: 'hsbc_order_status_text',
                statement_order_id: 'P-2',
                cash_settlement_date: '2026-06-23',
                cash_settlement_amount_raw: '-100.00',
                cash_settlement_balance_after_raw: '10000.00',
                cash_settlement_postings: [{
                    date: '2026-06-23',
                    amount_raw: '-100.00',
                    balance_after_raw: '10000.00',
                    row_number: 43,
                    ledger_sequence: 43,
                    currency: 'USD',
                    account_number: 'HSBC-TEST',
                    account_type: 'USD Savings',
                    source_file_kind: 'hsbc_usd_account_text',
                    source_sequence_sha256: HSBC_SEQUENCE_SHA_A,
                    reference: 'REF P2001 SEC',
                    role: 'principal',
                }],
            },
        },
    ]);

    assert.deepEqual(
        boundaries.map((boundary) => [
            boundary.transactionDate,
            boundary.date,
            boundary.settlementBalanceAfter,
            boundary.settlementAmount,
            boundary.sourceRowSequence,
        ]),
        [
            ['2026-06-22', '2026-06-23', 10100, -900, 42],
            ['2026-06-22', '2026-06-23', 10000, -100, 43],
        ],
    );
    assert.ok(boundaries.every((boundary) => !('type' in boundary)));
    assert.ok(boundaries.every((boundary) => !('ticker' in boundary)));
    assert.ok(boundaries.every((boundary) => !('description' in boundary)));
    assert.ok(boundaries.every((boundary) => !('ledger_no' in boundary)));
    assert.ok(boundaries.every((boundary) => (
        boundary.cashScopeKey === 'HSBC|HSBC-TEST|SAVINGS|USD'
    )));
    assert.ok(boundaries.every((boundary) => (
        boundary.sourceSequenceSha256 === HSBC_SEQUENCE_SHA_A
    )));
});

test('blank HSBC fee balances remain unavailable while the fee cash leg is retained', () => {
    const boundaries = buildHsbcCashSettlementBoundaryPlan([{
        broker: 'hsbc',
        account: 'HSBC-TEST',
        account_type: 'USD Savings',
        date: '2026-09-17',
        type: 'sell',
        ticker: 'QQQI',
        currency: 'USD',
        net_amount_raw: '200',
        commission_raw: '-0.01',
        normalized: {commission: '-0.01'},
        source: {
            file_kind: 'hsbc_order_status_text',
            statement_order_id: 'S-100001',
            cash_settlement_date: '2026-09-18',
            cash_settlement_amount_raw: '200',
            cash_settlement_postings: [
                {
                    date: '2026-09-18', amount_raw: '200', balance_after_raw: '1200',
                    row_number: 44, ledger_sequence: 44, currency: 'USD',
                    account_number: 'HSBC-TEST', account_type: 'USD Savings',
                    source_file_kind: 'hsbc_usd_account_text',
                    source_sequence_sha256: HSBC_SEQUENCE_SHA_A,
                    reference: 'REF S100001001 SEC', role: 'principal',
                },
                {
                    date: '2026-09-18', amount_raw: '-0.01', balance_after_raw: '',
                    row_number: 45, ledger_sequence: 45, currency: 'USD',
                    account_number: 'HSBC-TEST', account_type: 'USD Savings',
                    source_file_kind: 'hsbc_usd_account_text',
                    source_sequence_sha256: HSBC_SEQUENCE_SHA_A,
                    reference: 'REF S100001001 SEC', role: 'fee',
                },
            ],
        },
    }]);

    assert.deepEqual(
        boundaries.map((boundary) => [
            boundary.role,
            boundary.settlementAmount,
            boundary.settlementBalanceAfter,
        ]),
        [
            ['principal', 200, 1200],
            ['fee', -0.01, null],
        ],
    );
});

test('HSBC settlement evidence closes physical-row aliases and same-day ownership', () => {
    const makeSell = ({
        account = 'HSBC-TEST',
        netAmount = '200',
        principalAmount = '200',
        sourceFileKind = 'hsbc_usd_account_text',
        tradeDate = '2026-09-17',
        settlementDate = '2026-09-18',
    } = {}) => ({
        broker: 'hsbc',
        account,
        date: tradeDate,
        type: 'sell',
        ticker: 'QQQI',
        currency: 'USD',
        net_amount_raw: netAmount,
        commission_raw: '-0.01',
        normalized: {commission: '-0.01', net_amount: netAmount},
        source: {
            file_kind: 'hsbc_order_status_text',
            statement_order_id: 'S-100001',
            cash_settlement_date: settlementDate,
            cash_settlement_amount_raw: principalAmount,
            cash_settlement_postings: [
                {
                    date: settlementDate, amount_raw: principalAmount,
                    balance_after_raw: '1200', row_number: 44,
                    ledger_sequence: 44, currency: 'USD', account_number: account,
                    account_type: 'USD Savings', source_file_kind: sourceFileKind,
                    source_sequence_sha256: HSBC_SEQUENCE_SHA_A,
                    reference: 'REF S100001001 SEC', role: 'principal',
                },
                {
                    date: settlementDate, amount_raw: '-0.01',
                    balance_after_raw: '1199.99', row_number: 45,
                    ledger_sequence: 45, currency: 'USD', account_number: account,
                    account_type: 'USD Savings', source_file_kind: sourceFileKind,
                    source_sequence_sha256: HSBC_SEQUENCE_SHA_A,
                    reference: 'REF S100001001 SEC', role: 'fee',
                },
            ],
        },
    });

    const sameDay = makeSell({
        tradeDate: '2026-09-18',
        settlementDate: '2026-09-18',
    });
    assert.deepEqual(
        buildHsbcCashSettlementBoundaryPlan([sameDay]).map((boundary) => boundary.role),
        ['principal', 'fee'],
    );
    assert.equal(getTransactionEvidencedTradeCashAmount(sameDay), 199.99);

    const legacyScalarOnly = makeSell();
    delete legacyScalarOnly.source.cash_settlement_postings;
    assert.deepEqual(buildHsbcCashSettlementBoundaryPlan([legacyScalarOnly]), []);

    const missingStatementOwner = makeSell({sourceFileKind: 'hsbc_statement_cash'});
    delete missingStatementOwner.source.statement_order_id;
    assert.deepEqual(buildHsbcCashSettlementBoundaryPlan([missingStatementOwner]), []);
    assert.equal(getTransactionEvidencedTradeCashAmount(missingStatementOwner), 200);

    const mismatchedStatementRowAlias = makeSell({
        sourceFileKind: 'hsbc_statement_cash',
    });
    mismatchedStatementRowAlias.source.cash_settlement_postings[1]
        .statement_pdf_source_row_number = 99;
    assert.deepEqual(
        buildHsbcCashSettlementBoundaryPlan([mismatchedStatementRowAlias]),
        [],
    );
    assert.equal(
        getTransactionEvidencedTradeCashAmount(mismatchedStatementRowAlias),
        200,
    );

    const invalidCalendarDate = makeSell({settlementDate: '2026-99-99'});
    assert.deepEqual(buildHsbcCashSettlementBoundaryPlan([invalidCalendarDate]), []);
    assert.equal(getTransactionEvidencedTradeCashAmount(invalidCalendarDate), 200);

    for (const [label, mutate] of [
        ['unsupported account type', (transaction) => {
            transaction.source.cash_settlement_postings.forEach((posting) => {
                posting.account_type = 'Mystery';
            });
        }],
        ['unsupported currency', (transaction) => {
            transaction.currency = 'DOGE';
            transaction.source.cash_settlement_postings.forEach((posting) => {
                posting.currency = 'DOGE';
                posting.account_type = 'Savings';
            });
        }],
        ['USD file kind with HKD currency', (transaction) => {
            transaction.currency = 'HKD';
            transaction.source.cash_settlement_postings.forEach((posting) => {
                posting.currency = 'HKD';
                posting.account_type = 'Savings';
            });
        }],
        ['missing source settlement amount', (transaction) => {
            delete transaction.source.cash_settlement_amount_raw;
        }],
        ['mismatched source settlement amount', (transaction) => {
            transaction.source.cash_settlement_amount_raw = '201';
        }],
        ['principal differs below binary tolerance', (transaction) => {
            transaction.source.cash_settlement_postings[0].amount_raw = '200.0000005';
        }],
        ['missing canonical posting amount', (transaction) => {
            const posting = transaction.source.cash_settlement_postings[0];
            posting.amount = posting.amount_raw;
            delete posting.amount_raw;
        }],
        ['missing canonical posting balance', (transaction) => {
            const posting = transaction.source.cash_settlement_postings[0];
            posting.balance_after = posting.balance_after_raw;
            delete posting.balance_after_raw;
        }],
        ['missing every cash balance', (transaction) => {
            transaction.source.cash_settlement_postings.forEach((posting) => {
                delete posting.balance_after_raw;
            });
        }],
        ['invalid sequence-order marker', (transaction) => {
            transaction.source.cash_settlement_postings[1]
                .ledger_sequence_order = 'reverse';
        }],
        ['mixed sequence-order domain', (transaction) => {
            transaction.source.cash_settlement_postings[1]
                .ledger_sequence_order = 'chronological';
        }],
        ['missing posting ledger sequence', (transaction) => {
            delete transaction.source.cash_settlement_postings[0].ledger_sequence;
        }],
        ['non-CSV divergent ledger sequence', (transaction) => {
            transaction.source.cash_settlement_postings[0].ledger_sequence = 99;
        }],
        ['USD file kind with Current account', (transaction) => {
            transaction.account_type = 'USD Current';
            transaction.source.account_type = 'USD Current';
            transaction.source.cash_settlement_postings.forEach((posting) => {
                posting.account_type = 'USD Current';
            });
        }],
        ['CSV without chronological marker', (transaction) => {
            transaction.source.cash_settlement_postings.forEach((posting) => {
                posting.source_file_kind = 'hsbc_usd_savings_csv';
            });
        }],
        ['non-decimal principal amount', (transaction) => {
            transaction.source.cash_settlement_amount_raw = '0xC8';
            transaction.source.cash_settlement_postings[0].amount_raw = '0xC8';
        }],
        ['missing owner net amount', (transaction) => {
            delete transaction.net_amount_raw;
            delete transaction.normalized.net_amount;
            transaction.amount = 200;
        }],
    ]) {
        const invalidDomain = makeSell();
        mutate(invalidDomain);
        assert.deepEqual(
            buildHsbcCashSettlementBoundaryPlan([invalidDomain]),
            [],
            label,
        );
        assert.equal(
            getTransactionEvidencedTradeCashAmount(invalidDomain),
            200,
            label,
        );
    }

    const reusedPhysicalRow = makeSell();
    reusedPhysicalRow.source.cash_settlement_postings[1].row_number = 44;
    assert.deepEqual(buildHsbcCashSettlementBoundaryPlan([reusedPhysicalRow]), []);
    assert.equal(getTransactionEvidencedTradeCashAmount(reusedPhysicalRow), 200);

    const firstOwner = makeSell();
    firstOwner.source.cash_settlement_postings.forEach((posting, index) => {
        posting.row_number = index === 0 ? 111 : 110;
        posting.ledger_sequence = index === 0 ? 57 : 58;
        posting.ledger_sequence_order = 'chronological';
    });
    const secondOwner = makeSell({
        account: 'HSBC-OTHER',
        netAmount: '300',
        principalAmount: '300',
        sourceFileKind: 'hsbc_statement_cash',
    });
    secondOwner.source.statement_order_id = 'S-200002';
    secondOwner.source.cash_settlement_postings.forEach((posting, index) => {
        posting.row_number = index === 0 ? 111 : 110;
        posting.ledger_sequence = index === 0 ? 57 : 58;
        posting.reference = 'STATEMENT CASH';
    });
    sortInvestmentTransactionsForReplay([firstOwner, secondOwner]);
    assert.deepEqual(
        buildHsbcCashSettlementBoundaryPlan([firstOwner, secondOwner]),
        [],
    );
    assert.equal(getTransactionEvidencedTradeCashAmount(firstOwner), 200);
    assert.equal(getTransactionEvidencedTradeCashAmount(secondOwner), 300);
});

test('HSBC settlement plan rejects a missing fee leg for nonzero commission', () => {
    const boundaries = buildHsbcCashSettlementBoundaryPlan([{
        broker: 'hsbc',
        account: 'HSBC-TEST',
        date: '2026-09-17',
        type: 'sell',
        currency: 'USD',
        net_amount_raw: '59.99',
        commission_raw: '-0.01',
        normalized: {commission: '-0.01'},
        source: {
            file_kind: 'hsbc_order_status_text',
            statement_order_id: 'S-100002',
            cash_settlement_date: '2026-09-18',
            cash_settlement_postings: [{
                date: '2026-09-18', amount_raw: '59.99', balance_after_raw: '2000',
                row_number: 44, ledger_sequence: 44, currency: 'USD',
                account_number: 'HSBC-TEST', account_type: 'USD Savings',
                source_file_kind: 'hsbc_usd_account_text',
                source_sequence_sha256: HSBC_SEQUENCE_SHA_A,
                reference: 'REF S100002001 SEC', role: 'principal',
            }],
        },
    }]);

    assert.deepEqual(boundaries, []);
});

test('HSBC settlement boundaries fail closed without a cash subaccount identity', () => {
    const boundaries = buildHsbcCashSettlementBoundaryPlan([{
        broker: 'hsbc',
        account: 'HSBC-TEST',
        date: '2026-06-22',
        type: 'sell',
        ticker: 'BOXX',
        currency: 'USD',
        source: {
            file_kind: 'hsbc_order_status_text',
            cash_settlement_date: '2026-06-23',
            cash_settlement_postings: [{
                date: '2026-06-23',
                amount_raw: '100',
                balance_after_raw: '1100',
                currency: 'USD',
                source_file_kind: 'hsbc_statement_cash',
            }],
        },
    }]);

    assert.deepEqual(boundaries, []);
});

test('HSBC settlement balance continuity overrides drifted incremental row sequences', () => {
    const boundaries = buildHsbcCashSettlementBoundaryPlan([
        {
            broker: 'hsbc',
            account: 'HSBC-TEST',
            date: '2026-09-01',
            type: 'buy',
            ticker: 'EUV',
            currency: 'USD',
            net_amount_raw: '-230.00',
            commission_raw: '0',
            normalized: {commission: '0', net_amount: '-230.00'},
            source: {
                statement_order_id: 'P-100003',
                cash_settlement_date: '2026-09-02',
                cash_settlement_amount_raw: '-230.00',
                cash_settlement_postings: [{
                    date: '2026-09-02',
                    amount_raw: '-230.00',
                    balance_after_raw: '32992.32',
                    row_number: 47,
                    ledger_sequence: 47,
                    currency: 'USD',
                    account_number: 'HSBC-TEST',
                    account_type: 'USD Savings',
                    source_file_kind: 'hsbc_usd_savings_csv',
                    source_sequence_sha256: HSBC_SEQUENCE_SHA_A,
                    ledger_sequence_order: 'chronological',
                    reference: 'REF P100003001 SEC',
                    role: 'principal',
                }],
            },
        },
        {
            broker: 'hsbc',
            account: 'HSBC-TEST',
            date: '2026-09-01',
            type: 'buy',
            ticker: 'BOXX',
            currency: 'USD',
            net_amount_raw: '-11807.00',
            commission_raw: '0',
            normalized: {commission: '0', net_amount: '-11807.00'},
            source: {
                statement_order_id: 'P-100004',
                cash_settlement_date: '2026-09-02',
                cash_settlement_amount_raw: '-11807.00',
                cash_settlement_postings: [{
                    date: '2026-09-02',
                    amount_raw: '-11807.00',
                    balance_after_raw: '21185.32',
                    row_number: 43,
                    ledger_sequence: 43,
                    currency: 'USD',
                    account_number: 'HSBC-TEST',
                    account_type: 'USD Savings',
                    source_file_kind: 'hsbc_usd_savings_csv',
                    source_sequence_sha256: HSBC_SEQUENCE_SHA_B,
                    ledger_sequence_order: 'chronological',
                    reference: 'REF P100004001 SEC',
                    role: 'principal',
                }],
            },
        },
    ]);

    assert.deepEqual(
        boundaries.map((boundary) => [
            boundary.reference,
            boundary.settlementBalanceAfter,
            boundary.sourceRowSequence,
        ]),
        [
            ['REF P100003001 SEC', 32992.32, 47],
            ['REF P100004001 SEC', 21185.32, 43],
        ],
    );
});

test('missing broker starting boundaries remain absent instead of becoming USD zero', () => {
    const previousWindow = globalThis.window;
    globalThis.window = {
        WORTHWARD_INVESTMENT_DATA: {
            broker_summaries: {
                ibkr: {},
                hsbc: {starting_cash: null},
                longbridge_hk: {starting_cash: '0'},
            },
        },
    };
    try {
        assert.deepEqual(getInvestmentBrokerStartingCashBalances('ibkr'), {});
        assert.deepEqual(getInvestmentBrokerStartingCashBalances('hsbc'), {});
        assert.deepEqual(getInvestmentBrokerStartingCashBalances('longbridge_hk'), {});
    } finally {
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
    }
});

test('daily equity replay accepts a settlement boundary snapshot without adding a transaction', () => {
    const previousWindow = globalThis.window;
    globalThis.window = {WORTHWARD_INVESTMENT_DATA: {starting_cash: '12000'}};
    try {
        const canonicalTransactions = [{
            date: '2026-06-22',
            datetime: '2026-06-22 20:00:00',
            ledger_no: 1,
            aggregate_running_cash: 12000,
            aggregate_display_cash: 12000,
            aggregate_holdings: {},
        }];
        const points = buildDailyEquityChartPoints(
            canonicalTransactions,
            {},
            new Set(),
            {
                replaySnapshots: [
                    canonicalTransactions[0],
                    {
                        date: '2026-06-23',
                        datetime: '2026-06-23 23:59:00.0001',
                        replay_snapshot_order: 2,
                        aggregate_running_cash: 11600,
                        aggregate_display_cash: 11600,
                        aggregate_holdings: {},
                        aggregate_money_market_anchors: {},
                        replay_snapshot_kind: 'hsbc_cash_settlement_boundary',
                    },
                ],
            },
        );
        assert.equal(points.find((point) => point.date === '2026-06-22')?.aggregate_total_equity, 12000);
        assert.equal(points.find((point) => point.date === '2026-06-23')?.aggregate_total_equity, 11600);
        assert.deepEqual(points.find((point) => point.date === '2026-06-23')?.anchor_ledger_nos, []);
    } finally {
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
    }
});

test('daily equity replay sorts snapshots by ledger date before consuming the cursor', () => {
    const previousWindow = globalThis.window;
    globalThis.window = {WORTHWARD_INVESTMENT_DATA: {starting_cash: '0'}};
    try {
        const points = buildDailyEquityChartPoints([
            {
                date: '2023-05-11',
                datetime: '2023-05-10 00:50:40',
                aggregate_holdings: {},
                aggregate_running_cash: 100,
                aggregate_display_cash: 100,
            },
            {
                date: '2023-05-10',
                datetime: '2023-05-10 00:53:48',
                aggregate_holdings: {SPYM: 400},
                aggregate_running_cash: 0,
                aggregate_display_cash: 0,
            },
        ], {
            SPYM: {'2023-05-10': 48.54},
        }, new Set());
        assert.equal(points.find((point) => point.date === '2023-05-10')?.aggregate_total_equity, 19416);
        assert.equal(points.find((point) => point.date === '2023-05-11')?.aggregate_total_equity, 100);
    } finally {
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
    }
});

test('daily equity keeps the current account boundary on the final chart point', () => {
    const previousWindow = globalThis.window;
    globalThis.window = {WORTHWARD_INVESTMENT_DATA: {starting_cash: '0'}};
    try {
        const points = buildDailyEquityChartPoints([
            {
                date: '2026-08-06',
                aggregate_running_cash: 100,
                aggregate_display_cash: 100,
                aggregate_history_running_cash: 90,
                aggregate_history_display_cash: 90,
                aggregate_holdings: {},
            },
            {
                date: '2026-08-07',
                aggregate_running_cash: 130,
                aggregate_display_cash: 130,
                aggregate_history_running_cash: 160,
                aggregate_history_display_cash: 160,
                aggregate_holdings: {},
            },
        ], {}, new Set());
        assert.equal(points.find((point) => point.date === '2026-08-06')?.aggregate_total_equity, 90);
        assert.equal(points.find((point) => point.date === '2026-08-07')?.aggregate_total_equity, 130);
        assert.equal(points.find((point) => point.date === '2026-08-07')?.aggregate_current_total_equity, 130);
    } finally {
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
    }
});

test('daily price normalization rejects bad closes and deduplicates deterministically', () => {
    const firstPayload = normalizePriceHistoryPayload({
        'DIS.US': [
            {date: '2025-03-12', close: 0},
            {date: '2025-03-12', close: 101},
            {date: '2025-03-12', close: 100},
            {date: '2025-03-13', close: -1},
            {date: '2025-03-13', close: 102},
        ],
    });
    const shuffledPayload = normalizePriceHistoryPayload({
        'DIS.US': [
            {date: '2025-03-13', close: 102},
            {date: '2025-03-12', close: 100},
            {date: '2025-03-12', close: 101},
            {date: '2025-03-13', close: -1},
            {date: '2025-03-12', close: 0},
        ],
    });
    assert.deepEqual(firstPayload, shuffledPayload);
    assert.deepEqual(firstPayload, {
        DIS: {'2025-03-12': 100, '2025-03-13': 102},
        'DIS.US': {'2025-03-12': 100, '2025-03-13': 102},
    });
});

test('missing historical holdings fail closed instead of using transaction or last-known prices', () => {
    const previousWindow = globalThis.window;
    globalThis.window = {WORTHWARD_INVESTMENT_DATA: {starting_cash: '0'}};
    try {
        const incompleteLastKnownPoint = buildDailyEquityChartPoints([
            {
                date: '2025-03-12',
                aggregate_running_cash: 0,
                aggregate_display_cash: 0,
                aggregate_holdings: {DIS: 10},
                aggregate_last_known_ticker_prices: {DIS: 42},
            },
        ], {}, new Set());
        assert.equal(incompleteLastKnownPoint[1]?.aggregate_total_equity, null);
        assert.equal(incompleteLastKnownPoint[1]?.valuation_complete, false);
        assert.deepEqual(incompleteLastKnownPoint[1]?.missing_price_tickers, ['DIS']);
        assert.deepEqual(incompleteLastKnownPoint[1]?.degraded_price_tickers, []);

        const incompletePoint = buildDailyEquityChartPoints([
            {
                date: '2025-03-12',
                aggregate_running_cash: 0,
                aggregate_display_cash: 0,
                aggregate_holdings: {AMD: 10, SQQQ: 2},
            },
        ], {}, new Set());
        assert.equal(incompletePoint[1]?.aggregate_total_equity, null);
        assert.equal(incompletePoint[1]?.valuation_complete, false);
        assert.deepEqual(incompletePoint[1]?.missing_price_tickers, ['AMD', 'SQQQ']);
    } finally {
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
    }
});

test('Max equity gap diagnostics isolate a pre-coverage close from lineage and money-market resolution', () => {
    const previousWindow = globalThis.window;
    globalThis.window = {
        WORTHWARD_INVESTMENT_DATA: {
            starting_cash: '0',
            ticker_lineage: {'LEGACY.US': ['CANONICAL.US']},
            money_market_tickers: ['MMF'],
        },
    };
    try {
        const points = buildDailyEquityChartPoints(
            [
                {
                    date: '2024-01-02',
                    aggregate_running_cash: 0,
                    aggregate_display_cash: 0,
                    aggregate_holdings: {
                        AMD: 10,
                        'CANONICAL.US': 2,
                        MMF: 100,
                    },
                    aggregate_money_market_anchors: {MMF: 1.25},
                },
                {
                    date: '2024-01-03',
                    aggregate_running_cash: 0,
                    aggregate_display_cash: 0,
                    aggregate_holdings: {
                        AMD: 10,
                        'CANONICAL.US': 2,
                        MMF: 100,
                    },
                    aggregate_money_market_anchors: {MMF: 1.25},
                },
            ],
            normalizePriceHistoryPayload({
                AMD: [{date: '2024-01-03', close: 100}],
                'LEGACY.US': [
                    {date: '2024-01-01', close: 9.5},
                    {date: '2024-01-03', close: 10},
                ],
            }),
            new Set(['MMF']),
            {includeCalendarDays: true},
        );

        const nullDiagnostics = points
            .filter((point) => point.aggregate_total_equity === null)
            .map((point) => ({
                date: point.date,
                missing_price_tickers: point.missing_price_tickers,
            }));
        assert.deepEqual(nullDiagnostics, [
            {date: '2024-01-02', missing_price_tickers: ['AMD']},
        ]);
        assert.equal(
            points.find((point) => point.date === '2024-01-03')?.aggregate_total_equity,
            1_145,
        );
        assert.equal(
            points.find((point) => point.date === '2024-01-03')?.missing_price_tickers?.length,
            0,
        );
    } finally {
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
    }
});

test('historical bridge cash is cumulative and current endpoint remains unbridged', () => {
    const previousWindow = globalThis.window;
    globalThis.window = {WORTHWARD_INVESTMENT_DATA: {starting_cash: '0'}};
    try {
        const points = buildDailyEquityChartPoints([
            {
                date: '2026-06-21', aggregate_running_cash: 100, aggregate_display_cash: 100,
                aggregate_bridge_adjustment: -100, aggregate_holdings: {},
            },
            {
                date: '2026-06-22', aggregate_running_cash: 100, aggregate_display_cash: 100,
                aggregate_bridge_adjustment: 0, aggregate_holdings: {},
            },
        ], {}, new Set());
        assert.equal(points.find((point) => point.date === '2026-06-21')?.aggregate_total_equity, 0);
        assert.equal(points.find((point) => point.date === '2026-06-22')?.aggregate_total_equity, 100);
    } finally {
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
    }
});

test('daily curve is invariant to shuffled input when transaction identities are unchanged', () => {
    const previousWindow = globalThis.window;
    globalThis.window = {WORTHWARD_INVESTMENT_DATA: {starting_cash: '1000'}};
    try {
        const rows = [
            {date: '2025-03-12', datetime: '2025-03-12 09:00:00', source: {row_number: 1}, aggregate_running_cash: 900, aggregate_display_cash: 900, aggregate_holdings: {DIS: 1}},
            {date: '2025-03-13', datetime: '2025-03-13 09:00:00', source: {row_number: 2}, aggregate_running_cash: 950, aggregate_display_cash: 950, aggregate_holdings: {DIS: 1}},
            {date: '2025-03-14', datetime: '2025-03-14 09:00:00', source: {row_number: 3}, aggregate_running_cash: 900, aggregate_display_cash: 900, aggregate_holdings: {}},
        ];
        const prices = {DIS: {'2025-03-12': 100, '2025-03-13': 105, '2025-03-14': 106}};
        const ordered = buildDailyEquityChartPoints(rows, prices, new Set());
        const shuffled = buildDailyEquityChartPoints([rows[2], rows[0], rows[1]], prices, new Set());
        assert.deepEqual(shuffled, ordered);
    } finally {
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
    }
});

test('shared scoped-position aggregation keeps Holdings and chart semantics aligned', () => {
    const usdState = createPositionState('DRAM');
    usdState.shares = 10;
    usdState.totalCost = 500;
    usdState.realizedPnl = 12;
    usdState.lotScope = {currency: 'USD'};
    const hkdState = createPositionState('DRAM');
    hkdState.shares = 1;
    hkdState.totalCost = 780;
    hkdState.lotScope = {currency: 'HKD'};
    const aggregate = aggregateInvestmentScopedPositionStates(
        new Map([['usd', usdState], ['hkd', hkdState]]),
        'DRAM',
        () => 'USD',
    );
    assert.equal(aggregate.shares, 11);
    assert.equal(aggregate.totalCost, null);
    assert.equal(aggregate.averagePrice, null);
    assert.equal(aggregate.realizedPnl, 12);
    assert.deepEqual(aggregate.positionCurrencies, ['HKD', 'USD']);
    assert.equal(aggregate.hasMixedPositionCurrencies, true);
});

test('mixed-broker payloads select the authoritative broker-scoped HSBC position snapshot', () => {
    const previousWindow = globalThis.window;
    globalThis.window = {
        WORTHWARD_INVESTMENT_DATA: {
            ticker_lineage: {},
            summary: {position_snapshot_authoritative: false},
            broker_summaries: {
                hsbc: {
                    broker: 'hsbc',
                    account: '000-999999-999',
                    position_snapshot_authoritative: true,
                    position_snapshot_source: 'hsbc_portfolio_text',
                    position_snapshot: {
                        DRAM: {
                            quantity: '200',
                            cost_price: '60.9455',
                            market_value: '10980.00',
                            last_price: '54.890',
                        },
                    },
                    holdings_validation: {matched: false, mismatch_count: 1},
                },
            },
        },
    };
    try {
        const transactions = [{
            broker: 'hsbc',
            account: '000-999999-999',
            ticker: 'DRAM',
            type: 'sell',
            date: '2026-08-04',
            source: {broker: 'hsbc', account: '000-999999-999'},
        }];
        const snapshot = getAuthoritativePositionSnapshotForTransactions(transactions);
        assert.equal(snapshot.DRAM.quantity, 200);
        assert.equal(snapshot.DRAM.marketValue, 10980);
    } finally {
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
    }
});

test('historical summaries reject current authoritative position snapshots', () => {
    const previousWindow = globalThis.window;
    globalThis.window = {
        WORTHWARD_INVESTMENT_DATA: {
            ticker_lineage: {},
            money_market_tickers: [],
            summary: {
                position_snapshot_authoritative: false,
                performance_snapshot_authoritative: false,
            },
            broker_summaries: {
                ibkr: {
                    broker: 'ibkr',
                    account: 'U1',
                    position_snapshot_authoritative: true,
                    position_snapshot: {
                        QQQ: {
                            quantity: '10',
                            cost_price: '100',
                            cost_basis_status: 'known',
                            market_value: '1000',
                            last_price: '100',
                        },
                    },
                },
            },
        },
    };
    try {
        const transactions = [{
            broker: 'ibkr',
            account: 'U1',
            type: 'buy',
            ticker: 'QQQ',
            currency: 'USD',
            date: '2026-08-04',
            datetime: '2026-08-04 12:00:00',
            quantity_abs: '1',
            quantity_raw: '1',
            price_raw: '100',
            normalized: {
                position_quantity: '1',
                unit_price: '100',
                net_amount: '-100',
            },
            source: {file_kind: 'test_fixture'},
        }];
        const currentSummary = buildTickerSummaries(
            transactions,
            {QQQ: 120},
            120,
            {},
        )[0];
        const historicalSummary = buildTickerSummaries(
            transactions,
            {QQQ: 120},
            120,
            {},
            {
                useAuthoritativePositionSnapshot: false,
                useAuthoritativePerformanceSnapshot: false,
                valuationDate: '2026-08-04',
            },
        )[0];

        assert.equal(currentSummary.shares, 10);
        assert.equal(currentSummary.unrealizedPnl, 0);
        assert.equal(historicalSummary.shares, 1);
        assert.equal(historicalSummary.unrealizedPnl, 20);
    } finally {
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
    }
});

test('Futu internal-transfer overlays preserve signed broker cash while neutralizing aggregate funding', () => {
    assert.equal(
        getInvestmentInternalTransferAggregateBridgeDelta({
            internal_transfer_external_flow_excluded: true,
            normalized: {net_amount: '1271.50'},
        }),
        -1271.5,
    );
    assert.equal(
        getInvestmentInternalTransferAggregateBridgeDelta({
            internal_transfer_external_flow_excluded: true,
            normalized: {net_amount: '-100.00'},
        }),
        100,
    );
    assert.equal(
        getInvestmentInternalTransferAggregateBridgeDelta({
            normalized: {net_amount: '1271.50'},
        }),
        0,
    );
    const fxTimeline = {
        baseCurrency: 'USD',
        ratesByCurrency: {
            HKD: {
                dates: ['2023-02-15'],
                values: {'2023-02-15': 7.849650},
            },
        },
    };
    const hkdTransfer = {
        date: '2023-02-15',
        currency: 'HKD',
        normalized: {net_amount: '10000.00'},
        internal_transfer_external_flow_excluded: true,
    };
    assert.ok(Math.abs(
        getInvestmentInternalTransferAggregateBridgeAmount(
            10000,
            hkdTransfer,
            fxTimeline,
            'USD',
        ) - 1273.9421502869554,
    ) < 1e-9);
    assert.ok(Math.abs(
        getInvestmentInternalTransferAggregateBridgeDelta(
            hkdTransfer,
            fxTimeline,
            'USD',
        ) + 1273.9421502869554,
    ) < 1e-9);
});

test('daily equity charts omit marked Futu internal transfers from external-flow points', () => {
    const previousWindow = globalThis.window;
    globalThis.window = {WORTHWARD_INVESTMENT_DATA: {}};
    try {
        const points = buildDailyEquityChartPoints([
            {
                date: '2023-02-16',
                type: 'deposit',
                currency: 'USD',
                normalized: {net_amount: '1271.50'},
                internal_transfer_external_flow_excluded: true,
                aggregate_running_cash: 0,
                aggregate_display_cash: 0,
                aggregate_holdings: {},
                aggregate_money_market_anchors: {},
            },
        ], {}, new Set());
        const point = points.find((entry) => entry.date === '2023-02-16');
        assert.ok(point);
        assert.equal(point.cash_in_amount, 0);
        assert.equal(point.net_transfer_amount, 0);
        assert.equal(point.cumulative_net_transfer_amount, 0);
    } finally {
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
    }
});

test('long-range daily equity charts fill calendar days and carry weekend cash changes', () => {
    const previousWindow = globalThis.window;
    globalThis.window = {
        WORTHWARD_INVESTMENT_DATA: {
            starting_cash: '0.00',
            ticker_lineage: {},
            money_market_tickers: [],
        },
    };
    try {
        const transactions = [
            {
                ledger_no: 1,
                date: '2024-01-04',
                type: 'buy',
                ticker: 'ABC',
                currency: 'USD',
                quantity: 1,
                price: 100,
                normalized: {net_amount: '-100.00'},
                aggregate_running_cash: 0,
                aggregate_display_cash: 0,
                aggregate_holdings: {ABC: 1},
            },
            {
                ledger_no: 2,
                date: '2024-01-06',
                type: 'deposit',
                currency: 'USD',
                normalized: {net_amount: '10.00'},
                aggregate_running_cash: 10,
                aggregate_display_cash: 10,
                aggregate_holdings: {ABC: 1},
            },
            {
                ledger_no: 3,
                date: '2024-01-08',
                type: 'adjustment',
                currency: 'USD',
                normalized: {net_amount: '0.00'},
                aggregate_running_cash: 10,
                aggregate_display_cash: 10,
                aggregate_holdings: {ABC: 1},
            },
        ];
        const prices = normalizePriceHistoryPayload({
            ABC: [
                {date: '2024-01-05', close: 100},
                {date: '2024-01-08', close: 110},
            ],
        });
        const sparsePoints = buildDailyEquityChartPoints(transactions, prices, new Set());
        const calendarPoints = buildDailyEquityChartPoints(
            transactions,
            prices,
            new Set(),
            {includeCalendarDays: true},
        );
        const pointByDate = Object.fromEntries(calendarPoints.map((point) => [point.date, point]));

        assert.equal(sparsePoints.some((point) => point.date === '2024-01-07'), false);
        assert.deepEqual(
            calendarPoints.map((point) => point.date),
            ['2024-01-03', '2024-01-04', '2024-01-05', '2024-01-06', '2024-01-07', '2024-01-08'],
        );
        assert.equal(pointByDate['2024-01-05'].is_trading_day, true);
        assert.equal(pointByDate['2024-01-06'].is_trading_day, false);
        assert.equal(pointByDate['2024-01-07'].is_trading_day, false);
        assert.equal(pointByDate['2024-01-06'].is_calendar_carry_forward, false);
        assert.equal(pointByDate['2024-01-07'].is_calendar_carry_forward, true);
        assert.equal(pointByDate['2024-01-06'].cash_in_amount, 10);
        assert.equal(pointByDate['2024-01-06'].aggregate_total_equity, 110);
        assert.equal(pointByDate['2024-01-07'].aggregate_total_equity, 110);
        assert.equal(pointByDate['2024-01-07'].previous_trading_point_index, 2);
        assert.equal(pointByDate['2024-01-08'].aggregate_total_equity, 120);
    } finally {
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
    }
});

test('Schwab authoritative snapshots retain unknown basis and reported close prices without fabricating P&L', () => {
    const previousWindow = globalThis.window;
    globalThis.window = {
        WORTHWARD_INVESTMENT_DATA: {
            ticker_lineage: {},
            money_market_tickers: [],
            summary: {
                position_snapshot_authoritative: true,
                performance_snapshot_authoritative: false,
            },
            position_snapshot: {
                QQQI: {
                    quantity: '15',
                    cost_price: '',
                    cost_basis: '',
                    cost_basis_status: 'unknown',
                    last_price: '',
                    close_price: '53.89',
                    value: '808.35',
                },
                PART: {
                    quantity: '2',
                    cost_price: '50.00',
                    cost_basis_status: 'partial',
                    close_price: '55.00',
                    value: '110.00',
                },
                KNOWN: {
                    quantity: '1',
                    cost_price: '0',
                    cost_basis_status: 'known',
                    close_price: '2.00',
                    value: '2.00',
                },
            },
        },
    };
    try {
        const snapshot = getAuthoritativePositionSnapshot();
        assert.deepEqual(snapshot.QQQI, {
            quantity: 15,
            costBasisStatus: 'unknown',
            costPrice: null,
            marketValue: 808.35,
            lastPrice: 53.89,
        });
        assert.equal(snapshot.PART.costBasisStatus, 'partial');
        assert.equal(snapshot.PART.costPrice, null);
        assert.equal(snapshot.KNOWN.costBasisStatus, 'known');
        assert.equal(snapshot.KNOWN.costPrice, 0);
        assert.equal(snapshot.KNOWN.lastPrice, 2);

        const qqqiBuy = makeImportedTrade({
            type: 'buy', date: '2026-07-29', quantity: 1, price: 50,
        });
        qqqiBuy.ticker = 'QQQI';
        qqqiBuy.broker = 'ibkr';
        qqqiBuy.account = 'U00000003';
        const qqqiSell = makeImportedTrade({
            type: 'sell', date: '2026-07-30', quantity: 1, price: 60,
        });
        qqqiSell.ticker = 'QQQI';
        qqqiSell.broker = 'ibkr';
        qqqiSell.account = 'U00000003';
        const summaries = buildTickerSummaries([qqqiBuy, qqqiSell], {}, 920.35, {});
        const qqqi = summaries.find((summary) => summary.ticker === 'QQQI');
        const partial = summaries.find((summary) => summary.ticker === 'PART');
        const known = summaries.find((summary) => summary.ticker === 'KNOWN');

        for (const summary of [qqqi, partial]) {
            assert.ok(summary);
            assert.equal(summary.totalCost, null);
            assert.equal(summary.averagePrice, null);
            assert.equal(summary.realizedPnl, null);
            assert.equal(summary.realizedPnlLocal, null);
            assert.equal(summary.unrealizedPnl, null);
            assert.equal(summary.unrealizedPnlLocal, null);
            assert.equal(summary.totalPnl, null);
            assert.equal(summary.totalPnlLocal, null);
            assert.equal(summary.realizedPnlStatus, 'unavailable');
            assert.equal(summary.unrealizedPnlStatus, 'unavailable');
            assert.equal(summary.pnlUnavailable, true);
        }
        assert.equal(qqqi.lastPrice, 53.89);
        assert.equal(qqqi.marketValue, 808.35);
        assert.equal(qqqi.realizedPnlAccounts.length, 1);
        assert.equal(qqqi.realizedPnlAccounts[0].realizedPnl, null);
        assert.equal(qqqi.realizedPnlAccounts[0].realizedPnlLocal, null);
        assert.equal(qqqi.realizedPnlAccounts[0].status, 'unavailable');
        assert.equal(
            qqqi.pnlUnavailableReason,
            'authoritative_position_snapshot_cost_basis_unknown',
        );
        assert.equal(
            partial.pnlUnavailableReason,
            'authoritative_position_snapshot_cost_basis_partial',
        );
        assert.equal(known.pnlUnavailable, false);
        assert.equal(known.averagePrice, 0);
        assert.equal(known.unrealizedPnl, 2);
        assert.equal(known.totalPnl, 2);
    } finally {
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
    }
});

test('FIFO reconstructed transfer basis restores Holdings P&L over an unknown Schwab snapshot', () => {
    const previousWindow = globalThis.window;
    globalThis.window = {
        WORTHWARD_INVESTMENT_DATA: {
            ticker_lineage: {},
            money_market_tickers: [],
            summary: {
                position_snapshot_authoritative: true,
                performance_snapshot_authoritative: false,
            },
            position_snapshot: {
                QQQI: {
                    quantity: '5',
                    cost_price: '',
                    cost_basis_status: 'unknown',
                    value: '400',
                    close_price: '80',
                },
            },
            broker_summaries: {},
        },
    };
    const transactions = [
        {
            broker: 'ibkr', account: 'U***001', ticker: 'QQQI', currency: 'USD',
            type: 'buy', date: '2026-07-01', datetime: '2026-07-01 12:00:00',
            quantity_raw: '3', quantity_abs: '3',
            normalized: {display_quantity: '3', net_amount: '-30.09'},
            source: {file_kind: 'ibkr_csv', row_number: 1},
        },
        {
            broker: 'ibkr', account: 'U***001', ticker: 'QQQI', currency: 'USD',
            type: 'buy', date: '2026-07-10', datetime: '2026-07-10 12:00:00',
            quantity_raw: '2', quantity_abs: '2',
            normalized: {display_quantity: '2', net_amount: '-40.06'},
            source: {file_kind: 'ibkr_csv', row_number: 2},
        },
        {
            broker: 'ibkr', account: 'U***001', ticker: 'QQQI', currency: 'USD',
            type: 'transfer_out', date: '2026-07-31', datetime: '2026-07-31 12:00:00',
            quantity_raw: '5', quantity_abs: '5',
            transfer_out_cost_basis_raw: '70.15',
            transfer_out_cost_basis_status: 'known',
            transfer_out_cost_basis_method_label: 'FIFO reconstructed',
            source: {file_kind: 'ibkr_csv', row_number: 3},
        },
        {
            broker: 'schwab', account: 'Individual ...001', ticker: 'QQQI', currency: 'USD',
            type: 'transfer_in', date: '2026-07-31', datetime: '2026-07-31 12:00:00',
            quantity_raw: '5', quantity_abs: '5',
            carried_cost_basis_raw: '70.15',
            carried_cost_basis_status: 'known',
            carried_cost_basis_method_label: 'FIFO reconstructed',
            source: {file_kind: 'schwab_transactions_csv', row_number: 4},
        },
    ];
    try {
        const summary = buildTickerSummaries(transactions, {QQQI: 80}, 400, {})[0];
        assert.equal(summary.shares, 5);
        assert.equal(summary.totalCost, 70.15);
        assert.ok(Math.abs(summary.averagePrice - 14.03) < 1e-9);
        assert.equal(summary.costBasisStatus, 'known');
        assert.equal(summary.costBasisMethod, 'FIFO reconstructed');
        assert.equal(summary.pnlUnavailable, false);
        assert.ok(Math.abs(summary.unrealizedPnl - 329.85) < 1e-9);
    } finally {
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
    }
});

test('HSBC cash snapshots preserve USD, HKD, and CNH balances', () => {
    const previousWindow = globalThis.window;
    globalThis.window = {
        WORTHWARD_INVESTMENT_DATA: {
            starting_cash: '99.00',
            starting_cash_by_currency: {USD: '10.00', HKD: '46.10', CNH: '12.00', ZERO: '0'},
            ending_cash: '2.00',
            ending_cash_by_currency: {USD: '2.00', HKD: '46.10', CNH: '12.00'},
            ending_cash_base_currency: '10.50',
            broker_summaries: {
                hsbc: {
                    ending_cash: '2.00',
                    ending_cash_by_currency: {USD: '2.00', HKD: '46.10', CNH: '12.00'},
                    ending_cash_base_currency: '10.50',
                    ending_cash_base_currency_as_of: '2026-08-07',
                },
            },
        },
    };
    try {
        assert.deepEqual(getInvestmentStartingCashBalances(), {USD: 10, HKD: 46.1, CNH: 12});
        assert.deepEqual(getInvestmentEndingCashBalances(), {USD: 2, HKD: 46.1, CNH: 12});
        assert.equal(getInvestmentEndingCashInBaseCurrency(), 10.5);
        assert.deepEqual(getInvestmentBrokerEndingCashBalances('HSBC'), {USD: 2, HKD: 46.1, CNH: 12});
        assert.equal(getInvestmentBrokerEndingCashInBaseCurrency('hsbc'), 10.5);
        assert.equal(getInvestmentBrokerEndingCashAsOf('hsbc'), '2026-08-07');
        assert.deepEqual(
            createCashLedgerFromBalances({USD: '2.00', HKD: '46.10', CNH: '12.00'}),
            {USD: 2, HKD: 46.1, CNH: 12},
        );
    } finally {
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
    }
});

test('dated cash snapshots anchor replay without erasing later IBKR trades', () => {
    const rows = [
        {
            date: '2026-08-07',
            broker_running_cash: 400,
            broker_cash_by_currency: {USD: 400},
        },
        {
            date: '2026-08-10',
            broker_running_cash: 249.65,
            broker_cash_by_currency: {USD: 249.65},
        },
    ];
    const projection = buildDatedCashSnapshotProjection(rows, {
        asOf: '2026-08-07',
        authoritativeBaseCash: 420.38156702,
        authoritativeBalances: {USD: 420.38156702},
    });

    assert.equal(projection.applied, true);
    assert.ok(Math.abs(projection.projections[0].runningCash - 420.38156702) < 1e-9);
    assert.ok(Math.abs(projection.projections[1].runningCash - 270.03156702) < 1e-9);
    assert.ok(Math.abs(projection.projections[1].balances.USD - 270.03156702) < 1e-9);
});

test('current broker cash rolls a dated snapshot forward through a later withdrawal', () => {
    const previousWindow = globalThis.window;
    globalThis.window = {
        WORTHWARD_INVESTMENT_DATA: {
            broker_summaries: {
                ibkr: {
                    ending_cash: '40.25',
                    ending_cash_as_of: '2026-03-02',
                    ending_cash_as_of_datetime: '2026-03-02 10:00:00',
                    cash_snapshot_authoritative: true,
                },
            },
        },
    };
    try {
        const rows = [
            {date: '2026-03-02', datetime: '2026-03-02 09:00:00', broker_running_cash: 38, broker_cash_by_currency: {USD: 38}},
            {date: '2026-03-02', datetime: '2026-03-02 18:00:00', broker_running_cash: -2.25, broker_cash_by_currency: {USD: -2.25}},
        ];
        const authoritativeBalances = getInvestmentBrokerEndingCashBalances('ibkr');
        const projection = buildDatedCashSnapshotProjection(rows, {
            asOf: getInvestmentBrokerEndingCashAsOf('ibkr'),
            asOfDateTime: getInvestmentBrokerEndingCashAsOfDateTime('ibkr'),
            authoritativeBaseCash: 40.25,
            authoritativeBalances,
        });
        assert.deepEqual(
            projection.projections.map(({index, afterSnapshot}) => ({index, afterSnapshot})),
            [{index: 1, afterSnapshot: true}],
        );
        const latest = projection.projections[0];
        assert.ok(Math.abs(latest.runningCash) < 1e-9);
        const delta = buildInvestmentPostSnapshotCashDelta(latest.balances, authoritativeBalances);
        assert.ok(Math.abs(delta.USD + 40.25) < 1e-9);

        const staleSnapshot = getInvestmentBrokerCurrentCashSnapshot('ibkr', '2026-03-03', {});
        assert.equal(staleSnapshot.displayCash, 40.25);
        const rolledSnapshot = getInvestmentBrokerCurrentCashSnapshot(
            'ibkr',
            '2026-03-03',
            {},
            {postSnapshotCashDelta: delta},
        );
        assert.ok(Math.abs(rolledSnapshot.runningCash) < 1e-9);
        assert.ok(Math.abs(rolledSnapshot.displayCash) < 1e-9);
        assert.deepEqual(rolledSnapshot.runningBalances, {});
    } finally {
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
    }
});

test('intraday cash boundaries leave earlier same-day IBKR rows unchanged', () => {
    const rows = [
        {
            date: '2026-08-12',
            datetime: '2026-08-12 20:20:00',
            broker_running_cash: 312.45,
            broker_cash_by_currency: {USD: 312.45},
        },
        {
            date: '2026-08-12',
            datetime: '2026-08-12 21:56:00',
            broker_running_cash: 845.68250076,
            broker_cash_by_currency: {USD: 845.68250076},
        },
    ];
    const projection = buildDatedCashSnapshotProjection(rows, {
        asOf: '2026-08-12',
        asOfDateTime: '2026-08-12 21:56:00',
        authoritativeBaseCash: 845.67,
        authoritativeBalances: {USD: 845.67},
        getRowDateTime: (row) => row.datetime,
    });

    assert.equal(projection.applied, true);
    assert.deepEqual(
        projection.projections.map(({index, runningCash}) => ({index, runningCash})),
        [{index: 1, runningCash: 845.67}],
    );
});

test('a later authoritative cash boundary supersedes an older snapshot correction', () => {
    const rows = [
        {date: '2026-08-06', broker_running_cash: 400, broker_cash_by_currency: {USD: 400}},
        {date: '2026-08-07', broker_running_cash: 300, broker_cash_by_currency: {USD: 300}},
        {date: '2026-08-08', broker_running_cash: 500, broker_cash_by_currency: {USD: 500}, boundary: true},
    ];
    const projection = buildDatedCashSnapshotProjection(rows, {
        asOf: '2026-08-06',
        authoritativeBaseCash: 420,
        authoritativeBalances: {USD: 420},
        getBoundaryCurrencies: (row) => row.boundary ? ['USD'] : [],
    });

    assert.deepEqual(
        projection.projections.map(({runningCash}) => runningCash),
        [420, 320, 500],
    );
    assert.equal(projection.projections[2].balances.USD, 500);
});

test('authoritative negative cash remains signed through dated replay', () => {
    const projection = buildDatedCashSnapshotProjection([
        {date: '2026-08-07', broker_running_cash: 100, broker_cash_by_currency: {USD: 100}},
        {date: '2026-08-08', broker_running_cash: 90, broker_cash_by_currency: {USD: 90}},
    ], {
        asOf: '2026-08-07',
        authoritativeBaseCash: -5,
        authoritativeBalances: {USD: -5},
    });

    assert.deepEqual(
        projection.projections.map(({runningCash}) => runningCash),
        [-5, -15],
    );
    assert.equal(projection.projections[1].balances.USD, -15);
});

test('cash and position snapshots retain independent as-of dates', () => {
    const previousWindow = globalThis.window;
    globalThis.window = {
        WORTHWARD_INVESTMENT_DATA: {
            broker_summaries: {
                ibkr: {
                    ending_cash_base_currency_as_of: '2026-08-06',
                    position_snapshot_as_of: '2026-08-07',
                },
            },
        },
    };
    try {
        assert.equal(getInvestmentBrokerEndingCashAsOf('ibkr'), '2026-08-06');
        assert.equal(getInvestmentBrokerPositionSnapshotAsOf('ibkr'), '2026-08-07');
    } finally {
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
    }
});

test('IBKR cash replay prefers the last transaction date over the later report date', () => {
    const previousWindow = globalThis.window;
    globalThis.window = {
        WORTHWARD_INVESTMENT_DATA: {
            broker_summaries: {
                ibkr: {
                    ending_cash_as_of: '2026-08-11',
                    ending_cash_replay_as_of: '2026-08-10',
                    ending_cash_replay_as_of_datetime: '2026-08-10 18:30:00',
                    position_snapshot_as_of: '2026-08-11',
                },
            },
        },
    };
    try {
        assert.equal(getInvestmentBrokerEndingCashAsOf('ibkr'), '2026-08-10');
        assert.equal(
            getInvestmentBrokerEndingCashAsOfDateTime('ibkr'),
            '2026-08-10 18:30:00',
        );
    } finally {
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
    }
});

test('dated position snapshots project later buys into current holdings and cost', () => {
    const snapshot = {
        DRAM: {
            quantity: 102,
            costBasisStatus: 'known',
            costPrice: 49,
            marketValue: 5100,
            lastPrice: 50,
        },
    };
    const projected = projectAuthoritativePositionSnapshot(snapshot, [{
        broker: 'ibkr',
        account: 'U00000001',
        type: 'buy',
        ticker: 'DRAM',
        date: '2026-08-10',
        quantity_abs: '3',
        normalized: {
            position_quantity: '3',
            unit_price: '50',
            net_amount: '-150.35',
            commission: '-0.35',
        },
    }], '2026-08-07');

    assert.equal(projected.DRAM.quantity, 105);
    assert.ok(Math.abs(projected.DRAM.costPrice - ((102 * 49 + 150.35) / 105)) < 1e-9);
    assert.equal(projected.DRAM.marketValue, null);
    assert.equal(projected.DRAM.lastPrice, null);
});

test('dated position snapshots retain IBKR grants at zero cost', () => {
    const snapshot = {
        IBKR: {
            quantity: 1,
            costBasisStatus: 'known',
            costPrice: 84.25,
            marketValue: 84.25,
            lastPrice: 84.25,
        },
    };
    const projected = projectAuthoritativePositionSnapshot(snapshot, [{
        broker: 'ibkr',
        account: 'U00000001',
        type: 'grant',
        ticker: 'IBKR',
        date: '2026-01-30',
        quantity_abs: '3.25',
        price_raw: '64.25',
        normalized: {
            position_quantity: '3.25',
            unit_price: '64.25',
            net_amount: '0',
        },
    }], '2026-01-29');

    assert.equal(projected.IBKR.quantity, 4.25);
    assert.ok(Math.abs(projected.IBKR.costPrice - (84.25 / 4.25)) < 1e-9);
    assert.equal(projected.IBKR.marketValue, null);
    assert.equal(projected.IBKR.lastPrice, null);
});

test('Holdings and the daily equity endpoint share the projected post-snapshot position', () => {
    const previousWindow = globalThis.window;
    globalThis.window = {
        WORTHWARD_INVESTMENT_DATA: {
            starting_cash: '0',
            ticker_lineage: {},
            money_market_tickers: [],
            summary: {position_snapshot_authoritative: false, performance_snapshot_authoritative: false},
            broker_summaries: {
                ibkr: {
                    broker: 'ibkr',
                    account: 'U00000001',
                    position_snapshot_authoritative: true,
                    position_snapshot_as_of: '2026-08-07',
                    position_snapshot: {
                        DRAM: {
                            quantity: '102',
                            cost_basis_status: 'known',
                            cost_price: '49',
                            market_value: '5100',
                            last_price: '50',
                        },
                    },
                },
            },
        },
    };
    const buy = {
        broker: 'ibkr',
        account: 'U00000001',
        type: 'buy',
        ticker: 'DRAM',
        currency: 'USD',
        date: '2026-08-10',
        datetime: '2026-08-10 00:57:00',
        quantity_abs: '3',
        normalized: {
            position_quantity: '3',
            unit_price: '50',
            net_amount: '-150.35',
            commission: '-0.35',
        },
    };
    try {
        const holdings = buildTickerSummaries([buy], {DRAM: 50}, 5520.03156702, {
            DRAM: {'2026-08-10': 50},
        });
        assert.equal(holdings[0].shares, 105);
        assert.equal(holdings[0].marketValue, 5250);

        const points = buildDailyEquityChartPoints([{
            ...buy,
            ledger_no: 1,
            aggregate_running_cash: 270.03156702,
            aggregate_display_cash: 270.03156702,
            aggregate_holdings: {DRAM: 105},
        }], {DRAM: {'2026-08-10': 50}}, new Set());
        const endpoint = points.find((point) => point.date === '2026-08-10');
        assert.ok(Math.abs(endpoint.aggregate_total_equity - 5520.03156702) < 1e-9);
        assert.ok(Math.abs(
            endpoint.aggregate_total_equity
            - (270.03156702 + holdings[0].marketValue),
        ) < 1e-9);
    } finally {
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
    }
});

test('HSBC cash boundaries clear stale unscoped replay without merging subaccounts', () => {
    const savingsRow = {
        broker: 'hsbc',
        account: '000-999999-999',
        account_type: 'HKD Savings',
        date: '2026-09-21',
        type: 'deposit',
        currency: 'HKD',
        net_amount_raw: '89.24',
        normalized: {net_amount: '89.24'},
        source: {
            account_type: 'HKD Savings',
            balance_after_raw: '89.24',
            cash_balance_authoritative: false,
            cash_balance_scope: 'account',
            file_kind: 'hsbc_multi_currency_cash_account_text',
            ledger_sequence: 1,
            row_number: 1,
            source_sequence_sha256: HSBC_SEQUENCE_SHA_A,
        },
    };
    const currentRow = {
        ...savingsRow,
        account_type: 'HKD Current',
        net_amount_raw: '1',
        normalized: {net_amount: '1'},
        source: {
            ...savingsRow.source,
            account_type: 'HKD Current',
            balance_after_raw: '0.00',
            ledger_sequence: 2,
            row_number: 2,
        },
    };
    const legacyUsdRow = {
        ...savingsRow,
        account_type: 'Foreign Currency Savings USD',
        currency: 'USD',
        net_amount_raw: '1',
        normalized: {net_amount: '1'},
        source: {
            ...savingsRow.source,
            account_type: 'Foreign Currency Savings USD',
            balance_after_raw: '0.00',
            file_kind: 'hsbc_statement_cash',
            ledger_sequence: 3,
            row_number: 3,
        },
    };
    const usdSavingsRow = {
        ...legacyUsdRow,
        account_type: 'USD Savings',
        source: {
            ...legacyUsdRow.source,
            account_type: 'USD Savings',
            balance_after_raw: '21108.38',
            cash_balance_authoritative: true,
            file_kind: 'hsbc_usd_account_text',
            ledger_sequence: 4,
            row_number: 4,
        },
    };
    assert.notEqual(
        getInvestmentCashBalanceScope(savingsRow),
        getInvestmentCashBalanceScope(currentRow),
    );
    assert.deepEqual(getInvestmentCashBalanceBoundary(savingsRow), {
        scopeKey: 'HSBC|000-999999-999|SAVINGS|HKD',
        currency: 'HKD',
        balance: 89.24,
    });
    assert.equal(
        getInvestmentCashBalanceBoundary({
            ...usdSavingsRow,
            source: {...usdSavingsRow.source, balance_after_raw: ''},
        }),
        null,
    );
    for (const [label, mutate] of [
        ['unknown kind', (row) => {
            row.source.file_kind = 'fabricated_cash';
        }],
        ['USD Current', (row) => {
            row.account_type = 'USD Current';
            row.source.account_type = 'USD Current';
        }],
        ['missing account type', (row) => {
            delete row.account_type;
            delete row.source.account_type;
        }],
        ['wrong authority flag', (row) => {
            row.source.cash_balance_authoritative = false;
        }],
        ['wrong balance scope', (row) => {
            row.source.cash_balance_scope = 'portfolio';
        }],
        ['missing ledger sequence', (row) => {
            delete row.source.ledger_sequence;
        }],
        ['unknown type', (row) => {
            row.type = 'mystery';
        }],
        ['negative deposit', (row) => {
            row.net_amount_raw = '-1';
            row.normalized.net_amount = '-1';
        }],
        ['zero amount', (row) => {
            row.net_amount_raw = '0';
            row.normalized.net_amount = '0';
        }],
    ]) {
        const invalidRow = structuredClone(usdSavingsRow);
        mutate(invalidRow);
        assert.equal(getInvestmentCashBalanceBoundary(invalidRow), null, label);
    }

    const ledger = createInvestmentCashScopeLedger({HKD: 27_462.16});
    setInvestmentCashScopeBoundary(ledger, getInvestmentCashBalanceBoundary(savingsRow));
    setInvestmentCashScopeBoundary(ledger, getInvestmentCashBalanceBoundary(currentRow));
    setInvestmentCashScopeBoundary(ledger, getInvestmentCashBalanceBoundary(legacyUsdRow));
    addInvestmentCashScopeDelta(ledger, 'USD', -24_373.75);
    setInvestmentCashScopeBoundary(ledger, getInvestmentCashBalanceBoundary(usdSavingsRow));
    addInvestmentCashScopeDelta(ledger, 'USD', 3);
    assert.deepEqual(getInvestmentCashScopeBalances(ledger), {
        USD: 21_111.38,
        HKD: 89.24,
    });
});

test('empty multi-currency snapshots fall back to the legacy base-currency scalar', () => {
    const previousWindow = globalThis.window;
    globalThis.window = {
        WORTHWARD_INVESTMENT_DATA: {
            starting_cash: '99.00',
            starting_cash_by_currency: {},
            ending_cash: '2.00',
            ending_cash_by_currency: {},
            broker_summaries: {
                hsbc: {
                    ending_cash: '2.00',
                    ending_cash_by_currency: {},
                },
            },
        },
    };
    try {
        assert.deepEqual(getInvestmentStartingCashBalances(), {USD: 99});
        assert.deepEqual(getInvestmentEndingCashBalances(), {USD: 2});
        assert.deepEqual(getInvestmentBrokerEndingCashBalances('hsbc'), {USD: 2});
        assert.deepEqual(createCashLedgerFromBalances({}, '2.00'), {USD: 2});
    } finally {
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
    }
});

test('ledger price fallback stays silent when valuation remains complete', () => {
    const status = buildValuationStatus({
        fallbackTickers: ['DRAM'],
        openTickers: ['DRAM'],
    });

    assert.equal(status.isDegraded, false);
    assert.equal(status.message, '');
    assert.deepEqual(status.fallbackTickers, ['DRAM']);
});
