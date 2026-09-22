/* Shared select adapter state-mirroring tests. Code version: v1.0.1 */

import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(
    new URL('../app/web/static/assets/js/app/select-controls.js', import.meta.url),
    'utf8',
);

class FakeClassList {
    constructor() {
        this.values = new Set();
    }

    add(...values) {
        values.forEach((value) => this.values.add(value));
    }

    contains(value) {
        return this.values.has(value);
    }

    toggle(value, force) {
        if (force === false) this.values.delete(value);
        else this.values.add(value);
    }
}

class FakeHTMLElement {
    constructor() {
        this.attributes = new Map();
        this.children = [];
        this.classList = new FakeClassList();
        this.dataset = {};
        this.hidden = false;
        this.parentElement = null;
        this.textContent = '';
        this.title = '';
    }

    appendChild(child) {
        child.parentElement = this;
        this.children.push(child);
        return child;
    }

    addEventListener() {}

    closest() {
        return null;
    }

    focus() {}

    getAttribute(name) {
        return this.attributes.get(name) ?? null;
    }

    querySelector() {
        return null;
    }

    removeAttribute(name) {
        this.attributes.delete(name);
    }

    setAttribute(name, value) {
        this.attributes.set(name, String(value));
    }
}

class FakeHTMLButtonElement extends FakeHTMLElement {
    constructor() {
        super();
        this.disabled = false;
        this.tabIndex = 0;
        this.type = '';
    }
}

class FakeHTMLImageElement extends FakeHTMLElement {}
class FakeHTMLInputElement extends FakeHTMLElement {}

class FakeHTMLOptionElement extends FakeHTMLElement {
    constructor({value, label, disabled = false, hidden = false, parentDisabled = false}) {
        super();
        this.value = value;
        this.textContent = label;
        this.disabled = disabled;
        this.hidden = hidden;
        this.parentElement = {disabled: parentDisabled};
    }
}

class FakeHTMLSelectElement extends FakeHTMLElement {
    constructor(options) {
        super();
        this.options = options;
        this.value = options[0]?.value || '';
        this.disabled = false;
        this.id = 'native_select';
    }
}

const document = {
    body: new FakeHTMLElement(),
    createElement(tagName) {
        if (tagName === 'button') return new FakeHTMLButtonElement();
        if (tagName === 'img') return new FakeHTMLImageElement();
        return new FakeHTMLElement();
    },
    querySelector() {
        return null;
    },
    querySelectorAll() {
        return [];
    },
};

const context = {
    document,
    Event: class {},
    HTMLElement: FakeHTMLElement,
    HTMLButtonElement: FakeHTMLButtonElement,
    HTMLImageElement: FakeHTMLImageElement,
    HTMLInputElement: FakeHTMLInputElement,
    HTMLOptionElement: FakeHTMLOptionElement,
    HTMLSelectElement: FakeHTMLSelectElement,
    window: {},
};
vm.runInNewContext(source, context);

const createAdapter = () => context.window.WORTHWARD_APP_SELECT_CONTROLS.create({
    $: () => null,
    $$: () => [],
    areAllFilledTickersUs: () => false,
    defaults: {period: '1y', range_mode: 'period'},
    dispatchPortfolioPreviewUpdate() {},
    form: null,
    getFilledTickers: () => [],
    getPortfolioAllocationInputs: () => [],
    getPortfolioAllocationMode: () => '',
    getWeightFields: () => [],
    hidePortfolioWeightTooltips() {},
    isPortfolioView: false,
    isUsTicker: () => false,
    rangeModeInputs: [],
    requestWorkspaceChartTransition() {},
    sanitizeTicker: (value) => value,
    state: {currentView: 'backtest'},
    validatePortfolioWeightInputs: () => true,
});

const fixture = () => {
    const options = [
        new FakeHTMLOptionElement({value: 'ready', label: 'Ready'}),
        new FakeHTMLOptionElement({value: 'hidden', label: 'Hidden', hidden: true}),
        new FakeHTMLOptionElement({value: 'disabled', label: 'Disabled', disabled: true}),
        new FakeHTMLOptionElement({value: 'grouped', label: 'Grouped', parentDisabled: true}),
    ];
    const select = new FakeHTMLSelectElement(options);
    const trigger = new FakeHTMLButtonElement();
    trigger.dataset.sharedSelectTrigger = '';
    const triggerLabel = new FakeHTMLElement();
    triggerLabel.dataset.fallbackLabel = 'Fallback';
    const dropdown = new FakeHTMLElement();
    dropdown.id = 'shared_select_dropdown';
    Object.defineProperty(dropdown, 'innerHTML', {
        set() {
            this.children = [];
        },
    });
    const field = new FakeHTMLElement();
    field.querySelector = (selector) => ({
        select,
        '[data-shared-select-trigger]': trigger,
        '[data-shared-select-trigger-label]': triggerLabel,
        '[data-shared-select-dropdown]': dropdown,
    })[selector] || null;
    return {dropdown, field, select, trigger};
};

test('mirrors native disabled and option availability into the enhanced select', () => {
    const adapter = createAdapter();
    const {dropdown, field, select, trigger} = fixture();

    select.disabled = true;
    adapter.syncSharedSelectTriggerLabel(field);
    assert.equal(trigger.disabled, true);
    assert.equal(field.getAttribute('aria-disabled'), 'true');

    select.disabled = false;
    adapter.syncSharedSelectTriggerLabel(field);
    assert.equal(trigger.disabled, false);
    assert.equal(field.getAttribute('aria-disabled'), null);

    adapter.renderSharedSelectDropdown(field);
    assert.equal(dropdown.children.length, 4);
    assert.equal(dropdown.children[0].hidden, false);
    assert.equal(dropdown.children[0].disabled, false);
    assert.equal(dropdown.children[0].getAttribute('aria-disabled'), null);
    assert.equal(dropdown.children[1].hidden, true);
    assert.equal(dropdown.children[1].disabled, false);
    assert.equal(dropdown.children[2].disabled, true);
    assert.equal(dropdown.children[2].getAttribute('aria-disabled'), 'true');
    assert.equal(dropdown.children[3].disabled, true);
    assert.equal(dropdown.children[3].getAttribute('aria-disabled'), 'true');
});

test('commits an empty value to exactly one native option', () => {
    const adapter = createAdapter();
    const emptyOption = new FakeHTMLOptionElement({value: '', label: 'All'});
    const duplicateEmptyOption = new FakeHTMLOptionElement({value: '', label: 'Fallback'});
    const readyOption = new FakeHTMLOptionElement({value: 'ready', label: 'Ready'});
    const select = new FakeHTMLSelectElement([
        emptyOption,
        duplicateEmptyOption,
        readyOption,
    ]);

    adapter.syncNativeSelectSelection(select, '');

    assert.equal(emptyOption.selected, true);
    assert.equal(emptyOption.defaultSelected, true);
    assert.equal(emptyOption.getAttribute('selected'), 'selected');
    assert.equal(duplicateEmptyOption.selected, false);
    assert.equal(duplicateEmptyOption.defaultSelected, false);
    assert.equal(duplicateEmptyOption.getAttribute('selected'), null);
    assert.equal(readyOption.selected, false);
    assert.equal(readyOption.defaultSelected, false);
});
