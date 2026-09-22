/**
 * Shared numeric display parsing and integer/fraction rendering.
 *
 * Code version: v1.3.0
 * - Added: Currency-aware rendering keeps zero-minor-unit currencies at one
 *   size while reusing the shared integer/fraction treatment elsewhere.
 * - Added: Preserve one complete accessible value while visual fragments stay
 *   hidden from assistive technology.
 * - Added: One parser and renderer for metric values across workspace pages,
 *   Settings previews, Compare, and Investment realtime transitions.
 * - Added: A small browser runtime API for dynamically rendered workspace rows.
 */

export const NUMERIC_DISPLAY_MODULE_VERSION = 'v1.3.0';

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

function getCurrencyCodeFromNumericPrefix(prefix) {
    const normalizedPrefix = String(prefix ?? '')
        .replace(/^[+\-]?\*?/, '')
        .trim()
        .toUpperCase();
    if (normalizedPrefix === '$') return 'USD';
    return /^[A-Z]{3}$/.test(normalizedPrefix) ? normalizedPrefix : '';
}

function getNumericDisplayPartsFromParsed(parsed, keepWholeValue = false) {
    if (!parsed.isNumeric) {
        return [{className: 'workspace-metric-value-major', text: parsed.raw}];
    }
    if (keepWholeValue || !parsed.decimalPart) {
        return [{
            className: 'workspace-metric-value-major',
            text: keepWholeValue
                ? parsed.raw
                : `${parsed.prefix}${parsed.integerPart}${parsed.suffix}`,
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

export function getNumericDisplayParts(value) {
    const parsed = parseNumericDisplayValue(value);
    const currencyCode = getCurrencyCodeFromNumericPrefix(parsed.prefix);
    return getNumericDisplayPartsFromParsed(
        parsed,
        getCurrencyMinorUnitDigits(currencyCode) === 0,
    );
}

const CURRENCY_CODE_ALIASES = Object.freeze({
    CNH: 'CNY',
    RMB: 'CNY',
});

export function getCurrencyMinorUnitDigits(currencyCode) {
    const rawCode = String(currencyCode ?? '').trim().toUpperCase();
    const normalizedCode = CURRENCY_CODE_ALIASES[rawCode] ?? rawCode;
    if (!/^[A-Z]{3}$/.test(normalizedCode)) return null;
    try {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: normalizedCode,
        }).resolvedOptions().maximumFractionDigits;
    } catch {
        return null;
    }
}

export function getMonetaryDisplayParts(value, currencyCode) {
    const parsed = parseNumericDisplayValue(value);
    return getNumericDisplayPartsFromParsed(
        parsed,
        getCurrencyMinorUnitDigits(currencyCode) === 0,
    );
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
        .map((part) => `<span class="${part.className}" aria-hidden="true">${escapeHtml(part.text)}</span>`)
        .join('');
}

export function renderMonetaryDisplayContent(value, currencyCode) {
    return getMonetaryDisplayParts(value, currencyCode)
        .map((part) => `<span class="${part.className}" aria-hidden="true">${escapeHtml(part.text)}</span>`)
        .join('');
}

function setNumericDisplayAccessibility(element, value) {
    element.setAttribute('aria-label', parseNumericDisplayValue(value).raw);
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
        const currencyCode = element.dataset.currencyCode ?? '';
        if (
            element.dataset.numericDisplayRendered === value
            && (element.dataset.numericDisplayCurrency ?? '') === currencyCode
        ) return;
        setNumericDisplayAccessibility(element, value);
        element.innerHTML = currencyCode
            ? renderMonetaryDisplayContent(value, currencyCode)
            : renderNumericDisplayContent(value);
        element.dataset.numericDisplayRendered = value;
        element.dataset.numericDisplayCurrency = currencyCode;
    });

    const cellElements = collectMatchingElements(root, '[data-numeric-display-cell]');
    cellElements.forEach((element) => {
        if (element.dataset.numericDisplayRendered === 'cell') return;
        const parsed = parseNumericDisplayValue(element.textContent);
        if (!parsed.isNumeric || !parsed.decimalPart) return;
        const currencyCode = element.dataset.currencyCode ?? '';
        setNumericDisplayAccessibility(element, parsed.raw);
        element.innerHTML = currencyCode
            ? renderMonetaryDisplayContent(parsed.raw, currencyCode)
            : renderNumericDisplayContent(parsed.raw);
        element.dataset.numericDisplayRendered = 'cell';
        element.dataset.numericDisplayCurrency = currencyCode;
    });
}

const numericDisplayApi = Object.freeze({
    enhanceNumericDisplayElements,
    getCurrencyMinorUnitDigits,
    getMonetaryDisplayParts,
    getNumericDisplayParts,
    parseNumericDisplayValue,
    renderMonetaryDisplayContent,
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
