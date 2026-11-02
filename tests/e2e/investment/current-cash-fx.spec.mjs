/* Code version: v1.0.0
 * Current cash requires daily market FX while dated rewards retain their own FX.
 */
import {expect, test} from '@playwright/test';
import {mockInvestmentReadApis} from '../critical_flows/support.mjs';

const VALUATION_DATE = '2026-11-02';
const MARKET_HKD_HISTORY = {
    dates: [VALUATION_DATE],
    values: {[VALUATION_DATE]: 8},
};
const metricsValue = (page, field) => page.locator(
    `#investment_metrics_panel:not([hidden]) [data-investment-live-field="${field}"]`,
);
const holdingsValue = (page, field) => page.locator(
    `#investment_holdings_panel:not([hidden]) [data-investment-live-field="${field}"]`,
);
const rewardsCard = (page) => page.locator(
    '#investment_metrics_panel:not([hidden]) [data-metric-key="coupon-rebates-cash-rewards"]',
);

async function mockCurrentCash(page, {missingMarketFx = false} = {}) {
    const writes = [];
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => {
        if (new URL(request.url()).pathname.startsWith('/api/') && request.method() !== 'GET') {
            writes.push({path: new URL(request.url()).pathname, method: request.method()});
        }
    });
    // Every financial response is anonymous and intercepted; no write reaches a server.
    await page.route('**/api/**', (route) => (
        route.request().method() === 'GET' ? route.fallback() : route.abort()
    ));
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
    }, '2026-11-02T15:00:00Z');

    const marketFx = missingMarketFx ? {} : {HKD: MARKET_HKD_HISTORY};
    await mockInvestmentReadApis(page, {
        startingCash: 0,
        brokers: ['hsbc', 'ibkr'],
        transactions: [
            {
                broker: 'ibkr', account: 'IBKR-TEST-001', date: '2026-01-06',
                type: 'forex_trade_component', ticker: 'USD.HKD', currency: 'USD',
                price: 7.5, amount: 0, description: 'Historical other-broker FX execution',
            },
            {
                broker: 'hsbc', account: 'HSBC-TEST-001', date: '2026-01-07',
                datetime: '2026-01-07 09:00:00',
                type: 'deposit', currency: 'USD', amount: 5,
                description: 'Historical HSBC USD cash',
            },
            {
                broker: 'hsbc', account: 'HSBC-TEST-001', date: '2026-01-07',
                datetime: '2026-01-07 10:00:00',
                type: 'deposit', currency: 'HKD', amount: 800,
                description: 'Historical HSBC HKD cash',
            },
            {
                broker: 'hsbc', account: 'HSBC-TEST-001', date: VALUATION_DATE,
                type: 'deposit', currency: 'USD', amount: 0,
                description: 'Current HSBC cash boundary',
            },
        ],
        brokerSummaries: {
            hsbc: {
                broker: 'hsbc', account: 'HSBC-TEST-001',
                starting_cash: '0.00', starting_cash_by_currency: {USD: '0.00'},
                ending_cash: '5.00', ending_cash_base_currency: '5.00',
                ending_cash_by_currency: {USD: '5.00', HKD: '800.00'},
                cash_snapshot_authoritative: true, cash_snapshot_as_of: VALUATION_DATE,
                hsbc_ending_cash_components: {'USD:SAVINGS': '5.00', 'HKD:SAVINGS': '800.00'},
                hsbc_cash_component_post_dates: {
                    'USD:SAVINGS': VALUATION_DATE, 'HKD:SAVINGS': VALUATION_DATE,
                },
                hsbc_pending_settlement_cash: '0.00', hsbc_pending_settlement_order_count: 0,
            },
            ibkr: {
                broker: 'ibkr', account: 'IBKR-TEST-001',
                starting_cash: '0.00', starting_cash_by_currency: {USD: '0.00'},
                ending_cash: '0.00', ending_cash_base_currency: '0.00',
                ending_cash_by_currency: {USD: '0.00'},
                cash_snapshot_authoritative: true, cash_snapshot_as_of: VALUATION_DATE,
            },
        },
        summary: {authoritative_current_cash_brokers: ['hsbc', 'ibkr']},
        fxRateHistoryByCurrency: marketFx,
        creditCardRewards: {
            status: 'complete',
            transactions: [{
                id: 'anonymous-card-redemption', date: '2026-10-30',
                currency: 'HKD', amount: '16.00',
            }],
            fx_rate_history_by_currency: {
                HKD: {dates: ['2026-10-30'], values: {'2026-10-30': 8}},
            },
        },
        intradayRows: () => [],
    });
    return {marketFx, writes, errors};
}

async function assertHistoricalAndNativeEvidence(page) {
    const historicalRow = page.locator('#investment_history tr[data-investment-history-row]')
        .filter({hasText: 'Historical HSBC HKD cash'});
    // An actual historical conversion remains valid for historical cash replay.
    await expect(historicalRow.locator('td').nth(9)).toContainText('111.67');
    expect(await page.evaluate(() => (
        window.WORTHWARD_INVESTMENT_DATA.broker_summaries.hsbc.ending_cash_by_currency
    ))).toEqual({USD: '5.00', HKD: '800.00'});
    await expect(rewardsCard(page).locator('.trade-metric-value')).toHaveText('2.00');
}

async function assertHoldingsCash(page, expected) {
    await page.locator('label[for="investment_view_holdings"]').click();
    for (const field of ['summary_cash_balance', 'summary_total_equity']) {
        const value = holdingsValue(page, field);
        await expect(value).toHaveText(expected);
        if (expected === '-') {
            await expect(value).not.toHaveAttribute('data-investment-live-number', /./);
        }
    }
    const rewards = page.locator(
        '#investment_holdings_panel .investment-holdings-table-scroll [data-investment-broker-rewards-row]',
    );
    await expect(rewards.locator('td').nth(6).locator('.trade-metric-value')).toHaveText('2.00');
}

async function assertAllMetrics(page, expected) {
    await page.goto('/trade/investment?view=metrics&metrics-broker=all');
    for (const field of ['metrics_cash', 'metrics_total_equity']) {
        const value = metricsValue(page, field);
        await expect(value).toHaveText(expected);
        if (expected === '-') {
            await expect(value).not.toHaveAttribute('data-investment-live-number', /./);
        }
    }
    await expect(rewardsCard(page).locator('.trade-metric-value')).toHaveText('2.00');
}

test('daily market FX values HSBC Metrics and All Holdings without reusing an old execution rate', async ({page}) => {
    const {writes, errors} = await mockCurrentCash(page);
    await page.goto('/trade/investment?view=metrics&metrics-broker=hsbc&broker=hsbc');
    for (const field of ['metrics_cash', 'metrics_total_equity']) {
        await expect(metricsValue(page, field)).toHaveText('105.00');
    }
    await assertHistoricalAndNativeEvidence(page);
    await assertAllMetrics(page, '105.00');
    await assertHoldingsCash(page, '105.00');
    await page.reload();
    for (const field of ['summary_cash_balance', 'summary_total_equity']) {
        await expect(holdingsValue(page, field)).toHaveText('105.00');
    }
    expect(writes).toEqual([]);
    expect(errors).toEqual([]);
});

test('missing daily market FX withholds current cash and equity while dated RewardCash remains available', async ({page}) => {
    const {marketFx, writes, errors} = await mockCurrentCash(page, {missingMarketFx: true});
    await page.goto('/trade/investment?view=metrics&metrics-broker=hsbc&broker=hsbc');
    for (const field of ['metrics_cash', 'metrics_total_equity']) {
        const value = metricsValue(page, field);
        await expect(value).toHaveText('-');
        await expect(value).not.toHaveAttribute('data-investment-live-number', /./);
    }
    await assertHistoricalAndNativeEvidence(page);
    await assertAllMetrics(page, '-');
    await assertHoldingsCash(page, '-');

    // Only the intercepted read response changes; no financial record is imported.
    marketFx.HKD = MARKET_HKD_HISTORY;
    await page.reload();
    for (const field of ['summary_cash_balance', 'summary_total_equity']) {
        await expect(holdingsValue(page, field)).toHaveText('105.00');
    }
    await page.locator('label[for="investment_view_metrics"]').click();
    for (const field of ['metrics_cash', 'metrics_total_equity']) {
        await expect(metricsValue(page, field)).toHaveText('105.00');
    }
    await assertHistoricalAndNativeEvidence(page);
    expect(writes).toEqual([]);
    expect(errors).toEqual([]);
});
