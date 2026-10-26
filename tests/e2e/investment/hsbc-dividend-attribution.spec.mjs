/* HSBC dividend attribution through the transaction Description dropdown.
 * Code version: v1.0.0
 */

import {expect, test} from '@playwright/test';
import {mockInvestmentReadApis} from '../critical_flows/support.mjs';

const RECORD_KEY = 'hsbc-dividend:browser-fixture';
const ROW_NUMBER = 82_001;
const SELECTOR = '.investment-dividend-attribution-select';

function fixture(ticker = '') {
    return [{
        ledger_no: ROW_NUMBER,
        broker: 'hsbc',
        account: 'HSBC-TEST-DIVIDEND',
        date: '2026-06-22',
        type: 'dividend',
        currency: 'USD',
        amount: 12.34,
        net_amount_raw: '12.34',
        ticker,
        description: 'CORP EVT PAYMENT SEC',
        dividend_attribution_key: RECORD_KEY,
        dividend_attribution_candidates: ['EUV', 'QQQI'],
        source: {
            broker: 'hsbc',
            dividend_attribution_status: ticker ? 'user_confirmed' : 'unavailable_from_hsbc_cash_text',
            dividend_attribution_method: ticker ? 'user_selection' : '',
        },
    }];
}

async function openDividendHistory(page, {width = 1280, ticker = '', rejectSave = false, deferSave = false} = {}) {
    let selectedTicker = ticker;
    const writes = [];
    let releaseSave = () => {};
    const saveGate = deferSave ? new Promise((resolve) => { releaseSave = resolve; }) : null;
    await page.setViewportSize({width, height: 900});
    await mockInvestmentReadApis(page, {
        transactions: () => fixture(selectedTicker),
        brokers: ['hsbc'],
        intradayRows: () => [],
    });
    await page.route('**/api/investment/session-token', (route) => route.fulfill({
        json: {success: true, investment_csrf_token: 'dividend-browser-session'},
    }));
    // This write always terminates at the route interceptor and never reaches a store.
    await page.route('**/api/investment/dividend-attribution', async (route) => {
        const request = route.request();
        expect(request.method()).toBe('POST');
        const body = request.postDataJSON();
        writes.push({body, csrf: request.headers()['x-csrf-token']});
        if (saveGate) await saveGate;
        if (rejectSave) {
            await route.fulfill({status: 409, json: {success: false, error: 'The dividend record changed. Reload before matching.'}});
            return;
        }
        expect(body.record_key).toBe(RECORD_KEY);
        expect(['', 'EUV', 'QQQI']).toContain(body.ticker);
        selectedTicker = body.ticker;
        await route.fulfill({json: {success: true, record_key: RECORD_KEY, ticker: selectedTicker}});
    });
    await page.goto('/trade/investment?range=max');
    const row = page.locator('#investment_history tr[data-investment-history-row]');
    await expect(row).toBeVisible();
    const select = row.locator(SELECTOR);
    await expect(select).toHaveCount(1);
    return {row, select, writes, releaseSave};
}

for (const width of [1280, 390]) {
    test(`matches an unresolved dividend from Description and reads back the saved ticker at width ${width}`, async ({page}) => {
        const {row, select, writes} = await openDividendHistory(page, {width});
        await expect(select).toHaveValue('');
        await expect(select).toHaveAttribute('aria-label', 'Match this HSBC dividend to a ticker');
        await expect(row.locator('td').nth(4)).toContainText('CORP EVT PAYMENT SEC');
        expect(writes).toHaveLength(0);

        const trigger = row.locator('[data-shared-select-trigger]');
        await expect(trigger).toHaveCount(1);
        await trigger.press('ArrowDown');
        const menu = page.locator(`#${await trigger.getAttribute('aria-controls')}`);
        await expect(menu).toBeVisible();
        await expect(menu.locator('[aria-selected="true"]')).toBeFocused();
        const menuBounds = await menu.boundingBox();
        expect(menuBounds.x).toBeGreaterThanOrEqual(0);
        expect(menuBounds.x + menuBounds.width).toBeLessThanOrEqual(width);
        await page.keyboard.press('Escape');
        await expect(menu).toBeHidden();
        await expect(trigger).toBeFocused();
        expect(writes).toHaveLength(0);

        await trigger.press('ArrowDown');
        await page.keyboard.press('End');
        await expect(menu.locator('[role="option"]').last()).toBeFocused();
        await page.keyboard.press('Enter');
        await expect.poll(() => writes.length).toBe(1);
        expect(writes[0]).toEqual({
            body: {record_key: RECORD_KEY, ticker: 'QQQI'},
            csrf: 'dividend-browser-session',
        });
        await expect(row).toHaveAttribute('data-investment-history-ticker', 'QQQI');
        await expect(row.locator('td').nth(4)).toContainText('QQQI · CORP EVT PAYMENT SEC');
        await expect(select).toHaveValue('QQQI');
        await expect(row.locator('[data-shared-select-trigger]')).toBeFocused();
        await expect(row.locator('td').nth(6)).toHaveText('12.34');
        expect(await page.evaluate(() => window.WORTHWARD_INVESTMENT_DATA.transactions[0].description))
            .toBe('CORP EVT PAYMENT SEC');
    });
}

test('a confirmed dividend can be corrected and returned to unresolved', async ({page}) => {
    const {row, select, writes} = await openDividendHistory(page, {ticker: 'QQQI'});
    await expect(select).toHaveValue('QQQI');

    await select.selectOption('EUV', {force: true});
    await expect(row).toHaveAttribute('data-investment-history-ticker', 'EUV');
    await expect(select).toHaveValue('EUV');

    await select.selectOption('', {force: true});
    await expect(row).toHaveAttribute('data-investment-history-ticker', '');
    await expect(select).toHaveValue('');
    await expect(row.locator('td').nth(4)).toContainText('CORP EVT PAYMENT SEC');
    expect(writes.map(({body}) => body)).toEqual([
        {record_key: RECORD_KEY, ticker: 'EUV'},
        {record_key: RECORD_KEY, ticker: ''},
    ]);
});

test('a rejected selection restores the saved value and leaves source transactions untouched', async ({page}) => {
    const {row, select, writes} = await openDividendHistory(page, {rejectSave: true});
    await select.selectOption('QQQI', {force: true});

    await expect.poll(() => writes.length).toBe(1);
    await expect(select).toHaveValue('');
    await expect(select).toBeEnabled();
    await expect(row).toHaveAttribute('data-investment-history-ticker', '');
    await expect(page.locator('#investment_import_feedback')).toContainText('The dividend record changed');
    const transaction = await page.evaluate(() => window.WORTHWARD_INVESTMENT_DATA.transactions[0]);
    expect(transaction.ticker).toBe('');
    expect(transaction.description).toBe('CORP EVT PAYMENT SEC');
    expect(transaction.net_amount_raw).toBe('12.34');
});

test('a pending save disables both dropdown surfaces until persisted readback', async ({page}) => {
    const {row, select, writes, releaseSave} = await openDividendHistory(page, {deferSave: true});
    const trigger = row.locator('[data-shared-select-trigger]');
    await expect(trigger).toBeVisible();
    try {
        await select.selectOption('QQQI', {force: true});
        await expect.poll(() => writes.length).toBe(1);
        await expect(select).toBeDisabled();
        await expect(trigger).toBeDisabled();
        await expect(row).toHaveAttribute('data-investment-history-ticker', '');
    } finally {
        releaseSave();
    }
    await expect(row).toHaveAttribute('data-investment-history-ticker', 'QQQI');
    await expect(select).toBeEnabled();
    await expect(row.locator('[data-shared-select-trigger]')).toBeEnabled();
    await expect(row.locator('[data-shared-select-trigger]')).toBeFocused();
});
