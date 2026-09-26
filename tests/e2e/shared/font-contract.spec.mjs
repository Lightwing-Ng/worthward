/* Code version: v3.1.1 */
import {expect, test} from '@playwright/test';

test('uses the approved Univers Next source for Western interface text', async ({page, context}) => {
    await page.goto('/settings/about');
    await page.evaluate(() => document.fonts.ready);

    const heading = page.locator('.about-heading').first();
    await expect(heading).toHaveText('What this service does');
    const computedFamily = await heading.evaluate((element) => getComputedStyle(element).fontFamily);
    expect(computedFamily).toContain('Univers Next for HSBC');
    for (const forbidden of [
        'GDS Transport', 'Helvetica', 'Arial', 'Inter', 'SF Pro', 'Menlo', 'Monaco',
        'system-ui', 'BlinkMacSystemFont',
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
        .filter((pathname) => pathname.includes('/assets/fonts/')));
    expect(fontResources).toContain('/static/assets/fonts/UniversNextforHSBC-Regular.ttf');
    expect(fontResources.every((pathname) => pathname.endsWith('.ttf'))).toBe(true);

    await page.goto('/settings/style-tokens');
    await page.evaluate(() => document.fonts.ready);
    const technicalText = page.locator('.style-token-name').first();
    await expect(technicalText).toBeVisible();
    expect(await technicalText.evaluate((element) => getComputedStyle(element).fontFamily))
        .toContain('Univers Next for HSBC');

    const styleTokenDocument = await cdp.send('DOM.getDocument');
    const technicalNode = await cdp.send('DOM.querySelector', {
        nodeId: styleTokenDocument.root.nodeId,
        selector: '.style-token-name',
    });
    const {fonts: technicalFonts} = await cdp.send('CSS.getPlatformFontsForNode', {
        nodeId: technicalNode.nodeId,
    });
    expect(technicalFonts.length).toBeGreaterThan(0);
    expect(technicalFonts.every((font) => font.isCustomFont)).toBe(true);
    expect(technicalFonts.every((font) => font.familyName === 'Univers Next for HSBC')).toBe(true);

    const chartFontContract = await page.evaluate(() => {
        const tokenFamily = getComputedStyle(document.documentElement)
            .getPropertyValue('--font-family-base')
            .trim() || getComputedStyle(document.body).fontFamily.trim();
        const canvas = document.createElement('canvas');
        const chart = new Chart(canvas, {
            type: 'line',
            data: {labels: ['A', 'B'], datasets: [{data: [1, 2]}]},
            options: {animation: false, responsive: false},
        });
        const resolved = {
            defaultFamily: Chart.defaults.font.family,
            tokenFamily,
            chartFamily: chart.options.font.family,
            xTickFamily: chart.scales.x._resolveTickFontOptions(0).family,
        };
        chart.destroy();
        return resolved;
    });
    expect(chartFontContract.defaultFamily).toBe(chartFontContract.tokenFamily);
    expect(chartFontContract.chartFamily).toBe(chartFontContract.tokenFamily);
    expect(chartFontContract.xTickFamily).toBe(chartFontContract.tokenFamily);
    expect(chartFontContract.defaultFamily).toContain('Univers Next for HSBC');
    expect(chartFontContract.defaultFamily).not.toContain('Helvetica');
    expect(chartFontContract.defaultFamily).not.toContain('Arial');
});
