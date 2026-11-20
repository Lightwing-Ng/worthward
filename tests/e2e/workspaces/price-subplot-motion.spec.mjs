/* Code version: v1.0.0 */
import {expect, test} from '@playwright/test';

test('carries subplot drag release speed into its spring and bounds edge jelly', async ({page}) => {
    await page.goto('/workspaces/prices?ticker=DRAM&ticker=MU&ticker=STX&period=3d');
    await page.waitForFunction(() => (
        [...document.querySelectorAll('[data-price-subplot-canvas]')]
            .every((canvas) => Boolean(window.Chart?.getChart?.(canvas)))
    ));
    const firstSection = page.locator('[data-price-subplot][data-ticker="DRAM"]');
    const handle = firstSection.locator('[data-price-subplot-order-handle]');
    const edge = await handle.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        window.__subplotJellyPeak = 0;
        const observer = new MutationObserver(() => {
            const offset = Number.parseFloat(element.style.getPropertyValue('--price-subplot-order-jelly-y')) || 0;
            window.__subplotJellyPeak = Math.max(window.__subplotJellyPeak, Math.abs(offset));
        });
        observer.observe(element, {attributes: true, attributeFilter: ['style']});
        const dispatch = (target, type, clientY, time) => {
            const event = new PointerEvent(type, {
                bubbles: true, button: 0, pointerId: 81, clientX: x, clientY,
            });
            Object.defineProperty(event, 'timeStamp', {value: time});
            target.dispatchEvent(event);
        };
        dispatch(element, 'pointerdown', y, 1_000);
        dispatch(window, 'pointermove', y - 20, 1_020);
        dispatch(window, 'pointermove', y - 60, 1_040);
        const mapped = element.closest('[data-price-subplot]').style.getPropertyValue('--price-subplot-order-y');
        dispatch(window, 'pointerup', y - 60, 1_041);
        return {mapped, rect: rect.toJSON()};
    });
    expect(edge.mapped).toBe('-60.00px');
    await expect.poll(() => page.evaluate(() => window.__subplotJellyPeak)).toBeGreaterThan(1);
    await expect.poll(() => handle.evaluate((element) => (
        element.style.getPropertyValue('--price-subplot-order-jelly-y')
    ))).toBe('');
    expect(await page.locator('#price_subplot_region > [data-price-subplot]').evaluateAll(
        (sections) => sections.map((section) => section.dataset.ticker),
    )).toEqual(['DRAM', 'MU', 'STX']);
    expect(await handle.evaluate((element) => element.getBoundingClientRect().width))
        .toBeCloseTo(edge.rect.width, 1);
    expect(await page.evaluate(() => window.__subplotJellyPeak)).toBeLessThanOrEqual(8);

    const lastHandle = page.locator('[data-price-subplot][data-ticker="STX"] [data-price-subplot-order-handle]');
    await lastHandle.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        window.__subplotLastJellyPeak = 0;
        const observer = new MutationObserver(() => {
            const offset = Number.parseFloat(element.style.getPropertyValue('--price-subplot-order-jelly-y')) || 0;
            window.__subplotLastJellyPeak = Math.max(window.__subplotLastJellyPeak, Math.abs(offset));
        });
        observer.observe(element, {attributes: true, attributeFilter: ['style']});
        const dispatch = (target, type, clientY, time) => {
            const event = new PointerEvent(type, {
                bubbles: true, button: 0, pointerId: 85, clientX: x, clientY,
            });
            Object.defineProperty(event, 'timeStamp', {value: time});
            target.dispatchEvent(event);
        };
        dispatch(element, 'pointerdown', y, 1_500);
        dispatch(window, 'pointermove', y + 20, 1_520);
        dispatch(window, 'pointermove', y + 60, 1_540);
        dispatch(window, 'pointerup', y + 60, 1_541);
    });
    await expect.poll(() => page.evaluate(() => window.__subplotLastJellyPeak)).toBeGreaterThan(1);
    await expect.poll(() => lastHandle.evaluate((element) => (
        element.style.getPropertyValue('--price-subplot-order-jelly-y')
    ))).toBe('');
    expect(await page.evaluate(() => window.__subplotLastJellyPeak)).toBeLessThanOrEqual(8);
    expect(await page.locator('#price_subplot_region > [data-price-subplot]').evaluateAll(
        (sections) => sections.map((section) => section.dataset.ticker),
    )).toEqual(['DRAM', 'MU', 'STX']);

    const reorder = await handle.evaluate((element) => {
        const section = element.closest('[data-price-subplot]');
        const next = section.nextElementSibling;
        const rect = element.getBoundingClientRect();
        const nextRect = next.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        const targetY = nextRect.top + nextRect.height * 0.75;
        let captured = null;
        const originalAnimate = section.animate.bind(section);
        section.animate = (frames, options) => {
            captured = {frames, options};
            return originalAnimate(frames, options);
        };
        const dispatch = (target, type, clientY, time) => {
            const event = new PointerEvent(type, {
                bubbles: true, button: 0, pointerId: 82, clientX: x, clientY,
            });
            Object.defineProperty(event, 'timeStamp', {value: time});
            target.dispatchEvent(event);
        };
        dispatch(element, 'pointerdown', y, 2_000);
        dispatch(window, 'pointermove', y + (targetY - y) / 2, 2_020);
        dispatch(window, 'pointermove', targetY, 2_040);
        const mapped = section.style.getPropertyValue('--price-subplot-order-y');
        dispatch(window, 'pointerup', targetY, 2_041);
        return {
            mapped,
            rawDelta: targetY - y,
            frameCount: captured?.frames.length ?? 0,
            easing: captured?.options.easing ?? '',
            first: captured?.frames[0].transform ?? '',
            second: captured?.frames[1].transform ?? '',
            last: captured?.frames.at(-1).transform ?? '',
        };
    });
    expect(Number.parseFloat(reorder.mapped)).toBeCloseTo(reorder.rawDelta, 1);
    expect(reorder.frameCount).toBe(41);
    expect(reorder.easing).toBe('linear');
    const firstY = Number(reorder.first.match(/translate3d\(0, ([\d.-]+)px/)?.[1]);
    const secondY = Number(reorder.second.match(/translate3d\(0, ([\d.-]+)px/)?.[1]);
    expect(Number.isFinite(firstY) && Number.isFinite(secondY)).toBe(true);
    expect(Math.abs(secondY - firstY)).toBeGreaterThan(5);
    expect(reorder.last).toContain('translate3d(0, 0.000px, 0)');
    expect(await page.locator('#price_subplot_region > [data-price-subplot]').evaluateAll(
        (sections) => sections.map((section) => section.dataset.ticker),
    )).toEqual(['MU', 'DRAM', 'STX']);

    const cancelled = await handle.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        const dispatch = (target, type, clientY, time) => {
            const event = new PointerEvent(type, {
                bubbles: true, button: 0, pointerId: 83, clientX: x, clientY,
            });
            Object.defineProperty(event, 'timeStamp', {value: time});
            target.dispatchEvent(event);
        };
        dispatch(element, 'pointerdown', y, 3_000);
        dispatch(window, 'pointermove', y - 40, 3_030);
        dispatch(window, 'pointercancel', y - 40, 3_031);
        return {
            grabbed: element.getAttribute('aria-grabbed'),
            jelly: element.style.getPropertyValue('--price-subplot-order-jelly-y'),
            dragging: element.closest('[data-price-subplot]').classList.contains('is-order-dragging'),
        };
    });
    expect(cancelled).toEqual({grabbed: 'false', jelly: '', dragging: false});
    expect(await page.locator('#price_subplot_region > [data-price-subplot]').evaluateAll(
        (sections) => sections.map((section) => section.dataset.ticker),
    )).toEqual(['MU', 'DRAM', 'STX']);

    await page.emulateMedia({reducedMotion: 'reduce'});
    const reduced = await page.locator('[data-price-subplot][data-ticker="MU"] [data-price-subplot-order-handle]')
        .evaluate((element) => {
            const rect = element.getBoundingClientRect();
            const x = rect.left + rect.width / 2;
            const y = rect.top + rect.height / 2;
            const dispatch = (target, type, clientY, time) => {
                const event = new PointerEvent(type, {
                    bubbles: true, button: 0, pointerId: 84, clientX: x, clientY,
                });
                Object.defineProperty(event, 'timeStamp', {value: time});
                target.dispatchEvent(event);
            };
            dispatch(element, 'pointerdown', y, 4_000);
            dispatch(window, 'pointermove', y - 40, 4_030);
            dispatch(window, 'pointerup', y - 40, 4_031);
            return element.style.getPropertyValue('--price-subplot-order-jelly-y');
        });
    expect(reduced).toBe('');
});
