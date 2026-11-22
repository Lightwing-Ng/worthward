/* Code version: v1.0.18 */
import {expect, test} from '@playwright/test';

const workspaceRoutes = [
    '/workspaces/prices',
    '/workspaces/prices?metric=market-cap',
    '/workspaces/compare',
    '/workspaces/portfolio',
    '/workspaces/backtest',
    '/trade/investment',
    '/trade/live-trading',
    ...[
        'about', 'general', 'backtest', 'broker-access', 'cash-equivalents',
        'clear-caches', 'email-smtp', 'export-image', 'font-tokens',
        'color-tokens', 'investment', 'local-market-store', 'material-tokens',
        'network', 'strategies', 'style-tokens',
    ].map(section => `/settings/${section}`),
    ...[
        'regime-radar', 'analog-explorer', 'stress-lab', 'robustness-lab',
        'path-remix', 'recovery-clock', 'calibration-lab', 'buy-analysis',
        'thesis-lab', 'research-frontier',
    ].map(experiment => `/beta/${experiment}`),
];

test.use({reducedMotion: 'reduce'});

test('every workspace route keeps a twelve-track content owner across shell states', async ({page}) => {
    test.setTimeout(480_000);
    const unlock = await page.context().request.post('/trade/live-trading/unlock', {
        form: {pin: process.env.WORTHWARD_LIVE_TRADING_PIN || '123456'},
    });
    expect(unlock.status()).toBe(200);

    for (const route of workspaceRoutes) {
        await page.goto(route, {waitUntil: 'domcontentloaded', timeout: 90_000});
        const grid = page.locator('[data-layout-role="content-grid"]').first();
        await expect(grid, route).toHaveCount(1);

        for (const width of [1280, 820, 390]) {
            await page.setViewportSize({width, height: 900});
            for (const expanded of [true, false]) {
                const toggle = page.locator('#sidebar_toggle');
                if (await toggle.getAttribute('aria-expanded') !== String(expanded)) {
                    await toggle.focus();
                    await toggle.press('Enter', {timeout: 3000});
                }
                await expect(toggle).toHaveAttribute('aria-expanded', String(expanded));
                const geometry = await grid.evaluate(element => {
                    const style = getComputedStyle(element);
                    const tracks = style.gridTemplateColumns.split(/\s+/).filter(Boolean);
                    const rect = element.getBoundingClientRect();
                    const scrollport = element.closest('[data-layout-role="content-scrollport"]');
                    return {
                        display: style.display,
                        tracks: tracks.length,
                        gutter: style.columnGap,
                        rowGap: style.rowGap,
                        width: rect.width,
                        overflow: document.documentElement.scrollWidth - innerWidth,
                        scrollportOverflow: scrollport ? getComputedStyle(scrollport).overflowY : null,
                    };
                });
                expect(geometry.display, `${route} ${width}px`).toBe('grid');
                expect(geometry.tracks, `${route} ${width}px`).toBe(12);
                expect(geometry.gutter, `${route} ${width}px`).toBe('12px');
                expect(geometry.rowGap, `${route} ${width}px`).toBe('12px');
                expect(geometry.width, `${route} ${width}px`).toBeGreaterThan(0);
                expect(geometry.overflow, `${route} ${width}px`).toBeLessThanOrEqual(1);
                if (geometry.scrollportOverflow !== null) {
                    expect(geometry.scrollportOverflow, `${route} ${width}px`).toBe('auto');
                }
            }
        }
    }
});

test('metric cards use whole-track spans from their own available width', async ({page}) => {
    await page.goto('/settings/style-tokens');
    const grid = page.locator('.style-token-list[data-layout-role="content-grid"]');
    await expect(grid).toBeVisible();
    await expect(grid.locator(':scope > .style-token-card').first()).toHaveCSS('grid-column-end', '-1');

    await page.goto('/beta/regime-radar');
    const betaGrid = page.locator('.beta-content-grid[data-layout-role="content-grid"]');
    await page.setViewportSize({width: 1280, height: 900});
    const wide = await betaGrid.locator(':scope > .beta-intro, :scope > .beta-guide').evaluateAll(elements =>
        elements.map(element => getComputedStyle(element).gridColumnStart));
    expect(wide).toEqual(['span 4', 'span 8']);
    await page.setViewportSize({width: 390, height: 900});
    const compact = await betaGrid.locator(':scope > .beta-intro, :scope > .beta-guide').evaluateAll(elements =>
        elements.map(element => getComputedStyle(element).gridColumnStart));
    expect(compact).toEqual(['1', '1']);
});

test('title rail aligns with the content grid in wide and compact shells', async ({page}) => {
    const samples = [];
    for (const route of ['/workspaces/prices', '/trade/investment', '/settings/about', '/beta/regime-radar']) {
        await page.goto(route, {waitUntil: 'load'});
        for (const width of [1280, 820, 390]) {
            await page.setViewportSize({width, height: 900});
            for (const expanded of [true, false]) {
                const toggle = page.locator('#sidebar_toggle');
                if (await toggle.getAttribute('aria-expanded') !== String(expanded)) {
                    await toggle.focus();
                    await toggle.press('Enter', {timeout: 3000});
                }
                const geometry = await page.evaluate(() => {
                    const grid = document.querySelector('[data-layout-role="content-grid"]');
                    const title = document.querySelector('[data-layout-role="result-title-rail"]') ||
                        document.querySelector('[data-layout-role="title-rail"]');
                    const first = grid?.firstElementChild;
                    const heading = title?.querySelector('[data-layout-role="result-heading"], [data-layout-role="title-heading"]');
                    const scrollport = grid?.closest('[data-layout-role="content-scrollport"]');
                    const scrollStyle = scrollport ? getComputedStyle(scrollport) : null;
                    return {grid: grid?.getBoundingClientRect().left,
                        first: first?.getBoundingClientRect().left,
                        title: title?.getBoundingClientRect().left,
                        heading: heading?.getBoundingClientRect().left,
                        scrollport: scrollport?.getBoundingClientRect().left,
                        scrollportPadding: scrollStyle?.paddingLeft,
                        scrollportBorder: scrollStyle?.borderLeftWidth,
                        scrollportMargin: scrollStyle?.marginLeft};
                });
                expect(Math.abs(geometry.grid - geometry.title), `${route} ${width}px ${expanded}`).toBeLessThanOrEqual(1);
                expect(Math.abs(geometry.first - geometry.grid), `${route} ${width}px ${expanded}`).toBeLessThanOrEqual(1);
                samples.push({route, width, expanded, geometry});
            }
        }
    }
    console.log(`GRID_ALIGNMENT ${JSON.stringify(samples)}`);
});

test('visible rounded suggestion menu computes the continuous corner shape', async ({page}) => {
    await page.emulateMedia({colorScheme: 'light'});
    await page.route('**/api/symbol-search**', route => route.fulfill({
        json: [{source: 'local', symbol: 'QQQ', name: 'Inert symbol fixture', logo_url: ''}],
    }));
    await page.goto('/workspaces/compare');
    await page.locator('#ticker_1').fill('QQQ');
    const suggestions = page.locator('#ticker_1_suggestions');
    await expect(suggestions).toBeVisible();
    const shape = await suggestions.evaluate(element => getComputedStyle(element).cornerShape);
    expect(['squircle', 'superellipse(2)']).toContain(shape);
});

test('open shared dropdown computes continuous corners', async ({page}) => {
    await page.emulateMedia({colorScheme: 'light'});
    await page.goto('/workspaces/backtest');
    await page.locator('#period_panel .backtest-shared-select-trigger').click();
    const menu = page.locator('#period_panel .trade-strategy-dropdown');
    await expect(menu).toBeVisible();
    const state = await menu.evaluate(element => {
        const style = getComputedStyle(element);
        return {radius: style.borderRadius, shape: style.cornerShape};
    });
    expect(state.radius).not.toBe('0px');
    expect(['squircle', 'superellipse(2)']).toContain(state.shape);
});

test('light locked workspace modal keeps continuous corners', async ({page}) => {
    await page.emulateMedia({colorScheme: 'light'});
    await page.goto('/trade/live-trading');
    const dialog = page.locator('.live-trading-pin-dialog');
    await expect(dialog).toBeVisible();
    const state = await dialog.evaluate(element => {
        const style = getComputedStyle(element);
        return {radius: style.borderRadius, shape: style.cornerShape};
    });
    expect(state.radius).not.toBe('0px');
    expect(['squircle', 'superellipse(2)']).toContain(state.shape);
});

test('dark navigation skeleton control keeps continuous painted corners', async ({page}) => {
    const response = await page.request.get('/settings/email-smtp');
    expect(response.ok()).toBe(true);
    const markup = await response.text();
    await page.route('**/settings/email-smtp', async route => {
        await new Promise(resolve => setTimeout(resolve, 700));
        await route.fulfill({body: markup, contentType: 'text/html; charset=utf-8'});
    });
    await page.goto('/settings/clear-caches');
    await page.locator('html').evaluate(root => root.setAttribute('data-theme-override', 'dark'));
    await page.locator('.settings-nav-item-email').click();
    const control = page.locator('.navigation-skeleton-line.navigation-skeleton-control').first();
    await expect(control).toBeVisible();
    const state = await control.evaluate(element => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return {radius: style.borderRadius, shape: style.cornerShape,
            width: rect.width, height: rect.height};
    });
    expect(state.width).toBeGreaterThan(state.height * 2);
    expect(state.radius).toBe('10px');
    expect(['squircle', 'superellipse(2)']).toContain(state.shape);
});

test('pending result pseudo surface keeps continuous corners', async ({page}) => {
    await page.goto('/workspaces/portfolio');
    const value = page.locator('#portfolio_total_return');
    await value.evaluate(element => element.classList.add('is-pending-value'));
    const state = await value.evaluate(element => {
        const pseudo = getComputedStyle(element, '::after');
        return {content: pseudo.content, radius: pseudo.borderRadius,
            background: pseudo.backgroundColor, shape: pseudo.cornerShape};
    });
    expect(state.content).not.toBe('none');
    expect(state.radius).not.toBe('0px');
    expect(state.background).not.toBe('rgba(0, 0, 0, 0)');
    expect(['squircle', 'superellipse(2)']).toContain(state.shape);
});

test('audit painted rounded rectangles across workspace routes', async ({page}) => {
    test.setTimeout(240_000);
    const unresolved = [];
    let paintedRectangles = 0;
    let paintedPseudoRectangles = 0;
    await page.context().request.post('/trade/live-trading/unlock', {
        form: {pin: process.env.WORTHWARD_LIVE_TRADING_PIN || '123456'},
    });
    for (const route of workspaceRoutes.filter(path => !path.includes('metric=market-cap'))) {
        await page.goto(route, {waitUntil: 'domcontentloaded', timeout: 90_000});
        await page.locator('html').evaluate(root => root.setAttribute('data-theme-override', 'dark'));
        if (['/workspaces/compare', '/workspaces/portfolio', '/workspaces/backtest',
            '/trade/investment', '/settings/local-market-store'].includes(route)) {
            await page.evaluate(() => {
                document.querySelectorAll('[data-workspace-mask]').forEach(element =>
                    element.classList.add('is-pending-value'));
            });
        }
        const audit = await page.evaluate(() => {
            const present = value => value && value !== 'none' && value !== 'normal';
            const painted = style =>
                (style.backgroundColor !== 'rgba(0, 0, 0, 0)' && style.backgroundColor !== 'transparent') ||
                present(style.backgroundImage) || present(style.boxShadow) ||
                present(style.backdropFilter) ||
                (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0 &&
                    style.outlineColor !== 'rgba(0, 0, 0, 0)') ||
                ['hidden', 'clip'].includes(style.overflowX) ||
                ['hidden', 'clip'].includes(style.overflowY) ||
                ['Top', 'Right', 'Bottom', 'Left'].some(side =>
                    parseFloat(style[`border${side}Width`]) > 0 &&
                    style[`border${side}Style`] !== 'none' &&
                    style[`border${side}Color`] !== 'rgba(0, 0, 0, 0)');
            const id = element => `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}${[...element.classList].slice(0, 3).map(name => `.${name}`).join('')}`;
            const findings = [];
            let rectangles = 0;
            let pseudoRectangles = 0;
            for (const element of document.querySelectorAll('*')) {
                const rect = element.getBoundingClientRect();
                if (rect.width < 8 || rect.height < 8) continue;
                for (const pseudo of [null, '::before', '::after']) {
                    const style = getComputedStyle(element, pseudo);
                    if (pseudo && ['none', 'normal', ''].includes(style.content)) continue;
                    if (style.display === 'none' || style.visibility !== 'visible' || style.opacity === '0') continue;
                    const radii = [style.borderTopLeftRadius, style.borderTopRightRadius,
                        style.borderBottomRightRadius, style.borderBottomLeftRadius];
                    if (!radii.some(radius => radius && radius !== '0px')) continue;
                    const size = pseudo && parseFloat(style.width) >= 8 && parseFloat(style.height) >= 8
                        ? {width: parseFloat(style.width), height: parseFloat(style.height)}
                        : rect;
                    const minSize = Math.min(size.width, size.height);
                    const isRectangle = radii.some(radius => {
                        const px = parseFloat(radius);
                        return Number.isFinite(px) && px > 0 &&
                            (radius.includes('%') ? px < 50 : px * 2 < minSize - 1);
                    });
                    if (!isRectangle) continue;
                    if (!painted(style)) continue;
                    rectangles += 1;
                    if (pseudo) pseudoRectangles += 1;
                    if (['squircle', 'superellipse(2)'].includes(style.cornerShape)) continue;
                    findings.push({element: id(element) + (pseudo || ''), radii, shape: style.cornerShape, size: `${Math.round(size.width)}x${Math.round(size.height)}`});
                }
            }
            return {rectangles, pseudoRectangles,
                findings: [...new Map(findings.map(item => [`${item.element}|${item.radii.join(',')}`, item])).values()].slice(0, 80)};
        });
        paintedRectangles += audit.rectangles;
        paintedPseudoRectangles += audit.pseudoRectangles;
        if (audit.findings.length) unresolved.push({route, shapes: audit.findings});
    }
    console.log(`G2_AUDIT ${JSON.stringify({routes: workspaceRoutes.length - 1, paintedRectangles,
        paintedPseudoRectangles, unresolved})}`);
    expect(paintedRectangles).toBeGreaterThan(0);
    expect(paintedPseudoRectangles).toBeGreaterThan(0);
    expect(unresolved).toEqual([]);
});
