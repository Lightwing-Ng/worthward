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
test('matches Stock details numeric typography to Transaction history', async ({page}) => {
    await mockInvestmentReadApis(page, {
        transactions: [
            {ledger_no: 1, broker: 'ibkr', date: '2026-07-21', type: 'buy', ticker: 'QQQ', currency: 'USD', quantity: 1, price: 500.25, amount: -500.25, commission: -1.25},
            {ledger_no: 2, broker: 'ibkr', date: '2026-07-22', type: 'sell', ticker: 'QQQ', currency: 'USD', quantity: 1, price: 510.75, amount: 510.75, commission: -1.75, broker_realized_pnl_raw: 10.50},
            {ledger_no: 3, broker: 'ibkr', date: '2026-07-23', type: 'sell', ticker: 'QQQ', currency: 'USD', quantity: 1, price: 490.00, amount: 490.00, commission: -1.50, broker_realized_pnl_raw: -10.50},
        ],
        priceHistoryByTicker: {
            QQQ: [
                {date: '2026-07-21', close: 500.25},
                {date: '2026-07-22', close: 510.75},
                {date: '2026-07-23', close: 490.00},
            ],
        },
    });
    await page.goto('/trade/investment?ticker=QQQ#stock_panel');

    const typographyPairs = await page.locator('[data-investment-stock-detail-ledger="2"]').evaluate((stockRow) => {
        const stockBuyRow = document.querySelector('[data-investment-stock-detail-ledger="1"]');
        const historyBuyRow = document.querySelector('#investment_history_row_1');
        const historyRow = document.querySelector('#investment_history_row_2');
        const readCell = (cell) => {
            const metric = cell?.querySelector('.investment-history-metric-value.trade-metric-value');
            const major = cell?.querySelector('.workspace-metric-value-major');
            const minor = cell?.querySelector('.workspace-metric-value-minor');
            return {
                hasMetric: Boolean(metric),
                hasMajor: Boolean(major),
                majorFontSize: major ? getComputedStyle(major).fontSize : '',
                minorFontSize: minor ? getComputedStyle(minor).fontSize : '',
            };
        };
        return [
            [stockBuyRow, 6, historyBuyRow, 6],
            [stockBuyRow, 7, historyBuyRow, 7],
            [stockBuyRow, 8, historyBuyRow, 8],
            [stockRow, 9, historyRow, 10],
        ].map(([stock, stockIndex, history, historyIndex]) => ({
            stock: readCell(stock?.cells.item(stockIndex)),
            history: readCell(history?.cells.item(historyIndex)),
        }));
    });

    for (const pair of typographyPairs) {
        expect(pair.stock.hasMetric).toBe(true);
        expect(pair.stock.hasMajor).toBe(true);
        expect(pair.stock.majorFontSize).toBe(pair.history.majorFontSize);
        expect(pair.stock.minorFontSize).toBe(pair.history.minorFontSize);
    }

    const colorTones = await page.evaluate(() => {
        const resolveTokenColor = (tokenName) => {
            const probe = document.createElement('span');
            probe.style.color = `var(${tokenName})`;
            document.body.appendChild(probe);
            const color = getComputedStyle(probe).color;
            probe.remove();
            return color;
        };
        const readPnlTone = (ledgerNo) => {
            const cell = document.querySelector(`[data-investment-stock-detail-ledger="${ledgerNo}"]`)?.cells.item(9);
            const metric = cell?.querySelector('.investment-history-metric-value');
            return {
                className: metric?.className || '',
                color: metric ? getComputedStyle(metric).color : '',
                expectedColor: resolveTokenColor(
                    ledgerNo === '2' ? '--theme-accent-positive' : '--theme-accent-secondary',
                ),
            };
        };
        return {
            positive: readPnlTone('2'),
            negative: readPnlTone('3'),
        };
    });

    expect(colorTones.positive.className).toContain('investment-holdings-value-positive');
    expect(colorTones.positive.color).toBe(colorTones.positive.expectedColor);
    expect(colorTones.negative.className).toContain('investment-holdings-value-negative');
    expect(colorTones.negative.color).toBe(colorTones.negative.expectedColor);
});

test('exports the filtered Stock details scope as a standard XLSX workbook', async ({page}) => {
    const standardWorkbook = await readFile(fixturePath('zircon-hk-valid.xlsx'));
    let exportRequest = null;
    await page.route('**/api/investment/exports/standard.xlsx', async (route) => {
        exportRequest = route.request().postDataJSON();
        await route.fulfill({
            status: 200,
            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            headers: {
                'Content-Disposition': 'attachment; filename=QQQ_standard_investment_export.xlsx',
            },
            body: standardWorkbook,
        });
    });
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

    await page.locator('[data-investment-stock-details-time-filter-trigger]').click();
    await page.locator('#investment_stock_details_date_start').evaluate((input) => {
        input.value = '2026-07-22';
        input.dispatchEvent(new Event('change', {bubbles: true}));
    });
    await page.locator('#investment_share_actions > .export-transactions-button').hover();
    const standardXlsxButton = page.locator('#export_standard_xlsx_button');
    const standardXlsxButtonBox = await standardXlsxButton.boundingBox();
    expect(standardXlsxButtonBox).not.toBeNull();
    await page.mouse.move(
        standardXlsxButtonBox.x + (standardXlsxButtonBox.width / 2),
        standardXlsxButtonBox.y + (standardXlsxButtonBox.height / 2),
        {steps: 12},
    );
    await expect(standardXlsxButton).toHaveCSS('pointer-events', 'auto');
    const downloadPromise = page.waitForEvent('download');
    await standardXlsxButton.click();
    const download = await downloadPromise;
    const downloadPath = await download.path();
    expect(download.suggestedFilename()).toBe('QQQ_standard_investment_export.xlsx');
    expect(downloadPath).not.toBeNull();
    const downloadedBytes = await readFile(downloadPath);
    expect(downloadedBytes.subarray(0, 2).toString('ascii')).toBe('PK');
    expect(exportRequest.transactions).toHaveLength(1);
    expect(exportRequest.transactions[0].ledger_no).toBe(2);
});

test('uses Longbridge extended-hours quotes for the Stock details live position without animating metric-card chrome', async ({page}) => {
    await page.addInitScript(() => {
        const RealDate = Date;
        const fixedTimestamp = new RealDate('2026-07-20T21:30:00Z').valueOf();
        class FixedDate extends RealDate {
            constructor(...args) {
                super(...(args.length ? args : [fixedTimestamp]));
            }

            static now() {
                return fixedTimestamp;
            }
        }
        window.Date = FixedDate;

        const nativeSetTimeout = window.setTimeout.bind(window);
        window.setTimeout = (callback, delay, ...args) => {
            if (delay === 60_000 && typeof callback === 'function') {
                window.__testTriggerInvestmentRealtimePoll = () => callback(...args);
                return 0;
            }
            return nativeSetTimeout(callback, delay, ...args);
        };
    });
    let quoteSource = 'longbridge';
    let quotePrice = 55.54;
    const liveQuotes = () => [{
        ticker: 'DRAM',
        price: quotePrice,
        timestamp: '2026-07-20 17:30',
        session: 'post',
        session_date: '2026-07-20',
        market: 'US',
        source: quoteSource,
    }];
    await mockInvestmentReadApis(page, {
        transactions: [
            {ledger_no: 1, broker: 'ibkr', date: '2026-07-20', type: 'buy', ticker: 'DRAM', currency: 'USD', quantity: 10, price: 54, amount: -540},
        ],
        priceHistoryByTicker: {
            DRAM: [
                {date: '2026-07-16', close: 53.0},
                {date: '2026-07-17', close: 54.0},
                {date: '2026-07-20', close: 55.0},
            ],
        },
        realtimeQuotes: liveQuotes,
        marketSession: {
            session: 'post',
            is_trading_day: true,
            is_realtime_allowed: true,
            session_date: '2026-07-20',
        },
    });
    await page.emulateMedia({reducedMotion: 'no-preference'});
    await page.setViewportSize({width: 1_024, height: 863});
    const firstSessionResponse = page.waitForResponse((response) => (
        response.url().includes('/api/market-session/us-equity')
    ));
    const firstRealtimeQuoteResponse = page.waitForResponse((response) => (
        response.url().includes('/api/investment/realtime-quotes')
    ));
    await page.goto('/trade/investment?ticker=DRAM#stock_panel');
    await firstSessionResponse;
    await firstRealtimeQuoteResponse;
    await page.locator('label[for="investment_stock_details_range_3m"]').click();

    const marker = page.locator('[data-investment-stock-details-live-marker]');
    await expect.poll(() => marker.evaluate((element) => !element.hidden)).toBe(true);
    const metricGrid = page.locator('.investment-stock-details-metrics');
    await expect(metricGrid).not.toHaveClass(/is-investment-realtime-pulse/);
    await expect(metricGrid.locator('.investment-stock-details-metric-card').first()).toHaveCSS('animation-name', 'none');
    const longbridgeGeometry = await marker.evaluate((element) => {
        const canvas = document.querySelector('.investment-stock-details-price-chart-canvas');
        const chart = window.Chart.getChart(canvas);
        const lastIndex = chart.data.labels.length - 1;
        return {
            markerLeft: Number.parseFloat(element.style.left),
            markerTop: Number.parseFloat(element.style.top),
            expectedLeft: chart.scales.x.getPixelForValue(lastIndex),
            expectedTop: chart.scales.y.getPixelForValue(55.54),
            yMaximum: chart.scales.y.max,
        };
    });
    expect(Math.abs(longbridgeGeometry.markerLeft - longbridgeGeometry.expectedLeft)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(longbridgeGeometry.markerTop - longbridgeGeometry.expectedTop)).toBeLessThanOrEqual(0.5);
    expect(longbridgeGeometry.yMaximum).toBeGreaterThanOrEqual(55.54);

    const lastPrice = metricGrid.locator('[data-investment-live-field="stock_last_price"]');
    const holdingsLastPrice = page.locator(
        '#investment_holdings_panel tr[data-investment-holdings-ticker="DRAM"] [data-investment-live-field="last"]',
    ).first();
    await expect(lastPrice).toHaveAttribute('data-investment-live-number', '55.54');
    await expect(lastPrice).toHaveAttribute('data-investment-live-display', '55.54');
    await expect(lastPrice).not.toHaveAttribute('data-investment-live-animation-token', /.+/);
    const liveMetricOverflow = await metricGrid.locator('[data-investment-live-field]').evaluateAll((nodes) => (
        nodes.map((node) => {
            const cardRect = node.closest('.investment-stock-details-metric-card')?.getBoundingClientRect();
            const valueRect = node.getBoundingClientRect();
            return cardRect ? Math.max(0, valueRect.right - cardRect.right) : Number.POSITIVE_INFINITY;
        })
    ));
    expect(Math.max(...liveMetricOverflow)).toBeLessThanOrEqual(1);
    await expect(lastPrice).not.toHaveAttribute('data-investment-live-reserve-width', /.+/);
    await expect.poll(() => page.evaluate(() => (
        window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ))).toBe(false);
    const freezeLiveDigitAnimations = () => page.evaluate(() => {
        const nativeRequestAnimationFrame = window.requestAnimationFrame.bind(window);
        window.__testNativeInvestmentRequestAnimationFrame = nativeRequestAnimationFrame;
        window.__testPendingInvestmentAnimationFrames = [];
        window.requestAnimationFrame = (callback) => {
            window.__testPendingInvestmentAnimationFrames.push(callback);
            return window.__testPendingInvestmentAnimationFrames.length;
        };
    });
    const resumeLiveDigitAnimations = () => page.evaluate(() => {
        const nativeRequestAnimationFrame = window.__testNativeInvestmentRequestAnimationFrame;
        const pendingFrames = window.__testPendingInvestmentAnimationFrames || [];
        if (typeof nativeRequestAnimationFrame === 'function') {
            window.requestAnimationFrame = nativeRequestAnimationFrame;
            pendingFrames.forEach((callback) => nativeRequestAnimationFrame(callback));
        }
        delete window.__testNativeInvestmentRequestAnimationFrame;
        delete window.__testPendingInvestmentAnimationFrames;
    });
    await expect.poll(() => page.evaluate(() => typeof window.__testTriggerInvestmentRealtimePoll)).toBe('function');
    quotePrice = 56.54;
    await freezeLiveDigitAnimations();
    const risingQuoteResponse = page.waitForResponse((response) => (
        response.url().includes('/api/investment/realtime-quotes')
    ));
    await page.evaluate(() => window.__testTriggerInvestmentRealtimePoll());
    await risingQuoteResponse;
    await expect(lastPrice).toHaveClass(/is-live-rise/);
    await expect(lastPrice.locator('.investment-live-digit--rise .investment-live-digit-face--new').first())
        .toHaveCSS('color', 'rgb(22, 163, 74)');
    await expect(holdingsLastPrice).toHaveAttribute('data-investment-live-number', '56.54');
    await expect(holdingsLastPrice).not.toHaveClass(/is-live-rise/);
    await expect(holdingsLastPrice.locator('.investment-live-digit')).toHaveCount(0);
    await expect(metricGrid.locator('.investment-stock-details-metric-card').first()).toHaveCSS('animation-name', 'none');
    await resumeLiveDigitAnimations();
    await expect(lastPrice).not.toHaveClass(/is-live-rise/);

    quotePrice = 54.54;
    await freezeLiveDigitAnimations();
    const fallingQuoteResponse = page.waitForResponse((response) => (
        response.url().includes('/api/investment/realtime-quotes')
    ));
    await page.evaluate(() => window.__testTriggerInvestmentRealtimePoll());
    await fallingQuoteResponse;
    await expect(lastPrice).toHaveClass(/is-live-fall/);
    await expect(lastPrice.locator('.investment-live-digit--fall .investment-live-digit-face--new').first())
        .toHaveCSS('color', 'rgb(255, 47, 146)');
    await expect(holdingsLastPrice).toHaveAttribute('data-investment-live-number', '54.54');
    await expect(holdingsLastPrice).not.toHaveClass(/is-live-fall/);
    await expect(holdingsLastPrice.locator('.investment-live-digit')).toHaveCount(0);
    await resumeLiveDigitAnimations();
    await expect(lastPrice).not.toHaveClass(/is-live-fall/);

    quoteSource = 'yfinance';
    const secondSessionResponse = page.waitForResponse((response) => (
        response.url().includes('/api/market-session/us-equity')
    ));
    await page.reload();
    await secondSessionResponse;
    await page.locator('label[for="investment_stock_details_range_3m"]').click();
    await expect.poll(() => marker.evaluate((element) => element.hidden)).toBe(true);
    await expect(metricGrid).not.toHaveClass(/is-investment-realtime-pulse/);
});

test('matches investment transaction headers to the shared field-title color in both themes', async ({page}) => {
    await mockInvestmentReadApis(page, {
        transactions: [
            {ledger_no: 1, broker: 'ibkr', date: '2026-07-10', type: 'buy', ticker: 'QQQ', currency: 'USD', quantity: 1, price: 500, amount: -500},
        ],
        priceHistoryByTicker: {
            QQQ: [
                {date: '2026-07-10', close: 500},
                {date: '2026-07-11', close: 501},
            ],
        },
    });
    await page.emulateMedia({colorScheme: 'dark'});
    await page.setViewportSize({width: 1_024, height: 863});
    await page.goto('/trade/investment?ticker=QQQ#stock_panel');

    const stockTable = page.locator('#investment_stock_details_table_host');
    const historyTable = page.locator('#history_table_wrap');
    await expect(stockTable).toBeVisible();
    await expect(historyTable).toBeHidden();
    const readColors = (table) => table.evaluate((host) => {
        const bodyCell = host.querySelector('tbody td');
        const headers = Array.from(host.querySelectorAll('thead th'));
        return {
            body: getComputedStyle(bodyCell).color,
            headers: headers.map((header) => ({
                color: getComputedStyle(header).color,
                label: header.getAttribute('aria-label') || header.textContent.trim(),
            })),
            filterControls: headers
                .flatMap((header) => Array.from(header.querySelectorAll('button')))
                .map((control) => getComputedStyle(control).color),
        };
    });

    const darkStockColors = await readColors(stockTable);
    expect(darkStockColors.headers.map(({label}) => label)).toContain('Realized P&L');
    expect(darkStockColors.headers.every(({color}) => color === darkStockColors.body)).toBe(true);
    expect(darkStockColors.filterControls.every((color) => color === darkStockColors.body)).toBe(true);

    await page.emulateMedia({colorScheme: 'light'});
    await expect.poll(async () => (await readColors(stockTable)).headers[0].color).not.toBe(darkStockColors.body);
    const lightStockColors = await readColors(stockTable);
    const fieldTitleColor = await stockTable.evaluate((host) => {
        const probe = document.createElement('span');
        probe.style.color = 'var(--field-title-color)';
        host.append(probe);
        const color = getComputedStyle(probe).color;
        probe.remove();
        return color;
    });
    expect(lightStockColors.headers.every(({color}) => color === fieldTitleColor)).toBe(true);
    expect(lightStockColors.headers.every(({color}) => color !== darkStockColors.body)).toBe(true);
    expect(lightStockColors.filterControls.every((color) => color !== darkStockColors.body)).toBe(true);
});

test('sizes the stock-detail Type menu to its widest option', async ({page}) => {
    await mockInvestmentReadApis(page, {
        transactions: [
            {ledger_no: 1, broker: 'ibkr', date: '2026-07-10', type: 'buy', ticker: 'QQQ', currency: 'USD', quantity: 1, price: 500, amount: -500},
            {ledger_no: 2, broker: 'ibkr', date: '2026-07-11', type: 'foreign_tax_withholding', ticker: 'QQQ', currency: 'USD', amount: -1},
            {ledger_no: 3, broker: 'ibkr', date: '2026-07-12', type: 'forex_trade_component', ticker: 'QQQ', currency: 'USD', amount: 2},
        ],
        priceHistoryByTicker: {
            QQQ: [
                {date: '2026-07-10', close: 500},
                {date: '2026-07-11', close: 501},
                {date: '2026-07-12', close: 502},
            ],
        },
    });
    await page.setViewportSize({width: 1_024, height: 863});
    await page.goto('/trade/investment?ticker=QQQ#stock_panel');

    const stockTable = page.locator('#investment_stock_details_table_host');
    const trigger = stockTable.locator('[data-investment-side-filter-trigger]');
    await expect(trigger).toBeVisible();
    await trigger.click();

    const dropdown = page.locator(
        '[data-investment-side-filter-dropdown][data-filter-owner="investment_stock_details_side_filter"]',
    );
    await expect(dropdown).toBeVisible();
    const geometry = await dropdown.evaluate((menu) => {
        const triggerElement = document.querySelector(
            '#investment_stock_details_table_host [data-investment-side-filter-trigger]',
        );
        const titles = Array.from(menu.querySelectorAll('.trade-strategy-dropdown-title'));
        return {
            clippedTitles: titles
                .filter((title) => title.scrollWidth > title.clientWidth + 1)
                .map((title) => title.textContent),
            menuWidth: menu.getBoundingClientRect().width,
            triggerWidth: triggerElement?.getBoundingClientRect().width || 0,
        };
    });
    expect(geometry.clippedTitles).toEqual([]);
    expect(geometry.menuWidth).toBeGreaterThan(geometry.triggerWidth);
});

test('keeps stock-detail metric sources collapsed until their shared arrow is toggled', async ({page}) => {
    await mockInvestmentReadApis(page, {
        brokers: ['ibkr', 'hsbc'],
        transactions: [
            {broker: 'ibkr', date: '2026-07-10', type: 'buy', ticker: 'QQQ', currency: 'USD', quantity: 2, price: 100, amount: -200, commission: 0.20},
            {broker: 'hsbc', date: '2026-07-11', type: 'buy', ticker: 'QQQ', currency: 'USD', quantity: 2, price: 101, amount: -202, commission: 0.20},
            {broker: 'ibkr', date: '2026-07-12', type: 'sell', ticker: 'QQQ', currency: 'USD', quantity: 1, price: 110, amount: 110, commission: 0.10},
            {broker: 'ibkr', date: '2026-07-13', type: 'dividend', ticker: 'QQQ', currency: 'USD', amount: 10},
            {broker: 'ibkr', date: '2026-07-14', type: 'foreign_tax_withholding', ticker: 'QQQ', currency: 'USD', amount: -1},
            {broker: 'hsbc', date: '2026-07-15', type: 'sell', ticker: 'QQQ', currency: 'USD', quantity: 1, price: 111, amount: 111, commission: 0.10},
        ],
        priceHistoryByTicker: {
            QQQ: [
                {date: '2026-07-10', close: 100},
                {date: '2026-07-11', close: 101},
                {date: '2026-07-12', close: 110},
                {date: '2026-07-13', close: 109},
                {date: '2026-07-14', close: 110},
                {date: '2026-07-15', close: 112},
            ],
        },
    });
    await page.setViewportSize({width: 735, height: 686});
    await page.goto('/trade/investment?ticker=QQQ#stock_panel');
    await setSidebarExpanded(page, false);
    await expect(page.locator('#stock_panel .investment-stock-details-price-chart-canvas')).toBeVisible();

    const portfolioWeightValue = page.locator('#stock_panel .trade-metric-card')
        .filter({hasText: 'Portfolio weight'})
        .locator('.investment-stock-details-metric-value');
    await expect(portfolioWeightValue.locator('.workspace-metric-value-major')).toHaveText(/^\d+$/);
    await expect(portfolioWeightValue.locator('.workspace-metric-value-minor')).toHaveText(/^\.\d+$/);
    const fractionalTypography = await portfolioWeightValue.evaluate((value) => {
        const major = value.querySelector('.workspace-metric-value-major');
        const minor = value.querySelector('.workspace-metric-value-minor');
        if (!(major instanceof HTMLElement) || !(minor instanceof HTMLElement)) return null;
        const majorStyle = getComputedStyle(major);
        const minorStyle = getComputedStyle(minor);
        const majorTextRange = document.createRange();
        majorTextRange.selectNodeContents(major);
        const minorTextRange = document.createRange();
        minorTextRange.selectNodeContents(minor);
        return {
            majorFontSize: Number.parseFloat(majorStyle.fontSize),
            minorFontSize: Number.parseFloat(minorStyle.fontSize),
            minorTransform: minorStyle.transform,
            textBottomDelta: Math.abs(
                majorTextRange.getBoundingClientRect().bottom
                - minorTextRange.getBoundingClientRect().bottom
            ),
        };
    });
    expect(fractionalTypography).not.toBeNull();
    expect(fractionalTypography.minorFontSize).toBeLessThan(fractionalTypography.majorFontSize);
    expect(fractionalTypography.minorTransform).not.toBe('none');
    expect(fractionalTypography.textBottomDelta).toBeLessThanOrEqual(0.1);

    const detailCards = page.locator('#stock_panel .investment-stock-details-metric-card-with-breakdown');
    await expect(detailCards).toHaveCount(5);
    await expect(detailCards.locator('.investment-stock-details-metric-breakdown')).toHaveCount(5);
    await expect(detailCards.locator('.investment-stock-details-metric-breakdown:not([hidden])')).toHaveCount(0);
    await expect(detailCards.locator('.investment-stock-details-metric-breakdown-trigger[aria-expanded="false"]')).toHaveCount(5);

    const alignment = await detailCards.evaluateAll((cards) => cards.map((card) => {
        const row = card.querySelector('.investment-stock-details-metric-value-row');
        const trigger = card.querySelector('.investment-stock-details-metric-breakdown-trigger');
        const value = card.querySelector('.investment-stock-details-metric-value');
        if (!(row instanceof HTMLElement) || !(trigger instanceof HTMLElement) || !(value instanceof HTMLElement)) return null;
        const rowRect = row.getBoundingClientRect();
        const triggerRect = trigger.getBoundingClientRect();
        const valueRect = value.getBoundingClientRect();
        return {
            triggerLeftDelta: triggerRect.left - rowRect.left,
            triggerCenterDelta: (triggerRect.top + (triggerRect.height / 2)) - (valueRect.top + (valueRect.height / 2)),
            triggerWidth: triggerRect.width,
            triggerHeight: triggerRect.height,
        };
    }));
    expect(alignment.every(Boolean)).toBe(true);
    alignment.forEach((entry) => {
        expect(Math.abs(entry.triggerLeftDelta)).toBeLessThanOrEqual(1);
        expect(Math.abs(entry.triggerCenterDelta)).toBeLessThanOrEqual(1);
        expect(entry.triggerWidth).toBe(20);
        expect(entry.triggerHeight).toBe(20);
    });

    const brokerTrigger = page.locator('#investment_stock_details_table_host [data-investment-broker-filter-trigger]');
    const firstDetailCard = detailCards.first();
    const metricTrigger = firstDetailCard.locator('.investment-stock-details-metric-breakdown-trigger');
    await expect(brokerTrigger).toBeVisible();
    const readMetricTriggerPresentation = () => metricTrigger.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
            opacity: style.opacity,
            pointerEvents: style.pointerEvents,
        };
    });
    expect(await readMetricTriggerPresentation()).toEqual({opacity: '0', pointerEvents: 'none'});
    await firstDetailCard.hover();
    await expect.poll(readMetricTriggerPresentation).toEqual({opacity: '1', pointerEvents: 'auto'});
    await page.locator('#investment_view_segmented').hover();
    await expect.poll(readMetricTriggerPresentation).toEqual({opacity: '0', pointerEvents: 'none'});
    await metricTrigger.focus();
    await expect.poll(readMetricTriggerPresentation).toEqual({opacity: '1', pointerEvents: 'auto'});

    const sharedArrowGeometry = async (locator) => locator.evaluate((element) => {
        const triggerStyle = getComputedStyle(element);
        const arrowStyle = getComputedStyle(element, '::before');
        return {
            triggerWidth: triggerStyle.width,
            triggerHeight: triggerStyle.height,
            arrowWidth: arrowStyle.width,
            arrowHeight: arrowStyle.height,
            arrowMask: arrowStyle.maskImage || arrowStyle.webkitMaskImage,
        };
    });
    expect(await sharedArrowGeometry(metricTrigger)).toEqual(await sharedArrowGeometry(brokerTrigger));

    const realizedCard = detailCards.filter({has: page.locator('.trade-metric-label', {hasText: /^Realized P&L$/})});
    const realizedTrigger = realizedCard.locator('.investment-stock-details-metric-breakdown-trigger');
    const realizedBreakdown = realizedCard.locator('.investment-stock-details-metric-breakdown');
    const readRealizedTriggerAlignment = () => realizedTrigger.evaluate((trigger) => {
        const value = trigger.parentElement?.querySelector('.investment-stock-details-metric-value');
        if (!(value instanceof HTMLElement)) return null;
        const triggerRect = trigger.getBoundingClientRect();
        const valueRect = value.getBoundingClientRect();
        return {
            centerDelta: (triggerRect.top + (triggerRect.height / 2))
                - (valueRect.top + (valueRect.height / 2)),
            transform: getComputedStyle(trigger).transform,
        };
    });
    const realizedAlignmentBeforeInteraction = await readRealizedTriggerAlignment();
    expect(realizedAlignmentBeforeInteraction).not.toBeNull();
    await realizedCard.hover();
    await expect.poll(readRealizedTriggerAlignment).toEqual(realizedAlignmentBeforeInteraction);
    await expect(realizedBreakdown).toBeHidden();
    await realizedTrigger.click();
    await expect(realizedTrigger).toHaveAttribute('aria-expanded', 'true');
    await expect.poll(readRealizedTriggerAlignment).toEqual(realizedAlignmentBeforeInteraction);
    await expect(realizedTrigger).toHaveAttribute('aria-label', 'Hide Realized P&L details');
    await expect(realizedBreakdown).toBeVisible();
    await expect(realizedBreakdown).toContainText('Dividend income');
    await expect(realizedBreakdown).toContainText('Foreign tax withholding');
    await expect(realizedBreakdown).toContainText('Trading spread income');
    await expect(realizedBreakdown).toContainText('IBKR · Dividend income');
    await expect(realizedBreakdown).toContainText('IBKR · Foreign tax withholding');
    await expect(realizedBreakdown).toContainText('IBKR · Trading spread income');
    await expect(realizedBreakdown).toContainText('HSBC · Trading spread income');

    const marketValueCard = detailCards.filter({has: page.locator('.trade-metric-label', {hasText: /^Market value$/})});
    const marketValueTrigger = marketValueCard.locator('.investment-stock-details-metric-breakdown-trigger');
    await marketValueTrigger.focus();
    await marketValueTrigger.press('Enter');
    await expect(marketValueTrigger).toHaveAttribute('aria-expanded', 'true');
    await expect(marketValueCard.locator('.investment-stock-details-metric-breakdown')).toBeVisible();
    await expect(realizedBreakdown).toBeVisible();

    await realizedTrigger.focus();
    await realizedTrigger.press('Space');
    await expect(realizedTrigger).toHaveAttribute('aria-expanded', 'false');
    await expect(realizedTrigger).toHaveAttribute('aria-label', 'Show Realized P&L details');
    await expect(realizedBreakdown).toBeHidden();
    await expect(page.locator('#stock_panel .investment-stock-details-metric-card', {
        has: page.locator('.trade-metric-label', {hasText: /^Unrealized P&L$/}),
    }).locator('.investment-stock-details-metric-breakdown-trigger')).toHaveCount(0);
});

test('keeps YTD investment x-axis labels inside the overview clip at low desktop heights', async ({page}) => {
    await mockInvestmentReadApis(page, {
        transactions: [
            {broker: 'ibkr', date: '2026-01-02', type: 'buy', ticker: 'QQQ', currency: 'USD', quantity: 1, price: 500, amount: -500},
            {broker: 'ibkr', date: '2026-03-09', type: 'buy', ticker: 'QQQ', currency: 'USD', quantity: 1, price: 501, amount: -501},
            {broker: 'ibkr', date: '2026-05-15', type: 'buy', ticker: 'QQQ', currency: 'USD', quantity: 1, price: 502, amount: -502},
            {broker: 'ibkr', date: '2026-07-17', type: 'buy', ticker: 'QQQ', currency: 'USD', quantity: 1, price: 503, amount: -503},
        ],
    });
    await page.setViewportSize({width: 792, height: 675});
    await page.goto('/trade/investment');
    await setSidebarExpanded(page, false);
    await expect.poll(() => page.locator(
        '.investment-workspace-header > .workspace-summary-card'
    ).evaluate((card) => {
        const rootStyles = getComputedStyle(document.documentElement);
        const expected = Number.parseFloat(
            rootStyles.getPropertyValue('--workspace-title-rail-pad-block-start')
        );
        const actual = Number.parseFloat(getComputedStyle(card).paddingTop);
        return Math.abs(actual - expected);
    })).toBeLessThanOrEqual(0.5);
    await page.locator('label[for="investment_equity_range_ytd"]').click();
    await expect(page.locator('#investmentEquityChart[data-investment-chart-ready="1"]')).toBeVisible();
    const resizer = page.locator('#investment_section_resizer');
    await resizer.focus();
    await resizer.press('Home');
    await expect.poll(() => page.locator('#investmentEquityChart').evaluate((canvas) => {
        const clip = document.querySelector('.investment-view-surface-body');
        return canvas.getBoundingClientRect().bottom <= clip.getBoundingClientRect().bottom + 1;
    })).toBe(true);

    const geometry = await page.evaluate(() => {
        const canvas = document.querySelector('#investmentEquityChart');
        const clip = document.querySelector('.investment-view-surface-body');
        const history = document.querySelector('#investment_history_surface');
        const chart = window.Chart?.getChart?.(canvas);
        if (!(canvas instanceof HTMLCanvasElement) || !clip || !history || !chart?.chartArea) return null;
        const canvasRect = canvas.getBoundingClientRect();
        const clipRect = clip.getBoundingClientRect();
        const historyRect = history.getBoundingClientRect();
        const labelOptions = chart.options?.plugins?.investmentXAxisLabels || {};
        const fontSize = Number.parseFloat(labelOptions.fontSize) || 12;
        const lineHeight = Number.parseFloat(labelOptions.lineHeight) || 10;
        return {
            axisLabelBottom: canvasRect.top + chart.chartArea.bottom + lineHeight + fontSize,
            canvasBottom: canvasRect.bottom,
            clipBottom: clipRect.bottom,
            historyTop: historyRect.top,
        };
    });
    expect(geometry).not.toBeNull();
    expect(geometry.axisLabelBottom).toBeLessThanOrEqual(geometry.clipBottom + 1);
    expect(geometry.canvasBottom).toBeLessThanOrEqual(geometry.clipBottom + 1);
    expect(geometry.clipBottom).toBeLessThanOrEqual(geometry.historyTop + 1);
});

test('aligns the trade title with the shared desktop title rail', async ({page}) => {
    await mockInvestmentReadApis(page);
    await page.setViewportSize({width: 1024, height: 900});
    await page.goto('/trade/investment');

    const readTitleGeometry = () => page.evaluate(() => {
        const trade = document.querySelector('#app_sidebar .hero h1').getBoundingClientRect();
        const investment = document.querySelector(
            '.investment-workspace-header > .workspace-summary-card .report-heading'
        ).getBoundingClientRect();
        const summary = document.querySelector(
            '.investment-workspace-header > .workspace-summary-card'
        ).getBoundingClientRect();
        const toggle = document.querySelector('#sidebar_toggle').getBoundingClientRect();
        const theme = document.querySelector('#global_theme_toggle').getBoundingClientRect();
        const centerY = (rect) => rect.top + (rect.height / 2);
        return {
            tradeCenter: centerY(trade),
            investmentCenter: centerY(investment),
            summaryHeight: summary.height,
            toggleCenter: centerY(toggle),
            toggleRight: toggle.right,
            themeCenter: centerY(theme),
            investmentLeft: investment.left,
        };
    });

    await expect(page.locator('#sidebar_toggle')).toHaveAttribute('aria-expanded', 'true');
    const expanded = await readTitleGeometry();
    expect(Math.abs(expanded.tradeCenter - expanded.investmentCenter)).toBeLessThanOrEqual(1);
    expect(Math.abs(expanded.investmentCenter - expanded.toggleCenter)).toBeLessThanOrEqual(1);
    expect(Math.abs(expanded.investmentCenter - expanded.themeCenter)).toBeLessThanOrEqual(1);

    await page.locator('#sidebar_toggle').click();
    await expect(page.locator('#sidebar_toggle')).toHaveAttribute('aria-expanded', 'false');
    await expect.poll(async () => {
        const collapsed = await readTitleGeometry();
        return collapsed.investmentLeft - collapsed.toggleRight;
    }).toBeGreaterThanOrEqual(12);
    const collapsed = await readTitleGeometry();
    expect(Math.abs(collapsed.investmentCenter - collapsed.toggleCenter)).toBeLessThanOrEqual(1);
    expect(Math.abs(collapsed.investmentCenter - collapsed.themeCenter)).toBeLessThanOrEqual(1);
    expect(Math.abs(collapsed.summaryHeight - expanded.summaryHeight)).toBeLessThanOrEqual(1);

    await page.locator('#sidebar_toggle').click();
    await expect(page.locator('#sidebar_toggle')).toHaveAttribute('aria-expanded', 'true');
    const unlockResponse = await page.context().request.post('/trade/live-trading/unlock', {
        form: {pin: process.env.WORTHWARD_LIVE_TRADING_PIN || '123456'},
    });
    expect(unlockResponse.status()).toBe(200);
    await page.goto('/trade/live-trading');
    await expect(page.locator(
        '.investment-workspace-header > .workspace-summary-card .report-heading'
    )).toHaveText('Live trading');
    const liveTrading = await readTitleGeometry();
    expect(Math.abs(liveTrading.tradeCenter - liveTrading.investmentCenter)).toBeLessThanOrEqual(1);
    expect(Math.abs(liveTrading.investmentCenter - liveTrading.toggleCenter)).toBeLessThanOrEqual(1);
    expect(Math.abs(liveTrading.investmentCenter - liveTrading.themeCenter)).toBeLessThanOrEqual(1);
});

test('keeps shared desktop titles clear throughout sidebar motion', async ({page}) => {
    await mockInvestmentReadApis(page);
    await page.setViewportSize({width: 1024, height: 863});

    const routes = [
        {
            url: '/trade/investment',
            title: '.investment-workspace-header > .workspace-summary-card .report-heading',
        },
        {
            url: '/workspaces/compare?ticker=QQQ&ticker=AAPL&period=1y',
            title: '.workspace-mode-title-card .report-heading',
        },
        {
            url: '/settings/about',
            title: '.settings-workspace-header > .settings-summary-card .report-heading',
        },
    ];

    const sampleTransition = (titleSelector) => page.evaluate(async (selector) => {
        const toggle = document.querySelector('#sidebar_toggle');
        const sidebar = document.querySelector('#app_sidebar');
        const title = document.querySelector(selector);
        if (!(toggle instanceof HTMLElement) || !(sidebar instanceof HTMLElement) || !(title instanceof HTMLElement)) {
            return null;
        }

        const frames = [];
        const startedAt = performance.now();
        toggle.click();
        await new Promise((resolve) => {
            const sample = () => {
                const toggleRect = toggle.getBoundingClientRect();
                const sidebarRect = sidebar.getBoundingClientRect();
                const titleRect = title.getBoundingClientRect();
                frames.push({
                    toggleGap: titleRect.left - toggleRect.right,
                    sidebarGap: titleRect.left - sidebarRect.right,
                });
                if (performance.now() - startedAt >= 700) {
                    resolve();
                    return;
                }
                requestAnimationFrame(sample);
            };
            requestAnimationFrame(sample);
        });

        return {
            minToggleGap: Math.min(...frames.map((frame) => frame.toggleGap)),
            minSidebarGap: Math.min(...frames.map((frame) => frame.sidebarGap)),
        };
    }, titleSelector);

    for (const route of routes) {
        await page.goto(route.url);
        await expect(page.locator(route.title)).toBeVisible();
        const toggle = page.locator('#sidebar_toggle');
        if (await toggle.getAttribute('aria-expanded') === 'false') {
            await toggle.click();
            await page.waitForTimeout(700);
        }

        const collapse = await sampleTransition(route.title);
        expect(collapse).not.toBeNull();
        expect(collapse.minToggleGap).toBeGreaterThanOrEqual(11.5);
        expect(collapse.minSidebarGap).toBeGreaterThanOrEqual(0);

        const expand = await sampleTransition(route.title);
        expect(expand).not.toBeNull();
        expect(expand.minToggleGap).toBeGreaterThanOrEqual(11.5);
        expect(expand.minSidebarGap).toBeGreaterThanOrEqual(0);
    }
});

test('adds desktop workspace gel motion without moving title rails or leaking into narrow layouts', async ({page}) => {
    await mockInvestmentReadApis(page, {
        transactions: [
            {broker: 'ibkr', date: '2026-07-17', type: 'buy', ticker: 'QQQ', currency: 'USD', quantity: 1, price: 500, amount: -500},
        ],
        priceHistoryByTicker: {
            QQQ: [
                {date: '2026-07-17', close: 500},
                {date: '2026-07-18', close: 501},
            ],
        },
    });
    await page.emulateMedia({reducedMotion: 'no-preference'});
    await page.setViewportSize({width: 1024, height: 863});
    await page.goto('/settings/style-tokens');
    await expect(page.locator('#sidebar_toggle')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('.style-token-shell')).toBeVisible();

    const expandedBaseline = await page.locator('.style-token-shell').evaluate((content) => {
        const rect = content.getBoundingClientRect();
        return {
            left: rect.left,
            top: rect.top,
            width: rect.width,
        };
    });

    const sampleSidebarMotion = () => page.evaluate(async () => {
        const toggle = document.querySelector('#sidebar_toggle');
        const shell = document.querySelector('.app-shell');
        const titleRail = document.querySelector('.settings-summary-card');
        const content = document.querySelector('.style-token-shell');
        if (!(toggle instanceof HTMLElement)
            || !(shell instanceof HTMLElement)
            || !(titleRail instanceof HTMLElement)
            || !(content instanceof HTMLElement)) {
            return null;
        }

        const frames = [];
        const startedAt = performance.now();
        toggle.click();
        await new Promise((resolve) => {
            const sample = () => {
                const transform = getComputedStyle(content).transform;
                const matrix = transform === 'none' ? new DOMMatrixReadOnly() : new DOMMatrixReadOnly(transform);
                const contentRect = content.getBoundingClientRect();
                const titleRect = titleRail.getBoundingClientRect();
                frames.push({
                    animationNames: content.getAnimations().map((animation) => animation.animationName || ''),
                    className: shell.className,
                    contentGap: contentRect.top - titleRect.bottom,
                    documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
                    offsetWidth: content.offsetWidth,
                    scaleX: matrix.a,
                    scaleY: matrix.d,
                    titleTransform: getComputedStyle(titleRail).transform,
                    translateX: matrix.e,
                });
                if (performance.now() - startedAt >= 760) {
                    resolve();
                    return;
                }
                requestAnimationFrame(sample);
            };
            requestAnimationFrame(sample);
        });
        const finalRect = content.getBoundingClientRect();
        return {
            finalAnimationNames: content.getAnimations().map((animation) => animation.animationName || ''),
            finalClassName: shell.className,
            finalRect: {
                left: finalRect.left,
                top: finalRect.top,
                width: finalRect.width,
            },
            finalTransform: getComputedStyle(content).transform,
            frames,
        };
    });

    const closing = await sampleSidebarMotion();
    expect(closing).not.toBeNull();
    expect(closing.frames.some((frame) => frame.className.includes('is-sidebar-closing'))).toBe(true);
    expect(closing.frames.some((frame) => frame.animationNames.includes('workspace-sidebar-gel-close'))).toBe(true);
    expect(Math.max(...closing.frames.map((frame) => Math.abs(frame.scaleX - 1)))).toBeGreaterThan(0.005);
    expect(Math.max(...closing.frames.map((frame) => Math.abs(frame.scaleY - 1)))).toBeGreaterThan(0.005);
    expect(Math.max(...closing.frames.map((frame) => Math.abs(frame.translateX)))).toBeGreaterThan(8);
    expect(Math.max(...closing.frames.map((frame) => frame.documentOverflow))).toBeLessThanOrEqual(1);
    expect(Math.min(...closing.frames.map((frame) => frame.contentGap))).toBeGreaterThanOrEqual(0);
    expect(
        Math.max(...closing.frames.map((frame) => frame.offsetWidth))
        - Math.min(...closing.frames.map((frame) => frame.offsetWidth)),
    ).toBeLessThanOrEqual(1);
    expect(closing.frames.every((frame) => frame.titleTransform === 'none')).toBe(true);
    expect(closing.finalClassName).not.toContain('is-sidebar-animating');
    expect(closing.finalTransform).toBe('none');
    expect(closing.finalAnimationNames.some((name) => String(name).startsWith('workspace-sidebar-gel-'))).toBe(false);

    const opening = await sampleSidebarMotion();
    expect(opening).not.toBeNull();
    expect(opening.frames.some((frame) => frame.className.includes('is-sidebar-opening'))).toBe(true);
    expect(opening.frames.some((frame) => frame.animationNames.includes('workspace-sidebar-gel-open'))).toBe(true);
    expect(Math.max(...opening.frames.map((frame) => frame.documentOverflow))).toBeLessThanOrEqual(1);
    expect(Math.min(...opening.frames.map((frame) => frame.contentGap))).toBeGreaterThanOrEqual(0);
    expect(
        Math.max(...opening.frames.map((frame) => frame.offsetWidth))
        - Math.min(...opening.frames.map((frame) => frame.offsetWidth)),
    ).toBeLessThanOrEqual(1);
    expect(opening.frames.every((frame) => frame.titleTransform === 'none')).toBe(true);
    expect(opening.finalClassName).not.toContain('is-sidebar-animating');
    expect(opening.finalTransform).toBe('none');
    expect(opening.finalAnimationNames.some((name) => String(name).startsWith('workspace-sidebar-gel-'))).toBe(false);
    expect(Math.abs(opening.finalRect.left - expandedBaseline.left)).toBeLessThanOrEqual(1);
    expect(Math.abs(opening.finalRect.top - expandedBaseline.top)).toBeLessThanOrEqual(1);
    expect(Math.abs(opening.finalRect.width - expandedBaseline.width)).toBeLessThanOrEqual(1);

    await page.emulateMedia({reducedMotion: 'reduce'});
    const reducedMotionGate = await page.locator('#sidebar_toggle').evaluate((toggle) => {
        const shell = document.querySelector('.app-shell');
        const content = document.querySelector('.style-token-shell');
        toggle.click();
        return {
            animationNames: content?.getAnimations().map((animation) => animation.animationName || '') || [],
            ariaExpanded: toggle.getAttribute('aria-expanded'),
            className: shell?.className || '',
        };
    });
    expect(reducedMotionGate.ariaExpanded).toBe('false');
    expect(reducedMotionGate.className).not.toContain('is-sidebar-animating');
    expect(reducedMotionGate.animationNames.some((name) => String(name).startsWith('workspace-sidebar-gel-'))).toBe(false);

    await page.emulateMedia({reducedMotion: 'no-preference'});
    await page.setViewportSize({width: 390, height: 844});
    await page.evaluate(() => window.sessionStorage.setItem('worthward:sidebar-open', 'true'));
    await page.reload();
    await expect(page.locator('#sidebar_toggle')).toHaveAttribute('aria-expanded', 'true');
    const narrowMotionGate = await page.locator('#sidebar_toggle').evaluate((toggle) => {
        const shell = document.querySelector('.app-shell');
        const content = document.querySelector('.style-token-shell');
        toggle.click();
        return {
            animationNames: content?.getAnimations().map((animation) => animation.animationName || '') || [],
            ariaExpanded: toggle.getAttribute('aria-expanded'),
            className: shell?.className || '',
        };
    });
    expect(narrowMotionGate.ariaExpanded).toBe('false');
    expect(narrowMotionGate.className).not.toContain('is-sidebar-animating');
    expect(narrowMotionGate.animationNames.some((name) => String(name).startsWith('workspace-sidebar-gel-'))).toBe(false);
    await expect.poll(() => page.evaluate(() => (
        document.documentElement.scrollWidth - document.documentElement.clientWidth
    ))).toBeLessThanOrEqual(1);

    await page.setViewportSize({width: 1024, height: 863});
    await page.goto('/trade/investment');
    await expect(page.locator('#investmentEquityChart[data-investment-chart-ready="1"]')).toBeVisible();
    await setSidebarExpanded(page, true);
    await expect(page.locator('.app-shell')).not.toHaveClass(/is-sidebar-animating/);

    const productionMotion = await page.evaluate(async () => {
        const toggle = document.querySelector('#sidebar_toggle');
        const shell = document.querySelector('.app-shell');
        const titleRail = document.querySelector('.investment-workspace-header > .workspace-summary-card');
        const content = document.querySelector('.investment-workspace-header > .trade-performance-card');
        if (!(toggle instanceof HTMLElement)
            || !(shell instanceof HTMLElement)
            || !(titleRail instanceof HTMLElement)
            || !(content instanceof HTMLElement)) {
            return null;
        }

        const frames = [];
        const startedAt = performance.now();
        toggle.click();
        await new Promise((resolve) => {
            const sample = () => {
                const contentRect = content.getBoundingClientRect();
                const titleRect = titleRail.getBoundingClientRect();
                frames.push({
                    animationNames: content.getAnimations().map((animation) => animation.animationName || ''),
                    contentGap: contentRect.top - titleRect.bottom,
                    documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
                    offsetWidth: content.offsetWidth,
                    titleTransform: getComputedStyle(titleRail).transform,
                });
                if (performance.now() - startedAt >= 760) {
                    resolve();
                    return;
                }
                requestAnimationFrame(sample);
            };
            requestAnimationFrame(sample);
        });
        return {
            finalAnimationNames: content.getAnimations().map((animation) => animation.animationName || ''),
            finalClassName: shell.className,
            finalTransform: getComputedStyle(content).transform,
            frames,
        };
    });
    expect(productionMotion).not.toBeNull();
    expect(productionMotion.frames.some((frame) => (
        frame.animationNames.includes('workspace-sidebar-gel-close')
    ))).toBe(true);
    expect(Math.max(...productionMotion.frames.map((frame) => frame.documentOverflow))).toBeLessThanOrEqual(1);
    expect(Math.min(...productionMotion.frames.map((frame) => frame.contentGap))).toBeGreaterThanOrEqual(0);
    expect(
        Math.max(...productionMotion.frames.map((frame) => frame.offsetWidth))
        - Math.min(...productionMotion.frames.map((frame) => frame.offsetWidth)),
    ).toBeLessThanOrEqual(1);
    expect(productionMotion.frames.every((frame) => frame.titleTransform === 'none')).toBe(true);
    expect(productionMotion.finalClassName).not.toContain('is-sidebar-animating');
    expect(productionMotion.finalTransform).toBe('none');
    expect(productionMotion.finalAnimationNames.some((name) => (
        String(name).startsWith('workspace-sidebar-gel-')
    ))).toBe(false);
});

test('keeps the selected segmented pill shadow inside the outer edge', async ({page}) => {
    await mockInvestmentReadApis(page);
    await page.setViewportSize({width: 825, height: 900});
    await page.goto('/trade/investment');

    const segmented = page.locator('#investment_view_segmented');
    await expect(segmented.locator('input[value="chart"]')).toBeChecked();
    await expect.poll(() => segmented.evaluate((element) => (
        getComputedStyle(element, '::before').boxShadow
    ))).toContain('12px 12px 24px -12px');

    await page.locator('label[for="investment_view_holdings"]').click();
    await expect(segmented.locator('input[value="holdings"]')).toBeChecked();
    await expect.poll(() => segmented.evaluate((element) => (
        getComputedStyle(element, '::before').boxShadow
    ))).not.toContain('12px 12px 24px -12px');
});

test('keeps Investment segmented effects un-clipped with concentric edge caps', async ({page}) => {
    await mockInvestmentReadApis(page, {
        transactions: [
            {broker: 'ibkr', date: '2026-07-10', type: 'buy', ticker: 'QQQ', currency: 'USD', quantity: 1, price: 500, amount: -500},
            {broker: 'ibkr', date: '2026-07-11', type: 'sell', ticker: 'QQQ', currency: 'USD', quantity: 1, price: 501, amount: 501},
        ],
        priceHistoryByTicker: {
            QQQ: [
                {date: '2026-07-10', close: 500},
                {date: '2026-07-11', close: 501},
            ],
        },
    });
    await page.setViewportSize({width: 1_024, height: 863});
    await page.goto('/trade/investment?ticker=QQQ');

    const segmented = page.locator('#investment_view_segmented');
    const readCapDelta = (side) => segmented.evaluate((element, requestedSide) => {
        const railRect = element.getBoundingClientRect();
        const thumbStyles = getComputedStyle(element, '::before');
        const matrixParts = (thumbStyles.transform.match(/^matrix\(([^)]+)\)$/)?.[1] || '').split(',');
        const translateX = Number.parseFloat(matrixParts[4]) || 0;
        const thumbLeft = railRect.left
            + (Number.parseFloat(thumbStyles.left) || 0)
            + translateX;
        const thumbWidth = Number.parseFloat(thumbStyles.width) || 0;
        const thumbHeight = railRect.height
            - (Number.parseFloat(thumbStyles.top) || 0)
            - (Number.parseFloat(thumbStyles.bottom) || 0);
        if (requestedSide === 'right') {
            const railCenter = railRect.right - (railRect.height / 2);
            const thumbCenter = thumbLeft + thumbWidth - (thumbHeight / 2);
            return thumbCenter - railCenter;
        }
        const railCenter = railRect.left + (railRect.height / 2);
        const thumbCenter = thumbLeft + (thumbHeight / 2);
        return thumbCenter - railCenter;
    }, side);
    const readLayerGeometry = (controlSelector, stageSelector) => page.evaluate(({controlSelector: controlQuery, stageSelector: stageQuery}) => {
        const control = document.querySelector(controlQuery);
        const shell = control?.closest('.investment-stock-details-range-shell');
        const stage = document.querySelector(stageQuery);
        if (!(control instanceof HTMLElement) || !(shell instanceof HTMLElement) || !(stage instanceof HTMLElement)) return null;
        const controlStyles = getComputedStyle(control);
        const shellStyles = getComputedStyle(shell);
        const stageStyles = getComputedStyle(stage);
        return {
            controlOverflowX: controlStyles.overflowX,
            controlOverflowY: controlStyles.overflowY,
            overflowState: control.dataset.segmentedOverflow,
            shellOverflowX: shellStyles.overflowX,
            shellOverflowY: shellStyles.overflowY,
            shellZIndex: Number.parseFloat(shellStyles.zIndex) || 0,
            stageZIndex: Number.parseFloat(stageStyles.zIndex) || 0,
        };
    }, {controlSelector, stageSelector});

    await expect(segmented).toHaveClass(/is-pill-ready/);
    await expect.poll(() => readCapDelta('left')).toBeCloseTo(0, 2);
    await expect(segmented).toHaveAttribute('data-segmented-overflow', '0');
    await expect.poll(() => segmented.evaluate((element) => getComputedStyle(element).overflowY)).toBe('visible');
    const viewGeometry = await segmented.evaluate((element) => {
        const owner = element.parentElement;
        const controlRect = element.getBoundingClientRect();
        const ownerRect = owner?.getBoundingClientRect();
        const optionWidths = Array.from(element.querySelectorAll('.segmented-control-option'))
            .map((option) => option.getBoundingClientRect().width);
        return {
            centerDelta: ownerRect
                ? Math.abs((controlRect.left + (controlRect.width / 2)) - (ownerRect.left + (ownerRect.width / 2)))
                : Number.POSITIVE_INFINITY,
            compact: ownerRect ? controlRect.width < ownerRect.width - 1 : false,
            optionWidths,
        };
    });
    expect(viewGeometry.compact).toBe(true);
    expect(viewGeometry.centerDelta).toBeLessThanOrEqual(1);
    expect(Math.max(...viewGeometry.optionWidths) - Math.min(...viewGeometry.optionWidths)).toBeLessThanOrEqual(1);

    const overviewRange = page.locator('#investment_equity_chart .investment-stock-details-range-segmented');
    await expect(overviewRange).toHaveClass(/is-pill-ready/);
    await expect(overviewRange).toHaveAttribute('data-segmented-overflow', '0');
    const overviewLayers = await readLayerGeometry(
        '#investment_equity_chart .investment-stock-details-range-segmented',
        '#investment_equity_chart .investment-equity-chart-stage',
    );
    expect(overviewLayers).not.toBeNull();
    expect(overviewLayers).toMatchObject({
        controlOverflowX: 'visible',
        controlOverflowY: 'visible',
        overflowState: '0',
        shellOverflowX: 'visible',
        shellOverflowY: 'visible',
    });
    await expect.poll(() => overviewRange.evaluate((element) => getComputedStyle(element).pointerEvents)).toBe('auto');
    expect(overviewLayers.shellZIndex).toBeGreaterThan(overviewLayers.stageZIndex);

    await page.locator('label[for="investment_view_metrics"]').click();
    await expect(segmented).toHaveAttribute('data-active', 'metrics');
    await expect.poll(() => readCapDelta('right')).toBeCloseTo(0, 2);
    await expect(segmented).toHaveAttribute('data-segmented-overflow', '0');

    await page.locator('label[for="investment_view_stock_details"]').click();
    await expect(page.locator('#stock_panel')).toBeVisible();
    const stockDetailsRange = page.locator('#stock_panel .investment-stock-details-range-segmented');
    await expect(stockDetailsRange).toHaveClass(/is-pill-ready/);
    const overflowWidth = await stockDetailsRange.evaluate((control) => {
        const naturalWidth = Math.max(control.scrollWidth, control.getBoundingClientRect().width);
        return Math.max(1, Math.floor(naturalWidth / 2));
    });
    await page.addStyleTag({
        content: `#stock_panel .investment-stock-details-range-shell { width: ${overflowWidth}px !important; }`,
    });
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    await expect(stockDetailsRange).toHaveAttribute('data-segmented-overflow', '1');
    const segmentedMotherStyle = (selector) => page.locator(selector).evaluate((element) => {
        const computed = getComputedStyle(element);
        const firstOption = element.querySelector('.segmented-control-option');
        return {
            sharedClasses: ['segmented-control', 'segmented-control--compact', 'investment-view-segmented']
                .every((className) => element.classList.contains(className)),
            signature: {
                display: computed.display,
                boxSizing: computed.boxSizing,
                padding: computed.padding,
                gap: computed.gap,
                minHeight: computed.minHeight,
                height: computed.height,
                borderRadius: computed.borderRadius,
                backgroundColor: computed.backgroundColor,
                boxShadow: computed.boxShadow,
                fontSize: computed.fontSize,
                fontWeight: computed.fontWeight,
                lineHeight: computed.lineHeight,
                overflow: computed.overflow,
                pointerEvents: computed.pointerEvents,
            },
            optionShape: firstOption ? {
                tagName: firstOption.tagName,
                className: firstOption.className,
                inputTagName: firstOption.querySelector('input')?.tagName || '',
                labelTagName: firstOption.querySelector('input + span')?.tagName || '',
                nestedLabelCount: firstOption.querySelector('input + span')?.children.length || 0,
            } : null,
        };
    });
    const viewSegmentedMotherStyle = await segmentedMotherStyle('#investment_view_segmented');
    const stockDetailsSegmentedMotherStyle = await segmentedMotherStyle(
        '#stock_panel .investment-stock-details-range-segmented',
    );
    expect(stockDetailsSegmentedMotherStyle.sharedClasses).toBe(true);
    const {overflow: viewOverflow, ...viewSignature} = viewSegmentedMotherStyle.signature;
    const {overflow: stockDetailsOverflow, ...stockDetailsSignature} = stockDetailsSegmentedMotherStyle.signature;
    expect(stockDetailsSignature).toEqual(viewSignature);
    expect(viewOverflow).toBe('visible');
    expect(stockDetailsOverflow).toBe('auto hidden');
    expect(stockDetailsSegmentedMotherStyle.optionShape).toEqual(viewSegmentedMotherStyle.optionShape);
    const stockDetailsLayers = await readLayerGeometry(
        '#stock_panel .investment-stock-details-range-segmented',
        '#stock_panel .investment-stock-details-price-chart-stage',
    );
    expect(stockDetailsLayers).not.toBeNull();
    expect(stockDetailsLayers).toMatchObject({
        controlOverflowX: 'auto',
        controlOverflowY: 'hidden',
        overflowState: '1',
        shellOverflowX: 'visible',
        shellOverflowY: 'visible',
    });
    expect(stockDetailsLayers.shellZIndex).toBeGreaterThan(stockDetailsLayers.stageZIndex);
});

test('keeps visible segmented items equal while future items fade through the shared overflow frame', async ({page}) => {
    await mockInvestmentReadApis(page);
    await page.setViewportSize({width: 1_024, height: 863});
    await page.goto('/trade/investment');

    const segmented = page.locator('#investment_view_segmented');
    const overflowFrame = page.locator('[data-segmented-overflow-frame]:has(#investment_view_segmented)');
    const readOptionWidths = () => segmented.locator('.segmented-control-option').evaluateAll((options) => (
        options.filter((option) => !option.hidden).map((option) => option.getBoundingClientRect().width)
    ));
    const expectEqualWidths = async () => {
        const widths = await readOptionWidths();
        expect(widths.length).toBeGreaterThan(1);
        expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(0.5);
    };

    await expect(segmented).toHaveAttribute('data-segmented-overflow', '0');
    await expect(overflowFrame).toHaveAttribute('data-segmented-overflow', '0');
    await expectEqualWidths();

    await segmented.evaluate((control) => {
        ['Research', 'Income', 'Risk', 'Activity'].forEach((labelText, index) => {
            const label = document.createElement('label');
            const input = document.createElement('input');
            const span = document.createElement('span');
            const optionId = `investment_view_future_${index}`;
            label.className = 'segmented-control-option';
            label.htmlFor = optionId;
            input.id = optionId;
            input.name = 'investment_view_tab';
            input.type = 'radio';
            input.value = `future_${index}`;
            span.textContent = labelText;
            label.append(input, span);
            control.append(label);
        });
    });

    await expect(segmented).toHaveAttribute('data-segmented-overflow', '1');
    await expect(overflowFrame).toHaveAttribute('data-segmented-overflow', '1');
    await expect(overflowFrame).toHaveAttribute('data-overflow-start', '0');
    await expect(overflowFrame).toHaveAttribute('data-overflow-end', '1');
    await expectEqualWidths();
    const overflowGeometry = await overflowFrame.evaluate((frame) => {
        const control = frame.querySelector('#investment_view_segmented');
        const options = Array.from(control?.querySelectorAll('.segmented-control-option') || []);
        const visibleCount = Number.parseInt(frame.dataset.segmentedVisibleCount || '0', 10);
        const frameRect = frame.getBoundingClientRect();
        const previewRect = options[visibleCount]?.getBoundingClientRect();
        const previewIntersection = previewRect
            ? Math.max(0, Math.min(frameRect.right, previewRect.right) - Math.max(frameRect.left, previewRect.left))
            : 0;
        return {
            controlOverflowY: getComputedStyle(control).overflowY,
            frameMask: getComputedStyle(frame).maskImage,
            previewIntersection,
            previewWidth: previewRect?.width || 0,
            visibleCount,
        };
    });
    expect(overflowGeometry.visibleCount).toBeGreaterThanOrEqual(2);
    expect(overflowGeometry.controlOverflowY).toBe('visible');
    expect(overflowGeometry.frameMask).not.toBe('none');
    expect(overflowGeometry.previewIntersection).toBeGreaterThan(8);
    expect(overflowGeometry.previewIntersection).toBeLessThan(overflowGeometry.previewWidth - 8);

    await segmented.evaluate((control) => {
        const options = Array.from(control.querySelectorAll('.segmented-control-option'));
        const lastOption = options.at(-1);
        const lastInput = lastOption?.querySelector('input');
        if (lastInput instanceof HTMLInputElement) lastInput.checked = true;
        window.WORTHWARD_SEGMENTED_CONTROLS?.sync?.(control, {
            activeIndex: options.length - 1,
            options,
        });
    });
    await expect.poll(() => overflowFrame.evaluate((frame) => frame.scrollLeft)).toBeGreaterThan(0);
    await expect(overflowFrame).toHaveAttribute('data-overflow-start', '1');
    await expect(overflowFrame).toHaveAttribute('data-overflow-end', '0');
    await expectEqualWidths();
});

