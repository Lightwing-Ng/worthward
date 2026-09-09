/* Code version: v0.5.3 */
import {expect, test} from '@playwright/test';

const MEMORY_KEY = 'worthward:backtest-strategy-params:v1';

const readRememberedValue = async (page, strategyId, key) => page.evaluate(
    ({key: storageKey, strategyId: storedStrategyId, paramKey}) => {
        const memory = JSON.parse(window.localStorage.getItem(storageKey) || '{}');
        return memory?.[storedStrategyId]?.[paramKey] || null;
    },
    {key: MEMORY_KEY, strategyId, paramKey: key},
);

test('remembers Backtest parameters per strategy and gives explicit URLs precedence', async ({page}) => {
    await page.setViewportSize({width: 1024, height: 900});
    await page.goto('/workspaces/backtest?ticker=TQQQ&range=3y&strategy=grid-trading&stop_loss=0');
    await expect(page.locator('#tradePriceChart')).toBeVisible();
    await page.evaluate((key) => window.localStorage.removeItem(key), MEMORY_KEY);

    const gridMaximum = page.locator('#strategy_param_holding_max');
    await gridMaximum.fill('500');
    await gridMaximum.blur();
    await expect.poll(() => readRememberedValue(page, 'grid-trading', 'holding_max')).toBe('500');

    await page.goto('/workspaces/backtest?ticker=TQQQ&range=3y&strategy=dca&stop_loss=0');
    await expect(page.locator('#tradePriceChart')).toBeVisible();
    const dcaAmount = page.locator('#strategy_param_amount');
    await dcaAmount.fill('2340');
    await dcaAmount.blur();
    await expect.poll(() => readRememberedValue(page, 'dca', 'amount')).toBe('2340.0');

    await page.goto('/workspaces/backtest?ticker=TQQQ&range=3y&strategy=grid-trading&stop_loss=0');
    await expect(page.locator('#strategy_param_holding_max')).toHaveValue('500');
    await expect(page.locator('#strategy_param_amount')).toHaveCount(0);

    await page.goto('/workspaces/backtest?ticker=TQQQ&range=3y&strategy=grid-trading&stop_loss=0&holding_max=789');
    await expect(page.locator('#strategy_param_holding_max')).toHaveValue('789');
    await expect.poll(() => readRememberedValue(page, 'grid-trading', 'holding_max')).toBe('500');
});

test('Leveraged Rotation exposes dynamic ticker labels and a collision-safe allocation band', async ({page}) => {
    await page.setViewportSize({width: 1023, height: 1404});
    await page.goto('/workspaces/backtest?range=2y&strategy=leveraged-rotation&capital=10000&stop_loss=1'
        + '&initial_primary_pct=44.2&initial_leveraged_pct=36.3');
    await expect(page.locator('#tradePriceChart')).toBeVisible();
    await page.getByText('Rotation triggers (%, change)', {exact: true}).click();
    const returnWindow = page.locator('[data-strategy-param-key="rotation_window"]');
    await returnWindow.locator('[data-shared-select-trigger]').click();
    await page.getByRole('option', {name: '1 month', exact: true}).click();
    await expect(page).toHaveURL(/rotation_window=1m/);
    await expect(page.locator('#strategy_param_rotation_window')).toHaveValue('1m');
    await expect(returnWindow.locator('[data-shared-select-trigger-label]')).toHaveText('1 month');
    const windowLabel = returnWindow.locator('[data-shared-select-trigger-label]');
    expect(await windowLabel.evaluate((label) => label.scrollWidth <= label.clientWidth)).toBe(true);
    const contentWidths = await returnWindow.evaluate((field) => {
        const trigger = field.querySelector('[data-shared-select-trigger]');
        const label = field.querySelector('[data-shared-select-trigger-label]');
        const original = label.textContent;
        const widths = ['A', 'AB', 'ABCDEFGHIJK'].map((text) => {
            label.textContent = text;
            return trigger.getBoundingClientRect().width;
        });
        label.textContent = original;
        return {
            widths,
            fieldRight: field.getBoundingClientRect().right,
            triggerRight: trigger.getBoundingClientRect().right,
            unusedInline: trigger.getBoundingClientRect().width - label.scrollWidth,
        };
    });
    expect(contentWidths.widths[0]).toBeLessThan(contentWidths.widths[1]);
    expect(contentWidths.widths[1]).toBeLessThan(contentWidths.widths[2]);
    expect(Math.abs(contentWidths.fieldRight - contentWidths.triggerRight)).toBeLessThan(0.1);
    expect(contentWidths.unusedInline).toBeLessThanOrEqual(42);
    const wrappedFieldLabel = await returnWindow.evaluate((field) => {
        const labelText = field.querySelector('[data-strategy-param-label-text]');
        const trigger = field.querySelector('[data-shared-select-trigger]');
        const original = labelText.textContent;
        labelText.textContent = 'Field text that intentionally occupies two lines';
        const labelBox = labelText.getBoundingClientRect();
        const triggerBox = trigger.getBoundingClientRect();
        const lineHeight = Number.parseFloat(getComputedStyle(labelText).lineHeight);
        labelText.textContent = original;
        return {
            height: labelBox.height,
            lineHeight,
            labelRight: labelBox.right,
            triggerLeft: triggerBox.left,
        };
    });
    expect(wrappedFieldLabel.height).toBeGreaterThan(wrappedFieldLabel.lineHeight * 1.5);
    expect(wrappedFieldLabel.labelRight).toBeLessThanOrEqual(wrappedFieldLabel.triggerLeft);
    await page.getByText('Initial allocation', {exact: true}).click();

    const allocation = page.locator('[data-strategy-allocation-range]');
    await expect(allocation).toBeVisible();
    await expect(page.locator('.strategy-factor-group--allocation-visual > .ui-collapse-body').first())
        .toHaveCSS('padding-bottom', '0px');
    await expect(allocation.locator('.strategy-allocation-track-shell')).toHaveCSS('height', '30px');
    await expect(page.getByText('Allocation limits (%, equity)', {exact: true})).toBeVisible();
    await expect(page.getByText('Rotation triggers (%, change)', {exact: true})).toBeVisible();
    await expect(page.getByRole('slider', {name: 'QQQ minimum', exact: true, includeHidden: true})).toBeAttached();
    await expect(page.getByRole('slider', {name: 'QQQ maximum', exact: true, includeHidden: true})).toBeAttached();
    await expect(page.getByRole('slider', {name: 'TQQQ minimum', exact: true, includeHidden: true})).toBeAttached();
    await expect(page.getByRole('slider', {name: 'TQQQ maximum', exact: true, includeHidden: true})).toBeAttached();
    await expect(page.getByText('Return window', {exact: true})).toBeAttached();
    await expect(page.getByText('QQQ drop trigger', {exact: true})).toBeAttached();
    await expect(page.getByText('TQQQ rise trigger', {exact: true})).toBeAttached();
    await expect(page.locator('#strategy_param_primary_min_pct')).toHaveValue('20');
    await expect(page.locator('#strategy_param_primary_max_pct')).toHaveValue('95');
    await expect(page.locator('#strategy_param_buy_leveraged_drop_pct')).toHaveValue('3.00');
    await expect(page.locator('#strategy_param_sell_leveraged_rise_pct')).toHaveValue('5.00');
    await expect(allocation.locator('[data-allocation-primary-name]')).toHaveText('QQQ');
    await expect(allocation.locator('[data-allocation-leveraged-name]')).toHaveText('TQQQ');
    await expect(allocation.locator('[data-allocation-primary-value]')).toHaveText('44.20%');
    await expect(allocation.locator('[data-allocation-leveraged-value]')).toHaveText('36.30%');
    await expect(allocation.locator('[data-allocation-cash-value]')).toHaveText(/^[\d,]+\.\d{2}$/);
    await expect(allocation).not.toContainText(/\d[\d,]* sh\b/);
    await expect(allocation.locator('[data-allocation-cash-label]')).not.toContainText('%');
    const allocationTypography = await allocation.evaluate((element) => ({
        names: Array.from(element.querySelectorAll('.strategy-allocation-label-name'))
            .map((node) => getComputedStyle(node).fontSize),
        values: Array.from(element.querySelectorAll('.strategy-allocation-label-value'))
            .map((node) => getComputedStyle(node).fontSize),
    }));
    expect(allocationTypography.names).toEqual(['15px', '15px', '15px']);
    expect(allocationTypography.values).toEqual(['11px', '11px', '11px']);

    const segmentColors = await allocation.evaluate((element) => {
        const tokenColor = (name) => {
            const probe = document.createElement('span');
            probe.style.color = `var(${name})`;
            document.body.append(probe);
            const color = getComputedStyle(probe).color;
            probe.remove();
            return color;
        };
        const background = (selector) => getComputedStyle(element.querySelector(selector)).backgroundColor;
        return {
            actual: [
                background('[data-allocation-primary-segment]'),
                background('[data-allocation-leveraged-segment]'),
                background('[data-allocation-cash-segment]'),
            ],
            expected: [
                tokenColor('--theme-accent-primary'),
                tokenColor('--theme-accent-secondary'),
                tokenColor('--theme-accent-positive'),
            ],
        };
    });
    expect(segmentColors.actual).toEqual(segmentColors.expected);

    const expectAlignedBoundaries = async () => {
        const errors = await allocation.evaluate((element) => {
            const segment = element.querySelector('[data-allocation-leveraged-segment]').getBoundingClientRect();
            return ['primary', 'invested'].map((boundary, index) => {
                const input = element.querySelector(`[data-allocation-boundary="${boundary}"]`);
                const box = input.getBoundingClientRect();
                const fraction = (Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min));
                const center = box.left + 5 + fraction * (box.width - 10);
                return Math.abs(center - (index === 0 ? segment.left : segment.right));
            });
        });
        errors.forEach((error) => expect(error).toBeLessThan(0.1));
    };
    await expectAlignedBoundaries();

    await allocation.locator('[data-allocation-boundary="primary"]').evaluate((input) => {
        input.value = '55.25';
        input.dispatchEvent(new Event('input', {bubbles: true}));
    });
    await expect(allocation.locator('[name="initial_primary_pct"]')).toHaveValue('55.25');
    await expect(allocation.locator('[name="initial_leveraged_pct"]')).toHaveValue('25.25');
    await expect(allocation.locator('[data-allocation-boundary="primary"]')).toHaveAttribute('max', '100');
    await expect(allocation.locator('[data-allocation-boundary="invested"]')).toHaveAttribute('min', '0');
    expect(await allocation.evaluate((element) => element.style.getPropertyValue('--allocation-cash'))).toBe('19.5%');
    await allocation.locator('[data-allocation-boundary="invested"]').evaluate((input) => {
        input.value = '88.88';
        input.dispatchEvent(new Event('input', {bubbles: true}));
    });
    await expect(allocation.locator('[name="initial_primary_pct"]')).toHaveValue('55.25');
    await expect(allocation.locator('[name="initial_leveraged_pct"]')).toHaveValue('33.63');
    await expect(allocation.locator('[data-allocation-primary-value]')).toHaveText('55.25%');
    await expect(allocation.locator('[data-allocation-leveraged-value]')).toHaveText('33.63%');
    await expectAlignedBoundaries();
    const integerPreview = await allocation.evaluate((element) => ({
        primaryShares: element.dataset.allocationPrimaryShares,
        leveragedShares: element.dataset.allocationLeveragedShares,
        cash: element.dataset.allocationCash,
    }));
    expect(integerPreview.primaryShares).toMatch(/^\d+$/);
    expect(integerPreview.leveragedShares).toMatch(/^\d+$/);
    expect(integerPreview.cash).toMatch(/^\d+\.\d{2}$/);

    await page.locator('[data-backtest-ticker-fields] [data-ticker-input]').evaluateAll((inputs) => {
        inputs[0].value = 'SPY';
        inputs[0].dispatchEvent(new Event('input', {bubbles: true}));
        inputs[1].value = 'UPRO';
        inputs[1].dispatchEvent(new Event('input', {bubbles: true}));
    });
    await expect(page.getByRole('slider', {name: 'SPY minimum', exact: true, includeHidden: true})).toBeAttached();
    await expect(page.getByRole('slider', {name: 'UPRO maximum', exact: true, includeHidden: true})).toBeAttached();
    await expect(page.getByText('SPY drop trigger', {exact: true})).toBeAttached();
    await expect(page.getByText('UPRO rise trigger', {exact: true})).toBeAttached();
    await expect(allocation.locator('[data-allocation-primary-name]')).toHaveText('SPY');
    await expect(allocation.locator('[data-allocation-leveraged-name]')).toHaveText('UPRO');

    await page.setViewportSize({width: 390, height: 844});
    await expect(allocation).toBeVisible();
    await expectAlignedBoundaries();
    await expect.poll(() => allocation.locator('[data-allocation-cash-label]')
        .getAttribute('data-allocation-label-position')).not.toBeNull();
    const [allocationBox, panelBox, labelBoxes] = await Promise.all([
        allocation.boundingBox(), page.locator('[data-trade-strategy-panel]').boundingBox(),
        allocation.locator('.strategy-allocation-label').evaluateAll((labels) => labels.map((label) => {
            const box = label.getBoundingClientRect();
            return {left: box.left, right: box.right};
        })),
    ]);
    expect(allocationBox.x).toBeGreaterThanOrEqual(panelBox.x);
    expect(allocationBox.x + allocationBox.width).toBeLessThanOrEqual(panelBox.x + panelBox.width + 1);
    expect(labelBoxes[0].right + 5).toBeLessThanOrEqual(labelBoxes[1].left);
    expect(labelBoxes[1].right + 5).toBeLessThanOrEqual(labelBoxes[2].left);

    await page.setViewportSize({width: 1017, height: 1346});
    await page.goto(`${page.url()}&ticker=QQQ&ticker=TQQQ`);
    await expect(page.locator('#tradePriceChart')).toBeVisible();
    await page.getByText('Initial allocation', {exact: true}).click();
    for (const [primary, leveraged] of [[0, 0], [50, 0], [60, 40], [100, 0]]) {
        await allocation.evaluate((element, values) => {
            element.querySelector('[name="initial_primary_pct"]').value = String(values[0]);
            element.querySelector('[name="initial_leveraged_pct"]').value = String(values[1]);
            document.getElementById('trade_initial_capital').dispatchEvent(new Event('input', {bubbles: true}));
        }, [primary, leveraged]);
        const thumbs = await allocation.locator('input[type="range"]').evaluateAll((inputs) => inputs.map((input) => {
            const rect = input.getBoundingClientRect();
            return {y: rect.y, value: Number(input.value)};
        }));
        expect(thumbs.map((thumb) => thumb.value)).toEqual([primary, primary + leveraged]);
        await expectAlignedBoundaries();
        if (leveraged === 0) expect(Math.abs(thumbs[0].y - thumbs[1].y)).toBeGreaterThanOrEqual(22);
    }
    await page.setViewportSize({width: 1014, height: 1388});
    await page.getByText('Allocation limits (%, equity)', {exact: true}).click();
    const limits = page.locator('[data-strategy-allocation-limits]');
    await expect(limits).toBeVisible();
    await expect(limits.locator('xpath=..')).toHaveCSS('padding-bottom', '0px');
    expect(await limits.locator('.strategy-allocation-track-shell').evaluateAll((tracks) => (
        tracks.map((track) => getComputedStyle(track).height)
    ))).toEqual(['30px', '30px']);
    const barGeometry = await page.locator(
        '[data-strategy-allocation-range], [data-limit-range]',
    ).evaluateAll((bars) => bars.map((bar) => {
        const box = bar.getBoundingClientRect();
        const track = bar.querySelector('.strategy-allocation-track-shell').getBoundingClientRect();
        return {
            top: box.top,
            bottom: box.bottom,
            trackTop: track.top,
            trackBottom: track.bottom,
            interactiveHandles: [...bar.querySelectorAll('input[type="range"]')]
                .every((input) => input.getBoundingClientRect().height > 0),
        };
    }));
    expect(barGeometry).toHaveLength(3);
    for (let index = 1; index < barGeometry.length; index += 1) {
        expect(barGeometry[index - 1].bottom).toBeLessThanOrEqual(barGeometry[index].top);
    }
    for (const geometry of barGeometry) {
        expect(geometry.trackTop).toBeGreaterThanOrEqual(geometry.top);
        expect(geometry.trackBottom).toBeLessThanOrEqual(geometry.bottom);
        expect(geometry.interactiveHandles).toBe(true);
    }
    await page.setViewportSize({width: 1017, height: 1346});
    await page.locator('[data-trade-strategy-panel]').screenshot({path: '/tmp/worthward-allocation-limits.png', animations: 'disabled'});
    expect(await allocation.locator('input[type="range"]').evaluateAll((inputs) => inputs.map((input) => getComputedStyle(input).padding))).toEqual(['0px', '0px']);
    await limits.locator('[name="primary_min_pct"]').evaluate((input) => {
        input.value = '100'; input.dispatchEvent(new Event('input', {bubbles: true}));
    });
    await expect(limits.locator('[name="leveraged_min_pct"]')).toHaveValue('0');
    await expect(limits.locator('[name="leveraged_max_pct"]')).toHaveValue('0');
    await expect(limits.locator('[name="primary_max_pct"]')).toHaveValue('100');
    await limits.locator('[name="primary_max_pct"]').evaluate((input) => {
        input.value = '0'; input.dispatchEvent(new Event('input', {bubbles: true}));
    });
    await expect(limits.locator('[name="primary_min_pct"]')).toHaveValue('0');
    await expect(limits.locator('.has-close-handles')).toHaveCount(2);
    await limits.locator('[name="primary_max_pct"]').dispatchEvent('change');
    await expect(page).toHaveURL(/primary_max_pct=0(?:\.00)?(?:&|$)/);
    await expect(page.locator('[name="primary_max_pct"]')).toHaveValue('0');
    await expect(page.locator('#tradePriceChart')).toBeVisible();
});
