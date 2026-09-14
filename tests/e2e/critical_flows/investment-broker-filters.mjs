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
test('keeps default broker checks without preselecting every active option background', async ({page}) => {
    await mockInvestmentReadApis(page);
    await page.setViewportSize({width: 1_064, height: 863});
    await page.goto('/trade/investment');

    const brokerTrigger = page.locator('#history_table_wrap [data-investment-broker-filter-trigger]');
    await brokerTrigger.click();
    const allOption = page.getByRole('option', {name: 'All', exact: true});
    const ibkrOption = page.getByRole('option', {name: 'IBKR', exact: true});

    await expect(allOption).toHaveClass(/is-active/);
    await expect(ibkrOption).toHaveAttribute('aria-selected', 'true');
    await expect(ibkrOption).toHaveClass(/is-selected/);
    await expect(ibkrOption).not.toHaveClass(/is-active/);
    await expect.poll(() => ibkrOption.evaluate((element) => (
        getComputedStyle(element).backgroundColor
    ))).toBe('rgba(0, 0, 0, 0)');
});

test('keeps Type open for continuous selection until an outside click', async ({page}) => {
    await mockInvestmentReadApis(page, {
        transactions: [
            {broker: 'ibkr', date: '2026-07-10', type: 'buy', ticker: 'QQQ', currency: 'USD', quantity: 1, price: 500, amount: -500},
            {broker: 'ibkr', date: '2026-07-11', type: 'sell', ticker: 'QQQ', currency: 'USD', quantity: 1, price: 501, amount: 501},
            {broker: 'ibkr', date: '2026-07-12', type: 'dividend', ticker: 'QQQ', currency: 'USD', amount: 2},
        ],
    });
    await page.setViewportSize({width: 1_064, height: 863});
    await page.goto('/trade/investment');

    const typeHeader = page.locator('#history_table_wrap th[aria-label="Side"]');
    const historyRows = page.locator('#investment_history > tr:not([data-table-empty-row])');
    await expect(historyRows).toHaveCount(3);
    await typeHeader.hover();
    const typography = await typeHeader.evaluate((header) => {
        const defaultLabel = getComputedStyle(header.querySelector('.investment-side-filter-default-label'));
        const activeLabel = getComputedStyle(header.querySelector('[data-investment-side-filter-label]'));
        const readTypography = (styles) => ({
            fontFamily: styles.fontFamily,
            fontSize: styles.fontSize,
            fontWeight: styles.fontWeight,
            lineHeight: styles.lineHeight,
        });
        return {
            defaultLabel: readTypography(defaultLabel),
            activeLabel: readTypography(activeLabel),
        };
    });
    expect(typography.activeLabel).toEqual(typography.defaultLabel);

    await typeHeader.getByRole('button', {name: 'Type filter: All'}).click();
    await expect(page.getByRole('option', {name: 'All', exact: true})).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('option', {name: 'Buy', exact: true})).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('option', {name: 'Sell', exact: true})).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('option', {name: 'Dividend', exact: true})).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('option', {name: 'All', exact: true}).click();
    await expect(page.locator('#investment_history [data-table-empty-row]')).toContainText(
        'No transactions match the selected filters.',
    );
    await expect(typeHeader.getByRole('button', {name: 'Type filter: None'})).toBeVisible();
    await expect(typeHeader.getByRole('button', {name: 'Type filter: None'})).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('option', {name: 'All', exact: true})).toBeVisible();

    await page.getByRole('option', {name: 'Buy', exact: true}).click();
    await expect(historyRows).toHaveCount(1);
    await expect(typeHeader.getByRole('button', {name: 'Type filter: Buy'})).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('option', {name: 'Sell', exact: true})).toBeVisible();
    await page.getByRole('option', {name: 'Sell', exact: true}).click();
    await expect(historyRows).toHaveCount(2);
    await expect(typeHeader.getByRole('button', {name: 'Type filter: Buy, Sell'})).toHaveAttribute('aria-expanded', 'true');
    await page.getByRole('option', {name: 'Dividend', exact: true}).click();
    await expect(historyRows).toHaveCount(3);
    await expect(typeHeader.getByRole('button', {name: 'Type filter: All'})).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('option', {name: 'All', exact: true})).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('option', {name: 'Buy', exact: true})).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('option', {name: 'Sell', exact: true})).toHaveAttribute('aria-selected', 'true');
    await page.locator('#investment_history_surface .chart-heading').click();
    await expect(page.getByRole('option', {name: 'All', exact: true})).toBeHidden();
    await expect(typeHeader.getByRole('button', {name: 'Type filter: All'})).toHaveAttribute('aria-expanded', 'false');
});

test('uses the Type hover disclosure contract for Description and Currency filters', async ({page}) => {
    await mockInvestmentReadApis(page, {
        brokers: ['hsbc', 'ibkr'],
        transactions: [
            {
                ledger_no: 1,
                broker: 'hsbc',
                date: '2026-07-10',
                type: 'deposit',
                currency: 'HKD',
                amount: 500,
                description: 'Unbound receiving deposit',
            },
            {
                ledger_no: 2,
                broker: 'ibkr',
                date: '2026-07-10',
                type: 'withdrawal',
                currency: 'HKD',
                amount: -500,
                description: 'Unbound transfer outflow',
            },
        ],
    });
    await page.setViewportSize({width: 1_064, height: 863});
    await page.goto('/trade/investment');

    const compactFilters = [
        {
            name: 'Type',
            header: page.locator('#history_table_wrap th[aria-label="Side"]'),
            hoverTarget: page.locator('#history_table_wrap th[aria-label="Side"]'),
        },
        {
            name: 'Description',
            header: page.locator('#history_table_wrap th[data-markdown-export-label="Description"]'),
            hoverTarget: page.locator('#history_table_wrap th[data-markdown-export-label="Description"] > div[data-investment-description-filter]'),
        },
        {
            name: 'Currency',
            header: page.locator('#history_table_wrap th[aria-label="Currency"]'),
            hoverTarget: page.locator('#history_table_wrap th[aria-label="Currency"]'),
        },
    ];
    const typeReference = await compactFilters[0].header.evaluate((header) => {
        const activeLabel = header.querySelector('[data-investment-side-filter-label]');
        const style = activeLabel ? getComputedStyle(activeLabel) : null;
        return style ? {
            fontFamily: style.fontFamily,
            fontSize: style.fontSize,
            fontWeight: style.fontWeight,
            lineHeight: style.lineHeight,
            justifyContent: style.justifyContent,
        } : null;
    });
    expect(typeReference).not.toBeNull();

    for (const {name, header, hoverTarget} of compactFilters) {
        await expect(header).toHaveCount(1);
        await expect(hoverTarget).toHaveCount(1);
        await hoverTarget.hover({force: true});
        await expect.poll(() => header.evaluate((element) => {
            const defaultLabel = element.querySelector('.scrollable-data-table-filter-default-label');
            const field = element.querySelector('.scrollable-data-table-filter-field');
            const activeLabel = element.querySelector('.trade-strategy-trigger-label');
            const defaultStyle = defaultLabel ? getComputedStyle(defaultLabel) : null;
            const fieldStyle = field ? getComputedStyle(field) : null;
            const activeStyle = activeLabel ? getComputedStyle(activeLabel) : null;
            return {
                defaultOpacity: defaultStyle?.opacity,
                fieldOpacity: fieldStyle?.opacity,
                activeText: activeLabel?.textContent?.trim(),
                activeTypography: activeStyle ? {
                    fontFamily: activeStyle.fontFamily,
                    fontSize: activeStyle.fontSize,
                    fontWeight: activeStyle.fontWeight,
                    lineHeight: activeStyle.lineHeight,
                    justifyContent: activeStyle.justifyContent,
                } : null,
            };
        }), {message: `${name} filter hover state`}).toEqual({
            defaultOpacity: '0',
            fieldOpacity: '1',
            activeText: 'All',
            activeTypography: typeReference,
        });
    }
});

test('fills the current 1W session axis and stops its realtime curve at the New York minute', async ({page}) => {
    await page.addInitScript(() => {
        const RealDate = Date;
        let fixedTimestamp = new RealDate('2026-08-11T13:42:00Z').valueOf();
        class FixedDate extends RealDate {
            constructor(...args) {
                super(...(args.length ? args : [fixedTimestamp]));
            }

            static now() {
                return fixedTimestamp;
            }
        }
        window.Date = FixedDate;
        window.__setInvestmentOverviewNow = (value) => {
            fixedTimestamp = new RealDate(value).valueOf();
        };

        const nativeSetTimeout = window.setTimeout.bind(window);
        window.setTimeout = (callback, delay, ...args) => {
            if (delay === 60_000 && typeof callback === 'function') {
                window.__testTriggerInvestmentOverviewIntradayPoll = () => callback(...args);
                return 0;
            }
            return nativeSetTimeout(callback, delay, ...args);
        };
    });
    const tradingDays = [
        '2026-07-10',
        '2026-07-13', '2026-07-14', '2026-07-15', '2026-07-16', '2026-07-17',
        '2026-07-20', '2026-07-21', '2026-07-22', '2026-07-23', '2026-07-24',
        '2026-07-27', '2026-07-28', '2026-07-29', '2026-07-30', '2026-07-31',
        '2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07',
        '2026-08-10', '2026-08-11',
    ];
    let quotePrice = 120;
    let marketAsOf = '2026-08-11T09:42:00-04:00';
    const marketSessionDayCounts = [];
    const liveQuotes = () => [{
        ticker: 'QQQ',
        price: quotePrice,
        timestamp: '',
        session: 'intraday',
        session_date: '2026-08-11',
        market: 'US',
        source: 'longbridge',
    }];
    await mockInvestmentReadApis(page, {
        transactions: [
            {
                ledger_no: 1,
                broker: 'ibkr',
                date: '2026-08-04',
                type: 'buy',
                ticker: 'QQQ',
                currency: 'USD',
                quantity: 1,
                price: 100,
                amount: -100,
            },
        ],
        tradingDays,
        priceHistoryByTicker: {
            QQQ: tradingDays.map((date) => ({date, close: 100})),
        },
        realtimeQuotes: liveQuotes,
        marketSession: (url) => {
            const dayCount = Number(url.searchParams.get('day_count')) || 5;
            marketSessionDayCounts.push(dayCount);
            return {
                session: 'intraday',
                is_trading_day: true,
                is_realtime_allowed: true,
                session_date: '2026-08-11',
                as_of: marketAsOf,
                trading_days: tradingDays.slice(-dayCount),
            };
        },
        intradayRows: (url) => {
            const requestedDays = String(url.searchParams.get('days') || '').split(',').filter(Boolean);
            return requestedDays.flatMap((day) => {
                const minuteCount = day === '2026-08-11' ? 12 : 390;
                return Array.from({length: minuteCount}, (_, minuteOffset) => {
                    const totalMinutes = (9 * 60) + 30 + minuteOffset;
                    const hours = String(Math.floor(totalMinutes / 60)).padStart(2, '0');
                    const minutes = String(totalMinutes % 60).padStart(2, '0');
                    const close = 100 + (minuteOffset * 0.01);
                    return {
                        date: `${day} ${hours}:${minutes}`,
                        open: close,
                        high: close,
                        low: close,
                        close,
                    };
                });
            });
        },
    });
    await page.setViewportSize({width: 1_024, height: 863});
    await page.goto('/trade/investment?view=overview&range=1w');

    const readCurveState = () => page.evaluate(() => {
        const chart = window.Chart?.getChart(document.querySelector('#investmentEquityChart'));
        const labels = chart?.data?.rawLabels || [];
        const values = chart?.data?.datasets?.[0]?.data || [];
        const finiteIndexes = values
            .map((value, index) => Number.isFinite(value) ? index : -1)
            .filter((index) => index >= 0);
        const lastFiniteIndex = finiteIndexes[finiteIndexes.length - 1] ?? -1;
        const currentIndex = labels.indexOf('2026-08-11 09:42');
        return {
            labelCount: labels.length,
            firstCurrentDayLabel: labels.find((label) => label.startsWith('2026-08-11')) || '',
            finalAxisLabel: labels[labels.length - 1] || '',
            lastFiniteLabel: labels[lastFiniteIndex] || '',
            currentValue: currentIndex >= 0 ? values[currentIndex] : null,
            futureValuesAreNull: values.slice(currentIndex + 1).every((value) => value === null),
            holdingsTotalEquity: Number(
                document.querySelector('[data-investment-live-field="summary_total_equity"]')
                    ?.dataset.investmentLiveNumber,
            ),
        };
    });
    await expect.poll(readCurveState, {timeout: 30_000}).toEqual({
        labelCount: 5 * 390,
        firstCurrentDayLabel: '2026-08-11 09:30',
        finalAxisLabel: '2026-08-11 15:59',
        lastFiniteLabel: '2026-08-11 09:42',
        currentValue: 10_020,
        futureValuesAreNull: true,
        holdingsTotalEquity: 10_020,
    });
    await expect.poll(() => page.locator('[data-investment-equity-live-marker]').evaluate(
        (element) => !element.hidden,
    )).toBe(true);

    const tooltip = page.locator('[data-investment-chart-tooltip="1"]');
    const activateCurveMinuteTooltip = async (minuteKey) => {
        await expect.poll(() => page.evaluate((label) => {
            const canvas = document.querySelector('#investmentEquityChart');
            const chart = window.Chart?.getChart(canvas);
            const index = chart?.data?.rawLabels?.indexOf(label) ?? -1;
            const element = index >= 0 ? chart?.getDatasetMeta(0)?.data?.[index] : null;
            if (!chart || !element || element.skip) return false;
            const center = element.getCenterPoint();
            chart.setActiveElements([{datasetIndex: 0, index}]);
            chart.tooltip?.setActiveElements(
                [{datasetIndex: 0, index}],
                {x: center.x, y: center.y},
            );
            chart.update('none');
            return true;
        }, minuteKey)).toBe(true);
        await expect(tooltip).toHaveClass(/is-visible/);
    };
    const readTooltipPnl = () => tooltip.locator('.chart-tooltip-row').evaluateAll((rows) => (
        rows.slice(-3).map((row) => ({
            label: row.querySelector('.chart-tooltip-label')?.textContent || '',
            value: Number(
                String(row.querySelector('.chart-tooltip-value')?.textContent || '')
                    .replace(/[^0-9.-]/g, ''),
            ),
        }))
    ));
    const expectTooltipPnlAtInstant = async (expectedRows) => {
        await expect.poll(readTooltipPnl).toEqual(expectedRows);
        const [realizedRow, unrealizedRow, cumulativeRow] = await readTooltipPnl();
        expect(cumulativeRow.value).toBe(Number(
            (realizedRow.value + unrealizedRow.value).toFixed(2),
        ));
    };

    await activateCurveMinuteTooltip('2026-08-11 09:42');
    await expect(tooltip.locator('.chart-tooltip-date')).toHaveText('11 Aug 2026 09:42');
    await expectTooltipPnlAtInstant([
        {label: 'Realized P&L', value: 0},
        {label: 'Unrealized P&L', value: 20},
        {label: 'Cumulative P&L', value: 20},
    ]);

    quotePrice = 125;
    marketAsOf = '2026-08-11T09:43:00-04:00';
    await page.evaluate(() => window.__setInvestmentOverviewNow('2026-08-11T13:43:00Z'));
    await expect.poll(() => page.evaluate(() => (
        typeof window.__testTriggerInvestmentOverviewIntradayPoll
    ))).toBe('function');
    const realtimeResponse = page.waitForResponse((response) => (
        response.url().includes('/api/investment/realtime-quotes')
    ));
    await page.evaluate(() => window.__testTriggerInvestmentOverviewIntradayPoll());
    await realtimeResponse;
    await expect.poll(() => page.evaluate(() => {
        const chart = window.Chart?.getChart(document.querySelector('#investmentEquityChart'));
        const labels = chart?.data?.rawLabels || [];
        const values = chart?.data?.datasets?.[0]?.data || [];
        const firstLiveIndex = labels.indexOf('2026-08-11 09:42');
        const secondLiveIndex = labels.indexOf('2026-08-11 09:43');
        const finiteIndexes = values
            .map((value, index) => Number.isFinite(value) ? index : -1)
            .filter((index) => index >= 0);
        return {
            firstLiveValue: values[firstLiveIndex],
            secondLiveValue: values[secondLiveIndex],
            lastFiniteLabel: labels[finiteIndexes[finiteIndexes.length - 1]],
            futureValuesAreNull: values.slice(secondLiveIndex + 1).every((value) => value === null),
        };
    })).toEqual({
        firstLiveValue: 10_020,
        secondLiveValue: 10_025,
        lastFiniteLabel: '2026-08-11 09:43',
        futureValuesAreNull: true,
    });

    await activateCurveMinuteTooltip('2026-08-11 09:43');
    await expect(tooltip.locator('.chart-tooltip-date')).toHaveText('11 Aug 2026 09:43');
    await expectTooltipPnlAtInstant([
        {label: 'Realized P&L', value: 0},
        {label: 'Unrealized P&L', value: 25},
        {label: 'Cumulative P&L', value: 25},
    ]);

    await activateCurveMinuteTooltip('2026-08-11 09:42');
    await expect(tooltip.locator('.chart-tooltip-date')).toHaveText('11 Aug 2026 09:42');
    await expectTooltipPnlAtInstant([
        {label: 'Realized P&L', value: 0},
        {label: 'Unrealized P&L', value: 20},
        {label: 'Cumulative P&L', value: 20},
    ]);

    await page.locator('label[for="investment_equity_range_1m"]').click();
    await expect.poll(() => page.evaluate(() => {
        const chart = window.Chart?.getChart(document.querySelector('#investmentEquityChart'));
        const labels = chart?.data?.rawLabels || [];
        const values = chart?.data?.datasets?.[0]?.data || [];
        const historicalIndex = labels.indexOf('2026-08-10 09:30');
        const currentIndex = labels.indexOf('2026-08-11 09:43');
        const finiteIndexes = values
            .map((value, index) => Number.isFinite(value) ? index : -1)
            .filter((index) => index >= 0);
        return {
            labelCount: labels.length,
            finalAxisLabel: labels[labels.length - 1] || '',
            historicalValue: values[historicalIndex],
            lastFiniteLabel: labels[finiteIndexes[finiteIndexes.length - 1]] || '',
            futureValuesAreNull: values.slice(currentIndex + 1).every((value) => value === null),
        };
    }), {timeout: 30_000}).toEqual({
        labelCount: 23 * 390,
        finalAxisLabel: '2026-08-11 15:59',
        historicalValue: 10_000,
        lastFiniteLabel: '2026-08-11 09:43',
        futureValuesAreNull: true,
    });

    quotePrice = 130;
    marketAsOf = '2026-08-11T09:44:00-04:00';
    await page.evaluate(() => window.__setInvestmentOverviewNow('2026-08-11T13:44:00Z'));
    const sessionRequestCountBeforeSecondPoll = marketSessionDayCounts.length;
    const secondRealtimeResponse = page.waitForResponse((response) => (
        response.url().includes('/api/investment/realtime-quotes')
    ));
    await page.evaluate(() => window.__testTriggerInvestmentOverviewIntradayPoll());
    await secondRealtimeResponse;
    expect(marketSessionDayCounts.length).toBeGreaterThan(sessionRequestCountBeforeSecondPoll);
    expect(marketSessionDayCounts.at(-1)).toBe(23);
    await expect.poll(() => page.evaluate(() => {
        const chart = window.Chart?.getChart(document.querySelector('#investmentEquityChart'));
        const labels = chart?.data?.rawLabels || [];
        const values = chart?.data?.datasets?.[0]?.data || [];
        const currentIndex = labels.indexOf('2026-08-11 09:44');
        const finiteIndexes = values
            .map((value, index) => Number.isFinite(value) ? index : -1)
            .filter((index) => index >= 0);
        return {
            labelCount: labels.length,
            currentValue: values[currentIndex],
            lastFiniteLabel: labels[finiteIndexes[finiteIndexes.length - 1]] || '',
            futureValuesAreNull: values.slice(currentIndex + 1).every((value) => value === null),
        };
    })).toEqual({
        labelCount: 23 * 390,
        currentValue: 10_030,
        lastFiniteLabel: '2026-08-11 09:44',
        futureValuesAreNull: true,
    });

    await activateCurveMinuteTooltip('2026-08-11 09:44');
    await expect(tooltip.locator('.chart-tooltip-date')).toHaveText('11 Aug 2026 09:44');
    await expectTooltipPnlAtInstant([
        {label: 'Realized P&L', value: 0},
        {label: 'Unrealized P&L', value: 30},
        {label: 'Cumulative P&L', value: 30},
    ]);
});

test('keeps the completed regular curve and appends an overnight live equity marker', async ({page}) => {
    await page.addInitScript(() => {
        const RealDate = Date;
        const fixedTimestamp = new RealDate('2026-08-12T06:00:00Z').valueOf();
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
    const tradingDays = [
        '2026-08-05',
        '2026-08-06',
        '2026-08-07',
        '2026-08-10',
        '2026-08-11',
    ];
    await mockInvestmentReadApis(page, {
        transactions: [
            {
                ledger_no: 1,
                broker: 'ibkr',
                date: '2026-08-04',
                type: 'buy',
                ticker: 'QQQ',
                currency: 'USD',
                quantity: 1,
                price: 100,
                amount: -100,
            },
        ],
        tradingDays,
        priceHistoryByTicker: {
            QQQ: tradingDays.map((date) => ({date, close: 100})),
        },
        realtimeQuotes: [{
            ticker: 'QQQ',
            price: 120,
            timestamp: '2026-08-12 02:00',
            session: 'overnight',
            session_date: '2026-08-12',
            market: 'US',
            source: 'longbridge',
        }],
        marketSession: {
            session: 'overnight',
            is_trading_day: true,
            is_realtime_allowed: true,
            session_date: '2026-08-12',
            as_of: '2026-08-12T02:00:00-04:00',
        },
        intradayRows: (url) => {
            const requestedDays = String(url.searchParams.get('days') || '').split(',').filter(Boolean);
            return requestedDays.flatMap((day) => Array.from({length: 390}, (_, minuteOffset) => {
                const totalMinutes = (9 * 60) + 30 + minuteOffset;
                const hours = String(Math.floor(totalMinutes / 60)).padStart(2, '0');
                const minutes = String(totalMinutes % 60).padStart(2, '0');
                const close = 100 + (minuteOffset * 0.01);
                return {
                    date: `${day} ${hours}:${minutes}`,
                    open: close,
                    high: close,
                    low: close,
                    close,
                };
            }));
        },
    });
    await page.setViewportSize({width: 1_024, height: 863});
    await page.goto('/trade/investment?view=overview&range=1w');

    await expect.poll(() => page.evaluate(() => {
        const chart = window.Chart?.getChart(document.querySelector('#investmentEquityChart'));
        const labels = chart?.data?.rawLabels || [];
        const values = chart?.data?.datasets?.[0]?.data || [];
        const currentDayValues = labels
            .map((label, index) => ({label, value: values[index]}))
            .filter(({label}) => label.startsWith('2026-08-11'));
        const marker = document.querySelector('[data-investment-equity-live-marker]');
        return {
            labelCount: labels.length,
            historicalStart: currentDayValues[0]?.value ?? null,
            historicalEnd: currentDayValues.at(-1)?.value ?? null,
            lastLabel: labels.at(-1) || '',
            lastValue: values.at(-1) ?? null,
            markerHidden: marker?.hidden ?? true,
            holdingsTotalEquity: Number(
                document.querySelector('[data-investment-live-field="summary_total_equity"]')
                    ?.dataset.investmentLiveNumber,
            ),
        };
    }), {timeout: 30_000}).toEqual({
        labelCount: (5 * 390) + 1,
        historicalStart: 10_000,
        historicalEnd: 10_003.89,
        lastLabel: '2026-08-12 02:00',
        lastValue: 10_020,
        markerHidden: false,
        holdingsTotalEquity: 10_020,
    });

    const markerState = await page.locator('[data-investment-equity-live-marker]').evaluate((element) => {
        const chart = window.Chart?.getChart(document.querySelector('#investmentEquityChart'));
        const lastIndex = chart.data.labels.length - 1;
        const lastValue = Number(chart.data.datasets[0].data[lastIndex]);
        return {
            left: Number.parseFloat(element.style.left),
            top: Number.parseFloat(element.style.top),
            expectedLeft: chart.scales.x.getPixelForValue(lastIndex),
            expectedTop: chart.scales.y.getPixelForValue(lastValue),
        };
    });
    expect(Math.abs(markerState.left - markerState.expectedLeft)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(markerState.top - markerState.expectedTop)).toBeLessThanOrEqual(0.5);
});

test('renders the 1M investment equity curve from the requested high-precision calendar', async ({page}) => {
    const tradingDays = [
        '2026-06-15', '2026-06-16', '2026-06-17', '2026-06-18', '2026-06-19',
        '2026-06-22', '2026-06-23', '2026-06-24', '2026-06-25', '2026-06-26',
        '2026-06-29', '2026-06-30', '2026-07-01', '2026-07-02', '2026-07-03',
        '2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09', '2026-07-10',
        '2026-07-13', '2026-07-14', '2026-07-15',
    ];
    await mockInvestmentReadApis(page, {
        transactions: [
            {broker: 'ibkr', date: '2026-06-01', type: 'buy', ticker: 'QQQ', currency: 'USD', quantity: 1, price: 500, amount: -500},
        ],
        tradingDays,
        intradayRows: (url) => {
            const requestedDays = String(url.searchParams.get('days') || '').split(',').filter(Boolean);
            return requestedDays.slice(-2).flatMap((day, dayIndex) => Array.from({length: 390}, (_, minuteOffset) => {
                const totalMinutes = (9 * 60) + 30 + minuteOffset;
                const hours = String(Math.floor(totalMinutes / 60)).padStart(2, '0');
                const minutes = String(totalMinutes % 60).padStart(2, '0');
                const close = 500 + (dayIndex * 390) + minuteOffset;
                return {date: `${day} ${hours}:${minutes}`, open: close, high: close, low: close, close};
            }));
        },
    });
    await page.addInitScript(() => {
        const originalFillText = CanvasRenderingContext2D.prototype.fillText;
        CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
            if (this.canvas?.id === 'investmentEquityChart') {
                window.__investmentEquityCanvasLabels = [
                    ...(window.__investmentEquityCanvasLabels || []),
                    String(text),
                ];
            }
            return originalFillText.call(this, text, ...args);
        };
    });
    await page.setViewportSize({width: 919, height: 1_090});
    await page.goto('/trade/investment');
    await expect.poll(() => page.evaluate(() => Boolean(window.Chart?.getChart?.(document.querySelector('#investmentEquityChart'))))).toBe(true);

    await page.evaluate(() => {
        window.__investmentEquityCanvasLabels = [];
    });
    await page.locator('label[for="investment_equity_range_1m"]').click();
    await expect.poll(() => page.evaluate(() => {
        const canvas = document.querySelector('#investmentEquityChart');
        const chart = window.Chart?.getChart(canvas);
        const values = chart?.data?.datasets?.[0]?.data || [];
        const stack = canvas?.closest('.investment-chart-stack');
        return {
            labelCount: chart?.data?.labels?.length || 0,
            finiteCount: values.filter(Number.isFinite).length,
            yScaleMax: Number(chart?.options?.scales?.y?.max),
            dataMax: Math.max(...values.filter(Number.isFinite)),
            peakGuard: getComputedStyle(stack).getPropertyValue('--investment-equity-peak-guard').trim(),
        };
    }), {timeout: 30_000}).toEqual(expect.objectContaining({
        labelCount: 23 * 390,
        finiteCount: 2 * 390,
        peakGuard: '5px',
    }));
    const scaleSafety = await page.evaluate(() => {
        const canvas = document.querySelector('#investmentEquityChart');
        const chart = window.Chart?.getChart(canvas);
        const values = chart.data.datasets[0].data.filter(Number.isFinite);
        return {dataMax: Math.max(...values), yScaleMax: Number(chart.options.scales.y.max)};
    });
    expect(scaleSafety.yScaleMax).toBeGreaterThan(scaleSafety.dataMax);

    const expectDateOnlyAxisLabels = async () => {
        await expect.poll(() => page.evaluate(() => {
            const labels = window.__investmentEquityCanvasLabels || [];
            return {
                hasDate: labels.some((label) => /^\d{1,2} [A-Za-z]{3}$/.test(label)),
                hasYear: labels.some((label) => /^\d{4}$/.test(label)),
                timeCount: labels.filter((label) => /\b\d{1,2}:\d{2}\b/.test(label)).length,
            };
        })).toEqual({
            hasDate: true,
            hasYear: true,
            timeCount: 0,
        });
    };
    await expectDateOnlyAxisLabels();

    await page.evaluate(() => {
        window.__investmentEquityCanvasLabels = [];
    });
    await page.locator('label[for="investment_equity_range_1w"]').click();
    await expect.poll(() => page.evaluate(() => {
        const canvas = document.querySelector('#investmentEquityChart');
        return window.Chart?.getChart(canvas)?.data?.labels?.length || 0;
    }), {timeout: 30_000}).toBe(5 * 390);
    await expectDateOnlyAxisLabels();
});

test('carries each ticker intraday close forward across interleaved missing bars', async ({page}) => {
    const tradingDays = [
        '2026-06-15', '2026-06-16', '2026-06-17', '2026-06-18', '2026-06-19',
    ];
    await mockInvestmentReadApis(page, {
        transactions: [
            {broker: 'ibkr', date: '2026-06-01', type: 'buy', ticker: 'QQQ', currency: 'USD', quantity: 1, price: 100, amount: -100},
            {broker: 'ibkr', date: '2026-06-01', type: 'buy', ticker: 'SPY', currency: 'USD', quantity: 1, price: 200, amount: -200},
        ],
        tradingDays,
        priceHistoryByTicker: {
            QQQ: [{date: '2026-06-01', close: 100}],
            SPY: [{date: '2026-06-01', close: 200}],
        },
        intradayRows: (url) => {
            const ticker = String(url.searchParams.get('ticker') || '');
            const requestedDays = String(url.searchParams.get('days') || '').split(',').filter(Boolean);
            return requestedDays.flatMap((day) => {
                const bars = ticker === 'QQQ'
                    ? [
                        ['09:30', 100], ['09:32', 102], ['09:34', 104], ['09:36', 106],
                        ['09:38', 108], ['09:40', 110], ['09:42', 112], ['09:44', 114],
                    ]
                    : [
                        ['09:31', 201], ['09:33', 203], ['09:35', 205], ['09:37', 207],
                        ['09:39', 209], ['09:41', 211], ['09:43', 213], ['09:45', 215],
                    ];
                return bars.map(([time, close]) => ({
                    date: `${day} ${time}`,
                    open: close,
                    high: close,
                    low: close,
                    close,
                }));
            });
        },
    });
    await page.goto('/trade/investment');
    await page.locator('label[for="investment_equity_range_1w"]').click();
    await expect.poll(() => page.evaluate(() => {
        const chart = window.Chart?.getChart(document.querySelector('#investmentEquityChart'));
        return (chart?.data?.rawLabels || []).map((date, index) => ({
            date,
            value: chart.data.datasets?.[0]?.data?.[index] ?? null,
        })).filter((point) => point.date.startsWith('2026-06-15 09:3')).slice(0, 4);
    }).then((points) => points.map((point) => point.value)), {timeout: 30_000}).toEqual([
        null, 10_001, 10_003, 10_005,
    ]);
});

test('replays trusted intraday fills by minute and carries date-only trades into the next session', async ({page}) => {
    const tradingDays = [
        '2026-06-15', '2026-06-16', '2026-06-17', '2026-06-18', '2026-06-19',
    ];
    await mockInvestmentReadApis(page, {
        transactions: [
            {
                broker: 'ibkr',
                date: '2026-06-12',
                type: 'buy',
                ticker: 'QQQ',
                currency: 'USD',
                quantity: 10,
                price: 100,
                amount: -1_000,
            },
            {
                broker: 'ibkr',
                date: '2026-06-15',
                datetime: '2026-06-15 10:00:00',
                type: 'buy',
                ticker: 'QQQ',
                currency: 'USD',
                quantity: 5,
                price: 102,
                amount: -510,
                source: {source_has_intraday_timestamp: true},
            },
            {
                broker: 'ibkr',
                date: '2026-06-15',
                datetime: '2026-06-15 10:02:00',
                type: 'sell',
                ticker: 'QQQ',
                currency: 'USD',
                quantity: 3,
                price: 105,
                amount: 315,
                source: {source_has_intraday_timestamp: true},
            },
            {
                broker: 'ibkr',
                date: '2026-06-15',
                datetime: '2026-06-15 20:00:00',
                type: 'buy',
                ticker: 'QQQ',
                currency: 'USD',
                quantity: 2,
                price: 106,
                amount: -212,
                source: {source_has_intraday_timestamp: false},
            },
        ],
        tradingDays,
        priceHistoryByTicker: {
            QQQ: [
                {date: '2026-06-12', close: 100},
                {date: '2026-06-15', close: 105},
                {date: '2026-06-16', close: 106},
            ],
        },
        intradayRows: (url) => {
            const requestedDays = String(url.searchParams.get('days') || '').split(',').filter(Boolean);
            return requestedDays.flatMap((day) => {
                const closes = day === '2026-06-15'
                    ? [['09:30', 100], ['10:00', 102], ['10:01', 103], ['10:02', 104], ['10:03', 105]]
                    : day === '2026-06-16'
                        ? [['09:30', 106]]
                        : [['09:30', 106]];
                return closes.map(([time, close]) => ({
                    date: `${day} ${time}`,
                    open: close,
                    high: close,
                    low: close,
                    close,
                }));
            });
        },
    });
    await page.goto('/trade/investment');
    await page.locator('label[for="investment_equity_range_1w"]').click();
    await expect.poll(() => page.evaluate(() => {
        const chart = window.Chart?.getChart(document.querySelector('#investmentEquityChart'));
        const valuesByMinute = new Map((chart?.data?.rawLabels || []).map((date, index) => [
            date,
            chart?.data?.datasets?.[0]?.data?.[index],
        ]));
        return Object.fromEntries([
            '2026-06-15 10:00',
            '2026-06-15 10:01',
            '2026-06-15 10:02',
            '2026-06-15 10:03',
            '2026-06-16 09:30',
        ].map((minuteKey) => [minuteKey, valuesByMinute.get(minuteKey)]));
    }), {timeout: 30_000}).toEqual({
        '2026-06-15 10:00': 10_020,
        '2026-06-15 10:01': 10_035,
        '2026-06-15 10:02': 10_050,
        '2026-06-15 10:03': 10_065,
        '2026-06-16 09:30': 10_077,
    });
});

test('renders trailing overnight and pre-market buy glow zones in the stock-details gap', async ({page}) => {
    await mockInvestmentReadApis(page, {
        transactions: [
            {
                broker: 'ibkr',
                date: '2026-06-15',
                datetime: '2026-06-15 10:00:00',
                type: 'buy',
                ticker: 'QQQ',
                currency: 'USD',
                quantity: 10,
                price: 100,
                amount: -1_000,
                source: {source_has_intraday_timestamp: true},
            },
            {
                broker: 'ibkr',
                date: '2026-06-16',
                datetime: '2026-06-16 21:00:00',
                type: 'buy',
                ticker: 'QQQ',
                currency: 'USD',
                quantity: 2,
                price: 104,
                amount: -208,
                source: {source_has_intraday_timestamp: true},
            },
            {
                broker: 'ibkr',
                date: '2026-06-17',
                datetime: '2026-06-17 00:20:00',
                type: 'buy',
                ticker: 'QQQ',
                currency: 'USD',
                quantity: 2,
                price: 103,
                amount: -206,
                source: {source_has_intraday_timestamp: true},
            },
            {
                broker: 'ibkr',
                date: '2026-06-17',
                datetime: '2026-06-17 05:00:00',
                type: 'buy',
                ticker: 'QQQ',
                currency: 'USD',
                quantity: 2,
                price: 102,
                amount: -204,
                source: {source_has_intraday_timestamp: true},
            },
        ],
        tradingDays: ['2026-06-15', '2026-06-16'],
        priceHistoryByTicker: {
            QQQ: [
                {date: '2026-06-15', close: 100},
                {date: '2026-06-16', close: 104},
                {date: '2026-06-17', close: 102},
            ],
        },
        intradayRows: () => [
            {date: '2026-06-15 09:30', open: 99, high: 101, low: 98, close: 100},
            {date: '2026-06-15 15:59', open: 100, high: 102, low: 99, close: 101},
            {date: '2026-06-16 09:30', open: 103, high: 105, low: 102, close: 104},
            {date: '2026-06-16 15:59', open: 104, high: 106, low: 103, close: 105},
        ],
    });
    await page.setViewportSize({width: 1_024, height: 863});
    await page.goto('/trade/investment?view=stock-details&ticker=QQQ&range=1w');

    const canvas = page.locator('.investment-stock-details-price-chart-canvas');
    await expect.poll(() => canvas.evaluate((element) => {
        const chart = window.Chart?.getChart(element);
        return Boolean(chart?.chartArea && chart.data?.labels?.length === 4);
    }), {timeout: 30_000}).toBe(true);

    const markerGaps = await canvas.evaluate((element) => {
        const chart = window.Chart?.getChart(element);
        const context = element.getContext('2d');
        const lastIndex = (chart?.data?.labels?.length || 1) - 1;
        const lastPointX = Number(chart?.getDatasetMeta(0)?.data?.[lastIndex]?.x);
        const yScale = chart?.scales?.y;
        const hasGreenPixelsNear = (x, y) => {
            if (!context || !Number.isFinite(x) || !Number.isFinite(y)) return false;
            const centerX = Math.round(x);
            const centerY = Math.round(y);
            const left = Math.max(0, centerX - 9);
            const top = Math.max(0, centerY - 24);
            const right = Math.min(element.width, centerX + 10);
            const bottom = Math.min(element.height, centerY + 25);
            const image = context.getImageData(left, top, Math.max(1, right - left), Math.max(1, bottom - top)).data;
            for (let index = 0; index < image.length; index += 4) {
                const red = image[index];
                const green = image[index + 1];
                const blue = image[index + 2];
                if (green > 90 && green > red * 1.2 && green > blue * 1.05) return true;
            }
            return false;
        };
        return {
            lastPointX,
            nightGreen: hasGreenPixelsNear(lastPointX, yScale?.getPixelForValue(104)),
            overnightGreen: hasGreenPixelsNear(lastPointX, yScale?.getPixelForValue(103)),
            preMarketGreen: hasGreenPixelsNear(lastPointX, yScale?.getPixelForValue(102)),
        };
    });
    expect(markerGaps.nightGreen).toBe(true);
    expect(markerGaps.overnightGreen).toBe(true);
    expect(markerGaps.preMarketGreen).toBe(true);
});

test('does not pre-fund an earlier booking date with future sale proceeds', async ({page}) => {
    await mockInvestmentReadApis(page, {
        transactions: [
            {
                broker: 'ibkr',
                date: '2025-03-12',
                type: 'buy',
                ticker: 'QQQ',
                currency: 'USD',
                quantity: 150,
                price: 100,
                amount: -15_000,
            },
            {
                broker: 'ibkr',
                date: '2025-03-15',
                type: 'sell',
                ticker: 'QQQ',
                currency: 'USD',
                quantity: 150,
                price: 100,
                amount: 15_000,
            },
        ],
        priceHistoryByTicker: {
            QQQ: [
                {date: '2025-03-12', close: 100},
                {date: '2025-03-13', close: 100},
                {date: '2025-03-14', close: 100},
                {date: '2025-03-15', close: 100},
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
    for (const date of ['2025-03-12', '2025-03-13', '2025-03-14', '2025-03-15']) {
        expect(chartValues.find((point) => point.date === date)?.value).toBeCloseTo(10_000, 8);
    }
    expect(chartValues.some((point) => Math.abs(point.value - 10_000) > 0.01)).toBe(false);

    await page.locator('label[for="investment_view_holdings"]').click();
    const endpointAndHoldings = await page.evaluate(() => {
        const chart = window.Chart?.getChart(document.querySelector('#investmentEquityChart'));
        const values = chart?.data?.datasets?.[0]?.data || [];
        return {
            chartEndpoint: Number(values[values.length - 1]),
            holdingsTotalEquity: Number(
                document.querySelector('[data-investment-live-field="summary_total_equity"]')?.dataset.investmentLiveNumber,
            ),
        };
    });
    expect(endpointAndHoldings.chartEndpoint).toBeCloseTo(endpointAndHoldings.holdingsTotalEquity, 8);
});

