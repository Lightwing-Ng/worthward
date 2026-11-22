/* Code version: v1.2.0 */
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

test('resizer keeps bounded values while faster edge releases produce stronger visual jelly', async ({page}) => {
    await page.setViewportSize({width: 1_760, height: 900});
    await page.goto('/settings/style-tokens');
    const handle = page.locator('[data-style-token-resizer]');
    await expect(handle).toHaveAttribute('data-bound', '1');
    const springSupport = await handle.evaluate((element) => {
        const token = getComputedStyle(document.documentElement).getPropertyValue('--motion-spring-080').trim();
        return {
            token,
            supported: CSS.supports('transition-timing-function', token),
            computed: getComputedStyle(element, '::after').transitionTimingFunction,
        };
    });
    expect(springSupport.token).toMatch(/^linear\(0,/);
    expect(springSupport.supported).toBe(true);
    expect(springSupport.computed).toContain('linear(');

    const exerciseEdge = async (edge, fast) => {
        await handle.press(edge === 'minimum' ? 'Home' : 'End');
        await waitForStableGeometry(page);
        const before = await handle.evaluate((element, targetEdge) => ({
            rect: element.getBoundingClientRect().toJSON(),
            value: element.getAttribute('aria-valuenow'),
            bound: element.getAttribute(targetEdge === 'minimum' ? 'aria-valuemin' : 'aria-valuemax'),
        }), edge);
        expect(before.value).toBe(before.bound);
        await handle.evaluate((element) => {
            window.__resizerJellyPeak = 0;
            window.__resizerJellyObserver?.disconnect();
            window.__resizerJellyObserver = new MutationObserver(() => {
                const offset = Number.parseFloat(element.style.getPropertyValue('--surface-resizer-jelly-offset')) || 0;
                window.__resizerJellyPeak = Math.max(window.__resizerJellyPeak, Math.abs(offset));
            });
            window.__resizerJellyObserver.observe(element, {attributes: true, attributeFilter: ['style']});
        });
        await handle.evaluate((element, {targetEdge, isFast}) => {
            const rect = element.getBoundingClientRect();
            const startX = rect.left + rect.width / 2;
            const y = rect.top + rect.height / 2;
            const direction = targetEdge === 'minimum' ? -1 : 1;
            const step = isFast ? 20 : 8;
            const interval = isFast ? 10 : 40;
            const dispatch = (target, type, x, time) => {
                const event = new PointerEvent(type, {
                    bubbles: true, button: 0, pointerId: 91, clientX: x, clientY: y,
                });
                Object.defineProperty(event, 'timeStamp', {value: time});
                target.dispatchEvent(event);
            };
            dispatch(element, 'pointerdown', startX, 1_000);
            for (let index = 1; index <= 4; index += 1) {
                dispatch(window, 'pointermove', startX + direction * step * index, 1_000 + interval * index);
            }
            dispatch(window, 'pointerup', startX + direction * step * 4, 1_001 + interval * 4);
        }, {targetEdge: edge, isFast: fast});
        await expect.poll(() => page.evaluate(() => window.__resizerJellyPeak)).toBeGreaterThan(0.1);
        await expect.poll(() => handle.evaluate((element) => (
            element.style.getPropertyValue('--surface-resizer-jelly-offset')
        ))).toBe('');
        const after = await handle.evaluate((element) => ({
            rect: element.getBoundingClientRect().toJSON(),
            value: element.getAttribute('aria-valuenow'),
            peak: window.__resizerJellyPeak,
            pseudoTransform: getComputedStyle(element, '::after').transform,
        }));
        expect(after.value).toBe(before.bound);
        expect(after.rect.x).toBeCloseTo(before.rect.x, 1);
        expect(after.rect.width).toBeCloseTo(before.rect.width, 1);
        expect(after.peak).toBeLessThanOrEqual(8);
        expect(after.pseudoTransform).toContain('matrix');
        return after.peak;
    };

    for (const edge of ['minimum', 'maximum']) {
        const slowPeak = await exerciseEdge(edge, false);
        const fastPeak = await exerciseEdge(edge, true);
        expect(slowPeak).toBeGreaterThan(0.5);
        expect(fastPeak).toBeGreaterThan(slowPeak + 0.5);
    }

    await handle.press('Home');
    const cancelled = await handle.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        const event = (type, clientX, timestamp) => {
            const pointerEvent = new PointerEvent(type, {
                bubbles: true, button: 0, pointerId: 92, clientX, clientY: y,
            });
            Object.defineProperty(pointerEvent, 'timeStamp', {value: timestamp});
            return pointerEvent;
        };
        const start = element.getAttribute('aria-valuenow');
        element.dispatchEvent(event('pointerdown', x, 2_000));
        window.dispatchEvent(event('pointermove', x + 64, 2_040));
        const moved = element.getAttribute('aria-valuenow');
        window.dispatchEvent(event('pointercancel', x + 64, 2_050));
        return {
            start, moved,
            final: element.getAttribute('aria-valuenow'),
            jelly: element.style.getPropertyValue('--surface-resizer-jelly-offset'),
        };
    });
    expect(Number(cancelled.moved)).toBeGreaterThan(Number(cancelled.start));
    expect(cancelled.final).toBe(cancelled.start);
    expect(cancelled.jelly).toBe('');

    await handle.press('End');
    await handle.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        const event = (type, clientX, timestamp) => {
            const pointerEvent = new PointerEvent(type, {
                bubbles: true, button: 0, pointerId: 93, clientX, clientY: y,
            });
            Object.defineProperty(pointerEvent, 'timeStamp', {value: timestamp});
            return pointerEvent;
        };
        element.dispatchEvent(event('pointerdown', x, 3_000));
        window.dispatchEvent(event('pointermove', x + 60, 3_030));
        window.dispatchEvent(event('pointerup', x + 60, 3_031));
    });
    await expect.poll(() => handle.evaluate((element) => (
        element.style.getPropertyValue('--surface-resizer-jelly-offset')
    ))).not.toBe('');
    const reversal = await handle.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        const before = element.style.getPropertyValue('--surface-resizer-jelly-offset');
        const event = (type, clientX, timestamp) => {
            const pointerEvent = new PointerEvent(type, {
                bubbles: true, button: 0, pointerId: 94, clientX, clientY: y,
            });
            Object.defineProperty(pointerEvent, 'timeStamp', {value: timestamp});
            return pointerEvent;
        };
        element.dispatchEvent(event('pointerdown', x, 4_000));
        const after = element.style.getPropertyValue('--surface-resizer-jelly-offset');
        window.dispatchEvent(event('pointermove', x - 40, 4_030));
        window.dispatchEvent(event('pointerup', x - 40, 4_031));
        return {before, after};
    });
    expect(reversal.before).not.toBe('');
    expect(reversal.after).toBe(reversal.before);
    await expect.poll(() => handle.evaluate((element) => (
        element.style.getPropertyValue('--surface-resizer-jelly-offset')
    ))).toBe('');

    await page.emulateMedia({reducedMotion: 'reduce'});
    await handle.press('Home');
    const box = await handle.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x - 40, box.y + box.height / 2);
    await page.mouse.up();
    expect(await handle.evaluate((element) => (
        element.style.getPropertyValue('--surface-resizer-jelly-offset')
    ))).toBe('');
});
