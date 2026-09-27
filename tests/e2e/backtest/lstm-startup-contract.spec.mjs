/* LSTM startup history and compact backend contracts. Code version: v1.0.0 */
import {expect, test} from '@playwright/test';
import {openBacktestParameterOverlay} from '../support/backtest-parameter-overlay-helper.mjs';

const defaultUrl = '/workspaces/backtest?ticker=DRAM&strategy=lstm-price-field';
const memoryKey = 'worthward:backtest-strategy-params:v1';
const backendField = '[data-collapse="training"] [data-strategy-param-key="compute_backend"]';

const waitForBacktest = async (page) => {
    await expect.poll(() => page.evaluate(() => (
        window.WORTHWARD_BOOTSTRAP?.backtestLoadState
    )), {timeout: 30_000}).toBe('ready');
    await expect(page.locator('#tradePriceChart')).toBeVisible();
};

const readHistory = async (page) => {
    const response = await page.request.get('/api/lstm-training');
    expect(response.ok()).toBe(true);
    const payload = await response.json();
    expect(payload.success).toBe(true);
    return payload.runs;
};

const readParameters = (page) => page.locator(
    '#trade_strategy_params_panel [data-strategy-param-input][name]',
).evaluateAll((nodes) => Object.fromEntries(nodes.map((node) => [node.name, node.value])));

test('default loading records real completed training and reloading preserves its identity', async ({page}) => {
    test.setTimeout(90_000);
    await page.setViewportSize({width: 914, height: 790});
    await page.goto(defaultUrl);
    await waitForBacktest(page);
    const parameters = await readParameters(page);
    expect(parameters.compute_backend).toBe('Auto');
    const presentation = await page.evaluate(() => (
        window.WORTHWARD_APP.backtestResult.strategy_presentation
    ));
    expect(presentation.device.requested).toBe('Auto');
    expect(presentation.device.origins_trained).toBeGreaterThan(0);
    expect(presentation.device.train_ms).toBeGreaterThan(0);
    expect(presentation.fingerprint).toMatch(/^[a-f0-9]{64}$/);

    const runs = await readHistory(page);
    const matching = runs.filter((run) => run.source === 'backtest'
        && run.ticker === 'DRAM'
        && run.requested_range.from === presentation.data_keys[0].slice(0, 10)
        && run.requested_range.to === presentation.data_keys.at(-1).slice(0, 10)
        && Object.entries(parameters).every(([key, value]) => {
            const saved = run.selected_params?.[key];
            return typeof saved === 'boolean' ? value === (saved ? '1' : '0')
                : typeof saved === 'number' ? Number(value) === saved : value === saved;
        }));
    expect(matching).toHaveLength(1);
    const run = matching[0];
    expect(run.status).toBe('completed');
    expect(run.training_mode).toBe('backtest');
    expect(run.active).toBe(false);
    expect(run.device.origins_trained).toBe(presentation.device.origins_trained);
    expect(run.device.optimizer_steps).toBe(presentation.device.optimizer_steps);
    expect(run.accuracy_label).toBe('Backtest direction accuracy');
    expect(run.result_available).toBe(true);
    expect(run.files.map((file) => file.name)).toEqual(expect.arrayContaining([
        'request.json', 'snapshot.json', 'status.json', 'result.json',
    ]));
    const row = page.locator(`[data-lstm-training-run-id="${run.id}"]`);
    await expect(row).toBeVisible();
    await expect(row.locator('.lstm-training-history-details')).toContainText('Trained during Backtest loading');
    await expect(page.locator('[data-lstm-training-count]')).toHaveText(
        String(runs.filter((entry) => !entry.active).length),
    );

    await page.reload();
    await waitForBacktest(page);
    expect(await page.evaluate(() => (
        window.WORTHWARD_APP.backtestResult.strategy_presentation.fingerprint
    ))).toBe(presentation.fingerprint);
    const reloaded = await readHistory(page);
    expect(reloaded.map((entry) => entry.id).sort()).toEqual(runs.map((entry) => entry.id).sort());
    expect(reloaded.find((entry) => entry.id === run.id).started_at).toBe(run.started_at);
    await expect(row).toBeVisible();
    await expect(page.locator('[data-lstm-training-count]')).toHaveText(
        String(runs.filter((entry) => !entry.active).length),
    );
    await row.locator('.lstm-training-history-select').click();
    await expect(page).toHaveURL(new RegExp(`lstm_training_run=${run.id}`));
    await waitForBacktest(page);
    expect((await readHistory(page)).map((entry) => entry.id).sort()).toEqual(
        runs.map((entry) => entry.id).sort(),
    );
});

for (const theme of ['light', 'dark']) {
    for (const viewport of [
        {width: 914, height: 790},
        {width: 390, height: 844},
        {width: 914, height: 500},
    ]) {
        test(`LSTM backend uses arrow-free glass with keyboard selection at ${viewport.width}x${viewport.height} ${theme}`, async ({page}, testInfo) => {
            test.setTimeout(60_000);
            const errors = [];
            page.on('pageerror', (error) => errors.push(error.message));
            await page.setViewportSize(viewport);
            await page.emulateMedia({colorScheme: theme});
            await page.goto(defaultUrl);
            await waitForBacktest(page);
            const sidebar = page.locator('#sidebar_toggle');
            if (await sidebar.getAttribute('aria-expanded') === 'true') await sidebar.click();
            await openBacktestParameterOverlay(page);
            const common = page.locator('[data-collapse="backtest"]');
            if (await common.getAttribute('open') !== null) await common.locator(':scope > summary').click();
            const field = page.locator(backendField);
            const native = field.locator('[data-strategy-param-input]');
            const trigger = field.locator('[data-shared-select-trigger]');
            await expect(native).toHaveValue('Auto');
            await trigger.scrollIntoViewIfNeeded();
            const appearance = await trigger.evaluate((node) => {
                const style = getComputedStyle(node);
                const label = node.querySelector('.trade-strategy-trigger-label');
                const bounds = node.getBoundingClientRect();
                const labelBounds = label.getBoundingClientRect();
                const probe = document.createElement('div');
                probe.style.cssText = 'position:absolute;visibility:hidden;'
                    + 'background:var(--frosted-glass-background);border:var(--frosted-glass-border);'
                    + 'box-shadow:var(--frosted-glass-shadow);backdrop-filter:var(--frosted-glass-blur);';
                node.parentElement.appendChild(probe);
                const expected = getComputedStyle(probe);
                const result = {
                    arrow: getComputedStyle(node, '::after').content,
                    paddingStart: style.paddingInlineStart,
                    paddingEnd: style.paddingInlineEnd,
                    centerDifference: Math.abs((bounds.left + bounds.right) / 2
                        - (labelBounds.left + labelBounds.right) / 2),
                    background: style.background,
                    expectedBackground: expected.background,
                    border: style.border,
                    expectedBorder: expected.border,
                    shadow: style.boxShadow,
                    expectedShadow: expected.boxShadow,
                    blur: style.backdropFilter,
                    expectedBlur: expected.backdropFilter,
                    width: bounds.width,
                    left: bounds.left,
                    right: bounds.right,
                    viewportWidth: window.innerWidth,
                };
                probe.remove();
                return result;
            });
            expect(appearance.arrow).toBe('none');
            expect(appearance.paddingStart).toBe(appearance.paddingEnd);
            expect(appearance.centerDifference).toBeLessThanOrEqual(1);
            expect(appearance.background).toBe(appearance.expectedBackground);
            expect(appearance.border).toBe(appearance.expectedBorder);
            expect(appearance.shadow).toBe(appearance.expectedShadow);
            expect(appearance.blur).toBe(appearance.expectedBlur);
            expect(appearance.blur).toBe('blur(12px)');
            expect(appearance.left).toBeGreaterThanOrEqual(0);
            expect(appearance.right).toBeLessThanOrEqual(appearance.viewportWidth);
            expect(appearance.width).toBeLessThanOrEqual(160);
            const period = page.locator('#period_panel [data-shared-select-trigger]');
            expect(await period.evaluate((node) => getComputedStyle(node, '::after').content)).toBe('""');
            expect(await period.evaluate((node) => getComputedStyle(node, '::after').maskImage)).not.toBe('none');

            const menu = page.locator(`#${await trigger.getAttribute('aria-controls')}`);
            await trigger.press('ArrowDown');
            await expect(trigger).toHaveAttribute('aria-expanded', 'true');
            await expect(menu.getByRole('option', {name: 'Auto', exact: true})).toBeFocused();
            await page.keyboard.press('ArrowDown');
            await expect(menu.getByRole('option', {name: 'CPU', exact: true})).toBeFocused();
            await page.keyboard.press('Escape');
            await expect(menu).toBeHidden();
            await expect(trigger).toBeFocused();
            await expect(native).toHaveValue('Auto');
            await trigger.press('ArrowDown');
            await page.keyboard.press('ArrowDown');
            await page.keyboard.press('Enter');
            await expect(native).toHaveValue('CPU');
            await expect(menu).toBeHidden();
            await trigger.press('Home');
            await page.keyboard.press('Enter');
            await expect(native).toHaveValue('Auto');
            await expect(trigger).toHaveAccessibleName('Compute backend: Auto');
            await trigger.blur();
            expect(await page.evaluate(() => (
                document.documentElement.scrollWidth - document.documentElement.clientWidth
            ))).toBeLessThanOrEqual(1);
            expect(errors).toEqual([]);
            await page.screenshot({path: testInfo.outputPath(`backend-${theme}-${viewport.width}x${viewport.height}.png`)});
        });
    }
}

test('complete NVDA CPU memory migrates to Auto while custom values and explicit URLs retain precedence', async ({page}) => {
    test.setTimeout(90_000);
    const url = '/workspaces/backtest?ticker=NVDA&strategy=lstm-price-field';
    const backend = page.locator('#strategy_param_compute_backend');
    await page.goto(url);
    await waitForBacktest(page);
    await expect(backend).toHaveValue('Auto');
    const previous = {...await readParameters(page), compute_backend: 'CPU'};
    expect(Object.keys(previous)).toHaveLength(46);
    const save = (params) => page.evaluate(({key, values}) => {
        localStorage.setItem(key, JSON.stringify({'lstm-price-field': values}));
    }, {key: memoryKey, values: params});

    await save(previous);
    await page.goto(url);
    await waitForBacktest(page);
    await expect(backend).toHaveValue('Auto');
    await expect(page.locator('#strategy_param_lstm_epochs')).toHaveValue('8');
    await save({...previous, lstm_seed: '17'});
    await page.goto(url);
    await waitForBacktest(page);
    await expect(backend).toHaveValue('CPU');
    await expect(page.locator('#strategy_param_lstm_seed')).toHaveValue('17');
    await page.goto(`${url}&compute_backend=Auto`);
    await waitForBacktest(page);
    await expect(backend).toHaveValue('Auto');
    await expect(page.locator('#strategy_param_lstm_seed')).toHaveValue('17');
    await save(previous);
    await page.goto(`${url}&compute_backend=CPU`);
    await waitForBacktest(page);
    await expect(backend).toHaveValue('CPU');
});
