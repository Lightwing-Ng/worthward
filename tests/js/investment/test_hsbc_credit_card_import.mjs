/* Code version: v1.2.0 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createInvestmentImportWorkflowRuntime} from '../../../app/web/static/assets/js/investment/runtime/import-workflows.js';
import {
    createHsbcCreditCardImportRuntime,
    classifyHsbcCreditCardPaste,
    formatCreditCardAmount,
    formatCreditCardDate,
} from '../../../app/web/static/assets/js/investment/runtime/credit-card-import.js';

const CHUNK_MARKER = '===== HSBC PASTE CHUNK =====';
const cardPage = `Banking Card, loan & mortgage
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
const cashPage = `Card, loan & mortgage
Selected account's details
HSBC HKD Savings
Account number:
000-123456-789
Available balance:
1,250.00 HKD
Transactions`;
const joinChunks = (...chunks) => chunks.join(`\n\n${CHUNK_MARKER}\n\n`);

class Element {
    constructor() { this.value = ''; this.children = []; this.handlers = {}; this.hidden = true; this.dataset = {}; }
    addEventListener(event, callback) { this.handlers[event] = callback; }
    dispatchEvent(event) { this.handlers[event.type]?.(event); }
    appendChild(child) { this.children.push(child); }
    replaceChildren() { this.children = []; }
}
const fixture = () => ({
    success: true, ready: true, source_sha256: 'a'.repeat(64),
    account: {last4: '6789', name: 'HSBC Red Credit Card', currency: 'HKD'},
    snapshot: {account_balance: '4850.50', current_amount_due: '0', minimum_payment: '0', payment_due_date: '2026-11-06', rewardcash_balance: '0'},
    transactions: [{transaction_date: '2026-10-12', card_last4: '6789', description: '<img src=x onerror=alert(1)>', kind: 'purchase', status: 'pending', amount: '2450', currency: 'HKD'}],
    summary: {posted_purchase_count: 0, posted_purchase_total: '0', repayment_count: 0, repayment_total: '0', rewardcash_count: 0, rewardcash_total: '0', pending_count: 1, pending_total: '2450', added_count: 1, promoted_count: 0, duplicate_count: 0},
    warnings: [],
});
const response = (value) => ({ok: true, json: async () => value});
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return {promise, resolve}; };

function setup(t, fetcher = async () => response(fixture())) {
    const elements = new Map();
    const documentBefore = globalThis.document;
    const fetchBefore = globalThis.fetch;
    globalThis.document = {
        getElementById: (id) => {
            if (!elements.has(id)) elements.set(id, new Element());
            return elements.get(id);
        },
        createElement: () => new Element(),
    };
    globalThis.fetch = fetcher;
    t.after(() => { globalThis.document = documentBefore; globalThis.fetch = fetchBefore; });
    const runtime = {
        state: {investmentImportSession: {state: 'ready'}, investmentImportInFlight: false, hsbcPasteValidation: {state: 'idle', ready: false, fieldStatus: {}}},
        mode: 'paste', broker: 'hsbc', HSBC_PASTE_CHUNK_MARKER: CHUNK_MARKER,
        hsbcCashAccountTextInput: document.getElementById('hsbc_cash_account_text'),
        hsbcPortfolioTextInput: document.getElementById('hsbc_portfolio_text'),
        hsbcOrderStatusTextInput: document.getElementById('hsbc_order_status_text'),
        getSelectedInvestmentImportBroker() { return this.broker; },
        getSelectedHsbcImportMode() { return this.mode; },
        ensureInvestmentImportSession: async () => true,
        describeInvestmentImportSessionFailure: () => 'Session unavailable.',
        buildInvestmentRequestOptions: (options) => ({...options, headers: {...options.headers, 'X-CSRF-Token': 'test-token'}}),
        syncImportValidationState: () => {},
        syncHsbcPasteDisplaySummaries: () => {},
        resetHsbcPasteValidation() { this.state.hsbcPasteValidation = {state: 'idle', ready: false, fieldStatus: {}}; },
        setImportFeedback(message) { this.feedback = message; },
    };
    const workflows = createInvestmentImportWorkflowRuntime(runtime);
    for (const key of ['splitHsbcPastedTextChunks', 'mergeHsbcPastedText', 'getHsbcPasteTexts', 'getHsbcPasteValidationSignature']) {
        runtime[key] = workflows[key];
    }
    runtime.hsbcCashAccountTextInput.value = cardPage;
    Object.assign(runtime, createHsbcCreditCardImportRuntime(runtime));
    runtime.syncHsbcCreditCardInput();
    return {runtime, elements};
}

function changeInput(runtime, text) {
    runtime.hsbcCashAccountTextInput.value = text;
    runtime.invalidateHsbcCreditCardPreview();
    runtime.syncHsbcCreditCardInput();
}

function appendInput(runtime, text) {
    const merged = runtime.mergeHsbcPastedText(runtime.hsbcCashAccountTextInput.value, text);
    changeInput(runtime, merged.mergedText);
    return merged;
}

test('formats dates, amounts, and unavailable values without coercing missing data to zero', () => {
    assert.equal(formatCreditCardDate('2026-11-06'), '6 Nov 2026');
    assert.equal(formatCreditCardAmount('4850.50', 'HKD'), 'HKD 4,850.50');
    assert.equal(formatCreditCardAmount(null, 'HKD'), 'Unavailable');
    assert.equal(formatCreditCardDate(''), 'Unavailable');
});

test('preview uses the shared account text and safely renders only after a manual request', async (t) => {
    const requests = [];
    const {runtime, elements} = setup(t, async (url, options) => { requests.push({url, options}); return response(fixture()); });
    assert.equal(runtime.mode, 'paste');
    assert.equal(runtime.isHsbcCreditCardInput(), true);
    assert.equal(runtime.isHsbcCreditCardReady(), false);
    assert.equal(requests.length, 0);
    await runtime.previewHsbcCreditCard();
    assert.equal(runtime.isHsbcCreditCardReady(), true);
    assert.equal(requests[0].url, '/api/credit-cards/hsbc/preview');
    assert.deepEqual(JSON.parse(requests[0].options.body), {text: cardPage});
    assert.equal(requests[0].options.headers['X-CSRF-Token'], 'test-token');
    const cells = elements.get('hsbc_credit_card_rows').children[0].children;
    assert.equal(cells[2].textContent, '<img src=x onerror=alert(1)>');
    assert.equal(cells[2].children.length, 0);
    assert.equal(cells[4].textContent, 'Pending');
    assert.equal(cells[5].textContent, 'HKD 2,450.00');
    assert.match(elements.get('hsbc_credit_card_status').textContent, /Nothing has been saved/);
});

for (const [label, replacement] of [
    ['changed card', cardPage.replace('4,850.50', '4,000.00')],
    ['cash page', cashPage],
    ['mixed account batch', joinChunks(cardPage, cashPage)],
    ['empty input', ''],
]) {
    test(`a pending preview cannot authorize ${label}`, async (t) => {
        const pending = deferred();
        const {runtime, elements} = setup(t, () => pending.promise);
        const preview = runtime.previewHsbcCreditCard();
        await Promise.resolve();
        changeInput(runtime, replacement);
        pending.resolve(response(fixture()));
        await preview;
        assert.equal(runtime.isHsbcCreditCardReady(), false);
        assert.equal(elements.get('hsbc_credit_card_results').hidden, true);
    });
}

for (const dimension of ['mode', 'broker']) {
    test(`a ${dimension} round trip invalidates a pending preview even with unchanged text`, async (t) => {
        const pending = deferred();
        const {runtime, elements} = setup(t, () => pending.promise);
        const preview = runtime.previewHsbcCreditCard();
        await Promise.resolve();
        const initial = runtime[dimension];
        runtime[dimension] = dimension === 'mode' ? 'statement_pdf' : 'ibkr';
        runtime.invalidateHsbcCreditCardPreview();
        runtime[dimension] = initial;
        runtime.invalidateHsbcCreditCardPreview();
        pending.resolve(response(fixture()));
        await preview;
        assert.equal(runtime.isHsbcCreditCardReady(), false);
        assert.equal(elements.get('hsbc_credit_card_results').hidden, true);
    });
}

test('saved readback cannot authorize an import', async (t) => {
    const {runtime, elements} = setup(t, async () => response({...fixture(), accounts: [{...fixture().account, snapshot: fixture().snapshot}]}));
    await runtime.previewHsbcCreditCard();
    assert.equal(runtime.isHsbcCreditCardReady(), true);
    await runtime.viewSavedHsbcCreditCards();
    assert.equal(runtime.isHsbcCreditCardReady(), false);
    assert.match(elements.get('hsbc_credit_card_status').textContent, /Saved credit-card activity/);
});

test('commit sends only shared card text and its preview digest once while retaining security drafts', async (t) => {
    const requests = [];
    const {runtime, elements} = setup(t, async (url, options) => { requests.push({url, options}); return response(fixture()); });
    runtime.hsbcPortfolioTextInput.value = 'Existing Portfolio';
    runtime.hsbcOrderStatusTextInput.value = 'Existing Order Status';
    await runtime.previewHsbcCreditCard();
    await runtime.importHsbcCreditCard();
    await runtime.importHsbcCreditCard();
    assert.deepEqual(requests.map(({url}) => url), ['/api/credit-cards/hsbc/preview', '/api/credit-cards/hsbc/import']);
    assert.deepEqual(JSON.parse(requests[1].options.body), {text: cardPage, source_sha256: 'a'.repeat(64)});
    assert.equal(runtime.hsbcCashAccountTextInput.value, cardPage);
    assert.equal(runtime.hsbcPortfolioTextInput.value, 'Existing Portfolio');
    assert.equal(runtime.hsbcOrderStatusTextInput.value, 'Existing Order Status');
    assert.equal(runtime.state.investmentImportInFlight, false);
    assert.equal(runtime.isHsbcCreditCardReady(), false);
    assert.equal(elements.get('hsbc_credit_card_results').hidden, false);
    assert.match(elements.get('hsbc_credit_card_status').textContent, /read back/);
});

test('changing shared input during session refresh prevents a captured commit', async (t) => {
    const urls = [];
    const {runtime} = setup(t, async (url) => { urls.push(url); return response(fixture()); });
    await runtime.previewHsbcCreditCard();
    const session = deferred();
    runtime.ensureInvestmentImportSession = () => session.promise;
    const commit = runtime.importHsbcCreditCard();
    changeInput(runtime, joinChunks(cardPage, cashPage));
    session.resolve(true);
    await commit;
    assert.deepEqual(urls, ['/api/credit-cards/hsbc/preview']);
    assert.equal(runtime.state.investmentImportInFlight, false);
});

test('an uncertain failed commit requires a fresh preview before retry', async (t) => {
    let requests = 0;
    const {runtime, elements} = setup(t, async () => {
        requests += 1;
        if (requests > 1) throw new Error('Connection interrupted');
        return response(fixture());
    });
    await runtime.previewHsbcCreditCard();
    await runtime.importHsbcCreditCard();
    await runtime.importHsbcCreditCard();
    assert.equal(requests, 2);
    assert.equal(runtime.isHsbcCreditCardReady(), false);
    assert.match(elements.get('hsbc_credit_card_status').textContent, /Preview again/);
});

test('classification distinguishes complete cards, card clues, and ordinary navigation', () => {
    assert.equal(classifyHsbcCreditCardPaste(cardPage), 'credit_card');
    assert.equal(classifyHsbcCreditCardPaste(cashPage), 'none');
    assert.equal(classifyHsbcCreditCardPaste(`${cashPage}\nHSBC Red Credit Card offers`), 'none');
    assert.equal(classifyHsbcCreditCardPaste(cardPage.replace('Payment due date:', 'See payment details:')), 'incomplete');
    assert.equal(classifyHsbcCreditCardPaste('HSBC Red Credit Card'), 'incomplete');
    assert.equal(classifyHsbcCreditCardPaste('RewardCash balance:\n0\nCurrent amount due:\n0 HKD'), 'incomplete');
    assert.equal(classifyHsbcCreditCardPaste('Card, loan & mortgage\nCredit cards'), 'none');
});

test('multiple cash clips remain in the existing cash workflow', (t) => {
    const {runtime} = setup(t);
    changeInput(runtime, cashPage);
    const otherCash = cashPage.replace('HKD Savings', 'USD Savings');
    appendInput(runtime, otherCash);
    assert.equal(runtime.getHsbcCreditCardInputKind(), 'none');
    assert.equal(runtime.isHsbcCreditCardInput(), false);
    assert.equal(runtime.hsbcCashAccountTextInput.value, joinChunks(cashPage, otherCash));
});

test('a repeated card clip is deduplicated in the shared source without automatic preview', (t) => {
    const {runtime} = setup(t, () => { throw new Error('Detection must not send a request'); });
    const merged = appendInput(runtime, cardPage);
    assert.equal(merged.duplicate, true);
    assert.equal(merged.addedChunkCount, 0);
    assert.equal(runtime.hsbcCashAccountTextInput.value, cardPage);
    assert.equal(runtime.getHsbcCreditCardInputKind(), 'credit_card');
    assert.equal(runtime.mode, 'paste');
    assert.equal(runtime.isHsbcCreditCardReady(), false);
});

for (const [label, first, next] of [
    ['cash then card', cashPage, cardPage],
    ['card then cash', cardPage, cashPage],
    ['two distinct cards', cardPage, cardPage.replaceAll('6789', '9876')],
    ['unknown clip after card', cardPage, 'Unrecognized account capture'],
    ['unknown clip before card', 'Unrecognized account capture', cardPage],
]) {
    test(`${label} preserves every clip and blocks both preview and import`, async (t) => {
        const {runtime, elements} = setup(t, () => { throw new Error('Mixed input must not send a request'); });
        changeInput(runtime, first);
        appendInput(runtime, next);
        assert.equal(runtime.hsbcCashAccountTextInput.value, joinChunks(first, next));
        assert.equal(runtime.getHsbcCreditCardInputKind(), 'mixed');
        assert.equal(runtime.isHsbcCreditCardInput(), true);
        assert.equal(runtime.isHsbcCreditCardReady(), false);
        assert.equal(elements.get('hsbc_credit_card_preview_button').disabled, true);
        await runtime.previewHsbcCreditCard();
        await runtime.importHsbcCreditCard();
    });
}

test('incomplete card input is preserved without falling back to cash or allowing preview', async (t) => {
    const {runtime, elements} = setup(t, () => { throw new Error('Incomplete card must not send a request'); });
    const incomplete = cardPage.replace('Payment due date:', 'See payment details:');
    changeInput(runtime, incomplete);
    assert.equal(runtime.hsbcCashAccountTextInput.value, incomplete);
    assert.equal(runtime.getHsbcCreditCardInputKind(), 'incomplete');
    assert.equal(runtime.isHsbcCreditCardInput(), true);
    assert.equal(elements.get('hsbc_credit_card_preview_button').disabled, true);
    await runtime.previewHsbcCreditCard();
    await runtime.importHsbcCreditCard();
    assert.equal(runtime.isHsbcCreditCardReady(), false);
});

test('shared card detection is inactive outside HSBC Copy/paste', (t) => {
    const {runtime} = setup(t);
    runtime.broker = 'ibkr';
    assert.equal(runtime.isHsbcCreditCardInput(), false);
    runtime.broker = 'hsbc';
    runtime.mode = 'statement_pdf';
    assert.equal(runtime.isHsbcCreditCardInput(), false);
    runtime.mode = 'paste';
    assert.equal(runtime.isHsbcCreditCardInput(), true);
});
