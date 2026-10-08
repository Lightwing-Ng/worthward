/* Code version: v0.1.0 */
const root = typeof document !== 'undefined' ? document.querySelector('[data-beta-committee]') : null;

const voteLabels = Object.freeze({approve: 'Approve', oppose: 'Oppose', neutral: 'Neutral', abstain: 'Abstain', incomplete: 'Incomplete'});
const number = (value) => Number(value).toLocaleString('en-US');
const probability = (value) => typeof value === 'number' && Number.isFinite(value)
    ? `${(value * 100).toLocaleString('en-US', {maximumFractionDigits: 2})}%` : 'Unavailable';
const dateLabel = (value) => {
    const date = String(value || '').match(/^\d{4}-\d{2}-\d{2}/)?.[0];
    if (!date) return value || 'Unavailable';
    const parsed = new Date(`${date}T00:00:00Z`);
    if (!Number.isFinite(parsed.getTime())) return value;
    return `${parsed.getUTCDate()} ${parsed.toLocaleString('en-US', {month: 'short', timeZone: 'UTC'})} ${parsed.getUTCFullYear()}`;
};
const node = (tag, text, className) => {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = String(text);
    if (className) element.className = className;
    return element;
};

if (root) {
    const form = root.querySelector('[data-beta-committee-form]');
    const feedback = root.querySelector('[data-beta-committee-feedback]');
    const results = root.querySelector('[data-beta-committee-results]');
    const ticker = root.querySelector('#beta_committee_ticker');
    const model = root.querySelector('#beta_committee_model');
    const horizon = root.querySelector('#beta_committee_horizon');
    const threshold = root.querySelector('#beta_committee_threshold');
    const run = root.querySelector('[data-beta-committee-run]');
    const cancel = root.querySelector('[data-beta-committee-cancel]');
    let controller = null;
    let generation = 0;

    const setFeedback = (text, state = '') => {
        feedback.textContent = text;
        feedback.dataset.state = state;
    };
    const pending = (value) => {
        run.disabled = value;
        run.textContent = value ? 'Computing committee votes…' : 'Run buy analysis';
        form.setAttribute('aria-busy', String(value));
        cancel.hidden = !value;
    };
    const stop = (message) => {
        generation += 1;
        controller?.abort();
        controller = null;
        pending(false);
        results.hidden = true;
        if (message) setFeedback(message);
    };
    const updateThresholdHelp = () => {
        if (!threshold.validity.valid) return;
        const value = threshold.valueAsNumber;
        root.querySelector('#beta_committee_threshold_help').textContent = `At ${number(value)}%, Price Field approves at an upward probability of at least ${number(value)}%, opposes at ${number(100 - value)}% or less, and stays neutral between them. Unavailable forecasts abstain.`;
    };
    const metric = (label, value, note) => {
        const card = node('article', undefined, 'trade-metric-card');
        card.append(node('p', label, 'trade-metric-label'), node('p', value, 'trade-metric-value'), node('p', note, 'beta-caption'));
        return card;
    };
    const render = (data) => {
        if (data.schema !== 'beta-buy-analysis/v1' || !Array.isArray(data.votes) || !data.summary) {
            throw new Error('The committee response could not be read. Run the analysis again.');
        }
        const summary = data.summary;
        const priceField = data.votes.find((vote) => vote.member === 'price-field' || vote.name?.includes('Price Field'));
        root.querySelector('[data-beta-committee-provenance]').textContent = `${data.ticker} · Through ${data.as_of} · ${number(data.observations)} cached observations · ${data.source}`;
        root.querySelector('[data-beta-committee-metrics]').replaceChildren(
            metric('Committee verdict', voteLabels[summary.verdict] || 'Incomplete', `${number(summary.required_approvals)} approvals required from ${number(summary.total)} members.`),
            metric('Approval votes', `${number(summary.approve)} / ${number(summary.total)}`, `${number(summary.oppose)} oppose · ${number(summary.neutral)} neutral · ${number(summary.abstain)} abstain.`),
            metric('Price Field upward probability', probability(priceField?.probability_up), `One committee vote · ${voteLabels[priceField?.vote] || 'Abstain'} · ${data.model?.name || 'Model unavailable'}.`),
            metric('Forecast horizon', priceField?.horizon == null ? 'Unavailable' : `${number(priceField.horizon)} sessions`, priceField?.target_interval || 'Target interval unavailable.'),
        );
        const table = root.querySelector('[data-beta-committee-table]');
        const head = node('thead');
        const heading = node('tr');
        ['Committee member', 'Vote', 'Upward probability', 'Evidence', 'Forecast provenance'].forEach((label) => {
            const cell = node('th', label);
            cell.scope = 'col';
            heading.append(cell);
        });
        head.append(heading);
        const body = node('tbody');
        data.votes.forEach((vote) => {
            const row = node('tr');
            row.dataset.committeeMember = vote.member;
            const member = node('th', vote.name);
            member.scope = 'row';
            const provenance = node('td', undefined, 'beta-vote-reason');
            if (vote.model_id) {
                provenance.append(
                    node('p', `${data.model?.name || vote.model_id} · ${vote.model_id} · ${vote.model_version || 'Version unavailable'}`),
                    node('p', `Origin: ${dateLabel(vote.origin)} · ${number(vote.horizon)} sessions`),
                    node('p', vote.target_interval || 'Target interval unavailable.'),
                    node('p', `Fingerprint: ${vote.fingerprint || 'Unavailable'}`),
                );
            } else {
                provenance.append(node('p', `Through ${dateLabel(vote.origin || data.origin)}`), node('p', 'Historical diagnostic; no forecast model.'));
            }
            const upwardProbability = vote.probability_up == null && !vote.model_id ? 'Not a forecast' : probability(vote.probability_up);
            row.append(member, node('td', voteLabels[vote.vote] || 'Abstain'), node('td', upwardProbability), node('td', vote.reason, 'beta-vote-reason'), provenance);
            body.append(row);
        });
        table.replaceChildren(node('caption', 'Each member contributes one equally weighted vote. Probabilities are not averaged.'), head, body);
        root.querySelector('[data-beta-committee-notes]').replaceChildren(...(data.notes || []).map((note) => node('li', note)));
        results.hidden = false;
    };

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!form.reportValidity()) return;
        stop();
        const token = ++generation;
        const active = new AbortController();
        controller = active;
        ticker.value = ticker.value.trim().toUpperCase();
        const url = new URL(root.dataset.endpoint, location.origin);
        url.searchParams.set('ticker', ticker.value);
        url.searchParams.set('model', model.value);
        url.searchParams.set('horizon', horizon.value);
        url.searchParams.set('threshold', threshold.value);
        pending(true);
        setFeedback('Reading cached history and computing each member’s vote…', 'pending');
        const timeout = setTimeout(() => active.abort(), 60000);
        try {
            const response = await fetch(url, {method: 'GET', signal: active.signal, credentials: 'same-origin', cache: 'no-store'});
            const data = await response.json();
            if (token !== generation) return;
            if (active.signal.aborted) throw new DOMException('The local computation timed out.', 'AbortError');
            if (!response.ok) throw new Error(data.error || 'The committee could not complete this analysis.');
            render(data);
            setFeedback('Analysis complete. Review every vote and its evidence before using the signal.', 'complete');
        } catch (error) {
            if (token !== generation) return;
            results.hidden = true;
            setFeedback(error.name === 'AbortError' ? 'The local computation timed out. You can try again.' : error.message, 'error');
        } finally {
            clearTimeout(timeout);
            if (token === generation) { controller = null; pending(false); }
        }
    });
    const inputChanged = () => {
        stop('Inputs changed. Run buy analysis to update the committee votes.');
        updateThresholdHelp();
    };
    form.addEventListener('input', inputChanged);
    form.addEventListener('change', inputChanged);
    cancel.addEventListener('click', () => stop('Buy analysis canceled.'));
    window.addEventListener('pagehide', () => stop('Buy analysis canceled when you left this page.'));
}
