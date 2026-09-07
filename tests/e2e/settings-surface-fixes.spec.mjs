/* Code version: v1.0.0 */
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
