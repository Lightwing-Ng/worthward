/* Backtest shared control geometry regression. Code version: v1.0.0 */
import {expect, test} from '@playwright/test';

const backtestUrl = (
    '/workspaces/backtest?ticker=DRAM&strategy=lstm-price-field'
    + '&range=custom&period=1y&from=2026-04-02&to=2026-09-03'
    + '&show_trade_details=0&compute_backend=CPU&lstm_epochs=1'
    + '&lstm_lookback=4&lstm_hidden_size=4&training_window=40'
);

test('shared Backtest controls keep the sampled compact geometry', async ({page}) => {
    await page.setViewportSize({width: 1021, height: 863});
    const run = {
        id: 'lstm-geometry-aaaaaaaaaaaaaaaaaaaa',
        ticker: 'DRAM',
        period: '1y',
        status: 'completed',
        active: false,
        started_at: '2026-09-04T00:00:00Z',
        identifier: '260904(01)',
        accuracy_pct: 45,
        configuration: {
            ticker: 'DRAM', period: '1y', range: 'custom',
            from: '2026-04-02', to: '2026-09-03', interval: '1d',
            strategy: 'lstm-price-field', initial_capital: 10000,
            price_only: false, reinvest_dividends: false, stop_loss: true,
            show_trade_details: false,
            params: {
                cell_display_threshold: 2,
                training_window: 40,
                chip_window: 74,
                lstm_lookback: 4,
                lstm_hidden_size: 4,
                lstm_epochs: 1,
                lstm_learning_rate: 0.007,
                lstm_seed: 42,
                entry_probability: 60,
                compute_backend: 'CPU',
                use_capital_flow: false,
            },
        },
        files: [],
    };
    await page.route('**/api/lstm-training', (route) => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({success: true, protocol_version: 2, runs: [run]}),
    }));

    await page.goto(backtestUrl);
    const paramsPanel = page.locator('#trade_strategy_params_panel');
    await expect(paramsPanel).toBeVisible();

    const parametersSection = paramsPanel.locator('[data-collapse="parameters"]');
    if (!await parametersSection.locator('[data-strategy-param-key="training_window"]').isVisible()) {
        await parametersSection.locator(':scope > summary').click();
    }
    const factorsSection = paramsPanel.locator('[data-collapse="factors"]');
    if (!await factorsSection.locator('[data-strategy-param-key="use_capital_flow"]').isVisible()) {
        await factorsSection.locator(':scope > summary').click();
    }

    const geometry = await page.evaluate(() => {
        const read = (selector) => {
            const node = document.querySelector(selector);
            if (!(node instanceof HTMLElement)) throw new Error(`Missing geometry target: ${selector}`);
            const style = getComputedStyle(node);
            const rect = node.getBoundingClientRect();
            return {
                height: style.height,
                minHeight: style.minHeight,
                paddingTop: style.paddingTop,
                borderRadius: style.borderRadius,
                rectHeight: rect.height,
            };
        };
        return {
            startDate: read('.date-picker-grid:nth-of-type(1) .date-picker-field:nth-of-type(1) .date-picker-trigger-value'),
            endDate: read('.date-picker-grid:nth-of-type(1) .date-picker-field:nth-of-type(2) .date-picker-trigger-value'),
            trainingWindow: read('[data-strategy-param-key="training_window"]'),
            computeBackend: read('[data-strategy-param-key="compute_backend"]'),
            capitalFlow: read('[data-strategy-param-key="use_capital_flow"]'),
            history: read('.lstm-training-history-select'),
        };
    });
    for (const date of [geometry.startDate, geometry.endDate]) {
        expect(date.minHeight).toBe('30px');
        expect(date.rectHeight).toBe(30);
    }
    for (const row of [geometry.trainingWindow, geometry.computeBackend, geometry.capitalFlow]) {
        expect(row.height).toBe('36px');
        expect(row.minHeight).toBe('36px');
        expect(row.rectHeight).toBe(36);
    }
    expect(geometry.trainingWindow.paddingTop).toBe('0px');
    expect(geometry.history.borderRadius).toBe('999px');
});
