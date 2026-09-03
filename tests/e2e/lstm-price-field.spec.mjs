/* Shared LSTM / Bayesian Price Field E2E. Code version: v1.0.0 */
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
    expect(desktop.version).toBe('v0.26.0');
    expect(desktop.schemas).toEqual(['bayesian-price-field/v1', 'lstm-price-field/v1']);
    expect(desktop.renderer).toBe('probability-grid-v1');
    expect(desktop.script).toContain('backtest-probability-grid-v0.26.0');
    expect(desktop.backtestScript).toContain('backtest-v0.38.0');
    expect(desktop.appScript).toContain('app-v0.51.0');
    expect(desktop.panelTitle).toBe('LSTM Price Field detail');
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

test('Bayesian Price Field uses the same probability-grid module as LSTM', async ({page}) => {
    test.setTimeout(90_000);
    await page.setViewportSize({width: 1024, height: 841});
    await page.goto(bayesianUrl);
    await expect(page.locator('#trade_strategy')).toHaveValue('bayesian-price-field');
    await injectPriceFieldPresentation(page, 'bayesian-price-field/v1');
    const contract = await readGridContract(page);
    expect(contract.version).toBe('v0.26.0');
    expect(contract.script).toContain('backtest-probability-grid-v0.26.0');
    expect(contract.schemas).toEqual(['bayesian-price-field/v1', 'lstm-price-field/v1']);
    expect(contract.hasPriceFieldTab).toBe(true);
    expect(contract.panelTitle).toBe('Bayesian Price Field detail');
});
