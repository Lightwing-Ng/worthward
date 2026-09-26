/* Code version: v1.0.2 */
import {expect, test} from '@playwright/test';

// Fixtures are intercepted in the browser and never enter a persistent store.
const loadHoldings = async (page, {foreignCash = false, cashType = 'deposit', fx = {}} = {}) => {
    await page.route('**/api/investment/transactions*', async (route) => {
        if (route.request().method() !== 'GET') return route.abort();
        await route.fulfill({json: {
            success: true, starting_cash: 10000, base_currency: 'USD', brokers: ['ibkr'],
            transactions: foreignCash ? [
                {broker: 'ibkr', account: 'TEST', date: '2026-01-01', type: 'buy', currency: 'USD', ticker: 'AAPL', quantity: 10, price: 100, amount: -1000},
                {broker: 'ibkr', account: 'TEST', date: '2026-01-02', type: cashType, currency: 'HKD', amount: 1000},
            ] : [
                {broker: 'ibkr', account: 'TEST', date: '2026-01-02', type: 'buy', currency: 'USD', ticker: 'AAPL', quantity: 10, price: 100, amount: -1000},
                {broker: 'ibkr', account: 'TEST', date: '2026-01-02', type: 'buy', currency: 'HKD', ticker: '5.HK', quantity: 10, price: 100, amount: -1000},
            ],
            price_history_by_ticker: {AAPL: [{date: '2026-01-02', close: 110}], '5.HK': [{date: '2026-01-02', close: 110}]},
            ticker_profiles: {}, money_market_tickers: [], cash_equivalent_tickers: ['5.HK'],
            fx_rate_history_by_currency: fx, ticker_lineage: {}, summary: {}, broker_summaries: {},
            realtime_quotes: [], section_freshness: {},
        }});
    });
    await page.route('**/api/investment/realtime-quotes?*', route => route.fulfill({json: {success: true, quotes: []}}));
    await page.route('**/api/market-session/us-equity?*', route => route.fulfill({json: {success: true, session: 'off', is_trading_day: false, is_realtime_allowed: false, trading_days: []}}));
    await page.goto('/trade/investment?view=holdings');
};

const loadAccrualHoldings = async (page, {currency = 'USD'} = {}) => {
    await page.route('**/api/investment/transactions*', async (route) => {
        if (route.request().method() !== 'GET') return route.abort();
        await route.fulfill({json: {
            success: true,
            starting_cash: 10000,
            base_currency: 'USD',
            brokers: ['ibkr'],
            transactions: [
                {broker: 'ibkr', account: 'TEST', date: '2026-06-26', type: 'buy', currency: 'USD', ticker: 'AAPL', quantity: 10, price: 100, amount: -1000},
            ],
            price_history_by_ticker: {AAPL: [{date: '2026-06-26', close: 110}]},
            ticker_profiles: {},
            money_market_tickers: [],
            cash_equivalent_tickers: [],
            fx_rate_history_by_currency: {},
            ticker_lineage: {},
            summary: {},
            broker_summaries: {},
            broker_snapshots: {
                'ibkr:TEST': {
                    broker: 'ibkr',
                    account: 'TEST',
                    interest_accrual_snapshots: [
                        {as_of: '2026-06-26', status: 'reported', currency, amount: '-6.5'},
                    ],
                },
            },
            realtime_quotes: [],
            section_freshness: {},
        }});
    });
    await page.route('**/api/investment/realtime-quotes?*', route => route.fulfill({json: {success: true, quotes: []}}));
    await page.route('**/api/market-session/us-equity?*', route => route.fulfill({json: {success: true, session: 'off', is_trading_day: false, is_realtime_allowed: false, trading_days: []}}));
    await page.goto('/trade/investment?view=holdings');
};

test('missing FX with mixed P&L coverage withholds Holdings and Metrics totals', async ({page}) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await loadHoldings(page);
    const holdings = page.locator('#investment_holdings_panel');
    await expect(holdings).toContainText('Partial · total unavailable');
    await expect(holdings.locator('[data-pnl-coverage]')).toHaveAttribute('data-pnl-coverage', 'partial');
    await expect(holdings.locator('[data-pnl-coverage]')).toHaveAttribute('title', /5.HK/);
    await expect(holdings.locator('[data-investment-live-field="summary_total_equity"]')).toHaveText('-');
    await expect(holdings.locator('[data-investment-live-field="summary_cash_equivalents"]')).toHaveText('-');
    await page.goto('/trade/investment?view=metrics');
    await expect(page.locator('#investment_metrics_panel')).toContainText('Partial · total unavailable');
    expect(errors).toEqual([]);
});

test('missing cash FX cannot use an older numeric balance or equity', async ({page}) => {
    await loadHoldings(page, {foreignCash: true});
    const holdings = page.locator('#investment_holdings_panel');
    await expect(holdings.locator('[data-investment-live-field="summary_cash_balance"]')).toHaveText('-');
    await expect(holdings.locator('[data-investment-live-field="summary_total_equity"]')).toHaveText('-');
});

test('available FX restores complete Holdings valuation', async ({page}) => {
    await loadHoldings(page, {fx: {HKD: {dates: ['2026-01-02'], values: {'2026-01-02': 10}}}});
    const holdings = page.locator('#investment_holdings_panel');
    await expect(holdings.locator('[data-investment-live-field="summary_total_equity"]')).toHaveText('10,110.00');
    await expect(holdings).not.toContainText('Partial · total unavailable');
});

test('missing interest FX invalidates P&L even when every stock is calculable', async ({page}) => {
    await loadHoldings(page, {foreignCash: true, cashType: 'credit_interest'});
    const holdings = page.locator('#investment_holdings_panel');
    await expect(holdings).toContainText('Partial · total unavailable');
    await expect(holdings.locator('[data-pnl-coverage]')).toHaveAttribute('title', 'Cash-flow FX unavailable');
});

test('initial Holdings preserves dated interest accrual without realtime quotes', async ({page}) => {
    await loadAccrualHoldings(page);
    const holdings = page.locator('#investment_holdings_panel');
    const cash = Number(await holdings.locator('[data-investment-live-field="summary_cash_balance"]').getAttribute('data-investment-live-number'));
    const marketValue = Number(await holdings.locator('[data-investment-live-field="summary_market_value"]').getAttribute('data-investment-live-number'));
    const totalEquity = Number(await holdings.locator('[data-investment-live-field="summary_total_equity"]').getAttribute('data-investment-live-number'));
    expect(totalEquity).toBeCloseTo(cash + marketValue - 6.5, 8);
    const metricsTotalEquity = Number(await page.locator('#investment_metrics_panel [data-investment-live-field="metrics_total_equity"]').getAttribute('data-investment-live-number'));
    expect(metricsTotalEquity).toBeCloseTo(totalEquity, 8);
});

test('initial Holdings fails current NAV closed when accrual FX is missing', async ({page}) => {
    await loadAccrualHoldings(page, {currency: 'HKD'});
    const holdings = page.locator('#investment_holdings_panel');
    await expect(holdings.locator('[data-investment-live-field="summary_cash_balance"]')).not.toHaveText('-');
    await expect(holdings.locator('[data-investment-live-field="summary_market_value"]')).not.toHaveText('-');
    await expect(holdings.locator('[data-investment-live-field="summary_total_equity"]')).toHaveText('-');
    await expect(page.locator('#investment_metrics_panel [data-investment-live-field="metrics_total_equity"]')).toHaveText('-');
});
