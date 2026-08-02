/* Tests for the shared export-image configuration registry. Code version: v1.0.1 */

import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const SOURCE_PATH = new URL('../app/web/static/assets/js/export-image-config.js', import.meta.url);
const SOURCE = await readFile(SOURCE_PATH, 'utf8');

class FakeElement {
    constructor() {
        this.dataset = {};
        this.style = {
            values: {},
            setProperty: (name, value) => {
                this.style.values[name] = String(value);
            },
        };
    }
}

class FakeStorage {
    constructor() {
        this.values = new Map();
    }

    getItem(key) {
        return this.values.get(key) ?? null;
    }

    setItem(key, value) {
        this.values.set(key, String(value));
    }

    removeItem(key) {
        this.values.delete(key);
    }
}

const createRuntime = (localStorage = new FakeStorage()) => {
    const root = new FakeElement();
    const events = [];
    class FakeCustomEvent {
        constructor(type, init = {}) {
            this.type = type;
            this.detail = init.detail;
        }
    }
    const window = {
        CustomEvent: FakeCustomEvent,
        localStorage,
        dispatchEvent: (event) => events.push(event),
    };
    const context = {
        document: {documentElement: root},
        HTMLElement: FakeElement,
        window,
    };
    vm.runInNewContext(SOURCE, context, {filename: SOURCE_PATH.pathname});
    return {
        api: window.ANTIGRAVITY_EXPORT_IMAGE,
        events,
        localStorage,
        root,
    };
};

test('default profile exposes the stable portrait export contract', () => {
    const runtime = createRuntime();
    const config = runtime.api.getConfig();

    assert.equal(runtime.api.version, 'v0.1.1');
    assert.deepEqual(Array.from(runtime.api.getProfileIds()), ['investment-community-share']);
    assert.equal(config.tokens['--investment-community-share-shell-width'], '1080px');
    assert.equal(config.tokens['--investment-community-share-shell-height'], '1730px');
    assert.equal(config.derived['--investment-community-share-logical-width'], '540px');
    assert.equal(config.derived['--investment-community-share-logical-height'], '865px');
    assert.equal(config.derived['--investment-community-share-export-scale'], '2');
});

test('token changes persist and apply derived dimensions to detached export targets', () => {
    const runtime = createRuntime();
    const target = new FakeElement();
    const config = runtime.api.setToken(
        '--investment-community-share-shell-width',
        '1200px',
        {targets: [runtime.root, target]},
    );

    assert.equal(config.tokens['--investment-community-share-shell-width'], '1200px');
    assert.equal(config.derived['--investment-community-share-logical-width'], '600px');
    assert.equal(target.style.values['--investment-community-share-shell-width'], '1200px');
    assert.equal(target.style.values['--investment-community-share-logical-width'], '600px');
    assert.equal(target.dataset.exportImageTemplate, 'stable-v1');
    assert.equal(runtime.events.at(-1).type, 'antigravity:export-image-config-change');

    const reloaded = createRuntime(runtime.localStorage);
    assert.equal(
        reloaded.api.getConfig().tokens['--investment-community-share-shell-width'],
        '1200px',
    );
});

test('future exporters can register an isolated profile without changing the share profile', () => {
    const runtime = createRuntime();
    assert.equal(runtime.api.registerProfile('future-square-share', {
        template: 'square-v1',
        defaults: {'--future-square-share-gap': '12px'},
    }), true);
    assert.equal(runtime.api.registerProfile('future-square-share', {
        defaults: {'--future-square-share-gap': '20px'},
    }), false);

    const config = runtime.api.setToken(
        '--future-square-share-gap',
        '20px',
        {profileId: 'future-square-share'},
    );
    assert.equal(config.id, 'future-square-share');
    assert.equal(config.template, 'square-v1');
    assert.equal(config.tokens['--future-square-share-gap'], '20px');
    assert.equal(runtime.api.getConfig().tokens['--investment-community-share-card-gap'], '10px');
});
