/* Code version: v1.0.0 */
import {expect, test} from '@playwright/test';
import {mockInvestmentReadApis} from '../critical_flows/support.mjs';

// Fixtures are intercepted in the browser and never enter a persistent store.
const loadInvestmentPage = async (page) => {
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
    await page.setViewportSize({width: 1_024, height: 863});
    await page.goto('/trade/investment?ticker=QQQ');
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
    await loadInvestmentPage(page);
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
    expect(snapshot.activeIndex).toBe('1');
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
        window.__pillMotion = {cancelled: 0, hidden: 0};
        control.addEventListener('transitioncancel', (event) => {
            if (event.pseudoElement === '::before' && event.propertyName === 'transform') {
                window.__pillMotion.cancelled += 1;
            }
        });
        new MutationObserver(() => {
            if (!control.classList.contains('is-pill-ready')) window.__pillMotion.hidden += 1;
        }).observe(control, {attributes: true, attributeFilter: ['class']});
    });

    for (const view of ['holdings', 'stock_details', 'metrics', 'chart']) {
        const slid = segmented.evaluate((control) => new Promise((resolve) => {
            const onEnd = (event) => {
                if (event.pseudoElement !== '::before' || event.propertyName !== 'transform') return;
                control.removeEventListener('transitionend', onEnd);
                resolve();
            };
            control.addEventListener('transitionend', onEnd);
        }));
        await page.locator(`label[for="investment_view_${view}"]`).click();
        await expect(segmented).toHaveAttribute('data-active', view);
        await slid;
    }

    // Each selection has one owner writing the pill, so no transition was cancelled midway
    // and the pill never faded out and back in while it was re-measured.
    expect(await page.evaluate(() => window.__pillMotion)).toEqual({cancelled: 0, hidden: 0});
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
