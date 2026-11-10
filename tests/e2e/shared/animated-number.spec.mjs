/* Code version: v1.0.0
 * Real shared assets animate numbers without duplicate loops or stale rest geometry.
 */
import fs from 'node:fs/promises';
import {expect, test} from '@playwright/test';
import {mockInvestmentReadApis} from '../critical_flows/support.mjs';

const fixtureUrl = '/__test__/animated-number-demo?manual=1';
const demoHtml = new URL('../fixtures/animated-number-demo.html', import.meta.url);
const valueNode = (page, index = 0) => page.locator(`#value-${index}`);
const display = (page, index = 0) => valueNode(page, index).locator('[data-animated-number-sr]');

async function openDemo(page, {manual = true} = {}) {
    const themePage = await page.request.get('/settings/about');
    const themeHtml = await themePage.text();
    const theme = themeHtml.match(/<style>[\s\S]*?<\/style>/)?.[0];
    if (!theme) throw new Error('The isolated application did not render its theme variables.');
    await page.route('**/__test__/animated-number-demo*', async (route) => {
        const body = (await fs.readFile(demoHtml, 'utf8')).replace('<!-- RENDERED_THEME -->', theme);
        await route.fulfill({contentType: 'text/html', body});
    });
    await page.goto(manual ? fixtureUrl : '/__test__/animated-number-demo');
    await expect(page.locator('#demo')).toHaveAttribute('data-ready', 'true');
}

async function pauseClock(page) {
    const time = new Date('2026-07-07T12:00:00Z');
    await page.clock.install({time});
    await page.clock.pauseAt(time);
}

async function restGeometry(page, index = 0) {
    return valueNode(page, index).evaluate((node, rowIndex) => ({
        width: node.getBoundingClientRect().width,
        height: node.getBoundingClientRect().height,
        referenceWidth: document.querySelector(`#reference-${rowIndex}`).getBoundingClientRect().width,
        referenceHeight: document.querySelector(`#reference-${rowIndex}`).getBoundingClientRect().height,
        baselineOffset: node.getBoundingClientRect().bottom - document.querySelector(`#baseline-${rowIndex}`).getBoundingClientRect().top,
        referenceBaselineOffset: document.querySelector(`#reference-${rowIndex}`).getBoundingClientRect().bottom - document.querySelector(`#reference-baseline-${rowIndex}`).getBoundingClientRect().top,
        overflow: node.scrollWidth - node.clientWidth,
        font: getComputedStyle(node).fontFamily,
    }), index);
}

async function assertRestingInkMatchesReference(page, testInfo, index = 0) {
    const node = valueNode(page, index);
    const reference = page.locator(`#reference-${index}`);
    const clip = await node.boundingBox();
    const actual = await page.screenshot({clip});
    const originalStyles = {
        node: await node.getAttribute('style'),
        reference: await reference.getAttribute('style'),
    };
    await node.evaluate((element) => { element.style.visibility = 'hidden'; });
    await reference.evaluate((element, bounds) => {
        Object.assign(element.style, {
            position: 'fixed', left: `${bounds.x}px`, top: `${bounds.y}px`,
            visibility: 'visible', zIndex: '100000',
        });
    }, clip);
    const expected = await page.screenshot({clip});
    if (!actual.equals(expected)) {
        await fs.writeFile(testInfo.outputPath('animated-number-resting-actual.png'), actual);
        await fs.writeFile(testInfo.outputPath('animated-number-resting-reference.png'), expected);
        await fs.writeFile(testInfo.outputPath('animated-number-resting-geometry.json'), `${JSON.stringify({clip, geometry: await restGeometry(page, index)}, null, 2)}\n`);
    }
    await node.evaluate((element, style) => {
        if (style === null) element.removeAttribute('style');
        else element.setAttribute('style', style);
    }, originalStyles.node);
    await reference.evaluate((element, style) => {
        if (style === null) element.removeAttribute('style');
        else element.setAttribute('style', style);
    }, originalStyles.reference);
    expect(actual.equals(expected), 'Resting text pixels must match the plain formatter at the same screen position.').toBe(true);
}

test('manual preview of the animated number development specimen', async ({page}) => {
    test.skip(process.env.WORTHWARD_ANIMATED_NUMBER_DEMO !== '1', 'Opt in to the isolated headed development preview.');
    await openDemo(page, {manual: false});
    await page.pause();
});

test('digit carries and zero crossings settle to accessible values and natural widths', async ({page, context}, testInfo) => {
    await pauseClock(page);
    await openDemo(page);
    await expect(display(page)).toHaveText('9.98');
    const initial = await restGeometry(page);
    expect(initial.font).toContain('Univers Next for HSBC');
    await page.evaluate(() => window.animatedNumberDemo.set(0, 10.03));
    await expect(display(page)).toHaveText('10.03');
    await page.clock.runFor(80);
    await expect(valueNode(page)).toHaveAttribute('data-number-state', 'running');
    await page.clock.runFor(320);
    const settledFraction = Number(await valueNode(page).locator('[data-key="d:1:0"]').getAttribute('data-number-position'));
    const fractionPhase = ((settledFraction % 10) + 10) % 10;
    const fractionDistance = Math.min(Math.abs(fractionPhase - 3), 10 - Math.abs(fractionPhase - 3));
    // The five-step 8-to-3 carry is within 1% of its travel after 400 ms.
    expect(fractionDistance).toBeLessThan(0.05);
    await page.clock.runFor(1880);
    await expect(valueNode(page)).toHaveAttribute('data-number-state', 'idle');
    const carried = await restGeometry(page);
    expect(carried.width).toBeGreaterThan(initial.width);
    expect(Math.abs(carried.width - carried.referenceWidth)).toBeLessThanOrEqual(1);
    expect(Math.abs(carried.height - carried.referenceHeight)).toBeLessThanOrEqual(0.1);
    expect(Math.abs(carried.baselineOffset - carried.referenceBaselineOffset)).toBeLessThanOrEqual(0.1);

    await page.evaluate(() => window.animatedNumberDemo.set(0, -0.04));
    await expect(display(page)).toHaveText('-0.04');
    await page.clock.runFor(2200);
    await expect(valueNode(page)).toHaveAttribute('data-number-state', 'idle');
    const negative = await restGeometry(page);
    expect(Math.abs(negative.width - negative.referenceWidth)).toBeLessThanOrEqual(1);
    expect(Math.abs(negative.height - negative.referenceHeight)).toBeLessThanOrEqual(0.1);
    expect(Math.abs(negative.baselineOffset - negative.referenceBaselineOffset)).toBeLessThanOrEqual(0.1);
    expect(negative.overflow).toBeLessThanOrEqual(1);
    await expect(valueNode(page).locator(':scope > [aria-hidden="true"]')).not.toHaveCount(0);
    await expect(display(page)).toHaveCount(1);
    const cdp = await context.newCDPSession(page);
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    const documentNode = await cdp.send('DOM.getDocument');
    const digit = await cdp.send('DOM.querySelector', {
        nodeId: documentNode.root.nodeId,
        selector: '#value-0 > .workspace-metric-value-major',
    });
    const {fonts} = await cdp.send('CSS.getPlatformFontsForNode', {nodeId: digit.nodeId});
    expect(fonts.length).toBeGreaterThan(0);
    expect(fonts.every((font) => font.isCustomFont && font.familyName === 'Univers Next for HSBC')).toBe(true);
    await cdp.detach();
    await assertRestingInkMatchesReference(page, testInfo);
    await page.screenshot({path: testInfo.outputPath('animated-number-zero-crossing-idle.png')});
});

test('a retargeted digit keeps its current position and motion instead of restarting', async ({page}) => {
    await pauseClock(page);
    await openDemo(page);
    await page.evaluate(() => window.animatedNumberDemo.set(0, 12, {animate: false}));
    await page.evaluate(() => window.animatedNumberDemo.set(0, 18));
    const strip = valueNode(page).locator('[data-number-kind="digit"] .animated-number-strip').nth(1);
    const unchanged = valueNode(page).locator('[data-key="d:0:1"] .animated-number-strip');
    const unchangedOffset = await unchanged.evaluate((node) => getComputedStyle(node).transform);
    const offset = () => strip.evaluate((node) => new DOMMatrixReadOnly(getComputedStyle(node).transform).m42);
    await page.clock.runFor(48);
    const first = await offset();
    await page.clock.runFor(16);
    const before = await offset();
    expect(Math.abs(before - first)).toBeGreaterThan(0.01);
    expect(await unchanged.evaluate((node) => getComputedStyle(node).transform)).toBe(unchangedOffset);
    await page.evaluate(() => window.animatedNumberDemo.set(0, 14));
    const after = await offset();
    expect(Math.abs(after - before)).toBeLessThan(0.01);
    await page.clock.runFor(16);
    const continued = await offset();
    expect((continued - after) * (before - first)).toBeGreaterThan(0);
    await page.clock.runFor(2200);
    await expect(display(page)).toHaveText('14.00');
    await expect(valueNode(page)).toHaveAttribute('data-number-state', 'idle');
});

test('50 interrupted values share a frame loop that stops completely at rest', async ({page}) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    await pauseClock(page);
    await openDemo(page);
    await expect(page.locator('[data-animated-number]')).toHaveCount(50);
    for (const value of [120, 80, -2, 1]) {
        await page.evaluate((next) => window.animatedNumberDemo.setAll(next), value);
        await page.clock.runFor(80);
    }
    await page.clock.runFor(3000);
    const resting = await page.evaluate(() => window.animatedNumberDemo.audit());
    expect(resting.maxPending).toBe(1);
    expect(resting.pending).toBe(0);
    await expect(page.locator('[data-number-state="running"]')).toHaveCount(0);
    await page.clock.runFor(1000);
    expect(await page.evaluate(() => window.animatedNumberDemo.audit())).toEqual(resting);
    await page.evaluate(() => window.animatedNumberDemo.destroy());
    await page.clock.runFor(1000);
    expect((await page.evaluate(() => window.animatedNumberDemo.audit())).pending).toBe(0);
    expect(errors).toEqual([]);
});

test('reduced motion and hidden documents settle updates without rolling in the background', async ({page}) => {
    await page.emulateMedia({reducedMotion: 'reduce'});
    await pauseClock(page);
    await openDemo(page);
    await page.evaluate(() => window.animatedNumberDemo.set(0, -0.04));
    await expect(display(page)).toHaveText('-0.04');
    await page.clock.runFor(200);
    await expect(valueNode(page)).toHaveAttribute('data-number-state', 'idle');
    expect((await page.evaluate(() => window.animatedNumberDemo.audit())).pending).toBe(0);

    await page.emulateMedia({reducedMotion: 'no-preference'});
    await page.evaluate(() => {
        window.animatedNumberDemo.set(0, 100);
        window.animatedNumberDemo.setHidden(true);
        window.animatedNumberDemo.set(0, -100);
    });
    await expect(display(page)).toHaveText('-100.00');
    await expect(valueNode(page)).toHaveAttribute('data-number-state', 'idle');
    const hidden = await page.evaluate(() => window.animatedNumberDemo.audit());
    expect(hidden.pending).toBe(0);
    await page.clock.runFor(1000);
    expect(await page.evaluate(() => window.animatedNumberDemo.audit())).toEqual(hidden);
    await page.evaluate(() => window.animatedNumberDemo.setHidden(false));
    await expect(display(page)).toHaveText('-100.00');
    await expect(valueNode(page)).toHaveAttribute('data-number-state', 'idle');
});

test('a value mounted inside a hidden ancestor gains correct digit metrics when revealed unchanged', async ({page}) => {
    await pauseClock(page);
    await openDemo(page);
    await page.evaluate(() => {
        window.animatedNumberDemo.mountHidden(0, 10.03);
        window.animatedNumberDemo.set(0, -0.04, {animate: false});
    });
    await expect(valueNode(page)).toBeHidden();
    await page.evaluate(() => window.animatedNumberDemo.reveal(0));
    await expect(valueNode(page)).toBeVisible();
    await page.evaluate(() => window.animatedNumberDemo.set(0, -0.04));
    await page.clock.runFor(2000);
    await expect(display(page)).toHaveText('-0.04');
    const geometry = await restGeometry(page);
    expect(Math.abs(geometry.width - geometry.referenceWidth)).toBeLessThanOrEqual(0.1);
    expect(Math.abs(geometry.height - geometry.referenceHeight)).toBeLessThanOrEqual(0.1);
    await page.evaluate(() => window.animatedNumberDemo.set(0, 0.04));
    await page.clock.runFor(80);
    await expect(valueNode(page)).toHaveAttribute('data-number-state', 'running');
    const heights = await valueNode(page).locator('[data-number-kind="digit"] .animated-number-glyph').evaluateAll((glyphs) => glyphs.map((glyph) => glyph.getBoundingClientRect().height));
    expect(heights.length).toBeGreaterThan(0);
    expect(heights.every((height) => height > 0)).toBe(true);
    await page.clock.runFor(2200);
    await expect(display(page)).toHaveText('0.04');
    await expect(valueNode(page)).toHaveAttribute('data-number-state', 'idle');
    const idle = await page.evaluate(() => window.animatedNumberDemo.audit());
    expect(idle.pending).toBe(0);
    await page.clock.runFor(1000);
    expect(await page.evaluate(() => window.animatedNumberDemo.audit())).toEqual(idle);
});

test('direction flashes use shared color tokens while target signs retain their own color', async ({page}) => {
    await pauseClock(page);
    await openDemo(page);
    await page.evaluate(() => window.animatedNumberDemo.set(0, -0.04));
    await expect(valueNode(page)).toHaveAttribute('data-number-direction', 'down');
    const down = await valueNode(page).evaluate((node) => ({
        flash: getComputedStyle(node).getPropertyValue('--animated-number-flash-color').trim(),
        token: getComputedStyle(node).getPropertyValue('--theme-accent-secondary').trim(),
    }));
    expect(down.flash).toBe(down.token);
    await page.clock.runFor(2200);
    await expect(valueNode(page)).toHaveClass(/investment-holdings-value-negative/);
    await expect.poll(() => valueNode(page).evaluate((node) => getComputedStyle(node).color))
        .toBe(await page.locator('#reference-0').evaluate((node) => getComputedStyle(node).color));
    await page.evaluate(() => window.animatedNumberDemo.set(0, 0.04));
    await expect(valueNode(page)).toHaveAttribute('data-number-direction', 'up');
    const up = await valueNode(page).evaluate((node) => ({
        flash: getComputedStyle(node).getPropertyValue('--animated-number-flash-color').trim(),
        token: getComputedStyle(node).getPropertyValue('--theme-accent-positive').trim(),
    }));
    expect(up.flash).toBe(up.token);
    await page.clock.runFor(100);
    const exitingSign = valueNode(page).locator('[data-number-kind="sign"] .animated-number-window');
    await expect(exitingSign.locator('.animated-number-strip')).toHaveCount(0);
    const signOpacity = await exitingSign.evaluate((node) => Number(getComputedStyle(node).opacity));
    expect(signOpacity).toBeGreaterThan(0);
    expect(signOpacity).toBeLessThan(1);
    await page.clock.runFor(120);
    expect(await exitingSign.evaluate((node) => Number(getComputedStyle(node).opacity))).toBeLessThanOrEqual(0.01);
    await page.clock.runFor(1980);
    await expect(valueNode(page)).toHaveClass(/investment-holdings-value-positive/);
    await expect.poll(() => valueNode(page).evaluate((node) => getComputedStyle(node).color))
        .toBe(await page.locator('#reference-0').evaluate((node) => getComputedStyle(node).color));
});

test('the development specimen runs and stops its seeded random walk through visible controls', async ({page}) => {
    await pauseClock(page);
    await openDemo(page, {manual: false});
    await expect(page.locator('#demo-status')).toHaveText('Random walk running');
    await page.clock.runFor(550);
    await expect(display(page)).toHaveText('10.03');
    await page.clock.runFor(250);
    await expect(display(page)).toHaveText('-0.04');
    await page.locator('#stop').click();
    await expect(page.locator('#demo-status')).toHaveText('Updates stopped');
    await page.clock.runFor(3000);
    const stopped = await display(page).textContent();
    await page.clock.runFor(1000);
    await expect(display(page)).toHaveText(stopped);
    await page.locator('#cross-zero').click();
    await page.clock.runFor(350);
    await expect(display(page)).toHaveText('10.03');
    await page.clock.runFor(2500);
    await expect(display(page)).toHaveText('-0.04');
});

test('50 live random walks keep frame cadence responsive under native browser time', async ({page}, testInfo) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await openDemo(page, {manual: false});
    const startedAt = await page.evaluate(() => performance.now());
    // This bounded observation intentionally uses native wall time to measure rendering work.
    await page.waitForTimeout(2400);
    const metrics = await page.evaluate((started) => {
        const audit = window.animatedNumberDemo.audit();
        const timestamps = audit.timestamps.filter((timestamp) => timestamp >= started);
        const gaps = timestamps.slice(1).map((timestamp, index) => timestamp - timestamps[index]);
        const sortedGaps = [...gaps].sort((left, right) => left - right);
        const elapsedMs = performance.now() - started;
        return {
            instances: document.querySelectorAll('[data-animated-number]').length,
            elapsedMs, frames: timestamps.length, framesPerSecond: timestamps.length * 1000 / elapsedMs,
            maxFrameGapMs: gaps.length ? Math.max(...gaps) : 0,
            p95FrameGapMs: sortedGaps[Math.floor(sortedGaps.length * 0.95)] || 0,
            maxCallbackMs: Math.max(0, ...audit.callbackDurations),
            meanCallbackMs: audit.callbackDurations.reduce((total, duration) => total + duration, 0) / Math.max(1, audit.callbackDurations.length),
            maxPendingFrames: audit.maxPending,
        };
    }, startedAt);
    expect(metrics.instances).toBe(50);
    expect(metrics.frames).toBeGreaterThan(20);
    expect(metrics.maxFrameGapMs).toBeLessThan(500);
    expect(metrics.maxPendingFrames).toBe(1);
    await fs.writeFile(testInfo.outputPath('animated-number-stress.json'), `${JSON.stringify(metrics, null, 2)}\n`);
    testInfo.annotations.push({type: 'native-frame-audit', description: JSON.stringify(metrics)});
    await page.locator('#stop').click();
    await expect(page.locator('[data-number-state="running"]')).toHaveCount(0);
    await page.screenshot({path: testInfo.outputPath('animated-number-demo-50-idle.png'), fullPage: true});
    expect(errors).toEqual([]);
});

test('Holdings animates unrealized and daily P&L while preserving negative tones and resting typography', async ({page}, testInfo) => {
    await page.setViewportSize({width: 1280, height: 900});
    await page.clock.setFixedTime(new Date('2026-07-22T14:00:00Z'));
    await page.addInitScript(() => {
        const nativeTimeout = window.setTimeout.bind(window);
        window.setTimeout = (callback, delay, ...args) => {
            if (delay === 60_000 && typeof callback === 'function') {
                window.__animatedNumberQuotePoll = () => callback(...args);
                return 0;
            }
            return nativeTimeout(callback, delay, ...args);
        };
    });
    let price = 18;
    await mockInvestmentReadApis(page, {
        transactions: [{
            ledger_no: 1, broker: 'ibkr', account: 'SYNTHETIC', ticker: 'TEST',
            currency: 'USD', type: 'buy', date: '2026-07-21', quantity: 10,
            price: 20, amount: -200,
        }],
        priceHistoryByTicker: {TEST: [{date: '2026-07-21', close: 19}]},
        realtimeQuotes: () => [{
            ticker: 'TEST', price, timestamp: '2026-07-22 10:00',
            session: 'intraday', session_date: '2026-07-22', market: 'US', source: 'yfinance',
        }],
        marketSession: {
            session: 'intraday', is_trading_day: true, is_realtime_allowed: true,
            session_date: '2026-07-22',
        },
        intradayRows: () => [],
    });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/trade/investment?view=holdings');
    const row = page.locator('#investment_holdings_panel .investment-holdings-table-scroll tr[data-investment-holdings-ticker="TEST"]');
    const main = row.locator('[data-investment-live-field="unrealized_pnl"]');
    const daily = row.locator('[data-investment-live-field="daily_unrealized_pnl"]');
    const last = row.locator('[data-investment-live-field="last"]');
    await expect(main).toHaveAttribute('data-investment-live-display', '-20.00');
    await expect(daily).toHaveAttribute('data-investment-live-display', '-10.00');
    await expect(main.locator('[data-animated-number-sr]')).toHaveCount(1);
    await expect(main.locator('[data-animated-number-sr]')).toHaveText('-20.00');
    await expect(daily.locator('[data-animated-number-sr]')).toHaveCount(1);
    await expect(daily.locator('[data-animated-number-sr]')).toHaveText('-10.00');
    await expect(main.locator('.animated-number-column')).toHaveCount(0);
    await page.evaluate(() => document.fonts.ready);
    const geometry = (node) => node.evaluate((element) => {
        const marker = document.createElement('span');
        Object.assign(marker.style, {display: 'inline-block', width: '0', height: '0', verticalAlign: 'baseline'});
        element.after(marker);
        const baseline = marker.getBoundingClientRect().top;
        const rect = element.getBoundingClientRect();
        const parts = ['major', 'minor'].map((part) => {
            const fragment = element.querySelector(`:scope > .workspace-metric-value-${part}`);
            const bounds = fragment.getBoundingClientRect();
            return {top: bounds.top - baseline, bottom: bounds.bottom - baseline, height: bounds.height};
        });
        marker.remove();
        return {width: rect.width, height: rect.height, baseline: rect.bottom - baseline, parts};
    });
    const before = {main: await geometry(main), daily: await geometry(daily)};
    const negativeColor = await main.evaluate((element) => getComputedStyle(element).color);
    const negativeBadge = await daily.evaluate((element) => getComputedStyle(element.closest('.investment-holdings-daily-pnl-badge')).backgroundColor);
    price = 18.5;
    await expect.poll(() => page.evaluate(() => typeof window.__animatedNumberQuotePoll)).toBe('function');
    await page.evaluate(() => window.__animatedNumberQuotePoll());
    await expect(main).toHaveAttribute('data-investment-live-display', '-15.00');
    await expect(daily).toHaveAttribute('data-investment-live-display', '-5.00');
    await expect(main.locator('[data-animated-number-sr]')).toHaveCount(1);
    await expect(main.locator('[data-animated-number-sr]')).toHaveText('-15.00');
    await expect(daily.locator('[data-animated-number-sr]')).toHaveCount(1);
    await expect(daily.locator('[data-animated-number-sr]')).toHaveText('-5.00');
    await expect(main).toHaveAttribute('data-number-direction', 'up');
    await expect(daily).toHaveAttribute('data-number-direction', 'up');
    await expect(main).toHaveClass(/investment-holdings-value-negative/);
    await expect.poll(() => main.evaluate((element) => getComputedStyle(element).color)).toBe(negativeColor);
    await expect.poll(() => daily.evaluate((element) => getComputedStyle(element.closest('.investment-holdings-daily-pnl-badge')).backgroundColor)).toBe(negativeBadge);
    await expect(last).not.toHaveAttribute('data-animated-number');
    await expect(last.locator('.animated-number-column')).toHaveCount(0);
    await expect(last).toHaveAttribute('data-investment-live-display', '18.50');

    // Return to the same source value to compare pre-attachment and resting ink geometry.
    price = 18;
    await page.evaluate(() => window.__animatedNumberQuotePoll());
    await expect(main).toHaveAttribute('data-investment-live-display', '-20.00');
    await expect(daily).toHaveAttribute('data-investment-live-display', '-10.00');
    await expect(main).toHaveAttribute('data-number-state', 'idle');
    await expect(daily).toHaveAttribute('data-number-state', 'idle');
    const after = {main: await geometry(main), daily: await geometry(daily)};
    for (const kind of ['main', 'daily']) {
        for (const property of ['width', 'height', 'baseline']) {
            expect(Math.abs(after[kind][property] - before[kind][property])).toBeLessThanOrEqual(0.1);
        }
        for (const [index, part] of before[kind].parts.entries()) {
            for (const property of ['top', 'bottom', 'height']) {
                expect(Math.abs(after[kind].parts[index][property] - part[property])).toBeLessThanOrEqual(0.1);
            }
        }
    }
    await page.screenshot({path: testInfo.outputPath('holdings-animated-number-idle.png')});
    expect(errors).toEqual([]);
});
