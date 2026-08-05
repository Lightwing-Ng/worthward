/**
 * Canonical Settings URL state parsing and serialization.
 *
 * Code version: v0.2.0
 */

export const SETTINGS_URL_STATE_MODULE_VERSION = 'v0.2.0';

const SETTINGS_DEFAULT_SECTION = 'about';
const SETTINGS_DEFAULT_TAB = 'current';
const SETTINGS_DEFAULT_PAGE = 1;
const SETTINGS_PAGINATED_SECTIONS = new Set(['general', 'local-market-store']);
const SETTINGS_SECTIONS = new Set([
    'about',
    'general',
    'backtest',
    'font-tokens',
    'color-tokens',
    'material-tokens',
    'network',
    'strategies',
    'email-smtp',
    'broker-access',
    'local-market-store',
    'clear-caches',
    'style-tokens',
    'export-image',
    'cash-equivalents',
]);
const SETTINGS_SECTION_ALIASES = Object.freeze({
    broker: 'broker-access',
    broker_access: 'broker-access',
    font_tokens: 'font-tokens',
    color_tokens: 'color-tokens',
    local_market_store: 'local-market-store',
    local_store: 'local-market-store',
    material_tokens: 'material-tokens',
    style_tokens: 'style-tokens',
    cash_equivalents: 'cash-equivalents',
    clear_caches: 'clear-caches',
    email_smtp: 'email-smtp',
    export_image: 'export-image',
});
const SETTINGS_TABS = new Set(['current', 'history']);
const SETTINGS_PARAMETER_NAMES = Object.freeze([
    'section',
    'settings_section',
    'tab',
    'settings_tab',
    'language_tab',
    'page',
    'settings_page',
    'local_page',
    'language_page',
]);

function resolveUrl(input) {
    if (input instanceof URL) return new URL(input.href);
    if (input && typeof input === 'object' && typeof input.href === 'string') {
        return new URL(input.href, 'http://localhost');
    }
    return new URL(String(input || ''), 'http://localhost');
}

function normalizeValue(value) {
    return String(value ?? '').trim();
}

function normalizeLower(value) {
    return normalizeValue(value).toLowerCase();
}

function readFirst(params, names) {
    for (const name of names) {
        const value = normalizeValue(params.get(name));
        if (value) return value;
    }
    return '';
}

function normalizeSection(value) {
    const candidate = normalizeLower(value) || SETTINGS_DEFAULT_SECTION;
    const aliased = SETTINGS_SECTION_ALIASES[candidate] || candidate;
    return SETTINGS_SECTIONS.has(aliased) ? aliased : SETTINGS_DEFAULT_SECTION;
}

function normalizeTab(value) {
    const candidate = normalizeLower(value);
    return SETTINGS_TABS.has(candidate) ? candidate : SETTINGS_DEFAULT_TAB;
}

function normalizePage(value) {
    const parsed = Number.parseInt(normalizeValue(value), 10);
    return Number.isFinite(parsed) ? Math.max(SETTINGS_DEFAULT_PAGE, parsed) : SETTINGS_DEFAULT_PAGE;
}

function getPathSection(url) {
    const match = url.pathname.match(/^\/settings\/([^/]+)\/?$/i);
    return match ? normalizeSection(decodeURIComponent(match[1])) : '';
}

function getSectionFromUrl(url) {
    return getPathSection(url)
        || normalizeSection(readFirst(url.searchParams, ['section', 'settings_section']));
}

export function parseSettingsUrlState(input) {
    const url = resolveUrl(input);
    const params = url.searchParams;
    const section = getSectionFromUrl(url);
    const tab = normalizeTab(readFirst(params, ['tab', 'settings_tab', 'language_tab']));
    const page = normalizePage(readFirst(params, ['page', 'settings_page', 'local_page', 'language_page']));
    const hasExplicitState = SETTINGS_PARAMETER_NAMES.some((name) => params.has(name));

    return {
        pathname: url.pathname,
        section,
        tab,
        page,
        hasExplicitState,
    };
}

function clearSettingsParameters(params, {preserveUnknown = false} = {}) {
    Array.from(params.keys()).forEach((name) => {
        if (SETTINGS_PARAMETER_NAMES.includes(name) || !preserveUnknown) params.delete(name);
    });
}

export function buildSettingsUrl(input, state = {}, {preserveUnknown = false} = {}) {
    const url = resolveUrl(input);
    const parsedState = parseSettingsUrlState(url);
    const section = normalizeSection(state.section ?? parsedState.section);
    const tab = normalizeTab(state.tab ?? parsedState.tab);
    const page = normalizePage(state.page ?? parsedState.page);
    const params = url.searchParams;
    clearSettingsParameters(params, {preserveUnknown});

    if (section === 'general' && tab === 'history') params.set('tab', 'history');
    if (SETTINGS_PAGINATED_SECTIONS.has(section) && page > SETTINGS_DEFAULT_PAGE) {
        params.set('page', String(page));
    }

    url.pathname = `/settings/${section}`;
    return `${url.pathname}${params.toString() ? `?${params.toString()}` : ''}${url.hash}`;
}

export function getSettingsUrlParameterNames() {
    return [...SETTINGS_PARAMETER_NAMES];
}
