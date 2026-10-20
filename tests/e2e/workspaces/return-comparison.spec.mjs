/* Return comparison regressions. Code version: v1.2.3 */
import {expect, test} from '@playwright/test';


const dynfSuggestion = {
    symbol: 'DYNF',
    name: 'iShares U.S. Equity Factor Rotation Active ETF',
    logo_url: '',
    source: 'remote',
};


test('keeps a cold DY prefix and pending DYNF lookup neutral', async ({page}) => {
    let releaseLookup;
    let dynfLookupCount = 0;
    const lookupGate = new Promise((resolve) => {
        releaseLookup = resolve;
    });
    await page.route('**/api/symbol-search?**', async (route) => {
        const query = new URL(route.request().url()).searchParams.get('q');
        if (query === 'DYNF') {
            dynfLookupCount += 1;
            await lookupGate;
        }
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify(query === 'DYNF' ? [dynfSuggestion] : []),
        });
    });
    await page.goto('/workspaces/compare?ticker=QQQ&ticker=JEPQ&period=1y');
    const input = page.locator('#ticker_2');
    const panel = page.locator('#ticker_2_suggestions');
    const prefixResponse = page.waitForResponse((response) => (
        new URL(response.url()).pathname === '/api/symbol-search'
        && new URL(response.url()).searchParams.get('q') === 'DY'
    ));

    await input.fill('DY');
    await prefixResponse;
    await expect(panel).not.toHaveClass(/is-open/);
    await expect(input).not.toHaveClass(/is-invalid/);
    await expect(input).toHaveJSProperty('validationMessage', '');

    await input.fill('DYNF');
    await expect(panel.locator('.suggestion-loading')).toHaveText('Fetching DYNF…');
    await expect.poll(() => dynfLookupCount).toBe(1);
    await expect(input).not.toHaveClass(/is-invalid/);
    await expect(input).toHaveJSProperty('validationMessage', '');

    releaseLookup();
    await expect(panel.locator('.suggestion-item[data-symbol="DYNF"]')).toBeVisible();
    await expect(input).toHaveAttribute('data-validated-ticker', 'DYNF');
    await expect(input).not.toHaveClass(/is-invalid/);
});


test('clears a malformed .DY error while a new DYNF lookup is pending', async ({page}) => {
    let releaseLookup;
    let dynfLookupCount = 0;
    const lookupGate = new Promise((resolve) => {
        releaseLookup = resolve;
    });
    await page.route('**/api/symbol-search?**', async (route) => {
        const query = new URL(route.request().url()).searchParams.get('q');
        if (query === 'DYNF') {
            dynfLookupCount += 1;
            await lookupGate;
        }
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify(query === 'DYNF' ? [dynfSuggestion] : []),
        });
    });
    await page.goto('/workspaces/compare?ticker=QQQ&ticker=JEPQ&period=1y');
    const input = page.locator('#ticker_2');

    await input.fill('.DY');
    await input.press('Enter');
    await expect(input).toHaveClass(/is-invalid/);
    await expect(input).toHaveJSProperty('validationMessage', 'Enter a valid ticker symbol.');

    await input.fill('DYNF');
    await expect(page.locator('#ticker_2_suggestions .suggestion-loading')).toHaveText('Fetching DYNF…');
    await expect.poll(() => dynfLookupCount).toBe(1);
    await expect(input).not.toHaveClass(/is-invalid/);
    await expect(input).toHaveJSProperty('validationMessage', '');

    releaseLookup();
    await expect(page.locator('#ticker_2_suggestions .suggestion-item[data-symbol="DYNF"]')).toBeVisible();
    await expect(input).toHaveAttribute('data-validated-ticker', 'DYNF');
    await expect(input).not.toHaveClass(/is-invalid/);
});


for (const {name, initialItems} of [
    {name: 'empty results', initialItems: []},
    {
        name: 'nonexact suggestions',
        initialItems: [{symbol: 'DYN', name: 'Dynasty Financial Partners', logo_url: '', source: 'remote'}],
    },
]) {
    test(`retries a cold DYNF lookup after ${name} when Enter commits the ticker`, async ({page}) => {
        let lookupCount = 0;
        await page.route('**/api/symbol-search?**', async (route) => {
            const query = new URL(route.request().url()).searchParams.get('q');
            const items = query === 'DYNF'
                ? (++lookupCount === 1 ? initialItems : [dynfSuggestion])
                : [];
            await route.fulfill({
                contentType: 'application/json',
                body: JSON.stringify(items),
            });
        });
        await page.route('**/workspaces/compare?**', async (route) => {
            const url = new URL(route.request().url());
            if (url.searchParams.getAll('ticker').includes('DYNF')) {
                await route.fulfill({
                    contentType: 'text/html',
                    body: '<!doctype html><title>DYNF comparison loaded</title>',
                });
                return;
            }
            await route.continue();
        });
        await page.goto('/workspaces/compare?ticker=QQQ&ticker=JEPQ&period=1y');
        const input = page.locator('#ticker_2');

        await input.fill('DYNF');
        await expect.poll(() => lookupCount).toBe(1);
        await expect(page.locator('#ticker_2_suggestions .suggestion-loading')).toBeHidden();
        if (initialItems.length) {
            await expect(page.locator('#ticker_2_suggestions .suggestion-item[data-symbol="DYN"]')).toBeVisible();
        }
        await expect(input).not.toHaveClass(/is-invalid/);
        await input.press('Enter');

        await expect(page).toHaveURL(/ticker=DYNF/, {timeout: 10_000});
        await expect(page).toHaveTitle('DYNF comparison loaded');
        expect(lookupCount).toBeGreaterThanOrEqual(2);
    });
}


for (const {name, status, items} of [
    {name: 'empty discovery', status: 200, items: []},
    {
        name: 'nonexact discovery',
        status: 200,
        items: [{symbol: 'FELG', name: 'Fidelity Enhanced Large Cap Growth ETF', logo_url: '', source: 'remote'}],
    },
    {name: 'unavailable discovery', status: 503, items: []},
]) {
    test(`loads a first cold FELC submission after ${name}`, async ({page}) => {
        let releaseLookup;
        let releaseComparison;
        let lookupCount = 0;
        let submitCount = 0;
        const comparisonRequests = [];
        const lookupGate = new Promise((resolve) => {
            releaseLookup = resolve;
        });
        const comparisonGate = new Promise((resolve) => {
            releaseComparison = resolve;
        });
        await page.route('**/api/symbol-search?**', async (route) => {
            const query = new URL(route.request().url()).searchParams.get('q');
            if (query === 'FELC') {
                lookupCount += 1;
                await lookupGate;
                await route.fulfill({
                    status,
                    contentType: 'application/json',
                    body: JSON.stringify(items),
                });
                return;
            }
            await route.fulfill({contentType: 'application/json', body: '[]'});
        });
        await page.route('**/workspaces/compare?**', async (route) => {
            const url = new URL(route.request().url());
            if (url.searchParams.getAll('ticker').includes('FELC')) {
                comparisonRequests.push({
                    url: url.href,
                    kind: route.request().resourceType(),
                    requestedWith: route.request().headers()['x-requested-with'] || '',
                });
                await comparisonGate;
                await route.fulfill({
                    contentType: 'text/html',
                    body: '<!doctype html><title>First FELC comparison loaded</title>',
                });
                return;
            }
            await route.continue();
        });
        await page.goto('/workspaces/compare?ticker=QQQ&ticker=JEPQ&period=1y');
        await page.locator('#add_ticker').click();
        const input = page.locator('#ticker_3');
        await expect(input).toHaveValue('');
        await page.exposeFunction('__recordFelcSubmit', () => {
            submitCount += 1;
        });
        await input.evaluate((element) => {
            element.form.addEventListener('submit', () => {
                if (element.value === 'FELC') void window.__recordFelcSubmit();
            });
        });

        await input.pressSequentially('FELC');
        await expect.poll(() => lookupCount).toBe(1);
        await input.press('Enter');
        await expect(input).toHaveAttribute('data-validation-pending', '1');
        await expect(input).not.toHaveClass(/is-invalid/);
        await expect(input).not.toHaveAttribute('data-validated-known', '1');

        releaseLookup();
        await expect.poll(() => comparisonRequests.length, {timeout: 10_000}).toBe(1);
        await expect(input).toHaveAttribute('data-unresolved-ticker', 'FELC');
        await expect(input).not.toHaveAttribute('data-validated-known', '1');
        await expect(input).not.toHaveAttribute('data-validated-ticker', 'FELC');
        await expect(input).not.toHaveClass(/is-invalid/);
        await expect(input).toHaveJSProperty('validationMessage', '');
        expect(lookupCount).toBe(1);
        await expect.poll(() => submitCount).toBe(1);

        releaseComparison();
        await expect(page).toHaveURL(/ticker=FELC/);
        await expect(page).toHaveTitle('First FELC comparison loaded');
        // The title-only fixture lacks a workspace panel, so hydration falls back to a document request.
        expect(comparisonRequests.map((request) => request.kind)).toEqual(['fetch', 'document']);
        expect(comparisonRequests.map((request) => request.requestedWith)).toEqual(['workspace-hydrate', '']);
        expect(comparisonRequests[0].url).toBe(comparisonRequests[1].url);
        expect(submitCount).toBe(1);
        expect(lookupCount).toBe(1);
    });
}


test('loads a canonical ticker alias from one coalesced pending lookup', async ({page}) => {
    let releaseLookup;
    const lookupQueries = [];
    const lookupGate = new Promise((resolve) => {
        releaseLookup = resolve;
    });
    await page.route('**/api/symbol-search?**', async (route) => {
        const query = new URL(route.request().url()).searchParams.get('q');
        const isAliasQuery = query === '600519.SH' || query === '600519.SS';
        if (isAliasQuery) {
            lookupQueries.push(query);
            await lookupGate;
        }
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify(isAliasQuery ? [{
                symbol: '600519.SS',
                name: 'Kweichow Moutai Co., Ltd.',
                logo_url: '',
                source: 'remote',
            }] : []),
        });
    });
    await page.route('**/workspaces/compare?**', async (route) => {
        const url = new URL(route.request().url());
        if (url.searchParams.getAll('ticker').includes('600519.SS')) {
            await route.fulfill({
                contentType: 'text/html',
                body: '<!doctype html><title>Canonical Shanghai comparison loaded</title>',
            });
            return;
        }
        await route.continue();
    });
    await page.goto('/workspaces/compare?ticker=QQQ&ticker=JEPQ&period=1y');
    const input = page.locator('#ticker_2');

    await input.fill('600519.SH');
    await expect(page.locator('#ticker_2_suggestions .suggestion-loading')).toHaveText('Fetching 600519.SH…');
    await expect.poll(() => lookupQueries.length).toBe(1);
    await input.press('Enter');
    await expect(input).toHaveAttribute('data-validation-pending', '1');
    expect(lookupQueries).toEqual(['600519.SH']);

    releaseLookup();

    await expect(page).toHaveURL(/ticker=600519\.SS/, {timeout: 10_000});
    await expect(page).toHaveTitle('Canonical Shanghai comparison loaded');
    expect(lookupQueries).toEqual(['600519.SH']);
});


test('ignores a stale empty DY lookup after DYNF is confirmed', async ({page}) => {
    let releasePrefix;
    let prefixLookupCount = 0;
    const prefixGate = new Promise((resolve) => {
        releasePrefix = resolve;
    });
    await page.route('**/api/symbol-search?**', async (route) => {
        const query = new URL(route.request().url()).searchParams.get('q');
        if (query === 'DY') {
            prefixLookupCount += 1;
            await prefixGate;
        }
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify(query === 'DYNF' ? [dynfSuggestion] : []),
        });
    });
    await page.goto('/workspaces/compare?ticker=QQQ&ticker=JEPQ&period=1y');
    const input = page.locator('#ticker_2');
    const exactSuggestion = page.locator('#ticker_2_suggestions .suggestion-item[data-symbol="DYNF"]');

    await input.fill('DY');
    await expect.poll(() => prefixLookupCount).toBe(1);
    await input.fill('DYNF');
    await expect(exactSuggestion).toBeVisible();
    await expect(input).toHaveAttribute('data-validated-ticker', 'DYNF');
    const staleResponse = page.waitForResponse((response) => (
        new URL(response.url()).pathname === '/api/symbol-search'
        && new URL(response.url()).searchParams.get('q') === 'DY'
    ));

    releasePrefix();
    await (await staleResponse).finished();
    await page.evaluate(() => new Promise((resolve) => window.requestAnimationFrame(resolve)));

    await expect(input).toHaveValue('DYNF');
    await expect(input).toHaveAttribute('data-validated-ticker', 'DYNF');
    await expect(input).not.toHaveClass(/is-invalid/);
    await expect(input).toHaveJSProperty('validationMessage', '');
    await expect(exactSuggestion).toBeVisible();
});


test('does not commit DYNF when an older DY blur validation succeeds', async ({page}) => {
    let releaseDyValidation;
    let releaseDynfLookup;
    let dyLookupCount = 0;
    let dynfLookupCount = 0;
    const dynfComparisonRequests = [];
    const dyValidationGate = new Promise((resolve) => {
        releaseDyValidation = resolve;
    });
    const dynfLookupGate = new Promise((resolve) => {
        releaseDynfLookup = resolve;
    });
    await page.route('**/api/symbol-search?**', async (route) => {
        const query = new URL(route.request().url()).searchParams.get('q');
        if (query === 'DY') {
            dyLookupCount += 1;
            if (dyLookupCount > 1) await dyValidationGate;
        } else if (query === 'DYNF') {
            dynfLookupCount += 1;
            await dynfLookupGate;
        }
        const items = query === 'DYNF'
            ? [dynfSuggestion]
            : query === 'DY'
                ? [{symbol: 'DY', name: 'Dycom Industries, Inc.', logo_url: '', source: 'remote'}]
                : [];
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify(items),
        });
    });
    await page.route('**/workspaces/compare?**', async (route) => {
        const url = new URL(route.request().url());
        if (url.searchParams.getAll('ticker').includes('DYNF')) {
            dynfComparisonRequests.push(url.href);
            await route.fulfill({
                contentType: 'text/html',
                body: '<!doctype html><title>Unexpected uncommitted DYNF comparison</title>',
            });
            return;
        }
        await route.continue();
    });
    await page.goto('/workspaces/compare?ticker=QQQ&ticker=JEPQ&period=1y');
    const input = page.locator('#ticker_2');

    await input.fill('DY');
    await expect(input).toHaveAttribute('data-validated-ticker', 'DY');
    await input.blur();
    await expect.poll(() => dyLookupCount).toBe(2);
    await expect(input).toHaveAttribute('data-validation-pending', '1');

    await input.fill('DYNF');
    await expect.poll(() => dynfLookupCount).toBe(1);
    await page.evaluate(() => {
        window.__returnComparisonSubmitCount = 0;
        const input = document.querySelector('#ticker_2');
        input.form.addEventListener('submit', () => {
            if (input.value === 'DYNF') window.__returnComparisonSubmitCount += 1;
        });
    });
    const staleResponse = page.waitForResponse((response) => (
        new URL(response.url()).pathname === '/api/symbol-search'
        && new URL(response.url()).searchParams.get('q') === 'DY'
    ));

    releaseDyValidation();
    await (await staleResponse).finished();
    // Cover the 120 ms blur-finalization timer while DYNF remains gated and uncommitted.
    await page.waitForTimeout(250);

    expect(await page.evaluate(() => window.__returnComparisonSubmitCount)).toBe(0);
    expect(dynfComparisonRequests).toHaveLength(0);
    await expect(input).toHaveValue('DYNF');
    await expect(input).toHaveAttribute('data-symbol', '');
    await expect(input).toHaveAttribute('data-validated-ticker', '');
    await expect(input).toHaveAttribute('data-validation-pending', '');
    await expect(input).not.toHaveClass(/is-invalid/);
    await expect(input).toHaveJSProperty('validationMessage', '');

    releaseDynfLookup();
    await expect(page.locator('#ticker_2_suggestions .suggestion-item[data-symbol="DYNF"]')).toBeVisible();
    await expect(input).toHaveAttribute('data-validated-ticker', 'DYNF');
    expect(dynfComparisonRequests).toHaveLength(0);
});


test('preserves independently confirmed bare numeric input after a stale qualified lookup', async ({page}) => {
    let releaseQualifiedValidation;
    let releaseBareLookup;
    let qualifiedLookupCount = 0;
    let bareLookupCount = 0;
    let submitCount = 0;
    const comparisonRequests = [];
    const qualifiedValidationGate = new Promise((resolve) => {
        releaseQualifiedValidation = resolve;
    });
    const bareLookupGate = new Promise((resolve) => {
        releaseBareLookup = resolve;
    });
    await page.route('**/api/symbol-search?**', async (route) => {
        const query = new URL(route.request().url()).searchParams.get('q');
        if (query === '0700.HK') {
            qualifiedLookupCount += 1;
            if (qualifiedLookupCount > 1) await qualifiedValidationGate;
        } else if (query === '700') {
            bareLookupCount += 1;
            await bareLookupGate;
        }
        const items = query === '0700.HK' || query === '700'
            ? [{symbol: query, name: 'Independent numeric lookup result', logo_url: '', source: 'remote'}]
            : [];
        await route.fulfill({contentType: 'application/json', body: JSON.stringify(items)});
    });
    await page.route('**/workspaces/compare?**', async (route) => {
        const url = new URL(route.request().url());
        if (url.searchParams.getAll('ticker').some((ticker) => ticker === '700' || ticker === '0700.HK')) {
            comparisonRequests.push(url.href);
            await route.fulfill({
                contentType: 'text/html',
                body: '<!doctype html><title>Unexpected numeric comparison submission</title>',
            });
            return;
        }
        await route.continue();
    });
    await page.goto('/workspaces/compare?ticker=QQQ&ticker=JEPQ&period=1y');
    const input = page.locator('#ticker_2');

    await input.fill('0700.HK');
    await expect(input).toHaveAttribute('data-validated-ticker', '0700.HK');
    await input.blur();
    await expect.poll(() => qualifiedLookupCount).toBe(2);
    await expect(input).toHaveAttribute('data-validation-pending', '1');

    await input.fill('700');
    await expect.poll(() => bareLookupCount).toBe(1);
    await page.exposeFunction('__recordNumericSubmit', () => {
        submitCount += 1;
    });
    await input.evaluate((element) => {
        element.form.addEventListener('submit', () => {
            void window.__recordNumericSubmit();
        });
    });

    releaseBareLookup();
    await expect(page.locator('#ticker_2_suggestions .suggestion-item[data-symbol="700"]')).toBeVisible();
    await expect(input).toHaveAttribute('data-validated-ticker', '700');
    await expect(input).toHaveAttribute('data-validated-known', '1');
    const staleResponse = page.waitForResponse((response) => (
        new URL(response.url()).pathname === '/api/symbol-search'
        && new URL(response.url()).searchParams.get('q') === '0700.HK'
    ));

    releaseQualifiedValidation();
    await (await staleResponse).finished();
    // A prior qualified identity must not use its 120 ms blur timer to commit the edited bare number.
    await page.waitForTimeout(250);

    await expect(input).toHaveValue('700');
    await expect(input).toHaveAttribute('data-symbol', '700');
    await expect(input).toHaveAttribute('data-validated-ticker', '700');
    await expect(input).toHaveAttribute('data-validated-known', '1');
    await expect(input).toHaveAttribute('data-validation-pending', '');
    await expect(input).not.toHaveClass(/is-invalid/);
    await expect(input).toHaveJSProperty('validationMessage', '');
    expect(submitCount).toBe(0);
    expect(comparisonRequests).toHaveLength(0);
    expect(bareLookupCount).toBe(1);
});


for (const {name, value, message} of [
    {name: 'duplicate', value: 'QQQ', message: 'Ticker symbol must be unique.'},
    {name: 'malformed', value: '.DYNF', message: 'Enter a valid ticker symbol.'},
]) {
    test(`continues to reject a ${name} Return comparison ticker`, async ({page}) => {
        await page.route('**/api/symbol-search?**', async (route) => {
            await route.fulfill({contentType: 'application/json', body: '[]'});
        });
        await page.goto('/workspaces/compare?ticker=QQQ&ticker=JEPQ&period=1y');
        const input = page.locator('#ticker_2');

        await input.fill(value);

        await expect(input).toHaveClass(/is-invalid/);
        await expect(input).toHaveJSProperty('validationMessage', message);
        expect(await input.evaluate((element) => element.checkValidity())).toBe(false);
    });
}


test('restores Return comparison tickers from local memory', async ({page}) => {
    const memoryKey = 'worthward:return-comparison-tickers:v1';
    await page.goto('/settings/about');
    await page.evaluate((key) => {
        window.localStorage.removeItem(key);
        window.sessionStorage.removeItem('worthward:view-memory');
    }, memoryKey);

    await page.goto('/workspaces/compare?ticker=AAPL&ticker=MSFT&period=1y');
    await expect(page.locator('#ticker_1')).toHaveValue('AAPL');
    await expect(page.locator('#ticker_2')).toHaveValue('MSFT');
    await expect.poll(() => page.evaluate((key) => window.localStorage.getItem(key), memoryKey))
        .toBe('["AAPL","MSFT"]');

    await page.evaluate(() => window.sessionStorage.removeItem('worthward:view-memory'));
    await page.goto('/settings/about');
    await page.goto('/workspaces/compare');

    await expect(page).toHaveURL(/\/workspaces\/compare\?ticker=AAPL&ticker=MSFT/);
    await expect(page.locator('#ticker_1')).toHaveValue('AAPL');
    await expect(page.locator('#ticker_2')).toHaveValue('MSFT');
});


test('exposes Return comparison title and result landmarks', async ({page}) => {
    await page.goto('/workspaces/compare?ticker=QQQ&ticker=AAPL&period=1y');

    await expect(page.getByRole('heading', {name: 'Return comparison', exact: true, level: 2})).toBeVisible();
    await expect(page.getByRole('heading', {name: 'Performance summary', exact: true, level: 2})).toBeVisible();
    await expect(page.locator('.workspace-mode-shell')).toHaveAttribute(
        'aria-labelledby',
        'return_comparison_heading',
    );
    await expect(page.locator('.workspace-mode-controls-surface')).toHaveAttribute(
        'aria-labelledby',
        'return_comparison_heading',
    );
    await expect(page.locator('.workspace-mode-main')).toHaveAttribute(
        'aria-labelledby',
        'return_performance_heading',
    );
});


test('uses date-only, collision-aware labels on a one-year Return comparison axis', async ({page}) => {
    await page.goto('/workspaces/compare?ticker=QQQI&ticker=JEPQ&period=1y');

    const axis = await page.evaluate(() => {
        const host = document.createElement('div');
        host.className = 'chart-wrap';
        host.style.width = '760px';
        host.style.height = '320px';
        const canvas = document.createElement('canvas');
        canvas.id = 'returnsChartAxisRegression';
        host.appendChild(canvas);
        document.body.appendChild(host);
        window.history.replaceState({}, '', '/workspaces/compare?ticker=QQQI&ticker=JEPQ&period=1y');

        const start = Date.UTC(2025, 8, 23);
        const rawDates = Array.from({length: 366}, (_, index) => (
            `${new Date(start + (index * 86_400_000)).toISOString().slice(0, 10)} 00:00`
        ));
        const series = ['QQQI', 'JEPQ'].map((ticker, index) => ({
            ticker,
            dates: rawDates,
            raw_dates: rawDates,
            normalized_returns: rawDates.map((_date, dateIndex) => dateIndex / 30 + index),
            color: index ? '#ff2f92' : '#0055cc',
            glow: false,
        }));
        const chart = window.WORTHWARD_BOOTSTRAP.renderReturnsChart({canvas}, {
            state: {
                currentView: 'tickers',
                chart: {series, profiles: []},
                theme: {muted: '#aaa', accent_primary: '#0055cc'},
                chartConfig: {},
            },
        });
        const plugin = chart.config._config.plugins.find((item) => item.id === 'xAxisLabelPlugin');
        const calls = [];
        plugin.afterDraw({
            canvas,
            width: chart.width,
            chartArea: chart.chartArea,
            scales: chart.scales,
            ctx: {
                save: () => {},
                restore: () => {},
                measureText: (text) => ({width: String(text).length * 7}),
                fillText(text, x) {
                    calls.push({text: String(text), x, align: this.textAlign});
                },
            },
        });
        const ticks = [...new Map(calls.map((call) => [call.x, call.align])).entries()]
            .map(([x, align]) => ({x, align}));
        return {labels: calls.map((call) => call.text), ticks};
    });

    expect(axis.labels.join(' ')).not.toMatch(/\d{2}:\d{2}/);
    expect(axis.labels).toContain('2025');
    expect(axis.labels).toContain('2026');
    expect(axis.ticks.length).toBeGreaterThanOrEqual(5);
    expect(axis.ticks.length).toBeLessThanOrEqual(12);
    expect(axis.ticks[0].align).toBe('left');
    expect(axis.ticks.at(-1).align).toBe('right');
    expect(axis.ticks.slice(1, -1).every((tick) => tick.align === 'center')).toBe(true);
});


test('keeps meaningful session times on an exact one-day Return comparison axis', async ({page}) => {
    await page.goto('/workspaces/compare?ticker=QQQI&ticker=JEPQ&period=1d&range=exact&trading_date=2026-07-17');

    const axisLabels = await page.evaluate(() => {
        const host = document.createElement('div');
        host.className = 'chart-wrap';
        host.style.width = '760px';
        host.style.height = '320px';
        const canvas = document.createElement('canvas');
        canvas.id = 'returnsChartOneDayAxisRegression';
        host.appendChild(canvas);
        document.body.appendChild(host);
        window.history.replaceState({}, '', '/workspaces/compare?ticker=QQQI&ticker=JEPQ&period=1d&range=exact&trading_date=2026-07-17');

        const rawDates = [
            '2026-07-17 09:30',
            '2026-07-17 12:00',
            '2026-07-17 14:00',
            '2026-07-17 15:59',
        ];
        const series = ['QQQI', 'JEPQ'].map((ticker, index) => ({
            ticker,
            dates: rawDates,
            raw_dates: rawDates,
            normalized_returns: rawDates.map((_date, pointIndex) => pointIndex + index),
            color: index ? '#ff2f92' : '#0055cc',
            glow: false,
        }));
        const chart = window.WORTHWARD_BOOTSTRAP.renderReturnsChart({canvas}, {
            state: {
                currentView: 'tickers',
                chart: {series, profiles: [], tradingDate: '2026-07-17'},
                theme: {muted: '#aaa', accent_primary: '#0055cc'},
                chartConfig: {},
            },
        });
        const plugin = chart.config._config.plugins.find((item) => item.id === 'xAxisLabelPlugin');
        const calls = [];
        plugin.afterDraw({
            canvas,
            width: chart.width,
            chartArea: chart.chartArea,
            scales: chart.scales,
            ctx: {
                save: () => {},
                restore: () => {},
                fillText: (text) => calls.push(String(text)),
            },
        });
        return calls;
    });

    expect(axisLabels.filter((label) => /^\d{2}:\d{2}$/.test(label)))
        .toEqual(['09:30', '12:00', '14:00', '16:00']);
    expect(axisLabels).not.toContain('00:00');
    expect(axisLabels.filter((label) => label.includes('2026'))).toHaveLength(4);
});


test('starts and stops Return comparison live refresh after same-page hydration', async ({page}) => {
    const liveRequests = [];
    let currentComparisonDate = '';
    await page.route('**/api/compare/live?*', async (route) => {
        const requestUrl = new URL(route.request().url());
        liveRequests.push(requestUrl);
        const tickers = requestUrl.searchParams.getAll('ticker');
        const period = requestUrl.searchParams.get('period') || '1d';
        const axisDate = requestUrl.searchParams.get('axis_date') || '';
        const liveDate = requestUrl.searchParams.get('live_date') || currentComparisonDate;
        const rawDates = [`${liveDate} 09:30`, `${liveDate} 09:31`];
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({
                success: true,
                period,
                axisDate,
                currentComparisonDate,
                liveDate,
                liveSessionActive: false,
                displayRange: '8 Sep 2026',
                series: tickers.map((ticker, index) => ({
                    ticker,
                    dates: rawDates,
                    raw_dates: rawDates,
                    prices: [100 + index, 101 + index],
                    normalized_returns: [0, 1],
                    candlestick_prices: [],
                    candlestick_returns: [],
                    color: index === 0 ? '#0055cc' : '#ff2f92',
                    glow: false,
                })),
                performanceItems: tickers.map((ticker, index) => ({
                    ticker,
                    ending_return: index,
                    ttm_dividend_yield: null,
                    color: index === 0 ? '#0055cc' : '#ff2f92',
                    is_winner: index === tickers.length - 1,
                    is_dividend_yield_winner: false,
                })),
                sources: Object.fromEntries(tickers.map((ticker) => [ticker, 'test'])),
                fetchedAt: `${currentComparisonDate}T00:00:00Z`,
            }),
        });
    });

    await page.goto('/workspaces/compare?ticker=QQQ&ticker=AAPL&period=1y');
    currentComparisonDate = await page.evaluate(() => window.WORTHWARD_APP?.comparisonCurrentDate || '');
    expect(currentComparisonDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await page.waitForTimeout(1_700);
    expect(liveRequests).toHaveLength(0);

    await page.locator('#period').evaluate((select) => {
        select.value = '1d';
        select.dispatchEvent(new Event('change', {bubbles: true}));
    });
    await expect(page).toHaveURL(/range=1d/, {timeout: 30_000});
    await expect(page.locator('#workspace_modal_overlay')).toBeHidden();
    await expect.poll(() => liveRequests.length, {timeout: 10_000}).toBe(1);
    expect(liveRequests[0].searchParams.get('period')).toBe('1d');
    expect(liveRequests[0].searchParams.has('live_date')).toBe(false);

    await page.evaluate(() => {
        const url = new URL(window.location.href);
        url.searchParams.set('range', '1y');
        url.searchParams.delete('period');
        window.history.replaceState({}, '', `${url.pathname}${url.search}`);
        window.WORTHWARD_BOOTSTRAP.syncCompareLiveRefresh();
    });
    const requestCountAfterStop = liveRequests.length;
    await page.waitForTimeout(1_700);
    expect(liveRequests).toHaveLength(requestCountAfterStop);
});
