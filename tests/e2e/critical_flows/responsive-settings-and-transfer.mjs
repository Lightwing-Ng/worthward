/* Code version: v1.0.1 */
import {
    expect,
    test,
    readFile,
    openBacktestParameterOverlay,
    fixturePath,
    requireChipFallback,
    setSidebarExpanded,
    tapAtCenter,
    readPriceLogoThemeAlignment,
    recordCostDistributionGuideStrokes,
    fulfillInertPriceLiveResponse,
    mockInvestmentReadApis,
    assertCompleteStandardInvestmentExportPayload,
} from './support.mjs';
const responsiveViewports = [
    {name: 'iPhone SE', width: 375, height: 667, overlaySidebar: true},
    {name: 'iPhone 15 Pro', width: 393, height: 852, overlaySidebar: true},
    {name: 'iPad mini portrait', width: 744, height: 1133, overlaySidebar: true},
    {name: 'annotated tablet portrait', width: 753, height: 1355, overlaySidebar: true},
    {name: 'iPad portrait', width: 768, height: 1024, overlaySidebar: true},
    {name: 'iPad Air portrait', width: 820, height: 1180, overlaySidebar: true},
    {name: 'iPad Pro 11 portrait', width: 834, height: 1194, overlaySidebar: true},
    {name: 'iPad landscape', width: 1024, height: 768, overlaySidebar: false},
    {name: 'iPad Pro portrait', width: 1024, height: 1366, overlaySidebar: false},
    {name: 'MacBook Pro 14', width: 1512, height: 982, overlaySidebar: false},
    {name: 'MacBook Pro 16', width: 1728, height: 1117, overlaySidebar: false},
];

for (const viewport of responsiveViewports) {
    test(`keeps the settings workspace operable at ${viewport.name}`, async ({page}) => {
        await page.setViewportSize({width: viewport.width, height: viewport.height});
        await page.goto('/settings/about');

        const layout = await page.evaluate(() => {
            const root = document.documentElement;
            const toggle = document.querySelector('#sidebar_toggle')?.getBoundingClientRect();
            const theme = document.querySelector('#global_theme_toggle')?.getBoundingClientRect();
            const sidebarTitle = document.querySelector('#app_sidebar .hero h1')?.getBoundingClientRect();
            const pageTitle = document.querySelector('.settings-summary-card .report-heading')?.getBoundingClientRect();
            const workspace = document.querySelector('.workspace')?.getBoundingClientRect();
            const dockLabels = [...document.querySelectorAll('.sidebar-dock-label')];
            const centerY = (rect) => rect ? rect.top + (rect.height / 2) : null;
            return {
                overflowX: root.scrollWidth > window.innerWidth + 1,
                sidebarExpanded: document.querySelector('#sidebar_toggle')?.getAttribute('aria-expanded'),
                toggle: toggle ? {width: toggle.width, height: toggle.height, left: toggle.left, right: toggle.right} : null,
                titleCenterDelta: pageTitle && toggle ? Math.abs(centerY(pageTitle) - centerY(toggle)) : null,
                sidebarCenterDelta: sidebarTitle && toggle ? Math.abs(centerY(sidebarTitle) - centerY(toggle)) : null,
                themeCenterDelta: pageTitle && theme ? Math.abs(centerY(pageTitle) - centerY(theme)) : null,
                workspace: workspace ? {width: workspace.width, left: workspace.left, right: workspace.right} : null,
                dockLabels: dockLabels.map((label) => ({
                    group: label.closest('[data-dock-group]')?.dataset.dockGroup || '',
                    text: label.textContent.trim(),
                    visible: getComputedStyle(label).display !== 'none',
                })),
            };
        });

        expect(layout.overflowX).toBe(false);
        expect(layout.toggle).not.toBeNull();
        expect(layout.workspace).not.toBeNull();
        expect(layout.toggle.left).toBeGreaterThanOrEqual(0);
        expect(layout.toggle.right).toBeLessThanOrEqual(viewport.width);
        expect(layout.workspace.right).toBeLessThanOrEqual(viewport.width);
        expect(layout.workspace.width).toBeGreaterThanOrEqual(
            viewport.overlaySidebar ? viewport.width - 24 : (viewport.workspaceMinWidth || 400),
        );
        expect(layout.sidebarExpanded).toBe(viewport.overlaySidebar ? 'false' : 'true');
        const dockGroups = layout.dockLabels.map((label) => label.group);
        expect(dockGroups).toEqual(dockGroups.includes('beta')
            ? ['workspace', 'trade', 'beta', 'settings']
            : ['workspace', 'trade', 'settings']);
        expect(layout.dockLabels.every((label) => label.text.length > 0)).toBe(true);
        expect(layout.dockLabels.every((label) => !label.visible)).toBe(true);
        if (viewport.overlaySidebar) {
            expect(layout.toggle.width).toBeGreaterThanOrEqual(44);
            expect(layout.toggle.height).toBeGreaterThanOrEqual(44);
        } else if (viewport.width >= 768) {
            expect(layout.titleCenterDelta).toBeLessThanOrEqual(1);
            expect(layout.sidebarCenterDelta).toBeLessThanOrEqual(1);
            expect(layout.themeCenterDelta).toBeLessThanOrEqual(1);
        }
    });
}

test('reserves persisted transfer targets when their owning broker is filtered out', async ({page}) => {
    const sourceKey = 'v2:["ibkr","ibkr:u-suffix:99999","2026-06-20","deposit","CNH","1500"]';
    const targetKey = 'v2:["boc_hk","TEST","2026-06-20","withdrawal","CNH","-1500"]';
    await mockInvestmentReadApis(page, {
        brokers: ['hsbc', 'ibkr', 'boc_hk'],
        transactions: [
            {broker: 'hsbc', account: 'TEST', date: '2026-06-20', type: 'deposit', currency: 'CNH', amount: 1490, description: 'Unrelated savings receipt'},
            {broker: 'boc_hk', account: 'TEST', date: '2026-06-20', type: 'withdrawal', currency: 'CNH', amount: -1500},
            {broker: 'ibkr', account: 'U999999', date: '2026-06-20', type: 'deposit', currency: 'CNH', amount: 1500},
        ],
        manualInternalTransferBindings: {[sourceKey]: targetKey},
        fxRateHistoryByCurrency: {CNH: {dates: ['2026-06-20'], values: {'2026-06-20': 7}}},
        intradayRows: () => [],
    });
    for (const broker of ['hsbc,boc_hk', 'hsbc,boc_hk,ibkr']) {
        await page.goto(`/trade/investment?view=holdings&broker=${broker}`);
        const receipt = page.locator('[id^="investment_history_row_"]').filter({hasText: 'Unrelated savings receipt'});
        await expect(receipt).toHaveCount(1);
        await expect(receipt.locator('select[data-investment-transfer-source-key]')).toHaveCount(0);
    }
});
