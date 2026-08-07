/**
 * Investment URL state parsing and serialization.
 *
 * Code version: v1.1.0
 * - Changed: Overview and Stock-details ranges stay scoped to their own tabs.
 * - Changed: Metrics broker state is serialized only while Metrics is active.
 */

export const INVESTMENT_URL_STATE_MODULE_VERSION = 'v1.1.0';

const INVESTMENT_URL_VIEW_SLUGS = Object.freeze({
    chart: 'overview',
    holdings: 'holdings',
    stock_details: 'stock-details',
    metrics: 'metrics',
});

const INVESTMENT_URL_VIEW_ALIASES = Object.freeze({
    overview: 'chart',
    chart: 'chart',
    holdings: 'holdings',
    'stock-details': 'stock_details',
    stock_details: 'stock_details',
    metrics: 'metrics',
});

const INVESTMENT_URL_RANGE_VALUES = new Set([
    '1w',
    '1m',
    '3m',
    'ytd',
    '1y',
    'max',
    'auto',
]);

const INVESTMENT_URL_PARAMETER_NAMES = Object.freeze([
    'view',
    'ticker',
    'range',
    'metrics-broker',
    'broker',
    'type',
    'currency',
    'description',
    'date',
    'page',
]);

function resolveUrl(input) {
    if (input instanceof URL) return new URL(input.href);
    if (input && typeof input === 'object' && typeof input.href === 'string') {
        return new URL(input.href, 'http://localhost');
    }
    return new URL(String(input || ''), 'http://localhost');
}

function normalizeView(value, fallback = 'chart') {
    const normalized = String(value || '').trim().toLowerCase();
    return INVESTMENT_URL_VIEW_ALIASES[normalized] || fallback;
}

function normalizeTicker(value, fallback = '') {
    const normalized = String(value || '').trim().toUpperCase();
    return normalized || fallback;
}

function normalizeRange(value, fallback = 'max') {
    const normalized = String(value || '').trim().toLowerCase();
    return INVESTMENT_URL_RANGE_VALUES.has(normalized) ? normalized : fallback;
}

function getDelimitedValues(params, name) {
    return params.getAll(name)
        .flatMap((value) => String(value || '').split(','))
        .map((value) => value.trim())
        .filter(Boolean);
}

function normalizeFilterList(values, {uppercase = false} = {}) {
    return Array.from(new Set(values
        .map((value) => uppercase ? value.toUpperCase() : value.toLowerCase())
        .filter(Boolean)));
}

function parseBrokerSelection(params) {
    const values = normalizeFilterList(getDelimitedValues(params, 'broker'));
    if (!values.length || values.includes('all')) {
        return {all: true, codes: []};
    }
    return {all: false, codes: values};
}

function parseTypeSelection(params) {
    const values = normalizeFilterList(getDelimitedValues(params, 'type'));
    if (!values.length || values.includes('all')) return 'all';
    if (values.includes('none')) return 'none';
    return values;
}

function parseDateFilter(params) {
    const value = String(params.get('date') || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return {mode: 'day', value};
    }
    if (/^\d{4}-\d{2}$/.test(value)) {
        return {mode: 'month', value};
    }
    return {mode: 'all', value: ''};
}

export function parseInvestmentUrlState(input, {tickerNormalizer = normalizeTicker} = {}) {
    const url = resolveUrl(input);
    const params = url.searchParams;
    const legacyStockDetailsHash = [
        '#stock_panel',
        '#investment_stock_details_panel',
    ].includes(url.hash);
    const view = normalizeView(
        params.get('view') || (legacyStockDetailsHash ? 'stock-details' : 'overview'),
    );
    const range = normalizeRange(params.get('range'));
    const metricsBroker = String(params.get('metrics-broker') || 'all').trim().toLowerCase() || 'all';
    const currency = String(params.get('currency') || 'all').trim().toUpperCase() || 'all';
    const description = String(params.get('description') || 'all').trim().toLowerCase() === 'unbound'
        ? 'unbound'
        : 'all';
    const pageValue = Number.parseInt(String(params.get('page') || '1'), 10);
    const hasKnownQueryState = INVESTMENT_URL_PARAMETER_NAMES.some((name) => params.has(name));

    return {
        view,
        viewSlug: INVESTMENT_URL_VIEW_SLUGS[view],
        ticker: tickerNormalizer(params.get('ticker') || ''),
        range,
        metricsBroker,
        brokerSelection: parseBrokerSelection(params),
        typeFilter: parseTypeSelection(params),
        currencyFilter: currency === 'ALL' ? 'all' : currency,
        descriptionFilter: description,
        dateFilter: parseDateFilter(params),
        page: Number.isFinite(pageValue) ? Math.max(1, pageValue) : 1,
        hasExplicitState: hasKnownQueryState || legacyStockDetailsHash,
    };
}

function serializeDelimitedSelection(value, {uppercase = false} = {}) {
    const values = Array.isArray(value)
        ? value
        : String(value || '').split(',');
    return normalizeFilterList(
        values.flatMap((item) => String(item || '').split(',')),
        {uppercase},
    ).sort((left, right) => left.localeCompare(right));
}

function setIfNonDefault(params, name, value, defaultValue) {
    const normalizedValue = String(value || '').trim();
    if (normalizedValue && normalizedValue !== defaultValue) {
        params.set(name, normalizedValue);
    }
}

export function buildInvestmentUrl(input, state = {}) {
    const url = resolveUrl(input);
    const params = url.searchParams;
    INVESTMENT_URL_PARAMETER_NAMES.forEach((name) => params.delete(name));
    const view = normalizeView(state.view);
    const viewSlug = INVESTMENT_URL_VIEW_SLUGS[view];
    params.set('view', viewSlug);

    const ticker = normalizeTicker(state.ticker);
    if (view === 'stock_details' && ticker) params.set('ticker', ticker);

    if (view === 'stock_details') {
        setIfNonDefault(
            params,
            'range',
            normalizeRange(state.stockDetailsRange ?? state.range),
            'max',
        );
    } else if (view === 'chart') {
        setIfNonDefault(
            params,
            'range',
            normalizeRange(state.overviewRange ?? state.range),
            'max',
        );
    }

    const metricsBroker = String(state.metricsBroker || 'all').trim().toLowerCase();
    if (view === 'metrics') {
        setIfNonDefault(params, 'metrics-broker', metricsBroker, 'all');
    }

    const brokerSelection = state.brokerSelection || {};
    if (!brokerSelection.all) {
        const brokerCodes = serializeDelimitedSelection(brokerSelection.codes);
        if (brokerCodes.length) params.set('broker', brokerCodes.join(','));
    }

    const typeFilter = state.typeFilter;
    if (Array.isArray(typeFilter)) {
        const typeValues = serializeDelimitedSelection(typeFilter);
        if (typeValues.length) params.set('type', typeValues.join(','));
    } else {
        setIfNonDefault(params, 'type', typeFilter, 'all');
    }

    const currency = String(state.currencyFilter || 'all').trim().toUpperCase();
    setIfNonDefault(params, 'currency', currency === 'ALL' ? 'all' : currency, 'all');
    setIfNonDefault(params, 'description', state.descriptionFilter, 'all');

    const dateFilter = state.dateFilter || {};
    if (dateFilter.mode === 'day' || dateFilter.mode === 'month') {
        const dateValue = String(dateFilter.value || '').trim();
        if ((dateFilter.mode === 'day' && /^\d{4}-\d{2}-\d{2}$/.test(dateValue))
            || (dateFilter.mode === 'month' && /^\d{4}-\d{2}$/.test(dateValue))) {
            params.set('date', dateValue);
        }
    }

    const page = Number.parseInt(String(state.page || '1'), 10);
    if (Number.isFinite(page) && page > 1) params.set('page', String(page));
    url.hash = '';
    return `${url.pathname}${url.search}${url.hash}`;
}

export function getInvestmentUrlViewSlug(view) {
    return INVESTMENT_URL_VIEW_SLUGS[normalizeView(view)] || INVESTMENT_URL_VIEW_SLUGS.chart;
}

export function getInvestmentUrlParameterNames() {
    return [...INVESTMENT_URL_PARAMETER_NAMES];
}
