/* Code version: v2.0.0 */
import {expect, test} from '@playwright/test';

test('uses the operating-system stack without downloading interface fonts', async ({page, context}) => {
    await page.goto('/settings/about');
    await page.evaluate(() => document.fonts.ready);

    const heading = page.locator('.about-heading').first();
    await expect(heading).toHaveText('What this service does');
    const computedFamily = await heading.evaluate((element) => getComputedStyle(element).fontFamily);
    expect(computedFamily).toMatch(/BlinkMacSystemFont|system-ui/);
    for (const forbidden of ['GDS Transport', 'Univers Next for HSBC', 'Inter']) {
        expect(computedFamily).not.toContain(forbidden);
    }

    const cdp = await context.newCDPSession(page);
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    const documentNode = await cdp.send('DOM.getDocument');
    const headingNode = await cdp.send('DOM.querySelector', {
        nodeId: documentNode.root.nodeId,
        selector: '.about-heading',
    });
    const {fonts} = await cdp.send('CSS.getPlatformFontsForNode', {nodeId: headingNode.nodeId});
    expect(fonts.length).toBeGreaterThan(0);
    expect(fonts.every((font) => !font.isCustomFont)).toBe(true);

    const fontResources = await page.evaluate(() => performance.getEntriesByType('resource')
        .map((entry) => new URL(entry.name).pathname)
        .filter((pathname) => pathname.includes('/assets/fonts/')));
    expect(fontResources).toEqual([]);
});
