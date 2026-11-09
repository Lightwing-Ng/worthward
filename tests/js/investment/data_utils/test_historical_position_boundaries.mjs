/* Historical broker-position boundary regressions. Code version: v1.0.0 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createUtils} from './context.mjs';

const ACCOUNT = 'U00000001';

function trade(type, quantity, price, date, ticker = 'SAMPLE') {
    const amount = quantity * price * (type === 'buy' ? -1 : 1);
    return {
        broker: 'ibkr', account: ACCOUNT, ticker, currency: 'USD', type,
        date, datetime: `${date} 12:00:00`, quantity, price, amount,
        normalized: {
            position_quantity: String(quantity), unit_price: String(price),
            net_amount: String(amount),
        },
        source: {file_kind: 'gainskeeper'},
    };
}

function buildCase() {
    const evidence = {
        evidence_id: 'synthetic-historical-boundary',
        broker: 'ibkr', account: ACCOUNT,
        position_snapshot_authoritative: true,
        position_snapshot_source: 'ibkr_user_verified_app_positions',
        position_snapshot_as_of: '2026-01-05',
        position_snapshot: {
            OTHER: {quantity: '1', currency: 'USD', as_of: '2026-01-05 18:00:00'},
        },
        holdings_validation: {
            matched: true, history_complete: false,
            comparison_scope: 'user_confirmed_current_position_snapshot',
        },
    };
    const selected = {
        broker: 'ibkr', account: ACCOUNT,
        position_snapshot_authoritative: true,
        position_snapshot_as_of: '2026-01-06',
        position_snapshot: {
            OTHER: {
                quantity: '2', currency: 'USD', cost_price: '5',
                as_of: '2026-01-06 18:00:00',
            },
        },
        performance_snapshot_authoritative: true,
        performance_snapshot_as_of: '2026-01-02',
        performance_snapshot: {SAMPLE: {currency: 'USD', realized_total: '2'}},
        holdings_validation: {matched: false},
        evidence: [evidence],
    };
    const payload = {broker_snapshots: {[`ibkr:${ACCOUNT}`]: selected}};
    const rows = [
        trade('buy', 4, 10, '2026-01-01'),
        trade('sell', 1, 12, '2026-01-02'),
        trade('sell', 3, 15, '2026-01-04'),
        trade('buy', 2, 5, '2026-01-01', 'OTHER'),
    ];
    return {payload, rows, selected, evidence};
}

function summarize(fixture, run) {
    const previous = globalThis.window;
    globalThis.window = {WORTHWARD_INVESTMENT_DATA: fixture.payload};
    try {
        const summaries = createUtils().buildTickerSummaries(
            fixture.rows, {SAMPLE: 16, OTHER: 6}, 0, {},
        );
        const sample = summaries.find((row) => row.ticker === 'SAMPLE');
        return run(sample, summaries);
    } finally {
        if (previous === undefined) delete globalThis.window;
        else globalThis.window = previous;
    }
}

function assertComplete(sample, expectedRealized, expectedIncrement) {
    assert.equal(sample.realizedPnlUnavailable, false);
    assert.equal(sample.realizedPnlStatus, 'complete');
    assert.equal(sample.realizedPnl, expectedRealized);
    const reconciliation = sample.realizedPnlAccounts[0].reconciliation;
    assert.equal(reconciliation.coverageStatus, 'complete');
    assert.equal(reconciliation.baselineRealizedPnlLocal, 2);
    assert.equal(reconciliation.incrementalRealizedPnlLocal, expectedIncrement);
    assert.equal(reconciliation.realizedPnlLocal, expectedRealized);
    assert.equal(reconciliation.arithmeticCheck.valid, true);
    assert.equal(reconciliation.replay.required, true);
    assert.equal(reconciliation.replay.status, 'complete');
    assert.equal(
        Object.values(sample.realizedPnlByDate).reduce((sum, value) => sum + value, 0),
        expectedRealized,
    );
    return reconciliation;
}

function assertUnavailable(sample) {
    assert.equal(sample.realizedPnlUnavailable, true);
    assert.equal(sample.realizedPnl, null);
    assert.notEqual(sample.realizedPnlStatus, 'complete');
    assert.equal(sample.realizedPnlAccounts[0].reconciliation.coverageStatus, 'unavailable');
    assert.deepEqual(sample.realizedPnlByDate, {});
}

test('retained historical proof restores a closed ticker without replacing current positions', () => {
    const fixture = buildCase();
    const original = structuredClone(fixture);
    summarize(fixture, (sample, summaries) => {
        const reconciliation = assertComplete(sample, 17, 15);
        assert.equal(
            reconciliation.replay.positionBoundaryEvidenceId,
            'synthetic-historical-boundary',
        );
        assert.equal(sample.shares, 0);
        assert.equal(sample.hasOpenPosition, false);
        assert.equal(reconciliation.asOf.positionSnapshot, '2026-01-06');
        assert.deepEqual(sample.realizedPnlByDate, {'2026-01-02': 2, '2026-01-04': 15});
        assert.equal(summaries.find((row) => row.ticker === 'OTHER').shares, 2);
    });
    assert.deepEqual(fixture, original);
});

test('a proven transfer after the performance baseline changes inventory without adding realized gains', () => {
    const fixture = buildCase();
    fixture.rows[2] = {
        ...trade('transfer_out', 3, 15, '2026-01-04'),
        amount: 0,
        normalized: {position_quantity: '3', unit_price: '15', net_amount: '0'},
        transfer_out_cost_basis_status: 'known', transfer_out_cost_basis_raw: '30',
        transfer_out_cost_basis_method: 'fifo_reconstructed',
    };
    summarize(fixture, (sample) => {
        assertComplete(sample, 2, 0);
        assert.equal(sample.shares, 0);
    });
});

test('an explicit historical quantity can pass scoped replay despite other account mismatches', () => {
    const fixture = buildCase();
    fixture.evidence.position_snapshot.SAMPLE = {
        quantity: '0', currency: 'USD', as_of: '2026-01-05 18:00:00',
    };
    fixture.evidence.holdings_validation = {matched: false};
    summarize(fixture, (sample) => assertComplete(sample, 17, 15));
});

test('later purchases retain current exposure after an older flat boundary proves realized history', () => {
    const fixture = buildCase();
    fixture.rows.push(trade('buy', 1, 20, '2026-01-07'));
    summarize(fixture, (sample) => {
        assertComplete(sample, 17, 15);
        assert.equal(sample.shares, 1);
        assert.equal(sample.totalCost, 20);
        assert.equal(sample.unrealizedPnl, -4);
    });
});

test('the newest eligible retained boundary owns replay provenance regardless of evidence order', () => {
    const fixture = buildCase();
    const older = structuredClone(fixture.evidence);
    older.evidence_id = 'synthetic-older-boundary';
    older.position_snapshot_as_of = '2026-01-04';
    older.position_snapshot.OTHER.as_of = '2026-01-04 18:00:00';
    fixture.selected.evidence.unshift(older);
    summarize(fixture, (sample) => {
        const reconciliation = assertComplete(sample, 17, 15);
        assert.equal(
            reconciliation.replay.positionBoundaryEvidenceId,
            'synthetic-historical-boundary',
        );
    });
});

const rejectedEvidenceCases = [
    ['absent historical evidence', (fixture) => { fixture.selected.evidence = []; }],
    ['foreign account', ({evidence}) => { evidence.account = 'U00000002'; }],
    ['missing account', ({evidence}) => { delete evidence.account; }],
    ['foreign broker', ({evidence}) => { evidence.broker = 'schwab'; }],
    ['missing broker', ({evidence}) => { delete evidence.broker; }],
    ['missing evidence identity', ({evidence}) => { delete evidence.evidence_id; }],
    ['missing source provenance', ({evidence}) => { delete evidence.position_snapshot_source; }],
    ['non-authoritative evidence', ({evidence}) => { evidence.position_snapshot_authoritative = false; }],
    ['unvalidated omitted-ticker evidence', ({evidence}) => { evidence.holdings_validation.matched = false; }],
    ['unsupported omitted-ticker coverage', ({evidence}) => { evidence.holdings_validation.history_complete = true; }],
    ['unconfirmed omitted-ticker scope', ({evidence}) => {
        evidence.holdings_validation.comparison_scope = 'partial_file_history';
    }],
    ['undated evidence', ({evidence}) => {
        delete evidence.position_snapshot_as_of;
        delete evidence.position_snapshot.OTHER.as_of;
    }],
    ['invalid boundary date', ({evidence}) => {
        evidence.position_snapshot_as_of = 'not-a-date';
        evidence.position_snapshot.OTHER.as_of = 'not-a-date';
    }],
    ['impossible calendar date', ({evidence}) => {
        evidence.position_snapshot_as_of = '2025-02-30';
        evidence.position_snapshot.OTHER.as_of = '2025-02-30 18:00:00';
    }],
    ['invalid clock time', ({evidence}) => {
        evidence.position_snapshot.OTHER.as_of = '2026-01-05 25:00:00';
    }],
    ['evidence later than the selected boundary', ({evidence}) => {
        evidence.position_snapshot_as_of = '2026-01-08';
        evidence.position_snapshot.OTHER.as_of = '2026-01-08 18:00:00';
    }],
    ['explicit currency mismatch', ({evidence}) => {
        evidence.position_snapshot.SAMPLE = {
            quantity: '0', currency: 'EUR', as_of: '2026-01-05 18:00:00',
        };
    }],
    ['only foreign-currency anchors', ({evidence}) => {
        evidence.position_snapshot.OTHER.currency = 'EUR';
    }],
    ['missing anchor currency', ({evidence}) => {
        delete evidence.position_snapshot.OTHER.currency;
    }],
    ['explicit invalid quantity', ({evidence}) => {
        evidence.position_snapshot.SAMPLE = {
            quantity: 'unknown', currency: 'USD', as_of: '2026-01-05 18:00:00',
        };
    }],
    ['explicit quantity disagreement', ({evidence}) => {
        evidence.position_snapshot.SAMPLE = {
            quantity: '2', currency: 'USD', as_of: '2026-01-05 18:00:00',
        };
    }],
    ['missing opening inventory', ({rows}) => { rows.splice(0, 1); }],
    ['unknown execution cost', ({rows}) => {
        delete rows[0].price;
        delete rows[0].amount;
        delete rows[0].normalized.unit_price;
        delete rows[0].normalized.net_amount;
    }],
];

for (const [label, change] of rejectedEvidenceCases) {
    test(`${label} cannot attest omitted current-position history`, () => {
        const fixture = buildCase();
        change(fixture);
        summarize(fixture, assertUnavailable);
    });
}

test('historical evidence cannot bypass an explicit conflicting selected quantity', () => {
    const fixture = buildCase();
    fixture.selected.position_snapshot.SAMPLE = {
        quantity: '1', currency: 'USD', as_of: '2026-01-06 18:00:00',
    };
    summarize(fixture, assertUnavailable);
});

for (const [label, entry] of [
    ['null entry', null],
    ['invalid quantity', {quantity: 'unknown', currency: 'USD', as_of: '2026-01-06 18:00:00'}],
]) {
    test(`historical evidence cannot bypass a selected ${label}`, () => {
        const fixture = buildCase();
        fixture.selected.position_snapshot.SAMPLE = entry;
        summarize(fixture, assertUnavailable);
    });
}

test('a transfer with unsupported carried basis cannot gain completeness from a historical boundary', () => {
    const fixture = buildCase();
    fixture.rows[2] = {
        ...trade('transfer_out', 3, 15, '2026-01-04'),
        amount: 0,
        normalized: {position_quantity: '3', unit_price: '15', net_amount: '0'},
        transfer_out_cost_basis_status: 'known', transfer_out_cost_basis_raw: '29',
        transfer_out_cost_basis_method: 'fifo_reconstructed',
    };
    summarize(fixture, assertUnavailable);
});

test('an explicit historical flat boundary cannot invent proceeds for an unpriced later sale', () => {
    const fixture = buildCase();
    fixture.evidence.position_snapshot.SAMPLE = {
        quantity: '0', currency: 'USD', as_of: '2026-01-05 18:00:00',
    };
    const sale = fixture.rows[2];
    delete sale.price;
    delete sale.amount;
    delete sale.normalized.unit_price;
    delete sale.normalized.net_amount;
    summarize(fixture, assertUnavailable);
});

for (const source of ['normalized net amount', 'top-level amount']) {
    for (const netAmount of [-1, 0]) {
        for (const representation of ['number', 'string']) {
            test(`${source} preserves signed sale proceeds ${netAmount} as a ${representation}`, () => {
                const fixture = buildCase();
                fixture.evidence.position_snapshot.SAMPLE = {
                    quantity: '0', currency: 'USD', as_of: '2026-01-05 18:00:00',
                };
                const sale = fixture.rows[2];
                const reportedAmount = representation === 'string' ? String(netAmount) : netAmount;
                sale.price = 0.1;
                sale.normalized.unit_price = '0.1';
                sale.normalized.commission = String(netAmount === -1 ? -1.3 : -0.3);
                sale.amount = reportedAmount;
                if (source === 'normalized net amount') {
                    sale.normalized.net_amount = reportedAmount;
                } else {
                    delete sale.normalized.net_amount;
                }
                const original = structuredClone(fixture);
                const expectedIncrement = netAmount - 30;
                summarize(fixture, (sample) => {
                    assertComplete(sample, 2 + expectedIncrement, expectedIncrement);
                    assert.deepEqual(sample.realizedPnlByDate, {
                        '2026-01-02': 2, '2026-01-04': expectedIncrement,
                    });
                });
                assert.deepEqual(fixture, original);
            });
        }
    }
}

for (const missingNetAmount of [undefined, null, '', '   ']) {
    test(`unknown sale proceeds remain unavailable with normalized net ${JSON.stringify(missingNetAmount)}`, () => {
        const fixture = buildCase();
        fixture.evidence.position_snapshot.SAMPLE = {
            quantity: '0', currency: 'USD', as_of: '2026-01-05 18:00:00',
        };
        const sale = fixture.rows[2];
        delete sale.price;
        delete sale.amount;
        delete sale.normalized.unit_price;
        if (missingNetAmount === undefined) {
            delete sale.normalized.net_amount;
        } else {
            sale.normalized.net_amount = missingNetAmount;
        }
        summarize(fixture, assertUnavailable);
    });
}

test('price-only sale evidence retains a fee that exceeds gross proceeds', () => {
    const fixture = buildCase();
    fixture.evidence.position_snapshot.SAMPLE = {
        quantity: '0', currency: 'USD', as_of: '2026-01-05 18:00:00',
    };
    const sale = fixture.rows[2];
    sale.price = 0.01;
    sale.normalized.unit_price = '0.01';
    sale.normalized.commission = '-1.03';
    delete sale.amount;
    delete sale.normalized.net_amount;
    summarize(fixture, (sample) => assertComplete(sample, -29, -31));
});

test('explicit normalized zero proceeds take precedence over a positive fallback amount', () => {
    const fixture = buildCase();
    fixture.evidence.position_snapshot.SAMPLE = {
        quantity: '0', currency: 'USD', as_of: '2026-01-05 18:00:00',
    };
    const sale = fixture.rows[2];
    sale.price = 0.01;
    sale.normalized.unit_price = '0.01';
    sale.normalized.commission = '-0.03';
    sale.normalized.net_amount = '0';
    sale.amount = 0.03;
    summarize(fixture, (sample) => assertComplete(sample, -28, -30));
});

for (const netAmount of [-1, 0]) {
    test(`raw cash alias preserves signed sale proceeds ${netAmount}`, () => {
        const fixture = buildCase();
        fixture.evidence.position_snapshot.SAMPLE = {
            quantity: '0', currency: 'USD', as_of: '2026-01-05 18:00:00',
        };
        const sale = fixture.rows[2];
        sale.price = 0.1;
        sale.normalized.unit_price = '0.1';
        sale.cash = String(netAmount);
        delete sale.amount;
        delete sale.normalized.net_amount;
        summarize(fixture, (sample) => assertComplete(sample, netAmount - 28, netAmount - 30));
    });
}

for (const source of ['normalized net amount', 'top-level amount', 'raw cash']) {
    test(`malformed explicit ${source} cannot fall back to a valid price`, () => {
        const fixture = buildCase();
        fixture.evidence.position_snapshot.SAMPLE = {
            quantity: '0', currency: 'USD', as_of: '2026-01-05 18:00:00',
        };
        const sale = fixture.rows[2];
        if (source === 'normalized net amount') {
            sale.normalized.net_amount = 'unknown';
        } else {
            delete sale.normalized.net_amount;
            if (source === 'top-level amount') {
                sale.amount = 'unknown';
            } else {
                delete sale.amount;
                sale.cash = 'unknown';
            }
        }
        summarize(fixture, assertUnavailable);
    });
}
