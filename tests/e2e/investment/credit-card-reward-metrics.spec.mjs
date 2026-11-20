/* Code version: v1.2.3
 * Reward detail columns retain their headline anchors across viewport changes.
 */
import {expect, test} from '@playwright/test';
import {mockInvestmentReadApis} from '../critical_flows/support.mjs';

const holdingsRewards = (page) => page.locator('#investment_holdings_panel .investment-holdings-table-scroll [data-investment-broker-rewards-row]');
const holdingsRewardValue = (page) => holdingsRewards(page).locator('td').nth(6).locator('.trade-metric-value');
const holdingsRewardTrigger = (page) => holdingsRewards(page).locator('[data-investment-rewards-breakdown-trigger]');
const holdingsRewardDetailsRow = (page) => page.locator('#investment_holdings_panel .investment-holdings-table-scroll [data-investment-rewards-breakdown-row]');
const holdingsRewardDetails = (page) => holdingsRewardDetailsRow(page).locator('[data-investment-rewards-breakdown]');
const holdingsRewardCategory = (page, category) => holdingsRewardDetails(page)
    .locator(`[data-investment-rewards-category="${category}"]`);

const expectRewardCategoryAlignment = async (page, key) => {
    await expect(async () => {
        const layout = await holdingsRewardCategory(page, key).evaluate((node) => {
            const table = node.closest('table');
            const title = table.querySelector('[data-investment-broker-rewards-row] .investment-holdings-rewards-title');
            const total = table.querySelector('[data-investment-broker-rewards-row] [data-investment-rewards-value]');
            const label = node.querySelector('dt');
            const native = node.querySelector('[data-investment-rewards-category-native]');
            const amount = node.querySelector('[data-investment-rewards-category-amount]');
            return {
                labelAlign: getComputedStyle(label).textAlign,
                nativeAlign: getComputedStyle(native).textAlign,
                amountAlign: getComputedStyle(amount).textAlign,
                titleLeft: title.getBoundingClientRect().left,
                totalRight: total.getBoundingClientRect().right,
                labelLeft: label.getBoundingClientRect().left,
                nativeLeft: native.getBoundingClientRect().left,
                amountRight: amount.getBoundingClientRect().right,
                currencyLines: [...native.querySelectorAll('.investment-holdings-rewards-breakdown-currency')]
                    .map((line) => {
                        const bounds = line.getBoundingClientRect();
                        return {left: bounds.left, top: bounds.top, bottom: bounds.bottom};
                    }),
            };
        });
        expect(layout.labelAlign).toBe('left');
        expect(layout.nativeAlign).toBe('left');
        expect(layout.amountAlign).toBe('right');
        expect(Math.abs(layout.labelLeft - layout.titleLeft)).toBeLessThanOrEqual(1);
        expect(Math.abs(layout.nativeLeft - layout.titleLeft)).toBeLessThanOrEqual(1);
        expect(Math.abs(layout.amountRight - layout.totalRight)).toBeLessThanOrEqual(1);
        for (const [index, line] of layout.currencyLines.entries()) {
            expect(Math.abs(line.left - layout.titleLeft)).toBeLessThanOrEqual(1);
            if (index > 0) {
                expect(line.top).toBeGreaterThanOrEqual(layout.currencyLines[index - 1].bottom - 0.5);
            }
        }
    }).toPass({timeout: 5000});
};

const mockRewardCategories = async (page, {missingFx = false} = {}) => mockInvestmentReadApis(page, {
    startingCash: 0,
    brokers: ['hsbc', 'ibkr', 'tigertrade', 'longbridge_hk'],
    fxRateHistoryByCurrency: {
        CNH: {dates: ['2026-09-01'], values: {'2026-09-01': 4}},
    },
    transactions: [
        {broker: 'hsbc', date: '2026-09-01', type: 'deposit', currency: 'USD', amount: 1000},
        {
            broker: 'hsbc', date: '2026-09-02', type: 'kol_reward', currency: 'USD',
            description: 'KOL Rewards', normalized: {net_amount: '10.00', cash_flow_amount: '10.00'},
        },
        {
            broker: 'hsbc', date: '2026-09-03', type: 'credit_interest', currency: 'USD',
            description: 'CASH REBATE 0055',
            source: {
                file_kind: 'hsbc_multi_currency_cash_account_text', account_number: '000-555555-001',
                account_type: 'USD Savings',
            },
            normalized: {net_amount: '1.00', cash_flow_amount: '1.00'},
        },
        {
            broker: 'hsbc', date: '2026-09-03', type: 'credit_interest', currency: 'CNH',
            description: 'CASH REBATE 0055',
            source: {
                file_kind: 'hsbc_multi_currency_cash_account_text', account_number: '000-555555-001',
                account_type: 'RMB Savings',
            },
            normalized: {net_amount: '4.00', cash_flow_amount: '4.00'},
        },
        {
            broker: 'tigertrade', date: '2026-09-04', type: 'deposit', currency: 'USD',
            description: 'Order Rebate', source: {transaction_type_raw: 'kol'},
            normalized: {net_amount: '2.00', cash_flow_amount: '2.00'},
        },
        {
            broker: 'longbridge_hk', date: '2026-09-05', type: 'cash_reward', currency: 'USD',
            description: 'Campaign cash reward', normalized: {net_amount: '3.00', cash_flow_amount: '3.00'},
        },
        {broker: 'ibkr', date: '2026-09-01', type: 'deposit', currency: 'USD', amount: 20},
    ],
    creditCardRewards: {
        status: 'complete',
        transactions: [
            {id: 'reward-a', kind: 'rewardcash', date: '2026-09-18', currency: 'HKD', amount: '15.00'},
            {id: 'reward-b', kind: 'rewardcash', date: '2026-10-12', currency: 'HKD', amount: '25.00'},
            {id: 'rebate-a', kind: 'rebate', date: '2026-10-14', currency: 'HKD', amount: '8.00'},
        ],
        fx_rate_history_by_currency: missingFx ? {} : {
            HKD: {dates: ['2026-09-01'], values: {'2026-09-01': 8}},
        },
    },
});

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

for (const width of [1280, 843, 390]) {
    test(`Holdings Rewards expands six categories with native and converted amounts at ${width}px`, async ({page}) => {
        const errors = [];
        const writes = [];
        page.on('pageerror', (error) => errors.push(error.message));
        page.on('request', (request) => {
            if (new URL(request.url()).pathname.startsWith('/api/') && request.method() !== 'GET') {
                writes.push(request.method());
            }
        });
        await page.setViewportSize({width, height: 900});
        await mockRewardCategories(page);
        await page.goto('/trade/investment?view=holdings');
        await expect(holdingsRewardValue(page)).toHaveText('23.00');
        await expect(holdingsRewards(page).locator(':scope > td')).toHaveCount(9);
        const trigger = holdingsRewardTrigger(page);
        await expect(trigger).toHaveAttribute('aria-label', 'Show Rewards details');
        await expect(trigger).toHaveAttribute('aria-expanded', 'false');
        await expect(trigger).toHaveAttribute('aria-controls', 'investment_holdings_rewards_breakdown');
        const identityLayout = await trigger.evaluate((element) => {
            const title = element.querySelector('.ticker-identity-symbol');
            const description = element.querySelector('.ticker-identity-name');
            return {
                stacked: description.getBoundingClientRect().top >= title.getBoundingClientRect().bottom - 1,
                hasChevron: Boolean(element.querySelector('.investment-stock-details-metric-breakdown-trigger')),
            };
        });
        expect(identityLayout).toEqual({stacked: true, hasChevron: false});
        await expect(holdingsRewardDetails(page)).toHaveAttribute('id', 'investment_holdings_rewards_breakdown');
        const underlayTrigger = page.locator('#investment_holdings_panel .scrollable-data-table-frosted-underlay [data-investment-rewards-breakdown-trigger]');
        await expect(underlayTrigger).toBeDisabled();
        await expect(underlayTrigger).toHaveAttribute('tabindex', '-1');
        await trigger.focus();
        await expect(trigger).toBeFocused();
        await underlayTrigger.evaluate((node) => node.focus());
        await expect(trigger).toBeFocused();
        await expect(holdingsRewardDetailsRow(page)).toBeHidden();
        const rewardsNumber = holdingsRewards(page).locator('td').first();
        if (width === 843) {
            const rowHeights = await rewardsNumber.evaluate((cell) => {
                cell.click();
                const details = cell.closest('tr').nextElementSibling;
                const reveal = details.querySelector('.investment-holding-detail-reveal');
                const animation = reveal.getAnimations()[0];
                animation.pause();
                const duration = animation.effect.getComputedTiming().duration;
                const heights = [0, 0.4, 0.8].map((fraction) => {
                    animation.currentTime = duration * fraction;
                    return details.getBoundingClientRect().height;
                });
                animation.finish();
                return heights;
            });
            expect(rowHeights[0]).toBeLessThanOrEqual(1);
            expect(rowHeights[1]).toBeGreaterThan(rowHeights[0]);
            expect(rowHeights[2]).toBeGreaterThan(rowHeights[1]);
        } else {
            await rewardsNumber.click();
        }
        await expect(trigger).toHaveAttribute('aria-label', 'Hide Rewards details');
        await expect(trigger).toHaveAttribute('aria-expanded', 'true');
        await expect(holdingsRewardDetailsRow(page)).toBeVisible();
        const detailCells = holdingsRewardDetailsRow(page).locator(':scope > td');
        await expect(detailCells).toHaveCount(3);
        const columnSpans = await detailCells.evaluateAll((cells) => cells.map((cell) => cell.colSpan));
        expect(columnSpans).toEqual([1, 6, 2]);
        expect(columnSpans.reduce((total, span) => total + span, 0)).toBe(9);
        expect(await holdingsRewardDetailsRow(page).evaluate((row) => row.previousElementSibling
            ?.hasAttribute('data-investment-broker-rewards-row'))).toBe(true);
        const categories = [
            ['debit_card_cashback', 'Debit-card rebates', ['CNH 4.00', 'USD 1.00'], '2.00'],
            ['card_rewardcash', 'Credit-card RewardCash', ['HKD 40.00'], '5.00'],
            ['card_rebates', 'Credit-card rebates', ['HKD 8.00'], '1.00'],
            ['kol_rewards', 'KOL rewards', ['USD 10.00'], '10.00'],
            ['coupons', 'Coupons', ['USD 2.00'], '2.00'],
            ['cash_rewards', 'Cash rewards', ['USD 3.00'], '3.00'],
        ];
        await expect(holdingsRewardDetails(page).locator('[data-investment-rewards-category]')).toHaveCount(6);
        for (const [key, label, native, converted] of categories) {
            const category = holdingsRewardCategory(page, key);
            await expect(category).toContainText(label);
            const nativeAmounts = category.locator('[data-investment-rewards-category-native]');
            await expect(nativeAmounts.locator('.investment-holdings-rewards-breakdown-currency')).toHaveText(native);
            await expect(category.locator('[data-investment-rewards-category-amount]')).toContainText(converted);
            await expectRewardCategoryAlignment(page, key);
        }
        const convertedTotal = await holdingsRewardDetails(page)
            .locator('[data-investment-rewards-category-amount]').evaluateAll((nodes) => nodes.reduce(
                (sum, node) => sum + Number(node.textContent.replace(/[^\d.+-]/g, '')), 0,
            ));
        expect(convertedTotal).toBe(23);
        expect(await holdingsRewardDetails(page).evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
        for (const resizedWidth of [width === 390 ? 1280 : 390, width]) {
            await page.setViewportSize({width: resizedWidth, height: 900});
            await expect(holdingsRewardDetailsRow(page)).toBeVisible();
            for (const [key] of categories) await expectRewardCategoryAlignment(page, key);
            expect(await holdingsRewardDetails(page).evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
            await expect(holdingsRewardValue(page)).toHaveText('23.00');
        }
        await holdingsRewards(page).locator('td').first().click();
        await expect(trigger).toHaveAttribute('aria-expanded', 'false');
        await expect(holdingsRewardDetailsRow(page)).toBeHidden();
        await trigger.focus();
        await trigger.press('Enter');
        await expect(trigger).toHaveAttribute('aria-expanded', 'true');
        await expect(holdingsRewardDetailsRow(page)).toBeVisible();
        await expect(holdingsRewardValue(page)).toHaveText('23.00');
        expect(writes).toEqual([]);
        expect(errors).toEqual([]);
    });

    if (width === 843) continue;

    test(`Holdings Rewards keeps known categories and native card amounts when FX is missing at ${width}px`, async ({page}) => {
        await page.setViewportSize({width, height: 900});
        await mockRewardCategories(page, {missingFx: true});
        await page.goto('/trade/investment?view=holdings');
        await expect(holdingsRewardValue(page)).toHaveText('Unavailable');
        await holdingsRewardTrigger(page).click();
        await expect(holdingsRewardDetailsRow(page)).toBeVisible();
        for (const [key, native] of [['card_rewardcash', 'HKD 40.00'], ['card_rebates', 'HKD 8.00']]) {
            const category = holdingsRewardCategory(page, key);
            await expect(category.locator('[data-investment-rewards-category-native]')).toContainText(native);
            await expect(category.locator('[data-investment-rewards-category-amount]')).toHaveText('Unavailable');
        }
        for (const [key, converted] of [
            ['debit_card_cashback', '2.00'], ['kol_rewards', '10.00'], ['coupons', '2.00'], ['cash_rewards', '3.00'],
        ]) {
            await expect(holdingsRewardCategory(page, key).locator('[data-investment-rewards-category-amount]'))
                .toContainText(converted);
        }
        await expect(holdingsRewardDetails(page).locator('[data-investment-rewards-category]')).toHaveCount(6);
        expect(await holdingsRewardDetails(page).evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
        await expect(holdingsRewardValue(page)).toHaveText('Unavailable');
    });

}

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
        await expect(panel.locator('[data-metric-key="realized-pnl"] .trade-metric-value')).toHaveText('+15.00');
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
        await expect(holdingsRewards(page)).toContainText('Rewards');
        await expect(holdingsRewardValue(page)).toHaveText('15.00');
        await expect(holdings.locator('[data-investment-live-field="summary_cash_balance"]')).toHaveText('1,030.00');
        await expect(holdings.locator('[data-investment-live-field="summary_total_equity"]')).toHaveText('1,030.00');
        for (const field of ['summary_realized_pnl', 'summary_cumulative_pnl']) {
            await expect(holdings.locator(`[data-investment-live-field="${field}"]`))
                .toHaveAttribute('data-investment-live-number', '15');
        }
        await page.goto('/trade/investment?view=metrics&metrics-broker=ibkr&broker=ibkr');
        await expect(page.locator('#investment_metrics_panel [data-metric-key="coupon-rebates-cash-rewards"] .trade-metric-value')).toHaveText('0.00');
        await expect(page.locator('#investment_metrics_panel [data-metric-key="realized-pnl"] .trade-metric-value')).toHaveText('0.00');
        // Holdings remains the all-broker aggregate when the history filter changes.
        await expect(holdingsRewardValue(page)).toHaveText('15.00');
        expect(errors).toEqual([]);
    });
}

test('Holdings Markdown keeps its Rewards parent row without cloning disclosure rows', async ({page}) => {
    await mockRewardCategories(page);
    await page.goto('/trade/investment?view=holdings');
    await expect(holdingsRewardValue(page)).toHaveText('23.00');
    for (const expanded of [false, true]) {
        if (expanded) await holdingsRewardTrigger(page).click();
        const exported = await page.evaluate(async () => {
            const {createInvestmentExportHistoryRuntime} = await import('/static/assets/js/investment/runtime/export-history.js');
            const runtime = createInvestmentExportHistoryRuntime({});
            const header = document.querySelector('#investment_holdings_panel [data-table-header]');
            const body = document.querySelector('#investment_holdings_panel .investment-holdings-table-scroll table');
            const original = `${header.outerHTML}${body.outerHTML}`;
            const table = runtime.cloneRenderedTable(header, body);
            return {
                rows: [...table.querySelectorAll('tbody tr')].map((row) => ({
                    rewards: row.hasAttribute('data-investment-broker-rewards-row'), columns: row.cells.length,
                })),
                disclosureRows: table.querySelectorAll('[data-investment-rewards-breakdown-row]').length,
                markdown: runtime.extractMarkdownTable(table),
                unchanged: original === `${header.outerHTML}${body.outerHTML}`,
            };
        });
        expect(exported.rows).toEqual([{rewards: true, columns: 9}]);
        expect(exported.disclosureRows).toBe(0);
        expect(exported.markdown).toContain('23.00');
        expect(exported.markdown).not.toContain('Credit-card RewardCash');
        expect(exported.markdown).not.toContain('Converted to USD');
        expect(exported.unchanged).toBe(true);
    }
});

test('Holdings share keeps its Rewards parent row without treating disclosure as a security', async ({page}) => {
    await mockRewardCategories(page);
    await page.goto('/trade/investment?view=holdings');
    await expect(holdingsRewardValue(page)).toHaveText('23.00');
    for (const expanded of [false, true]) {
        if (expanded) await holdingsRewardTrigger(page).click();
        const shared = await page.evaluate(async () => {
            const {createInvestmentShareLinkedHoverRuntime} = await import('/static/assets/js/investment/runtime/share-linked-hover.js');
            const {createInvestmentHoldingsLiveRuntime} = await import('/static/assets/js/investment/runtime/holdings-live.js');
            const runtime = {renderWorkspaceMetricValueContent: String};
            Object.assign(runtime, createInvestmentHoldingsLiveRuntime(runtime));
            const share = createInvestmentShareLinkedHoverRuntime(runtime);
            const body = document.querySelector('#investment_holdings_panel .investment-holdings-table-scroll table');
            const original = body.outerHTML;
            const table = share.buildInvestmentHoldingsShareTable();
            return {
                rows: [...table.querySelectorAll('tbody tr')].map((row) => ({
                    rewards: row.hasAttribute('data-investment-broker-rewards-row'), columns: row.cells.length,
                })),
                disclosureRows: table.querySelectorAll('[data-investment-rewards-breakdown-row]').length,
                text: table.textContent,
                unchanged: original === body.outerHTML,
            };
        });
        expect(shared.rows).toEqual([{rewards: true, columns: 8}]);
        expect(shared.disclosureRows).toBe(0);
        expect(shared.text).toContain('23.00');
        expect(shared.text).not.toContain('Credit-card RewardCash');
        expect(shared.unchanged).toBe(true);
    }
});

test('missing card FX marks current rewards and P&L unavailable while preserving cash and native RewardCash', async ({page}) => {
    await mockRewards(page, {missingFx: true});
    await page.goto('/trade/investment?view=metrics&metrics-broker=hsbc&broker=hsbc');
    const panel = page.locator('#investment_metrics_panel');
    const rewards = panel.locator('[data-metric-key="coupon-rebates-cash-rewards"]');
    await expect(rewards.locator('.trade-metric-value')).toHaveText('Unavailable');
    await rewards.hover();
    await rewards.locator('[data-investment-metric-breakdown-trigger]').click();
    await expect(rewards).toContainText('HKD 40.00');
    await expect(panel.locator('[data-metric-key="realized-pnl"] .trade-metric-value')).toHaveText('Unavailable');
    await expect(holdingsRewardValue(page)).toHaveText('Unavailable');
    const holdings = page.locator('#investment_holdings_panel');
    for (const field of ['summary_realized_pnl', 'summary_cumulative_pnl']) {
        await expect(holdings.locator(`[data-investment-live-field="${field}"]`)).toHaveText(/^(?:Unavailable|Partial · total unavailable)$/);
        await expect(holdings.locator(`[data-investment-live-field="${field}"]`))
            .not.toHaveAttribute('data-investment-live-number', /./);
    }
    await expect(holdings.locator('[data-investment-live-field="summary_cash_balance"]')).toHaveText('1,030.00');
    await expect(holdings.locator('[data-investment-live-field="summary_total_equity"]')).toHaveText('1,030.00');
    await expect(page.locator('#investment_history tr[data-investment-history-row]')).toHaveCount(2);
    await page.goto('/trade/investment?view=metrics&metrics-broker=ibkr&broker=ibkr');
    await expect(page.locator('#investment_metrics_panel [data-metric-key="realized-pnl"] .trade-metric-value')).toHaveText('0.00');
});

for (const width of [1280, 390]) {
test(`card import refreshes expanded Rewards only after success without investment reloads at ${width}px`, async ({page}) => {
    await page.setViewportSize({width, height: 900});
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
    await expect(holdingsRewardValue(page)).toHaveText('15.00');
    await expect(panel.locator('[data-metric-key="realized-pnl"] .trade-metric-value')).toHaveText('+15.00');
    await page.locator('label[for="investment_view_holdings"]').click();
    await holdingsRewardTrigger(page).click();
    await expect(holdingsRewardTrigger(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(holdingsRewardDetailsRow(page)).toBeVisible();
    await expect(holdingsRewardCategory(page, 'card_rewardcash')
        .locator('[data-investment-rewards-category-native]')).toContainText('HKD 40.00');
    await page.locator('label[for="investment_view_metrics"]').click();
    await expect(panel).toBeVisible();
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
    await expect(holdingsRewardValue(page)).toHaveText('15.00');
    await expect(panel.locator('[data-metric-key="realized-pnl"] .trade-metric-value')).toHaveText('+15.00');
    await expect(holdingsRewardTrigger(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(holdingsRewardCategory(page, 'card_rewardcash')
        .locator('[data-investment-rewards-category-native]')).toContainText('HKD 40.00');
    expect(await page.evaluate(() => JSON.stringify(window.WORTHWARD_INVESTMENT_DATA.credit_card_rewards))).toBe(rewardsBefore);
    await paste.click();
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(status).toContainText('Entries were read back from the credit-card ledger.');
    await expect(submit).toBeDisabled();
    await expect(rewards.locator('.trade-metric-value')).toHaveText('7.50');
    await expect(kol.locator('.trade-metric-value')).toHaveText('10.00');
    await expect(holdingsRewardValue(page)).toHaveText('17.50');
    await expect(panel.locator('[data-metric-key="realized-pnl"] .trade-metric-value')).toHaveText('+17.50');
    await expect(holdingsRewardTrigger(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(holdingsRewardCategory(page, 'card_rewardcash')
        .locator('[data-investment-rewards-category-native]')).toContainText('HKD 60.00');
    await expect(holdingsRewardCategory(page, 'card_rewardcash')
        .locator('[data-investment-rewards-category-amount]')).toContainText('7.50');
    await expect(holdingsRewardCategory(page, 'kol_rewards')
        .locator('[data-investment-rewards-category-amount]')).toContainText('10.00');
    await expect(holdingsRewardDetails(page).locator('[data-investment-rewards-category]')).toHaveCount(2);
    const holdings = page.locator('#investment_holdings_panel');
    for (const field of ['summary_realized_pnl', 'summary_cumulative_pnl']) {
        await expect(holdings.locator(`[data-investment-live-field="${field}"]`))
            .toHaveAttribute('data-investment-live-number', '17.5');
    }
    await expect(holdings.locator('[data-investment-live-field="summary_cash_balance"]')).toHaveText('1,030.00');
    await expect(holdings.locator('[data-investment-live-field="summary_total_equity"]')).toHaveText('1,030.00');
    await expect(page.locator('#investment_history tr[data-investment-history-row]')).toHaveCount(2);
    await page.locator('#investment_import_close_button').click();
    await expect(page.locator('#transaction_form_container')).toBeHidden();
    await rewards.hover();
    await rewards.locator('[data-investment-metric-breakdown-trigger]').click();
    await expect(rewards.locator('.investment-stock-details-metric-breakdown')).toContainText('HKD 60.00');
    await page.locator('label[for="investment_view_holdings"]').click();
    await expect(holdingsRewardDetailsRow(page)).toBeVisible();
    await expect(holdingsRewardTrigger(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(holdingsRewardValue(page)).toHaveText('17.50');
    expect(await holdingsRewardDetails(page).evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
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
}
