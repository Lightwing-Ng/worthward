/* Shared LSTM / Bayesian Price Field E2E. Code version: v1.2.1 */
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
    expect(desktop.backtestScript).toContain('backtest-v0.38.6');
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
    await expect.poll(() => page.evaluate(() => {
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
        };
    }), {timeout: 15_000}).toEqual(expect.objectContaining({
        tooltipVisible: true,
        activeIndex: hoverAnchor.index,
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
    expect(rendered.panelTitle).toBe('LSTM Price Field detail');
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
    expect(contract.version).toBe('v0.26.0');
    expect(contract.script).toContain('backtest-probability-grid-v0.26.0');
    expect(contract.schemas).toEqual(['bayesian-price-field/v1', 'lstm-price-field/v1']);
    expect(contract.hasPriceFieldTab).toBe(true);
    expect(contract.panelTitle).toBe('Bayesian Price Field detail');
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
