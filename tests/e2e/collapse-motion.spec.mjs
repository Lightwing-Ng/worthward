/* Code version: v1.0.0 */
import {expect, test} from '@playwright/test';

for (const width of [1137, 390]) {
    for (const colorScheme of ['light', 'dark']) {
        test(`shared disclosure springs open at ${width}px in ${colorScheme}`, async ({page}) => {
            await page.setViewportSize({width, height: 1008});
            await page.emulateMedia({colorScheme, reducedMotion: 'no-preference'});
            await page.goto('/settings/style-tokens');
            const details = page.locator('#collapse details.ui-collapse');
            const summary = details.locator(':scope > summary');
            await summary.scrollIntoViewIfNeeded();
            const closed = await details.evaluate(el => el.getBoundingClientRect().height);
            await summary.press('Enter');
            await expect(details).toHaveAttribute('open');
            await expect.poll(() => details.evaluate(el => el.getAnimations().length)).toBe(1);
            const samples = await details.evaluate(el => {
                const animation = el.getAnimations()[0];
                animation.pause();
                const duration = animation.effect.getTiming().duration;
                const read = (fraction) => {
                    animation.currentTime = duration * fraction;
                    return {height: el.getBoundingClientRect().height,
                        summaryHeight: el.querySelector('summary').getBoundingClientRect().height};
                };
                const start = read(0), middle = read(0.05), overshoot = read(0.2), end = read(1);
                animation.finish();
                return {start, middle, overshoot, end};
            });
            expect(Math.abs(samples.start.height - closed)).toBeLessThan(1);
            expect(samples.middle.height).toBeGreaterThan(closed + 5);
            expect(samples.middle.height).toBeLessThan(samples.end.height);
            expect(samples.overshoot.height).toBeGreaterThan(samples.end.height + 1);
            expect(samples.start.summaryHeight).toBe(samples.end.summaryHeight);
            await expect.poll(() => details.evaluate(el => el.getAnimations().length)).toBe(0);
            await expect(details.locator('[data-style-token-collapse-example]')).toBeVisible();
            expect(await details.evaluate(el => el.style.height)).toBe('');
            await summary.press('Space');
            await expect(details).not.toHaveAttribute('open');
            await summary.click();
            await summary.press('Enter');
            await expect(details).not.toHaveAttribute('open');
            await expect.poll(() => details.evaluate(el => el.getAnimations().length)).toBe(0);
            expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
        });
    }

    test(`shared disclosure respects reduced motion at ${width}px`, async ({page}) => {
        await page.setViewportSize({width, height: 1008});
        await page.emulateMedia({reducedMotion: 'reduce'});
        await page.goto('/settings/style-tokens');
        const details = page.locator('#collapse details.ui-collapse');
        await details.locator('summary').click();
        await expect(details).toHaveAttribute('open');
        await expect(details.locator('[data-style-token-collapse-example]')).toBeVisible();
        expect(await details.evaluate(el => el.getAnimations().length)).toBe(0);
    });
}
