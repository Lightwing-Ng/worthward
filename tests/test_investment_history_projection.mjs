/* Investment history-projection regressions. Code version: v1.3.6 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    createInvestmentHistoryProjectionRuntime,
} from '../app/web/static/assets/js/investment/runtime/history-projection.js';
import {
    normalizeInvestmentAuthoritativeCashBoundaryAmount,
    resolveInvestmentEvidenceSafeCashDelta,
} from '../app/web/static/assets/js/investment/runtime/transaction-table.js';
import {
    createInvestmentExportHistoryRuntime,
} from '../app/web/static/assets/js/investment/runtime/export-history.js';

const USD_SAVINGS_SCOPE = 'HSBC|HSBC-TEST|SAVINGS|USD';
const OTHER_USD_SCOPE = 'HSBC|HSBC-TEST|CURRENT|USD';
const HKD_SAVINGS_SCOPE = 'HSBC|HSBC-TEST|SAVINGS|HKD';
const HSBC_SEQUENCE_SHA_A = 'a'.repeat(64);
const HSBC_SEQUENCE_SHA_B = 'b'.repeat(64);

test('HSBC cash metrics do not repeat the pending-order asterisk', () => {
    const runtime = createInvestmentExportHistoryRuntime({
        formatAmount: (value) => Number(value).toFixed(2),
        formatHoldingsMoney: (value) => Number(value).toFixed(2),
        getOptionalInvestmentNumber: (value) => (
            Number.isFinite(Number(value)) ? Number(value) : null
        ),
    });

    assert.equal(runtime.formatInvestmentHistoryCashProjection(120.75, true), '120.75');
    assert.equal(runtime.formatInvestmentHistoryCashProjection(-120.75, true), '-120.75');
    assert.equal(runtime.formatInvestmentCurrentCash(120.75, true), '120.75');
    assert.equal(runtime.formatInvestmentCurrentCash(-120.75, true), '-120.75');
});

test('HSBC authoritative cash boundaries preserve verified negative balances', () => {
    assert.equal(normalizeInvestmentAuthoritativeCashBoundaryAmount('-88.250'), -88.25);
    assert.equal(normalizeInvestmentAuthoritativeCashBoundaryAmount('not-cash'), null);
    assert.equal(resolveInvestmentEvidenceSafeCashDelta(20), 20);
    assert.equal(resolveInvestmentEvidenceSafeCashDelta(20, {
        hasPhysicalEvidenceConflict: true,
    }), 0);
});

function createHistoryProjection() {
    const convertAmountToBaseCurrency = (amount, currency) => (
        String(currency || '').toUpperCase() === 'HKD'
            ? Number(amount) / 10
            : Number(amount)
    );
    const runtime = {
        normalizeInvestmentBroker: (value) => String(value || '').trim().toLowerCase(),
        getTransactionBrokerCode: (txn) => txn?.broker || '',
        getNormalizedTransactionType: (txn) => txn?.type || '',
        getTransactionAmount: (txn) => Number(
            txn?.normalized?.net_amount ?? txn?.net_amount_raw,
        ),
        normalizeLedgerDate: (value) => String(value || '').slice(0, 10),
        isHsbcSettlementActuallyPending: () => false,
        formatTransactionCurrency: (txn) => txn?.currency || '',
        getTickerQuoteCurrency: () => '',
        getInvestmentBrokerEndingCashInBaseCurrency: () => null,
        getInvestmentCashBalanceScope: (txn) => {
            const account = String(txn?.account || '').trim().toUpperCase();
            let accountType = String(
                txn?.account_type || txn?.source?.account_type || '',
            ).trim().toUpperCase();
            const currency = String(txn?.currency || '').trim().toUpperCase();
            accountType = accountType.replace(/^(?:USD|HKD|CNH|CNY|RMB)\s+/, '');
            if (/^FOREIGN CURRENCY SAVINGS(?:\s+(?:USD|HKD|CNH|CNY|RMB))?$/.test(
                accountType,
            )) {
                accountType = 'SAVINGS';
            }
            return account && accountType && currency
                ? ['HSBC', account, accountType, currency].join('|')
                : '';
        },
        convertAmountToBaseCurrency,
        sumCashLedgerInBaseCurrency: (balances) => Object.entries(balances || {}).reduce(
            (total, [currency, amount]) => total + convertAmountToBaseCurrency(amount, currency),
            0,
        ),
        cloneCashLedgerBalances: (balances) => ({...(balances || {})}),
    };
    return createInvestmentHistoryProjectionRuntime(runtime, {
        baseCurrency: 'USD',
        calculateInvestmentCashDelta: () => 0,
        cashFundingAdjustments: new Map(),
        fxTimeline: {},
    });
}

function makeScopeLedger(scopedBalances = {}, unscopedBalances = {}) {
    return {
        unscopedBalances: {...unscopedBalances},
        scopedBalances: {...scopedBalances},
        scopedCurrencies: Object.keys(scopedBalances).reduce((currencies, scopeKey) => {
            currencies[scopeKey.split('|').at(-1)] = true;
            return currencies;
        }, {}),
    };
}

function makeSettlementSell({
    balanceAfter = 1_200,
    brokerRunningCash = 1_010,
    calculatedBalances = {USD: 1_000, HKD: 100},
    cashScopeLedger = makeScopeLedger({
        [USD_SAVINGS_SCOPE]: 1_000,
        [HKD_SAVINGS_SCOPE]: 100,
    }),
    sourceFileKind = 'hsbc_usd_account_text',
    sourceSequenceSha256 = HSBC_SEQUENCE_SHA_A,
    rowNumber = 44,
    ledgerSequence = 44,
} = {}) {
    return {
        broker: 'hsbc',
        account: 'HSBC-TEST',
        date: '2026-09-17',
        type: 'sell',
        currency: 'USD',
        commission_raw: '0',
        net_amount_raw: '200',
        normalized: {commission: '0', net_amount: '200'},
        broker_running_cash: brokerRunningCash,
        broker_display_cash: brokerRunningCash,
        broker_pending_settlement_cash: 0,
        calculated_broker_cash_by_currency: calculatedBalances,
        calculated_broker_cash_scope_ledger: cashScopeLedger,
        source: {
            statement_order_id: 'S-100001',
            cash_settlement_date: '2026-09-18',
            cash_settlement_amount_raw: '200',
            cash_settlement_postings: [{
                date: '2026-09-18',
                currency: 'USD',
                amount_raw: '200',
                balance_after_raw: String(balanceAfter),
                row_number: rowNumber,
                ledger_sequence: ledgerSequence,
                source_file_kind: sourceFileKind,
                source_sequence_sha256: sourceSequenceSha256,
                account_number: 'HSBC-TEST',
                account_type: 'USD Savings',
                reference: 'REF S100001001 SEC',
                role: 'principal',
                ...(sourceFileKind === 'hsbc_usd_savings_csv'
                    ? {ledger_sequence_order: 'chronological'}
                    : {}),
            }],
        },
    };
}

function makeCashRow({
    date,
    balanceAfter,
    brokerRunningCash,
    rowNumber,
    ledgerSequence,
    sourceSequenceSha256,
    fileKind = 'hsbc_usd_account_text',
    type = 'deposit',
    amount = 200,
}) {
    return {
        broker: 'hsbc',
        account: 'HSBC-TEST',
        account_type: 'USD Savings',
        date,
        type,
        currency: 'USD',
        net_amount_raw: String(amount),
        normalized: {net_amount: String(amount)},
        broker_running_cash: brokerRunningCash,
        broker_display_cash: brokerRunningCash,
        source: {
            file_kind: fileKind,
            cash_balance_scope: 'account',
            cash_balance_authoritative: [
                'hsbc_usd_account_text',
                'hsbc_usd_savings_csv',
            ].includes(fileKind),
            account_type: 'USD Savings',
            balance_after_raw: String(balanceAfter),
            row_number: rowNumber,
            ledger_sequence: ledgerSequence,
            source_sequence_sha256: sourceSequenceSha256,
            ...(fileKind === 'hsbc_usd_savings_csv'
                ? {ledger_sequence_order: 'chronological'}
                : {}),
        },
    };
}

test('HSBC available-cash calibration requires strict direct-cash evidence', () => {
    const {getValidatedHsbcAvailableCashAfter} = createHistoryProjection();
    const valid = makeCashRow({
        date: '2026-09-21', balanceAfter: 100, brokerRunningCash: 100,
        rowNumber: 50, ledgerSequence: 50,
        sourceSequenceSha256: HSBC_SEQUENCE_SHA_A,
    });
    valid.source.available_cash_after_raw = '88.250';
    valid.source.available_cash_calibration_source = 'hsbc_usd_savings_available_balance';
    assert.equal(getValidatedHsbcAvailableCashAfter(valid), 88.25);

    const invalidCases = {
        'hexadecimal amount': (row) => {
            row.source.available_cash_after_raw = '0x10';
        },
        'unsafe integer amount': (row) => {
            row.source.available_cash_after_raw = '9007199254740993';
        },
        'wrong calibration source': (row) => {
            row.source.available_cash_calibration_source = 'unverified';
        },
        'pending settlement': (row) => {
            row.source.cash_replay_pending_settlement = true;
        },
        'settlement balance collision': (row) => {
            row.source.cash_settlement_balance_after_raw = '88.25';
        },
        'unknown source kind': (row) => {
            row.source.file_kind = 'mystery_cash';
        },
        'unsupported currency': (row) => {
            row.currency = 'DOGE';
        },
        'missing immutable digest': (row) => {
            delete row.source.source_sequence_sha256;
        },
        'wrong cash sign': (row) => {
            row.type = 'deposit';
            row.net_amount_raw = '-1';
            row.normalized.net_amount = '-1';
        },
    };
    Object.entries(invalidCases).forEach(([label, mutate]) => {
        const candidate = structuredClone(valid);
        mutate(candidate);
        assert.equal(
            getValidatedHsbcAvailableCashAfter(candidate),
            null,
            label,
        );
    });
});

test('HSBC history keeps foreign cash and rejects an older balance reset', () => {
    const {applyHsbcHistoryPresentationProjection} = createHistoryProjection();
    const sell = makeSettlementSell();
    const olderReceipt = makeCashRow({
        date: '2026-09-17', balanceAfter: 1_000, brokerRunningCash: 1_010,
        rowNumber: 43, ledgerSequence: 43, sourceSequenceSha256: HSBC_SEQUENCE_SHA_A,
    });
    const laterDividend = makeCashRow({
        date: '2026-09-21', balanceAfter: 1_510, brokerRunningCash: 1_521,
        rowNumber: 50, ledgerSequence: 50, sourceSequenceSha256: HSBC_SEQUENCE_SHA_B,
        type: 'dividend',
    });

    applyHsbcHistoryPresentationProjection([sell, olderReceipt, laterDividend]);

    assert.equal(sell.history_broker_cash, 1_210);
    assert.equal(olderReceipt.history_broker_cash, 1_210);
    assert.equal(laterDividend.history_broker_cash, 1_521);
});

test('HSBC history treats an absent target currency as zero without dropping foreign cash', () => {
    const {applyHsbcHistoryPresentationProjection} = createHistoryProjection();
    const sell = makeSettlementSell({
        balanceAfter: 200,
        brokerRunningCash: 10,
        calculatedBalances: {HKD: 100},
        cashScopeLedger: makeScopeLedger({[HKD_SAVINGS_SCOPE]: 100}),
    });

    applyHsbcHistoryPresentationProjection([sell]);

    assert.equal(sell.history_broker_cash, 210);
});

test('HSBC history corrects one USD scope without consuming another USD scope', () => {
    const {applyHsbcHistoryPresentationProjection} = createHistoryProjection();
    const sell = makeSettlementSell({
        brokerRunningCash: 1_050,
        calculatedBalances: {USD: 1_050},
        cashScopeLedger: makeScopeLedger({
            [USD_SAVINGS_SCOPE]: 1_000,
            [OTHER_USD_SCOPE]: 50,
        }),
    });

    applyHsbcHistoryPresentationProjection([sell]);

    assert.equal(sell.history_broker_cash, 1_250);
});

test('HSBC history creates an exact target when only another USD scope is known', () => {
    const {applyHsbcHistoryPresentationProjection} = createHistoryProjection();
    const sell = makeSettlementSell({
        balanceAfter: 200,
        brokerRunningCash: 50,
        calculatedBalances: {USD: 50},
        cashScopeLedger: makeScopeLedger({[OTHER_USD_SCOPE]: 50}),
    });

    applyHsbcHistoryPresentationProjection([sell]);

    assert.equal(sell.history_broker_cash, 250);
});

test('HSBC history preserves aggregate-only legacy replay balances', () => {
    const {applyHsbcHistoryPresentationProjection} = createHistoryProjection();
    const sell = makeSettlementSell({
        brokerRunningCash: 1_000,
        calculatedBalances: {USD: 1_000},
        cashScopeLedger: makeScopeLedger({}, {USD: 1_000}),
    });

    applyHsbcHistoryPresentationProjection([sell]);

    assert.equal(sell.history_broker_cash, 1_200);
});

test('HSBC history keeps a correction provisional when the direct row balance is blank', () => {
    const {applyHsbcHistoryPresentationProjection} = createHistoryProjection();
    const sell = makeSettlementSell({brokerRunningCash: 1_000});
    const directPrincipal = makeCashRow({
        date: '2026-09-18', balanceAfter: '', brokerRunningCash: 1_200,
        rowNumber: 44, ledgerSequence: 44,
        sourceSequenceSha256: HSBC_SEQUENCE_SHA_A,
    });

    applyHsbcHistoryPresentationProjection([sell, directPrincipal]);

    assert.equal(sell.history_broker_cash, 1_000);
    assert.equal(directPrincipal.history_broker_cash, 1_200);
    assert.equal(directPrincipal.history_cash_is_provisional, true);
});

test('HSBC history rejects conflicting direct cash provenance aliases', () => {
    const mutations = {
        'invalid date': (cashRow) => {
            cashRow.date = '2026-02-31';
        },
        'statement digest': (cashRow) => {
            cashRow.source.statement_pdf_source_sha256 = HSBC_SEQUENCE_SHA_B;
        },
        'statement row': (cashRow) => {
            cashRow.source.statement_pdf_source_row_number = 99;
        },
        'cash amount': (cashRow) => {
            cashRow.amount = 999;
        },
    };

    Object.entries(mutations).forEach(([label, mutate]) => {
        const {applyHsbcHistoryPresentationProjection} = createHistoryProjection();
        const sell = makeSettlementSell({brokerRunningCash: 1_000});
        const directPrincipal = makeCashRow({
            date: '2026-09-18', balanceAfter: 1_200, brokerRunningCash: 1_200,
            rowNumber: 44, ledgerSequence: 44,
            sourceSequenceSha256: HSBC_SEQUENCE_SHA_A,
        });
        mutate(directPrincipal);

        applyHsbcHistoryPresentationProjection([sell, directPrincipal]);

        assert.equal(
            sell.history_broker_cash,
            1_000,
            `${label} keeps the pre-settlement owner cash`,
        );
        assert.equal(
            sell.history_cash_is_provisional,
            true,
            `${label} invalidates the same-day owner boundary`,
        );
        assert.equal(
            directPrincipal.history_broker_cash,
            1_200,
            `${label} keeps the direct bank balance`,
        );
        assert.equal(
            directPrincipal.history_cash_is_provisional,
            true,
            `${label} cannot clear the settlement boundary`,
        );
    });
});

test('HSBC history marks standalone malformed direct cash evidence provisional', () => {
    const mutations = {
        'invalid date': (cashRow) => {
            cashRow.date = '2026-02-31';
        },
        'statement digest': (cashRow) => {
            cashRow.source.statement_pdf_source_sha256 = HSBC_SEQUENCE_SHA_B;
        },
        'statement row': (cashRow) => {
            cashRow.source.statement_pdf_source_row_number = 99;
        },
        'cash amount': (cashRow) => {
            cashRow.amount = 999;
        },
    };

    Object.entries(mutations).forEach(([label, mutate]) => {
        const {applyHsbcHistoryPresentationProjection} = createHistoryProjection();
        const cashRow = makeCashRow({
            date: '2026-09-18', balanceAfter: 1_200, brokerRunningCash: 1_200,
            rowNumber: 44, ledgerSequence: 44,
            sourceSequenceSha256: HSBC_SEQUENCE_SHA_A,
        });
        mutate(cashRow);

        applyHsbcHistoryPresentationProjection([cashRow]);

        assert.equal(cashRow.history_broker_cash, 1_200, label);
        assert.equal(cashRow.history_cash_is_provisional, true, label);
        assert.match(cashRow.history_balance_provisional_reason, /inconsistent/);
    });
});

test('HSBC history rejects duplicate ownership of one physical direct cash row', () => {
    const {applyHsbcHistoryPresentationProjection} = createHistoryProjection();
    const first = makeCashRow({
        date: '2026-09-18', balanceAfter: 110, brokerRunningCash: 110,
        rowNumber: 44, ledgerSequence: 44,
        sourceSequenceSha256: HSBC_SEQUENCE_SHA_A,
        amount: 10,
    });
    const second = makeCashRow({
        date: '2026-09-18', balanceAfter: 120, brokerRunningCash: 120,
        rowNumber: 44, ledgerSequence: 44,
        sourceSequenceSha256: HSBC_SEQUENCE_SHA_A,
        amount: 20,
    });

    applyHsbcHistoryPresentationProjection([first, second]);

    [first, second].forEach((row) => {
        assert.equal(row.history_cash_is_provisional, true);
        assert.equal(row.history_equity_is_provisional, true);
        assert.match(
            row.history_balance_provisional_reason,
            /incomplete or inconsistent immutable source-sequence evidence/,
        );
    });
});

test('HSBC history requires a complete immutable direct cash identity', () => {
    const mutations = {
        'fractional source row': (cashRow) => {
            cashRow.source.row_number = 44.5;
        },
        'missing source row': (cashRow) => {
            delete cashRow.source.row_number;
        },
        'fractional ledger sequence': (cashRow) => {
            cashRow.source.ledger_sequence = 44.5;
        },
        'missing source digest': (cashRow) => {
            delete cashRow.source.source_sequence_sha256;
        },
        'invalid source digest': (cashRow) => {
            cashRow.source.source_sequence_sha256 = 'not-a-sha256';
        },
        'missing account': (cashRow) => {
            delete cashRow.account;
        },
        'missing explicit currency': (cashRow) => {
            delete cashRow.currency;
        },
        'missing cash amount': (cashRow) => {
            delete cashRow.net_amount_raw;
            delete cashRow.normalized.net_amount;
        },
        'legacy cash amount alias only': (cashRow) => {
            cashRow.amount = cashRow.net_amount_raw;
            delete cashRow.net_amount_raw;
            delete cashRow.normalized.net_amount;
        },
        'legacy balance alias only': (cashRow) => {
            cashRow.source.balance_after = cashRow.source.balance_after_raw;
            delete cashRow.source.balance_after_raw;
        },
        'non-decimal cash amount': (cashRow) => {
            cashRow.net_amount_raw = '0x10';
            cashRow.normalized.net_amount = '0x10';
        },
        'unsafe cash amount': (cashRow) => {
            cashRow.net_amount_raw = '9007199254740993';
            cashRow.normalized.net_amount = '9007199254740993';
        },
        'unsafe cash balance': (cashRow) => {
            cashRow.source.balance_after_raw = '9007199254740993';
        },
        'date with trailing data': (cashRow) => {
            cashRow.date = '2026-09-18evil';
        },
        'unsupported currency': (cashRow) => {
            cashRow.currency = 'DOGE';
            cashRow.account_type = 'Savings';
            cashRow.source.account_type = 'Savings';
        },
        'unsupported account type': (cashRow) => {
            cashRow.account_type = 'Mystery';
            cashRow.source.account_type = 'Mystery';
        },
        'USD file kind with HKD currency': (cashRow) => {
            cashRow.currency = 'HKD';
            cashRow.account_type = 'Savings';
            cashRow.source.account_type = 'Savings';
        },
        'multi-currency kind with authoritative flag': (cashRow) => {
            cashRow.source.file_kind = 'hsbc_multi_currency_cash_account_text';
        },
        'USD-only kind with Current account': (cashRow) => {
            cashRow.account_type = 'USD Current';
            cashRow.source.account_type = 'USD Current';
        },
        'missing explicit account type': (cashRow) => {
            delete cashRow.account_type;
            delete cashRow.source.account_type;
        },
        'missing transaction type': (cashRow) => {
            delete cashRow.type;
        },
        'unknown transaction type': (cashRow) => {
            cashRow.type = 'mystery';
        },
        'negative deposit': (cashRow) => {
            cashRow.net_amount_raw = '-200';
            cashRow.normalized.net_amount = '-200';
        },
        'zero cash amount': (cashRow) => {
            cashRow.net_amount_raw = '0';
            cashRow.normalized.net_amount = '0';
        },
        'missing ledger sequence': (cashRow) => {
            delete cashRow.source.ledger_sequence;
        },
        'wrong cash-balance scope': (cashRow) => {
            cashRow.source.cash_balance_scope = 'portfolio';
        },
        'wrong authoritative flag': (cashRow) => {
            cashRow.source.cash_balance_authoritative = false;
        },
        'CSV without chronological marker': (cashRow) => {
            cashRow.source.file_kind = 'hsbc_usd_savings_csv';
        },
        'non-CSV chronological marker': (cashRow) => {
            cashRow.source.ledger_sequence_order = 'chronological';
        },
        'non-CSV divergent ledger sequence': (cashRow) => {
            cashRow.source.ledger_sequence = 45;
        },
        'source-sequence direction override': (cashRow) => {
            cashRow.source.source_sequence_direction = 1;
        },
    };

    Object.entries(mutations).forEach(([label, mutate]) => {
        const {applyHsbcHistoryPresentationProjection} = createHistoryProjection();
        const cashRow = makeCashRow({
            date: '2026-09-18', balanceAfter: 1_200, brokerRunningCash: 1_200,
            rowNumber: 44, ledgerSequence: 44,
            sourceSequenceSha256: HSBC_SEQUENCE_SHA_A,
        });
        mutate(cashRow);

        applyHsbcHistoryPresentationProjection([cashRow]);

        assert.equal(cashRow.history_broker_cash, 1_200, label);
        assert.equal(cashRow.history_cash_is_provisional, true, label);
        assert.equal(cashRow.history_equity_is_provisional, true, label);
        assert.match(
            cashRow.history_balance_provisional_reason,
            /incomplete or inconsistent immutable source-sequence evidence/,
            label,
        );
    });
});

test('HSBC history marks a settlement provisional when its exact cash scope has no baseline', () => {
    const {applyHsbcHistoryPresentationProjection} = createHistoryProjection();
    const sell = makeSettlementSell({
        brokerRunningCash: 0,
        calculatedBalances: {},
        cashScopeLedger: makeScopeLedger(),
    });

    applyHsbcHistoryPresentationProjection([sell]);

    assert.equal(sell.history_broker_cash, 0);
    assert.equal(sell.history_cash_is_provisional, true);
});

test('HSBC history rejects one immutable cash posting claimed by two cash scopes', () => {
    const {applyHsbcHistoryPresentationProjection} = createHistoryProjection();
    const savingsSell = makeSettlementSell({
        brokerRunningCash: 1_500,
        calculatedBalances: {USD: 1_500},
        cashScopeLedger: makeScopeLedger({
            [USD_SAVINGS_SCOPE]: 1_000,
            [OTHER_USD_SCOPE]: 500,
        }),
    });
    const currentSell = makeSettlementSell({
        balanceAfter: 800,
        brokerRunningCash: 1_500,
        calculatedBalances: {USD: 1_500},
        cashScopeLedger: makeScopeLedger({
            [USD_SAVINGS_SCOPE]: 1_000,
            [OTHER_USD_SCOPE]: 500,
        }),
        sourceFileKind: 'hsbc_multi_currency_cash_account_text',
    });
    currentSell.net_amount_raw = '300';
    currentSell.normalized.net_amount = '300';
    currentSell.source.statement_order_id = 'S-200002';
    currentSell.source.cash_settlement_amount_raw = '300';
    Object.assign(currentSell.source.cash_settlement_postings[0], {
        account_type: 'USD Current',
        amount_raw: '300',
        reference: 'REF S200002001 SEC',
    });

    applyHsbcHistoryPresentationProjection([savingsSell, currentSell]);

    assert.equal(savingsSell.history_broker_cash, 1_500);
    assert.equal(currentSell.history_broker_cash, 1_500);
    assert.equal(savingsSell.history_cash_is_provisional, true);
    assert.equal(currentSell.history_cash_is_provisional, true);
});

test('HSBC history settlement boundaries require complete canonical evidence', () => {
    const {getHsbcHistorySettlementCashBoundary} = createHistoryProjection();
    const mutations = {
        'missing owner net amount': (sell) => {
            delete sell.net_amount_raw;
            delete sell.normalized.net_amount;
            sell.amount = 200;
        },
        'missing source settlement amount': (sell) => {
            delete sell.source.cash_settlement_amount_raw;
        },
        'mismatched source settlement amount': (sell) => {
            sell.source.cash_settlement_amount_raw = '201';
        },
        'unsupported currency': (sell) => {
            sell.currency = 'DOGE';
            sell.source.cash_settlement_postings[0].currency = 'DOGE';
            sell.source.cash_settlement_postings[0].account_type = 'Savings';
        },
        'unsupported account type': (sell) => {
            sell.source.cash_settlement_postings[0].account_type = 'Mystery';
        },
        'USD file kind with HKD currency': (sell) => {
            sell.currency = 'HKD';
            sell.source.cash_settlement_postings[0].currency = 'HKD';
            sell.source.cash_settlement_postings[0].account_type = 'Savings';
        },
        'invalid sequence-order marker': (sell) => {
            sell.source.cash_settlement_postings[0]
                .ledger_sequence_order = 'reverse';
        },
        'missing cash balance': (sell) => {
            delete sell.source.cash_settlement_postings[0].balance_after_raw;
        },
        'non-decimal principal amount': (sell) => {
            sell.source.cash_settlement_amount_raw = '0xC8';
            sell.source.cash_settlement_postings[0].amount_raw = '0xC8';
        },
        'principal differs below binary tolerance': (sell) => {
            sell.source.cash_settlement_postings[0].amount_raw = '200.0000005';
        },
        'missing canonical posting amount': (sell) => {
            const posting = sell.source.cash_settlement_postings[0];
            posting.amount = posting.amount_raw;
            delete posting.amount_raw;
        },
        'missing canonical posting balance': (sell) => {
            const posting = sell.source.cash_settlement_postings[0];
            posting.balance_after = posting.balance_after_raw;
            delete posting.balance_after_raw;
        },
        'missing posting ledger sequence': (sell) => {
            delete sell.source.cash_settlement_postings[0].ledger_sequence;
        },
        'non-CSV divergent ledger sequence': (sell) => {
            sell.source.cash_settlement_postings[0].ledger_sequence = 45;
        },
        'USD file kind with Current account': (sell) => {
            sell.account_type = 'USD Current';
            sell.source.account_type = 'USD Current';
            sell.source.cash_settlement_postings[0].account_type = 'USD Current';
        },
        'CSV without chronological marker': (sell) => {
            sell.source.cash_settlement_postings[0].source_file_kind
                = 'hsbc_usd_savings_csv';
        },
    };

    const validSell = makeSettlementSell();
    assert.ok(getHsbcHistorySettlementCashBoundary(validSell));
    Object.entries(mutations).forEach(([label, mutate]) => {
        const sell = makeSettlementSell();
        mutate(sell);
        assert.equal(getHsbcHistorySettlementCashBoundary(sell), null, label);
    });
});

test('HSBC history ignores scalar-only legacy settlement metadata', () => {
    const {getHsbcHistorySettlementCashDeltas} = createHistoryProjection();
    const sell = makeSettlementSell();
    delete sell.source.cash_settlement_postings;

    assert.deepEqual(getHsbcHistorySettlementCashDeltas(sell), []);
});

test('HSBC history applies trailing blank-balance fees once after a principal boundary', () => {
    const {applyHsbcHistoryPresentationProjection} = createHistoryProjection();
    const sell = makeSettlementSell();
    sell.source.cash_settlement_postings.push({
        date: '2026-09-18', currency: 'USD', amount_raw: '-0.01',
        balance_after_raw: '', row_number: 45, ledger_sequence: 45,
        source_file_kind: 'hsbc_usd_account_text',
        source_sequence_sha256: HSBC_SEQUENCE_SHA_A,
        account_number: 'HSBC-TEST', account_type: 'USD Savings',
        reference: 'REF S100001001 SEC', role: 'fee',
    });
    sell.commission_raw = '-0.01';
    sell.normalized.commission = '-0.01';

    applyHsbcHistoryPresentationProjection([sell]);

    assert.equal(sell.history_broker_cash, 1_209.99);
});

test('HSBC history rejects a trailing blank-balance posting from another cash scope', () => {
    const {applyHsbcHistoryPresentationProjection} = createHistoryProjection();
    const sell = makeSettlementSell();
    sell.source.cash_settlement_postings.push({
        date: '2026-09-18', currency: 'HKD', amount_raw: '-1',
        balance_after_raw: '', row_number: 45, ledger_sequence: 45,
        source_file_kind: 'hsbc_usd_account_text',
        source_sequence_sha256: HSBC_SEQUENCE_SHA_A,
        account_number: 'HSBC-TEST', account_type: 'HKD Savings',
        reference: 'REF S100001001 SEC', role: 'fee',
    });
    sell.commission_raw = '-1';
    sell.normalized.commission = '-1';

    applyHsbcHistoryPresentationProjection([sell]);

    assert.equal(sell.history_broker_cash, 1_010);
});

test('HSBC history rejects a trailing blank-balance posting without exact identity', () => {
    const {applyHsbcHistoryPresentationProjection} = createHistoryProjection();
    const sell = makeSettlementSell();
    sell.source.cash_settlement_postings.push({
        date: '2026-09-18', currency: 'USD', amount_raw: '-0.01',
        balance_after_raw: '', row_number: 45, ledger_sequence: 45,
        source_file_kind: 'hsbc_usd_account_text',
        source_sequence_sha256: '',
        account_number: 'HSBC-TEST', account_type: 'USD Savings',
        reference: 'REF S100001001 SEC', role: 'fee',
    });
    sell.commission_raw = '-0.01';
    sell.normalized.commission = '-0.01';

    applyHsbcHistoryPresentationProjection([sell]);

    assert.equal(sell.history_broker_cash, 1_010);
});

test('HSBC history rejects a principal boundary from another cash scope', () => {
    const {applyHsbcHistoryPresentationProjection} = createHistoryProjection();
    const sell = makeSettlementSell();
    Object.assign(sell.source.cash_settlement_postings[0], {
        account_number: 'ACCOUNT-B',
        account_type: 'HKD Savings',
        currency: 'HKD',
        balance_after_raw: '2000',
    });

    applyHsbcHistoryPresentationProjection([sell]);

    assert.equal(sell.history_broker_cash, 1_010);
});

test('same-day CSV cash clears a settlement only in the same SHA and chronological-sequence domain', () => {
    const {applyHsbcHistoryPresentationProjection} = createHistoryProjection();
    const sell = makeSettlementSell({
        brokerRunningCash: 1_000,
        calculatedBalances: {USD: 1_000},
        cashScopeLedger: makeScopeLedger({[USD_SAVINGS_SCOPE]: 1_000}),
        sourceFileKind: 'hsbc_usd_savings_csv',
        sourceSequenceSha256: HSBC_SEQUENCE_SHA_A,
        rowNumber: 111,
        ledgerSequence: 57,
    });
    const olderCash = makeCashRow({
        date: '2026-09-18', balanceAfter: 1_000, brokerRunningCash: 1_000,
        fileKind: 'hsbc_usd_savings_csv', rowNumber: 114, ledgerSequence: 54,
        sourceSequenceSha256: HSBC_SEQUENCE_SHA_A,
    });
    const foreignDomainCash = makeCashRow({
        date: '2026-09-18', balanceAfter: 1_000, brokerRunningCash: 1_000,
        fileKind: 'hsbc_usd_savings_csv', rowNumber: 110, ledgerSequence: 58,
        sourceSequenceSha256: HSBC_SEQUENCE_SHA_B,
    });
    const laterCash = makeCashRow({
        date: '2026-09-18', balanceAfter: 1_200, brokerRunningCash: 1_200,
        fileKind: 'hsbc_usd_savings_csv', rowNumber: 110, ledgerSequence: 58,
        sourceSequenceSha256: HSBC_SEQUENCE_SHA_A,
    });

    applyHsbcHistoryPresentationProjection([sell, olderCash, foreignDomainCash, laterCash]);

    assert.equal(sell.history_broker_cash, 1_200);
    assert.equal(olderCash.history_broker_cash, 1_200);
    assert.equal(foreignDomainCash.history_broker_cash, 1_000);
    assert.equal(foreignDomainCash.history_cash_is_provisional, true);
    assert.equal(laterCash.history_broker_cash, 1_200);
});

test('same-day history without SHA keeps the direct cash row and marks it provisional', () => {
    const {applyHsbcHistoryPresentationProjection} = createHistoryProjection();
    const sell = makeSettlementSell({
        brokerRunningCash: 1_000,
        calculatedBalances: {USD: 1_000},
        cashScopeLedger: makeScopeLedger({[USD_SAVINGS_SCOPE]: 1_000}),
        sourceSequenceSha256: '',
    });
    const cashRow = makeCashRow({
        date: '2026-09-18', balanceAfter: 1_210, brokerRunningCash: 1_210,
        rowNumber: 50, ledgerSequence: 50, sourceSequenceSha256: '',
    });

    applyHsbcHistoryPresentationProjection([sell, cashRow]);

    assert.equal(sell.history_broker_cash, 1_000);
    assert.equal(cashRow.history_broker_cash, 1_210);
    assert.equal(cashRow.history_cash_is_provisional, true);
    assert.match(cashRow.history_balance_provisional_reason, /source-sequence/);
});

test('daily settlement replay corrects only its exact USD cash scope', () => {
    const {buildHsbcSettlementReplaySnapshots} = createHistoryProjection();
    const transaction = {
        broker: 'hsbc', account: 'HSBC-TEST', account_type: 'USD Savings',
        date: '2026-09-17', datetime: '2026-09-17 20:00:00', type: 'sell', currency: 'USD',
        aggregate_running_cash: 1_050, aggregate_display_cash: 1_050,
        aggregate_cash_by_currency: {USD: 1_050}, aggregate_pending_settlement_cash: 0,
        broker_running_cash: 1_050, broker_display_cash: 1_050,
        broker_cash_by_currency: {USD: 1_050},
        calculated_broker_cash_by_currency: {USD: 1_050},
        calculated_broker_cash_scope_ledger: makeScopeLedger({
            [USD_SAVINGS_SCOPE]: 1_000,
            [OTHER_USD_SCOPE]: 50,
        }),
        broker_pending_settlement_cash: 0,
    };
    const snapshots = buildHsbcSettlementReplaySnapshots([transaction], [{
        ownerTransactionIndex: 0,
        broker: 'hsbc', account: 'HSBC-TEST', accountType: 'USD SAVINGS',
        cashScopeKey: USD_SAVINGS_SCOPE,
        date: '2026-09-18', currency: 'USD', settlementAmount: 200,
        settlementBalanceAfter: 1_200, sourceRowSequence: 44, sourceRowNumber: 44,
        sourceFileKind: 'hsbc_usd_account_text',
        sourceSequenceSha256: HSBC_SEQUENCE_SHA_A,
    }]);
    const boundary = snapshots.find((snapshot) => (
        snapshot.replay_snapshot_kind === 'hsbc_cash_settlement_boundary'
    ));

    assert.equal(boundary.broker_running_cash, 1_250);
    assert.deepEqual(boundary.broker_cash_by_currency, {USD: 1_250});
    assert.equal(boundary.aggregate_running_cash, 1_250);
});

test('daily settlement replay uses an aggregate-only legacy target balance once', () => {
    const {buildHsbcSettlementReplaySnapshots} = createHistoryProjection();
    const transaction = {
        broker: 'hsbc', account: 'HSBC-TEST', account_type: 'USD Savings',
        date: '2026-09-17', type: 'sell', currency: 'USD',
        aggregate_running_cash: 1_000, aggregate_display_cash: 1_000,
        aggregate_cash_by_currency: {USD: 1_000}, aggregate_pending_settlement_cash: 0,
        broker_running_cash: 1_000, broker_display_cash: 1_000,
        broker_cash_by_currency: {USD: 1_000},
        calculated_broker_cash_by_currency: {USD: 1_000},
        calculated_broker_cash_scope_ledger: makeScopeLedger({}, {USD: 1_000}),
        broker_pending_settlement_cash: 0,
    };
    const snapshots = buildHsbcSettlementReplaySnapshots([transaction], [{
        ownerTransactionIndex: 0,
        broker: 'hsbc', account: 'HSBC-TEST', accountType: 'USD SAVINGS',
        cashScopeKey: USD_SAVINGS_SCOPE,
        date: '2026-09-18', currency: 'USD', settlementAmount: 200,
        settlementBalanceAfter: 1_200, sourceRowSequence: 44, sourceRowNumber: 44,
        sourceFileKind: 'hsbc_usd_account_text', sourceSequenceSha256: HSBC_SEQUENCE_SHA_A,
    }]);
    const boundary = snapshots.at(-1);

    assert.equal(boundary.broker_running_cash, 1_200);
    assert.deepEqual(boundary.broker_cash_by_currency, {USD: 1_200});
});

function makeUnscopedDeltaSettlementReplay(scopedBalances, unscopedBalances, total) {
    const transaction = {
        broker: 'hsbc', account: 'HSBC-TEST', account_type: 'USD Savings',
        date: '2026-09-17', type: 'sell', currency: 'USD',
        aggregate_running_cash: total, aggregate_display_cash: total,
        aggregate_cash_by_currency: {USD: total}, aggregate_pending_settlement_cash: 0,
        broker_running_cash: total, broker_display_cash: total,
        broker_cash_by_currency: {USD: total},
        calculated_broker_cash_by_currency: {USD: total},
        calculated_broker_cash_scope_ledger: makeScopeLedger(scopedBalances, unscopedBalances),
        broker_pending_settlement_cash: 0,
    };
    const boundary = {
        ownerTransactionIndex: 0,
        broker: 'hsbc', account: 'HSBC-TEST', accountType: 'USD SAVINGS',
        cashScopeKey: USD_SAVINGS_SCOPE,
        date: '2026-09-18', currency: 'USD', settlementAmount: 200,
        settlementBalanceAfter: 1_200, sourceRowSequence: 44, sourceRowNumber: 44,
        sourceFileKind: 'hsbc_usd_account_text', sourceSequenceSha256: HSBC_SEQUENCE_SHA_A,
    };
    return {transaction, boundary};
}

test('daily settlement replay folds unscoped deltas into the only same-currency scope', () => {
    const {buildHsbcSettlementReplaySnapshots} = createHistoryProjection();
    // Legacy direct-cash rows without sequence provenance leave their deltas
    // unscoped after an earlier zero-balance boundary.
    const {transaction, boundary} = makeUnscopedDeltaSettlementReplay(
        {[USD_SAVINGS_SCOPE]: 0},
        {USD: 45_000},
        45_000,
    );
    const snapshots = buildHsbcSettlementReplaySnapshots([transaction], [boundary]);
    const settlement = snapshots.at(-1);

    assert.equal(settlement.replay_snapshot_kind, 'hsbc_cash_settlement_boundary');
    assert.equal(settlement.broker_running_cash, 1_200);
    assert.deepEqual(settlement.broker_cash_by_currency, {USD: 1_200});
    assert.equal(settlement.aggregate_running_cash, 1_200);
});

test('daily settlement replay rejects unscoped deltas beside several same-currency scopes', () => {
    const {buildHsbcSettlementReplaySnapshots} = createHistoryProjection();
    const {transaction, boundary} = makeUnscopedDeltaSettlementReplay(
        {[USD_SAVINGS_SCOPE]: 1_000, [OTHER_USD_SCOPE]: 50},
        {USD: 500},
        1_550,
    );
    const snapshots = buildHsbcSettlementReplaySnapshots([transaction], [boundary]);

    assert.equal(snapshots.length, 1);
    assert.notEqual(snapshots[0].replay_snapshot_kind, 'hsbc_cash_settlement_boundary');
    assert.equal(snapshots[0].broker_running_cash, 1_550);
});

test('daily settlement replay creates an exact target beside another same-currency scope', () => {
    const {buildHsbcSettlementReplaySnapshots} = createHistoryProjection();
    const transaction = {
        broker: 'hsbc', account: 'HSBC-TEST', account_type: 'USD Current',
        date: '2026-09-17', type: 'sell', currency: 'USD',
        aggregate_running_cash: 50, aggregate_display_cash: 50,
        aggregate_cash_by_currency: {USD: 50}, aggregate_pending_settlement_cash: 0,
        broker_running_cash: 50, broker_display_cash: 50,
        broker_cash_by_currency: {USD: 50}, calculated_broker_cash_by_currency: {USD: 50},
        calculated_broker_cash_scope_ledger: makeScopeLedger({[OTHER_USD_SCOPE]: 50}),
        broker_pending_settlement_cash: 0,
    };
    const snapshots = buildHsbcSettlementReplaySnapshots([transaction], [{
        ownerTransactionIndex: 0,
        broker: 'hsbc', account: 'HSBC-TEST', accountType: 'USD SAVINGS',
        cashScopeKey: USD_SAVINGS_SCOPE,
        date: '2026-09-18', currency: 'USD', settlementAmount: 200,
        settlementBalanceAfter: 1_200, sourceRowSequence: 44, sourceRowNumber: 44,
        sourceFileKind: 'hsbc_usd_account_text', sourceSequenceSha256: HSBC_SEQUENCE_SHA_A,
    }]);
    const boundary = snapshots.at(-1);

    assert.equal(boundary.broker_running_cash, 1_250);
    assert.equal(boundary.broker_display_cash, 1_250);
    assert.deepEqual(boundary.broker_cash_by_currency, {USD: 1_250});
});

test('same-day replay without SHA rejects the sequence-incomparable boundary', () => {
    const {buildHsbcSettlementReplaySnapshots} = createHistoryProjection();
    const transaction = {
        broker: 'hsbc', account: 'HSBC-TEST', account_type: 'USD Savings',
        date: '2026-09-18', datetime: '2026-09-18 20:00:00', type: 'deposit', currency: 'USD',
        aggregate_running_cash: 1_210, aggregate_display_cash: 1_210,
        aggregate_cash_by_currency: {USD: 1_210}, aggregate_pending_settlement_cash: 0,
        broker_running_cash: 1_210, broker_display_cash: 1_210,
        broker_cash_by_currency: {USD: 1_210},
        calculated_broker_cash_by_currency: {USD: 1_210},
        calculated_broker_cash_scope_ledger: makeScopeLedger({[USD_SAVINGS_SCOPE]: 1_210}),
        broker_pending_settlement_cash: 0,
        source: {
            file_kind: 'hsbc_usd_account_text', account_type: 'USD Savings',
            balance_after_raw: '1210', row_number: 50, ledger_sequence: 50,
        },
    };
    const snapshots = buildHsbcSettlementReplaySnapshots([transaction], [{
        ownerTransactionIndex: 0,
        broker: 'hsbc', account: 'HSBC-TEST', accountType: 'USD SAVINGS',
        cashScopeKey: USD_SAVINGS_SCOPE,
        date: '2026-09-18', currency: 'USD', settlementAmount: 200,
        settlementBalanceAfter: 1_200, sourceRowSequence: 40, sourceRowNumber: 40,
        sourceFileKind: 'hsbc_usd_account_text', sourceSequenceSha256: '',
    }]);

    assert.equal(snapshots.length, 1);
    assert.notEqual(snapshots[0].replay_snapshot_kind, 'hsbc_cash_settlement_boundary');
    assert.equal(snapshots[0].broker_running_cash, 1_210);
});

test('same-day cash corroborated as the opening balance retains later SEC settlement', () => {
    const {buildHsbcSettlementReplaySnapshots} = createHistoryProjection();
    const owner = {
        ...makeSettlementSell({
            balanceAfter: 1_200,
            brokerRunningCash: 998,
            calculatedBalances: {USD: 998},
            cashScopeLedger: makeScopeLedger({[USD_SAVINGS_SCOPE]: 998}),
            sourceFileKind: 'hsbc_usd_savings_csv',
            sourceSequenceSha256: HSBC_SEQUENCE_SHA_A,
            rowNumber: 44,
            ledgerSequence: 44,
        }),
        aggregate_running_cash: 998,
        aggregate_display_cash: 998,
        aggregate_cash_by_currency: {USD: 998},
        aggregate_pending_settlement_cash: 0,
    };
    const directCash = {
        ...makeCashRow({
            date: '2026-09-18',
            balanceAfter: 1_000,
            brokerRunningCash: 1_000,
            amount: 2,
            rowNumber: 50,
            ledgerSequence: 50,
            sourceSequenceSha256: HSBC_SEQUENCE_SHA_B,
        }),
        aggregate_running_cash: 1_000,
        aggregate_display_cash: 1_000,
        aggregate_cash_by_currency: {USD: 1_000},
        aggregate_pending_settlement_cash: 0,
        calculated_broker_cash_by_currency: {USD: 1_000},
        calculated_broker_cash_scope_ledger: makeScopeLedger({[USD_SAVINGS_SCOPE]: 1_000}),
    };
    directCash.source.ledger_sequence_order = 'chronological';
    const boundary = {
        ownerTransactionIndex: 0,
        broker: 'hsbc', account: 'HSBC-TEST', accountType: 'USD SAVINGS',
        cashScopeKey: USD_SAVINGS_SCOPE,
        date: '2026-09-18', currency: 'USD', settlementAmount: 200,
        settlementBalanceAfter: 1_200,
        sourceRowSequence: 44, sourceRowNumber: 44,
        sourceFileKind: 'hsbc_usd_savings_csv', sourceSequenceSha256: HSBC_SEQUENCE_SHA_A,
        sourceSequenceDirection: 1,
    };
    const snapshots = buildHsbcSettlementReplaySnapshots([owner, directCash], [boundary]);

    assert.equal(snapshots.length, 3);
    assert.equal(snapshots[0].aggregate_pending_settlement_cash, 200);
    assert.equal(snapshots[1].aggregate_display_cash, 1_200);
    assert.equal(snapshots[2].aggregate_running_cash, 1_200);
    assert.equal(snapshots[2].aggregate_pending_settlement_cash, 0);

    const conflictingCash = {
        ...directCash,
        source: {...directCash.source, balance_after_raw: '990'},
    };
    const rejected = buildHsbcSettlementReplaySnapshots([owner, conflictingCash], [boundary]);
    assert.equal(rejected.length, 2);
    assert.equal(rejected[0].aggregate_pending_settlement_cash, 0);
});

test('replay rejects an invalid-date direct row claiming the boundary physical row', () => {
    const {buildHsbcSettlementReplaySnapshots} = createHistoryProjection();
    const owner = {
        broker: 'hsbc', account: 'HSBC-TEST', account_type: 'USD Savings',
        date: '2026-09-17', type: 'sell', currency: 'USD',
        aggregate_running_cash: 1_000, aggregate_display_cash: 1_000,
        aggregate_cash_by_currency: {USD: 1_000}, aggregate_pending_settlement_cash: 200,
        broker_running_cash: 1_000, broker_display_cash: 1_000,
        broker_cash_by_currency: {USD: 1_000},
        calculated_broker_cash_by_currency: {USD: 1_000},
        calculated_broker_cash_scope_ledger: makeScopeLedger({[USD_SAVINGS_SCOPE]: 1_000}),
        broker_pending_settlement_cash: 200,
    };
    const invalidDirect = makeCashRow({
        date: '2026-02-31', balanceAfter: 1_200, brokerRunningCash: 1_200,
        rowNumber: 44, ledgerSequence: 44,
        sourceSequenceSha256: HSBC_SEQUENCE_SHA_A,
    });
    const snapshots = buildHsbcSettlementReplaySnapshots([owner, invalidDirect], [{
        ownerTransactionIndex: 0,
        broker: 'hsbc', account: 'HSBC-TEST', accountType: 'USD SAVINGS',
        cashScopeKey: USD_SAVINGS_SCOPE,
        date: '2026-09-18', currency: 'USD', settlementAmount: 200,
        settlementBalanceAfter: 1_200, sourceRowSequence: 44, sourceRowNumber: 44,
        sourceFileKind: 'hsbc_usd_account_text',
        sourceSequenceSha256: HSBC_SEQUENCE_SHA_A,
    }]);

    assert.equal(snapshots.length, 2);
    assert.ok(snapshots.every((snapshot) => (
        snapshot.replay_snapshot_kind !== 'hsbc_cash_settlement_boundary'
    )));
    assert.equal(snapshots[0].broker_pending_settlement_cash, 200);
});

test('blank fee balance applies the fee once after the principal boundary', () => {
    const {buildHsbcSettlementReplaySnapshots} = createHistoryProjection();
    const transaction = {
        broker: 'hsbc', account: 'HSBC-TEST', account_type: 'USD Savings',
        date: '2026-09-17', type: 'sell', currency: 'USD',
        aggregate_running_cash: 1_000, aggregate_display_cash: 1_000,
        aggregate_cash_by_currency: {USD: 1_000}, aggregate_pending_settlement_cash: 0,
        broker_running_cash: 1_000, broker_display_cash: 1_000,
        broker_cash_by_currency: {USD: 1_000},
        calculated_broker_cash_by_currency: {USD: 1_000},
        calculated_broker_cash_scope_ledger: makeScopeLedger({[USD_SAVINGS_SCOPE]: 1_000}),
        broker_pending_settlement_cash: 0,
    };
    const commonBoundary = {
        ownerTransactionIndex: 0,
        broker: 'hsbc', account: 'HSBC-TEST', accountType: 'USD SAVINGS',
        cashScopeKey: USD_SAVINGS_SCOPE,
        date: '2026-09-18', currency: 'USD',
        sourceFileKind: 'hsbc_usd_account_text',
        sourceSequenceSha256: HSBC_SEQUENCE_SHA_A,
    };
    const snapshots = buildHsbcSettlementReplaySnapshots([transaction], [
        {
            ...commonBoundary,
            settlementAmount: 200, settlementBalanceAfter: 1_200,
            sourceRowSequence: 44, sourceRowNumber: 44, role: 'principal',
        },
        {
            ...commonBoundary,
            settlementAmount: -0.01, settlementBalanceAfter: null,
            sourceRowSequence: 45, sourceRowNumber: 45, role: 'fee',
        },
    ]);

    assert.equal(snapshots.at(-1).broker_running_cash, 1_199.99);
    assert.equal(snapshots.at(-1).broker_display_cash, 1_199.99);
    assert.deepEqual(snapshots.at(-1).broker_cash_by_currency, {USD: 1_199.99});
});

test('same-day CSV replay follows the importer chronological sequence', () => {
    const {buildHsbcSettlementReplaySnapshots} = createHistoryProjection();
    const owner = {
        broker: 'hsbc', account: 'HSBC-TEST', account_type: 'USD Savings',
        date: '2026-09-17', type: 'sell', currency: 'USD', description: 'owner',
        aggregate_running_cash: 1_000, aggregate_display_cash: 1_000,
        aggregate_cash_by_currency: {USD: 1_000}, aggregate_pending_settlement_cash: 0,
        broker_running_cash: 1_000, broker_display_cash: 1_000,
        broker_cash_by_currency: {USD: 1_000}, calculated_broker_cash_by_currency: {USD: 1_000},
        calculated_broker_cash_scope_ledger: makeScopeLedger({[USD_SAVINGS_SCOPE]: 1_000}),
        broker_pending_settlement_cash: 0,
    };
    const makeCsvCash = (rowNumber, description) => ({
        ...owner,
        date: '2026-09-18',
        type: 'deposit',
        description,
        net_amount_raw: '200',
        normalized: {net_amount: '200'},
        source: {
            file_kind: 'hsbc_usd_savings_csv', account_type: 'USD Savings',
            cash_balance_authoritative: true, cash_balance_scope: 'account',
            balance_after_raw: '1200', row_number: rowNumber,
            ledger_sequence: 168 - rowNumber, source_sequence_sha256: HSBC_SEQUENCE_SHA_A,
            ledger_sequence_order: 'chronological',
        },
    });
    const boundary = {
        ownerTransactionIndex: 0,
        broker: 'hsbc', account: 'HSBC-TEST', accountType: 'USD SAVINGS',
        cashScopeKey: USD_SAVINGS_SCOPE,
        date: '2026-09-18', currency: 'USD', settlementAmount: 200,
        settlementBalanceAfter: 1_200, sourceRowSequence: 57, sourceRowNumber: 111,
        sourceFileKind: 'hsbc_usd_savings_csv', sourceSequenceSha256: HSBC_SEQUENCE_SHA_A,
        sourceSequenceDirection: 1,
    };
    const replayKinds = (cashRow) => buildHsbcSettlementReplaySnapshots(
        [owner, cashRow],
        [boundary],
    ).map((snapshot) => snapshot.replay_snapshot_kind || snapshot.description);

    assert.deepEqual(replayKinds(makeCsvCash(114, 'older cash')), [
        'owner',
        'older cash',
        'hsbc_cash_settlement_boundary',
    ]);
    assert.deepEqual(replayKinds(makeCsvCash(110, 'later cash')), [
        'owner',
        'hsbc_cash_settlement_boundary',
        'later cash',
    ]);
});
