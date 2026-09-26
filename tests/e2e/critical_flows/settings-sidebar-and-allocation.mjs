/* Code version: v1.0.2 */
import {expect, test, openBacktestParameterOverlay} from './support.mjs';

const settingsViewports = [
    {width: 996, height: 801},
    {width: 390, height: 844},
];

function readSettingsSidebarGeometry() {
    const sidebar = document.querySelector('#app_sidebar');
    const heading = sidebar?.querySelector(':scope > .hero');
    const nav = sidebar?.querySelector(':scope > .settings-nav');
    const lastItem = nav?.querySelector('.settings-nav-item-style-tokens');
    const toggle = document.querySelector('#sidebar_toggle');
    const dock = document.querySelector('.sidebar-dock');
    const rect = (element) => {
        if (!element) return null;
        const bounds = element.getBoundingClientRect();
        return {
            left: bounds.left,
            right: bounds.right,
            top: bounds.top,
            bottom: bounds.bottom,
        };
    };
    return {
        sidebar: rect(sidebar),
        heading: rect(heading),
        nav: rect(nav),
        lastItem: rect(lastItem),
        toggle: rect(toggle),
        dock: rect(dock),
        sidebarScrollTop: sidebar?.scrollTop ?? -1,
        navScrollTop: nav?.scrollTop ?? -1,
        navScrollRange: nav ? nav.scrollHeight - nav.clientHeight : -1,
        navOverflowY: nav ? getComputedStyle(nav).overflowY : '',
        documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
}

async function waitForSettingsNavToSettle(page) {
    const settled = await page.evaluate(() => new Promise((resolve) => {
        const nav = document.querySelector('#app_sidebar > .settings-nav');
        let previous = null;
        let stableFrames = 0;
        let frames = 0;
        const sample = () => {
            const rect = nav?.getBoundingClientRect();
            const current = rect && [rect.left, rect.right, rect.top, rect.bottom];
            const inViewport = current && rect.left >= 0 && rect.right <= innerWidth
                && rect.top >= 0 && rect.bottom <= innerHeight;
            stableFrames = inViewport && previous
                && current.every((value, index) => Math.abs(value - previous[index]) <= 0.25)
                ? stableFrames + 1 : 0;
            if (stableFrames >= 2) return resolve(true);
            if (++frames >= 180) return resolve(false);
            previous = current;
            requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
    }));
    expect(settled, 'Settings navigation should finish entering the viewport').toBe(true);
}

for (const viewport of settingsViewports) {
    test(`keeps the Settings heading fixed while its sidebar navigation scrolls at ${viewport.width}x${viewport.height}`, async ({page}) => {
        await page.setViewportSize(viewport);
        await page.goto('/settings/about');

        const toggle = page.locator('#sidebar_toggle');
        if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
        await expect(toggle).toHaveAttribute('aria-expanded', 'true');
        const sidebar = page.locator('#app_sidebar');
        const nav = sidebar.locator(':scope > .settings-nav');
        const heading = sidebar.locator(':scope > .hero');
        const lastItem = nav.locator('.settings-nav-item-style-tokens');
        await expect(sidebar).toBeVisible();
        await expect(heading).toContainText('Settings');
        await expect(nav).toBeVisible();
        await waitForSettingsNavToSettle(page);

        const initial = await page.evaluate(readSettingsSidebarGeometry);
        expect(initial.navOverflowY).toBe('auto');
        expect(initial.navScrollRange).toBeGreaterThan(20);
        expect(initial.sidebarScrollTop).toBe(0);
        expect(initial.heading.top).toBeGreaterThanOrEqual(initial.sidebar.top - 1);
        expect(initial.heading.bottom).toBeLessThanOrEqual(initial.nav.top + 1);

        await page.mouse.move(
            (initial.nav.left + initial.nav.right) / 2,
            (initial.nav.top + initial.nav.bottom) / 2,
        );
        await page.mouse.wheel(0, 4_000);
        await expect.poll(() => nav.evaluate((element) => element.scrollTop)).toBeGreaterThan(20);
        await expect.poll(() => page.evaluate(() => {
            const navElement = document.querySelector('#app_sidebar > .settings-nav');
            const item = navElement?.querySelector('.settings-nav-item-style-tokens');
            const dock = document.querySelector('.sidebar-dock');
            if (!navElement || !item || !dock) return false;
            const navRect = navElement.getBoundingClientRect();
            const itemRect = item.getBoundingClientRect();
            const dockRect = dock.getBoundingClientRect();
            return itemRect.top >= navRect.top - 1
                && itemRect.bottom <= navRect.bottom + 1
                && itemRect.bottom <= dockRect.top - 1;
        })).toBe(true);

        const scrolled = await page.evaluate(readSettingsSidebarGeometry);
        expect(scrolled.navScrollTop).toBeGreaterThan(initial.navScrollTop);
        expect(scrolled.sidebarScrollTop).toBe(0);
        expect(scrolled.documentOverflow).toBeLessThanOrEqual(1);
        for (const [part, edge] of [
            ['sidebar', 'top'], ['heading', 'top'], ['heading', 'bottom'],
            ['nav', 'top'], ['toggle', 'top'],
        ]) {
            expect(Math.abs(scrolled[part][edge] - initial[part][edge]), `${part}.${edge}`).toBeLessThanOrEqual(1);
        }

        await toggle.click();
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');
        await expect(sidebar).toHaveAttribute('aria-hidden', 'true');
        await expect.poll(() => sidebar.evaluate((element) => element.inert)).toBe(true);
        await toggle.click();
        await expect(toggle).toHaveAttribute('aria-expanded', 'true');
        await expect(sidebar).toHaveAttribute('aria-hidden', 'false');
        await expect.poll(() => sidebar.evaluate((element) => element.inert)).toBe(false);
        await expect(sidebar).toBeVisible();
        await lastItem.scrollIntoViewIfNeeded();
        await expect(lastItem).toBeInViewport();
        await lastItem.click();
        await expect(page).toHaveURL(/\/settings\/style-tokens(?:\?|$)/);
        await expect(page.locator('#settings_workspace_shell')).toBeVisible();
    });
}

for (const viewport of settingsViewports) {
    test(`shares the frosted allocation handle material at ${viewport.width}x${viewport.height}`, async ({page}) => {
        await page.setViewportSize(viewport);
        await page.goto('/settings/style-tokens');
        const demo = page.locator('[data-style-token-card="allocation-range"] .style-token-allocation-demo');
        await expect(demo).toBeAttached();
        await demo.scrollIntoViewIfNeeded();
        const appearance = await demo.evaluate((element) => {
            const reference = document.querySelector('[data-style-token-resizer]');
            const referenceStyle = reference ? getComputedStyle(reference, '::after') : null;
            const findRule = (selector) => {
                const scan = (rules) => {
                    for (const rule of rules) {
                        if (rule.selectorText?.includes(selector)) return rule;
                        const childRules = rule.styleSheet?.cssRules || rule.cssRules;
                        if (childRules) {
                            const found = scan(childRules);
                            if (found) return found;
                        }
                    }
                    return null;
                };
                for (const sheet of document.styleSheets) {
                    try {
                        const found = scan(sheet.cssRules);
                        if (found) return found;
                    } catch {
                        continue;
                    }
                }
                return null;
            };
            const thumbRule = findRule('.strategy-allocation-handle::-webkit-slider-thumb');
            const hoverRule = findRule('.strategy-allocation-handle::-webkit-slider-thumb:hover');
            const declaration = (rule, name) => rule?.style?.getPropertyValue(name).trim() || '';
            const readMaterial = (style) => style ? ({
                background: style.background,
                shadow: style.boxShadow,
                blur: style.backdropFilter,
                radius: style.borderRadius,
            }) : null;
            const probe = document.createElement('span');
            probe.style.cssText = `position:absolute;pointer-events:none;
                background:var(--surface-resizer-handle-background);
                box-shadow:var(--surface-resizer-handle-shadow);
                backdrop-filter:var(--surface-resizer-handle-blur);
                border:0;
                border-radius:var(--radius-pill);
                width:var(--strategy-range-thumb-inline-size);
                height:var(--strategy-range-thumb-block-size)`;
            element.append(probe);
            const resolvedShared = readMaterial(getComputedStyle(probe));
            const thumbRect = probe.getBoundingClientRect();
            probe.remove();
            const handles = Array.from(element.querySelectorAll('.strategy-allocation-handle'));
            return {
                reference: readMaterial(referenceStyle),
                resolvedShared,
                declarations: {
                    background: declaration(thumbRule, 'background'),
                    shadow: declaration(thumbRule, 'box-shadow'),
                    blur: declaration(thumbRule, 'backdrop-filter'),
                    radius: declaration(thumbRule, 'border-radius'),
                    border: declaration(thumbRule, 'border'),
                    hoverBackground: declaration(hoverRule, 'background'),
                    hoverShadow: declaration(hoverRule, 'box-shadow'),
                },
                thumbWidth: thumbRect.width,
                thumbHeight: thumbRect.height,
                handles: handles.map((input) => {
                    const inputStyle = getComputedStyle(input);
                    const bounds = input.getBoundingClientRect();
                    return {
                        accent: inputStyle.color,
                        inputWidth: bounds.width,
                        inputHeight: bounds.height,
                    };
                }),
                demoWidth: element.getBoundingClientRect().width,
                cardWidth: element.closest('.style-token-card')?.getBoundingClientRect().width ?? 0,
                documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            };
        });
        expect(appearance.reference).not.toBeNull();
        expect(appearance.reference.radius).toBe('999px');
        expect(appearance.resolvedShared).toEqual(appearance.reference);
        expect(appearance.declarations).toEqual({
            background: 'var(--strategy-range-thumb-background, var(--surface-resizer-handle-background))',
            shadow: 'var(--surface-resizer-handle-shadow)',
            blur: 'var(--surface-resizer-handle-blur)',
            radius: 'var(--radius-pill)',
            border: '0px',
            hoverBackground: 'var(--surface-resizer-handle-background-hover)',
            hoverShadow: 'var(--surface-resizer-handle-shadow-hover)',
        });
        expect(appearance.handles).toHaveLength(6);
        expect(appearance.demoWidth).toBeLessThanOrEqual(appearance.cardWidth + 1);
        expect(appearance.documentOverflow).toBeLessThanOrEqual(1);
        expect(appearance.thumbWidth).toBeGreaterThan(0);
        expect(appearance.thumbHeight).toBeGreaterThan(0);
        expect(appearance.handles[0].accent).not.toBe(appearance.handles[1].accent);
        expect(appearance.handles[2].accent).toBe(appearance.handles[0].accent);
        expect(appearance.handles[4].accent).toBe(appearance.handles[1].accent);
        for (const handle of appearance.handles) {
            expect(handle.inputWidth).toBeGreaterThan(appearance.thumbWidth);
            expect(handle.inputHeight).toBeGreaterThan(0);
        }
    });

    test(`keeps the live Backtest allocation handle draggable at ${viewport.width}x${viewport.height}`, async ({page}) => {
        await page.setViewportSize(viewport);
        await page.goto('/workspaces/backtest?range=2y&strategy=leveraged-rotation&capital=10000'
            + '&initial_primary_pct=35&initial_leveraged_pct=35');
        await page.locator('[data-dismissible-notice]').evaluateAll((notices) => {
            notices.forEach((notice) => { notice.hidden = true; });
        });
        if (viewport.width <= 900) {
            await expect(await openBacktestParameterOverlay(page)).toBe(true);
        }
        const allocation = page.locator('[data-strategy-allocation-range]');
        const initialAllocation = page.locator('details.strategy-factor-group--allocation-visual')
            .filter({has: allocation});
        await expect(initialAllocation).toHaveCount(1);
        if (!(await initialAllocation.evaluate((element) => element.open))) {
            await initialAllocation.locator('summary').click();
        }
        await expect(initialAllocation).toHaveAttribute('open', '');
        const handle = allocation.locator('[data-allocation-boundary="primary"]');
        await expect(allocation).toBeVisible();
        await expect(allocation.locator('.strategy-allocation-track')).toBeVisible();
        await expect(handle).toHaveValue('35');
        await expect(handle).toBeVisible();
        await handle.scrollIntoViewIfNeeded();
        const before = Number(await handle.inputValue());
        const readTarget = () => handle.evaluate((input) => {
            const rect = input.getBoundingClientRect();
            const probe = document.createElement('span');
            probe.style.cssText = 'position:absolute;pointer-events:none;width:var(--strategy-range-thumb-inline-size);height:1px';
            input.parentElement.append(probe);
            const thumbWidth = probe.getBoundingClientRect().width;
            probe.remove();
            const fraction = (Number(input.value) - Number(input.min))
                / (Number(input.max) - Number(input.min));
            const idealX = rect.left + (thumbWidth / 2) + (fraction * (rect.width - thumbWidth));
            const idealY = rect.top + (rect.height / 2);
            let point = null;
            for (let dy = 0; dy <= rect.height / 2 && !point; dy += 2) {
                for (let dx = 0; dx <= thumbWidth && !point; dx += 2) {
                    for (const [x, y] of [
                        [idealX + dx, idealY + dy], [idealX - dx, idealY + dy],
                        [idealX + dx, idealY - dy], [idealX - dx, idealY - dy],
                    ]) {
                        if (document.elementFromPoint(x, y) === input) {
                            point = {x, y};
                            break;
                        }
                    }
                }
            }
            const hit = document.elementFromPoint(idealX, idealY);
            return {
                ...point,
                distance: Math.min(42, rect.width * 0.16),
                idealX,
                idealY,
                inputRect: {left: rect.left, top: rect.top, width: rect.width, height: rect.height},
                thumbWidth,
                idealHit: {tag: hit?.tagName, className: String(hit?.className || '')},
            };
        });
        let target;
        await expect.poll(async () => {
            target = await readTarget();
            return target.x;
        }, {message: 'The expanded allocation thumb must expose a pointer hit'}).toBeDefined();
        const hit = await page.evaluate(({x, y}) => {
            const input = document.querySelector('[data-strategy-allocation-range] [data-allocation-boundary="primary"]');
            const target = document.elementFromPoint(x, y);
            return {matches: target === input, tag: target?.tagName, className: String(target?.className || '')};
        }, target);
        expect(hit.matches, `Allocation thumb hit target: ${JSON.stringify(hit)}`).toBe(true);
        await page.mouse.move(target.x, target.y);
        await page.mouse.down();
        await page.mouse.move(target.x + target.distance, target.y, {steps: 8});
        await page.mouse.up();
        await expect.poll(async () => Number(await handle.inputValue())).toBeGreaterThan(before + 3);
        await expect.poll(async () => Number(await allocation.locator('[name="initial_primary_pct"]').inputValue()))
            .toBeGreaterThan(before + 3);
        await expect(allocation.locator('[data-allocation-primary-value]')).toContainText('%');
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
            .toBeLessThanOrEqual(1);
    });
}
