/* HSBC settlement-consumer regressions. Code version: v1.0.0
 * Added: Either-side, zero-fee, and split-fee settlement consumer regressions.
 * Added: Stock-details runtime metadata matches its cache-key source version.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {
    buildHsbcCashSettlementBoundaryPlan,
    getTransactionEvidencedTradeCashAmount,
    getTransactionEvidencedTradePrincipalAmount,
} from './context.mjs';

const HSBC_SEQUENCE_SHA_A = 'a'.repeat(64);

test('Investment stock-details runtime metadata matches its source version', async () => {
    const source = await readFile(new URL(
        '../../../../app/web/static/assets/js/investment/stock-details.js',
        import.meta.url,
    ), 'utf8');
    const sourceVersion = source.match(/Code version:\s*(v\d+\.\d+\.\d+)/)?.[1];
    const runtimeVersion = source.match(
        /export const INVESTMENT_STOCK_DETAILS_MODULE_VERSION = '(v\d+\.\d+\.\d+)';/,
    )?.[1];

    assert.ok(sourceVersion);
    assert.equal(runtimeVersion, sourceVersion);
});

test('HSBC settlement consumers accept fees on either side of the principal', () => {
    for (const feeSequence of [43, 45]) {
        const principal = {
            date: '2026-09-18', amount_raw: '200',
            balance_after_raw: feeSequence < 44 ? '1199.99' : '1200',
            row_number: 44, ledger_sequence: 44, currency: 'USD',
            account_number: 'HSBC-TEST', account_type: 'USD Savings',
            source_file_kind: 'hsbc_usd_account_text',
            source_sequence_sha256: HSBC_SEQUENCE_SHA_A,
            reference: 'REF S100001001 SEC', role: 'principal',
        };
        const sell = {
            broker: 'hsbc', account: 'HSBC-TEST', date: '2026-09-17',
            type: 'sell', ticker: 'QQQI', currency: 'USD',
            net_amount_raw: '200', commission_raw: '-0.01',
            normalized: {net_amount: '200', commission: '-0.01'},
            source: {
                statement_order_id: 'S-100001', cash_settlement_date: '2026-09-18',
                cash_settlement_amount_raw: '200',
                cash_settlement_postings: [principal, {
                    ...principal, amount_raw: '-0.01', role: 'fee',
                    row_number: feeSequence, ledger_sequence: feeSequence,
                    balance_after_raw: feeSequence < 44 ? '999.99' : '1199.99',
                }],
            },
        };

        assert.equal(buildHsbcCashSettlementBoundaryPlan([sell]).length, 2);
        assert.equal(getTransactionEvidencedTradeCashAmount(sell), 199.99);
    }
});

test('HSBC settlement consumers accept principal-only evidence with zero commission', () => {
    const sell = {
        broker: 'hsbc', account: 'HSBC-TEST', date: '2026-09-17',
        type: 'sell', ticker: 'QQQI', currency: 'USD',
        net_amount_raw: '200000', commission_raw: '0',
        normalized: {net_amount: '200000', commission: '0'},
        source: {
            statement_order_id: 'S-100001', cash_settlement_date: '2026-09-18',
            cash_settlement_amount_raw: '200000',
            cash_settlement_postings: [{
                date: '2026-09-18', amount_raw: '200000', balance_after_raw: '201000',
                row_number: 44, ledger_sequence: 44, currency: 'USD',
                account_number: 'HSBC-TEST', account_type: 'USD Savings',
                source_file_kind: 'hsbc_usd_account_text',
                source_sequence_sha256: HSBC_SEQUENCE_SHA_A,
                reference: 'REF S100001001 SEC', role: 'principal',
            }],
        },
    };

    assert.equal(buildHsbcCashSettlementBoundaryPlan([sell]).length, 1);
    assert.equal(getTransactionEvidencedTradeCashAmount(sell), 200_000);
    assert.equal(getTransactionEvidencedTradePrincipalAmount(sell), 200_000);

    sell.source.cash_settlement_postings.push(
        ...[-2.5, -3.06].map((amount, index) => ({
            ...sell.source.cash_settlement_postings[0],
            role: 'fee', amount_raw: String(amount), balance_after_raw: '',
            row_number: 45 + index, ledger_sequence: 45 + index,
        })),
    );
    sell.commission_raw = '-5.56';
    sell.normalized.commission = '-5.56';
    assert.equal(buildHsbcCashSettlementBoundaryPlan([sell]).length, 3);
    assert.equal(getTransactionEvidencedTradeCashAmount(sell), 199_994.44);
});
