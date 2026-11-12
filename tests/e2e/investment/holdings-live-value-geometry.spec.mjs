/* Code version: v1.0.0 */
import {expect, test} from '@playwright/test';
import {mockInvestmentReadApis} from '../critical_flows/support.mjs';

test('keeps Holdings live-value geometry stable and fixed summary cumulative P&L free of a daily badge', async ({page}) => {
    await page.addInitScript(() => {
        const RealDate = Date;
        const fixedTimestamp = new RealDate('2026-07-22T14:00:00Z').valueOf();
        class FixedDate extends RealDate {
            constructor(...args) {
                super(...(args.length ? args : [fixedTimestamp]));
            }

            static now() {
                return fixedTimestamp;
            }
        }
        window.Date = FixedDate;

        const nativeSetTimeout = window.setTimeout.bind(window);
        window.setTimeout = (callback, delay, ...args) => {
            if (delay === 60_000 && typeof callback === 'function') {
                window.__testTriggerInvestmentHoldingsRealtimePoll = () => callback(...args);
                return 0;
            }
            return nativeSetTimeout(callback, delay, ...args);
        };
    });
    const tickers = ['TST1', 'TST2', 'TST3', 'TST4', 'TST5'];
    let quotePrice = 100;
    const realtimeQuotes = () => tickers.map((ticker) => ({
        ticker,
        price: quotePrice,
        timestamp: '2026-07-22 10:00',
        session: 'intraday',
        session_date: '2026-07-22',
        market: 'US',
        source: 'yfinance',
    }));
    await mockInvestmentReadApis(page, {
        transactions: tickers.map((ticker, index) => ({
            ledger_no: index + 1,
            broker: 'ibkr',
            date: '2026-07-21',
            type: 'buy',
            ticker,
            currency: 'USD',
            quantity: 1,
            price: 110,
            amount: -110,
        })),
        priceHistoryByTicker: Object.fromEntries(
            tickers.map((ticker) => [ticker, [{date: '2026-07-21', close: 99}]]),
        ),
        realtimeQuotes,
        marketSession: {
            session: 'intraday',
            is_trading_day: true,
            is_realtime_allowed: true,
            session_date: '2026-07-22',
        },
    });
    await page.goto('/trade/investment');
    const surface = page.locator('#investment_view_surface');
    await surface.evaluate((node) => {
        const workspace = node.closest('.investment-workspace-header');
        const eventName = 'worthward:investment-view-surface-height-released';
        const onHeightReleased = (event) => {
            if (event.target !== node || node.dataset.activeView !== 'holdings') return;
            workspace.removeEventListener(eventName, onHeightReleased);
            node.dataset.e2eHoldingsHeightReleased = String(!node.style.height && !node.style.overflow);
        };
        workspace.addEventListener(eventName, onHeightReleased);
    });
    await page.locator('label[for="investment_view_holdings"]').click();
    await expect(surface).toHaveAttribute('data-e2e-holdings-height-released', 'true');

    const summaryRow = page.locator(
        '#investment_holdings_panel:not([hidden]) .investment-holdings-summary-row',
    );
    const cumulativePnl = summaryRow.locator('[data-investment-live-field="summary_cumulative_pnl"]');
    const dailyNetPnl = summaryRow.locator('[data-investment-live-field="summary_daily_cumulative_pnl"]');
    await expect(cumulativePnl).toHaveAttribute('data-investment-live-display', '-50.00');
    await expect(dailyNetPnl).toHaveCount(0);

    const readLiveValueGeometry = () => page.evaluate(() => {
        const panel = document.querySelector('#investment_holdings_panel:not([hidden])');
        const shell = panel?.querySelector('.investment-holdings-table-shell');
        const table = panel?.querySelector('[data-table-body]');
        const row = panel?.querySelector(
            '[data-table-scroll] tr[data-investment-holdings-ticker="TST1"]',
        );
        const readRect = (element) => {
            const rect = element?.getBoundingClientRect();
            return rect ? {width: rect.width, height: rect.height} : null;
        };
        return {
            shell: readRect(shell),
            table: readRect(table),
            row: readRect(row),
            last: readRect(row?.querySelector('[data-investment-live-field="last"]')),
            marketValue: readRect(row?.querySelector('[data-investment-live-field="market_value"]')),
            unrealizedPnl: readRect(row?.querySelector('[data-investment-live-field="unrealized_pnl"]')),
            positionWeight: readRect(row?.querySelector('[data-investment-live-field="position_weight"]')),
            summaryCumulativePnl: readRect(
                panel?.querySelector('[data-investment-live-field="summary_cumulative_pnl"]'),
            ),
        };
    });
    const readStableLiveValueGeometry = async () => {
        await expect(surface).toHaveAttribute('data-active-view', 'holdings');
        // A view switch keeps a temporary surface height until its cleanup finishes.
        await expect.poll(() => surface.evaluate((node) => ({
            height: node.style.height,
            overflow: node.style.overflow,
        })), {timeout: 5_000}).toEqual({height: '', overflow: ''});
        await page.evaluate(() => document.fonts.ready);

        // Settle each snapshot independently of the other snapshot's dimensions.
        let previous = null;
        let geometry = null;
        let stableSamples = 0;
        await expect.poll(async () => {
            await page.evaluate(() => new Promise((resolve) => {
                requestAnimationFrame(() => requestAnimationFrame(resolve));
            }));
            geometry = await readLiveValueGeometry();
            const complete = Object.values(geometry).every((rect) => rect
                && Number.isFinite(rect.width) && rect.width > 0
                && Number.isFinite(rect.height) && rect.height > 0);
            stableSamples = complete && previous
                && JSON.stringify(geometry) === JSON.stringify(previous)
                ? stableSamples + 1 : 0;
            previous = complete ? geometry : null;
            return stableSamples;
        }, {timeout: 5_000, intervals: [16, 32, 64, 100]}).toBeGreaterThanOrEqual(2);
        return geometry;
    };

    const dailyHoldingBadges = page.locator(
        '#investment_holdings_panel:not([hidden]) [data-table-scroll] tr[data-investment-holdings-ticker] [data-investment-live-field="daily_unrealized_pnl"]',
    );
    await expect(dailyHoldingBadges).toHaveCount(5);
    for (let index = 0; index < 5; index += 1) {
        await expect(dailyHoldingBadges.nth(index)).toHaveAttribute('data-investment-live-display', '+1.00');
    }
    const initialGeometry = await readStableLiveValueGeometry();

    quotePrice = 1_000;
    await expect.poll(() => page.evaluate(() => (
        typeof window.__testTriggerInvestmentHoldingsRealtimePoll
    ))).toBe('function');
    await page.evaluate(() => window.__testTriggerInvestmentHoldingsRealtimePoll());
    await expect(cumulativePnl).toHaveAttribute('data-investment-live-display', '+4,450.00');
    await expect(dailyNetPnl).toHaveCount(0);
    for (let index = 0; index < 5; index += 1) {
        await expect(dailyHoldingBadges.nth(index)).toHaveAttribute('data-investment-live-display', '+901.00');
    }
    const updatedGeometry = await readStableLiveValueGeometry();
    for (const key of Object.keys(initialGeometry)) {
        expect(updatedGeometry[key]?.width, `${key} width`).toBeCloseTo(initialGeometry[key]?.width, 1);
        expect(updatedGeometry[key]?.height, `${key} height`).toBeCloseTo(initialGeometry[key]?.height, 1);
    }
});
