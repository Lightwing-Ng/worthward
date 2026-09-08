/* Code version: v0.1.0 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
    THESIS_STORAGE_KEY,
    buildResearchBrief,
    deleteThesisDraft,
    formatResearchDate,
    mountThesisLab,
    parseResearchDate,
    readLinkedHypothesis,
    readThesisDraft,
    saveThesisDraft,
    validateResearchThesis,
} from '../app/web/static/assets/js/beta-notebook.js';

const research = () => ({
    hypothesis: 'Reducing the form to one question improves task completion.',
    supportingEvidence: '',
    counterevidence: '',
    falsificationTrigger: 'Completion is no better than the unchanged form in the held-out trial.',
    dataCutoff: '2026-09-07',
    testDeadline: '2026-10-07',
    reviewDate: '2026-10-08',
});

function memoryStorage() {
    const values = new Map([['worthward:settings', 'preserve']]);
    const writes = [];
    return {
        values,
        writes,
        getItem(key) { return values.get(key) ?? null; },
        setItem(key, value) { writes.push(key); values.set(key, value); },
        removeItem(key) { writes.push(key); values.delete(key); },
    };
}

test('research brief preserves unknown evidence and separates instructions from results', () => {
    const brief = buildResearchBrief(research());
    assert.match(brief, /## Proponent/);
    assert.match(brief, /## Skeptic/);
    assert.match(brief, /## Experimenter/);
    assert.match(brief, /Counterevidence supplied by the user\n> Not provided\./);
    assert.match(brief, /Data cutoff: 7 Sep 2026/);
    assert.match(brief, /Test deadline: 7 Oct 2026/);
    assert.match(brief, /future-data leakage/);
    assert.match(brief, /publication lags/);
    assert.match(brief, /not an AI analysis or a verified conclusion/);
    assert.match(brief, /does not contact a model/);
    assert.throws(() => buildResearchBrief({}), /Hypothesis is required/);
});

test('date parsing validates real calendar days and formats independently of local time', () => {
    assert.equal(parseResearchDate('29 Feb 2024'), '2024-02-29');
    assert.equal(parseResearchDate('29 Feb 2026'), null);
    assert.equal(parseResearchDate('2026-04-31'), null);
    assert.equal(parseResearchDate('0000-01-01'), null);
    assert.equal(parseResearchDate('7 sep 2026'), '2026-09-07');
    assert.equal(formatResearchDate('2026-09-07'), '7 Sep 2026');
    assert.equal(formatResearchDate('invalid'), '');
});

test('complete briefs enforce a falsification trigger, chronology, types, and bounded notes', () => {
    assert.equal(validateResearchThesis({...research(), hypothesis: 'x'.repeat(2001)}).valid, false);
    assert.equal(validateResearchThesis({...research(), falsificationTrigger: ''}).valid, false);
    assert.equal(validateResearchThesis({...research(), supportingEvidence: 17}).valid, false);
    assert.equal(validateResearchThesis({...research(), testDeadline: '2026-09-06'}).valid, false);
    assert.equal(validateResearchThesis({...research(), reviewDate: '2026-09-06'}).valid, false);
    assert.equal(validateResearchThesis({}, {complete: false}).valid, true);
    assert.equal(validateResearchThesis(null).valid, false);
});

test('draft saving and deletion touch only the namespaced experiment key', () => {
    const storage = memoryStorage();
    assert.deepEqual(readThesisDraft(storage), {ok: true, data: null});
    assert.equal(saveThesisDraft(storage, research()).ok, true);
    assert.deepEqual(readThesisDraft(storage).data, research());
    assert.equal(deleteThesisDraft(storage).ok, true);
    assert.deepEqual([...storage.values], [['worthward:settings', 'preserve']]);
    assert.deepEqual(storage.writes, [THESIS_STORAGE_KEY, THESIS_STORAGE_KEY]);
});

test('unavailable storage and damaged or incompatible drafts fail without overwriting data', () => {
    const storage = memoryStorage();
    for (const value of ['{bad json', JSON.stringify({version: 2, data: research()}),
        JSON.stringify({version: 1, data: {hypothesis: ['invalid']}})]) {
        storage.values.set(THESIS_STORAGE_KEY, value);
        assert.equal(readThesisDraft(storage).ok, false);
        assert.equal(storage.values.get(THESIS_STORAGE_KEY), value);
    }
    const unavailable = {
        getItem() { throw new Error('blocked'); },
        setItem() { throw new Error('quota'); },
        removeItem() { throw new Error('blocked'); },
    };
    assert.equal(readThesisDraft(unavailable).ok, false);
    assert.equal(saveThesisDraft(unavailable, research()).ok, false);
    assert.equal(deleteThesisDraft(unavailable).ok, false);
    assert.equal(saveThesisDraft(null, research()).ok, false);
    assert.deepEqual(storage.writes, []);
});

function labRoot(data = research()) {
    const nodes = new Map();
    const listeners = new Map();
    const element = (dataset = {}) => ({
        dataset, value: '', textContent: '', disabled: false, hidden: false,
        matches(selector) { return selector === '[data-thesis-field]' && Boolean(this.dataset.thesisField); },
        closest() { return this; },
        setAttribute(name, value) { this[name] = value; },
        removeAttribute(name) { delete this[name]; },
    });
    for (const [field, value] of Object.entries(data)) {
        const node = element({thesisField: field});
        node.value = value;
        nodes.set(`[data-thesis-field="${field}"]`, node);
    }
    for (const action of ['build', 'save', 'delete', 'copy', 'download']) {
        nodes.set(`[data-thesis-action="${action}"]`, element({thesisAction: action}));
    }
    for (const name of ['draft-status', 'action-status', 'brief']) {
        nodes.set(`[data-thesis-${name}]`, element());
    }
    return {
        dataset: {},
        nodes,
        querySelector(selector) { return nodes.get(selector); },
        contains(node) { return [...nodes.values()].includes(node); },
        addEventListener(event, listener) { listeners.set(event, listener); },
        async click(action) { return listeners.get('click')({target: nodes.get(`[data-thesis-action="${action}"]`)}); },
        input(field, value) {
            const target = nodes.get(`[data-thesis-field="${field}"]`);
            target.value = value;
            listeners.get('input')({target});
        },
    };
}

test('browser editing renders notes as text and invalidates an old export immediately', async () => {
    const root = labRoot({...research(), hypothesis: '<img src=x onerror=alert(1)>'});
    const storage = memoryStorage();
    mountThesisLab(root, {storage});
    await root.click('build');
    const output = root.querySelector('[data-thesis-brief]');
    assert.match(output.textContent, /> <img src=x onerror=alert\(1\)>/);
    assert.equal(output.innerHTML, undefined);
    assert.equal(root.querySelector('[data-thesis-action="copy"]').disabled, false);
    root.input('hypothesis', 'A changed claim');
    assert.equal(output.textContent, '');
    assert.equal(root.querySelector('[data-thesis-action="copy"]').disabled, true);
    assert.equal(root.querySelector('[data-thesis-action="download"]').disabled, true);
    assert.equal(root.querySelector('[data-thesis-draft-status]').dataset.state, 'unsaved');
    assert.deepEqual(storage.writes, []);
});

test('clipboard reports pending until completion and reports rejection as failure', async () => {
    let rejectCopy;
    const clipboard = {writeText: () => new Promise((resolve, reject) => { rejectCopy = reject; })};
    const root = labRoot();
    mountThesisLab(root, {storage: memoryStorage(), clipboard});
    await root.click('build');
    const pending = root.click('copy');
    assert.equal(root.querySelector('[data-thesis-action-status]').dataset.state, 'pending');
    assert.equal(root.querySelector('[data-thesis-action="copy"]').disabled, true);
    rejectCopy(new Error('denied'));
    await pending;
    assert.equal(root.querySelector('[data-thesis-action-status]').dataset.state, 'error');
    assert.match(root.querySelector('[data-thesis-action-status]').textContent, /not copied/);
    assert.equal(root.querySelector('[data-thesis-action="copy"]').disabled, false);
});

test('failed saves never display saved state; deleting a draft keeps the current inputs', async () => {
    const root = labRoot();
    mountThesisLab(root, {storage: null});
    await root.click('save');
    assert.equal(root.querySelector('[data-thesis-draft-status]').dataset.state, 'error');
    assert.match(root.querySelector('[data-thesis-draft-status]').textContent, /not saved/);
    const savedRoot = labRoot();
    const storage = memoryStorage();
    mountThesisLab(savedRoot, {storage});
    await savedRoot.click('save');
    await savedRoot.click('delete');
    assert.equal(savedRoot.querySelector('[data-thesis-field="hypothesis"]').value, research().hypothesis);
    assert.equal(savedRoot.querySelector('[data-thesis-draft-status]').dataset.state, 'unsaved');
    assert.equal(storage.values.has(THESIS_STORAGE_KEY), false);
});

test('a linked hypothesis takes precedence without modifying or mixing in a saved draft', () => {
    const storage = memoryStorage();
    saveThesisDraft(storage, research());
    const before = storage.values.get(THESIS_STORAGE_KEY);
    const root = labRoot();
    mountThesisLab(root, {storage, search: '?hypothesis=Linked%20research%20question'});
    assert.equal(root.querySelector('[data-thesis-field="hypothesis"]').value, 'Linked research question');
    assert.equal(root.querySelector('[data-thesis-field="falsificationTrigger"]').value, '');
    assert.equal(root.querySelector('[data-thesis-field="dataCutoff"]').value, '');
    assert.equal(root.querySelector('[data-thesis-draft-status]').dataset.state, 'unsaved');
    assert.equal(storage.values.get(THESIS_STORAGE_KEY), before);
    assert.equal(readLinkedHypothesis('?unrelated=value'), null);
    assert.equal(readLinkedHypothesis(`?hypothesis=${'x'.repeat(2001)}`).ok, false);
    assert.equal(readLinkedHypothesis('?hypothesis=').data.hypothesis, '');
});
