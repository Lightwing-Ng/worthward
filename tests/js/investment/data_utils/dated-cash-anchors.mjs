/* Dated native-currency cash anchor regressions. Code version: v1.0.0 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildDatedCashBalanceProjection,
    getInvestmentBrokerDatedCashAnchors,
    getInvestmentBrokerExplicitEndingCashBalances,
    getInvestmentCashBalanceBoundary,
} from './context.mjs';

const ACCOUNT = 'HSBC-TEST-001';
const SEQUENCE_SHA = 'c'.repeat(64);
const FX_RATES = {HKD: 7.8, CNH: 7};

function withInvestmentData(data, callback) {
    const previousWindow = globalThis.window;
    globalThis.window = {WORTHWARD_INVESTMENT_DATA: data};
    try {
        return callback();
    } finally {
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
    }
}

function convertAtFixtureRates(balances) {
    return Object.entries(balances || {}).reduce(
        (total, [currency, amount]) => total + (Number(amount) / (FX_RATES[currency] || 1)),
        0,
    );
}

function hsbcMulticurrencySummary(overrides = {}) {
    return {
        ending_cash: '21210.00',
        ending_cash_base_currency: '21210.00',
        ending_cash_base_currency_as_of: '2026-03-05',
        cash_snapshot_as_of: '2026-03-06',
        cash_snapshot_authoritative: true,
        ending_cash_by_currency: {USD: '21210.00', HKD: '2804.88', CNH: '0.00'},
        hsbc_ending_cash_components: {
            'USD:SAVINGS': '21210.00',
            'HKD:SAVINGS': '2804.88',
            'HKD:CURRENT': '0.00',
            'CNH:SAVINGS': '0.00',
        },
        hsbc_cash_component_post_dates: {
            'USD:SAVINGS': '2026-03-05',
            'HKD:SAVINGS': '2026-03-06',
            'HKD:CURRENT': '2026-01-20',
            'CNH:SAVINGS': '2026-03-06',
        },
        ...overrides,
    };
}

test('explicit ending balances keep authoritative zeros and drop unusable entries', () => {
    withInvestmentData({
        broker_summaries: {
            hsbc: hsbcMulticurrencySummary({
                ending_cash_by_currency: {USD: '21210.00', HKD: '2804.88', CNH: '0.00', CNY: ''},
            }),
            ibkr: {ending_cash: '420.38', ending_cash_as_of: '2026-03-02'},
            schwab: {ending_cash_by_currency: {USD: 'n/a', HKD: '78.00'}},
            futuhk: {ending_cash_by_currency: {usd: '1.00', USD: '2.00'}},
            boc_hk: {ending_cash_by_currency: {RMB: '5.00'}},
            cmbwl: {ending_cash_by_currency: {}},
        },
    }, () => {
        // A native zero is a balance boundary; a blank value stays unknown.
        assert.deepEqual(getInvestmentBrokerExplicitEndingCashBalances('hsbc'), {
            USD: 21210,
            HKD: 2804.88,
            CNH: 0,
        });
        // A scalar-only snapshot is a base-currency total, not a balance map.
        assert.equal(getInvestmentBrokerExplicitEndingCashBalances('ibkr'), null);
        assert.deepEqual(getInvestmentBrokerExplicitEndingCashBalances('schwab'), {HKD: 78});
        // Two spellings of one currency conflict, but the map stays explicit.
        assert.deepEqual(getInvestmentBrokerExplicitEndingCashBalances('futuhk'), {});
        assert.deepEqual(getInvestmentBrokerDatedCashAnchors('futuhk'), {
            anchors: [],
            unanchoredCurrencies: ['USD'],
        });
        // Offshore-RMB labels are canonical CNH only for HSBC.
        assert.deepEqual(getInvestmentBrokerExplicitEndingCashBalances('boc_hk'), {RMB: 5});
        assert.equal(getInvestmentBrokerExplicitEndingCashBalances('cmbwl'), null);
        assert.equal(getInvestmentBrokerExplicitEndingCashBalances('missing'), null);
    });
    withInvestmentData({
        broker_summaries: {
            hsbc: {ending_cash_by_currency: {CNY: '5.00', RMB: '6.00'}},
            ibkr: {ending_cash_by_currency: {USD: '', HKD: null}},
        },
    }, () => {
        assert.deepEqual(getInvestmentBrokerExplicitEndingCashBalances('hsbc'), {});
        // Only blank entries carry no balance evidence at all.
        assert.equal(getInvestmentBrokerExplicitEndingCashBalances('ibkr'), null);
    });
});

test('HSBC component post dates date each native currency anchor independently', () => {
    withInvestmentData({broker_summaries: {hsbc: hsbcMulticurrencySummary()}}, () => {
        // The native USD scalar is one component, never the total of all currencies.
        assert.deepEqual(getInvestmentBrokerDatedCashAnchors('hsbc'), {
            anchors: [
                {currency: 'CNH', balance: 0, asOf: '2026-03-06', asOfDateTime: ''},
                {currency: 'HKD', balance: 2804.88, asOf: '2026-03-06', asOfDateTime: ''},
                {currency: 'USD', balance: 21210, asOf: '2026-03-05', asOfDateTime: ''},
            ],
            unanchoredCurrencies: [],
        });
    });
});

test('incomplete or conflicting component evidence leaves only that currency unanchored', () => {
    const cases = [
        ['undated component', {
            hsbc_cash_component_post_dates: {
                'USD:SAVINGS': '2026-03-05',
                'HKD:SAVINGS': '2026-03-06',
                'CNH:SAVINGS': '2026-03-06',
            },
        }, ['HKD']],
        ['component total disagrees with the balance map', {
            hsbc_ending_cash_components: {
                'USD:SAVINGS': '21210.00',
                'HKD:SAVINGS': '2804.88',
                'HKD:CURRENT': '5.00',
                'CNH:SAVINGS': '0.00',
            },
        }, ['HKD']],
        ['impossible calendar date', {
            hsbc_cash_component_post_dates: {
                'USD:SAVINGS': '2026-03-05',
                'HKD:SAVINGS': '2026-03-06',
                'HKD:CURRENT': '2026-01-20',
                'CNH:SAVINGS': '2026-02-30',
            },
        }, ['CNH']],
        ['balance without a component', {
            ending_cash_by_currency: {USD: '21210.00', HKD: '2804.88', CNH: '0.00', EUR: '10.00'},
        }, ['EUR']],
        ['malformed component amount', {
            hsbc_ending_cash_components: {
                'USD:SAVINGS': '21,210.00',
                'HKD:SAVINGS': '2804.88',
                'HKD:CURRENT': '0.00',
                'CNH:SAVINGS': '0.00',
            },
        }, ['USD']],
    ];
    cases.forEach(([label, overrides, unanchored]) => {
        withInvestmentData({broker_summaries: {hsbc: hsbcMulticurrencySummary(overrides)}}, () => {
            const resolved = getInvestmentBrokerDatedCashAnchors('hsbc');
            assert.deepEqual(resolved.unanchoredCurrencies, unanchored, label);
            assert.deepEqual(
                resolved.anchors.map(({currency}) => currency),
                ['CNH', 'HKD', 'USD'].filter((currency) => !unanchored.includes(currency)),
                label,
            );
        });
    });
});

test('brokers without component dates anchor each explicit balance at the broker boundary', () => {
    withInvestmentData({
        broker_summaries: {
            ibkr: {
                ending_cash: '100.00',
                ending_cash_by_currency: {USD: '100.00', HKD: '780.00'},
                ending_cash_replay_as_of: '2026-03-02',
                ending_cash_replay_as_of_datetime: '2026-03-02 15:30:00',
            },
            schwab: {ending_cash_by_currency: {USD: '5.00'}},
            longbridge_sg: {ending_cash: '9.00'},
        },
    }, () => {
        assert.deepEqual(getInvestmentBrokerDatedCashAnchors('ibkr'), {
            anchors: [
                {currency: 'HKD', balance: 780, asOf: '2026-03-02', asOfDateTime: '2026-03-02 15:30:00'},
                {currency: 'USD', balance: 100, asOf: '2026-03-02', asOfDateTime: '2026-03-02 15:30:00'},
            ],
            unanchoredCurrencies: [],
        });
        assert.deepEqual(getInvestmentBrokerDatedCashAnchors('schwab'), {
            anchors: [],
            unanchoredCurrencies: ['USD'],
        });
        assert.equal(getInvestmentBrokerDatedCashAnchors('longbridge_sg'), null);
    });
});

function mixedDateReplayRows() {
    return [
        {date: '2026-03-04', broker_cash_by_currency: {USD: 21500, HKD: 1950, CNH: 420}},
        {date: '2026-03-05', broker_cash_by_currency: {USD: 21500, HKD: 1950, CNH: 490}},
        {date: '2026-03-05', broker_cash_by_currency: {USD: 21500, HKD: 2262, CNH: 490}},
        {date: '2026-03-06', broker_cash_by_currency: {USD: 21500, HKD: 2262}},
        {date: '2026-03-06', broker_cash_by_currency: {USD: 21500, HKD: 2804.88}},
    ];
}

const MIXED_DATE_ANCHORS = [
    {currency: 'USD', balance: 21210, asOf: '2026-03-05'},
    {currency: 'HKD', balance: 2804.88, asOf: '2026-03-06'},
    {currency: 'CNH', balance: 0, asOf: '2026-03-06'},
];

test('dated balance projection converts foreign cash once at each component boundary', () => {
    const projection = buildDatedCashBalanceProjection(mixedDateReplayRows(), {
        anchors: MIXED_DATE_ANCHORS,
        convertBalancesToBaseCash: convertAtFixtureRates,
    });

    assert.equal(projection.applied, true);
    // The earlier same-day row precedes the end-of-day USD boundary.
    assert.deepEqual(projection.projections.map(({index}) => index), [2, 3, 4]);
    const [usdBoundary, cnhWithdrawal, currentRow] = projection.projections;
    assert.deepEqual(usdBoundary.balances, {USD: 21210, HKD: 2262, CNH: 490});
    assert.ok(Math.abs(usdBoundary.runningCash - (21210 + 290 + 70)) < 1e-9);
    assert.deepEqual(Object.keys(usdBoundary.anchors), ['USD']);
    assert.deepEqual(usdBoundary.anchors.USD, {
        asOf: '2026-03-05',
        balance: 21210,
        adjustment: -290,
        active: true,
        afterSnapshot: false,
    });
    // HKD and CNH stay on their own replay balances until their own date.
    assert.deepEqual(cnhWithdrawal.balances, {USD: 21210, HKD: 2262});
    assert.ok(Math.abs(cnhWithdrawal.runningCash - (21210 + 290)) < 1e-9);
    assert.deepEqual(Object.keys(cnhWithdrawal.anchors), ['USD']);
    assert.equal(cnhWithdrawal.anchors.USD.afterSnapshot, true);
    assert.deepEqual(currentRow.balances, {USD: 21210, HKD: 2804.88});
    assert.ok(Math.abs(currentRow.runningCash - (21210 + 359.6)) < 1e-9);
    assert.deepEqual(Object.keys(currentRow.anchors).sort(), ['CNH', 'HKD', 'USD']);
    assert.equal(currentRow.anchors.HKD.adjustment, 0);
    assert.equal(currentRow.anchors.HKD.afterSnapshot, false);
    assert.equal(currentRow.anchors.CNH.balance, 0);
});

test('zero and negative native anchors remain signed balance boundaries', () => {
    const projection = buildDatedCashBalanceProjection([
        {date: '2026-03-05', broker_cash_by_currency: {USD: 100, CNH: 25}},
        {date: '2026-03-06', broker_cash_by_currency: {USD: 90, CNH: 25}},
    ], {
        anchors: [
            {currency: 'USD', balance: -5, asOf: '2026-03-05'},
            {currency: 'CNH', balance: 0, asOf: '2026-03-05'},
        ],
        convertBalancesToBaseCash: convertAtFixtureRates,
    });

    assert.deepEqual(projection.projections.map(({balances}) => balances), [
        {USD: -5},
        {USD: -15},
    ]);
    assert.deepEqual(projection.projections.map(({runningCash}) => runningCash), [-5, -15]);
    assert.equal(projection.projections[0].anchors.CNH.adjustment, -25);
});

test('later direct evidence retires only its own currency anchor', () => {
    const rows = [
        {date: '2026-03-05', broker_cash_by_currency: {USD: 100, HKD: 78}},
        {date: '2026-03-06', broker_cash_by_currency: {USD: 100, HKD: 156}, boundary: 'HKD'},
        {date: '2026-03-07', broker_cash_by_currency: {USD: 90, HKD: 156}},
    ];
    const projection = buildDatedCashBalanceProjection(rows, {
        anchors: [
            {currency: 'USD', balance: 120, asOf: '2026-03-05'},
            {currency: 'HKD', balance: 70.2, asOf: '2026-03-05'},
        ],
        getBoundaryCurrencies: (row) => (row.boundary ? [row.boundary] : []),
        convertBalancesToBaseCash: convertAtFixtureRates,
    });

    assert.deepEqual(projection.projections.map(({balances}) => balances), [
        {USD: 120, HKD: 70.2},
        {USD: 120, HKD: 156},
        {USD: 110, HKD: 156},
    ]);
    assert.equal(projection.projections[1].anchors.HKD.active, false);
    assert.equal(projection.projections[1].anchors.HKD.adjustment, 0);
    assert.equal(projection.projections[2].anchors.USD.active, true);
});

test('an anchor dated after the latest row stays with the current snapshot', () => {
    const projection = buildDatedCashBalanceProjection(mixedDateReplayRows(), {
        anchors: [{currency: 'HKD', balance: 3000, asOf: '2026-03-07'}],
        convertBalancesToBaseCash: convertAtFixtureRates,
    });
    assert.deepEqual(projection, {applied: false, projections: []});
});

test('a timed anchor leaves earlier same-day rows on their replay balance', () => {
    const projection = buildDatedCashBalanceProjection([
        {date: '2026-03-02', datetime: '2026-03-02 09:00:00', broker_cash_by_currency: {USD: 38}},
        {date: '2026-03-02', datetime: '2026-03-02 15:30:00', broker_cash_by_currency: {USD: 40}},
        {date: '2026-03-02', datetime: '2026-03-02 18:00:00', broker_cash_by_currency: {USD: 30}},
    ], {
        anchors: [{currency: 'USD', balance: 40.25, asOf: '2026-03-02', asOfDateTime: '2026-03-02 15:30:00'}],
        convertBalancesToBaseCash: convertAtFixtureRates,
    });

    assert.deepEqual(projection.projections.map(({index, runningCash}) => ({index, runningCash})), [
        {index: 1, runningCash: 40.25},
        {index: 2, runningCash: 30.25},
    ]);
});

function makePastedUsdSavingsRow(sourceOverrides = {}) {
    return {
        broker: 'hsbc',
        account: ACCOUNT,
        account_type: 'USD Savings',
        date: '2026-03-03',
        type: 'deposit',
        currency: 'USD',
        net_amount_raw: '1000.00',
        normalized: {net_amount: '1000.00'},
        source: {
            file_kind: 'hsbc_usd_account_text',
            broker: 'hsbc',
            account_number: ACCOUNT,
            account_type: 'USD Savings',
            balance_after_raw: '21500.00',
            row_number: 3,
            ledger_sequence: 3,
            cash_balance_scope: 'account',
            cash_balance_authoritative: true,
            source_sequence_sha256: SEQUENCE_SHA,
            ...sourceOverrides,
        },
    };
}

test('a legacy chronological marker on pasted USD Savings cash restates producer order', () => {
    const expected = {
        scopeKey: `HSBC|${ACCOUNT}|SAVINGS|USD`,
        currency: 'USD',
        balance: 21500,
    };
    assert.deepEqual(getInvestmentCashBalanceBoundary(makePastedUsdSavingsRow()), expected);
    assert.deepEqual(
        getInvestmentCashBalanceBoundary(makePastedUsdSavingsRow({ledger_sequence_order: 'chronological'})),
        expected,
    );

    const multicurrencyRow = makePastedUsdSavingsRow({
        file_kind: 'hsbc_multi_currency_cash_account_text',
        cash_balance_authoritative: false,
        account_type: 'HKD Savings',
    });
    Object.assign(multicurrencyRow, {currency: 'HKD', account_type: 'HKD Savings'});
    assert.deepEqual(getInvestmentCashBalanceBoundary(multicurrencyRow), {
        scopeKey: `HSBC|${ACCOUNT}|SAVINGS|HKD`,
        currency: 'HKD',
        balance: 21500,
    });
    multicurrencyRow.source.ledger_sequence_order = 'chronological';
    assert.equal(getInvestmentCashBalanceBoundary(multicurrencyRow), null);

    for (const [label, overrides] of [
        ['divergent ledger sequence', {ledger_sequence_order: 'chronological', ledger_sequence: 4}],
        ['unknown order marker', {ledger_sequence_order: 'reverse'}],
        ['direction override', {ledger_sequence_order: 'chronological', source_sequence_direction: 1}],
        ['missing sequence digest', {ledger_sequence_order: 'chronological', source_sequence_sha256: ''}],
        ['conflicting digest alias', {ledger_sequence_order: 'chronological', source_file_sha256: 'd'.repeat(64)}],
    ]) {
        assert.equal(getInvestmentCashBalanceBoundary(makePastedUsdSavingsRow(overrides)), null, label);
    }
});
