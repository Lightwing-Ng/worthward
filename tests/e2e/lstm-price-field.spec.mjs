/* Shared LSTM / Bayesian Price Field E2E. Code version: v1.10.1 */
import {expect, test} from '@playwright/test';

const lstmUrl = (
    '/workspaces/backtest?ticker=DRAM&strategy=lstm-price-field'
    + '&show_trade_details=0&compute_backend=CPU&lstm_epochs=1'
    + '&lstm_lookback=4&lstm_hidden_size=4&training_window=40'
);
const bayesianUrl = (
    '/workspaces/backtest?ticker=DRAM&strategy=bayesian-price-field'
    + '&show_trade_details=0&compute_backend=CPU&training_window=40'
);
const auditUrls = [
    {
        id: 'lstm-price-field',
        url: '/workspaces/backtest?ticker=DRAM&strategy=lstm-price-field'
            + '&stop_loss=0&show_trade_details=0&cell_display_threshold=2.50',
        schema: 'lstm-price-field/v1',
    },
    {
        id: 'bayesian-price-field',
        url: '/workspaces/backtest?ticker=DRAM&strategy=bayesian-price-field'
            + '&stop_loss=0&show_trade_details=0'
            + '&use_option_call_volume=1&use_pe_ratio=0'
            + '&use_option_put_call_open_interest_ratio=1'
            + '&use_option_put_call_volume_ratio=1'
            + '&cell_display_threshold=2.50&training_window=30'
            + '&chip_window=41&prior_strength=1.51',
        schema: 'bayesian-price-field/v1',
    },
];

const injectPriceFieldPresentation = async (page, schema) => page.evaluate((presentationSchema) => {
    const result = window.WORTHWARD_APP?.backtestResult;
    if (!result?.chart) throw new Error('Backtest chart shell is unavailable.');
    const rawDates = [];
    const cursor = new Date('2026-01-02T00:00:00Z');
    while (rawDates.length < 64) {
        const weekday = cursor.getUTCDay();
        if (weekday !== 0 && weekday !== 6) rawDates.push(cursor.toISOString().slice(0, 10));
        cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    const close = rawDates.map((_, index) => 40 + (index * 0.18) + (Math.sin(index / 5) * 1.4));
    const equity = close.map((value, index) => 10_000 + ((value - close[0]) * 40) + (index * 3));
    result.interval = '1d';
    result.multi_asset = false;
    result.trades = [];
    result.summary = {
        ...(result.summary || {}),
        ticker: 'DRAM',
        initial_capital: 10_000,
    };
    result.chart = {
        ...(result.chart || {}),
        dates: [...rawDates],
        raw_dates: [...rawDates],
        open: close.map((value) => value - 0.4),
        high: close.map((value) => value + 0.8),
        low: close.map((value) => value - 0.9),
        close,
        equity,
        all_in_equity: equity.map((value, index) => value + index),
    };
    result.strategy_presentation = {
        schema: presentationSchema,
        renderer: 'probability-grid-v1',
        rows_above: 10,
        rows_below: 10,
        columns: 20,
        width_fraction: 0.25,
        gap_px: 2,
        padding_px: 8,
        min_cell_px: 4,
        cell_opacity_mapping: 'instant-contrast-power-v1',
        cell_opacity_exponent: 1.6,
        cell_opacity_tail_ratio: 0.02,
        cell_display_threshold_pct: 0,
        time_quantization: 'integer-trading-days',
        distribution_kind: 'dynamic-normal-log-return',
        target_interval: 'next-open-to-following-open',
        price_anchor_kind: 'signal-close-display-anchor',
        multi_step_kind: 'causal-ar1-return-state',
        return_autoregression: rawDates.map((_, index) => (index < 4 ? null : 0.2)),
        return_long_run_mean: rawDates.map((_, index) => (index < 4 ? null : 0)),
        return_innovation_scale: rawDates.map((_, index) => (index < 4 ? null : 0.012)),
        data_keys: [...rawDates],
        predictive_mean: rawDates.map((_, index) => (index < 4 ? null : 0.001)),
        predictive_scale: rawDates.map((_, index) => (index < 4 ? null : 0.02)),
    };
    window.WORTHWARD_BOOTSTRAP?.initBacktestWorkspace?.();
    window.WORTHWARD_BOOTSTRAP?.initBacktestLayout?.();
}, schema);

const readGridContract = async (page) => page.evaluate(() => {
    const gridApi = window.WORTHWARD_BACKTEST_PROBABILITY_GRID;
    const scripts = [...document.querySelectorAll('script[src]')].map((node) => node.getAttribute('src') || '');
    const panel = document.querySelector('#backtest_probability_detail_panel');
    const grid = document.querySelector('[data-backtest-probability-grid]');
    const cells = [...(grid?.querySelectorAll('.backtest-probability-cell') || [])];
    const first = cells[0]?.getBoundingClientRect();
    const second = cells[1]?.getBoundingClientRect();
    return {
        version: gridApi?.BACKTEST_PROBABILITY_GRID_VERSION,
        schemas: gridApi?.PRESENTATION_SCHEMAS,
        strategyIds: gridApi?.PRICE_FIELD_STRATEGY_IDS,
        renderer: gridApi?.RENDERER_ID,
        script: scripts.find((src) => src.includes('probability-grid.js')),
        backtestScript: scripts.find((src) => src.includes('backtest.js') && !src.includes('probability-grid')),
        appScript: scripts.find((src) => src.includes('app.js')),
        panelTitle: document.querySelector('#backtest_probability_detail_title')?.textContent?.trim(),
        hasPriceFieldTab: Boolean(document.querySelector('#backtest_history_probability')),
        optionCount: document.querySelector('[data-backtest-history-view-segmented]')?.getAttribute('data-option-count'),
        panelPresent: panel instanceof HTMLElement,
        cellCount: cells.length,
        firstSquare: first ? Math.abs(first.width - first.height) : null,
        gap: first && second ? Math.abs(second.left - first.right) : null,
        overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
});

for (const width of [1276, 1018]) {
    test(`Price Field future drag preserves the cursor, fixed axis, and badges at ${width}px`, async ({page}) => {
        await page.setViewportSize({width, height: 1079});
        await page.emulateMedia({colorScheme: width === 1018 ? 'dark' : 'light'});
        await page.goto(lstmUrl);
        await injectPriceFieldPresentation(page, 'lstm-price-field/v1');
        const read = () => page.evaluate(() => {
            const stack = document.querySelector('.trade-chart-stack');
            const chart = Chart.getChart('tradePriceChart');
            const canvas = chart.canvas.getBoundingClientRect();
            const rect = stack.getBoundingClientRect();
            const line = stack.querySelector('.trade-chart-hover-line').getBoundingClientRect();
            const axis = stack.querySelector('.backtest-fixed-price-axis');
            const date = stack.querySelector('.trade-chart-hover-date-label');
            const field = stack.querySelector('.backtest-probability-tooltip');
            const bounds = chart._activeBacktestProbabilityGridBounds;
            const price = chart._activeBacktestPriceGuideBounds;
            const ratio = chart.currentDevicePixelRatio;
            const nativeDatePixels = chart.ctx.getImageData(
                Math.round((chart.chartArea.right - 42) * ratio), Math.round((chart.chartArea.bottom + 1) * ratio),
                Math.round(40 * ratio), Math.round(18 * ratio),
            ).data;
            const badgePixel = price?.badgeLeft === undefined ? [] : [...axis.getContext('2d').getImageData(
                Math.round((price.badgeLeft + 2) * ratio), Math.round((price.badgeTop + 2) * ratio), 1, 1,
            ).data];
            return {
                stack: rect.toJSON(), axisX: axis.getBoundingClientRect().x,
                endpointX: canvas.left + chart.getDatasetMeta(0).data.at(-1).x,
                endpointY: canvas.top + chart.getDatasetMeta(0).data.at(-1).y,
                guideX: line.x + line.width / 2, guideY: price?.y,
                gridY: bounds?.anchorY, index: bounds?.index, fieldWidth: bounds?.width,
                fieldRight: field.getBoundingClientRect().right, date: date.getBoundingClientRect().toJSON(),
                visible: field.classList.contains('is-visible') && !date.hidden,
                pinned: field.dataset.pinned, badgePixel,
                axisPixel: [...axis.getContext('2d').getImageData(2, 2, 1, 1).data],
                nativeDateInk: nativeDatePixels.filter((value, index) => index % 4 === 3 && value > 0).length,
                overflow: stack.classList.contains('has-probability-overflow'),
                pan: Number(stack.dataset.probabilityPanVisualPosition || 0),
            };
        });
        const initial = await read();
        const startX = Math.floor(initial.endpointX - 2);
        const y = Math.round(width === 1018 ? initial.endpointY : initial.stack.top + initial.stack.height * 0.45);
        await page.mouse.move(startX, y);
        await expect.poll(async () => (await read()).overflow).toBe(true);
        const before = await read();
        expect(before.index).toBe(63);
        expect(before.axisPixel[3]).toBe(255);
        if (width === 1018) expect(before.axisPixel[0]).toBeLessThan(128);
        else expect(before.axisPixel[0]).toBeGreaterThan(200);
        const finishX = Math.floor(before.stack.right - before.fieldWidth - 24);
        await page.mouse.down();
        if (width === 1018) {
            const pressed = await read();
            expect(pressed.pinned).toBe('true');
            expect(pressed.pan).toBeCloseTo(before.pan, 2);
        }
        for (let step = 1; step <= 16; step += 1) {
            const x = Math.round(startX + (finishX - startX) * step / 16);
            await page.mouse.move(x, y);
            await page.evaluate(() => new Promise(requestAnimationFrame));
            const frame = await read();
            expect(Math.abs(frame.guideX - x)).toBeLessThanOrEqual(0.6);
            expect(frame.axisX).toBeCloseTo(initial.axisX, 1);
            expect(frame.index).toBe(before.index);
            expect(frame.gridY).toBeCloseTo(frame.guideY, 2);
            expect(frame.visible).toBe(true);
            expect(frame.badgePixel[3]).toBe(255);
            expect(frame.badgePixel[2]).toBeGreaterThan(frame.badgePixel[0]);
            expect(frame.nativeDateInk).toBe(0);
            expect(frame.date.left).toBeGreaterThanOrEqual(frame.stack.left);
            expect(frame.date.right).toBeLessThanOrEqual(frame.stack.right + 0.5);
        }
        await page.mouse.up();
        const after = await read();
        expect(after.pinned).not.toBe('true');
        expect(after.fieldRight).toBeLessThanOrEqual(after.stack.right);
        for (const offset of [-35, 30, -15, 0]) {
            // The synthetic endpoint is close to the top of the plot. Keep
            // vertical-only probes inside it; leaving is tested separately.
            const probeY = Math.min(after.stack.bottom - 2, Math.max(after.stack.top + 2, y + offset));
            await page.mouse.move(finishX, probeY);
            await page.evaluate(() => new Promise(requestAnimationFrame));
            const frame = await read();
            expect(frame.pan).toBeCloseTo(after.pan, 2);
            expect(frame.guideX).toBeCloseTo(finishX, 1);
            expect(frame.index).toBe(after.index);
        }
        await page.mouse.move(startX, y);
        await expect.poll(async () => Math.abs((await read()).guideX - startX)).toBeLessThan(0.6);
        await page.mouse.move(initial.stack.left - 10, y);
        await expect(page.locator('.backtest-probability-tooltip')).toBeHidden();
    });
}

test('Price Field explains threshold-empty forecasts without losing the last date', async ({page}) => {
    await page.setViewportSize({width: 1276, height: 1079});
    await page.goto(lstmUrl);
    await injectPriceFieldPresentation(page, 'lstm-price-field/v1');
    await page.evaluate(() => {
        const p = window.WORTHWARD_APP.backtestResult.strategy_presentation;
        p.predictive_scale.fill(2);
        p.return_innovation_scale.fill(2);
        p.cell_display_threshold_pct = 2;
        window.WORTHWARD_BOOTSTRAP.initBacktestWorkspace();
    });
    await page.locator('label[for="backtest_history_probability"]').click();
    const point = await page.evaluate(() => {
        const c = Chart.getChart('tradePriceChart');
        const r = c.canvas.getBoundingClientRect();
        return {x: Math.floor(r.left + c.chartArea.right - 2), y: r.top + c.height / 2};
    });
    await page.mouse.move(point.x, point.y);
    await expect(page.locator('.backtest-probability-hint')).toContainText('All cells below 2.00%');
    await expect(page.locator('.backtest-probability-empty-state')).toContainText('All cells below 2.00%');
    expect(await page.evaluate(() => Chart.getChart('tradePriceChart')._activeBacktestProbabilityGridBounds.index)).toBe(63);
    await expect(page.locator('.trade-chart-hover-date-label')).toBeVisible();
});

test('LSTM Price Field reuses the shared probability grid and stays square at 390px', async ({page}) => {
    test.setTimeout(90_000);
    await page.setViewportSize({width: 1024, height: 841});
    await page.goto(lstmUrl);
    await expect(page.locator('#trade_strategy')).toHaveValue('lstm-price-field');
    await expect(page.locator('#trade_strategy option[value="lstm-price-field"]')).toHaveText('LSTM Price Field');
    await expect(page.locator('#backtest_history_probability')).toHaveCount(1);
    await expect(page.locator('input[name="lstm_lookback"]')).toHaveCount(1);
    await expect(page.locator('input[name="prior_strength"]')).toHaveCount(0);

    await injectPriceFieldPresentation(page, 'lstm-price-field/v1');
    await page.locator('label[for="backtest_history_probability"]').click();
    await expect(page.locator('#backtest_history_probability')).toBeChecked();
    await expect(page.locator('#backtest_probability_detail_panel')).toBeVisible();

    const priceCanvas = page.locator('#tradePriceChart');
    await expect.poll(() => page.evaluate(() => (
        window.Chart?.getChart?.(document.querySelector('#tradePriceChart'))
            ?.getDatasetMeta?.(0)?.data?.length || 0
    ))).toBeGreaterThan(10);
    const box = await priceCanvas.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box.x + (box.width * 0.55), box.y + (box.height * 0.45));

    const desktop = await readGridContract(page);
    expect(desktop.version).toBe('v0.29.0');
    expect(desktop.schemas).toEqual(['bayesian-price-field/v1', 'lstm-price-field/v1']);
    expect(desktop.renderer).toBe('probability-grid-v1');
    expect(desktop.script).toContain('backtest-probability-grid-v0.29.0');
    expect(desktop.backtestScript).toContain('backtest-v0.40.1');
    expect(desktop.appScript).toContain('app-v0.52.0');
    expect(desktop.panelTitle).toBe('Price field detail');
    expect(desktop.hasPriceFieldTab).toBe(true);
    expect(desktop.optionCount).toBe('3');
    expect(desktop.cellCount).toBeGreaterThan(0);
    expect(desktop.firstSquare).toBeLessThanOrEqual(0.51);
    expect(desktop.overflowX).toBeLessThanOrEqual(1);

    await page.setViewportSize({width: 390, height: 844});
    await page.waitForTimeout(200);
    const narrow = await readGridContract(page);
    expect(narrow.overflowX).toBeLessThanOrEqual(1);
    expect(narrow.script).toBe(desktop.script);
    expect(narrow.version).toBe(desktop.version);
});

test('LSTM private training actions stay in the private strategy parameters collapse', async ({page}) => {
    await page.setViewportSize({width: 1024, height: 841});
    await page.route('**/api/lstm-training', (route) => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({success: true, protocol_version: 2, runs: []}),
    }));
    await page.goto(lstmUrl);
    const tuneButton = page.locator('[data-trade-strategy-tune-button]');
    await expect(tuneButton).toHaveAttribute('aria-expanded', 'true');
    const paramsPanel = page.locator('#trade_strategy_params_panel');
    await expect(paramsPanel).toBeVisible();
    const privateMenu = paramsPanel.locator('[data-lstm-training-menu]');
    await expect(privateMenu).toHaveCount(1);
    await expect(privateMenu).toBeVisible();
    await expect(privateMenu.locator('[data-lstm-training-action="start"]')).toBeEnabled();
    await expect(privateMenu.locator('[data-lstm-training-action]')).toHaveCount(1);
    await expect(privateMenu.locator('[data-lstm-training-action="stop"]')).toHaveCount(0);
    await expect(privateMenu.locator('[data-lstm-training-status]')).toBeHidden();
    await expect(privateMenu.locator('.lstm-training-action')).toHaveCSS('font-size', '13px');
    await expect(privateMenu.locator('.lstm-training-action')).toHaveCSS('color', 'rgb(0, 85, 204)');
    await expect(privateMenu.locator('.lstm-training-action')).toHaveCSS('height', '31px');
    await expect(privateMenu.locator('[data-lstm-training-history]')).toHaveCount(1);
    await expect(privateMenu.locator('.lstm-training-history-collapse')).toHaveCount(1);
    await expect(page.locator('#trade_strategy_dropdown [data-lstm-training-menu]')).toHaveCount(0);
    await expect(page.locator('#app_sidebar [data-lstm-training-menu]')).toHaveCount(0);

    const menuRelation = await privateMenu.evaluate((node) => ({
        directPrivateHost: node.parentElement?.matches('[data-strategy-action-slot="lstm-training"]') || false,
        insideStrategyParams: Boolean(node.closest('#trade_strategy_params_panel')),
    }));
    expect(menuRelation).toEqual({directPrivateHost: true, insideStrategyParams: true});
    const iconMasks = await privateMenu.locator('.lstm-training-action-icon').evaluateAll((nodes) => (
        nodes.map((node) => getComputedStyle(node).maskImage || getComputedStyle(node).webkitMaskImage)
    ));
    expect(iconMasks[0]).toContain('/static/images/bolt.fill.svg');
    await expect(privateMenu.locator('.lstm-training-history-empty')).toHaveText('No historical LSTM training runs.');

    await expect(paramsPanel.locator(':scope > details > summary')).toHaveText([
        'LSTM parameters', 'LSTM training', 'Training factors',
    ]);
    const parametersSection = paramsPanel.locator('[data-collapse="parameters"]');
    await expect(parametersSection.locator('[data-strategy-param-key]')).toHaveCount(10);
    await expect(parametersSection.locator('[data-strategy-param-key]').first()).toHaveAttribute('data-strategy-param-key', 'cell_display_threshold');
    await expect(parametersSection.locator('[data-strategy-param-key]').last()).toHaveAttribute('data-strategy-param-key', 'compute_backend');

    const trainingSection = paramsPanel.locator('[data-collapse="training"]');
    await expect(trainingSection.locator(':scope > summary')).toHaveCSS('font-size', '15px');
    await expect(trainingSection.locator(':scope > summary')).toHaveCSS('font-weight', '500');
    const factorsSection = paramsPanel.locator('[data-collapse="factors"]');
    await expect(factorsSection.locator('[data-strategy-param-key]')).toHaveCount(23);
    await expect(trainingSection).toHaveCSS('border-top-width', '0px');
    const fieldValues = () => paramsPanel.locator('[data-strategy-param-input][name]').evaluateAll(
        (nodes) => nodes.map((node) => [node.name, node.value]),
    );
    const originalValues = await fieldValues();
    await factorsSection.locator(':scope > summary').click();
    await expect(privateMenu).toBeHidden();
    await expect(factorsSection.locator('[data-strategy-param-key="use_broker_holding"]')).toBeVisible();
    await trainingSection.locator(':scope > summary').focus();
    await page.keyboard.press('Enter');
    await expect(privateMenu).toBeVisible();
    await expect(factorsSection.locator('[data-trade-strategy-params-grid]')).toBeHidden();
    expect(await fieldValues()).toEqual(originalValues);

    let trainingRequest;
    await page.route('**/api/lstm-training/start', async (route) => {
        trainingRequest = route.request().postDataJSON();
        await route.fulfill({status: 202, contentType: 'application/json', body: JSON.stringify({success: true, run: {}})});
    });
    await factorsSection.locator(':scope > summary').click();
    await factorsSection.locator('[data-strategy-param-key="use_broker_holding"] [data-strategy-param-switch]').click();
    const selectedValues = Object.fromEntries(await fieldValues());
    await trainingSection.locator(':scope > summary').click();
    await privateMenu.locator('[data-lstm-training-action="start"]').click();
    await expect.poll(() => trainingRequest?.params).toEqual(selectedValues);
    expect(trainingRequest.ticker).toBe('DRAM');
    expect(trainingRequest.period).toBe('1y');
    expect(trainingRequest.interval).toBe('1d');
    expect(trainingRequest.params.use_broker_holding).not.toBe(Object.fromEntries(originalValues).use_broker_holding);

    await page.reload();
    await expect(privateMenu).toBeVisible();
    await expect(paramsPanel.locator('[data-collapse]')).toHaveCount(3);

    await tuneButton.click();
    await expect(paramsPanel).toBeHidden();
    await expect(privateMenu).toBeHidden();
    await tuneButton.click();
    await expect(paramsPanel).toBeVisible();
    await expect(privateMenu).toBeVisible();

    await page.setViewportSize({width: 390, height: 844});
    await expect(trainingSection.locator(':scope > summary')).toHaveCSS('font-size', '15px');
    await expect(trainingSection.locator(':scope > summary')).toHaveCSS('font-weight', '500');
    await expect(privateMenu).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});

test('LSTM training toggles one button and displays real progress and artifact metadata', async ({page}) => {
    test.setTimeout(60_000);
    let runs = [];
    let historyFails = false;
    let startRequests = 0;
    const run = {
        id: 'lstm-ga-aaaaaaaaaaaaaaaaaaaaaaaa', ticker: 'DRAM', period: '1y',
        status: 'running', active: true, started_at: '2026-09-04T00:00:00Z',
        progress: {completed: 25, total: 100, percent: 25},
        files: [{name: 'request.json', size_bytes: 1234}, {name: 'status.json', size_bytes: 256}],
    };
    await page.route('**/api/lstm-training', (route) => route.fulfill({
        status: historyFails ? 503 : 200, contentType: 'application/json',
        body: JSON.stringify(historyFails ? {success: false, error: 'History unavailable'} : {success: true, protocol_version: 2, runs}),
    }));
    await page.route('**/api/lstm-training/start', async (route) => {
        startRequests += 1;
        runs = [{...run}];
        await route.fulfill({status: 202, contentType: 'application/json', body: JSON.stringify({success: true, run: runs[0]})});
    });
    await page.route('**/api/lstm-training/stop', async (route) => {
        expect(route.request().postDataJSON()).toEqual({run_id: run.id});
        runs = [{...run, status: 'stopping'}];
        await route.fulfill({status: 202, contentType: 'application/json', body: JSON.stringify({success: true, run: runs[0]})});
    });
    await page.goto(lstmUrl);
    const menu = page.locator('[data-lstm-training-menu]');
    const button = menu.locator('[data-lstm-training-action]');
    await expect(button).toHaveText('Start training');
    await button.click();
    await expect(button).toHaveText('Stop training');
    await expect(button).toBeEnabled();
    await expect(button).toHaveCount(1);
    expect(startRequests).toBe(1);
    await expect(menu.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25');
    await expect(menu.locator('.lstm-training-history-details')).toBeHidden();
    await expect(menu.locator('.lstm-training-history-item')).toHaveCount(0);
    await expect(menu.locator('[data-lstm-training-progress] [role="progressbar"]')).toHaveCount(1);
    await expect(page.locator('.lstm-training-spinner')).toBeVisible();
    expect(await button.locator('.icon').evaluate((node) => getComputedStyle(node).maskImage)).toContain('/static/images/stop.fill.svg');
    await expect(menu.locator('.lstm-training-progress-fill')).toHaveCSS('background-image', 'none');
    expect(await menu.locator('.lstm-training-progress-fill').evaluate((node) => {
        const style = getComputedStyle(node);
        const token = style.getPropertyValue('--theme-accent-positive').trim();
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        context.fillStyle = token;
        const expected = context.fillStyle;
        context.fillStyle = style.backgroundColor;
        return context.fillStyle === expected;
    })).toBe(true);

    await button.click();
    await expect(button).toHaveText('Stopping training…');
    await expect(button).toBeDisabled();
    runs = [{...run, status: 'interrupted', active: false}];
    await expect(button).toHaveText('Start training', {timeout: 10_000});
    await expect(menu.getByRole('progressbar')).toHaveCount(0);
    await page.reload();
    await expect(button).toHaveText('Start training');
    await expect(menu.locator('.lstm-training-files')).toBeHidden();
    await page.setViewportSize({width: 390, height: 844});
    if (await page.locator('#sidebar_toggle').getAttribute('aria-expanded') === 'true') {
        await page.locator('#sidebar_toggle').click();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);

    runs = [{...run, status: 'starting', progress: {percent: null}}];
    await expect(button).toHaveText('Stop training', {timeout: 10_000});
    await expect(menu.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
    await expect(menu.locator('.lstm-training-progress-track')).toHaveClass(/is-indeterminate/);

    runs = [
        {...run, id: 'lstm-ga-bbbbbbbbbbbbbbbbbbbbbbbb', started_at: '2026-09-04T02:00:00Z', status: 'completed', active: false},
        {...run, status: 'completed', active: false},
    ];
    await expect(menu.locator('.lstm-training-history-item')).toHaveCount(2, {timeout: 10_000});
    await expect(menu.locator('.lstm-training-history-select[aria-expanded="true"]')).toHaveCount(0);
    await expect(menu.getByRole('progressbar')).toHaveCount(0);
    await expect(menu.locator('.lstm-training-history-select')).toHaveText(['DRAM260904(02)', 'DRAM260904(01)']);
    await expect(menu.locator('.lstm-training-history-identifier').first()).toHaveCSS('text-align', 'right');
    await menu.locator('.lstm-training-history-select').first().click();
    await expect(menu.locator('.lstm-training-files').first()).toBeVisible();
    await page.reload();
    await expect(menu.locator('.lstm-training-history-select[aria-expanded="true"]')).toHaveCount(0);
    await expect(menu.getByRole('progressbar')).toHaveCount(0);
    historyFails = true;
    await expect(menu.getByRole('status')).toHaveText('History unavailable', {timeout: 10_000});
    await expect(menu.getByRole('status')).toBeVisible();
});

test('LSTM history selects a complete case, detaches edits, and archives one result', async ({page}) => {
    test.setTimeout(90_000);
    await page.setViewportSize({width: 1021, height: 863});
    let runs = [];
    const deleted = [];
    await page.route('**/api/lstm-training', (route) => route.fulfill({
        contentType: 'application/json', body: JSON.stringify({success: true, protocol_version: 2, runs}),
    }));
    await page.route('**/api/lstm-training/delete', async (route) => {
        const id = route.request().postDataJSON().run_id;
        expect(route.request().headers()['x-csrf-token']).toBeTruthy();
        deleted.push(id);
        runs = runs.filter((run) => run.id !== id);
        await route.fulfill({contentType: 'application/json', body: JSON.stringify({success: true, id, recoverable: true})});
    });
    await page.goto(lstmUrl);
    const params = await page.locator('[data-strategy-param-input][name]').evaluateAll((inputs) => Object.fromEntries(inputs.map((input) => {
        const kind = input.closest('[data-strategy-param-kind]').dataset.strategyParamKind;
        return [input.name, kind === 'boolean' ? ['true', '1'].includes(input.value)
            : ['number', 'integer'].includes(kind) ? Number(input.value) : input.value];
    })));
    const configuration = {
        ticker: 'NVDA', period: '6mo', range: 'exact', from: '2026-03-04', to: '2026-07-14',
        interval: '1d', strategy: 'lstm-price-field', initial_capital: 25000,
        price_only: false, reinvest_dividends: true, stop_loss: false, show_trade_details: false,
        params: {...params, lstm_seed: 19, use_option_total_volume: true},
    };
    runs = [{
        id: 'lstm-ga-aaaaaaaaaaaaaaaaaaaaaaaa', ticker: 'NVDA', status: 'completed', active: false,
        started_at: '2026-09-04T00:00:00Z', identifier: '260904(01)', accuracy_pct: 65,
        configuration, files: [{name: 'request.json', size_bytes: 1234}],
    }, {
        id: 'lstm-ga-bbbbbbbbbbbbbbbbbbbbbbbb', ticker: 'DRAM', status: 'completed', active: false,
        started_at: '2026-09-04T01:00:00Z', identifier: '260904(02)', accuracy_pct: 61.25,
        configuration: {...configuration, ticker: 'DRAM', params: {...configuration.params, lstm_seed: 23}},
    }];
    const menu = page.locator('[data-lstm-training-menu]');
    const rows = menu.locator('.lstm-training-history-select');
    await expect(rows).toHaveCount(2, {timeout: 10_000});
    await expect(menu.locator('details, summary')).toHaveCount(0);
    await expect(menu.locator('.lstm-training-history-heading')).toHaveCSS('text-align', 'left');
    await expect(menu.locator('.lstm-training-accuracy').first()).toHaveText('65.00%');
    expect(await menu.locator('.lstm-training-history-identifier').first().evaluate((node) => getComputedStyle(node).fontFamily)).toContain('monospace');
    const buttonWidth = await menu.locator('.lstm-training-action').evaluate((node) => node.getBoundingClientRect().width);
    expect(buttonWidth).toBeLessThan(await menu.evaluate((node) => node.getBoundingClientRect().width) - 50);

    await rows.first().click();
    await expect(page).toHaveURL(/ticker=NVDA/);
    await expect(page.locator('[data-ticker-input]')).toHaveValue('NVDA');
    await expect(page.locator('[name="range"][value="exact"]')).toBeChecked();
    await expect(page.locator('[name="from"]')).toHaveValue('2026-03-04');
    await expect(page.locator('[name="to"]')).toHaveValue('2026-07-14');
    await expect(page.locator('[name="period"]')).toHaveValue('6mo');
    await expect(page.locator('#trade_initial_capital')).toHaveValue('25,000.00');
    await expect(page.locator('#include_dividends')).toBeChecked();
    await expect(page.locator('#stop_loss')).not.toBeChecked();
    await expect(page.locator('#strategy_param_lstm_seed')).toHaveValue('19');
    await expect(rows.first()).toHaveAttribute('aria-pressed', 'true');
    await expect(menu.locator('.lstm-training-selected-icon').first()).toBeVisible();
    await expect(menu.locator('.lstm-training-history-select[aria-expanded="true"]')).toHaveCount(1);
    expect(await menu.locator('.lstm-training-history-details').first().evaluate((node) => getComputedStyle(node).fontFamily)).toContain('monospace');
    await page.reload();
    expect(await page.locator('[data-strategy-param-input][name]').evaluateAll((inputs) => Object.fromEntries(inputs.map((input) => {
        const kind = input.closest('[data-strategy-param-kind]').dataset.strategyParamKind;
        return [input.name, kind === 'boolean' ? ['true', '1'].includes(input.value)
            : ['number', 'integer'].includes(kind) ? Number(input.value) : input.value];
    })))).toEqual(configuration.params);
    await expect(rows.first()).toHaveAttribute('aria-pressed', 'true');

    // A bookmarked case must survive a new session, not only an in-memory check.
    await expect(page).toHaveURL(/lstm_training_run=lstm-ga-aaaaaaaaaaaaaaaaaaaaaaaa/);
    await page.evaluate(() => sessionStorage.removeItem('worthward.lstm.selected-configuration.v1'));
    await page.reload();
    await expect(rows.first()).toHaveAttribute('aria-pressed', 'true');
    await expect(page).toHaveURL(/lstm_training_run=lstm-ga-aaaaaaaaaaaaaaaaaaaaaaaa/);

    // Two runs can have identical settings. Polling must retain the clicked run,
    // not reselect the case that originally supplied the URL.
    runs.push({...runs[0], id: 'lstm-ga-cccccccccccccccccccccccc', identifier: '260904(03)'});
    await expect(rows).toHaveCount(3, {timeout: 10_000});
    await rows.nth(2).click();
    await expect(page).toHaveURL(/lstm_training_run=lstm-ga-cccccccccccccccccccccccc/);
    await page.waitForResponse((response) => response.url().endsWith('/api/lstm-training'));
    await expect(rows.nth(2)).toHaveAttribute('aria-pressed', 'true');
    await expect(page).toHaveURL(/lstm_training_run=lstm-ga-cccccccccccccccccccccccc/);
    await rows.first().click();
    runs.pop();
    await expect(rows).toHaveCount(2, {timeout: 10_000});
    await page.locator('#trade_initial_capital').fill('35000');
    await expect(menu.locator('[aria-pressed="true"]')).toHaveCount(0);
    await expect(page).not.toHaveURL(/lstm_training_run=/);
    await rows.nth(1).click();
    await expect(page).toHaveURL(/ticker=DRAM/);
    await expect(page.locator('#strategy_param_lstm_seed')).toHaveValue('23');
    await expect(rows.nth(1)).toHaveAttribute('aria-pressed', 'true');
    await expect(menu.locator('.lstm-training-history-select[aria-expanded="true"]')).toHaveCount(1);
    await expect(menu.locator('.lstm-training-history-details').first()).toBeHidden();

    await page.setViewportSize({width: 390, height: 844});
    if (await page.locator('#sidebar_toggle').getAttribute('aria-expanded') === 'true') await page.locator('#sidebar_toggle').click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    // A narrow desktop viewport still uses a mouse: reveal the hover-only action first.
    await rows.nth(1).hover();
    const remove = menu.locator('[data-lstm-training-delete]').nth(1);
    await expect(remove).toHaveCSS('opacity', '1');
    await expect(remove).toHaveCSS('pointer-events', 'auto');
    await remove.click();
    await expect(rows).toHaveCount(1);
    expect(deleted).toEqual(['lstm-ga-bbbbbbbbbbbbbbbbbbbbbbbb']);
    await expect(menu.locator('[aria-pressed="true"]')).toHaveCount(0);
    await expect(menu.locator('.lstm-training-history-identifier')).toHaveText('260904(01)');
    await page.goto('/workspaces/backtest?strategy=lstm-price-field&dividends=1&show_trade_details=0&compute_backend=CPU&lstm_epochs=1');
    await expect(page.locator('#include_dividends')).toBeChecked();
});

test('server-side LSTM Price Field computes a real probability field and renders it', async ({page}) => {
    test.setTimeout(120_000);
    await page.setViewportSize({width: 1024, height: 841});
    await page.goto(lstmUrl);
    await expect(page.locator('#trade_strategy')).toHaveValue('lstm-price-field');
    const readLstmPresentation = () => page.evaluate(() => {
        const payload = window.WORTHWARD_APP?.backtestResult?.strategy_presentation;
        if (!payload || payload.schema !== 'lstm-price-field/v1') return null;
        const chart = window.WORTHWARD_APP?.backtestResult?.chart;
        const gridApi = window.WORTHWARD_BACKTEST_PROBABILITY_GRID;
        const normalized = gridApi?.normalizePresentation?.(payload, {
            raw_dates: chart?.raw_dates,
            length: Array.isArray(chart?.close) ? chart.close.length : null,
        });
        const means = Array.isArray(payload.predictive_mean) ? payload.predictive_mean : [];
        return {
            schema: payload.schema,
            renderer: payload.renderer,
            columns: payload.columns,
            rowsAbove: payload.rows_above,
            device: payload.device?.resolved || '',
            engine: payload.device?.engine || '',
            neuralConfirmed: Boolean(payload.device?.neural_engine_confirmed),
            featureNames: Array.isArray(payload.lstm?.feature_names)
                ? [...payload.lstm.feature_names]
                : [],
            originsTrained: Number(payload.device?.origins_trained || 0),
            originsFailedClosed: Number(payload.device?.origins_failed_closed || 0),
            trainMs: Number(payload.device?.train_ms || 0),
            finiteMeans: means.filter((value) => (
                value !== null && value !== undefined && Number.isFinite(Number(value))
            )).length,
            normalized: Boolean(normalized),
            hasProbabilityField: Boolean(
                document.querySelector('.trade-chart-stack')?.classList.contains('has-probability-field'),
            ),
        };
    });
    await expect.poll(readLstmPresentation, {timeout: 90_000}).not.toBeNull();
    const presentation = await readLstmPresentation();
    expect(presentation.schema).toBe('lstm-price-field/v1');
    expect(presentation.renderer).toBe('probability-grid-v1');
    expect(presentation.columns).toBe(20);
    expect(presentation.rowsAbove).toBe(10);
    expect(['cpu', 'mps', 'cuda']).toContain(presentation.device);
    expect(presentation.neuralConfirmed).toBe(false);
    expect(presentation.originsTrained).toBeGreaterThan(0);
    expect(presentation.originsFailedClosed).toBeLessThan(presentation.finiteMeans);
    expect(presentation.trainMs).toBeGreaterThan(0);
    expect(presentation.featureNames).toContain('lstm_lagged_close_return');
    expect(presentation.featureNames).not.toContain('pe');
    expect(presentation.finiteMeans).toBeGreaterThan(0);
    expect(presentation.normalized).toBe(true);
    expect(presentation.hasProbabilityField).toBe(true);

    await page.evaluate(() => {
        window.WORTHWARD_BOOTSTRAP?.initBacktestWorkspace?.();
        window.WORTHWARD_BOOTSTRAP?.initBacktestLayout?.();
    });

    const tuneButton = page.locator('[data-trade-strategy-tune-button]');
    if ((await tuneButton.getAttribute('aria-pressed')) === 'true') {
        await tuneButton.click();
        await expect(tuneButton).toHaveAttribute('aria-pressed', 'false');
    }

    await page.locator('label[for="backtest_history_probability"]').click();
    await expect(page.locator('#backtest_history_probability')).toBeChecked();
    await expect(page.locator('#backtest_probability_detail_panel')).toBeVisible();
    const readForecastableAnchor = () => page.evaluate(() => {
        const canvas = document.querySelector('#tradePriceChart');
        const chart = window.Chart?.getChart?.(canvas);
        const points = chart?.getDatasetMeta?.(0)?.data || [];
        const rect = canvas?.getBoundingClientRect();
        const chartArea = chart?.chartArea;
        const chartWidth = Number(chart?.width);
        const chartHeight = Number(chart?.height);
        const payload = window.WORTHWARD_APP?.backtestResult?.strategy_presentation;
        const normalized = window.WORTHWARD_BACKTEST_PROBABILITY_GRID?.normalizePresentation?.(
            payload,
            {
                raw_dates: window.WORTHWARD_APP?.backtestResult?.chart?.raw_dates,
                length: window.WORTHWARD_APP?.backtestResult?.chart?.close?.length,
            },
        );
        if (!(canvas instanceof HTMLCanvasElement) || !rect || !chartArea
            || !(chartWidth > 0) || !(chartHeight > 0) || !normalized) {
            return null;
        }
        const centerY = (chartArea.top + chartArea.bottom) / 2;
        const candidates = points
            .map((point, index) => {
                const parsed = chart.getDatasetMeta(0)?.controller?.getParsed?.(index);
                const x = Number(point?.x);
                const y = Number.isFinite(Number(point?.y))
                    ? Number(point.y)
                    : Number(chart.scales?.y?.getPixelForValue?.(parsed?.y));
                return {index, x, y};
            })
            .filter(({index, x, y}) => (
                Number.isFinite(x)
                && Number.isFinite(y)
                && normalized.predictive_mean?.[index] !== null
                && normalized.predictive_scale?.[index] !== null
                && Number.isFinite(Number(normalized.predictive_mean?.[index]))
                && Number.isFinite(Number(normalized.predictive_scale?.[index]))
                && Number(normalized.predictive_scale[index]) > 0
            ));
        if (!candidates.length) {
            const finitePoints = points.filter((point) => (
                Number.isFinite(Number(point?.x)) && Number.isFinite(Number(point?.y))
            )).length;
            const finiteNormMeans = Array.isArray(normalized.predictive_mean)
                ? normalized.predictive_mean.filter((value) => value !== null).length
                : 0;
            return {
                error: 'no-forecastable-anchor',
                pointCount: points.length,
                finitePoints,
                finiteNormMeans,
                meanLength: normalized.predictive_mean?.length || 0,
                closeLength: window.WORTHWARD_APP?.backtestResult?.chart?.close?.length || 0,
                dataKey: window.WORTHWARD_APP?.backtestResult?.strategy_presentation?.data_keys?.[0] || '',
                rawDate: window.WORTHWARD_APP?.backtestResult?.chart?.raw_dates?.[0] || '',
            };
        }
        const nearest = candidates.reduce((best, candidate) => (
            Math.abs(candidate.y - centerY) < Math.abs(best.y - centerY)
                ? candidate
                : best
        ));
        return {
            index: nearest.index,
            x: rect.left + (nearest.x * (rect.width / chartWidth)),
            y: rect.top + (nearest.y * (rect.height / chartHeight)),
        };
    });
    await expect.poll(readForecastableAnchor, {timeout: 15_000}).toEqual(expect.objectContaining({
        index: expect.any(Number),
        x: expect.any(Number),
        y: expect.any(Number),
    }));
    const hoverAnchor = await readForecastableAnchor();
    expect(Number.isInteger(hoverAnchor?.index)).toBe(true);
    await page.mouse.move(hoverAnchor.x, hoverAnchor.y);
    await expect.poll(() => page.evaluate((pointerX) => {
        const canvas = document.querySelector('#tradePriceChart');
        const chart = window.Chart.getChart(canvas);
        const rect = canvas.getBoundingClientRect();
        const chartX = (Math.trunc(pointerX) - rect.left) * chart.width / rect.width;
        const expectedIndex = chart.getDatasetMeta(0).data
            .map((point, index) => ({point, index}))
            .filter(({point}) => Number.isFinite(point.x) && Number.isFinite(point.y))
            .reduce((best, candidate) => Math.abs(candidate.point.x - chartX)
                < Math.abs(best.point.x - chartX) ? candidate : best).index;
        const tooltipCells = document.querySelectorAll(
            '[data-backtest-chart-tooltip="probability-grid"] .backtest-probability-cell',
        ).length;
        const detailCells = document.querySelectorAll(
            '#backtest_probability_detail_panel .backtest-probability-detail-cell',
        ).length;
        return {
            tooltipCells,
            detailCells,
            tooltipVisible: document.querySelector(
                '[data-backtest-chart-tooltip="probability-grid"]',
            )?.classList.contains('is-visible') === true,
            activeIndex: window.Chart?.getChart?.(document.querySelector('#tradePriceChart'))
                ?._activeBacktestProbabilityGridBounds?.index,
            tracksVisibleCurve: chart._activeBacktestProbabilityGridBounds?.index === expectedIndex,
        };
    }, hoverAnchor.x), {timeout: 15_000}).toEqual(expect.objectContaining({
        tooltipVisible: true,
        tracksVisibleCurve: true,
    }));
    const rendered = await page.evaluate(() => ({
        tooltipCells: document.querySelectorAll(
            '[data-backtest-chart-tooltip="probability-grid"] .backtest-probability-cell',
        ).length,
        detailCells: document.querySelectorAll(
            '#backtest_probability_detail_panel .backtest-probability-detail-cell',
        ).length,
        panelTitle: document.querySelector('#backtest_probability_detail_title')?.textContent?.trim(),
        statusText: document.querySelector(
            '#backtest_probability_detail_panel [data-backtest-probability-detail-status]',
        )?.textContent?.trim(),
    }));
    expect(rendered.tooltipCells).toBeGreaterThan(0);
    expect(rendered.detailCells).toBeGreaterThan(0);
    expect(rendered.panelTitle).toBe('Price field detail');
    expect(rendered.statusText).toMatch(
        /^Selected date: \d{1,2} [A-Z][a-z]{2} \d{4} · LSTM training: [\d,]+ causal origins · backend: (CPU|MPS|CUDA) · [\d,]+ ms$/,
    );
});

test('Bayesian Price Field uses the same probability-grid module as LSTM', async ({page}) => {
    test.setTimeout(90_000);
    await page.setViewportSize({width: 1024, height: 841});
    await page.goto(bayesianUrl);
    await expect(page.locator('#trade_strategy')).toHaveValue('bayesian-price-field');
    await injectPriceFieldPresentation(page, 'bayesian-price-field/v1');
    const contract = await readGridContract(page);
    expect(contract.version).toBe('v0.29.0');
    expect(contract.script).toContain('backtest-probability-grid-v0.29.0');
    expect(contract.schemas).toEqual(['bayesian-price-field/v1', 'lstm-price-field/v1']);
    expect(contract.hasPriceFieldTab).toBe(true);
    expect(contract.panelTitle).toBe('Price field detail');
});

test('the two supplied DRAM audit URLs render model-specific fields on the shared contract', async ({page}) => {
    test.setTimeout(180_000);
    await page.setViewportSize({width: 1024, height: 841});

    for (const audit of auditUrls) {
        await page.goto(audit.url);
        await expect(page.locator('#trade_strategy')).toHaveValue(audit.id);
        await expect(page.locator('#backtest_history_probability')).toHaveCount(1);
        await expect.poll(() => page.evaluate(() => {
            const result = window.WORTHWARD_APP?.backtestResult;
            const presentation = result?.strategy_presentation;
            return {
                schema: presentation?.schema || '',
                renderer: presentation?.renderer || '',
                columns: Number(presentation?.columns || 0),
                showTradeDetails: document.querySelector('#show_trade_details')?.checked === true,
            };
        }), {timeout: 120_000}).toEqual({
            schema: audit.schema,
            renderer: 'probability-grid-v1',
            columns: 20,
            showTradeDetails: false,
        });
    }
});
