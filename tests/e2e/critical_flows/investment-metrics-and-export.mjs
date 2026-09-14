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

test('aligns Holdings Market value and clips fixed table layers at every supported width', async ({page}) => {
    await mockInvestmentReadApis(page, {
        transactions: [
            {
                ledger_no: 1,
                broker: 'ibkr',
                date: '2026-07-17',
                type: 'buy',
                ticker: 'SGOV',
                currency: 'USD',
                quantity: 10,
                price: 100.58,
                amount: -1_005.80,
            },
        ],
        priceHistoryByTicker: {
            SGOV: [
                {date: '2026-07-16', close: 100.56},
                {date: '2026-07-17', close: 100.58},
            ],
        },
    });
    await page.goto('/trade/investment');
    await page.locator('label[for="investment_view_holdings"]').click();

    for (const viewport of [
        {width: 856, height: 769},
        {width: 1_024, height: 863},
        {width: 1_440, height: 960},
    ]) {
        await page.setViewportSize(viewport);
        await page.evaluate(() => new Promise((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(resolve));
        }));
        await expect.poll(() => page.evaluate(() => {
            const holdingsHeader = document.querySelector(
                '#investment_holdings_panel .investment-holdings-table[data-table-header] thead tr:first-child',
            );
            const historyHeader = document.querySelector(
                '#history_table_wrap .investment-history-table[data-table-header] thead tr',
            );
            const holdingsRow = document.querySelector(
                '#investment_holdings_panel tr[data-investment-holdings-ticker="SGOV"]',
            );
            const historyRow = document.querySelector('#investment_history tr[data-investment-history-row]');
            if (!holdingsHeader || !historyHeader || !holdingsRow || !historyRow) return null;

            const holdingsHeaderCell = holdingsHeader.cells.item(5);
            const historyHeaderCell = historyHeader.cells.item(8);
            if (!holdingsHeaderCell || !historyHeaderCell) return null;

            const holdingsHeaderRect = holdingsHeaderCell.getBoundingClientRect();
            const historyHeaderRect = historyHeaderCell.getBoundingClientRect();
            const headerCenterDelta = Math.abs(
                (holdingsHeaderRect.left + holdingsHeaderRect.right)
                - (historyHeaderRect.left + historyHeaderRect.right),
            ) / 2;
            const leftDelta = Math.abs(holdingsHeaderRect.left - historyHeaderRect.left);
            const rightDelta = Math.abs(holdingsHeaderRect.right - historyHeaderRect.right);
            return Math.max(headerCenterDelta, leftDelta, rightDelta);
        }), {message: `Holdings/history Market value edges at ${viewport.width}px`}).toBeLessThanOrEqual(1);
        const alignment = await page.evaluate(() => {
            const holdingsHeader = document.querySelector(
                '#investment_holdings_panel .investment-holdings-table[data-table-header] thead tr:first-child',
            );
            const historyHeader = document.querySelector(
                '#history_table_wrap .investment-history-table[data-table-header] thead tr',
            );
            const holdingsRow = document.querySelector(
                '#investment_holdings_panel tr[data-investment-holdings-ticker="SGOV"]',
            );
            const historyRow = document.querySelector('#investment_history tr[data-investment-history-row]');
            const holdingsHeaderRect = holdingsHeader.cells.item(5).getBoundingClientRect();
            const historyHeaderRect = historyHeader.cells.item(8).getBoundingClientRect();
            const holdingsValueCell = holdingsRow.cells.item(5);
            const historyValueCell = historyRow.cells.item(8);
            const holdingsSummaryRow = holdingsHeader.closest('table')?.tHead?.rows.item(1);
            const holdingsValueStyle = getComputedStyle(holdingsValueCell);
            const historyValueStyle = getComputedStyle(historyValueCell);
            const holdingsShell = holdingsHeader.closest('.investment-holdings-table-shell');
            const holdingsScroll = holdingsShell?.querySelector('.investment-holdings-table-scroll');
            const holdingsBodyTable = holdingsScroll?.querySelector('.investment-holdings-table');
            const holdingsBodyRows = holdingsBodyTable?.tBodies.item(0)?.rows;
            const lastBodyRow = holdingsBodyRows?.item((holdingsBodyRows.length || 1) - 1);
            const getValueRightEdge = (cell) => {
                const value = cell.querySelector(
                    '.investment-holdings-pnl-stack, .investment-holdings-allocation-badge, [data-investment-live-field]',
                );
                return value?.getBoundingClientRect().right ?? 0;
            };
            return {
                headerCenterDelta: Math.abs(
                    (holdingsHeaderRect.left + holdingsHeaderRect.right)
                    - (historyHeaderRect.left + historyHeaderRect.right),
                ) / 2,
                leftDelta: Math.abs(holdingsHeaderRect.left - historyHeaderRect.left),
                rightDelta: Math.abs(holdingsHeaderRect.right - historyHeaderRect.right),
                textAlignMatches: (
                    holdingsValueStyle.textAlign === 'right'
                    && historyValueStyle.textAlign === 'right'
                ),
                paddingMatches: (
                    holdingsValueStyle.paddingInlineStart === historyValueStyle.paddingInlineStart
                    && holdingsValueStyle.paddingInlineEnd === historyValueStyle.paddingInlineEnd
                ),
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
        expect(alignment.leftDelta).toBeLessThanOrEqual(1);
        expect(alignment.rightDelta).toBeLessThanOrEqual(1);
        expect(alignment.headerCenterDelta).toBeLessThanOrEqual(1);
        expect(alignment.textAlignMatches).toBe(true);
        expect(alignment.paddingMatches).toBe(true);
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
    }
});

