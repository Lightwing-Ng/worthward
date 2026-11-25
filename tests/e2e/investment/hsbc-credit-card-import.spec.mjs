/* Code version: v1.3.11 */
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

const expandedCardPage = `${completeCardPage.split('\nTransactions\n')[0]}
Transactions
Transaction date Card Description Amount in Amount out Additional options
29 Oct 2026
TEST CARD HOLDER
Card ending in 6789
SALES: SAMPLE SHOP Beijing CN
51.75 HKD
Post date
30 Oct 2026
Transaction time
17:40:23
Merchant name
SAMPLE SHOP
Area / district
Beijing
Country / region
CHINA
Transaction amount
43.00 CNY
Billing amount
51.75 HKD
Card number
4321-0000-0000-6789
24 Oct 2026
TEST CARD HOLDER
Card ending in 6789
APPLEPAY SAMPLE TRANSIT Shenzhen CN
36.00 CNY
Pending
Post date
Not yet posted
Transaction time
18:37:03
Merchant name
SAMPLE TRANSIT
Area / district
Shenzhen
Country / region
CN
Transaction amount
36.00 CNY
Billing amount
Pending
Card number
4321-0000-0000-6789
24 Oct 2026
TEST CARD HOLDER
Card ending in 6789
APPLEPAY SAMPLE TRANSIT Shenzhen CN
5.99 HKD
Download`;

// Writes are always intercepted. One case exercises the isolated read-only preview.
const parsedCard = () => {
    const transactions = [
        {transaction_date: '2026-10-13', card_last4: '6789', description: 'PAYMENT - THANK YOU', kind: 'repayment', status: 'posted', currency: 'HKD', amount: '3000'},
        {transaction_date: '2026-10-12', card_last4: '6789', description: 'APPLEPAY SAMPLE ELECTRONICS HONG KONG HK', kind: 'purchase', status: 'pending', currency: 'HKD', amount: '2450'},
        {transaction_date: '2026-10-12', card_last4: '6789', description: 'PAY w/RC SAMPLE ELECTRONICS HONG KONG HK', kind: 'rewardcash', status: 'posted', currency: 'HKD', amount: '25'},
        {transaction_date: '2026-10-11', card_last4: '6789', description: '<img src=x onerror=alert(1)>', kind: 'purchase', status: 'posted', currency: 'HKD', amount: '18.50'},
    ];
    return {
        success: true, ready: true, source_sha256: 'a'.repeat(64),
        account: {last4: '6789', name: 'HSBC Red Credit Card', currency: 'HKD'},
        snapshot: {account_balance: '4850.50', current_amount_due: '0', minimum_payment: '0', payment_due_date: '2026-11-06', rewardcash_balance: '0'},
        transactions,
        preview_transactions: transactions,
        summary: {posted_purchase_count: 1, posted_purchase_total: '18.50', repayment_count: 1, repayment_total: '3000', rewardcash_count: 1, rewardcash_total: '25', pending_count: 1, pending_total: '2450', added_count: 4, promoted_count: 0, duplicate_count: 0},
        warnings: [],
    };
};
const emptyCashPreview = () => ({transactions: [], balances: [], positions: [], warnings: []});
const validCash = () => ({
    success: true,
    ready: true,
    mode: 'cash_only_non_usd',
    field_status: {cash: true},
    cash_currencies: ['HKD'],
    preview: emptyCashPreview(),
});

async function openAccountImport(page, width = 1280, url = '/trade/investment', height = 900, {realSession = false} = {}) {
    await mockInvestmentReadApis(page, {intradayRows: () => []});
    await page.setViewportSize({width, height});
    if (!realSession) {
        await page.route('**/api/investment/session-token', (route) => route.fulfill({json: {success: true, investment_csrf_token: 'test-card-session'}}));
    }
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

async function pasteDisplayText(page, selector, text) {
    const prevented = await page.locator(selector).evaluate((input, value) => {
        const clipboardData = new DataTransfer();
        clipboardData.setData('text/plain', value);
        const event = new ClipboardEvent('paste', {bubbles: true, cancelable: true, clipboardData});
        input.dispatchEvent(event);
        return event.defaultPrevented;
    }, text);
    expect(prevented).toBe(true);
}

async function disableClipboardReader(page) {
    await page.evaluate(() => {
        Object.defineProperty(navigator, 'clipboard', {configurable: true, value: undefined});
    });
}

async function pasteDisplayClipboard(page, selector, text) {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.evaluate((value) => navigator.clipboard.writeText(value), text);
    await disableClipboardReader(page);
    await page.locator(selector).press(process.platform === 'darwin' ? 'Meta+V' : 'Control+V');
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

test('native keyboard paste previews sales and pending CNY without a Clipboard API reader or ledger writes', async ({page}) => {
    let previewResult;
    let previews = 0;
    const writes = [];
    await page.route('**/api/credit-cards/hsbc/import', (route) => {
        writes.push(route.request().url());
        return route.abort();
    });
    await page.route('**/api/investment/import', (route) => {
        writes.push(route.request().url());
        return route.abort();
    });
    await page.route('**/api/credit-cards/hsbc/preview', async (route) => {
        previews += 1;
        expect(route.request().postDataJSON()).toEqual({text: expandedCardPage});
        const response = await route.fetch();
        previewResult = await response.json();
        await route.fulfill({response});
    });
    await openAccountImport(page, 1280, '/trade/investment', 900, {realSession: true});
    await pasteDisplayClipboard(page, '#hsbc_cash_account_display', expandedCardPage);
    await expect(page.locator('#hsbc_cash_account_text')).toHaveValue(expandedCardPage);
    await expect(page.locator('#hsbc_credit_card_status')).toContainText('Preview ready. Review the entries');
    await expect(page.locator('#investment_import_submit_button')).toBeEnabled();
    await expect(page.locator('#hsbc_credit_card_rows tr')).toHaveCount(3);
    const rows = page.locator('#hsbc_credit_card_rows tr');
    await expect(rows.nth(0)).toContainText('SALES: SAMPLE SHOP Beijing CN');
    await expect(rows.nth(0).locator('td').nth(4)).toHaveText('Posted');
    await expect(rows.nth(0).locator('td').nth(5)).toHaveText('HKD 51.75');
    await expect(rows.nth(1).locator('td').nth(4)).toHaveText('Pending');
    await expect(rows.nth(1).locator('td').nth(5)).toHaveText('CNY 36.00');
    expect(previewResult.ready).toBe(true);
    expect(previewResult.committed).toBe(false);
    expect(previewResult.transactions[1].liability_delta).toBeNull();
    expect(previewResult.summary.pending_total).toBeNull();
    expect(previewResult.summary.pending_totals_by_currency).toEqual({CNY: '36.00'});
    await pasteDisplayText(page, '#hsbc_cash_account_display', expandedCardPage);
    await expect(page.locator('#hsbc_cash_account_text')).toHaveValue(expandedCardPage);
    await expect(page.locator('#investment_import_submit_button')).toBeEnabled();
    expect(previews).toBe(1);
    expect(writes).toEqual([]);
});

test('native HSBC cash, portfolio, and order pastes retain separate multiline sources', async ({page}) => {
    const calls = await guardRoutingRequests(page);
    const validations = [];
    const writes = [];
    await page.route('**/api/investment/imports/hsbc-paste/validate', (route) => {
        const body = route.request().postDataJSON();
        validations.push(body);
        const composite = Boolean(body.portfolio_text || body.order_status_text);
        const validation = {
            success: true,
            mode: composite ? 'usd_composite' : 'cash_only_usd',
            field_status: {
                cash: Boolean(body.cash_account_text),
                portfolio: Boolean(body.portfolio_text),
                order_status: Boolean(body.order_status_text),
            },
            cash_currencies: ['USD'],
        };
        if (composite && !body.order_status_text) {
            return route.fulfill({json: {...validation, ready: false, required_fields: ['order_status']}});
        }
        return route.fulfill({json: {
            ...validation,
            ready: true,
            preview: {
                transactions: composite
                    ? [{date: '2026-11-13', ticker: 'QQQI', description: 'Sample trade', type: 'buy', amount: '-94.25', currency: 'USD', quantity: '5', change: 'updated', settlement_date: '2026-11-16', settlement_amount: '-94.25'}]
                    : [],
                balances: [{account_type: 'SAVINGS', currency: 'USD', previous_amount: '1000', amount: '1250', date: '2026-11-16'}],
                positions: composite ? [{ticker: 'QQQI', currency: 'USD', previous_quantity: '10', quantity: '15', previous_cost_price: '18.5', cost_price: '18.75'}] : [],
                warnings: [],
            },
        }});
    });
    await openAccountImport(page);
    await page.route('**/api/investment/transactions*', (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        writes.push(route.request().url());
        return route.abort();
    });
    await disableClipboardReader(page);
    const usdCashPage = completeCashPage.replaceAll('HKD', 'USD');
    const fields = [
        ['#hsbc_cash_account_paste_button', '#hsbc_cash_account_display', '#hsbc_cash_account_text', 'cash_account_text', usdCashPage],
        ['#hsbc_portfolio_text_paste_button', '#hsbc_portfolio_text_display', '#hsbc_portfolio_text', 'portfolio_text', 'Portfolio\nSample holdings capture'],
        ['#hsbc_order_status_paste_button', '#hsbc_order_status_display', '#hsbc_order_status_text', 'order_status_text', 'Order Status\nSample order capture'],
    ];
    const expected = {cash_account_text: '', portfolio_text: '', order_status_text: ''};
    for (const [button, display, source, key, text] of fields) {
        await page.locator(button).click();
        await expect(page.locator(display)).toBeFocused();
        await expect(page.locator('#investment_import_feedback_message')).toContainText('Press ⌘V on Mac or Ctrl+V');
        await pasteDisplayText(page, display, text);
        expected[key] = text;
        await expect(page.locator(source)).toHaveValue(text);
        await expect.poll(() => validations.at(-1)).toEqual({...expected});
        if (key === 'portfolio_text') {
            await expect(page.locator('#hsbc_paste_preview_status')).toHaveText('Paste Order Status to preview this HSBC sync.');
            await expect(page.locator('#investment_import_submit_button')).toBeDisabled();
            await expect(page.locator('#hsbc_paste_preview_balances tr')).toHaveCount(0);
            continue;
        }
        await expect(page.locator('#investment_import_submit_button')).toBeEnabled();
        await expect(page.locator('#hsbc_paste_preview_balances tr')).toHaveCount(1);
        await expect(page.locator('#hsbc_paste_preview_balances tr')).toContainText('USD Savings');
        await expect(page.locator('#hsbc_paste_preview_balances tr')).toContainText('USD 1,250.00');
        await expect(page.locator('#hsbc_paste_preview_transactions tr')).toHaveCount(key === 'order_status_text' ? 1 : 0);
        await expect(page.locator('#hsbc_paste_preview_positions tr')).toHaveCount(key === 'order_status_text' ? 1 : 0);
    }
    await expect(page.locator('#hsbc_paste_preview_transactions tr')).toContainText('Sample trade');
    await expect(page.locator('#hsbc_paste_preview_transactions tr')).toContainText('USD -94.25 settled');
    const holdingChanges = page.locator('#hsbc_paste_preview_positions tr')
        .getByRole('cell').nth(1).getByRole('list');
    await expect(holdingChanges).toHaveCSS('list-style-type', 'disc');
    await expect(holdingChanges.getByRole('listitem')).toHaveText([
        'Shares 10 → 15',
        'Average cost USD 18.50 → USD 18.75',
    ]);
    for (const [, , source, , text] of fields) await expect(page.locator(source)).toHaveValue(text);
    await page.evaluate(() => {
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: {readText: async () => { throw new DOMException('Permission denied', 'NotAllowedError'); }},
        });
    });
    await page.locator('#hsbc_cash_account_paste_button').click();
    await expect(page.locator('#hsbc_cash_account_display')).toBeFocused();
    await expect(page.locator('#investment_import_feedback_message')).toContainText('Press ⌘V on Mac or Ctrl+V');
    await expect(page.locator('#hsbc_credit_card_panel')).toBeHidden();
    expect(calls).toEqual({cash: 0, card: 0, preview: 0});
    expect(writes).toEqual([]);
});

test('HSBC sync stays blocked until validation returns a complete preview', async ({page}) => {
    let validations = 0;
    const writes = [];
    const previews = [undefined, {...emptyCashPreview(), transactions: [null]}, emptyCashPreview()];
    await page.route('**/api/investment/imports/hsbc-paste/validate', (route) => {
        return route.fulfill({json: {
            ...validCash(),
            preview: previews[validations++],
        }});
    });
    await openAccountImport(page);
    await page.route('**/api/investment/transactions*', (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        writes.push(route.request().url());
        return route.abort();
    });
    const previewStatus = page.locator('#hsbc_paste_preview_status');
    const submitButton = page.getByRole('button', {name: 'Sync now'});
    for (const attempt of [1, 2]) {
        await pasteAccountClipboard(page, completeCashPage);
        await expect.poll(() => validations).toBe(attempt);
        await expect(previewStatus).toContainText('The HSBC sync preview is unavailable.');
        await expect(submitButton).toBeDisabled();
        await page.locator('#investment_form').evaluate((form) => form.requestSubmit());
    }
    await pasteAccountClipboard(page, completeCashPage);
    await expect(previewStatus).toContainText('No changes to transactions');
    await expect(submitButton).toBeEnabled();
    expect(writes).toEqual([]);
});

test('an unchanged HSBC cash capture shows a summary and keeps sync available', async ({page}) => {
    const calls = await guardRoutingRequests(page);
    await page.route('**/api/investment/imports/hsbc-paste/validate', (route) => route.fulfill({json: {
        ...validCash(),
    }}));
    await openAccountImport(page, 390, '/trade/investment?view=holdings');
    await pasteAccountClipboard(page, completeCashPage.replace('HSBC HKD Savings', 'HKD Current'));
    const preview = page.getByRole('region', {name: 'HSBC sync preview'});
    await expect(preview.getByRole('status')).toContainText('No changes to transactions, cash balances, or holdings.');
    await expect(preview.getByRole('table')).toHaveCount(0);
    await expect(page.getByRole('button', {name: 'Sync now'})).toBeEnabled();
    expect(calls).toEqual({cash: 0, card: 0, preview: 0});
});

for (const [label, text, status] of [
    ['mixed', joinChunks(completeCashPage, completeCardPage), 'mixed or multiple credit-card pages'],
    ['incomplete', completeCardPage.replace('Payment due date:', 'See payment details:'), 'credit-card page is incomplete'],
]) {
    test(`native ${label} card paste retains its source and blocks preview and import`, async ({page}) => {
        const calls = await guardRoutingRequests(page);
        const writes = [];
        await page.route('**/api/investment/import', (route) => {
            writes.push(route.request().url());
            return route.abort();
        });
        await openAccountImport(page);
        await disableClipboardReader(page);
        await pasteDisplayText(page, '#hsbc_cash_account_display', text);
        await expect(page.locator('#hsbc_cash_account_text')).toHaveValue(text);
        await expect(page.locator('#hsbc_credit_card_status')).toContainText(status);
        await expect(page.locator('#hsbc_credit_card_results')).toBeHidden();
        await expect(page.locator('#investment_import_submit_button')).toBeDisabled();
        expect(calls).toEqual({cash: 0, card: 0, preview: 0});
        expect(writes).toEqual([]);
    });
}

test('credit-card feedback confirms an all-duplicate import after ledger readback', async ({page}) => {
    const calls = await guardRoutingRequests(page);
    const writes = [];
    const imports = [];
    let releasePreview;
    let previewReceived;
    let releaseImport;
    let importReceived;
    let previews = 0;
    const previewArrived = new Promise((resolve) => { previewReceived = resolve; });
    const previewAllowed = new Promise((resolve) => { releasePreview = resolve; });
    const importArrived = new Promise((resolve) => { importReceived = resolve; });
    const importAllowed = new Promise((resolve) => { releaseImport = resolve; });
    const duplicateResult = () => {
        const result = parsedCard();
        result.source_already_imported = true;
        result.preview_transactions = [];
        result.summary = {...result.summary, added_count: 0, promoted_count: 0, duplicate_count: 4};
        return result;
    };
    await page.route('**/api/investment/import', (route) => {
        writes.push(route.request().url());
        return route.abort();
    });
    await page.route('**/api/credit-cards/hsbc/preview', async (route) => {
        previews += 1;
        previewReceived();
        await previewAllowed;
        await route.fulfill({json: duplicateResult()});
    });
    await page.route('**/api/credit-cards/hsbc/import', async (route) => {
        imports.push(route.request().postDataJSON());
        importReceived();
        await importAllowed;
        const result = duplicateResult();
        result.committed = true;
        result.merged_transactions = result.transactions;
        await route.fulfill({json: result});
    });
    await openAccountImport(page, 847, '/trade/investment?view=holdings', 1063);
    await pasteAccountClipboard(page, completeCardPage);
    await previewArrived;
    const status = page.locator('#hsbc_credit_card_status');
    const progress = page.locator('#hsbc_credit_card_progress');
    const spinner = progress.locator('.suggestion-loading-spinner');
    const note = page.locator('#investment_import_note');
    const icon = page.locator('#hsbc_cash_account_text_status');
    const display = page.locator('#hsbc_cash_account_display');
    const submit = page.locator('#investment_import_submit_button');
    const form = page.locator('#transaction_form_container');
    const feedback = page.locator('#investment_import_feedback');
    await expect(status).toContainText('Parsing credit-card activity');
    await expect(progress).toHaveCSS('backdrop-filter', /blur\(/);
    await expect(spinner).toBeVisible();
    await expect(spinner).toHaveCSS('animation-name', 'ticker-suggestion-loading');
    await page.emulateMedia({reducedMotion: 'reduce'});
    await expect(spinner).toHaveCSS('animation-name', 'none');
    await page.emulateMedia({reducedMotion: 'no-preference'});
    await expect(note).toHaveText(await status.textContent());
    await expect(icon).toHaveClass(/suggestion-loading-spinner/);
    await expect(submit).toBeDisabled();
    await expect(page.locator('#hsbc_credit_card_results')).toBeHidden();
    releasePreview();
    await expect(status).toContainText('Preview ready. No transaction changes.');
    await expect(spinner).toBeHidden();
    await expect(progress).toHaveCSS('backdrop-filter', 'none');
    await expect(status).toContainText('4 already saved.');
    await expect(status).toContainText('Select Import now to save the capture.');
    await expect(page.locator('#hsbc_credit_card_results')).toBeHidden();
    await expect(page.locator('#hsbc_credit_card_rows tr')).toHaveCount(0);
    await expect(note).toHaveText(await status.textContent());
    await expect(icon).not.toHaveClass(/suggestion-loading-spinner/);
    await expect(submit).toBeEnabled();
    await expect(feedback).toBeHidden();
    expect(imports).toEqual([]);
    await submit.click();
    await importArrived;
    await expect(status).toContainText('Importing credit-card activity');
    await expect(note).toHaveText(await status.textContent());
    await expect(icon).toHaveClass(/suggestion-loading-spinner/);
    await expect(submit).toBeDisabled();
    await expect(feedback).toBeHidden();
    releaseImport();
    await expect(form).toBeHidden();
    await expect(feedback).toBeVisible();
    await expect(feedback.locator('.notice-floating-banner-heading')).toHaveText('HSBC credit-card import complete');
    await expect(feedback.locator('.notice-floating-banner-copy')).toHaveText(
        '0 added, 0 updated, 4 duplicates. Entries were read back from the credit-card ledger.',
    );
    await feedback.hover();
    await feedback.getByRole('button', {name: 'Dismiss import feedback'}).click();
    await expect(feedback).toBeHidden();
    await page.locator('#toggle_form_button').click();
    await expect(status).toContainText('Credit-card import saved.');
    await expect(status).toContainText('0 added, 0 updated, 4 duplicates.');
    await expect(note).toHaveText(await status.textContent());
    await expect(display).toHaveValue(/Imported/);
    await expect(display).not.toHaveValue(/Check preview/);
    await expect(icon).not.toHaveClass(/suggestion-loading-spinner/);
    await expect(submit).toBeDisabled();
    await expect(page.locator('#hsbc_credit_card_caption')).toHaveText('Saved transactions');
    await expect(page.locator('#hsbc_credit_card_rows tr')).toHaveCount(4);
    expect(previews).toBe(1);
    expect(imports).toEqual([{text: completeCardPage, source_sha256: 'a'.repeat(64)}]);
    expect(calls).toEqual({cash: 0, card: 0, preview: 0});
    expect(writes).toEqual([]);
});

for (const width of [1280, 390]) {
    test(`shared account preview classifies safely from stock details at width ${width}`, async ({page}, testInfo) => {
        const calls = await guardRoutingRequests(page);
        let previews = 0;
        await page.route('**/api/credit-cards/hsbc/preview', (route) => {
            previews += 1;
            expect(route.request().postDataJSON()).toEqual({text: completeCardPage});
            const result = parsedCard();
            result.preview_transactions = result.transactions.slice(1);
            Object.assign(result.summary, {added_count: 3, duplicate_count: 1});
            return route.fulfill({json: result});
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
        await expect(page.locator('#hsbc_credit_card_caption')).toHaveText('Transaction changes');
        await expect(page.locator('#hsbc_credit_card_rows tr')).toHaveCount(3);
        await expect(page.locator('#hsbc_credit_card_rows')).not.toContainText('Repayment');
        await expect(page.locator('#hsbc_credit_card_rows tr').nth(0)).toContainText('Pending');
        await expect(page.locator('#hsbc_credit_card_rows tr').nth(1)).toContainText('RewardCash');
        await expect(page.locator('#hsbc_credit_card_rows tr').nth(2)).toContainText('Purchase');
        await expect(page.locator('#hsbc_credit_card_rows img')).toHaveCount(0);
        await expect(page.locator('#hsbc_credit_card_status')).toContainText('1 already saved.');
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
        result.committed = true;
        result.merged_transactions = result.transactions.map((row) => ({...row, status: 'posted'}));
        return route.fulfill({json: result});
    });
    const initialTransactions = page.waitForResponse((response) => (
        new URL(response.url()).pathname === '/api/investment/transactions'
        && response.request().method() === 'GET'
    ));
    await openAccountImport(page);
    await initialTransactions;
    await page.evaluate(() => {
        document.getElementById('hsbc_portfolio_text').value = 'Existing Portfolio draft';
        document.getElementById('hsbc_order_status_text').value = 'Existing Order Status draft';
    });
    await pasteAccountClipboard(page, completeCardPage);
    await expect(page.locator('#investment_import_submit_button')).toBeEnabled();
    expect(calls).toEqual([]);
    const requestsBeforeImport = [...investmentRequests];
    await page.locator('#investment_import_submit_button').click();
    await expect(page.locator('#transaction_form_container')).toBeHidden();
    await page.locator('#toggle_form_button').click();
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
        if (previews === 1) {
            return route.fulfill({status: 400, json: {success: false, error: 'The captured card date needs review.'}});
        }
        const result = parsedCard();
        result.transactions[3] = {transaction_date: '2026-10-12', card_last4: '6789', description: 'RETURN: SAMPLE REBATE Rebate HK', kind: 'rebate', status: 'posted', currency: 'HKD', amount: '10.82'};
        return route.fulfill({json: result});
    });
    await openAccountImport(page);
    await pasteAccountClipboard(page, completeCardPage);
    await expect(page.locator('#hsbc_credit_card_status')).toContainText('The captured card date needs review.');
    await expect(page.locator('#hsbc_credit_card_progress .suggestion-loading-spinner')).toBeHidden();
    await expect(page.locator('#hsbc_credit_card_results')).toBeHidden();
    await expect(page.locator('#investment_import_submit_button')).toBeDisabled();
    expect(previews).toBe(1);
    await pasteAccountClipboard(page, completeCardPage);
    await expect(page.locator('#hsbc_credit_card_rows tr')).toHaveCount(4);
    await expect(page.locator('#hsbc_credit_card_rows tr').last().locator('td').nth(3)).toHaveText('Rebate');
    await expect(page.locator('#investment_import_submit_button')).toBeEnabled();
    expect(previews).toBe(2);
    expect(calls).toEqual({cash: 0, card: 0, preview: 0});
});

for (const [width, height] of [[827, 1189], [390, 844]]) {
    test(`HSBC Statements shows the complete PDF field label at ${width}x${height}`, async ({page}) => {
        await openAccountImport(page, width, '/trade/investment?view=holdings', height);
        await page.locator('label[for="hsbc_import_mode_statement_pdf"]').click();

        const input = page.locator('#hsbc_statement_pdfs');
        const label = page.locator('label[for="hsbc_statement_pdfs"] .investment-import-label-text');
        await expect(input).toBeVisible();
        await expect(label).toHaveText('HSBC statement PDFs');
        await expect(page.locator('#investment_import_note')).toContainText('For credit-card activity, paste the account page in Copy/paste.');
        const geometry = await label.evaluate((element) => {
            const range = document.createRange();
            range.selectNodeContents(element);
            const fragments = [...range.getClientRects()];
            const bounds = element.getBoundingClientRect();
            return {
                lines: fragments.length,
                fullyVisible: fragments.every((rect) => rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1),
            };
        });
        expect(geometry).toEqual({lines: 1, fullyVisible: true});
        const inputBounds = await input.boundingBox();
        const labelBounds = await label.boundingBox();
        expect(Math.abs(inputBounds.x - labelBounds.x)).toBeLessThanOrEqual(1);
    });
}

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
            await page.locator('#investment_import_broker').selectOption('schwab', {force: true});
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
        await route.fulfill({json: {
            ...validCash(),
            preview: {
                transactions: [],
                balances: [{account_type: 'CURRENT', currency: 'HKD', amount: '1250'}],
                positions: [],
                warnings: [],
            },
        }}).catch(() => {});
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
    await expect(page.locator('#hsbc_credit_card_status')).toContainText('Parsing credit-card activity');
    await expect(page.locator('#hsbc_cash_account_display')).not.toHaveValue(/Checking/);
    await expect(page.locator('#investment_import_submit_button')).toBeDisabled();
    await expect(page.locator('#hsbc_credit_card_results')).toBeHidden();
    await expect(page.locator('#hsbc_paste_preview')).toBeHidden();
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
