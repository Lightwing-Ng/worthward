/* Code version: v1.1.4 */
import {expect, test} from '@playwright/test';

for (const width of [1024, 390]) {
    for (const colorScheme of ['light', 'dark']) {
        test(`Settings surfaces stay bounded at ${width}px in ${colorScheme}`, async ({page}) => {
            await page.setViewportSize({width, height: 1232});
            await page.emulateMedia({colorScheme, reducedMotion: 'reduce'});
            await page.goto('/settings/general?page=41');
            const pagination = page.locator('.settings-language-panel.is-active .settings-language-pagination');
            await expect(pagination).toBeVisible();
            const material = await pagination.evaluate(el => {
                const probe = document.createElement('div');
                probe.style.background = 'var(--frosted-glass-background)';
                probe.style.backdropFilter = 'var(--frosted-glass-blur)';
                document.body.append(probe);
                const actual = getComputedStyle(el), expected = getComputedStyle(probe);
                const result = {background: actual.background === expected.background,
                    blur: actual.backdropFilter === expected.backdropFilter,
                    radius: actual.borderRadius, width: el.getBoundingClientRect().width,
                    available: el.parentElement.getBoundingClientRect().width};
                probe.remove();
                return result;
            });
            expect(material.background).toBe(true);
            expect(material.blur).toBe(true);
            expect(material.radius).toBe('999px');
            expect(material.width).toBeLessThanOrEqual(material.available + 1);
            const saveAlignment = await page.evaluate(() => {
                const form = document.querySelector('[data-settings-language-form]');
                const button = document.querySelector('[data-language-save-button]');
                const formBounds = form.getBoundingClientRect();
                const buttonBounds = button.getBoundingClientRect();
                return {
                    rightDelta: Math.abs(formBounds.right - buttonBounds.right),
                    actionClasses: button.parentElement.className,
                };
            });
            expect(saveAlignment.rightDelta).toBeLessThanOrEqual(1);
            expect(saveAlignment.actionClasses).toContain('settings-form-actions');

            await page.goto('/settings/style-tokens');
            const rangeThumbMaterial = await page.getByRole('slider', {name: 'QQQ minimum', exact: true}).evaluate((input) => {
                // Chromium reports the range input's style for its native thumb pseudo-element.
                const findThumbRule = (rules) => {
                    for (const rule of rules) {
                        if (rule.selectorText === '.strategy-allocation-handle::-webkit-slider-thumb') return rule;
                        const childRules = rule.styleSheet?.cssRules || rule.cssRules;
                        const nested = childRules && findThumbRule(childRules);
                        if (nested) return nested;
                    }
                    return null;
                };
                const thumbRule = Array.from(document.styleSheets)
                    .map((sheet) => findThumbRule(sheet.cssRules)).find(Boolean);
                if (!thumbRule) throw new Error('Allocation thumb rule is missing');
                const probe = document.createElement('span');
                probe.style.cssText = thumbRule.style.cssText;
                probe.style.position = 'absolute';
                probe.style.pointerEvents = 'none';
                probe.style.setProperty('--strategy-range-thumb-background',
                    getComputedStyle(input).getPropertyValue('--strategy-range-thumb-background'));
                input.parentElement.append(probe);
                const material = getComputedStyle(probe);
                const shared = getComputedStyle(document.querySelector('[data-style-token-resizer]'), '::after');
                const result = {
                    backgroundMatches: material.background === shared.background,
                    shadowMatches: material.boxShadow === shared.boxShadow,
                    blurMatches: material.backdropFilter === shared.backdropFilter,
                    radiusMatches: material.borderRadius === shared.borderRadius,
                    borderMatches: material.borderTop === shared.borderTop && material.borderTopStyle === 'solid',
                };
                probe.remove();
                return result;
            });
            expect(Object.values(rangeThumbMaterial).every(Boolean)).toBe(true);

            await page.goto('/settings/network');
            const mail = page.locator('[data-service-key="smtp"] .settings-service-heading');
            await expect(mail).toContainText("Yahoo Mail SMTP");
            expect(await mail.evaluate(el => {
                const probe = document.createElement('span');
                probe.style.color = 'var(--accent-text)'; document.body.append(probe);
                const equal = getComputedStyle(el, "::before").backgroundColor === getComputedStyle(probe).color;
                probe.remove(); return equal;
            })).toBe(true);
            // Hold the existing navigation-mask state without issuing any network checks.
            await page.evaluate(() => {
                document.body.classList.add('is-workspace-switching');
                document.querySelectorAll('.settings-service-row [data-workspace-mask]').forEach(el => el.classList.add('is-masked-during-switch'));
            });
            const masks = await page.locator('.settings-service-row [data-workspace-mask]').evaluateAll(nodes => nodes.map(el => {
                const box = el.getBoundingClientRect(), row = el.closest('.settings-service-row').getBoundingClientRect();
                const after = getComputedStyle(el, '::after');
                return {inset: after.inset, inside: box.left >= row.left && box.right <= row.right && box.top >= row.top && box.bottom <= row.bottom};
            }));
            expect(masks.length).toBeGreaterThan(0);
            expect(masks.every(mask => mask.inset === '0px' && mask.inside)).toBe(true);
            await expect(page.locator('.settings-service-row').first()).toHaveCSS('overflow', 'clip');
            await page.goto('/settings/strategies');
            const summary = page.locator('.settings-strategy-summary').nth(2);
            const arrow = await summary.evaluate(el => {
                const css = getComputedStyle(el, '::after');
                return {align: css.alignSelf, inset: parseFloat(getComputedStyle(el).paddingTop) + parseFloat(css.marginTop)};
            });
            expect(arrow.align).toBe('start');
            expect(arrow.inset).toBe(12);
            await summary.click();
            await expect(summary.locator('..')).toHaveAttribute('open');
            expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
        });
    }
}

test('Settings optimistic navigation retains one document and bounds the dark skeleton', async ({page}) => {
    await page.setViewportSize({width: 1007, height: 1355});
    await page.emulateMedia({colorScheme: 'dark'});
    const networkResponse = await page.request.get('/settings/network');
    expect(networkResponse.ok()).toBe(true);
    const networkMarkup = await networkResponse.text();
    await page.route('**/settings/network', async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 350));
        await route.fulfill({
            body: networkMarkup,
            contentType: 'text/html; charset=utf-8',
            status: networkResponse.status(),
        });
    });
    await page.goto('/settings/clear-caches');
    await page.evaluate(() => {
        window.__settingsDocumentToken = 'retained-settings-document';
        window.__settingsViewTransitionCalls = 0;
        document.startViewTransition = (callback) => {
            window.__settingsViewTransitionCalls += 1;
            callback();
            return {finished: Promise.resolve()};
        };
    });

    await page.locator('.settings-nav-network').click();
    await expect(page.locator('.navigation-skeleton-root[data-navigation-skeleton]')).toBeVisible();
    const pendingState = await page.evaluate(() => {
        const shell = document.querySelector('#settings_workspace_shell').getBoundingClientRect();
        const scrollport = document.querySelector('#settings_workspace_shell > .settings-content-scrollport');
        const scrollportBounds = scrollport.getBoundingClientRect();
        const cards = [...scrollport.querySelectorAll('.navigation-skeleton-card')];
        return {
            hardNavigation: document.body.classList.contains('is-page-navigating'),
            token: window.__settingsDocumentToken,
            transitionCalls: window.__settingsViewTransitionCalls,
            scrollportInsideShell: scrollportBounds.left >= shell.left - 1 && scrollportBounds.right <= shell.right + 1,
            cardsInsideScrollport: cards.length > 0 && cards.every((card) => {
                const bounds = card.getBoundingClientRect();
                return bounds.left >= scrollportBounds.left - 1 && bounds.right <= scrollportBounds.right + 1;
            }),
        };
    });
    expect(pendingState).toEqual({
        hardNavigation: false,
        token: 'retained-settings-document',
        transitionCalls: 0,
        scrollportInsideShell: true,
        cardsInsideScrollport: true,
    });

    await expect(page).toHaveURL(/\/settings\/network$/);
    await expect(page.locator('[data-navigation-skeleton]')).toHaveCount(0);
    expect(await page.evaluate(() => window.__settingsDocumentToken)).toBe('retained-settings-document');
    expect(await page.evaluate(() => window.__settingsViewTransitionCalls)).toBe(0);
});
