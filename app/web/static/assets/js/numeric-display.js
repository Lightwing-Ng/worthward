/**
 * Shared numeric display parsing and integer/fraction rendering.
 *
 * Code version: v1.1.0
 * - Added: One parser and renderer for metric values across workspace pages,
 *   Settings previews, Compare, and Investment realtime transitions.
 * - Added: A small browser runtime API for dynamically rendered workspace rows.
 */

export const NUMERIC_DISPLAY_MODULE_VERSION = 'v1.1.0';

const NUMERIC_DISPLAY_PATTERN = /^([+\-]?\*?(?:(?:[A-Z]{3}|\$)\s*)?)(\d[\d,]*)(?:\.(\d+))?(%?)$/;

export function parseNumericDisplayValue(value) {
    const raw = String(value ?? '').trim();
    const normalized = raw || '--';
    const match = normalized.match(NUMERIC_DISPLAY_PATTERN);
    if (!match) {
        return {
            raw: normalized,
            isNumeric: false,
            prefix: '',
            integerPart: '',
            decimalPart: '',
            suffix: '',
        };
    }
    const [, prefix, integerPart, decimalPart = '', suffix = ''] = match;
    return {
        raw: normalized,
        isNumeric: true,
        prefix,
        integerPart,
        decimalPart,
        suffix,
    };
}

export function getNumericDisplayParts(value) {
    const parsed = parseNumericDisplayValue(value);
    if (!parsed.isNumeric) {
        return [{className: 'workspace-metric-value-major', text: parsed.raw}];
    }
    if (!parsed.decimalPart) {
        return [{
            className: 'workspace-metric-value-major',
            text: `${parsed.prefix}${parsed.integerPart}${parsed.suffix}`,
        }];
    }
    return [
        {
            className: 'workspace-metric-value-major',
            text: `${parsed.prefix}${parsed.integerPart}`,
        },
        {className: 'workspace-metric-value-minor', text: `.${parsed.decimalPart}`},
        ...(parsed.suffix
            ? [{className: 'workspace-metric-value-suffix', text: parsed.suffix}]
            : []),
    ];
}

function escapeHtml(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

export function renderNumericDisplayContent(value) {
    return getNumericDisplayParts(value)
        .map((part) => `<span class="${part.className}">${escapeHtml(part.text)}</span>`)
        .join('');
}

function collectMatchingElements(root, selector) {
    if (!root || typeof root.querySelectorAll !== 'function') return [];
    const elements = [];
    if (typeof root.matches === 'function' && root.matches(selector)) elements.push(root);
    elements.push(...root.querySelectorAll(selector));
    return elements;
}

export function enhanceNumericDisplayElements(root = globalThis.document) {
    const valueElements = collectMatchingElements(root, '[data-numeric-display-value]');
    valueElements.forEach((element) => {
        const value = element.dataset.numericDisplayValue ?? element.textContent ?? '';
        if (element.dataset.numericDisplayRendered === value) return;
        element.innerHTML = renderNumericDisplayContent(value);
        element.dataset.numericDisplayRendered = value;
    });

    const cellElements = collectMatchingElements(root, '[data-numeric-display-cell]');
    cellElements.forEach((element) => {
        if (element.dataset.numericDisplayRendered === 'cell') return;
        const parsed = parseNumericDisplayValue(element.textContent);
        if (!parsed.isNumeric || !parsed.decimalPart) return;
        element.innerHTML = renderNumericDisplayContent(parsed.raw);
        element.dataset.numericDisplayRendered = 'cell';
    });
}

const numericDisplayApi = Object.freeze({
    enhanceNumericDisplayElements,
    getNumericDisplayParts,
    parseNumericDisplayValue,
    renderNumericDisplayContent,
});

if (typeof window !== 'undefined') {
    window.WORTHWARD_NUMERIC_DISPLAY = numericDisplayApi;
    window.dispatchEvent(new CustomEvent('worthward:numeric-display-ready'));
}

if (typeof document !== 'undefined') {
    const initializeNumericDisplay = () => enhanceNumericDisplayElements(document);
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeNumericDisplay, {once: true});
    } else {
        initializeNumericDisplay();
    }
}
