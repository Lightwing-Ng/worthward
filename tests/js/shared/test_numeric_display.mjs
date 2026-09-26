/* Tests for the shared numeric display contract. Code version: v1.2.1 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    NUMERIC_DISPLAY_MODULE_VERSION,
    enhanceNumericDisplayElements,
    getCurrencyMinorUnitDigits,
    getMonetaryDisplayParts,
    getNumericDisplayParts,
    parseNumericDisplayValue,
    renderNumericDisplayContent,
} from '../../../app/web/static/assets/js/numeric-display.js';

test('module exposes a semantic cache-busting version', () => {
    assert.match(NUMERIC_DISPLAY_MODULE_VERSION, /^v\d+\.\d+\.\d+$/);
});

test('shared parser handles signs, markers, currencies, separators, and suffixes', () => {
    assert.deepEqual(parseNumericDisplayValue('*8,020.60'), {
        raw: '*8,020.60',
        isNumeric: true,
        prefix: '*',
        integerPart: '8,020',
        decimalPart: '60',
        suffix: '',
    });
    assert.deepEqual(parseNumericDisplayValue('+$ 10,333.71%'), {
        raw: '+$ 10,333.71%',
        isNumeric: true,
        prefix: '+$ ',
        integerPart: '10,333',
        decimalPart: '71',
        suffix: '%',
    });
});

test('shared parts keep the integer and decimal point with the canonical classes', () => {
    assert.deepEqual(getNumericDisplayParts('32.80%'), [
        {className: 'workspace-metric-value-major', text: '32'},
        {className: 'workspace-metric-value-minor', text: '.80'},
        {className: 'workspace-metric-value-suffix', text: '%'},
    ]);
    assert.deepEqual(getNumericDisplayParts('-'), [
        {className: 'workspace-metric-value-major', text: '-'},
    ]);
});

test('monetary parts honor currency minor-unit semantics', () => {
    assert.equal(getCurrencyMinorUnitDigits('RMB'), 2);
    assert.equal(getCurrencyMinorUnitDigits('USD'), 2);
    assert.equal(getCurrencyMinorUnitDigits('JPY'), 0);
    assert.deepEqual(getMonetaryDisplayParts('RMB 5,440.00', 'CNY'), [
        {className: 'workspace-metric-value-major', text: 'RMB 5,440'},
        {className: 'workspace-metric-value-minor', text: '.00'},
    ]);
    assert.deepEqual(getMonetaryDisplayParts('JPY 5,440.00', 'JPY'), [
        {className: 'workspace-metric-value-major', text: 'JPY 5,440.00'},
    ]);
    assert.deepEqual(getNumericDisplayParts('JPY 5,440.00'), [
        {className: 'workspace-metric-value-major', text: 'JPY 5,440.00'},
    ]);
});

test('shared renderer escapes raw fallback text', () => {
    assert.equal(
        renderNumericDisplayContent('<Unavailable>'),
        '<span class="workspace-metric-value-major" aria-hidden="true">&lt;Unavailable&gt;</span>',
    );
    assert.equal(
        renderNumericDisplayContent('$ 10,333.71'),
        '<span class="workspace-metric-value-major" aria-hidden="true">$ 10,333</span><span class="workspace-metric-value-minor" aria-hidden="true">.71</span>',
    );
});

test('progressive enhancement renders standalone values and monetary table cells once', () => {
    const valueElement = {
        dataset: {numericDisplayValue: '$7,089.68'},
        textContent: '$7,089.68',
        innerHTML: '',
        attributes: {},
        setAttribute(name, value) { this.attributes[name] = value; },
    };
    const cellElement = {
        dataset: {},
        textContent: '$5,000.00',
        innerHTML: '',
        attributes: {},
        setAttribute(name, value) { this.attributes[name] = value; },
    };
    const root = {
        querySelectorAll(selector) {
            return selector === '[data-numeric-display-value]' ? [valueElement] : [cellElement];
        },
    };

    enhanceNumericDisplayElements(root);
    const renderedValue = valueElement.innerHTML;
    const renderedCell = cellElement.innerHTML;
    enhanceNumericDisplayElements(root);

    assert.equal(renderedValue, '<span class="workspace-metric-value-major" aria-hidden="true">$7,089</span><span class="workspace-metric-value-minor" aria-hidden="true">.68</span>');
    assert.equal(renderedCell, '<span class="workspace-metric-value-major" aria-hidden="true">$5,000</span><span class="workspace-metric-value-minor" aria-hidden="true">.00</span>');
    assert.equal(valueElement.attributes['aria-label'], '$7,089.68');
    assert.equal(cellElement.attributes['aria-label'], '$5,000.00');
    assert.equal(valueElement.innerHTML, renderedValue);
    assert.equal(cellElement.innerHTML, renderedCell);
});

test('progressive enhancement uses explicit currency metadata', () => {
    const cnyElement = {
        dataset: {numericDisplayValue: 'RMB 5,440.00', currencyCode: 'CNY'},
        textContent: 'RMB 5,440.00',
        innerHTML: '',
        attributes: {},
        setAttribute(name, value) { this.attributes[name] = value; },
    };
    const jpyElement = {
        dataset: {numericDisplayValue: 'JPY 5,440.00', currencyCode: 'JPY'},
        textContent: 'JPY 5,440.00',
        innerHTML: '',
        attributes: {},
        setAttribute(name, value) { this.attributes[name] = value; },
    };
    const root = {
        querySelectorAll(selector) {
            return selector === '[data-numeric-display-value]'
                ? [cnyElement, jpyElement]
                : [];
        },
    };

    enhanceNumericDisplayElements(root);

    assert.match(cnyElement.innerHTML, /workspace-metric-value-minor/);
    assert.doesNotMatch(jpyElement.innerHTML, /workspace-metric-value-minor/);
    assert.equal(cnyElement.attributes['aria-label'], 'RMB 5,440.00');
    assert.equal(jpyElement.attributes['aria-label'], 'JPY 5,440.00');
});
