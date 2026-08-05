/* Tests for the canonical Settings URL state contract. Code version: v0.2.0 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
    SETTINGS_URL_STATE_MODULE_VERSION,
    buildSettingsUrl,
    getSettingsUrlParameterNames,
    parseSettingsUrlState,
} from '../app/web/static/assets/js/settings/url-state.js';

test('exposes the Settings URL contract and stable parameter names', () => {
    assert.equal(SETTINGS_URL_STATE_MODULE_VERSION, 'v0.2.0');
    assert.deepEqual(getSettingsUrlParameterNames(), [
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
});

test('parses canonical and legacy Settings locations into one state', () => {
    const canonical = parseSettingsUrlState(
        'http://localhost:8688/settings/general?tab=history&page=2',
    );
    const legacy = parseSettingsUrlState(
        'http://localhost:8688/settings?section=general&language_tab=history&local_page=2',
    );

    assert.deepEqual(
        {
            section: canonical.section,
            tab: canonical.tab,
            page: canonical.page,
            hasExplicitState: canonical.hasExplicitState,
        },
        {
            section: legacy.section,
            tab: legacy.tab,
            page: legacy.page,
            hasExplicitState: legacy.hasExplicitState,
        },
    );
    assert.equal(canonical.section, 'general');
    assert.equal(canonical.tab, 'history');
    assert.equal(canonical.page, 2);
});

test('omits default state and serializes tab before page', () => {
    assert.equal(
        buildSettingsUrl(
            'http://localhost:8688/settings/general?settings_tab=current&local_page=1&unused=drop#language',
            {section: 'general', tab: 'current', page: 1},
        ),
        '/settings/general#language',
    );
    assert.equal(
        buildSettingsUrl(
            'http://localhost:8688/settings/general?language_page=2',
            {section: 'general', tab: 'history', page: 2},
        ),
        '/settings/general?tab=history&page=2',
    );
});

test('drops irrelevant state when navigating to a non-paginated section', () => {
    assert.equal(
        buildSettingsUrl(
            'http://localhost:8688/settings/general?tab=history&page=4',
            {section: 'style_tokens', tab: 'history', page: 4},
        ),
        '/settings/style-tokens',
    );
    assert.equal(
        buildSettingsUrl(
            'http://localhost:8688/settings/local_store?page=3',
            {section: 'local_store', page: 3},
        ),
        '/settings/local-market-store?page=3',
    );
});
