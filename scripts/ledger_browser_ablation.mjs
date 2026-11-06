#!/usr/bin/env node
/* Replay real scenario payloads through the final browser accounting and charts.
 * Code version: v1.1.0
 */

import assert from 'node:assert/strict';
import {createHash, randomBytes} from 'node:crypto';
import {execFileSync, spawn, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {deflateSync, inflateSync} from 'node:zlib';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FROZEN_FIELDS = ['realtime_quotes', 'price_history_by_ticker', 'fx_rate_history_by_currency'];
const METRIC_KEYS = [
    'cash', 'cashIsApproximate', 'marketValue', 'totalEquity', 'totalRealizedPnl',
    'totalUnrealizedPnl', 'cumulativePnl', 'pnlUnavailable', 'pnlCoverage',
    'realizedPnlUnavailable', 'unrealizedPnlUnavailable', 'realizedPnlCoverage',
    'unrealizedPnlCoverage', 'tickerSummaries',
];
const EQUIVALENT_CONTROLS = new Set([
    'full_cold', 'sqlite_with_cache', 'sqlite_without_cache', 'sqlite_without_cache_repeat',
    'conflicting_legacy_files', 'stale_cache', 'stale_same_schema_cache',
]);
const CORE_INPUTS = ['investment.sqlite3', 'private_investment_evidence.sqlite3', 'settings.sqlite3', 'credit_cards.sqlite3'];
const FORCE_RENDER = new Set(['full_cold', 'sqlite_without_cache', 'conflicting_legacy_files']);
const CHECKPOINT_APPLICATION_ID = 0x57574243;

export function canonical(value) {
    if (typeof value === 'number' && !Number.isFinite(value)) return {$nonfinite: String(value)};
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort()
        .filter((key) => value[key] !== undefined).map((key) => [key, canonical(value[key])]));
    return value;
}

export const digest = (value) => createHash('sha256').update(JSON.stringify(canonical(value)) ?? 'undefined').digest('hex');

export function resolvedPath(value) {
    let existing = path.resolve(value);
    const suffix = [];
    while (!fs.existsSync(existing)) {
        const parent = path.dirname(existing);
        if (parent === existing) break;
        suffix.unshift(path.basename(existing)); existing = parent;
    }
    return path.join(fs.realpathSync(existing), ...suffix);
}

export function pathIsWithin(value, root) {
    const selected = resolvedPath(value).toLowerCase(), protectedPath = resolvedPath(root).toLowerCase();
    return selected === protectedPath || selected.startsWith(protectedPath + path.sep);
}

export function requireAuditLock(environment = process.env) {
    const {WORTHWARD_E2E_LOCK_FILE: file, WORTHWARD_E2E_LOCK_ROOT: root, WORTHWARD_E2E_LOCK_TOKEN: token} = environment;
    if (!file || !root || !token) throw new Error('Run browser ablation through scripts/e2e_lock.py run.');
    const owner = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (fs.realpathSync(root) !== fs.realpathSync(ROOT)
        || fs.realpathSync(owner.root) !== fs.realpathSync(ROOT) || owner.token !== token) {
        throw new Error('The inherited browser audit lock does not match this repository.');
    }
}

export function validateManifest(manifest) {
    assert(['1.0.0', '1.1.0'].includes(manifest.version));
    assert(Number.isFinite(Date.parse(manifest.clock)), 'Supply one explicit frozen browser clock.');
    assert(Array.isArray(manifest.scenarios) && manifest.scenarios.length, 'No accounting scenarios were supplied.');
    const sources = [path.join(ROOT, 'settings_store'), path.join(ROOT, 'market_store'), ...(manifest.protected_roots || [])]
        .map(resolvedPath);
    for (const key of ['settings_root', 'market_root', 'compute_root']) {
        assert(manifest.server?.[key], `Missing isolated server input ${key}.`);
        const selected = resolvedPath(manifest.server[key]);
        for (const source of sources) {
            assert(!pathIsWithin(selected, source) && !pathIsWithin(source, selected), 'Browser data roots must be isolated from protected stores.');
        }
    }
    assert(new Set(manifest.scenarios.map((item) => item.name)).size === manifest.scenarios.length, 'Scenario names must be unique.');
    for (const scenario of manifest.scenarios) {
        assert(scenario.name && (scenario.payload_path || (scenario.payload_database && scenario.payload_key && scenario.input_sha256)));
        if (scenario.input_sha256) assert(/^[a-f0-9]{64}$/.test(scenario.input_sha256));
    }
    const ranges = manifest.ranges || ['max'];
    assert(ranges.includes('max') && ranges.every((range) => ['max', '1w', '1m'].includes(range)));
}

export function validateReportPath(reportPath, manifest) {
    assert(!fs.existsSync(reportPath), 'Choose a new browser report path.');
    const protectedOutputs = [path.join(ROOT, 'settings_store'), path.join(ROOT, 'market_store'),
        ...(manifest.protected_roots || []), ...['settings_root', 'market_root', 'compute_root'].map((key) => manifest.server[key])];
    assert(!protectedOutputs.some((root) => pathIsWithin(reportPath, root)), 'Keep the browser report outside every data store.');
}

export function validateCheckpointPath(checkpointPath, manifest) {
    const protectedOutputs = [path.join(ROOT, 'settings_store'), path.join(ROOT, 'market_store'),
        ...(manifest.protected_roots || []), ...['settings_root', 'market_root', 'compute_root'].map((key) => manifest.server[key])];
    assert(!protectedOutputs.some((root) => pathIsWithin(checkpointPath, root)), 'Keep checkpoints outside every data store.');
    if (fs.existsSync(checkpointPath)) {
        const stat = fs.lstatSync(checkpointPath);
        assert(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1, 'Checkpoint aliases and hardlinks are forbidden.');
        assert(manifest.resume_checkpoint === true, 'Existing checkpoints require explicit resume_checkpoint.');
    }
}

export function loadScenarioPayload(scenario) {
    let raw;
    if (scenario.payload_database) {
        const db = new DatabaseSync(scenario.payload_database, {readOnly: true});
        try {
            assert.equal(db.prepare('PRAGMA application_id').get().application_id, 0x57574154);
            assert.equal(db.prepare('PRAGMA user_version').get().user_version, 1);
            const row = db.prepare('SELECT * FROM payloads WHERE payload_key = ?').get(scenario.payload_key);
            assert(row && row.codec === 'zlib', 'Missing or unsupported compressed scenario payload.');
            raw = inflateSync(row.payload);
            assert.equal(raw.length, row.raw_bytes);
            assert.equal(createHash('sha256').update(raw).digest('hex'), row.raw_sha256);
        } finally { db.close(); }
    } else raw = fs.readFileSync(scenario.payload_path);
    const rawSha256 = createHash('sha256').update(raw).digest('hex');
    if (scenario.input_sha256) assert.equal(rawSha256, scenario.input_sha256, `Transport identity changed for ${scenario.name}.`);
    const payload = JSON.parse(raw.toString('utf8'));
    return {payload, raw_sha256: rawSha256, canonical_sha256: digest(payload)};
}

export class CaptureCheckpoint {
    constructor(file, context, resume = false) {
        this.path = path.resolve(file);
        const existed = fs.existsSync(file);
        assert(!existed || resume, 'Existing checkpoints require explicit resume.');
        if (!existed) fs.closeSync(fs.openSync(file, 'wx', 0o600));
        this.db = new DatabaseSync(file);
        try {
            if (existed) {
                assert.equal(this.db.prepare('PRAGMA application_id').get().application_id, CHECKPOINT_APPLICATION_ID);
                assert.equal(this.db.prepare('PRAGMA user_version').get().user_version, 1);
                assert.equal(this.db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
            }
            this.db.exec('PRAGMA synchronous = FULL; PRAGMA journal_mode = DELETE; PRAGMA busy_timeout = 5000;');
            if (!existed) {
                this.db.exec(`PRAGMA application_id = ${CHECKPOINT_APPLICATION_ID}; PRAGMA user_version = 1;
                    CREATE TABLE records (record_key TEXT PRIMARY KEY, sha256 TEXT NOT NULL,
                        raw_bytes INTEGER NOT NULL, compressed_bytes INTEGER NOT NULL, payload BLOB NOT NULL) WITHOUT ROWID;`);
                this.write([['context', context]]);
            } else assert.equal(digest(this.read('context').value), digest(context), 'Checkpoint context changed; use a new checkpoint.');
        } catch (error) { this.db.close(); throw error; }
    }
    write(entries) {
        const insert = this.db.prepare('INSERT OR REPLACE INTO records VALUES (?, ?, ?, ?, ?)');
        const refs = {};
        this.db.exec('BEGIN IMMEDIATE');
        try {
            for (const [key, value] of entries) {
                const raw = Buffer.from(JSON.stringify(canonical(value)));
                const payload = deflateSync(raw, {level: 6});
                const sha256 = createHash('sha256').update(raw).digest('hex');
                assert(inflateSync(payload).equals(raw), 'Checkpoint compression did not roundtrip.');
                insert.run(key, sha256, raw.length, payload.length, payload);
                refs[key] = {database: this.path, record_key: key, codec: 'zlib', sha256,
                    raw_bytes: raw.length, compressed_bytes: payload.length};
            }
            this.db.exec('COMMIT');
            for (const [key] of entries) assert.equal(this.read(key).ref.sha256, refs[key].sha256);
            return refs;
        } catch (error) {
            if (this.db.isTransaction) this.db.exec('ROLLBACK');
            throw error;
        }
    }
    read(key) {
        const row = this.db.prepare('SELECT * FROM records WHERE record_key = ?').get(key);
        if (!row) return null;
        assert.equal(row.payload.length, row.compressed_bytes);
        const raw = inflateSync(row.payload);
        assert.equal(raw.length, row.raw_bytes);
        assert.equal(createHash('sha256').update(raw).digest('hex'), row.sha256, `Damaged checkpoint record ${key}.`);
        return {value: JSON.parse(raw.toString('utf8')), ref: {database: this.path, record_key: key,
            codec: 'zlib', sha256: row.sha256, raw_bytes: row.raw_bytes, compressed_bytes: row.compressed_bytes}};
    }
    close() { this.db.close(); }
}

export function exactInputKey(scenario, identity, contextSha256, auxiliarySha256) {
    return digest({raw_sha256: identity.raw_sha256, canonical_sha256: identity.canonical_sha256,
        http_status: scenario.http_status || 200, context_sha256: contextSha256, auxiliary_sha256: auxiliarySha256});
}

export function canReuseExactInput(manifest, scenario) {
    return manifest.deduplicate_exact_inputs === true && !FORCE_RENDER.has(scenario.name)
        && !(manifest.force_render || []).includes(scenario.name);
}

export function loadCommittedCase(checkpoint, name) {
    const saved = checkpoint.read(`case/${name}`);
    assert(!saved || saved.value.completed === true,
        `Checkpoint preserves a failed or incomplete capture for ${name}; keep it and choose a new checkpoint.`);
    return saved;
}

const OBSERVER = `
    window.__LEDGER_BROWSER_OBSERVATIONS = {metricsByBroker: {}};
    const originalAuditMetrics = runtime.getHoldingsSummaryMetrics;
    runtime.getHoldingsSummaryMetrics = function (...args) {
        const result = originalAuditMetrics.apply(this, args);
        const broker = args[4]?.brokerCode || 'all';
        window.__LEDGER_BROWSER_OBSERVATIONS.metricsByBroker[broker] = result;
        return result;
    };
`;

export function instrumentEntry(source) {
    const runtimeNeedle = 'const runtime = {state: {}};';
    const bootstrapNeedle = '    // Load and render transactions';
    assert.equal(source.split(runtimeNeedle).length, 2, 'The real page runtime hook is ambiguous.');
    assert.equal(source.split(bootstrapNeedle).length, 2, 'The real page bootstrap hook is ambiguous.');
    return source.replace(runtimeNeedle, `${runtimeNeedle}\n    window.__LEDGER_BROWSER_RUNTIME = runtime;`)
        .replace(bootstrapNeedle, `${OBSERVER}\n${bootstrapNeedle}`);
}

function startServer(manifestPath, manifest, token, bytecode) {
    const python = manifest.server.python || process.env.WORTHWARD_PYTHON || 'python3';
    const child = spawn(python, ['-u', path.join(ROOT, 'scripts/ledger_browser_ablation_server.py'), '--manifest', manifestPath, '--token', token], {
        cwd: ROOT, env: {...process.env, PYTHONPYCACHEPREFIX: process.env.WORTHWARD_ABLATION_PYCACHE || bytecode},
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '', stdout = '';
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-200_000); });
    const ready = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`The isolated page server did not start: ${stderr.slice(-2000)}`)), 300_000);
        child.once('error', (error) => { clearTimeout(timer); reject(error); });
        child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`The isolated page server exited ${code}: ${stderr.slice(-2000)}`)); });
        child.stdout.on('data', (chunk) => {
            stdout += chunk;
            for (const line of stdout.split('\n').slice(0, -1)) {
                try {
                    const result = JSON.parse(line);
                    if (result.ready) { clearTimeout(timer); resolve(result); }
                } catch { /* Dependency diagnostics can precede the readiness record. */ }
            }
        });
    });
    return {child, ready, stderr: () => stderr};
}

async function stopServer(child) {
    if (!child || child.exitCode !== null) return;
    child.kill('SIGTERM');
    await Promise.race([new Promise((resolve) => child.once('exit', resolve)), new Promise((resolve) => setTimeout(resolve, 5000))]);
    if (child.exitCode === null) child.kill('SIGKILL');
}

function descendantPids() {
    const rows = execFileSync('ps', ['-axo', 'pid,ppid'], {encoding: 'utf8'}).split('\n').slice(1)
        .map((line) => line.trim().split(/\s+/).map(Number)).filter((row) => row.length === 2 && row.every(Number.isFinite));
    const owned = new Set(), pending = [process.pid];
    while (pending.length) {
        const parent = pending.shift();
        for (const [pid, ppid] of rows) if (ppid === parent && !owned.has(pid)) { owned.add(pid); pending.push(pid); }
    }
    return [...owned].reverse();
}

async function settle(page, expectedCount) {
    await page.waitForFunction((count) => {
        const runtime = window.__LEDGER_BROWSER_RUNTIME;
        return runtime && window.WORTHWARD_INVESTMENT_DATA?.transactions?.length === count
            && runtime.state.investmentProcessedTransactionsCache?.length > 0
            && !runtime.state.investmentBootstrapTimer
            && (runtime.state.investmentChartReady || runtime.state.investmentAggregateSecurityTransferState?.blocked)
            && !runtime.state.investmentMarketSessionStateRequest
            && runtime.investmentOverviewIntradayInflight.size === 0;
    }, expectedCount, {timeout: 120_000});
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function capturePage(page, ranges, expectedCount) {
    await settle(page, expectedCount);
    await page.evaluate(() => {
        const runtime = window.__LEDGER_BROWSER_RUNTIME;
        runtime.state.selectedInvestmentEquityRange = 'max';
        runtime.applyInvestmentEquityRangeChange(runtime.state.investmentBaseChartPointsCache);
    });
    await settle(page, expectedCount);
    const initial = await page.evaluate((metricKeys) => {
        const runtime = window.__LEDGER_BROWSER_RUNTIME;
        const pick = (value) => Object.fromEntries(metricKeys.filter((key) => value && key in value).map((key) => [key, value[key]]));
        runtime.setInvestmentView('holdings', {syncHash: false});
        runtime.syncInvestmentHoldingsRealtimeValues();
        const metrics = window.__LEDGER_BROWSER_OBSERVATIONS.metricsByBroker.all;
        const dom = [...document.querySelectorAll('#investment_holdings_panel .investment-holdings-table-scroll [data-investment-live-field]')]
            .map((node) => ({field: node.dataset.investmentLiveField, ticker: node.dataset.investmentLiveTicker || '',
                numeric: node.hasAttribute('data-investment-live-number') ? Number(node.dataset.investmentLiveNumber) : null,
                display: node.dataset.investmentLiveDisplay || node.textContent.trim()}));
        const summaryDom = [...document.querySelectorAll('#investment_holdings_panel [data-investment-live-field^="summary_"]')]
            .filter((node) => !node.closest('.scrollable-data-table-frosted-underlay'))
            .map((node) => ({field: node.dataset.investmentLiveField,
                numeric: node.hasAttribute('data-investment-live-number') ? Number(node.dataset.investmentLiveNumber) : null,
                display: node.dataset.investmentLiveDisplay || node.textContent.trim()}));
        const brokerCodes = [...new Set(['all', ...(runtime.state.investmentAvailableBrokerCodesCache || [])])];
        const brokers = {};
        runtime.setInvestmentView('metrics', {syncHash: false});
        for (const broker of brokerCodes) {
            runtime.state.investmentBrokerSummarySelectedCode = broker;
            runtime.renderInvestmentMetricsPanel();
            brokers[broker] = {
                metrics: pick(window.__LEDGER_BROWSER_OBSERVATIONS.metricsByBroker[broker]),
                dom: [...document.querySelectorAll('#investment_metrics_panel .trade-metric-card')].map((card) => card.textContent.trim()),
            };
        }
        runtime.state.investmentBrokerSummarySelectedCode = 'all';
        runtime.renderInvestmentMetricsPanel();
        return {
            holdings: {metrics: pick(metrics), dom, summary_dom: summaryDom}, broker_metrics: brokers,
            ticker_summaries: runtime.state.investmentTickerSummariesCache,
            current_chart_pnl: runtime.state.investmentCurrentChartPnlMetrics,
            complete_daily_points: runtime.state.investmentBaseChartPointsCache,
            aggregate_blocked: runtime.state.investmentAggregateSecurityTransferState?.blocked === true,
            control_state: {range: runtime.state.selectedInvestmentEquityRange,
                calendar_days: runtime.isInvestmentDailyEquityLiveRange(),
                market_session: runtime.state.investmentMarketSessionState},
            module_versions: window.WORTHWARD_INVESTMENT_MODULE_VERSIONS,
        };
    }, METRIC_KEYS);
    for (const field of ['summary_realized_pnl', 'summary_unrealized_pnl', 'summary_cumulative_pnl', 'summary_total_equity']) {
        assert(initial.holdings.summary_dom.some((item) => item.field === field), `The rendered Holdings summary is missing ${field}.`);
    }
    const curves = {};
    if (!initial.aggregate_blocked) {
        for (const range of ranges) {
            await page.evaluate((selected) => {
                const runtime = window.__LEDGER_BROWSER_RUNTIME;
                runtime.setInvestmentView('chart', {syncHash: false});
                runtime.state.selectedInvestmentEquityRange = selected;
                runtime.applyInvestmentEquityRangeChange(runtime.state.investmentBaseChartPointsCache);
            }, range);
            await settle(page, expectedCount);
            // The real controller owns intraday readiness, quality gates, and fallback.
            curves[range] = await page.evaluate(() => {
                const runtime = window.__LEDGER_BROWSER_RUNTIME;
                const state = runtime.state.investmentEquityChartRuntimeState;
                const chart = runtime.state.investmentEquityChartInstance;
                const points = state?.visibleChartPoints || [];
                const target = runtime.resolveInvestmentEquityRealtimeMarkerTarget(state);
                return {
                    dates: state?.rawDates || [], equity: state?.equity || [],
                    points: points.map((point, index) => ({...point,
                        rendered_equity: state.equity[index],
                        historical_pnl: runtime.state.investmentChartPnlMetricsByPoint.get(point) || null,
                        tooltip_uses_current_holdings: target?.index === index,
                        tooltip_pnl: target?.index === index
                            ? runtime.resolveInvestmentChartPnlMetrics(point, {useCurrentHoldings: true})
                            : runtime.state.investmentChartPnlMetricsByPoint.get(point) || null,
                    })),
                    hover_pnl_coverage: 'Existing application cache and current-holdings marker only; every possible hover was not replayed.',
                    chart_labels: chart?.data?.rawLabels || chart?.data?.labels || [],
                    chart_datasets: (chart?.data?.datasets || []).map((dataset) => ({label: dataset.label || '', data: dataset.data})),
                    intraday_quality: runtime.getInvestmentOverviewIntradayLineQuality(state?.overviewIntradayLinePoints || []),
                    uses_intraday: Boolean(state?.overviewIntradayLinePoints?.length),
                };
            });
            assert(curves[range].dates.length > 0, `The ${range} chart contains no rendered points.`);
            assert.equal(curves[range].dates.length, curves[range].equity.length);
            assert.equal(curves[range].dates.length, curves[range].points.length);
            assert.deepEqual(curves[range].chart_labels, curves[range].dates);
            assert.deepEqual(curves[range].chart_datasets[0]?.data, curves[range].equity);
        }
    }
    return canonical({...initial, curves});
}

export function compareAccounting(baseline, actual) {
    const result = {same_complete_accounting: digest(baseline) === digest(actual),
        same_holdings: digest(baseline.holdings) === digest(actual.holdings),
        same_broker_metrics: digest(baseline.broker_metrics) === digest(actual.broker_metrics),
        same_current_chart_pnl: digest(baseline.current_chart_pnl) === digest(actual.current_chart_pnl),
        same_complete_daily_points: digest(baseline.complete_daily_points) === digest(actual.complete_daily_points),
        same_ticker_summaries: digest(baseline.ticker_summaries) === digest(actual.ticker_summaries), curve_differences: {}};
    for (const range of new Set([...Object.keys(baseline.curves || {}), ...Object.keys(actual.curves || {})])) {
        const left = baseline.curves?.[range], right = actual.curves?.[range];
        const differences = [];
        for (let index = 0; index < Math.max(left?.dates.length || 0, right?.dates.length || 0); index += 1) {
            const before = {date: left?.dates[index], equity: left?.equity[index], pnl: left?.points[index]?.historical_pnl};
            const after = {date: right?.dates[index], equity: right?.equity[index], pnl: right?.points[index]?.historical_pnl};
            if (digest(before) !== digest(after)) differences.push({index, baseline: before, actual: after});
        }
        result.curve_differences[range] = {same_complete_curve: digest(left) === digest(right), points: differences};
    }
    return result;
}

export function assessAcceptance(scenarios) {
    const equivalent = scenarios.filter((item) => EQUIVALENT_CONTROLS.has(item.name));
    const negatives = scenarios.filter((item) => item.http_status >= 400);
    return {
        all_requested_equivalence_controls_match: equivalent.every((item) => (item.accounting || item.has_accounting) && (item.comparison === null || item.comparison.same_complete_accounting)),
        all_accounting_rerenders_stable: scenarios.filter((item) => item.accounting || item.has_accounting).every((item) => item.rerender_stable === true),
        all_negative_controls_failed_closed: negatives.every((item) => item.negative_state?.failed_closed === true),
        required_shadow_controls_rendered: scenarios.filter((item) => FORCE_RENDER.has(item.name))
            .every((item) => item.render_mode === 'actual_browser'),
        no_page_errors: scenarios.every((item) => item.page_errors?.length === 0),
        no_browser_write_attempts: scenarios.every((item) => !(item.blocked_requests || []).some((request) => !['GET', 'HEAD'].includes(request.method))),
    };
}

export function compactCase(measured, reference) {
    const {accounting, rerendered_accounting: rerendered, server_audit: serverAudit, ...summary} = measured;
    const compactComparison = (value) => value && ({...value, curve_differences: Object.fromEntries(
        Object.entries(value.curve_differences || {}).map(([range, curve]) => [range,
            {same_complete_curve: curve.same_complete_curve, changed_point_count: curve.points?.length ?? curve.changed_point_count ?? 0}]))});
    summary.comparison = compactComparison(summary.comparison);
    summary.rerender_comparison = compactComparison(summary.rerender_comparison);
    summary.has_accounting = Boolean(accounting) || summary.has_accounting === true;
    summary.capture_ref = reference;
    if (serverAudit) summary.server_audit_summary = {
        production_access_attempts: serverAudit.production_access_attempts,
        outbound_connection_attempts: serverAudit.outbound_connection_attempts,
        data_open_key_count: Object.keys(serverAudit.attempted_data_opens || {}).length,
        sha256: digest(serverAudit),
    };
    if (accounting) {
        summary.accounting_sha256 = digest(accounting);
        summary.accounting_ref = reference;
        summary.financial_totals = Object.fromEntries(Object.entries(accounting.holdings?.metrics || {})
            .filter(([key]) => key !== 'tickerSummaries'));
        summary.rendered_holdings_summary = accounting.holdings?.summary_dom;
        summary.curve_summary = Object.fromEntries(Object.entries(accounting.curves || {}).map(([range, curve]) => [range,
            {points: curve.dates.length, first_date: curve.dates[0], last_date: curve.dates.at(-1),
                first_equity: curve.equity[0], last_equity: curve.equity.at(-1), sha256: digest(curve)}]));
        summary.complete_daily_point_count = accounting.complete_daily_points?.length;
    }
    return summary;
}

async function treeDigests(root, sourceOnly = false) {
    const files = {};
    const visit = async (directory) => {
        for (const entry of (await fsp.readdir(directory, {withFileTypes: true})).sort((a, b) => a.name.localeCompare(b.name))) {
            if (entry.name.startsWith('.') || entry.name === '__pycache__') continue;
            const file = path.join(directory, entry.name);
            assert(!entry.isSymbolicLink(), `Fingerprint inputs must not contain symlinks: ${file}`);
            if (entry.isDirectory()) await visit(file);
            else if (!sourceOnly || /\.(py|js|mjs|css|html)$/.test(entry.name)) {
                const raw = await fsp.readFile(file);
                assert.equal(raw.length, (await fsp.stat(file)).size, `Fingerprint input is not fully materialized: ${file}`);
                files[path.relative(root, file)] = createHash('sha256').update(raw).digest('hex');
            }
        }
    };
    await visit(root);
    return files;
}

async function sourceDigests() {
    const files = await treeDigests(path.join(ROOT, 'app'), true);
    for (const relative of ['scripts/ledger_browser_ablation.mjs', 'scripts/ledger_browser_ablation_server.py',
        'scripts/audit_investment_storage_ablation.py', 'package-lock.json']) {
        files[`../${relative}`] = createHash('sha256').update(await fsp.readFile(path.join(ROOT, relative))).digest('hex');
    }
    return files;
}

async function coreInputDigests(settingsRoot) {
    return Object.fromEntries(await Promise.all(CORE_INPUTS.map(async (name) => {
        const file = path.join(settingsRoot, name);
        return [name, fs.existsSync(file) ? createHash('sha256').update(await fsp.readFile(file)).digest('hex') : null];
    })));
}

export async function replayManifest(manifestPath, reportPath) {
    requireAuditLock();
    const manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf8'));
    validateManifest(manifest);
    validateReportPath(reportPath, manifest);
    const lock = spawnSync(manifest.server.python || process.env.WORTHWARD_PYTHON || 'python3',
        [path.join(ROOT, 'scripts/e2e_lock.py'), 'verify', '--root', ROOT], {encoding: 'utf8'});
    assert.equal(lock.status, 0, `The inherited host lock is not active: ${lock.stderr || ''}`);
    const checkpointPath = manifest.checkpoint_path || `${reportPath}.captures.sqlite3`;
    validateCheckpointPath(checkpointPath, manifest);
    await fsp.mkdir(path.dirname(path.resolve(checkpointPath)), {recursive: true});
    const identities = [];
    let frozenInputHashes;
    for (const scenario of manifest.scenarios) {
        const identity = loadScenarioPayload(scenario);
        identities.push({name: scenario.name, raw_sha256: identity.raw_sha256,
            canonical_sha256: identity.canonical_sha256, http_status: scenario.http_status || 200});
        if (identity.payload.success !== false && (scenario.http_status || 200) < 400) {
            const hashes = Object.fromEntries(FROZEN_FIELDS.map((key) => [key, digest(identity.payload[key])]));
            if (!frozenInputHashes) frozenInputHashes = hashes;
            else assert.equal(digest(hashes), digest(frozenInputHashes), 'Market controls changed across scenario inputs.');
        }
    }
    const codeBefore = await sourceDigests();
    const coreBefore = await coreInputDigests(manifest.server.settings_root);
    const runContext = {version: '1.1.0', clock: manifest.clock, timezone: manifest.timezone || 'Asia/Taipei',
        ranges: manifest.ranges || ['max'], scenarios: identities, core_inputs: coreBefore,
        market_inputs: await treeDigests(manifest.server.market_root), source_files: codeBefore,
        frozen_input_sha256: frozenInputHashes, deduplicate_exact_inputs: manifest.deduplicate_exact_inputs === true,
        force_render: [...new Set([...FORCE_RENDER, ...(manifest.force_render || [])])].sort()};
    const contextSha256 = digest(runContext);
    const checkpoint = new CaptureCheckpoint(checkpointPath, runContext, manifest.resume_checkpoint === true);
    const progressPath = `${reportPath}.progress.log`;
    validateCheckpointPath(progressPath, manifest);
    await fsp.mkdir(path.dirname(path.resolve(progressPath)), {recursive: true});
    const progressFd = fs.openSync(progressPath, manifest.resume_checkpoint ? 'a' : 'wx', 0o600);
    const progress = (message) => { console.error(message); fs.writeSync(progressFd, `${new Date().toISOString()} ${message}\n`); };
    const temp = await fsp.mkdtemp(path.join(os.tmpdir(), 'worthward-browser-replay-'));
    const token = randomBytes(24).toString('hex');
    const server = startServer(path.resolve(manifestPath), manifest, token, path.join(temp, 'bytecode'));
    let browser;
    let cleanupPromise;
    const cleanup = () => {
        if (!cleanupPromise) cleanupPromise = (async () => {
            try {
                if (browser) await Promise.race([browser.close(), new Promise((resolve) => setTimeout(resolve, 5000))]);
            } finally {
                try { await stopServer(server.child); }
                finally {
                    for (const pid of descendantPids()) { try { process.kill(pid, 'SIGTERM'); } catch { /* Already exited. */ } }
                    await new Promise((resolve) => setTimeout(resolve, 100));
                    for (const pid of descendantPids()) { try { process.kill(pid, 'SIGKILL'); } catch { /* Already exited. */ } }
                    await fsp.rm(temp, {recursive: true, force: true});
                    fs.closeSync(progressFd);
                    checkpoint.close();
                }
            }
        })();
        return cleanupPromise;
    };
    const interrupt = () => { cleanup().finally(() => process.exit(130)); };
    process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
    const report = {report_version: '1.1.0', clock: manifest.clock, timezone: manifest.timezone || 'Asia/Taipei', progress_log: path.resolve(progressPath), scenarios: [], auxiliary_responses: {},
        checkpoint: {path: path.resolve(checkpointPath), context_sha256: contextSha256, source_sha256: digest(codeBefore),
            source_file_count: Object.keys(codeBefore).length, format: 'SQLite v1; zlib-compressed canonical JSON records with SHA-256'},
        verified_static_assets: {},
        interpretation_limits: ['Browser accounting uses the real application page and functions; observational hooks only publish existing runtime results.',
            'Frozen market/FX/quote data and auxiliary GET responses come from the first real scenario and isolated baseline server.',
            'Exact-input reuse is disclosed per case; the full-cold, no-cache, and conflicting-legacy controls always render independently.',
            'Full financial captures and every numerical chart point are stored losslessly in the referenced compressed SQLite checkpoint.',
            'Missing intraday bars remain gaps or the application fallback; no fabricated bars are supplied.',
            'Python audit hooks do not constitute complete OS-level tracing of arbitrary native C I/O.']};
    try {
        const ready = await server.ready;
        const base = new URL(ready.base_url);
        assert.equal(base.hostname, '127.0.0.1'); assert.notEqual(base.port, '8688');
        report.server = ready;
        const {chromium, request: apiRequest} = await import('playwright-core');
        browser = await chromium.launch({headless: true});
        const auditSnapshot = async () => {
            const response = await fetch(`${base.origin}/__ledger_browser_audit_status`, {
                headers: {'X-Worthward-Browser-Audit': token}, signal: AbortSignal.timeout(15_000),
            });
            assert(response.ok, 'Unable to preserve the browser server access audit.');
            const audit = await response.json();
            assert.equal(audit.production_access_attempts.length, 0);
            return audit;
        };
        const savedAuxiliary = checkpoint.read('auxiliary');
        const frozen = new Map(Object.entries(savedAuxiliary?.value.responses || {})), inflight = new Map();
        if (savedAuxiliary) report.verified_static_assets = savedAuxiliary.value.verified_static_assets;
        const reusable = new Map();
        let baselineAccounting, auxiliaryFrozen = Boolean(savedAuxiliary);
        const persist = (measured) => {
            const refs = checkpoint.write([['auxiliary', {responses: Object.fromEntries(frozen),
                verified_static_assets: report.verified_static_assets}], [`case/${measured.name}`, measured]]);
            const summary = compactCase(measured, refs[`case/${measured.name}`]);
            report.scenarios.push(summary);
            return summary;
        };
        for (const scenario of manifest.scenarios) {
            const scenarioStarted = Date.now();
            progress(`Browser replay: ${scenario.name}`);
            const identity = loadScenarioPayload(scenario);
            const payload = identity.payload;
            const expectedIdentity = identities.find((item) => item.name === scenario.name);
            assert.equal(identity.raw_sha256, expectedIdentity.raw_sha256);
            assert.equal(identity.canonical_sha256, expectedIdentity.canonical_sha256);
            const inputKey = exactInputKey(scenario, identity, contextSha256, digest(Object.fromEntries(frozen)));
            const saved = loadCommittedCase(checkpoint, scenario.name);
            if (saved?.value.completed === true) {
                assert.equal(saved.value.input_sha256, identity.raw_sha256);
                assert.equal(saved.value.canonical_input_sha256, identity.canonical_sha256);
                assert.equal(saved.value.auxiliary_sha256, digest(Object.fromEntries(frozen)));
                if (saved.value.render_mode === 'actual_browser') assert.equal(saved.value.server_audit?.production_access_attempts.length, 0,
                    'A resumed capture is missing its original server access audit.');
                const summary = compactCase(saved.value, saved.ref);
                summary.resumed_from_checkpoint = true;
                report.scenarios.push(summary);
                if (saved.value.accounting && !baselineAccounting) baselineAccounting = saved.value.accounting;
                if (saved.value.render_mode === 'actual_browser') reusable.set(inputKey, summary);
                progress(`Resumed committed capture: ${scenario.name}`);
                continue;
            }
            if (canReuseExactInput(manifest, scenario) && reusable.has(inputKey)) {
                const source = reusable.get(inputKey);
                const reused = {...source, name: scenario.name, input_sha256: identity.raw_sha256,
                    canonical_input_sha256: identity.canonical_sha256, render_mode: 'reused_exact_input',
                    reused_exact_input_from: source.name, rerender_performed: false, completed: true,
                    auxiliary_sha256: digest(Object.fromEntries(frozen)), elapsed_ms: Date.now() - scenarioStarted};
                delete reused.capture_ref;
                persist(reused);
                progress(`Committed exact-input reference: ${scenario.name} <- ${source.name}`);
                continue;
            }
            const context = await browser.newContext({viewport: {width: 1440, height: 1000}, locale: 'en-US',
                timezoneId: manifest.timezone || 'Asia/Taipei', reducedMotion: 'reduce', extraHTTPHeaders: {'X-Worthward-Browser-Audit': token}, serviceWorkers: 'block'});
            const page = await context.newPage();
            const pageErrors = [], blockedRequests = [], auxiliaryKeys = new Set();
            page.on('pageerror', (error) => { pageErrors.push(error.message); progress(`Page error: ${error.message}`); });
            await page.clock.setFixedTime(new Date(manifest.clock));
            await page.route('**/*', async (route) => {
                const request = route.request(), url = new URL(request.url());
                if (url.origin !== base.origin || !['GET', 'HEAD'].includes(request.method())) {
                    blockedRequests.push({url: request.url(), method: request.method()}); await route.abort(); return;
                }
                if (url.pathname === '/api/investment/transactions') {
                    await route.fulfill({status: scenario.http_status || 200, contentType: 'application/json', body: JSON.stringify(payload)}); return;
                }
                if (url.pathname === '/static/assets/js/investment.js') {
                    const response = await route.fetch();
                    await route.fulfill({response, body: instrumentEntry(await response.text())}); return;
                }
                if (url.pathname.startsWith('/static/assets/js/vendor/chart/')) {
                    const response = await route.fetch();
                    const body = await response.body();
                    const sourcePath = path.join(ROOT, 'app/web', url.pathname.slice(1));
                    const expected = await fsp.readFile(sourcePath);
                    assert.equal(expected.length, (await fsp.stat(sourcePath)).size, `The source chart asset is not materialized: ${sourcePath}`);
                    assert.equal(body.length, expected.length, `The served chart asset is incomplete: ${url.pathname}`);
                    const sha256 = createHash('sha256').update(body).digest('hex');
                    assert.equal(sha256, createHash('sha256').update(expected).digest('hex'));
                    report.verified_static_assets[url.pathname] = {bytes: body.length, sha256};
                    await route.fulfill({response, body}); return;
                }
                if (url.pathname.startsWith('/api/')) {
                    const key = url.pathname + '?' + [...url.searchParams].sort().map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`).join('&');
                    auxiliaryKeys.add(key);
                    if (!frozen.has(key)) {
                        assert(!auxiliaryFrozen, `A later scenario requested an unfrozen auxiliary input: ${key}`);
                        if (!inflight.has(key)) inflight.set(key, (async () => {
                            const response = await route.fetch({timeout: 120_000});
                            const stored = {status: response.status(), content_type: response.headers()['content-type'] || 'application/json', body: await response.text()};
                            frozen.set(key, stored); return stored;
                        })());
                        await inflight.get(key);
                    }
                    const saved = frozen.get(key);
                    await route.fulfill({status: saved.status, contentType: saved.content_type, body: saved.body}); return;
                }
                await route.continue();
            });
            const measured = {name: scenario.name, input_sha256: identity.raw_sha256,
                canonical_input_sha256: identity.canonical_sha256, http_status: scenario.http_status || 200,
                render_mode: 'actual_browser', rerender_performed: false};
            try {
                await page.goto(`${base.origin}/trade/investment?view=holdings`, {waitUntil: 'domcontentloaded', timeout: 120_000});
                progress(`Page loaded: ${scenario.name}`);
                if (payload.success === false || measured.http_status >= 400) {
                    await page.waitForFunction(() => /Failed to load|Unable to load/.test(document.querySelector('#investment_import_feedback')?.textContent || ''), null, {timeout: 60_000});
                    measured.rendered_error = await page.locator('#investment_import_feedback').innerText();
                    measured.negative_state = await page.evaluate(() => {
                        const runtime = window.__LEDGER_BROWSER_RUNTIME;
                        const transactions = window.WORTHWARD_INVESTMENT_DATA?.transactions || [];
                        const summaries = runtime.state.investmentTickerSummariesCache || [];
                        const chartPresent = Boolean(runtime.state.investmentEquityChartInstance);
                        return {transaction_count: transactions.length, summary_count: summaries.length,
                            chart_present: chartPresent, failed_closed: transactions.length === 0 && summaries.length === 0 && !chartPresent};
                    });
                    assert(measured.negative_state.failed_closed, `Failed input ${scenario.name} exposed computed financial output.`);
                } else {
                    const count = payload.transactions?.length || 0;
                    progress(`Capturing accounting: ${scenario.name}`);
                    measured.accounting = await capturePage(page, manifest.ranges || ['max'], count);
                    assert(!measured.accounting.aggregate_blocked, `Aggregate accounting is blocked for ${scenario.name}; no complete P&L/curve capture is possible.`);
                    await page.evaluate(async () => {
                        const runtime = window.__LEDGER_BROWSER_RUNTIME;
                        runtime.state.selectedInvestmentEquityRange = 'max';
                        runtime.state.investmentBrokerSummarySelectedCode = 'all';
                        runtime.setInvestmentView('holdings', {syncHash: false});
                        await runtime.fetchInvestmentData();
                    });
                    progress(`Capturing rerender: ${scenario.name}`);
                    let rerendered = await capturePage(page, manifest.ranges || ['max'], count);
                    measured.rerender_performed = true;
                    measured.rerender_stable = digest(measured.accounting) === digest(rerendered);
                    measured.rerender_comparison = compareAccounting(measured.accounting, rerendered);
                    if (!measured.rerender_stable) {
                        measured.rerendered_accounting = rerendered;
                        measured.completed = false;
                        measured.auxiliary_sha256 = digest(Object.fromEntries(frozen));
                        measured.server_audit = await auditSnapshot();
                        persist(measured);
                        console.error(JSON.stringify(measured.rerender_comparison).slice(0, 3000));
                    }
                    assert(measured.rerender_stable, `Browser rerender changed accounting for ${scenario.name}.`);
                    rerendered = null;
                    measured.comparison = baselineAccounting ? compareAccounting(baselineAccounting, measured.accounting) : null;
                    if (!baselineAccounting) baselineAccounting = measured.accounting;
                    auxiliaryFrozen = true;
                }
                measured.page_errors = pageErrors;
                measured.blocked_requests = blockedRequests;
                measured.auxiliary_keys = [...auxiliaryKeys].sort();
                measured.elapsed_ms = Date.now() - scenarioStarted;
                assert.equal(pageErrors.length, 0, `Browser errors in ${scenario.name}: ${pageErrors.join('; ')}`);
                measured.completed = true;
                measured.auxiliary_sha256 = digest(Object.fromEntries(frozen));
                measured.server_audit = await auditSnapshot();
                const summary = persist(measured);
                reusable.set(exactInputKey(scenario, identity, contextSha256, measured.auxiliary_sha256), summary);
                progress(`Committed browser capture: ${scenario.name}`);
            } finally { await context.close(); }
        }
        report.auxiliary_responses = Object.fromEntries([...frozen].map(([key, item]) => [key,
            {status: item.status, content_type: item.content_type, bytes: Buffer.byteLength(item.body),
                sha256: createHash('sha256').update(item.body).digest('hex')}]));
        report.auxiliary_capture_ref = checkpoint.read('auxiliary')?.ref;
        const status = await apiRequest.newContext({extraHTTPHeaders: {'X-Worthward-Browser-Audit': token}});
        try { report.server_audit = await (await status.get(`${base.origin}/__ledger_browser_audit_status`)).json(); }
        finally { await status.dispose(); }
        assert.equal(report.server_audit.production_access_attempts.length, 0);
        report.baseline_core_inputs_unchanged = digest(coreBefore) === digest(await coreInputDigests(manifest.server.settings_root));
        assert(report.baseline_core_inputs_unchanged, 'The browser server rewrote a prepared core input.');
        report.frozen_input_sha256 = frozenInputHashes;
        report.source_code_unchanged = digest(codeBefore) === digest(await sourceDigests());
        assert(report.source_code_unchanged, 'Application source changed while browser captures were running.');
        report.actual_browser_cases = report.scenarios.filter((item) => item.render_mode === 'actual_browser').map((item) => item.name);
        report.actual_browser_cases_this_run = report.scenarios.filter((item) => item.render_mode === 'actual_browser'
            && !item.resumed_from_checkpoint).map((item) => item.name);
        report.reused_exact_input_cases = report.scenarios.filter((item) => item.render_mode === 'reused_exact_input').map((item) => item.name);
        report.acceptance = assessAcceptance(report.scenarios);
        report.acceptance.all_checkpointed_server_access_audits_safe = report.scenarios.every((item) =>
            item.server_audit_summary?.production_access_attempts?.length === 0);
        report.complete = Object.values(report.acceptance).every(Boolean);
        await fsp.mkdir(path.dirname(path.resolve(reportPath)), {recursive: true});
        const finalReference = checkpoint.write([['report', report]]).report;
        report.report_capture_ref = finalReference;
        const finalFd = fs.openSync(reportPath, 'wx', 0o600);
        try { fs.writeFileSync(finalFd, JSON.stringify(report, null, 2) + '\n'); fs.fsyncSync(finalFd); }
        finally { fs.closeSync(finalFd); }
        assert(report.complete, 'Browser accounting acceptance failed; inspect the preserved report.');
        return report;
    } finally {
        try { await cleanup(); }
        finally { process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt); }
    }
}

async function main() {
    const options = Object.fromEntries(process.argv.slice(2).reduce((rows, item, index, args) => {
        if (item.startsWith('--')) rows.push([item.slice(2), args[index + 1]]); return rows;
    }, []));
    assert(options.manifest && options.report, 'Use --manifest <isolated.json> --report <new.json>.');
    const result = await replayManifest(options.manifest, options.report);
    console.log(JSON.stringify({report: path.resolve(options.report), complete: result.complete,
        scenarios: result.scenarios.map((item) => ({name: item.name, rerender_stable: item.rerender_stable, has_accounting: item.has_accounting, render_mode: item.render_mode}))}));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
}
