/* Code version: v1.0.4 */
import {test, expect} from '@playwright/test';

test('Backtest title shares the global control centerline and preserves compact result flow', async ({page}) => {
    test.setTimeout(90_000);
    await page.goto('/workspaces/backtest?ticker=DRAM&strategy=lstm-price-field&show_trade_details=0&compute_backend=CPU&lstm_epochs=1&lstm_lookback=4&lstm_hidden_size=4&training_window=40');
    const result = page.locator('.backtest-results-stack [data-layout-role="result-heading"]');
    await expect(result).toBeVisible();
    for (const width of [1276, 1021, 901, 900, 897, 768, 767, 687, 600, 390]) {
        await page.setViewportSize({width, height: 863});
        if (width <= 900) {
            const sidebarToggle = page.locator('#sidebar_toggle');
            if (await sidebarToggle.getAttribute('aria-expanded') === 'true') {
                await sidebarToggle.click();
            }
            await expect(sidebarToggle).toHaveAttribute('aria-expanded', 'false');
        }
        await expect.poll(async () => page.evaluate(() => {
            const rect = (selector) => document.querySelector(selector).getBoundingClientRect();
            const center = (selector) => {
                const box = rect(selector);
                return box.y + box.height / 2;
            };
            const top = center('[data-layout-role="title-heading"]');
            const result = rect('.backtest-results-stack [data-layout-role="result-heading"]');
            const main = document.querySelector('.backtest-workspace-main');
            const stack = rect('.trade-chart-stack');
            const stackStyle = getComputedStyle(document.querySelector('.trade-chart-stack'));
            const surfaceStyle = getComputedStyle(document.querySelector('#backtest_overview_panel > .backtest-surface'));
            const resizer = rect('#backtest_section_resizer');
            return {
                aligned: [
                    center('#sidebar_toggle'),
                    center('[data-layout-role="global-theme-anchor"]'),
                ].every(value => Math.abs(value - top) <= 1),
                desktopResultAligned: innerWidth <= 900
                    || Math.abs(result.y + result.height / 2 - top) <= 1,
                compactFlow: innerWidth > 900 || (getComputedStyle(main).transform === 'none' && result.y > top),
                chartVisible: stack.height > 0 && stack.width > 0,
                splitterBelowChart: resizer.y >= stack.bottom - 1,
                probabilityStackBottomPadding: stackStyle.paddingBottom,
                overviewInlinePadding: [surfaceStyle.paddingLeft, surfaceStyle.paddingRight],
                noHorizontalOverflow: document.documentElement.scrollWidth <= innerWidth,
            };
        })).toEqual({
            aligned: true,
            desktopResultAligned: true,
            compactFlow: true,
            chartVisible: true,
            splitterBelowChart: true,
            probabilityStackBottomPadding: '6px',
            overviewInlinePadding: ['6px', '6px'],
            noHorizontalOverflow: true,
        });
        if (width <= 900) {
            const toggle = page.locator('#backtest_parameter_toggle');
            for (const expanded of [true, false]) {
                await toggle.click();
                await expect(toggle).toHaveAttribute('aria-expanded', String(expanded));
                await expect.poll(() => page.evaluate(() => {
                    const rect = (selector) => document.querySelector(selector).getBoundingClientRect();
                    const global = rect('#sidebar_toggle');
                    const parameter = rect('#backtest_parameter_toggle');
                    const titleHeading = rect('[data-layout-role="title-heading"]');
                    const title = rect('[data-layout-role="title-heading"] .report-heading');
                    return {
                        gap: Math.round(parameter.left - global.right),
                        aligned: Math.abs(parameter.top - global.top) <= 1,
                        titleAligned: Math.abs(
                            titleHeading.y + titleHeading.height / 2
                            - (global.y + global.height / 2)
                        ) <= 1,
                        titleClear: title.left >= parameter.right + 9,
                    };
                })).toEqual({gap: 10, aligned: true, titleAligned: true, titleClear: true});
            }
        }
    }
});
