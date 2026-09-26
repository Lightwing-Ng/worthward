/* Code version: v1.3.3 */
import {expect, test} from '@playwright/test';

for (const width of [1138, 800, 390]) {
    test(`Settings annotation ownership and geometry at ${width}px`, async ({page}) => {
        await page.setViewportSize({width, height: 959});
        await page.emulateMedia({colorScheme: 'light'});
        await page.goto('/settings/style-tokens');
        if (width <= 900) {
            const shell = page.locator('.app-shell');
            await expect(shell).toHaveClass(/is-sidebar-(?:open|collapsed)/);
            if (await shell.evaluate(element => element.classList.contains('is-sidebar-collapsed'))) {
                await page.locator('#sidebar_toggle').click();
            }
            await expect(shell).toHaveClass(/is-sidebar-open/);
        }
        const sidebarShell = page.locator('[data-layout-role="sidebar-shell"]');
        await expect(sidebarShell).toHaveCount(1);
        const sidebarMaterial = await sidebarShell.evaluate(element => {
            const style = getComputedStyle(element);
            return {
                width: element.getBoundingClientRect().width,
                padding: style.padding,
                backgroundColor: style.backgroundColor,
                backgroundImage: style.backgroundImage,
                borderRadius: style.borderRadius,
                borderTopWidth: style.borderTopWidth,
                boxShadow: style.boxShadow,
                backdropFilter: style.backdropFilter || style.webkitBackdropFilter,
            };
        });
        expect(sidebarMaterial.width).toBeLessThanOrEqual(312);
        expect(sidebarMaterial.width).toBe(width === 390 ? 252 : 312);
        expect(sidebarMaterial.padding).toBe(width > 900 ? '9px 10px 0px' : '9px 18px 0px');
        expect(sidebarMaterial.backgroundColor).toBe('rgba(255, 255, 255, 0.08)');
        expect(sidebarMaterial.backgroundImage).toContain('rgba(255, 255, 255, 0.24)');
        expect(sidebarMaterial.borderRadius).toBe('10px');
        expect(sidebarMaterial.borderTopWidth).toBe('1px');
        expect(sidebarMaterial.boxShadow).toContain('rgba(10, 14, 25, 0.12)');
        expect(sidebarMaterial.backdropFilter).toContain('blur(18px)');
        if (width <= 900) {
            await page.locator('#sidebar_toggle').click();
            await expect(page.locator('.app-shell')).toHaveClass(/is-sidebar-collapsed/);
        }
        const primary = page.locator('#primary-button .style-token-demo > button');
        const packaged = page.locator('#settings-action-package .settings-action-package-form > button');
        for (const button of [primary, packaged]) {
            expect(await button.evaluate(e => e.getBoundingClientRect().width < e.closest('.style-token-demo').getBoundingClientRect().width)).toBe(true);
        }
        for (const property of ['padding', 'background', 'border-radius', 'font-weight']) {
            expect(await primary.evaluate((e, p) => getComputedStyle(e).getPropertyValue(p), property))
                .toBe(await packaged.evaluate((e, p) => getComputedStyle(e).getPropertyValue(p), property));
        }
        const ticker = page.locator('#ticker-input-control [data-ticker-input]');
        await expect(ticker).toHaveCSS('font-size', '15px');
        expect(await ticker.evaluate(e => Math.abs(e.getBoundingClientRect().left - e.closest('.style-token-demo').getBoundingClientRect().left))).toBeLessThanOrEqual(1);
        const toggle = page.locator('#style_token_switch_demo');
        for (const checked of [true, false]) {
            await toggle.setChecked(checked);
            await expect(toggle).toBeChecked({checked});
            const motion = await toggle.evaluate(e => {
                const slider = e.parentElement.querySelector('.ios-switch-slider');
                const c = getComputedStyle(slider, '::after');
                const root = getComputedStyle(document.documentElement);
                return {duration: c.transitionDuration, easing: c.transitionTimingFunction, shared: root.getPropertyValue('--motion-bouncy').trim()};
            });
            expect(motion.duration).toContain('0.56s');
            expect(motion.easing).toContain(motion.shared);
        }
        for (const theme of ['light', 'dark']) {
            await page.emulateMedia({colorScheme: theme});
            await expect.poll(() => page.evaluate(() => {
                const option = document.querySelector('#settings-execution-option .settings-general-option');
                const tooltip = document.querySelector('#tooltip .chart-tooltip');
                const c = getComputedStyle(option);
                const t = getComputedStyle(tooltip);
                // Resolve token aliases through a detached same-document style probe.
                const probe = document.createElement('div');
                probe.style.background = 'var(--settings-general-option-background)';
                document.body.append(probe);
                const normal = getComputedStyle(probe).background;
                probe.style.background = 'var(--frosted-glass-background)';
                const glass = getComputedStyle(probe).background;
                probe.remove();
                return {neutral: c.background === normal, glass: t.background === glass};
            })).toEqual({neutral: true, glass: true});
        }
        await page.emulateMedia({reducedMotion: 'reduce'});
        expect(await toggle.evaluate(e => getComputedStyle(e.parentElement.querySelector('.ios-switch-slider'), '::after').transitionDuration)).toMatch(/^(0s|0.001s)(, (0s|0.001s))*$/);
        await page.goto('/settings/about');
        await expect(page.locator('.settings-nav-label').nth(0)).toHaveText('About');
        await expect(page.locator('.settings-nav-label').nth(1)).toHaveText('General');
        await expect(page.locator('.about-disclaimer-list > li')).toHaveCount(6);
        const about = await page.evaluate(() => {
            const shell = document.querySelector('#settings_workspace_shell').getBoundingClientRect();
            const scroll = document.querySelector('.settings-content-scrollport').getBoundingClientRect();
            const sidebar = document.querySelector('#app_sidebar').getBoundingClientRect();
            return {shell: shell.left, scroll: scroll.left, sidebar: sidebar.right, overflow: document.documentElement.scrollWidth > innerWidth};
        });
        expect(about.scroll).toBeGreaterThanOrEqual(about.shell - 1);
        if (width > 900) expect(about.scroll).toBeGreaterThan(about.sidebar);
        expect(about.overflow).toBe(false);
        await page.goto('/settings/cash-equivalents');
        expect(await page.locator('#add_ticker').evaluate(e => Math.abs(e.getBoundingClientRect().right - e.closest('.cash-equivalent-category').getBoundingClientRect().right))).toBeLessThanOrEqual(1);
        await page.goto('/settings/color-tokens');
        const reset = page.locator('[data-color-token-reset-all]');
        await expect(reset).toHaveClass(/settings-inline-button-danger/);
        expect(await reset.evaluate(e => e.closest('.settings-action-package') === document.querySelector('.settings-color-token-content').lastElementChild)).toBe(true);
        await page.goto('/settings/local-market-store');
        await expect(page.locator('#local_store_region')).toHaveCSS('overflow', 'visible');
        await expect(page.locator('#local_store_table_scroll')).toHaveCSS('overflow-y', 'auto');
        const pagination = page.locator('.local-store-table-pagination');
        await expect(pagination).toHaveCount(1);
        expect(await pagination.evaluate(e => !e.closest('#local_store_table_scroll'))).toBe(true);
        await page.goto('/settings/strategies');
        await expect(page.locator('.settings-strategy-summary').first()).toHaveCSS('padding', '6px 4px');
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });
}

test('Local market store preserves effect clearance and rounded scroll ownership at the annotated viewport', async ({page}) => {
    await page.setViewportSize({width: 830, height: 1_171});
    await page.emulateMedia({colorScheme: 'light'});
    await page.goto('/settings/local-market-store');

    const geometry = await page.evaluate(() => {
        const shell = document.querySelector('#settings_workspace_shell');
        const scrollport = shell.querySelector(':scope > .settings-content-scrollport');
        const card = scrollport.querySelector('.local-store-maintain-card');
        const tableShell = scrollport.querySelector('.local-store-table-shell');
        const tableScroll = tableShell.querySelector('#local_store_table_scroll');
        const shellBounds = shell.getBoundingClientRect();
        const scrollportBounds = scrollport.getBoundingClientRect();
        const cardBounds = card.getBoundingClientRect();
        const rootStyle = getComputedStyle(document.documentElement);
        const scrollportStyle = getComputedStyle(scrollport);
        const cardStyle = getComputedStyle(card);
        const tableShellStyle = getComputedStyle(tableShell);
        const tableScrollStyle = getComputedStyle(tableScroll);
        return {
            bleed: parseFloat(rootStyle.getPropertyValue('--layout-physical-effect-bleed')),
            leftClearance: cardBounds.left - scrollportBounds.left,
            topClearance: cardBounds.top - scrollportBounds.top,
            scrollportKeepsEndEdge: Math.abs(scrollportBounds.right - shellBounds.right),
            scrollportOverflowX: scrollportStyle.overflowX,
            scrollportOverflowY: scrollportStyle.overflowY,
            cardShadow: cardStyle.boxShadow,
            tableShellOverflow: tableShellStyle.overflow,
            tableShellRadius: tableShellStyle.borderRadius,
            tableScrollRadius: tableScrollStyle.borderRadius,
            documentOverflow: document.documentElement.scrollWidth
                - document.documentElement.clientWidth,
        };
    });

    expect(geometry.bleed).toBe(48);
    expect(geometry.leftClearance).toBeCloseTo(geometry.bleed, 1);
    expect(geometry.topClearance).toBeCloseTo(geometry.bleed, 1);
    expect(geometry.scrollportKeepsEndEdge).toBeLessThanOrEqual(1);
    expect(geometry.scrollportOverflowX).toBe('hidden');
    expect(geometry.scrollportOverflowY).toBe('auto');
    expect(geometry.cardShadow).not.toBe('none');
    expect(geometry.tableShellOverflow).toBe('visible');
    expect(geometry.tableShellRadius).toBe('10px');
    expect(geometry.tableScrollRadius).toBe('10px');
    expect(geometry.documentOverflow).toBeLessThanOrEqual(1);
});

for (const width of [830, 390]) {
    test(`Process List catalog keeps its four-step track at ${width}px`, async ({page}) => {
        await page.setViewportSize({width, height: 1_171});
        await page.goto('/settings/style-tokens');
        const list = page.locator('#process-list .process-list');
        await expect(list.locator(':scope > li')).toHaveCount(4);
        const marker = list.locator('.process-list-marker').first();
        for (const theme of ['light', 'dark']) {
            await page.locator('html').evaluate((root, mode) => {
                root.setAttribute('data-theme-override', mode);
            }, theme);
            await expect(marker).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
            await expect(marker).toHaveCSS('box-shadow', 'none');
        }
        const state = await list.evaluate((element) => {
            const steps = [...element.children];
            const markers = steps.map((step) => step.querySelector('.process-list-marker').getBoundingClientRect());
            const headings = steps.map((step) => step.querySelector('.process-list-heading').getBoundingClientRect());
            return {
                markerSizes: markers.map((rect) => [rect.width, rect.height]),
                headingCenterDeltas: headings.map((rect, index) => Math.abs(rect.top + rect.height / 2 - markers[index].top - markers[index].height / 2)),
                connectorCount: steps.filter((step) => getComputedStyle(step, '::before').content !== 'none').length,
                markerColor: getComputedStyle(steps[0].querySelector('.process-list-marker')).color,
                connectorColor: getComputedStyle(steps[0], '::before').backgroundColor,
                documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            };
        });
        expect(state.markerSizes).toEqual(Array(4).fill([32, 32]));
        expect(state.headingCenterDeltas.every((delta) => delta <= 1)).toBe(true);
        expect(state.connectorCount).toBe(3);
        expect(state.markerColor).toBe(state.connectorColor);
        expect(state.documentOverflow).toBeLessThanOrEqual(1);
    });
}

test('Settings sidebar effects escape the centered page at ultrawide width', async ({page}) => {
    await page.setViewportSize({width: 1_920, height: 960});
    await page.goto('/settings/style-tokens');

    const geometry = await page.evaluate(() => {
        const pageShell = document.querySelector('.page');
        const appShell = document.querySelector('.app-shell');
        const sidebar = document.querySelector('#app_sidebar');
        const pageBounds = pageShell.getBoundingClientRect();
        const sidebarBounds = sidebar.getBoundingClientRect();
        const clippingAncestors = [];
        for (let node = sidebar.parentElement; node; node = node.parentElement) {
            const style = getComputedStyle(node);
            if (style.overflowX !== 'visible' || style.overflowY !== 'visible') {
                clippingAncestors.push({
                    selector: node.id || node.className || node.tagName,
                    x: style.overflowX,
                    y: style.overflowY,
                });
            }
        }
        return {
            pageLeft: pageBounds.left,
            sidebarLeft: sidebarBounds.left,
            pageOverflow: getComputedStyle(pageShell).overflow,
            appShellOverflow: getComputedStyle(appShell).overflow,
            clippingAncestors,
            documentOverflow: document.documentElement.scrollWidth
                - document.documentElement.clientWidth,
        };
    });

    expect(geometry.pageLeft).toBeGreaterThanOrEqual(179);
    expect(geometry.sidebarLeft).toBeGreaterThanOrEqual(geometry.pageLeft);
    expect(geometry.pageOverflow).toBe('visible');
    expect(geometry.appShellOverflow).toBe('visible');
    expect(geometry.clippingAncestors.some(({selector}) => selector === 'page')).toBe(false);
    expect(geometry.clippingAncestors[0].selector).toBe('BODY');
    expect(geometry.documentOverflow).toBeLessThanOrEqual(1);
});

test('Network uses the standard action assembly and expandable readable transport details', async ({page}) => {
    await page.route('**/api/settings/network-status*', route => route.fulfill({json: {rows: [], transport_note: 'Verified TLS; no account credentials sent.'}}));
    await page.goto('/settings/network');
    const action = page.locator('.settings-shell-network > .settings-content-scrollport > .settings-action-package');
    await expect(action.locator('.settings-service-note')).toHaveCount(1);
    await expect(action.locator('[data-network-refresh-button]')).toBeVisible();
    await expect(page.locator('[data-network-transport]')).toBeHidden();
    await page.locator('[data-collapse="settings-network-details"] > summary').click();
    await expect(page.locator('[data-network-transport]')).toBeVisible();
    await expect(page.locator('[data-network-transport]')).toHaveCSS('font-size', await action.locator('.settings-service-note').evaluate(e => getComputedStyle(e).fontSize));
});
