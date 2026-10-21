/**
 * HSBC credit-card automatic preview, isolated import, and ledger readback.
 * Code version: v1.3.0
 * - Added: Successful card imports refresh the Metrics rewards disclosure.
 * - Changed: Complete account-page pastes preview automatically before explicit import.
 */

const KIND_LABELS = Object.freeze({purchase: 'Purchase', repayment: 'Repayment', rewardcash: 'RewardCash'});

export function classifyHsbcCreditCardPaste(rawText) {
    const text = String(rawText || '').replace(/\r\n?/g, '\n').trim();
    const titles = text.match(/^\s*HSBC[^\n]+Credit Card\s*$/gim) || [];
    const cardFields = [
        'Account number', 'RewardCash balance', 'Account balance',
        'Current amount due', 'Total minimum payment amount', 'Payment due date',
    ];
    const hasField = (field) => new RegExp(`^\\s*${field}\\s*:`, 'im').test(text);
    const cardEvidence = cardFields.filter((field) => !['Account number', 'Account balance'].includes(field))
        .filter(hasField).length;
    if (!titles.length && cardEvidence < 2) {
        return 'none';
    }
    // HSBC navigation mentions cards on cash pages; routing requires the account
    // title and card-specific snapshot fields, never a generic navigation word.
    const accountFields = text.match(/^\s*Account number\s*:/gim) || [];
    if (titles.length > 1 || accountFields.length > 1
        || /^\s*Available balance\s*:?/im.test(text)
        || /^\s*=+\s*HSBC PASTE CHUNK\s*=+\s*$/im.test(text)) {
        return 'mixed';
    }
    if (titles.length !== 1 || !/^\s*Transactions\s*$/im.test(text) || !cardFields.every(hasField)) {
        return 'incomplete';
    }
    return 'credit_card';
}

export function formatCreditCardDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
    if (!match) return 'Unavailable';
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${Number(match[3])} ${months[Number(match[2]) - 1] || '?'} ${match[1]}`;
}

export function formatCreditCardAmount(value, currency = '') {
    if (value === null || value === undefined || value === '' || !Number.isFinite(Number(value))) return 'Unavailable';
    const amount = Number(value).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
    return `${currency ? `${currency} ` : ''}${amount}`;
}

export function createHsbcCreditCardImportRuntime(runtime) {
    const input = runtime.hsbcCashAccountTextInput;
    const panel = document.getElementById('hsbc_credit_card_panel');
    const status = document.getElementById('hsbc_credit_card_status');
    const results = document.getElementById('hsbc_credit_card_results');
    const rows = document.getElementById('hsbc_credit_card_rows');
    const caption = document.getElementById('hsbc_credit_card_caption');
    const state = {epoch: 0, attemptedEpoch: null, busy: false, retryable: false, text: '', result: null, observedText: ''};
    const currentText = () => String(input?.value || '').trim();
    const getHsbcCreditCardInputKind = () => classifyHsbcCreditCardPaste(currentText());
    const isHsbcCreditCardInput = () => runtime.getSelectedInvestmentImportBroker() === 'hsbc'
        && runtime.getSelectedHsbcImportMode() === 'paste' && getHsbcCreditCardInputKind() !== 'none';
    const active = () => isHsbcCreditCardInput() && getHsbcCreditCardInputKind() === 'credit_card';
    const current = (epoch, text) => state.epoch === epoch && active() && currentText() === text;
    const setStatus = (message) => {
        if (status) status.textContent = message;
        runtime.syncInvestmentImportContainerHeight?.();
    };
    const syncControls = () => {
        runtime.syncHsbcPasteDisplaySummaries?.();
        runtime.syncImportValidationState?.();
    };
    const isHsbcCreditCardReady = () => active() && !state.busy
        && state.result?.ready === true && state.result?.review_required !== true && state.text === currentText()
        && /^[a-f0-9]{64}$/i.test(String(state.result?.source_sha256 || ''));

    function invalidateHsbcCreditCardPreview() {
        state.epoch += 1;
        state.attemptedEpoch = null;
        state.retryable = false;
        state.text = '';
        state.result = null;
        if (results) results.hidden = true;
        setStatus('');
        syncControls();
    }

    function syncHsbcCreditCardInput({retry = false} = {}) {
        const changed = state.observedText !== currentText();
        if (changed) {
            state.observedText = currentText();
            invalidateHsbcCreditCardPreview();
        }
        const detected = isHsbcCreditCardInput();
        if (panel) panel.hidden = !detected;
        if (detected) {
            runtime.resetHsbcPasteValidation?.();
            const kind = getHsbcCreditCardInputKind();
            if (kind !== 'credit_card') {
                const message = kind === 'mixed'
                    ? 'The account field contains mixed or multiple credit-card pages. All pasted text has been kept. Clear it and paste one complete credit-card page at a time.'
                    : 'The credit-card page is incomplete. Copy the full account page, including balances, due date, and transactions, into the account field.';
                setStatus(message);
                runtime.setImportFeedback(message, 'warning');
            } else {
                if (retry && state.retryable && !state.busy) invalidateHsbcCreditCardPreview();
                previewHsbcCreditCard();
            }
        }
        syncControls();
        return detected;
    }

    function resultStatus(message, result) {
        return [message, ...(result.warnings || []).map(String)].join(' ');
    }

    function renderResult(result, mode = 'preview') {
        const imported = mode === 'imported';
        if (caption) caption.textContent = imported ? 'Saved transactions' : 'Captured transactions';
        rows?.replaceChildren();
        const transactions = imported ? (result.merged_transactions || result.transactions || []) : (result.transactions || []);
        transactions.forEach((transaction) => {
            const row = document.createElement('tr');
            const card = /^\d{4}$/.test(String(transaction.card_last4 || '')) ? transaction.card_last4 : 'Unavailable';
            const values = [
                formatCreditCardDate(transaction.transaction_date),
                card,
                transaction.description || '',
                KIND_LABELS[transaction.kind] || 'Unrecognized',
                transaction.status === 'pending' ? 'Pending' : 'Posted',
                formatCreditCardAmount(transaction.amount, transaction.currency),
            ];
            values.forEach((value) => {
                const cell = document.createElement('td');
                cell.textContent = value;
                row.appendChild(cell);
            });
            rows?.appendChild(row);
        });
        if (results) results.hidden = false;
        runtime.syncInvestmentImportContainerHeight?.();
    }

    async function request(path, body) {
        if (body && !await runtime.ensureInvestmentImportSession()) {
            throw new Error(runtime.describeInvestmentImportSessionFailure());
        }
        const response = await fetch(path, runtime.buildInvestmentRequestOptions({
            method: body ? 'POST' : 'GET',
            ...(body ? {headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)} : {}),
        }));
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || 'The credit-card request failed.');
        return result;
    }

    async function previewHsbcCreditCard() {
        if (!active() || state.busy || state.attemptedEpoch === state.epoch
            || runtime.state.investmentImportInFlight) return;
        state.attemptedEpoch = state.epoch;
        const epoch = state.epoch;
        const text = currentText();
        state.busy = true;
        setStatus('Previewing credit-card activity…');
        syncControls();
        try {
            const result = await request('/api/credit-cards/hsbc/preview', {text});
            if (!current(epoch, text)) return;
            state.text = text;
            state.result = result;
            renderResult(result);
            const ready = result.ready === true && result.review_required !== true;
            setStatus(resultStatus(ready ? 'Preview ready. Nothing has been saved.'
                : 'Preview needs review. Nothing has been saved.', result));
        } catch (error) {
            if (current(epoch, text)) {
                state.retryable = true;
                setStatus(`${error.message || 'Credit-card preview failed.'} Paste the page again to retry.`);
            }
        } finally {
            state.busy = false;
            syncControls();
            // Only a newer input or mode epoch may start another automatic request.
            previewHsbcCreditCard();
        }
    }

    async function importHsbcCreditCard() {
        if (!isHsbcCreditCardReady() || runtime.state.investmentImportInFlight) return;
        const epoch = state.epoch;
        const text = currentText();
        const sourceSha256 = state.result.source_sha256;
        state.busy = true;
        runtime.state.investmentImportInFlight = true;
        setStatus('Importing credit-card activity…');
        syncControls();
        try {
            if (!await runtime.ensureInvestmentImportSession()) {
                throw new Error(runtime.describeInvestmentImportSessionFailure());
            }
            // A changed input or import mode cannot authorize the captured request.
            if (!current(epoch, text)) return;
            const response = await fetch('/api/credit-cards/hsbc/import', runtime.buildInvestmentRequestOptions({
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({text, source_sha256: sourceSha256}),
            }));
            const result = await response.json();
            if (!response.ok || !result.success) throw new Error(result.error || 'Credit-card import failed.');
            if (!current(epoch, text)) return;
            if (result.credit_card_rewards && typeof result.credit_card_rewards === 'object') {
                window.WORTHWARD_INVESTMENT_DATA = {
                    ...window.WORTHWARD_INVESTMENT_DATA,
                    credit_card_rewards: result.credit_card_rewards,
                };
                runtime.renderInvestmentMetricsPanel?.();
            }
            state.result = null;
            state.text = '';
            renderResult(result, 'imported');
            setStatus(resultStatus('Credit-card import saved. Entries were read back from the credit-card ledger.', result));
        } catch (error) {
            if (current(epoch, text)) {
                state.result = null;
                state.text = '';
                state.retryable = true;
                setStatus(`${error.message || 'Credit-card import failed.'} Paste the page again to preview before retrying.`);
            }
        } finally {
            state.busy = false;
            runtime.state.investmentImportInFlight = false;
            syncControls();
            previewHsbcCreditCard();
        }
    }

    return {getHsbcCreditCardInputKind, isHsbcCreditCardInput, syncHsbcCreditCardInput,
        isHsbcCreditCardReady, invalidateHsbcCreditCardPreview, importHsbcCreditCard};
}
