/* Code version: v1.2.0 */
import {expect, test} from '@playwright/test';
import {mockInvestmentReadApis} from '../critical_flows/support.mjs';

const STOCK_DETAILS_URL = '/trade/investment?view=stock-details&ticker=EUV&range=ytd';
const CHUNK_MARKER = '===== HSBC PASTE CHUNK =====';
const joinChunks = (...chunks) => chunks.join(`\n\n${CHUNK_MARKER}\n\n`);
const completeCardPage = `Banking Card, loan & mortgage
Selected account's details
HSBC Red Credit Card
Account number:
4321-0000-0000-6789
RewardCash balance:
0
Account balance:
4,850.50
HKD
Current amount due:
0.00 HKD
Total minimum payment amount:
0.00 HKD
Payment due date:
06 May 2026
Transactions
10 Apr 2026
TEST CARD HOLDER
Card ending in 6789
APPLEPAY SAMPLE ELECTRONICS
2,450.00 HKD
Pending`;
const completeCashPage = `Card, loan & mortgage
Selected account's details
HSBC HKD Savings
Account number:
000-123456-789
Available balance:
1,250.00 HKD
Transactions`;

// All credit-card reads and writes are intercepted; no fixture reaches a store.
const parsedCard = () => ({
    success: true, ready: true, source_sha256: 'a'.repeat(64),
    account: {last4: '6789', name: 'HSBC Red Credit Card', currency: 'HKD'},
    snapshot: {account_balance: '4850.50', current_amount_due: '0', minimum_payment: '0', payment_due_date: '2026-11-06', rewardcash_balance: '0'},
    transactions: [
        {transaction_date: '2026-10-13', card_last4: '6789', description: 'PAYMENT - THANK YOU', kind: 'repayment', status: 'posted', currency: 'HKD', amount: '3000'},
        {transaction_date: '2026-10-12', card_last4: '6789', description: 'APPLEPAY SAMPLE ELECTRONICS HONG KONG HK', kind: 'purchase', status: 'pending', currency: 'HKD', amount: '2450'},
        {transaction_date: '2026-10-12', card_last4: '6789', description: 'PAY w/RC SAMPLE ELECTRONICS HONG KONG HK', kind: 'rewardcash', status: 'posted', currency: 'HKD', amount: '25'},
        {transaction_date: '2026-10-11', card_last4: '6789', description: '<img src=x onerror=alert(1)>', kind: 'purchase', status: 'posted', currency: 'HKD', amount: '18.50'},
    ],
    summary: {posted_purchase_count: 1, posted_purchase_total: '18.50', repayment_count: 1, repayment_total: '3000', rewardcash_count: 1, rewardcash_total: '25', pending_count: 1, pending_total: '2450', added_count: 4, promoted_count: 0, duplicate_count: 0},
    warnings: [],
});
const validCash = () => ({success: true, ready: true, mode: 'cash_only', field_status: {cash: true}, cash_currencies: ['HKD']});

async function openAccountImport(page, width = 1280, url = '/trade/investment') {
    await mockInvestmentReadApis(page, {intradayRows: () => []});
    await page.setViewportSize({width, height: 900});
    await page.route('**/api/investment/session-token', (route) => route.fulfill({json: {success: true, investment_csrf_token: 'test-card-session'}}));
    await page.goto(url);
    await page.locator('#toggle_form_button').click();
    await page.locator('#investment_import_broker').selectOption('hsbc', {force: true});
    await expect(page.locator('#hsbc_import_mode_paste')).toBeChecked();
    await expect(page.locator('#hsbc_import_mode_credit_card')).toHaveCount(0);
    await expect(page.locator('#hsbc_credit_card_text')).toHaveCount(0);
    await expect(page.locator('#hsbc_cash_account_display')).toBeVisible();
    await expect(page.locator('#hsbc_cash_account_display')).toHaveAttribute('readonly', '');
    await expect(page.locator('label[for="hsbc_cash_account_display"] .investment-import-label-text')).toHaveText('HSBC account-page text');
}

async function pasteAccountClipboard(page, text) {
    await page.evaluate((value) => {
        Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {readText: async () => value}});
    }, text);
    await page.getByRole('button', {name: 'Paste HSBC account page text from clipboard', exact: true}).click();
}

async function replaceAccountInput(page, text) {
    await page.locator('#hsbc_cash_account_text').evaluate((input, value) => {
        input.value = value;
        input.dispatchEvent(new Event('input', {bubbles: true}));
    }, text);
}

async function clearAccountInput(page) {
    await page.locator('#hsbc_cash_account_display').hover();
    await page.getByRole('button', {name: 'Clear pasted HSBC account-page text', exact: true}).click();
}

async function guardRoutingRequests(page) {
    const calls = {cash: 0, card: 0};
    await page.route('**/api/credit-cards/**', (route) => { calls.card += 1; return route.abort(); });
    await page.route('**/api/investment/imports/hsbc-paste/validate', (route) => {
        calls.cash += 1;
        return route.fulfill({json: validCash()});
    });
    return calls;
}

for (const width of [1280, 390]) {
    test(`shared account preview classifies safely from stock details at width ${width}`, async ({page}, testInfo) => {
        const calls = await guardRoutingRequests(page);
        let previews = 0;
        await page.route('**/api/credit-cards/hsbc/preview', (route) => {
            previews += 1;
            expect(route.request().postDataJSON()).toEqual({text: completeCardPage});
            return route.fulfill({json: parsedCard()});
        });
        await openAccountImport(page, width, STOCK_DETAILS_URL);
        await expect(page.locator('#hsbc_credit_card_panel')).toBeHidden();
        await pasteAccountClipboard(page, completeCardPage);
        await expect(page.locator('#hsbc_import_mode_paste')).toBeChecked();
        await expect(page.locator('#hsbc_cash_account_text')).toHaveValue(completeCardPage);
        await expect(page.locator('#hsbc_credit_card_panel')).toBeVisible();
        await expect(page.locator('#hsbc_credit_card_status')).toContainText('Select Preview');
        await expect(page.locator('#investment_import_submit_button')).toBeDisabled();
        expect(previews).toBe(0);
        expect(calls).toEqual({cash: 0, card: 0});
        await page.locator('#hsbc_credit_card_preview_button').click();
        await expect(page.locator('#hsbc_credit_card_rows tr')).toHaveCount(4);
        await expect(page.locator('#hsbc_credit_card_rows tr').nth(0)).toContainText('Repayment');
        await expect(page.locator('#hsbc_credit_card_rows tr').nth(1)).toContainText('Pending');
        await expect(page.locator('#hsbc_credit_card_rows tr').nth(2)).toContainText('RewardCash');
        await expect(page.locator('#hsbc_credit_card_rows tr').nth(3)).toContainText('Purchase');
        await expect(page.locator('#hsbc_credit_card_rows img')).toHaveCount(0);
        await expect(page.locator('#hsbc_credit_card_summary')).toContainText('HKD 4,850.50');
        await expect(page.locator('#hsbc_credit_card_summary')).toContainText('6 Nov 2026');
        await expect(page.locator('#hsbc_credit_card_status')).toContainText('Nothing has been saved');
        await expect(page.locator('#investment_import_submit_button')).toBeEnabled();
        expect(previews).toBe(1);
        const bounds = await page.locator('#hsbc_cash_account_display').boundingBox();
        expect(bounds.width).toBeGreaterThan(150);
        expect(bounds.x).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
        const help = await page.locator('#hsbc_credit_card_help').boundingBox();
        const preview = await page.locator('#hsbc_credit_card_preview_button').boundingBox();
        expect(help.y).toBeGreaterThanOrEqual(bounds.y + bounds.height);
        expect(preview.y).toBeGreaterThanOrEqual(help.y + help.height);
        await page.locator('#hsbc_cash_account_display').scrollIntoViewIfNeeded();
        await expect(page.locator('#hsbc_cash_account_display')).toHaveCSS('font-family', /Univers Next for HSBC/);
        await page.evaluate(() => document.fonts.ready);
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('DOM.enable');
        await cdp.send('CSS.enable');
        const {root} = await cdp.send('DOM.getDocument');
        const {nodeId} = await cdp.send('DOM.querySelector', {nodeId: root.nodeId, selector: 'label[for="hsbc_cash_account_display"] .investment-import-label-text'});
        const {fonts} = await cdp.send('CSS.getPlatformFontsForNode', {nodeId});
        expect(fonts.length).toBeGreaterThan(0);
        expect(fonts.every((font) => font.isCustomFont && font.familyName === 'Univers Next for HSBC')).toBe(true);
        await cdp.detach();
        await page.screenshot({path: testInfo.outputPath('credit-card-preview.png')});
        await replaceAccountInput(page, completeCardPage.replace('4,850.50', '4,000.00'));
        await expect(page.locator('#investment_import_submit_button')).toBeDisabled();
        await expect(page.locator('#hsbc_credit_card_results')).toBeHidden();
    });
}

test('card import sends only shared account text and digest without investment writes or market refresh', async ({page}) => {
    const calls = [];
    const investmentRequests = [];
    page.on('request', (request) => {
        const path = new URL(request.url()).pathname;
        if (path.startsWith('/api/investment/') && path !== '/api/investment/session-token'
            || path.startsWith('/api/market-session/')) investmentRequests.push({path, method: request.method()});
    });
    await page.route('**/api/credit-cards/hsbc/preview', (route) => route.fulfill({json: parsedCard()}));
    await page.route('**/api/credit-cards/hsbc/import', (route) => {
        calls.push({body: route.request().postDataJSON(), csrf: route.request().headers()['x-csrf-token']});
        const result = parsedCard();
        result.merged_transactions = result.transactions.map((row) => ({...row, status: 'posted'}));
        return route.fulfill({json: result});
    });
    await openAccountImport(page);
    await page.evaluate(() => {
        document.getElementById('hsbc_portfolio_text').value = 'Existing Portfolio draft';
        document.getElementById('hsbc_order_status_text').value = 'Existing Order Status draft';
    });
    await pasteAccountClipboard(page, completeCardPage);
    await expect(page.locator('#hsbc_credit_card_status')).toContainText('Portfolio and Order Status drafts are kept and are not included');
    await page.locator('#hsbc_credit_card_preview_button').click();
    await expect(page.locator('#investment_import_submit_button')).toBeEnabled();
    const requestsBeforeImport = [...investmentRequests];
    await page.locator('#investment_import_submit_button').click();
    await expect(page.locator('#hsbc_credit_card_status')).toContainText('read back');
    await expect(page.locator('#hsbc_credit_card_caption')).toHaveText('Saved transactions');
    await expect(page.locator('#hsbc_credit_card_rows tr').nth(1)).toContainText('Posted');
    await expect(page.locator('#investment_import_submit_button')).toBeDisabled();
    await expect(page.locator('#hsbc_cash_account_text')).toHaveValue(completeCardPage);
    await expect(page.locator('#hsbc_portfolio_text')).toHaveValue('Existing Portfolio draft');
    await expect(page.locator('#hsbc_order_status_text')).toHaveValue('Existing Order Status draft');
    expect(calls).toEqual([{body: {text: completeCardPage, source_sha256: 'a'.repeat(64)}, csrf: 'test-card-session'}]);
    expect(investmentRequests).toEqual(requestsBeforeImport);
    expect(investmentRequests.every(({method}) => method === 'GET')).toBe(true);
});

test('saved-card readback cannot authorize the shared current input', async ({page}) => {
    await page.route('**/api/credit-cards/hsbc/preview', (route) => route.fulfill({json: parsedCard()}));
    await page.route('**/api/credit-cards/hsbc', (route) => {
        const result = parsedCard();
        result.accounts = [{...result.account, snapshot: result.snapshot}];
        return route.fulfill({json: result});
    });
    await openAccountImport(page);
    await pasteAccountClipboard(page, completeCardPage);
    await page.locator('#hsbc_credit_card_preview_button').click();
    await expect(page.locator('#investment_import_submit_button')).toBeEnabled();
    await page.locator('#hsbc_credit_card_saved_button').click();
    await expect(page.locator('#hsbc_credit_card_rows tr')).toHaveCount(4);
    await expect(page.locator('#hsbc_credit_card_caption')).toHaveText('Saved transactions');
    await expect(page.locator('#investment_import_submit_button')).toBeDisabled();
});

for (const dimension of ['Statements', 'broker']) {
    test(`a delayed preview cannot unlock import after a ${dimension} round trip`, async ({page}) => {
        let release;
        let received;
        const requestArrived = new Promise((resolve) => { received = resolve; });
        const responseAllowed = new Promise((resolve) => { release = resolve; });
        await page.route('**/api/credit-cards/hsbc/preview', async (route) => {
            received();
            await responseAllowed;
            await route.fulfill({json: parsedCard()});
        });
        await openAccountImport(page);
        await pasteAccountClipboard(page, completeCardPage);
        await page.locator('#hsbc_credit_card_preview_button').click();
        await requestArrived;
        if (dimension === 'Statements') {
            await page.locator('label[for="hsbc_import_mode_statement_pdf"]').click();
            await page.locator('label[for="hsbc_import_mode_paste"]').click();
        } else {
            await page.locator('#investment_import_broker').selectOption('ibkr', {force: true});
            await page.locator('#investment_import_broker').selectOption('hsbc', {force: true});
        }
        release();
        await expect(page.locator('#hsbc_credit_card_preview_button')).toBeEnabled();
        await expect(page.locator('#investment_import_submit_button')).toBeDisabled();
        await expect(page.locator('#hsbc_credit_card_results')).toBeHidden();
        await expect(page.locator('#hsbc_cash_account_text')).toHaveValue(completeCardPage);
    });
}

test('clearing a preview resets the shared source and removes card readiness', async ({page}) => {
    await page.route('**/api/credit-cards/hsbc/preview', (route) => route.fulfill({json: parsedCard()}));
    await openAccountImport(page);
    await pasteAccountClipboard(page, completeCardPage);
    await page.locator('#hsbc_credit_card_preview_button').click();
    await expect(page.locator('#investment_import_submit_button')).toBeEnabled();
    await clearAccountInput(page);
    await expect(page.locator('#hsbc_cash_account_text')).toHaveValue('');
    await expect(page.locator('#hsbc_cash_account_display')).toHaveValue('');
    await expect(page.locator('#hsbc_credit_card_panel')).toBeHidden();
    await expect(page.locator('#hsbc_credit_card_results')).toBeHidden();
    await expect(page.locator('#investment_import_submit_button')).toBeDisabled();
});

test('pasting the same complete card twice retains one clip without automatic preview', async ({page}) => {
    const calls = await guardRoutingRequests(page);
    await openAccountImport(page);
    await pasteAccountClipboard(page, completeCardPage);
    await pasteAccountClipboard(page, completeCardPage);
    await expect(page.locator('#hsbc_cash_account_text')).toHaveValue(completeCardPage);
    await expect(page.locator('#hsbc_credit_card_preview_button')).toBeEnabled();
    await expect(page.locator('#investment_import_submit_button')).toBeDisabled();
    expect(calls).toEqual({cash: 0, card: 0});
});

test('ordinary cash clips with card navigation continue through the existing cash validator', async ({page}) => {
    const calls = await guardRoutingRequests(page);
    await openAccountImport(page);
    await pasteAccountClipboard(page, completeCashPage);
    await expect.poll(() => calls.cash).toBe(1);
    const secondCash = completeCashPage.replace('HKD Savings', 'USD Savings');
    await pasteAccountClipboard(page, secondCash);
    await expect.poll(() => calls.cash).toBe(2);
    await expect(page.locator('#hsbc_import_mode_paste')).toBeChecked();
    await expect(page.locator('#hsbc_cash_account_text')).toHaveValue(joinChunks(completeCashPage, secondCash));
    await expect(page.locator('#hsbc_credit_card_panel')).toBeHidden();
    await expect(page.locator('#investment_import_submit_button')).toBeEnabled();
    expect(calls.card).toBe(0);
});

for (const [label, first, next] of [
    ['cash then card', completeCashPage, completeCardPage],
    ['card then cash', completeCardPage, completeCashPage],
    ['two different card pages', completeCardPage, completeCardPage.replaceAll('6789', '9876')],
    ['card then unknown', completeCardPage, 'Unknown account capture'],
    ['unknown then card', 'Unknown account capture', completeCardPage],
]) {
    test(`${label} preserves both clipboard captures and blocks the combined import`, async ({page}) => {
        const calls = await guardRoutingRequests(page);
        await openAccountImport(page);
        await pasteAccountClipboard(page, first);
        if (first !== completeCardPage) await expect.poll(() => calls.cash).toBe(1);
        const cashBeforeMixed = calls.cash;
        await pasteAccountClipboard(page, next);
        await expect(page.locator('#hsbc_cash_account_text')).toHaveValue(joinChunks(first, next));
        await expect(page.locator('#hsbc_credit_card_status')).toContainText('mixed or multiple credit-card pages');
        await expect(page.locator('#hsbc_credit_card_preview_button')).toBeDisabled();
        await expect(page.locator('#investment_import_submit_button')).toBeDisabled();
        expect(calls).toEqual({cash: cashBeforeMixed, card: 0});
    });
}

test('a mixed clipboard batch remains intact and never falls back to cash validation', async ({page}) => {
    const calls = await guardRoutingRequests(page);
    await openAccountImport(page);
    const mixed = joinChunks(completeCashPage, completeCardPage);
    await pasteAccountClipboard(page, mixed);
    await expect(page.locator('#hsbc_cash_account_text')).toHaveValue(mixed);
    await expect(page.locator('#hsbc_credit_card_preview_button')).toBeDisabled();
    await expect(page.locator('#investment_import_feedback_message')).toContainText('mixed or multiple credit-card pages');
    await expect(page.locator('#investment_import_submit_button')).toBeDisabled();
    expect(calls).toEqual({cash: 0, card: 0});
});

test('an incomplete card stays in the account field and cannot use cash validation', async ({page}) => {
    const calls = await guardRoutingRequests(page);
    await openAccountImport(page);
    const incomplete = completeCardPage.replace('Payment due date:', 'See payment details:');
    await pasteAccountClipboard(page, incomplete);
    await expect(page.locator('#hsbc_cash_account_text')).toHaveValue(incomplete);
    await expect(page.locator('#hsbc_credit_card_status')).toContainText('credit-card page is incomplete');
    await expect(page.locator('#hsbc_credit_card_preview_button')).toBeDisabled();
    await expect(page.locator('#investment_import_submit_button')).toBeDisabled();
    expect(calls).toEqual({cash: 0, card: 0});
});

test('a stale cash response cannot authorize a newly pasted card', async ({page}) => {
    let release;
    let received;
    let completed;
    const requestArrived = new Promise((resolve) => { received = resolve; });
    const responseAllowed = new Promise((resolve) => { release = resolve; });
    const responseCompleted = new Promise((resolve) => { completed = resolve; });
    const calls = await guardRoutingRequests(page);
    await page.route('**/api/investment/imports/hsbc-paste/validate', async (route) => {
        received();
        await responseAllowed;
        await route.fulfill({json: validCash()}).catch(() => {});
        completed();
    });
    await openAccountImport(page);
    await pasteAccountClipboard(page, completeCashPage);
    await requestArrived;
    await clearAccountInput(page);
    await pasteAccountClipboard(page, completeCardPage);
    release();
    await responseCompleted;
    await expect(page.locator('#hsbc_credit_card_status')).toContainText('Select Preview');
    await expect(page.locator('#hsbc_cash_account_display')).not.toHaveValue(/Checking/);
    await expect(page.locator('#hsbc_credit_card_preview_button')).toBeEnabled();
    await expect(page.locator('#investment_import_submit_button')).toBeDisabled();
    await expect(page.locator('#hsbc_credit_card_results')).toBeHidden();
    expect(calls.card).toBe(0);
});
