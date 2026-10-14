/* Code version: v1.3.0 */
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
const settle = () => new Promise(setImmediate);

function setup(t, fetcher = async () => response(fixture()), initialText = cardPage) {
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
    runtime.hsbcCashAccountTextInput.value = initialText;
    Object.assign(runtime, createHsbcCreditCardImportRuntime(runtime));
    runtime.syncHsbcCreditCardInput();
    return {runtime, elements};
}

function changeInput(runtime, text) {
    runtime.hsbcCashAccountTextInput.value = text;
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

test('complete shared account text previews automatically without an import request', async (t) => {
    const requests = [];
    const {runtime, elements} = setup(t, async (url, options) => { requests.push({url, options}); return response(fixture()); });
    assert.equal(runtime.mode, 'paste');
    assert.equal(runtime.isHsbcCreditCardInput(), true);
    assert.equal(runtime.isHsbcCreditCardReady(), false);
    await settle();
    assert.equal(runtime.isHsbcCreditCardReady(), true);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, '/api/credit-cards/hsbc/preview');
    assert.deepEqual(JSON.parse(requests[0].options.body), {text: cardPage});
    assert.equal(requests[0].options.headers['X-CSRF-Token'], 'test-token');
    const cells = elements.get('hsbc_credit_card_rows').children[0].children;
    assert.equal(cells[2].textContent, '<img src=x onerror=alert(1)>');
    assert.equal(cells[2].children.length, 0);
    assert.equal(cells[4].textContent, 'Pending');
    assert.equal(cells[5].textContent, 'HKD 2,450.00');
    assert.match(elements.get('hsbc_credit_card_status').textContent, /Nothing has been saved/);
    for (const removedId of ['hsbc_credit_card_preview_button', 'hsbc_credit_card_saved_button', 'hsbc_credit_card_summary']) {
        assert.equal(elements.has(removedId), false);
    }
});

for (const [label, replacement] of [
    ['cash page', cashPage],
    ['mixed account batch', joinChunks(cardPage, cashPage)],
    ['empty input', ''],
]) {
    test(`a pending preview cannot authorize ${label}`, async (t) => {
        const pending = deferred();
        const requests = [];
        const {runtime, elements} = setup(t, (url) => { requests.push(url); return pending.promise; });
        await settle();
        changeInput(runtime, replacement);
        pending.resolve(response(fixture()));
        await settle();
        assert.equal(runtime.isHsbcCreditCardReady(), false);
        assert.equal(elements.get('hsbc_credit_card_results').hidden, true);
        assert.equal(requests.length, 1);
    });
}

test('changing complete text while busy previews only the latest input after discarding the old response', async (t) => {
    const first = deferred();
    const latest = deferred();
    const requests = [];
    const {runtime, elements} = setup(t, (url, options) => {
        requests.push({url, text: JSON.parse(options.body).text});
        return requests.length === 1 ? first.promise : latest.promise;
    });
    await settle();
    changeInput(runtime, cardPage.replace('4,850.50', '4,000.00'));
    const finalText = cardPage.replace('4,850.50', '3,000.00');
    changeInput(runtime, finalText);
    assert.equal(requests.length, 1);
    first.resolve(response(fixture()));
    await settle();
    assert.equal(runtime.isHsbcCreditCardReady(), false);
    assert.equal(elements.get('hsbc_credit_card_results').hidden, true);
    assert.deepEqual(requests.map(({text}) => text), [cardPage, finalText]);
    latest.resolve(response({...fixture(), source_sha256: 'b'.repeat(64)}));
    await settle();
    assert.equal(runtime.isHsbcCreditCardReady(), true);
    assert.equal(requests.every(({url}) => url.endsWith('/preview')), true);
});

for (const dimension of ['mode', 'broker']) {
    test(`a ${dimension} round trip rejects the old response and automatically previews again`, async (t) => {
        const first = deferred();
        const fresh = deferred();
        let requests = 0;
        const {runtime, elements} = setup(t, () => (++requests === 1 ? first.promise : fresh.promise));
        await settle();
        const initial = runtime[dimension];
        runtime[dimension] = dimension === 'mode' ? 'statement_pdf' : 'ibkr';
        runtime.invalidateHsbcCreditCardPreview();
        runtime.syncHsbcCreditCardInput();
        runtime[dimension] = initial;
        runtime.invalidateHsbcCreditCardPreview();
        runtime.syncHsbcCreditCardInput();
        first.resolve(response(fixture()));
        await settle();
        assert.equal(requests, 2);
        assert.equal(runtime.isHsbcCreditCardReady(), false);
        assert.equal(elements.get('hsbc_credit_card_results').hidden, true);
        fresh.resolve(response(fixture()));
        await settle();
        assert.equal(runtime.isHsbcCreditCardReady(), true);
    });
}

test('review warnings remain visible and block importing after the summary is removed', async (t) => {
    const warning = 'Matching pending and posted purchases need original statement review.';
    const urls = [];
    const {runtime, elements} = setup(t, async (url) => {
        urls.push(url);
        return response({...fixture(), ready: false, review_required: true, warnings: [warning]});
    });
    await settle();
    assert.equal(runtime.isHsbcCreditCardReady(), false);
    assert.equal(elements.get('hsbc_credit_card_results').hidden, false);
    assert.match(elements.get('hsbc_credit_card_status').textContent, /Preview needs review/);
    assert.equal(elements.get('hsbc_credit_card_status').textContent.includes(warning), true);
    await runtime.importHsbcCreditCard();
    assert.deepEqual(urls, ['/api/credit-cards/hsbc/preview']);
});

test('a failed preview retries once on an explicit identical re-paste but never on routine sync', async (t) => {
    let requests = 0;
    const {runtime, elements} = setup(t, async () => {
        requests += 1;
        if (requests < 3) throw new Error('Connection interrupted');
        return response(fixture());
    });
    await settle();
    for (let index = 0; index < 3; index += 1) runtime.syncHsbcCreditCardInput();
    await settle();
    assert.equal(requests, 1);
    assert.match(elements.get('hsbc_credit_card_status').textContent, /Paste the page again to retry/);
    runtime.syncHsbcCreditCardInput({retry: true});
    await settle();
    runtime.syncHsbcCreditCardInput();
    await settle();
    assert.equal(requests, 2);
    runtime.syncHsbcCreditCardInput({retry: true});
    await settle();
    assert.equal(requests, 3);
    assert.equal(runtime.isHsbcCreditCardReady(), true);
});

test('commit sends shared card text and digest once, then displays persisted rows and retains drafts', async (t) => {
    const requests = [];
    const savedRow = {...fixture().transactions[0], description: 'Persisted purchase', status: 'posted'};
    const {runtime, elements} = setup(t, async (url, options) => {
        requests.push({url, options});
        return response({...fixture(), merged_transactions: [savedRow]});
    });
    runtime.hsbcPortfolioTextInput.value = 'Existing Portfolio';
    runtime.hsbcOrderStatusTextInput.value = 'Existing Order Status';
    await settle();
    await runtime.importHsbcCreditCard();
    runtime.syncHsbcCreditCardInput();
    await runtime.importHsbcCreditCard();
    await settle();
    assert.deepEqual(requests.map(({url}) => url), ['/api/credit-cards/hsbc/preview', '/api/credit-cards/hsbc/import']);
    assert.deepEqual(JSON.parse(requests[1].options.body), {text: cardPage, source_sha256: 'a'.repeat(64)});
    assert.equal(runtime.hsbcCashAccountTextInput.value, cardPage);
    assert.equal(runtime.hsbcPortfolioTextInput.value, 'Existing Portfolio');
    assert.equal(runtime.hsbcOrderStatusTextInput.value, 'Existing Order Status');
    assert.equal(runtime.state.investmentImportInFlight, false);
    assert.equal(runtime.isHsbcCreditCardReady(), false);
    assert.equal(elements.get('hsbc_credit_card_results').hidden, false);
    assert.equal(elements.get('hsbc_credit_card_rows').children[0].children[2].textContent, 'Persisted purchase');
    assert.match(elements.get('hsbc_credit_card_status').textContent, /read back/);
});

test('changing shared input during session refresh prevents a captured commit', async (t) => {
    const urls = [];
    const {runtime} = setup(t, async (url) => { urls.push(url); return response(fixture()); });
    await settle();
    const session = deferred();
    runtime.ensureInvestmentImportSession = () => session.promise;
    const commit = runtime.importHsbcCreditCard();
    changeInput(runtime, joinChunks(cardPage, cashPage));
    session.resolve(true);
    await commit;
    assert.deepEqual(urls, ['/api/credit-cards/hsbc/preview']);
    assert.equal(runtime.state.investmentImportInFlight, false);
});

test('new card text entered during a commit previews afterward without another write', async (t) => {
    const commitResponse = deferred();
    const urls = [];
    const {runtime, elements} = setup(t, async (url) => {
        urls.push(url);
        return url.endsWith('/import') ? commitResponse.promise : response(fixture());
    });
    await settle();
    const commit = runtime.importHsbcCreditCard();
    await settle();
    changeInput(runtime, cardPage.replace('4,850.50', '4,000.00'));
    commitResponse.resolve(response({...fixture(), merged_transactions: []}));
    await commit;
    await settle();
    assert.deepEqual(urls, ['/api/credit-cards/hsbc/preview', '/api/credit-cards/hsbc/import', '/api/credit-cards/hsbc/preview']);
    assert.equal(runtime.isHsbcCreditCardReady(), true);
    assert.match(elements.get('hsbc_credit_card_status').textContent, /Nothing has been saved/);
    assert.equal(elements.get('hsbc_credit_card_rows').children.length, 1);
});

test('an uncertain failed commit needs an explicit re-paste and fresh preview before retry', async (t) => {
    const urls = [];
    const {runtime, elements} = setup(t, async (url) => {
        urls.push(url);
        if (url.endsWith('/import')) throw new Error('Connection interrupted');
        return response(fixture());
    });
    await settle();
    await runtime.importHsbcCreditCard();
    runtime.syncHsbcCreditCardInput();
    await runtime.importHsbcCreditCard();
    await settle();
    assert.equal(urls.length, 2);
    assert.equal(runtime.isHsbcCreditCardReady(), false);
    assert.match(elements.get('hsbc_credit_card_status').textContent, /Paste the page again to preview/);
    runtime.syncHsbcCreditCardInput({retry: true});
    await settle();
    assert.equal(runtime.isHsbcCreditCardReady(), true);
    assert.deepEqual(urls, ['/api/credit-cards/hsbc/preview', '/api/credit-cards/hsbc/import', '/api/credit-cards/hsbc/preview']);
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
    const {runtime} = setup(t, undefined, cashPage);
    const otherCash = cashPage.replace('HKD Savings', 'USD Savings');
    appendInput(runtime, otherCash);
    assert.equal(runtime.getHsbcCreditCardInputKind(), 'none');
    assert.equal(runtime.isHsbcCreditCardInput(), false);
    assert.equal(runtime.hsbcCashAccountTextInput.value, joinChunks(cashPage, otherCash));
});

test('a repeated card clip is deduplicated without another preview or import', async (t) => {
    const urls = [];
    const {runtime} = setup(t, async (url) => { urls.push(url); return response(fixture()); });
    await settle();
    const merged = appendInput(runtime, cardPage);
    runtime.syncHsbcCreditCardInput({retry: true});
    await settle();
    assert.equal(merged.duplicate, true);
    assert.equal(merged.addedChunkCount, 0);
    assert.equal(runtime.hsbcCashAccountTextInput.value, cardPage);
    assert.equal(runtime.getHsbcCreditCardInputKind(), 'credit_card');
    assert.equal(runtime.isHsbcCreditCardReady(), true);
    assert.deepEqual(urls, ['/api/credit-cards/hsbc/preview']);
});

for (const [label, first, next] of [
    ['cash then card', cashPage, cardPage],
    ['card then cash', cardPage, cashPage],
    ['two distinct cards', cardPage, cardPage.replaceAll('6789', '9876')],
    ['unknown clip after card', cardPage, 'Unrecognized account capture'],
    ['unknown clip before card', 'Unrecognized account capture', cardPage],
]) {
    test(`${label} preserves every clip and blocks both preview and import`, async (t) => {
        const urls = [];
        const mixedText = joinChunks(first, next);
        const {runtime} = setup(t, async (url) => { urls.push(url); return response(fixture()); }, mixedText);
        assert.equal(runtime.hsbcCashAccountTextInput.value, joinChunks(first, next));
        assert.equal(runtime.getHsbcCreditCardInputKind(), 'mixed');
        assert.equal(runtime.isHsbcCreditCardInput(), true);
        assert.equal(runtime.isHsbcCreditCardReady(), false);
        await runtime.importHsbcCreditCard();
        await settle();
        assert.deepEqual(urls, []);
    });
}

test('incomplete card input is preserved without falling back to cash or allowing preview', async (t) => {
    const urls = [];
    const incomplete = cardPage.replace('Payment due date:', 'See payment details:');
    const {runtime} = setup(t, async (url) => { urls.push(url); return response(fixture()); }, incomplete);
    assert.equal(runtime.hsbcCashAccountTextInput.value, incomplete);
    assert.equal(runtime.getHsbcCreditCardInputKind(), 'incomplete');
    assert.equal(runtime.isHsbcCreditCardInput(), true);
    await runtime.importHsbcCreditCard();
    await settle();
    assert.equal(runtime.isHsbcCreditCardReady(), false);
    assert.deepEqual(urls, []);
});

test('shared card detection is inactive outside HSBC Copy/paste', (t) => {
    const {runtime} = setup(t, undefined, '');
    runtime.hsbcCashAccountTextInput.value = cardPage;
    runtime.broker = 'ibkr';
    assert.equal(runtime.isHsbcCreditCardInput(), false);
    runtime.broker = 'hsbc';
    runtime.mode = 'statement_pdf';
    assert.equal(runtime.isHsbcCreditCardInput(), false);
    runtime.mode = 'paste';
    assert.equal(runtime.isHsbcCreditCardInput(), true);
});
