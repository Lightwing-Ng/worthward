/* Code version: v1.0.0 */
import {expect, test} from '@playwright/test';
import {mockInvestmentReadApis} from '../critical_flows/support.mjs';

const cases = [
    {route: '/workspaces/backtest', selector: '#backtest_parameter_toggle', effect: 'expand'},
    {route: '/workspaces/prices', selector: '#price_compare_controls_toggle', effect: 'expand'},
    {route: '/workspaces/compare', selector: '#add_ticker', effect: 'add-input'},
    {route: '/workspaces/portfolio', selector: '#add_ticker', effect: 'add-input'},
    {route: '/settings/cash-equivalents', selector: '#add_ticker', effect: 'add-input'},
    {route: '/trade/investment?view=holdings', selector: '#toggle_form_button', effect: 'open-modal'},
];

for (const width of [390, 825]) {
    test.describe(`Isolated circular touch targets at ${width}px`, () => {
        test.use({viewport: {width, height: 844}, hasTouch: true, isMobile: width === 390});

        test('painted 32px controls have separate 44px hits and respond at the outer edge', async ({page}) => {
            await page.route('**/*', async (route) => {
                if (route.request().method() === 'GET') await route.continue();
                else await route.abort();
            });
            await mockInvestmentReadApis(page, {transactions: [], brokerSummaries: {}, brokers: ['hsbc']});

            for (const {route, selector, effect} of cases) {
                await test.step(`${route} ${selector}`, async () => {
                    await page.goto(route);
                    const noticeDismiss = page.getByRole('button', {name: 'Close notice'}).first();
                    if (await noticeDismiss.isVisible().catch(() => false)) await noticeDismiss.click();
                    if (effect === 'open-modal') {
                        const loadingOverlay = page.locator('#workspace_modal_overlay');
                        await expect(loadingOverlay).toBeVisible();
                        await expect(loadingOverlay).toBeHidden();
                    }
                    const button = page.locator(selector);
                    await expect(button).toBeVisible();
                    await button.scrollIntoViewIfNeeded();
                    const hit = await button.evaluate((element) => {
                        const box = element.getBoundingClientRect();
                        const pseudo = getComputedStyle(element, '::before');
                        const centerX = box.left + box.width / 2;
                        const centerY = box.top + box.height / 2;
                        const offsets = [[-20, 0], [20, 0], [0, -20], [0, 20]];
                        const outerHits = offsets.map(([dx, dy]) => {
                            const target = document.elementFromPoint(centerX + dx, centerY + dy);
                            return target === element || element.contains(target);
                        });
                        const sidebar = document.querySelector('#sidebar_toggle');
                        const sidebarBox = sidebar?.getBoundingClientRect();
                        const sidebarEdgeHit = sidebarBox
                            ? document.elementFromPoint(sidebarBox.left + sidebarBox.width / 2 + 20,
                                sidebarBox.top + sidebarBox.height / 2) : null;
                        return {
                            size: [box.width, box.height],
                            hitSize: [pseudo.width, pseudo.height],
                            outerHits,
                            position: getComputedStyle(element).position,
                            sidebarGap: sidebarBox ? box.left - sidebarBox.right : null,
                            sidebarEdgeOwned: sidebarEdgeHit === sidebar || sidebar?.contains(sidebarEdgeHit),
                        };
                    });
                    expect(hit.size).toEqual([32, 32]);
                    expect(hit.hitSize).toEqual(['44px', '44px']);
                    expect(hit.outerHits).toEqual([true, true, true, true]);
                    if (effect === 'expand') {
                        expect(hit.sidebarGap).toBeGreaterThanOrEqual(12);
                        expect(hit.sidebarEdgeOwned).toBe(true);
                    }
                    if (effect === 'open-modal') expect(hit.position).toBe('relative');

                    const beforeInputs = effect === 'add-input' ? await page.locator('input').count() : null;
                    const box = await button.boundingBox();
                    await page.touchscreen.tap(box.x + box.width / 2 + 20, box.y + box.height / 2);
                    if (effect === 'expand') await expect(button).toHaveAttribute('aria-expanded', 'true');
                    if (effect === 'add-input') await expect.poll(() => page.locator('input').count()).toBeGreaterThan(beforeInputs);
                    if (effect === 'open-modal') await expect(page.locator('#investment_form')).toBeVisible();
                });
            }
        });
    });
}

for (const width of [390, 1_006]) {
    test.describe(`PIN gate dismissal at ${width}px`, () => {
        test.use({viewport: {width, height: 844}, hasTouch: width === 390, isMobile: width === 390});

        test('the close link owns its visual center above the title row', async ({page}) => {
            await page.goto('/trade/live-trading');
            const close = page.getByRole('link', {name: 'Back to investment'});
            if (width !== 390) await page.locator('.live-trading-pin-dialog').hover();
            await expect(close).toBeVisible();
            const hit = await close.evaluate((element) => {
                const box = element.getBoundingClientRect();
                const target = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
                return target === element || element.contains(target);
            });
            expect(hit).toBe(true);
            await close.click();
            await expect(page).toHaveURL(/\/trade\/investment/);
        });
    });
}

for (const width of [390, 1_006]) {
    test.describe(`Settings sidebar scroll hits at ${width}px`, () => {
        test.use({viewport: {width, height: 600}, hasTouch: true, isMobile: width === 390});

        test('the final navigation row scrolls clear of the fixed Dock', async ({page}) => {
            await page.goto('/settings/style-tokens');
            const toggle = page.locator('#sidebar_toggle');
            if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
            await expect(toggle).toHaveAttribute('aria-expanded', 'true');
            await page.waitForTimeout(500);

            const initial = await page.locator('.settings-nav').evaluate((nav) => ({
                scrollHeight: nav.scrollHeight,
                clientHeight: nav.clientHeight,
            }));
            expect(initial.scrollHeight).toBeGreaterThan(initial.clientHeight);
            await page.locator('.settings-nav').evaluate((nav) => { nav.scrollTop = nav.scrollHeight; });
            const lastLink = page.locator('a.settings-nav-item-style-tokens');
            const result = await lastLink.evaluate((element) => {
                const box = element.getBoundingClientRect();
                const dockTop = document.querySelector('.sidebar-dock').getBoundingClientRect().top;
                const target = document.elementFromPoint(box.left + box.width / 2,
                    box.top + box.height / 2);
                return {clearance: dockTop - box.bottom, owned: target === element || element.contains(target)};
            });
            expect(result.clearance).toBeGreaterThanOrEqual(0);
            expect(result.owned).toBe(true);
            await lastLink.evaluate((element) => {
                element.addEventListener('click', (event) => {
                    event.preventDefault();
                    element.dataset.hitAreaTap = 'true';
                }, {once: true});
            });
            const box = await lastLink.boundingBox();
            await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
            await expect(lastLink).toHaveAttribute('data-hit-area-tap', 'true');
        });
    });
}

for (const width of [390, 767, 825, 1_006, 1_056, 1_057, 1_080, 1_081, 1_280]) {
    test.describe(`Narrow notice and global action hits at ${width}px`, () => {
        test.use({viewport: {width, height: 844}, hasTouch: true, isMobile: width === 390});

        test('a visible nonmodal notice leaves the global control rail touchable', async ({page}) => {
            await page.goto('/workspaces/backtest');
            const notice = page.locator('.notice-floating-banner-global').first();
            await expect(notice).toBeVisible();
            const geometry = await page.evaluate(() => {
                const noticeBox = document.querySelector('.notice-floating-banner-global').getBoundingClientRect();
                const controls = ['#sidebar_toggle', '#global_theme_toggle'];
                const hits = controls.map((selector) => {
                    const control = document.querySelector(selector);
                    const box = control.getBoundingClientRect();
                    const centerX = box.left + box.width / 2;
                    const centerY = box.top + box.height / 2;
                    return [
                        document.elementFromPoint(centerX, centerY),
                        document.elementFromPoint(centerX + 20, centerY),
                    ].every((target) => target === control || control.contains(target));
                });
                return {noticeTop: noticeBox.top, hits};
            });
            if (width <= 1_080) expect(geometry.noticeTop).toBeGreaterThanOrEqual(58);
            expect(geometry.hits).toEqual([true, true]);
            const sidebar = page.locator('#sidebar_toggle');
            const before = await sidebar.getAttribute('aria-expanded');
            let box = await sidebar.boundingBox();
            await page.touchscreen.tap(box.x + box.width / 2 + 20, box.y + box.height / 2);
            await expect(sidebar).toHaveAttribute('aria-expanded', before === 'true' ? 'false' : 'true');
            await page.waitForTimeout(500);
            const secondHit = await sidebar.evaluate((element) => {
                const rect = element.getBoundingClientRect();
                const target = document.elementFromPoint(rect.left + rect.width / 2 + 20,
                    rect.top + rect.height / 2);
                return target === element || element.contains(target);
            });
            expect(secondHit).toBe(true);
            box = await sidebar.boundingBox();
            await page.touchscreen.tap(box.x + box.width / 2 + 20, box.y + box.height / 2);
            await expect(sidebar).toHaveAttribute('aria-expanded', before);
            await expect(notice).toBeVisible();
        });
    });
}
