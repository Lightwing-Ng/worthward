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
test('shows standard names for US-suffixed yfinance fallback profiles', async ({page}) => {
    const expectedNames = {
        AAPL: 'Apple Inc.',
        BOXX: 'Alpha Architect 1-3 Month Box ETF',
        EUV: 'Corgi Lithography & Semiconductor Photonics ETF',
        GOOGL: 'Alphabet Inc.',
        IBKR: 'Interactive Brokers Group, Inc.',
        JEPQ: 'JPMorgan Nasdaq Equity Premium Income ETF',
        META: 'Meta Platforms, Inc.',
        MU: 'Micron Technology, Inc.',
        NVDA: 'NVIDIA Corporation',
        QQQ: 'Invesco QQQ Trust, Series 1',
        QCOM: 'QUALCOMM Incorporated',
        TQQQ: 'ProShares UltraPro QQQ',
        TSM: 'Taiwan Semiconductor Manufacturing Company Limited',
    };
    const tickers = Object.keys(expectedNames);
    await mockInvestmentReadApis(page, {
        transactions: tickers.map((ticker, index) => ({
            ledger_no: index + 1,
            broker: 'ibkr',
            date: '2026-07-21',
            type: 'buy',
            ticker,
            currency: 'USD',
            quantity: 1,
            price: 100 + index,
            amount: -(100 + index),
        })),
        tickerProfiles: Object.fromEntries(tickers.map((ticker) => [ticker, {
            ticker,
            company_name: `${ticker}.US`,
            logo_url: `/market-store/logos/${ticker}.svg`,
        }])),
        knownTickerCompanyNames: Object.fromEntries(tickers.flatMap((ticker) => [
            [ticker, expectedNames[ticker]],
            [`${ticker}.US`, expectedNames[ticker]],
        ])),
    });
    await page.goto('/trade/investment');
    await page.locator('label[for="investment_view_holdings"]').click();

    for (const [ticker, expectedName] of Object.entries(expectedNames)) {
        const holding = page.locator(
            `#investment_holdings_panel:not([hidden]) .investment-holdings-table-scroll tr[data-investment-holdings-ticker="${ticker}"]`,
        );
        await expect(holding.locator('.ticker-identity-name')).toHaveText(expectedName);
        await expect(holding.locator('.ticker-identity-name')).toHaveAttribute('title', expectedName);
    }
});

test('resizes the investment overview and history responsively in portrait layouts', async ({page}) => {
    await mockInvestmentReadApis(page, {
        transactions: [
            {broker: 'ibkr', date: '2026-07-10', type: 'buy', ticker: 'QQQ', currency: 'USD', quantity: 1, price: 500, amount: -500},
            {broker: 'ibkr', date: '2026-07-11', type: 'buy', ticker: 'QQQ', currency: 'USD', quantity: 1, price: 501, amount: -501},
            {broker: 'ibkr', date: '2026-07-12', type: 'buy', ticker: 'QQQ', currency: 'USD', quantity: 1, price: 502, amount: -502},
            {broker: 'ibkr', date: '2026-07-13', type: 'buy', ticker: 'QQQ', currency: 'USD', quantity: 1, price: 503, amount: -503},
            {broker: 'ibkr', date: '2026-07-14', type: 'buy', ticker: 'QQQ', currency: 'USD', quantity: 1, price: 504, amount: -504},
        ],
        priceHistoryByTicker: {
            QQQ: [
                {date: '2026-07-10', close: 500},
                {date: '2026-07-11', close: 501},
                {date: '2026-07-12', close: 502},
                {date: '2026-07-13', close: 503},
                {date: '2026-07-14', close: 504},
            ],
        },
    });
    await page.setViewportSize({width: 825, height: 900});
    await page.goto('/trade/investment');
    await expect.poll(() => page.evaluate(() => (
        Boolean(window.WORTHWARD_INVESTMENT_DATA)
        && document.querySelector('#workspace_modal_overlay')?.hidden === true
    )), {timeout: 30000}).toBe(true);

    const handle = page.locator('#investment_section_resizer');
    const overview = page.locator('.investment-report-card');
    const history = page.locator('#investment_history_surface');
    await expect(handle).toBeVisible();

    const overviewSpacing = await overview.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
            paddingTop: style.paddingTop,
            paddingRight: style.paddingRight,
            paddingBottom: style.paddingBottom,
            paddingLeft: style.paddingLeft,
            rowGap: style.rowGap,
            columnGap: style.columnGap,
        };
    });
    expect(overviewSpacing).toEqual({
        paddingTop: '0px',
        paddingRight: '4px',
        paddingBottom: '0px',
        paddingLeft: '4px',
        rowGap: '4px',
        columnGap: '4px',
    });

    const resizerGeometry = await handle.evaluate((element) => ({
        fontSize: getComputedStyle(element).fontSize,
        height: element.getBoundingClientRect().height,
        lineHeight: getComputedStyle(element, '::before').height,
    }));
    expect(resizerGeometry.fontSize).toBe('12px');
    expect(resizerGeometry.height).toBe(10);
    expect(resizerGeometry.lineHeight).toBe('1px');

    const hiddenOpacity = await handle.evaluate((element) => getComputedStyle(element, '::after').opacity);
    expect(hiddenOpacity).toBe('0');
    await handle.hover();
    await expect.poll(() => handle.evaluate((element) => getComputedStyle(element, '::after').opacity)).toBe('1');

    const beforeHeight = await overview.evaluate((element) => element.getBoundingClientRect().height);
    const defaultAllocation = await page.evaluate(() => {
        const workspace = document.querySelector('.investment-workspace-header');
        const overviewSurface = document.querySelector('.investment-report-card');
        const historySurface = document.querySelector('#investment_history_surface');
        const overviewHeight = overviewSurface.getBoundingClientRect().height;
        const historyHeight = historySurface.getBoundingClientRect().height;
        return {
            defaultOverviewShare: getComputedStyle(workspace).getPropertyValue('--investment-default-overview-share').trim(),
            overviewShare: overviewHeight / (overviewHeight + historyHeight),
        };
    });
    expect(defaultAllocation.defaultOverviewShare).toBe('0.5');
    expect(defaultAllocation.overviewShare).toBeGreaterThanOrEqual(0.45);
    const handleBox = await handle.boundingBox();
    await page.mouse.move(handleBox.x + (handleBox.width / 2), handleBox.y + (handleBox.height / 2));
    await page.mouse.down();
    await page.mouse.move(handleBox.x + (handleBox.width / 2), handleBox.y + (handleBox.height / 2) - 40);
    await page.mouse.up();
    const draggedHeight = await overview.evaluate((element) => element.getBoundingClientRect().height);
    expect(draggedHeight).toBeLessThan(beforeHeight);

    await handle.focus();
    await handle.press('ArrowDown');
    const afterHeight = await overview.evaluate((element) => element.getBoundingClientRect().height);
    expect(afterHeight).toBeGreaterThan(draggedHeight);
    await expect(handle).toHaveAttribute('aria-valuenow', /\d+/);

    await page.setViewportSize({width: 922, height: 773});
    await handle.press('Home');
    await expect.poll(() => page.evaluate(() => {
        const stage = document.querySelector('.investment-equity-chart-stage');
        const canvas = document.querySelector('#investmentEquityChart');
        const stageMinimum = Number.parseFloat(getComputedStyle(stage).minHeight);
        return (
            canvas.getBoundingClientRect().height >= stageMinimum - 1
            && stage.getBoundingClientRect().height >= stageMinimum - 1
        );
    })).toBe(true);
    const overviewLimitGeometry = await page.evaluate(() => {
        const stage = document.querySelector('.investment-equity-chart-stage');
        const canvas = document.querySelector('#investmentEquityChart');
        return {
            canvasHeight: canvas.getBoundingClientRect().height,
            stageHeight: stage.getBoundingClientRect().height,
            stageMinimum: Number.parseFloat(getComputedStyle(stage).minHeight),
        };
    });
    expect(overviewLimitGeometry.stageHeight).toBeGreaterThanOrEqual(overviewLimitGeometry.stageMinimum - 1);
    expect(overviewLimitGeometry.canvasHeight).toBeGreaterThanOrEqual(overviewLimitGeometry.stageMinimum - 1);

    await handle.press('End');
    const historyLimitGeometry = await page.evaluate(() => {
        const shell = document.querySelector('#history_table_wrap').getBoundingClientRect();
        const header = document.querySelector('#history_table_wrap [data-table-header]').getBoundingClientRect();
        const rows = Array.from(document.querySelectorAll('#investment_history > tr:not([data-table-empty-row])'))
            .slice(0, 2)
            .map((row) => {
                const rect = row.getBoundingClientRect();
                return {top: rect.top, bottom: rect.bottom, height: rect.height};
            });
        return {shellBottom: shell.bottom, headerBottom: header.bottom, rows};
    });
    expect(historyLimitGeometry.rows).toHaveLength(2);
    expect(historyLimitGeometry.rows[0].top).toBeGreaterThanOrEqual(historyLimitGeometry.headerBottom - 1);
    expect(historyLimitGeometry.rows[1].bottom).toBeLessThanOrEqual(historyLimitGeometry.shellBottom + 1);

    await page.locator('label[for="investment_view_stock_details"]').click();
    await expect(page.locator('#investment_stock_details_table_host')).toBeVisible();
    await expect(page.locator('.investment-stock-details-price-chart-canvas')).toBeVisible();
    await page.setViewportSize({width: 922, height: 1080});
    await handle.press('End');
    const stockDetailsGeometry = await page.evaluate(() => (
        Array.from(document.querySelectorAll('#investment_history_surface .investment-history-table-shell'))
            .filter((shell) => shell instanceof HTMLElement && shell.getClientRects().length > 0)
            .map((shell) => {
                const shellRect = shell.getBoundingClientRect();
                const header = shell.querySelector('[data-table-header]')?.getBoundingClientRect();
                const rows = Array.from(shell.querySelectorAll('tbody > tr:not([data-table-empty-row])'))
                    .slice(0, 2)
                    .map((row) => row.getBoundingClientRect());
                return {
                    shellBottom: shellRect.bottom,
                    headerBottom: header?.bottom || 0,
                    rows: rows.map((row) => ({top: row.top, bottom: row.bottom})),
                };
            })
    ));
    expect(await page.locator('#history_table_wrap')).toBeHidden();
    expect(stockDetailsGeometry).toHaveLength(1);
    stockDetailsGeometry.forEach((table) => {
        expect(table.rows).toHaveLength(2);
        expect(table.rows[0].top).toBeGreaterThanOrEqual(table.headerBottom - 1);
        expect(table.rows[1].bottom).toBeLessThanOrEqual(table.shellBottom + 1);
    });

    const stockChartGeometry = await page.evaluate(() => {
        const shell = document.querySelector('.investment-stock-details-price-chart-shell');
        const canvas = document.querySelector('.investment-stock-details-price-chart-canvas');
        canvas.style.height = '80px';
        return {
            shellHeight: shell.getBoundingClientRect().height,
            canvasHeight: canvas.getBoundingClientRect().height,
            shellBottom: shell.getBoundingClientRect().bottom,
            canvasBottom: canvas.getBoundingClientRect().bottom,
        };
    });
    expect(stockChartGeometry.canvasHeight).toBeGreaterThan(80);
    expect(Math.abs(stockChartGeometry.canvasHeight - stockChartGeometry.shellHeight)).toBeLessThanOrEqual(1);
    expect(Math.abs(stockChartGeometry.canvasBottom - stockChartGeometry.shellBottom)).toBeLessThanOrEqual(1);

    await page.locator('label[for="investment_view_holdings"]').click();
    await expect(page.locator('#investment_holdings_panel')).toBeVisible();
    await handle.focus();
    await handle.press('Home');
    await expect.poll(() => page.evaluate(() => {
        const shell = document.querySelector('#investment_holdings_panel .investment-holdings-table-shell');
        const header = shell?.querySelector('[data-table-header]');
        const firstRow = shell?.querySelector(
            '.investment-holdings-table-scroll tbody > tr[data-investment-holdings-ticker]',
        );
        if (!shell || !header || !firstRow) return false;
        const shellRect = shell.getBoundingClientRect();
        const headerRect = header.getBoundingClientRect();
        const firstRowRect = firstRow.getBoundingClientRect();
        return (
            firstRowRect.top >= headerRect.bottom - 1
            && firstRowRect.bottom <= shellRect.bottom + 1
        );
    })).toBe(true);
    const responsiveGeometry = await page.evaluate(() => {
        const workspace = document.querySelector('.investment-workspace-header').getBoundingClientRect();
        const overviewSurface = document.querySelector('.investment-report-card').getBoundingClientRect();
        const historySurface = document.querySelector('#investment_history_surface').getBoundingClientRect();
        const historyTable = document.querySelector('#history_table_wrap').getBoundingClientRect();
        return {
            workspaceBottom: workspace.bottom,
            overviewHeight: overviewSurface.height,
            historyBottom: historySurface.bottom,
            historyHeight: historySurface.height,
            historyTableHeight: historyTable.height,
            viewportHeight: window.innerHeight,
        };
    });
    expect(responsiveGeometry.overviewHeight).toBeGreaterThanOrEqual(148);
    expect(responsiveGeometry.historyHeight).toBeGreaterThanOrEqual(148);
    expect(responsiveGeometry.historyTableHeight).toBeGreaterThan(48);
    expect(responsiveGeometry.historyBottom).toBeLessThanOrEqual(
        Math.min(responsiveGeometry.workspaceBottom, responsiveGeometry.viewportHeight) + 1,
    );
});

test('keeps investment pagination visible at the lower resize limit', async ({page}) => {
    const transactions = Array.from({length: 105}, (_, index) => {
        const price = 350 + index;
        const isSell = index % 3 === 2;
        return {
            broker: 'ibkr',
            date: '2026-07-10',
            type: isSell ? 'sell' : 'buy',
            ticker: 'GOOGL',
            currency: 'USD',
            quantity: 1,
            price,
            amount: isSell ? price : -price,
        };
    });
    await mockInvestmentReadApis(page, {
        transactions,
        priceHistoryByTicker: {
            GOOGL: [
                {date: '2026-07-06', close: 346},
                {date: '2026-07-07', close: 350},
                {date: '2026-07-08', close: 354},
                {date: '2026-07-09', close: 352},
                {date: '2026-07-10', close: 356},
            ],
        },
    });
    await page.setViewportSize({width: 1024, height: 863});
    await page.goto('/trade/investment?ticker=GOOGL#stock_panel');
    await page.locator('#sidebar_toggle').click();
    await expect(page.locator('#sidebar_toggle')).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('.investment-stock-details-price-chart-canvas')).toBeVisible();
    await expect(page.locator('[data-investment-history-page-target="2"]')).toBeVisible();

    const resizer = page.locator('#investment_section_resizer');
    const resizerBox = await resizer.boundingBox();
    expect(resizerBox).not.toBeNull();
    await page.mouse.move(
        resizerBox.x + (resizerBox.width / 2),
        resizerBox.y + (resizerBox.height / 2),
    );
    await page.mouse.down();
    await page.mouse.move(
        resizerBox.x + (resizerBox.width / 2),
        page.viewportSize().height + 200,
    );
    await page.mouse.up();
    const geometry = await page.evaluate(() => {
        const surface = document.querySelector('#investment_history_surface');
        const pagination = document.querySelector('#investment_history_pagination');
        const paginationHost = document.querySelector('#investment_stock_details_table_host .investment-stock-details-table-shell');
        const paginationScroll = document.querySelector('#investment_stock_details_table_scroll');
        const historyTable = document.querySelector('#history_table_wrap');
        const resizerHandle = document.querySelector('#investment_section_resizer');
        const surfaceRect = surface.getBoundingClientRect();
        const paginationRect = pagination.getBoundingClientRect();
        const surfaceStyles = getComputedStyle(surface);
        const tables = Array.from(surface.querySelectorAll('.investment-history-table-shell'))
            .filter((shell) => shell instanceof HTMLElement && shell.getClientRects().length > 0)
            .map((shell) => {
                const shellRect = shell.getBoundingClientRect();
                const headerRect = shell.querySelector('[data-table-header]').getBoundingClientRect();
                const rows = Array.from(shell.querySelectorAll('tbody > tr:not([data-table-empty-row])'))
                    .slice(0, 2)
                    .map((row) => row.getBoundingClientRect());
                return {
                    isPaginationHost: shell === paginationHost,
                    shellTop: shellRect.top,
                    shellBottom: shellRect.bottom,
                    headerBottom: headerRect.bottom,
                    rows: rows.map((row) => ({top: row.top, bottom: row.bottom})),
                };
            });
        return {
            surfaceBottom: surfaceRect.bottom,
            contentBottom: surfaceRect.bottom - (Number.parseFloat(surfaceStyles.paddingBottom) || 0),
            paginationTop: paginationRect.top,
            paginationBottom: paginationRect.bottom,
            paginationVisible: !pagination.hidden && paginationRect.height > 0,
            paginationMounted: pagination.parentElement === paginationHost
                && pagination.dataset.paginationMounted === '1',
            historyTableHidden: historyTable.hidden,
            paginationControls: pagination.getAttribute('aria-controls'),
            paginationScrollTarget: pagination.dataset.paginationScrollTarget,
            paginationPosition: getComputedStyle(pagination).position,
            paginationBackdrop: getComputedStyle(pagination).backdropFilter,
            paginationHostOverflow: getComputedStyle(paginationHost).overflow,
            historySurfaceOverflow: getComputedStyle(surface).overflow,
            paginationScrollOverflowX: getComputedStyle(paginationScroll).overflowX,
            paginationScrollOverflowY: getComputedStyle(paginationScroll).overflowY,
            paginationIndicatorShadow: getComputedStyle(
                pagination.querySelector('.local-store-pagination-indicator'),
            ).boxShadow,
            scrollPaddingBottom: Number.parseFloat(getComputedStyle(paginationScroll).scrollPaddingBottom) || 0,
            surfacePaddingTop: Number.parseFloat(surfaceStyles.paddingTop) || 0,
            surfacePaddingBottom: Number.parseFloat(surfaceStyles.paddingBottom) || 0,
            inlineSurfacePaddingBottom: surface.style.paddingBottom,
            tableMarginBottom: Number.parseFloat(getComputedStyle(
                paginationScroll.querySelector('.investment-history-table'),
            ).marginBottom) || 0,
            resizerNow: Number(resizerHandle.getAttribute('aria-valuenow')),
            resizerMaximum: Number(resizerHandle.getAttribute('aria-valuemax')),
            tables,
        };
    });

    expect(geometry.paginationVisible).toBe(true);
    expect(geometry.paginationMounted).toBe(true);
    expect(geometry.historyTableHidden).toBe(true);
    expect(geometry.paginationControls).toBe('investment_stock_details');
    expect(geometry.paginationScrollTarget).toBe('investment_stock_details_table_scroll');
    expect(geometry.paginationPosition).toBe('absolute');
    expect(geometry.paginationBackdrop).not.toBe('none');
    expect(geometry.paginationHostOverflow).toBe('visible');
    expect(geometry.historySurfaceOverflow).toBe('visible');
    expect(geometry.paginationScrollOverflowX).toBe('auto');
    expect(geometry.paginationScrollOverflowY).toBe('auto');
    expect(geometry.paginationIndicatorShadow).not.toBe('none');
    expect(geometry.scrollPaddingBottom).toBeGreaterThan(geometry.paginationBottom - geometry.paginationTop);
    expect(geometry.surfacePaddingBottom).toBe(geometry.surfacePaddingTop);
    expect(geometry.inlineSurfacePaddingBottom).toBe('');
    expect(geometry.tableMarginBottom).toBe(0);
    expect(geometry.resizerNow).toBe(geometry.resizerMaximum);
    expect(geometry.paginationBottom).toBeLessThanOrEqual(geometry.contentBottom + 1);
    expect(geometry.paginationBottom).toBeLessThanOrEqual(geometry.surfaceBottom + 1);
    expect(geometry.tables).toHaveLength(1);
    geometry.tables.forEach((table) => {
        expect(table.rows).toHaveLength(2);
        expect(table.rows[0].top).toBeGreaterThanOrEqual(table.headerBottom - 1);
        expect(table.rows[1].bottom).toBeLessThanOrEqual(table.shellBottom + 1);
        if (table.isPaginationHost) {
            expect(geometry.paginationTop).toBeLessThan(table.shellBottom);
            expect(geometry.paginationBottom).toBeLessThanOrEqual(table.shellBottom + 1);
        } else {
            expect(table.shellBottom).toBeLessThanOrEqual(
                geometry.tables.find((candidate) => candidate.isPaginationHost).shellTop + 1,
            );
        }
    });

    const glassScrollContract = await page.evaluate(() => {
        const pagination = document.querySelector('#investment_history_pagination');
        const scroll = document.querySelector('#investment_stock_details_table_scroll');
        const rows = Array.from(scroll.querySelectorAll('#investment_stock_details > tr'));
        scroll.scrollTop = Math.max(1, (scroll.scrollHeight - scroll.clientHeight) / 2);
        const paginationRect = pagination.getBoundingClientRect();
        const rowBehindGlass = rows.some((row) => {
            const rowRect = row.getBoundingClientRect();
            return rowRect.top < paginationRect.bottom && rowRect.bottom > paginationRect.top;
        });
        scroll.scrollTop = scroll.scrollHeight;
        const table = scroll.querySelector('.investment-history-table');
        const scrollRect = scroll.getBoundingClientRect();
        const lastRowRect = rows.at(-1).getBoundingClientRect();
        const finalPaginationRect = pagination.getBoundingClientRect();
        const tailSpacerHeight = Number.parseFloat(getComputedStyle(scroll, '::after').height) || 0;
        return {
            rowBehindGlass,
            tableTailClearance: scroll.scrollHeight - table.offsetHeight,
            tailSpacerHeight,
            gapAbovePagination: finalPaginationRect.top - lastRowRect.bottom,
            gapBelowPagination: scrollRect.bottom - finalPaginationRect.bottom,
        };
    });
    expect(glassScrollContract.rowBehindGlass).toBe(true);
    expect(glassScrollContract.tailSpacerHeight).toBeGreaterThan(0);
    expect(Math.abs(
        glassScrollContract.tableTailClearance - glassScrollContract.tailSpacerHeight,
    )).toBeLessThanOrEqual(1);
    expect(glassScrollContract.gapAbovePagination).toBeGreaterThan(0);
    expect(Math.abs(
        glassScrollContract.gapAbovePagination - glassScrollContract.gapBelowPagination,
    )).toBeLessThanOrEqual(1);

    const pageTwoButton = page.locator('[data-investment-history-page-target="2"]');
    await expect(pageTwoButton).toBeVisible();
    await pageTwoButton.click();
    await expect(pageTwoButton).toHaveAttribute('aria-current', 'page');
    await expect.poll(() => page.locator('#investment_stock_details_table_scroll').evaluate((scroll) => scroll.scrollTop)).toBe(0);

    await page.setViewportSize({width: 751, height: 762});
    await expect.poll(() => page.locator('#investment_history_surface').evaluate((surface) => {
        const styles = getComputedStyle(surface);
        return {
            bottom: Number.parseFloat(styles.paddingBottom) || 0,
            inlineBottom: surface.style.paddingBottom,
            top: Number.parseFloat(styles.paddingTop) || 0,
        };
    })).toEqual({bottom: 10, inlineBottom: '', top: 10});
});

test('omits investment pagination when transaction history fits on one page', async ({page}) => {
    const transactions = Array.from({length: 100}, (_, index) => ({
        ledger_no: index + 1,
        broker: 'ibkr',
        date: '2026-07-10',
        type: index === 0 ? 'kol_reward' : 'credit_interest',
        currency: 'USD',
        amount: 1,
        description: index === 0 ? 'KOL Rewards' : `Interest ${index + 1}`,
    }));
    await mockInvestmentReadApis(page, {transactions});
    await page.goto('/trade/investment');

    const pagination = page.locator('#investment_history_pagination');
    await expect(pagination).toBeHidden();
    await expect(pagination.locator('button')).toHaveCount(0);
    await expect(page.locator('#history_table_wrap')).not.toHaveClass(/has-floating-pagination/);
    await expect(page.getByText('KOL Reward', {exact: true}).first()).toBeVisible();
    await expect(page.getByText('KOL Rewards', {exact: true}).first()).toBeVisible();
});

test('keeps compact investment page circles concentric and labels centered', async ({page}) => {
    const transactions = Array.from({length: 401}, (_, index) => ({
        ledger_no: index + 1,
        broker: 'ibkr',
        date: '2026-07-10',
        type: 'credit_interest',
        currency: 'USD',
        amount: 1,
        description: `Interest ${index + 1}`,
    }));
    await mockInvestmentReadApis(page, {transactions});
    await page.setViewportSize({width: 620, height: 900});
    await page.goto('/trade/investment');

    const pagination = page.locator('#investment_history_pagination');
    await expect(pagination).toBeVisible();
    await expect(pagination).toHaveAttribute('data-pagination-page-count', '5');
    await expect(pagination).toHaveAttribute('data-pagination-compact', '1');
    await expect(pagination.locator('button')).toHaveCount(5);
    await expect(pagination.locator('.local-store-page-nav')).toHaveCount(0);
    await expect(pagination.locator('.local-store-page-ellipsis')).toHaveCount(0);

    const geometry = await pagination.evaluate((nav) => {
        const buttons = Array.from(nav.querySelectorAll('.local-store-page-button'));
        const navRect = nav.getBoundingClientRect();
        const firstRect = buttons[0].getBoundingClientRect();
        const lastRect = buttons.at(-1).getBoundingClientRect();
        const outerRadius = navRect.height / 2;
        const centerX = (rect) => rect.left + (rect.width / 2);
        const centerY = (rect) => rect.top + (rect.height / 2);
        const labelCenterDeltas = buttons.map((button) => {
            const textNode = button.firstChild;
            const range = document.createRange();
            range.selectNodeContents(textNode);
            const textRect = range.getBoundingClientRect();
            const buttonRect = button.getBoundingClientRect();
            return Math.abs(centerX(textRect) - centerX(buttonRect));
        });
        return {
            leftCenterDelta: Math.max(
                Math.abs(centerX(firstRect) - (navRect.left + outerRadius)),
                Math.abs(centerY(firstRect) - (navRect.top + outerRadius)),
            ),
            rightCenterDelta: Math.max(
                Math.abs(centerX(lastRect) - (navRect.right - outerRadius)),
                Math.abs(centerY(lastRect) - (navRect.top + outerRadius)),
            ),
            maximumLabelCenterDelta: Math.max(...labelCenterDeltas),
        };
    });
    expect(geometry.leftCenterDelta).toBeLessThanOrEqual(0.25);
    expect(geometry.rightCenterDelta).toBeLessThanOrEqual(0.25);
    expect(geometry.maximumLabelCenterDelta).toBeLessThanOrEqual(0.5);
});

test('keeps Local market store pagination aligned with the Investment pagination contract', async ({page}) => {
    const transactions = Array.from({length: 101}, (_, index) => ({
        ledger_no: index + 1,
        broker: 'ibkr',
        date: '2026-07-10',
        type: 'credit_interest',
        currency: 'USD',
        amount: 1,
        description: `Interest ${index + 1}`,
    }));
    await mockInvestmentReadApis(page, {transactions});
    await page.setViewportSize({width: 1_280, height: 900});

    const readPaginationContract = (pagination) => pagination.evaluate((nav) => {
        const pageControls = Array.from(nav.querySelectorAll(
            '.local-store-page-button:not(.local-store-page-nav):not(.local-store-page-placeholder)',
        ));
        const active = nav.querySelector('.local-store-page-button[aria-current="page"]');
        const inactive = pageControls.find((control) => control !== active);
        const indicator = nav.querySelector('.local-store-pagination-indicator');
        if (!(active instanceof HTMLElement)
            || !(inactive instanceof HTMLElement)
            || !(indicator instanceof HTMLElement)) {
            throw new Error('Pagination controls or active indicator are incomplete.');
        }

        const readStyle = (element, properties) => {
            const styles = getComputedStyle(element);
            return Object.fromEntries(properties.map((property) => [property, styles[property]]));
        };
        const navRect = nav.getBoundingClientRect();
        const hostRect = nav.parentElement.getBoundingClientRect();
        const activeRect = active.getBoundingClientRect();
        const inactiveRect = inactive.getBoundingClientRect();
        const indicatorRect = indicator.getBoundingClientRect();

        return {
            commonClasses: [
                'settings-pagination',
                'local-store-pagination',
                'local-store-pagination--floating',
            ].filter((className) => nav.classList.contains(className)),
            pageCount: nav.dataset.paginationPageCount || '',
            currentPage: nav.dataset.paginationCurrentPage || '',
            compact: nav.dataset.paginationCompact || '',
            semanticTargets: {
                controlledBodyExists: Boolean(document.getElementById(nav.getAttribute('aria-controls') || '')),
                scrollTargetExists: Boolean(document.getElementById(nav.dataset.paginationScrollTarget || '')),
            },
            controls: pageControls.map((control) => ({
                label: control.getAttribute('aria-label'),
                page: control.textContent.trim(),
                target: control.getAttribute('data-pagination-target'),
                current: control.getAttribute('data-pagination-current'),
                ariaCurrent: control.getAttribute('aria-current'),
            })),
            navigationControlCount: nav.querySelectorAll('.local-store-page-nav').length,
            placeholderCount: nav.querySelectorAll('.local-store-page-placeholder').length,
            ellipsisCount: nav.querySelectorAll('.local-store-page-ellipsis').length,
            presentation: {
                nav: readStyle(nav, [
                    'alignItems',
                    'backdropFilter',
                    'backgroundColor',
                    'borderRadius',
                    'boxShadow',
                    'display',
                    'gap',
                    'justifyContent',
                    'paddingBottom',
                    'paddingLeft',
                    'paddingRight',
                    'paddingTop',
                    'pointerEvents',
                    'position',
                ]),
                inactiveControl: readStyle(inactive, [
                    'alignItems',
                    'backdropFilter',
                    'backgroundColor',
                    'borderRadius',
                    'borderTopColor',
                    'borderTopStyle',
                    'borderTopWidth',
                    'boxShadow',
                    'boxSizing',
                    'color',
                    'display',
                    'fontFamily',
                    'fontSize',
                    'fontWeight',
                    'justifyContent',
                    'lineHeight',
                ]),
                indicator: readStyle(indicator, [
                    'backgroundColor',
                    'borderRadius',
                    'boxShadow',
                    'opacity',
                    'position',
                ]),
            },
            geometry: {
                activeHeight: activeRect.height,
                activeWidth: activeRect.width,
                controlGap: inactiveRect.left - activeRect.right,
                hostCenterDelta: Math.abs(
                    ((navRect.left + navRect.right) / 2)
                    - ((hostRect.left + hostRect.right) / 2),
                ),
                indicatorDelta: Math.max(
                    Math.abs(activeRect.left - indicatorRect.left),
                    Math.abs(activeRect.top - indicatorRect.top),
                    Math.abs(activeRect.width - indicatorRect.width),
                    Math.abs(activeRect.height - indicatorRect.height),
                ),
                navHeight: navRect.height,
                navWidth: navRect.width,
                outerInsetLeft: activeRect.left - navRect.left,
                outerInsetRight: navRect.right - inactiveRect.right,
            },
        };
    });
    const expectCanonicalTwoPageControls = (contract) => {
        expect(contract.commonClasses).toEqual([
            'settings-pagination',
            'local-store-pagination',
            'local-store-pagination--floating',
        ]);
        expect(contract.pageCount).toBe('2');
        expect(contract.currentPage).toBe('1');
        expect(contract.compact).toBe('1');
        expect(contract.semanticTargets).toEqual({
            controlledBodyExists: true,
            scrollTargetExists: true,
        });
        expect(contract.controls).toEqual([
            {
                label: 'Page 1',
                page: '1',
                target: '1',
                current: '1',
                ariaCurrent: 'page',
            },
            {
                label: 'Page 2',
                page: '2',
                target: '2',
                current: '0',
                ariaCurrent: null,
            },
        ]);
        expect(contract.navigationControlCount).toBe(0);
        expect(contract.placeholderCount).toBe(0);
        expect(contract.ellipsisCount).toBe(0);
        expect(contract.geometry.hostCenterDelta).toBeLessThanOrEqual(1);
        expect(contract.geometry.indicatorDelta).toBeLessThanOrEqual(1);
    };
    const expectNear = (first, second) => {
        expect(Math.abs(first - second)).toBeLessThanOrEqual(1);
    };

    await page.goto('/settings/local-market-store?page=999');
    await expect(page).toHaveURL(/\/settings\/local-market-store\?page=2$/);
    await page.goto('/settings/local-market-store');
    const settingsPagination = page.locator('[data-local-store-pagination]');
    await expect(settingsPagination).toBeVisible();
    await expect(settingsPagination).toHaveAttribute('data-pagination-page-count', '2');
    await expect(settingsPagination.locator('.local-store-pagination-indicator')).toHaveCSS('opacity', '1');
    const settingsContract = await readPaginationContract(settingsPagination);
    expectCanonicalTwoPageControls(settingsContract);

    await settingsPagination.locator('[data-pagination-target="2"]').click();
    await expect(page).toHaveURL(/\/settings\/local-market-store\?page=2$/);
    await expect(page.locator(
        '[data-local-store-pagination] [data-pagination-target="2"]',
    )).toHaveAttribute('aria-current', 'page');
    await expect(page.locator(
        '#local_store_region .local-store-table-wrap tbody .local-store-index-cell',
    )).toHaveText(['11', '12', '13', '14', '15', '16', '17']);

    await page.goBack();
    await expect(page).toHaveURL(/\/settings\/local-market-store$/);
    await expect(page.locator(
        '[data-local-store-pagination] [data-pagination-target="1"]',
    )).toHaveAttribute('aria-current', 'page');
    await expect(page.locator(
        '#local_store_region .local-store-table-wrap tbody .local-store-index-cell',
    )).toHaveText(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);

    await page.goForward();
    await expect(page).toHaveURL(/\/settings\/local-market-store\?page=2$/);
    await expect(page.locator(
        '[data-local-store-pagination] [data-pagination-target="2"]',
    )).toHaveAttribute('aria-current', 'page');
    await expect(page.locator(
        '#local_store_region .local-store-table-wrap tbody .local-store-index-cell',
    )).toHaveText(['11', '12', '13', '14', '15', '16', '17']);

    await page.mouse.move(0, 0);
    await page.goto('/trade/investment');
    const investmentPagination = page.locator('#investment_history_pagination');
    await expect(investmentPagination).toBeVisible();
    await expect(investmentPagination).toHaveAttribute('data-pagination-page-count', '2');
    await expect(investmentPagination.locator('.local-store-pagination-indicator')).toHaveCSS('opacity', '1');
    const investmentContract = await readPaginationContract(investmentPagination);
    expectCanonicalTwoPageControls(investmentContract);

    expect(settingsContract.presentation).toEqual(investmentContract.presentation);
    for (const key of [
        'activeHeight',
        'activeWidth',
        'controlGap',
        'navHeight',
        'navWidth',
        'outerInsetLeft',
        'outerInsetRight',
    ]) {
        expectNear(settingsContract.geometry[key], investmentContract.geometry[key]);
    }

    await investmentPagination.locator('[data-pagination-target="2"]').click();
    await expect(investmentPagination.locator(
        '[data-pagination-target="2"]',
    )).toHaveAttribute('aria-current', 'page');
    await expect(page.locator(
        '#investment_history > tr:not([data-table-empty-row])',
    )).toHaveCount(1);
});

test('renders fixed investment pagination chunks centered and legible in dark mode', async ({page}) => {
    const transactions = Array.from({length: 5_001}, (_, index) => ({
        ledger_no: index + 1,
        broker: 'ibkr',
        date: '2026-07-10',
        type: 'credit_interest',
        currency: 'USD',
        amount: 1,
        description: `Interest ${index + 1}`,
    }));
    await mockInvestmentReadApis(page, {transactions});
    await page.emulateMedia({colorScheme: 'dark'});
    await page.setViewportSize({width: 620, height: 900});
    await page.goto('/trade/investment');

    const pagination = page.locator('#investment_history_pagination');
    const pageFive = page.getByRole('button', {name: 'Page 5', exact: true});
    const nextPage = page.getByRole('button', {name: 'Next page', exact: true});
    await expect(pagination).toBeVisible();
    await expect(pageFive).toBeVisible();
    await expect(nextPage).toBeVisible();
    await expect(pagination.locator('[data-pagination-ellipsis="trailing"]')).toHaveCount(1);
    await expect(page.getByRole('button', {name: 'Previous page', exact: true})).toHaveCount(0);
    await expect(page.getByRole('button', {name: 'Page 51', exact: true})).toBeVisible();

    const trailingRangeTrigger = page.getByRole('button', {name: 'Show later pages', exact: true});
    const trailingRangeMenu = pagination.locator(
        '[data-pagination-ellipsis="trailing"] [data-pagination-range-menu]',
    );
    await trailingRangeTrigger.click();
    await expect(trailingRangeTrigger).toHaveAttribute('aria-expanded', 'true');
    await expect(trailingRangeMenu).toBeVisible();
    await expect(trailingRangeMenu.getByRole('menuitem')).toHaveCount(9);
    await expect(trailingRangeMenu.getByRole('menuitem', {
        name: 'Pages 6 through 10',
        exact: true,
    })).toBeVisible();
    await expect(trailingRangeMenu.getByRole('menuitem', {
        name: 'Pages 46 through 51',
        exact: true,
    })).toBeVisible();
    await trailingRangeTrigger.press('ArrowDown');
    await expect(trailingRangeMenu.getByRole('menuitem').first()).toBeFocused();
    await trailingRangeMenu.getByRole('menuitem').first().press('End');
    await expect(trailingRangeMenu.getByRole('menuitem').last()).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(trailingRangeTrigger).toBeFocused();
    await expect(trailingRangeTrigger).toHaveAttribute('aria-expanded', 'false');
    await expect(trailingRangeMenu).toBeHidden();

    await page.setViewportSize({width: 978, height: 863});
    await setSidebarExpanded(page, true);
    await expect(page.locator('.app-shell')).toHaveClass(/is-sidebar-open/);
    const readDockCenterDelta = () => page.evaluate(() => {
        const paginationRect = document.querySelector('#investment_history_pagination').getBoundingClientRect();
        const dockRect = document.querySelector('nav[aria-label="Workspace modes"]').getBoundingClientRect();
        return Math.abs(
            ((paginationRect.top + paginationRect.bottom) / 2)
            - ((dockRect.top + dockRect.bottom) / 2),
        );
    });
    await page.waitForFunction(() => !document.querySelector('.app-shell')?.classList.contains('is-sidebar-animating'));
    await expect.poll(readDockCenterDelta).toBeLessThanOrEqual(0.5);

    await page.setViewportSize({width: 620, height: 900});
    await setSidebarExpanded(page, false);

    const accessibilityAndGeometry = await pagination.evaluate((nav) => {
        const host = nav.parentElement;
        const navRect = nav.getBoundingClientRect();
        const hostRect = host.getBoundingClientRect();
        const active = nav.querySelector('[aria-current="page"]');
        const indicator = nav.querySelector('.local-store-pagination-indicator');
        const inactive = nav.querySelector('[aria-label="Page 5"]');
        const ellipsis = nav.querySelector('[data-pagination-ellipsis="trailing"]');
        const ellipsisTrigger = ellipsis.querySelector('[data-pagination-range-trigger]');
        const ellipsisDots = ellipsis.querySelector('.local-store-page-ellipsis-dots');
        const buttonRects = Array.from(nav.querySelectorAll('.local-store-page-button')).map((button) => {
            const rect = button.getBoundingClientRect();
            return {left: rect.left, right: rect.right};
        });
        const parseColor = (value) => {
            const channels = String(value).match(/[\d.]+/g)?.slice(0, 3).map(Number) || [];
            return channels.length === 3 ? channels : null;
        };
        const resolveColor = (value) => {
            const probe = document.createElement('span');
            probe.style.color = value;
            document.body.append(probe);
            const resolved = getComputedStyle(probe).color;
            probe.remove();
            return resolved;
        };
        const luminance = (channels) => {
            const linear = channels.map((channel) => {
                const normalized = channel / 255;
                return normalized <= 0.04045
                    ? normalized / 12.92
                    : ((normalized + 0.055) / 1.055) ** 2.4;
            });
            return (linear[0] * 0.2126) + (linear[1] * 0.7152) + (linear[2] * 0.0722);
        };
        const contrast = (foreground, background) => {
            const foregroundLuminance = luminance(parseColor(foreground));
            const backgroundLuminance = luminance(parseColor(background));
            const lighter = Math.max(foregroundLuminance, backgroundLuminance);
            const darker = Math.min(foregroundLuminance, backgroundLuminance);
            return (lighter + 0.05) / (darker + 0.05);
        };
        const rootStyles = getComputedStyle(document.documentElement);
        const themeText = resolveColor(rootStyles.getPropertyValue('--theme-text'));
        const themeBackground = resolveColor(rootStyles.getPropertyValue('--theme-background'));
        const activeRect = active.getBoundingClientRect();
        const indicatorRect = indicator.getBoundingClientRect();
        const ellipsisRect = ellipsis.getBoundingClientRect();
        const ellipsisDotsRect = ellipsisDots.getBoundingClientRect();
        return {
            centerDelta: Math.abs(
                ((navRect.left + navRect.right) / 2) - ((hostRect.left + hostRect.right) / 2),
            ),
            navInsideHost: navRect.left >= hostRect.left - 1 && navRect.right <= hostRect.right + 1,
            allButtonsInsideNav: buttonRects.every((rect) => (
                rect.left >= navRect.left - 1 && rect.right <= navRect.right + 1
            )),
            everyButtonHasStateAndLabel: Array.from(nav.querySelectorAll('.local-store-page-button')).every((button) => (
                button.hasAttribute('data-investment-history-page-target')
                && button.hasAttribute('data-pagination-current')
                && button.hasAttribute('aria-label')
            )),
            currentButtonCount: nav.querySelectorAll('[data-pagination-current="1"][aria-current="page"]').length,
            inactiveUsesThemeText: getComputedStyle(inactive).color === themeText,
            inactiveContrast: contrast(themeText, themeBackground),
            activeContrast: contrast(
                getComputedStyle(active).color,
                getComputedStyle(indicator).backgroundColor,
            ),
            indicatorDelta: Math.max(
                Math.abs(activeRect.left - indicatorRect.left),
                Math.abs(activeRect.top - indicatorRect.top),
                Math.abs(activeRect.width - indicatorRect.width),
                Math.abs(activeRect.height - indicatorRect.height),
            ),
            ellipsisHasNoFontGlyph: ellipsisTrigger.textContent === '',
            ellipsisDotSize: {
                width: ellipsisDotsRect.width,
                height: ellipsisDotsRect.height,
            },
            ellipsisCenterDelta: Math.max(
                Math.abs(
                    ((ellipsisRect.left + ellipsisRect.right) / 2)
                    - ((ellipsisDotsRect.left + ellipsisDotsRect.right) / 2),
                ),
                Math.abs(
                    ((ellipsisRect.top + ellipsisRect.bottom) / 2)
                    - ((ellipsisDotsRect.top + ellipsisDotsRect.bottom) / 2),
                ),
            ),
            ellipsisHasTwoOuterDots: getComputedStyle(ellipsisDots).boxShadow.split('rgb').length === 3,
        };
    });
    expect(accessibilityAndGeometry.centerDelta).toBeLessThanOrEqual(1);
    expect(accessibilityAndGeometry.navInsideHost).toBe(true);
    expect(accessibilityAndGeometry.allButtonsInsideNav).toBe(true);
    expect(accessibilityAndGeometry.everyButtonHasStateAndLabel).toBe(true);
    expect(accessibilityAndGeometry.currentButtonCount).toBe(1);
    expect(accessibilityAndGeometry.inactiveUsesThemeText).toBe(true);
    expect(accessibilityAndGeometry.inactiveContrast).toBeGreaterThanOrEqual(4.5);
    expect(accessibilityAndGeometry.activeContrast).toBeGreaterThanOrEqual(4.5);
    expect(accessibilityAndGeometry.indicatorDelta).toBeLessThanOrEqual(1);
    expect(accessibilityAndGeometry.ellipsisHasNoFontGlyph).toBe(true);
    expect(accessibilityAndGeometry.ellipsisDotSize).toEqual({width: 3, height: 3});
    expect(accessibilityAndGeometry.ellipsisCenterDelta).toBeLessThanOrEqual(0.5);
    expect(accessibilityAndGeometry.ellipsisHasTwoOuterDots).toBe(true);

    await page.getByRole('button', {name: 'Page 4', exact: true}).click();
    await expect(page.getByRole('button', {name: 'Page 4', exact: true})).toHaveAttribute('aria-current', 'page');
    await page.getByRole('button', {name: 'Next page', exact: true}).click();
    await expect(page.getByRole('button', {name: 'Page 6', exact: true})).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('button', {name: 'Next page', exact: true})).toHaveAttribute(
        'data-investment-history-page-target',
        '11',
    );
    const previousPage = page.getByRole('button', {name: 'Previous page', exact: true});
    await expect(previousPage).toHaveAttribute('data-investment-history-page-target', '5');
    await expect(pagination.locator('[data-pagination-ellipsis="leading"]')).toHaveCount(1);
    await expect(pagination.locator('[data-pagination-ellipsis="trailing"]')).toHaveCount(1);
    await expect(page.getByRole('button', {name: 'Page 1', exact: true})).toBeVisible();
    await expect(page.getByRole('button', {name: 'Page 7', exact: true})).toBeVisible();
    await expect(page.getByRole('button', {name: 'Page 51', exact: true})).toBeVisible();
    const readMiddleChunkGeometry = () => pagination.evaluate((nav) => {
        const hostRect = nav.parentElement.getBoundingClientRect();
        const navRect = nav.getBoundingClientRect();
        const activeRect = nav.querySelector('[aria-current="page"]').getBoundingClientRect();
        const indicatorRect = nav.querySelector('.local-store-pagination-indicator').getBoundingClientRect();
        return {
            centerDelta: Math.abs(
                ((navRect.left + navRect.right) / 2) - ((hostRect.left + hostRect.right) / 2),
            ),
            containmentOverflow: Math.max(0, hostRect.left - navRect.left, navRect.right - hostRect.right),
            indicatorDelta: Math.max(
                Math.abs(activeRect.left - indicatorRect.left),
                Math.abs(activeRect.top - indicatorRect.top),
                Math.abs(activeRect.width - indicatorRect.width),
                Math.abs(activeRect.height - indicatorRect.height),
            ),
        };
    });
    await expect.poll(async () => (await readMiddleChunkGeometry()).centerDelta).toBeLessThanOrEqual(1);
    await expect.poll(async () => (await readMiddleChunkGeometry()).containmentOverflow).toBeLessThanOrEqual(1);
    await expect.poll(async () => (await readMiddleChunkGeometry()).indicatorDelta).toBeLessThanOrEqual(1);

    await previousPage.click();
    await expect(page.getByRole('button', {name: 'Page 5', exact: true})).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('button', {name: 'Previous page', exact: true})).toHaveCount(0);
    await page.getByRole('button', {name: 'Next page', exact: true}).click();
    await expect(page.getByRole('button', {name: 'Page 6', exact: true})).toHaveAttribute('aria-current', 'page');
    await page.getByRole('button', {name: 'Next page', exact: true}).click();
    await expect(page.getByRole('button', {name: 'Page 11', exact: true})).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('button', {name: 'Previous page', exact: true})).toHaveAttribute(
        'data-investment-history-page-target',
        '10',
    );
    await expect(page.getByRole('button', {name: 'Next page', exact: true})).toHaveAttribute(
        'data-investment-history-page-target',
        '16',
    );
});

