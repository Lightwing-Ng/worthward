/* Personal Stock-details cost lots share the price-chart scale. Code version: v1.5.1 */

import {expect, test} from '@playwright/test';
import {mockInvestmentReadApis, setSidebarExpanded} from '../critical_flows/support.mjs';

const priceCanvasSelector = '#stock_panel .investment-stock-details-price-chart-canvas';
const chipsSelector = '#stock_panel [data-investment-stock-chips]';
const chipsCanvasSelector = `${chipsSelector} canvas[data-investment-stock-chips-canvas]`;
const allocationSelector = '#stock_panel [data-investment-stock-allocation]';

const transactions = [
    {ledger_no: 1, broker: 'ibkr', date: '2026-07-14', type: 'buy', ticker: 'DRAM', currency: 'USD', quantity: 10, price: 10, amount: -100},
    {ledger_no: 2, broker: 'ibkr', date: '2026-07-15', type: 'buy', ticker: 'DRAM', currency: 'USD', quantity: 10, price: 20, amount: -200},
    {ledger_no: 3, broker: 'ibkr', date: '2026-07-17', type: 'sell', ticker: 'DRAM', currency: 'USD', quantity: 5, price: 25, amount: 125},
];
const priceHistory = [
    {date: '2026-07-13', close: 10},
    {date: '2026-07-14', close: 10},
    {date: '2026-07-15', close: 20},
    {date: '2026-07-16', close: 15},
    {date: '2026-07-17', close: 25},
];

async function installStockDetailsClock(page, timestamp, captureRealtimePoll = false) {
    await page.addInitScript(({timestamp, captureRealtimePoll}) => {
        const RealDate = Date;
        const fixedTime = new RealDate(timestamp).valueOf();
        window.Date = class FixedDate extends RealDate {
            constructor(...args) {
                super(...(args.length ? args : [fixedTime]));
            }

            static now() {
                return fixedTime;
            }
        };
        if (captureRealtimePoll) {
            const nativeSetTimeout = window.setTimeout.bind(window);
            window.setTimeout = (callback, delay, ...args) => {
                if (delay === 60_000 && typeof callback === 'function') {
                    window.__testTriggerStockDetailsRealtimePoll = () => callback(...args);
                    return 0;
                }
                return nativeSetTimeout(callback, delay, ...args);
            };
        }
    }, {timestamp, captureRealtimePoll});
}

async function openChipDetails(page, {width = 1_280, rows = transactions, expectChart = true, priceHistoryByTicker = {}, costBasisMethod = null} = {}) {
    await installStockDetailsClock(page, '2026-07-17T22:00:00Z');
    if (costBasisMethod) {
        await page.addInitScript((method) => {
            let payload;
            Object.defineProperty(window, 'WORTHWARD_INVESTMENT_DATA', {
                configurable: true,
                get: () => payload,
                set(value) {
                    if (value && typeof value === 'object') value.investment_cost_basis_method = method;
                    payload = value;
                },
            });
        }, costBasisMethod);
    }
    const writes = [];
    page.on('request', (request) => {
        if (request.method() !== 'GET' && request.url().includes('/api/investment/')) {
            writes.push({method: request.method(), path: new URL(request.url()).pathname});
        }
    });
    await mockInvestmentReadApis(page, {
        transactions: rows,
        startingCash: 10_000,
        priceHistoryByTicker: {DRAM: priceHistory, ...priceHistoryByTicker},
        tickerProfiles: {DRAM: {ticker: 'DRAM', company_name: 'Roundhill Memory ETF'}},
        intradayRows: () => [],
    });
    await page.emulateMedia({reducedMotion: 'reduce'});
    await page.setViewportSize({width, height: 1_000});
    await page.goto('/trade/investment?view=stock-details&ticker=DRAM&range=max');
    if (expectChart) {
        await expect(page.locator(priceCanvasSelector)).toBeVisible();
        await expect(page.locator(chipsSelector)).toHaveAttribute('data-date', '2026-07-17');
    } else {
        await expect(page.locator(chipsSelector)).toBeVisible();
    }
    return writes;
}

async function readChips(page) {
    return page.locator(chipsCanvasSelector).evaluate((canvas) => {
        const snapshot = canvas._investmentChipSnapshot;
        if (!snapshot) return null;
        return {
            date: snapshot.date,
            price: snapshot.price,
            currency: snapshot.currency,
            status: snapshot.status,
            totalQuantity: snapshot.totalQuantity,
            bins: snapshot.bins.map((bin) => ({
                price: bin.price,
                quantity: bin.quantity,
                side: bin.side,
                profitable: bin.profitable,
            })),
        };
    });
}

async function waitForStablePriceChart(page) {
    const canvas = page.locator(priceCanvasSelector);
    await expect.poll(() => canvas.evaluate(async (element) => {
        const chart = window.Chart?.getChart(element);
        const isIdle = () => Boolean(chart)
            && chart === window.Chart?.getChart(element)
            && !element._layoutSyncTimer && !element._layoutSyncRaf && !element._hoverSyncRaf;
        if (!isIdle()) return false;
        const readBounds = () => {
            const {left, top, width, height} = element.getBoundingClientRect();
            return [left, top, width, height, chart.width, chart.height];
        };
        const bounds = readBounds();
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return isIdle() && readBounds().every((value, index) => value === bounds[index]);
    })).toBe(true);
}

async function hoverDate(page, date) {
    const canvas = page.locator(priceCanvasSelector);
    await canvas.scrollIntoViewIfNeeded();
    await waitForStablePriceChart(page);
    const point = await canvas.evaluate((element, targetDate) => {
        const chart = window.Chart?.getChart(element);
        const index = chart?.data?.labels?.findIndex((label) => String(label) === targetDate);
        const geometry = index >= 0 ? chart.getDatasetMeta(0).data[index]?.getCenterPoint() : null;
        if (!geometry) return null;
        const bounds = element.getBoundingClientRect();
        const x = Math.max(chart.chartArea.left + 2, Math.min(chart.chartArea.right - 2, geometry.x));
        const y = Math.max(chart.chartArea.top + 2, Math.min(chart.chartArea.bottom - 2, geometry.y));
        return {
            x: bounds.left + x * bounds.width / chart.width,
            y: bounds.top + y * bounds.height / chart.height,
        };
    }, date);
    expect(point, `The price series contains ${date}`).not.toBeNull();
    await page.mouse.move(point.x, point.y);
    await expect(page.locator(chipsSelector)).toHaveAttribute('data-date', date);
}

async function readChipPriceMapping(page) {
    return page.evaluate(({priceCanvasSelector, chipsCanvasSelector}) => {
        const priceCanvas = document.querySelector(priceCanvasSelector);
        const chipsCanvas = document.querySelector(chipsCanvasSelector);
        const chart = window.Chart?.getChart(priceCanvas);
        const snapshot = chipsCanvas?._investmentChipSnapshot;
        const geometry = chipsCanvas?._investmentChipGeometry;
        if (!chart?.scales?.y || !snapshot || !Array.isArray(geometry?.bins)) return null;
        const priceRect = priceCanvas.getBoundingClientRect();
        const chipsRect = chipsCanvas.getBoundingClientRect();
        const scale = chart.scales.y;
        const scaleY = priceRect.height / chart.height;
        const visibleBins = snapshot.bins.filter((bin) => (
            bin.price >= scale.min && bin.price <= scale.max
        ));
        const expectedPageY = (price) => priceRect.top + scale.getPixelForValue(price) * scaleY;
        const context = chipsCanvas.getContext('2d');
        const rasterYScale = chipsCanvas.height / chipsRect.height;
        const rows = geometry.bins.map((bin) => {
            const expectedY = expectedPageY(bin.price);
            const pixelY = Math.max(0, Math.min(chipsCanvas.height - 1, Math.round(bin.y * rasterYScale)));
            const pixels = context.getImageData(0, pixelY, chipsCanvas.width, 1).data;
            return {
                price: bin.price,
                side: bin.side,
                quantity: bin.quantity,
                expectedPageY: expectedY,
                actualPageY: chipsRect.top + bin.y,
                reportedPageY: bin.pageY,
                rowHasPaint: pixels.some((value, index) => index % 4 === 3 && value > 0),
            };
        });
        return {
            min: scale.min,
            max: scale.max,
            snapshotBinCount: snapshot.bins.length,
            visibleBinCount: visibleBins.length,
            renderedBinCount: rows.length,
            rows,
            visibleBins: visibleBins.map(({price, side, quantity}) => ({price, side, quantity})),
            pricePlotTop: priceRect.top + chart.chartArea.top * scaleY,
            pricePlotBottom: priceRect.top + chart.chartArea.bottom * scaleY,
            chipsCanvasTop: chipsRect.top,
            chipsCanvasBottom: chipsRect.bottom,
        };
    }, {priceCanvasSelector, chipsCanvasSelector});
}

async function expectSharedPriceMapping(page, {minimumVisibleBins = 1} = {}) {
    await expect.poll(async () => {
        const mapping = await readChipPriceMapping(page);
        return Boolean(mapping)
            && mapping.visibleBinCount >= minimumVisibleBins
            && mapping.renderedBinCount === mapping.visibleBinCount
            && mapping.chipsCanvasTop <= mapping.pricePlotTop + 1
            && mapping.chipsCanvasBottom >= mapping.pricePlotBottom - 1
            && mapping.rows.every((row) => (
                Math.abs(row.actualPageY - row.expectedPageY) <= 1
                && Math.abs(row.reportedPageY - row.expectedPageY) <= 1
                && row.rowHasPaint
                && mapping.visibleBins.some((bin) => (
                    bin.price === row.price && bin.side === row.side && bin.quantity === row.quantity
                ))
            ));
    }, {message: 'Every rendered cost level uses the price chart scale at the same page Y'}).toBe(true);
}

async function readPriceCurveGeometry(page) {
    return page.locator(priceCanvasSelector).evaluate((canvas) => {
        const chart = window.Chart.getChart(canvas);
        return {
            min: chart.scales.y.min,
            max: chart.scales.y.max,
            width: chart.width,
            height: chart.height,
            chartArea: {...chart.chartArea},
            curves: chart.data.datasets.map((dataset, index) => ({
                data: dataset.data,
                points: chart.getDatasetMeta(index).data.map(({x, y}) => ({x, y})),
            })),
        };
    });
}

async function installChipPaintingProbe(page) {
    await page.evaluate(({priceCanvasSelector, chipsCanvasSelector}) => {
        for (const selector of [priceCanvasSelector, chipsCanvasSelector]) {
            const context = document.querySelector(selector).getContext('2d');
            const probe = {text: [], strokes: []};
            let path = [];
            context._stockDetailsPaintingProbe = probe;
            const originals = Object.fromEntries(
                ['clearRect', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'fillText']
                    .map((name) => [name, context[name]]),
            );
            context.clearRect = function (...args) {
                probe.text = [];
                probe.strokes = [];
                path = [];
                return originals.clearRect.apply(this, args);
            };
            context.beginPath = function (...args) {
                path = [];
                return originals.beginPath.apply(this, args);
            };
            for (const name of ['moveTo', 'lineTo']) {
                context[name] = function (x, y, ...args) {
                    path.push({x, y});
                    return originals[name].call(this, x, y, ...args);
                };
            }
            context.stroke = function (...args) {
                probe.strokes.push({
                    color: this.strokeStyle,
                    lineWidth: this.lineWidth,
                    dash: this.getLineDash(),
                    path: path.map((point) => ({...point})),
                });
                return originals.stroke.apply(this, args);
            };
            context.fillText = function (text, x, y, ...args) {
                probe.text.push({text: String(text), x, y, align: this.textAlign});
                return originals.fillText.call(this, text, x, y, ...args);
            };
        }
    }, {priceCanvasSelector, chipsCanvasSelector});
}

async function readChipPainting(page) {
    return page.evaluate(({priceCanvasSelector, chipsCanvasSelector}) => {
        const source = document.querySelector(priceCanvasSelector);
        const chips = document.querySelector(chipsCanvasSelector);
        const chart = window.Chart.getChart(source);
        const snapshot = chips._investmentChipSnapshot;
        const geometry = chips._investmentChipGeometry;
        const sourceProbe = source.getContext('2d')._stockDetailsPaintingProbe;
        const chipsProbe = chips.getContext('2d')._stockDetailsPaintingProbe;
        const sourceRect = source.getBoundingClientRect();
        const chipRect = chips.getBoundingClientRect();
        const near = (left, right) => Math.abs(left - right) < 0.01;
        const guide = sourceProbe.strokes.findLast(({path}) => (
            path.length === 2
            && near(path[0].x, chart.chartArea.left)
            && near(path[1].x, chart.chartArea.right)
            && near(path[0].y, chart._activeInvestmentStockDetailsGuideY)
            && near(path[0].y, path[1].y)
        ));
        const referenceY = sourceRect.top
            + chart.scales.y.getPixelForValue(snapshot.price) * sourceRect.height / chart.height
            - chipRect.top;
        const reference = chipsProbe.strokes.findLast(({path}) => (
            path.length === 2
            && path[1].x > path[0].x
            && near(path[0].y, path[1].y)
            && near(path[0].y, referenceY)
        ));
        const lineStyle = (stroke) => stroke ? {
            color: stroke.color, lineWidth: stroke.lineWidth, dash: stroke.dash,
        } : null;
        return {
            labels: (geometry.labels || []).map((label) => ({
                ...label,
                expectedY: sourceRect.top
                    + chart.scales.y.getPixelForValue(label.price) * sourceRect.height / chart.height
                    - chipRect.top,
            })),
            paintedText: chipsProbe.text,
            bins: geometry.bins,
            sourceStyle: lineStyle(guide),
            referenceStyle: lineStyle(reference),
        };
    }, {priceCanvasSelector, chipsCanvasSelector});
}

test('replays personal cost lots at hover dates and restores the visible endpoint on exit', async ({page}) => {
    const writes = await openChipDetails(page);
    const expectedRemaining = [
        {price: 10, quantity: 5, side: 'long', profitable: true},
        {price: 20, quantity: 10, side: 'long', profitable: true},
    ];
    await expect.poll(() => readChips(page)).toEqual({
        date: '2026-07-17', price: 25, currency: 'USD', status: 'ready',
        totalQuantity: 15, bins: expectedRemaining,
    });

    await hoverDate(page, '2026-07-13');
    await expect.poll(() => readChips(page)).toEqual(expect.objectContaining({
        status: 'empty', totalQuantity: 0, bins: [],
    }));
    await hoverDate(page, '2026-07-14');
    await expect.poll(() => readChips(page)).toEqual(expect.objectContaining({
        status: 'ready', totalQuantity: 10,
        bins: [{price: 10, quantity: 10, side: 'long', profitable: true}],
    }));
    await hoverDate(page, '2026-07-15');
    await expect.poll(() => readChips(page)).toEqual(expect.objectContaining({
        status: 'ready', totalQuantity: 20,
        bins: [
            {price: 10, quantity: 10, side: 'long', profitable: true},
            {price: 20, quantity: 10, side: 'long', profitable: true},
        ],
    }));
    await hoverDate(page, '2026-07-16');
    await expect.poll(() => readChips(page)).toEqual(expect.objectContaining({
        status: 'ready', totalQuantity: 20,
        bins: [
            {price: 10, quantity: 10, side: 'long', profitable: true},
            {price: 20, quantity: 10, side: 'long', profitable: false},
        ],
    }));
    await hoverDate(page, '2026-07-17');
    await expect.poll(() => readChips(page)).toEqual(expect.objectContaining({
        totalQuantity: 15, bins: expectedRemaining,
    }));
    await hoverDate(page, '2026-07-14');
    await page.mouse.move(0, 0);
    await expect(page.locator(chipsSelector)).toHaveAttribute('data-date', '2026-07-17');
    await expect.poll(() => readChips(page)).toEqual(expect.objectContaining({
        totalQuantity: 15, bins: expectedRemaining,
    }));

    const beforeTheme = await readChips(page);
    await page.locator('#global_theme_toggle').click();
    await expect.poll(() => readChips(page)).toEqual(beforeTheme);
    await expect.poll(() => page.locator(chipsCanvasSelector).evaluate((canvas) => {
        const image = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
        return image.data.some((value, index) => index % 4 === 3 && value > 0);
    })).toBe(true);
    expect(writes).toEqual([]);
});

test('anchors a fee-bearing purchase to its execution price while preserving financial cost', async ({page}) => {
    const writes = await openChipDetails(page, {
        rows: [{
            ledger_no: 1, broker: 'ibkr', date: '2026-07-14', type: 'buy', ticker: 'DRAM',
            currency: 'USD', quantity: 10, price: 10, amount: -101, commission_raw: '1',
            normalized: {position_quantity: '10', unit_price: '10', net_amount: '-101', commission: '1'},
        }],
    });
    await expect.poll(() => readChips(page)).toEqual(expect.objectContaining({
        totalQuantity: 10,
        bins: [{price: 10, quantity: 10, side: 'long', profitable: true}],
    }));
    const financialCost = await page.locator(chipsCanvasSelector).evaluate((canvas) => ({
        totalCost: canvas._investmentChipSnapshot.totalCost,
        weightedAverageCost: canvas._investmentChipSnapshot.weightedAverageCost,
    }));
    expect(financialCost.totalCost).toBeCloseTo(101, 8);
    expect(financialCost.weightedAverageCost).toBeCloseTo(10.1, 8);
    await hoverDate(page, '2026-07-14');
    await expectSharedPriceMapping(page);
    expect((await readChips(page)).bins.map(({price}) => price)).toEqual([10]);
    expect(writes).toEqual([]);
});

test('keeps both purchase levels after a moving-average sale without changing financial average cost', async ({page}) => {
    const writes = await openChipDetails(page, {costBasisMethod: 'moving_average'});
    await expect.poll(() => readChips(page)).toEqual(expect.objectContaining({
        totalQuantity: 15,
        bins: [
            {price: 10, quantity: 7.5, side: 'long', profitable: true},
            {price: 20, quantity: 7.5, side: 'long', profitable: true},
        ],
    }));
    const financialCost = await page.locator(chipsCanvasSelector).evaluate((canvas) => ({
        method: window.WORTHWARD_INVESTMENT_DATA.investment_cost_basis_method,
        totalCost: canvas._investmentChipSnapshot.totalCost,
        weightedAverageCost: canvas._investmentChipSnapshot.weightedAverageCost,
    }));
    expect(financialCost).toEqual({method: 'moving_average', totalCost: 225, weightedAverageCost: 15});
    for (const date of ['2026-07-16', '2026-07-17', '2026-07-15', '2026-07-17']) {
        await hoverDate(page, date);
        await expectSharedPriceMapping(page, {minimumVisibleBins: 2});
        expect((await readChips(page)).bins.map(({price}) => price)).toEqual([10, 20]);
    }
    expect(writes).toEqual([]);
});

for (const width of [1_280, 390]) {
    test(`keeps purchase-price Y positions fixed throughout forward and backward hover at ${width}px`, async ({page}) => {
        const writes = await openChipDetails(page, {
            width,
            rows: [
                {...transactions[0], date: '2026-07-01'},
                {...transactions[1], date: '2026-07-02'},
            ],
        });
        await page.emulateMedia({reducedMotion: width === 1_280 ? 'no-preference' : 'reduce'});
        await page.locator(priceCanvasSelector).scrollIntoViewIfNeeded();
        await waitForStablePriceChart(page);
        await expectSharedPriceMapping(page, {minimumVisibleBins: 2});
        const points = await page.locator(priceCanvasSelector).evaluate((canvas) => {
            const chart = window.Chart.getChart(canvas);
            const bounds = canvas.getBoundingClientRect();
            return ['2026-07-15', '2026-07-16', '2026-07-17'].map((date) => {
                const index = chart.data.labels.findIndex((label) => String(label) === date);
                const point = chart.getDatasetMeta(0).data[index].getCenterPoint();
                return {
                    date,
                    x: bounds.left + Math.max(chart.chartArea.left + 2, Math.min(chart.chartArea.right - 2, point.x)) * bounds.width / chart.width,
                    y: bounds.top + Math.max(chart.chartArea.top + 2, Math.min(chart.chartArea.bottom - 2, point.y)) * bounds.height / chart.height,
                };
            });
        });
        await page.evaluate(({priceCanvasSelector, chipsCanvasSelector}) => {
            const source = document.querySelector(priceCanvasSelector);
            const chips = document.querySelector(chipsCanvasSelector);
            const chart = window.Chart.getChart(source);
            const rect = source.getBoundingClientRect();
            const baseline = new Map([10, 20].map((price) => [
                price, rect.top + chart.scales.y.getPixelForValue(price) * rect.height / chart.height,
            ]));
            const probe = {running: true, frames: []};
            window.__chipAnchorFrameProbe = probe;
            const sample = () => {
                if (!probe.running) return;
                const sourceRect = source.getBoundingClientRect();
                const chipsRect = chips.getBoundingClientRect();
                const snapshot = chips._investmentChipSnapshot;
                const geometry = chips._investmentChipGeometry;
                probe.frames.push({
                    date: snapshot?.date,
                    bins: snapshot?.bins.map(({price, quantity}) => ({price, quantity})),
                    rows: (geometry?.bins || []).map((bin) => ({
                        price: bin.price,
                        actual: chipsRect.top + bin.y,
                        reported: bin.pageY,
                        expected: sourceRect.top + chart.scales.y.getPixelForValue(bin.price) * sourceRect.height / chart.height,
                        baseline: baseline.get(bin.price),
                    })),
                });
                if (probe.frames.length < 600) requestAnimationFrame(sample);
            };
            requestAnimationFrame(sample);
        }, {priceCanvasSelector, chipsCanvasSelector});
        for (const index of [0, 1, 2, 1, 0, 2, 0]) {
            await page.mouse.move(points[index].x, points[index].y, {steps: 12});
            await expect(page.locator(chipsSelector)).toHaveAttribute('data-date', points[index].date);
            await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
        }
        const frames = await page.evaluate(() => {
            window.__chipAnchorFrameProbe.running = false;
            return window.__chipAnchorFrameProbe.frames;
        });
        expect(frames.length).toBeGreaterThan(4);
        expect(new Set(frames.map(({date}) => date)).size).toBeGreaterThanOrEqual(2);
        for (const frame of frames) {
            expect(frame.bins, `Original purchase levels at ${frame.date}`).toEqual([
                {price: 10, quantity: 10}, {price: 20, quantity: 10},
            ]);
            expect(frame.rows).toHaveLength(2);
            for (const row of frame.rows) {
                expect(Math.abs(row.actual - row.expected), `Axis alignment for ${row.price} on ${frame.date}`).toBeLessThanOrEqual(1);
                expect(Math.abs(row.reported - row.expected)).toBeLessThanOrEqual(1);
                expect(Math.abs(row.actual - row.baseline), `Fixed purchase position for ${row.price} on ${frame.date}`).toBeLessThanOrEqual(1);
            }
        }
        expect(writes).toEqual([]);
    });
}

test('renders right-aligned share counts without the old title and matches the price hover line', async ({page}) => {
    const writes = await openChipDetails(page);
    await waitForStablePriceChart(page);
    await expect(page.locator(chipsSelector)).not.toContainText('My chips');
    await expect(page.locator(`${chipsSelector} [data-investment-stock-chips-date]`)).toHaveCount(0);
    await expect(page.locator(`${chipsSelector} [data-investment-stock-chips-summary]`)).toHaveCount(0);
    await expect(page.locator(chipsSelector)).not.toContainText(/USD|Jul 2026/);
    await expect(page.locator(chipsCanvasSelector)).not.toHaveAttribute('aria-label', /My chips/i);
    await installChipPaintingProbe(page);
    for (const theme of ['initial', 'alternate']) {
        if (theme === 'alternate') await page.locator('#global_theme_toggle').click();
        await hoverDate(page, '2026-07-16');
        await expect(page.locator(`${chipsSelector} [data-investment-stock-chips-summary]`)).toHaveCount(0);
        await expect(page.locator(chipsSelector)).not.toContainText(/USD|Jul 2026/);
        await expect.poll(async () => {
            const painting = await readChipPainting(page);
            return Boolean(painting.sourceStyle && painting.referenceStyle);
        }).toBe(true);
        const painting = await readChipPainting(page);
        expect(painting.referenceStyle, `${theme} reference line follows the actual hover stroke`)
            .toEqual(painting.sourceStyle);
        expect(painting.labels.map(({price, quantity, text, align}) => ({price, quantity, text, align}))
            .sort((left, right) => right.price - left.price))
            .toEqual([
                {price: 20, quantity: 10, text: '10', align: 'right'},
                {price: 10, quantity: 10, text: '10', align: 'right'},
            ]);
        expect(painting.paintedText).toHaveLength(2);
        painting.labels.forEach((label) => {
            expect(Math.abs(label.y - label.expectedY)).toBeLessThanOrEqual(1);
            expect(painting.paintedText.some((painted) => (
                painted.text === label.text && painted.align === 'right'
                && Math.abs(painted.x - label.x) <= 0.01 && Math.abs(painted.y - label.y) <= 0.01
            ))).toBe(true);
        });
        painting.paintedText.forEach((label) => {
            expect(label.text).toBe('10');
            expect(label.align).toBe('right');
            expect(label.x).toBeLessThan(Math.min(...painting.bins.map(({x}) => x)));
        });
        expect(Math.abs(painting.paintedText[0].x - painting.paintedText[1].x)).toBeLessThanOrEqual(0.01);
        await hoverDate(page, '2026-07-17');
        const afterSale = await readChipPainting(page);
        expect(afterSale.paintedText.map(({text}) => text).sort()).toEqual(['10', '5']);
        expect(afterSale.labels.map(({quantity}) => quantity).sort((left, right) => left - right)).toEqual([5, 10]);
    }
    expect(writes).toEqual([]);
});

for (const width of [1_280, 843, 390]) {
    test(`maps personal chips to the price curve beside the allocation bar at ${width}px`, async ({page}) => {
        const writes = await openChipDetails(page, {width});
        await waitForStablePriceChart(page);
        await expect.poll(() => page.evaluate(() => {
            const panel = document.querySelector('#stock_panel');
            const rect = (selector) => {
                const bounds = panel.querySelector(selector)?.getBoundingClientRect();
                return bounds ? {
                    left: bounds.left, right: bounds.right,
                    top: bounds.top, bottom: bounds.bottom,
                    width: bounds.width, height: bounds.height,
                } : null;
            };
            const side = rect('.investment-stock-details-side-card');
            const allocation = rect('[data-investment-stock-allocation]');
            const chips = rect('.investment-stock-details-chips-card');
            const canvas = rect('[data-investment-stock-chips-canvas]');
            const price = rect('.investment-stock-details-price-chart-card');
            if (!side || !allocation || !chips || !canvas || !price) return false;
            const contained = [allocation, chips].every((bounds) => (
                bounds.left >= side.left - 1 && bounds.right <= side.right + 1
                && bounds.top >= side.top - 1 && bounds.bottom <= side.bottom + 1
            ));
            const sidePlacement = side.left >= price.right - 1
                && Math.abs(side.bottom - price.bottom) <= 1;
            return contained && sidePlacement
                && allocation.height <= 64
                && canvas.width > 25 && canvas.height > 40
                && canvas.right <= chips.right + 1 && canvas.bottom <= chips.bottom + 1
                && document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1;
        })).toBe(true);
        await expect(page.locator('#stock_panel .investment-stock-details-donut')).toHaveCount(0);
        await expectSharedPriceMapping(page, {minimumVisibleBins: 2});
        await hoverDate(page, '2026-07-14');
        await expectSharedPriceMapping(page);
        const rangeChartId = await page.locator(priceCanvasSelector).evaluate((canvas) => window.Chart.getChart(canvas).id);
        await page.locator('label[for="investment_stock_details_range_3m"]').click();
        await expect.poll(() => page.locator(priceCanvasSelector).evaluate((canvas) => (
            window.Chart?.getChart(canvas)?.id ?? null
        ))).not.toBe(rangeChartId);
        await waitForStablePriceChart(page);
        await expectSharedPriceMapping(page, {minimumVisibleBins: 2});
        if (width >= 768) {
            const expanded = await page.locator('#sidebar_toggle').getAttribute('aria-expanded') === 'true';
            await setSidebarExpanded(page, !expanded);
            await waitForStablePriceChart(page);
            await expectSharedPriceMapping(page, {minimumVisibleBins: 2});
        }
        await page.setViewportSize({width: width + 37, height: 1_100});
        await waitForStablePriceChart(page);
        await expectSharedPriceMapping(page, {minimumVisibleBins: 2});
        expect(writes).toEqual([]);
    });
}

test('clips personal costs without changing the stock-price scale or curve geometry', async ({page}) => {
    await installStockDetailsClock(page, '2026-07-17T22:00:00Z');
    await mockInvestmentReadApis(page, {
        startingCash: 10_000,
        transactions: [
            {ledger_no: 1, broker: 'ibkr', date: '2025-01-02', type: 'buy', ticker: 'DRAM', currency: 'USD', quantity: 10, price: 5, amount: -50},
            {ledger_no: 2, broker: 'ibkr', date: '2025-01-03', type: 'buy', ticker: 'DRAM', currency: 'USD', quantity: 10, price: 100, amount: -1000},
        ],
        priceHistoryByTicker: {DRAM: [
            {date: '2025-01-02', close: 5}, {date: '2025-01-03', close: 100},
            {date: '2026-07-13', close: 45}, {date: '2026-07-14', close: 45},
            {date: '2026-07-15', close: 55}, {date: '2026-07-16', close: 48},
            {date: '2026-07-17', close: 50},
        ]},
        intradayRows: () => [],
    });
    await page.emulateMedia({reducedMotion: 'reduce'});
    await page.setViewportSize({width: 1_280, height: 1_000});
    await page.goto('/trade/investment?view=stock-details&ticker=DRAM&range=3m');
    await expect(page.locator(priceCanvasSelector)).toBeVisible();
    await expect(page.locator(chipsSelector)).toHaveAttribute('data-status', 'ready');
    await waitForStablePriceChart(page);
    await expectSharedPriceMapping(page, {minimumVisibleBins: 0});
    const mapping = await readChipPriceMapping(page);
    expect(mapping.snapshotBinCount).toBe(2);
    expect(mapping.visibleBinCount).toBe(0);
    expect(mapping.renderedBinCount).toBe(0);
    expect(mapping.min).toBeGreaterThan(40);
    expect(mapping.max).toBeLessThan(60);
    expect((await readChips(page)).bins).toEqual([
        {price: 5, quantity: 10, side: 'long', profitable: true},
        {price: 100, quantity: 10, side: 'long', profitable: false},
    ]);
    const priceGeometry = await readPriceCurveGeometry(page);
    await hoverDate(page, '2026-07-13');
    await expectSharedPriceMapping(page, {minimumVisibleBins: 0});
    expect(await readPriceCurveGeometry(page)).toEqual(priceGeometry);
    await hoverDate(page, '2026-07-17');
    await expectSharedPriceMapping(page, {minimumVisibleBins: 0});
    expect(await readPriceCurveGeometry(page)).toEqual(priceGeometry);

    // Keep the same ledger and price history while removing the optional chip renderer.
    await page.route(/\/stock-details-chip-chart\.js(?:\?.*)?$/, async (route) => {
        const response = await route.fetch();
        const source = await response.text();
        const factory = 'export function createInvestmentStockDetailsChipChart(card, {resolveTheme, getPriceChart} = {}) {';
        expect(source).toContain(factory);
        await route.fulfill({response, body: source.replace(factory, `${factory}\n    return null;`)});
    });
    await page.reload();
    await expect(page.locator(priceCanvasSelector)).toBeVisible();
    await waitForStablePriceChart(page);
    expect(await page.locator(chipsCanvasSelector).evaluate((canvas) => Boolean(canvas._investmentChipSnapshot))).toBe(false);
    expect(await readPriceCurveGeometry(page)).toEqual(priceGeometry);
});

test('uses total equity for current-stock cash and other-stock allocation at historical hover dates', async ({page}) => {
    const writes = await openChipDetails(page, {
        rows: [
            {ledger_no: 4, broker: 'ibkr', date: '2026-07-13', type: 'buy', ticker: 'QQQ', currency: 'USD', quantity: 50, price: 50, amount: -2500},
            ...transactions,
        ],
        priceHistoryByTicker: {QQQ: priceHistory.map((row) => ({...row, close: 50}))},
    });
    const readAllocation = () => page.locator(allocationSelector).evaluate((element) => ({
        cashRatio: Number(element.dataset.cashRatio),
        tickerRatio: Number(element.dataset.tickerRatio),
        otherRatio: Number(element.dataset.otherRatio),
        denominator: Number(element.dataset.denominator),
        ticker: element.dataset.ticker,
    }));
    await expect.poll(readAllocation).toEqual({
        cashRatio: 7325 / 10200, tickerRatio: 375 / 10200, otherRatio: 2500 / 10200,
        denominator: 10200, ticker: 'DRAM',
    });
    await hoverDate(page, '2026-07-14');
    await expect.poll(readAllocation).toEqual({
        cashRatio: 7400 / 10000, tickerRatio: 100 / 10000, otherRatio: 2500 / 10000,
        denominator: 10000, ticker: 'DRAM',
    });
    await expect(page.locator(allocationSelector)).toHaveAttribute('data-date', '2026-07-14');
    const segments = await page.locator(allocationSelector).evaluate((element) => {
        const bar = element.querySelector('[data-investment-stock-allocation-bar]');
        const cash = element.querySelector('[data-investment-stock-allocation-cash]').getBoundingClientRect();
        const ticker = element.querySelector('[data-investment-stock-allocation-ticker]').getBoundingClientRect();
        const other = element.querySelector('[data-investment-stock-allocation-other]').getBoundingClientRect();
        return {
            cash: cash.width, ticker: ticker.width, other: other.width,
            width: bar.getBoundingClientRect().width,
            order: Array.from(bar.children).map((segment) => (
                ['ticker', 'cash', 'other'].find((kind) => segment.hasAttribute(`data-investment-stock-allocation-${kind}`))
            )),
        };
    });
    expect(segments.order).toEqual(['ticker', 'other', 'cash']);
    expect(segments.cash / segments.width).toBeCloseTo(7400 / 10000, 3);
    expect(segments.ticker / segments.width).toBeCloseTo(100 / 10000, 3);
    expect(segments.other / segments.width).toBeCloseTo(2500 / 10000, 3);
    expect(segments.cash + segments.ticker + segments.other).toBeCloseTo(segments.width, 1);
    await expect(page.locator(`${allocationSelector} .strategy-allocation-label-name`)).toHaveText(['DRAM', 'Cash']);
    await expect(page.locator(`${allocationSelector} .strategy-allocation-label-value`)).toHaveText(['1.00%', '74.00%']);
    await expect(page.locator(`${chipsSelector} [data-investment-stock-chips-date]`)).toHaveCount(0);
    await expect(page.locator(`${chipsSelector} [data-investment-stock-chips-summary]`)).toHaveCount(0);
    await expect(page.locator(chipsSelector)).not.toContainText(/USD|Jul 2026/);
    await expect(page.locator(chipsCanvasSelector)).toHaveAttribute('aria-label', /Cost distribution on 14 Jul 2026/);
    await page.mouse.move(0, 0);
    await expect(page.locator(allocationSelector)).toHaveAttribute('data-date', '2026-07-17');
    for (const width of [1_280, 390]) {
        await page.setViewportSize({width, height: 1_000});
        const layout = await page.locator(allocationSelector).evaluate((element) => {
            const labels = [...element.querySelectorAll('.strategy-allocation-label')];
            const bar = element.querySelector('[data-investment-stock-allocation-bar]').getBoundingClientRect();
            const bounds = element.getBoundingClientRect();
            const details = labels.map((label) => {
                const name = label.querySelector('.strategy-allocation-label-name');
                const value = label.querySelector('.strategy-allocation-label-value');
                const style = getComputedStyle(label);
                const rect = label.getBoundingClientRect();
                return {
                    nameFontSize: getComputedStyle(name).fontSize,
                    valueFontSize: getComputedStyle(value).fontSize,
                    titleToken: style.getPropertyValue('--strategy-range-title-font-size').trim(),
                    detailToken: style.getPropertyValue('--strategy-range-detail-font-size').trim(),
                    stacked: name.getBoundingClientRect().bottom <= value.getBoundingClientRect().top + 1,
                    aboveBar: rect.bottom <= bar.top + 1,
                    contained: rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1,
                };
            });
            return {height: bounds.height, details, separated: labels[0].getBoundingClientRect().right <= labels[1].getBoundingClientRect().left};
        });
        expect(layout.height).toBeLessThanOrEqual(64);
        expect(layout.separated).toBe(true);
        expect(layout.details).toHaveLength(2);
        for (const label of layout.details) {
            expect(label.nameFontSize).toBe(label.titleToken);
            expect(label.valueFontSize).toBe(label.detailToken);
            expect(label.stacked).toBe(true);
            expect(label.aboveBar).toBe(true);
            expect(label.contained).toBe(true);
        }
    }
    expect(writes).toEqual([]);
});

test('keeps an unpriced incoming transfer unavailable instead of showing a zero-cost lot', async ({page}) => {
    const writes = await openChipDetails(page, {
        expectChart: false,
        rows: [{ledger_no: 1, broker: 'ibkr', date: '2026-07-14', type: 'transfer_in', ticker: 'DRAM', currency: 'USD', quantity: 5, amount: 0}],
    });
    await expect(page.locator(priceCanvasSelector)).toHaveCount(0);
    await expect(page.locator(chipsSelector)).toHaveAttribute('data-status', 'unavailable');
    await expect(page.locator(chipsSelector).locator('[data-investment-stock-chips-empty]'))
        .toHaveText('Cost history unavailable.');
    await expect(page.locator(chipsCanvasSelector)).toHaveAttribute('aria-label', 'Personal cost history unavailable');
    expect(writes).toEqual([]);
});

test('recolors the latest personal lots with live quotes while historical hover keeps its own close', async ({page}) => {
    await installStockDetailsClock(page, '2026-07-27T12:00:00Z', true);
    let livePrice = 15;
    const writes = [];
    page.on('request', (request) => {
        if (request.method() !== 'GET' && request.url().includes('/api/investment/')) {
            writes.push({method: request.method(), path: new URL(request.url()).pathname});
        }
    });
    await mockInvestmentReadApis(page, {
        transactions: [{ledger_no: 1, broker: 'ibkr', date: '2026-07-23', type: 'buy', ticker: 'DRAM', currency: 'USD', quantity: 10, price: 20, amount: -200}],
        startingCash: 10_000,
        priceHistoryByTicker: {DRAM: [
            {date: '2026-07-22', close: 19},
            {date: '2026-07-23', close: 20},
            {date: '2026-07-24', close: 18},
        ]},
        tickerProfiles: {DRAM: {ticker: 'DRAM', company_name: 'Roundhill Memory ETF'}},
        realtimeQuotes: () => [{
            ticker: 'DRAM', price: livePrice, timestamp: '2026-07-27 08:00',
            session: 'pre', session_date: '2026-07-27', market: 'US', source: 'longbridge',
        }],
        marketSession: {
            session: 'pre', session_date: '2026-07-27',
            is_trading_day: true, is_realtime_allowed: true,
        },
        intradayRows: () => [],
    });
    await page.emulateMedia({reducedMotion: 'reduce'});
    await page.setViewportSize({width: 1_280, height: 1_000});
    await page.goto('/trade/investment?view=stock-details&ticker=DRAM&range=ytd');
    await expect(page.locator(priceCanvasSelector)).toBeVisible();
    await expect.poll(() => readChips(page)).toEqual({
        date: '2026-07-27', price: 15, currency: 'USD', status: 'ready', totalQuantity: 10,
        bins: [{price: 20, quantity: 10, side: 'long', profitable: false}],
    });
    await expect.poll(() => page.evaluate(() => typeof window.__testTriggerStockDetailsRealtimePoll)).toBe('function');
    livePrice = 25;
    const quoteResponse = page.waitForResponse((response) => response.url().includes('/api/investment/realtime-quotes'));
    await page.evaluate(() => window.__testTriggerStockDetailsRealtimePoll());
    await quoteResponse;
    await expect.poll(() => readChips(page)).toEqual({
        date: '2026-07-27', price: 25, currency: 'USD', status: 'ready', totalQuantity: 10,
        bins: [{price: 20, quantity: 10, side: 'long', profitable: true}],
    });
    await hoverDate(page, '2026-07-24');
    await expect.poll(() => readChips(page)).toEqual({
        date: '2026-07-24', price: 18, currency: 'USD', status: 'ready', totalQuantity: 10,
        bins: [{price: 20, quantity: 10, side: 'long', profitable: false}],
    });
    await page.mouse.move(0, 0);
    await expect.poll(() => readChips(page)).toEqual(expect.objectContaining({
        date: '2026-07-27', price: 25, totalQuantity: 10,
        bins: [{price: 20, quantity: 10, side: 'long', profitable: true}],
    }));
    expect(writes).toEqual([]);
});
