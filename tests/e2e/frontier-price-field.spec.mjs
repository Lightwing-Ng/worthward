/* Additional neural Price Field GUI contracts. Code version: v1.0.0 */
import {expect, test} from '@playwright/test';

const models = [
    ['itransformer', 'iTransformer'], ['tide', 'TiDE'], ['moderntcn', 'ModernTCN'], ['tft', 'TFT'],
];
const urlFor = (architecture) => `/workspaces/backtest?ticker=NVDA&strategy=${architecture}-price-field`
    + '&range=exact&from=2024-07-14&to=2026-07-14&period=2y&interval=1d&show_trade_details=0'
    + '&compute_backend=CPU&epochs=1&lookback=8&hidden_size=8&training_window=64&retrain_interval=20&cell_display_threshold=0';
const trainingMenu = (page) => page.locator('[data-strategy-action-slot="price-field-training"] [data-lstm-training-menu]');

async function visibleConfiguration(page) {
    return page.evaluate(() => {
        const form = document.querySelector('[data-backtest-parameter-form]');
        const field = (name) => form.querySelector(`[name="${name}"]:checked`) || form.querySelector(`[name="${name}"]`);
        return {
            strategy: field('strategy').value, ticker: field('ticker').value, period: field('period').value,
            interval: field('interval').value, range: field('range').value,
            from: field('from').value, to: field('to').value,
            initial_capital: Number(field('capital').value.replaceAll(',', '')),
            price_only: field('price_only').checked, reinvest_dividends: field('dividends').checked,
            stop_loss: field('stop_loss').checked, show_trade_details: field('show_trade_details').checked,
            params: Object.fromEntries([...form.querySelectorAll('[data-strategy-param-input][name]')].map(
                (input) => [input.name, input.type === 'checkbox' ? input.checked : input.value],
            )),
        };
    });
}

for (const width of [1024, 390]) {
    test(`four additional models use the shared real CPU probability GUI at ${width}px`, async ({page}, testInfo) => {
        test.setTimeout(120_000);
        await page.setViewportSize({width, height: 1100});
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.route('**/api/price-field-training?*', (route) => route.fulfill({
            json: {success: true, protocol_version: 3, runs: []},
        }));
        for (const [architecture, label] of models) {
            await page.goto(urlFor(architecture));
            await expect(trainingMenu(page).getByRole('button', {name: 'Start training', exact: true})).toBeEnabled();
            await expect(page.getByRole('button', {name: `Strategy: ${label} Price Field`, exact: true})).toContainText(`${label} Price Field`);
            const contract = await page.evaluate(() => {
                const presentation = window.WORTHWARD_APP.backtestResult.strategy_presentation;
                return {
                    kind: presentation.distribution_kind, horizon: presentation.max_horizon,
                    score: presentation.diagnostics.probability_score_pct,
                    horizonCount: presentation.diagnostics.horizon_count,
                    count: presentation.diagnostics.valid_pairs, backend: presentation.device.resolved,
                    fields: document.querySelectorAll('[data-strategy-param-input]').length,
                    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
                };
            });
            expect(contract.kind).toBe('direct-normal-horizon');
            expect(contract.horizon).toBe(20);
            expect(contract.horizonCount).toBe(20);
            expect(Number.isFinite(contract.score)).toBe(true);
            expect(contract.score).toBeGreaterThanOrEqual(0);
            expect(contract.score).toBeLessThanOrEqual(100);
            expect(contract.count).toBeGreaterThan(0);
            expect(contract.backend).toBe('cpu');
            expect(contract.fields).toBeGreaterThan(50);
            expect(contract.overflow).toBeLessThanOrEqual(1);
            const probability = page.locator('[data-backtest-metric="probability-field-probability-score"]');
            const direction = page.locator('[data-backtest-metric="probability-field-direction-hit-rate"]');
            await expect(probability.locator('.trade-metric-label')).toHaveText(`${label} probability score`);
            await expect(probability).toHaveAttribute('data-probability-field-metric', 'direct-close-full-grid-brier');
            await expect(probability).toHaveAttribute('title', /equally weighted mean normalized multiclass Brier loss across close-to-future-close horizons 1–20/);
            await expect(probability).toHaveAttribute('title', /Scored horizons: 20 of 20/);
            await expect(probability).not.toHaveAttribute('title', /next-open|75%/);
            await expect(direction.locator('.trade-metric-label')).toHaveText(`${label} direction hit rate`);
            await expect(direction).toHaveAttribute('title', /signal-close-to-next-close/);
            await page.locator('label[for="backtest_history_probability"]').click();
            await expect(page.locator('[data-backtest-probability-detail-status]')).toContainText('Direct close-price forecasts: 1–20 trading days');
            await expect.poll(() => page.locator('[data-backtest-probability-detail-grid] [data-horizon]').evaluateAll(
                (cells) => new Set(cells.map((cell) => Number(cell.dataset.horizon))).size,
            )).toBe(20);
        }
        expect(errors).toEqual([]);
        await page.screenshot({path: testInfo.outputPath(`frontier-price-field-${width}.png`), fullPage: true});
    });

    test(`additional-model history stays isolated and restores complete parameters at ${width}px`, async ({page}) => {
        test.setTimeout(120_000);
        await page.setViewportSize({width, height: 1100});
        let runs = [];
        const queried = new Set();
        await page.route('**/api/price-field-training?*', (route) => {
            queried.add(new URL(route.request().url()).searchParams.get('strategy'));
            return route.fulfill({json: {success: true, protocol_version: 3, runs}});
        });
        await page.goto(urlFor('itransformer'));
        const original = await visibleConfiguration(page);
        runs = models.map(([architecture], index) => ({
            id: `price-field-${'abcd'[index].repeat(24)}`, strategy: `${architecture}-price-field`, ticker: 'NVDA',
            period: '2y', interval: '1d', started_at: '2026-09-08T00:00:00Z',
            status: 'completed', active: false, probability_score_pct: 55.21,
            probability_score_label: 'Complete-grid probability score', result_available: true,
            configuration: {...original, strategy: `${architecture}-price-field`}, files: [],
            device: {resolved: 'cpu', optimizer_steps: 1200, train_ms: 1250, infer_ms: 240},
        }));
        runs.push({...runs[0], id: `price-field-${'e'.repeat(24)}`, strategy: 'patchtst-price-field', ticker: 'QQQ'});
        for (const [architecture] of models) {
            await page.goto(urlFor(architecture));
            const menu = trainingMenu(page);
            const selection = menu.locator('.lstm-training-history-select');
            await expect(selection).toHaveCount(1);
            await expect(selection).toHaveAttribute('aria-pressed', 'false');
            await expect(menu.locator('.lstm-training-history-run')).toHaveText('NVDA');
            await expect(menu.locator('.lstm-training-accuracy')).toHaveText('55.21%');
            await expect(menu.locator('.lstm-training-accuracy')).toHaveAttribute('title', 'Complete-grid probability score');
            await selection.click();
            const completed = runs.find((run) => run.strategy === `${architecture}-price-field`);
            await expect(page).toHaveURL(new RegExp(`price_field_training_run=${completed.id}`));
            await expect(selection).toHaveAttribute('aria-pressed', 'true');
            expect(await visibleConfiguration(page)).toEqual(completed.configuration);
            await selection.click();
            await expect(menu.locator('.lstm-training-history-details')).toContainText('Backend cpu · 1,200 optimizer steps · 1.25 s training · 0.24 s inference');
        }
        expect(queried).toEqual(new Set(models.map(([architecture]) => `${architecture}-price-field`)));
    });
}

for (const [index, [architecture]] of models.entries()) {
    test(`${architecture} starts and stops asynchronously without a completed score`, async ({page}) => {
        test.setTimeout(60_000);
        await page.setViewportSize({width: index % 2 ? 390 : 1024, height: 1100});
        let runs = [];
        let request;
        let releaseStart;
        let releaseStop;
        const startPending = new Promise((resolve) => { releaseStart = resolve; });
        const stopPending = new Promise((resolve) => { releaseStop = resolve; });
        const run = {
            id: `price-field-${'f'.repeat(24)}`, strategy: `${architecture}-price-field`, ticker: 'NVDA',
            period: '2y', interval: '1d', started_at: '2026-09-08T00:00:00Z', status: 'running', active: true,
            progress: {percent: 40}, files: [],
        };
        await page.route('**/api/price-field-training?*', async (route) => {
            expect(new URL(route.request().url()).searchParams.get('strategy')).toBe(run.strategy);
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
            await stopPending;
            runs = [{...run, status: 'stopped', active: false, configuration: null, result_available: false}];
            await route.fulfill({json: {success: true, run: runs[0]}});
        });
        await page.goto(urlFor(architecture));
        const menu = trainingMenu(page);
        const action = menu.locator('[data-lstm-training-action]');
        await expect(action).toBeEnabled();
        await action.click();
        await expect(action).toHaveText('Starting training…');
        await expect(action).toBeDisabled();
        releaseStart();
        await expect(action).toHaveText('Stop training');
        expect(request.strategy).toBe(run.strategy);
        expect(request.ticker).toBe('NVDA');
        expect(request.period).toBe('2y');
        expect(request.params.compute_backend).toBe('CPU');
        expect(request.params.epochs).toBe('1');
        expect(request.params.lstm_epochs).toBeUndefined();
        await expect(menu.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '40');
        await action.click();
        await expect(action).toHaveText('Stopping training…');
        await expect(action).toBeDisabled();
        await expect(menu.locator('.lstm-training-accuracy')).toHaveCount(0);
        releaseStop();
        await expect(action).toHaveText('Start training');
        await expect(menu.locator('.lstm-training-history-entry')).toContainText('Stopped');
        await expect(menu.locator('.lstm-training-accuracy')).toHaveCount(0);
        await expect(menu.locator('.lstm-training-history-select')).toHaveAttribute('aria-pressed', 'false');
    });
}
