/* Code version: v1.0.3 */
import {expect, test} from '@playwright/test';

const widthTolerance = 1;

async function waitForMenuAnimation(menu) {
    await menu.evaluate((element) => Promise.all(
        element.getAnimations({subtree: true}).map((animation) => animation.finished.catch(() => {})),
    ));
}

const readGeometry = (page) => page.evaluate(() => {
    const card = (id) => document.querySelector(`[data-style-token-card="${id}"]`);
    const rect = (element) => element?.getBoundingClientRect();
    const select = (id) => {
        const owner = card(id);
        const demo = owner?.querySelector('.style-token-demo');
        const shell = demo?.querySelector(':scope > .style-token-shared-select-shell');
        const trigger = shell?.querySelector('[data-shared-select-trigger]');
        const menu = shell?.querySelector('[data-shared-select-dropdown]');
        const shellRect = rect(shell);
        const visibleControls = [trigger, menu?.getClientRects().length ? menu : null]
            .filter(Boolean);
        return {
            demoWidth: rect(demo)?.width ?? 0,
            shellWidth: shellRect?.width ?? 0,
            triggerWidth: rect(trigger)?.width ?? 0,
            containerType: demo ? getComputedStyle(demo).containerType : '',
            visibleControls: visibleControls.map((control) => {
                const controlRect = control.getBoundingClientRect();
                return {
                    kind: control === trigger ? 'trigger' : 'menu',
                    width: controlRect.width,
                    leftOverflow: (shellRect?.left ?? 0) - controlRect.left,
                    rightOverflow: controlRect.right - (shellRect?.right ?? 0),
                };
            }),
        };
    };
    const tuningCard = card('strategy-tuning-control');
    const tuningDemo = tuningCard?.querySelector('.style-token-demo');
    const tuning = tuningDemo?.querySelector(':scope > .style-token-strategy-tuning-demo');
    const tuningRow = tuning?.querySelector('.style-token-strategy-tuning-row');
    const tuningPanel = tuning?.querySelector('[data-style-token-strategy-tuning-panel]');
    const rootStyle = getComputedStyle(document.documentElement);
    return {
        controlToken: Number.parseFloat(rootStyle.getPropertyValue('--layout-control-width')),
        contentToken: Number.parseFloat(rootStyle.getPropertyValue('--layout-content-width')),
        menuToken: Number.parseFloat(rootStyle.getPropertyValue('--shared-select-dropdown-max-width')),
        filter: select('shared-select-filter'),
        period: select('shared-select-dropdown'),
        tuning: {
            demoWidth: rect(tuningDemo)?.width ?? 0,
            specimenWidth: rect(tuning)?.width ?? 0,
            rowWidth: rect(tuningRow)?.width ?? 0,
            panelWidth: rect(tuningPanel)?.width ?? 0,
            panelVisible: tuningPanel ? getComputedStyle(tuningPanel).display !== 'none' : false,
            containerType: tuningDemo ? getComputedStyle(tuningDemo).containerType : '',
            overflow: tuning ? tuning.scrollWidth - tuning.clientWidth : Number.POSITIVE_INFINITY,
        },
        pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
});

const widthValues = (geometry) => [
    geometry.filter.demoWidth,
    geometry.filter.shellWidth,
    geometry.filter.triggerWidth,
    geometry.period.demoWidth,
    geometry.period.shellWidth,
    geometry.period.triggerWidth,
    geometry.tuning.demoWidth,
    geometry.tuning.specimenWidth,
    geometry.tuning.rowWidth,
    geometry.tuning.panelWidth,
];

async function waitForLayoutFrames(page) {
    await page.evaluate(() => new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
}

async function waitForStableGeometry(page) {
    await expect.poll(async () => {
        const before = widthValues(await readGeometry(page));
        await waitForLayoutFrames(page);
        const after = widthValues(await readGeometry(page));
        return Math.max(...before.map((width, index) => Math.abs(width - after[index])));
    }).toBeLessThanOrEqual(0.1);
}

async function expectTier(page, availableWidth, expectedWidth) {
    await waitForMenuAnimation(page.locator('[data-style-token-card="shared-select-filter"] [data-shared-select-dropdown]'));
    await expect.poll(async () => {
        const before = await readGeometry(page);
        await waitForLayoutFrames(page);
        const after = await readGeometry(page);
        const tierError = (geometry) => Math.max(
            ...[geometry.filter, geometry.period].flatMap((select) => [
                Math.abs(select.demoWidth - availableWidth),
                Math.abs(select.shellWidth - expectedWidth),
                Math.abs(select.triggerWidth - expectedWidth),
            ]),
            ...[
                geometry.tuning.demoWidth - availableWidth,
                geometry.tuning.specimenWidth - expectedWidth,
                geometry.tuning.rowWidth - expectedWidth,
                geometry.tuning.panelWidth - expectedWidth,
            ].map(Math.abs),
        );
        const beforeWidths = widthValues(before);
        const afterWidths = widthValues(after);
        return Math.max(tierError(before), tierError(after),
            ...beforeWidths.map((width, index) => Math.abs(width - afterWidths[index])));
    }).toBeLessThanOrEqual(widthTolerance);
    const geometry = await readGeometry(page);
    expect(geometry.controlToken).toBe(384);
    expect(geometry.contentToken).toBe(640);
    expect(geometry.menuToken).toBe(384);
    for (const [kind, select] of [['filter', geometry.filter], ['period', geometry.period]]) {
        expect(select.containerType).toBe('inline-size');
        expect(Math.abs(select.demoWidth - availableWidth)).toBeLessThanOrEqual(widthTolerance);
        expect(Math.abs(select.shellWidth - expectedWidth)).toBeLessThanOrEqual(widthTolerance);
        expect(Math.abs(select.triggerWidth - expectedWidth)).toBeLessThanOrEqual(widthTolerance);
        for (const control of select.visibleControls) {
            expect(control.leftOverflow, `${kind} ${control.kind} left: ${JSON.stringify(control)}`)
                .toBeLessThanOrEqual(widthTolerance);
            expect(control.rightOverflow, `${kind} ${control.kind} right: ${JSON.stringify(control)}`)
                .toBeLessThanOrEqual(widthTolerance);
        }
    }
    expect(geometry.tuning.containerType).toBe('inline-size');
    expect(Math.abs(geometry.tuning.demoWidth - availableWidth)).toBeLessThanOrEqual(widthTolerance);
    expect(geometry.tuning.panelVisible).toBe(true);
    for (const width of [geometry.tuning.specimenWidth, geometry.tuning.rowWidth, geometry.tuning.panelWidth]) {
        expect(Math.abs(width - expectedWidth)).toBeLessThanOrEqual(widthTolerance);
    }
    expect(geometry.tuning.overflow).toBeLessThanOrEqual(widthTolerance);
    expect(geometry.pageOverflow).toBeLessThanOrEqual(widthTolerance);
}

async function dragDemoColumn(page, targetWidth) {
    const handle = page.locator('[data-style-token-resizer]');
    await expect(handle).toBeVisible();
    await expect(handle).toHaveAttribute('data-bound', '1');
    await waitForStableGeometry(page);
    const target = await handle.evaluate((element, width) => {
        const shell = element.closest('[data-style-token-shell]');
        if (!(shell instanceof HTMLElement)) return null;
        const shellRect = shell.getBoundingClientRect();
        const handleRect = element.getBoundingClientRect();
        const style = getComputedStyle(shell);
        const gap = Number.parseFloat(style.getPropertyValue('--style-token-column-gap'));
        const handleY = Number.parseFloat(style.getPropertyValue('--style-token-resizer-y'));
        const maxWidth = Math.max(220, shellRect.width - gap - 280);
        const availableWidth = Math.min(width, maxWidth);
        return {
            startX: handleRect.left + (handleRect.width / 2),
            targetX: shellRect.left + availableWidth + (gap / 2),
            y: Math.min(Math.max(shellRect.top + handleY, 90), innerHeight - 90),
            availableWidth,
        };
    }, targetWidth);
    expect(target).not.toBeNull();
    expect(target.availableWidth).toBeGreaterThan(384);
    await page.mouse.move(target.startX, target.y);
    await page.mouse.down();
    await page.mouse.move(target.targetX, target.y, {steps: 8});
    await page.mouse.up();
    return page.locator('[data-style-token-card="shared-select-dropdown"] .style-token-demo')
        .evaluate((element) => element.getBoundingClientRect().width);
}

async function expectPeriodMenuWithinSharedCap(page, triggerWidth) {
    const card = page.locator('[data-style-token-card="shared-select-dropdown"]');
    const trigger = card.locator('[data-shared-select-trigger]');
    const menu = card.locator('[data-shared-select-dropdown]');
    await trigger.click();
    await expect(menu).toBeVisible();
    await waitForMenuAnimation(menu);
    const geometry = await menu.evaluate((element) => {
        const menuRect = element.getBoundingClientRect();
        const triggerRect = element.closest('.trade-strategy-row')
            ?.querySelector('[data-shared-select-trigger]')?.getBoundingClientRect();
        const demoRect = element.closest('.style-token-demo')?.getBoundingClientRect();
        return {
            width: menuRect.width,
            triggerWidth: triggerRect?.width ?? 0,
            leftOverflow: (demoRect?.left ?? 0) - menuRect.left,
            rightOverflow: menuRect.right - (demoRect?.right ?? 0),
            scrollOverflow: element.scrollWidth - element.clientWidth,
        };
    });
    expect(Math.abs(geometry.triggerWidth - triggerWidth)).toBeLessThanOrEqual(widthTolerance);
    expect(geometry.width).toBeGreaterThan(0);
    expect(geometry.width).toBeLessThanOrEqual(384 + widthTolerance);
    expect(geometry.width).toBeLessThanOrEqual(triggerWidth + widthTolerance);
    expect(geometry.leftOverflow).toBeLessThanOrEqual(widthTolerance);
    expect(geometry.rightOverflow).toBeLessThanOrEqual(widthTolerance);
    expect(geometry.scrollOverflow).toBeLessThanOrEqual(widthTolerance);
    await expect(menu.locator('[role="option"][data-value="1y"]')).toBeVisible();
    await trigger.click();
    await expect(menu).toBeHidden();
}

test('uses the 384px tier for the annotated 996px Style tokens layout', async ({page}) => {
    await page.setViewportSize({width: 996, height: 801});
    await page.goto('/settings/style-tokens');
    const sidebarToggle = page.locator('#sidebar_toggle');
    if (await sidebarToggle.getAttribute('aria-expanded') === 'true') await sidebarToggle.click();
    await expect(page.locator('.app-shell')).not.toHaveClass(/is-sidebar-animating/);
    await dragDemoColumn(page, 500);
    await waitForStableGeometry(page);
    const availableWidth = (await readGeometry(page)).period.demoWidth;
    expect(availableWidth).toBeGreaterThan(384);
    expect(availableWidth).toBeLessThan(640);
    await expectTier(page, availableWidth, 384);
    await expectPeriodMenuWithinSharedCap(page, 384);
});

test('switches both specimens and the tuning panel as the same resizer crosses 640px', async ({page}) => {
    await page.setViewportSize({width: 1_760, height: 900});
    await page.goto('/settings/style-tokens');
    await dragDemoColumn(page, 574);
    await expectTier(page, 574, 384);
    await expectPeriodMenuWithinSharedCap(page, 384);
    await dragDemoColumn(page, 680);
    await expectTier(page, 680, 640);
    await expectPeriodMenuWithinSharedCap(page, 640);
    await dragDemoColumn(page, 574);
    await expectTier(page, 574, 384);
});

test('updates the resizer accessibility range when the viewport changes', async ({page}) => {
    await page.setViewportSize({width: 996, height: 801});
    await page.goto('/settings/style-tokens');
    const sidebarToggle = page.locator('#sidebar_toggle');
    if (await sidebarToggle.getAttribute('aria-expanded') === 'true') await sidebarToggle.click();
    await expect(page.locator('.app-shell')).not.toHaveClass(/is-sidebar-animating/);
    const handle = page.locator('[data-style-token-resizer]');
    await expect(handle).toHaveAttribute('data-bound', '1');
    const range = async () => handle.evaluate((element) => {
        const shell = element.closest('[data-style-token-shell]');
        const shellRect = shell.getBoundingClientRect();
        const columnGap = Number.parseFloat(getComputedStyle(shell).getPropertyValue('--style-token-column-gap'));
        return {
            maximum: Math.round(Math.max(220, shellRect.width - columnGap - 280)),
            actual: Math.round(shell.querySelector('.style-token-demo').getBoundingClientRect().width),
            ariaMaximum: Number(element.getAttribute('aria-valuemax')),
            ariaActual: Number(element.getAttribute('aria-valuenow')),
        };
    });
    const expectAccessibleRange = async () => {
        await waitForStableGeometry(page);
        await expect.poll(async () => {
            const state = await range();
            return {
                maximumGap: state.maximum - state.ariaMaximum,
                currentGap: state.actual - state.ariaActual,
            };
        }).toEqual({maximumGap: 0, currentGap: 0});
    };
    await expectAccessibleRange();
    const narrowMaximum = (await range()).maximum;
    await page.setViewportSize({width: 1760, height: 900});
    await expectAccessibleRange();
    const wideMaximum = (await range()).maximum;
    expect(wideMaximum).toBeGreaterThan(narrowMaximum);
    await handle.press('End');
    await expectTier(page, wideMaximum, 640);
    await page.setViewportSize({width: 996, height: 801});
    await expectAccessibleRange();
    expect((await range()).maximum).toBe(narrowMaximum);
});

test('lets the specimens shrink with a narrow single-column container', async ({page}) => {
    await page.setViewportSize({width: 390, height: 844});
    await page.goto('/settings/style-tokens');
    await waitForStableGeometry(page);
    const geometry = await readGeometry(page);
    expect(geometry.filter.demoWidth).toBeGreaterThan(0);
    expect(geometry.filter.demoWidth).toBeLessThan(384);
    await expectTier(page, geometry.filter.demoWidth, geometry.filter.demoWidth);
    await expectPeriodMenuWithinSharedCap(page, geometry.filter.demoWidth);
});
