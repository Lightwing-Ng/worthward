/* Code version: v1.0.0 */
import {expect, test} from '@playwright/test';
import {mockInvestmentReadApis} from './critical_flows/support.mjs';

const viewports = [
    {width: 1006, height: 791, touch: false},
    {width: 390, height: 844, touch: true},
    {width: 1006, height: 500, touch: false},
];

async function setPreviewValue(range, value) {
    await range.evaluate((input, nextValue) => {
        input.value = String(nextValue);
        input.dispatchEvent(new Event('input', {bubbles: true}));
    }, value);
}

async function readGeometry(indicator) {
    return indicator.evaluate((node) => {
        const dialog = node.closest('.workspace-modal-dialog');
        const rect = node.getBoundingClientRect();
        const dialogRect = dialog.getBoundingClientRect();
        return {
            width: rect.width,
            height: rect.height,
            leftInset: rect.left - dialogRect.left,
            topInset: rect.top - dialogRect.top,
            dialogWidth: dialogRect.width,
            dialogHeight: dialogRect.height,
            dialogOverflow: dialog.scrollWidth - dialog.clientWidth,
            documentOverflow: document.documentElement.scrollWidth - innerWidth,
        };
    });
}

async function expectDeterminate(indicator, value) {
    await expect(indicator).toHaveAttribute('data-loading-determinate', 'true');
    await expect(indicator).toHaveAttribute('role', 'progressbar');
    await expect(indicator).toHaveAttribute('aria-valuemin', '0');
    await expect(indicator).toHaveAttribute('aria-valuemax', '100');
    await expect(indicator).toHaveAttribute('aria-valuenow', String(value));
    await expect(indicator).not.toHaveAttribute('aria-hidden', 'true');
    await expect(indicator).toHaveCSS('animation-name', 'none');
    await expect(indicator).toHaveCSS('transform', 'none');
    await expect(indicator).toHaveCSS('mask-image', 'none');
    await expect(indicator.locator('[data-loading-indicator-svg]')).toHaveCount(1);
}

async function expectOriginalSpinner(indicator, {reducedMotion = true} = {}) {
    await expect(indicator).toHaveAttribute('data-loading-determinate', 'false');
    await expect(indicator).toHaveAttribute('aria-hidden', 'true');
    await expect(indicator).not.toHaveAttribute('role');
    await expect(indicator).not.toHaveAttribute('aria-valuenow');
    await expect(indicator).not.toHaveAttribute('data-loading-progress');
    await expect(indicator.locator('svg')).toHaveCount(0);
    await expect(indicator).toHaveCSS('mask-image', /loading\.spinner\.svg/);
    await expect(indicator).toHaveCSS('animation-name', reducedMotion ? 'none' : 'ticker-suggestion-loading');
}

for (const viewport of viewports) {
    for (const theme of ['light', 'dark']) {
        test(`loading catalog keeps exact dot, approved arc, and full ring at ${viewport.width}x${viewport.height} ${theme}`, async ({browser}, testInfo) => {
            const context = await browser.newContext({
                baseURL: 'http://127.0.0.1:8699',
                viewport: {width: viewport.width, height: viewport.height},
                hasTouch: viewport.touch,
                colorScheme: theme,
                reducedMotion: 'reduce',
            });
            try {
                const page = await context.newPage();
                const errors = [];
                page.on('pageerror', (error) => errors.push(error.message));
                await page.goto('/settings/style-tokens');
                await page.evaluate((value) => {
                    document.documentElement.dataset.themeOverride = value;
                }, theme);
                await page.evaluate(() => document.fonts.ready);
                const section = page.locator('#modal-dialog');
                const checkbox = section.locator('[data-loading-demo-determinate]');
                const range = section.locator('[data-loading-demo-value]');
                const indicator = section.locator('[data-loading-demo-indicator]');
                const dialog = section.locator('.workspace-modal-dialog');

                await expect(checkbox).not.toBeChecked();
                await expect(range).toBeDisabled();
                await expectOriginalSpinner(indicator);
                await indicator.scrollIntoViewIfNeeded();
                const originalGeometry = await readGeometry(indicator);
                expect(originalGeometry.width).toBe(36);
                expect(originalGeometry.height).toBe(36);
                expect(originalGeometry.dialogOverflow).toBeLessThanOrEqual(1);
                expect(originalGeometry.documentOverflow).toBeLessThanOrEqual(1);

                await checkbox.check();
                await expect(range).toBeEnabled();
                await expectDeterminate(indicator, 0);
                const dot = indicator.locator('[data-loading-dot]');
                const arc = indicator.locator('[data-loading-arc]');
                const track = indicator.locator('[data-loading-track]');
                await expect(dot).toHaveAttribute('cx', '12');
                await expect(dot).toHaveAttribute('cy', '3.25');
                await expect(dot).toHaveAttribute('r', '1.125');
                await expect(dot).toHaveCSS('display', 'inline');
                await expect(arc).toHaveCSS('display', 'none');
                const dotBounds = await dot.boundingBox();
                expect(dotBounds.width).toBeCloseTo(3.375, 3);
                expect(dotBounds.height).toBeCloseTo(dotBounds.width, 3);
                await dialog.screenshot({path: testInfo.outputPath('loading-zero.png')});

                await setPreviewValue(range, 75);
                await expectDeterminate(indicator, 75);
                await expect(section.locator('[data-loading-demo-output]')).toHaveText('75%');
                await expect(dot).toHaveCSS('display', 'none');
                await expect(arc).toHaveCSS('display', 'inline');
                await expect(arc).toHaveAttribute('r', '8.75');
                await expect(arc).toHaveAttribute('stroke-width', '2.25');
                await expect(arc).toHaveAttribute('stroke-linecap', 'round');
                await expect(arc).toHaveAttribute('stroke-dasharray', '39 16');
                await expect(arc).toHaveAttribute('transform', 'rotate(-90 12 12)');
                await expect(track).toHaveAttribute('opacity', '0.26');
                const colors = await indicator.evaluate((node) => ({
                    color: getComputedStyle(node).color,
                    arc: getComputedStyle(node.querySelector('[data-loading-arc]')).stroke,
                    dot: getComputedStyle(node.querySelector('[data-loading-dot]')).fill,
                }));
                expect(colors.arc).toBe(colors.color);
                expect(colors.dot).toBe(colors.color);
                expect(await readGeometry(indicator)).toEqual(originalGeometry);
                await dialog.screenshot({path: testInfo.outputPath('loading-seventy-five.png')});
                if (viewport.width === 1006 && viewport.height === 791 && theme === 'light') {
                    await checkbox.scrollIntoViewIfNeeded();
                    await page.screenshot({path: testInfo.outputPath('catalog-controls.png')});
                }

                await range.focus();
                await range.press('End');
                await expectDeterminate(indicator, 100);
                await expect(arc).not.toHaveAttribute('stroke-dasharray');
                await expect(dot).toHaveCSS('display', 'none');
                await expect(arc).toHaveCSS('display', 'inline');
                expect(await readGeometry(indicator)).toEqual(originalGeometry);
                await dialog.screenshot({path: testInfo.outputPath('loading-complete.png')});

                await checkbox.uncheck();
                await expect(range).toBeDisabled();
                await expectOriginalSpinner(indicator);
                expect(await readGeometry(indicator)).toEqual(originalGeometry);
                expect(errors).toEqual([]);
            } finally {
                await context.close();
            }
        });
    }
}

test('determinate progress stops rotation and restoring false resumes the original animation', async ({page}) => {
    await page.emulateMedia({reducedMotion: 'no-preference'});
    await page.goto('/settings/style-tokens');
    const indicator = page.locator('#modal-dialog [data-loading-demo-indicator]');
    await expectOriginalSpinner(indicator, {reducedMotion: false});
    const animation = await indicator.evaluate((node) => {
        const running = node.getAnimations()[0];
        return {state: running?.playState, iterations: running?.effect.getTiming().iterations};
    });
    expect(animation).toEqual({state: 'running', iterations: Infinity});
    const checkbox = page.locator('#modal-dialog [data-loading-demo-determinate]');
    await checkbox.check();
    await expectDeterminate(indicator, 0);
    expect(await indicator.evaluate((node) => node.getAnimations().length)).toBe(0);
    await checkbox.uncheck();
    await expectOriginalSpinner(indicator, {reducedMotion: false});
});

test('invalid measurements cannot overflow the ring or enable determinate mode by coercion', async ({page}) => {
    await page.emulateMedia({reducedMotion: 'reduce'});
    await page.goto('/settings/style-tokens');
    const indicator = page.locator('#modal-dialog [data-loading-demo-indicator]');
    const actual = await indicator.evaluate((node) => {
        const api = window.WORTHWARD_LOADING_INDICATOR;
        const values = [-1, 101, NaN, Infinity, -Infinity, undefined, null, '75', 12.5];
        const measurements = values.map((value) => {
            const result = api.setProgress(node, {determinate: true, value});
            return {result, accessible: node.getAttribute('aria-valuenow')};
        });
        const enabledByCoercion = ['true', 1, {}, null, undefined].map((determinate) => {
            api.setProgress(node, {determinate, value: 75});
            return node.getAttribute('data-loading-determinate');
        });
        api.setProgress(node, {determinate: true, value: 100});
        api.setProgress(node);
        return {measurements, enabledByCoercion};
    });
    expect(actual.measurements).toEqual([0, 100, 0, 0, 0, 0, 0, 0, 12.5]
        .map((value) => ({result: value, accessible: String(value)})));
    expect(actual.enabledByCoercion).toEqual(['false', 'false', 'false', 'false', 'false']);
    await expectOriginalSpinner(indicator);
});

function deferred() {
    let resolve;
    const promise = new Promise((complete) => { resolve = complete; });
    return {promise, resolve};
}

async function observeLoadingSteps(page) {
    await page.addInitScript(() => {
        window.loadingStepObservations = [];
        const observer = new MutationObserver((records) => {
            for (const record of records) {
                if (record.target.id !== 'workspace_modal_overlay_icon') continue;
                const indicator = record.target;
                const overlay = document.getElementById('workspace_modal_overlay');
                const holdings = document.getElementById('investment_holdings_panel');
                window.loadingStepObservations.push({
                    value: indicator.getAttribute('data-loading-progress'),
                    copy: document.getElementById('workspace_modal_overlay_copy')?.textContent,
                    overlayVisible: overlay ? !overlay.hidden : false,
                    holdingsVisible: holdings ? !holdings.hidden : false,
                    holdingsRows: holdings?.querySelectorAll('[data-table-scroll] [data-table-body] tr[data-investment-holdings-ticker]').length || 0,
                });
            }
        });
        observer.observe(document, {
            subtree: true,
            attributes: true,
            attributeFilter: ['data-loading-progress'],
        });
    });
}

async function readCompletedSteps(page) {
    return page.evaluate(() => window.loadingStepObservations
        .map((entry) => entry.value)
        .filter((value, index, values) => value !== null && value !== values[index - 1])
        .map(Number));
}

const holdingsCases = [
    {width: 1006, height: 791, touch: false, theme: 'light', motion: 'no-preference'},
    {width: 390, height: 844, touch: true, theme: 'dark', motion: 'reduce'},
    {width: 1006, height: 500, touch: false, theme: 'light', motion: 'reduce'},
];

for (const viewport of holdingsCases) {
    test(`Holdings progress waits for completed work at ${viewport.width}x${viewport.height} ${viewport.theme}`, async ({browser}, testInfo) => {
        const context = await browser.newContext({
            baseURL: 'http://127.0.0.1:8699',
            viewport: {width: viewport.width, height: viewport.height},
            hasTouch: viewport.touch,
            colorScheme: viewport.theme,
            reducedMotion: viewport.motion,
        });
        const transactions = deferred();
        const intraday = deferred();
        try {
            const page = await context.newPage();
            const errors = [];
            page.on('pageerror', (error) => errors.push(error.message));
            await observeLoadingSteps(page);
            // Existing shared browser fixtures keep every record and quote in intercepted reads.
            await mockInvestmentReadApis(page, {
                transactions: [{
                    ledger_no: 1, broker: 'ibkr', date: '2026-07-10', type: 'buy',
                    ticker: 'DRAM', currency: 'USD', quantity: 5, price: 100, amount: -500,
                }],
                summary: {position_snapshot_authoritative: true, position_snapshot_as_of: '2026-07-10'},
                positionSnapshot: {
                    DRAM: {quantity: '5', market_value: '500', last_price: '100'},
                },
                priceHistoryByTicker: {DRAM: [{date: '2026-07-10', close: 100}]},
                intradayRows: () => [],
            });
            let intradayRequests = 0;
            await page.route('**/api/investment/transactions*', async (route) => {
                await transactions.promise;
                await route.fallback();
            });
            await page.route('**/api/investment/intraday?*', async (route) => {
                intradayRequests += 1;
                await intraday.promise;
                await route.fallback();
            });
            await page.goto('/trade/investment?view=holdings');
            await page.evaluate((theme) => {
                document.documentElement.dataset.themeOverride = theme;
            }, viewport.theme);
            const overlay = page.locator('#workspace_modal_overlay');
            const indicator = page.locator('#workspace_modal_overlay_icon');
            const copy = page.locator('#workspace_modal_overlay_copy');
            await expect(overlay).toBeVisible();
            await expectDeterminate(indicator, 0);
            await expect(copy).toContainText('0 of 4 loading steps complete.');
            await expect(indicator.locator('[data-loading-dot]')).toHaveCSS('display', 'inline');
            // A deliberately held real request must not gain progress with elapsed time.
            await page.waitForTimeout(250);
            await expectDeterminate(indicator, 0);
            await overlay.screenshot({path: testInfo.outputPath('holdings-waiting-for-data.png')});

            transactions.resolve();
            await expect.poll(() => intradayRequests).toBeGreaterThan(0);
            await expectDeterminate(indicator, 25);
            await expect(copy).toContainText('1 of 4 loading steps complete.');
            await expect(indicator).toHaveAttribute('aria-valuetext', /1 of 4 loading steps complete/);
            await page.waitForTimeout(250);
            await expectDeterminate(indicator, 25);
            const geometry = await readGeometry(indicator);
            expect(geometry.dialogWidth).toBeLessThanOrEqual(viewport.width - 32);
            expect(geometry.dialogOverflow).toBeLessThanOrEqual(1);
            expect(geometry.documentOverflow).toBeLessThanOrEqual(1);
            await overlay.screenshot({path: testInfo.outputPath('holdings-waiting-for-prices.png')});

            intraday.resolve();
            await expect(overlay).toBeHidden();
            expect(await readCompletedSteps(page)).toEqual([0, 25, 50, 75, 100]);
            const completed = await page.evaluate(() => window.loadingStepObservations
                .find((entry) => entry.value === '100'));
            expect(completed).toEqual(expect.objectContaining({
                overlayVisible: true,
                holdingsVisible: true,
                holdingsRows: 1,
            }));
            expect(completed.copy).toContain('4 of 4 loading steps complete. Holdings are ready.');
            await expectOriginalSpinner(indicator, {reducedMotion: viewport.motion === 'reduce'});
            await expect(page.locator('#investment_holdings_panel [data-table-scroll] [data-table-body] tr[data-investment-holdings-ticker="DRAM"]')).toBeVisible();
            expect(errors).toEqual([]);
        } finally {
            transactions.resolve();
            intraday.resolve();
            await context.close();
        }
    });
}

test('failed Holdings reads never complete and a subsequent load starts again at zero', async ({page}) => {
    await page.emulateMedia({reducedMotion: 'reduce'});
    await observeLoadingSteps(page);
    await mockInvestmentReadApis(page);
    let shouldFail = true;
    let gate = deferred();
    await page.route('**/api/investment/transactions*', async (route) => {
        await gate.promise;
        if (shouldFail) {
            await route.fulfill({status: 503, json: {success: false, error: 'Local data read failed'}});
        } else {
            await route.fallback();
        }
    });
    try {
        await page.goto('/trade/investment?view=holdings');
        const overlay = page.locator('#workspace_modal_overlay');
        const indicator = page.locator('#workspace_modal_overlay_icon');
        await expectDeterminate(indicator, 0);
        gate.resolve();
        await expect(overlay).toBeHidden();
        expect(await readCompletedSteps(page)).toEqual([0]);
        await expect(page.getByText('Failed to load investment data: Local data read failed', {exact: true})).toBeVisible();
        await expectOriginalSpinner(indicator);

        shouldFail = false;
        gate = deferred();
        await page.reload();
        await expect(overlay).toBeVisible();
        await expectDeterminate(indicator, 0);
        await expect(page.locator('#workspace_modal_overlay_copy')).toContainText('0 of 4 loading steps complete.');
        expect(await readCompletedSteps(page)).toEqual([0]);
        gate.resolve();
        await expect(overlay).toBeHidden();
        expect(await readCompletedSteps(page)).toEqual([0, 25, 50, 75, 100]);
        await expectOriginalSpinner(indicator);
    } finally {
        gate.resolve();
    }
});

test('nonpilot investment views retain the fixed spinner without measured percentages', async ({page}) => {
    await page.emulateMedia({reducedMotion: 'no-preference'});
    await observeLoadingSteps(page);
    await mockInvestmentReadApis(page);
    const gate = deferred();
    await page.route('**/api/investment/transactions*', async (route) => {
        await gate.promise;
        await route.fallback();
    });
    try {
        await page.goto('/trade/investment?view=overview');
        const overlay = page.locator('#workspace_modal_overlay');
        await expect(overlay).toBeVisible();
        await expectOriginalSpinner(page.locator('#workspace_modal_overlay_icon'), {reducedMotion: false});
        await expect(page.locator('#workspace_modal_overlay_copy')).not.toContainText('loading steps complete');
        gate.resolve();
        await expect(overlay).toBeHidden();
        expect(await readCompletedSteps(page)).toEqual([]);
    } finally {
        gate.resolve();
    }
});
