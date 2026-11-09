/* Code version: v1.0.0
 * Retained position evidence and dated rewards keep rendered account totals complete.
 */
import {expect, test} from '@playwright/test';
import {mockInvestmentReadApis} from '../critical_flows/support.mjs';

const trade = (broker, account, ticker, type, date, quantity, price) => ({
    broker, account, ticker, currency: 'USD', type, date,
    datetime: `${date} 12:00:00`, quantity, price,
    amount: quantity * price * (type === 'buy' ? -1 : 1),
});
const holding = (page, ticker) => page.locator(
    `#investment_holdings_panel:not([hidden]) .investment-holdings-table-scroll tr[data-investment-holdings-ticker="${ticker}"]`,
);
const total = (page, metric) => page.locator(
    `#investment_holdings_panel:not([hidden]) [data-investment-live-field="summary_${metric}_pnl"]`,
);
const stockMetric = (page, label) => page.locator('.investment-stock-details-metric-card')
    .filter({has: page.locator('.trade-metric-label').getByText(label, {exact: true})})
    .locator('.trade-metric-value').first();
const rewards = (page) => page.locator(
    '#investment_holdings_panel .investment-holdings-table-scroll [data-investment-broker-rewards-row]',
);
const rewardCategory = (page, category) => page.locator(
    `#investment_holdings_panel .investment-holdings-table-scroll [data-investment-rewards-category="${category}"]`,
);

test('historical gains and dated foreign rewards remain complete across Holdings and Stock details', async ({page}) => {
    await page.clock.setFixedTime(new Date('2026-07-07T14:00:00Z'));
    const transactions = [
        trade('ibkr', 'CLOSED', 'TEST', 'buy', '2026-07-01', 3, 10),
        trade('ibkr', 'CLOSED', 'TEST', 'sell', '2026-07-02', 1, 15),
        trade('ibkr', 'CLOSED', 'TEST', 'sell', '2026-07-04', 2, 13),
        trade('ibkr', 'CLOSED', 'OTHER', 'buy', '2026-07-01', 1, 10),
        trade('schwab', 'CURRENT', 'TEST', 'buy', '2026-07-01', 2, 10),
        {
            broker: 'longbridge_sg', account: 'REWARDS', date: '2026-07-06',
            type: 'kol_reward', currency: 'SGD', description: 'KOL Rewards',
            normalized: {net_amount: '4.00', cash_flow_amount: '4.00'},
        },
    ];
    const otherPosition = {
        quantity: '1', currency: 'USD', cost_price: '10',
        last_price: '10', market_value: '10',
    };
    const selected = {
        broker: 'ibkr', account: 'CLOSED',
        position_snapshot_authoritative: true,
        position_snapshot_as_of: '2026-07-06',
        position_snapshot: {OTHER: {...otherPosition, as_of: '2026-07-06 16:00:00'}},
        holdings_validation: {matched: false},
        performance_snapshot_authoritative: true,
        performance_snapshot_as_of: '2026-07-03',
        performance_snapshot: {TEST: {currency: 'USD', realized_total: '5'}},
    };
    const evidence = {
        evidence_id: 'synthetic-verified-position-boundary',
        broker: 'ibkr', account: 'CLOSED',
        position_snapshot_source: 'ibkr_user_verified_app_positions',
        position_snapshot_authoritative: true,
        position_snapshot_as_of: '2026-07-05',
        position_snapshot: {OTHER: {...otherPosition, as_of: '2026-07-05 16:00:00'}},
        holdings_validation: {
            matched: true, history_complete: false,
            comparison_scope: 'user_confirmed_current_position_snapshot',
        },
    };
    const priceHistoryByTicker = {
        TEST: [{date: '2026-07-06', close: 12}],
        OTHER: [{date: '2026-07-06', close: 10}],
    };
    const brokers = ['ibkr', 'schwab', 'longbridge_sg', 'hsbc'];
    const fxRateHistoryByCurrency = {
        SGD: {dates: ['2026-07-06'], values: {'2026-07-06': 2}},
    };
    const creditCardRewards = {
        status: 'complete',
        transactions: [{
            id: 'synthetic-card-rebate', kind: 'rebate', date: '2026-07-06',
            currency: 'HKD', amount: '8.00',
        }],
        fx_rate_history_by_currency: {
            HKD: {dates: ['2026-07-06'], values: {'2026-07-06': 8}},
        },
    };
    await mockInvestmentReadApis(page, {
        transactions, brokers, fxRateHistoryByCurrency, creditCardRewards,
        priceHistoryByTicker, brokerSummaries: {ibkr: selected},
    });
    // Supply the canonical retained evidence alongside the selected projection.
    await page.route('**/api/investment/transactions*', async (route) => {
        if (route.request().method() !== 'GET') return route.abort();
        return route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({
                success: true, transactions, starting_cash: 1000, base_currency: 'USD',
                brokers, broker_summaries: {ibkr: selected},
                broker_snapshots: {'ibkr:CLOSED': {...selected, evidence: [evidence]}},
                price_history_by_ticker: priceHistoryByTicker,
                ticker_profiles: {}, ticker_lineage: {}, known_ticker_company_names: {},
                price_history_failures: [], money_market_tickers: [], cash_equivalent_tickers: [],
                fx_rate_history_by_currency: fxRateHistoryByCurrency, summary: {}, realtime_quotes: [],
                credit_card_rewards: creditCardRewards,
                section_freshness: {},
            }),
        });
    });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const assertHoldings = async () => {
        // The closed account contributes 5 of baseline gains and 6 of later gains.
        await expect(holding(page, 'TEST').locator('td').nth(6).locator('.trade-metric-value').first()).toHaveText('11.00');
        await expect(holding(page, 'TEST').locator('td').nth(4)).toHaveText('2');
        await expect(holding(page, 'TEST').locator('[data-investment-live-field="unrealized_pnl"]')).toHaveAttribute('data-investment-live-display', '4.00');
        // SGD 4 / 2 and HKD 8 / 8 add 3 of rewards once, outside ticker gains.
        await expect(rewards(page).locator('td').nth(6).locator('.trade-metric-value')).toHaveText('3.00');
        await expect(total(page, 'realized')).toHaveAttribute('data-investment-live-display', '14.00');
        await expect(total(page, 'cumulative')).toHaveAttribute('data-investment-live-display', '+18.00');
        await expect(holding(page, 'OTHER').locator('td').nth(4)).toHaveText('1');
    };
    await page.goto('/trade/investment?view=holdings');
    await assertHoldings();
    await rewards(page).locator('[data-investment-rewards-breakdown-trigger]').click();
    await expect(rewardCategory(page, 'kol_rewards').locator('[data-investment-rewards-category-native]')).toHaveText('SGD 4.00');
    await expect(rewardCategory(page, 'kol_rewards').locator('[data-investment-rewards-category-amount]')).toHaveText('USD 2.00');
    await expect(rewardCategory(page, 'card_rebates').locator('[data-investment-rewards-category-native]')).toHaveText('HKD 8.00');
    await expect(rewardCategory(page, 'card_rebates').locator('[data-investment-rewards-category-amount]')).toHaveText('USD 1.00');
    await page.reload();
    await assertHoldings();
    await holding(page, 'TEST').locator('[data-investment-stock-link]').click();
    await expect(stockMetric(page, 'Realized P&L')).toHaveText('11.00');
    await expect(stockMetric(page, 'Unrealized P&L')).toHaveText('4.00');
    await expect(stockMetric(page, 'Total P&L')).toHaveText('15.00');
    expect(errors).toEqual([]);
});
