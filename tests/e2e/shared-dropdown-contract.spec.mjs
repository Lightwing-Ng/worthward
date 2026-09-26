/* Code version: v0.3.0 */
import {expect, test} from '@playwright/test';

const assertNoVisibleNativeSelects = async (page) => {
    await expect(page.locator('select:visible')).toHaveCount(0);
};

const assertOptionMarkup = async (page, dropdownSelector) => {
    const optionChildren = await page.locator(`${dropdownSelector} [role="option"]`).evaluateAll((options) => (
        options.map((option) => Array.from(option.children).map((child) => child.className))
    ));
    expect(optionChildren.length).toBeGreaterThan(0);
    expect(optionChildren.every((children) => (
        children.length === 2
        && children[0] === 'trade-strategy-dropdown-check'
        && children[1] === 'trade-strategy-dropdown-text'
    ))).toBe(true);
};

test('reuses the shared dropdown contract across workspace selectors', async ({page}) => {
    await page.goto('/workspaces/prices?metric=market-cap&ticker=AAPL&ticker=NVDA&period=1y');
    await assertNoVisibleNativeSelects(page);

    const periodField = page.locator('#period_panel [data-shared-select-field]');
    await expect(periodField).toHaveCount(1);
    await expect(periodField.locator('[data-shared-select-trigger]')).toHaveCount(1);
    await expect(periodField.locator('[data-shared-select-dropdown]')).toHaveCount(1);
    await periodField.locator('[data-shared-select-trigger]').click();
    await expect(periodField.locator('[data-shared-select-dropdown]')).toBeVisible();
    await assertOptionMarkup(page, '#period_dropdown');

    await page.goto('/workspaces/backtest?ticker=AAPL&strategy=grid-trading');
    await assertNoVisibleNativeSelects(page);
    const strategyField = page.locator('[data-shared-select-field][data-shared-select-kind="strategy"]');
    await expect(strategyField).toHaveCount(1);
    await expect(strategyField).toHaveClass(/backtest-shared-select-field/);
    await expect(strategyField.locator('[data-shared-select-trigger]:visible')).toHaveCount(1);
    await expect(strategyField.locator('[data-shared-select-dropdown]')).toHaveCount(1);
    await expect(page.locator('#period_panel [data-shared-select-trigger]:visible')).toHaveCount(1);
    await strategyField.locator('[data-shared-select-trigger]').click();
    await expect(page.locator('#trade_strategy_dropdown')).toBeVisible();
    const strategyGeometry = await page.evaluate(() => {
        const trigger = document.querySelector('[data-shared-select-kind="strategy"] [data-shared-select-trigger]');
        const dropdown = document.querySelector('#trade_strategy_dropdown');
        if (!(trigger instanceof HTMLElement) || !(dropdown instanceof HTMLElement)) return null;
        return {
            triggerWidth: trigger.getBoundingClientRect().width,
            dropdownWidth: dropdown.getBoundingClientRect().width,
            dropdownCssWidth: getComputedStyle(dropdown).width,
            dropdownInlineWidth: dropdown.style.width,
            position: getComputedStyle(dropdown).position,
            isOverlayChild: dropdown.parentElement?.matches('[data-shared-select-overlay]') || false,
        };
    });
    expect(strategyGeometry).not.toBeNull();
    expect(strategyGeometry?.dropdownCssWidth).toBe(`${Math.round(strategyGeometry?.triggerWidth || 0)}px`);
    expect(strategyGeometry?.dropdownInlineWidth).toBe(`${Math.round(strategyGeometry?.triggerWidth || 0)}px`);
    expect(strategyGeometry?.position).toBe('fixed');
    expect(strategyGeometry?.isOverlayChild).toBe(true);
    await assertOptionMarkup(page, '#trade_strategy_dropdown');
});

test('publishes the canonical Shared select material, geometry, and chevron states', async ({page}) => {
    await page.setViewportSize({width: 1_280, height: 900});
    await page.goto('/settings/style-tokens');

    const card = page.locator('[data-style-token-card="shared-select-dropdown"]');
    const field = card.locator('[data-style-token-shared-select-dropdown-demo] [data-shared-select-field]');
    const trigger = field.locator('[data-shared-select-trigger]');
    const dropdown = field.locator('[data-shared-select-dropdown]');

    await expect(trigger).toHaveAttribute('aria-haspopup', 'listbox');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(trigger).toHaveAttribute('aria-controls', 'style_token_shared_select_dropdown_menu');

    const closed = await trigger.evaluate((element) => {
        const style = getComputedStyle(element);
        const chevron = getComputedStyle(element, '::after');
        const legacyChevron = element.querySelector('.trade-strategy-trigger-chevron');
        const matrix = new DOMMatrixReadOnly(chevron.transform);
        const materialProbe = document.createElement('span');
        materialProbe.style.cssText = [
            'position: fixed',
            'background: var(--shared-select-trigger-material)',
            'border: var(--shared-select-border)',
            'box-shadow: var(--shared-select-shadow)',
            'backdrop-filter: var(--shared-select-blur)',
            '-webkit-backdrop-filter: var(--shared-select-blur)',
        ].join(';');
        document.body.append(materialProbe);
        const expected = getComputedStyle(materialProbe);
        const result = {
            height: element.getBoundingClientRect().height,
            paddingInlineEnd: style.paddingInlineEnd,
            backgroundColor: style.backgroundColor,
            backgroundImage: style.backgroundImage,
            border: style.border,
            boxShadow: style.boxShadow,
            backdropFilter: style.backdropFilter || style.webkitBackdropFilter,
            expectedBackgroundColor: expected.backgroundColor,
            expectedBackgroundImage: expected.backgroundImage,
            expectedBorder: expected.border,
            expectedBoxShadow: expected.boxShadow,
            expectedBackdropFilter: expected.backdropFilter || expected.webkitBackdropFilter,
            chevron: {
                width: chevron.width,
                height: chevron.height,
                color: chevron.backgroundColor,
                triggerColor: style.color,
                maskImage: chevron.maskImage || chevron.webkitMaskImage,
                transitionDuration: chevron.transitionDuration,
                matrixA: matrix.a,
                matrixB: matrix.b,
                matrixC: matrix.c,
                matrixD: matrix.d,
            },
            legacyChevronDisplay: legacyChevron instanceof HTMLElement
                ? getComputedStyle(legacyChevron).display
                : null,
        };
        materialProbe.remove();
        return result;
    });

    expect(closed).toMatchObject({
        height: 30,
        paddingInlineEnd: '36px',
        backgroundColor: closed.expectedBackgroundColor,
        backgroundImage: closed.expectedBackgroundImage,
        border: closed.expectedBorder,
        boxShadow: closed.expectedBoxShadow,
        backdropFilter: closed.expectedBackdropFilter,
        legacyChevronDisplay: 'none',
        chevron: {
            width: '12px',
            height: '8px',
            color: closed.chevron.triggerColor,
            transitionDuration: '0.18s',
            matrixA: 0,
            matrixB: -1,
            matrixC: 1,
            matrixD: 0,
        },
    });
    expect(closed.chevron.maskImage).not.toBe('none');

    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(dropdown).toBeVisible();
    await page.waitForTimeout(200);

    const open = await field.evaluate((element) => {
        const triggerElement = element.querySelector('[data-shared-select-trigger]');
        const dropdownElement = element.querySelector('[data-shared-select-dropdown]');
        const option = dropdownElement?.querySelector('[role="option"]');
        if (!(triggerElement instanceof HTMLElement)
            || !(dropdownElement instanceof HTMLElement)
            || !(option instanceof HTMLElement)) return null;
        const dropdownStyle = getComputedStyle(dropdownElement);
        const chevron = getComputedStyle(triggerElement, '::after');
        const matrix = new DOMMatrixReadOnly(chevron.transform);
        const materialProbe = document.createElement('span');
        materialProbe.style.cssText = [
            'position: fixed',
            'background: var(--shared-select-dropdown-material)',
            'border: var(--shared-select-border)',
            'box-shadow: var(--shared-select-shadow)',
            'backdrop-filter: var(--shared-select-blur)',
            '-webkit-backdrop-filter: var(--shared-select-blur)',
        ].join(';');
        document.body.append(materialProbe);
        const expected = getComputedStyle(materialProbe);
        const rootStyle = getComputedStyle(document.documentElement);
        const parentWidth = dropdownElement.parentElement?.getBoundingClientRect().width
            ?? Number.POSITIVE_INFINITY;
        const result = {
            dropdownWidth: dropdownElement.getBoundingClientRect().width,
            parentWidth,
            maxWidthToken: Number.parseFloat(rootStyle.getPropertyValue('--shared-select-dropdown-max-width')),
            optionHeight: option.getBoundingClientRect().height,
            backgroundColor: dropdownStyle.backgroundColor,
            backgroundImage: dropdownStyle.backgroundImage,
            border: dropdownStyle.border,
            boxShadow: dropdownStyle.boxShadow,
            backdropFilter: dropdownStyle.backdropFilter || dropdownStyle.webkitBackdropFilter,
            expectedBackgroundColor: expected.backgroundColor,
            expectedBackgroundImage: expected.backgroundImage,
            expectedBorder: expected.border,
            expectedBoxShadow: expected.boxShadow,
            expectedBackdropFilter: expected.backdropFilter || expected.webkitBackdropFilter,
            matrixA: matrix.a,
            matrixB: matrix.b,
            matrixC: matrix.c,
            matrixD: matrix.d,
        };
        materialProbe.remove();
        return result;
    });

    expect(open).not.toBeNull();
    expect(open).toMatchObject({
        maxWidthToken: 384,
        backgroundColor: open?.expectedBackgroundColor,
        backgroundImage: open?.expectedBackgroundImage,
        border: open?.expectedBorder,
        boxShadow: open?.expectedBoxShadow,
        backdropFilter: open?.expectedBackdropFilter,
        matrixA: 1,
        matrixB: 0,
        matrixC: 0,
        matrixD: 1,
    });
    expect(Math.abs((open?.optionHeight ?? 0) - 36)).toBeLessThanOrEqual(1);
    expect(open?.dropdownWidth).toBeLessThanOrEqual(384);
    expect(open?.dropdownWidth).toBeLessThanOrEqual(open?.parentWidth ?? 0);

    await page.emulateMedia({reducedMotion: 'reduce'});
    await expect.poll(() => trigger.evaluate((element) => (
        getComputedStyle(element, '::after').transitionDuration
    ))).toBe('0s');
});
