/* Code version: v1.0.0 */
import {expect, test} from '@playwright/test';

for (const width of [1138, 800, 390]) {
    test(`Settings annotation ownership and geometry at ${width}px`, async ({page}) => {
        await page.setViewportSize({width, height: 959});
        await page.goto('/settings/style-tokens');
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
