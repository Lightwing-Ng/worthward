/* Code version: v0.1.0 */
const root = typeof document !== 'undefined' ? document.querySelector('[data-beta-root]') : null;

export function shockImpact(shock, exposure) {
    if (!Number.isFinite(shock) || shock < -100 || shock > 100
        || !Number.isFinite(exposure) || exposure < 0 || exposure > 100) {
        throw new Error('Enter a shock from −100 to 100 and an exposure from 0 to 100.');
    }
    const change = shock * exposure / 100;
    return {change, recovery: change <= -100 ? null : change < 0 ? (100 / (100 + change) - 1) * 100 : 0};
}

if (root) {
    const form = root.querySelector('[data-beta-analysis-form]');
    const feedback = root.querySelector('[data-beta-feedback]');
    const results = root.querySelector('[data-beta-results]');
    const ticker = root.querySelector('#beta_ticker');
    const run = root.querySelector('[data-beta-run]');
    const cancel = root.querySelector('[data-beta-cancel]');
    let controller = null;
    let chart = null;
    let observation = null;
    let generation = 0;
    const percent = (value) => `${value.toLocaleString('en-US', {maximumFractionDigits: 2, minimumFractionDigits: 2})}%`;
    const node = (tag, text, className) => {
        const element = document.createElement(tag);
        if (text !== undefined) element.textContent = String(text);
        if (className) element.className = className;
        return element;
    };
    const setFeedback = (text, state = '') => {
        feedback.textContent = text;
        feedback.dataset.state = state;
    };
    const pending = (value) => {
        run.disabled = value;
        run.textContent = value ? 'Reading local history…' : 'Run experiment';
        form.setAttribute('aria-busy', String(value));
        cancel.hidden = !value;
    };
    const clearResults = () => {
        observation = null;
        if (results) results.hidden = true;
        chart?.destroy();
        chart = null;
    };
    const stop = (message) => {
        generation += 1;
        controller?.abort();
        controller = null;
        if (form) {
            pending(false);
            if (message) setFeedback(message);
        }
    };
    const renderChart = (payload) => {
        const canvas = root.querySelector('[data-beta-chart]');
        if (!window.Chart) throw new Error('The chart library could not load. Reload the page to try again.');
        const styles = getComputedStyle(document.documentElement);
        const colors = ['--accent-fill', '--theme-accent-secondary', '--theme-accent-positive', '--muted', '--text']
            .map((name) => styles.getPropertyValue(name).trim());
        const color = styles.getPropertyValue('--muted').trim();
        chart?.destroy();
        chart = new window.Chart(canvas, {
            type: 'line',
            data: {
                labels: payload.labels,
                datasets: payload.series.map((series, index) => ({
                    label: series.label, data: series.values, borderColor: colors[index % colors.length],
                    backgroundColor: colors[index % colors.length], borderWidth: 1.8,
                    pointRadius: 0, pointHitRadius: 8, tension: 0, spanGaps: false,
                })),
            },
            options: {
                responsive: true, maintainAspectRatio: false, animation: false,
                interaction: {mode: 'index', intersect: false},
                plugins: {legend: {labels: {color, boxWidth: 12, font: {size: 11}}}},
                scales: {
                    x: {ticks: {color, maxTicksLimit: 6, maxRotation: 0}, grid: {display: false}},
                    y: {ticks: {color, callback: (value) => `${value}%`}, grid: {color: styles.getPropertyValue('--theme-glass-border').trim()}},
                },
            },
        });
    };
    const render = (data) => {
        root.querySelector('[data-beta-provenance]').textContent = `${data.ticker} · Through ${data.as_of} · ${Number(data.observations).toLocaleString('en-US')} observations · ${data.source}`;
        const metrics = root.querySelector('[data-beta-metrics]');
        metrics.replaceChildren(...data.metrics.map((item) => {
            const card = node('article', undefined, 'trade-metric-card');
            card.append(node('p', item.label, 'trade-metric-label'), node('p', item.value, 'trade-metric-value'), node('p', item.note, 'beta-caption'));
            return card;
        }));
        const table = root.querySelector('[data-beta-table]');
        const head = node('thead');
        const heading = node('tr');
        data.rows.columns.forEach((label) => {
            const cell = node('th', label); cell.scope = 'col'; heading.append(cell);
        });
        head.append(heading);
        const body = node('tbody');
        data.rows.values.forEach((values) => {
            const row = node('tr');
            values.forEach((value) => row.append(node('td', typeof value === 'number' ? value.toLocaleString('en-US') : value)));
            body.append(row);
        });
        table.replaceChildren(head, body);
        root.querySelector('[data-beta-notes]').replaceChildren(...data.notes.map((text) => node('li', text)));
        results.hidden = false;
        renderChart(data.chart);
    };
    if (form) {
        try { ticker.value = sessionStorage.getItem('worthward:beta:v1:ticker') || ''; } catch (_) { /* Optional session preference. */ }
        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            if (!form.reportValidity()) return;
            stop();
            clearResults();
            const token = ++generation;
            const active = new AbortController();
            controller = active;
            const symbol = ticker.value.trim().toUpperCase();
            ticker.value = symbol;
            const url = new URL(root.dataset.endpoint, location.origin);
            url.searchParams.set('experiment', root.dataset.experiment);
            url.searchParams.set('ticker', symbol);
            pending(true);
            setFeedback('Reading cached history and computing this experiment…', 'pending');
            const timeout = setTimeout(() => active.abort(), 20000);
            try {
                const response = await fetch(url, {signal: active.signal, credentials: 'same-origin', cache: 'no-store'});
                const data = await response.json();
                if (token !== generation) return;
                if (!response.ok) throw new Error(data.error || 'This experiment could not be completed.');
                render(data);
                observation = data;
                setFeedback('Experiment complete. Review the observations and method below.', 'complete');
                try { sessionStorage.setItem('worthward:beta:v1:ticker', symbol); } catch (_) { /* Optional session preference. */ }
            } catch (error) {
                if (token !== generation) return;
                clearResults();
                setFeedback(error.name === 'AbortError' ? 'The local read timed out. You can try again.' : error.message, 'error');
            } finally {
                clearTimeout(timeout);
                if (token === generation) { controller = null; pending(false); }
            }
        });
        ticker.addEventListener('input', () => { stop('Ticker changed. Run the experiment to update observations.'); clearResults(); });
        cancel.addEventListener('click', () => { stop('Experiment canceled.'); clearResults(); });
        root.querySelector('[data-beta-export]').addEventListener('click', () => {
            if (!observation) return;
            const blob = new Blob([JSON.stringify({schema: 'worthward-beta/v0.1.0', ...observation}, null, 2)], {type: 'application/json'});
            const url = URL.createObjectURL(blob);
            const link = node('a');
            link.href = url; link.download = `worthward-beta-${observation.experiment}-${observation.ticker}.json`;
            document.body.append(link); link.click(); link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        });
    }
    const updateShock = () => {
        const output = root.querySelector('[data-beta-shock-result]');
        try {
            const shock = root.querySelector('#beta_shock');
            const exposure = root.querySelector('#beta_exposure');
            const impact = shockImpact(shock.valueAsNumber, exposure.valueAsNumber);
            output.textContent = `Hypothetical portfolio change: ${percent(impact.change)}. ${impact.recovery === null ? 'A total loss cannot recover without new capital.' : impact.change < 0 ? `Gain needed to recover: ${percent(impact.recovery)}.` : 'No loss to recover.'}`;
        } catch (error) { output.textContent = error.message; }
    };
    if (root.querySelector('[data-beta-shock]')) {
        root.querySelector('[data-beta-shock]').addEventListener('input', updateShock);
        updateShock();
    }
    window.addEventListener('pagehide', () => { stop(controller ? 'Experiment canceled when you left this page.' : undefined); chart?.destroy(); chart = null; });
    window.addEventListener('pageshow', (event) => { if (event.persisted && observation) renderChart(observation.chart); });
    window.addEventListener('worthward:theme-mode-change', () => { if (observation) renderChart(observation.chart); });
}
