/* Tests for the shared numeric display contract. Code version: v1.0.0 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    NUMERIC_DISPLAY_MODULE_VERSION,
    enhanceNumericDisplayElements,
    getNumericDisplayParts,
    parseNumericDisplayValue,
    renderNumericDisplayContent,
} from '../app/web/static/assets/js/numeric-display.js';

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

test('shared renderer escapes raw fallback text', () => {
    assert.equal(
        renderNumericDisplayContent('<Unavailable>'),
        '<span class="workspace-metric-value-major">&lt;Unavailable&gt;</span>',
    );
    assert.equal(
        renderNumericDisplayContent('$ 10,333.71'),
        '<span class="workspace-metric-value-major">$ 10,333</span><span class="workspace-metric-value-minor">.71</span>',
    );
});

test('progressive enhancement renders standalone values and monetary table cells once', () => {
    const valueElement = {
        dataset: {numericDisplayValue: '$7,089.68'},
        textContent: '$7,089.68',
        innerHTML: '',
    };
    const cellElement = {
        dataset: {},
        textContent: '$5,000.00',
        innerHTML: '',
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

    assert.equal(renderedValue, '<span class="workspace-metric-value-major">$7,089</span><span class="workspace-metric-value-minor">.68</span>');
    assert.equal(renderedCell, '<span class="workspace-metric-value-major">$5,000</span><span class="workspace-metric-value-minor">.00</span>');
    assert.equal(valueElement.innerHTML, renderedValue);
    assert.equal(cellElement.innerHTML, renderedCell);
});
