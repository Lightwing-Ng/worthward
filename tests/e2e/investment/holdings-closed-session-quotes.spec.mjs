/* Closed-session quote recovery values Holdings without a live indicator. Code version: v1.0.0 */

import {expect, test} from '@playwright/test';
import {mockInvestmentReadApis} from '../critical_flows/support.mjs';

for (const scenario of [
    {name: 'Friday after post-market close', now: '2026-10-31T00:30:00Z', sessionDate: '2026-10-30'},
    {name: 'Saturday', now: '2026-10-31T16:00:00Z', sessionDate: '2026-10-31'},
]) {
    test(`Holdings uses the latest closed-session quote on ${scenario.name}`, async ({page}) => {
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.addInitScript((timestamp) => {
            const RealDate = Date;
            const now = new RealDate(timestamp).valueOf();
            window.Date = class FixedDate extends RealDate {
                constructor(...args) {
                    super(...(args.length ? args : [now]));
                }

                static now() {
                    return now;
                }
            };
        }, scenario.now);
        const transactions = [{
            ledger_no: 1, broker: 'ibkr', date: '2026-10-29', type: 'buy',
            ticker: 'QQQ', currency: 'USD', quantity: 10, price: 100, amount: -1_000,
        }];
        await mockInvestmentReadApis(page, {
            startingCash: 10_000,
            transactions,
            priceHistoryByTicker: {
                QQQ: [{date: '2026-10-29', close: 100}, {date: '2026-10-30', close: 120}],
            },
            marketSession: {
                session: 'off', session_date: scenario.sessionDate,
                is_trading_day: scenario.sessionDate === '2026-10-30', is_realtime_allowed: false,
            },
            realtimeQuotes: [],
            intradayRows: () => [],
        });
        const quoteRequests = [];
        await page.route('**/api/investment/realtime-quotes?*', async (route) => {
            const requestedTickers = new URL(route.request().url()).searchParams.getAll('ticker');
            quoteRequests.push(requestedTickers);
            await route.fulfill({json: {
                success: true,
                quotes: [{
                    ticker: 'QQQ', price: 123.45, timestamp: '2026-10-30 19:59',
                    session: 'post', session_date: '2026-10-30', market: 'US', source: 'longbridge',
                }],
            }});
        });
        await page.goto('/trade/investment?view=holdings');
        const panel = page.locator('#investment_holdings_panel:not([hidden])');
        const row = panel.locator('.investment-holdings-table-scroll tr[data-investment-holdings-ticker="QQQ"]');
        await expect(row.locator('[data-investment-live-field="last"]')).toHaveText('123.45');
        await expect(row.locator('[data-investment-live-field="market_value"]')).toHaveText('1,234.50');
        await expect(panel.locator('[data-investment-live-field="summary_cash_balance"]')).toHaveText('9,000.00');
        await expect(panel.locator('[data-investment-live-field="summary_market_value"]')).toHaveText('1,234.50');
        await expect(panel.locator('[data-investment-live-field="summary_total_equity"]')).toHaveText('10,234.50');
        await expect(row.locator('.investment-holdings-daily-pnl-badge:visible')).toHaveCount(0);
        await expect(panel.locator('.is-investment-realtime-pulse')).toHaveCount(0);
        await expect(page.locator('#investment_history tr[data-investment-history-row]')).toHaveCount(1);
        expect(await page.evaluate(() => window.WORTHWARD_INVESTMENT_DATA.transactions))
            .toEqual(transactions.map((transaction) => expect.objectContaining(transaction)));
        expect(quoteRequests).toContainEqual(['QQQ']);
        expect(errors).toEqual([]);
    });
}
