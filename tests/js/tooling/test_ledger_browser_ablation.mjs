/* Guard isolated browser accounting inputs and preserve numerical evidence. Code version: v1.1.0 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {deflateSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {
    assessAcceptance, canonical, canReuseExactInput, CaptureCheckpoint, compactCase, compareAccounting,
    digest, exactInputKey, instrumentEntry, loadCommittedCase, loadScenarioPayload, pathIsWithin, requireAuditLock,
    validateCheckpointPath, validateManifest, validateReportPath,
} from '../../../scripts/ledger_browser_ablation.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function temporaryManifest(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'worthward-browser-guards-'));
    t.after(() => fs.rmSync(root, {recursive: true, force: true}));
    return {root, manifest: {
        version: '1.0.0', clock: '2026-11-06T02:00:00.000Z',
        server: {settings_root: path.join(root, 'case/settings_store'), market_root: path.join(root, 'case/market_store'), compute_root: path.join(root, 'case/compute')},
        protected_roots: [path.join(root, 'original/settings_store')],
        scenarios: [{name: 'baseline', payload_path: path.join(root, 'payload.json')}], ranges: ['max', '1w'],
    }};
}

test('browser accounting requires a host audit lock', () => {
    assert.throws(() => requireAuditLock({}), /e2e_lock/);
});

test('manifest refuses protected paths, case aliases, and source ancestors', (t) => {
    const {manifest} = temporaryManifest(t);
    validateManifest(manifest);
    for (const selected of [path.join(ROOT, 'settings_store'), path.join(ROOT, 'SETTINGS_STORE'), ROOT]) {
        const changed = structuredClone(manifest); changed.server.settings_root = selected;
        assert.throws(() => validateManifest(changed), /isolated/);
    }
});

test('report guards reject data-store aliases and preserve prior evidence', (t) => {
    const {root, manifest} = temporaryManifest(t);
    const report = path.join(root, 'new-report.json');
    validateReportPath(report, manifest);
    assert.throws(() => validateReportPath(path.join(ROOT, 'SETTINGS_STORE/REPORT.JSON'), manifest), /outside/);
    const original = path.join(root, 'original/settings_store');
    fs.mkdirSync(original, {recursive: true});
    const alias = path.join(root, 'source-alias'); fs.symlinkSync(original, alias, 'dir');
    assert(pathIsWithin(path.join(alias, 'future.json'), original));
    assert.throws(() => validateReportPath(path.join(alias, 'future.json'), manifest), /outside/);
    fs.writeFileSync(report, 'Retain the existing report.');
    assert.throws(() => validateReportPath(report, manifest), /new browser report/);
    assert.equal(fs.readFileSync(report, 'utf8'), 'Retain the existing report.');
});

test('observation hook retains the original accounting code and rejects ambiguous targets', () => {
    const source = 'const runtime = {state: {}};\nconst balance = calculateActualLedger();\n    // Load and render transactions\nfetchActualData();';
    const instrumented = instrumentEntry(source);
    assert(instrumented.includes('const balance = calculateActualLedger();'));
    assert(instrumented.includes('fetchActualData();'));
    assert(instrumented.includes('originalAuditMetrics.apply(this, args)'));
    assert.throws(() => instrumentEntry(source + source), /ambiguous/);
    assert.throws(() => instrumentEntry('unrelated module'), /ambiguous/);
});

test('canonical evidence preserves null, explicit nonfinite values, order, and decimal strings', () => {
    const evidence = canonical({amount: '0001.230000', rows: [1, 1, null, NaN, Infinity]});
    assert.deepEqual(evidence, {amount: '0001.230000', rows: [1, 1, null, {$nonfinite: 'NaN'}, {$nonfinite: 'Infinity'}]});
    assert.notEqual(digest(evidence), digest({...evidence, rows: [1, null, 1, NaN, Infinity]}));
});

test('comparisons expose interior curve and current P&L changes without endpoint sampling', () => {
    const baseline = {holdings: {}, broker_metrics: {}, ticker_summaries: [], complete_daily_points: [], current_chart_pnl: {realizedPnl: 5}, curves: {
        max: {dates: ['2026-11-02', '2026-11-03', '2026-11-04'], equity: [100, 105, 110], points: [{}, {}, {}]},
    }};
    const actual = structuredClone(baseline);
    actual.curves.max.equity[1] = 104;
    actual.current_chart_pnl.realizedPnl = null;
    const comparison = compareAccounting(baseline, actual);
    assert.equal(comparison.same_current_chart_pnl, false);
    assert.equal(comparison.curve_differences.max.same_complete_curve, false);
    assert.equal(comparison.curve_differences.max.points.length, 1);
    assert.equal(comparison.curve_differences.max.points[0].index, 1);
    assert.equal(comparison.curve_differences.max.points[0].baseline.equity, 105);
    assert.equal(comparison.curve_differences.max.points[0].actual.equity, 104);
});

test('acceptance rejects changed shadow-control accounting and seeded failure output', () => {
    const scenarios = [{name: 'full_cold', accounting: {}, comparison: null, rerender_stable: true,
        page_errors: [], blocked_requests: [], http_status: 200, render_mode: 'actual_browser'},
    {name: 'conflicting_legacy_files', accounting: {}, comparison: {same_complete_accounting: false},
        rerender_stable: true, page_errors: [], blocked_requests: [], http_status: 200, render_mode: 'actual_browser'},
    {name: 'missing_canonical_with_legacy', negative_state: {failed_closed: false},
        page_errors: [], blocked_requests: [], http_status: 500}];
    const rejected = assessAcceptance(scenarios);
    assert.equal(rejected.all_requested_equivalence_controls_match, false);
    assert.equal(rejected.all_negative_controls_failed_closed, false);
    scenarios[1].comparison.same_complete_accounting = true;
    scenarios[2].negative_state.failed_closed = true;
    assert(Object.values(assessAcceptance(scenarios)).every(Boolean));
});

test('compressed checkpoint commits complete numerical evidence and resumes only identical context', (t) => {
    const {root} = temporaryManifest(t);
    const file = path.join(root, 'captures.sqlite3');
    const context = {clock: '2026-11-06T02:00:00Z', source: 'immutable-source-sha', inputs: ['full-payload-sha']};
    const original = canonical({name: 'full_cold', accounting: {amount: '0001.230000',
        complete_daily_points: [{date: '2026-11-05', equity: 1.23456789}, {date: '2026-11-05', equity: null}],
        curves: {max: {equity: [1, 1, null, NaN], dates: ['a', 'a', 'b', 'c']}}}});
    const checkpoint = new CaptureCheckpoint(file, context);
    const refs = checkpoint.write([['auxiliary', {body: '{"rates":[1,1,null]}'}], ['case/full_cold', original]]);
    assert(refs['case/full_cold'].compressed_bytes < refs['case/full_cold'].raw_bytes);
    assert.deepEqual(checkpoint.read('case/full_cold').value, original);
    checkpoint.close();
    assert.throws(() => new CaptureCheckpoint(file, context), /explicit resume/);
    assert.throws(() => new CaptureCheckpoint(file, {...context, clock: 'changed'}, true), /context changed/);
    const resumed = new CaptureCheckpoint(file, context, true);
    assert.deepEqual(resumed.read('case/full_cold').value, original);
    assert.equal(resumed.read('missing'), null);
    resumed.close();
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

test('checkpoint rejects altered compressed evidence and data-store output aliases', (t) => {
    const {root, manifest} = temporaryManifest(t);
    assert.throws(() => validateCheckpointPath(path.join(ROOT, 'SETTINGS_STORE/captures.sqlite3'), manifest), /outside/);
    const file = path.join(root, 'captures.sqlite3');
    const checkpoint = new CaptureCheckpoint(file, {});
    checkpoint.write([['case/a', {equity: [1, 2, 3]}]]);
    checkpoint.db.prepare('UPDATE records SET sha256 = ? WHERE record_key = ?').run('0'.repeat(64), 'case/a');
    assert.throws(() => checkpoint.read('case/a'), /Damaged checkpoint/);
    checkpoint.close();
    const alias = path.join(root, 'alias.sqlite3'); fs.linkSync(file, alias);
    assert.throws(() => validateCheckpointPath(alias, {...manifest, resume_checkpoint: true}), /hardlinks/);
});

test('checkpoint rolls back a partial case transaction and never resumes over failed accounting', (t) => {
    const {root} = temporaryManifest(t);
    const checkpoint = new CaptureCheckpoint(path.join(root, 'captures.sqlite3'), {});
    assert.throws(() => checkpoint.write([['case/partial', {equity: [1, 2]}], ['cannot-serialize', {value: 1n}]]));
    assert.equal(checkpoint.read('case/partial'), null);
    assert(checkpoint.read('context'));
    checkpoint.write([['case/unstable', {completed: false, accounting: {equity: [1]}, rerendered_accounting: {equity: [2]}}]]);
    assert.throws(() => loadCommittedCase(checkpoint, 'unstable'), /preserves a failed/);
    assert.deepEqual(checkpoint.read('case/unstable').value.rerendered_accounting, {equity: [2]});
    checkpoint.close();
});

test('compressed transport independently proves full original bytes and canonical payload', (t) => {
    const {root} = temporaryManifest(t);
    const file = path.join(root, 'payloads.sqlite3');
    const raw = Buffer.from('{"success":true,"transactions":[{"amount":"1.2300"},{"amount":"1.2300"}],"extra":{"nullable":null}}');
    const sha256 = createHash('sha256').update(raw).digest('hex');
    const db = new DatabaseSync(file);
    db.exec(`PRAGMA application_id = 1465336148; PRAGMA user_version = 1;
        CREATE TABLE payloads(payload_key TEXT PRIMARY KEY, raw_sha256 TEXT NOT NULL, raw_bytes INTEGER NOT NULL,
            codec TEXT NOT NULL, payload BLOB NOT NULL) WITHOUT ROWID;`);
    db.prepare('INSERT INTO payloads VALUES (?, ?, ?, ?, ?)').run('full_cold', sha256, raw.length, 'zlib', deflateSync(raw));
    db.close();
    const scenario = {name: 'full_cold', payload_database: file, payload_key: 'full_cold', input_sha256: sha256};
    const result = loadScenarioPayload(scenario);
    assert.deepEqual(result.payload, JSON.parse(raw));
    assert.equal(result.raw_sha256, sha256);
    assert.equal(result.canonical_sha256, digest(JSON.parse(raw)));
    assert.throws(() => loadScenarioPayload({...scenario, input_sha256: '0'.repeat(64)}), /Transport identity/);
});

test('dedup identity includes every payload field and HTTP status and force-renders shadow controls', () => {
    const manifest = {deduplicate_exact_inputs: true};
    for (const name of ['full_cold', 'sqlite_without_cache', 'conflicting_legacy_files']) {
        assert.equal(canReuseExactInput(manifest, {name}), false);
    }
    assert.equal(canReuseExactInput(manifest, {name: 'sqlite_with_cache'}), true);
    assert.equal(canReuseExactInput({}, {name: 'sqlite_with_cache'}), false);
    const identity = {raw_sha256: 'raw', canonical_sha256: 'canonical'};
    const key = exactInputKey({http_status: 200}, identity, 'code-clock-market-context', 'aux');
    for (const changed of [
        exactInputKey({http_status: 500}, identity, 'code-clock-market-context', 'aux'),
        exactInputKey({http_status: 200}, {...identity, raw_sha256: 'different-extra-field'}, 'code-clock-market-context', 'aux'),
        exactInputKey({http_status: 200}, identity, 'changed-clock', 'aux'),
        exactInputKey({http_status: 200}, identity, 'code-clock-market-context', 'changed-aux'),
    ]) assert.notEqual(key, changed);
});

test('compact report retains totals and references complete numerical evidence without duplicating it', () => {
    const measured = {name: 'full_cold', server_audit: {production_access_attempts: [], outbound_connection_attempts: [],
        attempted_data_opens: {'settings_store/investment.sqlite3': 1}},
    accounting: {holdings: {metrics: {cumulativePnl: 1.23, tickerSummaries: [{ticker: 'X'}]}},
        curves: {max: {dates: ['a', 'b', 'c'], equity: [100, 95, 110], points: [{}, {}, {}]}},
        complete_daily_points: [{}, {}, {}]}, comparison: {same_complete_accounting: false,
        curve_differences: {max: {same_complete_curve: false, points: [{index: 1}]}}}};
    const reference = {database: '/isolated/capture.sqlite3', record_key: 'case/full_cold', sha256: 'full-sha'};
    const summary = compactCase(measured, reference);
    assert(!('accounting' in summary));
    assert.equal(summary.has_accounting, true);
    assert.deepEqual(summary.financial_totals, {cumulativePnl: 1.23});
    assert.equal(summary.curve_summary.max.points, 3);
    assert.equal(summary.comparison.curve_differences.max.changed_point_count, 1);
    assert.deepEqual(summary.accounting_ref, reference);
    assert(!('server_audit' in summary));
    assert.equal(summary.server_audit_summary.data_open_key_count, 1);
    assert.equal(summary.server_audit_summary.sha256, digest(measured.server_audit));
});
