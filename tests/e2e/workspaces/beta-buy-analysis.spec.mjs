/* Code version: v1.0.0 */
import {expect, test as base} from '@playwright/test';

const API_PATH = '/beta/api/buy-analysis';
const committee = '[data-beta-committee]';
const run = '[data-beta-committee-run]';
const feedback = '[data-beta-committee-feedback]';
const results = '[data-beta-committee-results]';
const prohibitedApi = /\/(?:api\/)?(?:investment|live-trading|live-orders?|orders?|price-field-training|lstm-training|broker)(?:[/?-]|$)/;

const test = base.extend({
    isolationAudit: [async ({page, baseURL}, use) => {
        expect(new URL(baseURL).port).toBe('8699');
        const forbidden = [];
        const errors = [];
        const requests = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('request', request => {
            const url = new URL(request.url());
            requests.push({method: request.method(), path: url.pathname, url: request.url()});
            if (!['GET', 'HEAD'].includes(request.method()) || url.port === '8688'
                || (!url.pathname.startsWith('/static/') && prohibitedApi.test(url.pathname))) {
                forbidden.push(`${request.method()} ${url.pathname}`);
            }
        });
        await page.route('**/*', async route => {
            const request = route.request();
            const url = new URL(request.url());
            if (!['GET', 'HEAD'].includes(request.method()) || url.port === '8688'
                || (!url.pathname.startsWith('/static/') && prohibitedApi.test(url.pathname))) {
                await route.abort('blockedbyclient');
                return;
            }
            await route.continue();
        });
        await use(requests);
        expect(forbidden, 'Buy Analysis must remain a read-only Beta research page').toEqual([]);
        expect(errors, 'The committee and shared controls must not raise browser errors').toEqual([]);
    }, {auto: true}],
});

const payload = (ticker = 'QQQ', horizon = 1) => ({
    schema: 'beta-buy-analysis/v1', ticker, as_of: '14 Jul 2026',
    origin: '2026-07-14T00:00:00+00:00', observations: 1_499,
    source: `Local daily cache (${ticker}); no refresh`,
    model: {id: 'har-range-price-field', name: 'HAR Range Price Field'},
    votes: [
        {member: 'trend', name: 'Trend', vote: 'approve', reason: 'Latest close exceeds its trailing 60-close mean.', probability_up: null, origin: '2026-07-14T00:00:00+00:00', model_id: null},
        {member: 'momentum', name: 'Momentum', vote: 'neutral', reason: 'The observed 20-session close return is unchanged.', probability_up: null, origin: '2026-07-14T00:00:00+00:00', model_id: null},
        {member: 'price-field', name: 'Price Field', vote: 'approve', reason: 'The forecast rise probability reaches the approval threshold.', probability_up: 0.72, origin: '2026-07-14T00:00:00+00:00', model_id: 'har-range-price-field', model_version: 'v1.0.0', fingerprint: 'isolated-e2e-forecast', horizon, target_interval: 'signal-close-to-future-close'},
    ],
    summary: {verdict: 'approve', approve: 2, oppose: 0, neutral: 1, abstain: 0, total: 3, required_approvals: 2},
    notes: ['Price Field has one seat regardless of the selected model.', 'Probabilities are not averaged.'],
});

const openCommittee = async page => {
    await page.goto('/beta/buy-analysis');
    await expect(page.locator(committee)).toBeVisible();
    await expect(page.locator('#beta_committee_model')).toHaveValue('har-range-price-field');
};

const interceptCommittee = page => page.route('**/beta/api/buy-analysis?*', route => {
    const url = new URL(route.request().url());
    return route.fulfill({
        status: 200, contentType: 'application/json', headers: {'Cache-Control': 'no-store'},
        json: payload(url.searchParams.get('ticker'), Number(url.searchParams.get('horizon'))),
    });
});

const runCommittee = async (page, ticker = 'QQQ') => {
    await page.locator('#beta_committee_ticker').fill(ticker);
    const request = page.waitForRequest(item => new URL(item.url()).pathname === API_PATH);
    await page.locator(run).click();
    const sent = await request;
    await expect(page.locator(feedback)).toHaveAttribute('data-state', 'complete');
    await expect(page.locator(results)).toBeVisible();
    return new URL(sent.url());
};

test('Buy Analysis submits one explicit local read and displays Price Field as one vote', async ({page, isolationAudit}) => {
    await interceptCommittee(page);
    await openCommittee(page);
    expect(isolationAudit.filter(request => request.path === API_PATH)).toEqual([]);
    await expect(page.locator('#beta_committee_horizon')).toHaveValue('1');
    await expect(page.locator('#beta_committee_threshold')).toHaveValue('60');
    const request = await runCommittee(page, 'qqq');
    expect(Object.fromEntries(request.searchParams)).toEqual({ticker: 'QQQ', model: 'har-range-price-field', horizon: '1', threshold: '60'});
    expect(isolationAudit.filter(item => item.path === API_PATH)).toHaveLength(1);
    await expect(page.locator('[data-beta-committee-provenance]')).toContainText('QQQ · Through 14 Jul 2026 · 1,499 cached observations');
    const table = page.locator('[data-beta-committee-table]');
    await expect(table.locator('tbody tr')).toHaveCount(3);
    await expect(table.locator('[data-committee-member="price-field"]')).toHaveCount(1);
    await expect(table.locator('[data-committee-member="price-field"]')).toContainText('72%');
    await expect(table.locator('[data-committee-member="price-field"]')).toContainText('Origin: 14 Jul 2026');
    await expect(table.locator('[data-committee-member="price-field"]')).toContainText('Fingerprint: isolated-e2e-forecast');
    await expect(table.locator('[data-committee-member="trend"]')).toContainText('Not a forecast');
    await expect(page.locator('[data-beta-committee-metrics]')).toContainText('2 / 3');
    await expect(page.locator('[data-beta-committee-metrics]')).toContainText('One committee vote');
    await expect(table.locator('caption')).toContainText('Probabilities are not averaged');
});

for (const field of ['ticker', 'model', 'horizon', 'threshold']) {
    test(`changing ${field} invalidates all previously displayed committee votes`, async ({page, isolationAudit}) => {
        await interceptCommittee(page);
        await openCommittee(page);
        await runCommittee(page);
        if (field === 'model') {
            await page.locator('[data-shared-select-field] [data-shared-select-trigger]').click();
            await page.locator('#beta_committee_model_dropdown').getByRole('option', {name: 'Score-Driven Price Field', exact: true}).click();
        } else {
            await page.locator(`#beta_committee_${field}`).fill({ticker: 'AAPL', horizon: '5', threshold: '70'}[field]);
        }
        await expect(page.locator(results)).toBeHidden();
        await expect(page.locator(feedback)).toContainText('Inputs changed');
        await expect(page.locator(run)).toBeEnabled();
        expect(isolationAudit.filter(request => request.path === API_PATH)).toHaveLength(1);
    });
}

for (const action of ['cancel', 'edit']) {
test(`${action} discards a late response before a new analysis`, async ({page}) => {
    await openCommittee(page);
    let release;
    let settled;
    const waiting = new Promise(resolve => { release = resolve; });
    const finished = new Promise(resolve => { settled = resolve; });
    const handler = async route => {
        await waiting;
        try {
            await route.fulfill({status: 200, contentType: 'application/json', json: payload('OLD')});
        } catch { /* The browser can close an already canceled request. */ }
        settled();
    };
    await page.route('**/beta/api/buy-analysis?*', handler);
    await page.locator('#beta_committee_ticker').fill('QQQ');
    const requested = page.waitForRequest(request => new URL(request.url()).pathname === API_PATH);
    await page.locator(run).click();
    await requested;
    await expect(page.locator('[data-beta-committee-form]')).toHaveAttribute('aria-busy', 'true');
    await expect(page.locator(run)).toBeDisabled();
    if (action === 'cancel') await page.locator('[data-beta-committee-cancel]').click();
    else await page.locator('#beta_committee_horizon').fill('5');
    const expectedFeedback = action === 'cancel' ? 'Buy analysis canceled.' : 'Inputs changed. Run buy analysis to update the committee votes.';
    await expect(page.locator(feedback)).toHaveText(expectedFeedback);
    await expect(page.locator(run)).toBeEnabled();
    await expect(page.locator(results)).toBeHidden();
    release();
    await finished;
    await page.unroute('**/beta/api/buy-analysis?*', handler);
    await expect(page.locator(results)).toBeHidden();
    await expect(page.locator(feedback)).toHaveText(expectedFeedback);
    await interceptCommittee(page);
    await runCommittee(page, 'AAPL');
    await expect(page.locator('[data-beta-committee-provenance]')).toContainText('AAPL');
    await expect(page.locator(results)).not.toContainText('OLD');
});
}

test('unavailable Price Field remains an abstention and server errors leave no stale verdict', async ({page}) => {
    await page.route('**/beta/api/buy-analysis?*', route => {
        const data = payload();
        data.votes[2] = {...data.votes[2], vote: 'abstain', probability_up: null, reason: 'Observed OHLCV history is unavailable.'};
        data.summary = {verdict: 'incomplete', approve: 1, oppose: 0, neutral: 1, abstain: 1, total: 3, required_approvals: 2};
        return route.fulfill({status: 200, contentType: 'application/json', json: data});
    });
    await openCommittee(page);
    await runCommittee(page);
    await expect(page.locator('[data-beta-committee-metrics]')).toContainText('Incomplete');
    await expect(page.locator('[data-committee-member="price-field"]')).toContainText('Abstain');
    await expect(page.locator('[data-committee-member="price-field"]')).toContainText('Unavailable');
    await expect(page.locator('[data-beta-committee-table] tbody tr')).toHaveCount(3);
    await page.route('**/beta/api/buy-analysis?*', route => route.fulfill({status: 404, contentType: 'application/json', json: {error: 'No local daily Close cache is available for MISSING.'}}));
    await page.locator('#beta_committee_ticker').fill('MISSING');
    await page.locator(run).click();
    await expect(page.locator(feedback)).toHaveAttribute('data-state', 'error');
    await expect(page.locator(feedback)).toContainText('No local daily Close cache');
    await expect(page.locator(results)).toBeHidden();
    await expect(page.locator(run)).toBeEnabled();
});

for (const viewport of [{width: 1440, height: 900}, {width: 390, height: 740}]) {
    test(`standard guided controls and results remain bounded at ${viewport.width}px`, async ({page}) => {
        await page.setViewportSize(viewport);
        await interceptCommittee(page);
        await openCommittee(page);
        const steps = page.locator(`${committee} ol.process-list > li.process-list-step`);
        await expect(steps).toHaveCount(3);
        await expect(steps.locator('.process-list-marker[aria-hidden="true"]')).toHaveCount(3);
        await expect(steps.locator('details.ui-collapse')).toHaveCount(3);
        const disclosure = steps.last().locator('details.ui-collapse');
        const summary = disclosure.locator(':scope > summary');
        await summary.focus();
        await summary.press('Enter');
        await expect(disclosure).toHaveAttribute('open', '');
        await expect(disclosure.locator(':scope > .ui-collapse-body')).toBeVisible();
        await summary.press('Space');
        await expect(disclosure).not.toHaveAttribute('open', '');
        await runCommittee(page);
        expect(await page.locator(run).getAttribute('class')).toContain('secondary-button');
        await expect.poll(() => page.evaluate(() => {
            const root = document.querySelector('[data-beta-committee]');
            const bounds = root.getBoundingClientRect();
            const scrollport = document.querySelector('.beta-content');
            const tableScroll = root.querySelector('.beta-table-scroll');
            return {
                documentBounded: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
                contentBounded: scrollport.scrollWidth <= scrollport.clientWidth + 1,
                rootBounded: bounds.left >= -1 && bounds.right <= innerWidth + 1,
                tableContained: tableScroll.getBoundingClientRect().right <= bounds.right + 1,
            };
        })).toEqual({documentBounded: true, contentBounded: true, rootBounded: true, tableContained: true});
    });
}
