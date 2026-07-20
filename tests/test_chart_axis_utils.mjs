/* Shared chart axis helper contracts. Code version: v1.1.0 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
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
    assert.equal(typeof utils.readThemeTokens, 'function');
    assert.equal(typeof utils.readThemeToken, 'function');
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
