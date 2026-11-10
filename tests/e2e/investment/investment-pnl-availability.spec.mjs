/* Code version: v1.0.1
 * Intercepted account evidence keeps P&L component availability independent.
 */
import {expect, test} from '@playwright/test';
import {mockInvestmentReadApis} from '../critical_flows/support.mjs';

const trade = (account, type, date, quantity, price = 10) => ({
    broker: 'ibkr', account, ticker: 'TEST', currency: 'USD', type, date,
    datetime: `${date} 12:00:00`, quantity, price,
    amount: (type === 'buy' ? -1 : 1) * quantity * price,
});
const holding = (page) => page.locator(
    '#investment_holdings_panel:not([hidden]) .investment-holdings-table-scroll tr[data-investment-holdings-ticker="TEST"]',
);
const total = (page, metric) => page.locator(
    `#investment_holdings_panel:not([hidden]) [data-investment-live-field="summary_${metric}_pnl"]`,
);
const stockMetric = (page, label) => page.locator('.investment-stock-details-metric-card')
    .filter({has: page.locator('.trade-metric-label').getByText(label, {exact: true})})
    .locator('.trade-metric-value').first();

async function preparePage(page) {
    await page.clock.setFixedTime(new Date('2026-07-22T14:00:00Z'));
    await page.addInitScript(() => {
        const nativeSetTimeout = window.setTimeout.bind(window);
        window.setTimeout = (callback, delay, ...args) => {
            if (delay === 60_000 && typeof callback === 'function') {
                window.__testPnlQuotePoll = () => callback(...args);
                return 0;
            }
            return nativeSetTimeout(callback, delay, ...args);
        };
    });
}

test('partial historical realized P&L preserves known current unrealized values through quotes and rerender', async ({page}) => {
    await preparePage(page);
    let price = 12;
    await mockInvestmentReadApis(page, {
        transactions: [
            trade('CLOSED', 'sell', '2026-07-01', 10),
            trade('CLOSED', 'buy', '2026-07-02', 10),
            trade('CURRENT', 'buy', '2026-07-21', 10),
        ],
        priceHistoryByTicker: {TEST: [{date: '2026-07-21', close: 11}]},
        realtimeQuotes: () => [{
            ticker: 'TEST', price, timestamp: '2026-07-22 10:00',
            session: 'intraday', session_date: '2026-07-22', market: 'US', source: 'yfinance',
        }],
        marketSession: {session: 'intraday', is_trading_day: true, is_realtime_allowed: true, session_date: '2026-07-22'},
    });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/trade/investment?view=holdings');
    await expect(holding(page).locator('td').nth(6)).toContainText('Unavailable');
    await expect(holding(page).locator('[data-investment-live-field="unrealized_pnl"]')).toHaveAttribute('data-investment-live-display', '20.00');
    await expect(total(page, 'realized')).toHaveText('Partial · total unavailable');
    await expect(total(page, 'realized')).not.toHaveAttribute('data-investment-live-number');
    await expect(total(page, 'unrealized')).toHaveAttribute('data-investment-live-display', '20.00');
    await expect(total(page, 'cumulative')).toHaveText('Partial · total unavailable');
    await expect(holding(page).locator('[data-investment-live-field="daily_realized_pnl"]')).toHaveCount(0);
    await expect(holding(page).locator('[data-investment-live-field="daily_unrealized_pnl"]')).toHaveAttribute('data-investment-live-display', '+10.00');

    price = 13;
    await expect.poll(() => page.evaluate(() => typeof window.__testPnlQuotePoll)).toBe('function');
    await page.evaluate(() => window.__testPnlQuotePoll());
    await expect(total(page, 'unrealized')).toHaveAttribute('data-investment-live-display', '30.00');
    await expect(total(page, 'realized')).toHaveText('Partial · total unavailable');
    await expect(total(page, 'cumulative')).not.toHaveAttribute('data-investment-live-number');
    await page.reload();
    await expect(total(page, 'unrealized')).toHaveAttribute('data-investment-live-display', '30.00');
    await holding(page).locator('[data-investment-stock-link]').click();
    await expect(stockMetric(page, 'Unrealized P&L')).toHaveText('30.00');
    await expect(stockMetric(page, 'Realized P&L')).toHaveText('Unavailable');
    await expect(stockMetric(page, 'Total P&L')).toHaveText('Unavailable');
    expect(errors).toEqual([]);
});

test('known broker realized P&L remains visible when current native basis is unknown', async ({page}) => {
    await preparePage(page);
    await mockInvestmentReadApis(page, {
        transactions: [trade('CURRENT', 'buy', '2026-07-21', 10)],
        priceHistoryByTicker: {TEST: [{date: '2026-07-21', close: 12}]},
        brokerSummaries: {ibkr: {
            broker: 'ibkr', account: 'CURRENT',
            position_snapshot_authoritative: true, position_snapshot_as_of: '2026-07-21',
            position_snapshot: {TEST: {quantity: '10', cost_basis_status: 'unknown', currency: 'USD', as_of: '2026-07-21'}},
            performance_snapshot_authoritative: true, performance_snapshot_as_of: '2026-07-21',
            performance_snapshot: {TEST: {currency: 'USD', realized_total: '7'}},
        }},
    });
    await page.goto('/trade/investment?view=holdings');
    await expect(holding(page).locator('td').nth(6).locator('.trade-metric-value').first()).toHaveText('7.00');
    const unrealized = holding(page).locator('[data-investment-live-field="unrealized_pnl"]');
    await expect(unrealized).toHaveAttribute('data-investment-live-display', 'Unavailable');
    await expect(unrealized.locator('[data-animated-number-sr]')).toHaveCount(1);
    await expect(unrealized.locator('[data-animated-number-sr]')).toHaveText('Unavailable');
    await expect(total(page, 'realized')).toHaveAttribute('data-investment-live-display', '7.00');
    await expect(total(page, 'unrealized')).not.toHaveAttribute('data-investment-live-number');
    await expect(total(page, 'cumulative')).toContainText('Unavailable');
    await holding(page).locator('[data-investment-stock-link]').click();
    await expect(stockMetric(page, 'Realized P&L')).toHaveText('7.00');
    await expect(stockMetric(page, 'Unrealized P&L')).toHaveText('Unavailable');
    await expect(stockMetric(page, 'Total P&L')).toHaveText('Unavailable');
});

test('unverified security-transfer basis still blocks both P&L components', async ({page}) => {
    await preparePage(page);
    await mockInvestmentReadApis(page, {
        transactions: [trade('CURRENT', 'buy', '2026-07-21', 10)],
        priceHistoryByTicker: {TEST: [{date: '2026-07-21', close: 12}]},
        summary: {security_transfer_reconciliation: {
            aggregate_holdings_available: true, pnl_unavailable_tickers: ['TEST'],
            pnl_unavailable_reason: 'unverified_transfer_basis',
        }},
    });
    await page.goto('/trade/investment?view=holdings');
    await expect(holding(page).locator('td').nth(6)).toContainText('Unavailable');
    const unrealized = holding(page).locator('[data-investment-live-field="unrealized_pnl"]');
    await expect(unrealized).toHaveAttribute('data-investment-live-display', 'Unavailable');
    await expect(unrealized.locator('[data-animated-number-sr]')).toHaveCount(1);
    await expect(unrealized.locator('[data-animated-number-sr]')).toHaveText('Unavailable');
    await expect(total(page, 'realized')).not.toHaveAttribute('data-investment-live-number');
    await expect(total(page, 'unrealized')).not.toHaveAttribute('data-investment-live-number');
    await expect(total(page, 'cumulative')).not.toHaveAttribute('data-investment-live-number');
});


test('an unpriced later acquisition keeps unrealized and cumulative P&L unavailable through quote refresh', async ({page}) => {
    await preparePage(page);
    let price = 12;
    // This source record genuinely has no price, amount, raw, or normalized money.
    const unpricedBuy = {
        broker: 'ibkr', account: 'CURRENT', ticker: 'TEST', currency: 'USD',
        type: 'buy', date: '2026-07-22', quantity: 5,
    };
    await mockInvestmentReadApis(page, {
        transactions: [trade('CURRENT', 'buy', '2026-07-21', 10), unpricedBuy],
        priceHistoryByTicker: {TEST: [{date: '2026-07-21', close: 11}]},
        realtimeQuotes: () => [{
            ticker: 'TEST', price, timestamp: '2026-07-22 10:00',
            session: 'intraday', session_date: '2026-07-22', market: 'US', source: 'yfinance',
        }],
        marketSession: {session: 'intraday', is_trading_day: true, is_realtime_allowed: true, session_date: '2026-07-22'},
    });
    const assertUnknownBasis = async () => {
        await expect(holding(page).locator('td').nth(2)).toHaveText('-');
        await expect(holding(page).locator('td').nth(6).locator('.trade-metric-value').first()).toHaveText('0.00');
        await expect(total(page, 'realized')).toHaveAttribute('data-investment-live-number', '0');
        await expect(total(page, 'realized')).toHaveAttribute('data-investment-live-display', '0.00');
        const unrealized = holding(page).locator('[data-investment-live-field="unrealized_pnl"]');
        await expect(unrealized).toHaveAttribute('data-investment-live-display', 'Unavailable');
        await expect(unrealized.locator('[data-animated-number-sr]')).toHaveCount(1);
        await expect(unrealized.locator('[data-animated-number-sr]')).toHaveText('Unavailable');
        await expect(unrealized).not.toHaveAttribute('data-investment-live-number');
        for (const field of ['unrealized', 'cumulative']) {
            await expect(total(page, field)).toHaveText('Unavailable');
            await expect(total(page, field)).not.toHaveAttribute('data-investment-live-number');
        }
        await expect(holding(page).locator('[data-investment-live-field="daily_unrealized_pnl"]').locator('..')).toBeHidden();
    };
    await page.goto('/trade/investment?view=holdings');
    await expect(holding(page).locator('[data-investment-live-field="last"]')).toHaveAttribute('data-investment-live-display', '12.00');
    await assertUnknownBasis();
    price = 13;
    await expect.poll(() => page.evaluate(() => typeof window.__testPnlQuotePoll)).toBe('function');
    await page.evaluate(() => window.__testPnlQuotePoll());
    // A changed observed quote proves the updater ran; it cannot price the purchase.
    await expect(holding(page).locator('[data-investment-live-field="last"]')).toHaveAttribute('data-investment-live-display', '13.00');
    await assertUnknownBasis();
    await page.reload();
    await expect(holding(page).locator('[data-investment-live-field="last"]')).toHaveAttribute('data-investment-live-display', '13.00');
    await assertUnknownBasis();
});
