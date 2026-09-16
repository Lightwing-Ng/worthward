/* Code version: v1.0.1 */
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
test('applies the Scrollable table style to Backtest transaction details', async ({page}) => {
    await page.setViewportSize({width: 1024, height: 900});
    const readHostStyle = (locator) => locator.evaluate((element) => {
        const style = getComputedStyle(element);
        return Object.fromEntries([
            'display', 'position', 'flex', 'minHeight', 'margin', 'padding', 'overflow',
            'boxSizing', 'backgroundColor', 'border', 'borderRadius', 'boxShadow',
        ].map((property) => [property, style[property]]));
    });

    await page.goto('/settings/style-tokens');
    const referenceTableShell = page.locator(
        '[data-style-token-card="scrollable-table"] .scrollable-data-table-shell.style-token-table-demo',
    );
    await expect(referenceTableShell).toBeVisible();
    const referenceStyle = await readHostStyle(referenceTableShell);

    // Monthly DCA guarantees enough local-fixture rows to exercise the scrollport.
    await page.goto('/workspaces/backtest?show_trade_details=1&stop_loss=0&ticker=TQQQ&range=5y&strategy=dca&month_day=1');
    const backtestTableHost = page.locator('#backtest_history_table_wrap');
    await expect(backtestTableHost).toBeVisible();
    await expect(backtestTableHost).toHaveClass(/scrollable-data-table-shell/);
    await expect(backtestTableHost.locator(':scope > [data-table-header]')).toHaveCount(1);
    const backtestTableScroll = backtestTableHost.locator(':scope > [data-table-scroll]');
    await expect(backtestTableScroll).toHaveCount(1);
    await expect.poll(() => backtestTableScroll.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
            overflowY: style.overflowY,
            hasInternalOverflow: element.scrollHeight > element.clientHeight,
        };
    })).toEqual({overflowY: 'auto', hasInternalOverflow: true});
    await expect.poll(() => readHostStyle(backtestTableHost)).toEqual(referenceStyle);
});

test('uses the global compact date format and split numeric typography in Backtest transactions', async ({page}) => {
    await page.setViewportSize({width: 1024, height: 900});

    const setCompactDateFormat = async (value) => {
        await page.goto('/settings/general');
        const field = page.locator('[data-shared-select-kind="settings-short-date"]');
        await expect(field).toBeVisible();
        await field.locator('[data-shared-select-trigger]').click();
        const option = page.locator(`#settings_short_date_format_dropdown [data-value="${value}"]`);
        await expect(option).toBeVisible();
        await option.click();
        await page.waitForLoadState('domcontentloaded');
        await expect(page.locator('#settings_short_date_format')).toHaveValue(value);
    };

    await setCompactDateFormat('dd_mm_yyyy');
    try {
        await page.goto('/workspaces/backtest?show_trade_details=1&ticker=TQQQ&range=3y&strategy=supertrend-ai');
        const transactionHost = page.locator('#backtest_history_table_wrap');
        await expect(transactionHost).toBeVisible();
        const firstRow = transactionHost.locator('table[data-table-body] tbody tr').first();
        await expect(firstRow).toBeVisible();

        const renderedState = await page.evaluate(() => {
            const state = JSON.parse(document.getElementById('worthward_state')?.textContent || '{}');
            const row = document.querySelector('#backtest_history_table_wrap table[data-table-body] tbody tr');
            const numericCells = [
                'price',
                'realized-pnl',
                'unrealized-pnl',
                'cash',
                'market-value',
                'equity',
            ].map((className) => {
                const cell = row?.querySelector(`.${className}`);
                return {
                    hasMajor: Boolean(cell?.querySelector('.workspace-metric-value-major')),
                    hasMinor: Boolean(cell?.querySelector('.workspace-metric-value-minor')),
                    majorFontSize: cell?.querySelector('.workspace-metric-value-major')
                        ? getComputedStyle(cell.querySelector('.workspace-metric-value-major')).fontSize
                        : null,
                    minorFontSize: cell?.querySelector('.workspace-metric-value-minor')
                        ? getComputedStyle(cell.querySelector('.workspace-metric-value-minor')).fontSize
                        : null,
                };
            });
            return {
                shortDateFormat: state.dateDisplay?.short,
                dateText: row?.querySelector('.trade-transactions-date')?.textContent?.trim() || '',
                numericCells,
            };
        });

        expect(renderedState.shortDateFormat).toBe('dd_mm_yyyy');
        expect(renderedState.dateText).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
        expect(renderedState.numericCells).toHaveLength(6);
        renderedState.numericCells.forEach((cell) => {
            expect(cell.hasMajor).toBe(true);
            expect(cell.hasMinor).toBe(true);
            expect(Number.parseFloat(cell.minorFontSize)).toBeLessThan(Number.parseFloat(cell.majorFontSize));
        });
    } finally {
        await setCompactDateFormat('yyyy_mm_dd');
    }
});

test('starts every backtest strategy with its starter parameters from the dropdown', async ({page}) => {
    test.setTimeout(180_000);
    await page.setViewportSize({width: 1024, height: 900});
    await page.goto('/workspaces/backtest?show_trade_details=1&period=6mo&strategy=buy-and-hold');

    const strategyIds = await page.locator('#trade_strategy option').evaluateAll((options) => (
        [...new Set(options.map((option) => option.value))]
    ));
    expect(strategyIds.length).toBeGreaterThan(1);
    test.setTimeout(30_000 + strategyIds.length * 30_000);

    for (const strategyId of strategyIds) {
        const currentStrategyId = await page.locator('#trade_strategy').inputValue();
        if (currentStrategyId !== strategyId) {
            await page.locator('[data-trade-strategy-trigger]').click();
            const option = page.locator(
                `[data-trade-strategy-dropdown] [data-value="${strategyId}"]:visible`,
            ).first();
            await expect(option).toBeVisible();
            const navigation = page.waitForURL((url) => {
                const selectedStrategyId = url.searchParams.get('strategy');
                return url.pathname === '/workspaces/backtest'
                    && (
                        selectedStrategyId === strategyId
                        || (strategyId === 'grid-trading' && selectedStrategyId === null)
                    );
            }, {waitUntil: 'domcontentloaded'});
            await option.click();
            await navigation;
        }

        await expect(page.locator('#trade_strategy')).toHaveValue(strategyId);
        await expect(page.locator('#backtest_view_surface')).toBeVisible();
        await expect(page.locator('#backtest_history_table_wrap')).toBeVisible();
        await expect.poll(() => page.evaluate(() => {
            const fields = Array.from(document.querySelectorAll('[data-strategy-param-key]'));
            const valuesMatchDefaults = fields.every((field) => {
                const control = field.querySelector('[data-strategy-param-input]');
                if (!(control instanceof HTMLInputElement || control instanceof HTMLSelectElement)) return false;
                const value = String(control.value || '').trim();
                const defaultValue = String(control.dataset.default || '').trim();
                if (value === defaultValue) return true;
                if (control.dataset.strategyParamEmptyDefault === '1' && value === '') return true;
                const derivedValue = String(control.dataset.strategyParamDerivedValue || '').trim();
                if (
                    derivedValue !== ''
                    && Number(value.replaceAll(',', '')) === Number(derivedValue.replaceAll(',', ''))
                ) {
                    return true;
                }
                if (control.dataset.strategyParamInput === 'boolean') {
                    const normalizedDefault = defaultValue.toLowerCase();
                    const isDefaultOn = ['1', 'true', 'on'].includes(normalizedDefault);
                    const expectedValue = isDefaultOn
                        ? control.dataset.switchOnValue
                        : control.dataset.switchOffValue;
                    return value === String(expectedValue || '').trim();
                }
                const numericValue = Number(value);
                const numericDefault = Number(defaultValue);
                return value !== ''
                    && defaultValue !== ''
                    && Number.isFinite(numericValue)
                    && Number.isFinite(numericDefault)
                    && numericValue === numericDefault;
            });
            return {
                valuesMatchDefaults,
                hasPriceChart: Boolean(document.querySelector('#tradePriceChart')),
                hasEquityChart: Boolean(document.querySelector('#tradeEquityChart')),
            };
        })).toEqual({
            valuesMatchDefaults: true,
            hasPriceChart: true,
            hasEquityChart: true,
        });
    }
});

test('removes the horizontal reference line from the exact backtest equity canvas', async ({page}) => {
    await page.goto('/workspaces/backtest?show_trade_details=1&ticker=QQQ&range=6mo&strategy=buy-and-hold');

    const exactCanvas = page.locator(
        '#backtest_overview_panel .trade-chart-panel-equity #tradeEquityChart',
    );
    await expect(exactCanvas).toHaveCount(1);
    await expect(exactCanvas).toBeVisible();
    await expect.poll(() => page.evaluate(() => Boolean(
        window.Chart?.getChart?.(document.querySelector('#tradeEquityChart')),
    ))).toBe(true);

    const chartState = await page.evaluate(() => {
        const chart = window.Chart.getChart(document.querySelector('#tradeEquityChart'));
        return {
            pluginIds: chart.config._config.plugins.map((plugin) => plugin.id || 'anonymous'),
            xGridVisible: chart.options.scales.x.grid.display,
            xBorderVisible: chart.options.scales.x.border.display,
        };
    });

    expect(chartState.pluginIds).not.toContain('tradeReferenceLine');
    expect(chartState.xGridVisible).toBe(false);
    expect(chartState.xBorderVisible).toBe(false);
});

test('formats Backtest price and equity axes with distinct precision', async ({page}) => {
    await page.setViewportSize({width: 1024, height: 900});

    const readAxes = () => page.evaluate(() => {
        const readAxis = (selector) => {
            const chart = window.Chart?.getChart?.(document.querySelector(selector));
            if (!chart) return null;
            return {
                labels: chart.scales?.y?.ticks?.map((tick) => String(tick.label ?? '')).filter(Boolean) || [],
                width: chart.scales?.y?.width || 0,
                samples: selector === '#tradePriceChart'
                    ? [1234, 567, 12.5, 5.5].map((value) => (
                        chart.options.scales.y.ticks.callback(value, 1, [{}, {}, {}])
                    ))
                    : [],
            };
        };
        return {
            price: readAxis('#tradePriceChart'),
            equity: readAxis('#tradeEquityChart'),
        };
    });

    const assertAxisContract = async () => {
        await expect.poll(async () => {
            const axes = await readAxes();
            return Boolean(axes.price?.labels.length && axes.equity?.labels.length);
        }).toBe(true);

        const axes = await readAxes();
        const priceIntegerPattern = /^-?\d{1,3}(,\d{3})*$/;
        const priceDecimalPattern = /^-?\d{1,2}\.\d{2}$/;
        const equityTickPattern = /^-?\d{1,3}(,\d{3})*$/;
        expect(axes.price?.labels.every((label) => {
            const numericValue = Number(label.replaceAll(',', ''));
            return Math.abs(numericValue) >= 100
                ? priceIntegerPattern.test(label)
                : priceDecimalPattern.test(label);
        })).toBe(true);
        expect(axes.price?.samples).toEqual(['1,234', '567', '12.50', '5.50']);
        expect(axes.equity?.labels.every((label) => equityTickPattern.test(label))).toBe(true);
        expect(axes.price?.width).toBeGreaterThanOrEqual(72);
        expect(axes.equity?.width).toBeGreaterThanOrEqual(72);
    };

    await page.goto('/workspaces/backtest?show_trade_details=1&ticker=TQQQ&range=5y&strategy=dca&stop_loss=0&month_day=1');
    await assertAxisContract();
    await page.goto('/workspaces/backtest?show_trade_details=1&ticker=TQQQ&range=5y&strategy=buy-and-hold&stop_loss=0');
    await assertAxisContract();
});

test('shares the tokenized chart stroke width between Backtest price and Investment equity', async ({page}) => {
    await page.setViewportSize({width: 1024, height: 900});

    const readChartStroke = (selector, tokenOwnerSelector) => page.evaluate(({selector, tokenOwnerSelector}) => {
        const canvas = document.querySelector(selector);
        const chart = window.Chart?.getChart?.(canvas);
        const tokenOwner = document.querySelector(tokenOwnerSelector);
        if (!chart || !(tokenOwner instanceof Element)) return null;
        const token = getComputedStyle(tokenOwner)
            .getPropertyValue('--trade-chart-series-line-width')
            .trim();
        return {
            token,
            tokenWidth: Number.parseFloat(token),
            borderWidth: chart.data.datasets[0]?.borderWidth,
            borderColor: chart.data.datasets[0]?.borderColor,
            primaryColor: getComputedStyle(document.body)
                .getPropertyValue('--theme-accent-primary')
                .trim(),
        };
    }, {selector, tokenOwnerSelector});

    await page.goto('/workspaces/backtest?ticker=QQQ&range=6mo&strategy=buy-and-hold&stop_loss=0');
    await expect.poll(() => page.evaluate(() => Boolean(
        window.Chart?.getChart?.(document.querySelector('#tradePriceChart')),
    ))).toBe(true);
    const backtestStroke = await readChartStroke('#tradePriceChart', '.trade-chart-stack');
    expect(backtestStroke).not.toBeNull();
    expect(backtestStroke?.token).toBe('2px');
    expect(backtestStroke?.borderWidth).toBe(backtestStroke?.tokenWidth);
    expect(backtestStroke?.borderColor).toBe(backtestStroke?.primaryColor);

    await mockInvestmentReadApis(page, {
        transactions: [
            {broker: 'ibkr', date: '2026-07-01', type: 'buy', ticker: 'QQQ', currency: 'USD', quantity: 1, price: 100, amount: -100},
        ],
        priceHistoryByTicker: {
            QQQ: [
                {date: '2026-07-01', close: 100},
                {date: '2026-07-02', close: 101},
            ],
        },
    });
    await page.goto('/trade/investment?view=overview&range=3m');
    await expect.poll(() => page.evaluate(() => Boolean(
        window.Chart?.getChart?.(document.querySelector('#investmentEquityChart')),
    ))).toBe(true);
    const investmentStroke = await readChartStroke(
        '#investmentEquityChart',
        '.investment-chart-stack',
    );
    expect(investmentStroke).not.toBeNull();
    expect(investmentStroke?.token).toBe(backtestStroke?.token);
    expect(investmentStroke?.borderWidth).toBe(investmentStroke?.tokenWidth);
    expect(investmentStroke?.borderWidth).toBe(backtestStroke?.borderWidth);
    expect(investmentStroke?.borderColor).toBe('#0055cc');
});

test('enters DCA through the Backtest strategy dropdown and tunes private parameters', async ({page}) => {
    await page.setViewportSize({width: 1024, height: 900});
    await page.goto('/workspaces/backtest?show_trade_details=1&ticker=TQQQ&range=3y&strategy=buy-and-hold');

    const strategyTrigger = page.locator('[data-trade-strategy-trigger]');
    await expect(strategyTrigger).toBeVisible();
    await expect(strategyTrigger).toBeEnabled();
    const triggerStyle = await strategyTrigger.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
            backgroundColor: style.backgroundColor,
            borderColor: style.borderColor,
            pointerEvents: style.pointerEvents,
        };
    });
    expect(triggerStyle.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
    expect(triggerStyle.borderColor).not.toBe('rgba(0, 0, 0, 0)');
    expect(triggerStyle.pointerEvents).toBe('auto');

    await strategyTrigger.click();
    const strategyDropdown = page.locator('[data-trade-strategy-dropdown]');
    await expect(strategyDropdown).toBeVisible();
    const dropdownStyle = await strategyDropdown.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
            position: style.position,
            backgroundColor: style.backgroundColor,
            pointerEvents: style.pointerEvents,
            zIndex: style.zIndex,
        };
    });
    expect(dropdownStyle.position).toBe('fixed');
    expect(dropdownStyle.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
    expect(dropdownStyle.pointerEvents).toBe('auto');
    expect(Number(dropdownStyle.zIndex)).toBeGreaterThanOrEqual(10002);

    const dcaOption = strategyDropdown.locator('[data-value="dca"]');
    await dcaOption.click();
    await expect.poll(() => page.locator('#trade_strategy').inputValue()).toBe('dca');
    await expect.poll(() => new URL(page.url()).searchParams.get('strategy')).toBe('dca');
    await expect.poll(() => new URL(page.url()).searchParams.get('ticker')).toBe('TQQQ');
    const tuneButton = page.locator('[data-trade-strategy-tune-button]');
    const paramsPanel = page.locator('#trade_strategy_params_panel');
    await expect(tuneButton).toBeVisible();
    await expect(tuneButton).toBeEnabled();
    await expect(tuneButton).toHaveAttribute('aria-hidden', 'false');
    await expect(tuneButton).toHaveAttribute('aria-expanded', 'true');
    await expect(tuneButton).toHaveAttribute('aria-pressed', 'true');
    await expect(paramsPanel).toBeVisible();
    await expect(page.locator('[data-strategy-param-key="amount"]')).toBeVisible();
    await expect(page.locator('[data-strategy-param-key="frequency"]')).toBeVisible();
    await expect(page.locator('#tradePriceChart')).toBeVisible();
    await expect(page.locator('#tradeEquityChart')).toBeVisible();

    const dcaHistoryShell = page.locator('#backtest_history_table_wrap');
    await expect(dcaHistoryShell).toHaveClass(/scrollable-data-table-shell/);
    await expect(dcaHistoryShell.locator(':scope > [data-table-header]')).toHaveCount(1);
    await expect(dcaHistoryShell.locator(':scope > [data-table-scroll]')).toHaveCount(1);
    const dcaHistoryGeometry = await dcaHistoryShell.evaluate((shell) => {
        const header = shell.querySelector(':scope > [data-table-header]');
        const scroll = shell.querySelector(':scope > [data-table-scroll]');
        const headerRow = header?.querySelector('tr');
        const headerCell = header?.querySelector('th');
        if (!(header instanceof HTMLElement)
            || !(scroll instanceof HTMLElement)
            || !(headerRow instanceof HTMLElement)
            || !(headerCell instanceof HTMLElement)) return null;
        const headerRect = header.getBoundingClientRect();
        const headerRowRect = headerRow.getBoundingClientRect();
        const headerCellRect = headerCell.getBoundingClientRect();
        return {
            headerWidth: headerRect.width,
            headerHeight: headerRect.height,
            headerRowHeight: headerRowRect.height,
            headerCellHeight: headerCellRect.height,
            scrollOverflowY: getComputedStyle(scroll).overflowY,
            hasInternalVerticalOverflow: scroll.scrollHeight > scroll.clientHeight,
        };
    });
    expect(dcaHistoryGeometry).not.toBeNull();
    expect(dcaHistoryGeometry.headerWidth).toBeGreaterThanOrEqual(720);
    expect(dcaHistoryGeometry.headerHeight).toBeLessThan(60);
    expect(dcaHistoryGeometry.headerRowHeight).toBeLessThan(60);
    expect(dcaHistoryGeometry.headerCellHeight).toBeLessThan(60);
    expect(dcaHistoryGeometry.scrollOverflowY).toBe('auto');
    expect(dcaHistoryGeometry.hasInternalVerticalOverflow).toBe(true);
    const historyArticle = page.locator(
        'xpath=/html/body/main/div/section/section/div/article[2]/article/article[3]',
    );
    await expect(historyArticle.locator('.dca-transactions-shell')).toBeVisible();
    const transactionPageSize = await page.evaluate(() => (
        window.WORTHWARD_LOCAL_STORE_PAGINATION?.LOCAL_STORE_PAGINATION_TRANSACTION_PAGE_SIZE
    ));
    expect(transactionPageSize).toBe(100);
    expect(await historyArticle.locator('tbody tr').count()).toBeLessThanOrEqual(100);

    await expect(page.locator('#show_trade_details')).toBeChecked();
    await page.locator('label[for="show_trade_details"]').click();
    await expect(page.locator('#show_trade_details')).not.toBeChecked();
    await expect(page.locator('#tradeEquityChart')).toBeHidden();
    await expect(page.locator('#backtest_history_transactions')).toBeDisabled();
    await expect(page.locator('#backtest_history_metrics')).toBeChecked();
});

test('preserves the current ticker when switching strategies from the default ticker', async ({page}) => {
    await page.setViewportSize({width: 1033, height: 841});
    await page.goto('/workspaces/backtest?ticker=QQQ&range=3y&strategy=dca&stop_loss=0');

    const strategyTrigger = page.locator('[data-trade-strategy-trigger]');
    await expect(strategyTrigger).toBeVisible();
    await strategyTrigger.click();

    const buyAndHoldOption = page.locator('[data-trade-strategy-dropdown] [data-value="buy-and-hold"]');
    await expect(buyAndHoldOption).toBeVisible();
    await buyAndHoldOption.click();

    await expect.poll(() => page.locator('#trade_strategy').inputValue()).toBe('buy-and-hold');
    await expect(page.locator('#ticker_1')).toHaveValue('QQQ');
});

test('uses lighter Backtest sidebar weights for range labels and strategy selection', async ({page}) => {
    await page.setViewportSize({width: 1033, height: 841});
    await page.goto('/workspaces/backtest?ticker=QQQI&strategy=dca&stop_loss=0');

    const weights = await page.evaluate(() => ({
        mode: getComputedStyle(document.querySelector('.range-mode-field > label')).fontWeight,
        period: getComputedStyle(document.querySelector('#period_panel > label')).fontWeight,
        strategy: getComputedStyle(document.querySelector('.trade-strategy-field .trade-strategy-select')).fontWeight,
    }));
    expect(weights).toEqual({mode: '400', period: '400', strategy: '300'});
});

test('keeps DCA strategy parameter menus above clipping and the panel compact', async ({page}) => {
    await page.setViewportSize({width: 1023, height: 841});
    await page.goto('/workspaces/backtest?ticker=QQQI&strategy=dca&stop_loss=0');

    await expect(page.locator('#trade_strategy_params_panel')).toBeVisible();

    const frequencyTrigger = page.locator(
        '[data-strategy-param-key="frequency"] [data-shared-select-trigger]',
    );
    const weeklyField = page.locator('[data-strategy-param-key="weekday"]');
    const monthlyField = page.locator('[data-strategy-param-key="month_day"]');
    await expect(frequencyTrigger.locator('[data-shared-select-trigger-label]')).toHaveText('monthly');
    await expect(weeklyField).toBeHidden();
    await expect(monthlyField).toBeVisible();
    const monthlyTriggerGeometry = await frequencyTrigger.evaluate((trigger) => {
        const field = trigger.closest('[data-strategy-param-key]');
        const label = trigger.querySelector('[data-shared-select-trigger-label]');
        const triggerRect = trigger.getBoundingClientRect();
        const fieldRect = field?.getBoundingClientRect();
        return {
            rightDelta: fieldRect ? Math.abs(fieldRect.right - triggerRect.right) : Number.POSITIVE_INFINITY,
            labelOverflow: label instanceof HTMLElement ? label.scrollWidth - label.clientWidth : Number.POSITIVE_INFINITY,
            width: triggerRect.width,
        };
    });
    expect(monthlyTriggerGeometry.rightDelta).toBeLessThanOrEqual(1);
    expect(monthlyTriggerGeometry.labelOverflow).toBeLessThanOrEqual(1);
    expect(monthlyTriggerGeometry.width).toBeLessThan(110);
    await frequencyTrigger.click();
    const dropdown = page.locator('#strategy_param_frequency_dropdown');
    await expect(dropdown).toBeVisible();

    const layout = await page.evaluate(() => {
        const panel = document.querySelector('#trade_strategy_params_panel');
        const dropdown = document.querySelector('#strategy_param_frequency_dropdown');
        if (!(panel instanceof HTMLElement) || !(dropdown instanceof HTMLElement)) return null;
        const dropdownStyle = getComputedStyle(dropdown);
        return {
            isPageLevelOverlayChild: dropdown.parentElement?.matches('[data-shared-select-overlay]') || false,
            position: dropdownStyle.position,
            backgroundColor: dropdownStyle.backgroundColor,
            backgroundImage: dropdownStyle.backgroundImage,
            panelHeight: panel.getBoundingClientRect().height,
            menuBottom: dropdown.getBoundingClientRect().bottom,
            viewportHeight: window.innerHeight,
        };
    });

    expect(layout).not.toBeNull();
    expect(layout?.isPageLevelOverlayChild).toBe(true);
    expect(layout?.position).toBe('fixed');
    expect(layout?.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
    expect(layout?.backgroundImage).not.toBe('none');
    expect(layout?.menuBottom).toBeLessThanOrEqual((layout?.viewportHeight || 0) + 1);
    expect(layout?.panelHeight).toBeLessThan(320);

    await dropdown.locator('[data-value="weekly"]').click();
    await expect.poll(() => new URL(page.url()).searchParams.get('frequency')).toBe('weekly');
    await expect(weeklyField).toBeVisible();
    await expect(monthlyField).toBeHidden();
    const weekdayTrigger = weeklyField.locator('[data-shared-select-trigger]');
    await expect(weekdayTrigger.locator('[data-shared-select-trigger-label]')).toHaveText('Monday');
    await weekdayTrigger.click();
    await expect(page.locator('#strategy_param_weekday_dropdown [role="option"]')).toHaveText([
        'Monday',
        'Tuesday',
        'Wednesday',
        'Thursday',
        'Friday',
        'Saturday',
        'Sunday',
    ]);
});

test('keeps the bottom Backtest strategy parameter dropdown fully visible', async ({page}) => {
    await page.setViewportSize({width: 990, height: 1242});
    await page.goto('/workspaces/backtest?ticker=TQQQ&range=3d&strategy=supertrend-ai&interval=1m');

    await expect(page.locator('#trade_strategy_params_panel')).toBeVisible();
    const field = page.locator('[data-strategy-param-key="from_cluster"]');
    await expect(field).toBeVisible();
    await field.locator('[data-shared-select-trigger]').click();
    const dropdown = page.locator('#strategy_param_from_cluster_dropdown');
    await expect(dropdown).toBeVisible();

    const layout = await page.evaluate(() => {
        const trigger = document.querySelector('[data-strategy-param-key="from_cluster"] [data-shared-select-trigger]');
        const dropdown = document.querySelector('#strategy_param_from_cluster_dropdown');
        if (!(trigger instanceof HTMLElement) || !(dropdown instanceof HTMLElement)) return null;
        const triggerRect = trigger.getBoundingClientRect();
        const dropdownRect = dropdown.getBoundingClientRect();
        const options = Array.from(dropdown.querySelectorAll('[role="option"]')).map((option) => {
            const rect = option.getBoundingClientRect();
            return {
                text: option.textContent?.trim() || '',
                top: rect.top,
                bottom: rect.bottom,
            };
        });
        return {
            isPageLevelOverlayChild: dropdown.parentElement?.matches('[data-shared-select-overlay]') || false,
            position: getComputedStyle(dropdown).position,
            triggerTop: triggerRect.top,
            triggerBottom: triggerRect.bottom,
            dropdownTop: dropdownRect.top,
            dropdownBottom: dropdownRect.bottom,
            dropdownLeft: dropdownRect.left,
            dropdownRight: dropdownRect.right,
            triggerWidth: triggerRect.width,
            dropdownWidth: dropdownRect.width,
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
            options,
        };
    });
    expect(layout).not.toBeNull();
    expect(layout?.isPageLevelOverlayChild).toBe(true);
    expect(layout?.position).toBe('fixed');
    expect(layout?.dropdownTop).toBeGreaterThanOrEqual(0);
    expect(layout?.dropdownBottom).toBeLessThanOrEqual((layout?.viewportHeight || 0) + 1);
    expect(layout?.dropdownLeft).toBeGreaterThanOrEqual(0);
    expect(layout?.dropdownRight).toBeLessThanOrEqual((layout?.viewportWidth || 0) + 1);
    expect(layout?.dropdownWidth).toBeGreaterThanOrEqual((layout?.triggerWidth || 0) - 1);
    expect(layout?.options.every((option) => option.top >= 0 && option.bottom <= (layout?.viewportHeight || 0) + 1)).toBe(true);
    expect(layout?.options.map((option) => option.text)).toEqual(['Best', 'Average', 'Worst']);
});

test('keeps Bayesian compute on internal Auto and preserves parameter-panel effects', async ({page}) => {
    await page.setViewportSize({width: 974, height: 1386});
    await page.goto('/workspaces/backtest?ticker=AAPL&strategy=bayesian-price-field&stop_loss=0&show_trade_details=0&use_options=0&use_pe_ratio=0&use_option_put_open_interest=1&use_option_put_call_open_interest_ratio=1&use_volume=0&cell_display_threshold=2.50&training_window=425&chip_window=62&prior_strength=10.52&compute_backend=GPU');

    const field = page.locator('[data-strategy-param-key="compute_backend"]');
    await expect(field).toHaveCount(0);

    const panelEffects = await page.locator('#trade_strategy_params_panel').evaluate((panel) => {
        const style = getComputedStyle(panel);
        return {
            overflow: style.overflow,
            clipPath: style.clipPath,
            willChange: style.willChange,
        };
    });
    expect(panelEffects).toEqual({
        overflow: 'visible',
        clipPath: 'none',
        willChange: 'transform, opacity, filter',
    });
});

test('shares the plain switch style between Backtest controls and strategy booleans', async ({page}) => {
    await page.setViewportSize({width: 983, height: 1288});
    await page.goto('/workspaces/backtest?ticker=DRAM&range=6mo&strategy=bayesian-price-field&stop_loss=0&show_trade_details=0&use_options=0&use_pe_ratio=0&use_option_put_open_interest=1&use_option_put_call_open_interest_ratio=1&use_volume=0&cell_display_threshold=2.00&training_window=425&chip_window=62&prior_strength=10.52');

    const styleContract = await page.evaluate(() => {
        const root = document.documentElement;
        const findSwitchRow = (text) => [...document.querySelectorAll('.switch-row')]
            .find((row) => row.querySelector('.switch-label')?.textContent.trim().startsWith(text));
        const summarize = (row) => {
            if (!(row instanceof HTMLElement)) return null;
            const rowStyle = getComputedStyle(row);
            const label = row.querySelector('.switch-label');
            const labelStyle = label ? getComputedStyle(label) : null;
            const textWrapper = label?.querySelector(':scope > span:not(.field-tooltip)');
            const textStyle = textWrapper ? getComputedStyle(textWrapper) : null;
            return {
                classes: [...row.classList],
                row: {
                    background: rowStyle.backgroundColor,
                    border: rowStyle.border,
                    borderRadius: rowStyle.borderRadius,
                    boxShadow: rowStyle.boxShadow,
                    padding: rowStyle.padding,
                    backdropFilter: rowStyle.backdropFilter,
                    minHeight: rowStyle.minHeight,
                },
                label: labelStyle ? {
                    background: labelStyle.backgroundColor,
                    border: labelStyle.border,
                    borderRadius: labelStyle.borderRadius,
                    boxShadow: labelStyle.boxShadow,
                    padding: labelStyle.padding,
                } : null,
                text: textStyle ? {
                    background: textStyle.backgroundColor,
                    borderRadius: textStyle.borderRadius,
                    padding: textStyle.padding,
                } : null,
            };
        };
        const readTheme = (mode) => {
            root.setAttribute('data-theme-override', mode);
            const priceReturn = summarize(findSwitchRow('Price return only'));
            const strategyRows = [...document.querySelectorAll('.trade-strategy-boolean-row')];
            return {
                mode,
                priceReturn,
                strategyRows: strategyRows.map(summarize),
            };
        };
        return {
            light: readTheme('light'),
            dark: readTheme('dark'),
        };
    });

    for (const theme of [styleContract.light, styleContract.dark]) {
        expect(theme.priceReturn).not.toBeNull();
        expect(theme.strategyRows.length).toBeGreaterThan(0);
        expect(theme.strategyRows.every((row) => row?.classes.includes('switch-row--plain'))).toBe(true);
        for (const strategyRow of theme.strategyRows) {
            expect(strategyRow?.row).toEqual(theme.priceReturn?.row);
            expect(strategyRow?.label).toEqual(theme.priceReturn?.label);
            expect(strategyRow?.text).toEqual({
                background: 'rgba(0, 0, 0, 0)',
                borderRadius: '0px',
                padding: '0px',
            });
        }
    }
});

test('reuses compact numeric display and Backtest section spacing contracts', async ({page}) => {
    await page.setViewportSize({width: 1033, height: 841});
    await page.goto('/workspaces/backtest?show_trade_details=1&ticker=QQQI&range=3y&return=price&strategy=dca&stop_loss=0&month_day=1');

    const firstRow = page.locator('#backtest_history_table_wrap table[data-table-body] tbody tr').first();
    await expect(firstRow).toBeVisible();
    await expect(page.locator('#backtest_history_table_wrap table[data-table-header] thead th')).toHaveText([
        'No.',
        'Date time',
        'Side',
        'Price',
        'Quantity',
        'Realized P&L',
        'Unrealized P&L',
        'Cash',
        'Market value',
        'Equity',
    ]);
    await expect(firstRow.locator('td')).toHaveCount(10);

    const layout = await page.evaluate(() => {
        const overview = document.querySelector('#backtest_overview_panel > .backtest-surface');
        const contentCard = document.querySelector('.backtest-trade-performance-card');
        const resizer = document.querySelector('#backtest_section_resizer');
        const firstRow = document.querySelector('#backtest_history_table_wrap table[data-table-body] tbody tr');
        if (!(overview instanceof HTMLElement)
            || !(contentCard instanceof HTMLElement)
            || !(resizer instanceof HTMLElement)
            || !(firstRow instanceof HTMLTableRowElement)) {
            return null;
        }
        const overviewStyle = getComputedStyle(overview);
        const contentCardStyle = getComputedStyle(contentCard);
        const resizerStyle = getComputedStyle(resizer);
        return {
            overviewPadding: [overviewStyle.paddingTop, overviewStyle.paddingBottom],
            contentCardPadding: [contentCardStyle.paddingTop, contentCardStyle.paddingBottom],
            resizerFontSize: resizerStyle.fontSize,
            resizerHeight: resizerStyle.height,
            numericCells: Array.from(firstRow.querySelectorAll('.trade-transactions-number')).map((cell) => ({
                major: Boolean(cell.querySelector('.workspace-metric-value-major')),
                minor: Boolean(cell.querySelector('.workspace-metric-value-minor')),
            })),
        };
    });

    expect(layout).not.toBeNull();
    expect(layout?.overviewPadding).toEqual(['0px', '0px']);
    expect(layout?.contentCardPadding).toEqual(['2px', '2px']);
    expect(layout?.resizerFontSize).toBe('12px');
    expect(layout?.resizerHeight).toBe('10px');
    expect(layout?.numericCells.length).toBe(7);
    expect(layout?.numericCells.every((cell) => cell.major && cell.minor)).toBe(true);
});

test('renders the Backtest transaction contract for intraday results', async ({page}) => {
    await page.setViewportSize({width: 1024, height: 900});
    await page.goto('/workspaces/backtest?show_trade_details=1&ticker=QQQ&range=3d&interval=1m&strategy=buy-and-hold&stop_loss=0');
    await setSidebarExpanded(page, false);

    const headerCells = page.locator('#backtest_history_table_wrap [data-table-header] thead th');
    await expect(headerCells).toHaveText([
        'No.',
        'Date time',
        'Side',
        'Price',
        'Quantity',
        'Realized P&L',
        'Unrealized P&L',
        'Cash',
        'Market value',
        'Equity',
    ]);

    const firstRow = page.locator('#backtest_history_table_wrap [data-table-body] tbody tr').first();
    await expect(firstRow).toBeVisible();
    await expect(firstRow.locator('td')).toHaveCount(10);
    await expect(firstRow.locator('td').first()).toHaveText('1');
    await expect(page.locator('#backtest_interval_control')).toHaveAttribute('data-active', '1m');
    await expect(firstRow.locator('.trade-transactions-date')).toHaveText(/\d{2}:\d{2}/);

    const tableGeometry = await page.locator('#backtest_history_table_wrap').evaluate((shell) => {
        const headerTable = shell.querySelector('[data-table-header]');
        const bodyTable = shell.querySelector('[data-table-body]');
        const scroll = shell.querySelector('[data-table-scroll]');
        return {
            columnCount: headerTable.querySelectorAll('col').length,
            minWidth: getComputedStyle(bodyTable).minWidth,
            clientWidth: scroll.clientWidth,
            scrollWidth: scroll.scrollWidth,
        };
    });
    expect(tableGeometry.columnCount).toBe(10);
    expect(tableGeometry.minWidth).toBe('100%');
    expect(tableGeometry.scrollWidth - tableGeometry.clientWidth).toBeLessThanOrEqual(1);
});

test('removes the glass border color from the shared Backtest Period trigger', async ({page}) => {
    await page.setViewportSize({width: 1033, height: 841});
    await page.goto('/workspaces/backtest?ticker=TQQQ&strategy=grid-trading&stop_loss=0');

    const periodTrigger = page.locator('#period_panel [data-shared-select-trigger]');
    await expect(periodTrigger).toBeVisible();

    const borderState = await periodTrigger.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
            borderStyle: style.borderStyle,
            borderWidth: style.borderWidth,
            borderColor: style.borderColor,
        };
    });
    expect(borderState).toEqual({
        borderStyle: 'none',
        borderWidth: '0px',
        borderColor: 'rgba(0, 0, 0, 0)',
    });

    await periodTrigger.hover();
    await expect.poll(() => periodTrigger.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
            borderStyle: style.borderStyle,
            borderWidth: style.borderWidth,
            borderColor: style.borderColor,
        };
    })).toEqual({
        borderStyle: 'none',
        borderWidth: '0px',
        borderColor: 'rgba(0, 0, 0, 0)',
    });
});

test('keeps Grid Trading private parameters open through the shared strategy tune button', async ({page}) => {
    await page.setViewportSize({width: 1024, height: 900});
    await page.goto('/workspaces/backtest?ticker=QQQ&range=2y&strategy=grid-trading&show_trade_details=1&initial_holding=100&fall=2.00');

    const strategyTrigger = page.locator('[data-trade-strategy-trigger]');
    const tuneButton = page.locator('[data-trade-strategy-tune-button]');
    const paramsPanel = page.locator('#trade_strategy_params_panel');

    await expect(strategyTrigger).toHaveText('Grid Trading');
    await expect(tuneButton).toBeVisible();
    await expect(tuneButton).toBeEnabled();
    await expect(tuneButton).toHaveAttribute('aria-hidden', 'false');
    await expect(page.locator('[data-trade-strategy-field]')).not.toHaveClass(/is-grid-trading-inline/);
    await expect(tuneButton).toHaveAttribute('aria-expanded', 'true');
    await expect(tuneButton).toHaveAttribute('aria-pressed', 'true');
    await expect(paramsPanel).toBeVisible();
    await expect(page.locator('#tradePriceChart')).toBeVisible();
    await expect(page.getByText('Unable to load this workspace', {exact: false})).toHaveCount(0);
    await expect(page.locator('label[for="trade_initial_capital"]')).toHaveText('Initial cash (USD)');
    await expect(page.locator('#strategy_param_initial_holding')).toHaveValue('100');
    for (const key of ['initial_holding', 'quantity', 'holding_min', 'holding_max', 'rise', 'fall']) {
        await expect(page.locator(`[data-strategy-param-key="${key}"]`)).toBeVisible();
    }

    const numericContract = await page.locator('#trade_strategy_params_panel input[type="number"]').evaluateAll((inputs) => (
        inputs.map((input) => {
            const style = getComputedStyle(input);
            return {
                height: style.height,
                minHeight: style.minHeight,
                inputMode: input.getAttribute('inputmode'),
            };
        })
    ));
    expect(numericContract).toHaveLength(5);
    expect(numericContract.every((control) => (
        control.height === '28px'
        && control.minHeight === '28px'
        && ['numeric', 'decimal'].includes(control.inputMode)
    ))).toBe(true);
    expect(numericContract.slice(0, 3).every((control) => control.inputMode === 'numeric')).toBe(true);
    const holdingMaximumGeometry = await page.locator('#strategy_param_holding_max').evaluate((input) => ({
        clientWidth: input.clientWidth,
        scrollWidth: input.scrollWidth,
    }));
    expect(holdingMaximumGeometry.scrollWidth).toBeLessThanOrEqual(holdingMaximumGeometry.clientWidth);
    await expect(page.locator('#trade_initial_capital')).toHaveAttribute('inputmode', 'decimal');
    await expect(page.locator('#trade_initial_capital')).toHaveCSS('height', '28px');
});

test('requires the Backtest tune button for parameter-panel toggle', async ({page}) => {
    await page.setViewportSize({width: 1024, height: 900});
    await page.goto('/workspaces/backtest?ticker=TQQQ&range=3y&strategy=grid-trading');

    const tuneButton = page.locator('[data-trade-strategy-tune-button]');
    const paramsPanel = page.locator('#trade_strategy_params_panel');
    await expect(tuneButton).toBeVisible();
    await expect(tuneButton).toBeEnabled();
    await expect(tuneButton).toHaveAttribute('aria-pressed', 'true');
    await expect(tuneButton).toHaveAttribute('aria-expanded', 'true');
    await expect(paramsPanel).toBeVisible();

    await page.mouse.click(1000, 880);
    await expect(tuneButton).toHaveAttribute('aria-pressed', 'true');
    await expect(tuneButton).toHaveAttribute('aria-expanded', 'true');
    await expect(paramsPanel).toBeVisible();

    await tuneButton.click();
    await expect(tuneButton).toHaveAttribute('aria-pressed', 'false');
    await expect(tuneButton).toHaveAttribute('aria-expanded', 'false');
    await expect(paramsPanel).toBeHidden();

    await tuneButton.click();
    await expect(tuneButton).toHaveAttribute('aria-pressed', 'true');
    await expect(tuneButton).toHaveAttribute('aria-expanded', 'true');
    await expect(paramsPanel).toBeVisible();
});

test('waits for Grid Trading parameter blur before recalculating', async ({page}) => {
    await page.setViewportSize({width: 1024, height: 900});
    const hydrationRequests = [];
    page.on('request', (request) => {
        if (request.headers()['x-requested-with'] !== 'workspace-hydrate') return;
        if (new URL(request.url()).pathname !== '/workspaces/backtest') return;
        hydrationRequests.push(request.url());
    });

    await page.goto('/workspaces/backtest?ticker=TQQQ&range=3y&strategy=grid-trading&fall=0.50');
    await expect(page.locator('#tradePriceChart')).toBeVisible();
    await expect.poll(() => page.locator('#ticker_1').getAttribute('data-unknown')).not.toBe('1');

    const fallInput = page.locator('#strategy_param_fall');
    await expect(fallInput).toBeVisible();
    await fallInput.click();
    await fallInput.fill('1.75');
    await expect(fallInput).toHaveValue('1.75');
    await fallInput.evaluate((input) => {
        input.dataset.strategyParamDirty = '1';
        input.dispatchEvent(new Event('input', {bubbles: true}));
    });

    await page.waitForTimeout(350);
    expect(hydrationRequests).toHaveLength(0);

    await fallInput.press('Tab');
    await expect.poll(() => hydrationRequests.length, {timeout: 15_000}).toBe(1);
    await expect(page).toHaveURL(/fall=1\.75/);
});

test('replaces Backtest controls when the strategy changes without losing the ticker', async ({page}) => {
    await page.setViewportSize({width: 1024, height: 900});
    await page.goto('/workspaces/backtest?ticker=TQQQ&range=3y&strategy=grid-trading&stop_loss=0');

    const chooseStrategy = async (strategyId) => {
        const trigger = page.locator('[data-trade-strategy-trigger]');
        await trigger.click();
        const option = page.locator(`[data-trade-strategy-dropdown] [data-value="${strategyId}"]`);
        await expect(option).toHaveCount(1);
        await option.click();
        await expect.poll(() => page.locator('#trade_strategy').inputValue()).toBe(strategyId);
    };

    await expect(page.locator('#ticker_1')).toHaveValue('TQQQ');
    await expect(page.locator('[data-strategy-param-key="initial_holding"]')).toHaveCount(1);
    await expect(page.locator('#backtest_interval_control')).toHaveCount(1);
    await expect(page.locator('#stop_loss')).not.toBeChecked();

    await chooseStrategy('dca');
    await expect(page.locator('#ticker_1')).toHaveValue('TQQQ');
    await expect(page.locator('[data-strategy-param-key="frequency"]')).toHaveCount(1);
    await expect(page.locator('[data-strategy-param-key="initial_holding"]')).toHaveCount(0);
    await expect(page.locator('#backtest_interval_control')).toHaveCount(0);
    await expect(page.locator('#stop_loss')).toHaveCount(1);
    await expect(page.locator('#stop_loss')).not.toBeChecked();

    await chooseStrategy('grid-trading');
    await expect(page.locator('#ticker_1')).toHaveValue('TQQQ');
    await expect(page.locator('[data-strategy-param-key="initial_holding"]')).toHaveCount(1);
    await expect(page.locator('[data-strategy-param-key="frequency"]')).toHaveCount(0);
    await expect(page.locator('#backtest_interval_control')).toHaveCount(1);
});

test('keeps strategy parameters below Strategy and scrolls the Backtest sidebar', async ({page}) => {
    await page.setViewportSize({width: 972, height: 820});
    await page.goto('/workspaces/backtest?ticker=TQQQ&range=3y&strategy=supertrend-ai&stop_loss=0');

    const tuneButton = page.locator('[data-trade-strategy-tune-button]');
    const paramsPanel = page.locator('#trade_strategy_params_panel');
    const controlsSurface = page.locator('[data-backtest-parameter-panel]');
    await expect(tuneButton).toHaveAttribute('aria-expanded', 'true');
    await expect(paramsPanel).toBeVisible();

    const geometry = await paramsPanel.evaluate((panel) => {
        const panelRect = panel.getBoundingClientRect();
        const surface = panel.closest('[data-backtest-parameter-panel]');
        const grid = panel.querySelector('[data-trade-strategy-params-grid]');
        const anchorRect = panel.closest('[data-trade-strategy-field]')
            ?.querySelector('.trade-strategy-row')
            ?.getBoundingClientRect();
        return {
            flipped: panel.classList.contains('is-flipped'),
            panel: {top: panelRect.top, bottom: panelRect.bottom},
            anchor: anchorRect ? {top: anchorRect.top, bottom: anchorRect.bottom} : null,
            inlineStyle: {
                bottom: panel.style.bottom,
                height: panel.style.height,
                maxHeight: panel.style.maxHeight,
                top: panel.style.top,
            },
            grid: grid instanceof HTMLElement ? {
                isScrollableClass: grid.classList.contains('is-scrollable'),
                maxHeight: getComputedStyle(grid).maxHeight,
                overflowY: getComputedStyle(grid).overflowY,
            } : null,
            surface: surface instanceof HTMLElement ? {
                clientHeight: surface.clientHeight,
                overflowY: getComputedStyle(surface).overflowY,
                scrollHeight: surface.scrollHeight,
            } : null,
        };
    });

    expect(geometry.flipped).toBe(false);
    expect(geometry.anchor).not.toBeNull();
    expect(geometry.panel.top).toBeGreaterThanOrEqual((geometry.anchor?.bottom || 0) + 3);
    expect(geometry.inlineStyle).toEqual({bottom: '', height: '', maxHeight: '', top: ''});
    expect(geometry.grid).not.toBeNull();
    expect(geometry.grid.overflowY).toBe('visible');
    expect(geometry.grid.maxHeight).toBe('none');
    expect(geometry.grid.isScrollableClass).toBe(false);
    expect(geometry.surface).not.toBeNull();
    expect(geometry.surface.overflowY).toBe('auto');
    expect(geometry.surface.scrollHeight).toBeGreaterThan(geometry.surface.clientHeight);
    await controlsSurface.evaluate((surface) => {
        surface.scrollTop = surface.scrollHeight;
    });
    const lastParameter = paramsPanel.locator('details[open] [data-strategy-param-key]').last();
    await expect(lastParameter).toBeVisible();
    const scrolledGeometry = await page.evaluate(() => {
        const surface = document.querySelector('[data-backtest-parameter-panel]');
        const lastParameterField = document.querySelector(
            '#trade_strategy_params_panel details[open] [data-strategy-param-key]:last-child',
        );
        if (!(surface instanceof HTMLElement) || !(lastParameterField instanceof HTMLElement)) return null;
        const surfaceRect = surface.getBoundingClientRect();
        const fieldRect = lastParameterField.getBoundingClientRect();
        return {
            fieldBottom: fieldRect.bottom,
            fieldTop: fieldRect.top,
            surfaceBottom: surfaceRect.bottom,
            surfaceTop: surfaceRect.top,
        };
    });
    expect(scrolledGeometry).not.toBeNull();
    expect(scrolledGeometry.fieldTop).toBeGreaterThanOrEqual(scrolledGeometry.surfaceTop);
    expect(scrolledGeometry.fieldBottom).toBeLessThanOrEqual(scrolledGeometry.surfaceBottom + 1);

    await controlsSurface.evaluate((surface) => {
        surface.scrollTop = 0;
    });
    await page.setViewportSize({width: 390, height: 844});
    await openBacktestParameterOverlay(page);
    await expect(controlsSurface).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect.poll(() => page.evaluate(() => {
        const panel = document.getElementById('trade_strategy_params_panel');
        const surface = document.querySelector('[data-backtest-parameter-panel]');
        const strategyRow = document.querySelector('[data-trade-strategy-field] .trade-strategy-row');
        const scrollingElement = document.scrollingElement;
        if (!(panel instanceof HTMLElement)
            || !(surface instanceof HTMLElement)
            || !(strategyRow instanceof HTMLElement)
            || !(scrollingElement instanceof HTMLElement)) return null;
        const scrollCandidates = [scrollingElement];
        for (let candidate = panel.parentElement; candidate; candidate = candidate.parentElement) {
            scrollCandidates.push(candidate);
        }
        return {
            belowStrategy: panel.getBoundingClientRect().top
                >= strategyRow.getBoundingClientRect().bottom + 3,
            horizontalFits: document.documentElement.scrollWidth
                <= document.documentElement.clientWidth,
            hasVerticalScrollPath: scrollCandidates.some((candidate) => {
                if (!(candidate instanceof HTMLElement)) return false;
                const overflowY = getComputedStyle(candidate).overflowY;
                return ['auto', 'scroll'].includes(overflowY)
                    && candidate.scrollHeight > candidate.clientHeight;
            }),
            surfaceOverflowY: getComputedStyle(surface).overflowY,
        };
    })).toEqual({
        belowStrategy: true,
        hasVerticalScrollPath: true,
        horizontalFits: true,
        surfaceOverflowY: 'auto',
    });

    await lastParameter.scrollIntoViewIfNeeded();
    await expect.poll(() => lastParameter.evaluate((field) => {
        const rect = field.getBoundingClientRect();
        return rect.top >= 0 && rect.bottom <= window.innerHeight + 1;
    })).toBe(true);
});

test('keeps narrow Backtest tables scrollable and the section-resizer ARIA state accurate', async ({page}) => {
    await page.setViewportSize({width: 1280, height: 720});
    await page.goto('/workspaces/backtest?show_trade_details=1&ticker=TQQQ&range=5y&strategy=dca&stop_loss=0&month_day=1');
    await page.setViewportSize({width: 390, height: 844});
    const visibleNoticeClose = page.locator('[data-dismissible-notice]:not([hidden]) .notice-close').first();
    if (await visibleNoticeClose.isVisible()) {
        await visibleNoticeClose.locator('..').hover();
        await expect(visibleNoticeClose).toHaveCSS('pointer-events', 'auto');
        await visibleNoticeClose.click();
    }
    await setSidebarExpanded(page, false);

    const historyShell = page.locator('#backtest_history_table_wrap');
    const historyScroll = page.locator('#backtest_history_table_scroll');
    const headerTable = historyShell.locator('[data-table-header]');
    const resizer = page.locator('#backtest_section_resizer');
    await expect(historyShell).toBeVisible();
    await expect(historyScroll).toBeVisible();
    await expect(resizer).toHaveAttribute('aria-valuenow', /\d+/);

    await expect.poll(() => page.evaluate(() => {
        const scroll = document.getElementById('backtest_history_table_scroll');
        const bodyTable = scroll?.querySelector('[data-table-body]');
        const shell = document.querySelector('#backtest_history_table_wrap');
        const resizerElement = document.getElementById('backtest_section_resizer');
        const overview = document.querySelector('.backtest-trade-performance-card');
        if (!scroll || !bodyTable || !shell || !resizerElement || !overview) return null;
        const valueNow = Number(resizerElement.getAttribute('aria-valuenow'));
        const valueMin = Number(resizerElement.getAttribute('aria-valuemin'));
        const valueMax = Number(resizerElement.getAttribute('aria-valuemax'));
        return {
            bodyWidth: bodyTable.getBoundingClientRect().width,
            clientWidth: scroll.clientWidth,
            scrollWidth: scroll.scrollWidth,
            viewportWidth: document.documentElement.clientWidth,
            nowrap: getComputedStyle(bodyTable.querySelector('tbody td') || bodyTable).whiteSpace,
            paginationInsideShell: shell.contains(document.getElementById('tradeTransactionsPagination')),
            ariaMatchesOverview: valueNow === Math.round(overview.getBoundingClientRect().height),
            ariaInRange: valueNow >= valueMin && valueNow <= valueMax,
            historyVerticallyScrollable: scroll.scrollHeight > scroll.clientHeight,
        };
    })).toEqual(expect.objectContaining({
        bodyWidth: expect.any(Number),
        clientWidth: expect.any(Number),
        scrollWidth: expect.any(Number),
        nowrap: 'nowrap',
        paginationInsideShell: true,
        ariaMatchesOverview: true,
        ariaInRange: true,
        historyVerticallyScrollable: true,
    }));

    const tableMetrics = await historyScroll.evaluate((scroll) => ({
        clientWidth: scroll.clientWidth,
        clientHeight: scroll.clientHeight,
        scrollWidth: scroll.scrollWidth,
    }));
    expect(tableMetrics.clientHeight).toBeGreaterThan(0);
    expect(tableMetrics.scrollWidth).toBeGreaterThanOrEqual(720);
    expect(tableMetrics.clientWidth).toBeLessThanOrEqual(390);
    expect(tableMetrics.scrollWidth).toBeGreaterThan(tableMetrics.clientWidth);
    const horizontalOffset = await historyScroll.evaluate((scroll) => {
        scroll.scrollLeft = Math.min(96, scroll.scrollWidth - scroll.clientWidth);
        scroll.dispatchEvent(new Event('scroll'));
        return scroll.scrollLeft;
    });
    expect(horizontalOffset).toBeGreaterThan(0);
    await expect.poll(() => headerTable.evaluate((header) => Number.parseFloat(header.style.translate || '0')))
        .toBe(-horizontalOffset);

    const historyScrollMoved = await historyScroll.evaluate((scroll) => {
        const before = scroll.scrollTop;
        scroll.scrollTop = Math.min(scroll.scrollHeight - scroll.clientHeight, before + 120);
        return scroll.scrollTop > before;
    });
    expect(historyScrollMoved).toBe(true);
});

test('uses the shared 28px numeric control and iPad keyboard contract in Portfolio', async ({page}) => {
    await page.goto('/workspaces/portfolio?ticker=QQQ&ticker=AAPL&weight=60&weight=40&period=1y');

    const numericContract = await page.locator('input[type="number"]').evaluateAll((inputs) => (
        inputs.map((input) => {
            const style = getComputedStyle(input);
            return {
                height: style.height,
                minHeight: style.minHeight,
                inputMode: input.getAttribute('inputmode'),
            };
        })
    ));
    expect(numericContract).toHaveLength(4);
    expect(numericContract.every((control) => (
        control.height === '28px'
        && control.minHeight === '28px'
        && control.inputMode === 'numeric'
    ))).toBe(true);
});

test('keeps the shared dock centered inside the expanded sidebar at intermediate widths', async ({page}) => {
    await mockInvestmentReadApis(page);
    await page.goto('/trade/investment');

    const readDockGeometry = () => page.evaluate(() => {
        const sidebar = document.querySelector('#app_sidebar')?.getBoundingClientRect();
        const dock = document.querySelector('.sidebar-dock')?.getBoundingClientRect();
        if (!sidebar || !dock) return null;
        return {
            centerDelta: Math.abs(
                (dock.left + (dock.width / 2))
                - (sidebar.left + (sidebar.width / 2))
            ),
            dockLeft: dock.left,
            dockRight: dock.right,
            sidebarExpanded: document.querySelector('#sidebar_toggle')?.getAttribute('aria-expanded'),
        };
    });

    for (const width of [601, 744, 755, 767]) {
        await page.setViewportSize({width, height: 675});
        await expect.poll(async () => {
            const geometry = await readDockGeometry();
            return Boolean(
                geometry
                && geometry.sidebarExpanded === 'true'
                && geometry.centerDelta <= 0.5
                && geometry.dockLeft >= 0
                && geometry.dockRight <= width
            );
        }).toBe(true);

        const geometry = await readDockGeometry();
        expect(geometry.centerDelta).toBeLessThanOrEqual(0.5);
        expect(geometry.dockLeft).toBeGreaterThanOrEqual(0);
        expect(geometry.dockRight).toBeLessThanOrEqual(width);
    }
});

test('keeps the narrow-screen sidebar toggle clear of the sidebar edge and theme action', async ({page}) => {
    await page.setViewportSize({width: 375, height: 667});
    await page.goto('/settings/about');

    await page.locator('#sidebar_toggle').click();
    await expect(page.locator('#sidebar_toggle')).toHaveAttribute('aria-expanded', 'true');

    const geometry = () => page.evaluate(() => {
        const rectFor = (selector) => {
            const element = document.querySelector(selector);
            if (!element) return null;
            const {left, right, top, bottom} = element.getBoundingClientRect();
            return {left, right, top, bottom};
        };
        return {
            sidebar: rectFor('#app_sidebar'),
            toggle: rectFor('#sidebar_toggle'),
            theme: rectFor('#global_theme_toggle'),
        };
    });

    const toggleInset = await page.evaluate(() => {
        const rawValue = getComputedStyle(document.documentElement)
            .getPropertyValue('--sidebar-overlay-toggle-inset');
        return Number.parseFloat(rawValue.match(/[0-9]+(?:\.[0-9]+)?/)?.[0] || 'NaN');
    });
    await expect.poll(async () => {
        const {sidebar, toggle} = await geometry();
        return sidebar && toggle ? Math.abs((sidebar.right - toggle.right) - toggleInset) : null;
    }).toBeLessThanOrEqual(0.5);
    await expect.poll(async () => {
        const {theme, toggle} = await geometry();
        return theme && toggle ? theme.left - toggle.right : null;
    }).toBeGreaterThanOrEqual(12);
});
