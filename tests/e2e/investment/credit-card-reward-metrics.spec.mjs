/* Code version: v1.0.4
 * Intercepted card rewards never enter a persistent store or investment cash.
 */
import {expect, test} from '@playwright/test';
import {mockInvestmentReadApis} from '../critical_flows/support.mjs';

const mockRewards = async (page, {missingFx = false} = {}) => mockInvestmentReadApis(page, {
    startingCash: 0,
    brokers: ['hsbc', 'ibkr'],
    transactions: [
        {broker: 'hsbc', date: '2026-09-01', type: 'deposit', currency: 'USD', amount: 1000},
        {
            broker: 'hsbc', date: '2026-09-02', type: 'kol_reward', currency: 'USD',
            description: 'KOL Rewards', normalized: {net_amount: '10.00', cash_flow_amount: '10.00'},
        },
        {broker: 'ibkr', date: '2026-09-01', type: 'deposit', currency: 'USD', amount: 20},
    ],
    creditCardRewards: {
        status: 'complete',
        transactions: [
            {id: 'reward-a', date: '2026-09-18', currency: 'HKD', amount: '15.00'},
            {id: 'reward-b', date: '2026-10-12', currency: 'HKD', amount: '25.00'},
        ],
        fx_rate_history_by_currency: missingFx ? {} : {
            HKD: {dates: ['2026-09-01'], values: {'2026-09-01': 8}},
        },
    },
});

for (const width of [1280, 390]) {
    test(`HSBC Rewards includes card RewardCash separately from KOL at ${width}px`, async ({page}) => {
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.setViewportSize({width, height: 900});
        await mockRewards(page);
        await page.goto('/trade/investment?view=metrics&metrics-broker=hsbc&broker=hsbc');
        const panel = page.locator('#investment_metrics_panel:not([hidden])');
        const rewards = panel.locator('[data-metric-key="coupon-rebates-cash-rewards"]');
        await expect(rewards.locator('.trade-metric-label')).toHaveText('Rewards');
        await expect(rewards.locator('.trade-metric-value')).toHaveText('5.00');
        const kol = panel.locator('.trade-metric-card').filter({has: page.getByText('KOL rewards', {exact: true})});
        await expect(kol.locator('.trade-metric-value')).toHaveText('10.00');
        await rewards.hover();
        await rewards.locator('[data-investment-metric-breakdown-trigger]').click();
        await expect(rewards.locator('.investment-stock-details-metric-breakdown')).toBeVisible();
        await expect(rewards).toContainText('RewardCash · HKD');
        await expect(rewards).toContainText('HKD 40.00');
        expect(await rewards.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
        const history = page.locator('#investment_history tr[data-investment-history-row]');
        await expect(history).toHaveCount(2);
        await page.locator('label[for="investment_view_holdings"]').click();
        const holdings = page.locator('#investment_holdings_panel:not([hidden])');
        await expect(holdings.locator('[data-investment-live-field="summary_cash_balance"]')).toHaveText('1,030.00');
        await expect(holdings.locator('[data-investment-live-field="summary_total_equity"]')).toHaveText('1,030.00');
        const realizedPnl = holdings.locator('.investment-holdings-summary-row td').nth(6)
            .locator('.trade-metric-value').first();
        await expect(realizedPnl).toHaveText('10.00');
        await page.goto('/trade/investment?view=metrics&metrics-broker=ibkr&broker=ibkr');
        await expect(page.locator('#investment_metrics_panel [data-metric-key="coupon-rebates-cash-rewards"] .trade-metric-value')).toHaveText('0.00');
        expect(errors).toEqual([]);
    });
}

test('missing card FX leaves investment P&L available and native RewardCash visible', async ({page}) => {
    await mockRewards(page, {missingFx: true});
    await page.goto('/trade/investment?view=metrics&metrics-broker=hsbc&broker=hsbc');
    const panel = page.locator('#investment_metrics_panel');
    const rewards = panel.locator('[data-metric-key="coupon-rebates-cash-rewards"]');
    await expect(rewards.locator('.trade-metric-value')).toHaveText('Unavailable');
    await rewards.hover();
    await rewards.locator('[data-investment-metric-breakdown-trigger]').click();
    await expect(rewards).toContainText('HKD 40.00');
    await expect(panel.locator('[data-metric-key="realized-pnl"] .trade-metric-value')).toHaveText('+10.00');
});

test('card import refreshes Rewards in place only after success and preserves KOL without investment reloads', async ({page}) => {
    const accountText = `Selected account's details
HSBC Red Credit Card
Account number:
4321-0000-0000-6789
RewardCash balance:
0
Account balance:
0.00 HKD
Current amount due:
0.00 HKD
Total minimum payment amount:
0.00 HKD
Payment due date:
06 Nov 2026
Transactions
13 Oct 2026
Card ending in 6789
PAY w/RC SAMPLE SHOP HK
20.00 HKD`;
    const cardRow = {
        transaction_date: '2026-10-13', card_last4: '6789', description: 'PAY w/RC SAMPLE SHOP HK',
        kind: 'rewardcash', status: 'posted', currency: 'HKD', amount: '20.00',
    };
    const importedRewards = {
        status: 'complete',
        transactions: [
            {id: 'reward-a', date: '2026-09-18', currency: 'HKD', amount: '15.00'},
            {id: 'reward-b', date: '2026-10-12', currency: 'HKD', amount: '25.00'},
            {id: 'reward-c', date: '2026-10-13', currency: 'HKD', amount: '20.00'},
        ],
        fx_rate_history_by_currency: {
            HKD: {dates: ['2026-09-01'], values: {'2026-09-01': 8}},
        },
    };
    const investmentRequests = [];
    const cardRequests = [];
    let imports = 0;
    page.on('request', (request) => {
        const path = new URL(request.url()).pathname;
        if ((path.startsWith('/api/investment/') && path !== '/api/investment/session-token')
            || path.startsWith('/api/market-session/')) {
            investmentRequests.push({path, method: request.method()});
        }
    });
    await mockRewards(page);
    await page.route('**/api/investment/session-token', (route) => route.fulfill({
        json: {success: true, investment_csrf_token: 'test-reward-session'},
    }));
    await page.route('**/api/credit-cards/**', (route) => route.abort());
    await page.route('**/api/credit-cards/hsbc/preview', (route) => {
        cardRequests.push({path: 'preview', body: route.request().postDataJSON()});
        return route.fulfill({json: {
            success: true, ready: true, source_sha256: 'a'.repeat(64),
            transactions: [cardRow], warnings: [],
        }});
    });
    await page.route('**/api/credit-cards/hsbc/import', (route) => {
        imports += 1;
        cardRequests.push({path: 'import', body: route.request().postDataJSON()});
        return imports === 1
            ? route.fulfill({status: 500, json: {
                success: false, error: 'The card import could not be saved.', credit_card_rewards: importedRewards,
            }})
            : route.fulfill({json: {
                success: true, ready: true, merged_transactions: [cardRow], warnings: [],
                credit_card_rewards: importedRewards,
            }});
    });
    await page.goto('/trade/investment?view=metrics&metrics-broker=hsbc&broker=hsbc');
    const panel = page.locator('#investment_metrics_panel:not([hidden])');
    const rewards = panel.locator('[data-metric-key="coupon-rebates-cash-rewards"]');
    const kol = panel.locator('.trade-metric-card').filter({has: page.getByText('KOL rewards', {exact: true})});
    await expect(rewards.locator('.trade-metric-value')).toHaveText('5.00');
    await expect(kol.locator('.trade-metric-value')).toHaveText('10.00');
    const investmentBefore = await page.evaluate(() => JSON.stringify(window.WORTHWARD_INVESTMENT_DATA.transactions));
    const rewardsBefore = await page.evaluate(() => JSON.stringify(window.WORTHWARD_INVESTMENT_DATA.credit_card_rewards));
    await page.locator('#toggle_form_button').click();
    await page.locator('#investment_import_broker').selectOption('hsbc', {force: true});
    await expect(page.locator('#hsbc_import_mode_paste')).toBeChecked();
    await page.evaluate((text) => {
        Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {readText: async () => text}});
    }, accountText);
    const paste = page.getByRole('button', {name: 'Paste HSBC account page text from clipboard', exact: true});
    const submit = page.locator('#investment_import_submit_button');
    const status = page.locator('#hsbc_credit_card_status');
    await paste.click();
    await expect(submit).toBeEnabled();
    const requestsBeforeImport = [...investmentRequests];
    await submit.click();
    await expect(status).toContainText('The card import could not be saved.');
    await expect(submit).toBeDisabled();
    await expect(rewards.locator('.trade-metric-value')).toHaveText('5.00');
    await expect(kol.locator('.trade-metric-value')).toHaveText('10.00');
    expect(await page.evaluate(() => JSON.stringify(window.WORTHWARD_INVESTMENT_DATA.credit_card_rewards))).toBe(rewardsBefore);
    await paste.click();
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(status).toContainText('Entries were read back from the credit-card ledger.');
    await expect(submit).toBeDisabled();
    await expect(rewards.locator('.trade-metric-value')).toHaveText('7.50');
    await expect(kol.locator('.trade-metric-value')).toHaveText('10.00');
    await page.locator('#investment_import_close_button').click();
    await expect(page.locator('#transaction_form_container')).toBeHidden();
    await rewards.hover();
    await rewards.locator('[data-investment-metric-breakdown-trigger]').click();
    await expect(rewards.locator('.investment-stock-details-metric-breakdown')).toContainText('HKD 60.00');
    expect(await page.evaluate(() => JSON.stringify(window.WORTHWARD_INVESTMENT_DATA.transactions))).toBe(investmentBefore);
    expect(investmentRequests).toEqual(requestsBeforeImport);
    expect(investmentRequests.every(({method}) => method === 'GET')).toBe(true);
    expect(cardRequests).toEqual([
        {path: 'preview', body: {text: accountText}},
        {path: 'import', body: {text: accountText, source_sha256: 'a'.repeat(64)}},
        {path: 'preview', body: {text: accountText}},
        {path: 'import', body: {text: accountText, source_sha256: 'a'.repeat(64)}},
    ]);
});
