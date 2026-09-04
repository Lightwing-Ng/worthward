/* Code version: v1.0.1 */
import {test, expect} from '@playwright/test';

test('Backtest result title shares the desktop centerline and preserves compact flow', async ({page}) => {
    await page.goto('/workspaces/backtest?ticker=DRAM&strategy=lstm-price-field&show_trade_details=0&compute_backend=CPU&lstm_epochs=1&lstm_lookback=4&lstm_hidden_size=4&training_window=40');
    const result = page.locator('.backtest-results-stack [data-layout-role="result-heading"]');
    await expect(result).toBeVisible();
    for (const width of [1276, 1021, 900, 768, 390]) {
        await page.setViewportSize({width, height: 863});
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
                aligned: innerWidth < 768 || [
                    center('#sidebar_toggle'),
                    center('[data-layout-role="global-theme-anchor"]'),
                    result.y + result.height / 2,
                ].every(value => Math.abs(value - top) <= 1),
                compactFlow: innerWidth >= 768 || (getComputedStyle(main).transform === 'none' && result.y > top),
                chartVisible: stack.height > 0 && stack.width > 0,
                splitterBelowChart: resizer.y >= stack.bottom - 1,
                probabilityStackBottomPadding: stackStyle.paddingBottom,
                overviewInlinePadding: [surfaceStyle.paddingLeft, surfaceStyle.paddingRight],
                noHorizontalOverflow: document.documentElement.scrollWidth <= innerWidth,
            };
        })).toEqual({
            aligned: true,
            compactFlow: true,
            chartVisible: true,
            splitterBelowChart: true,
            probabilityStackBottomPadding: '4px',
            overviewInlinePadding: ['6px', '6px'],
            noHorizontalOverflow: true,
        });
    }
});
