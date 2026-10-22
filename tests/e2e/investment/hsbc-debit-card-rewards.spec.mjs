/* Code version: v1.0.2
 * Anonymous intercepted bank cash verifies cashback without touching a store.
 */
import {expect, test} from '@playwright/test';
import {mockInvestmentReadApis} from '../critical_flows/support.mjs';

const fxHistory = {
    HKD: {dates: ['2026-02-02', '2026-02-03'], values: {'2026-02-02': 8, '2026-02-03': 10}},
    CNH: {dates: ['2026-02-02', '2026-02-03'], values: {'2026-02-02': 4, '2026-02-03': 5}},
};
const bankRow = (date, currency, amount, description, type = 'credit_interest') => ({
    broker: 'hsbc', date, currency, description, type,
    source: {
        file_kind: 'hsbc_multi_currency_cash_account_text', account_number: '000-555555-001',
        account_type: currency === 'CNH' ? 'RMB Savings' : `${currency} Savings`,
    },
    normalized: {net_amount: String(amount), cash_flow_amount: String(amount)},
});
const cashbackRows = () => [
    bankRow('2026-02-02', 'USD', 6, 'CASH REBATE 0055'),
    bankRow('2026-02-02', 'HKD', 16, 'CASH REBATE 0055 (02FEB26) CREDIT AS ADVISED'),
    bankRow('2026-02-02', 'CNH', 12, 'REFUND P HSBCPCLOTRANSIT', 'deposit'),
    bankRow('2026-02-03', 'USD', 8, 'REFUND P MEITUAN REBATE', 'cash_reward'),
    bankRow('2026-02-03', 'HKD', 30, 'REFUND P HSBCPCLOTRANSIT', 'deposit'),
    bankRow('2026-02-03', 'CNH', 20, 'CASH REBATE 0055'),
    bankRow('2026-02-03', 'USD', -1, 'CASH REBATE REV 0055', 'withdrawal'),
    bankRow('2026-02-03', 'HKD', -10, 'CASH REBATE REV 0055', 'withdrawal'),
    bankRow('2026-02-03', 'CNH', -5, 'CASH REBATE REV 0055', 'withdrawal'),
];
const transactions = () => [
    bankRow('2026-02-01', 'USD', 200, 'DEPOSIT', 'deposit'),
    bankRow('2026-02-02', 'USD', 2, 'USD CREDIT INTEREST'),
    bankRow('2026-02-02', 'USD', 3, 'KOL Rewards', 'kol_reward'),
    ...cashbackRows(),
    {broker: 'ibkr', date: '2026-02-01', type: 'deposit', currency: 'USD', amount: 50},
];
const metric = (page, key) => page.locator(`#investment_metrics_panel:not([hidden]) [data-metric-key="${key}"]`);
const kol = (page) => page.locator('#investment_metrics_panel:not([hidden]) .trade-metric-card')
    .filter({has: page.getByText('KOL rewards', {exact: true})}).locator('.trade-metric-value');
const openRewards = async (page) => {
    const rewards = metric(page, 'coupon-rebates-cash-rewards');
    await rewards.hover();
    await rewards.locator('[data-investment-metric-breakdown-trigger]').click();
    return rewards.locator('.investment-stock-details-metric-breakdown');
};
const mockBank = (page, {rows = transactions(), missingFx = false} = {}) => mockInvestmentReadApis(page, {
    transactions: rows, startingCash: 0, brokers: ['hsbc', 'ibkr'],
    fxRateHistoryByCurrency: missingFx ? {HKD: fxHistory.HKD} : fxHistory,
    intradayRows: () => [],
});

for (const width of [1280, 390]) {
    test(`HSBC debit-card cashback and campaign rewards stay separate from KOL at ${width}px`, async ({page}) => {
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.setViewportSize({width, height: 900});
        await mockBank(page);
        await page.goto('/trade/investment?view=metrics&metrics-broker=hsbc&broker=hsbc');
        const rewards = metric(page, 'coupon-rebates-cash-rewards');
        await expect(rewards.locator('.trade-metric-value')).toHaveText('23.00');
        await expect(kol(page)).toHaveText('3.00');
        await expect(metric(page, 'direct-deposits')).toHaveText(/200\.00/);
        await expect(metric(page, 'realized-pnl').locator('.trade-metric-value')).toHaveText('+28.00');
        const details = await openRewards(page);
        for (const text of [
            'Debit-card cashback · USD', 'Debit-card cashback · HKD', 'Debit-card cashback · CNH',
            'Debit-card campaign rewards · USD', 'Debit-card campaign rewards · HKD', 'Debit-card campaign rewards · CNH',
            'HKD 6.00', 'CNH 15.00', 'HKD 30.00', 'CNH 12.00',
        ]) await expect(details).toContainText(text);
        expect(await rewards.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
        await expect(page.locator('#investment_history tr[data-investment-history-row]')).toHaveCount(12);
        // Current cash values native HKD/CNH balances at the later FX, not income-date FX.
        await expect(page.locator('#investment_metrics_panel [data-investment-live-field="metrics_cash"]')).toHaveText('227.00');
        await page.locator('label[for="investment_view_holdings"]').click();
        const holdings = page.locator('#investment_holdings_panel:not([hidden])');
        await expect(holdings.locator('[data-investment-live-field="summary_cash_balance"]')).toHaveText('277.00');
        await expect(holdings.locator('[data-investment-live-field="summary_total_equity"]')).toHaveText('277.00');
        await expect(holdings.locator('.investment-holdings-summary-row td').nth(6).locator('.trade-metric-value').first()).toHaveText('28.00');
        expect(errors).toEqual([]);
    });
}

test('missing debit-card FX preserves native reward details without a partial converted total', async ({page}) => {
    await mockBank(page, {missingFx: true});
    await page.goto('/trade/investment?view=metrics&metrics-broker=hsbc&broker=hsbc');
    await expect(metric(page, 'coupon-rebates-cash-rewards').locator('.trade-metric-value')).toHaveText('Unavailable');
    await expect(kol(page)).toHaveText('3.00');
    await expect(metric(page, 'realized-pnl').locator('.trade-metric-value')).toHaveText('Unavailable');
    const details = await openRewards(page);
    await expect(details).toContainText('Debit-card cashback · CNH');
    await expect(details).toContainText('CNH 15.00');
    await expect(details).toContainText('Debit-card campaign rewards · CNH');
    await expect(details).toContainText('CNH 12.00');
});

test('legacy rows and canonical cash_reward rows give the same Metrics without any write request', async ({page}) => {
    let rows = transactions();
    const writes = [];
    page.on('request', (request) => {
        if (new URL(request.url()).pathname.startsWith('/api/') && request.method() !== 'GET') {
            writes.push({path: new URL(request.url()).pathname, method: request.method()});
        }
    });
    await mockBank(page, {rows: () => rows});
    await page.goto('/trade/investment?view=metrics&metrics-broker=hsbc&broker=hsbc');
    await expect(metric(page, 'coupon-rebates-cash-rewards').locator('.trade-metric-value')).toHaveText('23.00');
    rows = rows.map((row) => row.broker === 'hsbc'
        && /^(?:CASH REBATE|REFUND P (?:HSBCPCLOTRANSIT|MEITUAN REBATE))/.test(row.description)
        ? {...row, type: 'cash_reward'} : row);
    await page.reload();
    await expect(metric(page, 'coupon-rebates-cash-rewards').locator('.trade-metric-value')).toHaveText('23.00');
    await expect(metric(page, 'realized-pnl').locator('.trade-metric-value')).toHaveText('+28.00');
    await expect(kol(page)).toHaveText('3.00');
    await expect(metric(page, 'direct-deposits')).toHaveText(/200\.00/);
    expect(writes).toEqual([]);
});

test('HSBC debit-card rewards stay outside another broker scope', async ({page}) => {
    await mockBank(page);
    await page.goto('/trade/investment?view=metrics&metrics-broker=ibkr&broker=ibkr');
    await expect(metric(page, 'coupon-rebates-cash-rewards').locator('.trade-metric-value')).toHaveText('0.00');
    await expect(kol(page)).toHaveText('0.00');
    await expect(metric(page, 'direct-deposits')).toHaveText(/50\.00/);
    await expect(metric(page, 'realized-pnl').locator('.trade-metric-value')).toHaveText('0.00');
    await expect(page.locator('#investment_history tr[data-investment-history-row]')).toHaveCount(1);
});
