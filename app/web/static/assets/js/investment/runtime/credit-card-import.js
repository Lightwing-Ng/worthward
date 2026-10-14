/**
 * HSBC credit-card preview, isolated import, and saved-card readback.
 * Code version: v1.1.0
 * - Changed: Credit-card activity uses the shared HSBC account-page input.
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
    const previewButton = document.getElementById('hsbc_credit_card_preview_button');
    const savedButton = document.getElementById('hsbc_credit_card_saved_button');
    const status = document.getElementById('hsbc_credit_card_status');
    const results = document.getElementById('hsbc_credit_card_results');
    const summary = document.getElementById('hsbc_credit_card_summary');
    const rows = document.getElementById('hsbc_credit_card_rows');
    const caption = document.getElementById('hsbc_credit_card_caption');
    const state = {epoch: 0, busy: false, text: '', result: null, observedText: ''};
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
        if (previewButton) previewButton.disabled = state.busy || !active() || runtime.state.investmentImportInFlight;
        if (savedButton) savedButton.disabled = state.busy || !active() || runtime.state.investmentImportInFlight;
        runtime.syncHsbcPasteDisplaySummaries?.();
        runtime.syncImportValidationState?.();
    };
    const isHsbcCreditCardReady = () => active() && !state.busy
        && state.result?.ready === true && state.text === currentText()
        && /^[a-f0-9]{64}$/i.test(String(state.result?.source_sha256 || ''));

    function invalidateHsbcCreditCardPreview() {
        state.epoch += 1;
        state.text = '';
        state.result = null;
        if (results) results.hidden = true;
        setStatus('Preview the current text to review purchases, repayments, RewardCash, and pending activity.');
        syncControls();
    }

    function syncHsbcCreditCardInput() {
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
            } else if (changed) {
                setStatus('Credit-card page detected. Select Preview to review it. Portfolio and Order Status drafts are kept and are not included. Nothing has been saved.');
            }
        }
        syncControls();
        return detected;
    }

    function paragraph(message) {
        const node = document.createElement('p');
        node.className = 'settings-service-note';
        node.textContent = message;
        summary?.appendChild(node);
    }

    function renderSummaryTotals(totals, currency, label) {
        if (!totals) return;
        const count = (key) => Number(totals[key] || 0).toLocaleString('en-US');
        const category = (name, key) => `${name}: ${count(`${key}_count`)}`
            + (currency ? ` (${formatCreditCardAmount(totals[`${key}_total`], currency)})` : '');
        paragraph(`${label} — ${[
            category('Posted purchases', 'posted_purchase'),
            category('Repayments', 'repayment'),
            category('RewardCash', 'rewardcash'),
            category('Pending', 'pending'),
        ].join('; ')}.`);
    }

    function renderResult(result, mode = 'preview') {
        const saved = mode === 'saved';
        const imported = mode === 'imported';
        if (caption) caption.textContent = mode === 'preview' ? 'Captured transactions' : 'Saved transactions';
        summary?.replaceChildren();
        rows?.replaceChildren();
        const accounts = saved ? (result.accounts || []) : [{
            ...result.account,
            snapshot: imported ? (result.merged_snapshot || result.snapshot) : result.snapshot,
        }];
        accounts.forEach((account) => {
            const snapshot = account.snapshot || {};
            const currency = account.currency || '';
            const last4 = /^\d{4}$/.test(String(account.last4 || '')) ? account.last4 : 'unavailable';
            paragraph(`${account.name || 'HSBC credit card'} · Card ending in ${last4}`);
            paragraph(`Account balance: ${formatCreditCardAmount(snapshot.account_balance, currency)}; `
                + `Current amount due: ${formatCreditCardAmount(snapshot.current_amount_due, currency)}; `
                + `Minimum payment: ${formatCreditCardAmount(snapshot.minimum_payment, currency)}; `
                + `Payment due: ${formatCreditCardDate(snapshot.payment_due_date)}; `
                + `RewardCash balance: ${formatCreditCardAmount(snapshot.rewardcash_balance)}.`);
        });
        if (accounts.length) paragraph('Balance fields are the bank values from the imported page; the visible transaction window may be incomplete.');
        const currencies = [...new Set(accounts.map((account) => account.currency).filter(Boolean))];
        const currency = currencies.length === 1 ? currencies[0] : '';
        renderSummaryTotals(result.capture_summary, currency, 'This capture');
        renderSummaryTotals(result.summary, currency, saved ? 'Saved ledger' : 'Ledger after merge');
        if (!saved && result.summary) {
            const count = (key) => Number(result.summary[key] || 0).toLocaleString('en-US');
            paragraph(`Merge: ${count('added_count')} added; ${count('promoted_count')} pending entries promoted; `
                + `${count('duplicate_count')} duplicates skipped.`);
        }
        (result.warnings || []).forEach((warning) => paragraph(String(warning)));
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
        if (saved && !accounts.length) paragraph('No saved HSBC credit cards.');
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
        if (!active() || state.busy || !currentText() || runtime.state.investmentImportInFlight) return;
        invalidateHsbcCreditCardPreview();
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
            setStatus(result.ready ? 'Preview ready. Review the entries before importing. Nothing has been saved.'
                : 'Preview needs review. Nothing has been saved.');
        } catch (error) {
            if (current(epoch, text)) setStatus(error.message || 'Credit-card preview failed.');
        } finally {
            state.busy = false;
            syncControls();
        }
    }

    async function viewSavedHsbcCreditCards() {
        if (!active() || state.busy || runtime.state.investmentImportInFlight) return;
        invalidateHsbcCreditCardPreview();
        const epoch = state.epoch;
        const text = currentText();
        state.busy = true;
        setStatus('Loading saved credit cards…');
        syncControls();
        try {
            const result = await request('/api/credit-cards/hsbc');
            if (!current(epoch, text)) return;
            renderResult(result, 'saved');
            setStatus('Saved credit-card activity. Preview the current text before importing.');
        } catch (error) {
            if (current(epoch, text)) setStatus(error.message || 'Saved credit cards could not be loaded.');
        } finally {
            state.busy = false;
            syncControls();
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
            state.result = null;
            state.text = '';
            renderResult(result, 'imported');
            setStatus('Credit-card import saved. The entries below were read back from the credit-card ledger.');
        } catch (error) {
            if (current(epoch, text)) {
                state.result = null;
                state.text = '';
                setStatus(`${error.message || 'Credit-card import failed.'} Preview again before retrying.`);
            }
        } finally {
            state.busy = false;
            runtime.state.investmentImportInFlight = false;
            syncControls();
        }
    }

    previewButton?.addEventListener('click', previewHsbcCreditCard);
    savedButton?.addEventListener('click', viewSavedHsbcCreditCards);
    return {getHsbcCreditCardInputKind, isHsbcCreditCardInput, syncHsbcCreditCardInput,
        isHsbcCreditCardReady, invalidateHsbcCreditCardPreview, previewHsbcCreditCard,
        viewSavedHsbcCreditCards, importHsbcCreditCard};
}
