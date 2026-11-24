/* Code version: v1.0.3 */
import {expect, test} from '@playwright/test';
import {mockInvestmentReadApis} from '../critical_flows/support.mjs';

// Fixtures are intercepted in the browser and never enter a persistent store.
const loadInvestmentPage = async (page, query = 'view=holdings', width = 1_024) => {
    await mockInvestmentReadApis(page, {
        transactions: [
            {broker: 'ibkr', date: '2026-07-10', type: 'buy', ticker: 'QQQ', currency: 'USD', quantity: 1, price: 500, amount: -500},
            {broker: 'ibkr', date: '2026-07-11', type: 'sell', ticker: 'QQQ', currency: 'USD', quantity: 1, price: 501, amount: 501},
        ],
        priceHistoryByTicker: {
            QQQ: [
                {date: '2026-07-10', close: 500},
                {date: '2026-07-11', close: 501},
            ],
        },
    });
    await page.setViewportSize({width, height: 863});
    await page.goto(query ? `/trade/investment?${query}` : '/trade/investment');
    await expect(page.locator('#investment_view_segmented')).toHaveClass(/is-pill-ready/);
};

test('does not rewrite the broker select while the Investment page is idle', async ({page}) => {
    await loadInvestmentPage(page);
    // Let start-up work finish, then watch the select that a repair loop keeps rewriting.
    await page.waitForTimeout(1_500);
    const rewrites = await page.evaluate(() => new Promise((resolve) => {
        const select = document.getElementById('investment_import_broker');
        let records = 0;
        const observer = new MutationObserver((list) => {
            records += list.length;
        });
        observer.observe(select, {childList: true});
        window.setTimeout(() => {
            observer.disconnect();
            resolve(records);
        }, 1_500);
    }));
    // The control repairs re-sorted an already sorted list on every frame, and every
    // rewrite scheduled the next repair: about ten thousand records per second.
    expect(rewrites).toBe(0);
});

test('moves the view pill in the click task and renders the view after its first frame', async ({page}) => {
    await loadInvestmentPage(page, 'view=metrics');
    const segmented = page.locator('#investment_view_segmented');
    const snapshot = await segmented.evaluate((control) => {
        const readPill = () => control.style.getPropertyValue('--segmented-pill-left');
        const before = readPill();
        document.querySelector('label[for="investment_view_holdings"]').click();
        return {
            before,
            after: readPill(),
            ready: control.classList.contains('is-pill-ready'),
            activeIndex: control.style.getPropertyValue('--segmented-active-index'),
            holdingsHiddenAtOnce: document.getElementById('investment_holdings_panel').hidden,
        };
    });
    expect(snapshot.after).not.toBe(snapshot.before);
    expect(snapshot.activeIndex).toBe('0');
    expect(snapshot.ready).toBe(true);
    // The view's own rendering has not started in the click's task, so it cannot delay the pill.
    expect(snapshot.holdingsHiddenAtOnce).toBe(true);

    await expect(page.locator('#investment_holdings_panel')).toBeVisible();
    await expect(segmented).toHaveAttribute('data-active', 'holdings');
});

test('slides the view pill once per selection without hiding or restarting it', async ({page}) => {
    await loadInvestmentPage(page);
    // Count only after start-up layout work has settled; it can reset the very first frame.
    await page.waitForTimeout(1_500);
    const segmented = page.locator('#investment_view_segmented');
    await segmented.evaluate((control) => {
        window.__pillMotion = {cancelled: 0, finished: 0, hidden: 0};
        control.addEventListener('transitioncancel', (event) => {
            if (event.pseudoElement === '::before' && event.propertyName === 'transform') {
                window.__pillMotion.cancelled += 1;
            }
        });
        control.addEventListener('transitionend', (event) => {
            if (event.pseudoElement === '::before' && event.propertyName === 'transform') {
                window.__pillMotion.finished += 1;
            }
        });
        new MutationObserver(() => {
            if (!control.classList.contains('is-pill-ready')) window.__pillMotion.hidden += 1;
        }).observe(control, {attributes: true, attributeFilter: ['class']});
    });

    const views = ['metrics', 'holdings', 'metrics', 'holdings'];
    for (const [index, view] of views.entries()) {
        await page.locator(`label[for="investment_view_${view}"]`).click();
        await expect(segmented).toHaveAttribute('data-active', view);
        await expect.poll(() => page.evaluate(() => window.__pillMotion.finished)).toBe(index + 1);
    }

    // Each selection has one owner writing the pill, so no transition was cancelled midway
    // and the pill never faded out and back in while it was re-measured.
    expect(await page.evaluate(() => window.__pillMotion)).toEqual({cancelled: 0, finished: views.length, hidden: 0});
});

test('leaves the Investment view pill geometry to its own adapter', async ({page}) => {
    await loadInvestmentPage(page);
    const segmented = page.locator('#investment_view_segmented');
    await expect(segmented).toHaveAttribute('data-segmented-owner', 'adapter');

    const seen = await segmented.evaluate((control) => new Promise((resolve) => {
        const values = new Set();
        const read = () => `${control.style.getPropertyValue('--segmented-pill-left')}|${control.style.getPropertyValue('--segmented-pill-width')}`;
        values.add(read());
        const observer = new MutationObserver(() => values.add(read()));
        observer.observe(control, {attributes: true, attributeFilter: ['style']});
        // Both events schedule the page-wide segmented-control sync.
        window.dispatchEvent(new Event('resize'));
        const probe = document.createElement('div');
        probe.hidden = true;
        document.body.appendChild(probe);
        probe.hidden = false;
        probe.remove();
        window.setTimeout(() => {
            observer.disconnect();
            resolve([...values]);
        }, 800);
    }));
    // The page-wide sync used to write whole-option values that the adapter then corrected.
    expect(seen).toHaveLength(1);
});

test('moves an overview range pill in the click task without hiding it', async ({page}) => {
    await loadInvestmentPage(page);
    await page.locator('.investment-holdings-summary-row').click();
    const overviewRange = page.locator('#investment_equity_chart .investment-stock-details-range-segmented');
    await expect(overviewRange).toHaveClass(/is-pill-ready/);
    const snapshot = await overviewRange.evaluate((control) => {
        const readPill = () => control.style.getPropertyValue('--segmented-pill-left');
        const before = readPill();
        control.querySelector('label[for="investment_equity_range_3m"]').click();
        return {before, after: readPill(), ready: control.classList.contains('is-pill-ready')};
    });
    expect(snapshot.after).not.toBe(snapshot.before);
    expect(snapshot.ready).toBe(true);
    await expect(overviewRange.locator('input[value="3m"]')).toBeChecked();
});

for (const [width, query] of [[854, 'view=holdings&summary=expanded&summary-range=ytd'], [390, '']]) {
    test(`renders the restored Overview range at its final shape from the first visible frame at ${width}px`, async ({page}) => {
        await page.addInitScript(() => {
            localStorage.setItem('worthward:investment:page-memory:v1', JSON.stringify({
                last_view: 'holdings',
                last_overview_expanded: true,
                last_equity_range: 'ytd',
            }));
            window.__overviewRangeFrames = [];
            const sample = () => {
                const control = document.querySelector('[data-investment-equity-range-segmented]');
                const rail = control?.getBoundingClientRect();
                if (rail?.height > 0) {
                    const active = control.querySelector('input:checked');
                    const option = active.closest('label').getBoundingClientRect();
                    const pill = getComputedStyle(control, '::before');
                    const transform = new DOMMatrixReadOnly(pill.transform === 'none' ? undefined : pill.transform);
                    window.__overviewRangeFrames.push({
                        chartReady: document.getElementById('investmentEquityChart')?.dataset.investmentChartReady === '1',
                        active: active.value,
                        rows: new Set(Array.from(control.querySelectorAll('label'), (label) => label.getBoundingClientRect().top)).size,
                        railWidth: rail.width,
                        railHeight: rail.height,
                        railRadius: getComputedStyle(control).borderTopLeftRadius,
                        pillWidth: parseFloat(pill.width),
                        pillHeight: parseFloat(pill.height),
                        pillRadius: pill.borderTopLeftRadius,
                        pillOpacity: Number(pill.opacity),
                        widthError: Math.abs(parseFloat(pill.width) - option.width),
                        leftError: Math.abs(rail.left + parseFloat(pill.left) + transform.m41 - control.scrollLeft - option.left),
                    });
                }
                if (window.__overviewRangeFrames.length < 12) requestAnimationFrame(sample);
            };
            requestAnimationFrame(sample);
        });

        await loadInvestmentPage(page, query, width);
        await expect(page.locator('#investmentEquityChart')).toHaveAttribute('data-investment-chart-ready', '1');
        await expect.poll(() => page.evaluate(() => window.__overviewRangeFrames.length)).toBe(12);
        const frames = await page.evaluate(() => window.__overviewRangeFrames);
        const final = frames.at(-1);
        expect(frames[0].chartReady).toBe(false);
        expect(final.chartReady).toBe(true);
        for (const frame of frames) {
            expect(frame.active).toBe('ytd');
            expect(frame.rows).toBe(1);
            expect(Math.abs(frame.railWidth - final.railWidth)).toBeLessThanOrEqual(1);
            expect(frame.railHeight).toBe(final.railHeight);
            expect(frame.railRadius).toBe(final.railRadius);
            expect(Math.abs(frame.pillWidth - final.pillWidth)).toBeLessThanOrEqual(1);
            expect(frame.pillHeight).toBe(final.pillHeight);
            expect(frame.pillRadius).toBe(final.pillRadius);
            expect(frame.pillOpacity).toBe(1);
            expect(frame.widthError).toBeLessThanOrEqual(1);
            expect(frame.leftError).toBeLessThanOrEqual(1);
        }
    });
}
