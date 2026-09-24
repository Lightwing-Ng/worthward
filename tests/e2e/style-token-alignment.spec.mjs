/* Code version: v1.8.1 */
import {expect, test} from '@playwright/test';

async function expectFieldTitle(locator) {
    await expect(locator).toHaveCSS('font-size', '15px');
    await expect(locator).toHaveCSS('font-weight', '400');
    await expect(locator).toHaveCSS('line-height', 'normal');
    await expect(locator).toHaveCSS('letter-spacing', 'normal');
    await expect(locator).toHaveCSS('color', 'rgb(11, 12, 12)');
}

for (const width of [1024, 390]) {
    test(`strategy tuning active surface follows the dark sidebar at ${width}px`, async ({page}) => {
        await page.setViewportSize({width, height: 863});
        await page.emulateMedia({colorScheme: 'dark'});
        await page.goto('/settings/style-tokens');
        const button = page.locator('[data-style-token-strategy-tune-button]');
        await expect(button).toHaveAttribute('aria-pressed', 'true');
        await expect(button).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
        await expect(button).toHaveCSS('background-image', 'none');
        const colors = await button.evaluate((node) => ({
            border: getComputedStyle(node).borderColor,
            icon: getComputedStyle(node.querySelector('.icon')).backgroundColor,
        }));
        expect(colors.border).toBe('rgb(0, 85, 204)');
        expect(colors.icon).toBe('rgb(0, 85, 204)');
    });
}

for (const width of [1024, 800, 390]) {
    test(`shared component annotations at ${width}px`, async ({page}) => {
        await page.setViewportSize({width, height: 863});
        await page.goto('/settings/style-tokens');
        await expect(page.locator('#workspace-article, #primary-inverted-button')).toHaveCount(0);
        await expect(page.getByText('Shared parameters and strategy actions', {exact: true})).toHaveCount(0);
        const controls = page.locator('.style-token-shared-select-shell .trade-strategy-select, .style-token-stepper-input');
        await expect(controls).toHaveCount(3);
        for (const control of await controls.all()) await expect(control).toHaveCSS('height', '30px');
        const secondary = page.locator('#secondary-button .style-token-demo > button');
        await expect(secondary).toHaveClass('secondary-button');
        await expect(secondary).toHaveCSS('font-size', '13px');
        expect(await secondary.evaluate(e => Math.abs(e.getBoundingClientRect().right - e.parentElement.getBoundingClientRect().right))).toBeLessThanOrEqual(1);
        await expect(secondary).toHaveCSS('height', '32px');
        expect(await secondary.evaluate(e => e.getBoundingClientRect().width < e.parentElement.getBoundingClientRect().width)).toBe(true);
        const periodTrigger = page.locator('[data-style-token-card="shared-select-dropdown"] [data-shared-select-trigger]');
        await periodTrigger.click();
        const periodOption = page.locator('[data-style-token-card="shared-select-dropdown"] [role="option"][data-value="1y"]');
        await expect(periodOption).toHaveCSS('height', '36px');
        await expect(periodOption.locator('.trade-strategy-dropdown-text')).toHaveText('1 year');
        expect(await periodOption.locator('.trade-strategy-dropdown-text').evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true);
        const tuneButton = page.locator('[data-style-token-strategy-tune-button]');
        const tunePanel = page.locator('[data-style-token-strategy-tuning-panel]');
        await expect(tuneButton).toHaveAttribute('aria-pressed', 'true');
        await expect(tuneButton).toHaveAttribute('aria-expanded', 'true');
        await expect(tuneButton).toHaveCSS('width', '30px');
        await expect(tuneButton.locator('.icon')).toHaveCSS('width', '14px');
        const pressedColors = await tuneButton.evaluate((button) => {
            const resolvedColor = (token) => {
                const probe = document.createElement('span');
                probe.style.color = `var(${token})`;
                document.body.appendChild(probe);
                const color = getComputedStyle(probe).color;
                probe.remove();
                return color;
            };
            const style = getComputedStyle(button);
            const icon = getComputedStyle(button.querySelector('.icon'));
            return {
                background: style.backgroundColor,
                border: style.borderColor,
                color: style.color,
                icon: icon.backgroundColor,
                white: resolvedColor('--color-white-adaptive'),
                primaryBlue: resolvedColor('--theme-accent-primary'),
            };
        });
        expect(pressedColors.background).toBe(pressedColors.white);
        expect(pressedColors.border).toBe(pressedColors.primaryBlue);
        expect(pressedColors.color).toBe(pressedColors.primaryBlue);
        expect(pressedColors.icon).toBe(pressedColors.primaryBlue);
        await expect(tunePanel).toHaveCSS('padding', '10px');
        await expect(tunePanel).toBeVisible();
        await page.locator('.style-token-strategy-tuning-label').click();
        await expect(tunePanel).toBeVisible();
        await tuneButton.click();
        await expect(tuneButton).toHaveAttribute('aria-pressed', 'false');
        await expect(tuneButton).toHaveAttribute('aria-expanded', 'false');
        await expect(tunePanel).toBeHidden();
        await tuneButton.click();
        await expect(tunePanel).toBeVisible();
        expect(await page.locator('[data-style-token-strategy-tuning]').evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true);
        const metricLabel = page.locator('[data-style-token-card="workspace-metric-value"] .trade-metric-label');
        await expect(metricLabel).toHaveText('Total trades');
        await expect(metricLabel).toHaveCSS('font-size', '15px');
        await expect(metricLabel).toHaveCSS('font-weight', '400');
        await expect(metricLabel).toHaveCSS('line-height', 'normal');
        await expect(metricLabel).toHaveCSS('color', 'rgb(11, 12, 12)');
        const monetaryValue = page.locator('[data-style-token-card="scrollable-table"] span[data-numeric-display-value][data-currency-code="USD"]');
        await expect(monetaryValue).toHaveAttribute('aria-label', '$7,089.68');
        await expect(monetaryValue.locator('.workspace-metric-value-major')).toHaveText('$7,089');
        await expect(monetaryValue.locator('.workspace-metric-value-minor')).toHaveText('.68');
        const monetarySizes = await monetaryValue.evaluate((node) => ({
            major: Number.parseFloat(getComputedStyle(node.querySelector('.workspace-metric-value-major')).fontSize),
            minor: Number.parseFloat(getComputedStyle(node.querySelector('.workspace-metric-value-minor')).fontSize),
        }));
        expect(Math.abs((monetarySizes.minor / monetarySizes.major) - 0.76)).toBeLessThan(0.01);
        await expectFieldTitle(page.locator('.style-token-scrollable-table thead th:nth-child(2)'));
        await expectFieldTitle(page.locator('.style-token-settings-input-label'));
        for (const id of ['modal-dialog', 'modal-dialog-banner-message']) {
            const surface = page.locator(`#${id} .style-token-modal-demo`);
            const close = page.locator(`#${id} .dismiss-button`);
            await expect(surface).toHaveCSS('padding', '12px');
            await expect(close).toHaveCSS('width', '24px');
            await expect(close).toHaveCSS('height', '24px');
            await expect(close).toHaveCSS('border-radius', '50%');
            const geometry = await surface.evaluate((node) => {
                const button = node.querySelector('.dismiss-button');
                const icon = node.querySelector('.workspace-modal-icon');
                const title = node.querySelector('.workspace-modal-title, .notice-floating-banner-heading');
                const copy = node.querySelector('.workspace-modal-copy, .notice-floating-banner-copy, .notice-floating-banner-list');
                const content = node.querySelector('.notice-floating-banner-content');
                const hangingItem = node.querySelector('.notice-floating-banner-list li:last-child');
                const hangingRange = hangingItem ? document.createRange() : null;
                hangingRange?.selectNodeContents(hangingItem);
                const hangingLineRects = hangingRange
                    ? Array.from(hangingRange.getClientRects(), rect => ({left: rect.left, width: rect.width}))
                    : [];
                return {
                    centerTop: button.offsetTop + (button.offsetHeight / 2),
                    centerLeft: button.offsetLeft + (button.offsetWidth / 2),
                    titleCenterY: title.offsetTop + (title.offsetHeight / 2),
                    iconLeft: icon.offsetLeft,
                    iconTop: icon.offsetTop,
                    iconWidth: icon.offsetWidth,
                    closeLeft: button.offsetLeft,
                    closeBottom: button.offsetTop + button.offsetHeight,
                    titleLeft: title.offsetLeft,
                    copyLeft: copy.offsetLeft,
                    copyTop: copy.offsetTop,
                    contentOwnsTitle: content ? title.parentElement === content : null,
                    contentOwnsBody: content ? copy.parentElement === content : null,
                    contentDisplay: content ? getComputedStyle(content).display : null,
                    hangingLineRects,
                    bodyElementCount: content
                        ? content.querySelectorAll(':scope > .notice-floating-banner-copy, :scope > .notice-floating-banner-list').length
                        : null,
                    overflow: node.scrollWidth - node.clientWidth,
                };
            });
            expect(Math.abs(geometry.centerTop - geometry.centerLeft)).toBeLessThanOrEqual(1);
            expect(Math.abs(geometry.titleCenterY - geometry.centerTop)).toBeLessThanOrEqual(1);
            expect(Math.abs(geometry.iconLeft - geometry.closeLeft)).toBeLessThanOrEqual(1);
            expect(geometry.iconTop - geometry.closeBottom).toBeGreaterThanOrEqual(4);
            expect(geometry.titleLeft - geometry.iconLeft - geometry.iconWidth).toBe(12);
            expect(Math.abs(geometry.copyTop - geometry.iconTop)).toBeLessThanOrEqual(1);
            expect(geometry.copyLeft).toBe(geometry.titleLeft);
            expect(geometry.overflow).toBeLessThanOrEqual(0);
            if (id === 'modal-dialog-banner-message') {
                expect(geometry.contentOwnsTitle).toBe(true);
                expect(geometry.contentOwnsBody).toBe(true);
                expect(geometry.contentDisplay).toBe('contents');
                expect(geometry.bodyElementCount).toBe(1);
                expect(geometry.hangingLineRects.length).toBeGreaterThanOrEqual(2);
                for (const line of geometry.hangingLineRects.slice(1)) {
                    expect(Math.abs(line.left - geometry.hangingLineRects[0].left)).toBeLessThanOrEqual(1);
                }
            }
            await page.mouse.move(0, 0);
            await expect(close).toHaveCSS('opacity', '0');
            await close.locator('..').hover();
            await expect(close).toHaveCSS('opacity', '1');
            await expect(close).toHaveCSS('color', 'rgb(200, 30, 30)');
            await page.mouse.move(0, 0);
            await close.focus();
            await expect(close).toHaveCSS('opacity', '1');
            await close.evaluate(e => e.blur());
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });
}

for (const width of [1024, 390]) {
    test(`dynamic banner content keeps explicit rows at ${width}px`, async ({page}) => {
        await page.setViewportSize({width, height: 863});
        await page.goto('/settings/style-tokens');
        const surface = page.locator('#modal-dialog-banner-message .style-token-modal-demo');
        const content = surface.locator('.notice-floating-banner-content');

        await content.evaluate((node) => {
            node.textContent = 'Heading-free status copy stays aligned with its unchanged topic icon.';
        });
        const fallback = await surface.evaluate((node) => {
            const icon = node.querySelector('.notice-floating-banner-icon');
            const message = node.querySelector('.notice-floating-banner-content');
            return {
                display: getComputedStyle(message).display,
                iconTop: icon.offsetTop,
                messageTop: message.offsetTop,
                overflow: node.scrollWidth - node.clientWidth,
            };
        });
        expect(fallback.display).toBe('block');
        expect(Math.abs(fallback.messageTop - fallback.iconTop)).toBeLessThanOrEqual(1);
        expect(fallback.overflow).toBeLessThanOrEqual(0);

        await content.evaluate((node) => {
            node.innerHTML = [
                '<p class="notice-floating-banner-heading">Dynamic status updated</p>',
                '<p class="notice-floating-banner-copy">A long dynamic paragraph stays in the body row and wraps without escaping the notice surface.</p>',
            ].join('');
        });
        const populated = await surface.evaluate((node) => {
            const close = node.querySelector('.dismiss-button');
            const icon = node.querySelector('.notice-floating-banner-icon');
            const content = node.querySelector('.notice-floating-banner-content');
            const heading = content.querySelector('.notice-floating-banner-heading');
            const copy = content.querySelector('.notice-floating-banner-copy');
            return {
                display: getComputedStyle(content).display,
                closeCenter: close.offsetTop + (close.offsetHeight / 2),
                headingCenter: heading.offsetTop + (heading.offsetHeight / 2),
                iconTop: icon.offsetTop,
                copyTop: copy.offsetTop,
                childCount: content.children.length,
                overflow: node.scrollWidth - node.clientWidth,
            };
        });
        expect(populated.display).toBe('contents');
        expect(populated.childCount).toBe(2);
        expect(Math.abs(populated.headingCenter - populated.closeCenter)).toBeLessThanOrEqual(1);
        expect(Math.abs(populated.copyTop - populated.iconTop)).toBeLessThanOrEqual(1);
        expect(populated.overflow).toBeLessThanOrEqual(0);
    });
}

test('floating banner preserves its reduced-motion path', async ({page}) => {
    await page.emulateMedia({reducedMotion: 'reduce'});
    await page.goto('/settings/style-tokens');
    const banner = page.locator('#modal-dialog-banner-message .style-token-modal-demo');
    await expect(banner).toHaveCSS('animation-duration', '0.001s');
    await expect(banner).toHaveCSS('animation-delay', '0s');
});

test('touch users can discover shared actions without hover', async ({browser}) => {
    const context = await browser.newContext({hasTouch: true, isMobile: true, viewport: {width: 390, height: 863}});
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:8699/settings/style-tokens');
    for (const close of await page.locator('.style-token-demo .dismiss-button').all()) {
        await expect(close).toHaveCSS('opacity', '1');
    }
    const circular = page.locator('[data-style-token-card="circular-icon-button"] .circular-icon-button').first();
    await expect(circular).toHaveCSS('width', '44px');
    await expect(circular).toHaveCSS('height', '44px');
    await circular.tap();

    const segmentedOption = page.locator('[data-style-token-card="segmented-control"] .segmented-control-option').nth(1);
    await segmentedOption.tap();
    await expect(segmentedOption.locator('input')).toBeChecked();

    const pagination = page.locator('[data-style-token-card="pagination"] .local-store-pagination');
    await expect(pagination).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await context.close();
});
