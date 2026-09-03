/* Motion performance regression tests. Code version: v1.0.0 */

import {expect, test} from '@playwright/test';

const collectFrameMetrics = (page, durationMs = 820) => page.evaluate((duration) => new Promise((resolve) => {
    const timestamps = [];
    const startedAt = performance.now();
    const sample = (timestamp) => {
        timestamps.push(timestamp);
        if (timestamp - startedAt >= duration) {
            const gaps = timestamps.slice(1).map((value, index) => value - timestamps[index]);
            resolve({
                frameCount: timestamps.length,
                maxGap: gaps.length ? Math.max(...gaps) : 0,
                longGapCount: gaps.filter((gap) => gap > 50).length,
            });
            return;
        }
        requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
}), durationMs);

test.describe('shared motion performance', () => {
    test.use({
        viewport: {width: 1_280, height: 720},
        deviceScaleFactor: 2,
    });

    test('keeps dpr2 sidebar motion compositor-friendly without weakening frosted glass', async ({page}) => {
        await page.goto('/settings/material-tokens');
        await expect(page.locator('[data-style-token-card="frosted-glass"] .style-token-demo-card')).toBeVisible();

        const initial = await page.evaluate(() => ({
            dpr: window.devicePixelRatio,
            surfaceOpacity: getComputedStyle(document.documentElement).getPropertyValue('--frosted-glass-surface-opacity').trim(),
            blur: getComputedStyle(document.documentElement).getPropertyValue('--frosted-glass-blur').trim(),
        }));
        expect(initial.dpr).toBe(2);
        expect(initial.surfaceOpacity).toBe('62%');
        expect(initial.blur).toBe('blur(12px)');

        await page.locator('#sidebar_toggle').click();
        const metrics = await collectFrameMetrics(page);
        expect(metrics.frameCount).toBeGreaterThan(10);
        expect(metrics.maxGap).toBeLessThan(120);
        expect(metrics.longGapCount).toBeLessThanOrEqual(1);

        const material = await page.locator('[data-style-token-card="frosted-glass"] .style-token-demo-card').evaluate((element) => {
            const style = getComputedStyle(element);
            return {backdropFilter: style.backdropFilter || style.webkitBackdropFilter};
        });
        expect(material.backdropFilter).toContain('blur(12px)');
    });

    test('settles shared scheduler work immediately under reduced motion at dpr2', async ({page}) => {
        await page.emulateMedia({reducedMotion: 'reduce'});
        await page.goto('/settings/material-tokens');
        await expect(page.locator('[data-style-token-card="frosted-glass"] .style-token-demo-card')).toBeVisible();

        await page.locator('#sidebar_toggle').click();
        await page.waitForTimeout(120);
        const state = await page.evaluate(() => ({
            dpr: window.devicePixelRatio,
            reduced: window.WorthwardMotion?.isReducedMotion?.(),
            activeSchedulerTasks: window.WorthwardMotion?.scheduler?.activeCount,
            motionDurations: getComputedStyle(document.querySelector('.settings-nav-item')).transitionDuration,
        }));
        expect(state.dpr).toBe(2);
        expect(state.reduced).toBe(true);
        expect(state.activeSchedulerTasks).toBe(0);
        expect(state.motionDurations.split(',').every((value) => value.trim() === '0.001s')).toBe(true);
    });
});
