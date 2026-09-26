/* Code version: v1.0.0 */
import {expect, test} from '@playwright/test';
import {openBacktestParameterOverlay} from './backtest-parameter-overlay-helper.mjs';

const viewports = [
    {width: 1_006, height: 791, hasTouch: false},
    {width: 390, height: 844, hasTouch: true},
    {width: 1_006, height: 500, hasTouch: false},
];

const chevronAngle = (trigger) => trigger.evaluate((element) => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(element, '::after').transform);
    return Math.round(Math.atan2(matrix.b, matrix.a) * 180 / Math.PI);
});

const readMenuPresentation = (menu) => menu.evaluate((element) => {
    const style = getComputedStyle(element);
    const root = getComputedStyle(document.documentElement);
    const expectedSurface = document.createElement('span');
    expectedSurface.style.background = [
        'linear-gradient(180deg,',
        'color-mix(in srgb, var(--theme-glass-highlight) 56%, transparent) 0%,',
        'color-mix(in srgb, var(--theme-glass-highlight) 16%, transparent) 100%),',
        'color-mix(in srgb, var(--theme-background) 62%, transparent)',
    ].join(' ');
    document.body.append(expectedSurface);
    const expected = getComputedStyle(expectedSurface);
    const rect = element.getBoundingClientRect();
    const options = Array.from(element.querySelectorAll('[role="option"]'));
    const visibleOptions = options.filter((option) => {
        const box = option.getBoundingClientRect();
        return box.top >= Math.max(rect.top, 0) && box.bottom <= Math.min(rect.bottom, innerHeight);
    });
    const result = {
        backgroundColor: style.backgroundColor,
        expectedBackgroundColor: expected.backgroundColor,
        backgroundImage: style.backgroundImage,
        expectedBackgroundImage: expected.backgroundImage,
        backdropFilter: style.backdropFilter || style.webkitBackdropFilter,
        borderWidth: style.borderTopWidth,
        borderRadius: style.borderRadius,
        opacity: style.opacity,
        width: rect.width,
        maxWidth: Number.parseFloat(root.getPropertyValue('--layout-control-width')),
        menuOpacityToken: root.getPropertyValue('--shared-select-dropdown-surface-opacity').trim(),
        ordinaryOpacityToken: root.getPropertyValue('--frosted-glass-surface-opacity').trim(),
        left: rect.left,
        right: rect.right,
        viewportWidth: innerWidth,
        horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        optionHeights: options.map((option) => option.getBoundingClientRect().height),
        visibleOptionCount: visibleOptions.length,
        visibleOptionsHittable: visibleOptions.every((option) => {
            const box = option.getBoundingClientRect();
            const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
            return hit === option || option.contains(hit);
        }),
    };
    expectedSurface.remove();
    return result;
});

for (const colorScheme of ['light', 'dark']) {
    for (const {width, height, hasTouch} of viewports) {
        test.describe(`Shared select parity ${colorScheme} ${width}x${height}`, () => {
            test.use({viewport: {width, height}, colorScheme, hasTouch});

            test('Period and catalog retain the approved menu and right/down affordance', async ({page}, testInfo) => {
                const writes = [];
                await page.route('**/*', async (route) => {
                    if (route.request().method() !== 'GET') {
                        writes.push(route.request().url());
                        await route.abort();
                    } else {
                        await route.continue();
                    }
                });

                for (const surface of ['period', 'catalog']) {
                    await page.goto(surface === 'period'
                        ? '/workspaces/backtest?ticker=DRAM&strategy=grid-trading&interval=1d&range=1y'
                        : '/settings/style-tokens');
                    if (surface === 'period') await openBacktestParameterOverlay(page);

                    const field = page.locator(surface === 'period'
                        ? '#period_panel [data-shared-select-field]'
                        : '[data-style-token-card="shared-select-dropdown"] [data-shared-select-field]');
                    const trigger = field.locator('[data-shared-select-trigger]');
                    const native = field.locator('select');
                    const menu = page.locator(`#${await trigger.getAttribute('aria-controls')}`);
                    const initialValue = await native.inputValue();
                    await trigger.scrollIntoViewIfNeeded();
                    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
                    await expect.poll(() => chevronAngle(trigger)).toBe(-90);
                    expect(await trigger.evaluate((element) => element.getBoundingClientRect().height)).toBe(30);
                    await expect(native).toBeHidden();

                    await trigger.press('ArrowDown');
                    await expect(menu).toBeVisible();
                    await expect(menu.locator('[aria-selected="true"]')).toBeFocused();
                    await expect.poll(() => chevronAngle(trigger)).toBe(0);
                    const presentation = await readMenuPresentation(menu);
                    expect(presentation).toMatchObject({
                        backgroundColor: presentation.expectedBackgroundColor,
                        backgroundImage: presentation.expectedBackgroundImage,
                        backdropFilter: 'blur(12px)',
                        borderWidth: '1px',
                        borderRadius: '10px',
                        opacity: '1',
                        menuOpacityToken: '62%',
                        ordinaryOpacityToken: '62%',
                        maxWidth: 384,
                        visibleOptionsHittable: true,
                    });
                    expect(presentation.visibleOptionCount).toBeGreaterThan(0);
                    expect(presentation.backgroundColor).toMatch(/0\.62\)$/);
                    expect(presentation.optionHeights.every((value) => value >= 35)).toBe(true);
                    expect(presentation.width).toBeLessThanOrEqual(385);
                    expect(presentation.left).toBeGreaterThanOrEqual(-1);
                    expect(presentation.right).toBeLessThanOrEqual(presentation.viewportWidth + 1);
                    expect(presentation.horizontalOverflow).toBeLessThanOrEqual(1);
                    await page.screenshot({path: testInfo.outputPath(`${surface}-open.png`)});

                    await page.keyboard.press('Home');
                    await expect(menu.locator('[role="option"]').first()).toBeFocused();
                    await expect(native).toHaveValue(initialValue);
                    await page.keyboard.press('Escape');
                    await expect(menu).toBeHidden();
                    await expect(trigger).toBeFocused();
                    await expect.poll(() => chevronAngle(trigger)).toBe(-90);
                    await expect(native).toHaveValue(initialValue);

                    await page.emulateMedia({reducedMotion: 'reduce'});
                    expect(await trigger.evaluate((element) => getComputedStyle(element, '::after').transitionDuration)).toBe('0s');
                    await trigger.press('ArrowDown');
                    await expect(menu).toBeVisible();
                    await expect.poll(() => chevronAngle(trigger)).toBe(0);
                    await page.keyboard.press('Escape');
                    await expect.poll(() => chevronAngle(trigger)).toBe(-90);
                    await page.emulateMedia({reducedMotion: 'no-preference'});
                }
                expect(writes).toEqual([]);
            });
        });
    }
}
