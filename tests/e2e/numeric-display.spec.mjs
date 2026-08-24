/* Browser contract for shared numeric typography. Code version: v1.1.1 */

import {test, expect} from '@playwright/test';

test('Style tokens and Font tokens use the shared integer/fraction display', async ({page}) => {
    await page.goto('/settings/style-tokens');

    const styleState = await page.evaluate(() => {
        const partClasses = (element) => Array.from(
            element?.querySelectorAll(':scope > .workspace-metric-value-major, :scope > .workspace-metric-value-minor, :scope > .workspace-metric-value-suffix') || [],
            (part) => part.className,
        );
        const workspaceMetric = document.querySelector(
            '[data-style-token-card="workspace-metric-value"] [data-numeric-display-value]',
        );
        const amountCells = Array.from(document.querySelectorAll('[data-numeric-display-cell]'))
            .filter((cell) => cell.querySelector('.workspace-metric-value-minor'));
        const tooltipValue = document.querySelector(
            '[data-style-token-card="tooltip"] [data-numeric-display-value]',
        );
        return {
            workspaceMetricParts: partClasses(workspaceMetric),
            amountCellCount: amountCells.length,
            tooltipParts: partClasses(tooltipValue),
            styleMetricOwnsFontScale: Array.from(
                document.querySelectorAll('[data-style-token-card="workspace-metric-value"] .style-token-name'),
            ).some((node) => node.textContent.trim() === '--font-numeric-fraction-scale'),
            styleMetricUsesAlias: Array.from(
                document.querySelectorAll('[data-style-token-card="workspace-metric-value"] .style-token-name'),
            ).some((node) => node.textContent.trim() === '--workspace-metric-decimal-scale'),
        };
    });

    expect(styleState.workspaceMetricParts).toEqual([
        'workspace-metric-value-major',
        'workspace-metric-value-minor',
        'workspace-metric-value-suffix',
    ]);
    expect(styleState.amountCellCount).toBeGreaterThanOrEqual(4);
    expect(styleState.tooltipParts).toEqual([
        'workspace-metric-value-major',
        'workspace-metric-value-minor',
    ]);
    expect(styleState.styleMetricOwnsFontScale).toBe(false);
    expect(styleState.styleMetricUsesAlias).toBe(true);

    await page.goto('/settings/font-tokens');
    const fontSamples = page.locator('.font-token-sample-numeric-fraction');
    await expect(fontSamples).toHaveCount(7);
    await expect(fontSamples.first().locator('.workspace-metric-value-major')).toHaveCount(1);
    await expect(fontSamples.first().locator('.workspace-metric-value-minor')).toHaveCount(1);

    const fontSampleState = await page.locator('.font-token-sample-text').evaluateAll((elements) => Object.fromEntries(
        elements.map((element) => [
            element.closest('.font-token-sample-row')?.querySelector('.font-token-sample-name')?.textContent.trim(),
            {
                previewToken: element.getAttribute('data-inline-font-size-token'),
                computedSize: getComputedStyle(element).fontSize,
            },
        ]),
    ));

    expect(fontSampleState['--font-size-7']).toEqual({
        previewToken: '--font-size-7',
        computedSize: '32px',
    });
    expect(fontSampleState['--font-size-8']).toEqual({
        previewToken: '--font-size-8',
        computedSize: '36px',
    });
    expect(fontSampleState['--font-metric-md']).toEqual({
        previewToken: '--font-metric-md',
        computedSize: '24px',
    });
    expect(fontSampleState['--font-metric-lg']).toEqual({
        previewToken: '--font-metric-lg',
        computedSize: '32px',
    });
    expect(fontSampleState['--font-metric-xl']).toEqual({
        previewToken: '--font-metric-xl',
        computedSize: '36px',
    });
    expect(fontSampleState['--font-metric-value']).toEqual({
        previewToken: '--font-metric-value',
        computedSize: '24px',
    });
    expect(fontSampleState['--font-numeric-fraction-scale']).toEqual({
        previewToken: '--font-metric-value',
        computedSize: '24px',
    });
});

test('Compare performance summary uses the shared integer/fraction display', async ({page}) => {
    await page.goto('/workspaces/compare?ticker=MSFT&ticker=AAPL&range=2y');

    const values = page.locator('#compare_summary_region .compare-percent-value');
    await expect(values).toHaveCount(4);
    const valueState = await values.evaluateAll((elements) => elements.map((element) => {
        const metrics = element.closest('.performance-metrics');
        const parts = Array.from(element.children);
        return {
            text: element.textContent.trim(),
            dataValue: element.getAttribute('data-numeric-display-value'),
            classes: parts.map((part) => part.className),
            majorFontSize: getComputedStyle(parts[0]).fontSize,
            minorFontSize: getComputedStyle(parts[1]).fontSize,
            decimalScale: getComputedStyle(metrics).getPropertyValue('--workspace-metric-decimal-scale-local').trim(),
            legacyParts: element.querySelectorAll('.compare-percent-major, .compare-percent-dot, .compare-percent-minor, .compare-percent-suffix').length,
        };
    }));

    valueState.forEach((value) => {
        expect(value.text).toMatch(/^[+-]?\d[\d,]*\.\d{2}%$/);
        expect(value.dataValue).toBe(value.text);
        expect(value.classes).toEqual([
            'workspace-metric-value-major',
            'workspace-metric-value-minor',
            'workspace-metric-value-suffix',
        ]);
        expect(Number.parseFloat(value.minorFontSize)).toBeLessThan(Number.parseFloat(value.majorFontSize));
        expect(value.decimalScale).toBe('0.76');
        expect(value.legacyParts).toBe(0);
    });
});
