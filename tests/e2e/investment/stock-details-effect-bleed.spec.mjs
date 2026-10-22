/* Code version: v1.0.0
 * Stock-details controls keep physical effects outside ordinary layout wrappers.
 */
import fs from 'node:fs/promises';
import {expect, test} from '@playwright/test';
import {mockInvestmentReadApis} from '../critical_flows/support.mjs';

const desktopViewports = [
    {width: 806, height: 1245},
    {width: 1024, height: 863},
];
const effectWrappers = [
    '#investment_view_surface',
    '#investment_view_surface_body',
    '#stock_panel',
    '.investment-stock-details-overview',
];

const mockStockDetails = async (page) => {
    await mockInvestmentReadApis(page, {
        startingCash: 1000,
        brokers: ['ibkr'],
        transactions: [
            {ledger_no: 1, broker: 'ibkr', date: '2026-02-02', type: 'buy', ticker: 'DRAM', currency: 'USD', quantity: 10, price: 20, amount: -200},
            {ledger_no: 2, broker: 'ibkr', date: '2026-02-02', type: 'buy', ticker: 'AAPL', currency: 'USD', quantity: 1, price: 100, amount: -100},
        ],
        tickerProfiles: {
            DRAM: {ticker: 'DRAM', company_name: 'Roundhill Memory ETF'},
            AAPL: {ticker: 'AAPL', company_name: 'Apple Inc.'},
        },
        priceHistoryByTicker: {
            DRAM: [{date: '2026-02-02', close: 20}, {date: '2026-02-03', close: 21}],
            AAPL: [{date: '2026-02-02', close: 100}, {date: '2026-02-03', close: 101}],
        },
        intradayRows: () => [],
    });
    await page.goto('/trade/investment?view=stock-details&ticker=DRAM&range=ytd');
    const trigger = page.locator('#stock_panel [data-shared-select-kind="investment-stock-ticker"] [data-shared-select-trigger]');
    await expect(trigger).toBeVisible();
    await expect(trigger).toHaveAttribute('aria-label', 'Choose a ticker: DRAM');
    await expect.poll(() => page.locator('#investment_view_surface').evaluate((element) => element.style.overflow)).toBe('');
    await trigger.evaluate(async (element) => {
        await document.fonts.ready;
        await Promise.allSettled(element.getAnimations({subtree: true})
            .filter((animation) => Number.isFinite(animation.effect?.getTiming().iterations))
            .map((animation) => animation.finished));
    });
    return trigger;
};

const ancestorGeometry = (trigger) => trigger.evaluate((element) => {
    const ancestors = [];
    for (let node = element; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        const bounds = node.getBoundingClientRect();
        ancestors.push({
            tag: node.tagName,
            id: node.id,
            className: node.className,
            layoutRole: node.dataset.layoutRole || '',
            stockChartMinimum: node.hasAttribute('data-investment-stock-chart-minimum'),
            overflowX: style.overflowX,
            overflowY: style.overflowY,
            contain: style.contain,
            clipPath: style.clipPath,
            rect: {left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom},
            clientWidth: node.clientWidth,
            clientHeight: node.clientHeight,
            scrollWidth: node.scrollWidth,
            scrollHeight: node.scrollHeight,
        });
    }
    return ancestors;
});

const recordAncestors = async (trigger, testInfo) => {
    const path = testInfo.outputPath('ancestor-geometry.json');
    await fs.writeFile(path, JSON.stringify(await ancestorGeometry(trigger), null, 2));
    await testInfo.attach('Stock-details ancestor geometry', {path, contentType: 'application/json'});
};

const expectSharedHoverShadow = async (trigger) => {
    await expect.poll(() => trigger.evaluate((element) => {
        const reference = document.createElement('span');
        reference.style.cssText = 'display: none; box-shadow: var(--shared-select-shadow-hover)';
        element.append(reference);
        const expected = getComputedStyle(reference).boxShadow;
        reference.remove();
        const actual = getComputedStyle(element).boxShadow;
        return {present: actual !== 'none', matchesSharedToken: actual === expected};
    })).toEqual({present: true, matchesSharedToken: true});
};

const expectNoHorizontalOverflow = async (page) => {
    await expect.poll(() => page.evaluate(() => (
        document.documentElement.scrollWidth - document.documentElement.clientWidth
    ))).toBeLessThanOrEqual(1);
};

const expectKeyboardMenu = async (page, trigger) => {
    await page.mouse.move(1, 1);
    await trigger.press('ArrowDown');
    const menuId = await trigger.getAttribute('aria-controls');
    const menu = page.locator(`#${menuId}`);
    await expect(menu).toBeVisible();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(menu.locator('[role="option"][aria-selected="true"]')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(trigger).toBeFocused();
    await expectSharedHoverShadow(trigger);
};

const paintOutsideWrappers = (trigger) => trigger.evaluate((element) => {
    const identity = element.closest('.investment-stock-details-identity');
    const wrappers = [
        document.querySelector('#investment_view_surface'),
        document.querySelector('#investment_view_surface_body'),
        document.querySelector('#stock_panel'),
        document.querySelector('.investment-stock-details-overview'),
        document.querySelector('.investment-workspace-header'),
    ];
    if (!(identity instanceof HTMLElement) || wrappers.some((node) => !(node instanceof HTMLElement))) return null;
    const identityRect = identity.getBoundingClientRect();
    const triggerRect = element.getBoundingClientRect();
    const boundary = Math.min(...wrappers.map((node) => node.getBoundingClientRect().left));
    const x = boundary - 4;
    const y = (triggerRect.top + triggerRect.bottom) / 2;
    const probe = document.createElement('span');
    probe.style.cssText = `position: absolute; left: ${x - identityRect.left - 2}px; top: ${y - identityRect.top - 2}px; width: 4px; height: 4px; background: #0055cc; pointer-events: auto; z-index: 2147483000`;
    identity.append(probe);
    try {
        const rect = probe.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return {
            visible: hit === probe,
            outsideEveryWrapper: wrappers.every((node) => rect.right < node.getBoundingClientRect().left),
            withinViewport: rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight,
            point: {x, y},
            hit: hit ? `${hit.tagName}#${hit.id}.${hit.className}` : null,
        };
    } finally {
        probe.remove();
    }
});

for (const colorScheme of ['light', 'dark']) {
    for (const viewport of desktopViewports) {
        test.describe(`Stock-details effect bleed ${colorScheme} ${viewport.width}px`, () => {
            test.use({viewport, colorScheme});

            test('retains hover and focus ink beyond outer layout boundaries', async ({page}, testInfo) => {
                const trigger = await mockStockDetails(page);
                await recordAncestors(trigger, testInfo);
                await trigger.hover();
                await expectSharedHoverShadow(trigger);
                await page.screenshot({path: testInfo.outputPath('ticker-hover-effects.png')});

                // A hit-testable ink sentinel proves the boundary is not merely styled visible.
                const paint = await paintOutsideWrappers(trigger);
                expect(paint).not.toBeNull();
                expect(paint.withinViewport, JSON.stringify(paint)).toBe(true);
                expect(paint.outsideEveryWrapper, JSON.stringify(paint)).toBe(true);
                expect(paint.visible, JSON.stringify(paint)).toBe(true);
                const wrappers = await page.evaluate((selectors) => selectors.map((selector) => {
                    const style = getComputedStyle(document.querySelector(selector));
                    return {selector, x: style.overflowX, y: style.overflowY, contain: style.contain, clipPath: style.clipPath};
                }), effectWrappers);
                wrappers.forEach((wrapper) => {
                    expect(wrapper.x, wrapper.selector).toBe('visible');
                    expect(wrapper.y, wrapper.selector).toBe('visible');
                    expect(wrapper.contain, wrapper.selector).not.toMatch(/paint|strict|content/);
                    expect(wrapper.clipPath, wrapper.selector).toBe('none');
                });
                await expectKeyboardMenu(page, trigger);
                await expectNoHorizontalOverflow(page);
                await page.screenshot({path: testInfo.outputPath('ticker-keyboard-focus-effects.png')});
            });
        });
    }

    test.describe(`Stock-details short desktop ${colorScheme} 1024px`, () => {
        test.use({viewport: {width: 1024, height: 400}, colorScheme});

        test('retains workspace scrolling when chart and history minima exceed the viewport', async ({page}, testInfo) => {
            const trigger = await mockStockDetails(page);
            await recordAncestors(trigger, testInfo);
            const workspace = page.locator('.investment-workspace-header');
            await expect(workspace).toHaveCSS('overflow-y', 'auto');
            const scroll = await workspace.evaluate((element) => {
                const overflow = element.scrollHeight - element.clientHeight;
                element.scrollTop = Math.min(40, overflow);
                return {overflow, top: element.scrollTop};
            });
            expect(scroll.overflow).toBeGreaterThan(0);
            expect(scroll.top).toBeGreaterThan(0);
            await trigger.scrollIntoViewIfNeeded();
            await expectKeyboardMenu(page, trigger);
            await expectNoHorizontalOverflow(page);
            await page.screenshot({path: testInfo.outputPath('ticker-short-desktop-scroll.png')});
        });
    });

    test.describe(`Stock-details mobile scroll ${colorScheme} 390px`, () => {
        test.use({viewport: {width: 390, height: 844}, colorScheme});

        test('keeps the local scroll owner and keyboard menu usable', async ({page}, testInfo) => {
            const trigger = await mockStockDetails(page);
            await recordAncestors(trigger, testInfo);
            const panel = page.locator('#stock_panel');
            await expect(panel).toHaveCSS('overflow-y', 'auto');
            const scroll = await panel.evaluate((element) => {
                const overflow = element.scrollHeight - element.clientHeight;
                element.scrollTop = Math.min(40, overflow);
                return {overflow, top: element.scrollTop};
            });
            expect(scroll.overflow).toBeGreaterThan(0);
            expect(scroll.top).toBeGreaterThan(0);
            await trigger.scrollIntoViewIfNeeded();
            await trigger.hover();
            await expectSharedHoverShadow(trigger);
            await expectKeyboardMenu(page, trigger);
            await expectNoHorizontalOverflow(page);
            await page.screenshot({path: testInfo.outputPath('ticker-mobile-scroll-and-focus.png')});
        });
    });
}
