/* Code version: v0.1.0 */
import {expect, test as base} from '@playwright/test';

const THESIS_KEY = 'worthward:beta:v1:thesis';
const API_PATH = '/beta/api/analyze';
const EXPERIMENTS = ['regime-radar', 'analog-explorer', 'stress-lab', 'robustness-lab'];
const ALL_PAGES = [...EXPERIMENTS, 'thesis-lab', 'research-frontier'];
const prohibitedApi = /\/(?:api\/)?(?:investment|live-trading|live-orders?|orders?|price-field-training|lstm-training|broker)(?:[/?-]|$)/;
const isProhibitedApi = path => !path.startsWith('/static/') && prohibitedApi.test(path);

const test = base.extend({
    isolationAudit: [async ({page, baseURL}, use) => {
        const baseUrl = new URL(baseURL);
        expect(baseUrl.hostname).toBe('127.0.0.1');
        expect(baseUrl.port).toBe('8699');
        const forbidden = [];
        const errors = [];
        const requests = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('request', request => {
            const url = new URL(request.url());
            const method = request.method();
            requests.push({url: request.url(), method, path: url.pathname});
            if (!['GET', 'HEAD'].includes(method) || url.port === '8688'
                || isProhibitedApi(url.pathname)) {
                forbidden.push(`${method} ${url.pathname}`);
            }
        });
        await page.route('**/*', async route => {
            const request = route.request();
            const url = new URL(request.url());
            if (!['GET', 'HEAD'].includes(request.method()) || url.port === '8688'
                || isProhibitedApi(url.pathname)) {
                await route.abort('blockedbyclient');
                return;
            }
            await route.continue();
        });
        await use(requests);
        expect(forbidden, 'Beta must not start mutations, training, investment, or live-order requests').toEqual([]);
        expect(errors, 'Beta and the shared shell must not raise browser errors').toEqual([]);
    }, {auto: true}],
});

const setSidebar = async (page, expanded) => {
    const toggle = page.locator('#sidebar_toggle');
    if (await toggle.getAttribute('aria-expanded') !== String(expanded)) await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', String(expanded));
};

const openBeta = async (page, experiment) => {
    await page.goto(`/beta/${experiment}`);
    await expect(page.locator('[data-beta-root]')).toHaveAttribute('data-experiment', experiment);
};

const runLocal = async (page, ticker = 'QQQ') => {
    await page.locator('#beta_ticker').fill(ticker);
    const responsePromise = page.waitForResponse(response => new URL(response.url()).pathname === API_PATH);
    await page.locator('[data-beta-run]').click();
    const response = await responsePromise;
    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toContain('no-store');
    const payload = await response.json();
    await expect(page.locator('[data-beta-feedback]')).toHaveAttribute('data-state', 'complete');
    await expect(page.locator('[data-beta-results]')).toBeVisible();
    return payload;
};

const fillThesis = async page => {
    await expect(page.locator('[data-beta-thesis]')).toHaveAttribute('data-thesis-mounted', 'true');
    const fields = {
        hypothesis: 'Reducing the form to one question improves task completion.',
        supportingEvidence: 'Source collection is still pending.',
        counterevidence: 'The shorter form may omit necessary context.',
        falsificationTrigger: 'The held-out trial does not improve completion.',
        dataCutoff: '7 Sep 2026',
        testDeadline: '7 Oct 2026',
        reviewDate: '8 Oct 2026',
    };
    for (const [field, value] of Object.entries(fields)) {
        await page.locator(`[data-thesis-field="${field}"]`).fill(value);
    }
    return fields;
};

const downloadText = async download => {
    expect(await download.failure()).toBeNull();
    const stream = await download.createReadStream();
    expect(stream).not.toBeNull();
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    return Buffer.concat(chunks).toString('utf8');
};

const coreStorageSnapshot = page => page.evaluate(() => {
    const snapshot = storage => Object.fromEntries(Object.keys(storage).sort()
        .filter(key => !key.startsWith('worthward:beta:'))
        .map(key => [key, storage.getItem(key)]));
    return {local: snapshot(localStorage), session: snapshot(sessionStorage)};
});

test('Beta precedes Settings and leaves Settings navigation and assets isolated', async ({page, isolationAudit}) => {
    await page.goto('/settings/about');
    await page.evaluate(() => {
        localStorage.setItem('worthward:theme-mode', 'light');
        sessionStorage.setItem('worthward:sidebar-open', 'true');
    });
    await page.reload();
    await setSidebar(page, true);
    const groups = await page.locator('.sidebar-dock [data-dock-group]').evaluateAll(
        links => links.map(link => link.dataset.dockGroup),
    );
    expect(groups.indexOf('beta')).toBeGreaterThanOrEqual(0);
    expect(groups[groups.indexOf('beta') + 1]).toBe('settings');
    await expect(page.locator('script[src*="/beta.js"], script[src*="/beta-notebook.js"], link[href*="/beta.css"]')).toHaveCount(0);
    expect(isolationAudit.filter(request => /\/(?:beta|beta-notebook)\.(?:js|css)$/.test(request.path))).toEqual([]);
    const coreBefore = await coreStorageSnapshot(page);
    await page.locator('[data-dock-group="beta"]').click();
    await expect(page).toHaveURL(/\/beta(?:\/regime-radar)?$/);
    await expect(page.getByRole('navigation', {name: 'Beta experiments'}).locator('a')).toHaveCount(6);
    await expect(page.locator('[data-dock-group="beta"]')).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('#global_language_toggle')).toBeDisabled();
    await expect(page.locator('html')).toHaveAttribute('data-theme-override', 'light');
    await page.locator('#global_theme_toggle').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme-override', 'dark');
    await setSidebar(page, false);
    expect(await coreStorageSnapshot(page)).toEqual(coreBefore);
    expect(await page.evaluate(() => ({
        theme: localStorage.getItem('worthward:beta:v1:theme-mode'),
        sidebar: sessionStorage.getItem('worthward:beta:v1:sidebar-open'),
    }))).toEqual({theme: 'dark', sidebar: 'false'});
    await setSidebar(page, true);
    expect(await coreStorageSnapshot(page)).toEqual(coreBefore);
    await page.locator('[data-dock-group="settings"]').click();
    await expect(page).toHaveURL(/\/settings\/about$/);
    await expect(page.locator('html')).toHaveAttribute('data-theme-override', 'light');
    await expect(page.locator('[data-beta-root]')).toHaveCount(0);
    await page.locator('.settings-nav a[href="/settings/general"]').click();
    await expect(page).toHaveURL(/\/settings\/general$/);
    await expect(page.locator('[data-settings-section="general"]')).toBeVisible();
    await expect(page.locator('script[src*="/beta.js"], script[src*="/beta-notebook.js"], link[href*="/beta.css"]')).toHaveCount(0);
});

test('four experiments render nonempty observations from the seeded local QQQ history', async ({page, isolationAudit}) => {
    test.setTimeout(60_000);
    let finalPayload;
    for (const experiment of EXPERIMENTS) {
        await openBeta(page, experiment);
        const payload = await runLocal(page);
        expect(payload.experiment).toBe(experiment);
        expect(payload.ticker).toBe('QQQ');
        expect(payload.as_of).toBe('14 Jul 2026');
        expect(payload.observations).toBeGreaterThan(1_000);
        expect(payload.metrics.length).toBeGreaterThan(0);
        expect(payload.rows.values.length).toBeGreaterThan(0);
        expect(payload.chart.labels.length).toBeGreaterThan(0);
        expect(payload.chart.series.length).toBeGreaterThan(0);
        expect(payload.chart.series.every(series => series.values.some(Number.isFinite))).toBe(true);
        await expect(page.locator('[data-beta-provenance]')).toContainText('QQQ · Through 14 Jul 2026');
        await expect(page.locator('[data-beta-metrics] .trade-metric-card')).toHaveCount(payload.metrics.length);
        await expect(page.locator('[data-beta-table] tbody tr')).toHaveCount(payload.rows.values.length);
        expect(await page.locator('[data-beta-metrics] .trade-metric-value').allTextContents())
            .toEqual(payload.metrics.map(metric => metric.value));
        expect(await page.locator('[data-beta-chart]').evaluate(canvas => {
            const chart = window.Chart.getChart(canvas);
            return Boolean(chart && chart.width > 0 && chart.height > 0 && chart.data.datasets.length > 0);
        })).toBe(true);
        if (experiment === 'stress-lab') {
            await page.locator('#beta_shock').fill('-20');
            await page.locator('#beta_exposure').fill('50');
            await expect(page.locator('[data-beta-shock-result]')).toContainText('-10.00%');
            await expect(page.locator('[data-beta-shock-result]')).toContainText('11.11%');
        }
        finalPayload = payload;
    }
    const downloadPromise = page.waitForEvent('download');
    await page.locator('[data-beta-export]').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('worthward-beta-robustness-lab-QQQ.json');
    const exported = JSON.parse(await downloadText(download));
    expect(exported.schema).toBe('worthward-beta/v0.1.0');
    expect(exported.metrics).toEqual(finalPayload.metrics);
    const apiRequests = isolationAudit.filter(request => request.path.includes('/api/'));
    expect(apiRequests).toHaveLength(4);
    expect(apiRequests.every(request => request.path === API_PATH && request.method === 'GET')).toBe(true);
});

test('pending reads cancel cleanly, edits invalidate results, and missing caches report an error', async ({page}) => {
    await openBeta(page, 'regime-radar');
    let release;
    let settled;
    const pending = new Promise(resolve => { release = resolve; });
    const finished = new Promise(resolve => { settled = resolve; });
    const handler = async route => {
        await pending;
        try { await route.abort('aborted'); } catch { /* Cancellation can already close the request. */ }
        settled();
    };
    await page.route('**/beta/api/analyze?*', handler);
    await page.locator('#beta_ticker').fill('QQQ');
    const requested = page.waitForRequest(request => new URL(request.url()).pathname === API_PATH);
    await page.locator('[data-beta-run]').click();
    await requested;
    await expect(page.locator('[data-beta-analysis-form]')).toHaveAttribute('aria-busy', 'true');
    await expect(page.locator('[data-beta-run]')).toBeDisabled();
    await expect(page.locator('[data-beta-feedback]')).toHaveAttribute('data-state', 'pending');
    await expect(page.locator('[data-beta-results]')).toBeHidden();
    await page.locator('[data-beta-cancel]').click();
    await expect(page.locator('[data-beta-feedback]')).toHaveText('Experiment canceled.');
    await expect(page.locator('[data-beta-run]')).toBeEnabled();
    await expect(page.locator('[data-beta-cancel]')).toBeHidden();
    release();
    await finished;
    await page.unroute('**/beta/api/analyze?*', handler);
    await runLocal(page);
    await page.locator('#beta_ticker').fill('BETANOCACHE');
    await expect(page.locator('[data-beta-results]')).toBeHidden();
    await expect(page.locator('[data-beta-feedback]')).toContainText('Ticker changed');
    const missing = page.waitForResponse(response => new URL(response.url()).pathname === API_PATH);
    await page.locator('[data-beta-run]').click();
    expect((await missing).status()).toBe(404);
    await expect(page.locator('[data-beta-feedback]')).toHaveAttribute('data-state', 'error');
    await expect(page.locator('[data-beta-feedback]')).toContainText('No local daily Close cache');
    await expect(page.locator('[data-beta-results]')).toBeHidden();
    await expect(page.locator('[data-beta-run]')).toBeEnabled();
});

test('Thesis Lab explicitly saves, restores, exports, and deletes only its own browser draft', async ({page}) => {
    await openBeta(page, 'thesis-lab');
    const fields = await fillThesis(page);
    await page.evaluate(() => localStorage.setItem('beta-e2e-unrelated', 'keep'));
    expect(await page.evaluate(key => localStorage.getItem(key), THESIS_KEY)).toBeNull();
    await page.locator('[data-thesis-action="build"]').click();
    await expect(page.locator('[data-thesis-brief]')).toContainText('## Skeptic');
    await expect(page.locator('[data-thesis-draft-status]')).toHaveAttribute('data-state', 'unsaved');
    await page.locator('[data-thesis-action="save"]').click();
    await expect(page.locator('[data-thesis-draft-status]')).toHaveAttribute('data-state', 'saved');
    await page.reload();
    await expect(page.locator('[data-thesis-draft-status]')).toContainText('Saved draft loaded');
    for (const [field, value] of Object.entries(fields)) {
        await expect(page.locator(`[data-thesis-field="${field}"]`)).toHaveValue(value);
    }
    await expect(page.locator('[data-thesis-action="download"]')).toBeDisabled();
    await page.locator('[data-thesis-action="build"]').click();
    const brief = await page.locator('[data-thesis-brief]').textContent();
    const downloadPromise = page.waitForEvent('download');
    await page.locator('[data-thesis-action="download"]').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('worthward-thesis-brief.md');
    expect(await downloadText(download)).toBe(brief);
    expect(brief).toContain('Data cutoff: 7 Sep 2026');
    expect(brief).toContain('future-data leakage');
    await page.locator('[data-thesis-field="hypothesis"]').fill('A revised claim');
    await expect(page.locator('[data-thesis-brief]')).toBeHidden();
    await expect(page.locator('[data-thesis-action="copy"]')).toBeDisabled();
    await expect(page.locator('[data-thesis-action="download"]')).toBeDisabled();
    await page.locator('[data-thesis-action="delete"]').click();
    await expect(page.locator('[data-thesis-field="hypothesis"]')).toHaveValue('A revised claim');
    expect(await page.evaluate(key => localStorage.getItem(key), THESIS_KEY)).toBeNull();
    expect(await page.evaluate(() => localStorage.getItem('beta-e2e-unrelated'))).toBe('keep');
});

test('Research Frontier opens a separate unsaved hypothesis without overwriting the saved thesis', async ({page}, testInfo) => {
    await openBeta(page, 'thesis-lab');
    const fields = await fillThesis(page);
    await page.locator('[data-thesis-action="save"]').click();
    await expect(page.locator('[data-thesis-draft-status]')).toHaveAttribute('data-state', 'saved');
    const saved = await page.evaluate(key => localStorage.getItem(key), THESIS_KEY);
    await openBeta(page, 'research-frontier');
    await expect(page.locator('.beta-frontier-card')).toHaveCount(6);
    await page.screenshot({path: testInfo.outputPath('beta-research-frontier.png'), fullPage: true});
    const link = page.getByRole('link', {name: 'Develop this thesis'}).first();
    const hypothesis = new URL(await link.getAttribute('href'), page.url()).searchParams.get('hypothesis');
    expect(hypothesis.length).toBeGreaterThan(0);
    await link.click();
    await expect(page.locator('[data-thesis-field="hypothesis"]')).toHaveValue(hypothesis);
    await expect(page.locator('[data-thesis-field="supportingEvidence"]')).toHaveValue('');
    await expect(page.locator('[data-thesis-field="dataCutoff"]')).toHaveValue('');
    await expect(page.locator('[data-thesis-draft-status]')).toHaveAttribute('data-state', 'unsaved');
    expect(await page.evaluate(key => localStorage.getItem(key), THESIS_KEY)).toBe(saved);
    await page.reload();
    await expect(page.locator('[data-thesis-field="hypothesis"]')).toHaveValue(hypothesis);
    await openBeta(page, 'thesis-lab');
    await expect(page.locator('[data-thesis-field="hypothesis"]')).toHaveValue(fields.hypothesis);
    expect(await page.evaluate(key => localStorage.getItem(key), THESIS_KEY)).toBe(saved);
});

test('Thesis Lab validates inputs and reports actual storage and clipboard failures', async ({page}) => {
    await page.addInitScript(key => {
        for (const method of ['getItem', 'setItem', 'removeItem']) {
            const original = Storage.prototype[method];
            Storage.prototype[method] = function (requestedKey, ...args) {
                if (requestedKey === key) throw new DOMException('Storage blocked', 'SecurityError');
                return original.call(this, requestedKey, ...args);
            };
        }
        Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {
            writeText: () => new Promise((resolve, reject) => { window.__betaRejectClipboard = reject; }),
        }});
    }, THESIS_KEY);
    await openBeta(page, 'thesis-lab');
    await expect(page.locator('[data-thesis-draft-status]')).toHaveAttribute('data-state', 'error');
    await page.locator('[data-thesis-action="build"]').click();
    await expect(page.locator('[data-thesis-action-status]')).toContainText('Hypothesis is required');
    await expect(page.locator('[data-thesis-brief]')).toBeHidden();
    await fillThesis(page);
    await page.locator('[data-thesis-action="save"]').click();
    await expect(page.locator('[data-thesis-draft-status]')).toHaveAttribute('data-state', 'error');
    await expect(page.locator('[data-thesis-draft-status]')).toContainText('Draft was not saved');
    await page.locator('[data-thesis-field="hypothesis"]').fill('<img src=x onerror="window.betaUnsafe=true">');
    await page.locator('[data-thesis-action="build"]').click();
    await expect(page.locator('[data-thesis-brief]')).toContainText('<img src=x');
    await expect(page.locator('[data-thesis-brief] img')).toHaveCount(0);
    expect(await page.evaluate(() => window.betaUnsafe)).toBeUndefined();
    await page.locator('[data-thesis-action="copy"]').click();
    await expect(page.locator('[data-thesis-action-status]')).toHaveAttribute('data-state', 'pending');
    await expect(page.locator('[data-thesis-action="copy"]')).toBeDisabled();
    await page.evaluate(() => window.__betaRejectClipboard(new DOMException('Denied', 'NotAllowedError')));
    await expect(page.locator('[data-thesis-action-status]')).toHaveAttribute('data-state', 'error');
    await expect(page.locator('[data-thesis-action-status]')).toContainText('Markdown was not copied');
    await page.locator('[data-thesis-action="delete"]').click();
    await expect(page.locator('[data-thesis-draft-status]')).toContainText('could not be deleted');
});

for (const width of [1024, 390]) {
    for (const colorScheme of ['light', 'dark']) {
        test(`all Beta pages stay bounded with a visible collapsed-sidebar workspace at ${width}px in ${colorScheme}`, async ({page}, testInfo) => {
            test.setTimeout(60_000);
            await page.setViewportSize({width, height: 1100});
            await page.emulateMedia({colorScheme, reducedMotion: 'reduce'});
            for (const experiment of ALL_PAGES) {
                await openBeta(page, experiment);
                await setSidebar(page, false);
                await expect(page.locator('[data-beta-root]')).toBeVisible();
                await expect(page.locator('.beta-intro')).toBeInViewport();
                if (experiment === 'regime-radar') {
                    await runLocal(page);
                    expect(await page.locator('.beta-metrics .trade-metric-card').evaluateAll(cards => cards.every(card => {
                        const label = card.querySelector('.trade-metric-label').getBoundingClientRect();
                        const value = card.querySelector('.trade-metric-value').getBoundingClientRect();
                        const note = card.querySelector('.beta-caption').getBoundingClientRect();
                        return label.bottom <= value.top + 1 && value.bottom <= note.top + 1
                            && note.bottom <= card.getBoundingClientRect().bottom + 1;
                    }))).toBe(true);
                }
                if (experiment === 'thesis-lab') {
                    await fillThesis(page);
                    await page.locator('[data-thesis-action="build"]').click();
                    await expect(page.locator('[data-thesis-brief]')).toBeVisible();
                }
                await expect.poll(() => page.evaluate(() => {
                    const root = document.querySelector('[data-beta-root]');
                    const bounds = root.getBoundingClientRect();
                    const scrollport = document.querySelector('.beta-content');
                    return {
                        documentBounded: document.documentElement.scrollWidth - document.documentElement.clientWidth <= 1,
                        contentBounded: scrollport.scrollWidth - scrollport.clientWidth <= 1,
                        rightBounded: bounds.right <= innerWidth + 1,
                        visibleWidth: bounds.width > 0 && bounds.left >= -1,
                    };
                })).toEqual({documentBounded: true, contentBounded: true, rightBounded: true, visibleWidth: true});
                expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toContain(colorScheme);
                if (experiment === 'regime-radar'
                    && ((width === 1024 && colorScheme === 'light') || (width === 390 && colorScheme === 'dark'))) {
                    await page.screenshot({path: testInfo.outputPath(`beta-${width}-${colorScheme}.png`), fullPage: true});
                }
            }
            await setSidebar(page, true);
            await expect(page.getByRole('navigation', {name: 'Beta experiments'})).toBeVisible();
            await setSidebar(page, false);
            await expect(page.locator('.beta-intro')).toBeInViewport();
        });
    }
}
