/* Code version: v1.3.1 */
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

async function openAccountImport(page, width = 1280, url = '/trade/investment', height = 900) {
    await mockInvestmentReadApis(page, {intradayRows: () => []});
    await page.setViewportSize({width, height});
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
    const calls = {cash: 0, card: 0, preview: 0};
    await page.route('**/api/credit-cards/**', (route) => { calls.card += 1; return route.abort(); });
    await page.route('**/api/credit-cards/hsbc/preview', (route) => {
        calls.preview += 1;
        return route.fulfill({json: parsedCard()});
    });
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
        await expect(page.locator('#hsbc_credit_card_preview_button')).toHaveCount(0);
        await expect(page.locator('#hsbc_credit_card_saved_button')).toHaveCount(0);
        await expect(page.locator('#hsbc_credit_card_summary')).toHaveCount(0);
        await expect(page.locator('#hsbc_credit_card_rows tr')).toHaveCount(4);
        await expect(page.locator('#hsbc_credit_card_rows tr').nth(0)).toContainText('Repayment');
        await expect(page.locator('#hsbc_credit_card_rows tr').nth(1)).toContainText('Pending');
        await expect(page.locator('#hsbc_credit_card_rows tr').nth(2)).toContainText('RewardCash');
        await expect(page.locator('#hsbc_credit_card_rows tr').nth(3)).toContainText('Purchase');
        await expect(page.locator('#hsbc_credit_card_rows img')).toHaveCount(0);
        await expect(page.locator('#hsbc_credit_card_status')).toContainText('Nothing has been saved');
        await expect(page.locator('#investment_import_submit_button')).toBeEnabled();
        expect(previews).toBe(1);
        expect(calls).toEqual({cash: 0, card: 0, preview: 0});
        const bounds = await page.locator('#hsbc_cash_account_display').boundingBox();
        expect(bounds.width).toBeGreaterThan(150);
        expect(bounds.x).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
        const help = await page.locator('#hsbc_credit_card_help').boundingBox();
        expect(help.y).toBeGreaterThanOrEqual(bounds.y + bounds.height);
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
    });
}

for (const [width, height] of [[1280, 720], [600, 1222], [390, 844], [320, 700]]) {
    test(`credit-card table keeps all columns within the holdings import at ${width}x${height}`, async ({page}) => {
        const calls = await guardRoutingRequests(page);
        await openAccountImport(page, width, '/trade/investment?view=holdings', height);
        await pasteAccountClipboard(page, completeCardPage);
        await expect(page.locator('#hsbc_credit_card_rows tr')).toHaveCount(4);
        const table = page.locator('.hsbc-credit-card-table');
        await expect(table.locator('thead th')).toHaveText(['Date', 'Card', 'Description', 'Kind', 'Status', 'Amount']);
        await expect(page.locator('#hsbc_credit_card_preview_button, #hsbc_credit_card_saved_button, #hsbc_credit_card_summary')).toHaveCount(0);
        const layout = await table.evaluate((element) => {
            const box = element.getBoundingClientRect();
            const wrapper = element.parentElement;
            const wrapperBox = wrapper.getBoundingClientRect();
            const cells = [...element.querySelectorAll('th, td')].map((cell) => {
                const bounds = cell.getBoundingClientRect();
                const styles = getComputedStyle(cell);
                const range = document.createRange();
                range.selectNodeContents(cell);
                return {
                    left: bounds.left, right: bounds.right, width: bounds.width,
                    display: styles.display, visibility: styles.visibility,
                    textOverflow: styles.textOverflow, clientWidth: cell.clientWidth, scrollWidth: cell.scrollWidth,
                    textBounds: [...range.getClientRects()].map((rect) => ({left: rect.left, right: rect.right})),
                };
            });
            return {
                percentages: [...element.querySelectorAll('colgroup col')].map((col) => col.style.width),
                renderedPercentages: [...element.querySelectorAll('colgroup col')].map((col) => col.getBoundingClientRect().width / box.width * 100),
                table: {left: box.left, right: box.right},
                wrapper: {left: wrapperBox.left, right: wrapperBox.right, clientWidth: wrapper.clientWidth, scrollWidth: wrapper.scrollWidth},
                pageWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth, cells,
            };
        });
        expect(layout.percentages).toHaveLength(6);
        const percentages = layout.percentages.map((value) => {
            expect(value).toMatch(/^\d+%$/);
            return Number.parseInt(value, 10);
        });
        expect(percentages.every((value) => value > 0 && (value % 2 === 0 || value % 5 === 0))).toBe(true);
        expect(percentages.reduce((total, value) => total + value, 0)).toBe(100);
        const responsivePercentages = layout.renderedPercentages.map((value) => Math.round(value));
        expect(responsivePercentages).toEqual(layout.viewportWidth <= 600
            ? [14, 14, 24, 14, 14, 20] : [14, 10, 32, 14, 12, 18]);
        expect(responsivePercentages.reduce((total, value) => total + value, 0)).toBe(100);
        expect(layout.wrapper.scrollWidth).toBeLessThanOrEqual(layout.wrapper.clientWidth + 1);
        expect(layout.pageWidth).toBeLessThanOrEqual(layout.viewportWidth);
        expect(layout.table.left).toBeGreaterThanOrEqual(layout.wrapper.left - 1);
        expect(layout.table.right).toBeLessThanOrEqual(layout.wrapper.right + 1);
        expect(layout.wrapper.left).toBeGreaterThanOrEqual(0);
        expect(layout.wrapper.right).toBeLessThanOrEqual(width);
        expect(layout.cells).toHaveLength(30);
        layout.cells.forEach((cell) => {
            expect(cell.width).toBeGreaterThan(0);
            expect(cell.display).not.toBe('none');
            expect(cell.visibility).toBe('visible');
            expect(cell.textOverflow).not.toBe('ellipsis');
            expect(cell.scrollWidth).toBeLessThanOrEqual(cell.clientWidth + 1);
            expect(cell.left).toBeGreaterThanOrEqual(layout.wrapper.left - 1);
            expect(cell.right).toBeLessThanOrEqual(layout.wrapper.right + 1);
            cell.textBounds.forEach((rect) => {
                expect(rect.left).toBeGreaterThanOrEqual(cell.left - 1);
                expect(rect.right).toBeLessThanOrEqual(cell.right + 1);
            });
        });
        await expect(page.locator('#hsbc_credit_card_rows tr').nth(1).locator('td').nth(2)).toHaveText('APPLEPAY SAMPLE ELECTRONICS HONG KONG HK');
        await expect(page.locator('#hsbc_credit_card_rows tr').nth(1).locator('td').nth(5)).toHaveText('HKD 2,450.00');
        expect(calls).toEqual({cash: 0, card: 0, preview: 1});
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
    await expect(page.locator('#investment_import_submit_button')).toBeEnabled();
    expect(calls).toEqual([]);
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

test('a failed automatic preview remains blocked and a deliberate repeat paste can retry', async ({page}) => {
    const calls = await guardRoutingRequests(page);
    let previews = 0;
    await page.route('**/api/credit-cards/hsbc/preview', (route) => {
        previews += 1;
        return previews === 1
            ? route.fulfill({status: 400, json: {success: false, error: 'The captured card date needs review.'}})
            : route.fulfill({json: parsedCard()});
    });
    await openAccountImport(page);
    await pasteAccountClipboard(page, completeCardPage);
    await expect(page.locator('#hsbc_credit_card_status')).toContainText('The captured card date needs review.');
    await expect(page.locator('#hsbc_credit_card_results')).toBeHidden();
    await expect(page.locator('#investment_import_submit_button')).toBeDisabled();
    expect(previews).toBe(1);
    await pasteAccountClipboard(page, completeCardPage);
    await expect(page.locator('#hsbc_credit_card_rows tr')).toHaveCount(4);
    await expect(page.locator('#investment_import_submit_button')).toBeEnabled();
    expect(previews).toBe(2);
    expect(calls).toEqual({cash: 0, card: 0, preview: 0});
});

for (const dimension of ['Statements', 'broker']) {
    test(`a ${dimension} round trip requires its fresh automatic preview before import`, async ({page}) => {
        let release;
        let received;
        let releaseFresh;
        let receivedFresh;
        let previews = 0;
        const requestArrived = new Promise((resolve) => { received = resolve; });
        const responseAllowed = new Promise((resolve) => { release = resolve; });
        const freshRequestArrived = new Promise((resolve) => { receivedFresh = resolve; });
        const freshResponseAllowed = new Promise((resolve) => { releaseFresh = resolve; });
        await page.route('**/api/credit-cards/hsbc/preview', async (route) => {
            previews += 1;
            if (previews === 1) {
                received();
                await responseAllowed;
            } else {
                receivedFresh();
                await freshResponseAllowed;
            }
            await route.fulfill({json: parsedCard()});
        });
        await openAccountImport(page);
        await pasteAccountClipboard(page, completeCardPage);
        await requestArrived;
        if (dimension === 'Statements') {
            await page.locator('label[for="hsbc_import_mode_statement_pdf"]').click();
            await page.locator('label[for="hsbc_import_mode_paste"]').click();
        } else {
            await page.locator('#investment_import_broker').selectOption('ibkr', {force: true});
            await page.locator('#investment_import_broker').selectOption('hsbc', {force: true});
        }
        release();
        await freshRequestArrived;
        await expect(page.locator('#investment_import_submit_button')).toBeDisabled();
        await expect(page.locator('#hsbc_credit_card_results')).toBeHidden();
        await expect(page.locator('#hsbc_cash_account_text')).toHaveValue(completeCardPage);
        releaseFresh();
        await expect(page.locator('#investment_import_submit_button')).toBeEnabled();
        await expect(page.locator('#hsbc_credit_card_rows tr')).toHaveCount(4);
        expect(previews).toBe(2);
    });
}

test('clearing a preview resets the shared source and removes card readiness', async ({page}) => {
    await page.route('**/api/credit-cards/hsbc/preview', (route) => route.fulfill({json: parsedCard()}));
    await openAccountImport(page);
    await pasteAccountClipboard(page, completeCardPage);
    await expect(page.locator('#investment_import_submit_button')).toBeEnabled();
    await clearAccountInput(page);
    await expect(page.locator('#hsbc_cash_account_text')).toHaveValue('');
    await expect(page.locator('#hsbc_cash_account_display')).toHaveValue('');
    await expect(page.locator('#hsbc_credit_card_panel')).toBeHidden();
    await expect(page.locator('#hsbc_credit_card_results')).toBeHidden();
    await expect(page.locator('#investment_import_submit_button')).toBeDisabled();
});

test('pasting the same complete card twice retains one clip and one read-only preview', async ({page}) => {
    const calls = await guardRoutingRequests(page);
    await openAccountImport(page);
    await pasteAccountClipboard(page, completeCardPage);
    await expect(page.locator('#investment_import_submit_button')).toBeEnabled();
    await pasteAccountClipboard(page, completeCardPage);
    await expect(page.locator('#hsbc_cash_account_text')).toHaveValue(completeCardPage);
    await expect(page.locator('#investment_import_submit_button')).toBeEnabled();
    expect(calls).toEqual({cash: 0, card: 0, preview: 1});
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
        else await expect.poll(() => calls.preview).toBe(1);
        const cashBeforeMixed = calls.cash;
        const previewsBeforeMixed = calls.preview;
        await pasteAccountClipboard(page, next);
        await expect(page.locator('#hsbc_cash_account_text')).toHaveValue(joinChunks(first, next));
        await expect(page.locator('#hsbc_credit_card_status')).toContainText('mixed or multiple credit-card pages');
        await expect(page.locator('#investment_import_submit_button')).toBeDisabled();
        await expect(page.locator('#hsbc_credit_card_results')).toBeHidden();
        expect(calls).toEqual({cash: cashBeforeMixed, card: 0, preview: previewsBeforeMixed});
    });
}

test('a mixed clipboard batch remains intact and never falls back to cash validation', async ({page}) => {
    const calls = await guardRoutingRequests(page);
    await openAccountImport(page);
    const mixed = joinChunks(completeCashPage, completeCardPage);
    await pasteAccountClipboard(page, mixed);
    await expect(page.locator('#hsbc_cash_account_text')).toHaveValue(mixed);
    await expect(page.locator('#investment_import_feedback_message')).toContainText('mixed or multiple credit-card pages');
    await expect(page.locator('#investment_import_submit_button')).toBeDisabled();
    expect(calls).toEqual({cash: 0, card: 0, preview: 0});
});

test('an incomplete card stays in the account field and cannot use cash validation', async ({page}) => {
    const calls = await guardRoutingRequests(page);
    await openAccountImport(page);
    const incomplete = completeCardPage.replace('Payment due date:', 'See payment details:');
    await pasteAccountClipboard(page, incomplete);
    await expect(page.locator('#hsbc_cash_account_text')).toHaveValue(incomplete);
    await expect(page.locator('#hsbc_credit_card_status')).toContainText('credit-card page is incomplete');
    await expect(page.locator('#investment_import_submit_button')).toBeDisabled();
    expect(calls).toEqual({cash: 0, card: 0, preview: 0});
});

test('a stale cash response cannot authorize a newly pasted card', async ({page}) => {
    let release;
    let received;
    let completed;
    let releaseCard;
    let receivedCard;
    const requestArrived = new Promise((resolve) => { received = resolve; });
    const responseAllowed = new Promise((resolve) => { release = resolve; });
    const responseCompleted = new Promise((resolve) => { completed = resolve; });
    const cardRequestArrived = new Promise((resolve) => { receivedCard = resolve; });
    const cardResponseAllowed = new Promise((resolve) => { releaseCard = resolve; });
    const calls = await guardRoutingRequests(page);
    await page.route('**/api/credit-cards/hsbc/preview', async (route) => {
        receivedCard();
        await cardResponseAllowed;
        await route.fulfill({json: parsedCard()});
    });
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
    await cardRequestArrived;
    release();
    await responseCompleted;
    await expect(page.locator('#hsbc_credit_card_status')).toContainText('Previewing credit-card activity');
    await expect(page.locator('#hsbc_cash_account_display')).not.toHaveValue(/Checking/);
    await expect(page.locator('#investment_import_submit_button')).toBeDisabled();
    await expect(page.locator('#hsbc_credit_card_results')).toBeHidden();
    expect(calls.card).toBe(0);
    releaseCard();
    await expect(page.locator('#investment_import_submit_button')).toBeEnabled();
    await expect(page.locator('#hsbc_credit_card_rows tr')).toHaveCount(4);
});

test('editing a complete card while previewing can authorize only the newest text', async ({page}) => {
    const calls = await guardRoutingRequests(page);
    const updatedText = completeCardPage.replace('4,850.50', '4,000.00');
    const previewTexts = [];
    let releaseOriginal;
    let originalReceived;
    let releaseCurrent;
    let currentReceived;
    const originalArrived = new Promise((resolve) => { originalReceived = resolve; });
    const originalAllowed = new Promise((resolve) => { releaseOriginal = resolve; });
    const currentArrived = new Promise((resolve) => { currentReceived = resolve; });
    const currentAllowed = new Promise((resolve) => { releaseCurrent = resolve; });
    await page.route('**/api/credit-cards/hsbc/preview', async (route) => {
        const {text} = route.request().postDataJSON();
        previewTexts.push(text);
        const result = parsedCard();
        if (text === completeCardPage) {
            originalReceived();
            await originalAllowed;
            result.transactions[0].description = 'Obsolete preview';
        } else {
            currentReceived();
            await currentAllowed;
            result.source_sha256 = 'b'.repeat(64);
            result.transactions[0].description = 'Current preview';
        }
        await route.fulfill({json: result});
    });
    await openAccountImport(page);
    await pasteAccountClipboard(page, completeCardPage);
    await originalArrived;
    await replaceAccountInput(page, updatedText);
    releaseOriginal();
    await currentArrived;
    await expect(page.locator('#investment_import_submit_button')).toBeDisabled();
    await expect(page.locator('#hsbc_credit_card_results')).toBeHidden();
    releaseCurrent();
    await expect(page.locator('#hsbc_credit_card_rows tr').nth(0)).toContainText('Current preview');
    await expect(page.locator('#hsbc_credit_card_rows')).not.toContainText('Obsolete preview');
    await expect(page.locator('#investment_import_submit_button')).toBeEnabled();
    expect(previewTexts).toEqual([completeCardPage, updatedText]);
    expect(calls).toEqual({cash: 0, card: 0, preview: 0});
});
