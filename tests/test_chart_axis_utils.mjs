/* Shared chart axis helper contracts. Code version: v1.4.0 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// package.json sets "type": "module", so the classic script attaches to globalThis.
require(path.join(root, 'app/web/static/assets/js/chart-axis-utils.js'));
const utils = globalThis.ANTIGRAVITY_CHART_AXIS;

const TOKEN_SPECS = Object.freeze([
    {
        key: 'text',
        cssName: '--theme-text',
        appThemeKey: 'text',
        cssValue: 'css-text',
        fallbackValue: 'fallback-text',
        themeValue: 'app-text',
    },
    {
        key: 'muted',
        cssName: '--theme-muted',
        appThemeKey: 'muted',
        cssValue: 'css-muted',
        fallbackValue: 'fallback-muted',
        themeValue: 'app-muted',
    },
    {
        key: 'accentPrimary',
        cssName: '--theme-accent-primary',
        appThemeKey: 'accent_primary',
        cssValue: 'css-primary',
        fallbackValue: 'fallback-primary',
        themeValue: 'app-primary',
    },
    {
        key: 'accentSecondary',
        cssName: '--theme-accent-secondary',
        appThemeKey: 'accent_secondary',
        cssValue: 'css-secondary',
        fallbackValue: 'fallback-secondary',
        themeValue: 'app-secondary',
    },
    {
        key: 'accentPositive',
        cssName: '--theme-accent-positive',
        appThemeKey: 'accent_positive',
        cssValue: 'css-positive',
        fallbackValue: 'fallback-positive',
        themeValue: 'app-positive',
    },
]);

function withThemeEnvironment({ cssTokens = {}, appTheme, run }) {
    const previousDocument = Object.prototype.hasOwnProperty.call(globalThis, 'document')
        ? globalThis.document
        : undefined;
    const previousGetComputedStyle = Object.prototype.hasOwnProperty.call(globalThis, 'getComputedStyle')
        ? globalThis.getComputedStyle
        : undefined;
    const previousApp = Object.prototype.hasOwnProperty.call(globalThis, 'ANTIGRAVITY_APP')
        ? globalThis.ANTIGRAVITY_APP
        : undefined;
    const hadDocument = Object.prototype.hasOwnProperty.call(globalThis, 'document');
    const hadGetComputedStyle = Object.prototype.hasOwnProperty.call(globalThis, 'getComputedStyle');
    const hadApp = Object.prototype.hasOwnProperty.call(globalThis, 'ANTIGRAVITY_APP');

    try {
        globalThis.document = { body: {} };
        globalThis.getComputedStyle = () => ({
            getPropertyValue: (name) => {
                const value = cssTokens[name];
                return value === undefined || value === null ? '' : String(value);
            },
        });
        if (appTheme === undefined) {
            delete globalThis.ANTIGRAVITY_APP;
        } else {
            globalThis.ANTIGRAVITY_APP = { theme: appTheme };
        }
        return run();
    } finally {
        if (hadDocument) {
            globalThis.document = previousDocument;
        } else {
            delete globalThis.document;
        }
        if (hadGetComputedStyle) {
            globalThis.getComputedStyle = previousGetComputedStyle;
        } else {
            delete globalThis.getComputedStyle;
        }
        if (hadApp) {
            globalThis.ANTIGRAVITY_APP = previousApp;
        } else {
            delete globalThis.ANTIGRAVITY_APP;
        }
    }
}

test('exposes a versioned shared chart axis API', () => {
    assert.ok(utils, 'ANTIGRAVITY_CHART_AXIS should be installed on globalThis');
    assert.match(utils.CHART_AXIS_UTILS_VERSION, /^v\d+\.\d+\.\d+$/);
    assert.equal(typeof utils.buildTickIndexSet, 'function');
    assert.equal(typeof utils.sortedTickIndexes, 'function');
    assert.equal(typeof utils.formatStockPriceAxisValue, 'function');
    assert.equal(typeof utils.buildAllInEquitySeries, 'function');
    assert.equal(typeof utils.drawYAxisValueBadge, 'function');
    assert.equal(typeof utils.readPxToken, 'function');
    assert.equal(typeof utils.readThemeTokens, 'function');
    assert.equal(typeof utils.readThemeToken, 'function');
    assert.equal(typeof utils.normalizeSafeImageUrl, 'function');
});

test('draws a blue rounded y-axis badge on the rendered decimal anchor', () => {
    const previousGetComputedStyle = globalThis.getComputedStyle;
    const hadGetComputedStyle = Object.prototype.hasOwnProperty.call(globalThis, 'getComputedStyle');
    const drawCalls = [];
    const ctx = {
        fillStyle: '',
        font: '',
        textAlign: '',
        textBaseline: '',
        save() {},
        restore() {},
        beginPath() {},
        measureText(copy) {
            return {width: String(copy).length * 6};
        },
        roundRect(...args) {
            drawCalls.push({kind: 'roundRect', args});
        },
        fill() {
            drawCalls.push({kind: 'fill', fillStyle: this.fillStyle});
        },
        fillText(copy, x, y) {
            drawCalls.push({
                kind: 'fillText',
                copy,
                x,
                y,
                fillStyle: this.fillStyle,
                textAlign: this.textAlign,
            });
        },
    };
    const chart = {
        canvas: {},
        ctx,
        chartArea: {top: 10, bottom: 90, left: 70},
        scales: {
            y: {
                right: 70,
                ticks: [{value: 80}, {value: 120}],
                _labelItems: [
                    {
                        label: '80',
                        font: {string: '400 12px Axis Font'},
                        options: {translation: [64, 20], textAlign: 'right'},
                    },
                    {
                        label: '120.00',
                        font: {string: '400 12px Axis Font'},
                        options: {translation: [64, 40], textAlign: 'right'},
                    },
                ],
            },
        },
    };

    try {
        globalThis.getComputedStyle = () => ({
            getPropertyValue: (name) => (
                name === '--investment-holdings-allocation-badge-radius' ? '10px' : ''
            ),
        });
        const bounds = utils.drawYAxisValueBadge(chart, {
            y: 50,
            value: 123.45,
            formattedValue: '123.45',
            formatTickLabel: (value) => Number(value).toFixed(2),
            boundsProperty: '_activeGuideBounds',
            boundsAliases: {price: 123.45},
        });

        assert.deepEqual(bounds, {
            badgeBottom: 60,
            badgeLeft: 23,
            badgeRight: 69,
            badgeTop: 40,
            axisLabelRight: 64,
            axisTickCopy: '120.00',
            decimalAnchor: 46,
            formattedValue: '123.45',
            value: 123.45,
            y: 50,
            price: 123.45,
        });
        assert.deepEqual(chart._activeGuideBounds, bounds);
        assert.deepEqual(
            drawCalls.find((call) => call.kind === 'roundRect'),
            {kind: 'roundRect', args: [23, 40, 46, 20, 10]},
        );
        assert.equal(
            drawCalls.find((call) => call.kind === 'fill').fillStyle,
            '#0055cc',
        );
        assert.deepEqual(
            drawCalls.filter((call) => call.kind === 'fillText'),
            [
                {
                    kind: 'fillText',
                    copy: '123',
                    x: 46,
                    y: 50,
                    fillStyle: '#ffffff',
                    textAlign: 'right',
                },
                {
                    kind: 'fillText',
                    copy: '.45',
                    x: 46,
                    y: 50,
                    fillStyle: '#ffffff',
                    textAlign: 'left',
                },
            ],
        );
    } finally {
        if (hadGetComputedStyle) {
            globalThis.getComputedStyle = previousGetComputedStyle;
        } else {
            delete globalThis.getComputedStyle;
        }
    }
});

test('reads numeric CSS pixel tokens and falls back for missing values', () => {
    const hadElement = Object.prototype.hasOwnProperty.call(globalThis, 'Element');
    const previousElement = globalThis.Element;
    class TestElement {}
    globalThis.Element = TestElement;
    try {
        const element = new TestElement();
        assert.equal(
            withThemeEnvironment({
                cssTokens: {'--chart-line-width': '2px'},
                run: () => utils.readPxToken(element, '--chart-line-width', 5),
            }),
            2,
        );
        assert.equal(
            withThemeEnvironment({
                cssTokens: {'--chart-line-width': 'auto'},
                run: () => utils.readPxToken(element, '--chart-line-width', 5),
            }),
            5,
        );
    } finally {
        if (hadElement) {
            globalThis.Element = previousElement;
        } else {
            delete globalThis.Element;
        }
    }
});

test('formats every stock-price y axis with one project-wide precision contract', () => {
    assert.equal(utils.STOCK_PRICE_INTEGER_THRESHOLD, 100);
    assert.equal(utils.formatStockPriceAxisValue(1_234), '1,234');
    assert.equal(utils.formatStockPriceAxisValue(567), '567');
    assert.equal(utils.formatStockPriceAxisValue(100), '100');
    assert.equal(utils.formatStockPriceAxisValue(99.5), '99.50');
    assert.equal(utils.formatStockPriceAxisValue(12.5), '12.50');
    assert.equal(utils.formatStockPriceAxisValue(5.5), '5.50');
    assert.equal(utils.formatStockPriceAxisValue(-567), '-567');
    assert.equal(utils.formatStockPriceAxisValue(-12.5), '-12.50');
});

test('adds a currency prefix only when a stock-price axis requests it', () => {
    assert.equal(
        utils.formatStockPriceAxisValue(1_234, {currency: 'KRW', showCurrency: true}),
        'KRW 1,234',
    );
    assert.equal(
        utils.formatStockPriceAxisValue(12.5, {currency: 'USD', showCurrency: false}),
        '12.50',
    );
    assert.equal(utils.formatStockPriceAxisValue(Number.NaN), '');
    assert.equal(utils.formatStockPriceAxisValue('unavailable'), '');
});

test('every stock-price chart consumer delegates its y-axis labels to the shared formatter', async () => {
    const consumerPaths = [
        'app/web/static/assets/js/backtest.js',
        'app/web/static/assets/js/dca.js',
        'app/web/static/assets/js/price-compare.js',
        'app/web/static/assets/js/live-trading.js',
        'app/web/static/assets/js/investment/stock-details.js',
        'app/web/static/assets/js/settings.js',
    ];
    for (const consumerPath of consumerPaths) {
        const source = await readFile(path.join(root, consumerPath), 'utf8');
        assert.match(source, /chartAxis\.formatStockPriceAxisValue/, consumerPath);
    }
});

test('normalizeSafeImageUrl permits only HTTP(S) and controlled local logo paths', () => {
    assert.equal(
        utils.normalizeSafeImageUrl('/market-store/logos/AAPL.svg?version=1#mark'),
        '/market-store/logos/AAPL.svg?version=1#mark',
    );
    assert.equal(
        utils.normalizeSafeImageUrl('/api/market-store/logos/QQQ.png'),
        '/api/market-store/logos/QQQ.png',
    );
    assert.equal(
        utils.normalizeSafeImageUrl('https://logos.example/AAPL.svg'),
        'https://logos.example/AAPL.svg',
    );
    assert.equal(
        utils.normalizeSafeImageUrl('http://logos.example/QQQ.png'),
        'http://logos.example/QQQ.png',
    );

    [
        'javascript:alert(1)',
        'data:image/svg+xml,<svg></svg>',
        '//logos.example/AAPL.svg',
        '/market-store/logos/../private.svg',
        '/static/images/AAPL.svg',
        'logos/AAPL.svg',
        'https://[invalid',
    ].forEach((unsafeValue) => {
        assert.equal(utils.normalizeSafeImageUrl(unsafeValue), '', unsafeValue);
    });
});

test('buildTickIndexSet handles empty, single, and three-tick layouts', () => {
    assert.deepEqual([...utils.buildTickIndexSet(0, 800)], []);
    assert.deepEqual([...utils.buildTickIndexSet(1, 800)], [0]);
    assert.deepEqual(
        utils.sortedTickIndexes(10, 500),
        [0, 5, 9],
    );
});

test('buildTickIndexSet uses four ticks on wide viewports when enough points exist', () => {
    assert.deepEqual(
        utils.sortedTickIndexes(10, 800),
        [0, 3, 6, 9],
    );
    assert.deepEqual(
        utils.sortedTickIndexes(3, 800),
        [0, 1, 2],
    );
});

test('buildAllInEquitySeries uses the opening price and residual cash consistently', () => {
    assert.deepEqual(
        utils.buildAllInEquitySeries([100, 110], [105, 120], 1_000),
        [1_050, 1_200],
    );
    assert.deepEqual(
        utils.buildAllInEquitySeries([], [100, 110], 1_000),
        [1_000, 1_100],
    );
});

test('readThemeTokens prefers CSS custom properties over fallbacks and app theme', () => {
    const cssTokens = Object.fromEntries(
        TOKEN_SPECS.map((spec) => [spec.cssName, `  ${spec.cssValue}  `]),
    );
    const fallbacks = Object.fromEntries(
        TOKEN_SPECS.map((spec) => [spec.key, spec.fallbackValue]),
    );
    const appTheme = Object.fromEntries(
        TOKEN_SPECS.map((spec) => [spec.appThemeKey, spec.themeValue]),
    );

    const tokens = withThemeEnvironment({
        cssTokens,
        appTheme,
        run: () => utils.readThemeTokens(fallbacks),
    });

    for (const spec of TOKEN_SPECS) {
        assert.equal(tokens[spec.key], spec.cssValue, `${spec.key} should use trimmed CSS token`);
    }
});

test('readThemeTokens uses explicit fallbacks when CSS tokens are missing', () => {
    const fallbacks = Object.fromEntries(
        TOKEN_SPECS.map((spec) => [spec.key, spec.fallbackValue]),
    );
    const appTheme = Object.fromEntries(
        TOKEN_SPECS.map((spec) => [spec.appThemeKey, spec.themeValue]),
    );

    const tokens = withThemeEnvironment({
        cssTokens: {},
        appTheme,
        run: () => utils.readThemeTokens(fallbacks),
    });

    for (const spec of TOKEN_SPECS) {
        assert.equal(tokens[spec.key], spec.fallbackValue, `${spec.key} should use explicit fallback`);
    }
});

test('readThemeTokens uses ANTIGRAVITY_APP.theme when CSS and fallbacks are missing', () => {
    const appTheme = Object.fromEntries(
        TOKEN_SPECS.map((spec) => [spec.appThemeKey, spec.themeValue]),
    );

    const tokens = withThemeEnvironment({
        cssTokens: {},
        appTheme,
        run: () => utils.readThemeTokens({}),
    });

    for (const spec of TOKEN_SPECS) {
        assert.equal(tokens[spec.key], spec.themeValue, `${spec.key} should use app theme`);
    }
});

test('readThemeTokens returns empty strings when every source is missing', () => {
    const tokens = withThemeEnvironment({
        cssTokens: {},
        appTheme: undefined,
        run: () => utils.readThemeTokens({}),
    });

    for (const spec of TOKEN_SPECS) {
        assert.equal(tokens[spec.key], '', `${spec.key} should be empty without sources`);
    }
});

test('readThemeTokens restores global document theme state after each assertion path', () => {
    const sentinelDocument = { body: { id: 'sentinel-document' } };
    const sentinelStyle = () => ({ getPropertyValue: () => 'sentinel-css' });
    const sentinelApp = { theme: { text: 'sentinel-app' } };

    globalThis.document = sentinelDocument;
    globalThis.getComputedStyle = sentinelStyle;
    globalThis.ANTIGRAVITY_APP = sentinelApp;

    try {
        withThemeEnvironment({
            cssTokens: { '--theme-text': 'temporary' },
            appTheme: { text: 'temporary-app' },
            run: () => {
                const tokens = utils.readThemeTokens({ text: 'temporary-fallback' });
                assert.equal(tokens.text, 'temporary');
            },
        });
        assert.equal(globalThis.document, sentinelDocument);
        assert.equal(globalThis.getComputedStyle, sentinelStyle);
        assert.equal(globalThis.ANTIGRAVITY_APP, sentinelApp);
    } finally {
        delete globalThis.document;
        delete globalThis.getComputedStyle;
        delete globalThis.ANTIGRAVITY_APP;
    }
});
