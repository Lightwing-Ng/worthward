/* Code version: v1.0.0 */
import {expect, test} from '@playwright/test';

const EXPECTED_TOOL_NAMES = [
    'get_site_capabilities',
    'get_page_context',
    'navigate_to_site_target',
];

const installSiteToolsRecorder = async (page) => {
    await page.addInitScript(() => {
        window.__registeredSiteTools = [];
        Object.defineProperty(document, 'modelContext', {
            configurable: true,
            value: {
                async registerTool(definition) {
                    window.__registeredSiteTools.push(definition);
                },
            },
        });
    });
};

test('registers bounded Site tools and performs allowlisted navigation', async ({page}) => {
    await installSiteToolsRecorder(page);
    await page.goto('/settings/about');
    await expect.poll(
        () => page.evaluate(() => (
            window.__registeredSiteTools.map(({name}) => name)
        )),
    ).toEqual(EXPECTED_TOOL_NAMES);

    const contextResult = await page.evaluate(async () => {
        const tool = window.__registeredSiteTools.find(
            ({name}) => name === 'get_page_context',
        );
        return tool.execute({});
    });
    expect(contextResult).toMatchObject({
        ok: true,
        tool: 'get_page_context',
        contractVersion: '1.0.0',
        data: {
            siteId: 'antigravity',
            route: '/settings/about',
            matchingTarget: {id: 'settings'},
        },
        verification: {
            topLevelPage: true,
            contentFieldsRead: 0,
            bounded: true,
        },
    });

    const navigationResult = await page.evaluate(async () => {
        const tool = window.__registeredSiteTools.find(
            ({name}) => name === 'navigate_to_site_target',
        );
        return tool.execute({target: 'ticker_comparison'});
    });
    expect(navigationResult).toMatchObject({
        ok: true,
        effects: {
            pageNavigation: true,
            directPersistedDataMutation: false,
            pageLoadMayUseExistingDataFlows: true,
        },
        verification: {
            sameOrigin: true,
            allowlisted: true,
            navigationScheduled: true,
        },
    });
    await page.waitForURL('/workspaces/compare');
    await expect(page.locator('#agent_optimization_manifest')).toHaveCount(1);
    await expect.poll(
        () => page.evaluate(() => (
            window.__registeredSiteTools.map(({name}) => name)
        )),
    ).toEqual(EXPECTED_TOOL_NAMES);
});

test('keeps the normal narrow UI intact when Site tools are unavailable', async ({page}) => {
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.setViewportSize({width: 390, height: 844});
    await page.goto('/settings/about');

    await expect(page.locator('#agent_optimization_manifest')).toHaveCount(1);
    await expect(page.locator('#sidebar_toggle')).toBeVisible();
    await expect(page.locator('#workspace_panel')).toBeVisible();
    expect(await page.evaluate(() => (
        window.SHARED_AGENT_OPTIMIZATION.boot()
    ))).toMatchObject({
        status: 'unsupported',
        contractVersion: '1.0.0',
        registered: [],
        failed: [],
    });
    expect(pageErrors).toEqual([]);
});
