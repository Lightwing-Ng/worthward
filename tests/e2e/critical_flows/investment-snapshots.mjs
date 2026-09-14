/* Code version: v1.0.0 */
import {
    expect,
    test,
    readFile,
    openBacktestParameterOverlay,
    fixturePath,
    requireChipFallback,
    setSidebarExpanded,
    tapAtCenter,
    readPriceLogoThemeAlignment,
    recordCostDistributionGuideStrokes,
    fulfillInertPriceLiveResponse,
    mockInvestmentReadApis,
    assertCompleteStandardInvestmentExportPayload,
} from './support.mjs';
test('anchors the latest IBKR buy to the verified current cash snapshot', async ({page}) => {
    await mockInvestmentReadApis(page, {
        brokers: ['ibkr'],
        startingCash: 0,
        transactions: [
            {
                ledger_no: 1,
                broker: 'ibkr',
                account: 'IBKR-TEST',
                date: '2026-08-18',
                datetime: '2026-08-18 03:00:00',
                type: 'deposit',
                currency: 'USD',
                // Preserve sub-cent source precision to verify the visible
                // cent-level history replay rather than hidden-fraction drift.
                amount: 1215.376,
            },
            {
                ledger_no: 2,
                broker: 'ibkr',
                account: 'IBKR-TEST',
                date: '2026-08-18',
                datetime: '2026-08-18 03:33:23',
                type: 'buy',
                ticker: 'DRAM',
                currency: 'USD',
                quantity: 5,
                price: 58,
                amount: -290.34827225,
            },
            {
                ledger_no: 3,
                broker: 'ibkr',
                account: 'IBKR-TEST',
                date: '2026-08-18',
                datetime: '2026-08-18 05:00:47',
                type: 'buy',
                ticker: 'DRAM',
                currency: 'USD',
                quantity: 5,
                price: 57,
                amount: -285.34327225,
            },
        ],
        summary: {
            authoritative_current_cash_brokers: ['ibkr'],
        },
        brokerSummaries: {
            ibkr: {
                broker: 'ibkr',
                account_id: 'IBKR-TEST',
                cash_snapshot_authoritative: true,
                ending_cash: '950.49',
                ending_cash_base_currency: '950.49',
                ending_cash_as_of: '2026-08-18',
                ending_cash_replay_as_of: '2026-08-18',
                ending_cash_as_of_datetime: '2026-08-18 05:00:47',
                ending_cash_replay_as_of_datetime: '2026-08-18 05:00:47',
            },
        },
        priceHistoryByTicker: {
            DRAM: [{date: '2026-08-18', close: 57.00}],
        },
    });
    await page.goto('/trade/investment');

    const firstBuyRow = page.locator('#investment_history_row_2');
    const latestBuyRow = page.locator('#investment_history_row_3');
    await expect(firstBuyRow.locator('td').nth(9)).toContainText('925.03');
    await expect(latestBuyRow.locator('td').nth(9)).toContainText('950.49');

    await page.locator('label[for="investment_view_holdings"]').click();
    await expect(
        page.locator('#investment_holdings_panel [data-investment-live-field="summary_cash_balance"]'),
    ).toHaveAttribute('data-investment-live-display', '950.49');

    await page.locator('label[for="investment_view_metrics"]').click();
    await expect(
        page.locator('#investment_metrics_panel [data-investment-live-field="metrics_cash"]'),
    ).toHaveAttribute('data-investment-live-display', '950.49');
});

test('keeps HSBC buy and sell equity conserved across 30 Jun–2 Jul settlement dates', async ({page}) => {
    await mockInvestmentReadApis(page, {
        brokers: ['hsbc'],
        transactions: [
            {
                broker: 'hsbc',
                account: 'HSBC-TEST',
                date: '2026-06-30',
                type: 'deposit',
                currency: 'USD',
                amount: 10_000,
                source: {
                    file_kind: 'hsbc_usd_savings_csv',
                    cash_balance_authoritative: true,
                    balance_after_raw: '10000.00',
                    ledger_sequence: 301,
                },
            },
            {
                broker: 'hsbc',
                account: 'HSBC-TEST',
                date: '2026-06-30',
                type: 'buy',
                ticker: 'BOXX',
                currency: 'USD',
                quantity: 1,
                price: 900,
                amount: -900,
                source: {
                    file_kind: 'hsbc_order_status_text',
                    cash_replay_pending_settlement: true,
                    cash_settlement_date: '2026-07-01',
                    cash_settlement_amount_raw: '-900.00',
                    cash_settlement_balance_after_raw: '9100.00',
                    cash_settlement_postings: [{
                        date: '2026-07-01',
                        amount_raw: '-900.00',
                        balance_after_raw: '9100.00',
                        source_file_kind: 'hsbc_usd_savings_csv',
                        ledger_sequence: 302,
                        currency: 'USD',
                        role: 'principal',
                    }],
                },
            },
            {
                broker: 'hsbc',
                account: 'HSBC-TEST',
                date: '2026-07-01',
                type: 'deposit',
                currency: 'USD',
                amount: 0,
                source: {
                    file_kind: 'hsbc_usd_savings_csv',
                    cash_balance_authoritative: true,
                    balance_after_raw: '9100.00',
                    ledger_sequence: 303,
                },
            },
            {
                broker: 'hsbc',
                account: 'HSBC-TEST',
                date: '2026-07-02',
                type: 'sell',
                ticker: 'BOXX',
                currency: 'USD',
                quantity: 1,
                price: 900,
                amount: 900,
                source: {
                    file_kind: 'hsbc_order_status_text',
                    cash_replay_pending_settlement: true,
                    cash_settlement_date: '2026-07-03',
                    cash_settlement_amount_raw: '900.00',
                    cash_settlement_balance_after_raw: '10000.00',
                    cash_settlement_postings: [{
                        date: '2026-07-03',
                        amount_raw: '900.00',
                        balance_after_raw: '10000.00',
                        source_file_kind: 'hsbc_usd_savings_csv',
                        ledger_sequence: 304,
                        currency: 'USD',
                        role: 'principal',
                    }],
                },
            },
            {
                broker: 'hsbc',
                account: 'HSBC-TEST',
                date: '2026-07-03',
                type: 'deposit',
                currency: 'USD',
                amount: 0,
                source: {
                    file_kind: 'hsbc_usd_savings_csv',
                    cash_balance_authoritative: true,
                    balance_after_raw: '10000.00',
                    ledger_sequence: 305,
                },
            },
        ],
        priceHistoryByTicker: {
            BOXX: [
                {date: '2026-06-30', close: 900},
                {date: '2026-07-01', close: 900},
                {date: '2026-07-02', close: 900},
                {date: '2026-07-03', close: 900},
            ],
        },
    });
    await page.goto('/trade/investment?range=max');
    await expect.poll(() => page.evaluate(() => (
        window.Chart?.getChart(document.querySelector('#investmentEquityChart'))?.data?.rawLabels?.length || 0
    ))).toBeGreaterThan(0);

    const chartValues = await page.evaluate(() => {
        const chart = window.Chart?.getChart(document.querySelector('#investmentEquityChart'));
        return (chart?.data?.rawLabels || []).map((date, index) => ({
            date,
            value: Number(chart.data.datasets?.[0]?.data?.[index]),
        }));
    });
    for (const date of ['2026-06-30', '2026-07-01', '2026-07-02', '2026-07-03']) {
        expect(chartValues.find((point) => point.date === date)?.value).toBeCloseTo(10_000, 8);
    }
});

test('keeps HSBC account-type cash boundaries out of a 6457-shaped cash spike', async ({page}) => {
    await mockInvestmentReadApis(page, {
        brokers: ['hsbc'],
        transactions: [
            {
                broker: 'hsbc',
                account: '000-999999-999',
                date: '2026-06-01',
                type: 'deposit',
                currency: 'HKD',
                amount: 27_462.16,
                source: {
                    account_type: 'HKD Savings',
                    balance_after_raw: '27462.16',
                    file_kind: 'hsbc_multi_currency_cash_account_text',
                },
            },
            {
                broker: 'hsbc',
                account: '000-999999-999',
                date: '2026-06-02',
                type: 'deposit',
                currency: 'HKD',
                amount: 0,
                description: 'HKD Savings balance snapshot',
                source: {
                    account_type: 'HKD Savings',
                    balance_after_raw: '89.24',
                    file_kind: 'hsbc_multi_currency_cash_account_text',
                },
            },
            {
                broker: 'hsbc',
                account: '000-999999-999',
                date: '2026-06-03',
                type: 'deposit',
                currency: 'USD',
                amount: 11_108.38,
                source: {
                    account_type: 'USD Savings',
                    balance_after_raw: '21108.38',
                    file_kind: 'hsbc_usd_account_text',
                },
            },
            {
                broker: 'hsbc',
                account: '000-999999-999',
                date: '2026-06-04',
                type: 'withdrawal',
                currency: 'CNH',
                amount: 0,
                description: 'RMB Savings balance snapshot',
                source: {
                    account_type: 'RMB Savings',
                    balance_after_raw: '0.00',
                    file_kind: 'hsbc_multi_currency_cash_account_text',
                },
            },
        ],
        fxRateHistoryByCurrency: {
            HKD: {dates: ['2026-06-04'], values: {'2026-06-04': 7.8}},
        },
    });
    await page.goto('/trade/investment?range=max');
    const cnhRow = page.locator('#investment_history_row_4');
    await expect(cnhRow).toHaveCount(1);
    const cashText = await cnhRow.locator('td').nth(9).innerText();
    const cashValue = Number(cashText.replace(/[^\d.-]/g, ''));
    expect(cashValue).toBeCloseTo(21_119.82, 2);
    expect(cashValue).toBeLessThan(22_000);
});

test('keeps the HSBC pending-settlement marker separate from FX conversion', async ({page}) => {
    await page.addInitScript(() => {
        const RealDate = Date;
        const fixedTimestamp = new RealDate('2026-08-20T12:00:00').valueOf();
        class FixedDate extends RealDate {
            constructor(...args) {
                super(...(args.length ? args : [fixedTimestamp]));
            }

            static now() {
                return fixedTimestamp;
            }
        }
        window.Date = FixedDate;
    });
    await mockInvestmentReadApis(page, {
        brokers: ['hsbc', 'ibkr', 'schwab'],
        transactions: [
            {ledger_no: 1, broker: 'hsbc', date: '2026-08-14', type: 'deposit', currency: 'USD', amount: 0},
            {
                ledger_no: 2,
                broker: 'ibkr',
                date: '2026-08-14',
                type: 'buy',
                ticker: 'TEST',
                currency: 'USD',
                quantity: 1,
                price: 1,
                amount: -1,
            },
            {ledger_no: 3, broker: 'schwab', date: '2026-08-15', type: 'deposit', currency: 'USD', amount: 0},
        ],
        priceHistoryByTicker: {
            TEST: [{date: '2026-08-14', close: 1}],
        },
        summary: {
            authoritative_current_cash_brokers: ['hsbc', 'ibkr', 'schwab'],
        },
        brokerSummaries: {
            hsbc: {
                broker: 'hsbc',
                cash_snapshot_authoritative: true,
                ending_cash: '23412.54',
                ending_cash_base_currency: '23412.54',
                ending_cash_as_of: '2026-08-19',
                ending_cash_by_currency: {
                    USD: '23412.54',
                    HKD: '89.24',
                    CNH: '0.00',
                },
                hsbc_bank_available_cash: '23388.54',
                cash_ledger_balance: '23412.54',
                hsbc_broker_cash_estimate: '23387.940',
                hsbc_pending_settlement_cash: '-24.600',
                hsbc_pending_settlement_order_count: 1,
            },
            ibkr: {
                broker: 'ibkr',
                cash_snapshot_authoritative: true,
                ending_cash: '950.49',
                ending_cash_base_currency: '950.49',
                ending_cash_as_of: '2026-08-19',
            },
            schwab: {
                broker: 'schwab',
                cash_snapshot_authoritative: true,
                ending_cash: '0.41',
                ending_cash_base_currency: '0.41',
                ending_cash_as_of: '2026-08-15',
            },
        },
        fxRateHistoryByCurrency: {
            HKD: {
                dates: ['2026-08-19'],
                values: {'2026-08-19': 7.842899799346924},
            },
        },
    });
    await page.goto('/trade/investment');
    await page.locator('label[for="investment_view_holdings"]').click();

    const cash = page.locator(
        '#investment_holdings_panel [data-investment-live-field="summary_cash_balance"]',
    );
    const totalEquity = page.locator(
        '#investment_holdings_panel [data-investment-live-field="summary_total_equity"]',
    );
    await expect(cash).toHaveAttribute('data-investment-live-display', '*24,350.22');
    expect(Number(await cash.getAttribute('data-investment-live-number'))).toBeCloseTo(
        23_387.94 + (89.24 / 7.842899799346924) + 950.49 + 0.41,
        8,
    );
    expect(Number(await totalEquity.getAttribute('data-investment-live-number'))).toBeCloseTo(
        Number(await cash.getAttribute('data-investment-live-number')) + 1,
        8,
    );

    await page.locator('label[for="investment_view_metrics"]').click();
    const brokerSelector = page.locator(
        '#investment_metrics_panel_shell [data-investment-broker-filter-trigger]',
    );
    await brokerSelector.click();
    await page.getByRole('option', {name: 'HSBC', exact: true}).click();
    const metricsCash = page.locator(
        '#investment_metrics_panel [data-investment-live-field="metrics_cash"]',
    );
    await expect(metricsCash).toHaveAttribute(
        'data-investment-live-display',
        '*23,399.32',
    );
    expect(Number(await metricsCash.getAttribute('data-investment-live-number'))).toBeCloseTo(
        23_387.94 + (89.24 / 7.842899799346924),
        8,
    );
});

test('sums HSBC, IBKR, and Schwab current cash before adding holdings equity', async ({page}) => {
    await mockInvestmentReadApis(page, {
        brokers: ['hsbc', 'ibkr', 'schwab'],
        transactions: [
            {
                ledger_no: 1,
                broker: 'hsbc',
                account: 'HSBC-TEST',
                date: '2026-08-18',
                datetime: '2026-08-18 10:00:00',
                type: 'deposit',
                currency: 'USD',
                amount: 26360.01,
            },
            {
                ledger_no: 2,
                broker: 'hsbc',
                account: 'HSBC-TEST',
                date: '2026-08-18',
                datetime: '2026-08-18 10:01:00',
                type: 'buy',
                ticker: 'TEST',
                currency: 'USD',
                quantity: 1,
                price: 653.90,
                amount: -653.90,
                source: {
                    cash_replay_pending_settlement: true,
                },
            },
            {
                ledger_no: 3,
                broker: 'ibkr',
                account: 'IBKR-TEST',
                date: '2026-08-18',
                type: 'deposit',
                currency: 'USD',
                amount: 0,
            },
            {
                ledger_no: 4,
                broker: 'schwab',
                account: 'SCHWAB-TEST',
                date: '2026-08-18',
                type: 'deposit',
                currency: 'USD',
                amount: 0,
            },
        ],
        priceHistoryByTicker: {
            TEST: [{date: '2026-08-18', close: 653.90}],
        },
        summary: {
            authoritative_current_cash_brokers: ['hsbc', 'ibkr', 'schwab'],
        },
        brokerSummaries: {
            hsbc: {
                broker: 'hsbc',
                cash_snapshot_authoritative: true,
                ending_cash: '23387.94',
                ending_cash_base_currency: '23387.94',
                ending_cash_as_of: '2026-08-19',
                ending_cash_by_currency: {
                    USD: '23387.94',
                    HKD: '89.24',
                },
                hsbc_bank_available_cash: '23388.54',
                cash_ledger_balance: '23387.94',
                hsbc_broker_cash_estimate: '23387.940',
                hsbc_pending_settlement_cash: '0.000',
                hsbc_pending_settlement_order_count: 0,
            },
            ibkr: {
                broker: 'ibkr',
                cash_snapshot_authoritative: true,
                ending_cash: '950.49',
                ending_cash_as_of: '2026-08-19',
            },
            schwab: {
                broker: 'schwab',
                cash_snapshot_authoritative: true,
                ending_cash: '0.41',
                ending_cash_as_of: '2026-08-18',
            },
        },
        fxRateHistoryByCurrency: {
            HKD: {
                dates: ['2026-08-18'],
                values: {'2026-08-18': 7.842899799346924},
            },
        },
    });
    await page.goto('/trade/investment');
    await page.locator('label[for="investment_view_holdings"]').click();

    const cash = page.locator(
        '#investment_holdings_panel [data-investment-live-field="summary_cash_balance"]',
    );
    const totalEquity = page.locator(
        '#investment_holdings_panel [data-investment-live-field="summary_total_equity"]',
    );
    await expect(cash).toHaveAttribute('data-investment-live-display', '24,350.22');
    await expect(totalEquity).toHaveAttribute('data-investment-live-display', '25,004.12');
});

test('keeps mixed-broker aggregate cash continuous when current HSBC cash postdates its latest trade', async ({page}) => {
    await mockInvestmentReadApis(page, {
        brokers: ['hsbc', 'ibkr', 'schwab'],
        startingCash: 0,
        transactions: [
            {
                broker: 'hsbc',
                account: 'HSBC-TEST',
                date: '2026-08-20',
                datetime: '2026-08-20 19:00:00',
                type: 'deposit',
                currency: 'USD',
                amount: 10_000,
            },
            {
                broker: 'hsbc',
                account: 'HSBC-TEST',
                date: '2026-08-20',
                datetime: '2026-08-20 19:01:00',
                type: 'transfer_in',
                ticker: 'SGOV',
                currency: 'USD',
                quantity: 100,
                amount: 0,
            },
            {
                broker: 'ibkr',
                account: 'IBKR-TEST',
                date: '2026-08-20',
                datetime: '2026-08-20 19:02:00',
                type: 'deposit',
                currency: 'USD',
                amount: 1_000,
            },
            {
                broker: 'schwab',
                account: 'SCHWAB-TEST',
                date: '2026-08-20',
                datetime: '2026-08-20 19:03:00',
                type: 'deposit',
                currency: 'USD',
                amount: 500,
            },
            {
                broker: 'hsbc',
                account: 'HSBC-TEST',
                date: '2026-08-21',
                datetime: '2026-08-21 20:00:00',
                type: 'sell',
                ticker: 'SGOV',
                currency: 'USD',
                quantity: 100,
                price: 100,
                amount: 10_000,
                source: {
                    file_kind: 'hsbc_order_status_text',
                    statement_order_id: 'S-SGOV',
                    cash_settlement_date: '2026-08-24',
                    cash_settlement_amount_raw: '10000.00',
                    cash_settlement_balance_after_raw: '20000.00',
                    cash_settlement_postings: [{
                        date: '2026-08-24',
                        amount_raw: '10000.00',
                        balance_after_raw: '20000.00',
                        source_file_kind: 'hsbc_usd_savings_csv',
                        ledger_sequence: 201,
                        currency: 'USD',
                        role: 'principal',
                    }],
                },
            },
            {
                broker: 'hsbc',
                account: 'HSBC-TEST',
                date: '2026-08-24',
                datetime: '2026-08-24 20:00:00',
                type: 'buy',
                ticker: 'EUV',
                currency: 'USD',
                quantity: 10,
                price: 100,
                amount: -1_000,
                source: {
                    file_kind: 'hsbc_order_status_text',
                    statement_order_id: 'P-EUV',
                    cash_settlement_date: '2026-08-25',
                    cash_settlement_amount_raw: '-1000.00',
                    cash_settlement_balance_after_raw: '19000.00',
                    cash_settlement_postings: [{
                        date: '2026-08-25',
                        amount_raw: '-1000.00',
                        balance_after_raw: '19000.00',
                        source_file_kind: 'hsbc_usd_savings_csv',
                        ledger_sequence: 202,
                        currency: 'USD',
                        role: 'principal',
                    }],
                },
            },
            {
                broker: 'hsbc',
                account: 'HSBC-TEST',
                date: '2026-08-25',
                datetime: '2026-08-25 20:00:00',
                type: 'sell',
                ticker: 'EUV',
                currency: 'USD',
                quantity: 5,
                price: 100,
                amount: 500,
                source: {
                    file_kind: 'hsbc_order_status_text',
                    statement_order_id: 'S-EUV',
                    cash_settlement_date: '2026-08-26',
                    cash_settlement_amount_raw: '500.00',
                    cash_settlement_balance_after_raw: '19500.00',
                    cash_settlement_postings: [{
                        date: '2026-08-26',
                        amount_raw: '500.00',
                        balance_after_raw: '19500.00',
                        source_file_kind: 'hsbc_usd_savings_csv',
                        ledger_sequence: 203,
                        currency: 'USD',
                        role: 'principal',
                    }],
                },
            },
            {
                broker: 'ibkr',
                account: 'IBKR-TEST',
                date: '2026-08-27',
                datetime: '2026-08-27 02:43:00',
                type: 'deposit',
                currency: 'USD',
                amount: 0,
            },
        ],
        priceHistoryByTicker: {
            SGOV: [
                {date: '2026-08-20', close: 100},
                {date: '2026-08-21', close: 100},
                {date: '2026-08-24', close: 100},
                {date: '2026-08-25', close: 100},
                {date: '2026-08-26', close: 100},
                {date: '2026-08-27', close: 100},
            ],
            EUV: [
                {date: '2026-08-24', close: 100},
                {date: '2026-08-25', close: 100},
                {date: '2026-08-26', close: 100},
                {date: '2026-08-27', close: 100},
            ],
        },
        summary: {
            authoritative_current_cash_brokers: ['hsbc', 'ibkr', 'schwab'],
        },
        brokerSummaries: {
            hsbc: {
                broker: 'hsbc',
                cash_snapshot_authoritative: true,
                ending_cash: '19500.00',
                ending_cash_base_currency: '19500.00',
                ending_cash_by_currency: {USD: '19500.00'},
                hsbc_cash_component_post_dates: {'USD:SAVINGS': '2026-08-26'},
                hsbc_pending_settlement_cash: '0.00',
                hsbc_pending_settlement_order_count: 0,
            },
            ibkr: {
                broker: 'ibkr',
                cash_snapshot_authoritative: true,
                ending_cash: '1000.00',
                ending_cash_as_of: '2026-08-27',
                ending_cash_as_of_datetime: '2026-08-27 02:43:00',
                ending_cash_by_currency: {USD: '1000.00'},
            },
            schwab: {
                broker: 'schwab',
                cash_snapshot_authoritative: true,
                ending_cash: '500.00',
                ending_cash_as_of: '2026-08-20',
                ending_cash_by_currency: {USD: '500.00'},
            },
        },
    });
    await page.goto('/trade/investment?range=max');
    await expect.poll(() => page.evaluate(() => (
        window.Chart?.getChart(document.querySelector('#investmentEquityChart'))?.data?.rawLabels?.length || 0
    ))).toBeGreaterThan(0);

    const replay = await page.evaluate(() => {
        const chart = window.Chart?.getChart(document.querySelector('#investmentEquityChart'));
        const points = (chart?.data?.rawLabels || []).map((date, index) => ({
            date,
            equity: Number(chart.data.datasets?.[0]?.data?.[index]),
        }));
        const holdingsTotal = Number(document.querySelector(
            '#investment_holdings_panel [data-investment-live-field="summary_total_equity"]',
        )?.dataset.investmentLiveNumber);
        return {points, holdingsTotal};
    });
    const expectedEquity = 21_500;
    ['2026-08-24', '2026-08-25', '2026-08-26'].forEach((date) => {
        expect(replay.points.find((point) => point.date === date)?.equity).toBeCloseTo(
            expectedEquity,
            8,
        );
    });
    expect(replay.points.at(-1)?.equity).toBeCloseTo(replay.holdingsTotal, 8);
});

test('keeps HSBC pending-sell cash source-bounded in history and equity', async ({page}) => {
    await mockInvestmentReadApis(page, {
        brokers: ['hsbc'],
        transactions: [
            {
                broker: 'hsbc',
                account: 'HSBC-TEST',
                date: '2026-08-01',
                type: 'buy',
                ticker: 'EUV',
                currency: 'USD',
                quantity: 86,
                price: 20,
                amount: -1720,
            },
            {
                broker: 'hsbc',
                account: 'HSBC-TEST',
                date: '2026-08-01',
                type: 'buy',
                ticker: 'DRAM',
                currency: 'USD',
                quantity: 206,
                price: 40,
                amount: -8240,
            },
            {
                broker: 'hsbc',
                account: 'HSBC-TEST',
                date: '2026-08-04',
                datetime: '2026-08-04 20:00:00',
                type: 'sell',
                ticker: 'EUV',
                currency: 'USD',
                quantity: 6,
                price: 25.58,
                amount: 153.48,
                normalized: {
                    net_amount: '153.48',
                    gross_amount: '153.48',
                    position_quantity: '6',
                    unit_price: '25.58',
                },
                source: {
                    cash_replay_pending_settlement: true,
                    // A malformed legacy value is not settlement evidence.
                    cash_settlement_amount_raw: 'NaN',
                    order_id: 'S-900002',
                },
            },
            {
                broker: 'hsbc',
                account: 'HSBC-TEST',
                date: '2026-08-04',
                datetime: '2026-08-04 20:00:01',
                type: 'sell',
                ticker: 'DRAM',
                currency: 'USD',
                quantity: 6,
                price: 54.62,
                amount: 327.72,
                normalized: {
                    net_amount: '327.72',
                    gross_amount: '327.72',
                    position_quantity: '6',
                    unit_price: '54.62',
                },
                source: {
                    cash_replay_pending_settlement: true,
                    order_id: 'S-900003',
                },
            },
            {
                broker: 'hsbc',
                account: 'HSBC-TEST',
                date: '2026-08-04',
                datetime: '2026-08-04 20:00:02',
                type: 'withdrawal',
                currency: 'CNH',
                amount: -500.01,
                normalized: {net_amount: '-500.01'},
                source: {
                    file_kind: 'hsbc_multi_currency_cash_account_text',
                    account_number: 'HSBC-TEST',
                },
            },
        ],
        brokerSummaries: {
            hsbc: {
                broker: 'hsbc',
                account_id: 'HSBC-TEST',
                ending_cash: '20444.97',
                ending_cash_base_currency: '20444.97',
                ending_cash_by_currency: {
                    CNH: '500.01',
                    HKD: '530.87',
                    USD: '20444.97',
                },
                position_snapshot_authoritative: true,
                position_snapshot: {
                    EUV: {quantity: '80', market_value: '2060', last_price: '25.75'},
                    DRAM: {quantity: '200', market_value: '10980', last_price: '54.90'},
                },
            },
        },
        summary: {position_snapshot_authoritative: true},
        positionSnapshot: {
            EUV: {quantity: '80', market_value: '2060', last_price: '25.75'},
            DRAM: {quantity: '200', market_value: '10980', last_price: '54.90'},
        },
        priceHistoryByTicker: {
            EUV: [{date: '2026-08-04', close: 25.75}],
            DRAM: [{date: '2026-08-04', close: 54.90}],
        },
        intradayRows: (url) => {
            const ticker = url.searchParams.get('ticker');
            const days = (url.searchParams.get('days') || '').split(',').filter(Boolean);
            const close = ticker === 'EUV' ? 25.50 : 55.00;
            return days.flatMap((day) => [
                {date: `${day} 15:59`, open: close, high: close, low: close, close: close - 0.10},
                {date: `${day} 16:00`, open: close, high: close, low: close, close},
            ]);
        },
        fxRateHistoryByCurrency: {
            CNH: {dates: ['2026-08-04'], values: {'2026-08-04': 7.2}},
            HKD: {dates: ['2026-08-04'], values: {'2026-08-04': 7.8}},
        },
    });
    await page.goto('/trade/investment');

    const euvSellRow = page.locator('#investment_history_row_3');
    const dramSellRow = page.locator('#investment_history_row_4');
    await expect(euvSellRow.locator('td').nth(8)).toContainText('13,370.00');
    await expect(dramSellRow.locator('td').nth(8)).toContainText('13,040.00');
    await expect(euvSellRow.locator('td').nth(9)).toContainText('*20,598.45');
    await expect(dramSellRow.locator('td').nth(9)).toContainText('*20,926.17');
    await expect(euvSellRow.locator('td').nth(10)).toContainText('*33,968.45');
    await expect(dramSellRow.locator('td').nth(10)).toContainText('*33,966.17');
    const cnhWithdrawalRow = page.locator('#investment_history_row_5');
    await expect(cnhWithdrawalRow.locator('td').nth(8)).not.toContainText('*');
    await expect(cnhWithdrawalRow.locator('td').nth(9)).toContainText(/^\*/);
    await expect(cnhWithdrawalRow.locator('td').nth(10)).toContainText(/^\*/);
    const exportButton = page.locator('#export_transactions_button');
    const downloadPromise = page.waitForEvent('download');
    await exportButton.click();
    const download = await downloadPromise;
    const downloadPath = await download.path();
    expect(downloadPath).not.toBeNull();
    const markdown = await readFile(downloadPath, 'utf8');
    expect(markdown).not.toContain('*20,598.45');
    expect(markdown).not.toContain('*33,968.45');

    await page.locator('label[for="investment_view_holdings"]').click();
    const liveSummary = await page.evaluate(() => {
        const read = (field) => Number(
            document.querySelector(
                `#investment_holdings_panel [data-investment-live-field="${field}"]`,
            )?.dataset.investmentLiveNumber,
        );
        return {
            cash: read('summary_cash_balance'),
            marketValue: read('summary_market_value'),
            totalEquity: read('summary_total_equity'),
        };
    });
    expect(liveSummary.totalEquity).toBeCloseTo(
        liveSummary.cash + liveSummary.marketValue,
        8,
    );
});

test('keeps pending HSBC history cash independent of earlier settlement corrections and broker filters', async ({page}) => {
    await mockInvestmentReadApis(page, {
        brokers: ['hsbc', 'ibkr'],
        transactions: [
            {broker: 'ibkr', date: '2026-08-01', type: 'deposit', currency: 'USD', amount: 4000},
            {
                broker: 'hsbc', account: 'HSBC-TEST', date: '2026-08-02',
                type: 'buy', ticker: 'DRAM', currency: 'USD', quantity: 100, price: 50, amount: -5000,
                source: {
                    order_id: 'P-900001', cash_settlement_date: '2026-08-03',
                    cash_settlement_amount_raw: '-5000', cash_settlement_balance_after_raw: '20000',
                },
            },
            {
                broker: 'hsbc', account: 'HSBC-TEST', date: '2026-08-04',
                type: 'sell', ticker: 'DRAM', currency: 'USD', quantity: 5, price: 60, amount: 300,
                source: {order_id: 'S-900002', cash_replay_pending_settlement: true},
            },
        ],
        brokerSummaries: {
            hsbc: {
                broker: 'hsbc', account: 'HSBC-TEST', ending_cash: '20000',
                ending_cash_base_currency: '20000', cash_snapshot_authoritative: true,
                cash_snapshot_as_of: '2026-08-05', position_snapshot_authoritative: true,
                position_snapshot: {DRAM: {quantity: '95', market_value: '5700', last_price: '60'}},
            },
        },
        priceHistoryByTicker: {DRAM: [{date: '2026-08-02', close: 50}, {date: '2026-08-04', close: 60}]},
        intradayRows: () => [],
    });
    for (const broker of ['', 'hsbc', 'hsbc,ibkr']) {
        await page.goto(`/trade/investment?view=holdings${broker ? `&broker=${broker}` : ''}`);
        const row = page.locator('[id^="investment_history_row_"]').filter({hasText: 'S-900002'});
        await expect(row).toHaveCount(1);
        await expect(row.locator('td').nth(8)).toContainText('5,700.00');
        await expect(row.locator('td').nth(9)).toContainText('*20,300.00');
        await expect(row.locator('td').nth(10)).toContainText('*26,000.00');
        const settled = page.locator('[id^="investment_history_row_"]').filter({hasText: 'Buy'});
        await expect(settled.locator('td').nth(9)).toContainText('20,000.00');
        await expect(settled.locator('td').nth(9)).not.toContainText('*');
    }
});

test('keeps actual aggregate cash after an internal subaccount bridge', async ({page}) => {
    await mockInvestmentReadApis(page, {
        brokers: ['futuhk'],
        transactions: [
            {
                broker: 'futuhk',
                account: 'FUTU-TEST',
                date: '2023-02-16',
                type: 'deposit',
                currency: 'USD',
                amount: 1271.50,
                normalized: {net_amount: '1271.50'},
                internal_transfer_external_flow_excluded: true,
            },
            {
                broker: 'futuhk',
                account: 'FUTU-TEST',
                date: '2023-02-16',
                type: 'buy',
                ticker: 'TST',
                currency: 'USD',
                quantity: 1,
                price: 10,
                amount: -10,
            },
            {
                broker: 'futuhk',
                account: 'FUTU-TEST',
                date: '2023-03-28',
                type: 'withdrawal',
                currency: 'USD',
                amount: -1271.50,
                normalized: {net_amount: '-1271.50'},
            },
        ],
        priceHistoryByTicker: {
            TST: [
                {date: '2023-02-16', close: 10},
                {date: '2023-03-28', close: 10},
            ],
        },
    });
    await page.goto('/trade/investment?range=max');
    await page.locator('label[for="investment_view_holdings"]').click();

    const liveSummary = new Map([
        ['summary_cash_balance', '9990'],
        ['summary_cash_equivalents', '9990'],
        ['summary_market_value', '10'],
        ['summary_total_equity', '10000'],
    ]);
    for (const [field, expectedValue] of liveSummary) {
        await expect(page.locator(
            `#investment_holdings_panel [data-investment-live-field="${field}"]`,
        )).toHaveAttribute('data-investment-live-number', expectedValue);
    }
    const chartValues = await page.evaluate(() => {
        const chart = window.Chart?.getChart(document.querySelector('#investmentEquityChart'));
        const values = new Map((chart?.data?.rawLabels || []).map((date, index) => [
            date,
            chart?.data?.datasets?.[0]?.data?.[index],
        ]));
        return {
            bridgeDate: values.get('2023-02-16'),
            finalDate: values.get('2023-03-28'),
        };
    });
    expect(chartValues.bridgeDate).toBe(10000);
    expect(chartValues.finalDate).toBe(10000);
});

test('renders incomplete historical valuations as unavailable instead of zero', async ({page}) => {
    await mockInvestmentReadApis(page, {
        transactions: [
            {
                ledger_no: 1,
                broker: 'ibkr',
                account: 'IBKR-TEST',
                date: '2024-05-03',
                type: 'buy',
                ticker: 'AMD',
                currency: 'USD',
                quantity: 10,
                price: 10,
                amount: -100,
            },
        ],
    });

    await page.goto('/trade/investment?range=max');

    const row = page.locator('#investment_history_row_1');
    await expect(row.locator('td').nth(8)).toHaveText('--');
    await expect(row.locator('td').nth(10)).toHaveText('--');
    const chartValue = await page.evaluate(() => {
        const chart = window.Chart?.getChart(document.querySelector('#investmentEquityChart'));
        const index = chart?.data?.rawLabels?.indexOf('2024-05-03') ?? -1;
        return index >= 0 ? chart?.data?.datasets?.[0]?.data?.[index] : undefined;
    });
    expect(chartValue).toBeNull();
});

test('keeps the latest yfinance post-market quote when Longbridge overnight data is unavailable', async ({page}) => {
    await page.addInitScript(() => {
        const RealDate = Date;
        const fixedTimestamp = new RealDate('2026-07-28T03:30:00Z').valueOf();
        class FixedDate extends RealDate {
            constructor(...args) {
                super(...(args.length ? args : [fixedTimestamp]));
            }

            static now() {
                return fixedTimestamp;
            }
        }
        window.Date = FixedDate;
    });
    await mockInvestmentReadApis(page, {
        transactions: [
            {
                ledger_no: 1,
                broker: 'ibkr',
                date: '2026-07-27',
                type: 'buy',
                ticker: 'DRAM',
                currency: 'USD',
                quantity: 10,
                price: 52.43,
                amount: -524.30,
            },
        ],
        priceHistoryByTicker: {
            DRAM: [
                {date: '2026-07-24', close: 53.20},
                {date: '2026-07-27', close: 52.43},
            ],
        },
        realtimeQuotes: [{
            ticker: 'DRAM',
            price: 51.80,
            timestamp: '2026-07-27 19:59',
            session: 'post',
            session_date: '2026-07-27',
            market: 'US',
            source: 'yfinance',
        }],
        marketSession: {
            session: 'overnight',
            is_trading_day: true,
            is_realtime_allowed: true,
            session_date: '2026-07-28',
        },
    });
    await page.setViewportSize({width: 1_024, height: 863});
    await page.goto('/trade/investment');
    await page.locator('label[for="investment_view_holdings"]').click();

    const holdingRow = page.locator(
        '#investment_holdings_panel [data-table-scroll] tr[data-investment-holdings-ticker="DRAM"]',
    );
    const lastPrice = holdingRow.locator('[data-investment-live-field="last"]');
    const unrealizedPnl = holdingRow.locator('[data-investment-live-field="unrealized_pnl"]');
    await expect(lastPrice).toHaveAttribute('data-investment-live-display', '51.80');
    await expect(unrealizedPnl).toHaveAttribute('data-investment-live-display', '-6.30');
    await expect(page.locator('[data-investment-equity-live-marker]')).toBeHidden();
});

test('anchors the Overview live marker to Hong Kong\'s current date after the US session closes', async ({page}) => {
    await page.addInitScript(() => {
        const RealDate = Date;
        const fixedTimestamp = new RealDate('2026-07-23T06:00:00Z').valueOf();
        class FixedDate extends RealDate {
            constructor(...args) {
                super(...(args.length ? args : [fixedTimestamp]));
            }

            static now() {
                return fixedTimestamp;
            }
        }
        window.Date = FixedDate;
    });
    await mockInvestmentReadApis(page, {
        transactions: [
            {ledger_no: 1, broker: 'longbridge_hk', date: '2026-07-22', type: 'buy', ticker: '700.HK', currency: 'HKD', quantity: 10, price: 400, amount: -4000},
        ],
        priceHistoryByTicker: {
            '700.HK': [
                {date: '2026-07-21', close: 398},
                {date: '2026-07-22', close: 400},
            ],
        },
        realtimeQuotes: [{
            ticker: '700.HK',
            price: 405,
            timestamp: '2026-07-23 14:00',
            session: 'intraday',
            session_date: '2026-07-23',
            market: 'HK',
            source: 'yfinance',
        }],
        marketSession: {
            session: 'off',
            is_trading_day: true,
            is_realtime_allowed: false,
            session_date: '2026-07-22',
        },
    });
    await page.setViewportSize({width: 1_024, height: 863});
    await page.goto('/trade/investment');

    const marker = page.locator('[data-investment-equity-live-marker]');
    await expect.poll(() => marker.evaluate((element) => !element.hidden)).toBe(true);
    await expect.poll(() => page.evaluate(() => {
        const chart = window.Chart?.getChart(document.querySelector('#investmentEquityChart'));
        const labels = chart?.data?.labels || [];
        return String(labels[labels.length - 1] || '');
    })).toBe('2026-07-23');
});

test('exports a semantically labeled Investment Markdown report with its active scope', async ({page}) => {
    await mockInvestmentReadApis(page, {
        transactions: [
            {
                ledger_no: 1,
                broker: 'ibkr',
                date: '2026-07-21',
                type: 'buy',
                ticker: 'QQQ',
                currency: 'USD',
                quantity: 1,
                price: 500,
                amount: -500,
                commission: 1,
            },
        ],
        priceHistoryByTicker: {
            QQQ: [
                {date: '2026-07-21', close: 500},
                {date: '2026-07-22', close: 505},
            ],
        },
    });
    await page.goto('/trade/investment');

    const exportButton = page.locator('#export_transactions_button');
    await expect(exportButton).toBeVisible();
    const downloadPromise = page.waitForEvent('download');
    await exportButton.click();
    const download = await downloadPromise;
    const downloadPath = await download.path();
    expect(downloadPath).not.toBeNull();
    const markdown = await readFile(downloadPath, 'utf8');

    expect(markdown).toContain('Filters: Broker: All brokers; Type: All types; Currency: All currencies; Description: All descriptions; Equity range: Max');
    expect(markdown).toContain('| Broker | No. | Time | Type | Description | Currency | Amount | Commission | Market value | Cash | Equity |');
    expect(markdown).toContain('| IBKR | 1 |');
});

test('keeps a Stock details Markdown export range aligned with its transaction-date filter', async ({page}) => {
    await mockInvestmentReadApis(page, {
        transactions: [
            {ledger_no: 1, broker: 'ibkr', date: '2026-07-21', type: 'buy', ticker: 'QQQ', currency: 'USD', quantity: 1, price: 500, amount: -500},
            {ledger_no: 2, broker: 'ibkr', date: '2026-07-22', type: 'buy', ticker: 'QQQ', currency: 'USD', quantity: 1, price: 505, amount: -505},
        ],
        priceHistoryByTicker: {
            QQQ: [
                {date: '2026-07-21', close: 500},
                {date: '2026-07-22', close: 505},
            ],
        },
    });
    await page.goto('/trade/investment?ticker=QQQ#stock_panel');

    await expect(page.locator('#investment_stock_details_table_host')).toBeVisible();
    await page.locator('[data-investment-stock-details-time-filter-trigger]').click();
    const dateInput = page.locator('#investment_stock_details_date_start');
    await expect(dateInput).toHaveCount(1);
    await dateInput.evaluate((input) => {
        input.value = '2026-07-22';
        input.dispatchEvent(new Event('change', {bubbles: true}));
    });
    await expect(page.locator('[data-investment-stock-detail-ledger="1"]')).toHaveCount(0);
    await expect(page.locator('[data-investment-stock-detail-ledger="2"]')).toHaveCount(1);

    const downloadPromise = page.waitForEvent('download');
    await page.locator('#export_transactions_button').click();
    const download = await downloadPromise;
    const downloadPath = await download.path();
    expect(downloadPath).not.toBeNull();
    const markdown = await readFile(downloadPath, 'utf8');

    expect(markdown).toContain('**Range:** 22 Jul 2026 - 22 Jul 2026');
    expect(markdown).toContain('Filters: Broker: All brokers; Type: All types; Currency: All currencies; Description: All descriptions; Transaction date: 22 Jul 2026');
    expect(markdown).toContain('| IBKR | 2 |');
    expect(markdown).not.toContain('| IBKR | 1 |');
});

