/* Code version: v1.0.0
 * Settled cash and unconfirmed execution prices retain the existing Description format.
 */
import {expect, test} from '@playwright/test';
import {mockInvestmentReadApis} from '../critical_flows/support.mjs';

function anonymousSell({ledger, date, price, order, status, pending = false}) {
    return {
        ledger_no: ledger,
        broker: 'hsbc', account: 'HSBC-ANONYMOUS', ticker: 'ALFA', type: 'sell',
        date, currency: 'USD', quantity: 1, quantity_abs: '1', price, amount: price,
        price_raw: String(price), net_amount_raw: String(price), commission_raw: '-0.02',
        normalized: {unit_price: String(price), net_amount: String(price), commission: '-0.02'},
        source: {
            file_kind: 'hsbc_order_status_text', statement_order_id: order,
            execution_price_status: status,
            execution_price_source: status === 'final_settled'
                ? 'hsbc_cash_settlement_amount' : 'hsbc_order_status_price',
            ...(pending
                ? {cash_replay_pending_settlement: true}
                : {cash_settlement_amount_raw: String(price)}),
        },
    };
}

test('history separates settled cash from pending cash without changing price descriptions', async ({page}) => {
    const errors = [];
    const writes = [];
    const unexpectedFinancialReads = [];
    page.on('pageerror', (error) => errors.push(error.message));


    // Unmatched financial reads never reach the isolated server or any user store.
    await page.route('**/api/**', async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname === '/api/investment/session-token') {
            await route.fulfill({json: {success: true, investment_csrf_token: 'anonymous-history-session'}});
            return;
        }
        if (/^\/api\/(?:investment|credit-cards|market-session)\//.test(url.pathname)) {
            unexpectedFinancialReads.push(url.pathname);
            await route.abort();
            return;
        }
        await route.fallback();
    });
    await mockInvestmentReadApis(page, {
        brokers: ['hsbc'],
        transactions: [
            {
                ledger_no: 1, broker: 'hsbc', account: 'HSBC-ANONYMOUS',
                date: '2026-03-01', type: 'buy', ticker: 'ALFA', currency: 'USD',
                quantity: 3, quantity_abs: '3', price: 100, amount: -300,
            },
            anonymousSell({ledger: 2, date: '2026-03-02', price: 123.45, order: 'S-900123', status: 'settled_cash_price_unconfirmed'}),
            anonymousSell({ledger: 3, date: '2026-03-03', price: 124, order: 'S-900124', status: 'final_settled'}),
            anonymousSell({ledger: 4, date: '2026-03-04', price: 125, order: 'S-900125', status: 'provisional_pending_settlement', pending: true}),
        ],
        priceHistoryByTicker: {ALFA: [
            {date: '2026-03-01', close: 100},
            {date: '2026-03-02', close: 123.45},
            {date: '2026-03-03', close: 124},
            {date: '2026-03-04', close: 125},
        ]},
        intradayRows: () => [],
    });
    // This last-registered guard takes precedence over every API read mock.
    await page.route('**/api/**', async (route) => {
        if (route.request().method() !== 'GET') {
            writes.push({path: new URL(route.request().url()).pathname, method: route.request().method()});
            await route.abort();
            return;
        }
        await route.fallback();
    });

    await page.goto('/trade/investment?range=max');
    const rows = page.locator('#investment_history tr[data-investment-history-row]');
    await expect(rows).toHaveCount(4);
    const description = (order) => rows.filter({hasText: order}).locator('td').nth(4);
    await expect(description('S-900123')).toHaveText('ALFA @ 123.45 × 1 · S-900123');
    await expect(description('S-900123')).not.toContainText('*');
    await expect(description('S-900123')).not.toContainText('(limit)');
    await expect(description('S-900124')).toHaveText('ALFA @ 124.00 × 1 · S-900124');
    await expect(description('S-900125')).toHaveText('ALFA @ 125.00 × 1 · S-900125*');

    expect(unexpectedFinancialReads).toEqual([]);
    expect(writes).toEqual([]);
    expect(errors).toEqual([]);
});
