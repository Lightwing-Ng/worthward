/* Code version: v1.0.0 */
import {expect, test} from '@playwright/test';

test('uses the approved Univers Next source for Latin interface text', async ({page, context}) => {
    await page.goto('/settings/about');
    await page.evaluate(() => document.fonts.ready);

    const heading = page.locator('.about-heading').first();
    await expect(heading).toHaveText('What this service does');
    const computedFamily = await heading.evaluate((element) => getComputedStyle(element).fontFamily);
    expect(computedFamily).toContain('Univers Next for HSBC');
    for (const forbidden of [
        'GDS Transport', 'Helvetica', 'Arial', 'Inter', 'SF Pro', 'Menlo', 'Monaco', 'system-ui',
    ]) {
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
    expect(fonts.every((font) => font.isCustomFont)).toBe(true);
    expect(fonts.every((font) => font.familyName === 'Univers Next for HSBC')).toBe(true);
    expect(fonts.some((font) => font.postScriptName === 'UniversNextforHSBC-Regular')).toBe(true);
    expect(fonts.every((font) => font.postScriptName !== 'UniversNextforHSBC-Bold')).toBe(true);

    const fontResources = await page.evaluate(() => performance.getEntriesByType('resource')
        .map((entry) => new URL(entry.name).pathname)
        .filter((pathname) => pathname.includes('/assets/fonts/UniversNextforHSBC')));
    expect(fontResources).toContain('/static/assets/fonts/UniversNextforHSBC-Regular.ttf');
    expect(fontResources.every((pathname) => pathname.endsWith('.ttf'))).toBe(true);
});
