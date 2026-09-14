/* Code version: v1.0.0 */
import {expect, test} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {openBacktestParameterOverlay} from '../backtest-parameter-overlay-helper.mjs';

export {expect, test, readFile, openBacktestParameterOverlay};

export const fixturePath = (name) => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));

export const requireChipFallback = async (page) => {
    // Model a legacy store without OHLCV so fallback/cache tests actually enter
    // that branch, independently of the complete local market-store fixture.
    await page.route('**/workspaces/prices?**', async (route) => {
        const response = await route.fetch();
        const html = (await response.text()).replace(
            /(<script[^>]*id="worthward_state"[^>]*>)([\s\S]*?)(<\/script>)/,
            (_match, start, json, end) => {
                const state = JSON.parse(json);
                for (const series of state.chart?.series || []) series.ohlcv = [];
                return start + JSON.stringify(state).replaceAll('<', '\\u003c') + end;
            },
        );
        await route.fulfill({response, body: html});
    });
};

export const setSidebarExpanded = async (page, expanded) => {
    const toggle = page.locator('#sidebar_toggle');
    const expected = String(expanded);
    if (await toggle.getAttribute('aria-expanded') !== expected) {
        await toggle.click();
    }
    await expect(toggle).toHaveAttribute('aria-expanded', expected);
};

export const tapAtCenter = async (page, locator) => {
    const box = await locator.boundingBox();
    if (!box) throw new Error('Cannot tap an element without a layout box');
    await page.touchscreen.tap(box.x + (box.width / 2), box.y + (box.height / 2));
};

export const readPriceLogoThemeAlignment = async (page) => page.evaluate(() => {
    const themeRect = document.querySelector('#global_theme_toggle')?.getBoundingClientRect();
    const themeCenterX = themeRect ? themeRect.left + (themeRect.width / 2) : null;
    return {
        themeCenterX,
        logos: [...document.querySelectorAll('[data-price-subplot-canvas]')].map((canvas) => {
            const chart = window.Chart.getChart(canvas);
            const canvasRect = canvas.getBoundingClientRect();
            const logo = chart?.$closingLogoPosition;
            const viewportCenterX = logo
                ? canvasRect.left + ((logo.x / chart.width) * canvasRect.width)
                : null;
            return {
                ticker: canvas.closest('[data-price-subplot]')?.dataset.ticker || '',
                viewportCenterX,
                delta: viewportCenterX === null || themeCenterX === null
                    ? null
                    : viewportCenterX - themeCenterX,
                contract: canvas.dataset.logoHorizontalAlignment,
                clamped: canvas.dataset.logoHorizontalAlignmentClamped,
            };
        }),
    };
});

export const recordCostDistributionGuideStrokes = async (canvasLocator) => canvasLocator.evaluate((canvas) => {
    const chart = window.Chart.getChart(canvas);
    const profile = chart?.$costDistribution;
    if (!chart || !profile) return null;
    const context = chart.ctx;
    const calls = [];
    let path = [];
    const originals = {
        beginPath: context.beginPath,
        moveTo: context.moveTo,
        lineTo: context.lineTo,
        stroke: context.stroke,
    };
    try {
        context.beginPath = function beginPath() {
            path = [];
            return originals.beginPath.apply(this, arguments);
        };
        context.moveTo = function moveTo(x, y) {
            path.push({operation: 'moveTo', x, y});
            return originals.moveTo.apply(this, arguments);
        };
        context.lineTo = function lineTo(x, y) {
            path.push({operation: 'lineTo', x, y});
            return originals.lineTo.apply(this, arguments);
        };
        context.stroke = function stroke() {
            calls.push({
                path: path.map((point) => ({...point})),
                alpha: this.globalAlpha,
                dash: this.getLineDash(),
                lineWidth: this.lineWidth,
            });
            return originals.stroke.apply(this, arguments);
        };
        chart.draw();
    } finally {
        context.beginPath = originals.beginPath;
        context.moveTo = originals.moveTo;
        context.lineTo = originals.lineTo;
        context.stroke = originals.stroke;
    }
    const panelLeft = chart.chartArea.right + 10;
    const panelRight = chart.width - 8;
    const closeTo = (left, right) => Math.abs(left - right) <= 0.5;
    const isTwoPointSegment = (call) => (
        call.path.length === 2
        && call.path[0].operation === 'moveTo'
        && call.path[1].operation === 'lineTo'
    );
    const baselineStrokes = calls.filter((call) => (
        isTwoPointSegment(call)
        && closeTo(call.path[0].x, panelLeft)
        && closeTo(call.path[1].x, panelLeft)
        && closeTo(call.path[0].y, chart.chartArea.top)
        && closeTo(call.path[1].y, chart.chartArea.bottom)
    ));
    const fullWidthHorizontalStrokes = calls.filter((call) => (
        isTwoPointSegment(call)
        && closeTo(call.path[0].x, chart.chartArea.left)
        && closeTo(call.path[1].x, panelRight)
        && closeTo(call.path[0].y, call.path[1].y)
    ));
    return {
        baselineCount: baselineStrokes.length,
        fullWidthHorizontalStrokes: fullWidthHorizontalStrokes.map((call) => ({
            y: call.path[0].y,
            alpha: call.alpha,
            dash: call.dash,
            lineWidth: call.lineWidth,
        })),
    };
});

export const fulfillInertPriceLiveResponse = async (route, tickers = []) => {
    await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
            success: true,
            liveSessionActive: false,
            series: tickers.map((ticker) => ({
                ticker,
                raw_dates: ['2026-07-10 09:30'],
                dates: ['10 Jul 2026 09:30'],
                prices: [null],
                candlestick_prices: [{x: 0, o: null, h: null, l: null, c: null}],
            })),
        }),
    });
};

export const mockInvestmentReadApis = async (page, {
    transactions = [],
    startingCash = 10000,
    tradingDays = [],
    intradayRows = null,
    brokers = ['ibkr'],
    priceHistoryByTicker = {},
    tickerProfiles = {},
    moneyMarketTickers = [],
    knownTickerCompanyNames = {},
    cashEquivalentTickers = [],
    realtimeQuotes = [],
    marketSession = {},
    fxRateHistoryByCurrency = {},
    manualInternalTransferBindings = {},
    manualInternalTransferIgnoredSourceKeys = [],
    manualSecurityTransferAttributions = {},
    summary = {},
    brokerSummaries = {},
    positionSnapshot = null,
} = {}) => {
    const readTransactions = () => (
        typeof transactions === 'function' ? transactions() : transactions
    );
    const readRealtimeQuotes = () => (
        typeof realtimeQuotes === 'function' ? realtimeQuotes() : realtimeQuotes
    );
    const readMarketSession = (url) => (
        typeof marketSession === 'function' ? marketSession(url) : marketSession
    );
    await page.route('**/api/investment/transactions*', async (route) => {
        if (route.request().method() !== 'GET') {
            await route.abort();
            return;
        }
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({
                success: true,
                transactions: readTransactions(),
                starting_cash: startingCash,
                base_currency: 'USD',
                brokers,
                ticker_profiles: tickerProfiles,
                price_history_by_ticker: priceHistoryByTicker,
                price_history_failures: [],
                money_market_tickers: moneyMarketTickers,
                cash_equivalent_tickers: cashEquivalentTickers,
                ticker_lineage: {},
                known_ticker_company_names: knownTickerCompanyNames,
                fx_rate_history_by_currency: fxRateHistoryByCurrency,
                manual_internal_transfer_bindings: manualInternalTransferBindings,
                manual_internal_transfer_ignored_source_keys: manualInternalTransferIgnoredSourceKeys,
                manual_security_transfer_attributions: manualSecurityTransferAttributions,
                summary,
                broker_summaries: brokerSummaries,
                position_snapshot: positionSnapshot,
                realtime_quotes: readRealtimeQuotes(),
                section_freshness: {},
            }),
        });
    });
    await page.route('**/api/investment/realtime-quotes?*', async (route) => {
        await route.fulfill({contentType: 'application/json', body: JSON.stringify({success: true, quotes: readRealtimeQuotes()})});
    });
    await page.route('**/api/market-session/us-equity?*', async (route) => {
        const url = new URL(route.request().url());
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({
                success: true,
                market: 'us_equity',
                session: 'off',
                is_trading_day: false,
                is_realtime_allowed: false,
                session_date: '',
                trading_days: tradingDays,
                ...readMarketSession(url),
            }),
        });
    });
    if (typeof intradayRows === 'function') {
        await page.route('**/api/investment/intraday?*', async (route) => {
            await route.fulfill({
                contentType: 'application/json',
                body: JSON.stringify({success: true, rows: intradayRows(new URL(route.request().url()))}),
            });
        });
    }
};

export const assertCompleteStandardInvestmentExportPayload = (payload, expectedBrokerCodes) => {
    expect(payload).toEqual(expect.objectContaining({transactions: expect.any(Array)}));
    expect(payload.transactions.length).toBeGreaterThan(0);
    const expectedBrokers = new Set(expectedBrokerCodes);
    const securityTypes = new Set([
        'buy',
        'sell',
        'dividend_reinvestment',
        'foreign_tax_withholding',
        'grant',
        'payment_in_lieu',
        'transfer_in',
        'transfer_out',
    ]);
    const quantityTypes = new Set([
        'buy',
        'sell',
        'dividend_reinvestment',
        'grant',
        'transfer_in',
        'transfer_out',
    ]);
    const priceTypes = new Set(['buy', 'sell', 'dividend_reinvestment']);

    for (const transaction of payload.transactions) {
        expect(transaction.broker).toEqual(expect.any(String));
        expect(transaction.type).toEqual(expect.any(String));
        expect(transaction.currency).toEqual(expect.any(String));
        expect(Boolean(transaction.datetime || transaction.date)).toBe(true);
        const hasLedgerIdentity = transaction.ledger_no !== null
            && transaction.ledger_no !== undefined
            && String(transaction.ledger_no).trim() !== '';
        const hasSourceIdentity = Boolean(String(
            transaction.source?.reference_id || transaction.source?.execution_key || '',
        ).trim());
        const hasStableFingerprint = Boolean(
            (transaction.datetime || transaction.date)
            && transaction.type
            && transaction.currency
            && (
                transaction.ticker
                || transaction.amount !== undefined
                || transaction.net_amount_raw !== undefined
            )
        );
        expect(hasLedgerIdentity || hasSourceIdentity || hasStableFingerprint).toBe(true);

        if (securityTypes.has(transaction.type)) {
            expect(String(transaction.ticker || '').trim()).not.toBe('');
        }
        if (quantityTypes.has(transaction.type)) {
            const quantity = transaction.quantity_raw
                ?? transaction.quantity_abs
                ?? transaction.quantity
                ?? transaction.normalized?.position_quantity;
            expect(quantity).not.toBeNull();
            expect(quantity).not.toBeUndefined();
        }
        if (priceTypes.has(transaction.type)) {
            const price = transaction.price_raw
                ?? transaction.price
                ?? transaction.normalized?.unit_price;
            expect(price).not.toBeNull();
            expect(price).not.toBeUndefined();
        }
    }

    expect(new Set(payload.transactions.map((transaction) => transaction.broker)))
        .toEqual(expectedBrokers);
};
