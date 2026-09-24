/* Code version: v1.0.0 */
import {expect, test} from '@playwright/test';

const viewports = [
    {width: 996, height: 801},
    {width: 390, height: 844},
];

for (const viewport of viewports) {
    test(`Investment Holdings demo uses shared major/minor typography at ${viewport.width}x${viewport.height}`, async ({page}) => {
        await page.setViewportSize(viewport);
        await page.goto('/settings/style-tokens');

        const demo = page.locator('#investment-holdings-allocation-badge .style-token-holdings-allocation-badge-demo');
        const values = demo.locator('[data-numeric-display-value]');
        await expect(values).toHaveCount(12);
        await expect(values.locator(':scope > .workspace-metric-value-minor')).toHaveCount(12);

        const state = await demo.evaluate((element) => {
            const demoRect = element.getBoundingClientRect();
            const sharedScale = Number.parseFloat(getComputedStyle(document.documentElement)
                .getPropertyValue('--workspace-metric-decimal-scale'));
            return {
                sharedScale,
                overflowX: element.scrollWidth - element.clientWidth,
                values: Array.from(element.querySelectorAll('[data-numeric-display-value]'), (value) => {
                    const major = value.querySelector(':scope > .workspace-metric-value-major');
                    const minor = value.querySelector(':scope > .workspace-metric-value-minor');
                    const suffix = value.querySelector(':scope > .workspace-metric-value-suffix');
                    const rect = value.getBoundingClientRect();
                    return {
                        source: value.dataset.numericDisplayValue,
                        accessible: value.getAttribute('aria-label'),
                        rendered: value.textContent.replace(/\s+/g, ''),
                        major: major?.textContent.replace(/\s+/g, '') ?? null,
                        minor: minor?.textContent.replace(/\s+/g, '') ?? null,
                        suffix: suffix?.textContent.replace(/\s+/g, '') ?? null,
                        majorSize: major ? Number.parseFloat(getComputedStyle(major).fontSize) : null,
                        minorSize: minor ? Number.parseFloat(getComputedStyle(minor).fontSize) : null,
                        leftOverflow: demoRect.left - rect.left,
                        rightOverflow: rect.right - demoRect.right,
                    };
                }),
            };
        });

        expect(state.sharedScale).toBeGreaterThan(0);
        expect(state.sharedScale).toBeLessThan(1);
        expect(state.overflowX).toBeLessThanOrEqual(1);
        for (const value of state.values) {
            expect(value.source).toMatch(/^\d[\d,]*\.\d{2}%?$/);
            expect(value.accessible).toBe(value.source);
            expect(value.rendered).toBe(value.source);
            expect(value.major).toMatch(/^\d[\d,]*$/);
            expect(value.minor).toMatch(/^\.\d{2}$/);
            expect(value.suffix).toBe(value.source.endsWith('%') ? '%' : null);
            expect(value.minorSize).toBeLessThan(value.majorSize);
            expect(Math.abs((value.minorSize / value.majorSize) - state.sharedScale)).toBeLessThan(0.02);
            expect(value.leftOverflow).toBeLessThanOrEqual(1);
            expect(value.rightOverflow).toBeLessThanOrEqual(1);
        }
    });

    test(`Process List demo assembles four readable body types at ${viewport.width}x${viewport.height}`, async ({page}) => {
        await page.setViewportSize(viewport);
        await page.goto('/settings/style-tokens');

        const demo = page.locator('#process-list .style-token-demo');
        const steps = demo.locator('ol.process-list > li.process-list-step');
        await expect(steps).toHaveCount(4);
        await expect(steps.locator('.process-list-marker')).toHaveText(['1', '2', '3', '4']);
        await expect(demo).not.toContainText(/<built-in method|object at 0x/i);

        const ordered = steps.nth(0).locator('.process-list-content > ol');
        const unordered = steps.nth(1).locator('.process-list-content > ul');
        const paragraph = steps.nth(2).locator('.process-list-content > p');
        const field = steps.nth(3).locator('.process-list-content > .field');
        await expect(ordered.locator('li')).toHaveCount(3);
        await expect(ordered).toContainText('Open the latest account statement.');
        await expect(unordered.locator('li')).toHaveCount(3);
        await expect(unordered).toContainText('Cash and cash equivalents');
        await expect(paragraph).toContainText('record where each figure came from');
        await expect(field).toHaveCount(1);
        await expect(field.locator('label')).toHaveText('Review title');
        const input = field.getByRole('textbox', {name: 'Review title'});
        await expect(input).toHaveAttribute('readonly', '');
        await expect(input).toHaveValue('Weekly portfolio review');

        const geometry = await demo.evaluate((element) => {
            const demoRect = element.getBoundingClientRect();
            return {
                overflowX: element.scrollWidth - element.clientWidth,
                bodies: Array.from(element.querySelectorAll('.process-list-content'), (content) => {
                    const rect = content.getBoundingClientRect();
                    return {
                        overflowX: content.scrollWidth - content.clientWidth,
                        overflowY: content.scrollHeight - content.clientHeight,
                        leftOverflow: demoRect.left - rect.left,
                        rightOverflow: rect.right - demoRect.right,
                    };
                }),
            };
        });
        expect(geometry.overflowX).toBeLessThanOrEqual(1);
        expect(geometry.bodies).toHaveLength(4);
        for (const body of geometry.bodies) {
            expect(body.overflowX).toBeLessThanOrEqual(1);
            expect(body.overflowY).toBeLessThanOrEqual(1);
            expect(body.leftOverflow).toBeLessThanOrEqual(1);
            expect(body.rightOverflow).toBeLessThanOrEqual(1);
        }
    });
}
