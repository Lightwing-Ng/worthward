/* Neural Price Field UI integration. Code version: v1.2.0 */
import {expect, test} from '@playwright/test';

const architectures = ['patchtst', 'tsmixer', 'nhits', 'timexer'];
const architectureNames = {patchtst: 'PatchTST', tsmixer: 'TSMixer', nhits: 'N-HiTS', timexer: 'TimeXer'};
const urlFor = (architecture) => `/workspaces/backtest?ticker=NVDA&strategy=${architecture}-price-field`
    + '&range=exact&from=2024-07-14&to=2026-07-14&period=2y&interval=1d&show_trade_details=0'
    + '&compute_backend=CPU&epochs=1&lookback=8&hidden_size=8&training_window=64&retrain_interval=20&cell_display_threshold=0';

for (const width of [1024, 390]) {
    test(`four neural strategies share training and complete direct-horizon detail at ${width}px`, async ({page}, testInfo) => {
        test.setTimeout(120_000);
        await page.setViewportSize({width, height: 1100});
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.route('**/api/price-field-training?*', (route) => route.fulfill({json: {success: true, protocol_version: 3, runs: []}}));
        for (const architecture of architectures) {
            await page.goto(urlFor(architecture));
            const menu = page.locator('[data-strategy-action-slot="price-field-training"] [data-lstm-training-menu]');
            await expect(menu.getByRole('button', {name: 'Start training', exact: true})).toBeEnabled();
            const contract = await page.evaluate(() => {
                const result = window.WORTHWARD_APP.backtestResult;
                const presentation = result.strategy_presentation;
                return {kind: presentation.distribution_kind, horizon: presentation.max_horizon,
                    score: presentation.diagnostics.probability_score_pct,
                    count: presentation.diagnostics.valid_pairs, backend: presentation.device.resolved,
                    fields: document.querySelectorAll('[data-strategy-param-input]').length,
                    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth};
            });
            expect(contract.kind).toBe('direct-normal-horizon');
            expect(contract.horizon).toBe(20);
            expect(contract.count).toBeGreaterThan(0);
            expect(contract.backend).toBe('cpu');
            expect(contract.fields).toBeGreaterThan(50);
            expect(contract.overflow).toBeLessThanOrEqual(1);
            const probability = page.locator('[data-backtest-metric="probability-field-probability-score"]');
            const direction = page.locator('[data-backtest-metric="probability-field-direction-hit-rate"]');
            await expect(probability.locator('.trade-metric-label')).toHaveText(`${architectureNames[architecture]} probability score`);
            await expect(probability).toHaveAttribute('data-probability-field-metric', 'direct-close-full-grid-brier');
            await expect(probability).toHaveAttribute('title', /equally weighted mean normalized multiclass Brier loss across close-to-future-close horizons 1–20/);
            await expect(probability).toHaveAttribute('title', /Scored horizons: 20 of 20/);
            await expect(probability).not.toHaveAttribute('title', /next-open|75%/);
            await expect(direction.locator('.trade-metric-label')).toHaveText(`${architectureNames[architecture]} direction hit rate`);
            await expect(direction).toHaveAttribute('data-probability-field-metric', 'next-close-direction-hit-rate');
            await expect(direction).toHaveAttribute('title', /signal-close-to-next-close/);
            await page.locator('label[for="backtest_history_probability"]').click();
            await expect(page.locator('[data-backtest-probability-detail-status]')).toContainText('Direct close-price forecasts: 1–20 trading days');
            await expect.poll(() => page.locator('[data-backtest-probability-detail-grid] [data-horizon]').evaluateAll(
                (cells) => new Set(cells.map((cell) => Number(cell.dataset.horizon))).size,
            )).toBe(20);
            if (architecture === 'timexer') await page.screenshot({path: testInfo.outputPath(`neural-price-field-${width}.png`), fullPage: true});
        }
        expect(errors).toEqual([]);
    });
}

test('completed probability history is model-scoped and restores its exact saved configuration', async ({page}) => {
    test.setTimeout(60_000);
    let runs = [];
    const queries = [];
    await page.route('**/api/price-field-training?*', async (route) => {
        queries.push(new URL(route.request().url()).searchParams.get('strategy'));
        await route.fulfill({json: {success: true, protocol_version: 3, runs}});
    });
    await page.goto(urlFor('nhits').replace('show_trade_details=0', 'show_trade_details=1'));
    const configuration = await page.evaluate(() => {
        const form = document.querySelector('[data-backtest-parameter-form]');
        const field = (name) => form.querySelector(`[name="${name}"]:checked`) || form.querySelector(`[name="${name}"]`);
        return {strategy: 'nhits-price-field', ticker: 'NVDA', period: '2y', interval: '1d',
            range: field('range').value, from: field('from').value, to: field('to').value,
            initial_capital: Number(field('capital').value.replaceAll(',', '')),
            price_only: field('price_only').checked, reinvest_dividends: field('dividends').checked,
            stop_loss: field('stop_loss').checked, show_trade_details: field('show_trade_details').checked,
            params: Object.fromEntries([...form.querySelectorAll('[data-strategy-param-input][name]')].map(
                (input) => [input.name, input.type === 'checkbox' ? input.checked : input.value],
            ))};
    });
    const completed = {id: 'price-field-bbbbbbbbbbbbbbbbbbbbbbbb', strategy: 'nhits-price-field',
        ticker: 'NVDA', period: '2y', interval: '1d', started_at: '2026-09-07T00:00:00Z',
        status: 'completed', active: false, probability_score_pct: 55.21,
        probability_score_label: 'Complete-grid probability score', configuration, files: [],
        device: {resolved: 'mps', optimizer_steps: 1200, train_ms: 1250, infer_ms: 240}};
    runs = [completed, {...completed, id: 'price-field-cccccccccccccccccccccccc', strategy: 'tsmixer-price-field', ticker: 'QQQ'}];
    const menu = page.locator('[data-lstm-training-menu]');
    await expect(menu.locator('.lstm-training-history-select')).toHaveCount(1, {timeout: 10_000});
    await expect(menu.locator('.lstm-training-accuracy')).toHaveText('55.21%');
    await expect(menu.locator('.lstm-training-accuracy')).toHaveAttribute('title', 'Complete-grid probability score');
    await expect(page.locator('#backtest_history_surface')).toHaveAttribute('data-active-view', 'transactions');
    await expect(page.locator('#backtest_history_transactions')).toBeChecked();
    await page.evaluate(() => { window.__savedConfigurationDocument = true; });
    await menu.locator('.lstm-training-history-select').click();
    await expect(page).toHaveURL(/price_field_training_run=price-field-bbbbbbbbbbbbbbbbbbbbbbbb/);
    await expect.poll(() => page.evaluate(() => Boolean(window.__savedConfigurationDocument))).toBe(false);
    await expect(menu.locator('.lstm-training-history-select')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('label[for="backtest_history_probability"] span')).toHaveText('Price field');
    await expect(page.locator('#backtest_history_surface')).toHaveAttribute('data-active-view', 'probability');
    await expect(page.locator('#backtest_history_probability')).toBeChecked();
    await expect(page.locator('#backtest_history_transactions')).not.toBeChecked();
    await expect(page.locator('#backtest_probability_detail_panel')).toBeVisible();
    await expect.poll(() => page.locator('[data-backtest-probability-detail-grid] [data-horizon]').evaluateAll(
        (cells) => new Set(cells.map((cell) => Number(cell.dataset.horizon))).size,
    )).toBe(20);
    await menu.locator('.lstm-training-history-select').click();
    await expect(menu.locator('.lstm-training-history-details')).toContainText('Backend mps · 1,200 optimizer steps · 1.25 s training · 0.24 s inference');
    expect(queries.every((strategy) => strategy === 'nhits-price-field')).toBe(true);
    await page.goto(urlFor('tsmixer'));
    await expect(menu.locator('.lstm-training-history-select')).toHaveCount(1);
    await expect(menu.locator('.lstm-training-history-run')).toHaveText('QQQ');
    await expect(menu.locator('.lstm-training-history-select')).toHaveAttribute('aria-pressed', 'false');
});

test('a newly completed training run automatically restores its probability grid', async ({page}) => {
    test.setTimeout(120_000);
    let runs = [];
    let startRequests = 0;
    const runId = 'price-field-dddddddddddddddddddddddd';
    await page.route('**/api/price-field-training?*', (route) => route.fulfill({
        json: {success: true, protocol_version: 3, runs},
    }));
    await page.route('**/api/price-field-training/start', async (route) => {
        startRequests += 1;
        const request = route.request().postDataJSON();
        const running = {
            id: runId, strategy: request.strategy, ticker: request.ticker,
            period: request.period, interval: request.interval,
            started_at: '2026-09-09T00:00:00Z', status: 'running', active: true,
            progress: {percent: 50}, files: [],
        };
        runs = [{
            ...running,
            status: 'completed',
            active: false,
            probability_score_pct: 56.25,
            probability_score_label: 'Complete-grid probability score',
            configuration: {
                ...request.configuration,
                strategy: request.strategy,
                ticker: request.ticker,
                period: request.period,
                interval: request.interval,
                params: request.params,
            },
        }];
        await route.fulfill({status: 202, json: {success: true, run: running}});
    });

    await page.goto(urlFor('nhits'));
    const menu = page.locator('[data-lstm-training-menu]');
    const action = menu.getByRole('button', {name: 'Start training', exact: true});
    await expect(action).toBeEnabled();
    await page.evaluate(() => { window.__beforeAutomaticTrainingApply = true; });
    await action.click();
    await expect(page).toHaveURL(new RegExp(`price_field_training_run=${runId}`));
    await expect.poll(() => page.evaluate(() => Boolean(window.__beforeAutomaticTrainingApply))).toBe(false);
    await expect(menu.locator('.lstm-training-history-select')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#backtest_history_surface')).toHaveAttribute('data-active-view', 'probability');
    await expect(page.locator('#backtest_history_probability')).toBeChecked();
    await expect(page.locator('#backtest_probability_detail_panel')).toBeVisible();
    await expect.poll(() => page.locator('[data-backtest-probability-detail-grid] [data-horizon]').evaluateAll(
        (cells) => new Set(cells.map((cell) => Number(cell.dataset.horizon))).size,
    )).toBe(20);
    expect(startRequests).toBe(1);
});

for (const width of [1024, 390]) {
    test(`training actions preserve model identity and stopped state at ${width}px`, async ({page}) => {
        test.setTimeout(60_000);
        await page.setViewportSize({width, height: 1100});
        let runs = [];
        let request;
        let releaseStart;
        const startPending = new Promise((resolve) => { releaseStart = resolve; });
        const run = {id: 'price-field-aaaaaaaaaaaaaaaaaaaaaaaa', strategy: 'tsmixer-price-field', ticker: 'NVDA',
            period: '2y', interval: '1d', started_at: '2026-09-07T00:00:00Z', status: 'running', active: true,
            progress: {percent: 40}, files: []};
        await page.route('**/api/price-field-training?*', async (route) => {
            expect(new URL(route.request().url()).searchParams.get('strategy')).toBe('tsmixer-price-field');
            await route.fulfill({json: {success: true, protocol_version: 3, runs}});
        });
        await page.route('**/api/price-field-training/start', async (route) => {
            request = route.request().postDataJSON();
            expect(route.request().headers()['x-csrf-token']).toBeTruthy();
            await startPending;
            runs = [run];
            await route.fulfill({status: 202, json: {success: true, run}});
        });
        await page.route('**/api/price-field-training/stop', async (route) => {
            expect(route.request().postDataJSON()).toEqual({run_id: run.id});
            runs = [{...run, status: 'stopped', active: false, configuration: null, result_available: false}];
            await route.fulfill({json: {success: true, run: runs[0]}});
        });
        await page.goto(urlFor('tsmixer'));
        const menu = page.locator('[data-lstm-training-menu]');
        const action = menu.locator('[data-lstm-training-action]');
        await expect(action).toBeEnabled();
        await action.click();
        await expect(action).toHaveText('Starting training…');
        await expect(action).toBeDisabled();
        releaseStart();
        await expect(action).toHaveText('Stop training');
        expect(request.strategy).toBe('tsmixer-price-field');
        expect(request.ticker).toBe('NVDA');
        expect(request.period).toBe('2y');
        expect(request.params.epochs).toBe('1');
        expect(request.params.lstm_epochs).toBeUndefined();
        await expect(menu.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '40');
        await action.click();
        await expect(action).toHaveText('Start training');
        await expect(menu.locator('.lstm-training-history-entry')).toContainText('Stopped');
        await expect(menu.locator('.lstm-training-accuracy')).toHaveCount(0);
        await expect(menu.locator('.lstm-training-history-select')).toHaveAttribute('aria-pressed', 'false');
    });
}
