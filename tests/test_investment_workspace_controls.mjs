/* Investment workspace-control ordering regressions. Code version: v1.0.0 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    createInvestmentWorkspaceControlsRuntime,
} from '../app/web/static/assets/js/investment/runtime/workspace-controls.js';

test('a bound transfer advances its predecessor without delaying the receipt', () => {
    const runtime = {
        state: {},
        normalizeInvestmentBroker: (value) => String(value || '').trim().toLowerCase(),
        getTransactionBrokerCode: (txn) => txn?.broker || '',
        getNormalizedTransactionType: (txn) => txn?.type || '',
        normalizeLedgerDate: (value) => String(value || '').slice(0, 10),
        getTransactionAmount: (txn) => Number(txn?.amount),
        INVESTMENT_INTERNAL_TRANSFER_BANK_BROKERS: new Set(['hsbc']),
    };
    const {reorderInvestmentTransactionsForBoundTransfers} = (
        createInvestmentWorkspaceControlsRuntime(runtime)
    );
    const receipt = {
        id: 'receipt',
        broker: 'hsbc',
        date: '2026-09-17',
        type: 'deposit',
        amount: 100,
    };
    const sellA = {id: 'sell-a', broker: 'hsbc', date: '2026-09-17', type: 'sell'};
    const sellB = {id: 'sell-b', broker: 'hsbc', date: '2026-09-17', type: 'sell'};
    const withdrawal = {
        id: 'withdrawal',
        broker: 'ibkr',
        date: '2026-09-17',
        type: 'withdrawal',
        amount: -100,
    };

    const reordered = reorderInvestmentTransactionsForBoundTransfers(
        [receipt, sellA, sellB, withdrawal],
        {
            resolvedBindingsBySourceKey: new Map([
                ['bound-transfer', {sourceTxn: receipt, targetTxn: withdrawal}],
            ]),
        },
    );

    assert.deepEqual(
        reordered.map((txn) => txn.id),
        ['withdrawal', 'receipt', 'sell-a', 'sell-b'],
    );
});
