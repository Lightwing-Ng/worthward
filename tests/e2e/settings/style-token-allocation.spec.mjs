/* Code version: v1.0.1 */
import {expect, test} from '@playwright/test';

const demoSelector = '[data-style-token-card="allocation-range"] .style-token-allocation-demo';

async function closeSidebar(page) {
    const toggle = page.locator('#sidebar_toggle');
    if (await toggle.getAttribute('aria-expanded') === 'true') await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
}

async function dragRange(page, input, value, inspect = async () => {}) {
    await input.scrollIntoViewIfNeeded();
    const pointer = await input.evaluate((element, target) => {
        const bounds = element.getBoundingClientRect();
        const probe = document.createElement('span');
        probe.style.cssText = 'position:absolute;pointer-events:none;width:var(--strategy-range-thumb-inline-size)';
        element.parentElement.append(probe);
        const thumbWidth = probe.getBoundingClientRect().width;
        probe.remove();
        const position = (number) => bounds.left + thumbWidth / 2
            + (number - Number(element.min)) / (Number(element.max) - Number(element.min))
            * (bounds.width - thumbWidth);
        const x = position(Number(element.value));
        const y = bounds.top + bounds.height / 2;
        for (let dy = 0; dy <= bounds.height / 2; dy += 2) {
            for (let dx = 0; dx <= thumbWidth; dx += 2) {
                for (const [hitX, hitY] of [[x + dx, y + dy], [x - dx, y + dy], [x + dx, y - dy], [x - dx, y - dy]]) {
                    if (document.elementFromPoint(hitX, hitY) === element) {
                        return {x: hitX, y: hitY, targetX: position(target)};
                    }
                }
            }
        }
        return null;
    }, value);
    expect(pointer, 'The native range thumb must expose a pointer hit target').not.toBeNull();
    await page.mouse.move(pointer.x, pointer.y);
    await page.mouse.down();
    try {
        await page.mouse.move(pointer.targetX, pointer.y, {steps: 8});
        await expect.poll(async () => Math.abs(Number(await input.inputValue()) - value)).toBeLessThanOrEqual(1);
        // Check the preview before pointerup so a change-only binding cannot pass.
        await inspect();
    } finally {
        await page.mouse.up();
    }
}

async function distributionState(allocation) {
    return allocation.evaluate((element) => {
        const primary = Number(element.querySelector('[data-allocation-boundary="primary"]').value);
        const invested = Number(element.querySelector('[data-allocation-boundary="invested"]').value);
        const labels = element.querySelector('.strategy-allocation-labels').getBoundingClientRect();
        const track = element.querySelector('.strategy-allocation-track').getBoundingClientRect();
        return {
            primary,
            invested,
            captions: [...element.querySelectorAll('.strategy-allocation-label-value')].map((node) => node.textContent),
            widths: [...element.querySelectorAll('.strategy-allocation-segment')]
                .map((node) => node.getBoundingClientRect().width),
            trackWidth: track.width,
            labelWidth: labels.width,
            labels: [...element.querySelectorAll('.strategy-allocation-label')].map((node) => {
                const bounds = node.getBoundingClientRect();
                return {left: bounds.left - labels.left, right: bounds.right - labels.left, center: (bounds.left + bounds.right) / 2};
            }),
        };
    });
}

async function expectDistribution(allocation) {
    const state = await distributionState(allocation);
    const percentages = [state.primary, state.invested - state.primary, 100 - state.invested];
    expect(state.captions).toEqual([
        `${percentages[0].toFixed(2)}%`,
        `${percentages[1].toFixed(2)}%`,
        (percentages[2] * 100).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2}),
    ]);
    state.widths.forEach((width, index) => {
        expect(Math.abs(width - state.trackWidth * percentages[index] / 100)).toBeLessThanOrEqual(1);
    });
    state.labels.forEach((label, index) => {
        expect(label.left).toBeGreaterThanOrEqual(-1);
        expect(label.right).toBeLessThanOrEqual(state.labelWidth + 1);
        if (index) expect(label.left - state.labels[index - 1].right).toBeGreaterThanOrEqual(5);
    });
    return state;
}

async function expectLimits(demo) {
    const bars = await demo.locator('[data-limit-range]').evaluateAll((elements) => elements.map((element) => {
        const bounds = element.getBoundingClientRect();
        return {
            values: [...element.querySelectorAll('input[type="range"]')].map((input) => Number(input.value)),
            captions: [...element.querySelectorAll('.strategy-limit-value')].map((node) => node.textContent),
            labels: [...element.querySelectorAll('.strategy-limit-labels label')].map((node) => {
                const label = node.getBoundingClientRect();
                return {left: label.left - bounds.left, right: label.right - bounds.left};
            }),
            width: bounds.width,
        };
    }));
    expect(bars).toHaveLength(2);
    for (const bar of bars) {
        expect(bar.captions).toEqual(bar.values.map((value) => `${Math.round(value)}%`));
        expect(bar.values[0]).toBeLessThanOrEqual(bar.values[1]);
        expect(bar.labels[0].left).toBeGreaterThanOrEqual(-1);
        expect(bar.labels[1].right).toBeLessThanOrEqual(bar.width + 1);
        expect(bar.labels[1].left - bar.labels[0].right).toBeGreaterThanOrEqual(7);
    }
    expect(bars[0].values[0] + bars[1].values[1]).toBeLessThanOrEqual(100);
    expect(bars[1].values[0] + bars[0].values[1]).toBeLessThanOrEqual(100);
}

async function expectSeparatedHandles(container) {
    await expect(container.locator('.strategy-allocation-track-shell')).toHaveClass(/has-close-handles/);
    const rows = await container.locator('input[type="range"]').evaluateAll((inputs) => inputs.map((input) => input.getBoundingClientRect().y));
    expect(Math.abs(rows[0] - rows[1])).toBeGreaterThanOrEqual(21);
}

for (const viewport of [{width: 1006, height: 791}, {width: 390, height: 844}]) {
    test(`Style tokens allocation previews follow all six dragged handles at ${viewport.width}px`, async ({page}) => {
        await page.setViewportSize(viewport);
        await page.emulateMedia({reducedMotion: 'reduce'});
        await page.goto('/settings/style-tokens');
        await closeSidebar(page);
        const demo = page.locator(demoSelector);
        const allocation = demo.locator('[data-strategy-allocation-range]');
        await expect(demo.locator('input[type="range"]')).toHaveCount(6);
        await expect(allocation.locator('[data-allocation-boundary="primary"]')).toHaveAttribute('aria-valuetext', /QQQ/);
        const writes = [];
        page.on('request', (request) => {
            if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method())) writes.push(request.url());
        });
        const initialUrl = page.url();
        await expectDistribution(allocation);
        const primary = allocation.locator('[data-allocation-boundary="primary"]');
        const invested = allocation.locator('[data-allocation-boundary="invested"]');
        const before = await distributionState(allocation);
        await dragRange(page, primary, 30, () => expectDistribution(allocation));
        const afterPrimary = await distributionState(allocation);
        expect(Math.abs(afterPrimary.labels[0].center - before.labels[0].center)).toBeGreaterThan(5);
        await dragRange(page, invested, 85, () => expectDistribution(allocation));
        const afterInvested = await distributionState(allocation);
        expect(Math.abs(afterInvested.labels[2].center - afterPrimary.labels[2].center)).toBeGreaterThan(5);

        for (const [name, value] of [['primary_min_pct', 35], ['primary_max_pct', 85], ['leveraged_min_pct', 10], ['leveraged_max_pct', 50]]) {
            const input = demo.locator(`[name="${name}"]`);
            const boundary = name.includes('_min_') ? 'min' : 'max';
            const label = input.locator('xpath=../..').locator(`[data-limit-value="${boundary}"]`).locator('..');
            const initial = await label.boundingBox();
            await dragRange(page, input, value, () => expectLimits(demo));
            const moved = await label.boundingBox();
            expect(Math.abs(moved.x - initial.x)).toBeGreaterThan(5);
        }

        await dragRange(page, demo.locator('[name="primary_max_pct"]'), 0, () => expectLimits(demo));
        const primaryLimits = demo.locator('[data-limit-range="primary"]');
        await expectSeparatedHandles(primaryLimits);
        await expect(primaryLimits.locator('.strategy-limit-labels label')).toHaveCount(2);
        await expect(primaryLimits.locator('.strategy-limit-labels label').first()).toHaveCSS('text-align', 'left');
        await dragRange(page, demo.locator('[name="primary_min_pct"]'), 100, () => expectLimits(demo));
        await expectSeparatedHandles(primaryLimits);
        await expectSeparatedHandles(demo.locator('[data-limit-range="leveraged"]'));
        await expect(primaryLimits.locator('.strategy-limit-labels label').first()).toHaveCSS('text-align', 'right');

        await dragRange(page, primary, 0, () => expectDistribution(allocation));
        await dragRange(page, invested, 0, () => expectDistribution(allocation));
        await expectSeparatedHandles(allocation);
        await dragRange(page, invested, 100, () => expectDistribution(allocation));
        await dragRange(page, primary, 100, () => expectDistribution(allocation));
        await expectSeparatedHandles(allocation);
        await expectDistribution(allocation);
        expect(page.url()).toBe(initialUrl);
        expect(writes).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    });
}

test('Style tokens allocation controls rebind after Settings navigation and release detached demos', async ({page}) => {
    await page.setViewportSize({width: 1006, height: 791});
    await page.emulateMedia({reducedMotion: 'reduce'});
    await page.goto('/settings/color-tokens');
    await page.evaluate(() => { window.__allocationDocument = 'retained'; });
    const navigate = async (section) => {
        const toggle = page.locator('#sidebar_toggle');
        if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
        await page.locator(`.settings-nav-item-${section}`).click();
        await expect(page).toHaveURL(new RegExp(`/settings/${section}$`));
    };
    await navigate('style-tokens');
    await closeSidebar(page);
    const allocation = page.locator(`${demoSelector} [data-strategy-allocation-range]`);
    const primary = allocation.locator('[data-allocation-boundary="primary"]');
    await dragRange(page, primary, 30, () => expectDistribution(allocation));
    await allocation.evaluate((element) => {
        window.__detachedAllocation = {
            input: element.querySelector('[data-allocation-boundary="primary"]'),
            value: element.querySelector('[data-allocation-primary-value]'),
        };
    });
    await navigate('color-tokens');
    expect(await page.evaluate(() => {
        const {input, value} = window.__detachedAllocation;
        const before = value.textContent;
        input.value = '20';
        input.dispatchEvent(new Event('input', {bubbles: true}));
        return {connected: input.isConnected, inactive: value.textContent === before};
    })).toEqual({connected: false, inactive: true});
    await navigate('style-tokens');
    await closeSidebar(page);
    await expect(primary).toHaveValue('44');
    await page.evaluate(() => {
        window.WORTHWARD_BOOTSTRAP.initSettingsWorkspace();
        window.WORTHWARD_BOOTSTRAP.initSettingsWorkspace();
    });
    await dragRange(page, primary, 55, () => expectDistribution(allocation));
    await primary.focus();
    const beforeKey = Number(await primary.inputValue());
    await primary.press('ArrowRight');
    expect(Number(await primary.inputValue())).toBeGreaterThan(beforeKey);
    await expectDistribution(allocation);
    expect(await page.evaluate(() => window.__allocationDocument)).toBe('retained');
});
