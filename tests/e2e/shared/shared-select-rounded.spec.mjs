/* Code version: v1.0.0 */
import {expect, test} from '@playwright/test';
import {mockInvestmentReadApis} from '../critical_flows/support.mjs';

const tolerance = 1;
const variants = [
    {width: 1_024, height: 863},
    {width: 390, height: 844},
];

const mockTickerLogos = async (page) => {
    await page.route(/\/market-store\/logos\/(?:GOOGL|AAPL)\.svg(?:\?.*)?$/, async (route) => {
        await route.fulfill({
            contentType: 'image/svg+xml',
            body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><rect width="20" height="20" rx="4" fill="#0055cc"/></svg>',
        });
    });
};

const settleTypography = async (trigger) => {
    await trigger.scrollIntoViewIfNeeded();
    await trigger.evaluate(async (element) => {
        await document.fonts.ready;
        await Promise.allSettled(element.getAnimations({subtree: true})
            .filter((animation) => Number.isFinite(animation.effect?.getTiming().iterations))
            .map((animation) => animation.finished));
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
};

const controlledMenu = async (page, trigger) => {
    const id = await trigger.getAttribute('aria-controls');
    expect(id).toBeTruthy();
    return page.locator(`#${id}`);
};

const readPresentation = (trigger) => trigger.evaluate((element) => {
    const menu = document.getElementById(element.getAttribute('aria-controls'));
    const option = menu?.querySelector('[role="option"][aria-selected="true"]');
    const title = element.querySelector('.trade-strategy-dropdown-title');
    const description = element.querySelector('.trade-strategy-dropdown-desc');
    const copy = element.querySelector('.trade-strategy-dropdown-copy');
    const media = element.querySelector('.trade-strategy-dropdown-media-slot, img.ticker-identity-logo');
    const optionTitle = option?.querySelector('.trade-strategy-dropdown-title');
    const optionDescription = option?.querySelector('.trade-strategy-dropdown-desc');
    const optionCopy = option?.querySelector('.trade-strategy-dropdown-copy');
    if (!title || !description || !copy || !media || !optionTitle || !optionDescription || !optionCopy) {
        return null;
    }
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const titleRect = title.getBoundingClientRect();
    const descriptionRect = description.getBoundingClientRect();
    const mediaRect = media.getBoundingClientRect();
    const content = element.querySelector('.ticker-identity-row') || copy;
    const contentRect = content.getBoundingClientRect();
    const typography = (node) => {
        const computed = getComputedStyle(node);
        return Object.fromEntries([
            'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing',
            'color', 'whiteSpace', 'textOverflow', 'marginTop', 'maskImage',
        ].map((key) => [key, computed[key]]));
    };
    const verticalInsets = ['paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth']
        .reduce((sum, key) => sum + (Number.parseFloat(style[key]) || 0), 0);
    const naturalHeight = Math.max(contentRect.height, mediaRect.height) + verticalInsets;
    const expectedHeight = Math.max(naturalHeight, Number.parseFloat(style.minHeight) || 0);
    const contained = [titleRect, descriptionRect, mediaRect].every((child) => (
        child.top >= rect.top - 1 && child.bottom <= rect.bottom + 1
        && child.left >= rect.left - 1 && child.right <= rect.right + 1
    ));
    return {
        radius: style.borderRadius,
        height: rect.height,
        naturalHeightError: Math.abs(rect.height - expectedHeight),
        contained,
        verticalOverflow: element.scrollHeight - element.clientHeight,
        titleAboveDescription: titleRect.bottom <= descriptionRect.top + 1,
        mediaWidth: mediaRect.width,
        mediaHeight: mediaRect.height,
        copyGap: getComputedStyle(copy).rowGap,
        optionCopyGap: getComputedStyle(optionCopy).rowGap,
        title: typography(title),
        optionTitle: typography(optionTitle),
        description: typography(description),
        optionDescription: typography(optionDescription),
        pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        left: rect.left,
        right: rect.right,
        viewportWidth: innerWidth,
    };
});

const expectRoundedPresentation = async (trigger) => {
    await settleTypography(trigger);
    const presentation = await readPresentation(trigger);
    expect(presentation).not.toBeNull();
    expect(presentation.radius).toBe('10px');
    expect(presentation.height).toBeGreaterThan(30);
    expect(presentation.naturalHeightError).toBeLessThanOrEqual(tolerance);
    expect(presentation.contained).toBe(true);
    expect(presentation.verticalOverflow).toBeLessThanOrEqual(tolerance);
    expect(presentation.titleAboveDescription).toBe(true);
    expect(Math.abs(presentation.mediaWidth - 20)).toBeLessThanOrEqual(tolerance);
    expect(Math.abs(presentation.mediaHeight - 20)).toBeLessThanOrEqual(tolerance);
    expect(presentation.copyGap).toBe(presentation.optionCopyGap);
    expect(presentation.title).toEqual(presentation.optionTitle);
    expect(presentation.description).toEqual(presentation.optionDescription);
    expect(presentation.description.whiteSpace).toBe('normal');
    expect(presentation.pageOverflow).toBeLessThanOrEqual(tolerance);
    expect(presentation.left).toBeGreaterThanOrEqual(-tolerance);
    expect(presentation.right).toBeLessThanOrEqual(presentation.viewportWidth + tolerance);
};

for (const colorScheme of ['light', 'dark']) {
    for (const viewport of variants) {
        test.describe(`Rounded Shared select ${colorScheme} ${viewport.width}px`, () => {
            test.use({viewport, colorScheme});

            test('catalog preserves the pill and synchronizes rounded ticker content', async ({page}, testInfo) => {
                await mockTickerLogos(page);
                await page.goto('/settings/style-tokens#shared-select-rounded-rectangle');
                const card = page.locator('[data-style-token-card="shared-select-rounded-rectangle"]');
                const field = card.locator('[data-shared-select-variant="rounded"]');
                const trigger = field.locator('[data-shared-select-trigger]');
                const native = field.locator('#style_token_shared_select_rounded');
                const title = trigger.locator('.trade-strategy-dropdown-title');
                const description = trigger.locator('[data-shared-select-trigger-description]');
                await expect(native).toBeHidden();
                await expect(native).toHaveValue('GOOGL');
                await expect(title).toHaveText('GOOGL');
                await expect(description).toHaveText('Alphabet Inc.');
                await expect(trigger.locator('[data-shared-select-trigger-logo]')).toHaveAttribute('src', /\/GOOGL\.svg(?:\?|$)/);
                await trigger.press('ArrowDown');
                let menu = await controlledMenu(page, trigger);
                await expect(menu).toBeVisible();
                await expect(menu.locator('[role="option"][aria-selected="true"]')).toBeFocused();
                await expectRoundedPresentation(trigger);
                await page.screenshot({path: testInfo.outputPath('catalog-rounded-open.png')});
                await page.keyboard.press('Escape');
                await expect(menu).toBeHidden();
                await expect(trigger).toBeFocused();
                await expect(native).toHaveValue('GOOGL');

                await native.evaluate((element) => {
                    element._roundedChangeCount = 0;
                    element.addEventListener('change', () => { element._roundedChangeCount += 1; });
                });
                await trigger.click();
                menu = await controlledMenu(page, trigger);
                await menu.locator('[role="option"][data-value="AAPL"]').click();
                await expect(native).toHaveValue('AAPL');
                await expect(title).toHaveText('AAPL');
                await expect(description).toHaveText('Apple Inc.');
                await expect(trigger.locator('[data-shared-select-trigger-logo]')).toHaveAttribute('src', /\/AAPL\.svg(?:\?|$)/);
                expect(await native.evaluate((element) => element._roundedChangeCount)).toBe(1);
                await expect(trigger).toBeFocused();
                await trigger.press('ArrowDown');
                await expectRoundedPresentation(trigger);
                await page.keyboard.press('Escape');

                const pill = page.locator('[data-style-token-card="shared-select-dropdown"] [data-shared-select-trigger]');
                await pill.scrollIntoViewIfNeeded();
                await expect(pill).toHaveCSS('height', '30px');
                expect(await pill.evaluate((element) => Number.parseFloat(getComputedStyle(element).borderRadius))).toBeGreaterThan(10);
            });

            test('Stock details fits ticker identity and wraps long names with option typography', async ({page}, testInfo) => {
                const companyName = 'Alphabet Inc. Class A common stock with a deliberately long fixture company name';
                await mockTickerLogos(page);
                await mockInvestmentReadApis(page, {
                    transactions: [
                        {ledger_no: 1, broker: 'ibkr', date: '2026-07-10', type: 'buy', ticker: 'GOOGL', currency: 'USD', quantity: 1, price: 180, amount: -180},
                        {ledger_no: 2, broker: 'ibkr', date: '2026-07-11', type: 'buy', ticker: 'AAPL', currency: 'USD', quantity: 1, price: 200, amount: -200},
                    ],
                    priceHistoryByTicker: {
                        GOOGL: [{date: '2026-07-10', close: 180}, {date: '2026-07-11', close: 181}],
                        AAPL: [{date: '2026-07-10', close: 200}, {date: '2026-07-11', close: 201}],
                    },
                    tickerProfiles: {
                        GOOGL: {ticker: 'GOOGL', company_name: companyName, logo_url: '/market-store/logos/GOOGL.svg'},
                        AAPL: {ticker: 'AAPL', company_name: 'Apple Inc.', logo_url: '/market-store/logos/AAPL.svg'},
                    },
                });
                await page.goto('/trade/investment?view=stock-details&ticker=GOOGL&range=1y');
                const field = page.locator('#stock_panel .investment-stock-details-identity [data-shared-select-variant="rounded"]');
                const trigger = field.locator('[data-shared-select-trigger]');
                const native = field.locator('[data-investment-stock-ticker-select]');
                await expect(native).toHaveValue('GOOGL');
                await expect(trigger.locator('.ticker-identity-symbol.trade-strategy-dropdown-title')).toHaveText('GOOGL');
                await expect(trigger.locator('.ticker-identity-name.trade-strategy-dropdown-desc')).toHaveText(companyName);
                await trigger.press('ArrowDown');
                const menu = await controlledMenu(page, trigger);
                await expect(menu).toBeVisible();
                await expectRoundedPresentation(trigger);
                const descriptionLines = await trigger.locator('.trade-strategy-dropdown-desc').evaluate((element) => (
                    element.getBoundingClientRect().height / Number.parseFloat(getComputedStyle(element).lineHeight)
                ));
                expect(descriptionLines).toBeGreaterThan(1.5);
                const menuBox = await menu.boundingBox();
                expect(menuBox).not.toBeNull();
                expect(menuBox.x).toBeGreaterThanOrEqual(-tolerance);
                expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(viewport.width + tolerance);
                await page.screenshot({path: testInfo.outputPath('stock-rounded-open.png')});
                await page.keyboard.press('Escape');
                await expect(menu).toBeHidden();
                await expect(trigger).toBeFocused();
                await expect(native).toHaveValue('GOOGL');
            });
        });
    }
}
