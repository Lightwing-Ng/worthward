/* Code version: v1.0.2 */
import {expect, test} from '@playwright/test';
import {mockInvestmentReadApis} from '../critical_flows/support.mjs';

const viewports = [
    {width: 1_006, height: 791, hasTouch: false},
    {width: 390, height: 844, hasTouch: true},
    {width: 1_006, height: 500, hasTouch: false},
    {width: 900, height: 791, hasTouch: false},
    {width: 901, height: 791, hasTouch: false},
    {width: 1_006, height: 791, hasTouch: true},
];

const readButtonGeometry = (button) => button.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const icon = element.querySelector('.icon').getBoundingClientRect();
    return {
        width: box.width,
        height: box.height,
        iconWidth: icon.width,
        iconHeight: icon.height,
        iconCenterX: Math.abs(icon.left + icon.width / 2 - box.left - box.width / 2),
        iconCenterY: Math.abs(icon.top + icon.height / 2 - box.top - box.height / 2),
        radius: getComputedStyle(element).borderRadius,
    };
});

async function settlePointer(page) {
    await page.mouse.move(0, 0);
    await page.evaluate(() => {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    });
}

for (const theme of ['light', 'dark']) {
    for (const width of [1_006, 390, 900, 901]) {
        test.describe(`Investment circular rail ${theme} ${width}px`, () => {
            test.use({viewport: {width, height: 844}, colorScheme: theme, hasTouch: width === 390});

            test('import height uses the visible responsive control rail', async ({page}) => {
                await page.route('**/*', async (route) => {
                    if (route.request().method() === 'GET') await route.continue();
                    else await route.abort();
                });
                await mockInvestmentReadApis(page, {transactions: [], brokerSummaries: {}, brokers: ['hsbc']});
                await page.goto('/trade/investment?view=holdings');
                await page.evaluate((value) => {
                    document.documentElement.dataset.themeOverride = value;
                }, theme);
                await page.locator('#toggle_form_button').click();
                await expect(page.locator('#investment_form')).toBeVisible();
                await expect.poll(async () => page.evaluate(() => {
                    const themeBox = document.querySelector('#global_theme_toggle').getBoundingClientRect();
                    const railBox = document.querySelector('#global_quick_actions').getBoundingClientRect();
                    const container = document.querySelector('#transaction_form_container');
                    const modalBox = document.querySelector('#investment_form').getBoundingClientRect();
                    const canonicalSize = Number.parseFloat(getComputedStyle(document.querySelector('#global_quick_actions'))
                        .getPropertyValue('--circular-icon-button-size'));
                    const expectedSize = innerWidth <= 900 ? 44 : 30;
                    const expectedTop = themeBox.bottom + 10;
                    const expectedHeight = Math.max(240, innerHeight - expectedTop * 2);
                    const heightValue = Number.parseFloat(container.style.getPropertyValue('--investment-import-modal-height'));
                    return {
                        themeUsesResponsiveSize: Math.abs(themeBox.height - expectedSize) <= 1,
                        railUsesResponsiveSize: Math.abs(railBox.height - expectedSize) <= 1,
                        ownerTokenMatchesRail: canonicalSize === expectedSize,
                        actualTopMatchesRail: Math.abs(modalBox.top - expectedTop) <= 1,
                        calculatedHeightMatchesRail: Math.abs(heightValue - expectedHeight) <= 1,
                        noHorizontalOverflow: document.documentElement.scrollWidth <= innerWidth + 1,
                    };
                })).toEqual({
                    themeUsesResponsiveSize: true,
                    railUsesResponsiveSize: true,
                    ownerTokenMatchesRail: true,
                    actualTopMatchesRail: true,
                    calculatedHeightMatchesRail: true,
                    noHorizontalOverflow: true,
                });
            });
        });
    }
}

const readShellGeometry = (page) => page.evaluate(() => {
    const rect = (selector) => document.querySelector(selector).getBoundingClientRect();
    const toggle = rect('#sidebar_toggle');
    const theme = rect('#global_theme_toggle');
    const languageElement = document.querySelector('#global_language_toggle');
    const languageStyle = getComputedStyle(languageElement);
    const rail = rect('#global_quick_actions');
    const sidebar = rect('#app_sidebar');
    const title = rect('[data-layout-role="title-heading"] .report-heading');
    const expanded = document.querySelector('#sidebar_toggle').getAttribute('aria-expanded') === 'true';
    const titleVisible = innerWidth > 900 || !expanded;
    return {
        toggleSize: [toggle.width, toggle.height],
        themeSize: [theme.width, theme.height],
        languageSize: [languageElement.offsetWidth, languageElement.offsetHeight],
        themeTop: theme.top,
        themeRightInset: innerWidth - theme.right,
        toggleTop: toggle.top,
        verticalCenterGap: Math.abs(toggle.top + toggle.height / 2 - theme.top - theme.height / 2),
        languageGap: Number.parseFloat(languageStyle.right) - theme.width,
        sidebarTopInset: expanded ? toggle.top - sidebar.top : null,
        sidebarRightInset: expanded ? sidebar.right - toggle.right : null,
        collapsedToggleLeft: expanded ? null : toggle.left,
        titleCenterGap: titleVisible
            ? Math.abs(title.top + title.height / 2 - theme.top - theme.height / 2) : 0,
        collapsedTitleClearance: expanded ? true : title.left >= toggle.right + 10,
        titleAvoidsGlobalActions: !titleVisible || title.right <= rail.left,
        noHorizontalOverflow: document.documentElement.scrollWidth <= innerWidth + 1,
        themeContained: theme.left >= 0 && theme.right <= innerWidth
            && theme.top >= 0 && theme.bottom <= innerHeight,
    };
});

async function expectShellGeometry(page, expectedSize, expanded) {
    await expect.poll(async () => {
        const geometry = await readShellGeometry(page);
        return {
            correctSizes: [geometry.toggleSize, geometry.themeSize, geometry.languageSize]
                .every((size) => size.every((value) => Math.abs(value - expectedSize) <= 1)),
            globalInsets: Math.abs(geometry.themeTop - 20) <= 1
                && Math.abs(geometry.themeRightInset - 20) <= 1,
            toggleAligned: Math.abs(geometry.toggleTop - 20) <= 1 && geometry.verticalCenterGap <= 1,
            languageGap: Math.abs(geometry.languageGap - 10) <= 1,
            sidebarInsets: expanded
                ? Math.abs(geometry.sidebarTopInset - 10) <= 1
                    && Math.abs(geometry.sidebarRightInset - 10) <= 1
                : Math.abs(geometry.collapsedToggleLeft - 20) <= 1,
            titleAligned: geometry.titleCenterGap <= 1,
            titleClear: geometry.collapsedTitleClearance && geometry.titleAvoidsGlobalActions,
            contained: geometry.noHorizontalOverflow && geometry.themeContained,
        };
    }).toEqual({
        correctSizes: true,
        globalInsets: true,
        toggleAligned: true,
        languageGap: true,
        sidebarInsets: true,
        titleAligned: true,
        titleClear: true,
        contained: true,
    });
}

for (const theme of ['light', 'dark']) {
    for (const {width, height, hasTouch} of viewports) {
        test.describe(`Circular action contract ${theme} ${width}x${height}${hasTouch ? ' touch' : ''}`, () => {
            test.use({viewport: {width, height}, colorScheme: theme, hasTouch});

            test('catalog and production anchors share the responsive primitive', async ({page}, testInfo) => {
                const errors = [];
                page.on('pageerror', (error) => errors.push(error.message));
                await page.route('**/*', async (route) => {
                    if (route.request().method() === 'GET') await route.continue();
                    else await route.abort();
                });
                await page.goto('/settings/style-tokens');
                await page.evaluate((value) => {
                    document.documentElement.dataset.themeOverride = value;
                }, theme);
                await page.evaluate(() => document.fonts.ready);
                const size = width <= 900 ? 44 : 30;
                const catalog = page.locator('#circular-icon-button .style-token-demo .circular-icon-button');
                const copy = page.locator('#circular-icon-button .style-token-copy-button');
                await expect(catalog).toBeVisible();
                await expect(page.locator('#circular-icon-button [data-style-token-name="--circular-icon-button-size"]'))
                    .toHaveAttribute('data-style-token-value', '30');
                await page.locator('#circular-icon-button .style-token-title-row').hover();
                await expect(copy).toBeVisible();
                await expect.poll(() => copy.evaluate((element) => getComputedStyle(element).transform)).toBe('none');
                for (const button of [catalog, copy, page.locator('#sidebar_toggle'), page.locator('#global_theme_toggle')]) {
                    const geometry = await readButtonGeometry(button);
                    expect(geometry.width).toBe(size);
                    expect(geometry.height).toBe(size);
                    expect(geometry.iconWidth).toBe(18);
                    expect(geometry.iconHeight).toBe(18);
                    expect(geometry.iconCenterX).toBeLessThanOrEqual(1);
                    expect(geometry.iconCenterY).toBeLessThanOrEqual(1);
                    expect(geometry.radius).toBe('999px');
                }

                const toggle = page.locator('#sidebar_toggle');
                for (const expanded of [false, true, false]) {
                    if (await toggle.getAttribute('aria-expanded') !== String(expanded)) await toggle.click();
                    await expect(toggle).toHaveAttribute('aria-expanded', String(expanded));
                    await settlePointer(page);
                    await expectShellGeometry(page, size, expanded);
                }
                const language = page.locator('#global_language_toggle');
                await page.locator('#global_quick_actions').hover();
                await expect.poll(() => language.evaluate((element) => getComputedStyle(element).opacity)).toBe('1');
                await expect.poll(async () => {
                    const geometry = await readButtonGeometry(language);
                    return Math.abs(geometry.width - size) <= 0.01 && Math.abs(geometry.height - size) <= 0.01;
                }).toBe(true);
                const revealedGap = await page.evaluate(() => {
                    const themeBox = document.querySelector('#global_theme_toggle').getBoundingClientRect();
                    const languageBox = document.querySelector('#global_language_toggle').getBoundingClientRect();
                    return themeBox.left - languageBox.right;
                });
                expect(Math.abs(revealedGap - 10)).toBeLessThanOrEqual(1);

                await catalog.scrollIntoViewIfNeeded();
                await settlePointer(page);
                const colors = await page.evaluate(() => {
                    const probe = document.createElement('span');
                    document.body.append(probe);
                    const values = {};
                    for (const [name, token] of Object.entries({idle: 'color', hover: 'color-hover'})) {
                        probe.style.color = `var(--circular-icon-button-${token})`;
                        values[name] = getComputedStyle(probe).color;
                    }
                    probe.remove();
                    return values;
                });
                await expect.poll(() => catalog.evaluate((element) => getComputedStyle(element).color)).toBe(colors.idle);
                await catalog.hover();
                await expect.poll(() => catalog.evaluate((element) => getComputedStyle(element).color)).toBe(colors.hover);
                await settlePointer(page);
                await page.keyboard.press('Tab');
                await catalog.focus();
                await expect(catalog).toBeFocused();
                await expect.poll(() => catalog.evaluate((element) => getComputedStyle(element).color)).toBe(colors.hover);
                expect(colors.hover).not.toBe(colors.idle);
                await settlePointer(page);
                const geometry = await readButtonGeometry(catalog);
                expect([geometry.width, geometry.height]).toEqual([size, size]);

                for (const [selector, expected] of [
                    ['#process-list .process-list-marker', 32],
                    ['#modal-dialog .workspace-modal-close', 24],
                    ['#modal-dialog .workspace-modal-icon', 36],
                ]) {
                    const actual = await page.locator(selector).first().evaluate((element) => {
                        return [element.offsetWidth, element.offsetHeight];
                    });
                    expect(actual).toEqual([expected, expected]);
                }
                await page.screenshot({path: testInfo.outputPath('circular-action-contract.png')});
                expect(errors).toEqual([]);
            });
        });
    }
}
