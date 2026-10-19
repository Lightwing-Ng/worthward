/* Code version: v1.1.7 */
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
test('keeps Investment Metrics disclosures current, readable, and viewport-safe', async ({page}) => {
    await mockInvestmentReadApis(page, {
        transactions: [
            {broker: 'longbridge_hk', date: '2026-07-08', type: 'forex_trade_component', ticker: 'USD.HKD', currency: 'USD', price: 7.8, amount: 10},
            {broker: 'longbridge_hk', date: '2026-07-09', type: 'forex_trade_component', ticker: 'USD.CNH', currency: 'USD', price: 7.2, amount: 10},
            {broker: 'ibkr', date: '2026-07-10', type: 'deposit', currency: 'USD', amount: 1_000},
            {broker: 'ibkr', date: '2026-07-11', type: 'buy', ticker: 'AAPL', currency: 'USD', quantity: 1, price: 100, amount: -100},
            {broker: 'ibkr', date: '2026-07-12', type: 'sell', ticker: 'AAPL', currency: 'USD', quantity: 1, price: 110, amount: 110},
            {broker: 'longbridge_hk', date: '2026-07-13', type: 'deposit', currency: 'HKD', amount: 78, description: 'Coupon Rebate', source: {transaction_type_raw: 'KOL'}},
            {broker: 'longbridge_hk', date: '2026-07-14', type: 'deposit', currency: 'USD', amount: 5, description: 'Coupon Rebate', source: {transaction_type_raw: 'KOL'}},
            {broker: 'longbridge_hk', date: '2026-07-15', type: 'deposit', currency: 'CNH', amount: 72, description: 'Cash Coupon', source: {transaction_type_raw: 'KOL'}},
            {broker: 'longbridge_hk', date: '2026-07-16', type: 'deposit', currency: 'USD', amount: 10, description: 'Cash Coupon', source: {transaction_type_raw: 'KOL'}},
        ],
        priceHistoryByTicker: {
            AAPL: [
                {date: '2026-07-11', close: 100},
                {date: '2026-07-12', close: 110},
            ],
        },
    });
    await page.setViewportSize({width: 856, height: 769});
    await page.goto('/trade/investment');
    await page.locator('label[for="investment_view_metrics"]').click();

    const metricsPanel = page.locator('#investment_metrics_panel:not([hidden])');
    await expect(metricsPanel).toBeVisible();
    await expect(metricsPanel.getByText('Total gain', {exact: true})).toHaveCount(0);
    await expect(metricsPanel.getByText(/offshore/i)).toHaveCount(0);

    const rewardsCard = metricsPanel.locator('.trade-metric-card').filter({
        has: page.getByText('Coupon rebates / Cash rewards', {exact: true}),
    });
    await expect(rewardsCard).toHaveCount(1);
    await expect(rewardsCard.locator('.trade-metric-value')).toHaveText('35.00');
    await expect(metricsPanel.getByText('Coupon rebates HKD', {exact: true})).toHaveCount(0);
    await expect(metricsPanel.getByText('Coupon rebates USD', {exact: true})).toHaveCount(0);
    await expect(metricsPanel.getByText('Cash rewards HKD', {exact: true})).toHaveCount(0);
    await expect(metricsPanel.getByText('Cash rewards USD', {exact: true})).toHaveCount(0);

    const rewardsTrigger = rewardsCard.locator('[data-investment-metric-breakdown-trigger]');
    const rewardsBreakdown = rewardsCard.locator('.investment-stock-details-metric-breakdown');
    await expect(rewardsBreakdown).toBeHidden();
    await rewardsCard.hover();
    await expect(rewardsTrigger).toHaveCSS('opacity', '1');
    await rewardsTrigger.click();
    await expect(rewardsTrigger).toHaveAttribute('aria-expanded', 'true');
    await expect(rewardsTrigger).toHaveAttribute('aria-label', 'Hide Coupon rebates / Cash rewards details');
    await expect(rewardsBreakdown).toBeVisible();
    await expect(rewardsBreakdown).toContainText('Coupon rebates · HKD');
    await expect(rewardsBreakdown).toContainText('HKD 78.00');
    await expect(rewardsBreakdown).toContainText('Coupon rebates · USD');
    await expect(rewardsBreakdown).toContainText('Cash rewards · CNH');
    await expect(rewardsBreakdown).toContainText('CNH 72.00');
    await expect(rewardsBreakdown).toContainText('Cash rewards · USD');

    const rewardsAlignment = await rewardsCard.evaluate((card) => {
        const readHorizontalBounds = (element) => {
            const rect = element?.getBoundingClientRect();
            return rect ? {left: rect.left, right: rect.right} : null;
        };
        return {
            card: readHorizontalBounds(card),
            summaryValue: readHorizontalBounds(card.querySelector('.investment-metric-value-row .trade-metric-value')),
            detailRows: Array.from(card.querySelectorAll('.investment-stock-details-metric-breakdown-row'))
                .map(readHorizontalBounds),
            detailValues: Array.from(card.querySelectorAll('.investment-stock-details-metric-breakdown-value'))
                .map(readHorizontalBounds),
        };
    });
    expect(rewardsAlignment.card).not.toBeNull();
    expect(rewardsAlignment.summaryValue).not.toBeNull();
    expect(Math.abs(rewardsAlignment.summaryValue.left - rewardsAlignment.card.left)).toBeLessThanOrEqual(1);
    expect(Math.abs(rewardsAlignment.summaryValue.right - rewardsAlignment.card.right)).toBeLessThanOrEqual(1);
    for (const detailRow of rewardsAlignment.detailRows) {
        expect(detailRow).not.toBeNull();
        expect(Math.abs(detailRow.left - rewardsAlignment.card.left)).toBeLessThanOrEqual(1);
        expect(Math.abs(detailRow.right - rewardsAlignment.card.right)).toBeLessThanOrEqual(1);
    }
    for (const detailValue of rewardsAlignment.detailValues) {
        expect(detailValue).not.toBeNull();
        expect(Math.abs(detailValue.right - rewardsAlignment.card.right)).toBeLessThanOrEqual(1);
    }

    const metricTrigger = metricsPanel.locator('[data-metric-key="cumulative-pnl"]');
    await expect(metricTrigger).toHaveCount(1);
    await metricTrigger.click();

    const tooltip = page.locator('#investment_metric_tooltip_cumulative-pnl');
    await expect(tooltip).toHaveClass(/is-visible/);
    await expect.poll(() => tooltip.evaluate((element) => getComputedStyle(element).opacity)).toBe('1');
    await expect(tooltip).toContainText('Calculation');
    await expect(tooltip).toContainText('Contributing ledger rows');
    await expect(tooltip).toContainText('Stock-grant P&L');

    const geometry = await metricTrigger.evaluate((trigger) => {
        const tooltipElement = document.getElementById('investment_metric_tooltip_cumulative-pnl');
        const tooltipRect = tooltipElement?.getBoundingClientRect();
        const copyRect = tooltipElement?.querySelector('.investment-metric-tooltip-copy')?.getBoundingClientRect();
        const rowNoRect = tooltipElement?.querySelector('.investment-metric-tooltip-row-no')?.getBoundingClientRect();
        const panel = document.getElementById('investment_metrics_panel');
        const styles = tooltipElement ? getComputedStyle(tooltipElement) : null;
        return {
            isBodyChild: tooltipElement?.parentElement === document.body,
            position: styles?.position || '',
            opacity: styles?.opacity || '',
            ariaDescribedBy: trigger.getAttribute('aria-describedby') || '',
            ariaHidden: tooltipElement?.getAttribute('aria-hidden') || '',
            tooltipWithinViewport: Boolean(
                tooltipRect
                && tooltipRect.left >= 0
                && tooltipRect.top >= 0
                && tooltipRect.right <= window.innerWidth
                && tooltipRect.bottom <= window.innerHeight,
            ),
            copyWithinTooltip: Boolean(copyRect && tooltipRect && copyRect.right <= tooltipRect.right + 1),
            rowNumberSingleLine: Boolean(rowNoRect && rowNoRect.height < 20),
            metricsOverflowY: panel ? getComputedStyle(panel).overflowY : '',
        };
    });

    expect(geometry).toMatchObject({
        isBodyChild: true,
        position: 'fixed',
        opacity: '1',
        ariaHidden: 'false',
        tooltipWithinViewport: true,
        copyWithinTooltip: true,
        rowNumberSingleLine: true,
        metricsOverflowY: 'auto',
    });
    expect(geometry.ariaDescribedBy).toBe('investment_metric_tooltip_cumulative-pnl');
});

test('expands broker-scoped Unrealized P&L into open-position contributions', async ({page}) => {
    await mockInvestmentReadApis(page, {
        brokers: ['hsbc'],
        transactions: [
            {
                broker: 'hsbc',
                account: 'HSBC-1',
                date: '2026-07-10',
                type: 'buy',
                ticker: 'DRAM',
                currency: 'USD',
                quantity: 2,
                price: 100,
                amount: -200,
            },
            {
                broker: 'hsbc',
                account: 'HSBC-1',
                date: '2026-07-11',
                type: 'buy',
                ticker: 'EUV',
                currency: 'USD',
                quantity: 1,
                price: 200,
                amount: -200,
            },
        ],
        priceHistoryByTicker: {
            DRAM: [
                {date: '2026-07-10', close: 100},
                {date: '2026-07-11', close: 110},
            ],
            EUV: [
                {date: '2026-07-11', close: 200},
                {date: '2026-07-12', close: 190},
            ],
        },
    });
    await page.goto('/trade/investment?view=metrics&metrics-broker=hsbc&broker=hsbc');

    const unrealizedCard = page.locator('#investment_metrics_panel [data-metric-key="unrealized-pnl"]');
    const trigger = unrealizedCard.locator('[data-investment-metric-breakdown-trigger]');
    const breakdown = unrealizedCard.locator('.investment-stock-details-metric-breakdown');

    await expect(unrealizedCard.locator('.trade-metric-value')).toContainText('+10.00');
    await expect(trigger).toHaveAttribute('aria-label', 'Show Unrealized P&L details');
    await expect(breakdown).toBeHidden();
    await unrealizedCard.hover();
    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(trigger).toHaveAttribute('aria-label', 'Hide Unrealized P&L details');
    await expect(breakdown).toBeVisible();
    await expect(breakdown.locator('.investment-stock-details-metric-breakdown-row')).toHaveCount(2);
    await expect(breakdown).toContainText('DRAM');
    await expect(breakdown).toContainText('+20.00');
    await expect(breakdown).toContainText('EUV');
    await expect(breakdown).toContainText('-10.00');
});

test('preserves HKD funding evidence when calculating USD funding Metrics', async ({page}) => {
    await mockInvestmentReadApis(page, {
        brokers: ['zircon_hk'],
        // Funding uses the deposit day's rate, before the later FX trade.
        fxRateHistoryByCurrency: {
            HKD: {dates: ['2026-07-01'], values: {'2026-07-01': 650 / 83.22}},
        },
        transactions: [
            {
                ledger_no: 1,
                broker: 'zircon_hk',
                account: 'HK-1',
                date: '2026-07-01',
                type: 'deposit',
                currency: 'HKD',
                amount: 25_000,
                description: 'Deposit',
            },
            {
                ledger_no: 2,
                broker: 'zircon_hk',
                account: 'HK-1',
                date: '2026-07-02',
                type: 'forex_trade_component',
                currency: 'HKD',
                amount: -650,
                description: 'FX from HKD to USD',
                source: {forex_pair_reference_id: 'zircon-fx-20260702-001'},
            },
            {
                ledger_no: 3,
                broker: 'zircon_hk',
                account: 'HK-1',
                date: '2026-07-02',
                type: 'forex_trade_component',
                currency: 'USD',
                amount: 83.22,
                description: 'FX from HKD to USD',
                source: {forex_pair_reference_id: 'zircon-fx-20260702-001'},
            },
        ],
    });
    await page.goto('/trade/investment');
    await page.locator('label[for="investment_view_metrics"]').click();

    const metricsPanel = page.locator('#investment_metrics_panel:not([hidden])');
    const metricCard = (label) => metricsPanel.locator('.trade-metric-card').filter({
        has: page.getByText(label, {exact: true}),
    });
    await expect(metricCard('Direct deposits')).toContainText('3,117.55');
    await expect(metricCard('Net USD converted')).toContainText('83.22');
    await expect(metricCard('Final investable USD')).toContainText('3,200.77');
    await expect(metricCard('Direct deposits')).not.toContainText('25,000.00');
});

test('splits realized P&L into spread, income, interest, and fee categories in USD', async ({page}) => {
    await mockInvestmentReadApis(page, {
        transactions: [
            {
                ledger_no: 1,
                broker: 'ibkr',
                account: 'U-1',
                date: '2026-07-10',
                type: 'buy',
                ticker: 'AAPL',
                currency: 'USD',
                quantity: 10,
                price: 10,
                amount: -100,
                commission: 1,
            },
            {
                ledger_no: 2,
                broker: 'ibkr',
                account: 'U-1',
                date: '2026-07-11',
                type: 'sell',
                ticker: 'AAPL',
                currency: 'USD',
                quantity: 10,
                price: 15,
                amount: 150,
                commission: 1,
            },
            {
                ledger_no: 3,
                broker: 'ibkr',
                account: 'U-1',
                date: '2026-07-12',
                type: 'dividend',
                ticker: 'AAPL',
                currency: 'USD',
                amount: 2,
            },
            {
                ledger_no: 4,
                broker: 'ibkr',
                account: 'U-1',
                date: '2026-07-12',
                type: 'foreign_tax_withholding',
                ticker: 'AAPL',
                currency: 'USD',
                amount: -0.3,
            },
            {
                ledger_no: 5,
                broker: 'ibkr',
                account: 'U-1',
                date: '2026-07-13',
                type: 'debit_interest',
                currency: 'USD',
                amount: -0.7,
                description: 'Margin interest',
            },
            {
                ledger_no: 6,
                broker: 'ibkr',
                account: 'U-1',
                date: '2026-07-14',
                type: 'fee',
                currency: 'USD',
                amount: -0.2,
                description: 'Account fee',
            },
        ],
        priceHistoryByTicker: {
            AAPL: [
                {date: '2026-07-10', close: 10},
                {date: '2026-07-11', close: 15},
            ],
        },
    });
    await page.goto('/trade/investment');
    await page.locator('label[for="investment_view_metrics"]').click();

    const metricsPanel = page.locator('#investment_metrics_panel:not([hidden])');
    const realizedCard = metricsPanel.locator('[data-metric-key="realized-pnl"]');
    const realizedBreakdown = realizedCard.locator('.investment-stock-details-metric-breakdown');
    await expect(realizedCard.locator('.trade-metric-value')).toContainText('+48.80');
    await realizedCard.hover();
    await realizedCard.locator('[data-investment-metric-breakdown-trigger]').click();
    await expect(realizedBreakdown).toBeVisible();
    await expect(realizedBreakdown).toContainText('Trading spread gains');
    await expect(realizedBreakdown).toContainText('+50.00');
    await expect(realizedBreakdown).toContainText('Dividends, net of withholding');
    await expect(realizedBreakdown).toContainText('+1.70');
    await expect(realizedBreakdown).toContainText('Interest charged');
    await expect(realizedBreakdown).toContainText('-0.70');
    await expect(realizedBreakdown).toContainText('Commissions / fees');
    await expect(realizedBreakdown).toContainText('-2.20');
    await expect(realizedBreakdown).not.toContainText('Broker-reported reconciliation');

    await page.locator('label[for="investment_view_holdings"]').click();
    const holdingsRealized = page.locator(
        '#investment_holdings_panel .investment-holdings-summary-row td',
    ).nth(6);
    await expect(holdingsRealized).toContainText('48.80');
});

test('shows Zircon (HK) cut losses from a lower sell price in Metrics', async ({page}) => {
    await mockInvestmentReadApis(page, {
        brokers: ['zircon_hk'],
        transactions: [
            {
                broker: 'zircon_hk',
                account: '47601705',
                date: '2026-07-10',
                type: 'buy',
                ticker: 'SPYM',
                currency: 'USD',
                quantity: 1,
                price: 71,
                amount: -71,
            },
            {
                broker: 'zircon_hk',
                account: '47601705',
                date: '2026-07-11',
                type: 'sell',
                ticker: 'SPYM',
                currency: 'USD',
                quantity: 1,
                price: 69.61,
                amount: 69.61,
            },
        ],
    });
    await page.goto('/trade/investment');
    await page.locator('label[for="investment_view_metrics"]').click();

    const brokerSelector = page.locator('#investment_metrics_panel_shell [data-investment-broker-filter-trigger]');
    await brokerSelector.click();
    await page.getByRole('option', {name: 'Zircon (HK)', exact: true}).click();

    const realizedCard = page.locator('#investment_metrics_panel [data-metric-key="realized-pnl"]');
    await realizedCard.hover();
    await realizedCard.locator('[data-investment-metric-breakdown-trigger]').click();
    const realizedBreakdown = realizedCard.locator('.investment-stock-details-metric-breakdown');
    await expect(realizedBreakdown).toContainText('Cut losses');
    await expect(realizedBreakdown).toContainText('-1.39');
});

test('synchronizes Investment Metrics and history by broker', async ({page}) => {
    const exportRequests = [];
    await page.route('**/api/investment/exports/standard.xlsx', async (route) => {
        exportRequests.push(route.request().postDataJSON());
        const response = await route.fetch();
        const body = await response.body();
        expect(response.status()).toBe(200);
        expect(response.headers()['content-type']).toContain(
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        );
        await route.fulfill({response, body});
    });
    await mockInvestmentReadApis(page, {
        brokers: ['ibkr', 'hsbc'],
        transactions: [
            {broker: 'ibkr', date: '2026-07-10', type: 'buy', ticker: 'AAPL', currency: 'USD', quantity: 1, price: 100, amount: -100},
            {broker: 'hsbc', date: '2026-07-11', type: 'buy', ticker: 'MSFT', currency: 'USD', quantity: 1, price: 200, amount: -200},
            {broker: 'hsbc', date: '2026-07-12', type: 'sell', ticker: 'MSFT', currency: 'USD', quantity: 1, price: 215, amount: 215},
            {broker: 'ibkr', date: '2026-07-13', type: 'sell', ticker: 'AAPL', currency: 'USD', quantity: 1, price: 110, amount: 110},
        ],
        priceHistoryByTicker: {
            AAPL: [
                {date: '2026-07-10', close: 100},
                {date: '2026-07-13', close: 110},
            ],
            MSFT: [
                {date: '2026-07-11', close: 200},
                {date: '2026-07-12', close: 215},
            ],
        },
    });
    await page.goto('/trade/investment');
    await page.locator('label[for="investment_view_metrics"]').click();

    const metricsShell = page.locator('#investment_metrics_panel_shell:not([hidden])');
    const metricsPanel = page.locator('#investment_metrics_panel');
    await expect(metricsShell).toBeVisible();
    await expect(metricsShell.locator('.investment-metrics-copy')).toHaveCount(0);
    const metricsBrokerField = metricsShell.locator('.investment-broker-summary-selector-shell');
    await expect(metricsBrokerField).toHaveClass(/live-trading-broker-strip/);
    await expect(metricsBrokerField).toHaveClass(/backtest-shared-select-field/);
    await expect(metricsBrokerField).toHaveClass(/investment-import-broker-field/);
    const brokerSelector = metricsShell.locator('[data-investment-broker-filter-trigger]');
    const brokerSelectorLogo = brokerSelector.locator('[data-investment-broker-filter-logo]');
    await expect(brokerSelector).toHaveAttribute('aria-label', 'Brokers selector: All');
    await expect(brokerSelectorLogo).toBeHidden();

    const cumulativeMetric = metricsPanel.locator('.trade-metric-card').filter({
        has: page.getByText('Cumulative P&L', {exact: true}),
    });
    await expect(cumulativeMetric).toContainText('25.00');
    await cumulativeMetric.locator('[data-metric-key="cumulative-pnl"]').click();
    await expect(page.locator('#investment_metric_tooltip_cumulative-pnl')).toHaveClass(/is-visible/);
    const historyRows = page.locator('#investment_history tr[data-investment-history-row]');
    const historyBrokerSelector = page.locator('#history_table_wrap [data-investment-broker-filter-trigger]');
    await expect(historyRows).toHaveCount(4);

    const exportVisibleStandardXlsx = async (expectedFilename) => {
        await page.locator('#investment_share_actions > .export-transactions-button').hover();
        const standardXlsxButton = page.locator('#export_standard_xlsx_button');
        await expect(standardXlsxButton).toHaveCSS('pointer-events', 'auto');
        const downloadPromise = page.waitForEvent('download');
        await standardXlsxButton.click();
        const download = await downloadPromise;
        expect(download.suggestedFilename()).toBe(expectedFilename);
        const downloadPath = await download.path();
        expect(downloadPath).not.toBeNull();
        const downloadedBytes = await readFile(downloadPath);
        expect(downloadedBytes.length).toBeGreaterThan(2);
        expect(downloadedBytes.subarray(0, 2).toString('ascii')).toBe('PK');
    };

    await exportVisibleStandardXlsx('Standard_investment_export.xlsx');
    assertCompleteStandardInvestmentExportPayload(exportRequests[0], ['ibkr', 'hsbc']);
    expect(exportRequests[0].transactions).toHaveLength(4);

    await brokerSelector.click();
    await expect(page.getByRole('option')).toHaveCount(3);
    await expect.poll(() => page.getByRole('option').evaluateAll((options) => options.filter((option) => (
        option.getAttribute('aria-selected') === 'true'
    )).length)).toBe(1);
    await page.getByRole('option', {name: 'HSBC', exact: true}).click();
    await expect(brokerSelector).toHaveAttribute('aria-label', 'Brokers selector: HSBC');
    await expect(brokerSelectorLogo).toHaveAttribute('src', '/market-store/logos/brokers/HSBC.png');
    await expect(brokerSelectorLogo).toBeVisible();
    await expect(page.locator('#investment_metric_tooltip_cumulative-pnl')).not.toHaveClass(/is-visible/);
    await expect(cumulativeMetric).toContainText('15.00');

    await expect(historyBrokerSelector).toHaveAttribute('aria-label', 'Broker filter: HSBC');
    await expect(historyRows).toHaveCount(2);
    await expect.poll(() => historyRows.evaluateAll((rows) => rows.map((row) => (
        row.querySelector('.investment-history-broker-cell')?.textContent?.trim() || ''
    )))).toEqual(['HSBC', 'HSBC']);
    await expect(page).toHaveURL(/view=metrics.*metrics-broker=hsbc.*broker=hsbc/);

    await exportVisibleStandardXlsx('MSFT_standard_investment_export.xlsx');
    assertCompleteStandardInvestmentExportPayload(exportRequests[1], ['hsbc']);
    expect(exportRequests[1].transactions).toHaveLength(2);

    await brokerSelector.click();
    await page.getByRole('option', {name: 'IBKR', exact: true}).click();
    await expect(brokerSelector).toHaveAttribute('aria-label', 'Brokers selector: IBKR');
    await expect(brokerSelectorLogo).toHaveAttribute('src', '/market-store/logos/brokers/IBKR.png');
    await expect(brokerSelectorLogo).toBeVisible();

    await expect(cumulativeMetric).toContainText('10.00');
    await expect(historyBrokerSelector).toHaveAttribute('aria-label', 'Broker filter: IBKR');
    await expect(historyRows).toHaveCount(2);
    await expect.poll(() => historyRows.evaluateAll((rows) => rows.map((row) => (
        row.querySelector('.investment-history-broker-cell')?.textContent?.trim() || ''
    )))).toEqual(['IBKR', 'IBKR']);
    await expect(page).toHaveURL(/view=metrics.*metrics-broker=ibkr.*broker=ibkr/);

    await exportVisibleStandardXlsx('AAPL_standard_investment_export.xlsx');
    assertCompleteStandardInvestmentExportPayload(exportRequests[2], ['ibkr']);
    expect(exportRequests[2].transactions).toHaveLength(2);

    await historyBrokerSelector.click();
    await expect.poll(() => page.getByRole('option').evaluateAll((options) => options.filter((option) => (
        option.getAttribute('aria-selected') === 'true'
    )).length)).toBe(1);
    await page.getByRole('option', {name: 'HSBC', exact: true}).click();
    await expect(brokerSelector).toHaveAttribute('aria-label', 'Brokers selector: HSBC');
    await expect(historyBrokerSelector).toHaveAttribute('aria-label', 'Broker filter: HSBC');
    await expect(historyRows).toHaveCount(2);
    await expect(cumulativeMetric).toContainText('15.00');
    await expect(page).toHaveURL(/view=metrics.*metrics-broker=hsbc.*broker=hsbc/);

    await historyBrokerSelector.click();
    await page.getByRole('option', {name: 'All', exact: true}).click();
    await expect(brokerSelector).toHaveAttribute('aria-label', 'Brokers selector: All');
    await expect(historyBrokerSelector).toHaveAttribute('aria-label', 'Broker filter: All brokers');
    await expect(historyRows).toHaveCount(4);
    await expect(brokerSelectorLogo).toBeHidden();
    await expect(brokerSelectorLogo).not.toHaveAttribute('src', /.+/);
    await expect(cumulativeMetric).toContainText('25.00');
    await expect(historyRows).toHaveCount(4);
    await expect(page).not.toHaveURL(/[?&](?:metrics-)?broker=/);

    await exportVisibleStandardXlsx('Standard_investment_export.xlsx');
    assertCompleteStandardInvestmentExportPayload(exportRequests[3], ['ibkr', 'hsbc']);
    expect(exportRequests[3].transactions).toHaveLength(4);
});

test('keeps the shared Metrics broker scope local and restores it on return', async ({page}) => {
    await mockInvestmentReadApis(page, {
        brokers: ['boc_hk', 'hsbc'],
        transactions: [
            {broker: 'boc_hk', date: '2026-07-10', type: 'buy', ticker: 'AAPL', currency: 'USD', quantity: 1, price: 100, amount: -100},
            {broker: 'hsbc', date: '2026-07-11', type: 'buy', ticker: 'AAPL', currency: 'USD', quantity: 1, price: 110, amount: -110},
            {broker: 'boc_hk', date: '2026-07-12', type: 'sell', ticker: 'AAPL', currency: 'USD', quantity: 1, price: 120, amount: 120},
            {broker: 'hsbc', date: '2026-07-13', type: 'sell', ticker: 'AAPL', currency: 'USD', quantity: 1, price: 130, amount: 130},
        ],
        priceHistoryByTicker: {
            AAPL: [
                {date: '2026-07-10', close: 100},
                {date: '2026-07-11', close: 110},
                {date: '2026-07-12', close: 120},
                {date: '2026-07-13', close: 130},
            ],
        },
    });

    await page.goto('/trade/investment?view=metrics&metrics-broker=boc_hk&broker=boc_hk');

    const topBroker = page.locator('#investment_metrics_panel_shell [data-investment-broker-filter-trigger]');
    const lowerBroker = page.locator('#history_table_wrap [data-investment-broker-filter-trigger]');
    const historyRows = page.locator('#investment_history tr[data-investment-history-row]');
    await expect(topBroker).toHaveAttribute('aria-label', 'Brokers selector: Bank of China (Hong Kong)');
    await expect(lowerBroker).toHaveAttribute('aria-label', 'Broker filter: Bank of China (Hong Kong)');
    await expect(historyRows).toHaveCount(2);

    await topBroker.click();
    await expect.poll(() => page.getByRole('option').evaluateAll((options) => options.filter((option) => (
        option.getAttribute('aria-selected') === 'true'
    )).length)).toBe(1);
    await page.getByRole('option', {name: 'Bank of China (Hong Kong)', exact: true}).click();
    await expect(topBroker).toHaveAttribute('aria-label', 'Brokers selector: Bank of China (Hong Kong)');

    await lowerBroker.click();
    await page.getByRole('option', {name: 'HSBC', exact: true}).click();
    await expect(lowerBroker).toHaveAttribute('aria-label', 'Broker filter: HSBC');
    await expect(topBroker).toHaveAttribute('aria-label', 'Brokers selector: HSBC');
    await expect(historyRows).toHaveCount(2);
    await expect(page).toHaveURL(/view=metrics.*metrics-broker=hsbc.*broker=hsbc/);

    await topBroker.click();
    await page.getByRole('option', {name: 'All', exact: true}).click();
    await expect(topBroker).toHaveAttribute('aria-label', 'Brokers selector: All');
    await expect(lowerBroker).toHaveAttribute('aria-label', 'Broker filter: All brokers');
    await expect(historyRows).toHaveCount(4);

    await topBroker.click();
    await page.getByRole('option', {name: 'Bank of China (Hong Kong)', exact: true}).click();
    await expect(topBroker).toHaveAttribute('aria-label', 'Brokers selector: Bank of China (Hong Kong)');
    await expect(lowerBroker).toHaveAttribute('aria-label', 'Broker filter: Bank of China (Hong Kong)');
    await expect(historyRows).toHaveCount(2);

    await page.locator('label[for="investment_view_chart"]').click();
    await expect(page).toHaveURL(/view=overview/);
    await expect(page).not.toHaveURL(/metrics-broker|broker=hsbc/);
    await expect(lowerBroker).toHaveAttribute('aria-label', 'Broker filter: All brokers');
    await expect(historyRows).toHaveCount(4);

    await page.reload();
    await expect(lowerBroker).toHaveAttribute('aria-label', 'Broker filter: All brokers');
    await expect(historyRows).toHaveCount(4);

    await page.locator('label[for="investment_view_holdings"]').click();
    await expect(lowerBroker).toHaveAttribute('aria-label', 'Broker filter: All brokers');
    await expect(historyRows).toHaveCount(4);

    await page.locator('label[for="investment_view_stock_details"]').click();
    await expect(page.locator('#investment_stock_details_table_host')).toBeVisible();
    await expect(lowerBroker).toHaveAttribute('aria-label', 'Broker filter: All brokers');
    await expect(page.locator('#investment_stock_details_table_host tr[data-investment-stock-detail-ledger]')).toHaveCount(4);

    await page.locator('label[for="investment_view_metrics"]').click();
    await expect(topBroker).toHaveAttribute('aria-label', 'Brokers selector: Bank of China (Hong Kong)');
    await expect(lowerBroker).toHaveAttribute('aria-label', 'Broker filter: Bank of China (Hong Kong)');
    await expect(historyRows).toHaveCount(2);

    await lowerBroker.click();
    await page.getByRole('option', {name: 'All', exact: true}).click();
    await expect(topBroker).toHaveAttribute('aria-label', 'Brokers selector: All');
    await expect(lowerBroker).toHaveAttribute('aria-label', 'Broker filter: All brokers');
    await expect(historyRows).toHaveCount(4);
});

test('keeps Overview and Stock details ranges isolated and remembered', async ({page}) => {
    await mockInvestmentReadApis(page, {
        brokers: ['boc_hk', 'hsbc'],
        transactions: [
            {broker: 'boc_hk', date: '2026-04-10', type: 'buy', ticker: 'AAPL', currency: 'USD', quantity: 1, price: 100, amount: -100},
            {broker: 'hsbc', date: '2026-07-10', type: 'buy', ticker: 'AAPL', currency: 'USD', quantity: 1, price: 110, amount: -110},
        ],
        priceHistoryByTicker: {
            AAPL: [
                {date: '2026-04-10', close: 100},
                {date: '2026-07-10', close: 110},
            ],
        },
    });

    await page.goto('/trade/investment?view=overview');
    await page.locator('label[for="investment_equity_range_3m"]').click();
    await expect(page.locator('#investment_equity_range_3m')).toBeChecked();
    await expect(page).toHaveURL(/view=overview.*range=3m/);

    await page.locator('label[for="investment_view_metrics"]').click();
    await expect(page).toHaveURL(/view=metrics/);
    await expect(page).not.toHaveURL(/range=/);

    await page.locator('label[for="investment_view_stock_details"]').click();
    await expect(page.locator('#investment_stock_details_range_max')).toBeChecked();
    await page.locator('label[for="investment_stock_details_range_1w"]').click();
    await expect(page.locator('#investment_stock_details_range_1w')).toBeChecked();
    await expect(page).toHaveURL(/view=stock-details.*range=1w/);

    await page.locator('label[for="investment_view_chart"]').click();
    await expect(page.locator('#investment_equity_range_3m')).toBeChecked();
    await expect(page).toHaveURL(/view=overview.*range=3m/);

    await page.locator('label[for="investment_view_stock_details"]').click();
    await expect(page.locator('#investment_stock_details_range_1w')).toBeChecked();
    await expect(page).toHaveURL(/view=stock-details.*range=1w/);

    await page.locator('label[for="investment_view_metrics"]').click();
    await expect(page).toHaveURL(/view=metrics/);
    await expect(page).not.toHaveURL(/range=/);
});

test('renders restored Hong Kong bank names and logos from a direct Metrics URL', async ({page}) => {
    await mockInvestmentReadApis(page, {
        brokers: ['cmb_hk', 'standard_chartered_hk', 'welab_bank'],
        transactions: [
            {
                ledger_no: 1,
                broker: 'cmb_hk',
                date: '2026-07-01',
                type: 'deposit',
                currency: 'HKD',
                amount: 100,
                description: 'CMB HK deposit',
            },
            {
                ledger_no: 2,
                broker: 'standard_chartered_hk',
                date: '2026-07-02',
                type: 'deposit',
                currency: 'HKD',
                amount: 200,
                description: 'Standard Chartered deposit',
            },
            {
                ledger_no: 3,
                broker: 'welab_bank',
                date: '2026-07-03',
                type: 'deposit',
                currency: 'HKD',
                amount: 300,
                description: 'WeLab deposit',
            },
        ],
    });

    await page.goto('/trade/investment?view=metrics&metrics-broker=standard_chartered_hk&broker=standard_chartered_hk');

    const metricsShell = page.locator('#investment_metrics_panel_shell:not([hidden])');
    const brokerSelector = metricsShell.locator('[data-investment-broker-filter-trigger]');
    const brokerSelectorLogo = brokerSelector.locator('[data-investment-broker-filter-logo]');
    const historyBrokerSelector = page.locator('#history_table_wrap [data-investment-broker-filter-trigger]');
    const historyRows = page.locator('#investment_history tr[data-investment-history-row]');
    await expect(brokerSelector).toHaveAttribute('aria-label', 'Brokers selector: Standard Chartered (HK)');
    await expect(historyBrokerSelector).toHaveAttribute('aria-label', 'Broker filter: Standard Chartered (HK)');
    await expect(brokerSelectorLogo).toHaveAttribute(
        'src',
        '/market-store/logos/brokers/Standard%20Chartered.svg',
    );
    await expect(brokerSelectorLogo).toBeVisible();
    await expect(historyRows).toHaveCount(1);
    await expect(historyRows.first().locator('.investment-history-broker-logo')).toHaveAttribute(
        'src',
        '/market-store/logos/brokers/Standard%20Chartered.svg',
    );

    await brokerSelector.click();
    await page.getByRole('option', {name: 'WeLab Bank', exact: true}).click();
    await expect(brokerSelector).toHaveAttribute('aria-label', 'Brokers selector: WeLab Bank');
    await expect(historyBrokerSelector).toHaveAttribute('aria-label', 'Broker filter: WeLab Bank');
    await expect(brokerSelectorLogo).toHaveAttribute(
        'src',
        '/market-store/logos/brokers/WeLab%20Bank.png',
    );
    await expect(brokerSelectorLogo).toBeVisible();
    await expect(historyRows).toHaveCount(1);
    await expect(historyRows.first().locator('.investment-history-broker-logo')).toHaveAttribute(
        'src',
        '/market-store/logos/brokers/WeLab%20Bank.png',
    );
    await expect(page).toHaveURL(/view=metrics.*metrics-broker=welab_bank.*broker=welab_bank/);

    await brokerSelector.click();
    await page.getByRole('option', {name: 'China Merchants Bank Hong Kong Branch', exact: true}).click();
    await expect(brokerSelector).toHaveAttribute(
        'aria-label',
        'Brokers selector: China Merchants Bank Hong Kong Branch',
    );
    await expect(historyBrokerSelector).toHaveAttribute(
        'aria-label',
        'Broker filter: China Merchants Bank Hong Kong Branch',
    );
    await expect(brokerSelectorLogo).toHaveAttribute(
        'src',
        '/market-store/logos/brokers/CMB%20Wing%20Lung.svg',
    );
    await expect(brokerSelectorLogo).toBeVisible();
    await expect(historyRows).toHaveCount(1);
    await expect(historyRows.first().locator('.investment-history-broker-logo')).toHaveAttribute(
        'src',
        '/market-store/logos/brokers/CMB%20Wing%20Lung.svg',
    );
    await expect(page).toHaveURL(/view=metrics.*metrics-broker=cmb_hk.*broker=cmb_hk/);
});

test('keeps Investment view, range, broker scope, and pagination in the canonical URL', async ({page}) => {
    const transactions = Array.from({length: 205}, (_, index) => ({
        ledger_no: index + 2,
        broker: 'hsbc',
        date: '2026-07-10',
        type: 'sell',
        ticker: 'AAPL',
        currency: 'USD',
        quantity: 1,
        price: 100,
        amount: 100,
    }));
    transactions.push({
        ledger_no: 2,
        broker: 'ibkr',
        date: '2026-07-10',
        type: 'sell',
        ticker: 'AAPL',
        currency: 'USD',
        quantity: 1,
        price: 99,
        amount: 99,
    });
    transactions.unshift(...['hsbc', 'ibkr'].map((broker) => ({
        ledger_no: 1,
        broker, date: '2026-07-09', type: 'buy', ticker: 'AAPL', currency: 'USD',
        quantity: 205, price: 90, amount: -18_450,
    })));
    await mockInvestmentReadApis(page, {
        brokers: ['hsbc', 'ibkr'],
        transactions,
        priceHistoryByTicker: {
            AAPL: [
                {date: '2026-07-10', close: 100},
                {date: '2026-07-11', close: 101},
            ],
        },
    });

    await page.goto('/trade/investment?view=overview&range=3m&broker=hsbc&type=sell&page=2');
    await expect(page).toHaveURL(/view=overview.*range=3m.*broker=hsbc.*type=sell.*page=2/);
    await expect(page.locator('#investment_history tr[data-investment-history-row]')).toHaveCount(100);

    await page.locator('label[for="investment_view_metrics"]').click();
    await expect(page).toHaveURL(/view=metrics.*type=sell/);
    await expect(page).not.toHaveURL(/[?&]broker=hsbc(?:&|$)/);
    const metricsBroker = page.locator('#investment_metrics_panel_shell [data-investment-broker-filter-trigger]');
    await metricsBroker.click();
    await page.getByRole('option', {name: 'HSBC', exact: true}).click();
    await expect(page).toHaveURL(/view=metrics.*metrics-broker=hsbc.*broker=hsbc.*type=sell/);

    await metricsBroker.click();
    await page.getByRole('option', {name: 'All', exact: true}).click();
    await expect(page).toHaveURL(/view=metrics.*type=sell/);
    await expect(page).not.toHaveURL(/[?&](?:metrics-)?broker=hsbc(?:&|$)/);

    await page.locator('label[for="investment_view_chart"]').click();
    await expect(page).toHaveURL(/view=overview.*range=3m.*broker=hsbc.*type=sell/);

    await page.goto('/trade/investment?view=stock-details&ticker=AAPL&range=3m&broker=hsbc&type=sell');
    await expect(page).toHaveURL(/view=stock-details.*ticker=AAPL.*range=3m.*broker=hsbc.*type=sell/);
    await expect(page.locator('#investment_stock_details_table_host')).toBeVisible();
    await expect(page.locator('.investment-stock-details-price-chart-canvas')).toBeVisible();
});

test('keeps China Merchants Bank KOL income in CNY while valuing it in USD', async ({page}) => {
    const cnyRewards = [
        ['2023-09-28', 3_845.10],
        ['2023-10-31', 3_354.48],
        ['2023-11-29', 1_868.80],
        ['2023-12-29', 2_922.24],
        ['2024-01-30', 1_816.80],
        ['2024-02-29', 1_924.23],
        ['2024-03-29', 5_780.25],
    ];
    await mockInvestmentReadApis(page, {
        brokers: ['cmb_cn'],
        transactions: [
            ...cnyRewards.map(([date, amount], index) => ({
                ledger_no: index + 1,
                broker: 'cmb_cn',
                date,
                type: 'kol_reward',
                currency: 'CNY',
                amount,
                description: 'Longbridge KOL Reward',
            })),
            {
                ledger_no: 8,
                broker: 'cmb_cn',
                date: '2024-04-01',
                type: 'virtual_balance_reset',
                currency: 'CNY',
                amount: -21_511.90,
                description: 'Manual virtual balance reset to CNY 0.00',
                source: {virtual_balance_reset_not_real_world_transaction: true},
            },
        ],
        fxRateHistoryByCurrency: {
            CNY: {
                dates: cnyRewards.map(([date]) => date),
                values: Object.fromEntries(cnyRewards.map(([date]) => [date, 7])),
            },
        },
    });
    await page.goto('/trade/investment');
    await page.locator('label[for="investment_view_metrics"]').click();

    const metricsShell = page.locator('#investment_metrics_panel_shell:not([hidden])');
    const brokerSelector = metricsShell.locator('[data-investment-broker-filter-trigger]');
    const brokerSelectorLogo = brokerSelector.locator('[data-investment-broker-filter-logo]');
    await brokerSelector.click();
    await page.getByRole('option', {name: 'China Merchants Bank', exact: true}).click();
    await expect(brokerSelector).toHaveAttribute('aria-label', 'Brokers selector: China Merchants Bank');
    await expect(brokerSelectorLogo).toHaveAttribute(
        'src',
        '/market-store/logos/brokers/CMB%20Wing%20Lung.svg',
    );

    const metricsPanel = page.locator('#investment_metrics_panel:not([hidden])');
    const kolCard = metricsPanel.locator('.trade-metric-card').filter({
        has: page.getByText('KOL rewards', {exact: true}),
    });
    await expect(kolCard.locator('.trade-metric-value')).toContainText('3,073.13');
    await expect(kolCard.locator('.trade-metric-value')).not.toContainText('21,511.90');

    const historyRows = page.locator('#investment_history tr[data-investment-history-row]');
    await expect(historyRows).toHaveCount(8);
    await expect.poll(() => historyRows.evaluateAll((rows) => rows.map((row) => (
        row.cells.item(5)?.textContent?.trim() || ''
    )))).toEqual(Array(8).fill('CNY'));
    await expect(historyRows.filter({hasText: 'KOL Rewards'})).toHaveCount(7);
    await expect(
        historyRows.filter({hasText: 'Manual virtual balance reset to CNY 0.00'}),
    ).toHaveCount(1);

    const currencyTrigger = page.locator(
        '#history_table_wrap [data-investment-currency-filter-trigger]',
    );
    await currencyTrigger.click();
    await expect(page.getByRole('option')).toHaveCount(2);
    await page.getByRole('option', {name: 'CNY', exact: true}).click();
    await expect(historyRows).toHaveCount(8);

    await page.locator('label[for="investment_view_holdings"]').click();
    const rewardRow = page.locator(
        '#investment_holdings_panel:not([hidden]) .investment-holdings-table-scroll tbody [data-investment-broker-rewards-row]',
    );
    await expect(rewardRow).toBeVisible();
    await expect(rewardRow.locator('td').nth(6)).toContainText('3,073.13');
    await expect(rewardRow).not.toContainText('21,511.90');
});

test('keeps Investment price and money groups equal with elastic identity columns on the shared table grid', async ({page}) => {
    await mockInvestmentReadApis(page, {
        startingCash: 10_058.00,
        transactions: [
            {
                ledger_no: 1,
                broker: 'ibkr',
                date: '2026-07-17',
                type: 'buy',
                ticker: 'SGOV',
                currency: 'USD',
                quantity: 100,
                price: 100.58,
                amount: -10_058.00,
            },
        ],
        priceHistoryByTicker: {
            SGOV: [
                {date: '2026-07-16', close: 100.56},
                {date: '2026-07-17', close: 100.58},
            ],
        },
        knownTickerCompanyNames: {SGOV: 'Treasury ETF'},
    });
    await page.goto('/trade/investment');
    await page.locator('label[for="investment_view_holdings"]').click();
    const holdingsAllocation = page.locator(
        '#investment_holdings_panel .investment-holdings-table-scroll > [data-table-body] tr[data-investment-holdings-ticker="SGOV"] [data-investment-live-field="position_weight"]',
    );

    const measurements = [];
    for (const {sidebarExpanded, ...viewport} of [
        {width: 390, height: 844, sidebarExpanded: false},
        {width: 869, height: 844, sidebarExpanded: false},
        {width: 869, height: 844, sidebarExpanded: true},
        {width: 1_024, height: 863, sidebarExpanded: false},
        {width: 1_024, height: 863, sidebarExpanded: true},
        {width: 1_440, height: 960, sidebarExpanded: false},
    ]) {
        await page.setViewportSize(viewport);
        await setSidebarExpanded(page, sidebarExpanded);
        const scenario = `${viewport.width}px with the sidebar ${sidebarExpanded ? 'expanded' : 'collapsed'}`;
        await expect(holdingsAllocation).toHaveText('100.00%');
        await page.evaluate(async () => {
            await document.fonts.ready;
            await Promise.all(document.querySelector('.app-shell').getAnimations({subtree: true})
                .filter((animation) => animation.playState === 'running'
                    && Number.isFinite(animation.effect?.getComputedTiming().endTime))
                .map((animation) => animation.finished.catch(() => {})));
            document.querySelectorAll(
                '#investment_holdings_panel .investment-holdings-table-scroll, #history_table_wrap .investment-history-table-scroll',
            ).forEach((scroll) => { scroll.scrollLeft = 0; });
            await new Promise((resolve) => {
                requestAnimationFrame(() => requestAnimationFrame(resolve));
            });
        });
        await expect.poll(() => page.evaluate(() => {
            const holdingsHeader = document.querySelector(
                '#investment_holdings_panel .investment-holdings-table[data-table-header] thead tr:first-child',
            );
            const historyHeader = document.querySelector(
                '#history_table_wrap .investment-history-table[data-table-header] thead tr',
            );
            const holdingsRow = document.querySelector(
                '#investment_holdings_panel .investment-holdings-table-scroll > [data-table-body] tr[data-investment-holdings-ticker="SGOV"]',
            );
            const historyRow = document.querySelector('#investment_history tr[data-investment-history-row]');
            if (!holdingsHeader || !historyHeader || !holdingsRow || !historyRow) return null;

            const readTerminalHeaderRect = (header, bodyRow) => {
                const shell = header.closest('.scrollable-data-table-shell');
                if (!shell) return null;
                const bodyRect = bodyRow.cells.item(bodyRow.cells.length - 1).getBoundingClientRect();
                const headerRect = header.cells.item(header.cells.length - 1).getBoundingClientRect();
                const trailingTrackWidth = Math.max(0, shell.getBoundingClientRect().right - bodyRect.right);
                return {left: headerRect.left, right: headerRect.right - trailingTrackWidth};
            };
            const holdingsAllocationHeaderRect = readTerminalHeaderRect(holdingsHeader, holdingsRow);
            const historyEquityHeaderRect = readTerminalHeaderRect(historyHeader, historyRow);
            if (!holdingsAllocationHeaderRect || !historyEquityHeaderRect) return null;
            const headerCenterDelta = Math.abs(
                (holdingsAllocationHeaderRect.left + holdingsAllocationHeaderRect.right)
                - (historyEquityHeaderRect.left + historyEquityHeaderRect.right),
            ) / 2;
            const leftDelta = Math.abs(holdingsAllocationHeaderRect.left - historyEquityHeaderRect.left);
            const rightDelta = Math.abs(holdingsAllocationHeaderRect.right - historyEquityHeaderRect.right);
            return Math.max(headerCenterDelta, leftDelta, rightDelta);
        }), {message: `Holdings Allocation/history Equity edges at ${scenario}`}).toBeLessThanOrEqual(1);
        const readAlignment = () => page.evaluate(() => {
            if (!window.WORTHWARD_INVESTMENT_DATA
                || document.querySelector('#workspace_modal_overlay')?.hidden !== true) return null;
            const holdingsHeader = document.querySelector(
                '#investment_holdings_panel .investment-holdings-table[data-table-header] thead tr:first-child',
            );
            const historyHeader = document.querySelector(
                '#history_table_wrap .investment-history-table[data-table-header] thead tr',
            );
            const holdingsRow = document.querySelector(
                '#investment_holdings_panel .investment-holdings-table-scroll > [data-table-body] tr[data-investment-holdings-ticker="SGOV"]',
            );
            const historyRow = document.querySelector('#investment_history tr[data-investment-history-row]');
            if (!holdingsHeader || !historyHeader || !holdingsRow || !historyRow) return null;
            const holdingsMarketValueCell = holdingsRow.cells.item(5);
            const historyAmountCell = historyRow.cells.item(6);
            const holdingsAllocationBodyRect = holdingsRow.cells.item(8).getBoundingClientRect();
            const historyEquityBodyRect = historyRow.cells.item(10).getBoundingClientRect();
            const holdingsSummaryRow = holdingsHeader.closest('table')?.tHead?.rows.item(1);
            const holdingsMarketValueStyle = getComputedStyle(holdingsMarketValueCell);
            const historyAmountStyle = getComputedStyle(historyAmountCell);
            const holdingsShell = holdingsHeader.closest('.investment-holdings-table-shell');
            const historyShell = historyHeader.closest('.investment-history-table-shell');
            if (!holdingsShell || !historyShell) return null;
            const holdingsTrailingTrackWidth = Math.max(
                0,
                holdingsShell.getBoundingClientRect().right - holdingsAllocationBodyRect.right,
            );
            const historyTrailingTrackWidth = Math.max(
                0,
                historyShell.getBoundingClientRect().right - historyEquityBodyRect.right,
            );
            const holdingsAllocationHeaderRect = holdingsHeader.cells.item(8).getBoundingClientRect();
            const historyEquityHeaderRect = historyHeader.cells.item(10).getBoundingClientRect();
            const holdingsAllocationHeaderRight = holdingsAllocationHeaderRect.right - holdingsTrailingTrackWidth;
            const historyEquityHeaderRight = historyEquityHeaderRect.right - historyTrailingTrackWidth;
            const holdingsScroll = holdingsShell?.querySelector('.investment-holdings-table-scroll');
            const historyScroll = historyShell.querySelector('.investment-history-table-scroll');
            const measuredHeaderHeight = Number.parseFloat(
                holdingsShell?.style.getPropertyValue('--scrollable-data-table-header-height'),
            );
            const renderedHeaderHeight = holdingsHeader.closest('table')?.getBoundingClientRect().height ?? 0;
            if (!Number.isFinite(measuredHeaderHeight) || measuredHeaderHeight <= 0
                || renderedHeaderHeight <= 0) return null;
            const holdingsBodyTable = holdingsScroll?.querySelector('.investment-holdings-table');
            const historyBodyTable = historyScroll?.querySelector('.investment-history-table');
            if (!holdingsScroll || !historyScroll || !holdingsBodyTable || !historyBodyTable) return null;
            const holdingsBodyRows = holdingsBodyTable?.tBodies.item(0)?.rows;
            const lastBodyRow = holdingsBodyRows?.item((holdingsBodyRows.length || 1) - 1);
            const getValueRightEdge = (cell) => {
                const value = cell.querySelector(
                    '.investment-holdings-pnl-stack, .investment-holdings-allocation-badge, [data-investment-live-field]',
                );
                return value?.getBoundingClientRect().right ?? 0;
            };
            const readBodyColumns = (row) => {
                const cells = Array.from(row.cells, (cell) => cell.getBoundingClientRect());
                const left = cells[0]?.left ?? 0;
                const width = (cells[cells.length - 1]?.right ?? left) - left;
                return {
                    width,
                    widths: cells.map((cell) => cell.width),
                    percentages: cells.map((cell) => cell.width / width * 100),
                    internalBoundaries: cells.slice(0, -1).map((cell) => cell.right),
                };
            };
            const holdingsColumns = readBodyColumns(holdingsRow);
            const historyColumns = readBodyColumns(historyRow);
            const readTextRects = (cell) => {
                const textRects = [];
                const textWalker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
                while (textWalker.nextNode()) {
                    if (!textWalker.currentNode.textContent.trim()
                        || textWalker.currentNode.parentElement?.closest('.sr-only')) continue;
                    const range = document.createRange();
                    range.selectNodeContents(textWalker.currentNode);
                    textRects.push(...Array.from(range.getClientRects(), (rect) => ({
                        left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
                    })));
                }
                return textRects;
            };
            const readColumnGeometry = (header, row, label, columnIndex, trailingTrackWidth = 0) => {
                const bodyCell = row.cells.item(columnIndex);
                const bodyRect = bodyCell.getBoundingClientRect();
                const headerCell = header.cells.item(columnIndex);
                const headerRect = headerCell.getBoundingClientRect();
                return {
                    label,
                    bodyWidth: bodyRect.width,
                    bodyCellBounds: {
                        left: bodyRect.left, right: bodyRect.right,
                        top: bodyRect.top, bottom: bodyRect.bottom,
                    },
                    bodyTextRects: readTextRects(bodyCell),
                    headerCellBounds: {
                        left: headerRect.left, right: headerRect.right - trailingTrackWidth,
                        top: headerRect.top, bottom: headerRect.bottom,
                    },
                    headerTextRects: readTextRects(headerCell),
                    headerWidth: headerRect.width - trailingTrackWidth,
                    headerBodyLeftDelta: Math.abs(headerRect.left - bodyRect.left),
                    headerBodyRightDelta: Math.abs(headerRect.right - trailingTrackWidth - bodyRect.right),
                };
            };
            const readAllColumns = (header, row, trailingTrackWidth) => Array.from(row.cells, (_cell, columnIndex) => (
                readColumnGeometry(
                    header,
                    row,
                    header.cells.item(columnIndex).textContent.trim(),
                    columnIndex,
                    columnIndex === row.cells.length - 1 ? trailingTrackWidth : 0,
                )
            ));
            const allColumns = {
                holdings: readAllColumns(holdingsHeader, holdingsRow, holdingsTrailingTrackWidth),
                history: readAllColumns(historyHeader, historyRow, historyTrailingTrackWidth),
            };
            const readScrollGeometry = (shell, scroll, bodyTable, header) => {
                const shellRect = shell.getBoundingClientRect();
                const scrollRect = scroll.getBoundingClientRect();
                const bodyRect = bodyTable.getBoundingClientRect();
                const headerRect = header.closest('table').getBoundingClientRect();
                const shellStyle = getComputedStyle(shell);
                return {
                    shellWidth: shellRect.width,
                    shellLeft: shellRect.left,
                    shellRight: shellRect.right,
                    gridContainerWidth: shell.clientWidth
                        - Number.parseFloat(shellStyle.paddingInlineStart)
                        - Number.parseFloat(shellStyle.paddingInlineEnd),
                    clientWidth: scroll.clientWidth,
                    scrollWidth: scroll.scrollWidth,
                    contentLeft: scrollRect.left + scroll.clientLeft,
                    contentRight: scrollRect.left + scroll.clientLeft + scroll.clientWidth,
                    bodyLeft: bodyRect.left,
                    bodyRight: bodyRect.right,
                    bodyWidth: bodyRect.width,
                    headerLeft: headerRect.left,
                    headerRight: headerRect.right,
                };
            };
            const summaryIdentityCell = holdingsSummaryRow?.cells.item(1);
            if (!summaryIdentityCell) return null;
            const summaryIdentityRect = summaryIdentityCell.getBoundingClientRect();
            const summaryMetricRows = Array.from(summaryIdentityCell.querySelectorAll('.investment-holdings-summary-metric-row'));
            const summaryMetricTextRects = summaryMetricRows.flatMap(readTextRects);
            const summaryNumericRightEdges = [
                'summary_cash_balance',
                'summary_cash_equivalents',
                'summary_total_equity',
                'summary_cumulative_pnl',
            ].map((field) => {
                const node = summaryIdentityCell.querySelector(`[data-investment-live-field="${field}"]`);
                const text = node ? readTextRects(node) : [];
                return {
                    field,
                    value: node?.getAttribute('data-investment-live-number'),
                    textCount: text.length,
                    right: Math.max(...text.map((rect) => rect.right)),
                };
            });
            const summaryMetricTextOverlaps = summaryMetricRows.flatMap((row) => {
                const children = Array.from(row.children, readTextRects);
                return children.flatMap((rects, index) => children.slice(index + 1).flatMap((otherRects) => (
                    rects.flatMap((rect) => otherRects.filter((other) => (
                        Math.min(rect.right, other.right) - Math.max(rect.left, other.left) > 1
                        && Math.min(rect.bottom, other.bottom) - Math.max(rect.top, other.top) > 1
                    )))
                )));
            }).length;
            const holdingsPriceColumns = [
                ['Average price', 2],
                ['Last price', 3],
            ].map(([label, columnIndex]) => readColumnGeometry(holdingsHeader, holdingsRow, label, columnIndex));
            const holdingsMoneyColumns = [
                ['Market value', 5],
                ['Realized P&L', 6],
                ['Unrealized P&L', 7],
            ].map(([label, columnIndex]) => readColumnGeometry(holdingsHeader, holdingsRow, label, columnIndex));
            const historyMoneyColumns = [
                ['Amount', 6],
                ['Market value', 8],
                ['Cash', 9],
                ['Equity', 10],
            ].map(([label, columnIndex]) => readColumnGeometry(
                historyHeader,
                historyRow,
                label,
                columnIndex,
                // The last header cell also covers the reserved scrollbar track.
                columnIndex === historyRow.cells.length - 1 ? historyTrailingTrackWidth : 0,
            ));
            const allocationCell = holdingsRow.cells.item(holdingsRow.cells.length - 1);
            const allocationCellRect = allocationCell.getBoundingClientRect();
            const allocationTextRects = readTextRects(allocationCell);
            return {
                headerMeasurement: {
                    measured: measuredHeaderHeight,
                    rendered: renderedHeaderHeight,
                    layout: holdingsHeader.closest('table').offsetHeight,
                },
                columns: {holdings: holdingsColumns, history: historyColumns},
                allColumns,
                scrollGeometry: {
                    holdings: readScrollGeometry(holdingsShell, holdingsScroll, holdingsBodyTable, holdingsHeader),
                    history: readScrollGeometry(historyShell, historyScroll, historyBodyTable, historyHeader),
                },
                holdingsPriceColumns,
                holdingsMoneyColumns,
                historyMoneyColumns,
                summaryNumericRightEdges,
                summaryIdentityTextGeometry: {
                    cell: {
                        left: summaryIdentityRect.left, right: summaryIdentityRect.right,
                        top: summaryIdentityRect.top, bottom: summaryIdentityRect.bottom,
                    },
                    text: summaryMetricTextRects,
                    overlapCount: summaryMetricTextOverlaps,
                },
                sharedGridBoundaryPairs: [
                    ['No.', 0, 0],
                    ['Holdings Market value/history Amount', 5, 6],
                    ['Holdings Unrealized P&L/history Cash', 7, 9],
                ].map(([label, holdingsIndex, historyIndex]) => ({
                    label,
                    bodyDelta: Math.abs(
                        allColumns.holdings[holdingsIndex].bodyCellBounds.right
                        - allColumns.history[historyIndex].bodyCellBounds.right,
                    ),
                    headerDelta: Math.abs(
                        allColumns.holdings[holdingsIndex].headerCellBounds.right
                        - allColumns.history[historyIndex].headerCellBounds.right,
                    ),
                })),
                allocationTextGeometry: {
                    cell: {
                        left: allocationCellRect.left, right: allocationCellRect.right,
                        top: allocationCellRect.top, bottom: allocationCellRect.bottom,
                    },
                    text: allocationTextRects,
                },
                sharedInternalBoundaryCount: holdingsColumns.internalBoundaries.filter((boundary) => (
                    historyColumns.internalBoundaries.some((candidate) => Math.abs(boundary - candidate) <= 1)
                )).length,
                holdingsAllocationToHistoryEquity: {
                    headerCenterDelta: Math.abs(
                        (holdingsAllocationHeaderRect.left + holdingsAllocationHeaderRight)
                        - (historyEquityHeaderRect.left + historyEquityHeaderRight),
                    ) / 2,
                    leftDelta: Math.abs(holdingsAllocationHeaderRect.left - historyEquityHeaderRect.left),
                    rightDelta: Math.abs(holdingsAllocationHeaderRight - historyEquityHeaderRight),
                    bodyLeftDelta: Math.abs(holdingsAllocationBodyRect.left - historyEquityBodyRect.left),
                    bodyRightDelta: Math.abs(holdingsAllocationBodyRect.right - historyEquityBodyRect.right),
                },
                moneyCellStyles: {
                    textAlignMatches: (
                        holdingsMarketValueStyle.textAlign === 'right'
                        && historyAmountStyle.textAlign === 'right'
                    ),
                    paddingMatches: (
                        holdingsMarketValueStyle.paddingInlineStart === historyAmountStyle.paddingInlineStart
                        && holdingsMarketValueStyle.paddingInlineEnd === historyAmountStyle.paddingInlineEnd
                    ),
                },
                summaryValueRightEdges: [5, 6, 7, 8].map((cellIndex) => ({
                    summary: getValueRightEdge(holdingsSummaryRow?.cells.item(cellIndex)),
                    body: getValueRightEdge(holdingsRow.cells.item(cellIndex)),
                })),
                fixedLayerGeometry: holdingsShell && holdingsScroll && lastBodyRow
                    ? (() => {
                        const shellRect = holdingsShell.getBoundingClientRect();
                        const headerRect = holdingsHeader.closest('table')?.getBoundingClientRect();
                        const scrollRect = holdingsScroll.getBoundingClientRect();
                        const cornerRadii = [
                            holdingsHeader.closest('table'),
                            holdingsHeader.cells.item(0),
                            holdingsHeader.cells.item(holdingsHeader.cells.length - 1),
                            holdingsScroll,
                            lastBodyRow.cells.item(0),
                            lastBodyRow.cells.item(lastBodyRow.cells.length - 1),
                        ].flatMap((node) => {
                            const style = getComputedStyle(node);
                            return [
                                style.borderTopLeftRadius,
                                style.borderTopRightRadius,
                                style.borderBottomRightRadius,
                                style.borderBottomLeftRadius,
                            ];
                        });
                        return {
                            shellRadii: [
                                getComputedStyle(holdingsShell).borderTopLeftRadius,
                                getComputedStyle(holdingsShell).borderTopRightRadius,
                                getComputedStyle(holdingsShell).borderBottomRightRadius,
                                getComputedStyle(holdingsShell).borderBottomLeftRadius,
                            ],
                            shellOverflow: getComputedStyle(holdingsShell).overflow,
                            scrollbarGutter: getComputedStyle(holdingsScroll).scrollbarGutter,
                            headerTop: headerRect?.top ?? 0,
                            headerBottom: headerRect?.bottom ?? 0,
                            scrollTop: scrollRect.top,
                            scrollBottom: scrollRect.bottom,
                            shellTop: shellRect.top,
                            shellBottom: shellRect.bottom,
                            cornerRadii,
                        };
                    })()
                    : null,
            };
        });
        let alignment = null;
        await expect.poll(async () => {
            alignment = await readAlignment();
            return alignment !== null;
        }, {message: `Loaded and measured Holdings table at ${scenario}`}).toBe(true);
        expect(Math.abs(alignment.headerMeasurement.measured - alignment.headerMeasurement.rendered),
            `measured header height ${JSON.stringify(alignment.headerMeasurement)} at ${scenario}`).toBeLessThanOrEqual(1);
        measurements.push({viewportWidth: viewport.width, sidebarExpanded, alignment});
        const sharedAllocationEquityGrid = alignment.holdingsAllocationToHistoryEquity;
        expect(sharedAllocationEquityGrid.leftDelta).toBeLessThanOrEqual(1);
        expect(sharedAllocationEquityGrid.rightDelta).toBeLessThanOrEqual(1);
        expect(sharedAllocationEquityGrid.headerCenterDelta).toBeLessThanOrEqual(1);
        expect(sharedAllocationEquityGrid.bodyLeftDelta).toBeLessThanOrEqual(1);
        expect(sharedAllocationEquityGrid.bodyRightDelta).toBeLessThanOrEqual(1);
        expect(alignment.moneyCellStyles.textAlignMatches).toBe(true);
        expect(alignment.moneyCellStyles.paddingMatches).toBe(true);
        for (const [group, columns, expectedCount] of [
            ['Holdings prices', alignment.holdingsPriceColumns, 2],
            ['Holdings money', alignment.holdingsMoneyColumns, 3],
        ]) {
            expect(columns).toHaveLength(expectedCount);
            const bodyWidths = columns.map((column) => column.bodyWidth);
            const headerWidths = columns.map((column) => column.headerWidth);
            expect(Math.max(...bodyWidths) - Math.min(...bodyWidths),
                `equal ${group} body widths at ${viewport.width}px`).toBeLessThanOrEqual(1);
            expect(Math.max(...headerWidths) - Math.min(...headerWidths),
                `equal ${group} header widths at ${viewport.width}px`).toBeLessThanOrEqual(1);
            columns.forEach((column) => {
                expect(column.bodyWidth, `${group} ${column.label} has a positive rendered width`)
                    .toBeGreaterThan(0);
                expect(column.headerBodyLeftDelta,
                    `${group} ${column.label} header/body left edge at ${viewport.width}px`)
                    .toBeLessThanOrEqual(1);
                expect(column.headerBodyRightDelta,
                    `${group} ${column.label} header/body right edge at ${viewport.width}px`)
                    .toBeLessThanOrEqual(1);
                for (const [layer, textRects, cellBounds] of [
                    ['header', column.headerTextRects, column.headerCellBounds],
                    ['body', column.bodyTextRects, column.bodyCellBounds],
                ]) {
                    expect(textRects.length, `${group} ${column.label} ${layer} renders text at ${viewport.width}px`)
                        .toBeGreaterThan(0);
                    textRects.forEach((rect) => {
                        expect(rect.left, `${group} ${column.label} ${layer} left ink edge at ${viewport.width}px`)
                            .toBeGreaterThanOrEqual(cellBounds.left - 1);
                        expect(rect.right, `${group} ${column.label} ${layer} right ink edge at ${viewport.width}px`)
                            .toBeLessThanOrEqual(cellBounds.right + 1);
                        expect(rect.top, `${group} ${column.label} ${layer} top ink edge at ${viewport.width}px`)
                            .toBeGreaterThanOrEqual(cellBounds.top - 1);
                        expect(rect.bottom, `${group} ${column.label} ${layer} bottom ink edge at ${viewport.width}px`)
                            .toBeLessThanOrEqual(cellBounds.bottom + 1);
                    });
                }
            });
        }
        expect(Math.min(...alignment.holdingsMoneyColumns.map((column) => column.bodyWidth)),
            `Holdings money columns remain wider than price columns at ${viewport.width}px`)
            .toBeGreaterThan(Math.max(...alignment.holdingsPriceColumns.map((column) => column.bodyWidth)) + 1);
        expect(alignment.historyMoneyColumns).toHaveLength(4);
        const historyMoneyBodyWidths = alignment.historyMoneyColumns.map((column) => column.bodyWidth);
        const historyMoneyHeaderWidths = alignment.historyMoneyColumns.map((column) => column.headerWidth);
        expect(Math.max(...historyMoneyBodyWidths) - Math.min(...historyMoneyBodyWidths),
            `equal history money body widths at ${viewport.width}px`).toBeLessThanOrEqual(1);
        expect(Math.max(...historyMoneyHeaderWidths) - Math.min(...historyMoneyHeaderWidths),
            `equal history money header widths excluding the trailing track at ${viewport.width}px`)
            .toBeLessThanOrEqual(1);
        alignment.historyMoneyColumns.forEach((column) => {
            expect(column.bodyWidth, `${column.label} has a positive rendered width`).toBeGreaterThan(0);
            expect(column.bodyTextRects.length, `${column.label} renders text at ${viewport.width}px`)
                .toBeGreaterThan(0);
            column.bodyTextRects.forEach((rect) => {
                expect(rect.left, `${column.label} left ink edge at ${viewport.width}px`)
                    .toBeGreaterThanOrEqual(column.bodyCellBounds.left - 1);
                expect(rect.right, `${column.label} right ink edge at ${viewport.width}px`)
                    .toBeLessThanOrEqual(column.bodyCellBounds.right + 1);
                expect(rect.top, `${column.label} top ink edge at ${viewport.width}px`)
                    .toBeGreaterThanOrEqual(column.bodyCellBounds.top - 1);
                expect(rect.bottom, `${column.label} bottom ink edge at ${viewport.width}px`)
                    .toBeLessThanOrEqual(column.bodyCellBounds.bottom + 1);
            });
            expect(column.headerBodyLeftDelta, `${column.label} header/body left edge at ${viewport.width}px`)
                .toBeLessThanOrEqual(1);
            expect(column.headerBodyRightDelta, `${column.label} header/body right edge at ${viewport.width}px`)
                .toBeLessThanOrEqual(1);
        });
        const gridUnit = alignment.holdingsPriceColumns[0].bodyWidth / 4;
        expect(gridUnit, `shared grid unit floor at ${scenario}`).toBeGreaterThanOrEqual(16 - 0.25);
        expect(gridUnit, `shared grid unit cap at ${scenario}`).toBeLessThanOrEqual(20 + 0.25);
        for (const [table, units, elasticIndex] of [
            ['holdings', [2, null, 4, 4, 4, 5, 5, 5, 4], 1],
            ['history', [2, 2, 5, 3, null, 2, 4, 2, 4, 4, 4], 4],
        ]) {
            const columns = alignment.columns[table];
            const geometry = alignment.scrollGeometry[table];
            expect(columns.widths).toHaveLength(units.length);
            expect(Math.abs(gridUnit - Math.min(20, Math.max(16, geometry.gridContainerWidth * 0.02))),
                `${table} grid unit follows its shell content width at ${scenario}`).toBeLessThanOrEqual(0.25);
            columns.widths.forEach((width, index) => {
                expect(width, `${table} column ${index + 1} has a positive width at ${scenario}`)
                    .toBeGreaterThan(0);
                if (units[index] === null) return;
                expect(Math.abs(width - units[index] * gridUnit),
                    `${table} column ${index + 1} follows the shared grid unit at ${scenario}`)
                    .toBeLessThanOrEqual(1);
            });
            const reservedWidth = units.reduce((total, unitCount) => total + (unitCount || 0) * gridUnit, 0);
            expect(Math.abs(columns.widths[elasticIndex] - (geometry.bodyWidth - reservedWidth)),
                `${table} identity column receives the remaining width at ${scenario}`).toBeLessThanOrEqual(1);
            expect(Math.abs(columns.widths.reduce((total, width) => total + width, 0) - geometry.bodyWidth),
                `${table} columns fill the body table at ${scenario}`).toBeLessThanOrEqual(1);
            expect(geometry.bodyWidth, `${table} readable minimum width at ${scenario}`)
                .toBeGreaterThanOrEqual(656 - 1);
            if (viewport.width >= 869) {
                expect(geometry.scrollWidth, `${table} has no horizontal scrolling at ${scenario}`)
                    .toBeLessThanOrEqual(geometry.clientWidth);
                expect(geometry.bodyLeft, `${table} body starts inside the scrollport at ${scenario}`)
                    .toBeGreaterThanOrEqual(geometry.contentLeft - 1);
                expect(geometry.bodyRight, `${table} body ends inside the scrollport at ${scenario}`)
                    .toBeLessThanOrEqual(geometry.contentRight + 1);
                expect(geometry.headerLeft, `${table} fixed header starts inside the shell at ${scenario}`)
                    .toBeGreaterThanOrEqual(geometry.shellLeft - 1);
                expect(geometry.headerRight, `${table} fixed header ends inside the shell at ${scenario}`)
                    .toBeLessThanOrEqual(geometry.shellRight + 1);
            }
            alignment.allColumns[table].forEach((column, index) => {
                expect(column.headerBodyLeftDelta, `${table} column ${index + 1} header/body left edge at ${scenario}`)
                    .toBeLessThanOrEqual(1);
                expect(column.headerBodyRightDelta, `${table} column ${index + 1} header/body right edge at ${scenario}`)
                    .toBeLessThanOrEqual(1);
                for (const [layer, textRects, bounds] of [
                    ['header', column.headerTextRects, column.headerCellBounds],
                    ['body', column.bodyTextRects, column.bodyCellBounds],
                ]) {
                    textRects.forEach((rect) => {
                        expect(rect.left, `${table} ${column.label} ${layer} left ink edge at ${scenario}`)
                            .toBeGreaterThanOrEqual(bounds.left - 1);
                        expect(rect.right, `${table} ${column.label} ${layer} right ink edge at ${scenario}`)
                            .toBeLessThanOrEqual(bounds.right + 1);
                        expect(rect.top, `${table} ${column.label} ${layer} top ink edge at ${scenario}`)
                            .toBeGreaterThanOrEqual(bounds.top - 1);
                        expect(rect.bottom, `${table} ${column.label} ${layer} bottom ink edge at ${scenario}`)
                            .toBeLessThanOrEqual(bounds.bottom + 1);
                    });
                }
            });
        }
        alignment.sharedGridBoundaryPairs.forEach(({label, bodyDelta, headerDelta}) => {
            expect(bodyDelta, `${label} shared body boundary at ${scenario}`).toBeLessThanOrEqual(1);
            expect(headerDelta, `${label} shared header boundary at ${scenario}`).toBeLessThanOrEqual(1);
        });
        expect(alignment.sharedInternalBoundaryCount, `shared internal column boundaries at ${viewport.width}px`)
            .toBeGreaterThanOrEqual(3);
        const summaryNumbers = alignment.summaryNumericRightEdges;
        expect(summaryNumbers).toHaveLength(4);
        const totalEquityRight = summaryNumbers.find(({field}) => field === 'summary_total_equity').right;
        summaryNumbers.forEach(({field, value, textCount, right}) => {
            expect(value, `${field} has a numeric value at ${scenario}`).not.toBeNull();
            expect(Number.isFinite(Number(value)), `${field} is finite at ${scenario}`).toBe(true);
            expect(textCount, `${field} renders numeric text at ${scenario}`).toBeGreaterThan(0);
            expect(Math.abs(right - totalEquityRight), `${field} aligns with the summary amount column at ${scenario}`)
                .toBeLessThanOrEqual(1);
        });
        const summaryGeometry = alignment.summaryIdentityTextGeometry;
        expect(summaryGeometry.text.length, `summary identity metrics render text at ${scenario}`).toBeGreaterThan(0);
        expect(summaryGeometry.overlapCount, `summary labels and values do not overlap at ${scenario}`).toBe(0);
        summaryGeometry.text.forEach((rect) => {
            expect(rect.left, `summary identity left ink edge at ${scenario}`)
                .toBeGreaterThanOrEqual(summaryGeometry.cell.left - 1);
            expect(rect.right, `summary identity right ink edge at ${scenario}`)
                .toBeLessThanOrEqual(summaryGeometry.cell.right + 1);
            expect(rect.top, `summary identity top ink edge at ${scenario}`)
                .toBeGreaterThanOrEqual(summaryGeometry.cell.top - 1);
            expect(rect.bottom, `summary identity bottom ink edge at ${scenario}`)
                .toBeLessThanOrEqual(summaryGeometry.cell.bottom + 1);
        });
        const allocationGeometry = alignment.allocationTextGeometry;
        expect(allocationGeometry.text.length, `100.00% renders text at ${viewport.width}px`).toBeGreaterThan(0);
        allocationGeometry.text.forEach((rect) => {
            expect(rect.left, `100.00% left ink edge at ${viewport.width}px`)
                .toBeGreaterThanOrEqual(allocationGeometry.cell.left - 1);
            expect(rect.right, `100.00% right ink edge at ${viewport.width}px`)
                .toBeLessThanOrEqual(allocationGeometry.cell.right + 1);
            expect(rect.top, `100.00% top ink edge at ${viewport.width}px`)
                .toBeGreaterThanOrEqual(allocationGeometry.cell.top - 1);
            expect(rect.bottom, `100.00% bottom ink edge at ${viewport.width}px`)
                .toBeLessThanOrEqual(allocationGeometry.cell.bottom + 1);
        });
        alignment.summaryValueRightEdges.forEach(({summary, body}, index) => {
            expect(Math.abs(summary - body), `Holdings column ${index + 6} right edge`).toBeLessThanOrEqual(1);
        });
        expect(alignment.fixedLayerGeometry).not.toBeNull();
        expect(alignment.fixedLayerGeometry.shellRadii).toEqual(['10px', '10px', '10px', '10px']);
        expect(alignment.fixedLayerGeometry.shellOverflow).toBe('hidden');
        expect(alignment.fixedLayerGeometry.scrollbarGutter).toBe('stable');
        expect(alignment.fixedLayerGeometry.headerTop).toBeGreaterThanOrEqual(
            alignment.fixedLayerGeometry.shellTop - 1,
        );
        expect(alignment.fixedLayerGeometry.scrollTop).toBeGreaterThanOrEqual(
            alignment.fixedLayerGeometry.headerBottom - 1,
        );
        expect(alignment.fixedLayerGeometry.scrollBottom).toBeLessThanOrEqual(
            alignment.fixedLayerGeometry.shellBottom + 1,
        );
        alignment.fixedLayerGeometry.cornerRadii.forEach((radius) => {
            expect(radius).toBe('0px');
        });
        if (viewport.width === 869 && !sidebarExpanded) {
            const screenshotPath = test.info().outputPath('elastic-columns-869.png');
            await page.screenshot({path: screenshotPath, fullPage: true, animations: 'disabled'});
            await test.info().attach('Elastic Investment columns at 869px', {
                path: screenshotPath,
                contentType: 'image/png',
            });
        }
        if (viewport.width === 390) {
            for (const selector of [
                '#investment_holdings_panel .investment-holdings-table-scroll',
                '#history_table_wrap .investment-history-table-scroll',
            ]) {
                const scroll = page.locator(selector);
                await scroll.evaluate((element) => { element.scrollLeft = element.scrollWidth; });
                await expect.poll(() => scroll.evaluate((element) => {
                    const row = element.querySelector(
                        ':scope > [data-table-body] tbody tr[data-investment-holdings-ticker], :scope > [data-table-body] tbody tr[data-investment-history-row]',
                    );
                    const shell = element.closest('.scrollable-data-table-shell');
                    const header = shell?.querySelector(':scope > [data-table-header] thead tr:first-child');
                    if (!row || !shell || !header) return false;
                    const cell = row.cells.item(row.cells.length - 1);
                    const bodyRect = cell.getBoundingClientRect();
                    const headerRect = header.cells.item(header.cells.length - 1).getBoundingClientRect();
                    const scrollRect = element.getBoundingClientRect();
                    const contentLeft = scrollRect.left + element.clientLeft;
                    // Overlay scrollbars leave the reserved trailing gutter visible at the endpoint.
                    const contentRight = scrollRect.right - (Number.parseFloat(getComputedStyle(element).borderRightWidth) || 0);
                    const trailingTrackWidth = Math.max(0, shell.getBoundingClientRect().right - bodyRect.right);
                    const textWalker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
                    const textRects = [];
                    while (textWalker.nextNode()) {
                        if (!textWalker.currentNode.textContent.trim()) continue;
                        const range = document.createRange();
                        range.selectNodeContents(textWalker.currentNode);
                        textRects.push(...range.getClientRects());
                    }
                    return {
                        overflows: element.scrollWidth > element.clientWidth,
                        scrolled: element.scrollLeft > 0,
                        bodyWithin: bodyRect.left >= contentLeft - 1 && bodyRect.right <= contentRight + 1,
                        headerAligned: Math.abs(headerRect.left - bodyRect.left) <= 1
                            && Math.abs(headerRect.right - trailingTrackWidth - bodyRect.right) <= 1,
                        textWithin: textRects.length > 0
                            && textRects.every((rect) => rect.left >= contentLeft - 1 && rect.right <= contentRight + 1),
                    };
                }), {message: `${selector} terminal values and fixed header remain reachable at ${scenario}`}).toEqual({
                    overflows: true, scrolled: true, bodyWithin: true, headerAligned: true, textWithin: true,
                });
                await scroll.evaluate((element) => { element.scrollLeft = 0; });
            }
        }
    }
    const collapsed869 = measurements.find(({viewportWidth, sidebarExpanded}) => viewportWidth === 869 && !sidebarExpanded);
    const expanded869 = measurements.find(({viewportWidth, sidebarExpanded}) => viewportWidth === 869 && sidebarExpanded);
    const collapsed1440 = measurements.find(({viewportWidth, sidebarExpanded}) => viewportWidth === 1_440 && !sidebarExpanded);
    for (const [table, elasticIndex] of [['holdings', 1], ['history', 4]]) {
        expect(Math.abs(
            collapsed869.alignment.scrollGeometry[table].shellWidth
            - expanded869.alignment.scrollGeometry[table].shellWidth,
        ), `${table} sidebar overlay preserves the available width at 869px`).toBeLessThanOrEqual(1);
        const narrowColumns = collapsed869.alignment.columns[table];
        const wideColumns = collapsed1440.alignment.columns[table];
        expect(wideColumns.widths[elasticIndex], `${table} identity column expands with the wider workspace`)
            .toBeGreaterThan(narrowColumns.widths[elasticIndex] + 1);
        expect(wideColumns.percentages[elasticIndex], `${table} identity column is not a fixed percentage`)
            .toBeGreaterThan(narrowColumns.percentages[elasticIndex] + 1);
        const reservedWidth = (columns) => columns.widths.reduce((total, width, index) => (
            total + (index === elasticIndex ? 0 : width)
        ), 0);
        const remainingWidthGrowth = wideColumns.width - narrowColumns.width
            - (reservedWidth(wideColumns) - reservedWidth(narrowColumns));
        expect(Math.abs(
            (wideColumns.widths[elasticIndex] - narrowColumns.widths[elasticIndex]) - remainingWidthGrowth,
        ), `${table} identity column absorbs the width left after the shared grid columns`).toBeLessThanOrEqual(1);
    }
});


test('aligns Investment share actions to the global anchor without collisions', async ({page}) => {
    await mockInvestmentReadApis(page, {
        transactions: [
            {broker: 'ibkr', date: '2026-07-10', type: 'deposit', currency: 'USD', amount: 1_000},
            {broker: 'ibkr', date: '2026-07-11', type: 'buy', ticker: 'AAPL', currency: 'USD', quantity: 1, price: 100, amount: -100},
        ],
        priceHistoryByTicker: {AAPL: [{date: '2026-07-11', close: 100}, {date: '2026-07-12', close: 110}]},
    });
    for (const [width, height] of [[1280, 800], [855, 1227], [600, 900], [390, 844]]) {
        await page.setViewportSize({width, height});
        await page.goto('/trade/investment?view=holdings');
        await expect(page.locator('#investment_share_actions')).toBeVisible();
        await expect.poll(async () => page.evaluate(() => {
            const rect = (selector) => document.querySelector(selector).getBoundingClientRect();
            const share = rect('#export_transactions_button');
            const theme = rect('[data-layout-role="global-theme-anchor"]');
            const control = rect('#investment_view_segmented');
            const body = rect('#investment_view_surface_body');
            const intersects = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
            const center = (r) => [r.left + (r.width / 2), r.top + (r.height / 2)];
            return {
                horizontalCenterline: Math.abs(center(share)[0] - center(theme)[0]) <= 1,
                verticalCenterline: Math.abs(center(share)[1] - center(control)[1]) <= 1,
                clearOfControl: !intersects(share, control),
                clearOfBody: !intersects(share, body),
            };
        }), {message: `share action geometry at ${width}px`}).toEqual({
            horizontalCenterline: true,
            verticalCenterline: true,
            clearOfControl: true,
            clearOfBody: true,
        });
    }
});
