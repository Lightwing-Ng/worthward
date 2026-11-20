/* Code version: v1.1.6
 * The inline Holdings share drawer follows its owning row.
 */
import {expect, test} from '@playwright/test';
import {mockInvestmentReadApis, setSidebarExpanded} from '../critical_flows/support.mjs';

const mockStockDetails = async (page, extraTickers = []) => {
    await mockInvestmentReadApis(page, {
        startingCash: 1000,
        brokers: ['ibkr'],
        transactions: [
            {ledger_no: 1, broker: 'ibkr', date: '2026-02-02', type: 'buy', ticker: 'DRAM', currency: 'USD', quantity: 10, price: 20, amount: -200},
            {ledger_no: 2, broker: 'ibkr', date: '2026-02-02', type: 'buy', ticker: 'AAPL', currency: 'USD', quantity: 1, price: 100, amount: -100},
            ...extraTickers.map((ticker, index) => ({
                ledger_no: index + 3, broker: 'ibkr', date: '2026-02-02', type: 'buy',
                ticker, currency: 'USD', quantity: 1, price: 10, amount: -10,
            })),
        ],
        tickerProfiles: {
            DRAM: {ticker: 'DRAM', company_name: 'Roundhill Memory ETF'},
            AAPL: {ticker: 'AAPL', company_name: 'Apple Inc.'},
        },
        priceHistoryByTicker: {
            DRAM: [{date: '2026-02-02', close: 20}, {date: '2026-02-03', close: 21}],
            AAPL: [{date: '2026-02-02', close: 100}, {date: '2026-02-03', close: 101}],
            ...Object.fromEntries(extraTickers.map((ticker) => [
                ticker, [{date: '2026-02-02', close: 10}, {date: '2026-02-03', close: 11}],
            ])),
        },
        intradayRows: () => [],
    });
};

test('opens the Holdings summary independently of the single expanded ticker', async ({page}) => {
    await page.setViewportSize({width: 836, height: 1_230});
    await page.emulateMedia({reducedMotion: 'reduce'});
    await mockStockDetails(page, ['EUV']);
    await page.goto('/trade/investment?view=holdings&ticker=EUV&range=ytd');
    await setSidebarExpanded(page, false);

    const panel = page.locator('#investment_holdings_panel');
    const scroll = panel.locator('.investment-holdings-table-scroll');
    const summary = panel.locator('table[data-table-header] .investment-holdings-summary-row');
    const summaryValue = summary.locator('[data-investment-live-field="summary_market_value"]');
    const summaryDetails = scroll.locator('tr[data-investment-holdings-overview-row]');
    const tickerDetails = scroll.locator('tr[data-investment-holding-detail]');
    const euv = tickerDetails.filter({has: page.locator('#stock_panel .investment-stock-details-price-chart-card')});
    const dramRow = scroll.locator('tr[data-investment-holdings-ticker="DRAM"]');

    await expect(page.locator('#investment_view_chart')).toHaveCount(0);
    await expect(summaryDetails).toBeHidden();
    await expect(euv).toHaveAttribute('data-investment-holding-detail', 'EUV');
    await summaryValue.click();
    await expect(summaryDetails).toBeVisible();
    await expect(summaryDetails.locator('#investment_equity_chart canvas')).toBeVisible();
    await expect(summaryDetails.locator('#investment_dummy_chart')).toBeVisible();
    await expect(scroll.locator('tbody > tr').first()).toHaveAttribute('data-investment-holdings-overview-row');
    await expect(tickerDetails).toHaveCount(1);
    await expect(tickerDetails).toHaveAttribute('data-investment-holding-detail', 'EUV');
    await expect.poll(() => scroll.evaluate((element) => {
        const pairs = [
            ['#investment_equity_chart', '#stock_panel .investment-stock-details-price-chart-card'],
            ['#investment_dummy_chart', '#stock_panel .investment-stock-details-side-card'],
        ];
        return Math.max(...pairs.flatMap(([summarySelector, tickerSelector]) => {
            const overview = element.querySelector(summarySelector).getBoundingClientRect();
            const detail = element.querySelector(tickerSelector).getBoundingClientRect();
            return [Math.abs(overview.left - detail.left), Math.abs(overview.right - detail.right)];
        }));
    })).toBeLessThanOrEqual(1);

    await dramRow.locator('[data-investment-stock-link]').click();
    await expect(tickerDetails).toHaveCount(1);
    await expect(tickerDetails).toHaveAttribute('data-investment-holding-detail', 'DRAM');
    await expect(summaryDetails).toBeVisible();
    await summaryValue.click();
    await expect(summaryDetails).toBeHidden();
    await expect(tickerDetails).toHaveAttribute('data-investment-holding-detail', 'DRAM');

    await summaryValue.click();
    await expect(summaryDetails).toBeVisible();
    await dramRow.locator('[data-investment-stock-link]').press('Enter');
    await expect(tickerDetails).toHaveCount(0);
    await expect(summaryDetails).toBeVisible();
});

for (const width of [390, 806, 1_024]) {
    test(`positions the stock share drawer inside the expanded Holdings row at ${width}px`, async ({page}) => {
        await page.setViewportSize({width, height: 1_000});
        await page.emulateMedia({reducedMotion: 'reduce'});
        await mockStockDetails(page);
        await page.goto('/trade/investment?view=holdings&ticker=DRAM&range=ytd');
        const row = page.locator('tr[data-investment-holding-detail="DRAM"]');
        const button = row.getByRole('button', {name: 'Export Transactions', exact: true});
        const chart = row.locator('.investment-stock-details-price-chart-card');
        const readBounds = (locator) => locator.evaluate((element) => element.getBoundingClientRect().toJSON());
        const expectHorizontalAlignment = () => expect.poll(() => button.evaluate((element) => {
            const anchor = document.querySelector('[data-layout-role="global-theme-anchor"]').getBoundingClientRect();
            const scroll = element.closest('.investment-holdings-table-scroll');
            const scrollRect = scroll.getBoundingClientRect();
            const content = element.closest('.investment-holding-detail-content').getBoundingClientRect();
            const buttonRect = element.getBoundingClientRect();
            const limit = Math.min(content.right, scrollRect.left + scroll.clientLeft + scroll.clientWidth);
            const alignedRight = anchor.left + (anchor.width + buttonRect.width) / 2;
            return Math.abs(buttonRect.right - Math.min(alignedRight, limit));
        })).toBeLessThanOrEqual(1);
        await expectHorizontalAlignment();
        await button.hover();
        await expectHorizontalAlignment();
        const [shareBounds, chartBounds] = await Promise.all([readBounds(button), readBounds(chart)]);
        expect(shareBounds.bottom).toBeLessThanOrEqual(chartBounds.top + 1);
        expect(shareBounds.right).toBeLessThanOrEqual(width);
        await expect(row.getByRole('button', {name: 'Mask Sensitive Values'})).toBeInViewport();
        await page.setViewportSize({width: width + 40, height: 1_000});
        await expectHorizontalAlignment();

        const ticker = page.locator('#investment_holdings_panel [data-table-scroll] [data-investment-stock-ticker="DRAM"]');
        await ticker.press('Enter');
        await expect(row).toHaveCount(0);
        await expect(page.locator('.investment-view-segmented-wrap > #investment_share_actions')).toBeVisible();
    });
}


test('moves adjacent Holdings rows during expansion and collapse without horizontal overflow at 836px', async ({page}) => {
    await page.setViewportSize({width: 836, height: 1_403});
    await page.emulateMedia({reducedMotion: 'no-preference'});
    await mockStockDetails(page, [
        'QQQI', 'BOXX', 'GOOGL', 'META', 'SGOV', 'QQQ', 'SPY', 'MSFT', 'NVDA', 'EUV',
        'VOO', 'AMD', 'PLTR', 'INTC', 'BABA', 'AMZN', 'AMAT', 'ASML', 'ADBE', 'COST',
    ]);
    await page.goto('/trade/investment?view=holdings');
    await setSidebarExpanded(page, false);
    const scroll = page.locator('#investment_holdings_panel .investment-holdings-table-scroll');
    const ticker = scroll.locator('[data-investment-stock-ticker="DRAM"]');
    const expanded = scroll.locator('tr[data-investment-holding-detail="DRAM"]');
    const expectNoHorizontalOverflow = () => expect.poll(() => scroll.evaluate((element) => (
        element.scrollWidth - element.clientWidth
    ))).toBe(0);

    await expect(ticker).toBeVisible();
    await expect.poll(() => scroll.evaluate((element) => (
        element.scrollHeight - element.clientHeight
    ))).toBeGreaterThan(0);
    await expectNoHorizontalOverflow();
    const sampleMotion = (opening) => ticker.evaluate((element, isOpening) => {
        const selectedRow = element.closest('tr');
        const nextRow = selectedRow.nextElementSibling;
        const followingRow = isOpening ? nextRow : nextRow.nextElementSibling;
        const measureGap = () => followingRow.getBoundingClientRect().top
            - selectedRow.getBoundingClientRect().bottom;
        const before = measureGap();
        element.click();
        const reveal = selectedRow.nextElementSibling.querySelector('.investment-holding-detail-reveal');
        const animation = reveal?.getAnimations().find((entry) => (
            entry.effect.getKeyframes().some((frame) => frame.height !== undefined)
        ));
        if (!animation) throw new Error('The Holdings detail row has no active height animation.');
        animation.pause();
        const duration = animation.effect.getComputedTiming().duration;
        const gaps = [0, 0.25, 0.6].map((fraction) => {
            animation.currentTime = duration * fraction;
            return measureGap();
        });
        animation.finish();
        return {before, gaps};
    }, opening);
    const opening = await sampleMotion(true);
    expect(opening.gaps[0]).toBeCloseTo(opening.before, 0);
    expect(opening.gaps[1]).toBeGreaterThan(opening.gaps[0] + 1);
    expect(opening.gaps[2]).toBeGreaterThan(opening.gaps[1] + 1);
    await expect(expanded.locator('.investment-stock-details-price-chart-canvas')).toBeInViewport();
    await expectNoHorizontalOverflow();
    await expanded.getByRole('button', {name: 'Export Transactions', exact: true}).hover();
    await expectNoHorizontalOverflow();
    const closing = await sampleMotion(false);
    expect(closing.gaps[0]).toBeCloseTo(closing.before, 0);
    expect(closing.gaps[1]).toBeLessThan(closing.gaps[0] - 1);
    expect(closing.gaps[2]).toBeLessThan(closing.gaps[1] - 1);
    await expect(expanded).toHaveCount(0);
    await expect.poll(() => ticker.evaluate((element) => {
        const row = element.closest('tr');
        return row.nextElementSibling.getBoundingClientRect().top - row.getBoundingClientRect().bottom;
    })).toBeCloseTo(opening.before, 0);
    await expectNoHorizontalOverflow();
});

test('keeps Holdings height animations continuous when clicks reverse them mid-flight', async ({page}) => {
    await page.setViewportSize({width: 836, height: 1_230});
    await page.emulateMedia({reducedMotion: 'no-preference'});
    await mockStockDetails(page);
    await page.goto('/trade/investment?view=holdings&ticker=DRAM&range=ytd');
    await setSidebarExpanded(page, false);
    const holdings = page.locator('#investment_holdings_panel');
    const summaryToggle = '[data-investment-holdings-overview-toggle]';
    const tickerToggle = '[data-table-scroll] [data-investment-stock-link][data-investment-stock-ticker="DRAM"]';
    const summaryRow = '[data-investment-holdings-overview-row]';
    const tickerRow = '[data-investment-holding-detail="DRAM"]';

    await expect(holdings.locator(summaryToggle)).toHaveAttribute('aria-expanded', 'false');
    await expect(holdings.locator(tickerToggle)).toHaveAttribute('aria-expanded', 'true');
    await page.evaluate(() => document.fonts.ready);

    const sampleMotion = async (trigger, detailRow, directions) => {
        const result = await holdings.evaluate((panel, {
            trigger, detailRow, directions, summaryRow, tickerToggle,
        }) => {
            const scroll = panel.querySelector('.investment-holdings-table-scroll');
            const toggle = panel.querySelector(trigger);
            const widths = () => Array.from(panel.querySelectorAll('table[data-table-header] thead th'))
                .concat(Array.from(panel.querySelector(tickerToggle).closest('tr').cells))
                .map((cell) => cell.getBoundingClientRect().width);
            const reveal = () => scroll.querySelector(`${detailRow} .investment-holding-detail-reveal`);
            const height = () => reveal()?.getBoundingClientRect().height ?? 0;
            const baselineWidths = widths();
            const rowBackgrounds = () => Array.from(
                scroll.querySelectorAll('tr[data-investment-holdings-ticker] > td:first-child'),
                (cell) => getComputedStyle(cell).backgroundColor,
            ).join('|');
            const baselineBackgrounds = rowBackgrounds();
            let activeAnimation;
            const samples = directions.map(() => {
                const before = height();
                toggle.click();
                activeAnimation = reveal()?.getAnimations().find((animation) => (
                    animation.effect.getKeyframes().some((frame) => frame.height !== undefined)
                ));
                if (!activeAnimation) throw new Error('No height animation followed the Holdings click.');
                activeAnimation.pause();
                const duration = activeAnimation.effect.getComputedTiming().duration;
                const frames = [0, 0.25, 0.5].map((fraction) => {
                    activeAnimation.currentTime = duration * fraction;
                    return {
                        height: height(),
                        widthChange: Math.max(...widths().map((width, index) => (
                            Math.abs(width - baselineWidths[index])
                        ))),
                        horizontalOverflow: scroll.scrollWidth - scroll.clientWidth,
                        rowBackgroundsStable: rowBackgrounds() === baselineBackgrounds,
                        summaryCount: scroll.querySelectorAll(summaryRow).length,
                        tickerCount: scroll.querySelectorAll('[data-investment-holding-detail]').length,
                    };
                });
                return {before, frames};
            });
            activeAnimation.finish();
            return samples;
        }, {trigger, detailRow, directions, summaryRow, tickerToggle});
        for (const [index, {before, frames}] of result.entries()) {
            expect(Math.abs(frames[0].height - before)).toBeLessThanOrEqual(1);
            for (let frameIndex = 1; frameIndex < frames.length; frameIndex += 1) {
                const change = frames[frameIndex].height - frames[frameIndex - 1].height;
                expect(change * directions[index]).toBeGreaterThan(1);
            }
            for (const frame of frames) {
                expect(frame.widthChange).toBeLessThanOrEqual(1);
                expect(frame.horizontalOverflow).toBe(0);
                expect(frame.rowBackgroundsStable).toBe(true);
                expect(frame.summaryCount).toBe(1);
                expect(frame.tickerCount).toBe(1);
            }
        }
    };

    await sampleMotion(summaryToggle, summaryRow, [1]);
    await expect(holdings.locator(summaryRow)).toBeVisible();
    await expect(holdings.locator(summaryRow).locator('.investment-holding-detail-reveal')).toHaveCSS('overflow-y', 'visible');
    await expect(holdings.locator(tickerToggle)).toHaveAttribute('aria-expanded', 'true');

    await sampleMotion(summaryToggle, summaryRow, [-1]);
    await expect(holdings.locator(summaryRow)).toBeHidden();
    await expect(holdings.locator(tickerRow)).toBeVisible();

    await sampleMotion(summaryToggle, summaryRow, [1, -1, 1]);
    await expect(holdings.locator(summaryToggle)).toHaveAttribute('aria-expanded', 'true');
    await expect(holdings.locator(summaryRow).locator('.investment-holding-detail-reveal')).toHaveCSS('overflow-y', 'visible');
    await expect(holdings.locator(tickerRow)).toHaveCount(1);

    await sampleMotion(tickerToggle, tickerRow, [-1, 1, -1]);
    await expect(holdings.locator(tickerToggle)).toHaveAttribute('aria-expanded', 'false');
    await expect(holdings.locator('[data-investment-holding-detail]')).toHaveCount(0);
    await expect(holdings.locator(summaryToggle)).toHaveAttribute('aria-expanded', 'true');
    await expect(holdings.locator(summaryRow)).toHaveCount(1);
    await expect(holdings.locator(summaryRow)).toBeVisible();
});

test('keeps the clicked ticker visible when switching after scrolling past an expanded Holdings chart', async ({page}) => {
    await page.setViewportSize({width: 836, height: 1_230});
    await page.emulateMedia({reducedMotion: 'no-preference'});
    await mockStockDetails(page, [
        'BOXX', 'EUV', 'GOOGL', 'META', 'MSFT', 'NVDA', 'QQQI', 'SGOV', 'SPY', 'TSLA',
    ]);
    await page.goto('/trade/investment?view=holdings&ticker=DRAM&range=ytd');
    await setSidebarExpanded(page, false);
    const scroll = page.locator('#investment_holdings_panel .investment-holdings-table-scroll');
    const aaplRow = scroll.locator('tr[data-investment-holdings-ticker="AAPL"]');
    const aaplLink = aaplRow.locator('[data-investment-stock-link]');
    await expect(scroll.locator('[data-investment-holding-detail="DRAM"]')).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await aaplRow.evaluate((row) => {
        const viewport = row.closest('.investment-holdings-table-scroll');
        viewport.scrollTop += row.getBoundingClientRect().top - viewport.getBoundingClientRect().top - 12;
    });
    await expect.poll(() => aaplRow.evaluate((row) => (
        row.getBoundingClientRect().top - row.closest('.investment-holdings-table-scroll').getBoundingClientRect().top
    ))).toBeCloseTo(12, 0);

    await aaplLink.evaluate((link) => {
        const panel = link.closest('#investment_holdings_panel');
        link.addEventListener('click', () => {
            const samples = [];
            const started = performance.now();
            const sample = () => {
                const viewport = panel.querySelector('.investment-holdings-table-scroll');
                const row = viewport.querySelector('tr[data-investment-holdings-ticker="AAPL"]');
                const bounds = row.getBoundingClientRect();
                const scrollBounds = viewport.getBoundingClientRect();
                samples.push({
                    topGap: bounds.top - scrollBounds.top,
                    bottomGap: scrollBounds.bottom - bounds.bottom,
                });
                if (performance.now() - started < 450) {
                    requestAnimationFrame(sample);
                } else {
                    window.holdingsSwitchSamples = samples;
                }
            };
            requestAnimationFrame(sample);
        }, {once: true});
    });
    await aaplLink.click();
    await expect(aaplLink).toHaveAttribute('aria-expanded', 'true');
    await expect(scroll.locator('[data-investment-holding-detail]'))
        .toHaveAttribute('data-investment-holding-detail', 'AAPL');
    await expect.poll(() => page.evaluate(() => window.holdingsSwitchSamples?.length || 0)).toBeGreaterThan(1);
    const samples = await page.evaluate(() => window.holdingsSwitchSamples);
    expect(Math.min(...samples.map(({topGap, bottomGap}) => Math.min(topGap, bottomGap)))).toBeGreaterThanOrEqual(-1);
});

test('shows a translucent frosted tooltip over the Holdings chart in Dark mode', async ({page}) => {
    await page.setViewportSize({width: 806, height: 1_180});
    await page.emulateMedia({colorScheme: 'dark', reducedMotion: 'reduce'});
    await mockStockDetails(page);
    await page.goto('/trade/investment?view=holdings&ticker=DRAM&range=ytd');
    await setSidebarExpanded(page, false);
    const canvas = page.locator('#stock_panel .investment-stock-details-price-chart-canvas');
    await expect(canvas).toBeVisible();
    const size = await canvas.boundingBox();
    expect(size).not.toBeNull();
    await canvas.hover({position: {x: size.width / 2, y: size.height / 2}});
    const tooltip = page.locator('[data-investment-stock-details-tooltip="1"].is-visible');
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toHaveCSS('background-color', 'rgba(255, 255, 255, 0.12)');
    await expect(tooltip).toHaveCSS('background-image', 'none');
    await expect(tooltip).toHaveCSS('backdrop-filter', 'saturate(1.6) blur(12px)');
});


test('keeps the entire inline Holdings chart visible while dragging the divider in both directions', async ({page}) => {
    const height = 1_230;
    await page.setViewportSize({width: 836, height});
    await page.emulateMedia({reducedMotion: 'reduce'});
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await mockStockDetails(page, ['BOXX', 'EUV', 'GOOGL', 'META', 'MSFT', 'NVDA', 'QQQI', 'SGOV', 'SPY', 'TSLA']);
    await page.goto('/trade/investment?view=holdings&ticker=EUV&range=1y');
    await setSidebarExpanded(page, false);

    const scroll = page.locator('#investment_holdings_panel .investment-holdings-table-scroll');
    const detail = scroll.locator('tr[data-investment-holding-detail="EUV"]');
    const canvas = detail.locator('.investment-stock-details-price-chart-canvas');
    const resizer = page.locator('#investment_section_resizer');
    await expect(canvas).toBeVisible();
    await expect.poll(() => canvas.evaluate((element) => Boolean(window.Chart?.getChart(element)))).toBe(true);
    await page.evaluate(() => document.fonts.ready);
    const original = await scroll.evaluate((element) => {
        const selected = element.querySelector('tr[data-investment-holdings-ticker="EUV"]');
        const content = element.querySelector('.investment-holding-detail-content');
        return {rowIndex: selected.sectionRowIndex, unscrolledTop: content.getBoundingClientRect().top + element.scrollTop};
    });
    expect(original.rowIndex).toBeGreaterThanOrEqual(2);

    await resizer.hover();
    const handle = await resizer.boundingBox();
    const x = handle.x + handle.width / 2;
    const startY = handle.y + handle.height / 2;
    const moveAndMeasure = async (y) => {
        await page.mouse.move(x, y);
        const frames = await scroll.evaluate(async (element) => {
            const readLayout = () => {
                const viewportTop = element.getBoundingClientRect().top + element.clientTop;
                const viewportBottom = viewportTop + element.clientHeight;
                const content = element.querySelector('.investment-holding-detail-content');
                const bounds = [
                    content,
                    content.querySelector('.investment-stock-details-price-chart-canvas'),
                    content.querySelector('[data-investment-stock-chips-canvas]'),
                ].map((node) => node.getBoundingClientRect());
                return {
                    viewport: [viewportTop, viewportBottom],
                    bounds: bounds.map((rect) => [rect.top, rect.bottom]),
                    clipped: bounds.some((rect) => rect.top < viewportTop - 1 || rect.bottom > viewportBottom + 1),
                    contentTop: bounds[0].top,
                    precedingSpace: bounds[0].top - viewportTop,
                    gridHeight: content.querySelector('.investment-stock-details-overview').getBoundingClientRect().height,
                    chartHeight: bounds[1].height,
                };
            };
            // Inspect animation-frame geometry after the divider applies its layout.
            const frames = [];
            for (let index = 0; index < 2; index += 1) {
                await new Promise((resolve) => requestAnimationFrame(resolve));
                frames.push(readLayout());
            }
            return frames;
        });
        expect(frames.some((layout) => layout.clipped), `full chart at divider pointer Y=${y}: ${JSON.stringify({frames, errors})}`)
            .toBe(false);
        const layout = frames.at(-1);
        return layout;
    };
    await page.mouse.move(x, startY);
    await page.mouse.down();
    try {
        await expect(resizer).toHaveClass(/is-resizing/);
        const wide = await moveAndMeasure(height - 2);
        await expect.poll(() => resizer.evaluate((element) => (
            Number(element.getAttribute('aria-valuemax')) - Number(element.getAttribute('aria-valuenow'))
        ))).toBe(0);
        const minimum = await resizer.getAttribute('aria-valuemin');
        const maximum = await resizer.getAttribute('aria-valuemax');
        const wideHandle = await resizer.boundingBox();
        const maxY = wideHandle.y + wideHandle.height / 2;
        const minY = maxY - (Number(maximum) - Number(minimum));
        const intermediateY = [0.25, 0.5, 0.75].map((fraction) => minY + (maxY - minY) * fraction);
        const upper = await moveAndMeasure(intermediateY.at(-1));
        expect(upper.gridHeight).toBeCloseTo(wide.gridHeight, 0);
        expect(wide.precedingSpace).toBeGreaterThan(upper.precedingSpace + 4);
        for (const y of intermediateY.slice(0, -1).reverse()) await moveAndMeasure(y);
        const compact = await moveAndMeasure(1);
        expect(compact.gridHeight).toBeCloseTo(220, 0);
        expect(wide.gridHeight).toBeCloseTo(440, 0);
        expect(wide.precedingSpace).toBeGreaterThan(compact.precedingSpace + 4);
        expect(compact.chartHeight).toBeGreaterThanOrEqual(180);
        expect(wide.chartHeight).toBeGreaterThan(compact.chartHeight + 16);
        expect(compact.contentTop).toBeLessThan(original.unscrolledTop - 4);
        for (const y of intermediateY) await moveAndMeasure(y);
        const reopened = await moveAndMeasure(height - 2);
        expect(reopened.chartHeight).toBeCloseTo(wide.chartHeight, 0);
    } finally {
        await page.mouse.up();
    }
});
